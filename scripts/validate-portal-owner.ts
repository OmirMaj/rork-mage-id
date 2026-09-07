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
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  derivePayAppPeriods, buildPeriodNarrative, buildOwnerDecisions,
  buildCOConsentRecord, summarizeOwnerDecisions,
  ESIGN_DISCLOSURE_TEXT, ESIGN_DISCLOSURE_VERSION, DUE_SOON_DAYS,
  type OwnerDecision,
} from '../utils/portalOwnerCore';
import { buildPortalSnapshot, scheduleWorkComplete, maskPortalLinkToken, portalShareUrl, PORTAL_BASE_URL, PORTAL_SNAPSHOT_VERSION } from '../utils/portalSnapshot';
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
  ok('portal AIA card shows Paid for a pay app with paidAt instead of a Pay button',
    /var aiaPaid = !!a\.paidAt;/.test(portalHtml) && /var canPay = !aiaPaid && !!a\.payLinkUrl && due > 0;/.test(portalHtml));
  ok('portal AIA drawer footer shows Paid for a pay app with paidAt',
    /var aiaCanPay = !aiaPaid && !!a\.payLinkUrl && aiaDue > 0;/.test(portalHtml) && /Paid ' \+ fmtDate\(a\.paidAt\)/.test(portalHtml));
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
        retentionPercent: 10, retentionAmount: 2_150, retentionReleased: 0,
        createdAt: '2026-06-10', updatedAt: '2026-06-10',
      },
    ] as unknown as Invoice[],
  });
  const b = partial.sections.budget!;
  // 21,500 billed − 2,150 retention still held − 5,000 paid = 14,350.
  expect('outstanding nets the retention the contract lets the client hold', b.outstanding, 14_350);
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
    invoices: [inv({ id: 'r1', retentionPercent: 10, retentionAmount: 1_080, retentionReleased: 0, amountPaid: 2_000 })],
  });
  const wb = withRet.sections.budget!;
  expect('retention held is reported separately', wb.retentionHeld, 1_080);
  expect('…and excluded from what is due now', wb.outstanding, 10_800 - 1_080 - 2_000);
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
