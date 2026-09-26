// validate-pay-earned.ts — pins "Pay what's earned" (utils/subBillCheck.ts +
// components/subInvoice/PayWhatsEarnedCard.tsx + its /sub-portal-setup mount).
// Run: bun run scripts/validate-pay-earned.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  companyDaysOnSite,
  subBillCheck,
  AHEAD_THRESHOLD_PTS,
  MIN_HOLD_CENTS,
  type SubBillCheckInput,
} from '../utils/subBillCheck';
import type { DailyFieldReport } from '../types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail ? `\n        ${detail}` : ''); }
}

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

console.log("\nPay what's earned:");

ok('thresholds are 10 pts and $100', AHEAD_THRESHOLD_PTS === 10 && MIN_HOLD_CENTS === 10000);

const task = (id: string, progress: number, durationDays: number, extra: Record<string, unknown> = {}) =>
  ({ id, title: `Task ${id}`, progress, durationDays, isMilestone: false, assignedSubId: 'sub1', ...extra });

function input(o: Partial<SubBillCheckInput> = {}): SubBillCheckInput {
  return {
    invoice: { id: 'inv3', amount: 16760, commitmentId: 'c1', status: 'submitted', retentionAmount: 0, invoiceNumber: '3' },
    siblings: [
      { id: 'inv1', amount: 8000, commitmentId: 'c1', status: 'approved' },
      { id: 'inv2', amount: 5000, commitmentId: 'c1', status: 'paid' },
      { id: 'inv0', amount: 9999, commitmentId: 'c1', status: 'rejected' },
      { id: 'invX', amount: 7777, commitmentId: 'c-other', status: 'approved' },
      { id: 'inv3', amount: 16760, commitmentId: 'c1', status: 'submitted' },
    ],
    commitment: { amount: 45000, changeAmount: 3000 },
    tasks: [task('a', 35, 10), task('b', 35, 20)],
    subId: 'sub1',
    subName: 'Acme Electric LLC',
    presence: { reportedDaysPresent: 6, lastSeen: '2026-09-20' },
    openPunchCount: 2,
    ...o,
  };
}

// ── The ahead-of-work case ──────────────────────────────────────────────────
const a = subBillCheck(input());
ok('$48,000 contract, $13,000 before, $16,760 now, 35% done → ahead_of_work', a.verdict === 'ahead_of_work', a.verdict);
ok('contract is amount + changeAmount in cents', a.contractCents === 4_800_000, String(a.contractCents));
ok('billed-before counts approved + paid siblings on this commitment only', a.billedBeforeCents === 1_300_000, String(a.billedBeforeCents));
ok('earned = 35% of the contract', a.earnedCents === 1_680_000, String(a.earnedCents));
ok('approve === 16,800 − 13,000 = 3,800 in exact cents', a.suggestApproveCents === 380_000, String(a.suggestApproveCents));
ok('approve + hold === this, in cents', (a.suggestApproveCents ?? 0) + (a.holdCents ?? 0) === a.thisCents && a.thisCents === 1_676_000);
ok('hold is 12,960', a.holdCents === 1_296_000, String(a.holdCents));
ok('headline states billed % and work %',
  a.headline === 'Acme Electric LLC has billed 62% of their $48,000 contract. Their scheduled tasks are 35% done, and your daily reports list them on site on 6 day(s).',
  a.headline);
ok('suggestion names both amounts',
  a.suggestion === 'Suggest approving $3,800 now and holding $12,960 until the work catches up.', a.suggestion ?? '');
ok('note to sub names the invoice, the amount and the split',
  !!a.noteToSub && a.noteToSub.startsWith('Hi Acme Electric LLC, we reviewed invoice #3 for $16,760.')
  && a.noteToSub.includes('We can approve $3,800 now') && a.noteToSub.includes('remaining $12,960'), a.noteToSub ?? '');
ok('evidence lists every task, presence and punch',
  a.evidence.includes('Task a: 35% (10 d)') && a.evidence.includes('Task b: 35% (20 d)')
  && a.evidence.some(e => e.startsWith('Acme Electric LLC is on your daily reports (by company name) on 6 day(s), last '))
  && a.evidence.includes('2 open punch item(s) on this sub'), JSON.stringify(a.evidence));

