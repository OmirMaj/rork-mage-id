// scripts/validate-money-desk.ts — the Payments desk, the lien-waiver log and
// the invoice-lines register (wave 6d, lane M2) never show a number the phone
// cards, the A/R report or the invoice's totals card do not.
//
// WHAT IS PROVED
//   (a) paymentsArBuckets: Σ(Current … 90+) === summarizePayments().pending,
//       to the cent, over 300 random invoice sets — with ≤ $0.50 balances (the
//       aging report skips them; the feed does not), retention held, invoices
//       the report does not know, refunds and every status.
//   (b) paymentsFooter: the Completed footer's Amount === Received, its Fee ===
//       the fee tile, its Net === Received − those fees; the Pending footer ===
//       Pending; the All tab carries NO Amount sum. The Net and Fee cells of a
//       hand-keyed card are '—' / 'Unknown'; Applied to names the invoice.
//   (e) invoice lines: the register's Billed footer IS the `subtotal`
//       identifier (source pin), and Σ billedAmountForLine is within 1¢ × lines
//       of it (executed, random progress / pre-scaled / full invoices).
//   (f) source pins: the payments feed's sentinel block is byte-identical to
//       the base (hash); the lien pins; no Wisetack on the invoice; the logs'
//       bulk handlers write through updateInvoice / updateRFI, never
//       supabase.from.
//   (Parts c and d — the bulk Mark sent / Close patches — live in lane V3's
//   scripts/validate-log-bulk.ts.)
//
// The feed is EXECUTED: app/payments.tsx is an Expo Router route that cannot be
// imported outside Metro, so its sentinel block is extracted and transpiled
// exactly as scripts/validate-payments-feed.ts does, with the real
// invoiceOutstanding / estimateNetAfterFees injected.
//
// Run via: bun run scripts/validate-money-desk.ts   (package.json test:money-desk)

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoiceOutstanding, pendingRetentionHeld, billedAmountForLine, progressSubtotal, roundCents } from '../utils/invoiceBilling';
import { estimateNetAfterFees } from '../utils/platformFees';
import { paymentReceivedAt } from '../utils/billingFlowCore';
import { dayOrInstantDate } from '../utils/calendarDate';
import { computeARAgingReport } from '../utils/financialReports';
import { PROVIDER_INFO } from '../mocks/payments';
import {
  paymentsArBuckets, paymentsFooter, paymentAppliedLabel, paymentFeeCell, paymentNetCell,
  PAYMENTS_CSV_COLUMNS, PAYMENT_METHOD_LABEL, PAYMENTS_AR_BUCKET_KEYS, type PaymentDeskRow,
} from '../utils/paymentsDesk';
import type { Invoice, Project } from '../types';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments removed, so a comment can never satisfy a code check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// ── the shipped feed ────────────────────────────────────────────────────────
type Row = PaymentDeskRow & { retentionHeld: number };
type Summary = { received: number; pending: number; pendingRetentionHeld: number; totalFees: number; unknownFeeCount: number; failedCount: number };
const PAYMENTS = 'app/payments.tsx';
const paySrc = read(PAYMENTS);
const BEGIN = '// --- BEGIN payments feed';
const END = '// --- END payments feed ---';
const from = paySrc.indexOf(BEGIN);
const to = paySrc.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`\n  ✗ could not find the payments-feed sentinels in ${PAYMENTS}.`);
  process.exit(1);
}
const feedJs = new Bun.Transpiler({ loader: 'ts' }).transformSync(paySrc.slice(from, to).replace(/^export /gm, ''));
const feed = new Function(
  'invoiceOutstanding', 'pendingRetentionHeld', 'estimateNetAfterFees', 'paymentReceivedAt', 'dayOrInstantDate',
  `${feedJs}\nreturn { derivePayments, summarizePayments, isPendingRow, isSettledRow };`,
)(invoiceOutstanding, pendingRetentionHeld, estimateNetAfterFees, paymentReceivedAt, dayOrInstantDate) as {
  derivePayments: (p: unknown[], i: unknown[], c: unknown[], tier: string) => Row[];
  summarizePayments: (rows: Row[]) => Summary;
  isPendingRow: (r: Row) => boolean;
  isSettledRow: (r: Row) => boolean;
};

