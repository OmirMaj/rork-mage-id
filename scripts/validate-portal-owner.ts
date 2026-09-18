// validate-portal-owner.ts — pins the OWNER-facing half of the client portal.
//
// Three things ship here and all three are the kind of thing that rots quietly:
//
//  1. CHANGE-ORDER E-SIGNATURE. Approving a change order used to be a browser
//     confirm() + prompt('Your name (for the record):') — a consent click, not
//     an electronic signature. A homeowner disputing a $12K CO could credibly
//     argue nobody ever signed anything. The portal now captures a drawn signature,
//     a typed legal name, and an affirmative consent against a disclosure, and
//     seals a canonical record whose SHA-256 the server recomputes. If ANY of
//     that regresses — the disclosure text drifting between the TS module and
//     the static HTML, the prompt() coming back, the sealed RPC disappearing —
//     the signature stops being defensible, so it is pinned here.
//
//  2. PAY-APPLICATION NARRATIVE. A homeowner can't judge "Division 09 Finishes
//     — $14,200 this period, 62% complete", so they sit on it, and
//     days-to-payment is the number that decides whether a small GC makes
//     payroll. The narrative must be grounded: ONLY in-window rows, and an
//     empty period must say so rather than generate filler.
//
//  3. WHAT'S WAITING ON THE OWNER. Ranked overdue-first and aged against a
//     caller-supplied `today`.
//
// Plus the hard constraint that governs all of it: the client portal must NEVER
// expose cost, markup, or margin. The deep key scan below is negative-tested —
// it is fed a deliberately poisoned payload and must FAIL on it — so a scanner
// that has quietly stopped scanning cannot pass.
//
// Run: bun run scripts/validate-portal-owner.ts
// Pinned to a US zone BEFORE any Date is built: an instant now reads as the
// LOCAL day it fell on (toCalendarDate, integration round 1), so the evening-
// report case below only means something west of Greenwich, and the fixtures'
// instants are placed for it.
process.env.TZ = 'America/Los_Angeles';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  derivePayAppPeriods, buildPeriodNarrative, buildOwnerDecisions, toCalendarDate,
  buildCOConsentRecord, summarizeOwnerDecisions,
  ESIGN_DISCLOSURE_TEXT, ESIGN_DISCLOSURE_VERSION, DUE_SOON_DAYS,
  type OwnerDecision,
} from '../utils/portalOwnerCore';
import { buildOwnerConfidence, ownerSchedulePace, OWNER_PACE_THRESHOLDS, STATUS_LABEL } from '../utils/ownerConfidence';
import { buildPortalSnapshot, scheduleWorkComplete, scheduleFinishDate, maskPortalLinkToken, portalShareUrl, PORTAL_BASE_URL, PORTAL_SNAPSHOT_VERSION,
  buildPortalDocuments, closeoutIsShared,
  buildProposalConsentRecord, buildFeedbackAsk, proposalBlockReason,
  PROPOSAL_ESIGN_VERSION, PROPOSAL_DISCLOSURE_TEXT, PROPOSAL_NOT_A_CONTRACT_NOTE } from '../utils/portalSnapshot';
import { toClientEstimateView } from '../utils/clientEstimateView';
import type { Project, ClientPortalSettings, SavedAIAPayApp, SelectionCategory, ChangeOrder, DailyFieldReport, ProjectPhoto, Invoice } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ─────────────────────────────────────────────────────────────────────────────
// The client-facing safety scanner. Mirrors the assertion style in
// scripts/validate-owner-confidence.ts ("billing exposes only client-facing
// keys (no cost/markup/margin)") but walks the whole object graph, because the
// payloads shipped here are nested (narratives inside pay apps inside sections).
// ─────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_KEY = /cost|markup|margin|profit|unitprice|supplier|vendor|wholesale|burden|overhead|basetotal/i;

function forbiddenKeys(value: unknown, path = '$', out: string[] = []): string[] {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => forbiddenKeys(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(k)) out.push(`${path}.${k}`);
      forbiddenKeys(v, `${path}.${k}`, out);
    }
  }
  return out;
}

/** Every string in the payload, for value-level checks (a leaked dollar figure
 *  doesn't need a suspicious key name to be a leak). */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach(v => allStrings(v, out)); return out; }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) allStrings(v, out);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Pay-app billing periods
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — pay-app billing periods:');

