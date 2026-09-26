// validate-learned-lead-time.ts — pins utils/automation/learnedLeadTime.ts and
// the provenance-aware half of utils/permitRoadmap.ts.
//
// WHAT IT PROTECTS
//   • 'learned' is REAL. LeadTimeSource has carried the member since v1 with
//     nothing producing it. This guard fails if the module stops producing it,
//     and fails if it produces it from anything but the contractor's own dated
//     appliedDate → approvedDate records.
//   • the sample floor. Under LEARNED_LEAD_FLOOR completed permits there is NO
//     forecast — the seeded default or the labelled AI estimate stands, and the
//     raw count is still reported so the surface can say why.
//   • the RANGE. Permit review varies by type and by season; when the record
//     supports a value it also supports a spread, and the spread is in the chip.
//   • NO BARE NUMBER, EVER. Every chip carries source and either a confidence
//     or an explicit "confirm".
//   • an `ai_estimate` never becomes a red "book-by date passed" banner.
//     roadmapFlags must drop to 'med' and say the deadline is only as real as
//     the guess behind it.
//   • bookByDate reads the RESOLVED lead, not RoadmapInspection.leadTimeDays.
//
// Run: bun run scripts/validate-learned-lead-time.ts

import {
  reviewSamplesFor,
  medianDays,
  learnedPermitReviewLead,
  resolvePermitReviewLead,
  resolveInspectionLead,
  leadTimeFactsFor,
  LEARNED_LEAD_FLOOR,
  MEASURED_LEAD_FLOOR,
  type MeasuredReviewLead,
} from '../utils/automation/learnedLeadTime';
import { leadTimeChipText, getLeadTime } from '../utils/automation/leadTimeLibrary';
import { issuingAuthorityForAddress } from '../utils/codeJurisdiction';
import { bookByDate, roadmapFlags } from '../utils/permitRoadmapSchedule';
import type { Permit, PermitType, PermitRoadmap, RoadmapInspection, ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, actual: T, expected: T, detail?: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(name, a === b, detail ? `${detail}\n      got ${a}, want ${b}` : `got ${a}, want ${b}`);
}

// The string the product actually produces. The literal that stood here —
// 'City of Phoenix Planning & Development Department' — exists nowhere in the
// shipped adoption table, so 66 assertions were green over an authority no
// contractor's permit could ever be matched against.
const PHOENIX = issuingAuthorityForAddress({ city: 'Phoenix', state: 'AZ' });
if (!PHOENIX) throw new Error('the seeded Phoenix row is gone — this guard has nothing to test');
const MESA_TYPED = 'City of Mesa, AZ';

