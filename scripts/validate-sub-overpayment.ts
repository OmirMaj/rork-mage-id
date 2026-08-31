// validate-sub-overpayment.ts — pins the sub-invoice overpayment guard and the
// "Advance requested" confirmation, the two places where MAGE tells a GC
// something about money that was not true.
//
// WHY THIS EXISTS (finding #13, docs/audits/2026-08-31-medium-sweep.md).
// `commitment.paidToDate` is the server rollup maintained by the
// recompute_commitment_paid_to_date trigger, and it sums every APPROVED *and*
// PAID sub invoice on the commitment. The "Mark paid" button only renders on
// invoices that are already 'approved' (app/sub-portal-setup.tsx), so the
// invoice in hand is already inside paidToDate — yet the guard computed
// `paidToDate + thisAmount`. On the final $10,000 draw of a fully-billed
// $50,000 commitment the GC got a blocking destructive dialog claiming that
// an exactly-on-contract payment would push the sub $10,000 over. They either
// stopped to chase a change order that does not exist, or learned the warning
// was noise and clicked "Pay anyway" through it — which is precisely the
// failure the guard exists to prevent.
//
// The same fix closes the opposite hole. The "fall back to a client-side sum
// when offline" branch was dead code, because ProjectContext maps
// `paid_to_date == null ? 0 : Number(...)` so the value is never null. An
// approval made offline is queued by supabaseWrite and the trigger has not
// run, so the rollup reads stale-low and the guard failed OPEN — silent
// overpayment, the exact thing it was written to stop.
//
// WHY THIS ALSO GUARDS ReadyToBillCard (finding #29). supabase-js RESOLVES on
// a PostgREST error rather than rejecting. The advance-interest upsert
// discarded its result and skipped the write entirely on an expired session,
// then showed "Advance requested — a lending partner will reach out" either
// way, and latched the button to 'done' so the GC could not retry. No row, no
// call, no way to ask again.
//
// The overpayment cases below execute the SHIPPED function: the source is
// extracted from app/sub-portal-setup.tsx between its sentinel comments and
// transpiled, because that file is an Expo Router route and cannot be
// imported outside Metro.
//
// Run via: bun run scripts/validate-sub-overpayment.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Declared locally rather than pulled from `bun-types`: this repo has no bun
// type package installed, and without this `npx tsc --noEmit` fails with
// TS2867 "Cannot find name 'Bun'" — a guard script must not break the repo's
// own type-check. Same pattern as scripts/validate-photo-drain.ts:40. Only the
// sliver of Bun.Transpiler used below is described.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

// ── load the shipped implementation ─────────────────────────────────────────
type Inv = { id: string; amount?: number; status: string; commitmentId?: string };
type Com = { amount?: number; changeAmount?: number; paidToDate?: number };
type Result = {
  overage: number; commitmentTotal: number; alreadyApproved: number; thisAmount: number;
} | null;
type Compute = (a: { invoice: Inv; commitment: Com; siblings: Inv[] }) => Result;

const SCREEN = 'app/sub-portal-setup.tsx';
const screenSrc = read(SCREEN);
const BEGIN = '// --- BEGIN computeSubOverpayment';
const END = '// --- END computeSubOverpayment ---';
const from = screenSrc.indexOf(BEGIN);
const to = screenSrc.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`\n  ✗ could not find the computeSubOverpayment sentinels in ${SCREEN}.`);
  console.error('    Someone moved or renamed the function; this guard cannot run and');
  console.error('    the overpayment math would go unpinned. Restore the sentinels.');
  process.exit(1);
}
const region = screenSrc.slice(from, to);
const js = new Bun.Transpiler({ loader: 'ts' })
  .transformSync(region)
  .replace(/\bexport\s+function\b/, 'function');
const computeSubOverpayment = new Function(
  `${js}\nreturn computeSubOverpayment;`,
)() as Compute;

console.log('\nSub-invoice overpayment guard (app/sub-portal-setup.tsx):');