{
  const periods = derivePayAppPeriods(
    [
      { id: 'b', applicationNumber: 2, periodTo: '2026-06-30' },
      { id: 'a', applicationNumber: 1, periodTo: '2026-05-31' },
      { id: 'c', applicationNumber: 3, periodTo: '2026-07-31' },
    ],
    '2026-05-01',
  );
  expect('app #1 anchors to the project start',
    periods.find(p => p.id === 'a'), { id: 'a', periodFrom: '2026-05-01', periodTo: '2026-05-31' });
  expect('app #2 starts the day after app #1 ends',
    periods.find(p => p.id === 'b'), { id: 'b', periodFrom: '2026-06-01', periodTo: '2026-06-30' });
  expect('app #3 chains off app #2',
    periods.find(p => p.id === 'c'), { id: 'c', periodFrom: '2026-07-01', periodTo: '2026-07-31' });
}
{
  // No project start and no predecessor → no window. We do NOT invent one.
  const [first] = derivePayAppPeriods([{ id: 'a', applicationNumber: 1, periodTo: '2026-05-31' }]);
  expect('app #1 with no project start has NO derived periodFrom', first.periodFrom, undefined);
}
{
  // Contradictory GC dates (period end before the derived start) → no window.
  const periods = derivePayAppPeriods([
    { id: 'a', applicationNumber: 1, periodTo: '2026-06-30' },
    { id: 'b', applicationNumber: 2, periodTo: '2026-06-15' },
  ], '2026-06-01');
  expect('impossible window (end before start) is reported as unknown, not inverted',
    periods.find(p => p.id === 'b')?.periodFrom, undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Period → activity matching
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — pay-app narrative (period matching):');

const REPORTS = [
  { id: 'r0', date: '2026-05-30', workPerformed: 'BEFORE WINDOW — demo of the old deck' },
  { id: 'r1', date: '2026-06-03', workPerformed: 'Framed the second-floor walls and set the ridge beam.' },
  { id: 'r2', date: '2026-06-03', workPerformed: 'Framed the second-floor walls and set the ridge beam.' }, // dupe note, same day
  { id: 'r3', date: '2026-06-05', workPerformed: 'Rough electrical pulled through the new framing.' },
  { id: 'r4', date: '2026-07-02', workPerformed: 'AFTER WINDOW — started drywall' },
];
const PHOTOS = [
  { url: 'https://x/1.jpg', timestamp: '2026-05-20T12:00:00Z' },   // before
  { url: 'https://x/2.jpg', timestamp: '2026-06-03T09:00:00Z' },
  { url: 'https://x/3.jpg', timestamp: '2026-06-04T09:00:00Z' },
  { url: 'https://x/4.jpg', timestamp: '2026-06-07T17:30:00Z' },
  { url: '', timestamp: '2026-06-06T09:00:00Z' },                   // no url — not a photo
  { url: 'https://x/5.jpg', timestamp: '2026-07-10T09:00:00Z' },   // after
];
const MILESTONES = [
  { id: 'm1', title: 'Framing complete', dateISO: '2026-06-06', completed: true },
  { id: 'm2', title: 'Rough electrical complete', dateISO: '2026-06-09', completed: true },
  { id: 'm3', title: 'Drywall complete', dateISO: '2026-07-15', completed: true },   // after window
  { id: 'm4', title: 'Windows installed', dateISO: '2026-06-08', completed: false }, // not done
];

const JUNE = { periodFrom: '2026-06-01', periodTo: '2026-06-30' };
const n = buildPeriodNarrative({ ...JUNE, reports: REPORTS, photos: PHOTOS, milestones: MILESTONES });

expect('toCalendarDate: a bare day is that day; an instant is its local day', [toCalendarDate('2026-09-15'), toCalendarDate('2026-09-16T02:00:00.000Z'), toCalendarDate('junk')], ['2026-09-15', '2026-09-15', null]);
expect('counts ONLY in-window daily reports', n.reportCount, 3);
expect('counts distinct on-site days, not report rows', n.workdayCount, 2);
expect('counts ONLY in-window photos with a real url', n.photoCount, 3);
expect('photo range is the in-window min/max', [n.photoFrom, n.photoTo], ['2026-06-03', '2026-06-07']);
expect('milestones: in-window AND completed only',
  n.milestones, ['Framing complete', 'Rough electrical complete']);
expect('duplicate field notes are collapsed', n.workNotes.length, 2);
expect('period label reads as a date range', n.periodLabel, 'Jun 1 – Jun 30, 2026');
expect('hasActivity + no gap when the period has content', [n.hasActivity, n.gap], [true, undefined]);
ok('headline names the milestones and cites the photos',
  n.headline === 'This billing period covers Framing complete and Rough electrical complete — 3 photos from Jun 3–Jun 7.',
  `got: ${n.headline}`);
ok('no out-of-window work text leaks into the narrative',
  !JSON.stringify(n).includes('BEFORE WINDOW') && !JSON.stringify(n).includes('AFTER WINDOW'));

// A report filed at 7 pm Pacific on the last day of the period is stored as
// an instant (the snapshot sends dayOrInstantDate(...).toISOString(), and the
// voice DFR stores `now`) whose UTC date is the NEXT day. It belongs to the
// day it was filed.
{
  const evening = buildPeriodNarrative({
    periodFrom: '2026-09-01', periodTo: '2026-09-15',
    reports: [{ id: 'eve', date: '2026-09-16T02:00:00.000Z' }, { id: 'noon', date: '2026-09-15T19:00:00.000Z' }],
  });
  expect('an evening report counts on the day it was filed, not the UTC day after', [evening.reportCount, evening.workdayCount], [2, 1]);
}

// Boundary dates are INCLUSIVE — a report filed on the last day of the period
// belongs to that period, not the next one.
{
  const edge = buildPeriodNarrative({
    periodFrom: '2026-06-01', periodTo: '2026-06-30',
    reports: [{ id: 'a', date: '2026-06-01' }, { id: 'b', date: '2026-06-30' }, { id: 'c', date: '2026-07-01' }],
  });
  expect('period bounds are inclusive on both ends', edge.reportCount, 2);
}

console.log('\nportal owner — pay-app narrative (empty periods never invent content):');
{
  // Real window, zero matching rows.
  const empty = buildPeriodNarrative({ ...JUNE, reports: [REPORTS[0]], photos: [PHOTOS[0]], milestones: [MILESTONES[2]] });
  expect('empty period → no activity, gap reason, ZERO bullets',
    [empty.hasActivity, empty.gap, empty.bullets.length, empty.photoCount, empty.reportCount, empty.milestones.length],
    [false, 'no_activity', 0, 0, 0, 0]);
  ok('empty-period headline states the truth and names the dates',
    empty.headline.includes('Nothing was logged') && empty.headline.includes('Jun 1 – Jun 30, 2026'),
    `got: ${empty.headline}`);
  ok('empty-period headline does not claim the period covered anything',
    !/This billing period covers/.test(empty.headline), `got: ${empty.headline}`);
}
{
  // No window at all.
  const noPeriod = buildPeriodNarrative({ reports: REPORTS, photos: PHOTOS, milestones: MILESTONES });
  expect('unknown window → no_period gap, zero counts, zero bullets',
    [noPeriod.gap, noPeriod.hasActivity, noPeriod.bullets.length, noPeriod.photoCount, noPeriod.reportCount],
    ['no_period', false, 0, 0, 0]);
  ok('unknown-window headline asks for the dates instead of guessing',
    /doesn't say which dates/.test(noPeriod.headline), `got: ${noPeriod.headline}`);
}
{
  // Sources exist but the GC shares none of them — never cite invisible rows.
  const hidden = buildPeriodNarrative({
    ...JUNE, reports: REPORTS, photos: PHOTOS, milestones: MILESTONES,
    shared: { reports: false, photos: false, schedule: false },
  });
  expect('nothing shared → nothing_shared gap, zero bullets',
    [hidden.gap, hidden.hasActivity, hidden.bullets.length], ['nothing_shared', false, 0]);
}
{
  // Photos off, reports on: never promise photos the portal isn't showing.
  const noPhotos = buildPeriodNarrative({
    ...JUNE, reports: REPORTS, photos: PHOTOS, milestones: MILESTONES,
    shared: { photos: false },
  });
  expect('photos hidden → photo count is zero', noPhotos.photoCount, 0);
  ok('photos hidden → the PROSE never promises a photo',
    !/photo/i.test([noPhotos.headline, ...noPhotos.bullets].join(' ')),
    [noPhotos.headline, ...noPhotos.bullets].join(' | '));
  expect('photos hidden → no photo date range is claimed',
    [noPhotos.photoFrom, noPhotos.photoTo], [undefined, undefined]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. What's waiting on the owner
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — decision list (ranking):');

const DECISION_INPUT = {
  contract: { status: 'sent', needsSignature: true, sentAt: '2026-06-01' },
  changeOrders: [
    { id: 'co1', number: 4, description: 'Add radiant floor heat to the primary bath', status: 'submitted', changeAmount: 12400, dateSubmitted: '2026-06-05' },
    { id: 'co2', number: 5, description: 'Approved already', status: 'approved', changeAmount: 900, dateSubmitted: '2026-06-06' },
    { id: 'co3', number: 6, description: 'Older pending item', status: 'under_review', changeAmount: 300, dateSubmitted: '2026-05-20' },
  ],
  coApprovalEnabled: true,
  selections: [
    { id: 'sel-late', category: 'Bathroom Tile', dueDate: '2026-06-10', chosen: false },
    { id: 'sel-soon', category: 'Kitchen Cabinets', dueDate: '2026-06-18', chosen: false },
    { id: 'sel-far', category: 'Exterior Paint', dueDate: '2026-12-01', chosen: false },
    { id: 'sel-done', category: 'Front Door', dueDate: '2026-06-02', chosen: true },
  ],
  invoices: [
    { id: 'inv1', number: 12, status: 'sent', balance: 8000, dueDate: '2026-06-09' },
    { id: 'inv2', number: 11, status: 'paid', balance: 0, dueDate: '2026-05-01' },
    { id: 'inv3', number: 13, status: 'sent', balance: 0, dueDate: '2026-06-01' },
  ],
};

const D_JUN15 = buildOwnerDecisions({ today: '2026-06-15', ...DECISION_INPUT });

expect('settled items are excluded (approved CO, chosen selection, paid + zero-balance invoices)',
  D_JUN15.map(d => d.id).sort(),
  ['co1', 'co3', 'contract', 'inv1', 'sel-far', 'sel-late', 'sel-soon']);

expect('overdue first, then contract → CO → selection → invoice, then oldest',
  D_JUN15.map(d => `${d.id}:${d.urgency}`),
  [
    'sel-late:overdue',   // due Jun 10, 5 days past
    'inv1:overdue',       // due Jun 9, 6 days past
    'sel-soon:due_soon',  // due Jun 18, 3 days out
    'contract:waiting',
    'co3:waiting',        // waiting 26 days
    'co1:waiting',        // waiting 10 days
    'sel-far:waiting',
  ]);

ok('an overdue selection outranks the unsigned contract',
  D_JUN15.findIndex(d => d.id === 'sel-late') < D_JUN15.findIndex(d => d.id === 'contract'));
ok('the unsigned contract outranks a pending CO at the same severity',
  D_JUN15.findIndex(d => d.id === 'contract') < D_JUN15.findIndex(d => d.id === 'co1'));
ok('the longest-waiting CO sorts ahead of the newer one',
  D_JUN15.findIndex(d => d.id === 'co3') < D_JUN15.findIndex(d => d.id === 'co1'));

console.log('\nportal owner — decision list (aging):');

const at = (today: string, id: string): OwnerDecision | undefined =>
  buildOwnerDecisions({ today, ...DECISION_INPUT }).find(d => d.id === id);

expect('far from the deadline → waiting, no overdue count',
  [at('2026-05-01', 'sel-late')?.urgency, at('2026-05-01', 'sel-late')?.daysOverdue],
  ['waiting', undefined]);
expect(`inside ${DUE_SOON_DAYS} days → due_soon`,
  at('2026-06-05', 'sel-late')?.urgency, 'due_soon');
expect('on the due date itself → still due_soon, not overdue',
  at('2026-06-10', 'sel-late')?.urgency, 'due_soon');
expect('one day past → overdue with daysOverdue 1',
  [at('2026-06-11', 'sel-late')?.urgency, at('2026-06-11', 'sel-late')?.daysOverdue],
  ['overdue', 1]);
expect('thirty days past → daysOverdue 30',
  at('2026-07-10', 'sel-late')?.daysOverdue, 30);
expect('an undated pending CO ages via waitingDays, never claims a deadline',
  [at('2026-06-15', 'co1')?.urgency, at('2026-06-15', 'co1')?.waitingDays, at('2026-06-15', 'co1')?.dueDate],
  ['waiting', 10, undefined]);
expect('the contract ages too', at('2026-06-21', 'contract')?.waitingDays, 20);
expect('an undated selection never fabricates urgency',
  buildOwnerDecisions({ today: '2026-06-15', selections: [{ id: 's', category: 'Tile', chosen: false }] })[0].urgency,
  'waiting');
expect('empty input → empty list', buildOwnerDecisions({ today: '2026-06-15' }), []);
expect('roll-up counts the overdue items', summarizeOwnerDecisions(D_JUN15), '7 things need you · 2 past due');
expect('roll-up on an empty list says so', summarizeOwnerDecisions([]), 'Nothing needs you right now.');

// Prose must not bake a live day count — the static portal caches this list in
// a snapshot and re-ages it in the browser, so a baked "3 days past due" would
// contradict the live badge a week later.
ok('decision prose states fixed dates, never a live day count',
  D_JUN15.every(d => !/\b\d+\s+days?\s+(past due|late|ago)\b/i.test(d.detail)),
  D_JUN15.map(d => d.detail).join(' | '));

// ─────────────────────────────────────────────────────────────────────────────
// 4. Snapshot integration — the three payloads the portal actually renders
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — buildPortalSnapshot integration:');

ok('snapshot version bumped for the owner payloads', PORTAL_SNAPSHOT_VERSION >= 10,
  `PORTAL_SNAPSHOT_VERSION = ${PORTAL_SNAPSHOT_VERSION}`);

const project = {
  id: 'p1', name: 'Maple St Reno', type: 'renovation', status: 'in_progress',
  location: '12 Maple St',
  linkedEstimate: { grandTotal: 400000, baseTotal: 320000, items: [] },
  contractMode: 'fixed',
  schedule: {
    startDate: '2026-05-01', workingDaysPerWeek: 5, totalDurationDays: 120,
    tasks: [
      { id: 't1', title: 'Framing complete', phase: 'Structure', durationDays: 25, startDay: 1, progress: 100, status: 'done', isMilestone: true },
      { id: 't2', title: 'Rough electrical complete', phase: 'MEP', durationDays: 30, startDay: 1, progress: 100, status: 'done', isMilestone: true },
      { id: 't3', title: 'Drywall complete', phase: 'Finishes', durationDays: 90, startDay: 1, progress: 0, status: 'not_started', isMilestone: true },
    ],
  },
  updatedAt: '2026-06-15T00:00:00.000Z',
} as unknown as Project;

const portalSettings = {
  portalId: 'portal-abc', enabled: true,
  showSchedule: true, showBudgetSummary: true, showInvoices: true,
  showChangeOrders: true, showPhotos: true, showDailyReports: true,
  showPunchList: false, showRFIs: false, showDocuments: false,
  coApprovalEnabled: true,
} as unknown as ClientPortalSettings;

const payApps = [
  {
    id: 'aia1', projectId: 'p1', applicationNumber: 1, applicationDate: '2026-06-01', periodTo: '2026-05-31',
    ownerName: 'Owner', contractorName: 'GC', projectName: 'Maple St Reno',
    originalContractSum: 400000, netChangeByCO: 0, contractSumToDate: 400000,
    retainagePercent: 10, lessPreviousCertificates: 0,
    lines: [{ id: 'l1', itemNo: '06', description: 'Wood & Plastics', scheduledValue: 90000, fromPreviousApp: 0, thisPeriod: 40000, materialsPresentlyStored: 0, retainagePercent: 10 }],
    totals: { totalScheduledValue: 400000, totalCompletedAndStored: 40000, totalRetainage: 4000, totalEarnedLessRetainage: 36000, currentPaymentDue: 36000, balanceToFinish: 364000, percentComplete: 10 },
  },
  {
    id: 'aia2', projectId: 'p1', applicationNumber: 2, applicationDate: '2026-07-01', periodTo: '2026-06-30',
    ownerName: 'Owner', contractorName: 'GC', projectName: 'Maple St Reno',
    originalContractSum: 400000, netChangeByCO: 0, contractSumToDate: 400000,
    retainagePercent: 10, lessPreviousCertificates: 36000,
    lines: [{ id: 'l2', itemNo: '09', description: 'Finishes', scheduledValue: 120000, fromPreviousApp: 40000, thisPeriod: 14200, materialsPresentlyStored: 0, retainagePercent: 10 }],
    totals: { totalScheduledValue: 400000, totalCompletedAndStored: 54200, totalRetainage: 5420, totalEarnedLessRetainage: 48780, currentPaymentDue: 12780, balanceToFinish: 345800, percentComplete: 14 },
  },
] as unknown as SavedAIAPayApp[];

const snapshot = buildPortalSnapshot({
  project,
  portal: portalSettings,
  aiaPayApps: payApps,
  dailyReports: REPORTS.map(r => ({ ...r, projectId: 'p1', manpower: [] })) as unknown as DailyFieldReport[],
  photos: PHOTOS.filter(p => p.url).map((p, i) => ({ id: `ph${i}`, projectId: 'p1', uri: p.url, timestamp: p.timestamp })) as unknown as ProjectPhoto[],
  changeOrders: [
    { id: 'co1', projectId: 'p1', number: 4, description: 'Add radiant floor heat', reason: 'Owner request after tile selection', date: '2026-06-05', status: 'submitted', changeAmount: 12400, newContractTotal: 412400, scheduleImpactDays: 4, lineItems: [] },
  ] as unknown as ChangeOrder[],
  selections: [
    {
      id: 'sel-late', projectId: 'p1', userId: 'u1', category: 'Bathroom Tile',
      styleBrief: 'warm neutral', budget: 4200, dueDate: '2026-06-10',
      status: 'pending', notes: '', displayOrder: 0,
      createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z',
      options: [{ id: 'o1', productName: 'Zellige 4x4', brand: 'Clé', description: '', unitPrice: 22, unit: 'sf', quantity: 180, total: 3960, supplier: 'Tile Co', highlights: [], isChosen: false }],
    },
  ] as unknown as SelectionCategory[],
  // Review of B3a (2026-09-05): the portal pill must read the status the app
  // computes. #7 is the worked invoice — settled at $90,000 with $10,000 held,
  // then released — whose stored 'paid' hid the reopened balance; #8 is simply
  // unpaid and past due.
  invoices: [
    {
      id: 'inv-released', number: 7, projectId: 'p1', type: 'progress', issueDate: '2026-05-01', dueDate: '2026-05-31',
      paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 100_000, taxRate: 0, taxAmount: 0,
      totalDue: 100_000, amountPaid: 90_000, status: 'paid', payments: [],
      retentionPercent: 10, retentionAmount: 10_000, retentionReleased: 10_000,
      createdAt: '2026-05-01', updatedAt: '2026-06-10',
    },
    {
      id: 'inv-late', number: 8, projectId: 'p1', type: 'progress', issueDate: '2026-05-01', dueDate: '2026-05-31',
      paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 20_000, taxRate: 0, taxAmount: 0,
      totalDue: 20_000, amountPaid: 0, status: 'sent', payments: [],
      createdAt: '2026-05-01', updatedAt: '2026-05-01',
    },
  ] as unknown as Invoice[],
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon',
});

// Review of B3a — the client sees the status the GC sees.
{
  const snapInvs = snapshot.sections.invoices ?? [];
  const released = snapInvs.find(i => i.id === 'inv-released');
  const late = snapInvs.find(i => i.id === 'inv-late');
  expect('snapshot invoices carry effectiveStatus (stored paid + released, unpaid retention → partially_paid)',
    released?.effectiveStatus, 'partially_paid');
  expect('…while the stored status is still carried for older portal builds', released?.status, 'paid');
  expect('…and the reopened $10,000 is the balance the portal shows', released?.balance, 10_000);
  expect('…with retentionReleased alongside so the drawer shows what is still held', released?.retentionReleased, 10_000);
  ok('…and nothing is reported as still held once it is all released', released?.retentionHeld === undefined,
    JSON.stringify(released?.retentionHeld));
  expect('an unpaid invoice past its due date reads overdue', late?.effectiveStatus, 'overdue');
}

// Job 3 — the mapping that never existed.
expect('SelectionCategory.dueDate now reaches the snapshot',
  snapshot.selections?.[0]?.dueDate, '2026-06-10');

// Job 2 — derived window + grounded narrative.
const aia2 = snapshot.sections.aiaPayApps?.find(a => a.id === 'aia2');
expect('pay app #2 gets a derived periodFrom (day after #1 ended)', aia2?.periodFrom, '2026-06-01');
expect('pay app #2 narrative counts only its own window',
  [aia2?.narrative?.reportCount, aia2?.narrative?.photoCount], [3, 3]);
ok('pay app #2 narrative cites the milestones that completed in June',
  (aia2?.narrative?.milestones ?? []).join('|') === 'Framing complete|Rough electrical complete',
  JSON.stringify(aia2?.narrative?.milestones));
const aia1 = snapshot.sections.aiaPayApps?.find(a => a.id === 'aia1');
expect('pay app #1 anchors to the project start', aia1?.periodFrom, '2026-05-01');
ok('pay app #1 does not borrow app #2 activity',
  (aia1?.narrative?.photoCount ?? 0) === 1 && (aia1?.narrative?.reportCount ?? 0) === 1,
  JSON.stringify({ photos: aia1?.narrative?.photoCount, reports: aia1?.narrative?.reportCount }));

// Job 1 — the record the homeowner signs.
const snapCO = snapshot.sections.changeOrders?.[0];
expect('the signable CO record carries the contract-level terms',
  [snapCO?.changeAmount, snapCO?.newContractTotal, snapCO?.scheduleImpactDays],
  [12400, 412400, 4]);

// Ranked decisions ride along in the snapshot.
ok('snapshot carries a ranked ownerDecisions list',
  (snapshot.ownerDecisions?.length ?? 0) >= 2, JSON.stringify(snapshot.ownerDecisions?.map(d => d.id)));
ok('the overdue tile selection is in the list',
  !!snapshot.ownerDecisions?.some(d => d.id === 'sel-late'));

// ─────────────────────────────────────────────────────────────────────────────
// 5. HARD CONSTRAINT — no cost / markup / margin reaches the owner payloads
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — client-facing safety (no cost / markup / margin):');

const narrativePayloads = (snapshot.sections.aiaPayApps ?? []).map(a => a.narrative);
expect('pay-app narratives expose no cost/markup/margin keys', forbiddenKeys(narrativePayloads), []);
expect('ownerDecisions expose no cost/markup/margin keys', forbiddenKeys(snapshot.ownerDecisions), []);
expect('the standalone narrative builder exposes none either', forbiddenKeys(n), []);
expect('the standalone decision builder exposes none either', forbiddenKeys(D_JUN15), []);

// Value-level: the SOV lines fed into this snapshot carry real dollars
// ($14,200 this period, $120,000 scheduled). None of them may surface in the
// prose that sits above the table.
const narrativeText = allStrings(narrativePayloads).join(' ');
ok('no dollar figure appears anywhere in the narrative prose',
  !/\$|\b\d{1,3}(,\d{3})+\b/.test(narrativeText), narrativeText.slice(0, 240));
ok('no supplier / vendor name appears in the narrative prose',
  !/Tile Co|Clé/.test(narrativeText));
ok('no SOV line description leaks into the narrative prose',
  !/Wood & Plastics|Finishes/.test(narrativeText));

// The decision list may name contract-level dollars the owner already sees (a
// change-order delta, an invoice balance) — but only under the key `amount`.
const decisionMoneyKeys = new Set<string>();
for (const d of D_JUN15) {
  for (const [k, v] of Object.entries(d)) if (typeof v === 'number' && /amount|total|price|value|sum/i.test(k)) decisionMoneyKeys.add(k);
}
expect('the only money key on a decision is the contract-level `amount`',
  [...decisionMoneyKeys].sort(), ['amount']);

// The open-book exception is deliberate and must stay EXACTLY as narrow as it
// is: committed/actual costs surface only for gmp / open_book contracts.
expect('a fixed-price project gets NO openBook block', snapshot.openBook, undefined);
{
  const gmp = buildPortalSnapshot({
    project: { ...project, contractMode: 'gmp' } as unknown as Project,
    portal: portalSettings,
  });
  expect('gmp without commitments still gets no openBook block', gmp.openBook, undefined);
}
{
  // Cost-plus with every cost self-performed (no commitments): the owner is
  // owed cost-to-date. It used to be hidden because the block required
  // commitments (integration round 1, money-accounts).
  const receipt = {
    id: 'r1', projectId: project.id, vendor: 'Supply Co',
    lines: [{ id: 'rl1', description: 'Lumber', category: 'Materials', quantity: 1, unit: 'ls', unitPrice: 4200, lineTotal: 4200 }],
    subtotal: 4200, total: 4200, status: 'reviewed',
  };
  const selfPerform = buildPortalSnapshot({
    project: { ...project, contractMode: 'open_book' } as unknown as Project,
    portal: portalSettings,
    commitments: [],
    costSources: { receipts: [receipt] } as never,
  });
  expect('open-book with only self-performed costs gets the block', selfPerform.openBook?.actual, 4200);
  const empty = buildPortalSnapshot({
    project: { ...project, contractMode: 'open_book' } as unknown as Project,
    portal: portalSettings,
    commitments: [],
    costSources: { receipts: [] } as never,
  });
  expect('…but nothing logged anywhere is still no block ($0/$0 is not a picture)', empty.openBook, undefined);
}

// ── NEGATIVE TEST ────────────────────────────────────────────────────────────
// A scanner that has quietly stopped scanning passes every positive assertion
// above. Feed it deliberately poisoned payloads and require it to FAIL.
{
  const poisonedNarrative = { ...n, lineItems: [{ description: 'Finishes', unitCost: 118.4, markupPercent: 22 }] };
  const hits = forbiddenKeys(poisonedNarrative);
  ok('NEGATIVE: scanner catches a cost key smuggled into a narrative',
    hits.includes('$.lineItems[0].unitCost'), `hits: ${JSON.stringify(hits)}`);
  ok('NEGATIVE: scanner catches a markup key too',
    hits.includes('$.lineItems[0].markupPercent'), `hits: ${JSON.stringify(hits)}`);
}
{
  const poisonedDecision = [{ ...D_JUN15[0], grossMargin: 0.18 }];
  ok('NEGATIVE: scanner catches a margin key on a decision',
    forbiddenKeys(poisonedDecision).includes('$[0].grossMargin'));
}
{
  // Nested three levels down, the shape the real snapshot actually has.
  const poisonedSnapshot = {
    sections: { aiaPayApps: [{ id: 'a', narrative: { headline: 'x', supplier: 'Ferguson' } }] },
  };
  ok('NEGATIVE: scanner catches a supplier name nested inside sections',
    forbiddenKeys(poisonedSnapshot).includes('$.sections.aiaPayApps[0].narrative.supplier'));
}
ok('NEGATIVE: the dollar-figure check actually fires on a leaked figure',
  /\$|\b\d{1,3}(,\d{3})+\b/.test('This period covers $14,200 of finishes.'));

// ─────────────────────────────────────────────────────────────────────────────
// 6. Change-order e-signature — drift guards
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — change-order e-signature:');

const portalHtml = read('marketing/portal/index.html');

// Review of B3a (2026-09-05) — the static portal renders the money the way the
// app computes it: the pill from effectiveStatus, retainage as what is still
// HELD, and a pay app the webhook stamped paidAt as Paid, never as a Pay button.
{
  ok('portal invoice card derives its pill from effectiveStatus (stored status is the fallback)',
    /var invStatus = i\.effectiveStatus \|\| i\.status;/.test(portalHtml) && /statusPillClass\(invStatus\)/.test(portalHtml));
  ok('portal invoice drawer does the same',
    /var invStatus = inv\.effectiveStatus \|\| inv\.status;/.test(portalHtml));
  ok('portal invoice drawer renders retainage as the pending amount (retentionAmount − retentionReleased)',
    /inv\.retentionAmount - retentionReleased/.test(portalHtml) && /Retainage held/.test(portalHtml));
  ok('…and never subtracts the ORIGINAL withholding',
    !/fmtMoney\(inv\.retentionAmount, \{dec:2\}\)/.test(portalHtml));
  // 2026-09-11 (AIA wave): these two used to pin the literal expressions
  // `var aiaPaid = !!a.paidAt;` / `var canPay = !aiaPaid && !!a.payLinkUrl &&
  // due > 0;`. The BEHAVIOUR they protect — a pay app the webhook stamped
  // paidAt is Paid and never payable — is unchanged and now strictly stronger:
  // both render sites go through one `aiaCanPay`, which also refuses a period
  // whose INVOICE is settled (the second live Pay button for one obligation)
  // and a link minted for an amount that is no longer what is owed (MONEY-F2,
  // the guard the invoice button had and this one did not). Pinning the old
  // source text would have kept the guard green only for the broken version.
  // scripts/validate-invoice-billing.ts LIFTS these functions out of the page
  // and executes them; what is checked here is that both sites call them.
  ok('portal AIA card shows Paid for a pay app with paidAt instead of a Pay button',
    /var aiaPaid = aiaIsPaid\(a\);/.test(portalHtml) && /var canPay = aiaCanPay\(a\);/.test(portalHtml)
    && /function aiaIsPaid\(a\) \{[\s\S]{0,200}!!a\.paidAt/.test(portalHtml));
  ok('portal AIA drawer footer shows Paid for a pay app with paidAt',
    /var aiaCanPayNow = aiaCanPay\(a\);/.test(portalHtml) && /Paid ' \+ fmtDate\(a\.paidAt\)/.test(portalHtml));
}
ok('portal/index.html loaded', portalHtml.length > 0);

// The regression this whole job exists to prevent.
const coHandler = (() => {
  const start = portalHtml.indexOf('function handleCODecision');
  const end = portalHtml.indexOf('function bindCOHandlers', start);
  return start >= 0 && end > start ? portalHtml.slice(start, end) : '';
})();
ok('handleCODecision() exists', coHandler.length > 0);
ok('CO approval NO LONGER uses confirm()', !/\bconfirm\s*\(/.test(coHandler),
  'a browser confirm() is a consent click, not an electronic signature');
ok('CO approval NO LONGER uses prompt() to capture the signer',
  !/\bprompt\s*\(/.test(coHandler));
ok('CO approval opens the review-and-sign modal', /showCOSignModal\s*\(/.test(coHandler));
ok('CO approval builds + hashes a canonical consent record',
  /buildCOConsentRecord\s*\(/.test(coHandler) && /sha256Hex\s*\(/.test(coHandler));
ok('CO approval submits through the sealed RPC',
  /postCOApprovalSigned\s*\(/.test(coHandler));

for (const needle of [
  'function attachSignaturePad',    // drawn signature
  'esign-consent-check',            // affirmative consent
  'esign-pad',                      // the canvas itself
  'esign-reason',                   // decline stays easy, with a reason
  '/rest/v1/rpc/portal_submit_co_approval_signed',
]) {
  ok(`portal ships ${needle}`, portalHtml.includes(needle));
}
ok('portal still calls the legacy CO RPC as a pre-migration fallback',
  portalHtml.includes('/rest/v1/rpc/portal_submit_co_approval\''));

// The disclosure the signer accepts must be byte-identical across the two
// surfaces — a record that hashes differently in the app and the browser is not
// re-verifiable, which is the entire point of sealing it.
{
  const slice = portalHtml.slice(portalHtml.indexOf('var ESIGN_DISCLOSURE_TEXT ='));
  const body = slice.slice(0, slice.indexOf(';'));
  const joined = (body.match(/'([^']*)'/g) ?? []).map(s => s.slice(1, -1)).join('');
  expect('portal disclosure text matches utils/portalOwnerCore.ts exactly', joined, ESIGN_DISCLOSURE_TEXT);
  ok('portal disclosure version matches',
    portalHtml.includes(`var ESIGN_DISCLOSURE_VERSION = '${ESIGN_DISCLOSURE_VERSION}'`));
  // The disclosure describes the ACT the signer is performing and the rights
  // they keep. It deliberately does NOT tell them what a statute makes of it —
  // MAGE ships without legal review, so it does not state the law.
  ok('the disclosure names the act of signing electronically',
    /consent to sign this change order electronically/.test(ESIGN_DISCLOSURE_TEXT));
  ok('the disclosure states what is being approved',
    /approving the scope described above/.test(ESIGN_DISCLOSURE_TEXT));
  ok('the disclosure offers a paper copy at no charge',
    /paper copy at no charge/.test(ESIGN_DISCLOSURE_TEXT));
  ok('the disclosure says a copy is retained and available',
    /retained by your contractor and is available to you/.test(ESIGN_DISCLOSURE_TEXT));
  ok('the disclosure cites no statute and claims no legal effect',
    !/E-?SIGN|UETA|U\.S\.C|legal effect|legally binding|same (force|effect) as/i.test(ESIGN_DISCLOSURE_TEXT),
    ESIGN_DISCLOSURE_TEXT);
  ok('NEGATIVE: that check fires on the statutory sentence it replaced',
    /E-?SIGN|UETA|legal effect/i.test(
      'Your electronic signature has the same legal effect as a handwritten one under the U.S. E-SIGN Act and UETA.'));
  ok('the portal shows no statutory claim next to the signature either',
    !/E-SIGN Act and UETA/.test(portalHtml), 'marketing/portal/index.html');
}

// Canonical record: order-fixed, carries every element a dispute needs.
{
  const record = buildCOConsentRecord({
    changeOrderId: 'co1', changeOrderNumber: 4,
    description: 'Add radiant floor heat to the primary bath',
    changeAmount: 12400, newContractTotal: 412400,
    decision: 'approved', signerName: 'Dana Reyes',
    signatureHash: 'a'.repeat(64), signatureStrokeCount: 5,
    portalId: 'portal-abc', signedAt: '2026-06-15T18:04:00.000Z',
    userAgent: 'Mozilla/5.0', timezoneOffsetMinutes: -240,
  });
  const lines = record.split('\n');
  expect('record header is stable', lines[0], 'MAGE ID CHANGE ORDER ELECTRONIC SIGNATURE RECORD');
  expect('record is versioned on line 2', lines[1], `version: ${ESIGN_DISCLOSURE_VERSION}`);
  for (const field of [
    'decision: approved', 'change_order_id: co1', 'change_amount_usd: 12400.00',
    'new_contract_total_usd: 412400.00', 'signer_name: Dana Reyes',
    'signed_at: 2026-06-15T18:04:00.000Z', 'signature_sha256: ' + 'a'.repeat(64),
    'signature_strokes: 5',
  ]) {
    ok(`record carries "${field.split(':')[0]}"`, record.includes(field));
  }
  ok('record embeds the full disclosure the signer saw',
    record.includes(`consent_disclosure: ${ESIGN_DISCLOSURE_TEXT}`));
  // Deterministic: same input, same bytes — otherwise the hash is meaningless.
  const again = buildCOConsentRecord({
    changeOrderId: 'co1', changeOrderNumber: 4,
    description: 'Add radiant floor heat to the primary bath',
    changeAmount: 12400, newContractTotal: 412400,
    decision: 'approved', signerName: 'Dana Reyes',
    signatureHash: 'a'.repeat(64), signatureStrokeCount: 5,
    portalId: 'portal-abc', signedAt: '2026-06-15T18:04:00.000Z',
    userAgent: 'Mozilla/5.0', timezoneOffsetMinutes: -240,
  });
  expect('record is byte-deterministic', again, record);

  const declined = buildCOConsentRecord({
    changeOrderId: 'co1', changeOrderNumber: 4, description: 'Add radiant floor heat',
    changeAmount: 12400, decision: 'declined', signerName: 'Dana Reyes',
    reason: 'Too expensive — please re-price without the primary bath.',
    portalId: 'portal-abc', signedAt: '2026-06-15T18:04:00.000Z',
  });
  ok('a decline record captures the reason and carries no signature fields',
    declined.includes('decline_reason: Too expensive') &&
    !declined.includes('signature_sha256') && !declined.includes('signature_strokes'));

  // The consent record is itself a client-facing artifact.
  ok('the consent record contains no cost/markup/margin language',
    !/unit cost|markup|margin|gross profit/i.test(record));

  // ── Cross-runtime equivalence ──────────────────────────────────────────────
  // The static portal cannot import the TS module (no build step), so it ships
  // its own hand-written copy of buildCOConsentRecord. The seal is only
  // re-verifiable if BOTH copies emit the same bytes for the same decision, so
  // we lift the portal's copy out of the HTML and run it head-to-head. A silent
  // divergence here would make a browser-signed CO unverifiable against an
  // app-signed one — exactly the failure a sealed record exists to prevent.
  const start = portalHtml.indexOf(`var ESIGN_DISCLOSURE_VERSION = '${ESIGN_DISCLOSURE_VERSION}';`);
  const stop = portalHtml.indexOf('// Canvas signature pad.', start);
  ok('portal e-signature block is extractable for a head-to-head check', start >= 0 && stop > start);
  if (start >= 0 && stop > start) {
    const src = `${portalHtml.slice(start, stop)}\nreturn buildCOConsentRecord;`;
    // eslint-disable-next-line no-new-func
    const portalBuild = new Function(src)() as (f: Record<string, unknown>) => string;
    const args = {
      changeOrderId: 'co1', changeOrderNumber: 4,
      description: '  Add   radiant floor heat to the primary bath  ',
      changeAmount: 12400, newContractTotal: 412400,
      decision: 'approved' as const, signerName: '  Dana Reyes ',
      signatureHash: 'b'.repeat(64), signatureStrokeCount: 7,
      portalId: 'portal-abc', signedAt: '2026-06-15T18:04:00.000Z',
      userAgent: 'Mozilla/5.0 (iPhone)', timezoneOffsetMinutes: -240,
    };
    expect('portal and app emit byte-identical consent records (approval)',
      portalBuild(args), buildCOConsentRecord(args));
    const declineArgs = {
      changeOrderId: 'co1', changeOrderNumber: 4, description: 'Add radiant floor heat',
      changeAmount: 12400, decision: 'declined' as const, signerName: 'Dana Reyes',
      reason: 'Too expensive — please re-price.', portalId: 'portal-abc',
      signedAt: '2026-06-15T18:04:00.000Z', userAgent: 'Mozilla/5.0',
    };
    expect('portal and app emit byte-identical consent records (decline)',
      portalBuild(declineArgs), buildCOConsentRecord(declineArgs));
  }
}

// The seal has to land somewhere. Pin the migration that gives it a home.
{
  const mig = read('supabase/migrations/20260803120500_portal_co_esignature.sql');
  ok('CO e-signature migration present', mig.length > 0);
  ok('migration creates the token-gated signed RPC',
    /create or replace function public\.portal_submit_co_approval_signed\(/.test(mig));
  ok('migration gates on the portal accessToken like every other portal RPC',
    /portal_project_for_token\(p_portal_id, p_access_token\)/.test(mig));
  ok('migration RE-HASHES the consent record server-side',
    /digest\(p_consent_record, 'sha256'\)/.test(mig));
  ok('migration refuses a client/server hash mismatch',
    /hash_mismatch/.test(mig));
  ok('migration refuses an approval without consent, signature, and name',
    /esign_consent_required/.test(mig) && /esign_signature_required/.test(mig) && /esign_signer_name_required/.test(mig));
  ok('migration keeps declining easy but requires a reason',
    /decline_reason_required/.test(mig));
  ok('migration appends a real audit entry to change_orders.audit_trail',
    /audit_trail = coalesce\(audit_trail, '\[\]'::jsonb\) \|\| jsonb_build_array/.test(mig));
  ok('migration grants execute to anon (the homeowner has no MAGE account)',
    /grant execute on function public\.portal_submit_co_approval_signed\(/.test(mig));
}

// The in-app viewer must write the same audit entry it always has — it was the
// ONLY code path in the app touching auditTrail, and now the portal writes them
// too, so both must keep doing it.
{
  const cv = read('app/client-view.tsx');
  ok('client-view still writes an auditTrail entry', /auditTrail: \[\.\.\.existingAudit, auditEntry\]/.test(cv));
  ok('client-view builds the shared consent record', /buildCOConsentRecord\(/.test(cv));
  ok('client-view requires the signing-consent checkbox before approving',
    /!esignConsent/.test(cv) && /Consent Required/.test(cv));
  ok('client-view persists the sealed record columns',
    /consent_record:/.test(cv) && /document_hash:/.test(cv));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6b. PROPOSAL ACCEPTANCE — the portal's third write path (2026-09-13)
//
// The homeowner could read everything and act on almost nothing: approve a
// change order, pay an invoice, and that was the list. Accepting the PROPOSAL
// is the decision that starts the job, and three cheaper competitors ship it.
//
// What is pinned here is not "the feature exists" — it is the two properties
// that make an acceptance worth anything:
//
//   A. THE SIGNATURE BINDS TO A DOCUMENT THE CONTRACTOR PUBLISHED. The portal
//      is a 192-bit token in a link and nothing else, so every byte the RPC
//      receives is attacker-controlled. There is no proposal ROW to join to
//      (an estimate lives inside project_financials.linked_estimate), so the
//      binding is: buildPortalProposal writes a canonical `documentText` into
//      the snapshot, the server hashes ITS copy of that text, and the signed
//      consent record must carry that digest on its own line. If the record
//      format and the SQL's line match ever drift, every acceptance fails
//      closed — but a drift in the OTHER direction (the SQL check quietly
//      passing on a record that no longer names the document) is the one that
//      would matter, so the exact substring the SQL greps for is asserted here
//      against a record the shipped builder produced.
//
//   B. THE CLIENT-FACING BOUNDARY HOLDS. The proposal is a projection of the
//      contractor's estimate — the object that DOES carry unit prices, markup
//      and suppliers — so the deep key scan and a value-level scan both run
//      over it, against a fixture whose estimate really does contain those.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — proposal acceptance:');

const PROPOSAL_EST = {
  id: 'est-77', createdAt: '2026-05-02T00:00:00.000Z',
  globalMarkup: 25, baseTotal: 320000, markupTotal: 80000, grandTotal: 400000,
  items: [
    { materialId: 'm1', name: 'Slab on grade', category: 'concrete', unit: 'sf', quantity: 1200, unitPrice: 9.5, bulkPrice: 9, markup: 25, usesBulk: false, lineTotal: 11400, supplier: 'Ferguson', csiDivision: '03' },
    { materialId: 'm2', name: 'Framing package', category: 'lumber', unit: 'ls', quantity: 1, unitPrice: 240000, bulkPrice: 0, markup: 25, usesBulk: false, lineTotal: 240000, supplier: 'BMC Lumber', csiDivision: '06' },
    { materialId: 'm3', name: 'Bathroom tile allowance', category: 'finishes', unit: 'ls', quantity: 1, unitPrice: 68600, bulkPrice: 0, markup: 25, usesBulk: false, lineTotal: 68600, supplier: 'Clé', csiDivision: '09', isAllowance: true },
  ],
};

const proposalProject = {
  ...project,
  linkedEstimate: PROPOSAL_EST,
} as unknown as Project;

// Direction B (2026-09-17): the proposal prints ONLY the portal's own stamp
// of the GC's terms. The shared fixture is stamped 25 / 65 / 10, so every check
// below runs against a proposal a homeowner can actually accept.
const PROPOSAL_STAMP = { depositPct: 25, progressPct: 65, finalPct: 10, confirmedAt: '2026-09-17T12:00:00.000Z' };
const proposalPortal = {
  ...portalSettings, proposalApprovalEnabled: true, proposalPaymentTerms: PROPOSAL_STAMP,
} as unknown as ClientPortalSettings;

const buildProposalSnapshot = (
  p: Project = proposalProject,
  pt: ClientPortalSettings = proposalPortal,
  extra: Record<string, unknown> = {},
) => buildPortalSnapshot({
  project: p, portal: pt,
  settings: { branding: { companyName: 'Ridgeline Builders' } } as never,
  supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon',
  ...extra,
});

// ── The gate ────────────────────────────────────────────────────────────────
{
  // The toggle, isolated. The shared `snapshot` fixture above ALSO has no
  // proposal, but its estimate has no id — so asserting on it would pass with
  // the toggle deleted. Mutation-checked 2026-09-13: removing
  // `if (!portal.proposalApprovalEnabled) return undefined` left the shared
  // fixture green and only this pair turns red.
  const off = buildProposalSnapshot(proposalProject,
    { ...portalSettings, proposalApprovalEnabled: false } as unknown as ClientPortalSettings);
  ok('a portal with the toggle OFF ships no proposal at all',
    off.proposal === undefined, JSON.stringify(off.proposal?.id));
  const missing = buildProposalSnapshot(proposalProject,
    { ...portalSettings } as unknown as ClientPortalSettings);
  ok('…and so does one that never heard of the toggle',
    missing.proposal === undefined, JSON.stringify(missing.proposal?.id));
}
{
  const on = buildProposalSnapshot();
  ok('turning proposalApprovalEnabled on ships one', !!on.proposal);
  expect('…for the estimate the contractor priced', on.proposal?.id, 'est-77');
}
{
  const noId = buildProposalSnapshot(
    { ...proposalProject, linkedEstimate: { ...PROPOSAL_EST, id: '' } } as unknown as Project);
  ok('an estimate with no id ships NO proposal (nothing stable to bind a signature to)',
    noId.proposal === undefined, JSON.stringify(noId.proposal));
}
{
  const zero = buildProposalSnapshot(
    { ...proposalProject, linkedEstimate: { ...PROPOSAL_EST, grandTotal: 0, items: [] } } as unknown as Project);
  ok('a $0 estimate ships no proposal', zero.proposal === undefined);
}
for (const status of ['sent', 'signed'] as const) {
  const withContract = buildProposalSnapshot(proposalProject, proposalPortal, {
    contract: { id: 'k1', status, contractValue: 400000, title: 'Construction Agreement', updatedAt: '2026-06-01' },
  });
  ok(`a contract already ${status} supersedes the proposal — it is not shown`,
    withContract.proposal === undefined, JSON.stringify(withContract.proposal?.id));
}

// ── THE SCOPE HAS TO DESCRIBE THE WORK ──────────────────────────────────────
//
// The fixture above stamps a csiDivision on every item, which is exactly why
// nothing here caught this. The app's OWN builders do not:
// app/(tabs)/estimate/full.tsx buildLinkedEstimate (:1021-1088) sets
// csiDivision on no item at all, and app/(tabs)/estimate/review.tsx sets
// `csiDivision: undefined` on every labor row (:221) and every assembly row
// (:229). groupByCSIDivision buckets all of that into one unassigned group, so
// on the mainline path a $400,000 estimate produced a proposal whose ENTIRE
// scope was `scope: Other scope — 400000.00` — and that line is the text the
// homeowner's signature binds to.
//
// A one-line "Other scope" is not a scope description, so it is refused, and
// the setup row says which condition fired.
{
  const unclassified = {
    ...PROPOSAL_EST,
    items: PROPOSAL_EST.items.map(i => ({ ...i, csiDivision: undefined })),
  };
  const p = { ...proposalProject, linkedEstimate: unclassified } as unknown as Project;

  // NEGATIVE FIRST — prove the fixture really does degenerate the way the app
  // does, or the refusal below proves nothing.
  const view = toClientEstimateView(unclassified as never);
  expect('NEGATIVE: an estimate with no CSI divisions really does roll up to ONE group',
    view.scopeGroups.map(g => `${g.key}:${g.total}`), ['other:400000']);

  const blocked = proposalBlockReason(p);
  expect('an estimate with no trade assignment is refused, with a reason',
    blocked?.code, 'scope-unclassified');
  ok('…and the reason names what the homeowner would otherwise have signed',
    /Other scope/.test(blocked?.gc ?? ''), blocked?.gc);
  ok('…and buildPortalSnapshot ships no proposal for it',
    buildProposalSnapshot(p).proposal === undefined,
    JSON.stringify(buildProposalSnapshot(p).proposal?.scope));
  // The mixed case still ships: one unassigned bucket alongside real trades is
  // a scope description with a catch-all in it, which is normal and fine.
  const mixed = {
    ...PROPOSAL_EST,
    items: [PROPOSAL_EST.items[0], { ...PROPOSAL_EST.items[1], csiDivision: undefined }],
  };
  const mixedSnap = buildProposalSnapshot(
    { ...proposalProject, linkedEstimate: mixed } as unknown as Project);
  ok('…but a real trade line plus an "Other scope" catch-all still ships',
    (mixedSnap.proposal?.scope.length ?? 0) === 2,
    JSON.stringify(mixedSnap.proposal?.scope));
}
{
  // grandTotal above zero, every item priced at zero. Measured before the fix:
  // the homeowner got "Fixed price $50,000", a payment table and a live accept
  // button with NO "What is included" block at all, under a consent box
  // reading "you are accepting the scope and the fixed price shown above".
  const hollow = { ...PROPOSAL_EST, baseTotal: 0, markupTotal: 50000, grandTotal: 50000, items: [] };
  const p = { ...proposalProject, linkedEstimate: hollow } as unknown as Project;
  expect('NEGATIVE: this shape really does produce a priced view with no scope',
    [toClientEstimateView(hollow as never).projectTotal,
      toClientEstimateView(hollow as never).scopeGroups.length],
    [50000, 0]);
  expect('a priced estimate with NO scope lines is refused', proposalBlockReason(p)?.code, 'scope-unclassified');
  ok('…and ships no proposal', buildProposalSnapshot(p).proposal === undefined);
}
{
  // A finished job has nothing to accept. Measured before the fix: a project
  // with status 'completed' and a substantial-completion date shipped BOTH the
  // proposal (total 400000, "accept to get started") and the feedback ask
  // ("your contractor has recorded substantial completion") in one snapshot.
  const done = { ...proposalProject, status: 'completed', substantialCompletionDate: '2026-08-01' } as unknown as Project;
  expect('a completed job is refused', proposalBlockReason(done)?.code, 'job-complete');
  const snap = buildProposalSnapshot(done);
  ok('…and its snapshot carries the completion ask WITHOUT a proposal beside it',
    snap.proposal === undefined && !!snap.feedbackAsk,
    JSON.stringify({ proposal: snap.proposal?.id, ask: snap.feedbackAsk }));
  const closed = { ...proposalProject, status: 'closed' } as unknown as Project;
  expect('…and so is a closed one', proposalBlockReason(closed)?.code, 'job-complete');
}
{
  expect('the contract reason is the same function the switch reads',
    proposalBlockReason(proposalProject, { id: 'k1', status: 'sent' } as never)?.code,
    'contract-superseded');
  expect('a project with no estimate reports no-estimate',
    proposalBlockReason({ ...proposalProject, linkedEstimate: undefined } as unknown as Project)?.code,
    'no-estimate');
  ok('a healthy project is not blocked', proposalBlockReason(proposalProject) === undefined);
}

// ── A CREDIT IS SCOPE, AND IT MUST REACH THE DOCUMENT ───────────────────────
//
// An owner-supplied credit in its own CSI division used to be dropped by
// clientEstimateView's `g.total > 0` filter, and the drift fold then ADDED its
// magnitude to the largest surviving group. Measured 2026-09-13 before the
// fix: framing $10,000 in div 06 plus a −$1,000 credit in div 01 rendered, and
// would have been SIGNED, as `scope: 06 Wood, Plastics, and Composites —
// 9000.00`. Total right; scope line overstated by the credit; the credit
// itself absent from the document the homeowner accepts.
{
  const mk = (over: Record<string, unknown>) => ({
    materialId: 'x', name: 'n', category: 'c', unit: 'ls', quantity: 1,
    unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, supplier: '', ...over,
  });
  const credited = {
    id: 'est-credit', createdAt: '2026-05-02T00:00:00.000Z',
    globalMarkup: 0, baseTotal: 9000, markupTotal: 0, grandTotal: 9000,
    items: [
      mk({ name: 'Framing', lineTotal: 10000, csiDivision: '06' }),
      mk({ name: 'Owner-supplied appliance credit', lineTotal: -1000, csiDivision: '01' }),
    ],
  };
  const p = buildProposalSnapshot(
    { ...proposalProject, linkedEstimate: credited } as unknown as Project).proposal!;
  ok('the credit survives as its own scope line', !!p, 'no proposal at all');
  expect('…and the trade line is NOT inflated by it',
    p.scope.find(g => g.key === '06')?.total, 10000);
  expect('…and the credit itself is a line the homeowner can read',
    p.scope.find(g => g.key === '01')?.total, -1000);
  expect('…and they still tie out to the price being accepted',
    p.scope.reduce((s, g) => s + g.total, 0), p.total);
  ok('…and BOTH lines are in the text the signature binds to',
    p.documentText.includes('— 10000.00') && p.documentText.includes('— -1000.00'),
    p.documentText);
}

// ── The numbers the homeowner reads ─────────────────────────────────────────
{
  const p = buildProposalSnapshot().proposal!;
  const groupSum = p.scope.reduce((s, g) => s + g.total, 0);
  expect('the scope groups sum EXACTLY to the price being accepted', groupSum, p.total);
  expect('…which is the estimate grand total, markup already inside it', p.total, 400000);
  expect('the line COUNT ships, never the lines', p.lineCount, 3);
  ok('the allowance line is carried so the homeowner knows what is still open',
    p.allowances.length === 1 && p.allowances[0].name === 'Bathroom tile allowance',
    JSON.stringify(p.allowances));
  ok('a payment schedule ships', p.payment.length >= 2, JSON.stringify(p.payment));
}

// ── DIRECTION B: THE PAYMENT SCHEDULE IS THE GC'S, FROZEN PER PORTAL ────────
//
// Until 2026-09-17 every proposal printed clientEstimateView.defaultPaymentSchedule
// — a 10% deposit nobody chose — while the PDF said 25 / 65 / 10 and the
// contract said 25 / 25 / 25 / 25. Now the proposal reads ONLY
// portal.proposalPaymentTerms (the stamp the setup screen writes, a copy of his
// saved terms), never settings: two snapshot writers push this row and a change
// under Company Profile must not rewrite text a homeowner may be signing.
{
  expect('the record version is proposal-esign-2 (the bump that makes old text unsignable)',
    PROPOSAL_ESIGN_VERSION, 'proposal-esign-2');
  const p = buildProposalSnapshot().proposal!;
  const lines = p.documentText.split('\n');
  expect('a stamped proposal\'s documentText line 2 is the esign-2 version', lines[1], 'version: proposal-esign-2');
  expect('…it prints exactly three payment lines (deposit / progress / final)', p.payment.length, 3);
  expect('…the three amounts add up to the price being accepted, to the cent',
    Math.round(p.payment.reduce((s, m) => s + (m.amount ?? 0), 0) * 100), Math.round(p.total * 100));
  expect('…from the stamp, not an invented default: 25% / 65% / 10% of $400,000',
    p.payment.map(m => m.amount), [100000, 260000, 40000]);
  ok('…the deposit line names its 25%', /25%/.test(p.payment[0]?.detail ?? ''), JSON.stringify(p.payment[0]));
  expect('…and the document carries the same three lines', lines.filter(l => l.startsWith('payment: ')).length, 3);
  ok('…the pending flag is absent on a stamped proposal', p.paymentTermsPending === undefined);
  ok('NEGATIVE: no trace of the retired 10% deposit',
    !p.payment.some(m => /10%/.test(m.detail) && /deposit/i.test(m.label)), JSON.stringify(p.payment));

  // Switched on with no stamp (a portal from before Direction B): the proposal
  // still ships so the homeowner is not left with a vanished section, but it
  // carries no schedule and cannot be accepted.
  const unstamped = buildProposalSnapshot(proposalProject,
    { ...portalSettings, proposalApprovalEnabled: true } as unknown as ClientPortalSettings).proposal;
  ok('switched on with NO stamp, a proposal IS still shipped', !!unstamped);
  expect('…marked paymentTermsPending', unstamped?.paymentTermsPending, true);
  expect('…with no payment lines', unstamped?.payment, []);
  ok('…its document says payment_terms: not_confirmed', /\npayment_terms: not_confirmed\n/.test(unstamped?.documentText ?? ''),
    unstamped?.documentText);
  ok('…and carries no payment: line at all', !/\npayment: /.test(unstamped?.documentText ?? ''));
  expect('…and is still esign-2 (the pending flag is what blocks it)', unstamped?.documentText.split('\n')[1], 'version: proposal-esign-2');

  // A malformed stamp (sums to 90) is not trusted.
  const bad = buildProposalSnapshot(proposalProject, {
    ...portalSettings, proposalApprovalEnabled: true,
    proposalPaymentTerms: { depositPct: 25, progressPct: 55, finalPct: 10, confirmedAt: '2026-09-17T12:00:00.000Z' },
  } as unknown as ClientPortalSettings).proposal;
  expect('a stamp that does not total 100% is treated as not confirmed', bad?.paymentTermsPending, true);

  // THE FREEZE. His saved terms, his location and his tax rate all changing
  // must leave the published text byte-identical.
  const withSettings = (settings: Record<string, unknown>) => buildPortalSnapshot({
    project: proposalProject, portal: proposalPortal,
    settings: { branding: { companyName: 'Ridgeline Builders' }, ...settings } as never,
    supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon',
  }).proposal!.documentText;
  const base = withSettings({});
  expect('saved terms 30 / 60 / 10 in settings do NOT change the published documentText',
    withSettings({ paymentSplit: { depositPct: 30, progressPct: 60, finalPct: 10 } }), base);
  expect('…nor a different location and tax rate',
    withSettings({ paymentSplit: { depositPct: 5, progressPct: 90, finalPct: 5 }, location: 'Sacramento, CA', taxRate: 9.25 }), base);
  ok('NEGATIVE: the freeze check can see a stamp change',
    buildPortalSnapshot({
      project: proposalProject,
      portal: { ...proposalPortal, proposalPaymentTerms: { ...PROPOSAL_STAMP, depositPct: 30, progressPct: 60 } } as unknown as ClientPortalSettings,
      settings: { branding: { companyName: 'Ridgeline Builders' } } as never,
      supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon',
    }).proposal!.documentText !== base);

  // Nothing passes settings into the proposal builder, anywhere.
  const callers = ['utils/portalSnapshot.ts', 'app/client-view.tsx', 'app/project-detail.tsx', 'app/client-portal-setup.tsx']
    .map(f => ({ f, src: read(f) }));
  for (const { f, src } of callers) {
    const calls = src.match(/buildPortalProposal\(\{[\s\S]*?\}\)/g) ?? [];
    ok(`${f}: no buildPortalProposal call passes settings`, calls.every(c => !/\bsettings\b\s*[:,}]/.test(c.replace(/settings\?\.branding/g, ''))),
      calls.join('\n'));
  }
  const ps = read('utils/portalSnapshot.ts');
  const builder = ps.slice(ps.indexOf('export function buildPortalProposal('), ps.indexOf('interface BuildOpts'));
  ok('buildPortalProposal reads the stamp through isValidStamp and prints proposalPaymentLines',
    /isValidStamp\(stamp\)/.test(builder) && /proposalPaymentLines\(view\.projectTotal, stamp\)/.test(builder), builder.slice(0, 300));
  ok('…and no longer imports the invented defaultPaymentSchedule',
    !/import[^;]*defaultPaymentSchedule/.test(ps) && !/defaultPaymentSchedule\(/.test(ps));
  ok('…and its signature takes no settings',
    !/settings/.test(builder.slice(0, builder.indexOf('}): PortalProposal'))));
}

// ── Stability: the hash the server checks cannot move on its own ────────────
{
  const snapA = buildProposalSnapshot();
  const snapB = buildProposalSnapshot();
  const a = snapA.proposal!;
  const b = snapB.proposal!;
  expect('documentText is byte-identical across two builds (no wall clock in it)',
    a.documentText, b.documentText);
  // Two builds a millisecond apart can legitimately share a snapshotAt, so
  // "they differ" is not the assertion. The assertion is that NEITHER build's
  // stamp is inside the document — a `snapshotAt` in there would re-hash the
  // proposal on every push (project-detail pushes on every project open) and
  // refuse the acceptance of anyone whose page loaded a moment earlier.
  ok('neither build\'s snapshotAt appears inside documentText',
    !a.documentText.includes(snapA.snapshotAt) && !a.documentText.includes(snapB.snapshotAt),
    `${snapA.snapshotAt} / ${snapB.snapshotAt}`);
  ok('NEGATIVE: that check would fire if the stamp were in there',
    `${a.documentText}\nsnapshot_at: ${snapA.snapshotAt}`.includes(snapA.snapshotAt));

  // client-portal-setup rewrites `clientName` per invite when it builds a
  // link. If that reached the document, the link and the stored row would
  // hash differently and every acceptance from a named invite would be
  // refused as superseded.
  const named = buildProposalSnapshot(proposalProject, proposalPortal, {
    invite: { id: 'inv1', name: 'Dana Reyes', email: 'd@example.com' },
  });
  expect('an invite name does NOT reach documentText', named.proposal?.documentText, a.documentText);
  expect('…even though it did reach the snapshot', named.clientName, 'Dana Reyes');
}

// ── The client-facing boundary ──────────────────────────────────────────────
{
  const p = buildProposalSnapshot().proposal!;
  expect('the proposal exposes no cost/markup/margin/supplier keys', forbiddenKeys(p), []);
  const text = [p.documentText, ...allStrings({ ...p, documentText: undefined })].join(' ');
  for (const leak of ['Ferguson', 'BMC Lumber', 'Clé']) {
    ok(`no supplier name (${leak}) reaches the proposal`, !text.includes(leak));
  }
  ok('no unit price reaches the proposal', !/\b9\.50\b/.test(text) && !text.includes('unitPrice'));
  ok('the base (pre-markup) total does not reach the proposal', !text.includes('320000'), text.slice(0, 200));
  // NEGATIVE — the scan above is only worth something if the fixture really
  // does carry what it is looking for.
  const raw = JSON.stringify(PROPOSAL_EST);
  ok('NEGATIVE: the fixture estimate really does carry those suppliers and the base total',
    raw.includes('Ferguson') && raw.includes('BMC Lumber') && raw.includes('Clé') && raw.includes('320000'));
}

// ── The consent record ──────────────────────────────────────────────────────
const PROPOSAL_DOC_HASH = 'c'.repeat(64);
{
  const p = buildProposalSnapshot().proposal!;
  const args = {
    decision: 'accepted' as const, portalId: 'portal-abc', proposalId: p.id,
    proposalTotal: p.total, proposalDocumentHash: PROPOSAL_DOC_HASH,
    signerName: '  Dana Reyes ', signedAt: '2026-06-15T18:04:00.000Z',
    timezoneOffsetMinutes: -240, signatureHash: 'b'.repeat(64), signatureStrokeCount: 5,
    userAgent: 'Mozilla/5.0 (iPhone)',
  };
  const record = buildProposalConsentRecord(args);
  const lines = record.split('\n');
  expect('record header is stable', lines[0], 'MAGE ID PROPOSAL ELECTRONIC SIGNATURE RECORD');
  expect('record is versioned on line 2', lines[1], `version: ${PROPOSAL_ESIGN_VERSION}`);
  for (const field of [
    'decision: accepted', 'proposal_id: est-77', 'proposal_total_usd: 400000.00',
    `proposal_document_sha256: ${PROPOSAL_DOC_HASH}`, 'signer_name: Dana Reyes',
    'signed_at: 2026-06-15T18:04:00.000Z', 'signature_strokes: 5',
  ]) {
    ok(`record carries "${field.split(':')[0]}"`, record.includes(field));
  }
  ok('record embeds the full disclosure the signer saw',
    record.includes(`consent_disclosure: ${PROPOSAL_DISCLOSURE_TEXT}`));
  expect('record is byte-deterministic', buildProposalConsentRecord(args), record);

  // THE CROSS-LANGUAGE CONTRACT. The RPC refuses any record that does not
  // contain, on its own line, the digest it computed from its own copy of the
  // published document:
  //     strpos(p_consent_record, E'\nproposal_document_sha256: ' || v_doc_hash || E'\n')
  // If that line ever moves to the end, loses its newline, or is renamed, the
  // RPC rejects every acceptance. Assert the exact substring the SQL looks for.
  ok('the record contains the EXACT full line the RPC greps for',
    record.includes(`\nproposal_document_sha256: ${PROPOSAL_DOC_HASH}\n`), record.slice(0, 300));
  ok('…and the proposal-id line it also greps for',
    record.includes(`\nproposal_id: ${p.id}\n`));
  // The RPC parses the total out with `([0-9]+\.[0-9]{2})` and compares it to
  // its own figure as a NUMBER. Run that exact pattern here: if the builder
  // ever emits a total this cannot parse, every acceptance is refused.
  {
    const m = new RegExp('\\nproposal_total_usd: ([0-9]+\\.[0-9]{2})\\n').exec(record);
    ok('the RPC\'s own total pattern matches what the builder emits', !!m, record.slice(0, 300));
    expect('…and parses to exactly the price in the snapshot', m ? Number(m[1]) : null, p.total);
    ok('NEGATIVE: that pattern does not match a total written without cents',
      !new RegExp('\\nproposal_total_usd: ([0-9]+\\.[0-9]{2})\\n')
        .test(record.replace(`proposal_total_usd: ${p.total.toFixed(2)}`, `proposal_total_usd: ${p.total}`)));
  }
  ok('NEGATIVE: a prefix-extended digest would NOT satisfy that full-line match',
    !record.replace(`proposal_document_sha256: ${PROPOSAL_DOC_HASH}\n`,
                    `proposal_document_sha256: ${PROPOSAL_DOC_HASH}DEADBEEF\n`)
       .includes(`\nproposal_document_sha256: ${PROPOSAL_DOC_HASH}\n`));

  const declined = buildProposalConsentRecord({
    decision: 'declined', portalId: 'portal-abc', proposalId: p.id, proposalTotal: p.total,
    proposalDocumentHash: PROPOSAL_DOC_HASH, signerName: 'Dana Reyes',
    signedAt: '2026-06-15T18:04:00.000Z',
    reason: 'Too expensive — please re-price without the primary bath.',
  });
  ok('a decline record captures the reason and carries no signature fields',
    declined.includes('decline_reason: Too expensive') &&
    !declined.includes('signature_sha256') && !declined.includes('signature_strokes'));
  ok('the consent record contains no cost/markup/margin language',
    !/unit cost|markup|margin|gross profit/i.test(record));
}

// ── The disclosure ──────────────────────────────────────────────────────────
{
  const slice = portalHtml.slice(portalHtml.indexOf('var PROPOSAL_DISCLOSURE_TEXT ='));
  const body = slice.slice(0, slice.indexOf(';'));
  const joined = (body.match(/'([^']*)'/g) ?? []).map(s => s.slice(1, -1)).join('');
  expect('portal proposal disclosure matches utils/portalSnapshot.ts exactly',
    joined, PROPOSAL_DISCLOSURE_TEXT);
  ok('portal proposal record version matches',
    portalHtml.includes(`var PROPOSAL_ESIGN_VERSION = '${PROPOSAL_ESIGN_VERSION}'`));
  ok('the disclosure names the act being performed',
    /consent to accept this proposal electronically/.test(PROPOSAL_DISCLOSURE_TEXT));
  ok('the disclosure offers a paper copy at no charge',
    /paper copy at no charge/.test(PROPOSAL_DISCLOSURE_TEXT));
  ok('the disclosure cites no statute and claims no legal effect',
    !/E-?SIGN|UETA|U\.S\.C|legal effect|legally binding|same (force|effect) as/i.test(PROPOSAL_DISCLOSURE_TEXT),
    PROPOSAL_DISCLOSURE_TEXT);
  // Accepting a proposal is NOT signing the construction agreement, and this
  // product does not get to blur that. Both surfaces say so.
  ok('the app-side copy says the agreement is a separate document',
    /separate document you will review and sign/.test(PROPOSAL_NOT_A_CONTRACT_NOTE));
  ok('the portal ships that same sentence next to the button',
    portalHtml.includes('That agreement is a separate document you will review and sign.'));
}

// ── Cross-runtime equivalence with the static portal's copy ─────────────────
{
  const START = '// PROPOSAL-ESIGN-BLOCK-START';
  const END = '// PROPOSAL-ESIGN-BLOCK-END';
  const s0 = portalHtml.indexOf(START);
  const s1 = portalHtml.indexOf(END, s0);
  ok('portal proposal e-signature block is extractable for a head-to-head check', s0 >= 0 && s1 > s0);
  // The block calls esignTidy(), which lives with the CO helpers further up
  // the page. Lift that too rather than re-implementing it here — a local
  // re-implementation would be the thing under test.
  const tidyStart = portalHtml.indexOf('function esignTidy(');
  const tidyEnd = portalHtml.indexOf('\n  }', tidyStart) + 4;
  ok('portal esignTidy is extractable', tidyStart >= 0 && tidyEnd > tidyStart);
  if (s0 >= 0 && s1 > s0 && tidyStart >= 0) {
    const src = `${portalHtml.slice(tidyStart, tidyEnd)}\n${portalHtml.slice(s0, s1)}\nreturn buildProposalConsentRecord;`;
    // eslint-disable-next-line no-new-func
    const portalBuild = new Function(src)() as (f: Record<string, unknown>) => string;
    const args = {
      decision: 'accepted' as const, portalId: 'portal-abc', proposalId: 'est-77',
      proposalTotal: 400000, proposalDocumentHash: PROPOSAL_DOC_HASH,
      signerName: '  Dana Reyes ', signedAt: '2026-06-15T18:04:00.000Z',
      timezoneOffsetMinutes: -240, signatureHash: 'b'.repeat(64), signatureStrokeCount: 7,
      userAgent: '  Mozilla/5.0   (iPhone)  ',
    };
    expect('portal and app emit byte-identical proposal records (acceptance)',
      portalBuild(args), buildProposalConsentRecord(args));
    const declineArgs = {
      decision: 'declined' as const, portalId: 'portal-abc', proposalId: 'est-77',
      proposalTotal: 400000, proposalDocumentHash: PROPOSAL_DOC_HASH,
      signerName: 'Dana Reyes', signedAt: '2026-06-15T18:04:00.000Z',
      reason: '  Too   expensive — please re-price.  ', userAgent: 'Mozilla/5.0',
    };
    expect('portal and app emit byte-identical proposal records (decline)',
      portalBuild(declineArgs), buildProposalConsentRecord(declineArgs));
  }
}

// ── The page ────────────────────────────────────────────────────────────────
{
  ok('portal renders a proposal section', /function renderProposal\(/.test(portalHtml)
    && portalHtml.includes("addSection('proposal'"));
  ok('the accept + decline buttons exist',
    portalHtml.includes('data-proposal-accept=') && portalHtml.includes('data-proposal-decline='));
  ok('the section subtitle promises "accept to get started" only under the same rule the buttons use',
    /var proposalCanDecide = !!data\.portalApi\s*\n\s*&& data\.proposal\.version === PROPOSAL_ESIGN_VERSION\s*\n\s*&& !data\.proposal\.paymentTermsPending;/.test(portalHtml));
  ok('the proposal signs through the SAME modal as a change order',
    /function showProposalSignModal\(/.test(portalHtml)
    && /return showDocSignModal\(\{[\s\S]{0,900}consentText: PROPOSAL_DISCLOSURE_TEXT/.test(portalHtml));
  ok('…and so does the change order, so the two cannot drift apart',
    /function showCOSignModal\(opts\) \{[\s\S]{0,3000}return showDocSignModal\(/.test(portalHtml));
  ok('the one modal still demands all three ESIGN elements before enabling submit',
    /nameValue\(\)\.length >= 3 && !!pad && pad\.pointCount\(\) >= 2 && checkEl\.checked/.test(portalHtml));

  const handler = (() => {
    const a = portalHtml.indexOf('function handleProposalDecision');
    const b = portalHtml.indexOf('function bindProposalHandlers', a);
    return a >= 0 && b > a ? portalHtml.slice(a, b) : '';
  })();
  ok('handleProposalDecision() exists', handler.length > 0);
  ok('it hashes the PUBLISHED documentText, not a locally re-derived one',
    /sha256Hex\(proposal\.documentText/.test(handler), handler.slice(0, 400));
  ok('it sends that digest to the server as well as inside the record',
    /proposal_document_hash: docHash/.test(handler) && /proposalDocumentHash: docHash/.test(handler));
  // Mutation-checked 2026-09-13: `/no_subtle_crypto/` alone stayed GREEN when
  // the throw was replaced with `docHash = docHash || ''` — the string still
  // occurs in the catch block that renders the message. Pin the refusal
  // itself, and the message that goes with it.
  ok('a browser that cannot hash is refused rather than sealed weakly',
    /if \(!docHash\) \{[\s\S]{0,120}throw new Error\('no_subtle_crypto'\)/.test(handler),
    handler.slice(handler.indexOf('docHash'), handler.indexOf('docHash') + 300));
  ok('…and is told why, rather than shown a generic failure',
    /cannot seal a signature/.test(handler));
  ok('it submits through the sealed RPC', /postProposalDecisionSigned\(/.test(handler));
  ok('it uses neither confirm() nor prompt()',
    !/\bconfirm\s*\(/.test(handler) && !/\bprompt\s*\(/.test(handler));
  ok('portal ships /rest/v1/rpc/portal_submit_proposal_approval_signed',
    portalHtml.includes('/rest/v1/rpc/portal_submit_proposal_approval_signed'));

  // An acceptance has exactly one way to be recorded. The CO flow can fall
  // back to an older RPC because one exists; there is no older proposal RPC,
  // and the available degradations — post a chat message, or write it to
  // localStorage and call it done — would present something that is not a
  // signature as one.
  /** A Storage-shaped object that forgets everything. */
  const stubStorage = () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} });

  const poster = (() => {
    const a = portalHtml.indexOf('async function postProposalDecisionSigned');
    const b = portalHtml.indexOf('function proposalErrorMessage', a);
    return a >= 0 && b > a ? portalHtml.slice(a, b) : '';
  })();
  ok('postProposalDecisionSigned() exists', poster.length > 0);

  // ── EXECUTED, because the regex here was a lie ────────────────────────────
  //
  // This assertion used to be `!/postMessage|portal_post_message|
  // saveProposalDecision/.test(poster)` — a NAME GREP over the function body,
  // and it was reported as catching a mutation it does not catch. Replacing
  // the whole error rejection with
  //
  //     try { localStorage.setItem('mage_prop_pending', JSON.stringify(payload)); } catch (e) {}
  //     return { ok: true };
  //
  // leaves that regex GREEN (none of the three names appear), and ships a page
  // that fires confetti and prints "Accepted" for a signature that never
  // reached the server. Measured 2026-09-13: 363 passed, 0 failed with that
  // fallback in place.
  //
  // So run the function. Stub fetch, hand it a 404 — the exact shape of "the
  // RPC is not deployed" — and require a REJECTION. A resolved value of any
  // kind is the failure, whatever the body is spelled like.
  if (poster.length > 0) {
    const makePoster = (fetchImpl: unknown) => new Function(
      'fetch', 'getPortalToken', 'localStorage', 'sessionStorage',
      `${poster}\nreturn postProposalDecisionSigned;`,
    )(fetchImpl, () => 'tok', stubStorage(), stubStorage()) as
      (api: unknown, payload: unknown) => Promise<unknown>;

    const api = { supabaseUrl: 'https://x.supabase.co/', supabaseAnonKey: 'anon' };
    const payload = { portal_id: 'p1', proposal_id: 'est-77', decision: 'accepted' };

    const notDeployed = makePoster(async () => ({
      ok: false, status: 404,
      text: async () => '{"code":"PGRST202"}',
      json: async () => ({ code: 'PGRST202' }),
    }));
    const rejected404 = await notDeployed(api, payload).then(
      v => ({ threw: false, v }), e => ({ threw: true, v: e }));
    ok('EXECUTED: a 404 (RPC not deployed) REJECTS — it never resolves to a decision',
      rejected404.threw === true, `resolved with ${JSON.stringify(rejected404.v)}`);
    ok('…and the rejection carries the status, so the caller can say which failure it was',
      (rejected404.v as { status?: number })?.status === 404);

    const denied = makePoster(async () => ({
      ok: false, status: 403,
      text: async () => 'portal_denied',
      json: async () => ({}),
    }));
    const rejected403 = await denied(api, payload).then(() => false, () => true);
    ok('EXECUTED: a 403 (bad token) rejects too', rejected403 === true);

    // NEGATIVE — the two checks above are only worth something if a GOOD
    // response really does resolve. Without this, a poster that rejected
    // unconditionally would pass them both.
    const good = makePoster(async () => ({
      ok: true, status: 200,
      text: async () => '{"ok":true}',
      json: async () => ({ ok: true, recorded: true, id: 'row1' }),
    }));
    const resolved = await good(api, payload).then(v => v, () => null);
    expect('NEGATIVE: a 200 resolves with the server\'s answer',
      (resolved as { id?: string })?.id, 'row1');

    // And nothing was stashed on the way out. This is the second half of the
    // mutation: a fallback that writes the decision somewhere local and calls
    // it done presents something that is not a signature as one.
    const writes: string[] = [];
    const spying = new Function(
      'fetch', 'getPortalToken', 'localStorage', 'sessionStorage',
      `${poster}\nreturn postProposalDecisionSigned;`,
    )(
      async () => ({ ok: false, status: 404, text: async () => 'PGRST202', json: async () => ({}) }),
      () => 'tok',
      { getItem: () => null, setItem: (k: string) => { writes.push(k); }, removeItem: () => {} },
      { getItem: () => null, setItem: (k: string) => { writes.push(`s:${k}`); }, removeItem: () => {} },
    ) as (api: unknown, payload: unknown) => Promise<unknown>;
    await spying(api, payload).catch(() => undefined);
    ok('EXECUTED: a failed submission writes NOTHING to local storage on its way out',
      writes.length === 0, `wrote ${JSON.stringify(writes)}`);
  }
  ok('the "not deployed" message tells the homeowner plainly and offers a message instead',
    /not switched on for your project yet/.test(portalHtml));
  ok('a re-priced proposal is reported as changed, not as a generic failure',
    /proposal_superseded/.test(portalHtml) && /changed this proposal since this page loaded/.test(portalHtml));
}

// ── The migration that gives the acceptance a home ──────────────────────────
{
  const mig = read('supabase/migrations/held/20260913120000_portal_proposal_acceptance.sql');
  ok('proposal-acceptance migration present (HELD)', mig.length > 0);
  ok('it is held, with its preconditions stated', /^-- =+\n-- HELD/.test(mig) && /PRECONDITIONS/.test(mig));
  ok('the RPC is token-gated like every other portal RPC',
    /portal_project_for_token\(p_portal_id, p_access_token\)/.test(mig));
  ok('it reads the proposal back out of the contractor-published snapshot',
    /from public\.portal_snapshots ps/.test(mig) && /snapshot->'proposal'/.test(mig));
  ok('it refuses a snapshot row belonging to another project',
    /v_snap_pid is not null and v_snap_pid <> v_pid/.test(mig));
  ok('OWNERSHIP: the signed proposal id must equal the published one',
    /coalesce\(v_proposal->>'id', ''\) <> btrim\(p_proposal_id\)/.test(mig));
  ok('it hashes ITS OWN copy of documentText',
    /v_doc_hash := encode\(digest\(v_doc, 'sha256'\), 'hex'\)/.test(mig));
  ok('the consent record must carry that digest on its own full line',
    /strpos\(p_consent_record, E'\\nproposal_document_sha256: ' \|\| v_doc_hash \|\| E'\\n'\) = 0/.test(mig));
  ok('it re-hashes the consent record and refuses a mismatch',
    /digest\(p_consent_record, 'sha256'\)/.test(mig) && /hash_mismatch/.test(mig));
  ok('the stored price is the SERVER\'s, read from the snapshot',
    /v_total := nullif\(v_proposal->>'total', ''\)::numeric/.test(mig)
    && !/p_proposal_total\b/.test(mig));
  ok('…and a snapshot with no usable total is refused rather than stored as null',
    /if v_total is null or v_total <= 0 then raise exception 'portal_denied'/.test(mig));
  // The digest binds the TERMS. These two stop the retained record — the thing
  // with a signature on it — from SAYING something the server never agreed to:
  // without them a link-holder could seal a record reading
  // "proposal_total_usd: 1.00" against a $400,000 proposal.
  ok('the record\'s own stated total must equal the server\'s, compared as a number',
    /v_claimed_total := nullif\(/.test(mig)
    && /proposal_total_usd: \(\[0-9\]\+/.test(mig)
    && /v_claimed_total <> v_total then/.test(mig));
  ok('…and the record\'s stated proposal id must match too',
    /strpos\(p_consent_record, E'\\nproposal_id: ' \|\| btrim\(p_proposal_id\) \|\| E'\\n'\) = 0/.test(mig));
  ok('a unique_violation from anywhere else is re-raised, not answered with ok:true',
    /if not found then raise; end if;/.test(mig));
  ok('an acceptance requires consent, a drawn signature and a legal name',
    /esign_consent_required/.test(mig) && /esign_signature_required/.test(mig) && /esign_signer_name_required/.test(mig));
  ok('declining stays one step but must say why', /decline_reason_required/.test(mig));
  // ONE ACCEPTANCE PER PORTAL, not per (portal, proposal). The proposal id is
  // the estimate id and app/(tabs)/estimate/full.tsx:1088 stamps a fresh
  // generateUUID() inside buildLinkedEstimate() on every link AND every merge,
  // so a per-proposal index lets a contractor's re-save unlock a SECOND
  // acceptance, at a second price, with nothing marking which supersedes.
  ok('one acceptance per PORTAL, enforced by a partial unique index',
    /create unique index proposal_approvals_one_acceptance\s*\n\s*on public\.proposal_approvals \(portal_id\)\s*\n\s*where decision = 'accepted';/.test(mig),
    mig.slice(mig.indexOf('proposal_approvals_one_acceptance') - 80, mig.indexOf('proposal_approvals_one_acceptance') + 220));
  ok('…and the index is dropped by name first, so a re-apply cannot keep the weaker one',
    /drop index if exists public\.proposal_approvals_one_acceptance;/.test(mig));
  ok('…and neither the pre-check nor the race handler narrows by proposal_id',
    !/where portal_id = p_portal_id and proposal_id = btrim\(p_proposal_id\)/.test(mig));
  ok('a duplicate acceptance returns the original seal instead of a second obligation',
    /exception when unique_violation/.test(mig) && /'already', true/.test(mig));
  // A signature taken and discarded while the page says "sealed" is worse than
  // no acceptance flow. The already-path must say who signed, when, and that
  // THIS submission was not stored.
  const alreadyReturns = mig.match(/'already', true, 'recorded', false,/g) ?? [];
  expect('both already-paths report recorded:false (pre-check AND the race handler)',
    alreadyReturns.length, 2);
  ok('…and hand back the ORIGINAL signer and seal time, so the page can name them',
    /'signer_name', v_existing\.signer_name,/.test(mig)
    && /'sealed_at', v_existing\.sealed_at\);/.test(mig));
  ok('…while a stored acceptance reports recorded:true',
    /'ok', true,\s*\n\s*'recorded', true,/.test(mig));
  // A decline filed after an acceptance is refused, not stored: the GC's list
  // is ordered created_at desc, so it would read "Proposal declined" on a job
  // the client already accepted.
  ok('a decline after an acceptance is REFUSED, not filed',
    /if p_decision = 'declined' then raise exception 'proposal_already_accepted'; end if;/.test(mig));
  // Mutation-checked 2026-09-13: `/proposal_approval_freeze_evidence/` alone
  // stayed GREEN when the function DEFINITION was renamed — the trigger below
  // still mentions the old name. Pin the definition, the trigger that binds
  // it, and the columns it actually pins.
  ok('the signed evidence is frozen against later edits by the party it binds',
    /create or replace function public\.proposal_approval_freeze_evidence\(\)/.test(mig)
    && /create trigger proposal_approvals_freeze\s*\n\s*before update on public\.proposal_approvals\s*\n\s*for each row execute function public\.proposal_approval_freeze_evidence\(\)/.test(mig));
  for (const col of ['decision', 'consent_record', 'document_hash', 'proposal_document_hash', 'proposal_total', 'signature_data', 'sealed_at']) {
    ok(`…and the freeze pins ${col}`, new RegExp(`new\\.${col}\\s+:= old\\.${col};`).test(mig));
  }
  ok('…while acknowledged_at stays writable, which is the whole point',
    !/new\.acknowledged_at\s+:= old\.acknowledged_at;/.test(mig)
    && /acknowledged_at is deliberately NOT pinned/.test(mig));
  // ── Direction B (2026-09-17), edited in BEFORE the file is ever applied ────
  ok('proposal_approvals.proposal_snapshot exists (create table + idempotent add)',
    /proposal_snapshot\s+jsonb\n\);/.test(mig)
    && /alter table public\.proposal_approvals add column if not exists proposal_snapshot jsonb;/.test(mig));
  ok('…and the freeze pins it', /new\.proposal_snapshot\s+:= old\.proposal_snapshot;/.test(mig));
  ok('the snapshot read takes a row lock (for update), so a push cannot slip between check and insert',
    /from public\.portal_snapshots ps\s*\n\s*where ps\.portal_id = p_portal_id\s*\n\s*limit 1\s*\n\s*for update;/.test(mig));
  {
    const m = /split_part\(v_doc, E'\\n', 2\) is distinct from 'version: ([a-z0-9-]+)'/.exec(mig);
    expect('the RPC\'s version literal equals PROPOSAL_ESIGN_VERSION', m?.[1], PROPOSAL_ESIGN_VERSION);
    ok('…and a pending proposal is refused as superseded',
      /or coalesce\(v_proposal->>'paymentTermsPending', ''\) = 'true' then\s*\n\s*raise exception 'proposal_superseded';/.test(mig));
    ok('…and the version gate runs right after documentText is read, before any hash or insert',
      mig.indexOf("split_part(v_doc") > mig.indexOf("v_doc := v_proposal->>'documentText'")
      && mig.indexOf("split_part(v_doc") < mig.indexOf('v_doc_hash := encode('));
  }
  ok('the insert stores proposal_snapshot = v_proposal',
    /consent_accepted, sealed_at,\s*\n\s*proposal_snapshot\)/.test(mig) && /v_now,\s*\n\s*v_proposal\)\s*\n\s*returning id into v_id;/.test(mig));
  ok('pin trigger: BEFORE INSERT OR UPDATE on public.portal_snapshots',
    /create trigger portal_snapshots_pin_accepted_proposal\s*\n\s*before insert or update on public\.portal_snapshots\s*\n\s*for each row execute function public\.portal_snapshots_pin_accepted_proposal\(\);/.test(mig));
  {
    const fnSrc = mig.slice(mig.indexOf('create or replace function public.portal_snapshots_pin_accepted_proposal()'),
      mig.indexOf('drop trigger if exists portal_snapshots_pin_accepted_proposal'));
    ok('…security definer with a pinned search_path',
      /security definer\s*\n\s*set search_path to 'pg_catalog', 'public'/.test(fnSrc), fnSrc.slice(0, 200));
    ok('…replaces an incoming proposal with the accepted proposal_snapshot',
      /decision = 'accepted'/.test(fnSrc) && /jsonb_set\(new\.snapshot, '\{proposal\}', v_accepted\)/.test(fnSrc));
    ok('…and only when the incoming snapshot carries a proposal (removing it stays allowed)',
      /if jsonb_typeof\(new\.snapshot -> 'proposal'\) is distinct from 'object' then return new; end if;/.test(fnSrc));
    ok('…execute revoked from public, anon, authenticated',
      /revoke execute on function public\.portal_snapshots_pin_accepted_proposal\(\) from public, anon, authenticated;/.test(mig));
  }
  ok('the header names the Direction B preconditions (esign-2 page, esign-1 rows near zero, these edits)',
    /PROPOSAL_ESIGN_VERSION = 'proposal-esign-2'/.test(mig)
    && /proposal-esign-1 rows in portal_snapshots are at or near\s*\n--\s+zero/.test(mig)
    && /snapshot->'proposal'->>'version' = 'proposal-esign-1'/.test(mig)
    && /This file carries the Direction B edits/.test(mig));
  // The auto-stamp reads the device cache and can overwrite an ACCEPTED
  // proposal's terms on the projects row; the snapshot pin does not cover it.
  ok('the header names precondition 7 (protect the accepted stamp on the projects row)',
    /7\. \(2026-09-17, integration round 2\) The ACCEPTED STAMP on the projects row/.test(mig)
    && /projects_keep_proposal_payment_terms restores[\s\S]{0,80}ABSENT/.test(mig));
  ok('held/README.md states the Direction B edits and the esign-2 apply condition',
    /proposal-esign-2/.test(read('supabase/migrations/held/README.md')));
  ok('anon may execute it (the homeowner has no MAGE account)',
    /grant execute on function public\.portal_submit_proposal_approval_signed\([\s\S]{0,200}to anon, authenticated/.test(mig));
  ok('the table is not readable by anon', /revoke all on public\.proposal_approvals from anon/.test(mig));

  // The hole the same audit found on the change-order path, closed in the
  // same file: a portal token could file an approval for ANY change-order id,
  // and hooks/usePortalApprovalReconciler.ts matches approvals to change
  // orders by id alone.
  const coOwnership = mig.match(/if not exists \(select 1 from public\.change_orders c\s*\n\s*where c\.id::text = btrim\(p_change_order_id\)\s*\n\s*and c\.project_id = v_pid\)/g) ?? [];
  expect('BOTH change-order RPCs now confirm the CO belongs to the token\'s project',
    coOwnership.length, 2);
  ok('…and the fix keeps their signatures, so no caller has to change',
    /create or replace function public\.portal_submit_co_approval\(\s*\n\s*p_portal_id text, p_access_token text, p_change_order_id text,/.test(mig)
    && /create or replace function public\.portal_submit_co_approval_signed\(/.test(mig));
  ok('the file tells the operator to look for rows the bug may already have made',
    /left join public\.change_orders c/.test(mig) && /Expect zero/.test(mig));

  // THE LAYER THAT ACTS ON THOSE ROWS. Section 3 stops new ones being written,
  // but hooks/usePortalApprovalReconciler.ts is what flips a change order to
  // `approved`, it runs against the TENANT-WIDE list from ProjectContext, and
  // rows written before the migration is applied are still in the table. It
  // matched on change_order_id alone until 2026-09-13.
  const rec = read('hooks/usePortalApprovalReconciler.ts');
  ok('the reconciler compares the PROJECT, not just the change-order id',
    /c\.id === row\.change_order_id\s*\n\s*&& \(!row\.project_id \|\| c\.projectId === row\.project_id\)/.test(rec),
    rec.slice(rec.indexOf('changeOrders.find') - 120, rec.indexOf('changeOrders.find') + 220));
  ok('…and still applies a legacy row that carries no project_id at all',
    /!row\.project_id \|\|/.test(rec),
    'project_id is nullable for historical rows — a null is tolerated, a mismatch is not');
  ok('…and it really does read project_id off the row it selects',
    /created_at, project_id'\)/.test(rec));
}

// ── The section, EXECUTED ───────────────────────────────────────────────────
//
// Every check above this point is a regex over source text, and a regex cannot
// tell you that the page renders the right dollar figure or that a supplier
// name does not reach the HTML. The static portal has no build step, so the
// house technique (scripts/validate-invoice-billing.ts does the same to the
// pay-app rules) is to lift the function out of the page and run it.
{
  const start = portalHtml.indexOf('function renderProposal(');
  const stop = portalHtml.indexOf('// Open the review-and-sign sheet for the proposal.', start);
  ok('renderProposal is extractable for execution', start >= 0 && stop > start);
  const noteStart = portalHtml.indexOf('var PROPOSAL_NOT_A_CONTRACT_NOTE =');
  const noteStop = portalHtml.indexOf(';', noteStart) + 1;

  if (start >= 0 && stop > start && noteStart >= 0) {
    const prelude = `
      function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
      function fmtMoney(n,o){ if(n==null||isNaN(n))return '—'; var d=o&&o.dec?o.dec:0;
        return '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
      function fmtDate(iso){ return iso ? 'May 2, 2026' : '—'; }
      function timeAgo(){ return 'just now'; }
      function emptyState(l){ return '<div class="empty-section">'+l+'</div>'; }
      function icn(){ return '<svg></svg>'; }
      var ICONS = { check: '', alert: '' };
    `;
    const verStart = portalHtml.indexOf('var PROPOSAL_ESIGN_VERSION =');
    const verStop = portalHtml.indexOf(';', verStart) + 1;
    const src = `${prelude}\n${portalHtml.slice(verStart, verStop)}\n${portalHtml.slice(noteStart, noteStop)}\n${portalHtml.slice(start, stop)}\nreturn renderProposal;`;
    const make = (decided: unknown) =>
      // eslint-disable-next-line no-new-func
      new Function('loadProposalDecision', src)(() => decided) as (p: unknown, can: boolean) => string;

    const snapProposal = buildProposalSnapshot().proposal!;
    const html = make(null)(snapProposal, true);

    // Anchored to the headline element, not to "the string appears somewhere":
    // mutation-checked 2026-09-13, `fmtMoney(p.total * 0.8)` left a bare
    // includes('$400,000') GREEN because the scope total row also prints it.
    ok('the headline shows the price being accepted',
      /<div class="prop-total">\$400,000<\/div>/.test(html), html.slice(0, 400));
    ok('…and the tie-out row under the scope shows the same number',
      /<div class="ob-row ob-row-total"><span>Total<\/span><strong>\$400,000<\/strong><\/div>/.test(html),
      html.slice(html.indexOf('ob-row-total') - 100, html.indexOf('ob-row-total') + 160));
    for (const g of snapProposal.scope) {
      ok(`…and the scope line "${g.label}"`, html.includes(g.label));
    }
    ok('…and the allowance the homeowner still gets to spend',
      html.includes('Bathroom tile allowance'));
    ok('…and the accept + decline buttons, wired to this proposal id',
      html.includes(`data-proposal-accept="${snapProposal.id}"`)
      && html.includes(`data-proposal-decline="${snapProposal.id}"`));
    ok('…and the sentence that keeps a proposal from reading as a contract',
      html.includes('separate document you will review and sign'));
    for (const leak of ['Ferguson', 'BMC Lumber', 'Clé', '320,000', 'markup', 'unit price']) {
      ok(`no "${leak}" reaches the rendered HTML`, !html.includes(leak), html.slice(0, 200));
    }
    // NEGATIVE — a render that returned '' would pass every "does not contain"
    // check above.
    ok('NEGATIVE: the rendered HTML is substantial, so the absence checks mean something',
      html.length > 800, `length ${html.length}`);

    // Without a write path there must be no button offering one.
    const readOnly = make(null)(snapProposal, false);
    ok('with no portalApi there is NO accept button (a button that cannot post must not be drawn)',
      !readOnly.includes('data-proposal-accept'), readOnly.slice(-300));
    ok('…but the proposal is still shown', readOnly.includes('$400,000'));

    // Already decided on this device → receipt, not a second button.
    const done = make({ decision: 'accepted', at: '2026-06-15T18:04:00.000Z', signer: 'Dana Reyes', hash: 'f'.repeat(64) })(snapProposal, true);
    ok('an already-accepted proposal shows the decision, not the button again',
      done.includes('Accepted') && done.includes('Dana Reyes') && !done.includes('data-proposal-accept'));
    ok('…and shows the record hash back as the homeowner\'s receipt',
      done.includes('Record SHA-256 ' + 'f'.repeat(32)));

    // ── THE SECOND PERSON ───────────────────────────────────────────────────
    //
    // Acceptance state lives in this browser's localStorage and the snapshot
    // carries no accepted flag, so a spouse, a second device, or the same
    // phone after clearing site data sees "Waiting on you" and a live accept
    // button on an already-accepted proposal. They type their legal name, draw
    // a signature, tick consent and submit — and the RPC, holding an
    // acceptance already, writes NOTHING.
    //
    // Before 2026-09-13 the page ran its entire success path on that answer:
    // confetti, "Accepted by <the second person's name>", and a "Record
    // SHA-256 …" receipt taken from the FIRST signer's row. A signature was
    // collected and discarded while the page said it was sealed.
    const second = make({
      decision: 'accepted', recorded: false,
      at: '2026-06-15T18:04:00.000Z', signer: 'Dana Reyes', hash: null,
    })(snapProposal, true);
    ok('a submission the server did not store says ALREADY accepted, not "accepted"',
      second.includes('Already accepted') && second.includes('Dana Reyes'),
      second.slice(-700));
    ok('…and says in so many words that what they just signed was not recorded',
      /not recorded/.test(second), second.slice(-500));
    ok('…and offers NO receipt hash, because the row is not theirs',
      !second.includes('Record SHA-256'), second.slice(-400));
    ok('…and does not draw the accept button again',
      !second.includes('data-proposal-accept'));
    // A decision saved by an older build of this page carries no `recorded`
    // field. It must keep reading as recorded, not silently downgrade every
    // existing homeowner's receipt to "already accepted by someone else".
    const legacy = make({ decision: 'accepted', at: '2026-06-15T18:04:00.000Z', signer: 'Dana Reyes', hash: 'a'.repeat(64) })(snapProposal, true);
    ok('a decision stored before the field existed still reads as sealed',
      !legacy.includes('Already accepted') && legacy.includes('Record SHA-256'),
      legacy.slice(-400));

    // ── DIRECTION B: only esign-2 with confirmed terms can be accepted ────────
    // The page and the held RPC apply the same rule, so an old app build still
    // pushing esign-1 (MAGE's 10% deposit) or a proposal whose terms are not
    // confirmed can never be signed, whichever of web or OTA ships first.
    ok('esign-2 stamped: payment rows are drawn',
      html.includes('How payment works') && html.includes('Deposit — Due on signing · 25%') && html.includes('$260,000'),
      html.slice(html.indexOf('prop-group-head'), html.indexOf('prop-group-head') + 900));
    const v1 = make(null)({ ...snapProposal, version: 'proposal-esign-1' }, true);
    ok('esign-1: NO accept or decline button', !v1.includes('data-proposal-accept') && !v1.includes('data-proposal-decline'), v1.slice(-400));
    ok('esign-1: NO payment amounts — its lines are MAGE\'s placeholder, not his terms',
      !v1.includes('How payment works') && !v1.includes('Due on signing') && !v1.includes('$260,000'), v1);
    ok('esign-1: the outdated note', v1.includes('Your contractor is updating this proposal. You can accept it here once they have.'));
    ok('esign-1: no "Waiting on you" pill', !v1.includes('Waiting on you'));
    const pendingProposal = buildProposalSnapshot(proposalProject,
      { ...portalSettings, proposalApprovalEnabled: true } as unknown as ClientPortalSettings).proposal!;
    const pend = make(null)(pendingProposal, true);
    ok('pending: NO accept or decline button', !pend.includes('data-proposal-accept') && !pend.includes('data-proposal-decline'), pend.slice(-400));
    ok('pending: the confirming note', pend.includes('Your contractor is confirming the payment schedule. You can accept here once it is set.'));
    ok('pending: still shows the price and scope', pend.includes('$400,000'));
    ok('NEGATIVE: a stamped esign-2 proposal has neither note',
      !html.includes('is updating this proposal') && !html.includes('is confirming the payment schedule'));
  }
}

// ── The submit handler's honesty, in the page ───────────────────────────────
{
  const handlerSrc = (() => {
    const a = portalHtml.indexOf('function handleProposalDecision');
    const b = portalHtml.indexOf('function bindProposalHandlers', a);
    return a >= 0 && b > a ? portalHtml.slice(a, b) : '';
  })();
  ok('the handler branches on whether the SERVER stored the row',
    /var wasRecorded = res\.recorded !== false;/.test(handlerSrc), handlerSrc.slice(0, 200));
  ok('…reading !== false, so an older server that predates the field still seals',
    !/res\.recorded === true/.test(handlerSrc));
  ok('confetti fires only for a signature that was actually recorded',
    /if \(decision === 'accepted' && wasRecorded\) fireWebConfetti\(\);/.test(handlerSrc),
    handlerSrc.slice(handlerSrc.indexOf('fireWebConfetti') - 200, handlerSrc.indexOf('fireWebConfetti') + 60));
  ok('…and no receipt hash is kept for a row this device did not create',
    /var stamp = wasRecorded \? \(res\.document_hash \|\| out\.clientHash \|\| null\) : null;/.test(handlerSrc));
  ok('…and the name and time shown are the ORIGINAL signer\'s, not this person\'s',
    /signer: wasRecorded \? result\.signerName : \(res\.signer_name \|\| null\)/.test(handlerSrc));
  ok('a decline refused because the proposal is already accepted is explained, not generic',
    /proposal_already_accepted/.test(portalHtml)
    && /already been accepted, so a decline cannot be filed/.test(portalHtml));
  // Substantial completion is the point at which the punch list is still open.
  ok('the completion card does not call a job with an open punch list "finished"',
    !/Your build is finished/.test(portalHtml)
    && /recorded substantial completion\. They would like to hear from you\./.test(portalHtml));
}

// ── The two app-side surfaces ───────────────────────────────────────────────
{
  const cv = read('app/client-view.tsx');
  ok('client-view renders the proposal the homeowner will see',
    /title="Your Proposal"/.test(cv) && /proposalBlock\.scope\.map/.test(cv));
  // It builds it with the SAME function the snapshot does. A hand-rolled
  // preview is a preview of something else.
  ok('…built with the shared buildPortalProposal, not re-derived',
    /buildPortalProposal\(\{/.test(cv) && /from '@\/utils\/portalSnapshot'/.test(cv));
  ok('…and reads a published snapshot\'s proposal straight off the snapshot',
    /if \(isSnapshotMode\) return remote\.snapshot\?\.proposal;/.test(cv));
  // THE HONESTY CONSTRAINT. This screen cannot take a signature — snapshot
  // mode has no session and the anon write policies are gone — so it must not
  // grow a button that looks like it can.
  ok('client-view has NO proposal write path',
    !/proposal_approvals/.test(cv) && !/portal_submit_proposal_approval/.test(cv),
    'a button here would post nothing while looking like it had');
  ok('…and says where the signature actually happens',
    /open the portal link your contractor sent/.test(cv) && /This view is read-only/.test(cv));
  ok('…and repeats that accepting is not signing the agreement',
    /PROPOSAL_NOT_A_CONTRACT_NOTE/.test(cv));
  ok('a pending proposal preview says the terms are not confirmed instead of drawing rows',
    /proposalBlock\.paymentTermsPending \? \(/.test(cv)
    && /testID="proposal-terms-pending"/.test(cv)
    && /Payment terms not confirmed — your client can\\u2019t accept until you confirm them in Client Portal\./.test(cv));
  // In SNAPSHOT mode the reader is the homeowner: the two notes must speak the
  // portal page's sentences, never the GC's instructions, and the "To accept,
  // open the portal link" line must not sit under a proposal that cannot be
  // accepted yet (integration round 3).
  const flat = cv.replace(/\s+/g, ' ');
  ok('client-view: in snapshot mode the pending note is the homeowner sentence',
    /\{isSnapshotMode \? 'Your contractor is confirming the payment schedule\. You can accept once it is set\.' : 'Payment terms not confirmed/.test(flat));
  ok('client-view: in snapshot mode the outdated note is the homeowner sentence',
    /\{isSnapshotMode \? 'Your contractor is updating this proposal\. You can accept it once they have\.' : 'This proposal was published by an older version/.test(flat));
  ok('client-view: "To accept, open the portal link" renders only when the proposal is decidable',
    /\{!proposalBlock\.paymentTermsPending && proposalBlock\.version === PROPOSAL_ESIGN_VERSION && \( <Text style=\{styles\.budgetCaption\} testID="proposal-accept-location">/.test(flat));
}
{
  const setup = read('app/client-portal-setup.tsx');
  ok('the GC gets an explicit opt-in switch',
    /onValueChange=\{handleProposalSwitch\}/.test(setup));
  ok('…which is OFF by default',
    /proposalApprovalEnabled: false,/.test(setup));
  // A switch that cannot do anything is worse than no switch — and the switch
  // and the builder have to agree on what "cannot" means. They ask the SAME
  // function. The old gate checked only `linkedEstimate.id && grandTotal > 0`,
  // so the switch turned on (and read "Owner reviews the scope and price…")
  // for a project with a contract already sent, whose proposal
  // buildPortalProposal then refused to emit, with no explanation anywhere.
  ok('…is disabled on exactly the conditions buildPortalProposal refuses on',
    /disabled=\{!canProposeToClient\}/.test(setup)
    && /proposalBlockReason\(project, contractQ\.data \?\? undefined\)/.test(setup));
  ok('…and says WHY rather than sitting there dead',
    /: proposalBlock\.gc\}/.test(setup));
  ok('…and no longer hand-rolls its own gate beside the builder\'s',
    !/hasPricedEstimate/.test(setup), 'two gates that can disagree is the bug');
  // The switch does not, by itself, put anything in front of the homeowner:
  // the proposal reaches them on the next snapshot push, and a portal page
  // loaded before the feature shipped has no accept button at all.
  ok('…and the GC is told what the switch does NOT do on its own',
    /testID="proposal-rollout-note"/.test(setup)
    && /within seconds of switching it on/.test(setup)
    && /asks them to refresh before accepting/.test(setup));
  ok('the section subtitle no longer promises the accept path unconditionally',
    !/Let the client accept the proposal,/.test(setup)
    && /accept the proposal once it is switched on below/.test(setup));
  ok('the GC sees the signed decisions that come back',
    /\.from\('proposal_approvals'\)/.test(setup) && /acceptances\.map\(/.test(setup));
  ok('…including the record hash, which is what makes it evidence',
    /Record SHA-256 \{a\.document_hash\.slice\(0, 24\)\}/.test(setup));
  ok('…and a missing table (migration not applied yet) shows nothing, but any OTHER error throws',
    !/if \(error\) return \[\];/.test(setup)
    && /if \(acceptanceStateFromRead\(\{ data, error \}\) === 'none'\) return \[\];\s*\n\s*throw error;/.test(setup));
  ok('…and a failed acceptance read counts as unknown for the terms row',
    /acceptancesQ\.isError\s*\n?\s*\? 'unknown'/.test(setup));

  // ── Direction B: every writer of the flag or the stamp saves it ─────────────
  // The lite push in project-detail rebuilds the proposal from the SAVED
  // project on every open, so a stamp that lived only in this screen's state
  // would publish once and vanish.
  const cb = (name: string) => {
    const a = setup.indexOf(`const ${name} = useCallback(`);
    const b = setup.indexOf('\n  }, [', a);
    return a >= 0 && b > a ? setup.slice(a, b) : '';
  };
  const persist = cb('persistProposalKeys');
  ok('persistProposalKeys merges ONLY the proposal keys onto the saved portal via updateProject',
    /updateProject\(id, \{ clientPortal: \{ \.\.\.project\.clientPortal, \.\.\.keys \} \}\)/.test(persist)
    && /Pick<ClientPortalSettings, 'proposalApprovalEnabled' \| 'proposalPaymentTerms'>/.test(persist), persist);
  for (const name of ['handleProposalSwitch', 'handleUseCurrentTerms', 'confirmTerms']) {
    const body = cb(name);
    ok(`${name} exists and reaches persistProposalKeys`, body.length > 0 && /persistProposalKeys\(\{/.test(body), body.slice(0, 200));
  }
  {
    const sw = cb('handleProposalSwitch');
    ok('switching ON goes through the ask gate with the portal copy',
      /gate\.run\(/.test(sw) && /purpose: 'portal_proposal'/.test(sw) && /terms: true/.test(sw));
    ok('…and writes the flag AND the stamp together',
      /persistProposalKeys\(\{ proposalApprovalEnabled: true, proposalPaymentTerms: next\.stamp \}\)/.test(sw));
    ok('switching OFF saves the flag and keeps the stamp',
      /persistProposalKeys\(\{ proposalApprovalEnabled: false \}\)/.test(sw));
    const use = cb('handleUseCurrentTerms');
    const iRead = use.indexOf('await fetchProposalAcceptanceState(id)');
    const iStamp = use.indexOf('nextProposalStamp(');
    ok('"Use my current terms" awaits a FRESH acceptance read before nextProposalStamp',
      iRead >= 0 && iStamp > iRead && /acceptance, nowIso/.test(use), use.slice(0, 400));
    ok('…and refuses with the reason when accepted or unknown', /'refused' in next/.test(use) && /showAlert\(/.test(use));
  }
  ok('the terms row renders the proposalTermsState copy with its testIDs',
    /proposalTermsState\(\{ portal, profileSplit: settings\.paymentSplit, acceptance: acceptanceForTerms \}\)/.test(setup)
    && /testID="proposal-terms-row"/.test(setup) && /testID="proposal-terms-use-current"/.test(setup)
    && /testID="proposal-terms-confirm"/.test(setup));
  ok('…with the locked, differs and unconfirmed sentences',
    /these can&apos;t change/.test(setup) && /the terms your client was shown/.test(setup)
    && /without payment terms and can&apos;t accept it yet/.test(setup)
    && /Your client will need to reload the page before accepting/.test(setup));
  ok('a stamp written elsewhere is adopted into local state',
    /isValidStamp\(p\.proposalPaymentTerms\) \? p : \{ \.\.\.p, proposalPaymentTerms: savedStamp \}/.test(setup));
  ok('the ask sheet is rendered once', (setup.match(/<ClientDocumentAskSheet \{\.\.\.gate\.sheet\} \/>/g) ?? []).length === 1);
}
{
  const pd = read('app/project-detail.tsx');
  ok('project-detail: "Terms needed" badge from proposalTermsState, only when the proposal is not blocked',
    /proposalTermsState\(\{ portal: project\?\.clientPortal/.test(pd)
    && /portalTerms\.state === 'unconfirmed'\s*\n\s*&& !proposalBlockReason\(project, portalBadgeContract \?\? undefined\)/.test(pd)
    && /clientPortal: \{ label: 'Terms needed', tone: 'pending' \}/.test(pd));
  const a = pd.indexOf('const confirmPortalProposalTerms = useCallback(');
  const body = a >= 0 ? pd.slice(a, pd.indexOf('\n  }, [', a)) : '';
  ok('project-detail: the unconfirmed row stamps via updateProject with the two keys merged onto the saved portal',
    /clientPortal: \{ \.\.\.cp, proposalApprovalEnabled: cp\.proposalApprovalEnabled, proposalPaymentTerms: next\.stamp \}/.test(body)
    && /const cp = project\?\.clientPortal;/.test(body) && /termsGate\.run\(/.test(body), body.slice(0, 300));
  ok('project-detail: the row and its button are rendered', /testID="portal-terms-needed"/.test(pd) && /testID="portal-terms-confirm"/.test(pd));
  ok('project-detail: the ask sheet renders inside the tile sheet', /<ClientDocumentAskSheet \{\.\.\.termsGate\.sheet\} \/>\s*\n\s*<\/Modal>/.test(pd));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6c. THE ASK AT SUBSTANTIAL COMPLETION, AND THE MESSAGE STARTERS (2026-09-13)
//
// Two cheap things a homeowner portal is supposed to do and this one did not:
// ask for feedback when the job finishes, and make raising a request one tap
// instead of a blank box.
//
// The honesty constraint governs both. Zuper's portal auto-triggers a
// satisfaction SURVEY and converts a customer request into a JOB. MAGE does
// neither — there is no survey table and no request-to-job conversion — so
// what ships is a prompt that opens the message thread that already exists,
// and both surfaces say that in so many words. What is pinned below is
// precisely that: the prompts exist, and they do not claim to be more.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — completion ask + message starters:');

{
  const base = { ...proposalProject, substantialCompletionDate: undefined } as unknown as Project;
  ok('no completion date → no ask (nothing to ask about)',
    buildFeedbackAsk(base, portalSettings, '2026-09-13') === undefined);

  const future = { ...proposalProject, substantialCompletionDate: '2026-12-01' } as unknown as Project;
  ok('a completion date still in the future → no ask',
    buildFeedbackAsk(future, portalSettings, '2026-09-13') === undefined,
    'asking "how did it go" before the job is done is worse than not asking');

  const past = { ...proposalProject, substantialCompletionDate: '2026-08-01' } as unknown as Project;
  expect('a completion date that has arrived → ask, carrying that date',
    buildFeedbackAsk(past, portalSettings, '2026-09-13'), { completedOn: '2026-08-01' });
  expect('the boundary day itself counts',
    buildFeedbackAsk(past, portalSettings, '2026-08-01'), { completedOn: '2026-08-01' });
  ok('the day before does not',
    buildFeedbackAsk(past, portalSettings, '2026-07-31') === undefined);
  ok('a disabled portal never asks',
    buildFeedbackAsk(past, { ...portalSettings, enabled: false } as unknown as ClientPortalSettings, '2026-09-13') === undefined);
  // A timestamp, not a calendar date, is what the app actually stores on some
  // paths. It must not be read as "unknown".
  expect('an ISO timestamp is normalised to its calendar day',
    buildFeedbackAsk({ ...proposalProject, substantialCompletionDate: '2026-08-01T17:30:00.000Z' } as unknown as Project,
      portalSettings, '2026-09-13'),
    { completedOn: '2026-08-01' });

  // And it reaches the snapshot both writers produce.
  const snap = buildProposalSnapshot(past);
  expect('the ask rides the snapshot', snap.feedbackAsk, { completedOn: '2026-08-01' });
  expect('…and carries NO rating, score or survey field',
    Object.keys(snap.feedbackAsk ?? {}).sort(), ['completedOn']);
}
{
  ok('the portal renders the ask', /function renderFeedbackAsk\(/.test(portalHtml)
    && portalHtml.includes("addSection('feedback'"));
  ok('…only when there is somewhere to send a message',
    /var showFeedbackAsk = !!feedbackAsk && !!data\.portalApi/.test(portalHtml));
  ok('…and not after the homeowner has already written since completion',
    /!homeownerRepliedSince\(data, feedbackAsk\.completedOn\)/.test(portalHtml)
    && /function homeownerRepliedSince\(/.test(portalHtml));
  ok('…and not after they have waved it off on this device',
    /!feedbackDismissed\(data\.portalApi\.portalId\)/.test(portalHtml)
    && /data-feedback-dismiss/.test(portalHtml));
  // THE HONESTY LINE. Without it a homeowner can reasonably think they are
  // leaving a public review or a star rating. Neither exists.
  ok('the card says the buttons write a message, publish nothing, and record no rating',
    /These write a message in your thread with your contractor\./.test(portalHtml)
    && /Nothing is published anywhere/.test(portalHtml)
    && /no rating is recorded/.test(portalHtml));
  ok('there is no star / score widget anywhere on the page',
    !/star-rating|data-rating|★/.test(portalHtml));
  ok('the local reply check counts messages sent from this device too',
    /loadLocalMessages\(data\)/.test(portalHtml.slice(
      portalHtml.indexOf('function homeownerRepliedSince'),
      portalHtml.indexOf('var FEEDBACK_PROMPTS'))),
    'app/project-detail.tsx pushes a snapshot with messages: [], so an empty thread is not evidence of silence');
}
{
  ok('the message composer offers tap-to-start prompts',
    /var MESSAGE_PROMPTS = \[/.test(portalHtml) && /data-msg-prompt=/.test(portalHtml));
  ok('…including asking for more work — the request a portal is judged on',
    /Request additional work/.test(portalHtml));
  ok('…and they fill the box rather than sending anything',
    /msgInput\.value = opener;/.test(portalHtml)
    && !/data-msg-prompt[\s\S]{0,400}postPortalMessage/.test(portalHtml));
  ok('…under a heading that says what actually happens to them',
    /Start a message — your contractor reads these/.test(portalHtml));
  // Zuper converts a portal request into a job. MAGE does not, and must not
  // imply it.
  ok('nothing on the page claims a request becomes a job automatically',
    !/automatically (creates|converted|becomes) a job/i.test(portalHtml));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. PORTAL-01 / PORTAL-07 — the two numbers and the one string the homeowner
//    reads first (runtime audit 2026-09-06)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — headline stat + share link:');

// The exact shape that produced "Project complete: 102%" in production:
// contract 44,325 + a 3,400 approved CO = 47,725 (PRE-tax), against one
// invoice of 45,300.51 + 3,397.54 tax, paid 48,826.93 (tax-INCLUSIVE cash).
const HENDERSON_TASKS = Array.from({ length: 20 }, (_, i) => ({
  id: `h${i}`, title: `Task ${i}`, phase: 'Build', durationDays: 3, startDay: i * 3,
  progress: 0, status: 'not_started', crew: '', dependencies: [], notes: '',
}));
const henderson = {
  id: 'hen', name: 'The Henderson Residence', type: 'renovation', status: 'in_progress',
  linkedEstimate: { grandTotal: 44_325, baseTotal: 44_325, items: [] },
  contractMode: 'fixed',
  schedule: { startDate: '2026-05-04', workingDaysPerWeek: 5, totalDurationDays: 60, tasks: HENDERSON_TASKS },
  updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as Project;

const hendersonSnap = buildPortalSnapshot({
  project: henderson,
  portal: portalSettings,
  changeOrders: [
    { id: 'hco', projectId: 'hen', number: 1, description: 'Extra tile', reason: '', date: '2026-06-01', status: 'approved', changeAmount: 3_400, newContractTotal: 47_725, lineItems: [] },
  ] as unknown as ChangeOrder[],
  invoices: [
    {
      id: 'hinv', number: 1, projectId: 'hen', type: 'progress', issueDate: '2026-06-10', dueDate: '2026-07-10',
      paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 45_300.51, taxRate: 7.5, taxAmount: 3_397.53825,
      totalDue: 48_698.04825, amountPaid: 48_826.93, status: 'paid', payments: [],
      createdAt: '2026-06-10', updatedAt: '2026-07-01',
    },
  ] as unknown as Invoice[],
});
const hbudget = hendersonSnap.sections.budget!;

// The regression itself. The old formula is reproduced here so the test fails
// loudly if anyone reinstates it rather than quietly agreeing with it.
expect('the old percent-PAID formula really did produce 102 on this data',
  Math.round((48_826.93 / 47_725) * 100), 102);
ok('the snapshot no longer emits pctComplete at all',
  !Object.prototype.hasOwnProperty.call(hbudget, 'pctComplete'), JSON.stringify(hbudget));
expect('a schedule nobody has updated reports work-complete as null, not 0%',
  hbudget.workComplete, null);
expect('…and the hero progress figure is absent rather than an invented 0',
  hendersonSnap.project.progressPct, undefined);
expect('contract value stays the pre-tax contract + approved COs', hbudget.contractValue, 47_725);
expect('paid-to-date stays the cash actually received', hbudget.paidToDate, 48_826.93);
expect('outstanding is billed-and-unpaid — not pre-tax contract minus taxed cash',
  hbudget.outstanding, 0);

// Basis check: outstanding must track the INVOICES, not the contract. Half the
// contract billed and a quarter of that paid.
{
  const partial = buildPortalSnapshot({
    project: henderson,
    portal: portalSettings,
    invoices: [
      {
        id: 'p1', number: 1, projectId: 'hen', type: 'progress', issueDate: '2026-06-10', dueDate: '2026-07-10',
        paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 20_000, taxRate: 7.5, taxAmount: 1_500,
        totalDue: 21_500, amountPaid: 5_000, status: 'sent', payments: [],
        // MONEY-05: 10% of the $20,000 of WORK, not of the $21,500 taxed total.
        // This fixture was itself written on the tax-inclusive basis (2,150) —
        // which is how far MISS-04 reached: even the guard agreed with the bug.
        retentionPercent: 10, retentionAmount: 2_000, retentionReleased: 0,
        createdAt: '2026-06-10', updatedAt: '2026-06-10',
      },
    ] as unknown as Invoice[],
  });
  const b = partial.sections.budget!;
  // 21,500 billed − 2,000 retention still held − 5,000 paid = 14,500.
  expect('outstanding nets the retention the contract lets the client hold', b.outstanding, 14_500);
  ok('outstanding is NOT contract-minus-cash', b.outstanding !== b.contractValue - b.paidToDate,
    `${b.outstanding} vs ${b.contractValue - b.paidToDate}`);
  ok('paid + outstanding no longer collapses onto contractValue (it tracks billing, not the contract)',
    b.paidToDate + b.outstanding < b.contractValue,
    `${b.paidToDate} + ${b.outstanding} vs ${b.contractValue}`);
  ok('every budget figure is whole cents',
    [b.contractValue, b.paidToDate, b.outstanding, b.invoicedToDate!, b.retentionHeld!]
      .every(v => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6),
    JSON.stringify(b));
  // The three legs of the portal's money bar must add up to what was billed,
  // or the bar is asserting a total its own legend contradicts.
  expect('paid + due-now + retention-held === invoiced',
    b.paidToDate + b.outstanding + b.retentionHeld!, b.invoicedToDate!);
}

// ── The population `outstanding` is summed over ─────────────────────────────
// It must be the SAME set of invoices the client's list renders. Anything
// wider bills the homeowner for a document that is not on their page.
{
  const inv = (over: Record<string, unknown>) => ({
    id: 'i', number: 1, projectId: 'hen', type: 'progress', issueDate: '2026-06-10',
    dueDate: '2026-07-10', paymentTerms: 'net_30', notes: '', lineItems: [],
    subtotal: 10_000, taxRate: 8, taxAmount: 800, totalDue: 10_800, amountPaid: 0,
    status: 'sent', payments: [], createdAt: '2026-06-10', updatedAt: '2026-06-10',
    ...over,
  }) as unknown as Invoice;

  const withDraft = buildPortalSnapshot({
    project: henderson, portal: portalSettings,
    invoices: [inv({ id: 'sent1' }), inv({ id: 'draft1', status: 'draft', subtotal: 27_000, taxAmount: 0, totalDue: 27_000 })],
  });
  expect('a DRAFT invoice the GC has never issued is not billed to the client',
    withDraft.sections.budget!.outstanding, 10_800);
  expect('…nor counted as invoiced', withDraft.sections.budget!.invoicedToDate, 10_800);

  const withRecalled = buildPortalSnapshot({
    project: henderson, portal: portalSettings,
    invoices: [
      inv({ id: 'sent1' }),
      inv({ id: 'rec1', subtotal: 27_000, taxAmount: 0, totalDue: 27_000, portalState: { status: 'recalled' } }),
    ],
  });
  const rb = withRecalled.sections.budget!;
  const rows = withRecalled.sections.invoices ?? [];
  expect('an invoice the GC RECALLED is not billed to the client, and its amount is not disclosed',
    rb.outstanding, 10_800);
  expect('the client sees exactly one invoice row', rows.length, 1);
  expect('the headline equals the sum of the rows the client can see',
    rb.outstanding, rows.reduce((sum, r) => sum + (r.balance ?? 0), 0));
  ok('no withheld dollar amount leaks anywhere in the payload',
    !JSON.stringify(withRecalled).includes('27000'), JSON.stringify(rb));

  // Retention is billed but not due today, so it belongs to neither
  // "paid" nor "outstanding" — it is reported on its own.
  const withRet = buildPortalSnapshot({
    project: henderson, portal: portalSettings,
    // MONEY-05: `inv` is subtotal 10,000 + 800 tax. 10% of the WORK is 1,000;
    // the 1,080 this fixture used to assert is 10% of the taxed 10,800 — the
    // stored-column basis. The stored figure is deliberately left at 1,080 so
    // this case also proves the reader ignores it.
    invoices: [inv({ id: 'r1', retentionPercent: 10, retentionAmount: 1_080, retentionReleased: 0, amountPaid: 2_000 })],
  });
  const wb = withRet.sections.budget!;
  expect('retention held is 10% of the work value, not of the taxed total', wb.retentionHeld, 1_000);
  expect('…and excluded from what is due now', wb.outstanding, 10_800 - 1_000 - 2_000);
  expect('…while the invoiced total still carries it', wb.invoicedToDate, 10_800);
}

// Work-complete: the rollup itself, at the boundaries that matter.
{
  const t = (over: Record<string, unknown>) => ({
    id: 'x', title: 'x', phase: 'p', durationDays: 10, startDay: 0, progress: 0,
    status: 'not_started', crew: '', dependencies: [], notes: '', ...over,
  });
  const withTasks = (tasks: unknown[]) => ({
    ...henderson, schedule: { ...(henderson as any).schedule, tasks },
  } as unknown as Project);
  expect('no schedule at all → null', scheduleWorkComplete({ ...henderson, schedule: undefined } as unknown as Project), null);
  expect('milestones alone are not progress → null',
    scheduleWorkComplete(withTasks([t({ isMilestone: true, progress: 100, status: 'done' })])), null);
  expect('a task marked done with no percent still counts as a real signal',
    scheduleWorkComplete(withTasks([t({ status: 'done' }), t({})])), 0);
  expect('duration-weighted, not a flat average',
    scheduleWorkComplete(withTasks([t({ durationDays: 30, progress: 100 }), t({ durationDays: 10, progress: 0 })])), 75);
  expect('out-of-range task progress is clamped, so the stat cannot exceed 100',
    scheduleWorkComplete(withTasks([t({ progress: 400 })])), 100);
}

// ── Cross-runtime equivalence: the static portal's copy of the rollup ───────
// The portal HTML has no build step and cannot import TypeScript, so it ships
// a hand-written deriveWorkProgress. If the two ever disagree, the homeowner's
// headline stat stops matching the app's — the exact class of drift the 102%
// bug lived in. Lift the portal's copy out of the file and run it head-to-head.
{
  const start = portalHtml.indexOf('  function deriveWorkProgress(data) {');
  const stop = portalHtml.indexOf('  // ───────── Stats bar ─────────', start);
  ok('portal work-progress rollup is extractable for a head-to-head check', start >= 0 && stop > start);
  if (start >= 0 && stop > start) {
    // eslint-disable-next-line no-new-func
    const portalDerive = new Function(`${portalHtml.slice(start, stop)}\nreturn deriveWorkProgress;`)() as
      (d: unknown) => { known: boolean; pct: number };
    const cases: { name: string; project: Project }[] = [
      { name: 'an untouched 20-task schedule', project: henderson },
      { name: 'the Maple St fixture (milestones only)', project },
      {
        name: 'a part-built schedule',
        project: {
          ...henderson,
          schedule: {
            ...(henderson as any).schedule,
            tasks: [
              { id: 'a', title: 'a', phase: 'p', durationDays: 30, startDay: 0, progress: 100, status: 'done', crew: '', dependencies: [], notes: '' },
              { id: 'b', title: 'b', phase: 'p', durationDays: 10, startDay: 30, progress: 40, status: 'in_progress', crew: '', dependencies: [], notes: '' },
              { id: 'c', title: 'c', phase: 'p', durationDays: 20, startDay: 40, progress: 0, status: 'not_started', crew: '', dependencies: [], notes: '' },
              { id: 'm', title: 'm', phase: 'p', durationDays: 0, startDay: 60, progress: 0, status: 'not_started', isMilestone: true, crew: '', dependencies: [], notes: '' },
            ],
          },
        } as unknown as Project,
      },
    ];
    for (const c of cases) {
      const snap = buildPortalSnapshot({ project: c.project, portal: portalSettings });
      const ts = scheduleWorkComplete(c.project);
      const html = portalDerive(snap);
      expect(`app and portal agree on work-complete — ${c.name}`,
        [html.known, html.known ? html.pct : null], [ts != null, ts]);
    }
    // And the honesty rule itself, stated on the portal side.
    expect('the portal reports "unknown" (not 0%) for an untouched schedule',
      portalDerive(buildPortalSnapshot({ project: henderson, portal: portalSettings })).known, false);
    // When the GC hides the schedule, the portal falls back to the rollup the
    // app already computed. `null` is the app saying it does not know; a
    // numeric 0 is the app saying zero. Reading a real 0 as "unknown" makes
    // the two surfaces disagree about a value the app actually has.
    expect('a hidden schedule with a real 0% renders 0%, not "Not reported yet"',
      portalDerive({ sections: { budget: { workComplete: 0 } } }), { known: true, pct: 0 });
    expect('a hidden schedule with no progress recorded still renders unknown',
      portalDerive({ sections: { budget: { workComplete: null } } }), { known: false, pct: 0 });
    expect('a pre-2026-09-06 snapshot\'s ambiguous progressPct: 0 stays unknown',
      portalDerive({ sections: {}, project: { progressPct: 0 } }), { known: false, pct: 0 });
  }
}

// ── ONE completion date, on three surfaces ─────────────────────────────────
//
// The portal hero used to print `startDate + totalDurationDays * 86400000`.
// `totalDurationDays` is a WORKING-day ordinal, so on a 5-day week that landed
// roughly 40% early — a 100-working-day job read about six weeks sooner than
// the schedule said. It is the first date a homeowner sees, on a page their GC
// sent them, and it is the one they book a lease end or a move-out around.
//
// Worse, the Gantt LOWER DOWN THE SAME PAGE printed a different day: it used
// `startDay + durationDays` with no `- 1` and advanced by the full ordinal,
// landing two working days late, and it never received `nonWorkingDates` at
// all so it ran straight through holidays and rain days the app had already
// suppressed. An attentive owner could scroll from one date to the other and
// watch their own portal contradict itself.
//
// So this block does not check a formula — it holds the three surfaces head to
// head on the same fixtures:
//
//   1. utils/portalSnapshot.ts scheduleFinishDate  (the hero)
//   2. marketing/portal/index.html renderSchedule  (the Gantt header)
//   3. utils/ownerConfidence.ts projectedFinishISO (what the GC sees in-app)
//
// All three must name the same calendar day. Any future edit that re-derives a
// finish date in one of them and not the others turns this red.
{
  const isoOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ── 1. The working-day/calendar-day confusion itself ────────────────────
  // Mon 2026-05-04, 20 tasks of 3 days, last one ending on working day 59.
  const hendersonFinish = scheduleFinishDate((henderson as any).schedule);
  const naiveCalendar = isoOf(
    new Date(new Date('2026-05-04T00:00:00').getTime() + 60 * 86400000),
  );
  ok('the old calendar-day formula really was weeks early on this fixture',
    hendersonFinish != null
    && Date.parse(hendersonFinish) - Date.parse(naiveCalendar) >= 14 * 86400000,
    `scheduleFinishDate=${hendersonFinish} old formula=${naiveCalendar}`);
  expect('the hero ships the working-day finish, not the calendar-day one',
    hendersonSnap.project.targetDate, hendersonFinish ?? undefined);
  // Source scan over CODE only — the comment that explains the defect is
  // allowed to quote it, and should, or the next reader has no idea why the
  // helper exists.
  ok('portalSnapshot no longer multiplies a duration by 86400000',
    !read('utils/portalSnapshot.ts').split('\n')
      .some(l => !/^\s*(?:\/\/|\*|\/\*)/.test(l) && /DurationDays \* 86400000/.test(l)));

  // ── 2. The off-by-one. Day 1 IS the start date ──────────────────────────
  // A one-day job starting Mon 2026-05-04 finishes Mon 2026-05-04, not Tue.
  const oneDay = {
    startDate: '2026-05-04', workingDaysPerWeek: 5, totalDurationDays: 1,
    tasks: [{ id: 'a', title: 'a', startDay: 1, durationDays: 1 }],
  } as any;
  expect('a one-day job finishes on the day it starts', scheduleFinishDate(oneDay), '2026-05-04');
  // Five working days from Monday is Friday — crossing no weekend.
  expect('a one-week job finishes Friday, not the following Monday',
    scheduleFinishDate({ ...oneDay, totalDurationDays: 5, tasks: [{ id: 'a', title: 'a', startDay: 1, durationDays: 5 }] }),
    '2026-05-08');
  // Six working days from Monday steps over Sat+Sun to the next Monday.
  expect('the sixth working day steps over the weekend',
    scheduleFinishDate({ ...oneDay, totalDurationDays: 6, tasks: [{ id: 'a', title: 'a', startDay: 1, durationDays: 6 }] }),
    '2026-05-11');
  // A marked holiday inside the run pushes the finish by exactly one day.
  expect('a non-working day inside the run pushes the finish out by one',
    scheduleFinishDate({
      ...oneDay, totalDurationDays: 5, nonWorkingDates: ['2026-05-06'],
      tasks: [{ id: 'a', title: 'a', startDay: 1, durationDays: 5 }],
    }),
    '2026-05-11');
  // No anchor = no date. A guessed completion date IS the bug.
  expect('no start date means no finish date — never today', scheduleFinishDate({ ...oneDay, startDate: undefined }), null);
  expect('no schedule at all means no finish date', scheduleFinishDate(undefined), null);
  // The authored tasks are the plan; a stale cached scalar must not win.
  expect('the tasks outrank a stale totalDurationDays',
    scheduleFinishDate({ ...oneDay, totalDurationDays: 999, tasks: [{ id: 'a', title: 'a', startDay: 1, durationDays: 5 }] }),
    '2026-05-08');

  // ── 3. Same day as the GC's own app ─────────────────────────────────────
  const finishCases: { name: string; project: Project }[] = [
    { name: 'the Henderson fixture', project: henderson },
    {
      name: 'a 6-day week with two marked closures',
      project: {
        ...henderson,
        schedule: {
          ...(henderson as any).schedule,
          workingDaysPerWeek: 6,
          nonWorkingDates: ['2026-05-25', '2026-07-03'],
        },
      } as unknown as Project,
    },
    {
      name: 'ragged task ends (the longest task is not the last one)',
      project: {
        ...henderson,
        schedule: {
          ...(henderson as any).schedule,
          tasks: [
            { id: 'a', title: 'a', phase: 'p', startDay: 1, durationDays: 40, progress: 0, status: 'not_started', crew: '', dependencies: [], notes: '' },
            { id: 'b', title: 'b', phase: 'p', startDay: 10, durationDays: 5, progress: 0, status: 'not_started', crew: '', dependencies: [], notes: '' },
            { id: 'm', title: 'm', phase: 'p', startDay: 41, durationDays: 0, progress: 0, status: 'not_started', isMilestone: true, crew: '', dependencies: [], notes: '' },
          ],
        },
      } as unknown as Project,
    },
  ];
  for (const c of finishCases) {
    const inApp = buildOwnerConfidence({
      project: c.project, changeOrders: [], invoices: [], nowMs: Date.parse('2026-06-01T12:00:00Z'),
    }).projectedFinishISO;
    expect(`the portal finish equals the in-app projected finish — ${c.name}`,
      scheduleFinishDate((c.project as any).schedule), inApp);
  }

  // ── 4. …and the same day as the Gantt on the same page ──────────────────
  // The static portal has no build step and cannot import TypeScript, so it
  // carries a hand-written copy of this maths. Lift both halves out of the
  // file and run them against the snapshot the page would actually receive.
  const awdStart = portalHtml.indexOf('  function parseCalendarDate(value) {');
  const awdStop = portalHtml.indexOf('  function fmtMonthShort(d) {', awdStart);
  const finStart = portalHtml.indexOf('    function startOrdinal(t) {');
  const finStop = portalHtml.indexOf('    // Geometry runs on a HALF-OPEN interval', finStart);
  ok('the portal Gantt\'s finish maths is extractable for a head-to-head check',
    awdStart >= 0 && awdStop > awdStart && finStart >= 0 && finStop > finStart,
    `awd=${awdStart}..${awdStop} fin=${finStart}..${finStop}`);
  if (awdStart >= 0 && awdStop > awdStart && finStart >= 0 && finStop > finStart) {
    // eslint-disable-next-line no-new-func
    const portalDateFns = new Function(
      `${portalHtml.slice(awdStart, awdStop)}\nreturn { parseCalendarDate: parseCalendarDate, addWorkingDays: addWorkingDays };`,
    )() as {
      parseCalendarDate: (v: string) => Date;
      addWorkingDays: (s: Date, d: number, dpw: number, nwd?: string[] | null) => Date;
    };
    const portalAddWorkingDays = portalDateFns.addWorkingDays;
    // eslint-disable-next-line no-new-func
    const portalGanttFinish = new Function(
      'tasks', 'projectStart', 'dpw', 'nonWorking', 'addWorkingDays',
      `${portalHtml.slice(finStart, finStop)}\nreturn projectEnd;`,
    ) as (
      tasks: unknown[], projectStart: Date, dpw: number, nonWorking: string[] | null,
      awd: typeof portalAddWorkingDays,
    ) => Date;

    for (const c of finishCases) {
      const snap = buildPortalSnapshot({ project: c.project, portal: portalSettings });
      const section = snap.sections.schedule!;
      // Anchor it exactly the way the page does — with the page's OWN
      // parseCalendarDate, so a regression in the anchor (UTC vs local
      // midnight, which silently moved the whole Gantt back a day for every
      // viewer west of Greenwich) shows up here as a disagreement.
      const drawn = portalGanttFinish(
        section.tasks,
        portalDateFns.parseCalendarDate(section.startDate!),
        section.workingDaysPerWeek || 5,
        section.nonWorkingDates || null,
        portalAddWorkingDays,
      );
      expect(`hero and Gantt print the same finish day — ${c.name}`,
        isoOf(drawn), snap.project.targetDate);
    }

    // The closures have to REACH the page, or the Gantt silently draws a
    // different calendar from the hero that sits above it.
    const closures = buildPortalSnapshot({ project: finishCases[1].project, portal: portalSettings });
    expect('marked non-working days are shipped to the portal',
      closures.sections.schedule!.nonWorkingDates, ['2026-05-25', '2026-07-03']);
    ok('…and are omitted rather than shipped empty when there are none',
      !Object.prototype.hasOwnProperty.call(hendersonSnap.sections.schedule!, 'nonWorkingDates'));
  }

  // The two specific shapes that were wrong, pinned as source so a rewrite
  // that reintroduces either one fails even if a fixture stops covering it.
  ok('the portal Gantt no longer advances by the full ordinal',
    !/addWorkingDays\(projectStart, maxEndDay, dpw\)/.test(portalHtml));
  ok('the portal Gantt passes the closures through to its date maths',
    /addWorkingDays\(projectStart, Math\.max\(0, maxEndDay - 1\), dpw, nonWorking\)/.test(portalHtml));
  ok('the hero labels the finish as the plan, not a bare arrow',
    /scheduled finish/.test(portalHtml));
}

// ── The pace verdict, on the page the homeowner actually opens ─────────────
//
// The app computed "On track / Minor delays / Behind schedule" and rendered it
// only in the GC's in-app preview; the homeowner's portal said nothing about
// whether the job was on time. The page now computes it itself, against the
// viewer's today — NOT from the snapshot, where a verdict frozen at publish
// time would still say "On track" weeks later.
//
// Held here, head-to-head:
//   - the page's deriveSchedulePace vs utils/ownerConfidence ownerSchedulePace
//     over a sweep of "todays" on several schedules, so a drifted threshold,
//     gate, finish ordinal or pace formula on either side turns this red;
//   - the page's threshold constants and chip labels vs the TypeScript ones;
//   - the evidence gate: no reported work or no start date → no chip at all.
{
  const awdStart = portalHtml.indexOf('  function parseCalendarDate(value) {');
  const awdStop = portalHtml.indexOf('  function fmtMonthShort(d) {', awdStart);
  const wpStart = portalHtml.indexOf('  function deriveWorkProgress(data) {');
  const paceStart = portalHtml.indexOf('  // ───────── Schedule pace (hero chip) ─────────');
  const paceStop = portalHtml.indexOf('  // ───────── Stats bar ─────────', paceStart);
  const extractable = awdStart >= 0 && awdStop > awdStart && wpStart >= 0 && paceStart > wpStart && paceStop > paceStart;
  ok('the portal pace read is extractable for a head-to-head check', extractable,
    `awd=${awdStart}..${awdStop} wp=${wpStart} pace=${paceStart}..${paceStop}`);
  if (extractable) {
    // deriveWorkProgress ends where the pace block begins; the pace block ends
    // at the stats bar. One slice carries both, plus the calendar helpers.
    const fmtStart = portalHtml.indexOf('  function fmtCalendarDate(dateStr, withYear) {');
    const fmtStop = portalHtml.indexOf('  function fmtPercent(n, dec) {', fmtStart);
    const monthsDecl = /var CAL_MONTHS = \[[^\]]*\];/.exec(portalHtml)?.[0] ?? '';
    ok('fmtCalendarDate + CAL_MONTHS are extractable', fmtStart >= 0 && fmtStop > fmtStart && monthsDecl.length > 0);
    const fallbackStart = portalHtml.indexOf('  var FALLBACK_STRINGS = {');
    const fallbackStop = portalHtml.indexOf('  function isCommercialProject() {', fallbackStart);
    // eslint-disable-next-line no-new-func
    const page = new Function('window', `
      function fmtDateShort(v){ return String(v); }
      ${monthsDecl}
      ${portalHtml.slice(fallbackStart, fallbackStop)}
      function isCommercialProject() { var d = window.__portalData; return !!(d && d.project && d.project.type === 'commercial'); }
      function t(key, vars) {
        var data = window.__portalData; var bundle = (data && data.uiStrings) || {};
        var fallback = (isCommercialProject() && COMMERCIAL_PASSPORT_STRINGS[key]) || FALLBACK_STRINGS[key];
        var s = bundle[key] || fallback || key;
        if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
        return s;
      }
      ${portalHtml.slice(fmtStart, fmtStop)}
      ${portalHtml.slice(awdStart, awdStop)}
      ${portalHtml.slice(wpStart, paceStop)}
      return { deriveSchedulePace: deriveSchedulePace, schedulePaceCopy: schedulePaceCopy,
        FALLBACK_STRINGS: FALLBACK_STRINGS, ON: PACE_ON_TRACK_MIN_DELTA, MINOR: PACE_MINOR_DELAYS_MIN_DELTA };
    `);
    const win: { __portalData?: unknown } = {};
    const P = page(win) as {
      deriveSchedulePace: (section: unknown, nowMs: number) => { status: string; pct: number; expected: number; finishISO: string } | null;
      schedulePaceCopy: (pace: unknown, nowMs: number) => { chip: string; basis: string };
      FALLBACK_STRINGS: Record<string, string>;
      ON: number; MINOR: number;
    };

    expect('page pace thresholds equal utils/ownerConfidence OWNER_PACE_THRESHOLDS',
      [P.ON, P.MINOR], [OWNER_PACE_THRESHOLDS.onTrackMinDelta, OWNER_PACE_THRESHOLDS.minorDelaysMinDelta]);
    expect('page chip labels equal the in-app card labels',
      [P.FALLBACK_STRINGS.paceOnTrack, P.FALLBACK_STRINGS.paceMinorDelays, P.FALLBACK_STRINGS.paceBehind, P.FALLBACK_STRINGS.paceComplete],
      [STATUS_LABEL.on_track, STATUS_LABEL.minor_delays, STATUS_LABEL.behind, STATUS_LABEL.complete]);

    const tk = (id: string, startDay: number, durationDays: number, progress: number, status = progress >= 100 ? 'done' : progress > 0 ? 'in_progress' : 'not_started', isMilestone = false) =>
      ({ id, title: id, phase: 'p', startDay, durationDays, progress, status, isMilestone, crew: '', dependencies: [], notes: '' });
    const withSchedule = (sched: Record<string, unknown>): Project =>
      ({ ...henderson, schedule: { ...(henderson as any).schedule, ...sched } } as unknown as Project);
    const paceCases: { name: string; project: Project }[] = [
      { name: 'the untouched Henderson schedule', project: henderson },
      { name: 'a part-built job', project: withSchedule({ tasks: [tk('a', 1, 20, 100), tk('b', 21, 15, 40), tk('c', 36, 25, 0), tk('m', 60, 0, 0, 'not_started', true)] }) },
      { name: 'a 6-day week with closures', project: withSchedule({ workingDaysPerWeek: 6, nonWorkingDates: ['2026-05-25', '2026-07-03'], tasks: [tk('a', 1, 30, 50), tk('b', 31, 30, 0)] }) },
      { name: 'status in_progress with 0%', project: withSchedule({ tasks: [tk('a', 1, 40, 0, 'in_progress')] }) },
      { name: 'milestone-only progress', project: withSchedule({ tasks: [tk('m', 1, 0, 100, 'done', true), tk('a', 1, 40, 0)] }) },
      { name: 'every task done', project: withSchedule({ tasks: [tk('a', 1, 10, 100), tk('b', 11, 10, 100)] }) },
      { name: 'a one-day job', project: withSchedule({ tasks: [tk('a', 1, 1, 50)] }) },
      { name: 'no start date', project: withSchedule({ startDate: undefined, tasks: [tk('a', 1, 20, 50)] }) },
    ];
    const seen = new Set<string>();
    let compared = 0;
    let firstMismatch = '';
    for (const c of paceCases) {
      const snap = buildPortalSnapshot({ project: c.project, portal: portalSettings });
      const section = snap.sections.schedule;
      const sch = (c.project as any).schedule;
      // Every day from a week before the start to well past the finish, at an
      // afternoon hour so the local-midnight anchor is exercised mid-day.
      for (let day = -7; day <= 130; day++) {
        const nowMs = new Date(2026, 4, 4 + day, 15, 0, 0).getTime();
        const ts = ownerSchedulePace({ tasks: sch.tasks, startDate: sch.startDate, workingDaysPerWeek: sch.workingDaysPerWeek, nonWorkingDates: sch.nonWorkingDates, nowMs });
        const pg = P.deriveSchedulePace(section, nowMs);
        const a = ts && [ts.status, ts.pct, Math.round(ts.expected * 1e6), ts.finishISO];
        const b = pg && [pg.status, pg.pct, Math.round(pg.expected * 1e6), pg.finishISO];
        compared++;
        if (ts) seen.add(ts.status); else seen.add('none');
        // The chip's date is the hero's date is the Gantt's date.
        if (pg && pg.finishISO !== snap.project.targetDate && !firstMismatch) {
          firstMismatch = `${c.name} day ${day}: chip finish ${pg.finishISO} != hero targetDate ${snap.project.targetDate}`;
        }
        if (JSON.stringify(a) !== JSON.stringify(b) && !firstMismatch) {
          firstMismatch = `${c.name} day ${day}: app=${JSON.stringify(a)} page=${JSON.stringify(b)}`;
        }
      }
    }
    ok(`app and portal give the same pace verdict on every day swept (${compared} comparisons)`, !firstMismatch, firstMismatch);
    expect('the sweep actually covers every verdict and the no-chip case',
      ['on_track', 'minor_delays', 'behind', 'complete', 'none'].every(k => seen.has(k)), true);

    // The gate, stated on the page side, on a live payload.
    const midJob = new Date(2026, 5, 20, 12).getTime();
    expect('no chip for an untouched schedule (never "Behind" for work nobody reported)',
      P.deriveSchedulePace(hendersonSnap.sections.schedule, midJob), null);
    expect('no chip without a start date (never an unearned "On track")',
      P.deriveSchedulePace({ ...hendersonSnap.sections.schedule, startDate: undefined, tasks: [tk('a', 1, 20, 50)] }, midJob), null);
    // An old payload (no nonWorkingDates, no totalDurationDays) still reads.
    ok('a pre-closure-era payload still yields a verdict',
      P.deriveSchedulePace({ startDate: '2026-05-04', workingDaysPerWeek: 5, tasks: [tk('a', 1, 20, 50)] }, midJob) !== null);

    // The words: tense follows the calendar, the plan is never called a forecast.
    const behind = { status: 'behind', pct: 20, expected: 0.6, finishISO: '2026-08-21' };
    win.__portalData = { project: { type: 'renovation' } };
    expect('behind, finish ahead → planned finish',
      P.schedulePaceCopy(behind, new Date(2026, 6, 1, 9).getTime()).chip, 'Behind schedule · planned finish Aug 21');
    expect('behind, finish passed → was due',
      P.schedulePaceCopy(behind, new Date(2026, 8, 1, 9).getTime()).chip, 'Behind schedule · was due Aug 21');
    expect('on track → finishing',
      P.schedulePaceCopy({ ...behind, status: 'on_track' }, new Date(2026, 6, 1, 9).getTime()).chip, 'On track · finishing Aug 21');
    expect('the basis line names what the verdict rests on',
      P.schedulePaceCopy(behind, new Date(2026, 6, 1, 9).getTime()).basis, '20% of the work reported done · 60% of the scheduled time used');
    win.__portalData = { project: { type: 'commercial' } };
    expect('commercial projects get completion wording via the copy switch',
      P.schedulePaceCopy({ ...behind, status: 'on_track' }, new Date(2026, 6, 1, 9).getTime()).chip, 'On track · scheduled completion Aug 21');
    win.__portalData = undefined;
    ok('no chip copy ever says "now finishing" (the date is the plan, not a forecast)',
      !/now finishing/i.test(portalHtml.slice(fallbackStart, fallbackStop).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')));
  }

  // Render wiring: textContent only, gated on closure, never baked in the snapshot.
  const renderAt = portalHtml.indexOf('var pace = (projStatus === \'completed\' || projStatus === \'closed\')');
  const renderBlock = renderAt >= 0 ? portalHtml.slice(renderAt, portalHtml.indexOf('// Hero photo background', renderAt)) : '';
  ok('the hero renders the pace chip, skipping closed jobs', renderAt >= 0
    && /: deriveSchedulePace\(sections\.schedule, nowMs\);/.test(renderBlock)
    && /if \(pace && progressHost\) \{/.test(renderBlock)
    && /progressHost\.appendChild\(paceWrap\);/.test(renderBlock)
    && /id="hero-progress"/.test(portalHtml));
  ok('the pace chip is written with textContent, not innerHTML',
    /chip\.textContent = copy\.chip;/.test(renderBlock) && /basis\.textContent = copy\.basis;/.test(renderBlock)
    && !/innerHTML/.test(renderBlock));
  const snapKeys = JSON.stringify(hendersonSnap);
  ok('no pace verdict is baked into the snapshot (it would go stale)',
    !/"(pace|paceStatus|ownerConfidence|scheduleStatus)"\s*:/.test(snapKeys));
}

// ── The portal HTML must not read the retired figure, anywhere ─────────────
ok('portal no longer renders budget.pctComplete', !/pctComplete/.test(portalHtml));
ok('portal labels the stat "Work complete", not "Project complete"',
  portalHtml.includes("label: 'Work complete'") && !portalHtml.includes("label: 'Project complete'"));
ok('portal says "Not reported yet" instead of a fabricated 0%',
  portalHtml.includes("sub: 'Not reported yet'"));
ok('the hero progress bar is gated on a real progress signal',
  /if \(work\.known\) \{/.test(portalHtml) && !/if \(typeof project\.progressPct === 'number'\) \{/.test(portalHtml));
ok('the signed-contract reconcile no longer recomputes outstanding as contract − cash',
  !/outstanding: Math\.max\(0, truth - paidSoFar\)/.test(portalHtml));

// ── The money bar under the stat tiles must stay on ONE basis ──────────────
// `Math.max(paid + outstanding, budget.contractValue)` added tax-INCLUSIVE
// cash to a tax-INCLUSIVE balance and printed the result as a PRE-TAX
// contract: on a taxed job with a balance the bar read "$50,000 of $108,000"
// directly under a "Contract value $100,000" tile. The contract value is not
// allowed anywhere near this bar.
// Scanned over CODE lines only: the comment that explains the defect quotes
// the old expression verbatim on purpose, and a tripwire that fires on its own
// documentation teaches people to delete the documentation.
const portalHtmlCode = portalHtml.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
ok('the money bar no longer maxes cash-plus-balance against the pre-tax contract',
  !/Math\.max\(paid \+ outstanding, budget\.contractValue\)/.test(portalHtmlCode));
{
  const barStart = portalHtml.indexOf('    var spendBarHtml = \'\';');
  const barStop = portalHtml.indexOf('grid.innerHTML = statsHtml + spendBarHtml;', barStart);
  ok('money bar block is extractable', barStart >= 0 && barStop > barStart);
  const bar = portalHtml.slice(barStart, barStop);
  ok('no contract figure is mixed into the money bar',
    !/contractValue/.test(bar), bar.slice(0, 400));
  ok('the money bar is drawn from invoice dollars only',
    /budget\.paidToDate/.test(bar) && /budget\.outstanding/.test(bar) && /budget\.retentionHeld/.test(bar));
  ok('its denominator is the sum of its own segments, so the legend always reconciles',
    /var billed = paid \+ outstanding \+ retHeld;/.test(bar));
  // A pre-fix snapshot's `outstanding` still means contract − cash. Labelling
  // that "Due now" would put a new false statement on an old frozen link, so
  // the bar and the new sub-label only render on the new basis.
  ok('the bar and its labels are gated on a snapshot that carries the new basis',
    /if \(budget && typeof budget\.invoicedToDate === 'number'\) \{/.test(portalHtmlCode)
    && /var hasBillingBasis = typeof budget\.invoicedToDate === 'number';/.test(portalHtmlCode)
    && /sub: !hasBillingBasis \? '' :/.test(portalHtmlCode));
}

// ── PORTAL-07 — displayed link === shared link ──────────────────────────────
// The token is the homeowner's authority to e-sign a change order, and the
// card it is printed on has no max width, so on desktop the whole 64
// characters render into any screenshot. Show the query parameter (so the
// bare URL is never mistaken for the link) with the secret's middle elided.
{
  const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);
  const full = `https://mageid.app/portal/portal-abc?t=${TOKEN}`;
  const masked = maskPortalLinkToken(full);
  ok('the masked link still shows it carries a key', masked.includes('?t='), masked);
  ok('…but not the key itself', !masked.includes(TOKEN), masked);
  ok('…and is visibly incomplete, so nobody transcribes it', masked.includes('\u2026'), masked);
  expect('exactly four characters at each end survive', masked, `https://mageid.app/portal/portal-abc?t=aaaa\u2026bbbb`);
  expect('a link with no token is left alone',
    maskPortalLinkToken('https://mageid.app/portal/portal-abc'), 'https://mageid.app/portal/portal-abc');
  expect('an inviteId ahead of the token is preserved',
    maskPortalLinkToken(`https://mageid.app/portal/portal-abc?inviteId=inv1&t=${TOKEN}`),
    'https://mageid.app/portal/portal-abc?inviteId=inv1&t=aaaa\u2026bbbb');
  ok('the masked string is never what gets shared', masked !== full);
}

{
  const setup = read('app/client-portal-setup.tsx');
  ok('client-portal-setup.tsx loaded', setup.length > 0);
  ok('the Portal Link card renders the link Copy/Share send, not a hand-built base URL',
    /\{linkPending \? `\$\{PORTAL_BASE_URL\}\/\$\{portal\.portalId\}` : maskPortalLinkToken\(portalLink\)\}/.test(setup),
    'the card must print `portalLink` (which carries ?t=<accessToken>), not a hand-built base URL');
  ok('Copy still puts the FULL link on the clipboard — masking is display-only',
    /copyToClipboard\(portalLink\)/.test(setup));
  ok('…and the only hand-built base URL left on screen is the explicit pending state',
    (setup.match(/\$\{PORTAL_BASE_URL\}\/\$\{portal\.portalId\}/g) ?? []).length <= 3);
  ok('the card explains that the tail is a security key, so it is not retyped',
    /security key that lets your client sign change orders/.test(setup));
  // All three doors the link goes out of guard on the same pending token.
  ok('Copy, Share and Email all guard on the same pending-token check',
    (setup.match(/if \(warnIfLinkPending\(\)\) return;/g) ?? []).length >= 3);
  // A portal that has never been saved is not "syncing" — the heal effect is
  // keyed on the PERSISTED portal and returns early — so the pending copy has
  // to name the step that actually produces the key.
  ok('the never-saved state tells the GC to Save instead of promising a sync',
    /const linkNeedsSave = linkPending && !project\?\.clientPortal\?\.enabled;/.test(setup)
    && /Tap Save to finish securing this link/.test(setup)
    && /'Save this portal first'/.test(setup));
  ok('the share link builder still appends the access token',
    /buildShortPortalUrl\(PORTAL_BASE_URL, portal\.portalId, undefined, portal\.accessToken\)/.test(setup));
}

// ── A portal URL is never built by concatenating a portalId ────────────────
//
// The signing RPCs gate on `?t=<accessToken>`. A URL built from the portalId
// alone opens a portal that renders — and refuses every decision the page asks
// the homeowner to make. That is exactly what app/contract.tsx mailed under
// the subject "your contract is ready to sign" until 2026-09-07, and what
// app/project-detail.tsx put on the clipboard and printed on the card.
//
// So: ONE builder on each side of the wire — portalShareUrl (client) and
// portalUrlFor (edge functions) — both of which return null instead of a
// token-less link, and a textual sweep that fails the build on a new
// hand-rolled one.
console.log('\nno portal URL is built by string-concatenating a portalId:');
{
  expect('portalShareUrl carries the token',
    portalShareUrl({ enabled: true, portalId: 'portal-abc', accessToken: 'tok123' }),
    `${PORTAL_BASE_URL}/portal-abc?t=tok123`);
  expect('…and the inviteId ahead of it',
    portalShareUrl({ enabled: true, portalId: 'portal-abc', accessToken: 'tok123' }, 'inv1'),
    `${PORTAL_BASE_URL}/portal-abc?inviteId=inv1&t=tok123`);
  expect('no token → null, NOT a bare URL',
    portalShareUrl({ enabled: true, portalId: 'portal-abc' }), null);
  expect('empty token → null', portalShareUrl({ enabled: true, portalId: 'portal-abc', accessToken: '  ' }), null);
  expect('no portalId → null', portalShareUrl({ enabled: true, accessToken: 'tok123' }), null);
  expect('a disabled portal → null', portalShareUrl({ enabled: false, portalId: 'portal-abc', accessToken: 'tok123' }), null);
  expect('nothing at all → null', portalShareUrl(null), null);
  // The client answer and the server answer must be the same string.
  ok('the edge-function builder applies the same rule',
    /if \(!portalId \|\| !token\) return null;/.test(read('supabase/functions/_shared/portalLinks.ts')));

  // The sweep. Any source line that pastes a portal id straight onto a portal
  // base — `https://mageid.app/portal/${...}`, `${PORTAL_BASE_URL}/${...}`,
  // `${PORTAL_BASE}/${...}` — is a token-less link unless it is named here.
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f, out);
      else if (/\.tsx?$/.test(e.name)) out.push(f);
    }
    return out;
  };
  const CONCAT = /(?:https:\/\/mageid\.app\/(?:sub-)?portal|\$\{(?:SUB_)?PORTAL_BASE(?:_URL)?\})\/\$\{/;
  // The ONE legal exception: the Portal Link card's explicit pending state,
  // which prints the base URL precisely to say the secure link is not ready
  // yet. It is not copied, shared or emailed — the three doors all guard on
  // warnIfLinkPending — and the string on screen is labelled as pending.
  const ALLOWED = new Set(['app/client-portal-setup.tsx']);
  const hits: string[] = [];
  for (const root of ['app', 'components', 'utils', 'hooks', 'contexts', 'supabase/functions']) {
    for (const f of walk(join(ROOT, root))) {
      const rel = f.slice(ROOT.length + 1);
      if (rel === 'supabase/functions/_shared/portalLinks.ts') continue; // the builder itself
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(?:\/\/|\*)/.test(line)) return;       // comments explaining the defect
        if (!CONCAT.test(line)) return;
        if (ALLOWED.has(rel)) return;
        hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  ok('no source file concatenates a portalId into a portal URL', hits.length === 0,
    hits.join('\n       ') +
    '\n\n      A portal URL without ?t=<accessToken> opens a portal that cannot' +
    '\n      sign, approve or select. Call portalShareUrl(project.clientPortal)' +
    '\n      from @/utils/portalSnapshot (or portalUrlFor in _shared/portalLinks' +
    '\n      on the server) and render the null case — say the secure link is' +
    '\n      not ready and name the step that mints it.');

  // The two call sites the runtime audit caught, pinned by shape.
  const contract = read('app/contract.tsx');
  ok('the contract-signing email builds its CTA with portalShareUrl',
    /const portalUrl = project \? portalShareUrl\(portalSettings\) : null;/.test(contract)
    && /if \(project && portalUrl && recipients\.length > 0\)/.test(contract));
  ok('…and when there is no key it says so instead of mailing a dead CTA',
    /no secure signing key yet, so nothing was emailed/.test(contract));
  const detail = read('app/project-detail.tsx');
  ok('project-detail copies the link the client receives',
    /const portalLink = useMemo\(\s*\(\) => portalShareUrl\(project\?\.clientPortal\),/.test(detail)
    && /copyToClipboard\(portalLink\)/.test(detail));
  ok('…prints that same link (token masked), not a bare URL',
    /maskPortalLinkToken\(portalLink\.replace\(\/\^https:\\\/\\\/\/, ''\)\)/.test(detail));
  ok('…and refuses to copy when there is no key',
    /'Secure link not ready'/.test(detail));
}

// ─────────────────────────────────────────────────────────────────────────────
// N. THE DOCUMENTS SECTION, AND THE CHANGE ORDER THE OWNER CANNOT SIGN
//
// Two defects from the 2026-09-16 screen audit, both of the same family: a
// control that says one thing and does another.
//
//  A. `if (portal.showDocuments) { sections.documents = []; }` — "stub for
//     now" — shipped for the portal's whole life. The static page skips a
//     zero-length section, so the switch labelled "Contracts, lien waivers,
//     permits" produced no visible change, no error, and no warning. The GC
//     believed they had shared the permit and the warranty; the owner asked by
//     email anyway, and at a warranty claim two years later the record was
//     only ever inside a closeout binder that exists after finalization.
//
//  B. With `coApprovalEnabled` off — the default — the portal shows a pending
//     change order with no approve button and told the owner "Your contractor
//     is waiting on your decision — reply in Messages." That reads as though a
//     chat reply were the decision. It is not: "yeah go ahead" in a message
//     thread is not a signed amendment, and the extra work done on the
//     strength of one is the change order the GC loses in a dispute.
//
// Both are pinned by BEHAVIOUR (the projection, the copy) and by SHAPE (the
// stub cannot come back, the two hand-written copies of the CO sentence cannot
// drift apart).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nportal owner — documents section:');
{
  const PERMIT = {
    projectId: 'p1', type: 'building' as const, status: 'approved' as const,
    permitNumber: 'B-2026-118', jurisdiction: 'City of Henderson',
    appliedDate: '2026-03-02', approvedDate: '2026-03-19', expiresDate: '2027-03-19',
  };
  const SENT_WARRANTY = {
    projectId: 'p1', title: 'Trane HVAC', category: 'hvac' as const, provider: 'Trane',
    startDate: '2026-08-01', endDate: '2036-08-01',
    portalState: { status: 'sent' as const },
  };
  const DRAFT_WARRANTY = { ...SENT_WARRANTY, title: 'Roof (draft)', portalState: { status: 'draft' as const } };
  // A warranty with NO portalState at all. `isShared()` treats that as shared
  // for grandfathered collections; a warranty is not one of those, and this
  // row must stay off the homeowner's page.
  const UNPUSHED_WARRANTY = { ...SENT_WARRANTY, title: 'Never pushed', portalState: undefined };
  const OTHER_PROJECT_PERMIT = { ...PERMIT, projectId: 'p2', permitNumber: 'X-1' };

  const docs = buildPortalDocuments({
    projectId: 'p1',
    permits: [PERMIT, OTHER_PROJECT_PERMIT],
    warranties: [SENT_WARRANTY, DRAFT_WARRANTY, UNPUSHED_WARRANTY],
    closeoutShared: false,
  });

  expect('a permit becomes one row, named by kind + number', docs[0], {
    name: 'Building permit #B-2026-118',
    type: 'City of Henderson',
    dateSent: '2026-03-19',
    status: 'Approved',
    expiresOn: '2027-03-19',
  });
  ok('another project’s permit is not on this portal',
    !docs.some(d => d.name.includes('X-1')));
  ok('only a warranty explicitly SENT to the portal appears',
    docs.filter(d => d.name === 'Trane HVAC').length === 1
    && !docs.some(d => d.name === 'Roof (draft)')
    && !docs.some(d => d.name === 'Never pushed'),
    JSON.stringify(docs.map(d => d.name)));

  // THE REGRESSION. An empty projection must produce an empty ARRAY that the
  // caller then omits — never a section key the page renders as nothing.
  expect('no permits and no sent warranties → no rows at all',
    buildPortalDocuments({ projectId: 'p1', closeoutShared: false }), []);

  // The binder owns the warranty roster once it ships; printing it in both
  // places puts the same warranty on one page twice.
  const withBinder = buildPortalDocuments({
    projectId: 'p1', permits: [PERMIT], warranties: [SENT_WARRANTY], closeoutShared: true,
  });
  ok('warranties move to the closeout section once the binder is shared',
    withBinder.length === 1 && withBinder[0].name.startsWith('Building permit'),
    JSON.stringify(withBinder));

  ok('closeoutIsShared agrees with the closeout block’s own gate',
    closeoutIsShared({ status: 'finalized' }) && closeoutIsShared({ status: 'sent' })
    && !closeoutIsShared({ status: 'draft' }) && !closeoutIsShared(null)
    && !closeoutIsShared(undefined));

  // No row may carry a link. Nothing in this repo writes a permit attachment
  // and Warranty.documentUri has no writer, so any url/fileUrl key here would
  // be a download button that 404s for the one reader who cannot ask anyone
  // else for the file.
  const linkKeys = docs.flatMap(d => Object.keys(d)).filter(k => /url|uri|href|link|download/i.test(k));
  ok('document rows carry no file link', linkKeys.length === 0, linkKeys.join(', '));

  // Nothing the portal already renders as its own section may be duplicated
  // here. Values, not just keys — a "contract" row would read as a second copy
  // of the contract card at the top of the page.
  const names = docs.map(d => d.name.toLowerCase()).join(' | ');
  ok('the contract and the closeout binder are NOT relisted as documents',
    !/contract|closeout|binder|proposal/.test(names), names);

  // End-to-end through the real builder: the toggle must now move something.
  const docProject = {
    ...(henderson as unknown as Project),
    id: 'p1',
  } as Project;
  const docPortal = { ...portalSettings, showDocuments: true } as ClientPortalSettings;
  const snapOn = buildPortalSnapshot({
    project: docProject, portal: docPortal, settings: undefined,
    permits: [PERMIT as never], warranties: [SENT_WARRANTY as never],
  });
  ok('flipping showDocuments on actually publishes rows',
    (snapOn.sections.documents ?? []).length === 2,
    JSON.stringify(snapOn.sections.documents));
  const snapEmpty = buildPortalSnapshot({
    project: docProject, portal: docPortal, settings: undefined,
  });
  ok('…and with nothing to publish the key is ABSENT, not an empty array',
    snapEmpty.sections.documents === undefined,
    JSON.stringify(snapEmpty.sections.documents));
  const snapOff = buildPortalSnapshot({
    project: docProject, portal: { ...docPortal, showDocuments: false }, settings: undefined,
    permits: [PERMIT as never],
  });
  ok('the switch still gates the section', snapOff.sections.documents === undefined);

  // The stub itself, pinned by shape so it cannot be reintroduced.
  // Comments are stripped first: both files now EXPLAIN the old stub, and a
  // guard that trips on its own post-mortem teaches people to delete the
  // explanation instead of keeping the fix.
  const stripComments = (src: string) => src
    .split('\n')
    .filter(l => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
    .join('\n');
  const snapSrc = stripComments(read('utils/portalSnapshot.ts'));
  ok('utils/portalSnapshot.ts no longer assigns an empty documents array',
    !/sections\.documents\s*=\s*\[\]/.test(snapSrc));

  // The switch's own copy. "Contracts, lien waivers, permits" promised two
  // things this app cannot put on a portal: the contract has its own section,
  // and nothing in the app stores a lien waiver a homeowner could be shown.
  const setupSrc = read('app/client-portal-setup.tsx');
  const docToggle = (() => {
    const src = stripComments(setupSrc);
    const i = src.indexOf("key: 'showDocuments'");
    return i < 0 ? '' : src.slice(i, src.indexOf('},', i));
  })();
  ok('the Documents switch describes what it actually publishes', docToggle.length > 0
    && /description: '[^']*[Pp]ermits[^']*'/.test(docToggle)
    && !/lien/i.test(docToggle)
    && !/description: '[^']*Contracts/.test(docToggle), docToggle);
  ok('…and the screen tells the GC when there is nothing to publish',
    setupSrc.includes('portal-documents-summary')
    && /Nothing to publish yet/.test(setupSrc));
}

console.log('\nportal owner — a chat reply is not a signed change order:');
{
  const pendingCO = [{ id: 'co1', number: 7, status: 'submitted', changeAmount: 12000, dateSubmitted: '2026-06-01', description: 'Regrade the lot' }];
  const onDetail = buildOwnerDecisions({ today: '2026-06-15', coApprovalEnabled: true, changeOrders: pendingCO })[0].detail;
  const offDetail = buildOwnerDecisions({ today: '2026-06-15', coApprovalEnabled: false, changeOrders: pendingCO })[0].detail;

  ok('with signing ON the copy points at the signature', /sign to approve or decline/.test(onDetail), onDetail);
  ok('with signing OFF the copy says there is no approve button',
    /no approve button/i.test(offDetail), offDetail);
  ok('…and refuses to let a message read as an approval',
    /not a signed change to your contract/i.test(offDetail), offDetail);
  ok('…and the old copy, which did read that way, is gone',
    !/waiting on your decision — reply in Messages\.'/.test(read('utils/portalOwnerCore.ts')));

  // The static page keeps a hand-written copy for pre-v10 snapshots. Held
  // byte-for-byte against the TS module: if they drift, two homeowners reading
  // the same portal on different snapshot versions get different instructions
  // about what their reply legally is.
  ok('marketing/portal/index.html ships the same OFF sentence',
    portalHtml.includes(offDetail), offDetail);
  ok('marketing/portal/index.html ships the same ON sentence',
    portalHtml.includes(onDetail));

  // The GC's side of the same fact. They are the ones who believe their client
  // can sign; nothing told them otherwise.
  const setupSrc = read('app/client-portal-setup.tsx');
  ok('the setup screen states that a portal with signing off has no approve button',
    setupSrc.includes('portal-signing-off-note')
    && /has no approve\s*\n?\s*button/.test(setupSrc), 'app/client-portal-setup.tsx');
  ok('…and offers the one tap that turns signing on when a CO is actually waiting',
    setupSrc.includes('portal-co-signing-off-nudge')
    && /pendingClientCOCount > 0/.test(setupSrc));
  ok('…counting the same statuses the portal’s own list ranks',
    /PENDING_CO_STATUSES\.has\(/.test(setupSrc));

  // "Preview as your client" is wired to the LIVE writers: the CO approve flow
  // inserts a real change_order_approvals row and flips the CO to approved
  // with an audit entry labelled client_signed_via_portal. The GC looking at
  // their own preview must not be able to sign their client's amendment, so
  // the preview is marked as a preview at the one place that opens it.
  ok('Preview opens client-view in previewMode',
    /pathname: '\/client-view'[^)]*previewMode: '1'/.test(setupSrc.replace(/\s+/g, ' ')),
    'app/client-portal-setup.tsx Preview button');
}

// project-detail's LITE snapshot writer carries the last rich openBook block
// forward (it never builds one — it passes no commitments). It must stop the
// moment the project leaves open-book / GMP: the portal renders any openBook
// it finds, so an unconditional carry kept publishing the GC's cost
// breakdown on a job he had moved to fixed price.
// It also re-stamps the contract terms (mode, GMP cap, fee) from the project
// as it is NOW: the portal titles the block from `mode`, so a carried GMP block
// told the homeowner "GMP" after the GC switched the job to open book.
// carriedOpenBook is lifted out of the screen and RUN, not pattern-matched.
{
  const pdRaw = read('app/project-detail.tsx');
  const pd = pdRaw.replace(/\s+/g, ' ');
  ok('the lite writer carries the block through carriedOpenBook(prev.openBook, project)',
    /openBook: snap\.openBook \?\? carriedOpenBook\(prev\.openBook, project\)/.test(pd)
      && !/openBook: snap\.openBook \?\? prev\.openBook/.test(pd),
    'app/project-detail.tsx lite portal writer');
  const fnStart = pdRaw.indexOf('function carriedOpenBook(');
  const fnEnd = pdRaw.indexOf('\n}\n', fnStart) + 3;
  type OB = { mode: string; gmpCap?: number; feePercent?: number; feeAmount?: number; actual: number; budget: number };
  let carry: ((prev: OB | undefined, project: Record<string, unknown>) => OB | undefined) | null = null;
  try {
    // Bun's global is not in the app's tsconfig types; reach it untyped.
    const BunRt = (globalThis as unknown as { Bun: { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } } }).Bun;
    const js = new BunRt.Transpiler({ loader: 'ts' }).transformSync(
      `type PortalOpenBook = any; type Project = any;\n${pdRaw.slice(fnStart, fnEnd)}\nexport { carriedOpenBook };`);
    carry = new Function(`${js.replace(/export \{[^}]*\};?/, '')}\nreturn carriedOpenBook;`)();
  } catch (err) {
    ok('carriedOpenBook could be lifted out of project-detail', false, String(err));
  }
  if (carry) {
    const prevGmp: OB = { mode: 'gmp', gmpCap: 480_000, feePercent: 10, feeAmount: undefined, actual: 212_000, budget: 450_000 };
    const switched = carry(prevGmp, { contractMode: 'open_book', gmpCap: undefined, contractorFeePercent: 12 });
    expect('GMP → open_book: the carried block now says open_book', switched?.mode, 'open_book');
    expect('…and drops the old GMP cap', switched?.gmpCap, undefined);
    expect('…and prints the fee as it is now', switched?.feePercent, 12);
    expect('…while the published cost figures ride along unchanged', [switched?.actual, switched?.budget], [212_000, 450_000]);
    expect('a cap edit on a GMP job shows the new cap',
      carry(prevGmp, { contractMode: 'gmp', gmpCap: 495_000, contractorFeePercent: 10 })?.gmpCap, 495_000);
    expect('a job moved to fixed price carries nothing', carry(prevGmp, { contractMode: 'fixed_price', gmpCap: 480_000 }), undefined);
    expect('no rich block published yet → nothing to carry', carry(undefined, { contractMode: 'gmp', gmpCap: 480_000 }), undefined);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
