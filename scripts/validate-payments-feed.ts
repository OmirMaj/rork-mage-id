// scripts/validate-payments-feed.ts — the Payments dashboard's money.
//
// WHY THIS EXISTS (runtime audit 2026-09-06, MONEY-01). Two independent lies
// met on app/payments.tsx, both visible in 12_payments.png:
//
//   1. `methodToProvider` mapped EVERY `method: 'credit_card'` to provider
//      'stripe', and the row was then docked 2.9% + 30¢ Stripe processing AND
//      the tier platform fee. The founder's only real payment — $48,826.93,
//      hand-keyed on an invoice whose `pay_link_url` is NULL, so MAGE never
//      minted a link and charged no platform fee — was docked $1,660.41
//      (including $244.13 of MAGE fee that was never charged) and badged
//      "Stripe". The same switch had no 'stripe' case at all, so a payment the
//      webhook really did record (it writes `method: 'stripe'` and a
//      `stripe-<session>` ledger id) fell through to default and was badged
//      "Check". Verified read-only against production before the fix.
//   2. The hero tile summed `netAmount` (gross − those invented fees) while the
//      row two lines below rendered gross and the fee tile showed the fee a
//      third time. The headline "Received" — $47,167 — tied to nothing: not the
//      rows, not the invoice's Amount Paid ($48,826.93), not the bank.
//
// THE RULES PINNED HERE:
//   · A row is Stripe-processed only when the ledger entry carries the
//     webhook's own marker. A hand-keyed card is "Card", gets NO fee estimate,
//     and the screen states that its processor fee is unknown.
//   · "Received" is gross cash recorded against invoices, net of refunds and
//     lost chargebacks — the sum of exactly the rows the Completed tab renders.
//
// The cases below execute the SHIPPED functions: the source is extracted from
// app/payments.tsx between its sentinel comments and transpiled, because that
// file is an Expo Router route and cannot be imported outside Metro (same
// technique as scripts/validate-sub-overpayment.ts). `invoiceOutstanding` and
// `estimateNetAfterFees` are injected from their real modules, so the retention
// rule and the fee schedule under test are the ones that ship too.
//
// Run via: bun run scripts/validate-payments-feed.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoiceOutstanding, pendingRetentionHeld } from '../utils/invoiceBilling';
import { estimateNetAfterFees } from '../utils/platformFees';

// Declared locally rather than pulled from `bun-types`: this repo has no bun
// type package installed, and without this `npx tsc --noEmit` fails with
// TS2867 "Cannot find name 'Bun'". Same pattern as
// scripts/validate-sub-overpayment.ts:50.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
type Row = {
  id: string;
  invoiceId?: string;
  projectId: string;
  projectName: string;
  clientName: string;
  amount: number;
  fee: number;
  netAmount: number;
  provider: string;
  processedByMage: boolean;
  retentionHeld: number;
  status: string;
  description: string;
  createdAt: string;
  completedAt?: string;
};
type Summary = {
  received: number;
  pending: number;
  pendingRetentionHeld: number;
  totalFees: number;
  unknownFeeCount: number;
  failedCount: number;
};
type Feed = {
  derivePayments: (p: unknown[], i: unknown[], c: unknown[], tier: string) => Row[];
  summarizePayments: (rows: Row[]) => Summary;
  isSettledRow: (row: Row) => boolean;
  isPendingRow: (row: Row) => boolean;
  isMageProcessed: (entry: Record<string, unknown>) => boolean;
  feedProviderFor: (entry: Record<string, unknown>) => string;
};

const SCREEN = 'app/payments.tsx';
const screenSrc = readFileSync(join(ROOT, SCREEN), 'utf8');
const BEGIN = '// --- BEGIN payments feed';
const END = '// --- END payments feed ---';
const from = screenSrc.indexOf(BEGIN);
const to = screenSrc.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`\n  ✗ could not find the payments-feed sentinels in ${SCREEN}.`);
  console.error('    Someone moved or renamed the region; this guard cannot run and the');
  console.error('    Received / fee math would go unpinned. Restore the sentinels.');
  process.exit(1);
}
const js = new Bun.Transpiler({ loader: 'ts' })
  .transformSync(screenSrc.slice(from, to).replace(/^export /gm, ''));
