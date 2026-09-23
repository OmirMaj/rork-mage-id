// validate-safety-osha.ts — unit tests for utils/safety/osha.ts (Wave A,
// isOshaRecordable classification) AND utils/safety/oshaLog.ts (Wave B, OSHA
// Form 300 row assembly + serializers). Both suites share one file/script
// (test:safety-osha) so ship-check covers classification and log assembly.
// Run via: bun run scripts/validate-safety-osha.ts

import {
  isOshaRecordable, describeRecordability, buildSafetyIncidentFromDfr,
  safetyIncidentIdForReport, DFR_SEVERITY_TO_REGISTER_SEVERITY,
  type IncidentClassInput,
} from '../utils/safety/osha';
import {
  canReadLiveWeatherFor, backfilledWeatherNotice, weatherProvenanceLine,
} from '../utils/weatherService';
import {
  buildOsha300Log, oshaRowFromIncident, osha300ToCsv, csvCell, isRecordableCase, buildOsha300Html,
  buildOsha300ATotals, prefillHoursFromTimeEntries, incidentRatePer200k, osha300ARates, availableOshaYears,
} from '../utils/safety/oshaLog';
import type { SafetyIncident } from '../types';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

// Baseline: a non-recordable first-aid-only injury. Each case overrides.
function base(over: Partial<IncidentClassInput>): IncidentClassInput {
  return {
    type: 'injury',
    treatment: 'first_aid',
    daysAway: 0,
    restrictedDuty: false,
    lostConsciousness: false,
    fatality: false,
    ...over,
  };
}

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nsafety OSHA-recordable validation:');

// Non-injury types are never recordable (near-miss / property / environmental)
expect('near_miss → not recordable', isOshaRecordable(base({ type: 'near_miss', treatment: 'none' })), false);
expect('property damage → not recordable', isOshaRecordable(base({ type: 'property', treatment: 'none' })), false);
expect('environmental → not recordable', isOshaRecordable(base({ type: 'environmental', treatment: 'none' })), false);

// First-aid-only injury is NOT recordable
expect('injury, first aid only → not recordable', isOshaRecordable(base({})), false);
expect('injury, no treatment → not recordable', isOshaRecordable(base({ treatment: 'none' })), false);

// Any recording trigger flips it to recordable
expect('medical beyond first aid → recordable', isOshaRecordable(base({ treatment: 'medical_beyond_first_aid' })), true);
expect('days away > 0 → recordable', isOshaRecordable(base({ daysAway: 3 })), true);
expect('restricted duty → recordable', isOshaRecordable(base({ restrictedDuty: true })), true);
expect('lost consciousness → recordable', isOshaRecordable(base({ lostConsciousness: true })), true);

// Fatality is always recordable — even if some other field looks benign
expect('fatality → recordable', isOshaRecordable(base({ fatality: true, treatment: 'none' })), true);
// A fatality on a non-injury-typed record is still recordable (death is death)
expect('fatality on environmental → recordable', isOshaRecordable(base({ type: 'environmental', fatality: true, treatment: 'none' })), true);

// ── Audit round 2 #1: the day count and the illness column decide too ───────
// Repro 1 (from the incident form): Injury, first aid, 0 days away, FIVE days
// restricted, toggle left off. Used to say "Not recordable — first aid only, no
// days away, no restriction." directly under the field showing 5.
const repro1 = base({ treatment: 'first_aid', daysRestricted: 5, restrictedDuty: false });
expect('5 days restricted, toggle off → recordable', isOshaRecordable(repro1), true);
expect('5 days restricted names restriction, not "no restriction"',
  describeRecordability(repro1).reason, 'Recordable — restricted work or job transfer.');
expect('0 days restricted, toggle off → still first-aid only', isOshaRecordable(base({ daysRestricted: 0 })), false);
// Repro 2: a respiratory illness logged as an 'environmental' event. The type
// gate rejected every non-'injury' type before the illness column was read.
const repro2 = base({ type: 'environmental', treatment: 'none', oshaIllnessType: 'respiratory', daysRestricted: 5 });
expect('respiratory illness on an environmental event → recordable', isOshaRecordable(repro2), true);
expect('an illness with medical treatment on a property event → recordable',
  isOshaRecordable(base({ type: 'property', treatment: 'medical_beyond_first_aid', oshaIllnessType: 'skin' })), true);
// ...but col M left at its default 'injury' on a non-injury event is NOT a claim
// that anyone was hurt, and must not make a near miss recordable.
expect("near miss with illness type left at 'injury' → not recordable",
  isOshaRecordable(base({ type: 'near_miss', treatment: 'medical_beyond_first_aid', oshaIllnessType: 'injury' })), false);

// ── Wave B: OSHA-300 log row assembly (utils/safety/oshaLog.ts) ──────────────
console.log('\nsafety OSHA-300 validation:');

// Minimal incident shapes — cast like validate-schedule-colors does with tasks.
function inc(o: Partial<SafetyIncident>): SafetyIncident { return o as unknown as SafetyIncident; }

