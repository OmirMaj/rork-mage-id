// validate-g-logs.ts — the desktop-web LOGS for RFIs, submittals, change
// orders and invoices (wave 6c, lane G).
//
// WHY. The sidebar's THIS JOB rows and the job page's tiles link to /rfi,
// /submittal, /change-order and /invoice with only `?projectId=`, and on the
// founder's 1512 px MacBook each opened a BLANK NEW FORM — there was no RFI or
// submittal list on desktop at all. Desktop web now opens a sortable log with
// the record beside it; the iPhone must not change by one node.
//
// This EXECUTES the pure rules and pins the wiring:
//
//   1. logRouteMode — the full truth table. With desktopWeb false EVERY
//      combination of params is 'phone' (the screen runs today's code). On
//      desktop web: a create signal (new, prefill*, and for invoices type /
//      milestone / contract / deposit) is 'form' even beside a record id; a
//      record id is 'split'; a known project is 'log'; else 'form'. The
//      tutorial's /invoice?projectId&type=progress is 'form'.
//   2. recordIdFromHref / logCsvFileName / the shared cell labels.
//   3. The row helpers: RFI days open (unknown → null, never 0), ball label,
//      filters and counts; submittal ball in court, cycle, late; CO approvals
//      x/y ('—' when nobody was asked), schedule days, totals (drafts not
//      pending); invoice aging ('—' for a draft), QBO, filters, totals.
//   4. Source pins: the phone returns are byte-identical; each log switch is
//      fed by useIsDesktopWeb(); the editors use the log-aware router / back;
//      SplitView's collapseWhenEmpty keeps the list the root's first child;
//      rfi / submittal are 'table' + self-capped; the invoice tutorial
//      sentinel still precedes the first Modal.
//   5. Wave 6d, lane V3: every log's empty state (and chip counts) waits for
//      its collection's settle signal — "Loading …", never "No … on this job
//      yet" before the read lands; a failed RFI / submittal read says so with a
//      retry. The daily-report log's rows are real links (getRowHref), and
//      RowLink never takes the browser's own right-click menu away.
//
// Not here (wave 6d, deferred with the CO line grid): the "Needs a price"
// blank-line rule.
//
// Run via: bun run test:g-logs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CREATE_SIGNALS, RECORD_PARAM, fileSlug, hasCreateSignal, logCsvFileName, logDayKey, logDayLabel, logMoney,
  logNumberLabel, logRouteMode, recordIdFromHref, type LogKind, type RouteParams,
} from '../utils/logs/logRoutes';
import {
  RFI_SUB_CHIPS_MAX, defaultLogFilter, rfiBallLabel, rfiDaysOpen, rfiLogChipCounts, rfiLogCounts, rfiLogFilter,
  rfiOverdueDays, rfiVisibleSubs,
} from '../utils/logs/rfiLogRows';
import {
  submittalBallInCourt, submittalCycleLabel, submittalIsLate, submittalLogChipCounts, submittalLogFilter,
} from '../utils/logs/submittalLogRows';
import {
  coApprovals, coApprovalsLabel, coLogChipCounts, coLogFilter, coLogTotals, coScheduleDays, coSignedAmount,
} from '../utils/logs/changeOrderLogRows';
import {
  invoiceAgingDays, invoiceAgingLabel, invoiceLogChipCounts, invoiceLogFilter, invoiceLogTotals, invoiceQboLabel,
  invoiceTypeLabel,
} from '../utils/logs/invoiceLogRows';
import { pageTypeForRoute, SELF_CAPPED_ROUTES } from '../utils/desktopPage';
import type { ChangeOrder, Invoice, RFI, Submittal } from '../types';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let failures = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}

const KINDS: LogKind[] = ['rfi', 'submittal', 'changeOrder', 'invoice'];