const feed = new Function(
  'invoiceOutstanding', 'pendingRetentionHeld', 'estimateNetAfterFees',
  `${js}\nreturn { derivePayments, summarizePayments, isSettledRow, isPendingRow, isMageProcessed, feedProviderFor };`,
)(invoiceOutstanding, pendingRetentionHeld, estimateNetAfterFees) as Feed;

const {
  derivePayments, summarizePayments, isSettledRow, isPendingRow, isMageProcessed, feedProviderFor,
} = feed;

console.log('\nPayments feed (app/payments.tsx):');

const project = { id: 'p1', name: 'The Henderson Residence' };
const projects = [project];
const contacts: unknown[] = [];
const invoice = (over: Record<string, unknown>) => ({
  id: 'i1', number: 1, projectId: 'p1', issueDate: '2026-05-01T00:00:00.000Z',
  status: 'paid', totalDue: 48698.05, amountPaid: 48826.93, payments: [], ...over,
});

// ── 1. The founder's real row: a card MAGE never touched ────────────────────
{
  // Verbatim from production: invoices.payments on The Henderson Residence #1.
  const handKeyedCard = {
    id: 'e6a78fde-1854-482f-9d1f-a89c4ac6e6cc',
    date: '2026-05-07T02:18:30.449Z',
    amount: 48826.93,
    method: 'credit_card',
  };
  const rows = derivePayments(projects, [invoice({ payments: [handKeyedCard] })], contacts, 'pro');
  eq('one settled row', rows.length, 1);
  eq('a hand-keyed card is NOT badged Stripe', rows[0].provider, 'card');
  eq('…and is not treated as MAGE-processed', rows[0].processedByMage, false);
  eq('no fee is invented for a card MAGE did not run', [rows[0].fee, rows[0].netAmount], [0, 48826.93]);
  ok('the row says the card was recorded by hand',
    rows[0].description.includes('recorded by hand'), rows[0].description);

  const stats = summarizePayments(rows);
  // The number the screen printed before the fix was $47,166.52.
  eq('Received is the money that actually came in, not gross − invented fees',
    stats.received, 48826.93);
  eq('no MAGE / Stripe fee is claimed', stats.totalFees, 0);
  eq('the unknown processor fee is COUNTED so the screen can say so',
    stats.unknownFeeCount, 1);
}

// ── 2. A payment the Stripe webhook really did record ───────────────────────
{
  // What supabase/functions/stripe-webhook/index.ts writes into the ledger.
  const stripeEntry = {
    id: 'stripe-cs_test_123', amount: 10000, method: 'stripe', kind: 'payment',
    date: '2026-06-01T00:00:00.000Z', receivedAt: '2026-06-01T00:00:00.000Z',
  };
  const rows = derivePayments(
    projects, [invoice({ payments: [stripeEntry], amountPaid: 10000 })], contacts, 'pro',
  );
  eq('the webhook marker IS recognised as Stripe', rows[0].provider, 'stripe');
  eq('…as MAGE-processed (the old switch had no stripe case and badged it "Check")',
    rows[0].processedByMage, true);
  // pro = 30 bps platform + 2.9% + 30¢ Stripe = 30 + 290.30.
  eq('the fee is the ONE schedule in utils/platformFees.ts', rows[0].fee, 320.3);
  eq('netAmount stays available as the estimate it is', rows[0].netAmount, 9679.7);
  eq('Received is still the gross, whatever the fee', summarizePayments(rows).received, 10000);
  eq('the estimated fee is reported in its own tile', summarizePayments(rows).totalFees, 320.3);

  // A card keyed in by hand on an invoice that ALSO has a live pay link is
  // still hand-keyed — the link proves nothing about this record.
  const mixed = derivePayments(projects, [invoice({
    payLinkUrl: 'https://buy.stripe.com/test', status: 'partially_paid', amountPaid: 100,
    payments: [{ id: 'uuid-1', amount: 100, method: 'credit_card', date: '2026-06-02T00:00:00.000Z' }],
  })], contacts, 'pro');
  eq('a live pay link does not make a hand-keyed card a Stripe payment',
    mixed.filter(isSettledRow)[0].provider, 'card');
}

