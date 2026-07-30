// validate-sub-network.ts — pins utils/subNetwork.ts.
// The sub-side network loop: the profile an invited sub gets to KEEP, plus the
// three isolation rules that make it safe to hand a sub anything at all
// (no cross-sub bleed, no cross-GC bleed, no GC economics).
// Run: bun run scripts/validate-sub-network.ts
import {
  buildSubNetworkProfile,
  matchesSubIdentity,
  normalizePhone,
  normalizeLicense,
  findSubDataLeaks,
  profileSourceIds,
  subIdentityKey,
  isForbiddenSubField,
  type GcLedger,
} from '../utils/subNetwork';
import type { Commitment, Project, PunchItem, Subcontractor } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

const NOW = Date.parse('2026-08-01T12:00:00');

// ── Fixtures ────────────────────────────────────────────────────────────────
// One sub (Sam at Volt Edge) on file with two GCs, plus a THIRD GC who has
// never heard of them, plus a rival shop with the IDENTICAL company name.

const mkSub = (o: Partial<Subcontractor>): Subcontractor => ({
  contactName: 'Contact', address: '', trade: 'Electrical', licenseNumber: '',
  licenseExpiry: '', coiExpiry: '', w9OnFile: false, bidHistory: [], assignedProjects: [],
  notes: '', createdAt: '2024-01-01', updatedAt: '2024-01-01', phone: '', email: '',
  ...o,
} as unknown as Subcontractor);

const mkCommit = (
  id: string, projectId: string, subcontractorId: string,
  status: string, signedDate: string, amount: number,
): Commitment => ({
  id, projectId, subcontractorId, number: id.toUpperCase(), type: 'subcontract',
  description: 'Scope', amount, changeAmount: 0, paidToDate: 0, signedDate, status,
  createdAt: signedDate, updatedAt: signedDate,
} as unknown as Commitment);

const mkTask = (o: Record<string, unknown>) => ({
  phase: 'Rough-in', progress: 100, crew: '', dependencies: [], notes: '', ...o,
});

// Schedule on Oak Kitchen: four measured tasks for Sam (three inside the days
// allotted), plus decoys that must not count.
const oakSchedule = {
  id: 'sch1', name: 'Oak', projectId: 'p1', startDate: '2025-02-03',
  workingDaysPerWeek: 7, bufferDays: 0, nonWorkingDates: [],
  totalDurationDays: 20, criticalPathDays: 20, laborAlignmentScore: 1, riskItems: [],
  tasks: [
    mkTask({ id: 't1', title: 'Rough-in', durationDays: 5, startDay: 1, status: 'done', assignedSubId: 's1', actualStartDay: 1, actualEndDay: 5 }),
    mkTask({ id: 't2', title: 'Panel', durationDays: 3, startDay: 6, status: 'done', assignedSubId: 's1', actualStartDay: 6, actualEndDay: 8 }),
    mkTask({ id: 't3', title: 'Devices', durationDays: 4, startDay: 9, status: 'done', assignedSubId: 's1', actualStartDay: 9, actualEndDay: 10 }),
    mkTask({ id: 't4', title: 'Trim out', durationDays: 2, startDay: 11, status: 'done', assignedSubId: 's1', actualStartDay: 11, actualEndDay: 16 }),
    mkTask({ id: 't5', title: 'Rival work', durationDays: 1, startDay: 1, status: 'done', assignedSubId: 's9', actualStartDay: 1, actualEndDay: 1 }),
    mkTask({ id: 't6', title: 'Still going', durationDays: 3, startDay: 17, status: 'in_progress', assignedSubId: 's1', actualStartDay: 17, actualEndDay: 19 }),
    mkTask({ id: 't7', title: 'No as-builts', durationDays: 3, startDay: 20, status: 'done', assignedSubId: 's1' }),
    mkTask({ id: 't8', title: 'Energize', durationDays: 0, startDay: 21, status: 'done', isMilestone: true, assignedSubId: 's1', actualStartDay: 21, actualEndDay: 25 }),
  ],
};

const gc1Projects = [
  { id: 'p1', name: 'Oak Kitchen', status: 'completed', schedule: oakSchedule },
  { id: 'p2', name: 'Elm Bath', status: 'in_progress', schedule: null },
  { id: 'p3', name: 'Maple Deck', status: 'estimated', schedule: null },
  { id: 'p4', name: 'Cedar Addition', status: 'in_progress', schedule: null },
] as unknown as Project[];

