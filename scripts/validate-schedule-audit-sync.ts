// validate-schedule-audit-sync.ts — the schedule change history must survive
// the device it was recorded on.
//
// WHY THIS EXISTS. utils/scheduleAudit.ts kept the schedule audit log ONLY in
// AsyncStorage (`mageid_schedule_audit::<projectId>`). The sign-out sweep
// deleted it, it never synced, and delay_events.evidence — a server row —
// carries pointers into it ({kind: 'schedule_audit', id}). On the laptop, on a
// new phone, or after a sign-out every such pointer dangled, and the delay
// register rendered it as if nothing were wrong. A delay claim is argued months
// later from exactly this record.
//
// The fix is a server copy (supabase/migrations/20260917100000_schedule_audit_
// log.sql) with the Last Planner mirror's shape. What this pins:
//   1. The merge: server wins, EXCEPT an entry whose write is still queued;
//      queued entries the device copy lost are restored; device entries the
//      server never saw are kept AND sent up; de-duplicated by id; another
//      project's rows never leak in.
//   2. The row: keyed on the entry's own id (upsert-idempotent under replay),
//      timestamps round-trip, ids spliced into `.in()` are filter-safe.
//   3. The writes go through the offline queue as upserts, and the load refuses
//      to let the server win blind when the queue cannot be read.
//   4. The delay register says so when a pointer cannot be resolved — and does
//      not call it "missing" when the server could not even be asked.
//   5. The migration: owner-only RLS TO authenticated, no DELETE, search_path
//      pinned, keep-first-write trigger, the migrate-before-OTA warning.
//
// Run via: bun scripts/validate-schedule-audit-sync.ts

import {
  mergeAuditWithCloud, auditEntryToRow, rowToAuditEntry, isQueryableAuditId,
  isSyncableAuditEntry, sortAuditNewestFirst, SCHEDULE_AUDIT_TABLE,
} from '../utils/scheduleAudit';
import type { ScheduleAuditEntry } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bun's global is not in the app tsconfig's types (tsc covers scripts/), so it
// is declared locally — same pattern as validate-schedule-verdict.ts.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' | 'tsx' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

const P = 'proj-1';
const U = '11111111-1111-1111-1111-111111111111';
function entry(id: string, at: string, over: Partial<ScheduleAuditEntry> = {}): ScheduleAuditEntry {
  return { id, at, user: 'gc@example.com', kind: 'task_edit', summary: `edit ${id}`, ...over };
}
const ids = (es: ScheduleAuditEntry[]) => es.map((e) => e.id).join(',');