// Classification/day/illness columns are read from each incident's OWN recorded
// outcome fields — NOT the internal severity rating. These fixtures deliberately
// mismatch severity vs outcome to prove severity is ignored.
const incidents: SafetyIncident[] = [
  // days-away case whose severity is only 'medium' — must classify by daysAway, not severity.
  inc({ id: 'i1', oshaRecordable: true,  occurredAt: '2026-03-02', severity: 'medium',   type: 'injury',        location: 'Level 2', description: 'Fall from ladder', daysAway: 3, restrictedDuty: false, fatality: false, peopleInvolved: [{ name: 'Jose R', role: 'Laborer', injuryDescription: 'Sprained ankle' }] }),
  inc({ id: 'i2', oshaRecordable: false, occurredAt: '2026-03-05', severity: 'low',      type: 'near_miss',     location: 'Yard',    description: 'Dropped tool',    peopleInvolved: [] }),
  // fatality whose severity is only 'high' — must still classify as death.
  inc({ id: 'i3', oshaRecordable: true,  occurredAt: '2026-01-15', severity: 'high',     type: 'injury',        location: 'Roof',    description: 'Fatal fall',      daysAway: 0, fatality: true, peopleInvolved: [{ name: 'Sam T', role: 'Roofer' }] }),
  // restricted chemical case with an explicit respiratory illness classification.
  // Its flag is COMPUTED, not typed in (audit round 2 #1): this fixture used to
  // hard-code oshaRecordable:true for inputs the classifier called false, so the
  // log tests passed on a row no screen could ever save. restrictedDuty is left
  // OFF on purpose — the 5 counted days alone must make it a restricted case.
  inc({ id: 'i4', oshaRecordable: isOshaRecordable({ type: 'environmental', treatment: 'none', daysAway: 0, daysRestricted: 5, restrictedDuty: false, lostConsciousness: false, fatality: false, oshaIllnessType: 'respiratory' }), occurredAt: '2026-04-01', severity: 'critical', type: 'environmental', treatment: 'none', location: 'Basement',description: 'Chemical exposure',daysAway: 0, restrictedDuty: false, lostConsciousness: false, daysRestricted: 5, fatality: false, oshaIllnessType: 'respiratory', peopleInvolved: [] }),
  // prior-year recordable — must be excluded from a 2026 log.
  inc({ id: 'i5', oshaRecordable: true,  occurredAt: '2025-11-01', severity: 'high',     type: 'injury',        location: 'Level 1', description: 'Prior-year injury', daysAway: 2, fatality: false, peopleInvolved: [] }),
];

// Every recordable fixture's stored flag must be what the classifier says about
// its own inputs. Without this the suite can never catch a stored flag that
// disagrees with the classifier — which is exactly how i4 hid the bug.
for (const f of incidents) {
  if (!f.oshaRecordable) continue;
  const recomputed = isOshaRecordable({
    type: f.type, treatment: f.treatment ?? (f.fatality ? 'none' : 'medical_beyond_first_aid'),
    daysAway: f.daysAway ?? 0, daysRestricted: f.daysRestricted ?? 0, restrictedDuty: !!f.restrictedDuty,
    lostConsciousness: !!f.lostConsciousness, fatality: !!f.fatality, oshaIllnessType: f.oshaIllnessType,
  });
  expect(`fixture ${f.id} stored flag matches the classifier`, recomputed, true);
}
// A case saved under the old classifier (flag false, evidence recordable) still
// reaches the log: the log re-classifies instead of trusting a stale snapshot.
const staleFlag = inc({ id: 'stale', oshaRecordable: false, occurredAt: '2026-05-01', type: 'injury', treatment: 'first_aid', daysAway: 0, daysRestricted: 4, restrictedDuty: false, lostConsciousness: false, fatality: false, peopleInvolved: [] });
expect('a stale false flag with 4 restricted days is a recordable case', isRecordableCase(staleFlag), true);
expect('…and it lands on the 300 as a restricted case', buildOsha300Log([staleFlag], '2026')[0]?.classification, 'restricted');
expect('a genuine first-aid case with a false flag stays off', buildOsha300Log([inc({ ...staleFlag, daysRestricted: 0 })], '2026').length, 0);

const logAll = buildOsha300Log(incidents);
const log = buildOsha300Log(incidents, '2026');
const log2025 = buildOsha300Log(incidents, '2025');
expect('no year → all recordable years',  logAll.length, 4);
expect('year 2026 → only 2026 recordable',log.length, 3);
expect('year 2025 → only 2025 recordable',log2025.length, 1);
expect('sorted oldest first (Jan)',       log[0].dateOfIncident, '2026-01-15');
expect('sorted (Mar second)',             log[1].dateOfIncident, '2026-03-02');
expect('sorted (Apr last)',               log[2].dateOfIncident, '2026-04-01');
expect('case numbers sequential',         [log[0].caseNo, log[1].caseNo, log[2].caseNo], ['1','2','3']);
expect('fatality → death (ignores sev)',  log[0].classification, 'death');
expect('daysAway>0 → days_away (ign sev)',log[1].classification, 'days_away');
expect('restricted days (toggle off) → restricted', log[2].classification, 'restricted');
expect('employee name from person',       log[1].employeeName, 'Jose R');
expect('job title from role',             log[1].jobTitle, 'Laborer');
expect('desc prefers injuryDescription',  log[1].description, 'Sprained ankle');
expect('no person → dash name',           log[2].employeeName, '—');
expect('no person → dash title',          log[2].jobTitle, '—');
expect('explicit illness type honored',   log[2].illnessType, 'respiratory');
expect('default illness type = injury',   log[1].illnessType, 'injury');
expect('days away read from incident',    log[1].daysAway, 3);
expect('days away 0 for fatality case',   log[0].daysAway, 0);
expect('days restricted read from incident', log[2].daysRestricted, 5);