const gc1Punch = [
  { id: 'pi1', projectId: 'p1', assignedSubId: 's1', assignedSub: '', status: 'closed', description: 'Cover plate' },
  { id: 'pi2', projectId: 'p1', assignedSubId: 's1', assignedSub: '', status: 'closed', description: 'Label panel' },
  { id: 'pi3', projectId: 'p1', assignedSubId: 's1', assignedSub: '', status: 'closed', description: 'Trim', rejectionNote: 'Redo the trim' },
  { id: 'pi4', projectId: 'p1', assignedSubId: 's1', assignedSub: '', status: 'open', description: 'Not ruled on yet' },
  { id: 'pi5', projectId: 'p4', assignedSubId: 's9', assignedSub: '', status: 'closed', description: 'Rival item' },
  // Legacy free-text row on a job Sam DOES hold a commitment on — counts.
  { id: 'pi6', projectId: 'p1', assignedSub: 'Volt Edge Electric', status: 'closed', description: 'Legacy row' },
  // Same free-text name on a job Sam has NO commitment on — must NOT count.
  { id: 'pi7', projectId: 'p4', assignedSub: 'Volt Edge Electric', status: 'closed', description: 'Not Sam' },
] as unknown as PunchItem[];

const gc1: GcLedger = {
  gcId: 'gc1',
  gcName: 'Northgate Builders',
  subcontractors: [
    mkSub({ id: 's1', companyName: 'Volt Edge Electric', email: 'Sam@VoltEdge.com', phone: '(415) 555-0100', licenseNumber: 'CA-EL-99812', licenseExpiry: '2028-01-01', coiExpiry: '2027-03-01', w9OnFile: true }),
    // Identical company name, different human. Must never merge into Sam.
    mkSub({ id: 's9', companyName: 'Volt Edge Electric', email: 'rob@rival.com', phone: '(510) 555-7777', licenseNumber: 'CA-EL-11111', licenseExpiry: '2027-01-01', coiExpiry: '2027-01-01' }),
  ],
  commitments: [
    mkCommit('c1', 'p1', 's1', 'closed', '2025-02-10', 48000),
    mkCommit('c2', 'p2', 's1', 'active', '2026-05-01', 31500),
    mkCommit('c3', 'p3', 's1', 'draft', '2026-07-01', 12750),   // unsigned intent — excluded
    mkCommit('c4', 'p4', 's9', 'closed', '2025-09-01', 22000),  // rival's work
  ],
  projects: gc1Projects,
  punchItems: gc1Punch,
};

const gc2: GcLedger = {
  gcId: 'gc2',
  gcName: 'Harbor Point GC',
  subcontractors: [
    // Same human, this GC's own row + their own id. Joined on email.
    mkSub({ id: 's2', companyName: 'Volt Edge Electric LLC', email: 'sam@voltedge.com', phone: '415-555-0100', licenseNumber: 'CA-EL-99812', licenseExpiry: '2026-06-01', coiExpiry: '2026-09-15', w9OnFile: false }),
  ],
  commitments: [mkCommit('c5', 'p5', 's2', 'closed', '2024-06-01', 64000)],
  projects: [{ id: 'p5', name: 'Bayview Loft', status: 'completed', schedule: null }] as unknown as Project[],
  punchItems: [],
};

// A GC who has never had Sam on file. Must contribute absolutely nothing.
const gc3: GcLedger = {
  gcId: 'gc3',
  gcName: 'Summit Construction',
  subcontractors: [mkSub({ id: 's7', companyName: 'Other Trades Inc', email: 'other@x.com', phone: '(206) 555-2222' })],
  commitments: [mkCommit('c6', 'p8', 's7', 'closed', '2026-01-01', 90000)],
  projects: [{ id: 'p8', name: 'Ridge Tower', status: 'completed', schedule: null }] as unknown as Project[],
  punchItems: [],
};

const LEDGERS = [gc1, gc2, gc3];
const SAM = { email: 'sam@voltedge.com' };

const sam = buildSubNetworkProfile({
  identity: SAM,
  ledgers: LEDGERS,
  nowMs: NOW,
  offPlatformGcs: [
    { name: 'Ridgeline Homes', contactName: 'Dana' },
    { name: 'Northgate Builders' },   // already on MAGE — drop
    { name: 'ridgeline homes' },      // dupe by case — drop
    { name: 'Castle Rock Custom', email: 'jo@castlerock.com' },
  ],
});