// ── 1. logRouteMode ─────────────────────────────────────────────────────────
console.log('\nlogRouteMode — the phone is ALWAYS phone; desktop web: create > record > project:');
// Every param any link to these four routes carries, each present or absent.
const PARAM_KEYS = [
  'projectId', 'new', 'prefillPhotoId', 'prefillDescription', 'type', 'milestoneId', 'contractId', 'contractTerms',
  'milestoneTrigger', 'depositNoRetainage', 'rfiId', 'submittalId', 'coId', 'invoiceId', 'sendNext',
] as const;
// An independent statement of the rule (not the implementation's code path).
const INVOICE_ONLY_CREATE = new Set(['type', 'milestoneId', 'contractId', 'contractTerms', 'milestoneTrigger', 'depositNoRetainage']);
function oracle(kind: LogKind, present: Set<string>, desktopWeb: boolean, projectKnown: boolean): string {
  if (!desktopWeb) return 'phone';
  const create = present.has('new') || present.has('prefillPhotoId') || present.has('prefillDescription')
    || (kind === 'invoice' && [...present].some((k) => INVOICE_ONLY_CREATE.has(k)));
  if (create) return 'form';
  const rec = kind === 'rfi' ? 'rfiId' : kind === 'submittal' ? 'submittalId' : kind === 'changeOrder' ? 'coId' : 'invoiceId';
  if (present.has(rec)) return 'split';
  return projectKnown ? 'log' : 'form';
}
let combos = 0;
let phoneWrong = 0;
let deskWrong = 0;
let firstWrong = '';
for (const kind of KINDS) {
  for (let mask = 0; mask < 1 << PARAM_KEYS.length; mask++) {
    const present = new Set<string>();
    const params: Record<string, string> = {};
    PARAM_KEYS.forEach((k, i) => { if (mask & (1 << i)) { present.add(k); params[k] = k === 'new' ? '1' : `v-${k}`; } });
    for (const projectKnown of [true, false]) {
      combos += 1;
      const phone = logRouteMode(kind, params, { desktopWeb: false, projectKnown });
      if (phone !== 'phone') { phoneWrong += 1; firstWrong ||= `${kind} ${JSON.stringify(params)} phone → ${phone}`; }
      const desk = logRouteMode(kind, params, { desktopWeb: true, projectKnown });
      const want = oracle(kind, present, true, projectKnown);
      if (desk !== want) { deskWrong += 1; firstWrong ||= `${kind} ${JSON.stringify(params)} desk → ${desk}, want ${want}`; }
    }
  }
}
ok(`desktopWeb false → 'phone' for all ${combos} param combinations (4 kinds × 2^${PARAM_KEYS.length} × project known/unknown)`, phoneWrong === 0, firstWrong);
ok(`desktopWeb true matches the rule for all ${combos} combinations`, deskWrong === 0, firstWrong);
for (const kind of KINDS) {
  ok(`${kind}: new=1 beside a record id is 'form' (create beats the record)`,
    logRouteMode(kind, { projectId: 'p', new: '1', [RECORD_PARAM[kind]]: 'r' }, { desktopWeb: true, projectKnown: true }) === 'form');
  ok(`${kind}: a prefill* key beside a record id is 'form'`,
    logRouteMode(kind, { projectId: 'p', prefillAnything: 'x', [RECORD_PARAM[kind]]: 'r' }, { desktopWeb: true, projectKnown: true }) === 'form');
  ok(`${kind}: a bare projectId of a known job is 'log'`,
    logRouteMode(kind, { projectId: 'p' }, { desktopWeb: true, projectKnown: true }) === 'log');
  ok(`${kind}: an unknown / missing job is 'form' (the picker)`,
    logRouteMode(kind, { projectId: 'gone' }, { desktopWeb: true, projectKnown: false }) === 'form'
    && logRouteMode(kind, {}, { desktopWeb: true, projectKnown: false }) === 'form');
  ok(`${kind}: a record id alone is 'split' (even with no project param)`,
    logRouteMode(kind, { [RECORD_PARAM[kind]]: 'r' }, { desktopWeb: true, projectKnown: false }) === 'split');
  ok(`${kind}: an EMPTY record id or new is not a signal`,
    logRouteMode(kind, { projectId: 'p', new: '', [RECORD_PARAM[kind]]: '' }, { desktopWeb: true, projectKnown: true }) === 'log');
}
ok("the tutorial's /invoice?projectId=S&type=progress is 'form' on desktop web",
  logRouteMode('invoice', { projectId: 'S', type: 'progress' }, { desktopWeb: true, projectKnown: true }) === 'form');
ok("…and 'phone' on the phone", logRouteMode('invoice', { projectId: 'S', type: 'progress' }, { desktopWeb: false, projectKnown: true }) === 'phone');
ok("the invoice send's setParams({invoiceId}) on a new=1 form stays 'form'",
  logRouteMode('invoice', { projectId: 'p', new: '1', invoiceId: 'i' }, { desktopWeb: true, projectKnown: true }) === 'form');
ok("a milestone bill (contract screen) is 'form'",
  logRouteMode('invoice', { projectId: 'p', milestoneId: 'm', contractId: 'c' }, { desktopWeb: true, projectKnown: true }) === 'form');
ok("'type' is a create signal for invoices only (an RFI link with ?type= is still the log)",
  logRouteMode('rfi', { projectId: 'p', type: 'x' }, { desktopWeb: true, projectKnown: true }) === 'log');
ok('array params: a non-empty first value counts', hasCreateSignal('rfi', { new: ['', '1'] } as RouteParams)
  && logRouteMode('rfi', { rfiId: ['r1'] } as RouteParams, { desktopWeb: true, projectKnown: true }) === 'split');
ok('CREATE_SIGNALS: every kind creates on new; invoice also on the six bill starters',
  KINDS.every((k) => CREATE_SIGNALS[k].includes('new')) && CREATE_SIGNALS.invoice.length === 7);

// ── 2. hrefs, file names, cell labels ──────────────────────────────────────
console.log('\nrecordIdFromHref / logCsvFileName / cell labels:');
ok('object href on the same route names its record',
  recordIdFromHref('rfi', { pathname: '/rfi', params: { projectId: 'p', rfiId: 'r9' } }) === 'r9');
ok('string href on the same route names its record',
  recordIdFromHref('changeOrder', '/change-order?projectId=p&coId=c%207') === 'c 7');
ok('another route → null (a real replace)', recordIdFromHref('rfi', { pathname: '/project-detail', params: { id: 'p' } }) === null
  && recordIdFromHref('invoice', '/rfi?rfiId=x') === null);
ok('same route without the record param → null', recordIdFromHref('submittal', '/submittal?projectId=p') === null
  && recordIdFromHref('submittal', '/submittal') === null && recordIdFromHref('rfi', null) === null);
ok('csv file name: slug + stem + LOCAL day',
  logCsvFileName('changeOrder', 'Henderson Kitchen — Phase 2', new Date(2026, 8, 5, 23, 30)) === 'henderson-kitchen-phase-2-change-orders-2026-09-05.csv',
  logCsvFileName('changeOrder', 'Henderson Kitchen — Phase 2', new Date(2026, 8, 5, 23, 30)));