// ── 3. Refunds and lost chargebacks are money going OUT ─────────────────────
{
  const rows = derivePayments(projects, [invoice({
    payments: [
      { id: 'stripe-cs_1', amount: 10000, method: 'stripe', kind: 'payment', date: '2026-06-01T00:00:00.000Z' },
      { id: 'stripe-refund-re_1', amount: -2000, method: 'stripe', kind: 'refund', date: '2026-06-05T00:00:00.000Z' },
      { id: 'stripe-dispute-du_1', amount: -500, method: 'stripe', kind: 'dispute', date: '2026-06-06T00:00:00.000Z' },
    ],
    amountPaid: 7500,
  })], contacts, 'pro');
  eq('a refund is not shown as a completed payment',
    rows.map(r => r.status), ['refunded', 'refunded', 'completed']);
  eq('reversals carry no fee estimate', rows.filter(r => r.amount < 0).every(r => r.fee === 0), true);
  eq('Received is the cash actually kept', summarizePayments(rows).received, 7500);
  ok('a chargeback row says chargeback',
    rows.some(r => r.description.includes('chargeback')));
}

// ── 4. THE INVARIANT: the hero equals the sum of its own rows ───────────────
{
  const rows = derivePayments(projects, [
    invoice({
      id: 'i1', number: 1, status: 'paid', amountPaid: 48826.93,
      payments: [{ id: 'u1', amount: 48826.93, method: 'credit_card', date: '2026-05-07T00:00:00.000Z' }],
    }),
    invoice({
      id: 'i2', number: 2, status: 'partially_paid', totalDue: 100000, amountPaid: 10000,
      payments: [{ id: 'stripe-cs_2', amount: 10000, method: 'stripe', date: '2026-06-01T00:00:00.000Z' }],
      retentionAmount: 5000, retentionReleased: 0,
    }),
    invoice({ id: 'i3', number: 3, status: 'draft', totalDue: 9000, amountPaid: 0, payments: [] }),
  ], contacts, 'business');

  const stats = summarizePayments(rows);
  const settled = rows.filter(isSettledRow);
  const pending = rows.filter(isPendingRow);
  const sum = (list: Row[], pick: (r: Row) => number) =>
    Math.round(list.reduce((s, r) => s + pick(r), 0) * 100) / 100;

  eq('hero Received === the sum of the amounts the Completed tab renders',
    stats.received, sum(settled, r => r.amount));
  eq('hero Pending === the sum of the amounts the Pending tab renders',
    stats.pending, sum(pending, r => r.amount));
  eq('every row is in exactly one tab',
    rows.filter(r => isSettledRow(r) === isPendingRow(r)).length, 0);
  // The old hero summed netAmount; with a real Stripe fee on the ledger the two
  // differ, which is precisely why the headline never tied to the list.
  ok('Received is NOT the net-of-fees figure', stats.received !== sum(settled, r => r.netAmount));
  eq('a draft invoice is not on the payments feed',
    rows.some(r => r.invoiceId === 'i3'), false);
  // MONEY-F5: the balance the client can be asked for excludes held retention,
  // and the screen states the amount it excluded rather than hiding it.
  eq('Pending is net of retention and the held amount is reported',
    [stats.pending, stats.pendingRetentionHeld], [85000, 5000]);
}