// ── 1. merge ────────────────────────────────────────────────────────────────
console.log('\nmerge: server copy + device copy + offline queue');
{
  const localQueued = entry('queued', '2026-09-10T10:00:00.000Z', { summary: 'device copy' });
  const localSynced = entry('synced', '2026-09-09T10:00:00.000Z', { summary: 'device copy' });
  const localOnly = entry('local-only', '2026-09-08T10:00:00.000Z');
  const cloudRows = [
    // The server's copy of an entry whose newer write is still queued.
    auditEntryToRow(P, U, { ...localQueued, summary: 'server copy' }),
    // The server's copy of an entry already on the device: server wins.
    { ...auditEntryToRow(P, U, { ...localSynced, summary: 'server copy' }), at: '2026-09-09T10:00:00+00:00' },
    // Recorded on the other device.
    auditEntryToRow(P, U, entry('other-device', '2026-09-11T10:00:00.000Z')),
    // Another project's row must never be filed under this one.
    auditEntryToRow('proj-2', U, entry('foreign-project', '2026-09-12T10:00:00.000Z')),
    // A duplicate id in the page collapses to one.
    auditEntryToRow(P, U, entry('other-device', '2026-09-11T10:00:00.000Z')),
  ];
  const pending = new Map<string, Record<string, unknown>>([
    ['queued', auditEntryToRow(P, U, localQueued)],
    // Same-user re-auth: the sweep emptied the device copy, the queue kept this.
    ['reauth', auditEntryToRow(P, U, entry('reauth', '2026-09-13T10:00:00.000Z'))],
    ['reauth-other-project', auditEntryToRow('proj-2', U, entry('reauth-other-project', '2026-09-13T11:00:00.000Z'))],
  ]);
  const local = [localQueued, localSynced, localOnly, localSynced];
  const { entries, backfill } = mergeAuditWithCloud(local, cloudRows, pending, P, U);
  const byId = new Map(entries.map((e) => [e.id, e]));

  check('a queued entry keeps its device copy (the server has not seen the newest write)',
    byId.get('queued')?.summary === 'device copy', `got ${byId.get('queued')?.summary}`);
  check('an entry the server has keeps the SERVER copy',
    byId.get('synced')?.summary === 'server copy', `got ${byId.get('synced')?.summary}`);
  check('a device-only entry is kept', byId.has('local-only'));
  check('…and sent up as backfill, keyed on its own id',
    backfill.length === 1 && backfill[0].id === 'local-only' && backfill[0].row.id === 'local-only'
      && backfill[0].row.user_id === U && backfill[0].row.project_id === P,
    JSON.stringify(backfill.map((b) => b.id)));
  check('a queued/server entry is not re-sent as backfill',
    !backfill.some((b) => b.id === 'queued' || b.id === 'synced'));
  check('an entry recorded on the other device is merged in', byId.has('other-device'));
  check('a queued entry the device copy lost is restored (re-auth case)', byId.has('reauth'));
  check("another project's rows never leak in (server page or queue)",
    !byId.has('foreign-project') && !byId.has('reauth-other-project'), ids(entries));
  check('de-duplicated by id', entries.length === new Set(entries.map((e) => e.id)).size && entries.length === 5,
    ids(entries));
  check('newest first', ids(entries) === 'reauth,other-device,queued,synced,local-only', ids(entries));
  check('the server timestamp is normalised to the device form',
    byId.get('synced')?.at === '2026-09-09T10:00:00.000Z', byId.get('synced')?.at);

  const broken = { ...entry('no-time', ''), at: 'not a date' };
  const r2 = mergeAuditWithCloud([broken], [], new Map(), P, U);
  check('an entry the table cannot hold stays on the device, not sent (a terminal write)',
    r2.entries.length === 1 && r2.backfill.length === 0);
  check('isSyncableAuditEntry rejects an unreadable timestamp', !isSyncableAuditEntry(broken));

  const empty = mergeAuditWithCloud([], [], new Map(), P, U);
  check('nothing in, nothing out', empty.entries.length === 0 && empty.backfill.length === 0);
}

// ── 2. row shape ────────────────────────────────────────────────────────────
console.log('\nrow shape');
{
  const e = entry('e1', '2026-09-16T10:00:00.123Z', {
    kind: 'reflow', taskId: 't1', taskTitle: 'Drywall', changeOrderId: 'co-4',
    before: { finish: 60 }, after: { finish: 64 },
  });
  const row = auditEntryToRow(P, U, e);
  check('the row id IS the entry id (upsert on it is replay-idempotent)', row.id === e.id);
  check('the row names its table', SCHEDULE_AUDIT_TABLE === 'schedule_audit_log');
  const back = rowToAuditEntry({ ...row, at: '2026-09-16T10:00:00.123+00:00', created_at: '2026-09-17T00:00:00+00:00' });
  check('an entry round-trips through the server byte-identically',
    JSON.stringify(back) === JSON.stringify(e), `${JSON.stringify(back)}\n      ${JSON.stringify(e)}`);
  check('a row with no id is not an entry', rowToAuditEntry({ ...row, id: '' }) === null);
  check('a row with no readable time is not an entry', rowToAuditEntry({ ...row, at: null }) === null);
  check('uuid ids are queryable', isQueryableAuditId('3f2b6c1e-8a1d-4c2e-9b7a-0d3e5f6a7b8c'));
  check('fallback aud_ ids are queryable', isQueryableAuditId('aud_1726480000000_k3j9x2'));
  check('an id that would rewrite an in.(…) filter is refused',
    !isQueryableAuditId('a,b') && !isQueryableAuditId('a)') && !isQueryableAuditId('"x"') && !isQueryableAuditId(''));
  check('sort keeps an unreadable time at the bottom instead of dropping it',
    ids(sortAuditNewestFirst([entry('bad', 'x'), entry('ok', '2026-01-01T00:00:00.000Z')])) === 'ok,bad');
}