ok('csv file name: no project → "project"', logCsvFileName('rfi', '', new Date(2026, 0, 2)) === 'project-rfis-2026-01-02.csv');
ok('fileSlug strips accents and punctuation', fileSlug('Café Olé!! #3') === 'cafe-ole-3', fileSlug('Café Olé!! #3'));
const NOW = new Date(2026, 8, 25, 10, 0);
ok("logDayLabel: this year 'Sep 5', another year 'Sep 5, 2025', unknown null",
  logDayLabel('2026-09-05', NOW) === 'Sep 5' && logDayLabel('2025-09-05', NOW) === 'Sep 5, 2025'
  && logDayLabel('', NOW) === null && logDayLabel('garbage', NOW) === null && logDayLabel('2026-02-31', NOW) === null);
ok('logDayKey: a bare day is itself; an instant is its LOCAL day', logDayKey('2026-09-05') === '2026-09-05'
  && logDayKey(new Date(2026, 8, 5, 23, 59).toISOString()) === '2026-09-05');
ok("logMoney: '$1,234.50', '-$20.00', '+$650.00' signed, null for not-a-number",
  logMoney(1234.5) === '$1,234.50' && logMoney(-20) === '-$20.00' && logMoney(650, true) === '+$650.00'
  && logMoney(0, true) === '$0.00' && logMoney(NaN) === null && logMoney(undefined) === null);
ok("logNumberLabel: 'RFI-007', null when unknown", logNumberLabel('RFI', 7) === 'RFI-007' && logNumberLabel('RFI', undefined) === null);

// ── 3a. RFI rows ────────────────────────────────────────────────────────────
console.log('\nRFI rows:');
const rfi = (o: Partial<RFI>): RFI => ({
  id: 'r', projectId: 'p', number: 1, subject: 's', question: 'q', submittedBy: '', assignedTo: '',
  dateSubmitted: '2026-09-01', dateRequired: '2026-09-20', status: 'open', priority: 'normal', attachments: [],
  createdAt: '', updatedAt: '', ...o,
});
ok('days open: an open RFI counts to today', rfiDaysOpen(rfi({}), NOW) === 24, String(rfiDaysOpen(rfi({}), NOW)));
ok('days open: an answered RFI stops at its response', rfiDaysOpen(rfi({ status: 'answered', dateResponded: '2026-09-04' }), NOW) === 3);
ok('days open: no submitted date → null (—), never 0', rfiDaysOpen(rfi({ dateSubmitted: '' }), NOW) === null);
ok('days open: answered with no response date → null (its end is unknown)', rfiDaysOpen(rfi({ status: 'closed' }), NOW) === null);
ok('days open: an ISO instant is read as its local day',
  rfiDaysOpen(rfi({ dateSubmitted: new Date(2026, 8, 24, 22, 0).toISOString() }), NOW) === 1);
ok("ball label: the RFI screen's words; unknown → null",
  rfiBallLabel('gc') === 'You (GC)' && rfiBallLabel('building_engineer') === 'Building engineer' && rfiBallLabel(undefined) === null);
ok('overdue: only an OPEN RFI past its due day', rfiOverdueDays(rfi({}), NOW) === 5
  && rfiOverdueDays(rfi({ status: 'answered' }), NOW) === 0 && rfiOverdueDays(rfi({ dateRequired: '2026-09-25' }), NOW) === 0);
const rfis = [rfi({ id: 'a' }), rfi({ id: 'b', dateRequired: '2026-10-01' }), rfi({ id: 'c', status: 'answered' }),
  rfi({ id: 'd', status: 'closed' }), rfi({ id: 'e', status: 'void' })];
const rc = rfiLogChipCounts(rfis, NOW);
ok('chips: open 2 · overdue 1 · answered 1 · closed 2 (void is closed) · all 5',
  rc.open === 2 && rc.overdue === 1 && rc.answered === 1 && rc.closed === 2 && rc.all === 5, JSON.stringify(rc));
ok('rfiLogCounts (for the 6d sidebar) = open + overdue', JSON.stringify(rfiLogCounts(rfis, NOW)) === JSON.stringify({ open: 2, overdue: 1 }));
ok('rfiLogFilter overdue picks exactly the late open one', rfis.filter((r) => rfiLogFilter(r, 'overdue', NOW)).map((r) => r.id).join() === 'a');
ok('default chip: Open; All when Open is empty but the log is not; Open on an empty log',
  defaultLogFilter('open', { open: 2 }, 5) === 'open' && defaultLogFilter('open', { open: 0 }, 3) === 'all'
  && defaultLogFilter('open', { open: 0 }, 0) === 'open');
