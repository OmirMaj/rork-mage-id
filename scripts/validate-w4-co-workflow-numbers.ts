// validate-w4-co-workflow-numbers.ts — wave 4, lane co-workflow (#77 / #141).
//
// Two devices (the owner's offline phone + his web session) could both issue
// "CO #4". The fix has three parts, each pinned here:
//   1. 20260920050000_change_order_numbers.sql — a BEFORE INSERT trigger that
//      keeps a free client number and moves a collider to max + 1 under a
//      per-project lock; a BEFORE UPDATE trigger that pins `number` on client
//      writes (a queued edit carrying the old number must not hit a non-pkey
//      23505, which the offline queue drops as terminal); and the unique
//      (project_id, number) index. The migration itself is EXECUTED twice in
//      PGlite by the lane (scratchpad co_numbers_w4.mjs); this script pins its
//      text so a later edit cannot drop a part.
//   2. hooks/useServerChangeOrderNumber.ts — its pure `co-number-state` block
//      is transpiled and executed here.
//   3. The screen wiring is pinned in validate-w4-co-workflow-screen.ts.

import { readFileSync } from 'fs';
import { join } from 'path';

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;

const ROOT = join(__dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function ok(label: string, cond: unknown, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}

type State = 'checking' | 'pending' | 'unsaved' | 'confirmed' | 'unverified' | 'edit_unsaved';
const HOOK = 'hooks/useServerChangeOrderNumber.ts';
const src = read(HOOK);
const start = src.indexOf('// >>> co-number-state');
const end = src.indexOf('// <<< co-number-state');
ok(`${HOOK} carries the co-number-state block`, start > -1 && end > start);
const B = start > -1 && end > start
  ? new Function(`${new Transpiler({ loader: 'ts' }).transformSync(src.slice(start, end).replace(/^export /gm, ''))}\nreturn { coNumberStateFrom, coNumberHoldReason };`)() as {
      coNumberStateFrom: (o: { queued: boolean; unsaved: boolean; editUnsaved?: boolean; configured: boolean; read?: { number: number } | { missing: true } | { error: true }; remembered?: number }) => { state: State; number?: number };
      coNumberHoldReason: (s: State, a: 'email' | 'portal' | 'pdf') => string | null;
    }
  : null;

console.log('\nthe number state');
if (B) {
  const base = { queued: false, unsaved: false, configured: true };
  ok('queued INSERT → pending (never confirmed from the device list)', B.coNumberStateFrom({ ...base, queued: true, read: { number: 4 } }).state === 'pending');
  ok('refused INSERT in the sync ledger → unsaved', B.coNumberStateFrom({ ...base, unsaved: true }).state === 'unsaved');
  ok('server read → confirmed with the SERVER number', (() => { const r = B.coNumberStateFrom({ ...base, read: { number: 5 } }); return r.state === 'confirmed' && r.number === 5; })());
  ok('row not there yet (direct insert on the wire) → pending', B.coNumberStateFrom({ ...base, read: { missing: true } }).state === 'pending');
  ok('read failed, never confirmed → unverified', B.coNumberStateFrom({ ...base, read: { error: true } }).state === 'unverified');
  ok('read failed, confirmed before on this device → confirmed (offline PDF)', (() => { const r = B.coNumberStateFrom({ ...base, read: { error: true }, remembered: 5 }); return r.state === 'confirmed' && r.number === 5; })());
  ok('a queued insert beats a remembered number', B.coNumberStateFrom({ ...base, queued: true, remembered: 5 }).state === 'pending');
  ok('not yet read → checking', B.coNumberStateFrom(base).state === 'checking');
  // Integration round 2: a refused EDIT of a CO whose create landed keeps the
  // server's number — it is not "did not reach MAGE / no confirmed number".
  ok('an unsaved EDIT keeps the confirmed number (edit_unsaved)', (() => { const r = B.coNumberStateFrom({ ...base, editUnsaved: true, read: { number: 7 } }); return r.state === 'edit_unsaved' && r.number === 7; })());
  ok('an unsaved EDIT offline keeps the remembered number', (() => { const r = B.coNumberStateFrom({ ...base, editUnsaved: true, read: { error: true }, remembered: 7 }); return r.state === 'edit_unsaved' && r.number === 7; })());
  ok('an unsaved CREATE still wins over an edit flag', B.coNumberStateFrom({ ...base, unsaved: true, editUnsaved: true, read: { number: 7 } }).state === 'unsaved');
  ok('the edit_unsaved reason does not claim the CO never reached MAGE', !/did not reach MAGE|no confirmed number/.test(B.coNumberHoldReason('edit_unsaved', 'email') ?? ''));
  for (const s of ['checking', 'pending', 'unsaved', 'unverified', 'edit_unsaved'] as State[]) {
    ok(`${s}: email, portal and PDF are held, with a reason`, (['email', 'portal', 'pdf'] as const).every(a => (B.coNumberHoldReason(s, a) ?? '').length > 20));
  }
  ok('confirmed: nothing held', (['email', 'portal', 'pdf'] as const).every(a => B.coNumberHoldReason('confirmed', a) === null));
  ok('the pending reason says another device may have used the number', /another device may already have used this number/.test(B.coNumberHoldReason('pending', 'email') ?? ''));
}

console.log('\nthe hook wiring');
{
  ok('queued check uses insertStillQueued (money-ledger\'s frozen signature)', /insertStillQueued\(await getOfflineQueue\(\), 'change_orders', id\)/.test(src));
  ok('an unreadable queue counts as holding the insert', /catch \{ queued = true; \}/.test(src));
  ok('reads number by id', /from\('change_orders'\)\.select\('number'\)\.eq\('id', id\)\.maybeSingle\(\)/.test(src));
  ok('a differing server number re-pulls [\'changeOrders\']', /invalidateQueries\(\{ queryKey: \['changeOrders'\] \}\)/.test(src));
  ok('re-checks on queue change, flush of change_orders, and ledger change', /onQueueChanged\(/.test(src) && /tables\.has\('change_orders'\)/.test(src) && /onSyncLedgerChanged\(/.test(src));
  ok('the remembered-number key is mageid_-prefixed', /'mageid_co_numbers_confirmed'/.test(src));
  ok('round 2: "unsaved" is the CO\'s CREATE under Not saved (unsavedCreateIds), an unsaved edit is editUnsaved', /unsaved = \(await unsavedCreateIds\('change_orders'\)\)\.has\(id\)/.test(src) && /editUnsaved = \(await unsavedWriteIds\('change_orders'\)\)\.has\(id\)/.test(src));
}

console.log('\nthe migration');
{
  const mig = read('supabase/migrations/20260920050000_change_order_numbers.sql');
  ok('BEFORE INSERT trigger change_orders_assign_number, SECURITY DEFINER, search_path \'\'',
    /create trigger change_orders_assign_number\s+before insert on public\.change_orders/.test(mig)
    && /change_orders_assign_number_fn\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path to ''/.test(mig));
  ok('per-project advisory lock', /pg_advisory_xact_lock\(hashtext\('change_orders'\), hashtext\(NEW\.project_id::text\)\)/.test(mig));
  ok('keeps a FREE client number; only a collider / missing number moves to max+1',
    /if NEW\.number is null\s+or NEW\.number < 1\s+or exists \(/.test(mig) && /c\.id is distinct from NEW\.id/.test(mig) && /coalesce\(max\(c\.number\), 0\) \+ 1 into NEW\.number/.test(mig));
  ok('client UPDATEs keep the number (invoker, authenticated/anon only)',
    /create trigger change_orders_keep_number\s+before update on public\.change_orders/.test(mig)
    && /change_orders_keep_number_fn\(\)\s+returns trigger\s+language plpgsql\s+security invoker/.test(mig)
    && /current_user in \('authenticated', 'anon'\) and NEW\.number is distinct from OLD\.number/.test(mig));
  ok('execute revoked on both functions', /revoke execute on function public\.change_orders_assign_number_fn\(\) from public, anon, authenticated;/.test(mig)
    && /revoke execute on function public\.change_orders_keep_number_fn\(\) from public, anon, authenticated;/.test(mig));
  ok('unique index change_orders_project_number_key (project_id, number), after the dedupe loop',
    /create unique index if not exists change_orders_project_number_key on public\.change_orders \(project_id, number\);/.test(mig)
    && mig.indexOf('do $renumber$') < mig.indexOf('create unique index if not exists change_orders_project_number_key')
    && mig.indexOf('create trigger change_orders_assign_number') < mig.indexOf('create unique index if not exists change_orders_project_number_key'));
  ok('revises_change_order_id uuid (nullable)', /add column if not exists revises_change_order_id uuid;/.test(mig));
}

// Reviewer round 1 — a CO the provider already fetched from the server (made
// on the web, or long ago here) must be printable offline: the provider seeds
// the confirmed map from its SERVER rows. The seeding merges into the
// persisted map (after loadRemembered), never overwriting it.
console.log('\nserver-fetched numbers count as confirmed offline');
ok('rememberServerChangeOrderNumbers is exported and merges after loadRemembered',
  /export function rememberServerChangeOrderNumbers\(rows: readonly \{ id: string; number: number \}\[\]\): void/.test(src)
  && /loadRemembered\(\)\.then\(\(\) => rememberMany\(/.test(src));
ok('an unreachable server with a remembered (seeded) number reads confirmed', (() => {
  const blk = src.slice(start, end);
  return /return o\.remembered != null \? \{ state: 'confirmed', number: o\.remembered \} : \{ state: 'unverified' \};/.test(blk);
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