// A fully-billed $50,000 commitment: four $10,000 draws already paid, and the
// fifth already APPROVED and sitting under "Mark paid". The trigger has rolled
// all five into paid_to_date.
const paidDraw = (n: number, amount = 10000): Inv =>
  ({ id: `d${n}`, amount, status: 'paid', commitmentId: 'c1' });
const finalDraw: Inv = { id: 'd5', amount: 10000, status: 'approved', commitmentId: 'c1' };
const fullyBilled: Inv[] = [paidDraw(1), paidDraw(2), paidDraw(3), paidDraw(4), finalDraw];

eq('final on-contract draw of a fully-billed commitment does NOT warn',
  computeSubOverpayment({
    invoice: finalDraw,
    commitment: { amount: 50000, paidToDate: 50000 },
    siblings: fullyBilled,
  }),
  null);

// The real overage still fires, with the right number. $43,000 already
// approved + a $12,000 draw against a $50,000 commitment is $5,000 over.
eq('a genuine overage on Mark paid reports $5,000, not $17,000',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 12000, status: 'approved', commitmentId: 'c1' },
    commitment: { amount: 50000, paidToDate: 55000 },
    siblings: [{ id: 'p', amount: 43000, status: 'paid', commitmentId: 'c1' }],
  }),
  { overage: 5000, commitmentTotal: 50000, alreadyApproved: 43000, thisAmount: 12000 });

// The approve path was always correct — the invoice is still 'submitted', so
// the trigger has not counted it and nothing is subtracted.
eq('approve path: submitted invoice is not subtracted out of the rollup',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 10000, status: 'submitted', commitmentId: 'c1' },
    commitment: { amount: 50000, paidToDate: 45000 },
    siblings: [],
  }),
  { overage: 5000, commitmentTotal: 50000, alreadyApproved: 45000, thisAmount: 10000 });

eq('approve path: exactly-on-contract final draw does not warn',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 10000, status: 'submitted', commitmentId: 'c1' },
    commitment: { amount: 50000, paidToDate: 40000 },
    siblings: [],
  }),
  null);

// An approved change order raises the ceiling the guard measures against.
eq('changeAmount raises the ceiling',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 12000, status: 'approved', commitmentId: 'c1' },
    commitment: { amount: 50000, changeAmount: 8000, paidToDate: 55000 },
    siblings: [{ id: 'p', amount: 43000, status: 'paid', commitmentId: 'c1' }],
  }),
  null);

// ── the guard must not fail OPEN when the rollup is stale ───────────────────
// ProjectContext coerces a NULL paid_to_date to 0, so this is what an offline
// approval (queued by supabaseWrite, trigger not yet run) actually looks like.
eq('stale-low rollup does not hide a real overage — local approvals still count',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 10000, status: 'submitted', commitmentId: 'c1' },
    commitment: { amount: 50000, paidToDate: 0 },
    siblings: [
      { id: 'a', amount: 25000, status: 'approved', commitmentId: 'c1' },
      { id: 'b', amount: 20000, status: 'paid', commitmentId: 'c1' },
    ],
  }),
  { overage: 5000, commitmentTotal: 50000, alreadyApproved: 45000, thisAmount: 10000 });

eq('a commitment with no paidToDate at all falls back to the local sum',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 10000, status: 'submitted', commitmentId: 'c1' },
    commitment: { amount: 50000 },
    siblings: [{ id: 'a', amount: 45000, status: 'approved', commitmentId: 'c1' }],
  }),
  { overage: 5000, commitmentTotal: 50000, alreadyApproved: 45000, thisAmount: 10000 });

eq('rollup wins when the server knows invoices this device never cached',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 10000, status: 'submitted', commitmentId: 'c1' },
    commitment: { amount: 50000, paidToDate: 45000 },
    siblings: [{ id: 'a', amount: 1000, status: 'paid', commitmentId: 'c1' }],
  }),
  { overage: 5000, commitmentTotal: 50000, alreadyApproved: 45000, thisAmount: 10000 });