const subs = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` }));
const vs = rfiVisibleSubs(subs, 's17', false);
ok(`sub rail: the first ${RFI_SUB_CHIPS_MAX} + the picked one, "+N more" counts the rest`,
  vs.shown.length === 13 && vs.shown[12].id === 's17' && vs.hidden === 7, JSON.stringify({ n: vs.shown.length, h: vs.hidden }));
ok('sub rail: expanded or short → everything, nothing hidden',
  rfiVisibleSubs(subs, null, true).hidden === 0 && rfiVisibleSubs(subs.slice(0, 5), null, false).shown.length === 5);

// ── 3b. Submittal rows ─────────────────────────────────────────────────────
console.log('\nsubmittal rows:');
const sub = (o: Partial<Submittal>): Submittal => ({
  id: 's', projectId: 'p', number: 1, title: 't', specSection: '', submittedBy: '', submittedDate: '', requiredDate: '',
  reviewCycles: [], currentStatus: 'pending', attachments: [], createdAt: '', updatedAt: '', ...o,
});
const cyc = (n: number, reviewer: string, returnDate?: string) => ({ cycleNumber: n, sentDate: '2026-09-01', reviewer, status: 'in_review' as const, ...(returnDate ? { returnDate } : {}) });
ok('ball: pending / revise & resubmit → Us', submittalBallInCourt(sub({})) === 'Us' && submittalBallInCourt(sub({ currentStatus: 'revise_resubmit' })) === 'Us');
ok("ball: in review → the last OPEN cycle's reviewer",
  submittalBallInCourt(sub({ currentStatus: 'in_review', reviewCycles: [cyc(1, 'Old', '2026-09-03'), cyc(2, 'Kestrel Arch')] })) === 'Kestrel Arch');
ok("ball: in review with no named reviewer → 'Reviewer'",
  submittalBallInCourt(sub({ currentStatus: 'in_review', reviewCycles: [cyc(1, ' ')] })) === 'Reviewer'
  && submittalBallInCourt(sub({ currentStatus: 'in_review' })) === 'Reviewer');
ok('ball: approved / as noted / rejected → null (—)', ['approved', 'approved_as_noted', 'rejected']
  .every((st) => submittalBallInCourt(sub({ currentStatus: st as Submittal['currentStatus'] })) === null));
ok("cycle: 'Not sent' before the first, else 'Cycle n' (the highest)",
  submittalCycleLabel(sub({})) === 'Not sent' && submittalCycleLabel(sub({ reviewCycles: [cyc(1, 'a', 'x'), cyc(2, 'b')] })) === 'Cycle 2');
ok('late: past required and not approved; no required date is never late',
  submittalIsLate(sub({ requiredDate: '2026-09-20' }), NOW) && !submittalIsLate(sub({ requiredDate: '2026-09-20', currentStatus: 'approved_as_noted' }), NOW)
  && !submittalIsLate(sub({}), NOW) && !submittalIsLate(sub({ requiredDate: '2026-09-25' }), NOW));
const sc = submittalLogChipCounts([sub({}), sub({ currentStatus: 'in_review', requiredDate: '2026-09-01' }), sub({ currentStatus: 'approved' }),
  sub({ currentStatus: 'revise_resubmit' }), sub({ currentStatus: 'rejected' })], NOW);
ok('chips: open 3 (pending + in review + revise) · late 1 · in review 1 · approved 1 · all 5',
  sc.open === 3 && sc.late === 1 && sc.in_review === 1 && sc.approved === 1 && sc.all === 5, JSON.stringify(sc));
ok('submittalLogFilter approved covers approved-as-noted', submittalLogFilter(sub({ currentStatus: 'approved_as_noted' }), 'approved', NOW));

// ── 3c. Change-order rows ──────────────────────────────────────────────────
console.log('\nchange-order rows:');
const co = (o: Partial<ChangeOrder>): ChangeOrder => ({
  id: 'c', number: 1, projectId: 'p', date: '2026-09-01', description: 'd', reason: '', lineItems: [],
  originalContractValue: 0, changeAmount: 0, newContractTotal: 0, status: 'draft', createdAt: '', updatedAt: '', ...o,
} as ChangeOrder);
const appr = (status: 'pending' | 'approved' | 'rejected', required = true) => ({ id: status, name: 'n', email: 'e', role: 'Client' as const, required, order: 0, status });
ok("approvals: x/y over the REQUIRED approvers",
  coApprovalsLabel(co({ approvers: [appr('approved'), appr('pending'), appr('approved', false)] })) === '1/2');
ok("approvals: nobody asked (none, or none required) → null ('—'), never '0/0'",
  coApprovalsLabel(co({})) === null && coApprovals(co({ approvers: [appr('approved', false)] })) === null);
ok('schedule days: undefined → null; 0 is a recorded 0', coScheduleDays(co({})) === null && coScheduleDays(co({ scheduleImpactDays: 0 })) === 0);
ok('signed amount keeps the sign; a missing amount is null', coSignedAmount(co({ changeAmount: -250 })) === -250
  && coSignedAmount({ changeAmount: undefined as unknown as number }) === null);
const cos = [co({ status: 'approved', changeAmount: 1000 }), co({ status: 'approved', changeAmount: -200.5 }), co({ status: 'submitted', changeAmount: 300 }),
  co({ status: 'draft', changeAmount: 999 }), co({ status: 'revised', changeAmount: 50 }), co({ status: 'rejected', changeAmount: 70 }), co({ status: 'void', changeAmount: 5 })];
const ct = coLogTotals(cos);
ok('totals: approved net 799.50; pending 350 (drafts and rejected not counted)', ct.approved === 799.5 && ct.pending === 350, JSON.stringify(ct));
const cc = coLogChipCounts(cos);
ok('chips: open 3 (draft, submitted, revised) · approved 2 · rejected 1 · void 1 · all 7',
  cc.open === 3 && cc.approved === 2 && cc.rejected === 1 && cc.void === 1 && cc.all === 7, JSON.stringify(cc));
ok('under_review is open', coLogFilter(co({ status: 'under_review' }), 'open'));

// ── 3d. Invoice rows ───────────────────────────────────────────────────────
console.log('\ninvoice rows (Date.now pinned to 2026-09-25):');
const realNow = Date.now;
Date.now = () => NOW.getTime();
try {
  const inv = (o: Partial<Invoice>): Invoice => ({
    id: 'i', number: 1, projectId: 'p', type: 'full', issueDate: '2026-08-01T12:00:00.000Z', dueDate: '2026-08-31T12:00:00.000Z',
    paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 1000, taxRate: 0, taxAmount: 0, totalDue: 1000, amountPaid: 0,
    status: 'sent', payments: [], createdAt: '', updatedAt: '', ...o,
  } as Invoice);
  ok("aging: a draft has no clock → null ('—')", invoiceAgingLabel(inv({ status: 'draft' })) === null && invoiceAgingDays(inv({ status: 'draft' })) === null);
  ok("aging: a sent invoice past due → '25d'", invoiceAgingLabel(inv({})) === '25d', String(invoiceAgingLabel(inv({}))));
  ok("aging: not yet due → 'Current'", invoiceAgingLabel(inv({ dueDate: '2026-10-30T12:00:00.000Z' })) === 'Current');
  ok("aging: paid → 'Current' (nothing past due)", invoiceAgingLabel(inv({ status: 'paid', amountPaid: 1000 })) === 'Current');
  ok("QBO: synced / pending / error, and null ('—') when absent",
    invoiceQboLabel(inv({ qboSyncStatus: 'synced' })) === 'Synced' && invoiceQboLabel(inv({ qboSyncStatus: 'error' })) === 'Error' && invoiceQboLabel(inv({})) === null);
  ok("type: 'Full', 'Progress · 25%', 'Progress' with no percent",
    invoiceTypeLabel(inv({})) === 'Full' && invoiceTypeLabel(inv({ type: 'progress', progressPercent: 25 })) === 'Progress · 25%'
    && invoiceTypeLabel(inv({ type: 'progress' })) === 'Progress');
  const invs = [inv({ status: 'draft' }), inv({}), inv({ dueDate: '2026-10-30T12:00:00.000Z' }), inv({ status: 'partially_paid', amountPaid: 400, dueDate: '2026-10-30T12:00:00.000Z' }),
    inv({ status: 'paid', amountPaid: 1000 })];
  const ic = invoiceLogChipCounts(invs);
  ok('chips: draft 1 · unpaid 3 (sent + partly paid + overdue) · overdue 1 · paid 1 · all 5',
    ic.draft === 1 && ic.unpaid === 3 && ic.overdue === 1 && ic.paid === 1 && ic.all === 5, JSON.stringify(ic));
  ok('the overdue chip reads the EFFECTIVE status (a stored "sent" past due)', invoiceLogFilter(inv({}), 'overdue'));
  const it = invoiceLogTotals(invs);
  ok('totals: total 5000 · paid 1400 · balance 3600 (netBalanceDue)', it.total === 5000 && it.paid === 1400 && it.balance === 3600, JSON.stringify(it));
  ok('balance nets held retention (the app rule, not total − paid)',
    invoiceLogTotals([inv({ retentionPercent: 10, retentionAmount: 100 })]).balance === 900,
    JSON.stringify(invoiceLogTotals([inv({ retentionPercent: 10, retentionAmount: 100 })])));
} finally {
  Date.now = realNow;
}

// ── 4. Source pins ─────────────────────────────────────────────────────────
console.log('\nsource — the phone path is untouched and the logs are desktop-web only:');
const rfiSrc = read('app/rfi.tsx');
const subSrc = read('app/submittal.tsx');
const coSrc = read('app/change-order.tsx');
const invSrc = read('app/invoice.tsx');
const fnBody = (src: string, name: string): string => {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return '';
  const next = src.indexOf('\nfunction ', at + 10);
  const nextExport = src.indexOf('\nexport ', at + 10);
  const ends = [next, nextExport].filter((n) => n > 0);
  return src.slice(at, ends.length ? Math.min(...ends) : undefined);
};
ok("rfi: the phone return `return <RFIForm key={found?.id ?? 'new'} />;` is byte-identical",
  rfiSrc.includes("  return <RFIForm key={found?.id ?? 'new'} />;\n}"));
ok("submittal: `return <SubmittalForm key={found?.id ?? 'new'} />;` is byte-identical",
  subSrc.includes("  return <SubmittalForm key={found?.id ?? 'new'} />;\n}"));
ok('change-order: `return <ChangeOrderGate />` and the keyed editor line are byte-identical',
  coSrc.includes('  return <ChangeOrderGate />;\n}') && coSrc.includes("    return <ChangeOrderInner key={target?.id ?? 'new'} projectIdOverride={target?.projectId} />;"));
ok("invoice: the practice line is byte-identical and the FINAL return is <InvoiceEntry />",
  invSrc.includes("    if (practice.has('change_orders_invoicing')) return <InvoiceInner />;")
  && /return <InvoiceEntry \/>;\n\}\n/.test(fnBody(invSrc, 'InvoiceScreen')));
ok("invoice: InvoiceEntry's fallback is exactly <InvoiceInner /> (2 such returns in the file)",
  (invSrc.match(/return <InvoiceInner \/>;/g) ?? []).length === 2 && /\n  return <InvoiceInner \/>;\n\}/.test(fnBody(invSrc, 'InvoiceEntry')));

const SCREENS: { file: string; src: string; fn: string; kind: string; log: string; firstGate: string }[] = [
  { file: 'app/rfi.tsx', src: rfiSrc, fn: 'RFIScreenInner', kind: 'rfi', log: 'RfiLog', firstGate: "if (gate === 'loading') return <RecordGateView" },
  { file: 'app/submittal.tsx', src: subSrc, fn: 'SubmittalScreenInner', kind: 'submittal', log: 'SubmittalLog', firstGate: "if (gate === 'loading') return <SubmittalGateView" },
  { file: 'app/change-order.tsx', src: coSrc, fn: 'ChangeOrderGate', kind: 'changeOrder', log: 'ChangeOrderLog', firstGate: "if (state === 'editor') {" },
  { file: 'app/invoice.tsx', src: invSrc, fn: 'InvoiceEntry', kind: 'invoice', log: 'InvoiceLog', firstGate: 'return <InvoiceInner />;' },
];
for (const s of SCREENS) {
  const body = fnBody(s.src, s.fn);
  ok(`${s.file}: ${s.fn} reads useIsDesktopWeb() and feeds it to logRouteMode('${s.kind}', …)`,
    /const desktopWeb = useIsDesktopWeb\(\);/.test(body) && new RegExp(`logRouteMode\\('${s.kind}', routeParams, \\{ desktopWeb, projectKnown: `).test(body));
  const modeAt = body.indexOf('const mode = logRouteMode(');
  const gateAt = body.indexOf(s.firstGate);
  ok(`${s.file}: the mode is decided BEFORE the first existing return`, modeAt > 0 && gateAt > modeAt, `${modeAt} / ${gateAt}`);
  const logs = [...s.src.matchAll(new RegExp(`<${s.log}\\b`, 'g'))].map((m) => m.index ?? 0);
  ok(`${s.file}: <${s.log}> mounts only under mode === 'log' / 'split'`,
    logs.length === 2 && logs.every((at) => /if \(mode === '(log|split)'\)/.test(s.src.slice(Math.max(0, at - 120), at))),
    String(logs.length));
  ok(`${s.file}: never gates the log on isDesktop alone (a native tablet keeps the phone screen)`,
    !new RegExp(`isDesktop[^\\n]{0,40}<${s.log}\\b`).test(s.src));
}
ok("rfi / submittal / invoice editors use the log-aware router (named `router`)",
  /function RFIForm\(\)[\s\S]{0,400}const router = useLogAwareRouter\(\);/.test(rfiSrc)
  && /function SubmittalForm\(\)[\s\S]{0,400}const router = useLogAwareRouter\(\);/.test(subSrc)
  && /function InvoiceInner\(\)[\s\S]{0,900}const router = useLogAwareRouter\(\);/.test(invSrc));
const coBackHook = coSrc.slice(coSrc.indexOf('function useCoBack'), coSrc.indexOf('function CoRoleBlocked'));
ok('change-order: useCoBack is useSafeBack() without a log, useLogAwareBack over it inside one',
  /function useCoBack\(\): \(\) => void \{\s*const goBack = useSafeBack\(\);\s*return useLogAwareBack\(goBack\);\s*\}/.test(coBackHook));
ok('change-order editor: goBack is useCoBack()', /const goBack = useCoBack\(\);/.test(coSrc.slice(coSrc.indexOf('function ChangeOrderInner'))));
// Fix round 1: ToolHeader's chevron is the REAL router's back (useSafeBack
// inside ToolScreenChrome), so in the log's record pane it would leave the whole
// log. Every ToolHeader the editor or its role gate can render inside the pane
// sits behind `logHost ? null :`; the gate's Back button closes the record.
{
  const inner = coSrc.slice(coSrc.indexOf('function ChangeOrderInner'));
  const blocked = coSrc.slice(coSrc.indexOf('function CoRoleBlocked'), coSrc.indexOf('function coGateState'));
  const bare = (src: string) => (src.match(/<ToolHeader\b/g) ?? []).length;
  const guarded = (src: string) => (src.match(/logHost \? null : \(?\s*<ToolHeader\b/g) ?? []).length;
  ok('change-order: every ToolHeader in ChangeOrderInner is dropped in the log pane (logHost ? null :)',
    /const logHost = useLogRecordHost\(\);/.test(inner) && bare(inner) >= 2 && guarded(inner) === bare(inner),
    `${guarded(inner)}/${bare(inner)}`);
  ok('change-order: CoRoleBlocked drops its ToolHeader in the pane and its Back closes the record',
    /const logHost = useLogRecordHost\(\);/.test(blocked) && bare(blocked) === 1 && guarded(blocked) === 1
      && /const goBack = useCoBack\(\);/.test(blocked),
    `${guarded(blocked)}/${bare(blocked)}`);
}
ok('rfi / submittal editors report unsaved edits to the log (useLogRecordDirty on dirtyRef)',
  /useLogRecordDirty\(\(\) => dirtyRef\.current\);/.test(rfiSrc) && /useLogRecordDirty\(\(\) => dirtyRef\.current\);/.test(subSrc));
ok('Cmd+S / Cmd+Enter: usePrimaryAction on all four editors, desktop only',
  /usePrimaryAction\(existingRFI \? handleSaveInPlace : handleSave, \{\s*label: 'Save RFI',\s*enabled: isDesktop/.test(rfiSrc)
  && /usePrimaryAction\(existingSubmittal \? handleSaveInPlace : handleSave, \{ label: 'Save submittal', enabled: isDesktop \}\)/.test(subSrc)
  && /usePrimaryAction\(\(\) => withConfirmedImpactDays\(\(\) => handleSave\('draft'\)\), \{\s*label: 'Save change order',\s*enabled: isDesktop,\s*disabled: isLocked,/.test(coSrc)
  && /usePrimaryAction\(\(\) => handleSave\('draft'\), \{\s*label: 'Save invoice',\s*enabled: isDesktop,/.test(invSrc));
ok('a sheet that sends or records money never binds Cmd+S (saveKey: false)',
  /useSheetPrimaryHotkey\(showSendModal,[^\n]*\{ saveKey: false \}\)/.test(rfiSrc)
  && /useSheetPrimaryHotkey\(showEmailSend,[^\n]*\{ saveKey: false \}\)/.test(subSrc)
  && /useSheetPrimaryHotkey\(showSendRecipient,[^\n]*\{ saveKey: false \}\)/.test(coSrc)
  && /useSheetPrimaryHotkey\(showSendRecipient,[^\n]*\{ saveKey: false \}\)/.test(invSrc)
  && /useSheetPrimaryHotkey\(showPaymentModal,[^\n]*\{ saveKey: false \}\)/.test(invSrc));

// Every converted Modal keeps `transparent` and takes the frame's animation.
for (const [file, src, names] of [
  ['app/rfi.tsx', rfiSrc, ['fSend', 'fTask']],
  ['app/submittal.tsx', subSrc, ['fTask', 'fEmail']],
  ['app/change-order.tsx', coSrc, ['fSend', 'fAddItem', 'fEstimate', 'fMaterial']],
  ['app/invoice.tsx', invSrc, ['fPayment', 'fRetainage', 'fRetention', 'fSend']],
] as const) {
  for (const n of names) {
    ok(`${file}: the ${n} Modal keeps transparent + animationType={${n}.animationType}, and its card takes ${n}.card`,
      new RegExp(`<Modal visible=\\{[^}]+\\} transparent animationType=\\{${n}\\.animationType\\}`).test(src) && new RegExp(`${n}\\.card(, ${n}\\.cardMotion)?\\]`).test(src) && src.includes(`${n}.overlay]`));
  }
}
const sentinelAt = invSrc.indexOf('<TutorialTarget id="invoice.modalUp" />');
ok('invoice: the tutorial modalUp sentinel still precedes `<Modal visible={showPaymentModal}`',
  sentinelAt > 0 && sentinelAt < invSrc.indexOf('<Modal visible={showPaymentModal}'));
ok('invoice: the send TutorialTarget sits INSIDE the ActionBar', /<ActionBar style=\{\[styles\.bottomBar,[^\n]*width="form" onLayout=\{onBottomBarLayout\}>[\s\S]{0,1200}<TutorialTarget id="invoice\.send"[\s\S]{0,1600}<\/TutorialTarget>[\s\S]{0,80}<\/ActionBar>/.test(invSrc));
ok('change-order: both edit bars and the bill bar are ActionBars at the form width; Buttons keep flex:1 for the phone',
  (coSrc.match(/<ActionBar style=\{\[styles\.(bottomBar|coBillBar), \{ paddingBottom: insets\.bottom \+ 12 \}\]\} width="form">/g) ?? []).length === 3
  && (coSrc.match(/style=\{\{ flex: 1 \}\}\n\s*testID="(co-sent-close|save-co-draft|send-co-btn)"/g) ?? []).length === 3);
ok('editors cap at the 760 form column on desktop',
  /contentDesktop: \{ width: '100%', maxWidth: Layout\.page\.form, alignSelf: 'center'/.test(rfiSrc)
  && /contentDesktop: \{ width: '100%', maxWidth: Layout\.page\.form, alignSelf: 'center'/.test(subSrc)
  && /contentDesktop: \{ width: '100%', maxWidth: Layout\.page\.form, alignSelf: 'center' as const \}/.test(coSrc)
  && /contentDesktop: \{ width: '100%', maxWidth: Layout\.page\.form, alignSelf: 'center' as const \}/.test(invSrc)
  && !/maxWidth: 1040/.test(coSrc) && !/maxWidth: 1040/.test(invSrc));
ok('rfi: the sub rail is a ChipRail on desktop; the phone keeps its ScrollView',
  /\{isDesktop \? \([\s\S]{0,400}<ChipRail contentContainerStyle=\{styles\.subChipRow\}[\s\S]*?\) : \(\n\s*<ScrollView\n\s*horizontal\n\s*showsHorizontalScrollIndicator=\{false\}\n\s*contentContainerStyle=\{styles\.subChipRow\}\n\s*keyboardShouldPersistTaps="handled"/.test(rfiSrc));

console.log('\nsource — the shell, the host and SplitView:');
const hostSrc = read('components/logs/LogRecordHost.tsx');
ok('useLogAwareRouter returns useRouter() ITSELF with no host (the phone gets the same object)',
  /const router = useRouter\(\);\s*const host = useContext\(LogRecordContext\);\s*return useMemo\(\(\) => \{\s*if \(!host\) return router;/.test(hostSrc));
ok('useLogAwareBack returns its fallback with no host', /return host \? host\.close : fallback;/.test(hostSrc));
ok('the context defaults to null', /createContext<LogRecordHost \| null>\(null\)/.test(hostSrc));
const shellSrc = read('components/logs/LogShell.tsx');
ok('LogShell: the page caps at Layout.page.table with the 24 gutter', /pageDesktop: \{[\s\S]{0,120}maxWidth: Layout\.page\.table,[\s\S]{0,60}paddingHorizontal: Layout\.gutter,/.test(shellSrc)
  && /\[styles\.page, isDesktop && styles\.pageDesktop\]/.test(shellSrc));
ok('LogShell: SplitView collapses when empty, keyed by the route record param', /<SplitView\s+splitId=\{`log-\$\{kind\}`\}[\s\S]{0,80}collapseWhenEmpty/.test(shellSrc)
  && /useSplitRecord\(\{ param \}\)/.test(shellSrc) && /const param = RECORD_PARAM\[kind\];/.test(shellSrc));
ok('LogShell: open / step / Esc go through the dirty guard ("Discard changes?")',
  /onClose=\{guardedClose\}/.test(shellSrc) && /onRowOpen: guardedOpen/.test(shellSrc) && /showAlert\('Discard changes\?'/.test(shellSrc));
ok('LogShell: the title row is print-hidden on web only', /Platform\.OS === 'web' \? \{ dataSet: \{ print: 'hide' \} \} : \{\}/.test(shellSrc)
  && /<View style=\{styles\.titleRow\} \{\.\.\.PRINT_HIDE\}>/.test(shellSrc));
const svSrc = read('components/desktop/SplitView.tsx');
const desk = svSrc.slice(svSrc.indexOf('function DesktopSplitView'), svSrc.indexOf('const makeStyles'));
ok('SplitView: collapseWhenEmpty is optional and defaults off', /collapseWhenEmpty\?: boolean;/.test(svSrc) && /collapseWhenEmpty = false,/.test(desk));
ok('SplitView collapse: the list stays the root\'s FIRST child (same node, restyled to 100%)',
  /return \(\s*<View style=\{\[single \? styles\.single : styles\.split, style\]\}[^>]*>\s*<View\s+style=\{single \? \[styles\.pane, hasRecord && styles\.hidden\] : \[styles\.listPane, \{ width: listWidth \}\]\}/.test(desk)
  && /const collapsed = collapseWhenEmpty && !single && !hasRecord;/.test(desk) && /collapsed \? '100%' : splitWidths\(width, ratio\)\.listWidth/.test(desk));
ok('SplitView collapse: no divider and no detail pane while collapsed',
  /\) : collapsed \? null : \(\n\s*<View\n\s*key="divider"/.test(desk) && /\(single && !hasRecord\) \|\| collapsed \? null : \(/.test(desk));

console.log('\nhonest loading (wave 6d, lane V3 — runtime fix C6): no "No … yet" before the collection loads:');
{
  const LOADERS: [string, string, RegExp, string][] = [
    ['components/logs/RfiLog.tsx', 'rfis', /const settle = useCollectionSettled\('rfis', undefined\);/, 'const loading = all.length === 0 && !settle.settled && !settledOnce;'],
    ['components/logs/SubmittalLog.tsx', 'submittals', /const settle = useCollectionSettled\('submittals', undefined\);/, 'const loading = all.length === 0 && !settle.settled && !settledOnce;'],
    ['components/logs/ChangeOrderLog.tsx', 'changeOrdersLoaded', /const \{[^}]*\bchangeOrdersLoaded\b[^}]*\} = useProjects\(\);/, 'const loading = all.length === 0 && !changeOrdersLoaded;'],
    ['components/logs/InvoiceLog.tsx', 'invoicesLoaded', /const \{[^}]*\binvoicesLoaded\b[^}]*\} = useProjects\(\);/, 'const loading = all.length === 0 && !invoicesLoaded;'],
  ];
  for (const [file, signal, reads, loadingLine] of LOADERS) {
    const src = read(file);
    const empty = src.slice(src.indexOf('emptyState={'), src.indexOf('renderCard='));
    ok(`${file}: reads its settle signal (${signal}) and derives \`loading\` from it`, reads.test(src) && src.includes(loadingLine));
    ok(`${file}: the emptyState branches on \`loading\` FIRST ("Loading …"), before any "No … on this job yet"`,
      /^emptyState=\{loading \? \(\s*<EmptyState[\s\S]{0,160}title="Loading [A-Za-z ]+…"/.test(empty)
      && empty.indexOf('title="Loading') < empty.indexOf('on this job yet'));
    ok(`${file}: the chip counts are hidden while loading (never a 0 it has not earned)`, /count: loading \? undefined : counts\[f\.key\]/.test(src));
  }
  for (const [file, key, noun] of [['components/logs/RfiLog.tsx', 'rfis', 'RFIs'], ['components/logs/SubmittalLog.tsx', 'submittals', 'submittals']] as const) {
    const src = read(file);
    ok(`${file}: a settled-and-failed read says "Couldn't load ${noun}. Check your connection." with a retry of ['${key}']`,
      new RegExp(`\\) : all\\.length === 0 && settle\\.failed \\? \\(\\s*<EmptyState[\\s\\S]{0,160}title="Couldn't load ${noun}\\. Check your connection\\."[\\s\\S]{0,200}onAction=\\{retryRead\\}`).test(src)
      && src.includes(`const retryRead = useCallback(() => { void qc.invalidateQueries({ queryKey: ['${key}'] }); }, [qc]);`));
  }
  const dfrLog = read('components/logs/DailyReportLog.tsx');
  ok('DailyReportLog: the empty table says "Loading daily reports…" until dailyReportsLoaded',
    /emptyState=\{rows\.length === 0 && !dailyReportsLoaded \? \(\s*<View style=\{styles\.empty\} testID="dfr-log-loading">\s*<Text style=\{styles\.emptyText\}>Loading daily reports…<\/Text>/.test(dfrLog));
  console.log('\nrecord links (wave 6d, lane V3 — contract D7):');
  ok("DailyReportLog passes getRowHref → routeHref('/daily-report', { projectId, reportId }) (Cmd-click / right-click open a new tab)",
    /getRowHref=\{\(r\) => routeHref\('\/daily-report', \{ projectId, reportId: r\.report\.id \}\)\}/.test(dfrLog)
    && /import \{ routeHref \} from '@\/components\/desktop\/RowLink';/.test(dfrLog)
    && /onRowOpen=\{\(r\) => rec\.open\(r\.report\.id\)\}/.test(dfrLog));
  const rowLink = read('components/desktop/RowLink.tsx');
  ok("RowLink.tsx contains no 'contextmenu' (the browser's native menu IS the right-click menu)", !/contextmenu/i.test(rowLink));
  ok('…and its header says so', /The browser's native context menu IS the right-click\n\/\/ menu/.test(rowLink));
}

console.log('\nroute contract (lane S, read-only here):');
ok("rfi and submittal are 'table' and self-capped", pageTypeForRoute('rfi') === 'table' && pageTypeForRoute('submittal') === 'table'
  && SELF_CAPPED_ROUTES.has('rfi') && SELF_CAPPED_ROUTES.has('submittal'));
ok("invoice and change-order are 'table'", pageTypeForRoute('invoice') === 'table' && pageTypeForRoute('change-order') === 'table');
ok("the onboarding checklist's invoice row asks for a new one", /href: '\/invoice\?new=1',/.test(read('components/OnboardingChecklist.tsx')));

if (failures > 0) {
  console.error(`\n✗ validate-g-logs: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n✓ validate-g-logs: the logs open only on desktop web, and the phone path is byte-identical');
