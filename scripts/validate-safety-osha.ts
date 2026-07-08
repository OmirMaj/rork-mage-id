// validate-safety-osha.ts — unit tests for utils/safety/osha.ts (Wave A,
// isOshaRecordable classification) AND utils/safety/oshaLog.ts (Wave B, OSHA
// Form 300 row assembly + serializers). Both suites share one file/script
// (test:safety-osha) so ship-check covers classification and log assembly.
// Run via: bun run scripts/validate-safety-osha.ts

import { isOshaRecordable, type IncidentClassInput } from '../utils/safety/osha';
import { buildOsha300Log, oshaRowFromIncident, osha300ToCsv, csvCell } from '../utils/safety/oshaLog';
import type { SafetyIncident } from '../types';

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

const incidents: SafetyIncident[] = [
  inc({ id: 'i1', oshaRecordable: true,  occurredAt: '2026-03-02', severity: 'high',     type: 'injury',        location: 'Level 2', description: 'Fall from ladder', peopleInvolved: [{ name: 'Jose R', role: 'Laborer', injuryDescription: 'Sprained ankle' }] }),
  inc({ id: 'i2', oshaRecordable: false, occurredAt: '2026-03-05', severity: 'low',      type: 'near_miss',     location: 'Yard',    description: 'Dropped tool',    peopleInvolved: [] }),
  inc({ id: 'i3', oshaRecordable: true,  occurredAt: '2026-01-15', severity: 'critical', type: 'injury',        location: 'Roof',    description: 'Fatal fall',      peopleInvolved: [{ name: 'Sam T', role: 'Roofer' }] }),
  inc({ id: 'i4', oshaRecordable: true,  occurredAt: '2026-04-01', severity: 'medium',   type: 'environmental', location: 'Basement',description: 'Chemical exposure',peopleInvolved: [] }),
];

const log = buildOsha300Log(incidents);
expect('only recordable included',        log.length, 3);
expect('sorted oldest first (Jan)',       log[0].dateOfIncident, '2026-01-15');
expect('sorted (Mar second)',             log[1].dateOfIncident, '2026-03-02');
expect('sorted (Apr last)',               log[2].dateOfIncident, '2026-04-01');
expect('case numbers sequential',         [log[0].caseNo, log[1].caseNo, log[2].caseNo], ['1','2','3']);
expect('critical → death class',          log[0].classification, 'death');
expect('high → days_away class',          log[1].classification, 'days_away');
expect('medium → restricted class',       log[2].classification, 'restricted');
expect('employee name from person',       log[1].employeeName, 'Jose R');
expect('job title from role',             log[1].jobTitle, 'Laborer');
expect('desc prefers injuryDescription',  log[1].description, 'Sprained ankle');
expect('no person → dash name',           log[2].employeeName, '—');
expect('no person → dash title',          log[2].jobTitle, '—');
expect('environmental → respiratory',     log[2].illnessType, 'respiratory');
expect('injury → injury illness type',    log[1].illnessType, 'injury');
expect('days away default 0',             log[0].daysAway, 0);

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