// ── scoping and clamping ────────────────────────────────────────────────────
eq('invoices on OTHER commitments are not counted',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 10000, status: 'submitted', commitmentId: 'c1' },
    commitment: { amount: 50000, paidToDate: 0 },
    siblings: [{ id: 'other', amount: 99000, status: 'paid', commitmentId: 'c2' }],
  }),
  null);

eq('rejected and still-submitted siblings are not counted',
  computeSubOverpayment({
    invoice: { id: 'x', amount: 10000, status: 'submitted', commitmentId: 'c1' },
    commitment: { amount: 50000, paidToDate: 0 },
    siblings: [
      { id: 'r', amount: 45000, status: 'rejected', commitmentId: 'c1' },
      { id: 's', amount: 45000, status: 'submitted', commitmentId: 'c1' },
    ],
  }),
  null);

const clamped = computeSubOverpayment({
  invoice: { id: 'x', amount: 12000, status: 'approved', commitmentId: 'c1' },
  commitment: { amount: 1000, paidToDate: 500 },
  siblings: [],
});
ok('subtracting our own draw never yields a negative "Already approved"',
  clamped !== null && clamped.alreadyApproved === 0 && clamped.overage === 11000,
  JSON.stringify(clamped));

// ── source pin: nothing may re-add the double count ─────────────────────────
ok('the guard still subtracts an already-counted invoice out of paidToDate',
  /countedInRollup\s*\?\s*thisAmount\s*:\s*0/.test(region),
  'The paidToDate rollup already contains approved+paid invoices. Adding\n'
  + '      thisAmount on top of it double-counts the draw being paid.');

// ── finding #29: the "Advance requested" confirmation ───────────────────────
console.log('\nAdvance-interest write (components/home/ReadyToBillCard.tsx):');
const card = read('components/home/ReadyToBillCard.tsx');
const onAdvance = card.slice(card.indexOf('const onAdvance'), card.indexOf('if (ready.count === 0)'));
ok('onAdvance body was located', onAdvance.length > 0);

ok('the upsert result is checked, not discarded',
  /const\s*\{\s*error\s*\}\s*=\s*await\s+supabase[\s\S]*?\.upsert\(/.test(onAdvance),
  'supabase-js resolves on a PostgREST error. feature_interest has no UPDATE\n'
  + '      policy, so the ON CONFLICT DO UPDATE arm is denied on the second tap —\n'
  + '      a discarded result showed "Advance requested" for a row that does not exist.');

ok('a PostgREST error aborts before the success alert',
  /if\s*\(error\)\s*throw error;/.test(onAdvance));

ok('the upsert resolves conflicts with DO NOTHING, not DO UPDATE',
  /ignoreDuplicates:\s*true/.test(onAdvance),
  'feature_interest has no UPDATE RLS policy (20260512000000_feature_interest.sql),\n'
  + '      so ON CONFLICT DO UPDATE is denied from the second tap onward. The row\n'
  + '      carries nothing an update could change — use DO NOTHING.');

ok('a null user (expired session) aborts instead of skipping the write silently',
  /if\s*\(!user\)\s*throw /.test(onAdvance)
  && !/if\s*\(user\)\s*\{/.test(onAdvance),
  'The old `if (user) { ...write... }` fell through to setAdvanceState(\'done\')\n'
  + '      and the success alert with no row written and no way to retry.');

ok('failure returns the button to idle so the GC can retry',
  /catch[\s\S]*setAdvanceState\('idle'\)/.test(onAdvance));

const iErr = onAdvance.indexOf('if (error) throw error;');
const iUser = onAdvance.indexOf('if (!user) throw');
const iAlert = onAdvance.indexOf("'Advance requested'");
ok('the success alert is only reachable after the write succeeded',
  iErr >= 0 && iUser >= 0 && iAlert > iErr && iAlert > iUser,
  `error-guard@${iErr} user-guard@${iUser} alert@${iAlert}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