// ── 5. What the feed does with data it does not fully know ──────────────────
{
  const rows = derivePayments(projects, [invoice({
    payments: [
      // Seeded/legacy rows carry receivedAt and no `date` — the old code put
      // `undefined` in createdAt, which rendered "Invalid Date" and sorted NaN.
      { id: 's1', amount: 50000, method: 'check', receivedAt: '2026-07-24T15:37:28.734Z' },
      // No method at all: say "recorded", do not guess a rail.
      { id: 's2', amount: 1000, date: '2026-07-25T00:00:00.000Z' },
      // Unparseable date → fall back to the invoice's issue date, never NaN.
      { id: 's3', amount: 25, method: 'cash', date: 'not-a-date' },
    ],
    amountPaid: 51025,
  })], contacts, 'free');
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  eq('receivedAt is used when the entry has no date', byId.s1.createdAt, '2026-07-24T15:37:28.734Z');
  eq('a check is a check', byId.s1.provider, 'check');
  eq('an unknown method is not guessed into one', byId.s2.provider, 'other');
  eq('an unparseable date falls back to the issue date', byId.s3.createdAt, '2026-05-01T00:00:00.000Z');
  ok('no row carries an invalid date', rows.every(r => !Number.isNaN(new Date(r.createdAt).getTime())));
  eq('the totals still foot', summarizePayments(rows).received, 51025);
  eq('free tier: no platform fee, and none of these went through MAGE anyway',
    summarizePayments(rows).totalFees, 0);
}

// ── 6. Pending rows ─────────────────────────────────────────────────────────
{
  const noLink = derivePayments(projects, [invoice({
    status: 'sent', totalDue: 76780, amountPaid: 0, payments: [],
  })], contacts, 'pro');
  eq('an unpaid invoice with no pay link is not badged as a rail we guessed',
    noLink[0].provider, 'other');
  eq('…and carries no fee estimate, because nothing has been minted',
    noLink[0].fee, 0);

  const withLink = derivePayments(projects, [invoice({
    status: 'sent', totalDue: 76780, amountPaid: 0, payments: [],
    payLinkUrl: 'https://buy.stripe.com/test',
  })], contacts, 'pro');
  eq('a live MAGE link is the one pending case whose fee schedule we DO know',
    [withLink[0].provider, withLink[0].fee > 0], ['stripe', true]);

  eq('a payment on an invoice whose project is gone is skipped, not crashed',
    derivePayments([], [invoice({ payments: [{ id: 'x', amount: 1, method: 'cash' }] })], contacts, 'pro').length,
    0);
}

// ── 7. The classifiers themselves ───────────────────────────────────────────
{
  eq('method stripe → MAGE-processed', isMageProcessed({ method: 'stripe' }), true);
  eq('a stripe- ledger id → MAGE-processed', isMageProcessed({ id: 'stripe-cs_1' }), true);
  eq('a uuid credit_card entry is NOT MAGE-processed',
    isMageProcessed({ id: 'e6a78fde-1854-482f-9d1f-a89c4ac6e6cc', method: 'credit_card' }), false);
  eq('an empty entry is not MAGE-processed', isMageProcessed({}), false);
  eq('credit_card maps to Card, never Stripe', feedProviderFor({ method: 'credit_card' }), 'card');
  eq('ach and cash keep their own rails',
    [feedProviderFor({ method: 'ach' }), feedProviderFor({ method: 'cash' })], ['ach', 'cash']);
}

// ── 8. Source guards — the two shapes that caused this ──────────────────────
{
  const stripped = screenSrc
    .split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  eq('nothing maps credit_card to the stripe provider again',
    /case\s*'credit_card'\s*:\s*return\s*'stripe'/.test(stripped), false);
  eq('the hero no longer sums netAmount',
    /received[\s\S]{0,120}netAmount/.test(stripped), false);
}

console.log(`\nvalidate-payments-feed: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