// direct row assembly with explicit case number
const row = oshaRowFromIncident(incidents[0], 7);
expect('explicit case number honored',    row.caseNo, '7');

// CSV
const csv = osha300ToCsv(log, { name: 'Acme, Inc', year: '2026' });
expect('csv includes a case row',         csv.includes('Fatal fall'), true);
expect('csv establishment escaped',       csv.includes('"Acme, Inc"'), true);
expect('csvCell escapes comma',           csvCell('Acme, Inc'), '"Acme, Inc"');
expect('csvCell escapes quote',           csvCell('a"b'), '"a""b"');
expect('csvCell plain passthrough',       csvCell('plain'), 'plain');

// ── Audit round 2 #4: the 300A — column totals, hours pre-fill, rates ────────
console.log('\nOSHA 300A summary:');
{
  const rowsA = buildOsha300Log(incidents, '2026'); // death, days-away(3), restricted(5, respiratory)
  const t = buildOsha300ATotals(rowsA);
  expect('G deaths', t.deaths, 1);
  expect('H days-away cases', t.daysAwayCases, 1);
  expect('I restricted cases', t.restrictedCases, 1);
  expect('J other cases', t.otherCases, 0);
  expect('K days away summed', t.totalDaysAway, 3);
  expect('L days restricted summed', t.totalDaysRestricted, 5);
  expect('M1 injuries', t.byType.injury, 2);
  expect('M3 respiratory', t.byType.respiratory, 1);
  expect('total cases', t.totalCases, 3);
  expect('G+H+I+J = total', t.deaths + t.daysAwayCases + t.restrictedCases + t.otherCases, t.totalCases);
  // The CSV carries the totals so February is not a spreadsheet job.
  const csvA = osha300ToCsv(rowsA, { name: 'Acme', year: '2026' });
  expect('csv carries the 300A totals block', csvA.includes('Totals (Form 300A columns G–M)'), true);
  expect('csv totals row G..L', csvA.includes('\n1,1,1,0,3,5\n'), true);
  // The PDF prints totals always, and the 300A page only with confirmed numbers.
  const htmlNoSummary = buildOsha300Html(rowsA, { name: 'Acme', year: '2026' });
  expect('html prints a totals footer', htmlNoSummary.includes('<tfoot>'), true);
  expect('no 300A page without confirmed hours', htmlNoSummary.includes('page-300a"'), false);
  const htmlEst = buildOsha300Html(rowsA, { name: 'Acme', year: '2026' },
    { hoursWorked: 100000, averageEmployees: 50, hoursSource: 'Entered by hand.', projectScoped: false });
  expect('300A page present with confirmed hours', htmlEst.includes('OSHA Form 300A'), true);
  expect('300A page prints TRIR over the confirmed hours', htmlEst.includes('>6.00<'), true);
  const htmlProj = buildOsha300Html(rowsA, { name: 'Acme', year: '2026' },
    { hoursWorked: 100000, averageEmployees: 50, hoursSource: 'x', projectScoped: true });
  expect('a project-scoped page is titled a project rate, not the 300A', htmlProj.includes('not the establishment 300A') && !htmlProj.includes('OSHA Form 300A —'), true);

  // Rates: cases × 200,000 / hours; never a number over an unknown denominator.
  expect('TRIR 3 cases / 100k h = 6', incidentRatePer200k(3, 100000), 6);
  expect('rate over 0 hours is null, not 0 or Infinity', incidentRatePer200k(3, 0), null);
  expect('rate over NaN hours is null', incidentRatePer200k(3, Number.NaN), null);
  const r = osha300ARates(t, 200000);
  expect('TRIR counts every case', r.trir, 3);
  expect('DART counts days-away + restricted only', r.dart, 2);

  // Hours pre-fill: TimeEntry only, year- and project-scoped, labelled.
  const te = [
    { workerId: 'w1', projectId: 'p1', date: '2026-03-02', totalHours: 8 },   // Mon
    { workerId: 'w2', projectId: 'p1', date: '2026-03-04', totalHours: 8 },   // same week
    { workerId: 'w1', projectId: 'p2', date: '2026-03-10', totalHours: 10 },  // next week, other project
    { workerId: 'w1', projectId: 'p1', date: '2025-12-31', totalHours: 9 },   // prior year
    { workerId: 'w3', projectId: 'p1', date: '2026-03-05', totalHours: 0 },   // open shift, no hours
  ];
  const all = prefillHoursFromTimeEntries(te, '2026');
  expect('hours summed for the year only', all.totalHours, 26);
  expect('entries counted', all.entryCount, 3);
  expect('two distinct weeks', all.weekCount, 2);
  expect('average employees = mean distinct workers per week (2,1 → 2)', all.averageEmployees, 2);
  expect('label names the source and says it runs low', all.sourceLabel.includes('MAGE time tracking') && all.sourceLabel.includes('payroll'), true);
  const p1 = prefillHoursFromTimeEntries(te, '2026', 'p1');
  expect('project scope filters hours to that project', p1.totalHours, 16);
  expect('no entries → says so and asks for payroll hours',
    prefillHoursFromTimeEntries([], '2026').sourceLabel.startsWith('No MAGE time-tracking entries'), true);
  // A Sunday and the following Monday are different weeks (Monday-anchored).
  const sunMon = prefillHoursFromTimeEntries([
    { workerId: 'a', projectId: 'p', date: '2026-03-08', totalHours: 1 },
    { workerId: 'a', projectId: 'p', date: '2026-03-09', totalHours: 1 },
  ], '2026');
  expect('Sunday and Monday fall in different weeks', sunMon.weekCount, 2);
  // A pre-fix entry whose `date` is the UTC day: bucket by the LOCAL day of
  // clockIn. Pinned to a zone west of Greenwich (CI runs in UTC, where the
  // two days coincide and the check would be vacuous), then restored.
  const prevTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  const localEve = new Date(2025, 11, 31, 20, 0, 0); // 8 pm Dec 31, local
  const utcDayOfIt = localEve.toISOString().slice(0, 10);
  const eve = prefillHoursFromTimeEntries([
    { workerId: 'a', projectId: 'p', date: utcDayOfIt, clockIn: localEve.toISOString(), totalHours: 4 },
  ], '2025');
  expect('an evening Dec 31 shift counts in the year it was worked, whatever its stored UTC date', eve.totalHours, 4);
  expect('…(the fixture really does carry next year\'s UTC date)', utcDayOfIt, '2026-01-01');
  if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
}