// ── Identity matching ───────────────────────────────────────────────────────
console.log('\nidentity matching (the cross-sub join key):');

expect('email match is case-insensitive', matchesSubIdentity(gc1.subcontractors[0], SAM), true);
expect('same company name, different human → NO match', matchesSubIdentity(gc1.subcontractors[1], SAM), false);
expect('phone match survives formatting', matchesSubIdentity(gc1.subcontractors[0], { phone: '+1 (415) 555-0100' }), true);
expect('phone under 10 digits never matches', matchesSubIdentity(gc1.subcontractors[0], { phone: '555-0100' }), false);
expect('license match is normalized', matchesSubIdentity(gc1.subcontractors[0], { licenseNumber: 'ca el 99812' }), true);
expect('empty identity matches nothing', matchesSubIdentity(gc1.subcontractors[0], {}), false);
expect('blank identity email does not sweep blank records', matchesSubIdentity(mkSub({ id: 'sx', companyName: 'X', email: '' }), { email: '' }), false);
expect('normalizePhone keeps last 10 digits', normalizePhone('+1 (415) 555-0100'), '4155550100');
expect('normalizeLicense strips punctuation + upcases', normalizeLicense('ca-el/998 12'), 'CAEL99812');
expect('identityKey prefers email', subIdentityKey({ email: 'Sam@VoltEdge.com', phone: '4155550100' }), 'email:sam@voltedge.com');

// ── Work history ────────────────────────────────────────────────────────────
console.log('\nwork history (what the sub owns):');

expect('two GCs matched, third ignored', sam.gcCount, 2);
expect('history ordered by most recent GC first', sam.history.map(h => h.gcName), ['Northgate Builders', 'Harbor Point GC']);
expect('three signed jobs across both GCs', sam.jobCount, 3);
expect('jobs newest first', sam.jobs.map(j => j.projectName), ['Elm Bath', 'Oak Kitchen', 'Bayview Loft']);
expect('draft commitment is NOT history (Maple Deck absent)', sam.jobs.some(j => j.projectName === 'Maple Deck'), false);
expect('job keys are GC-qualified', sam.jobs.map(j => j.key), ['gc1::p2', 'gc1::p1', 'gc2::p5']);
expect('per-GC job counts', sam.history.map(h => [h.gcName, h.jobCount, h.completedJobCount]), [['Northgate Builders', 2, 1], ['Harbor Point GC', 1, 1]]);
expect('active-now flag per GC', sam.history.map(h => h.activeNow), [true, false]);
expect('trades performed', sam.trades, ['Electrical']);
expect('date range spans first → last job', [sam.credential.firstJobISO, sam.credential.lastJobISO], ['2024-06-01', '2026-05-01']);
expect('active years (2024-06 → 2026-05)', sam.credential.activeYears, 1.9);
expect('linked record ids are this sub only', sam.history.map(h => h.linkedSubRecordIds), [['s1'], ['s2']]);

// ── Reliability ─────────────────────────────────────────────────────────────
console.log('\nreliability signals:');

expect('measured tasks exclude rival / unfinished / unstamped / milestone', sam.reliability.onTimeSampleSize, 4);
expect('on-time percent (3 of 4 inside days allotted)', sam.reliability.onTimePct, 75);
expect('jobs completed / in progress', [sam.reliability.jobsCompleted, sam.reliability.jobsInProgress], [2, 1]);
expect('punch reviewed count (open item + rival + off-job legacy excluded)', sam.reliability.punchSampleSize, 4);
expect('punch clean percent (3 of 4 closed first time)', sam.reliability.punchCleanPct, 75);
expect('COI takes the furthest expiry across GCs', sam.reliability.coiExpiryISO, '2027-03-01');
expect('COI current at nowMs', sam.reliability.coiCurrent, true);
expect('COI days remaining is positive', (sam.reliability.coiDaysRemaining ?? 0) > 180, true);
expect('license takes the furthest expiry across GCs', sam.reliability.licenseExpiryISO, '2028-01-01');
expect('license current at nowMs', sam.reliability.licenseCurrent, true);
expect('W-9 true when ANY GC has it on file', sam.reliability.w9OnFile, true);

