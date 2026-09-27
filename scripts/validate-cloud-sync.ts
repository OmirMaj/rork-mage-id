// validate-cloud-sync.ts — the cloud sync for saved code checks and the desktop
// takeoff (list round 3, 20260926180000_code_checks_takeoff_docs.sql).
//
// Proves:
//   1. utils/syncSeat: the seat verdict per role × tier (the RLS tiers:
//      code_checks 'field', takeoff_docs 'editor'), stamp parsing that treats
//      PostgREST's '+00:00' form and the client's 'Z' form as the same
//      instant, and a push stamp that is monotonic past the last server stamp;
//   2. utils/codeThread/syncMerge: local-only pushed, server-only kept, newer
//      wins (tie → server), the action union survives a server win, the cap
//      keeps the newest, a self-contradicting row is refused;
//   3. utils/takeoff/takeoffDocMerge: all five rules, rules 3 and 4 with a
//      PostgREST stamp, a conflict keeps what was added since the last sync and
//      never resurrects what was deleted, the backup only when the server wins,
//      aiDismissed, extra fields, a malformed server doc;
//   4. the row mappers;
//   5. COPY HONESTY: 'Saved to your account' only in the synced state;
//   6. STATIC: the migration's RLS / grants / triggers, no direct writes to
//      the two tables, the takeoff hook keeps its guards, the seat gate and
//      the verify read, every new key is swept, delete-account hands both
//      tables over;
//   7. list-3 follow-ups (lane R3F):
//      a. a code-check seat that recovers to writable re-syncs once per
//         transition (codeCheckResyncOwed), never on a repeat;
//      b. ONE queued takeoff write per job: a push is held while the last one
//         is still in the offline queue, settles once it has left, and the
//         latest doc is always the last write (a simulated offline session);
//      c. the workspace reads saveLine / conflict straight from the hook, and
//         the panel uses the hook's TakeoffConflict type;
//      d. 20260926190000_table_grant_hygiene.sql: shape, scope, idempotence.
//
// Run: bun run scripts/validate-cloud-sync.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CodeCheckRecord } from '../utils/codeThread/types';
import type { TakeoffDoc } from '../utils/takeoff/conditions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]): string => {
  try { return readFileSync(join(ROOT, ...p), 'utf8'); } catch { return ''; }
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}\n      want ${w}`);
}

// AsyncStorage's web build reads window.localStorage (the store imports it).
const mem = new Map<string, string>();
const g = globalThis as unknown as { window?: Record<string, unknown> };
g.window = g.window ?? {};
g.window.localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

async function main() {
  const { seatCanWrite, stampMs, nextPushStamp, seatReadStatus } = await import('../utils/syncSeat');
  const { codeCheckRow, recordFromRow, mergeCodeCheckLists } = await import('../utils/codeThread/syncMerge');
  const { MAX_CHECKS_PER_PROJECT, CODE_CHECKS_KEY } = await import('../utils/codeThread/store');
  const { CODE_CHECKS_CAPTION, unknownSeatState, codeCheckResyncOwed } = await import('../utils/codeThread/cloudSync');
  const {
    mergeTakeoffDocs, takeoffDocRow, TAKEOFF_CONFLICT_NOTICE_SERVER, TAKEOFF_CONFLICT_NOTICE_LOCAL, AI_DISMISSED_CAP,
    takeoffPushGate, takeoffQueueSignal, takeoffLandedAction, isTakeoffWriteFor, takeoffHeldEditedAt,
  } = await import('../utils/takeoff/takeoffDocMerge');
  const { parseTakeoffDoc } = await import('../utils/takeoff/conditions');
  const {
    TAKEOFF_SAVE_LINES, SEAT_UNKNOWN_LINE, TAKEOFF_SYNC_META_PREFIX, TAKEOFF_CONFLICT_PREFIX, takeoffSyncMetaKey, takeoffConflictKey,
    parseTakeoffSyncMeta,
  } = await import('../utils/takeoffCloudSync');
  const { isAppStorageKey } = await import('../utils/localCacheKeys');

  // ── 1. syncSeat ──────────────────────────────────────────────────────────
  console.log('\n1. seat + stamps (utils/syncSeat)');
  const roles = ['owner', 'editor', 'field', 'viewer'] as const;
  const want: Record<string, [boolean, boolean]> = {
    owner: [true, true], editor: [true, true], field: [true, false], viewer: [false, false],
  };
  for (const r of roles) {
    eq(`${r}: code checks (field tier) ${want[r][0]}, takeoff (editor tier) ${want[r][1]}`,
      [seatCanWrite(r, 'field'), seatCanWrite(r, 'editor')], want[r]);
  }
  eq('unknown role → null at both tiers', [seatCanWrite(null, 'field'), seatCanWrite(null, 'editor')], [null, null]);
  ok("stampMs('…18:00:00.12+00:00') === stampMs('…18:00:00.120Z')",
    stampMs('2026-09-26T18:00:00.12+00:00') === stampMs('2026-09-26T18:00:00.120Z') && stampMs('2026-09-26T18:00:00.120Z') !== null);
  eq('stampMs: missing / junk → null', [stampMs(null), stampMs(undefined), stampMs(''), stampMs('not a date')], [null, null, null, null]);
  const server = Date.parse('2026-09-26T18:00:00.000Z');
  const behind = nextPushStamp(server - 60_000, server);
  ok('nextPushStamp: a clock BEHIND the server still stamps past it', Date.parse(behind) > server, behind);
  eq('nextPushStamp: a clock ahead stamps now', nextPushStamp(server + 5_000, server), new Date(server + 5_000).toISOString());
  eq('nextPushStamp: no server stamp yet → now', nextPushStamp(server, null), new Date(server).toISOString());

  // ── 2. code checks ───────────────────────────────────────────────────────
  console.log('\n2. code-check merge (utils/codeThread/syncMerge)');
  const P = '22222222-2222-4222-8222-222222222222';
  const act = (kind: 'permit' | 'punch' | 'rfi', index: number) =>
    ({ kind, section: 'violations' as const, index, createdId: null, at: '2026-09-26T10:00:00Z' });
  const result = { summary: 's', applicableCodes: [], permitsRequired: [], inspections: [], commonViolations: ['a', 'b', 'c'] };
  const rec = (id: string, updatedAt: string, over: Partial<CodeCheckRecord> = {}): CodeCheckRecord => ({
    id, projectId: P, createdAt: '2026-09-26T09:00:00.000Z', updatedAt,
    source: { kind: 'project' }, category: 'c', categoryLabel: 'C', scenario: 'x', address: '',
    answers: [], followUps: [],
    grounding: { authority: null, codes: '', checkedOn: null, grounded: false, chipLabel: '', buildingRecordKind: 'none', buildingRecordHeadline: null, departmentName: null, jobDataSent: [] },
    result, disclaimer: '', recallNote: '', actions: [], ...over,
  });

  let m = mergeCodeCheckLists([rec('L', '2026-09-26T12:00:00.000Z')], [rec('S', '2026-09-26T11:00:00.000Z')]);
  ok('local-only is kept AND pushed', m.merged.some((r) => r.id === 'L') && m.push.some((r) => r.id === 'L'));
  ok('server-only is kept, not pushed', m.merged.some((r) => r.id === 'S') && !m.push.some((r) => r.id === 'S'));

  m = mergeCodeCheckLists([rec('A', '2026-09-26T12:00:00.000Z', { scenario: 'local' })], [rec('A', '2026-09-26T11:00:00.000Z', { scenario: 'server' })]);
  ok('local newer wins and is pushed', m.merged[0].scenario === 'local' && m.push.length === 1);
  m = mergeCodeCheckLists([rec('A', '2026-09-26T11:00:00.000Z', { scenario: 'local' })], [rec('A', '2026-09-26T12:00:00.000Z', { scenario: 'server' })]);
  ok('server newer wins, nothing to push', m.merged[0].scenario === 'server' && m.push.length === 0);
  m = mergeCodeCheckLists([rec('A', '2026-09-26T12:00:00.000Z', { scenario: 'local' })], [rec('A', '2026-09-26T12:00:00.000Z', { scenario: 'server' })]);
  ok('a tie goes to the server', m.merged[0].scenario === 'server' && m.push.length === 0);

  m = mergeCodeCheckLists(
    [rec('A', '2026-09-26T11:00:00.000Z', { actions: [act('punch', 1)] })],
    [rec('A', '2026-09-26T12:00:00.000Z', { actions: [act('rfi', 0)] })],
  );
  ok('the server wins but the local "Added" mark survives (action union), and the union is pushed',
    m.merged[0].actions.length === 2 && m.merged[0].actions.some((a) => a.kind === 'punch') && m.push.length === 1);
  m = mergeCodeCheckLists(
    [rec('A', '2026-09-26T12:00:00.000Z', { actions: [act('punch', 1)] })],
    [rec('A', '2026-09-26T11:00:00.000Z', { actions: [act('rfi', 0)] })],
  );
  ok('the local copy wins and the server-side mark survives', m.merged[0].actions.length === 2 && m.push.length === 1);
  m = mergeCodeCheckLists(
    [rec('A', '2026-09-26T12:00:00.000Z', { actions: [act('rfi', 0)] })],
    [rec('A', '2026-09-26T12:00:00+00:00', { actions: [act('rfi', 0)] })],
  );
  ok('same stamp, same actions → nothing pushed', m.push.length === 0);

  m = mergeCodeCheckLists(
    [rec('A', '2026-09-26T18:00:00.120Z', { scenario: 'local' })],
    [rec('A', '2026-09-26T18:00:00.12+00:00', { scenario: 'server' })],
  );
  ok("a '+00:00' server stamp equal in ms is EQUAL, not newer (tie → server, nothing pushed)",
    m.merged[0].scenario === 'server' && m.push.length === 0);

  const many = Array.from({ length: 60 }, (_, i) => rec(`r${i}`, new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60_000).toISOString()));
  m = mergeCodeCheckLists(many, []);
  ok(`the cap (${MAX_CHECKS_PER_PROJECT}) keeps the newest`,
    m.merged.length === MAX_CHECKS_PER_PROJECT && m.merged[0].id === 'r59' && !m.merged.some((r) => r.id === 'r0')
    && m.push.length === MAX_CHECKS_PER_PROJECT && !m.push.some((r) => r.id === 'r0'));

  m = mergeCodeCheckLists(
    [rec('older', '2026-09-26T20:00:00.000Z', { createdAt: '2026-09-20T09:00:00.000Z' })],
    [rec('newer', '2026-09-26T10:00:00.000Z', { createdAt: '2026-09-25T09:00:00.000Z' })],
  );
  ok('the list is newest first by createdAt (the date the card shows): a fresh "Added" on an old check does not lift it above a newer one',
    m.merged[0].id === 'newer' && m.merged[1].id === 'older');

  const good = { id: 'A', project_id: P, updated_at: '2026-09-26T18:00:00.12+00:00', record: rec('A', '2026-09-26T18:00:00.120Z') };
  const parsed = recordFromRow(good);
  ok('recordFromRow reads a good row with its server stamp', !!parsed && parsed.rec.id === 'A' && parsed.serverMs === Date.parse('2026-09-26T18:00:00.120Z'));
  ok('recordFromRow rejects an id mismatch', recordFromRow({ ...good, id: 'B' }) === null);
  ok('recordFromRow rejects a project mismatch', recordFromRow({ ...good, project_id: '33333333-3333-4333-8333-333333333333' }) === null);
  ok('recordFromRow rejects a non-object record', recordFromRow({ ...good, record: [1] }) === null && recordFromRow(null) === null);

  // ── 3. takeoff ───────────────────────────────────────────────────────────
  console.log('\n3. takeoff merge (utils/takeoff/takeoffDocMerge)');
  const cond = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
    id, name: id, kind: 'area' as const, trade: null, rateOverride: null, wastePct: 0 as const, heightFt: null,
    color: '#123456', createdAt, ...extra,
  });
  const meas = (id: string, conditionId: string, createdAt: string) => ({
    id, conditionId, sheetId: 's1', kind: 'area' as const, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], createdAt, aspect: 1.5,
  });
  const doc = (conditions: unknown[], measurements: unknown[] = [], extra: Record<string, unknown> = {}): TakeoffDoc =>
    ({ version: 1, conditions, measurements, pushed: {}, ...extra }) as unknown as TakeoffDoc;
  const EMPTY = doc([]);
  const clean = { localEditedAt: null, pendingStamp: null, lastSyncedAt: null, lastSyncedLocalAt: null };
  const T = (s: string) => `2026-09-26T${s}Z`;

  let r = mergeTakeoffDocs({ local: doc([cond('c1', T('10:00:00.000'))]), meta: clean, server: null });
  ok('rule 1: no server doc → local kept and pushed', r.rule === 1 && r.push && r.doc.conditions.length === 1 && !r.keptServer);
  r = mergeTakeoffDocs({ local: EMPTY, meta: clean, server: null });
  ok('rule 1: an empty local with no server doc pushes nothing', r.rule === 1 && !r.push);

  const serverDoc = doc([cond('s1', T('09:00:00.000'))]);
  r = mergeTakeoffDocs({ local: doc([cond('c1', T('10:00:00.000'))]), meta: clean, server: { doc: serverDoc, updatedAt: T('11:00:00.000') } });
  ok('rule 2: local clean → the server doc, no push', r.rule === 2 && !r.push && r.keptServer && r.doc.conditions[0].id === 's1' && r.syncedAt === T('11:00:00.000'));

  r = mergeTakeoffDocs({
    local: doc([cond('c1', T('10:00:00.000'))]),
    meta: { ...clean, localEditedAt: T('17:59:59.000'), pendingStamp: '2026-09-26T18:00:00.120Z', lastSyncedAt: T('12:00:00.000') },
    server: { doc: serverDoc, updatedAt: '2026-09-26T18:00:00.12+00:00' },
  });
  ok("rule 3 with a PostgREST stamp: pending '…:00.120Z' vs server '…:00.12+00:00' → our write landed: clean, no notice, no backup",
    r.rule === 3 && !r.push && r.keptServer && r.notice === null && !r.backupLocal);
  r = mergeTakeoffDocs({
    local: doc([cond('c1', T('10:00:00.000'))]),
    meta: { ...clean, localEditedAt: T('18:00:05.000'), pendingStamp: '2026-09-26T18:00:00.120Z', lastSyncedAt: T('12:00:00.000') },
    server: { doc: serverDoc, updatedAt: '2026-09-26T18:00:00.12+00:00' },
  });
  ok('rule 3: an edit AFTER our landed push is not thrown away (local wins, pushed)', r.rule === 3 && r.push && r.doc.conditions[0].id === 'c1' && !r.keptServer);

  r = mergeTakeoffDocs({
    local: doc([cond('c1', T('10:00:00.000'))]),
    meta: { ...clean, localEditedAt: T('19:00:00.000'), lastSyncedAt: '2026-09-26T18:00:00.120Z', lastSyncedLocalAt: T('18:00:01.000') },
    server: { doc: serverDoc, updatedAt: '2026-09-26T18:00:00.12+00:00' },
  });
  ok("rule 4 with a PostgREST stamp: the server is unchanged since we synced → local wins, pushed",
    r.rule === 4 && r.push && r.doc.conditions[0].id === 'c1' && !r.keptServer && r.notice === null);

  r = mergeTakeoffDocs({
    local: doc([cond('c1', T('10:00:00.000'))]),
    meta: { ...clean, localEditedAt: T('19:00:00.000'), lastSyncedAt: '2026-09-26T18:00:00Z', lastSyncedLocalAt: T('18:00:01.000') },
    server: { doc: serverDoc, updatedAt: '2026-09-26T18:00:00.5+00:00' },
  });
  ok('rule 4 is decided in epoch ms, not by string order: a server 500 ms past lastSyncedAt is a CHANGE (rule 5)',
    r.rule === 5);

  // Rule 5 — server newer (base = server).
  const since = T('12:00:00.000');
  const localDoc = doc(
    [cond('old', T('11:00:00.000')), cond('new', T('13:00:00.000'))],
    [meas('m-old', 'old', T('11:00:00.000')), meas('m-new', 'new', T('13:00:00.000'))],
    { pushed: { new: 'mat-new' } },
  );
  const srvDoc = doc([cond('srv', T('14:00:00.000'))], [meas('m-srv', 'srv', T('14:00:00.000'))],
    { pushed: { srv: 'mat-srv' }, lastPush: { at: T('14:00:00.000'), projectId: P, before: 1, after: 2, added: 1, updated: 0 } });
  r = mergeTakeoffDocs({
    local: localDoc,
    meta: { ...clean, localEditedAt: T('13:30:00.000'), lastSyncedAt: T('12:00:00.000'), lastSyncedLocalAt: since },
    server: { doc: srvDoc, updatedAt: T('15:00:00.000') },
  });
  const ids = r.doc.conditions.map((c) => c.id).sort();
  const mids = r.doc.measurements.map((x) => x.id).sort();
  ok('rule 5 (server newer): the server is the base, backed up, notice says the newer copy was kept',
    r.rule === 5 && r.push && r.keptServer && r.backupLocal && r.notice === TAKEOFF_CONFLICT_NOTICE_SERVER);
  eq('rule 5: a local item created after the last sync is carried over; one from before (deleted there) is not resurrected',
    ids, ['new', 'srv']);
  eq('rule 5: measurements follow the same rule, and only onto conditions in the result', mids, ['m-new', 'm-srv']);
  eq('rule 5: pushed = the base map plus the loser keys it lacks', r.doc.pushed, { new: 'mat-new', srv: 'mat-srv' });
  ok('rule 5: lastPush is the later one', r.doc.lastPush?.at === T('14:00:00.000'));

  // Rule 5 — local newer (base = local).
  r = mergeTakeoffDocs({
    local: localDoc,
    meta: { ...clean, localEditedAt: T('16:00:00.000'), lastSyncedAt: T('12:00:00.000'), lastSyncedLocalAt: since },
    server: { doc: doc([cond('srv', T('14:00:00.000')), cond('gone', T('11:30:00.000'))]), updatedAt: T('15:00:00.000') },
  });
  ok('rule 5 (local newer): local is the base, NO backup, the local notice',
    r.rule === 5 && r.push && !r.keptServer && !r.backupLocal && r.notice === TAKEOFF_CONFLICT_NOTICE_LOCAL);
  eq('rule 5 (local newer): what was added there is carried over, what is older is not',
    r.doc.conditions.map((c) => c.id).sort(), ['new', 'old', 'srv']);

  r = mergeTakeoffDocs({
    local: localDoc,
    meta: { ...clean, localEditedAt: T('15:00:00.000'), lastSyncedAt: T('12:00:00.000'), lastSyncedLocalAt: since },
    server: { doc: srvDoc, updatedAt: T('15:00:00.000') },
  });
  ok('rule 5: a tie in stamps goes to the server (backup kept)', r.rule === 5 && r.keptServer && r.backupLocal);

  r = mergeTakeoffDocs({
    local: localDoc,
    meta: { ...clean, localEditedAt: T('13:30:00.000') },
    server: { doc: srvDoc, updatedAt: T('15:00:00.000') },
  });
  ok('rule 5 with no sync history: everything local is carried (nothing is known to be deleted)',
    r.rule === 5 && ['new', 'old', 'srv'].every((id) => r.doc.conditions.some((c) => c.id === id)));

  // aiDismissed + extra fields (lane TK-b). They survive only if parseTakeoffDoc keeps them.
  const keepsDismissed = Array.isArray((parseTakeoffDoc(JSON.stringify({ ...EMPTY, aiDismissed: ['x'] })) as unknown as Record<string, unknown>).aiDismissed);
  if (keepsDismissed) {
    const a = Array.from({ length: 400 }, (_, i) => `a${i}`);
    const b = [...Array.from({ length: 200 }, (_, i) => `b${i}`), 'a1'];
    r = mergeTakeoffDocs({
      local: doc([], [], { aiDismissed: b }),
      meta: { ...clean, localEditedAt: T('13:30:00.000'), lastSyncedAt: T('12:00:00.000'), lastSyncedLocalAt: since },
      server: { doc: doc([], [], { aiDismissed: a }), updatedAt: T('15:00:00.000') },
    });
    const got = (r.doc as unknown as { aiDismissed?: string[] }).aiDismissed ?? [];
    ok(`aiDismissed: the deduped union, capped at ${AI_DISMISSED_CAP}`, got.length === AI_DISMISSED_CAP && new Set(got).size === got.length && got.includes('b0'));
  } else {
    console.log('  – SKIPPED aiDismissed union: parseTakeoffDoc does not keep aiDismissed yet (lane TK-b not merged)');
  }
  const aiRead = (note: string) => ({ qty: 10, unit: 'SF', confidence: 'high', citation: note, key: `k-${note}`, readAt: T('10:00:00.000') });
  const keepsAiRead = (() => {
    const p = parseTakeoffDoc(JSON.stringify(doc([cond('c', T('10:00:00.000'), { aiRead: aiRead('n') })])));
    return !!(p.conditions[0] as unknown as Record<string, unknown> | undefined)?.aiRead;
  })();
  if (keepsAiRead) {
    r = mergeTakeoffDocs({
      local: doc([cond('loc', T('13:00:00.000'), { aiRead: aiRead('mine') })]),
      meta: { ...clean, localEditedAt: T('13:30:00.000'), lastSyncedAt: T('12:00:00.000'), lastSyncedLocalAt: since },
      server: { doc: doc([cond('srv', T('14:00:00.000'), { aiRead: aiRead('theirs') })]), updatedAt: T('15:00:00.000') },
    });
    const byId = new Map(r.doc.conditions.map((c) => [c.id, c as unknown as Record<string, unknown>]));
    ok('extra condition fields (aiRead) survive on both the base and the carried condition',
      !!byId.get('srv')?.aiRead && !!byId.get('loc')?.aiRead);
  } else {
    console.log('  – SKIPPED extra condition fields (aiRead): parseTakeoffDoc does not keep them yet (lane TK-b not merged)');
  }
  const keepsTop = 'extraTop' in (parseTakeoffDoc(JSON.stringify({ ...EMPTY, extraTop: 1 })) as unknown as Record<string, unknown>);
  if (keepsTop) {
    r = mergeTakeoffDocs({
      local: doc([], [], { extraTop: 'local' }),
      meta: { ...clean, localEditedAt: T('13:30:00.000'), lastSyncedAt: T('12:00:00.000'), lastSyncedLocalAt: since },
      server: { doc: doc([], [], { extraTop: 'server' }), updatedAt: T('15:00:00.000') },
    });
    ok('unknown top-level fields come from the base', (r.doc as unknown as Record<string, unknown>).extraTop === 'server');
  } else {
    console.log('  – SKIPPED unknown top-level fields: parseTakeoffDoc drops them (the merge carries the base object whole)');
  }

  for (const junk of ['not a doc', 42, [1, 2], { conditions: 'x', measurements: { a: 1 } }, null]) {
    const rr = mergeTakeoffDocs({ local: EMPTY, meta: clean, server: { doc: junk, updatedAt: T('15:00:00.000') } });
    ok(`a malformed server doc (${JSON.stringify(junk)}) is empty-safe`,
      rr.doc.version === 1 && Array.isArray(rr.doc.conditions) && rr.doc.conditions.length === 0 && Array.isArray(rr.doc.measurements));
  }
  const rr = mergeTakeoffDocs({
    local: doc([cond('c1', T('13:00:00.000'))]),
    meta: { ...clean, localEditedAt: T('13:30:00.000'), lastSyncedAt: T('12:00:00.000'), lastSyncedLocalAt: since },
    server: { doc: { conditions: [{ id: 5 }], measurements: 'x' }, updatedAt: T('15:00:00.000') },
  });
  ok('a malformed server doc in a conflict keeps the local items', rr.doc.conditions.some((c) => c.id === 'c1'));

  // ── 4. mappers ───────────────────────────────────────────────────────────
  console.log('\n4. row mappers');
  const stamp = '2026-09-26T18:00:00.121Z';
  const row = codeCheckRow(rec('A', '2026-09-26T17:00:00.000Z'), 'user-1', stamp);
  ok("the code-check row stamps user_id, and updated_at === record.updatedAt === the pushed stamp",
    row.user_id === 'user-1' && row.updated_at === stamp && row.record.updatedAt === stamp && row.id === 'A' && row.project_id === P);
  ok('created_at is the record createdAt', row.created_at === '2026-09-26T09:00:00.000Z');
  ok('created_at falls back to the stamp when the record has none', codeCheckRow(rec('A', stamp, { createdAt: '' }), 'u', stamp).created_at === stamp);
  const tRow = takeoffDocRow(P, 'user-1', EMPTY, stamp);
  ok('the takeoff row: id === project_id === the job, user_id stamped, updated_at = the stamp',
    tRow.id === P && tRow.project_id === P && tRow.user_id === 'user-1' && tRow.updated_at === stamp);

  // ── 5. copy honesty ──────────────────────────────────────────────────────
  console.log('\n5. copy honesty');
  const STATES = ['local', 'seat', 'syncing', 'synced', 'offline', 'failed', 'refused'] as const;
  for (const [name, map] of [['CODE_CHECKS_CAPTION', CODE_CHECKS_CAPTION], ['TAKEOFF_SAVE_LINES', TAKEOFF_SAVE_LINES]] as const) {
    ok(`${name}: every state has a line`, STATES.every((s) => typeof map[s] === 'string' && map[s].length > 0));
    const claims = STATES.filter((s) => /saved to your account/i.test(map[s]));
    eq(`${name}: 'Saved to your account' appears ONLY in the synced state`, claims, ['synced']);
    ok(`${name}: local / seat / failed / refused never claim the account`,
      (['local', 'seat', 'failed', 'refused'] as const).every((s) => !/saved to your account/i.test(map[s])));
    ok(`${name}: the refused line says 'only'`, /\bonly\b/.test(map.refused));
    ok(`${name}: the seat line names the seat`, /\bseat\b/i.test(map.seat));
  }
  ok("the device-only code-check line is still 'Saved on this device until you sign out.'",
    CODE_CHECKS_CAPTION.local === 'Saved on this device until you sign out.');
  // #90: an unknown seat says WHY — 'syncing' only while the role read is in flight.
  const N = false, Y = true;
  eq('seatReadStatus: loading / failed (wins over loading) / offline / settled none',
    [seatReadStatus({ isLoading: Y, isError: N, isPaused: N }), seatReadStatus({ isLoading: Y, isError: Y, isPaused: N }),
      seatReadStatus({ isLoading: N, isError: Y, isPaused: Y }), seatReadStatus({ isLoading: N, isError: N, isPaused: Y }),
      seatReadStatus({ isLoading: Y, isError: N, isPaused: Y }), seatReadStatus({ isLoading: N, isError: N, isPaused: N })],
    ['loading', 'failed', 'failed', 'offline', 'loading', 'none']);
  eq('SEAT_UNKNOWN_LINE (takeoff): loading→syncing, failed→failed, offline→offline, none→seat',
    SEAT_UNKNOWN_LINE, { loading: 'syncing', failed: 'failed', offline: 'offline', none: 'seat' });
  eq('unknownSeatState (code checks): loading→syncing, failed→failed, offline→offline, none→seat, unset→syncing',
    [unknownSeatState('loading'), unknownSeatState('failed'), unknownSeatState('offline'), unknownSeatState('none'), unknownSeatState(undefined)],
    ['syncing', 'failed', 'offline', 'seat', 'syncing']);
  const ccSrc = read('utils', 'codeThread', 'cloudSync.ts');
  ok("the code-check quick verdict and the 'seat_unknown' verdict both read unknownSeatState",
    /seat\.role === null\) return unknownSeatState\(seat\.readStatus\)/.test(ccSrc)
    && /v === 'seat_unknown' \? unknownSeatState\(seats\.get\(projectId\)\?\.readStatus\)/.test(ccSrc));
  const ccHook = read('hooks', 'useCodeChecks.ts');
  ok('useCodeChecks passes the role read status (seatReadStatus) to setCodeCheckSeat',
    /seatReadStatus\(\{ isLoading: roleState\.isLoading, isError: roleState\.isError, isPaused: roleState\.isPaused \}\)/.test(ccHook)
    && /setCodeCheckSeat\(projectId, role, \{ sample, readStatus \}\)/.test(ccHook));
  const tkHook = read('hooks', 'useTakeoffConditions.ts');
  ok("the takeoff line maps a 'seat_unknown' verdict through SEAT_UNKNOWN_LINE[seatReadStatus(roleState…)]",
    /SEAT_UNKNOWN_LINE\[seatReadStatus\(\{\s*isLoading: roleState\.isLoading, isError: roleState\.isError, isPaused: roleState\.isPaused,/.test(tkHook)
    && /verdict === 'seat_unknown' && role === null \? unknownSeat/.test(tkHook));

  const card = read('components', 'codeThread', 'ProjectCodeChecksCard.tsx');
  ok('the card re-exports CODE_CHECKS_CAPTION and keeps CODE_CHECKS_LOCAL_CAPTION = the local line',
    /export \{ CODE_CHECKS_CAPTION \};/.test(card) && /export const CODE_CHECKS_LOCAL_CAPTION = CODE_CHECKS_CAPTION\.local;/.test(card)
    && card.includes('testID="codethread-sync-caption"') && card.includes('{CODE_CHECKS_CAPTION[syncState]}'));
  const sheet = read('components', 'codeThread', 'SavedCodeCheckSheet.tsx');
  ok("the saved-check sheet's fine print reads the same map for the job",
    sheet.includes('{CODE_CHECKS_CAPTION[syncState]}') && sheet.includes('useCodeCheckSyncState(recordProp.projectId)'));

  // ── 6. static ────────────────────────────────────────────────────────────
  console.log('\n6. static');
  const mig = read('supabase', 'migrations', '20260926180000_code_checks_takeoff_docs.sql');
  const migCode = mig.replace(/--.*$/gm, '');
  ok('the migration exists', mig.length > 0);
  for (const t of ['code_checks', 'takeoff_docs']) {
    ok(`${t}: RLS enabled`, new RegExp(`alter table public\\.${t} enable row level security;`).test(migCode));
    const tier = t === 'code_checks' ? 'field' : 'editor';
    for (const op of ['select', 'insert', 'update', 'delete']) {
      ok(`${t}: ${t}_collab_${op} policy`, new RegExp(`create policy ${t}_collab_${op} on public\\.${t}\\s+for ${op} to authenticated`).test(migCode));
    }
    const ins = migCode.match(new RegExp(`create policy ${t}_collab_insert[\\s\\S]*?;`))?.[0] ?? '';
    const upd = migCode.match(new RegExp(`create policy ${t}_collab_update[\\s\\S]*?;`))?.[0] ?? '';
    ok(`${t}: insert at the '${tier}' tier and author = auth.uid()`,
      ins.includes(`public.can_access_project(project_id, '${tier}')`) && ins.includes('auth.uid() = user_id'));
    ok(`${t}: update using + with check at the '${tier}' tier`,
      (upd.match(new RegExp(`public\\.can_access_project\\(project_id, '${tier}'\\)`, 'g')) ?? []).length === 2);
    ok(`${t}: aa_collab_freeze_ownership attached BEFORE UPDATE`,
      new RegExp(`create trigger aa_collab_freeze_ownership\\s+before update on public\\.${t}\\s+for each row execute function public\\.collab_freeze_ownership\\(\\)`).test(migCode));
    ok(`${t}: ab_sync_keep_newest attached BEFORE UPDATE`,
      new RegExp(`create trigger ab_sync_keep_newest\\s+before update on public\\.${t}\\s+for each row execute function public\\.sync_keep_newest\\(\\)`).test(migCode));
  }
  ok('both FKs cascade (project and author)',
    (migCode.match(/references public\.projects\(id\) on delete cascade/g) ?? []).length === 2
    && (migCode.match(/references auth\.users\(id\) on delete cascade/g) ?? []).length === 2);
  ok('anon revoked, authenticated granted',
    /revoke all on public\.code_checks, public\.takeoff_docs from anon, public;/.test(migCode)
    && /grant select, insert, update, delete on public\.code_checks, public\.takeoff_docs to authenticated;/.test(migCode));
  ok('no security definer in the migration', !/security definer/i.test(migCode));
  ok('keep-newest ignores an older write silently and pins created_at',
    /if new\.updated_at < old\.updated_at then\s+return null;\s+end if;\s+new\.created_at := old\.created_at;/.test(migCode));

  const walk = (dir: string, out: string[] = []): string[] => {
    let names: string[] = [];
    try { names = readdirSync(join(ROOT, dir)); } catch { return out; }
    for (const n of names) {
      if (n === 'node_modules' || n.startsWith('.')) continue;
      const rel = join(dir, n);
      let st;
      try { st = statSync(join(ROOT, rel)); } catch { continue; }
      if (st.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(rel);
    }
    return out;
  };
  const direct: string[] = [];
  for (const f of ['app', 'components', 'hooks', 'utils', 'contexts', 'lib'].flatMap((d) => walk(d))) {
    const src = read(f);
    if (/\.from\(\s*['"`](code_checks|takeoff_docs)['"`]\s*\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\(/.test(src)) direct.push(f);
  }
  eq('no app file writes code_checks / takeoff_docs outside utils/offlineQueue', direct, []);

  const hook = read('hooks', 'useTakeoffConditions.ts');
  ok('the takeoff hook keeps exactly its two guarded storage calls (validate-takeoff-conditions §5)',
    (hook.match(/AsyncStorage\.(getItem|setItem)/g) ?? []).length === 2
    && /try \{\s*void AsyncStorage\.setItem/.test(hook) && /try \{\s*AsyncStorage\.getItem/.test(hook));
  ok('the takeoff hook reads the seat (useProjectRoleState) and gates on seatCanWrite',
    hook.includes('useProjectRoleState(') && hook.includes('seatCanWrite') && hook.includes('canSyncTakeoff('));
  ok('the takeoff hook stamps pendingStamp before the write and verifies with fetchServerStamp',
    /pendingStamp: stamp[\s\S]*?pushTakeoffDoc\([\s\S]*?fetchServerStamp\(/.test(hook));
  ok("the takeoff hook's saveLine reads TAKEOFF_SAVE_LINES", /saveLine: TAKEOFF_SAVE_LINES\[/.test(hook));
  const cloudSync = read('utils', 'takeoffCloudSync.ts');
  ok("canSyncTakeoff gates on the 'editor' tier", /seatCanWrite\(role, 'editor'\)/.test(cloudSync));
  const ccSync = read('utils', 'codeThread', 'cloudSync.ts');
  ok("the code-check sync gates on the 'field' tier", /seatCanWrite\(seat\.role, 'field'\)/.test(ccSync));
  ok('both syncs write through supabaseWriteDetailed',
    /supabaseWriteDetailed\('takeoff_docs', 'upsert'/.test(cloudSync) && /supabaseWriteDetailed\('code_checks', 'upsert'/.test(ccSync));

  const keys = [CODE_CHECKS_KEY, takeoffSyncMetaKey(P), takeoffConflictKey(P), TAKEOFF_SYNC_META_PREFIX, TAKEOFF_CONFLICT_PREFIX];
  ok('every new key is swept on a tenant switch (isAppStorageKey)', keys.every((k) => k.startsWith('mageid_') && isAppStorageKey(k)), keys.join(', '));
  eq('sync meta parses defensively', [parseTakeoffSyncMeta('junk'), parseTakeoffSyncMeta(null), parseTakeoffSyncMeta('{"pendingStamp":5,"lastSyncedAt":"x"}')],
    [null, null, { localEditedAt: null, pendingStamp: null, lastSyncedAt: 'x', lastSyncedLocalAt: null }]);

  const del = read('supabase', 'functions', 'delete-account', 'index.ts');
  const list = del.match(/COLLABORATOR_FIELD_TABLES\s*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
  ok("delete-account hands code_checks and takeoff_docs to the job's owner", list.includes("'code_checks'") && list.includes("'takeoff_docs'"));
  const ledger = read('utils', 'syncLedger.ts');
  ok('the "Not saved" sheet names both tables', ledger.includes("code_checks: 'Saved code check'") && ledger.includes("takeoff_docs: 'Desktop takeoff'"));


  // ── 7. list-3 follow-ups (lane R3F) ──────────────────────────────────────
  console.log('\n7a. code checks: a seat that recovers re-syncs once (codeCheckResyncOwed)');
  type Seat = Parameters<typeof codeCheckResyncOwed>[1];
  const seat = (role: Seat['role'], readStatus: Seat['readStatus'] = 'none', sample = false): Seat => ({ role, readStatus, sample });
  eq('first registration owes nothing (useCodeChecks runs the first sync)', codeCheckResyncOwed(undefined, seat('editor'), true), false);
  eq('no sync has run for the job yet → nothing owed', codeCheckResyncOwed(seat(null, 'failed'), seat('editor'), false), false);
  eq('THE BUG: null (failed read) → editor, after a sync → owed', codeCheckResyncOwed(seat(null, 'failed'), seat('editor'), true), true);
  eq('null (offline read) → owner → owed', codeCheckResyncOwed(seat(null, 'offline'), seat('owner'), true), true);
  eq('null (loading) → field (field writes code checks) → owed', codeCheckResyncOwed(seat(null, 'loading'), seat('field'), true), true);
  eq('viewer → editor (read-only to writable) → owed', codeCheckResyncOwed(seat('viewer'), seat('editor'), true), true);
  eq('editor → editor (a readStatus flicker) → nothing', codeCheckResyncOwed(seat('editor', 'none'), seat('editor', 'loading'), true), false);
  eq('editor → owner (writable stays writable) → nothing', codeCheckResyncOwed(seat('editor'), seat('owner'), true), false);
  eq('null failed → null loading → nothing', codeCheckResyncOwed(seat(null, 'failed'), seat(null, 'loading'), true), false);
  eq('null → viewer (still read-only) → nothing', codeCheckResyncOwed(seat(null, 'failed'), seat('viewer'), true), false);
  eq('a sample job never re-syncs', codeCheckResyncOwed(seat(null, 'failed', true), seat('editor', 'none', true), true), false);
  {
    // A flapping seat: one re-sync per transition into writable, none on repeats.
    const flap = [seat('editor'), seat('editor'), seat(null, 'failed'), seat(null, 'failed'), seat('editor'), seat('editor'),
      seat(null, 'offline'), seat('editor'), seat('editor', 'loading')];
    const owed: number[] = [];
    for (let i = 1; i < flap.length; i++) if (codeCheckResyncOwed(flap[i - 1], flap[i], true)) owed.push(i);
    eq('a flapping seat owes exactly one re-sync per recovery (steps 4 and 7), none on repeats', owed, [4, 7]);
  }
  {
    const cc = read('utils', 'codeThread', 'cloudSync.ts');
    const setSeat = cc.match(/export function setCodeCheckSeat[\s\S]*?\n\}/)?.[0] ?? '';
    ok('setCodeCheckSeat re-syncs through codeCheckResyncOwed(prev, next, syncAttempted.has(projectId)) and shows syncing first',
      /codeCheckResyncOwed\(prev, next, syncAttempted\.has\(projectId\)\)/.test(setSeat)
      && /setState\(projectId, 'syncing'\);\s*void syncCodeChecksForProject\(projectId\)/.test(setSeat));
    ok('the re-sync keeps a refused caption (never overwritten by syncing)', /if \(states\.get\(projectId\) !== 'refused'\) setState\(projectId, 'syncing'\)/.test(setSeat));
    const syncFn = cc.match(/export function syncCodeChecksForProject[\s\S]*?\n\}/)?.[0] ?? '';
    ok('syncCodeChecksForProject marks the job attempted and never starts a second sync while one is in flight',
      /syncAttempted\.add\(projectId\);\s*const running = inFlight\.get\(projectId\);\s*if \(running\) return running;/.test(syncFn));
  }

  console.log('\n7b. takeoff: one queued write per job (the offline hold)');
  const Q = { stamp: '2026-09-26T18:00:00.120Z', sentAt: T('18:00:00.000'), seq: 3, held: false };
  eq('takeoffPushGate: nothing queued → push (whatever the queue says)', [takeoffPushGate(null, true), takeoffPushGate(null, false), takeoffPushGate(null, null)], ['push', 'push', 'push']);
  eq('takeoffPushGate: queued and still in the queue → hold', takeoffPushGate(Q, true), 'hold');
  eq('takeoffPushGate: queued but it has left → settle', takeoffPushGate(Q, false), 'settle');
  eq('takeoffPushGate: the queue could not be read → push (never stall a save)', takeoffPushGate(Q, null), 'push');
  eq('takeoffQueueSignal: settle only when a queued write has left',
    [takeoffQueueSignal(null, false), takeoffQueueSignal(Q, true), takeoffQueueSignal(Q, null), takeoffQueueSignal(Q, false)],
    ['wait', 'wait', 'wait', 'settle']);
  eq("takeoffLandedAction: the account holds our write (PostgREST '+00:00' form), nothing owed → synced",
    takeoffLandedAction(Q.stamp, '2026-09-26T18:00:00.12+00:00', false), 'synced');
  eq('takeoffLandedAction: it holds our write and a push was held → push the latest',
    takeoffLandedAction(Q.stamp, '2026-09-26T18:00:00.12+00:00', true), 'push');
  eq('takeoffLandedAction: another device wrote after / the write was dropped / the read failed → merge',
    [takeoffLandedAction(Q.stamp, T('18:00:05.000'), true), takeoffLandedAction(Q.stamp, null, true),
      takeoffLandedAction(Q.stamp, T('17:00:00.000'), false), takeoffLandedAction(Q.stamp, 'offline', true), takeoffLandedAction(Q.stamp, 'error', false)],
    ['merge', 'merge', 'merge', 'merge', 'merge']);
  eq('isTakeoffWriteFor: this job’s takeoff_docs write only',
    [isTakeoffWriteFor({ table: 'takeoff_docs', data: { id: P, project_id: P } }, P), isTakeoffWriteFor({ table: 'takeoff_docs', data: { project_id: P } }, P),
      isTakeoffWriteFor({ table: 'takeoff_docs', data: { id: 'other', project_id: 'other' } }, P), isTakeoffWriteFor({ table: 'code_checks', data: { id: P, project_id: P } }, P),
      isTakeoffWriteFor(null, P), isTakeoffWriteFor({ table: 'takeoff_docs', data: null }, P)],
    [true, true, false, false, false, false]);
  const ahead = Date.parse(Q.stamp);
  eq('takeoffHeldEditedAt: a queued stamp AHEAD of this clock → 1 ms past it', takeoffHeldEditedAt(ahead - 30_000, Q.stamp), new Date(ahead + 1).toISOString());
  eq('takeoffHeldEditedAt: a clock ahead of the stamp → now', takeoffHeldEditedAt(ahead + 5_000, Q.stamp), new Date(ahead + 5_000).toISOString());
  eq('takeoffHeldEditedAt: an unreadable stamp → now', takeoffHeldEditedAt(ahead, 'junk'), new Date(ahead).toISOString());
  {
    // A held edit on a clock BEHIND the queued stamp, reloaded before the hold
    // was released: rule 3 must still call it later than our landed write.
    const heldEdit = mergeTakeoffDocs({
      local: doc([cond('held', T('17:59:40.000'))]),
      meta: { ...clean, localEditedAt: takeoffHeldEditedAt(ahead - 20_000, Q.stamp), pendingStamp: Q.stamp, lastSyncedAt: T('12:00:00.000') },
      server: { doc: serverDoc, updatedAt: '2026-09-26T18:00:00.12+00:00' },
    });
    ok('a held edit dated by takeoffHeldEditedAt wins rule 3 even when the clock ran behind the stamp (never dropped)',
      heldEdit.rule === 3 && heldEdit.push && heldEdit.doc.conditions[0]?.id === 'held');
    const naive = mergeTakeoffDocs({
      local: doc([cond('held', T('17:59:40.000'))]),
      meta: { ...clean, localEditedAt: new Date(ahead - 20_000).toISOString(), pendingStamp: Q.stamp, lastSyncedAt: T('12:00:00.000') },
      server: { doc: serverDoc, updatedAt: '2026-09-26T18:00:00.12+00:00' },
    });
    ok('(control) dated by the raw clock, the same edit would lose rule 3 — why the hold re-dates it', naive.rule === 3 && !naive.push);
  }
  {
    // A simulated offline session, driven exactly the way the hook drives it.
    type Entry = { table: string; data: { id: string; project_id: string; v: number; updated_at: string } };
    const queue: Entry[] = [];
    let server: { v: number; updated_at: string } | null = null;
    let online = false;
    let queued: typeof Q | null = null;
    let seq = 0;
    let clock = Date.parse(T('19:00:00.000'));
    const stillQueued = () => queue.some((m) => isTakeoffWriteFor(m, P));
    const pushLatest = (): 'synced' | 'queued' | 'held' => {
      const gate = takeoffPushGate(queued, stillQueued());
      if (gate === 'hold') { queued!.held = true; return 'held'; }
      if (gate === 'settle') queued = null;
      const stamp = new Date(clock += 1000).toISOString();
      const row = { id: P, project_id: P, v: seq, updated_at: stamp };
      if (online && queue.length === 0) { server = { v: seq, updated_at: stamp }; return 'synced'; }
      queue.push({ table: 'takeoff_docs', data: row });
      queued = { stamp, sentAt: stamp, seq, held: false };
      return 'queued';
    };
    const outcomes: string[] = [];
    for (let i = 0; i < 12; i++) { seq++; outcomes.push(pushLatest()); }
    eq('12 debounced pushes while offline: the first is queued, the other 11 are held', [outcomes[0], outcomes.filter((o) => o === 'held').length], ['queued', 11]);
    eq('…so the offline queue holds ONE takeoff copy, not 12', queue.filter((m) => isTakeoffWriteFor(m, P)).length, 1);
    online = true;
    const landed = queue.shift()!;
    server = { v: landed.data.v, updated_at: landed.data.updated_at.replace('Z', '+00:00') };
    const sig = takeoffQueueSignal(queued, stillQueued());
    const q = queued!;
    const act = sig === 'settle' ? takeoffLandedAction(q.stamp, server.updated_at, q.held || seq !== q.seq) : 'none';
    queued = null;
    eq('the flush signal settles the hold: our write landed, a push is owed → push', [sig, act], ['settle', 'push']);
    const last = act === 'push' ? pushLatest() : 'none';
    eq('the owed push goes out once and the LATEST doc is what the account holds', [last, (server as { v: number } | null)?.v, queue.length], ['synced', 12, 0]);
    seq++;
    eq('the next edit after the flush pushes straight away (nothing held)', pushLatest(), 'synced');
  }
  {
    const hk = read('hooks', 'useTakeoffConditions.ts');
    const push = hk.match(/const pushNow = async[\s\S]*?\n {2}\};/)?.[0] ?? '';
    ok('pushNow gates on takeoffPushGate(held, await takeoffWriteQueued(pid)) BEFORE pushTakeoffDoc',
      /takeoffPushGate\(held, await takeoffWriteQueued\(pid\)\)[\s\S]*?pushTakeoffDoc\(/.test(push));
    ok("a hold keeps the edit (marks it, re-dates it), says 'offline' and kicks one queue drain",
      /const noHold = final \|\| !mounted\.current;[\s\S]*?if \(gate === 'hold' && !noHold\) \{\s*held\.held = true;\s*entry\.owed = Math\.max\(entry\.owed \?\? seqAtPush, seqAtPush\);\s*patchEntry\(entry, \{ localEditedAt: takeoffHeldEditedAt\(Date\.now\(\), held\.stamp\) \}\);\s*setStateFor\(pid, 'offline'\);\s*kickTakeoffQueueDrain\(\);\s*return;/.test(push));
    ok('a FINAL push never holds: it goes into the queue stamped past the held write (floorMs in lastSeen)',
      /if \(gate === 'hold'\) \{\s*floorMs = stampMs\(held\.stamp\);\s*\} else \{/.test(push)
      && /const lastSeen = Math\.max\([\s\S]*?floorMs \?\? Number\.NEGATIVE_INFINITY/.test(push));
    ok('every teardown pushes FINAL: job switch, unmount, and a pre-sign-out flush (registerPreSignOutFlush)',
      /flush\(\);\s*void flushPushFinal\(\);\s*projectRef\.current = projectId;/.test(hk)
      && /useEffect\(\(\) => \(\) => \{ flush\(\); void flushPushFinal\(\); \}, \[flush, flushPushFinal\]\);/.test(hk)
      && /useEffect\(\(\) => registerPreSignOutFlush\(\(\) => flushPushFinal\(\)\), \[flushPushFinal\]\);/.test(hk)
      && !/void flushPush\(\)|\{ flush\(\); flushPush\(\); \}/.test(hk));
    ok('a FINAL flush with nothing pending still sends the latest doc when a push was held (checked on pushChain)',
      /entry\.queued\?\.held \? pushNow\(entry, pid, editUserId, docAtPush, seqAtPush, false, true\) : undefined/.test(hk)
      && /if \(p\) return doPush\(p\.pid, p\.editUserId, false, final\)/.test(hk));
    ok("a 'queued' outcome records the hold and checks the queue once",
      /if \(outcome === 'queued'\) \{\s*entry\.queued = \{ stamp, sentAt, seq: seqAtPush, held: false \};\s*carried\(entry, seqAtPush\);\s*setStateFor\(pid, 'offline'\);\s*queueCheck\(entry, pid\);/.test(push));
    ok('the hook listens for queue signals (onTakeoffQueueSignal) and settles on pushChain',
      /useEffect\(\(\) => onTakeoffQueueSignal\(/.test(hk) && /pushChain\.current\.then\(\(\) => settleIfLeft\(entry, pid\)\)/.test(hk));
    ok('a settled write that owes a push pushes the latest doc (doPush), a merge otherwise',
      /const landed = await settleLanded\(entry, pid, q\);\s*if \(landed === 'push'\) \{\s*void doPush\(pid, userIdRef\.current\)[\s\S]*?\} else if \(landed === 'unread'\) \{\s*kickMerge\(entry, pid\);/.test(hk)
      && /if \(act === 'merge' \|\| typeof v !== 'string'\) \{\s*kickMerge\(entry, pid\);\s*return 'merge';/.test(hk)
      && /const kickMerge = \(entry: MetaEntry, pid: string\): void => \{\s*if \(metaRef\.current === entry\) void serverSyncRef\.current\(pid, true\)/.test(hk));
    // Integration round 2 — an owed push survives until a push carrying it is
    // queued or verified (a failed settle read never drops it), and the page
    // going away (pagehide / AppState background) fires the FINAL push.
    ok("a failed settle read is 'unread' (decides nothing): mounted it merges, a teardown pushes on stamped past the write that left",
      /if \(v === 'offline' \|\| v === 'error'\) return 'unread';/.test(hk)
      && /if \(landed === 'unread'\) \{[\s\S]*?if \(!noHold\) \{ kickMerge\(entry, pid\); return; \}\s*floorMs = stampMs\(held\.stamp\);/.test(push));
    ok('pushNow sends nothing once nothing is owed, and clears the obligation only on a queued / verified / refused push carrying it',
      /if \(entry\.owed == null\) return;/.test(push)
      && /const carried = \(entry: MetaEntry, seq: number\): void => \{\s*if \(entry\.owed != null && seq >= entry\.owed\) entry\.owed = null;/.test(hk)
      && (push.match(/carried\(entry, seqAtPush\)/g) ?? []).length === 3
      && (hk.match(/entry\.owed = null;/g) ?? []).length === 2);
    ok('every edit owes a push (commit sets owed) and a FINAL flush with nothing pending pushes while owed',
      /metaRef\.current\.owed = editSeq\.current;/.test(hk)
      && /entry\.owed != null \|\| entry\.queued\?\.held \? pushNow\(/.test(hk));
    ok("every push is stamped past this browser's own unverified write (meta.pendingStamp in lastSeen)",
      /const lastSeen = Math\.max\([\s\S]*?stampMs\(entry\.meta\.pendingStamp\) \?\? Number\.NEGATIVE_INFINITY,\s*\);/.test(push));
    ok("a teardown's push behind a queued write skips the network pre-check (floorMs == null gates fetchServerStamp)",
      /if \(floorMs == null\) \{\s*const pre = await fetchServerStamp\(pid\);/.test(push));
    ok('the page going away fires the FINAL push: web pagehide + AppState background / inactive',
      /sub = AppState\.addEventListener\('change', \(s\) => \{\s*if \(s === 'background' \|\| s === 'inactive'\) away\(\);/.test(hk)
      && /w\.addEventListener\('pagehide', away\);/.test(hk)
      && /const away = \(\) => \{ flush\(\); void flushPushFinal\(\); \};/.test(hk));
    ok('a failed read with a push owed arms ONE retry (entry.retry), spent by the next signal / online / active',
      /if \(!pid \|\| !entry\.retry \|\| entry\.owed == null \|\| entry\.queued \|\| pushPending\.current\) return;[\s\S]*?entry\.retry = false;\s*schedulePush\(pid, userIdRef\.current\);/.test(hk)
      && /if \(entry\.queued\) queueCheck\(entry, entry\.pid\);\s*else rearmRef\.current\(\);/.test(hk)
      && /w\.addEventListener\('online', rearmOwed\);/.test(hk)
      && /if \(res === 'offline' && entry\.owed != null\) entry\.retry = true;/.test(hk)
      && /if \(typeof v !== 'string'\) \{ if \(v === 'offline'\) entry\.retry = true;/.test(push));
    ok("an edit while held keeps the line on 'offline' (never 'syncing') and is dated past the queued stamp",
      /if \(verdictOk\(pid\) && !heldBehind\) setSyncState\('syncing'\);/.test(hk) && /heldBehind \? takeoffHeldEditedAt\(Date\.now\(\), heldBehind\.stamp\)/.test(hk));
    ok('the save line used while held never claims the account', !/saved to your account/i.test(TAKEOFF_SAVE_LINES.offline));
    const tcs = read('utils', 'takeoffCloudSync.ts');
    ok('takeoffWriteQueued reads the own queue (getOwnOfflineQueueDetailed): unreadable → null, else isTakeoffWriteFor',
      /getOwnOfflineQueueDetailed\(\)/.test(tcs) && /if \(readFailed\) return null;/.test(tcs) && /entries\.some\(\(m\) => isTakeoffWriteFor\(m, projectId\)\)/.test(tcs));
    ok('kickTakeoffQueueDrain joins/starts one drain (processOfflineQueue) and adds no queue copy',
      /export function kickTakeoffQueueDrain\(\): void \{[\s\S]*?cloud\.queue\.processOfflineQueue\(\)[\s\S]*?\n\}/.test(tcs)
      && !/export function kickTakeoffQueueDrain[\s\S]*?supabaseWrite[\s\S]*?\n\}\n\n\/\*\*\n \* Called when/.test(tcs));
    ok('onTakeoffQueueSignal listens to onQueueChanged and onQueueFlushed (takeoff_docs)',
      /onQueueChanged\(\(\) => listener\(\)\)/.test(tcs) && /onQueueFlushed\(\(tables\) => \{ if \(tables\.has\('takeoff_docs'\)\) listener\(\); \}\)/.test(tcs));
  }

  console.log('\n7c. the workspace reads the hook typed (no widening cast)');
  {
    const ws = read('components', 'takeoff', 'TakeoffWorkspace.tsx');
    const panel = read('components', 'takeoff', 'ConditionsPanel.tsx');
    ok('TakeoffWorkspace destructures saveLine + conflict straight from useTakeoffConditions',
      /const tk = useTakeoffConditions\(projectId\);/.test(ws) && /const \{ doc, loaded, update, record, undo, redo, saveLine, conflict \} = tk;/.test(ws));
    ok('…with no widening cast and no fallbacks', !/as typeof tk &/.test(ws) && !/sync\.saveLine/.test(ws) && !/sync\.conflict/.test(ws) && !/\?\? 'Saved on this browser'/.test(ws));
    ok('ConditionsPanel imports the hook’s TakeoffConflict and declares no copy of its own',
      /import type \{ TakeoffConflict \} from '@\/hooks\/useTakeoffConditions';/.test(panel) && !/type TakeoffConflict\s*=/.test(panel) && /conflict: TakeoffConflict \| null;/.test(panel));
    ok('the seams stay put (rail, first-run, ai-section)',
      ws.includes('{/* seam:rail */}') && ws.includes('{/* seam:first-run */}') && panel.includes('{/* seam:ai-section */}'));
  }

  console.log('\n7d. 20260926190000_table_grant_hygiene.sql');
  {
    const g = read('supabase', 'migrations', '20260926190000_table_grant_hygiene.sql');
    const code = g.replace(/--.*$/gm, '');
    ok('the migration exists', g.length > 0);
    const walks = code.match(/from pg_class c\s+join pg_namespace n on n\.oid = c\.relnamespace\s+where n\.nspname = 'public'\s+and c\.relkind in \('r', 'p'\)/g) ?? [];
    ok('both passes (the revoke and the still-held count) walk every ordinary + partitioned table in public (relkind r / p)',
      walks.length === 2 && (code.match(/relkind in/g) ?? []).length === 2, `${walks.length} matching walks`);
    ok('it revokes the verb list from anon, authenticated with %I quoting',
      /format\(\s*'revoke %s on table %I\.%I from anon, authenticated',\s*verbs, t\.nspname, t\.relname\s*\)/.test(code));
    ok("the verb list is exactly truncate/trigger/references, plus maintain only on Postgres 17+ (prod is 17.6; PGlite has none)",
      /verbs\s+text := case when current_setting\('server_version_num'\)::int >= 170000\s+then 'truncate, trigger, references, maintain'\s+else 'truncate, trigger, references' end;/.test(code));
    ok('each table is its own step, and a failure is named in a NOTICE (never skipped silently)',
      /exception when others then\s+n_failed := n_failed \+ 1;\s+raise notice 'table_grant_hygiene: could not revoke on/.test(code));
    ok('a closing NOTICE gives the counts (tables / revoked / could not / still held)',
      /raise notice 'table_grant_hygiene: % public tables; revoked on %, could not revoke on %, still held on %'/.test(code));
    ok('default privileges for role postgres drop the same three verbs, behind a role-exists check',
      /if not exists \(select 1 from pg_roles where rolname = 'postgres'\)/.test(code)
      && /alter default privileges for role postgres in schema public\s+revoke truncate, trigger, references on tables from anon, authenticated;/.test(code));
    const revokes = [...code.matchAll(/revoke\s+([a-z, ]+?)\s+on\b/gi)].map((m) => m[1].toLowerCase());
    eq('the default-privilege revokes name exactly truncate/trigger/references (+ maintain on 17+) — SELECT / INSERT / UPDATE / DELETE untouched',
      revokes, ['truncate, trigger, references, maintain', 'truncate, trigger, references']);
    const bare = code.replace(/'(?:[^']|'')*'/g, "''");
    ok('no grant, and service_role, sequences, functions, views, storage and auth are never named outside messages',
      !/\bgrant\b/i.test(bare) && !/service_role|sequence|function|storage|\bauth\b|\bview\b/i.test(bare), bare.match(/\bgrant\b|service_role|sequence|function|storage|\bauth\b|\bview\b/i)?.[0]);
    ok('the header says why, what it does NOT do, and names 20260926181000',
      /WHY\./.test(g) && /WHAT IT DOES NOT DO\./.test(g) && g.includes('20260926181000'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