// Rounding: an odd-cent case still reconciles exactly.
const odd = subBillCheck(input({
  invoice: { id: 'inv3', amount: 1234.57, commitmentId: 'c1', status: 'submitted', invoiceNumber: '9' },
  siblings: [{ id: 'inv1', amount: 100.01, commitmentId: 'c1', status: 'approved' }],
  commitment: { amount: 3333.33 },
  tasks: [task('a', 12.5, 3)],
}));
ok('odd cents: approve + hold === this', (odd.suggestApproveCents ?? 0) + (odd.holdCents ?? 0) === odd.thisCents, JSON.stringify(odd));
ok('odd cents: every figure is an integer',
  [odd.contractCents, odd.billedBeforeCents, odd.thisCents, odd.earnedCents, odd.suggestApproveCents, odd.holdCents]
    .every(n => n == null || Number.isInteger(n)));

// Retainage caveat.
const ret = subBillCheck(input({ invoice: { id: 'inv3', amount: 16760, commitmentId: 'c1', status: 'submitted', retentionAmount: 1676, invoiceNumber: '3' } }));
ok('retainage adds "Percentages are before retainage."', ret.headline.endsWith(' Percentages are before retainage.'), ret.headline);

// ── The other verdicts ──────────────────────────────────────────────────────
const nt = subBillCheck(input({ tasks: [task('z', 50, 5, { assignedSubId: 'someone-else' })] }));
ok('no tasks for this sub → no_tasks', nt.verdict === 'no_tasks', nt.verdict);
ok('no_tasks makes no suggestion', nt.suggestApproveCents === null && nt.holdCents === null && nt.suggestion === null && nt.noteToSub === null);
ok('no_tasks copy', nt.headline === 'No schedule tasks are assigned to Acme Electric LLC, so MAGE can’t compare this bill with work in place. Assign their tasks in the schedule to get this check.');

const st = subBillCheck(input({ tasks: [task('a', 0, 10), task('b', 0, 5)], presence: { reportedDaysPresent: 6, lastSeen: '2026-09-20' } }));
ok('all tasks 0% + 6 presence days → stale_schedule', st.verdict === 'stale_schedule', st.verdict);
ok('stale_schedule holds nothing', st.holdCents === null && st.suggestApproveCents === null && st.noteToSub === null);
ok('stale_schedule copy', st.headline === 'Every task assigned to Acme Electric LLC still reads 0%, but your daily reports list them on site on 6 day(s). Update task progress before holding any money.', st.headline);
const st1 = subBillCheck(input({ tasks: [task('a', 0, 10)], presence: { reportedDaysPresent: 1, lastSeen: '2026-09-20' } }));
ok('one presence day is not enough to call the schedule stale', st1.verdict !== 'stale_schedule', st1.verdict);

// 40% billed vs 36% work in place.
const il = subBillCheck(input({
  invoice: { id: 'inv3', amount: 6200, commitmentId: 'c1', status: 'submitted', invoiceNumber: '3' },
  tasks: [task('a', 36, 10)],
}));
ok('40% billed vs 36% done → in_line', il.verdict === 'in_line', `${il.verdict} ${il.billedPct}`);
ok('in_line copy', il.headline === 'Billing is in line with work in place (40% billed, 36% done).', il.headline);
ok('in_line suggests nothing', il.suggestion === null && il.holdCents === null && il.noteToSub === null);

// A big gap but a tiny hold stays in line (hold < $100).
const tiny = subBillCheck(input({
  invoice: { id: 'inv3', amount: 50, commitmentId: 'c1', status: 'submitted', invoiceNumber: '3' },
  siblings: [], commitment: { amount: 100 }, tasks: [task('a', 10, 1)],
}));
ok('hold under $100 stays in_line', tiny.verdict === 'in_line', tiny.verdict);

const nc = subBillCheck(input({ commitment: null }));
ok('no commitment → no_commitment', nc.verdict === 'no_commitment' && nc.contractCents === null);
ok('no_commitment copy', nc.headline === 'This invoice isn’t tied to a commitment, so there’s no contract value to compare it with.');
ok('zero-value commitment → no_commitment', subBillCheck(input({ commitment: { amount: 0 } })).verdict === 'no_commitment');

// ── Work in place ───────────────────────────────────────────────────────────
const ms = subBillCheck(input({ tasks: [task('a', 20, 10), task('m', 100, 50, { isMilestone: true })] }));
ok('milestones are excluded from work in place', ms.workInPlacePct === 0.2 && !ms.evidence.some(e => e.startsWith('Task m')), String(ms.workInPlacePct));
const zd = subBillCheck(input({ tasks: [task('a', 20, 0), task('b', 60, 0)] }));
ok('all-zero durations use the simple mean', Math.abs((zd.workInPlacePct ?? -1) - 0.4) < 1e-9, String(zd.workInPlacePct));
const wt = subBillCheck(input({ tasks: [task('a', 100, 30), task('b', 0, 10)] }));
ok('work in place is duration-weighted', wt.workInPlacePct === 0.75, String(wt.workInPlacePct));