// ── 3. write/read paths ─────────────────────────────────────────────────────
console.log('\nwrite and read paths (source)');
{
  const src = read('utils/scheduleAudit.ts');
  const body = (start: string, end: string) => {
    const a = src.indexOf(start);
    const b = src.indexOf(end, a + 1);
    return a >= 0 && b > a ? src.slice(a, b) : '';
  };
  const append = body('export async function appendAuditToAsyncStorage', '// ─────');
  check('every append is pushed to the server copy', /await pushAuditEntry\(projectId, entry\)/.test(append));
  const push = body('async function pushAuditEntry', 'export type ScheduleAuditSource');
  check('the push goes through the offline queue as an upsert',
    /supabaseWriteDetailed\(SCHEDULE_AUDIT_TABLE, 'upsert', row\)/.test(push));
  check('no direct supabase write to the table anywhere in the module',
    !/\.from\(SCHEDULE_AUDIT_TABLE\)[\s\S]{0,40}\.(insert|upsert|update|delete)\(/.test(src));
  check('offlineQueue / lib/supabase are not statically imported (bun must import the pure fns)',
    !/^import[^\n]*from '@\/(utils\/offlineQueue|lib\/supabase)'/m.test(src));
  const load = body('export async function loadScheduleAudit', 'export async function findScheduleAuditEntries');
  check('the load reads the offline queue for pending writes', /getOwnOfflineQueueDetailed\(\)/.test(load));
  check('…and refuses to let the server win blind when the queue is unreadable',
    /if \(queued\.readFailed\) throw/.test(load));
  check('…and counts this session’s in-flight pushes as pending', /for \(const \[id, row\] of inFlightRows\) pending\.set/.test(load));
  check('…and merges under the project lock, re-reading the device copy first',
    /withProjectLock\(projectId,[\s\S]*loadAuditFromAsyncStorage\(projectId\)[\s\S]*mergeAuditWithCloud\(latest/.test(load));
  check('…and does not write a merge back over a session that changed hands',
    /currentSessionUserId\(\)\) !== userId\) return/.test(load));
  check('the device cache stays capped', /entries\.slice\(0, MAX_ENTRIES\)/.test(load));
  const find = body('export async function findScheduleAuditEntries', '/** UI helper');
  check('the by-id lookup only splices filter-safe ids', /filter\(isQueryableAuditId\)/.test(find));
  check('the by-id lookup does not answer "not found" while signed out',
    /if \(!userId\) return \{ found: fromDevice, source: 'local-only' \}/.test(find));

  const modal = read('components/schedule/ScheduleAuditModal.tsx');
  check('the History viewer reads the merged log', /loadScheduleAudit\(props\.projectId\)/.test(modal));
  check('…and says when it is showing this device only', /On this device only/.test(modal));
}

// ── 4. the delay register ───────────────────────────────────────────────────
console.log('\ndelay register: a pointer that cannot be resolved says so');
{
  const screen = read('app/delay-events.tsx');
  check('the register reads the merged log', /loadScheduleAudit\(projectId\)/.test(screen));
  check('pointers the merged page lacks are looked up by id', /findScheduleAuditEntries\(projectId, missing\)/.test(screen));
  check('BOTH evidence strips (log form + event detail) get the pointer status',
    (screen.match(/auditStatus=\{statusForAuditPointer\}/g) ?? []).length === 2);
  check('the strip renders the warning for a schedule_audit pointer',
    /r\.kind === 'schedule_audit' \? auditPointerWarning\(auditStatus\(r\.id\), !!r\.note\)/.test(screen)
      && /\{warning\}<\/Text>/.test(screen));

  const start = screen.indexOf('type AuditPointerStatus');
  const end = screen.indexOf('export default function DelayEventsScreen');
  check('auditPointerStatus / auditPointerWarning are where this guard expects them', start >= 0 && end > start);
  if (start >= 0 && end > start) {
    const ts = `${screen.slice(start, end)}\nglobalThis.__aps = auditPointerStatus; globalThis.__apw = auditPointerWarning;`;
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(ts);
    new Function(js)();
    const g = globalThis as unknown as {
      __aps: (id: string, known: Set<string>, lookup: { found: Set<string>; source: string } | null) => string;
      __apw: (status: string, hasNote: boolean) => string | null;
    };
    const known = new Set(['a']);
    check('an entry in the loaded log resolves', g.__aps('a', known, null) === 'resolved');
    check('an entry found by id resolves', g.__aps('b', known, { found: new Set(['b']), source: 'cloud' }) === 'resolved');
    check('before the lookup answers, nothing is claimed', g.__aps('b', known, null) === 'checking');
    check('asked the server and it is not there → not_found',
      g.__aps('b', known, { found: new Set(), source: 'cloud' }) === 'not_found');
    check('could not ask the server → unverifiable, never "not found"',
      g.__aps('b', known, { found: new Set(), source: 'local-only' }) === 'unverifiable');
    check('a resolved or pending pointer shows no warning',
      g.__apw('resolved', true) === null && g.__apw('checking', true) === null);
    const nf = g.__apw('not_found', true) ?? '';
    check('not_found says so, names the other-account case, and labels the note as a copy',
      /isn't in your account's schedule history/.test(nf) && /another account/.test(nf) && /note copied/.test(nf), nf);
    const uv = g.__apw('unverifiable', false) ?? '';
    check('unverifiable says it could not check, and says when there is no note at all',
      /Couldn't check/.test(uv) && /No note was copied/.test(uv), uv);
  }
}

// ── 5. the migration ────────────────────────────────────────────────────────
console.log('\nmigration');
{
  const sql = read('supabase/migrations/20260917100000_schedule_audit_log.sql');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  check('creates the table the client writes', new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${SCHEDULE_AUDIT_TABLE}`).test(code));
  check('keyed on the entry id (text primary key)', /\bid text PRIMARY KEY/.test(code));
  check('RLS enabled', /ALTER TABLE public\.schedule_audit_log ENABLE ROW LEVEL SECURITY/.test(code));
  const policies = code.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
  check('three policies (select / insert / update)', policies.length === 3, String(policies.length));
  check('every policy is TO authenticated and owner-scoped',
    policies.every((p) => /TO authenticated/.test(p) && /auth\.uid\(\) = user_id/.test(p)));
  check('no DELETE policy and no DELETE grant',
    !policies.some((p) => /FOR DELETE/.test(p)) && !/GRANT[^;]*DELETE/.test(code));
  // Supabase's default privileges give `authenticated` TRUNCATE, which RLS
  // does not govern — so the grant is reset, not just DELETE revoked.
  check('authenticated privileges are reset to SELECT/INSERT/UPDATE (no TRUNCATE)',
    /REVOKE ALL ON public\.schedule_audit_log FROM authenticated;/.test(code)
      && /GRANT SELECT, INSERT, UPDATE ON public\.schedule_audit_log TO authenticated;/.test(code));
  check('every function pins search_path',
    (code.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length
      === (code.match(/CREATE OR REPLACE FUNCTION[\s\S]*?SET search_path = /g) ?? []).length);
  check('an UPDATE keeps the first-written row (append-only, silent on replay)',
    /BEFORE UPDATE ON public\.schedule_audit_log/.test(code) && /RETURN OLD;/.test(code));
  check('the header says to apply it before the OTA', /APPLY THIS BEFORE ANY OTA/.test(sql));
  check('the header states the collaborator decision', /collaborator's edits[\s\S]{0,120}NOT visible/.test(sql));
}

if (failures > 0) {
  console.error(`\n✗ validate-schedule-audit-sync: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\nall schedule-audit-sync checks passed\n');