// Seeded PRNG so a failure is reproducible.
let seed = 0x6d2d;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const cents = (max: number) => Math.round(rnd() * max * 100) / 100;

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (daysFromNow: number) => new Date(NOW + daysFromNow * DAY).toISOString();

function randomWorld(): { projects: Project[]; invoices: Invoice[] } {
  const projects = [{ id: 'p1', name: 'Harlow' }, { id: 'p2', name: 'Okafor' }] as unknown as Project[];
  const n = 1 + Math.floor(rnd() * 9);
  const invoices: Invoice[] = [];
  for (let i = 0; i < n; i++) {
    const subtotal = pick([cents(50000), 0.3, 0.5, 0.51, 1, cents(900)]);
    const retentionPercent = rnd() < 0.35 ? pick([5, 10]) : undefined;
    const totalDue = subtotal;
    const style = pick(['unpaid', 'partial', 'nearlyPaid', 'paid', 'overpaid']);
    const net = Math.max(0, totalDue - (retentionPercent ? roundCents(subtotal * retentionPercent / 100) : 0));
    const amountPaid = style === 'unpaid' ? 0
      : style === 'partial' ? cents(net)
        : style === 'nearlyPaid' ? Math.max(0, roundCents(net - pick([0.01, 0.3, 0.49, 0.5, 0.51])))
          : style === 'paid' ? net : roundCents(net + 5);
    const payments: Record<string, unknown>[] = amountPaid > 0
      ? [{ id: rnd() < 0.5 ? `stripe-cs_${i}` : `u-${i}`, amount: amountPaid, method: pick(['stripe', 'credit_card', 'check', 'ach', 'cash']), date: iso(-Math.floor(rnd() * 90)) }]
      : [];
    if (rnd() < 0.1 && amountPaid > 1) payments.push({ id: `stripe-refund-${i}`, amount: -1, method: 'stripe', date: iso(-2), kind: 'refund' });
    invoices.push({
      id: `i${i}`,
      number: i + 1,
      // An invoice on a project the user does not have: the feed skips it; the
      // report would list it — the buckets must follow the FEED.
      projectId: rnd() < 0.08 ? 'p-gone' : pick(['p1', 'p2']),
      type: 'full',
      issueDate: iso(-Math.floor(rnd() * 200)),
      dueDate: iso(-Math.floor(rnd() * 200) + 30),
      paymentTerms: 'net_30',
      notes: '',
      lineItems: [],
      subtotal,
      taxRate: 0,
      taxAmount: 0,
      totalDue,
      amountPaid,
      retentionPercent,
      status: pick(['draft', 'sent', 'partially_paid', 'overdue', 'paid']),
      payments,
      payLinkUrl: rnd() < 0.4 ? 'https://pay.example/x' : undefined,
      createdAt: iso(-200),
      updatedAt: iso(-1),
    } as unknown as Invoice);
  }
  return { projects, invoices };
}

