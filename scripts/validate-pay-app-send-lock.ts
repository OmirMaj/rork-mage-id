// scripts/validate-pay-app-send-lock.ts — the DATABASE lock on a pay
// application that was certified and sent with no Stripe pay link
// (supabase/migrations/20261014090000_aia_pay_app_send_lock.sql, lane
// PAYAPP-1c).
//
// The behaviour is proved by running the migration in PGlite
// (scripts/pgq/aia-pay-app-send-lock.mjs, 23 cases, 16 planted mutations).
// PGlite is not installed in the gate, so THIS file holds the lines that must
// not drift, by reading:
//   A. the freeze function replaced here still freezes every column the
//      function it replaces froze, still leaves the architect's certificate
//      response writable, and freezes on the pay link OR the send stamp;
//   B. the stamp is the server's: its own clock, kept once set, and the app
//      never writes the column;
//   C. the migration never stamps `certified_at` (the server reads that as
//      "a Stripe link was made"), touches no policy and no grant, deletes
//      nothing, and its ONE write to existing rows sets updated_at to itself
//      on rows that already carry the app's stamp;
//   D. the app and the migration agree on where the sidecar stamp lives;
//   E. (20261014100000_aia_pay_app_delete_guard.sql, proved by
//      scripts/pgq/aia-pay-app-delete-guard.mjs) a frozen row cannot be
//      deleted by a client, a draft can, and the service role and a cascade
//      still can.
// Planted mutations: each line is broken once, in memory, and must go red.
//
// Run: bun run scripts/validate-pay-app-send-lock.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiaRowToSaved, savedToAiaRow } from '../utils/projectContextPure';
import { keepsItsServerRow } from '../utils/payApp/sendLock';
import type { SavedAIAPayApp } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const MIGRATION = 'supabase/migrations/20261014090000_aia_pay_app_send_lock.sql';
const PRIOR = 'supabase/migrations/20260911090000_aia_certificate_response_writable.sql';
const PROOF = 'scripts/pgq/aia-pay-app-send-lock.mjs';
const GUARD = 'supabase/migrations/20261014100000_aia_pay_app_delete_guard.sql';
const GUARD_PROOF = 'scripts/pgq/aia-pay-app-delete-guard.mjs';
const QUEUE = 'utils/offlineQueue.ts';
const CONTEXT = 'contexts/ProjectContext.tsx';
const MAPPER = 'utils/projectContextPure.ts';
const LOCK = 'utils/payApp/sendLock.ts';
const BALANCE = 'supabase/functions/_shared/payLinkBalance.ts';
type Files = Map<string, string>;
const REAL: Files = new Map([MIGRATION, PRIOR, PROOF, MAPPER, LOCK, BALANCE, GUARD, GUARD_PROOF, QUEUE, CONTEXT].map(f => [f, read(f)]));