// Thin data must not produce a headline number.
const thin = buildSubNetworkProfile({
  identity: { email: 'rob@rival.com' },
  ledgers: LEDGERS,
  nowMs: NOW,
});
expect('one measured task → onTimePct stays null', [thin.reliability.onTimeSampleSize, thin.reliability.onTimePct], [1, null]);
expect('two reviewed punch items → punchCleanPct stays null', [thin.reliability.punchSampleSize, thin.reliability.punchCleanPct], [2, null]);
// pi7 carries the shared company name on p4 — the job the RIVAL holds the
// commitment on. The name fallback routes it to them, never to Sam.
expect('shared-name legacy punch row lands on the sub who holds that job', thin.jobs.map(j => j.projectName), ['Cedar Addition']);

// Expired paper reads as expired.
const expired = buildSubNetworkProfile({ identity: SAM, ledgers: LEDGERS, nowMs: Date.parse('2029-01-01T12:00:00') });
expect('COI + license expired at a later nowMs', [expired.reliability.coiCurrent, expired.reliability.licenseCurrent], [false, false]);

// ── ISOLATION 1: cross-sub ──────────────────────────────────────────────────
console.log('\nisolation — one sub never sees another sub:');

const rivalIds = profileSourceIds(thin);
const samIds = profileSourceIds(sam);
expect('rival profile cites only their own record id', rivalIds.subRecordIds, ['s9']);
expect('sam profile cites only their own record ids', samIds.subRecordIds, ['s1', 's2']);
expect('no shared sub record ids between the two profiles', samIds.subRecordIds.filter(id => rivalIds.subRecordIds.includes(id)), []);
expect('no shared job keys', sam.jobs.map(j => j.key).filter(k => thin.jobs.some(o => o.key === k)), []);
expect('rival job never appears in sam profile', JSON.stringify(sam).includes('Cedar Addition'), false);
expect('sam job never appears in rival profile', JSON.stringify(thin).includes('Oak Kitchen'), false);
expect('rival on-time hits do not inflate sam sample', sam.reliability.onTimeSampleSize, 4);
expect('rival punch item does not land in sam sample', sam.reliability.punchSampleSize, 4);

// ── ISOLATION 2: cross-GC ───────────────────────────────────────────────────
console.log('\nisolation — a GC with no record contributes nothing:');

expect('non-matching GC name absent from profile', JSON.stringify(sam).includes('Summit Construction'), false);
expect('non-matching GC project absent from profile', JSON.stringify(sam).includes('Ridge Tower'), false);
expect('source gcIds are matched ledgers only', samIds.gcIds, ['gc1', 'gc2']);
expect('source projectIds are the sub\'s own jobs only', samIds.projectIds, ['p1', 'p2', 'p5']);
expect('draft-only project id never sourced', samIds.projectIds.includes('p3'), false);

// A GC-only ledger (sub not on file anywhere) yields a clean empty profile.
const stranger = buildSubNetworkProfile({ identity: { email: 'nobody@nowhere.com' }, ledgers: LEDGERS, nowMs: NOW, displayName: 'New Shop LLC' });
expect('unmatched sub → isEmpty', stranger.isEmpty, true);
expect('unmatched sub → zero counts', [stranger.gcCount, stranger.jobCount, stranger.history.length, stranger.jobs.length], [0, 0, 0, 0]);
expect('unmatched sub → no invented highlights', stranger.credential.highlights, []);
expect('unmatched sub → display name honored', stranger.companyName, 'New Shop LLC');
expect('unmatched sub → nothing from any ledger', JSON.stringify(stranger).includes('Northgate'), false);

// ── ISOLATION 3: no GC economics ────────────────────────────────────────────
console.log('\nisolation — no cost, rate, markup, or margin ever reaches a sub:');

expect('sam profile has zero leakage violations', findSubDataLeaks(sam), []);
expect('rival profile has zero leakage violations', findSubDataLeaks(thin), []);
expect('empty profile has zero leakage violations', findSubDataLeaks(stranger), []);

const serialized = JSON.stringify(sam);
expect('no currency symbol anywhere in the payload', serialized.includes('$'), false);
expect('signed contract value 48000 never surfaces', serialized.includes('48000'), false);
expect('signed contract value 31500 never surfaces', serialized.includes('31500'), false);
expect('other GC contract value 64000 never surfaces', serialized.includes('64000'), false);
expect('draft value 12750 never surfaces', serialized.includes('12750'), false);

