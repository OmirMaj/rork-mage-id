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
import { buildOsha300Log, oshaRowFromIncident, osha300ToCsv, csvCell } from '../utils/safety/oshaLog';
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
  // restricted-duty chemical case with an explicit respiratory illness classification.
  inc({ id: 'i4', oshaRecordable: true,  occurredAt: '2026-04-01', severity: 'critical', type: 'environmental', location: 'Basement',description: 'Chemical exposure',daysAway: 0, restrictedDuty: true, daysRestricted: 5, fatality: false, oshaIllnessType: 'respiratory', peopleInvolved: [] }),
  // prior-year recordable — must be excluded from a 2026 log.
  inc({ id: 'i5', oshaRecordable: true,  occurredAt: '2025-11-01', severity: 'high',     type: 'injury',        location: 'Level 1', description: 'Prior-year injury', daysAway: 2, fatality: false, peopleInvolved: [] }),
];

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
expect('restrictedDuty → restricted',     log[2].classification, 'restricted');
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
        for (const lostConsciousness of [false, true]) {
          for (const fatality of [false, true]) {
            const input: IncidentClassInput = { type, treatment, daysAway, restrictedDuty, lostConsciousness, fatality };
            const v = describeRecordability(input);
            if (v.recordable !== isOshaRecordable(input)) matrixMismatch++;
            if (!v.reason.trim()) emptyReason++;
            // The sentence has to agree with the verdict, or the chip says
            // "Not recordable" over a case the 300 will list.
            if (v.recordable !== v.reason.startsWith('Recordable')) matrixMismatch++;
          }
        }
      }
    }
  }
}
expect('verdict matches isOshaRecordable across all 288 inputs', matrixMismatch, 0);
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
  /if \(incident\.hasIncident && projectId\)/.test(dfrSrc),
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