/** SQL with `--` comments removed, so a rule cannot be satisfied by prose. */
const sql = (s: string) => s.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
/** The body of one `create or replace function public.<name>()`, comments stripped. */
function fnBody(src: string, name: string): string {
  const s = sql(src);
  const at = s.indexOf(`create or replace function public.${name}()`);
  if (at < 0) return '';
  const open = s.slice(at).match(/as (\$[a-z]*\$)/);
  if (!open) return '';
  const from = at + (open.index ?? 0) + open[0].length;
  const end = s.indexOf(open[1], from);
  return end < 0 ? '' : s.slice(from, end);
}
/** Columns compared new against old, plainly or with '' and NULL folded together. */
const frozenColumns = (body: string) => [...body.matchAll(/(?:coalesce\()?new\.([a-z_]+)(?:, ''\))?\s+is distinct from (?:coalesce\()?old\.\1/g)].map(m => m[1]);
const TEXT_COLUMNS = ['owner_name', 'contractor_name', 'architect_name', 'project_name', 'project_location', 'contract_for_description', 'invoice_id'];
const EXEMPT = ['amountCertified', 'certifiedDate', 'certifiedExplanation'];

interface Rule { name: string; run: (f: Files) => string[] }
const RULES: Rule[] = [
  { name: 'A. the freeze function keeps every column the one it replaces froze, and the certificate response stays writable', run: (f) => {
    const out: string[] = [];
    const now = fnBody(f.get(MIGRATION)!, 'freeze_certified_aia_pay_app');
    const was = fnBody(f.get(PRIOR)!, 'freeze_certified_aia_pay_app');
    if (!now || !was) return ['the freeze function was not found in one of the two migrations'];
    const have = new Set(frozenColumns(now));
    const lost = frozenColumns(was).filter(c => !have.has(c));
    if (lost.length) out.push(`no longer frozen: ${lost.join(', ')}`);
    if (frozenColumns(was).length < 15) out.push('the earlier freeze list could not be read');
    if (!/new_frozen\s+is distinct from old_frozen/.test(now)) out.push('the saved totals are not compared');
    for (const side of ['old', 'new']) for (const key of EXEMPT) {
      if (!new RegExp(`${side}_frozen := \\(to_jsonb\\(${side}\\.snapshot_totals\\)[^;]*#- '\\{__mageCertificate,${key}\\}'`).test(now)) out.push(`${key} is not left out of the ${side} side`);
    }
    if ((now.match(/#- '\{/g) ?? []).length !== 6) out.push('something other than the three certificate fields is left out of the comparison');
    if (!/using errcode = 'check_violation'/.test(now)) out.push('a refusal is not a check_violation');
    for (const c of TEXT_COLUMNS) if (!now.includes(`or coalesce(new.${c}, '') is distinct from coalesce(old.${c}, '')`)) out.push(`${c}: '' and NULL are different values (the app's own re-save would be refused)`);
    for (const c of ['id', 'user_id', 'project_id']) if (!have.has(c)) out.push(`${c} is not frozen`);
    return out;
  } },
  { name: 'A. a row is frozen by the pay link OR the send stamp, and certified_at can be set once on a sent row and never cleared', run: (f) => {
    const out: string[] = [];
    const now = fnBody(f.get(MIGRATION)!, 'freeze_certified_aia_pay_app');
    if (!/if old\.certified_at is not null or old\.sent_locked_at is not null then/.test(now)) out.push('the freeze does not key on both the pay link and the send stamp');
    if (!/or \(old\.certified_at is not null and new\.certified_at is distinct from old\.certified_at\)/.test(now)) out.push('certified_at is not "set once, then immutable"');
    if (/sent_locked_at\s*:=/.test(now)) out.push('the freeze function writes the stamp');
    return out;
  } },
  { name: 'B. the stamp is the server\'s: its own clock, kept once set, taken from the sidecar key the app writes', run: (f) => {
    const out: string[] = [];
    const src = sql(f.get(MIGRATION)!);
    const body = fnBody(f.get(MIGRATION)!, 'aia_pay_app_stamp_send_lock');
    if (!body) return ['the stamp function was not found'];
    if (!/if tg_op = 'UPDATE' and old\.sent_locked_at is not null then\s+new\.sent_locked_at := old\.sent_locked_at;/.test(body)) out.push('a stamped row does not keep its stamp');
    if (!/if v_sidecar is not null and jsonb_typeof\(old\.snapshot_totals #> v_path\) = 'string' then\s+new\.snapshot_totals := jsonb_set\(new\.snapshot_totals, v_path, old\.snapshot_totals #> v_path\);\s+end if;\s+return new;\s+end if;/.test(body)) out.push('a certify sent twice does not keep the first sidecar time (it would be refused)');
    if ((body.match(/new\.snapshot_totals\s*:=/g) ?? []).length !== 1) out.push('the snapshot is rewritten somewhere else');
    if (!/new\.sent_locked_at := case when v_sidecar is not null then now\(\) else null end;/.test(body)) out.push('the stamp is not the server clock, or a client-sent value survives on an unstamped row');
    if (!/v_path constant text\[\] := array\['__mageCertificate', 'sentLockedAt'\];/.test(body)) out.push('the sidecar key read is not __mageCertificate.sentLockedAt');
    if (!/then nullif\(btrim\(new\.snapshot_totals #>> v_path\), ''\)/.test(body)) out.push('a blank sidecar stamps');
    if (!/when jsonb_typeof\(new\.snapshot_totals\) = 'object' and jsonb_typeof\(new\.snapshot_totals #> v_path\) = 'string'/.test(body)) out.push('a snapshot that is not an object, or a stamp that is not text, is read as a stamp');
    if ((body.match(/sent_locked_at\s*:=/g) ?? []).length !== 2) out.push('the stamp is written somewhere else in the function');
    if (!/function public\.aia_pay_app_stamp_send_lock\(\)\s+returns trigger\s+language plpgsql\s+security invoker\s+set search_path = ''/.test(src)) out.push('the stamp function is not SECURITY INVOKER with an empty search_path');
    if (!/create trigger trg_aia_pay_app_stamp_send_lock\s+before insert or update on public\.aia_pay_apps\s+for each row execute function public\.aia_pay_app_stamp_send_lock\(\);/.test(src)) out.push('the stamp trigger is not BEFORE INSERT OR UPDATE, per row');
    if (!/revoke all on function public\.aia_pay_app_stamp_send_lock\(\) from public, anon, authenticated;/.test(src)) out.push('the stamp function is left callable by a client');
    if (!/alter table public\.aia_pay_apps add column if not exists sent_locked_at timestamptz;/.test(src)) out.push('the column is not a plain nullable timestamptz with no default');
    return out;
  } },
  { name: 'C. the migration never stamps certified_at, touches no policy or grant, and backfills and deletes nothing', run: (f) => {
    const out: string[] = [];
    const src = sql(f.get(MIGRATION)!);
    if (/certified_at\s*:=/.test(src) || /set\s+certified_at/i.test(src)) out.push('certified_at is stamped without Stripe');
    if (/\b(create|alter|drop)\s+policy\b/i.test(src)) out.push('a policy is touched');
    if (/^\s*grant\b/im.test(src)) out.push('a grant is made');
    const TOUCH = /update public\.aia_pay_apps\s+set updated_at = updated_at\s+where sent_locked_at is null\s+and jsonb_typeof\(snapshot_totals\) = 'object'\s+and jsonb_typeof\(snapshot_totals #> '\{__mageCertificate,sentLockedAt\}'\) = 'string'\s+and nullif\(btrim\(snapshot_totals #>> '\{__mageCertificate,sentLockedAt\}'\), ''\) is not null;/;
    if (!TOUCH.test(src)) out.push('rows that already carry the app\'s stamp are not stamped, or the touch changes something');
    const rest = src.replace(TOUCH, '');
    if (/\bupdate\s+public\./i.test(rest) || /\binsert\s+into\b/i.test(rest) || /\bdelete\s+from\b/i.test(rest) || /\btruncate\b/i.test(rest)) out.push('rows are written or removed');
    if (src.indexOf('update public.aia_pay_apps') < src.indexOf('create trigger trg_aia_pay_app_stamp_send_lock')) out.push('the touch runs before the stamp trigger exists');
    if (/\bdrop\s+(table|column)\b/i.test(src) || /security definer/i.test(src)) out.push('something is dropped, or a function is SECURITY DEFINER');
    if (!/const throughStripe = !!aia\.pay_link_id \|\| !!aia\.pay_link_url \|\| !!aia\.certified_at;/.test(f.get(BALANCE)!)) out.push('payLinkBalance no longer reads certified_at (re-check why this migration must not stamp it)');
    return out;
  } },
  { name: 'D. the app writes the sidecar stamp where the migration reads it, and never writes the column', run: (f) => {
    const out: string[] = [];
    const mapper = f.get(MAPPER)!;
    if (!/const AIA_EXTRAS_FIELD = '__mageCertificate';/.test(mapper)) out.push('the sidecar field was renamed');
    if (!/if \(a\.sentLockedAt\) extras\.sentLockedAt = a\.sentLockedAt;/.test(mapper)) out.push('the sidecar stamp is no longer written');
    if (/sent_locked_at/.test(mapper)) out.push('the mapper names the server column');
    if (!/20261014090000_aia_pay_app_send_lock\.sql/.test(f.get(LOCK)!)) out.push('utils/payApp/sendLock.ts does not say the database holds the lock too');
    const proof = f.get(PROOF)!;
    if (!/const FILE = '20261014090000_aia_pay_app_send_lock\.sql';/.test(proof)) out.push('the PGlite proof is not of this migration');
    if ((proof.match(/^\s+case \d+: rep\(/gm) ?? []).length < 16) out.push('the PGlite proof lost planted mutations');
    return out;
  } },
  { name: 'E. a frozen row cannot be deleted by a client; a draft, the service role and a cascade are not stopped', run: (f) => {
    const out: string[] = [];
    const src = sql(f.get(GUARD)!);
    const body = fnBody(f.get(GUARD)!, 'aia_pay_app_guard_frozen_delete');
    if (!body) return ['the delete guard function was not found'];
    if (!/^\s*begin\s+if \(old\.certified_at is not null or old\.sent_locked_at is not null\)\s+and current_user in \('authenticated', 'anon'\) then\s+raise exception/.test(body)) out.push('the guard is not the FIRST thing the function does, or does not key on (pay link OR send stamp) AND a client role');
    if ((body.match(/\breturn\b/g) ?? []).length !== 1) out.push('the function returns somewhere other than its last line');
    const count = (re: RegExp) => (src.match(re) ?? []).length;
    if (count(/create or replace function/g) !== 1 || count(/create trigger/g) !== 1 || count(/drop trigger/g) !== 1 || count(/drop function/g) !== 0) out.push('the file defines or drops more than the one function and the one trigger');
    if (src.indexOf('drop trigger') > src.indexOf('create trigger')) out.push('the trigger is dropped after it is created');
    if (!/\$verify\$;\s*$/.test(src)) out.push('something runs after the self-check');
    if (!/tgtype = 11 and tgenabled = 'O'/.test(src) || !/relowner::regrole::text[^;]*in \('authenticated', 'anon'\) then\s+raise exception/.test(src) || !/has_table_privilege\('authenticated', 'public\.aia_pay_apps', 'TRUNCATE'\)\s+or has_table_privilege\('anon', 'public\.aia_pay_apps', 'TRUNCATE'\) then\s+raise exception/.test(src)) out.push('the self-check does not hold the trigger enabled, the owner not a client role, and TRUNCATE not held by a client');
    if (!/end if;\s+return old;\s+end\s*$/.test(body)) out.push('a delete that is allowed is not let through (BEFORE DELETE must return old)');
    if (!/using errcode = 'check_violation'/.test(body)) out.push('the refusal is not a check_violation');
    const msg = body.match(/raise exception\s+'([^']*)'/)?.[1] ?? '';
    if (!/violates/.test(msg) || /foreign key/.test(msg)) out.push('the refusal does not read as final to the offline queue (it would be retried)');
    if (!/\(m\.includes\('violates'\) && !m\.includes\('foreign key'\)\)/.test(f.get(QUEUE)!)) out.push('utils/offlineQueue.ts no longer reads "violates" as final: re-check the refusal wording');
    if (!/function public\.aia_pay_app_guard_frozen_delete\(\)\s+returns trigger\s+language plpgsql\s+security invoker\s+set search_path = ''/.test(src)) out.push('the guard is not SECURITY INVOKER with an empty search_path (as definer, current_user would be the owner and nothing would be refused)');
    if (!/create trigger trg_aia_pay_app_guard_frozen_delete\s+before delete on public\.aia_pay_apps\s+for each row execute function public\.aia_pay_app_guard_frozen_delete\(\);/.test(src)) out.push('the guard is not BEFORE DELETE, per row');
    if (!/revoke all on function public\.aia_pay_app_guard_frozen_delete\(\) from public, anon, authenticated;/.test(src)) out.push('the guard function is left callable by a client');
    if (/\b(create|alter|drop)\s+policy\b/i.test(src) || /^\s*grant\b/im.test(src) || /\bupdate\s+public\./i.test(src) || /\bdelete\s+from\b/i.test(src) || /\binsert\s+into\b/i.test(src) || /\balter\s+table\b/i.test(src)) out.push('the file touches a policy, a grant, the table or a row');
    if (!/apply 20261014090000_aia_pay_app_send_lock\.sql first/.test(src)) out.push('the file does not refuse to apply before the send lock');
    const proof = f.get(GUARD_PROOF)!;
    if (!/const FILE = '20261014100000_aia_pay_app_delete_guard\.sql';/.test(proof) || (proof.match(/^\s+case \d+: rep\(/gm) ?? []).length < 8) out.push('the PGlite proof is not of this migration, or lost planted mutations');
    return out;
  } },
  { name: 'F. the app never sends the housekeeping delete for a record the server keeps, and never drops one from the device', run: (f) => {
    const out: string[] = [];
    const ctx = f.get(CONTEXT)!;
    const leaves = "const leaves = (a: SavedAIAPayApp) => sameRecord(a) && (a.id === finalApp.id || !keepsItsServerRow(a));";
    if (ctx.split(leaves).length - 1 !== 2) out.push('addAIAPayApp and saveAIAPayAppOnline do not both spare a locked record');
    if (!ctx.includes('const dedup = aiaPayApps.filter(a => !leaves(a));') || !ctx.includes('const updated = [finalApp, ...base.filter(a => !leaves(a))];')) out.push('a locked record is dropped from the device list');
    if (!ctx.includes('const displaced = aiaPayApps.filter(a => leaves(a) && a.id !== finalApp.id);') || !ctx.includes('const displaced = base.filter(a => leaves(a) && a.id !== finalApp.id);')) out.push('the housekeeping delete can target a locked record');
    if ((ctx.match(/supabaseWrite\('aia_pay_apps', 'delete'/g) ?? []).length !== 3) out.push('a new delete of a pay application was added: check it against the delete guard');
    if (!/export function keepsItsServerRow\([^)]*\): boolean \{\s+if \(!rec\) return false;\s+return payAppLock\(\{ sentLockedAt: rec\.sentLockedAt, payLinkUrl: rec\.payLinkUrl, paidAt: rec\.paidAt, pendingBankPayment: !!rec\.paymentPendingAt \}\)\.locked;/.test(f.get(LOCK)!)) out.push('keepsItsServerRow is not the screen\'s own lock test');
    return out;
  } },
];
for (const r of RULES) { const bad = r.run(REAL); ok(r.name, bad.length === 0, bad.join(' | ')); }

// By running it: the row the app writes carries the stamp exactly where the trigger looks, and nowhere else.
{
  const rec = { id: 'r1', projectId: 'p1', applicationNumber: 2, lines: [], totals: { currentPaymentDue: 10 }, sentLockedAt: '2026-10-10T12:00:00.000Z' } as unknown as SavedAIAPayApp;
  const row = savedToAiaRow(rec, 'u1') as Record<string, unknown>;
  const snap = row.snapshot_totals as Record<string, Record<string, unknown>>;
  ok('the row the app writes carries the stamp at snapshot_totals.__mageCertificate.sentLockedAt', snap?.__mageCertificate?.sentLockedAt === '2026-10-10T12:00:00.000Z');
  ok('the row the app writes has no sent_locked_at column (the server owns it)', !('sent_locked_at' in row));
  ok('a row read back with the server column on it still maps (an unknown column is ignored)', aiaRowToSaved({ ...row, sent_locked_at: '2026-10-10T12:00:01Z' }).sentLockedAt === '2026-10-10T12:00:00.000Z');
  // What the freeze compares must survive the app's own read and re-write, with '' and NULL folded as the trigger folds them.
  const stored: Record<string, unknown> = { ...row, architect_name: '', project_location: '', contract_for_description: '', owner_name: 'Sample Owner', invoice_id: null, application_date: '2026-10-10', retainage_percent: 0 };
  const again = savedToAiaRow(aiaRowToSaved(stored), 'u1') as Record<string, unknown>;
  const fold = (v: unknown) => (v == null ? '' : v);
  const moved = ['application_number', 'application_date', 'period_to', 'contract_date', 'original_contract_sum', 'net_change_by_co', 'contract_sum_to_date', 'retainage_percent', 'less_previous_certificates', 'lines', 'snapshot_totals', ...TEXT_COLUMNS, 'id', 'user_id', 'project_id']
    .filter(c => JSON.stringify(fold(again[c])) !== JSON.stringify(fold(stored[c])));
  ok('a frozen row read by the app and written back is the same in every frozen column', moved.length === 0, moved.join(', '));
  const draft = savedToAiaRow({ ...rec, sentLockedAt: undefined } as SavedAIAPayApp, 'u1') as Record<string, unknown>;
  ok('a draft writes no stamp', !JSON.stringify(draft.snapshot_totals ?? null).includes('sentLockedAt'));
}

// By running it: which records the server keeps.
{
  const keeps = (r: Parameters<typeof keepsItsServerRow>[0]) => keepsItsServerRow(r);
  ok('a sent record, one with a pay link, a paid one and one with a bank payment settling keep their server row; a draft does not',
    keeps({ sentLockedAt: '2026-10-10T12:00:00.000Z' }) && keeps({ payLinkUrl: 'https://pay' }) && keeps({ paidAt: '2026-10-10' }) && keeps({ paymentPendingAt: '2026-10-10' })
      && !keeps({}) && !keeps(null) && !keeps({ sentLockedAt: '', payLinkUrl: null }));
}

// ═══ Planted mutations ══════════════════════════════════════════════════════
const PLANTS: [string, number, string, string, string][] = [
  ['the lines are dropped from the freeze', 0, MIGRATION, '      or new.lines                      is distinct from old.lines\n', ''],
  ['the invoice link is dropped from the freeze', 0, MIGRATION, "      or coalesce(new.invoice_id, '') is distinct from coalesce(old.invoice_id, '')\n", ''],
  ['an empty text box and NULL are different values again', 0, MIGRATION, "      or coalesce(new.project_location, '') is distinct from coalesce(old.project_location, '')", '      or new.project_location is distinct from old.project_location'],
  ['a frozen row can be moved to another job', 0, MIGRATION, '      or new.project_id                 is distinct from old.project_id\n', ''],
  ['the saved totals are not compared', 0, MIGRATION, '      or new_frozen                     is distinct from old_frozen\n', ''],
  ['the amount certified is frozen', 0, MIGRATION, "    new_frozen := (to_jsonb(new.snapshot_totals)\n                     #- '{__mageCertificate,amountCertified}'\n", '    new_frozen := (to_jsonb(new.snapshot_totals)\n'],
  ['the sent stamp itself is left out of the comparison', 0, MIGRATION, "                     #- '{__mageCertificate,certifiedExplanation}');\n    new_frozen", "                     #- '{__mageCertificate,certifiedExplanation}'\n                     #- '{__mageCertificate,sentLockedAt}');\n    new_frozen"],
  ['a refusal is a plain exception', 0, MIGRATION, "        using errcode = 'check_violation';", ';'],
  ['the freeze ignores the send stamp', 1, MIGRATION, '  if old.certified_at is not null or old.sent_locked_at is not null then', '  if old.certified_at is not null then'],
  ['certified_at can be cleared', 1, MIGRATION, '      or (old.certified_at is not null and new.certified_at is distinct from old.certified_at)\n', ''],
  ['a pay link can never be added after the send', 1, MIGRATION, '      or (old.certified_at is not null and new.certified_at is distinct from old.certified_at)', '      or new.certified_at is distinct from old.certified_at'],
  ['the stamp is the phone\'s clock', 2, MIGRATION, 'then now() else null end;', 'then v_sidecar::timestamptz else null end;'],
  ['a client-sent stamp survives on a draft', 2, MIGRATION, 'then now() else null end;', 'then now() else new.sent_locked_at end;'],
  ['a stamped row does not keep its stamp', 2, MIGRATION, '    new.sent_locked_at := old.sent_locked_at;\n', ''],
  ['a certify sent twice is refused', 2, MIGRATION, '      new.snapshot_totals := jsonb_set(new.snapshot_totals, v_path, old.snapshot_totals #> v_path);', '      null;'],
  ['a stamp that is not text locks the row', 2, MIGRATION, " and jsonb_typeof(new.snapshot_totals #> v_path) = 'string'\n", '\n'],
  ['a blank sidecar stamps', 2, MIGRATION, "then nullif(btrim(new.snapshot_totals #>> v_path), '')", 'then new.snapshot_totals #>> v_path'],
  ['the stamp trigger fires on insert only', 2, MIGRATION, '  before insert or update on public.aia_pay_apps\n  for each row execute function public.aia_pay_app_stamp_send_lock();', '  before insert on public.aia_pay_apps\n  for each row execute function public.aia_pay_app_stamp_send_lock();'],
  ['the stamp function is SECURITY DEFINER', 2, MIGRATION, "security invoker\nset search_path = ''\nas $fn$", "security definer\nset search_path = ''\nas $fn$"],
  ['the stamp function is left callable', 2, MIGRATION, 'revoke all on function public.aia_pay_app_stamp_send_lock() from public, anon, authenticated;', ''],
  ['certified_at is stamped without Stripe', 3, MIGRATION, '  new.sent_locked_at := case when v_sidecar is not null then now() else null end;', '  new.sent_locked_at := case when v_sidecar is not null then now() else null end;\n  new.certified_at := new.sent_locked_at;'],
  ['every old row with a certificate sidecar is stamped', 3, MIGRATION, "notify pgrst, 'reload schema';", "update public.aia_pay_apps set sent_locked_at = now() where snapshot_totals ? '__mageCertificate';\nnotify pgrst, 'reload schema';"],
  ['rows that already carry the stamp are left open', 3, MIGRATION, 'update public.aia_pay_apps\n   set updated_at = updated_at\n', 'update public.aia_pay_apps\n   set updated_at = now()\n'],
  ['a grant is made', 3, MIGRATION, "notify pgrst, 'reload schema';", "grant update (sent_locked_at) on public.aia_pay_apps to authenticated;\nnotify pgrst, 'reload schema';"],
  ['a row frozen by the send alone can be deleted', 5, GUARD, '  if (old.certified_at is not null or old.sent_locked_at is not null)', '  if (old.certified_at is not null)'],
  ['every role is refused: the job and the account cannot be deleted', 5, GUARD, "     and current_user in ('authenticated', 'anon') then", '     then'],
  ['an allowed delete is silently skipped', 5, GUARD, '  return old;', '  return null;'],
  ['the guard is SECURITY DEFINER', 5, GUARD, "security invoker\nset search_path = ''\nas $fn$", "security definer\nset search_path = ''\nas $fn$"],
  ['the guard fires on update', 5, GUARD, '  before delete on public.aia_pay_apps', '  before update on public.aia_pay_apps'],
  ['the refusal is retried by the queue', 5, GUARD, 'cannot be deleted: that violates its send lock.', 'cannot be deleted.'],
  ['the guard applies before the send lock exists', 5, GUARD, "    raise exception '[aia_pay_app_delete_guard] apply 20261014090000_aia_pay_app_send_lock.sql first (sent_locked_at is missing)';", '    null;'],
  ['the queue stops reading "violates" as final', 5, QUEUE, "(m.includes('violates') && !m.includes('foreign key'))", "m.includes('violates constraint')"],
  ['the guard is skipped by an early return', 5, GUARD, "as $fn$\nbegin\n  if (old.certified_at", "as $fn$\nbegin\n  return old;\n  if (old.certified_at"],
  ['the trigger is dropped again after the self-check', 5, GUARD, "$verify$;\n", "$verify$;\ndrop trigger if exists trg_aia_pay_app_guard_frozen_delete on public.aia_pay_apps;\n"],
  ['the self-check stops looking at TRUNCATE', 5, GUARD, "has_table_privilege('authenticated', 'public.aia_pay_apps', 'TRUNCATE')", "has_table_privilege('authenticated', 'public.aia_pay_apps', 'DELETE')"],
  ['the save path deletes a locked older record again', 6, CONTEXT, "const displaced = base.filter(a => leaves(a) && a.id !== finalApp.id);", "const displaced = base.filter(a => sameRecord(a) && a.id !== finalApp.id);"],
  ['a locked older record is dropped from the device', 6, CONTEXT, "const dedup = aiaPayApps.filter(a => !leaves(a));", "const dedup = aiaPayApps.filter(a => !sameRecord(a));"],
  ['a pay link no longer keeps the row', 6, LOCK, "return payAppLock({ sentLockedAt: rec.sentLockedAt, payLinkUrl: rec.payLinkUrl,", "return payAppLock({ sentLockedAt: rec.sentLockedAt, payLinkUrl: null,"],
  ['the sidecar field is renamed in the app', 4, MAPPER, "const AIA_EXTRAS_FIELD = '__mageCertificate';", "const AIA_EXTRAS_FIELD = '__mageExtras';"],
  ['the app stops writing the sidecar stamp', 4, MAPPER, '  if (a.sentLockedAt) extras.sentLockedAt = a.sentLockedAt;\n', ''],
  ['the app writes the server column', 4, MAPPER, '    notes: a.notes ?? null,\n', '    notes: a.notes ?? null,\n    sent_locked_at: a.sentLockedAt ?? null,\n'],
];
let caught = 0;
for (const [what, ruleIndex, file, from, to] of PLANTS) {
  const src = REAL.get(file)!;
  if (!src.includes(from)) { ok(`plant "${what}": its anchor is in ${file}`, false, from.slice(0, 80)); continue; }
  const mutated: Files = new Map(REAL);
  mutated.set(file, src.replace(from, to));
  const bad = RULES[ruleIndex].run(mutated);
  if (bad.length > 0) caught++;
  ok(`plant "${what}" turns its rule red`, bad.length > 0);
}

console.log(`\n${failed === 0 ? '✓' : '✗'} validate-pay-app-send-lock: ${passed} passed, ${failed} failed (${caught} of ${PLANTS.length} planted mutations caught)`);
process.exit(failed === 0 ? 0 : 1);