// camelCase is how every real field in this repo is named — a substring
// denylist misses `laborRate` and `contractorFeePercent` entirely.
expect('forbidden-field check catches camelCase, snake_case and SCREAMING_CASE',
  ['unitCost', 'markupPct', 'grossMargin', 'laborRate', 'amount', 'paidToDate', 'estimateBudget',
   'contractorFeePercent', 'labor_rate', 'BURDEN_RATE', 'quotedPrice'].every(k => isForbiddenSubField(k)), true);
expect('forbidden-field check does NOT flag our own field names',
  ['jobCount', 'gcCount', 'onTimePct', 'punchCleanPct', 'coiExpiryISO', 'activeYears', 'linkedSubRecordIds',
   'completedJobCount', 'trades', 'highlights', 'onTimeSampleSize', 'w9OnFile', 'verifiedLine', 'inviteTargets',
   'identityKey', 'startedISO', 'activeNow'].some(k => isForbiddenSubField(k)), false);
expect('every field name in a real profile passes the check',
  Object.keys(sam).concat(Object.keys(sam.reliability), Object.keys(sam.credential), Object.keys(sam.referral), Object.keys(sam.history[0]), Object.keys(sam.jobs[0]))
    .filter(k => isForbiddenSubField(k)), []);

const poisoned = { ...sam, credential: { ...sam.credential, unitCost: 82.5, summary: 'Great sub, billed $48,000 last year.' } };
expect('guard catches a money field AND money hidden in a string', findSubDataLeaks(poisoned).length, 2);
expect('guard reports both offending paths',
  findSubDataLeaks(poisoned).map(v => v.split(':')[0]).sort(),
  ['forbidden field at profile.credential.unitCost', 'money in string at profile.credential.summary']);
expect('guard catches a leak nested deep in an array', findSubDataLeaks({ history: [{ gcName: 'X', laborRate: 95 }] }).length, 1);

// ── Shareable credential ────────────────────────────────────────────────────
console.log('\nthe credential a sub hands a NEW GC:');

expect('company name resolved from the GCs\' records', sam.companyName, 'Volt Edge Electric');
expect('highlights lead with reach', sam.credential.highlights[0], '3 jobs for 2 general contractors');
expect('highlights include completed count', sam.credential.highlights.includes('2 jobs completed and closed out'), true);
expect('highlights include on-time proof with sample size', sam.credential.highlights.includes('75% of scheduled work finished inside the days allotted (4 tasks measured)'), true);
expect('highlights include punch proof', sam.credential.highlights.includes('75% of punch items closed first time, no rework (4 items reviewed)'), true);
expect('highlights include W-9', sam.credential.highlights.includes('W-9 on file'), true);
expect('highlights include trades', sam.credential.highlights.includes('Trades performed: Electrical'), true);
expect('highlights include first year on platform', sam.credential.highlights.includes('Working through MAGE ID since 2024'), true);
expect('summary opens with the reach claim', sam.credential.summary.startsWith('Volt Edge Electric has run 3 jobs for 2 general contractors on MAGE ID'), true);
expect('summary states the on-time rate', sam.credential.summary.includes('75% of the time'), true);
expect('verified line names the evidence and disclaims pricing', sam.credential.verifiedLine, 'Verified by MAGE ID from 3 job records across 2 general contractors. No pricing, rates, or contract values are shared.');
expect('empty credential says so instead of bluffing', stranger.credential.verifiedLine.includes('no linked job records yet'), true);

// ── Referral hook ───────────────────────────────────────────────────────────
console.log('\nreferral hook (the sub pulls their other GCs in):');

expect('invite targets drop GCs already on MAGE and case dupes', sam.referral.inviteTargets.map(g => g.name), ['Ridgeline Homes', 'Castle Rock Custom']);
expect('invite target contact details are carried through', [sam.referral.inviteTargets[0].contactName, sam.referral.inviteTargets[1].email], ['Dana', 'jo@castlerock.com']);
expect('no off-platform list → no targets', thin.referral.inviteTargets, []);
expect('referral leads with the sub\'s own experience', sam.referral.message.startsWith('Hey - a couple of the GCs I work for run their subs through MAGE ID'), true);
expect('referral carries the proof line', sam.referral.message.includes('3 jobs for 2 GCs, 2 closed out'), true);
expect('referral says free for subs', sam.referral.message.includes("free for subs"), true);
expect('short message fits an SMS', sam.referral.shortMessage.length < 200, true);
expect('email subject is branded to the sub', sam.referral.emailSubject, 'Volt Edge Electric - running our jobs through MAGE ID');
expect('referral copy carries no money', findSubDataLeaks(sam.referral), []);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