// ════════════════════════════════════════════════════════════════════════════
// (a) Σ aging buckets === Pending, to the cent
// ════════════════════════════════════════════════════════════════════════════
console.log('\n(a) paymentsArBuckets reconciles to Pending:');
{
  let bad = '';
  let sawTiny = 0, sawRetention = 0, sawUnknown = 0, sawAged = 0;
  for (let t = 0; t < 300 && !bad; t++) {
    const { projects, invoices } = randomWorld();
    const rows = feed.derivePayments(projects, invoices, [], pick(['free', 'pro', 'business', 'enterprise']));
    const stats = feed.summarizePayments(rows);
    // Sometimes the report is a step behind the feed (an invoice it does not
    // know): those rows must count as current, not vanish.
    const known = rnd() < 0.3 ? invoices.slice(0, Math.max(0, invoices.length - 1)) : invoices;
    const aging = computeARAgingReport(known, projects);
    const pending = rows.filter(feed.isPendingRow);
    const ar = paymentsArBuckets(pending, aging.rows);
    const sum = roundCents(PAYMENTS_AR_BUCKET_KEYS.reduce((s, k) => s + ar[k], 0));
    const count = PAYMENTS_AR_BUCKET_KEYS.reduce((s, k) => s + ar.counts[k], 0);
    sawTiny += pending.filter(p => p.amount > 0 && p.amount <= 0.5).length;
    sawRetention += pending.filter(p => p.retentionHeld > 0).length;
    sawUnknown += pending.filter(p => !aging.rows.some(r => r.invoiceId === p.invoiceId)).length;
    sawAged += ar.counts.d1_30 + ar.counts.d31_60 + ar.counts.d61_90 + ar.counts.d90p;
    if (sum !== stats.pending || ar.total !== stats.pending || !ar.reconciles || count !== pending.length) {
      bad = `trial ${t}: Σ buckets ${sum} / total ${ar.total} vs Pending ${stats.pending}; reconciles ${ar.reconciles}; count ${count}/${pending.length}`;
    }
  }
  ok('300 random invoice sets: Σ(Current … 90+) === Pending, every bucket in whole cents, one count per pending row', !bad, bad);
  ok(`…the sets covered ≤ $0.50 balances (${sawTiny}), retention held (${sawRetention}), invoices the report does not know (${sawUnknown}) and past-due buckets (${sawAged})`,
    sawTiny > 0 && sawRetention > 0 && sawUnknown > 0 && sawAged > 0);

  // Direct cases.
  const rows = [
    { invoiceId: 'a', amount: 100.1 }, { invoiceId: 'b', amount: 0.2 }, { invoiceId: 'c', amount: 50.05 }, { amount: 7 },
  ];
  const ar = paymentsArBuckets(rows, [
    { invoiceId: 'a', bucket: '31-60' }, { invoiceId: 'c', bucket: '90+' },
  ]);
  ok('a row the report skipped (≤ $0.50) or cannot name is current; a listed one takes its bucket',
    ar.current === 7.2 && ar.d31_60 === 100.1 && ar.d90p === 50.05 && ar.d1_30 === 0 && ar.counts.current === 2 && ar.total === 157.35 && ar.reconciles,
    JSON.stringify(ar));
  ok('an empty feed is all zeroes and reconciles', JSON.stringify(paymentsArBuckets([], [])) === JSON.stringify({
    current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0, counts: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 }, total: 0, reconciles: true,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// (b) the register footer and cells
// ════════════════════════════════════════════════════════════════════════════
console.log('\n(b) paymentsFooter and the cells:');
{
  let bad = '';
  for (let t = 0; t < 300 && !bad; t++) {
    const { projects, invoices } = randomWorld();
    const rows = feed.derivePayments(projects, invoices, [], pick(['free', 'pro', 'business', 'enterprise']));
    const stats = feed.summarizePayments(rows);
    const settled = rows.filter(feed.isSettledRow);
    const completed = paymentsFooter('completed', settled, stats);
    const pendingF = paymentsFooter('pending', rows.filter(feed.isPendingRow), stats);
    const all = paymentsFooter('all', rows, stats);
    const netWant = roundCents(stats.received - stats.totalFees);
    const colSum = roundCents(settled.reduce((s, r) => s + r.amount, 0));
    if (completed.amount !== stats.received || completed.amount !== colSum) bad = `trial ${t}: Completed ${completed.amount} vs Received ${stats.received} / rows ${colSum}`;
    else if (completed.fee !== stats.totalFees) bad = `trial ${t}: fee ${completed.fee} vs ${stats.totalFees}`;
    else if (completed.net !== netWant) bad = `trial ${t}: net ${completed.net} vs ${netWant}`;
    else if (pendingF.amount !== stats.pending || pendingF.fee !== undefined) bad = `trial ${t}: Pending footer ${JSON.stringify(pendingF)} vs ${stats.pending}`;
    else if (all.amount !== undefined || all.fee !== undefined || all.net !== undefined || !all.job) bad = `trial ${t}: All footer ${JSON.stringify(all)}`;
  }
  ok('300 random sets: Completed footer Amount === Received === Σ its rows; Fee === the fee tile; Net === Received − fees', !bad, bad);
  ok('…Pending footer === Pending; the All tab has no Amount / Fee / Net sum', !bad, bad);
  ok('the All footer names both totals, to the cent',
    paymentsFooter('all', [], { received: 48826.93, pending: 1200.5, totalFees: 0 }).job === 'Received $48,826.93 · Pending $1,200.50');

  const card: Row = { id: 'c', invoiceId: 'i1', projectId: 'p', projectName: 'P', clientName: 'C', amount: 3000, fee: 0, netAmount: 3000, provider: 'card', processedByMage: false, status: 'completed', description: '', createdAt: '', retentionHeld: 0 };
  const stripe: Row = { ...card, id: 's', provider: 'stripe', processedByMage: true, fee: 96.3, netAmount: 2903.7 };
  const check: Row = { ...card, id: 'k', provider: 'check' };
  ok('a hand-keyed card: Net is \'—\', Fee is \'Unknown\'', paymentNetCell(card) === '—' && paymentFeeCell(card) === 'Unknown');
  ok('a Stripe row: Fee and Net in cents', paymentFeeCell(stripe) === '$96.30' && paymentNetCell(stripe) === '$2,903.70');
  ok('a check: no fee (\'—\'), Net is the amount', paymentFeeCell(check) === '—' && paymentNetCell(check) === '$3,000.00');
  const nums = new Map([['i1', 12]]);
  ok('Applied to: settled → "#12", pending → "Owed on #12", an unknown invoice → null',
    paymentAppliedLabel(card, nums) === '#12' && paymentAppliedLabel({ ...card, status: 'refunded' }, nums) === '#12'
    && paymentAppliedLabel({ ...card, status: 'pending' }, nums) === 'Owed on #12'
    && paymentAppliedLabel({ ...card, invoiceId: 'nope' }, nums) === null && paymentAppliedLabel({ ...card, invoiceId: undefined }, nums) === null);
  const csv = (r: Row, key: string) => PAYMENTS_CSV_COLUMNS.find(c => c.key === key)!.csvValue(r);
  ok('CSV: an unknown fee / net is an EMPTY cell, never 0; money is a plain number',
    csv(card, 'fee') === null && csv(card, 'net') === null && csv(stripe, 'fee') === 96.3 && csv(stripe, 'net') === 2903.7 && csv(check, 'fee') === 0);
  // The CSV's method words are the feed's (FEED_PROVIDER_LABEL + PROVIDER_INFO).
  const feedLabels = /const FEED_PROVIDER_LABEL: Record<string, string> = \{\s*card: 'Card',\s*other: 'Recorded',\s*\};/.test(paySrc);
  const brandSame = Object.entries(PROVIDER_INFO).every(([k, v]) => PAYMENT_METHOD_LABEL[k] === v.label);
  ok('CSV Method labels are the feed\'s own (Card, Recorded, and every PROVIDER_INFO label)',
    feedLabels && brandSame && PAYMENT_METHOD_LABEL.card === 'Card' && PAYMENT_METHOD_LABEL.other === 'Recorded');

  // The screen reads these, not a figure of its own.
  const ps = code(paySrc);
  ok('payments.tsx: the aging comes from computeARAgingReport over the same invoices + projects',
    /const aging = useMemo\(\(\) => computeARAgingReport\(invoices, projects\), \[invoices, projects\]\);/.test(ps));
  ok('…the buckets from paymentsArBuckets over the feed\'s pending rows',
    /const ar = useMemo\(\(\) => paymentsArBuckets\(payments\.filter\(isPendingRow\), aging\.rows\), \[payments, aging\]\);/.test(ps));
  ok('…the KPI Received / Pending / fees are stats.received / stats.pending / stats.totalFees',
    /key: 'received', label: 'Received', value: formatMoney\(stats\.received, 2\)/.test(ps)
    && /key: 'pending',\s*label: 'Pending',\s*value: formatMoney\(stats\.pending, 2\)/.test(ps)
    && /key: 'fees', label: 'Est\. fees', value: formatMoney\(stats\.totalFees, 2\)/.test(ps));
  ok('…the Pending cell says so when the buckets do not reconcile',
    /!ar\.reconciles\s*\?\s*'A\/R buckets differ from Pending — see Reports'/.test(ps));
  ok('…the footer is paymentsFooter(selectedTab, filtered, stats)', /paymentsFooter\(selectedTab, filtered, stats\)/.test(ps));
  const table = ps.slice(ps.indexOf('<DataTable<PaymentRow>'), ps.indexOf('/>', ps.indexOf('renderCard=', ps.indexOf('<DataTable<PaymentRow>'))));
  ok('…the register has NO searchText (the footers are tab totals)', !!table && !/searchText/.test(table), table.slice(0, 80));
  ok('…its rows link to the invoice (getRowHref → routeHref(\'/invoice\', …))',
    /getRowHref=\{p => routeHref\('\/invoice', \{ projectId: p\.projectId, invoiceId: p\.invoiceId \?\? '' \}\)\}/.test(table));
}

// ════════════════════════════════════════════════════════════════════════════
// (e) invoice lines: Billed footer === the totals card's subtotal
// ════════════════════════════════════════════════════════════════════════════
console.log('\n(e) invoice lines:');
{
  const inv = code(read('app/invoice.tsx'));
  ok('the Billed footer is the `subtotal` identifier (the totals card figure), never a re-sum',
    /if \(isProgressType\) out\.billed = formatCurrency\(subtotal\);/.test(inv));
  ok('…and `subtotal` is still roundCents(progressSubtotal(lineItems, isProgressType, pctValue))',
    /const subtotal = useMemo\(\s*\(\) => roundCents\(progressSubtotal\(lineItems, isProgressType, pctValue\)\),/.test(inv));
  ok('…the per-line Billed cell is billedAmountForLine with the screen\'s percent',
    /formatCurrency\(billedAmountForLine\(li, \{ type: 'progress', progressPercent: pctValue \}, anyPreScaledLine\)\)/.test(inv));
  ok('…the Line total footer is roundCents(Σ li.total)',
    /const lineTotal = roundCents\(lineItems\.reduce\(\(sum, li\) => sum \+ \(li\.total \|\| 0\), 0\)\);/.test(inv) && /total: formatCurrency\(lineTotal\)/.test(inv));
  const table = inv.slice(inv.indexOf('<DataTable<InvoiceLineItem>'), inv.indexOf('renderCard=', inv.indexOf('<DataTable<InvoiceLineItem>')));
  ok('…READ-ONLY: the table has no editable cell and its hotkeys are off (it shares a page with InvoiceLog)',
    !!table && /hotkeys=\{false\}/.test(table) && !/TextInput|onChangeText/.test(table));
  ok('…bulk Remove says why when the invoice is locked', /disabledReason: isLocked \? 'Sent invoices are locked — void and reissue to change lines\.' : null/.test(inv));
  ok('…the invoice.totals TutorialTarget still directly follows the Line Items section',
    /<\/View>\s*\{\/\* The wrapper carries the card's outer margins[\s\S]{0,200}\*\/\}\s*<TutorialTarget id="invoice\.totals" style=\{styles\.totalsTarget\}>/.test(read('app/invoice.tsx')));

  let bad = '';
  for (let t = 0; t < 300 && !bad; t++) {
    const n = 1 + Math.floor(rnd() * 12);
    const preScaled = rnd() < 0.25;
    const isProgress = rnd() < 0.7;
    const pct = pick([0, 12.5, 25, 33.333, 50, 66.67, 100, 7]);
    const lines = Array.from({ length: n }, () => {
      const qty = pick([1, 3, 7, 12.5, 0.333]);
      const unit = cents(900);
      return { total: roundCents(qty * unit), billedPercent: preScaled && rnd() < 0.7 ? pick([25, 50, 100]) : undefined };
    });
    const anyPre = lines.some(l => l.billedPercent != null);
    const subtotal = roundCents(progressSubtotal(lines, isProgress, pct));
    if (!isProgress) continue; // the Billed column shows only on a progress invoice
    const cells = lines.reduce((s, li) => s + roundCents(billedAmountForLine(li, { type: 'progress', progressPercent: pct }, anyPre)), 0);
    if (Math.abs(roundCents(cells) - subtotal) > 0.01 * n + 1e-9) bad = `trial ${t}: Σ cells ${roundCents(cells)} vs subtotal ${subtotal} (${n} lines, ${pct}%, preScaled ${anyPre})`;
  }
  ok('300 random progress invoices: Σ per-line Billed cells is within 1¢ × lines of the subtotal', !bad, bad);
}

// ════════════════════════════════════════════════════════════════════════════
// (f) source pins
// ════════════════════════════════════════════════════════════════════════════
console.log('\n(f) source pins:');
{
  const block = paySrc.slice(from, to + END.length);
  const hash = createHash('sha256').update(block).digest('hex');
  ok('payments: the feed\'s sentinel block is byte-identical to the base (439e119a)',
    hash === 'aa16270ed02531b47afdf2d914da58ff44646bb7b385a584f8edc47c596e4f9d', hash);

  const lw = read('app/lien-waivers.tsx');
  const lwc = code(lw);
  ok('lien: "No waivers yet" still renders only when the read did not fail, once',
    lwc.includes('{!loading && !loadError && waivers.length === 0 && (') && (lwc.match(/No waivers yet/g) ?? []).length === 1);
  ok('lien: pull-to-refresh and the access gate view are kept',
    lw.includes('refreshControl={<RefreshControl') && /function LienWaiverGateView\(/.test(lw));
  ok('lien: the phone list keeps onMarkVoid={() => { void handleVoid(w); }}', lw.includes('onMarkVoid={() => { void handleVoid(w); }}'));
  // The record pane gets the SAME props the phone card does — no new write path.
  const detailAt = lwc.indexOf('detail={openWaiver ? (');
  const detail = detailAt < 0 ? '' : lwc.slice(detailAt, lwc.indexOf(') : null}', detailAt));
  const PROPS = ['exporting={exporting === openWaiver.id}', 'requesting={requesting === openWaiver.id}', 'busy={busy === openWaiver.id}',
    'offline={!!loadError?.offline}', 'formLabel={lienWaiverFormLabel(openWaiver, docCtx)}', 'onExport={() => handleExport(openWaiver)}',
    'onRequestSignature={() => handleRequestSignature(openWaiver)}', 'onRecordPaper={() => handleRecordPaper(openWaiver)}',
    "onMarkReceived={() => handleStatusChange(openWaiver, 'received')}", 'onMarkVoid={() => { void handleVoid(openWaiver); }}',
    'onDelete={() => handleDelete(openWaiver)}'];
  const missing = PROPS.filter(p => !detail.includes(p));
  ok('lien: the record pane is today\'s WaiverCard with the same eleven props', !!detail && /<WaiverCard/.test(detail) && missing.length === 0, missing.join(' | '));
  const bulkAt = lwc.indexOf('const waiverBulkActions');
  const bulk = bulkAt < 0 ? '' : lwc.slice(bulkAt, lwc.indexOf('}], [waivers, docCtx]);', bulkAt));
  ok('lien: the only bulk action is Export CSV (every waiver write is online and single-flight)',
    !!bulk && (bulk.match(/label: '/g) ?? []).length === 1 && /label: 'Export CSV'/.test(bulk)
    && !/updateLienWaiverStatus|deleteLienWaiver|saveLienWaiver|recordPaperLienWaiver|supabase/.test(bulk));
  ok('lien: a stale ?waiverId closes the pane once the list has loaded',
    /if \(isDesktop && !loading && openId && !openWaiver\) close\(\);/.test(lwc));
  ok('lien: NewWaiverModal is on the sheet recipe with onRequestClose and a Cmd+Enter create',
    /const f = useSheetFrame\('form', \{ visible, animationType: 'slide' \}\);/.test(lwc)
    && /<Modal visible=\{visible\} animationType=\{f\.animationType\} transparent onRequestClose=\{onClose\}>/.test(lwc)
    && /<View style=\{\[styles\.modalOverlay, f\.overlay\]\}>/.test(lwc) && /<View style=\{\[styles\.modalCard, f\.card\]\}>/.test(lwc)
    && /useSheetPrimaryHotkey\(visible, handleSubmit\);/.test(lwc));

  ok('invoice: no Wisetack anywhere in app/invoice.tsx', !/Wisetack/i.test(read('app/invoice.tsx')));

  for (const [file, writer] of [['components/logs/InvoiceLog.tsx', 'updateInvoice'], ['components/logs/RfiLog.tsx', 'updateRFI']] as const) {
    const src = code(read(file));
    ok(`${file}: the bulk handler writes through ${writer} (the offline queue), never supabase.from`,
      new RegExp(`\\.forEach\\(\\((\\w)\\) => ${writer}\\(\\1\\.id, \\1\\.patch\\)\\)`).test(src) && !/supabase\s*\.\s*from/.test(src));
  }
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-money-desk: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