// The screen wiring for the 300A: rates only after confirmation, hours scoped.
{
  const oshaSrc = readFileSync(new URL('../app/safety-osha.tsx', import.meta.url), 'utf8');
  ok('300A rates are gated on a confirmed denominator',
    /confirmed \? osha300ARates\(totals, hoursNum\) : null/.test(oshaSrc),
    'TRIR/DART must not render from an unconfirmed time-tracking pre-fill — it runs low and inflates the rate.');
  ok('the hours pre-fill follows the screen\'s project filter',
    /prefillHoursFromTimeEntries\(\s*hoursEntriesForOwnEstablishment\(timeEntries, projects, user\?\.id\),\s*est\.year,\s*projectId \|\| undefined,\s*\)/.test(oshaSrc),
    'dividing one project\'s cases by company-wide hours prints a wrong rate.');
  ok('the PDF only gets a 300A page from confirmed numbers',
    oshaSrc.includes('exportOsha300Pdf(scopedIncidents, est, summaryInput)') && /summaryInput = useMemo<Osha300ASummaryInput \| undefined>\(\(\) => \(confirmed \?/.test(oshaSrc),
    'the export must not print a rate the user never confirmed.');
  // A zero-case establishment still posts a 300A; the export lived inside
  // the `rows.length > 0` branch, so a clean year had no way to print it.
  {
    const exportAt = oshaSrc.indexOf('testID="osha-export-pdf"');
    const casesBranch = oshaSrc.indexOf('{rows.length > 0 ? (\n          <>');
    ok('Export PDF renders with zero recordable cases (outside the cases branch)',
      exportAt > 0 && casesBranch > 0 && exportAt < casesBranch,
      'a zero-case year must still export its 300 / 300A.');
    const zero = buildOsha300Html([], { name: 'Acme', year: '2026' });
    ok('…and the zero-case PDF says so rather than printing an empty table',
      /No recordable cases for 2026\./.test(zero));
  }
  // The year list moved into utils/safety/oshaLog.availableOshaYears (wave 3,
  // #168); the screen must use it, and it must keep the log's membership rule.
  ok('the year list uses the same membership rule as the log',
    /availableOshaYears\(scopedIncidents, currentYear\)/.test(oshaSrc)
      && availableOshaYears([inc({ id: 'y', oshaRecordable: false, type: 'injury', treatment: 'medical_beyond_first_aid', daysAway: 0, daysRestricted: 0, occurredAt: '2024-05-01' })], '2026').includes('2024'),
    'a re-classified case would be on the log but its year missing from the picker.');
}

// The incident screen feeds the classifier the day count and the illness type.
{
  const incSrc = readFileSync(new URL('../app/safety-incidents.tsx', import.meta.url), 'utf8');
  ok('incident form passes daysRestricted + oshaIllnessType into the classifier',
    /const classInput = useMemo\(\(\) => \(\{\s*type, treatment,\s*daysAway: Number\(daysAway\) \|\| 0,\s*daysRestricted: daysRestrictedNum,\s*restrictedDuty: effectiveRestricted,\s*lostConsciousness, fatality, oshaIllnessType,/.test(incSrc),
    'the live verdict and stored flag ignore the day count again — "5 days restricted" reads "no restriction".');
  ok('the stored flag and the live verdict read the same input',
    incSrc.includes('isOshaRecordable(classInput)') && incSrc.includes('describeRecordability(classInput)'),
    'two derivations of one determination drift.');
  ok('incident type is labelled Injury or illness',
    incSrc.includes("{ value: 'injury', label: 'Injury or illness' }"),
    'a bare "Injury" label sends illnesses to Environ.');
}

// ─────────────────────────────────────────────────────────────────────────
// DFR-OSHA-BRIDGE — the daily report's Safety block feeding the register.
//
// WHAT THIS PROTECTS. An injury written on the daily field report used to reach
// exactly one consumer in the whole repo (utils/oacEngine.ts, a meeting agenda),
// so months later when the 300 was pulled for an insurance renewal the case was
// simply absent. app/daily-report.tsx now builds a SafetyIncident on every save
// through buildSafetyIncidentFromDfr. The join below is where that can silently
// go wrong — the two screens speak different incident vocabularies and the two
// severity enums share exactly one literal — so it is run for real here.
// ─────────────────────────────────────────────────────────────────────────

console.log('\nDFR → safety register bridge:');

// The severity translation. A severity→severity COPY is the bug: the enums
// overlap only on 'critical', so a copy loses 'near_miss'/'minor'/'moderate'/
// 'major' entirely and writes an off-enum value the DB CHECK constraint rejects.
expect('near_miss severity → low',  DFR_SEVERITY_TO_REGISTER_SEVERITY.near_miss, 'low');
expect('minor → low',               DFR_SEVERITY_TO_REGISTER_SEVERITY.minor,     'low');
expect('moderate → medium',         DFR_SEVERITY_TO_REGISTER_SEVERITY.moderate,  'medium');
expect('major → high',              DFR_SEVERITY_TO_REGISTER_SEVERITY.major,     'high');
expect('critical → critical',       DFR_SEVERITY_TO_REGISTER_SEVERITY.critical,  'critical');
// Every translated value must be one the register (and its CHECK constraint)
// actually accepts — catches a future enum edit on either side.
const REGISTER_SEVERITIES = ['low', 'medium', 'high', 'critical'];
expect('every mapped severity is a register severity',
  Object.values(DFR_SEVERITY_TO_REGISTER_SEVERITY).every(v => REGISTER_SEVERITIES.includes(v)), true);

// The displayed determination can never disagree with the stored boolean.
// describeRecordability takes `recordable` FROM isOshaRecordable; walking the
// whole input matrix is what stops someone "simplifying" that into a second
// derivation that drifts.
const TYPES: IncidentClassInput['type'][] = ['injury', 'near_miss', 'property', 'environmental'];
const TREATMENTS: IncidentClassInput['treatment'][] = ['none', 'first_aid', 'medical_beyond_first_aid'];
let matrixMismatch = 0;
let emptyReason = 0;
for (const type of TYPES) {
  for (const treatment of TREATMENTS) {
    for (const daysAway of [0, 4]) {
      for (const restrictedDuty of [false, true]) {
       for (const daysRestricted of [0, 5]) {
        for (const oshaIllnessType of [undefined, 'injury', 'respiratory'] as const) {
        for (const lostConsciousness of [false, true]) {
          for (const fatality of [false, true]) {
            const input: IncidentClassInput = { type, treatment, daysAway, restrictedDuty, daysRestricted, oshaIllnessType, lostConsciousness, fatality };
            const v = describeRecordability(input);
            if (v.recordable !== isOshaRecordable(input)) matrixMismatch++;
            if (!v.reason.trim()) emptyReason++;
            // The sentence has to agree with the verdict, or the chip says
            // "Not recordable" over a case the 300 will list.
            if (v.recordable !== v.reason.startsWith('Recordable')) matrixMismatch++;
            // "no restriction" may never be printed over a counted day.
            if (daysRestricted > 0 && v.reason.includes('no restriction')) matrixMismatch++;
          }
        }
        }
       }
      }
    }
  }
}
expect('verdict matches isOshaRecordable across all 1728 inputs', matrixMismatch, 0);
expect('every input gets a reason', emptyReason, 0);

// The reason names the criterion that actually fired, in 1904 order.
expect('fatality reason',   describeRecordability(base({ fatality: true })).reason, 'Recordable — fatality.');
expect('days-away reason',  describeRecordability(base({ daysAway: 2 })).reason, 'Recordable — days away from work.');
expect('restriction reason', describeRecordability(base({ restrictedDuty: true })).reason,
  'Recordable — restricted work or job transfer.');
expect('medical reason',    describeRecordability(base({ treatment: 'medical_beyond_first_aid' })).reason,
  'Recordable — medical treatment beyond first aid.');
expect('near-miss reason names the type, not the severity',
  describeRecordability(base({ type: 'near_miss', treatment: 'none' })).reason,
  'Not recordable — near miss, no injury.');

// The derived case id. It has to be STABLE (re-saving a report updates its case
// instead of filing a duplicate every tap), DISTINCT from the report id (they
// are different rows in different tables), COLLISION-FREE (two reports must
// never share one OSHA case), and a legal UUID (safety_incidents.id is a UUID
// column, so a non-UUID would make every insert fail on sync).
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const rA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const rB = '7c9e6679-7425-40de-944b-e07fc1f90ae8'; // differs in the last nibble only
expect('case id is stable across calls', safetyIncidentIdForReport(rA), safetyIncidentIdForReport(rA));
expect('case id is uuid-shaped', UUID_SHAPE.test(safetyIncidentIdForReport(rA)), true);
expect('case id is not the report id', safetyIncidentIdForReport(rA) !== rA, true);
expect('near-identical report ids do not collide',
  safetyIncidentIdForReport(rA) !== safetyIncidentIdForReport(rB), true);
expect('non-uuid report id still yields a uuid',
  UUID_SHAPE.test(safetyIncidentIdForReport('report-9')), true);
expect('non-uuid ids are stable too',
  safetyIncidentIdForReport('report-9'), safetyIncidentIdForReport('report-9'));
expect('non-uuid ids do not collide either',
  safetyIncidentIdForReport('report-9') !== safetyIncidentIdForReport('report-8'), true);
// 500 distinct report ids → 500 distinct case ids. A hash-based derivation with
// a weak fold would start colliding here; the nibble XOR is a bijection.
const seen = new Set<string>();
for (let i = 0; i < 500; i++) {
  seen.add(safetyIncidentIdForReport(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`));
}
expect('500 report ids → 500 distinct case ids', seen.size, 500);

// The full join, run for real.
const dfrCase = buildSafetyIncidentFromDfr({
  reportId: rA,
  projectId: 'proj-1',
  occurredOn: '2026-09-14',
  severity: 'major',
  description: '  Cut hand on rebar tie  ',
  peopleInvolved: 'Jose R, foreman',
  correctiveAction: 'Toolbox talk on rebar caps',
  reportedBy: '  Mike T  ',
  location: '1400 Foothill Dr',
  photoUrls: ['https://x/1.jpg'],
  classification: { type: 'injury', treatment: 'medical_beyond_first_aid', daysAway: 0, restrictedDuty: false, lostConsciousness: false, fatality: false },
  daysRestricted: 0,
  author: 'Mike T',
  now: '2026-09-15T01:02:03.000Z',
});
expect('case id derives from the report', dfrCase.id, safetyIncidentIdForReport(rA));
expect('type comes from the classifier input, never from severity', dfrCase.type, 'injury');
expect('major → high (translated, not copied)', dfrCase.severity, 'high');
// The DAY THE WORK HAPPENED, not the day he typed it. A backfilled report that
// stamped `now` would file the case in the wrong month — and in January, the
// wrong OSHA log year, where the 300 screen's year filter drops it entirely.
expect('occurredAt is the report date, not now', dfrCase.occurredAt, '2026-09-14');
expect('occurredAt year is what the 300 filters on', dfrCase.occurredAt.slice(0, 4), '2026');
expect('description trimmed', dfrCase.description, 'Cut hand on rebar tie');
// Names stay one person: splitting on the comma would put "foreman" in the
// employee-name column of a second 300 row.
expect('people wrapped as one person', dfrCase.peopleInvolved.length, 1);
expect('person name is the typed string', dfrCase.peopleInvolved[0].name, 'Jose R, foreman');
expect('corrective action becomes one open action', dfrCase.correctiveActions,
  [{ action: 'Toolbox talk on rebar caps', owner: 'Mike T', done: false }]);
expect('recordable computed, not self-certified', dfrCase.oshaRecordable, true);
expect('photos carried onto the case', dfrCase.photoUrls, ['https://x/1.jpg']);
expect('location falls back to the project site', dfrCase.location, '1400 Foothill Dr');
expect('new case opens', dfrCase.status, 'open');

// A report with no names / no corrective action must not invent either.
const sparse = buildSafetyIncidentFromDfr({
  reportId: rB, projectId: 'p', occurredOn: '2026-01-02', description: 'Trip hazard',
  peopleInvolved: '   ', correctiveAction: '  ', reportedBy: '', location: '',
  photoUrls: [], daysRestricted: 0, author: 'Sam', now: '2026-01-02T00:00:00.000Z',
  classification: { type: 'near_miss', treatment: 'none', daysAway: 0, restrictedDuty: false, lostConsciousness: false, fatality: false },
});
expect('no names → no people', sparse.peopleInvolved, []);
expect('no action → no corrective actions', sparse.correctiveActions, []);
expect('reporter falls back to the author', sparse.reportedBy, 'Sam');
expect('missing DFR severity defaults to low', sparse.severity, 'low');
expect('a near miss is not recordable', sparse.oshaRecordable, false);
// A case the safety manager already moved on must not be snapped back to 'open'
// (or re-dated) because the super fixed a typo in the report an hour later.
const resaved = buildSafetyIncidentFromDfr({
  reportId: rA, projectId: 'proj-1', occurredOn: '2026-09-14', severity: 'major',
  description: 'Cut hand on rebar tie', peopleInvolved: 'Jose R', correctiveAction: '',
  reportedBy: 'Mike T', location: '1400 Foothill Dr', photoUrls: [], daysRestricted: 3,
  classification: { type: 'injury', treatment: 'first_aid', daysAway: 0, restrictedDuty: true, lostConsciousness: false, fatality: false },
  author: 'Mike T', now: '2026-09-16T00:00:00.000Z',
  existingCreatedAt: '2026-09-14T22:00:00.000Z', existingStatus: 'investigating',
});
expect('re-save keeps the same case id', resaved.id, dfrCase.id);
expect('re-save preserves createdAt', resaved.createdAt, '2026-09-14T22:00:00.000Z');
expect('re-save preserves an advanced status', resaved.status, 'investigating');
expect('re-save bumps updatedAt', resaved.updatedAt, '2026-09-16T00:00:00.000Z');
expect('daysRestricted (300 col L) is carried', resaved.daysRestricted, 3);
expect('restricted duty makes it recordable', resaved.oshaRecordable, true);
// Audit round 2 #1 on the DFR path: the report's classification object carries
// no day count, so the builder must fold daysRestricted in itself.
const lightDuty = buildSafetyIncidentFromDfr({
  reportId: '11111111-2222-4333-8444-555555555555', projectId: 'p', occurredOn: '2026-09-15', severity: 'minor',
  description: 'Strained back, light duty', peopleInvolved: 'Sam', correctiveAction: '', reportedBy: 'Mike',
  location: '', photoUrls: [], daysRestricted: 4, author: 'Mike', now: '2026-09-15T20:00:00.000Z',
  classification: { type: 'injury', treatment: 'first_aid', daysAway: 0, restrictedDuty: false, lostConsciousness: false, fatality: false },
});
expect('DFR: 4 restricted days with the toggle off → recordable', lightDuty.oshaRecordable, true);
expect('DFR: …stored with restrictedDuty agreeing with the day count', lightDuty.restrictedDuty, true);

// End to end: a DFR-built case must survive buildOsha300Log, which is the whole
// point — it is the 300 that comes up short when this join is missing.
const fromDfrLog = buildOsha300Log([dfrCase], '2026');
expect('DFR case reaches the 300 log', fromDfrLog.length, 1);
expect('300 row carries the report date', fromDfrLog[0].dateOfIncident, '2026-09-14');
expect('300 row names the person from the DFR', fromDfrLog[0].employeeName, 'Jose R, foreman');
expect('a non-recordable DFR case stays off the 300', buildOsha300Log([sparse], '2026').length, 0);

// ─────────────────────────────────────────────────────────────────────────
// DFR-WEATHER-DAY — the report's weather must belong to the report's day.
//
// WHAT THIS PROTECTS. The DFR fetched `current_condition` (the sky right now)
// and wrote it with isManual:false — the "this was fetched" flag — without ever
// looking at the report's date, so a Monday report filed Tuesday carried
// Tuesday's sky as evidence. There is no historical-weather source in this repo,
// so the only honest answer for a past day is to say so.
// ─────────────────────────────────────────────────────────────────────────

console.log('\nDFR weather day-binding:');

expect('same day → live read allowed', canReadLiveWeatherFor('2026-09-16', '2026-09-16'), true);
expect('yesterday → refused', canReadLiveWeatherFor('2026-09-15', '2026-09-16'), false);
expect('tomorrow → refused (a forecast is not an observation)',
  canReadLiveWeatherFor('2026-09-17', '2026-09-16'), false);
// A day the screen could not parse must fail CLOSED. Falling through to "fetch
// anyway" is the original bug.
expect('null report day → refused', canReadLiveWeatherFor(null, '2026-09-16'), false);
expect('empty report day → refused', canReadLiveWeatherFor('', '2026-09-16'), false);
expect('missing today → refused', canReadLiveWeatherFor('2026-09-16', ''), false);
// Day STRINGS, never instants: two moments on the same local day are the same
// day, and 11pm Monday vs 1am Tuesday are not — an instant comparison gets both
// backwards near midnight.
expect('a calendar day is not a prefix match', canReadLiveWeatherFor('2026-09-1', '2026-09-16'), false);

expect('the backfill notice names the day', backfilledWeatherNotice('Mon, Sep 14').includes('Mon, Sep 14'), true);
expect('the backfill notice says what to do instead',
  backfilledWeatherNotice('Mon, Sep 14').toLowerCase().includes('type what you saw'), true);

// The provenance chip. isManual was WRITE-ONLY before this — nothing read it —
// so these are the only strings standing between a reader and three bare values.
expect('empty block says nothing',
  weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: false, location: 'Henderson, NV' }), '');
expect('typed weather says typed',
  weatherProvenanceLine({ isManual: true, reportIsToday: true, hasValue: true, location: 'Henderson, NV' }),
  'Typed by hand.');
expect('a live read names the time and the place',
  weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: true, location: 'Henderson, NV', readAtLabel: '4:31 PM' }),
  'Read live at 4:31 PM for Henderson, NV.');
// project.location legitimately defaults to the literal "United States", and the
// chip must print it rather than hide it — that string IS the second falseness.
expect('the queried location is printed verbatim, warts and all',
  weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: true, location: 'United States', readAtLabel: '4:31 PM' })
    .includes('United States'), true);
expect('a restored reading does not invent a read time',
  weatherProvenanceLine({ isManual: false, reportIsToday: true, hasValue: true, location: 'Henderson, NV' }),
  'Read live and saved with this report.');
// A record saved before this guard shipped can be a wrong-day reading. It gets
// the caveat, not a confident claim.
expect('a fetched reading on a past day is caveated, not asserted',
  weatherProvenanceLine({ isManual: false, reportIsToday: false, hasValue: true, location: 'Henderson, NV' })
    .includes('cannot read a past day'), true);

// ─────────────────────────────────────────────────────────────────────────
// The wiring, pinned textually.
//
// Everything above proves the pure functions are right. None of it proves the
// SCREEN calls them — and a correct classifier nobody invokes is exactly the
// state this fix found the repo in (isOshaRecordable had been sitting two
// imports away from the DFR's self-certified checkbox since Wave A).
// app/daily-report.tsx is an Expo Router route and cannot be imported under
// bun, so these are source assertions. Coarse on purpose: they pin the JOIN
// existing, not the phrasing around it.
// ─────────────────────────────────────────────────────────────────────────

console.log('\nDFR screen wiring:');

const dfrSrc = readFileSync(new URL('../app/daily-report.tsx', import.meta.url), 'utf8');

ok('the DFR builds a register case from the incident block',
  dfrSrc.includes('buildSafetyIncidentFromDfr({'),
  'app/daily-report.tsx no longer calls buildSafetyIncidentFromDfr — an injury written on the ' +
  'report reaches only utils/oacEngine.ts again, and the OSHA 300 comes up short months later.');
ok('the case is actually written through SafetyContext',
  /addIncident\(caseRecord\)/.test(dfrSrc) && /updateIncident\(caseRecord\.id, caseRecord\)/.test(dfrSrc),
  'the built case is no longer handed to addIncident/updateIncident, so it never leaves the screen.');
ok('the case write is keyed on hasIncident, not on Send',
  // dfr-screen #89 (wave 3) adds `&& !caseDeletedInLog` — a case the owner
  // deleted in Incidents is not re-filed — which is still keyed on hasIncident.
  // wave 4 #122 (dfr) adds `&& !caseNotYoursReason` — another author's case
  // this seat cannot see is never blind-inserted; still keyed on hasIncident.
  /if \(incident\.hasIncident && projectId( && !caseDeletedInLog)?( && !caseNotYoursReason)?\)/.test(dfrSrc),
  'a draft daily report is still a contemporaneous record of an injury; gating the case on a ' +
  'sent report is how it goes missing.');
ok('the OSHA determination is no longer a self-ticked checkbox',
  !dfrSrc.includes('oshaRecordable: !p.oshaRecordable'),
  'the "OSHA recordable" checkbox is back. That determination turns on days away, restricted ' +
  'duty, loss of consciousness and medical-beyond-first-aid — describeRecordability answers it.');
ok('the DFR captures the incident TYPE',
  dfrSrc.includes("'injury', 'near_miss', 'property', 'environmental'"),
  'isOshaRecordable branches on type FIRST. Without the picker the type is inferred, and a ' +
  'genuine near-miss becomes a candidate 300 case.');
ok('leaving the injury type clears the medical answers it hides',
  /Leaving injury clears the medical answers with it/.test(dfrSrc)
    && /\.\.\.\(t === 'injury' \? null : \{/.test(dfrSrc),
  'a stale fatality:true from a mis-tap short-circuits the classifier into "Recordable — ' +
  'fatality" on a property-damage event, with no control left on screen to untick it.');
ok('the stored oshaRecordable is the computed verdict',
  dfrSrc.includes('oshaRecordable: recordability.recordable'),
  'the report is storing something other than the classifier output.');

ok('the weather fetch is bound to the report date',
  dfrSrc.includes('canReadLiveWeatherFor(requestedDay, todayCalendarDay())'),
  'fetchWeather no longer checks whether the report is FOR today, so a backfilled report ' +
  "carries this morning's sky stamped as fetched.");
ok('the day guard sits BEFORE the network read, not after',
  dfrSrc.indexOf('canReadLiveWeatherFor(requestedDay') < dfrSrc.indexOf('https://wttr.in/'),
  'the guard has to stop the request, not filter the answer.');
ok('the guard compares calendar days, not instants',
  dfrSrc.includes('const requestedDay = calendarDayOf(reportDate);'),
  'reportDate is an instant. Comparing instants misclassifies an evening-filed report near ' +
  'midnight, which re-introduces the wrong-day weather this guard exists to stop.');
ok('an in-flight read re-checks the day it was asked for',
  dfrSrc.includes('calendarDayOf(reportDateRef.current) === requestedDay'),
  'the date can move while the request is in flight (the mount fetch fires before the super ' +
  'has touched anything, and backfilling is the first thing he does).');
ok('the Auto-fetch button is disabled on a backfilled report',
  /disabled=\{weatherLoading \|\| !reportIsToday\}/.test(dfrSrc),
  'a live button on a past day is a silent wrong answer waiting to be tapped.');
ok('and it says why',
  dfrSrc.includes('backfilledWeatherNotice(reportDayLabel)'),
  'this app\'s rule is that a blocked control names its reason.');
ok('the weather block shows its provenance',
  dfrSrc.includes('weatherProvenanceLine({'),
  'isManual is write-only without this — flipping the flag changes nothing anyone can see.');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