let seq = 0;
/** A completed permit: applied on a day, approved `days` later. */
function reviewed(days: number, type: PermitType = 'electrical', jurisdiction = 'City of Phoenix, AZ'): Permit {
  seq += 1;
  const applied = new Date(Date.UTC(2026, 0, 5));
  const approved = new Date(applied.getTime() + days * 86400000);
  return {
    id: `p${seq}`, projectId: 'proj', projectName: 'Henderson', type,
    jurisdiction, status: 'approved',
    appliedDate: applied.toISOString().slice(0, 10),
    approvedDate: approved.toISOString().slice(0, 10),
    fee: 100,
  };
}
function open_(type: PermitType = 'electrical'): Permit {
  seq += 1;
  return {
    id: `o${seq}`, projectId: 'proj', projectName: 'Henderson', type,
    jurisdiction: 'City of Phoenix, AZ', status: 'applied',
    appliedDate: '2026-01-05', fee: 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nreading the record — what counts as a measurement:');

eq('a permit still in review is not a measurement', reviewSamplesFor([open_()], PHOENIX).length, 0);
eq('an approval BEFORE the application is bad data, not a fast review',
  reviewSamplesFor([{ ...reviewed(10), appliedDate: '2026-02-01', approvedDate: '2026-01-05' }], PHOENIX).length, 0,
  'a negative review would drag the median down and hand him an EARLIER book-by date than his record supports');
eq('a same-day approval IS a measurement and stays in the record',
  reviewSamplesFor([reviewed(0)], PHOENIX).map(s => s.days), [0]);
eq('another city is not this record', reviewSamplesFor([reviewed(10, 'electrical', MESA_TYPED)], PHOENIX).length, 0);
eq('the format the app itself suggests IS this record — the whole feature is silent otherwise',
  reviewSamplesFor([reviewed(10, 'electrical', 'City of Phoenix, AZ')], PHOENIX).length, 1,
  `PHOENIX = ${PHOENIX}`);
eq('no authority reads nothing', reviewSamplesFor([reviewed(10)], null).length, 0);
eq('an unparseable date is not a measurement',
  reviewSamplesFor([{ ...reviewed(10), approvedDate: 'soon' }], PHOENIX).length, 0);

eq('median of an odd set', medianDays([5, 40, 12]), 12);
eq('median of an even set takes the LOWER middle — never a half-day nobody observed',
  medianDays([10, 20, 30, 40]), 20);

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\nthe sample floor (${LEARNED_LEAD_FLOOR} completed permits):`);

eq('nothing on file learns nothing', learnedPermitReviewLead([], PHOENIX, 'electrical'), null);
eq(`${LEARNED_LEAD_FLOOR - 1} permits learn nothing — two points cannot support a forecast`,
  learnedPermitReviewLead([reviewed(18), reviewed(34)], PHOENIX, 'electrical'), null);
{
  const r = resolvePermitReviewLead({ permits: [reviewed(18), reviewed(34)], authority: PHOENIX, permitType: 'electrical', authoredDays: 7 });
  ok('...but the raw count is still reported', r.observed === 2, `observed=${r.observed}`);
  ok('...and the chip says WHY there is no learned value',
    /2 completed reviews on file — under 3, too few to learn from/.test(r.chipLabel), r.chipLabel);
  eq('...and the value falls back to the model guess, LABELLED', r.lead.source, 'ai_estimate');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n'learned' is finally produced — from his own dated records:");

{
  const permits = [reviewed(18), reviewed(25), reviewed(34)];
  const l = learnedPermitReviewLead(permits, PHOENIX, 'electrical');
  ok('three completed permits learn a lead', l !== null);
  eq('...the value booked against is the median', l?.days, 25);
  eq('...and the honest spread is carried with it', [l?.minDays, l?.maxDays], [18, 34]);
  eq('...scoped to the permit TYPE, not to permits in general', l?.scope, 'type');
  eq('...at medium confidence, not high, on three points', l?.confidence, 'med');

  const r = resolvePermitReviewLead({ permits, authority: PHOENIX, permitType: 'electrical', authoredDays: 5 });
  eq('the resolution reports source learned', r.lead.source, 'learned');
  eq('...and the days are the learned days, NOT the model\'s 5', r.lead.days, 25);
  ok('...the chip names it as HIS record', /Your record/.test(r.chipLabel), r.chipLabel);
  ok('...and shows the RANGE, because a single integer is the wrong shape for review time',
    /18–34d across your 3 electrical permits/.test(r.chipLabel), r.chipLabel);
  ok('...a learned date is a hard date', r.hardDate);
}
{
  const permits = [reviewed(10), reviewed(12), reviewed(14), reviewed(16), reviewed(18), reviewed(20)];
  eq('six type-matched permits earn high confidence',
    learnedPermitReviewLead(permits, PHOENIX, 'electrical')?.confidence, 'high');
}
{
  // One electrical permit and three plumbing ones. The type is below the floor
  // so the record widens — and the label has to admit it did.
  const permits = [reviewed(40, 'electrical'), reviewed(20, 'plumbing'), reviewed(24, 'plumbing'), reviewed(28, 'plumbing')];
  const l = learnedPermitReviewLead(permits, PHOENIX, 'electrical');
  eq('a below-floor type widens across all types', l?.scope, 'all_types');
  eq('...and a widened lead is only low confidence', l?.confidence, 'low');
  eq('...the median is across all four', l?.days, 24);
  ok('...and the chip says "all types" out loud',
    /across your 4 permits \(all types\)/.test(
      resolvePermitReviewLead({ permits, authority: PHOENIX, permitType: 'electrical' }).chipLabel));
}
{
  const permits = [reviewed(0), reviewed(0), reviewed(0)];
  const l = learnedPermitReviewLead(permits, PHOENIX, 'electrical');
  eq('an all-same-day record still books at least one day', l?.days, 1,
    'leadTimeLibrary\'s invariant: a lead can never collapse to a same-day anchor');
  eq('...while the range stays honest about what was observed', [l?.minDays, l?.maxDays], [0, 0]);
  // The clamp is a SCHEDULING decision. Printing it as the median produced
  // "0–0 days, median 1" — an arithmetic impossibility handed to the model as
  // a measurement of the contractor.
  eq('...and the measured median is carried unclamped', l?.medianRaw, 0);
  const facts = leadTimeFactsFor(permits, PHOENIX);
  ok('the prompt reports the MEASURED median, not the booked one',
    /0–0 days, median 0 \(booked at 1 — a lead is never zero days\)/.test(facts.promptBlock), facts.promptBlock);
  ok('...and no impossible "median 1" inside a 0–0 range survives',
    !/0–0 days, median 1/.test(facts.promptBlock));
  const chip = resolvePermitReviewLead({ permits, authority: PHOENIX, permitType: 'electrical' }).chipLabel;
  ok('...and the chip admits both numbers', /median 0d — booked at 1d/.test(chip), chip);
}
{
  // Confidence was a pure function of n. Three samples that disagree by two
  // orders of magnitude were "medium confidence", and the prompt told the model
  // the range "is a measurement of this contractor with this office".
  const wild = [reviewed(3), reviewed(3), reviewed(400)];
  const l = learnedPermitReviewLead(wild, PHOENIX, 'electrical');
  eq('a 3d/3d/400d record is not medium confidence', l?.confidence, 'low');
  eq('...and it is flagged as dispersed', l?.dispersed, true);
  ok('...the chip says WHY, rather than only showing the range',
    /wide spread, treat as unsettled/.test(
      resolvePermitReviewLead({ permits: wild, authority: PHOENIX, permitType: 'electrical' }).chipLabel));
  ok('...and the model is told the median does not describe it',
    /the median does not describe it/.test(leadTimeFactsFor(wild, PHOENIX).promptBlock));
  const tight = learnedPermitReviewLead([reviewed(18), reviewed(25), reviewed(34)], PHOENIX, 'electrical');
  eq('a record that agrees with itself keeps its confidence', tight?.confidence, 'med');
  eq('...and is not flagged', tight?.dispersed, false);
  const wildHigh = learnedPermitReviewLead(
    [reviewed(3), reviewed(3), reviewed(3), reviewed(3), reviewed(3), reviewed(400)], PHOENIX, 'electrical');
  eq('six samples that disagree are demoted from high, not left there', wildHigh?.confidence, 'med');
}
{
  const permits = [reviewed(18), reviewed(25), reviewed(34)];
  const r = resolvePermitReviewLead({ permits, authority: PHOENIX, permitType: 'electrical', authoredDays: 5 });
  ok('a learned value BEATS the model\'s authored guess', r.lead.source === 'learned' && r.lead.days !== 5);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nno source may render bare, and no guess may render as a deadline:');

for (const r of [
  resolvePermitReviewLead({ permits: [], authority: PHOENIX }),
  resolvePermitReviewLead({ permits: [], authority: PHOENIX, authoredDays: 9 }),
  resolvePermitReviewLead({ permits: [reviewed(18), reviewed(25), reviewed(34)], authority: PHOENIX, permitType: 'electrical' }),
  resolveInspectionLead({ authority: PHOENIX }),
  resolveInspectionLead({ authority: PHOENIX, authoredDays: 3 }),
]) {
  ok(`chip is never a bare number: ${JSON.stringify(r.chipLabel)}`,
    r.chipLabel.includes('·') && /Your record|Typical|Jurisdiction|AI estimate/.test(r.chipLabel));
  ok('  ...and always states the day count it is talking about', /\d+d lead/.test(r.chipLabel));
}
{
  const r = resolvePermitReviewLead({ permits: [], authority: PHOENIX, authoredDays: 9 });
  eq('an unbacked model integer surfaces as ai_estimate', r.lead.source, 'ai_estimate');
  eq('...and NEVER as a hard date', r.hardDate, false);
  ok('...the chip asks him to confirm it', /AI estimate · confirm/.test(r.chipLabel), r.chipLabel);
  ok('...and says there is no history behind it', /no permit history here yet/.test(r.chipLabel), r.chipLabel);
}
{
  const r = resolvePermitReviewLead({ permits: [], authority: PHOENIX });
  eq('with no model guess either, the seeded national default stands', r.lead.source, 'default');
  eq('...at the library\'s own value, not a number invented here', r.lead.days, getLeadTime('permit_review').days);
  ok('...labelled as a default rather than as local knowledge',
    /a seeded national default, not your record/.test(r.sourceLabel));
  // A national placeholder for an office nothing was measured about is LESS
  // grounded than the ai_estimate that at least saw the project scope. It used
  // to be the one source allowed to print a hard date and turn a banner red.
  eq('...and it is NOT a hard date', r.hardDate, false);
  eq('the inspection resolver agrees', resolveInspectionLead({ authority: PHOENIX }).hardDate, false);
  eq('...including when the model authors a zero, which the zod default does not fill',
    resolveInspectionLead({ authority: PHOENIX, authoredDays: 0 }).hardDate, false);
  ok('a hard date is now reserved for a measurement',
    resolvePermitReviewLead({ permits: [reviewed(18), reviewed(25), reviewed(34)], authority: PHOENIX, permitType: 'electrical' }).hardDate);
}
{
  // `observed` counts COMPLETED reviews. Three permits still in review reported
  // "no permit history here yet" to a contractor with three permits on file.
  const r = resolvePermitReviewLead({ permits: [open_(), open_(), open_()], authority: PHOENIX, permitType: 'electrical', authoredDays: 9 });
  ok('open permits are not "no permit history"',
    /no completed review here yet \(3 permits still open\)/.test(r.chipLabel), r.chipLabel);
  const mixed = resolvePermitReviewLead({ permits: [reviewed(18), open_(), open_()], authority: PHOENIX, permitType: 'electrical', authoredDays: 9 });
  ok('...and a partial record says both numbers',
    /1 completed review on file — under 3, too few to learn from, 2 still open/.test(mixed.chipLabel), mixed.chipLabel);
  const truly = resolvePermitReviewLead({ permits: [], authority: PHOENIX, authoredDays: 9 });
  ok('an empty file still says it is empty', /no permit history here yet/.test(truly.chipLabel), truly.chipLabel);
}
{
  // The one place a 'learned' value must NOT appear. PermitInspection records
  // the day of the visit, never the day it was requested, so a book-ahead lead
  // cannot be measured — inventing one would be a fabrication wearing the one
  // label in this union that means "measured".
  const permits = [reviewed(18), reviewed(25), reviewed(34)];
  ok('an inspection lead is never "learned", however rich the permit record is',
    resolveInspectionLead({ authority: PHOENIX }).lead.source !== 'learned'
    && resolveInspectionLead({ authority: PHOENIX, authoredDays: 4 }).lead.source !== 'learned');
  eq('...and the permit record does not leak into it',
    resolveInspectionLead({ authority: PHOENIX }).lead.days,
    getLeadTime('dob_inspection').days);
  ok('...(the permit path meanwhile does learn from those same records)',
    resolvePermitReviewLead({ permits, authority: PHOENIX, permitType: 'electrical' }).lead.source === 'learned');
}
ok('the chip idiom itself never emits a naked integer',
  !/^\d+d lead$/.test(leadTimeChipText({ days: 8, source: 'default', confidence: 'low' })));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe screen: a guess must not turn red:');

function task(id: string, startDay: number): ScheduleTask {
  return {
    id, title: id, phase: 'General', durationDays: 3, startDay, progress: 0,
    crew: '', dependencies: [], notes: '', status: 'not_started',
  };
}
function inspection(over: Partial<RoadmapInspection> = {}): RoadmapInspection {
  return {
    id: 'rmi1', type: 'electrical', title: 'Rough electrical', description: '',
    gatesTaskHint: 'Drywall', gatesTaskId: 't1', leadTimeDays: 30, status: 'pending', ...over,
  };
}
const tasks = [task('t1', 2)];
// Two days after start, minus the lead → a book-by date well in the past.
const START = new Date(Date.now()).toISOString().slice(0, 10);

{
  const roadmap: PermitRoadmap = {
    id: 'r1', projectId: 'proj', generatedAt: '', scopeHash: '',
    permits: [], inspections: [inspection()],
  };
  const guess = roadmapFlags(roadmap, tasks, START, () => ({
    days: 30, hardDate: false, sourceLabel: 'an AI estimate, not your record',
  }));
  eq('an overdue book-by from a GUESS is not high severity', guess[0]?.severity, 'med');
  ok('...and the message says the deadline is only as real as the guess',
    /book-by date passed IF the ~30d lead is right/.test(guess[0]?.message ?? ''), guess[0]?.message);
  ok('...and names the provenance in the banner itself',
    /an AI estimate, not your record/.test(guess[0]?.message ?? ''));

  // A GROUNDED lead — one hardDate source. Note what this does NOT prove: no
  // book-by date on the Roadmap can be backed by 'learned' today, because the
  // only rows carrying a date are INSPECTION rows and resolveInspectionLead has
  // no learned branch by design. The reachable hardDate source there is
  // 'jurisdiction'. This pins roadmapFlags' arithmetic, not a shipped state.
  const grounded = roadmapFlags(roadmap, tasks, START, () => ({
    days: 30, hardDate: true, sourceLabel: 'from a jurisdiction dataset',
  }));
  eq('an overdue book-by from a MEASUREMENT IS high severity', grounded[0]?.severity, 'high');
  ok('...stated flatly, because it is not a guess',
    /book-by date passed \(30d lead, from a jurisdiction dataset\)/.test(grounded[0]?.message ?? ''),
    grounded[0]?.message);
  const seeded = roadmapFlags(roadmap, tasks, START, () => {
    const r = resolveInspectionLead({ authority: PHOENIX, authoredDays: 0 });
    return { days: r.lead.days, hardDate: r.hardDate, sourceLabel: r.sourceLabel };
  });
  eq('the SEEDED DEFAULT, resolved through the real path, cannot turn the banner red',
    seeded[0]?.severity, 'med');
  ok('...and says the date is only as real as the placeholder behind it',
    /book-by date passed IF the ~\d+d lead is right — a seeded national default, not your record/.test(seeded[0]?.message ?? ''),
    seeded[0]?.message);
}
{
  // The upcoming (not yet overdue) case still has to name its source.
  const soon: PermitRoadmap = {
    id: 'r2', projectId: 'proj', generatedAt: '', scopeHash: '',
    permits: [], inspections: [inspection({ leadTimeDays: 1 })],
  };
  const flags = roadmapFlags(soon, [task('t1', 3)], START, () => ({
    days: 1, hardDate: true, sourceLabel: 'from a jurisdiction dataset',
  }));
  ok('an upcoming book-by names its lead and its source',
    /book by .+ \(1d lead, from a jurisdiction dataset\)/.test(flags[0]?.message ?? ''), flags[0]?.message);
}
{
  // THE CORE ROUTING CLAIM: the date comes from the resolved lead, not from
  // the integer sitting on the inspection.
  const insp = inspection({ leadTimeDays: 30 });
  const fromAuthored = bookByDate(insp, [task('t1', 60)], '2026-03-01', { days: 30, hardDate: true, sourceLabel: 'x' });
  const fromResolved = bookByDate(insp, [task('t1', 60)], '2026-03-01', { days: 5, hardDate: true, sourceLabel: 'x' });
  ok('bookByDate obeys the lead it is HANDED, not insp.leadTimeDays',
    fromAuthored?.getTime() !== fromResolved?.getTime()
    && fromResolved!.getTime() - fromAuthored!.getTime() === 25 * 86400000,
    `${fromAuthored?.toISOString()} vs ${fromResolved?.toISOString()}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nwhat the roadmap prompt is told:');

{
  const none = leadTimeFactsFor([], PHOENIX);
  eq('no record → not grounded', none.grounded, false);
  ok('...and the model is told not to present its guess as local knowledge',
    /do not present it as local knowledge/.test(none.promptBlock));
  const thin = leadTimeFactsFor([reviewed(18), reviewed(34)], PHOENIX);
  ok('below the floor the model is told the count AND the floor',
    /2 completed permits on file, under the 3-permit floor/.test(thin.promptBlock), thin.promptBlock);
  const learned = leadTimeFactsFor([reviewed(18), reviewed(25), reviewed(34)], PHOENIX);
  eq('a learned record → grounded', learned.grounded, true);
  ok('...and the model gets the RANGE, not a single number',
    /3 completed permits, 18–34 days, median 25\./.test(learned.promptBlock), learned.promptBlock);
  ok('...and is told whose measurement it is',
    /this contractor with this office, not a national average/.test(learned.promptBlock));
  const noAuth = leadTimeFactsFor([reviewed(18), reviewed(25), reviewed(34)], null);
  eq('no authority → not grounded, whatever is on file', noAuth.grounded, false);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe measured tier (a public dataset, e.g. NYC DOB review times):');

{
  const NYC = 'NYC Department of Buildings';
  const measured = (n: number, days = 41): MeasuredReviewLead => ({
    days,
    n,
    detail: `median ${days}d · p75 77d · n=${n.toLocaleString('en-US')} · Brooklyn standard-plan-exam alteration filings approved in the last 12 mo · NYC Open Data w9ak-ipjd · approved filings only`,
    appliesTo: ['building'],
  });
  eq('the floor is 30 filings', MEASURED_LEAD_FLOOR, 30);
  const m = resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'building', authoredDays: 90, measured: measured(8851) });
  eq('measured at the floor → source jurisdiction', m.lead.source, 'jurisdiction');
  eq('...books the measured median', m.lead.days, 41);
  eq('...is a hard date (a measurement)', m.hardDate, true);
  eq('...n >= 300 is high confidence', m.lead.confidence, 'high');
  eq('...says where it was measured', m.sourceLabel, 'measured from NYC DOB filings');
  ok('...the chip carries n and "approved filings only"', /n=8,851/.test(m.chipLabel) && /approved filings only/.test(m.chipLabel), m.chipLabel);
  ok('...and beats the ai_estimate', m.lead.source !== 'ai_estimate');
  eq('n between the floor and 300 → med', resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'building', measured: measured(120) }).lead.confidence, 'med');
  eq('exactly the floor (30) counts', resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'building', measured: measured(30) }).lead.source, 'jurisdiction');
  const thin = resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'building', authoredDays: 90, measured: measured(29) });
  ok('n=29 (under the floor) is IGNORED — the ai_estimate stands', thin.lead.source === 'ai_estimate' && thin.hardDate === false, JSON.stringify(thin.lead));
  const elec = resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'electrical', authoredDays: 90, measured: measured(8851) });
  ok('a type the benchmark does not describe (electrical) ignores it', elec.lead.source === 'ai_estimate', JSON.stringify(elec.lead));
  const own = [reviewed(18, 'building', NYC), reviewed(25, 'building', NYC), reviewed(34, 'building', NYC)];
  const learnedWins = resolvePermitReviewLead({ permits: own, authority: NYC, permitType: 'building', measured: measured(8851) });
  eq('his own record (>= 3 permits) beats the public benchmark', learnedWins.lead.source, 'learned');
  const none = resolvePermitReviewLead({ permits: [], authority: NYC, permitType: 'building', authoredDays: 90, measured: null });
  eq('no benchmark → unchanged resolution', none.lead.source, 'ai_estimate');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