// ── companyDaysOnSite ───────────────────────────────────────────────────────
const rep = (date: string, manpower: { trade: string; company: string; headcount: number }[]) =>
  ({ date, manpower: manpower.map((m, i) => ({ id: String(i), hoursWorked: 8, ...m })) }) as Pick<DailyFieldReport, 'date' | 'manpower'>;
const reports = [
  rep('2026-09-01', [{ trade: 'Electrical', company: 'Acme Electric LLC', headcount: 3 }]),
  rep('2026-09-02', [{ trade: 'Electrical', company: 'Bolt Electric', headcount: 4 }]),
  rep('2026-09-03', [{ trade: 'Electrical', company: 'Bolt Electric', headcount: 2 }]),
  rep('2026-09-04', [
    { trade: 'Electrical', company: 'ACME ELECTRIC, Inc.', headcount: 2 },
    { trade: 'Electrical', company: 'Acme Electric', headcount: 1 },
  ]),
  rep('2026-09-05', [{ trade: 'Electrical', company: 'Acme Electric LLC', headcount: 0 }]),
  rep('2026-09-04T18:00:00', [{ trade: 'Electrical', company: 'Acme Electric LLC', headcount: 2 }]),
];
const acme = companyDaysOnSite(reports, 'Acme Electric LLC');
ok("same trade, different company: only Acme's days count", acme?.reportedDaysPresent === 2, JSON.stringify(acme));
ok('two Acme entries on one day count once (and an instant on that day too)', acme?.lastSeen === '2026-09-04', JSON.stringify(acme));
ok('headcount 0 does not count (Sep 5 is not the last day seen)', acme?.lastSeen !== '2026-09-05');
const zeroOnly = companyDaysOnSite([reports[4]], 'Acme Electric LLC');
ok('a headcount-0 day alone is 0 days', zeroOnly?.reportedDaysPresent === 0 && zeroOnly.lastSeen === null, JSON.stringify(zeroOnly));
ok('blank companyName → null', companyDaysOnSite(reports, '   ') === null && companyDaysOnSite(reports, '') === null);
ok('a short name never matches by containment', companyDaysOnSite([rep('2026-09-01', [{ trade: 'x', company: 'Acme Electric', headcount: 1 }])], 'Acme')?.reportedDaysPresent === 0);

// ── Source checks ───────────────────────────────────────────────────────────
const util = code('utils/subBillCheck.ts');
const CARD = 'components/subInvoice/PayWhatsEarnedCard.tsx';
const card = code(CARD);
ok('paidToDate is never read (util)', !/paidToDate/.test(util));
ok('paidToDate is never read (card)', !/paidToDate/.test(card));
ok('the card does not call buildCrewPresence', !/buildCrewPresence/.test(card));
ok('the card uses companyDaysOnSite', /companyDaysOnSite\(getDailyReportsForProject\(project\.id\), sub\.companyName\)/.test(card));
ok('the card root testID is payearned-<id>', /testID=\{`payearned-\$\{invoice\.id\}`\}/.test(card));
ok('the card copies through utils/clipboard with a shareText fallback', /copyToClipboard\(/.test(card) && /shareText\(/.test(card));

const setup = code('app/sub-portal-setup.tsx');
const mountLines = setup.split('\n').filter(l => l.includes('<PayWhatsEarnedCard'));
ok('sub-portal-setup mounts the card once', mountLines.length === 1, String(mountLines.length));
ok("the mount is gated on inv.status === 'submitted'", mountLines.length === 1 && mountLines[0].includes("inv.status === 'submitted'"));
ok("the mount does not mention 'approved'", mountLines.length === 1 && !mountLines[0].includes('approved'));

const PINNED_CHECK_OVERPAYMENT = `  const checkOverpayment = useCallback(
    (invoiceId: string): (SubOverpayment & { subName: string }) | null => {
      const invoice = submitted.invoices.find(i => i.id === invoiceId);
      if (!invoice || !invoice.commitmentId) return null;
      const commitment = allCommitments.find(c => c.id === invoice.commitmentId);
      if (!commitment) return null;
      const numbers = computeSubOverpayment({
        invoice,
        commitment,
        siblings: submitted.invoices,
      });
      if (!numbers) return null;
      return { ...numbers, subName: sub?.companyName ?? 'this sub' };
    },
    [submitted.invoices, allCommitments, sub],
  );`;
ok('checkOverpayment is unchanged', read('app/sub-portal-setup.tsx').includes(PINNED_CHECK_OVERPAYMENT));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
