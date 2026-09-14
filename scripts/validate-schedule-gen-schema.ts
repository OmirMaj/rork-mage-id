import { autoScheduleTaskSchema, normalizeGeneratedTask, SCHEDULE_PHASES } from '../utils/scheduleGenSchema';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule generation schema validation:');

const full = {
  id: 't1', name: 'Framing', phase: 'Framing', duration: 5,
  predecessorIds: ['t0'], isMilestone: false, isCriticalPath: true,
  crewSize: 4, wbs: '3.1', rationale: 'Framing before drywall; 5 days from 1,800 SF at crew rate.',
  assumption: false, linkedCategories: ['lumber'],
};
expect('accepts a full task with rationale', autoScheduleTaskSchema.safeParse(full).success, true);

const noRationale = { ...full } as any; delete noRationale.rationale;
expect('rejects a task missing rationale', autoScheduleTaskSchema.safeParse(noRationale).success, false);

const noAssumption = { ...full } as any; delete noAssumption.assumption;
expect('assumption is optional', autoScheduleTaskSchema.safeParse(noAssumption).success, true);

const normalized = normalizeGeneratedTask({ id: 't2', name: 'Roofing', phase: 'Roofing', duration: 3, predecessorIds: [] }, 1);
expect('normalize defaults rationale to ""', normalized.rationale, '');
expect('normalize defaults assumption to true when no basis given', normalized.assumption, true);
expect('normalize defaults crewSize to 2 when absent', normalized.crewSize, 2);

// crewSize clamp path (the actual Math.min/max, not the default branch)
expect('normalize clamps crewSize above 8 → 8', normalizeGeneratedTask({ crewSize: 20 }, 0).crewSize, 8);
expect('normalize clamps crewSize below 1 → 1', normalizeGeneratedTask({ crewSize: 0 }, 0).crewSize, 1);
expect('normalize rounds fractional crewSize', normalizeGeneratedTask({ crewSize: 3.4 }, 0).crewSize, 3);

// ── PHASE RESOLUTION ───────────────────────────────────────────────────────
// There used to be an assertion here reading:
//
//   expect('normalize coerces unknown phase → General', ... .phase, 'General')
//
// It passed for as long as the defect existed, which is exactly what made it
// dangerous: the test was not protecting behaviour, it was PINNING a bug. On a
// commercial fit-out the model correctly answers "Commissioning" and the app
// threw the word away. The assertions below replace it with the rule that was
// actually wanted — a phase the app does not recognise is KEPT and FLAGGED,
// and 'General' is reserved for a phase that was never supplied.
// NOTE — the phase used here MUST NOT be one of the ten just added to the
// canon. The first draft of this assertion used 'Commissioning', which by then
// was canonical, so it passed even with the old flattening line restored: it
// was asserting that a known phase survives, which was never in doubt. Use a
// word the app genuinely does not know.
expect('an unrecognised phase is KEPT, not flattened', normalizeGeneratedTask({ phase: 'Tenant Signage' }, 0).phase, 'Tenant Signage');
expect('  ...and flagged as coined', normalizeGeneratedTask({ phase: 'Tenant Signage' }, 0).coinedPhase, true);
expect('a phase now IN the canon is not flagged', normalizeGeneratedTask({ phase: 'Commissioning' }, 0).coinedPhase, false);
expect('a canonical phase is not flagged', normalizeGeneratedTask({ phase: 'Framing' }, 0).coinedPhase, false);
expect('case differences match the canon rather than coining', normalizeGeneratedTask({ phase: 'framing' }, 0).phase, 'Framing');
expect('  ...and are not flagged', normalizeGeneratedTask({ phase: 'FRAMING' }, 0).coinedPhase, false);
expect('surrounding space is trimmed', normalizeGeneratedTask({ phase: '  Drywall  ' }, 0).phase, 'Drywall');
expect('inner whitespace is collapsed', normalizeGeneratedTask({ phase: 'Above-Ceiling   Inspection' }, 0).phase, 'Above-Ceiling Inspection');

// 'General' survives ONLY for an absent phase — and absent is not coined.
expect('a missing phase still falls back to General', normalizeGeneratedTask({ id: 'x' }, 0).phase, 'General');
expect('  ...and is NOT reported as coined', normalizeGeneratedTask({ id: 'x' }, 0).coinedPhase, false);
expect('an empty-string phase falls back to General', normalizeGeneratedTask({ phase: '   ' }, 0).phase, 'General');
expect('a non-string phase falls back to General', normalizeGeneratedTask({ phase: 42 as any }, 0).phase, 'General');
expect('a sentence in the phase field is refused, not adopted as a group header',
  normalizeGeneratedTask({ phase: 'This task covers the commissioning of the rooftop units and associated controls' }, 0).phase, 'General');

// The commercial phases the fit-out sequence needs must actually be canonical,
// or the generator is still being told a residential-only vocabulary.
for (const p of ['Abatement', 'Structure', 'Building Envelope', 'Fire Protection',
                 'Low Voltage', 'Above-Ceiling Inspection', 'Ceilings', 'Millwork',
                 'Commissioning', 'Closeout']) {
  expect(`"${p}" is a canonical phase`, normalizeGeneratedTask({ phase: p }, 0).coinedPhase, false);
}

// Review groups phases by SCHEDULE_PHASES INDEX, so order is behaviour, not
// cosmetics — closeout must not sort above foundation.
const ORDER = SCHEDULE_PHASES as readonly string[];
const idx = (p: string) => ORDER.indexOf(p);
expect('demo precedes foundation', idx('Demo') < idx('Foundation'), true);
expect('abatement precedes structure', idx('Abatement') < idx('Structure'), true);
expect('rough-in precedes above-ceiling inspection', idx('MEP') < idx('Above-Ceiling Inspection'), true);
expect('above-ceiling inspection precedes ceilings', idx('Above-Ceiling Inspection') < idx('Ceilings'), true);
expect('ceilings precede finishes', idx('Ceilings') < idx('Finishes'), true);
expect('commissioning precedes closeout', idx('Commissioning') < idx('Closeout'), true);
expect('closeout is last before the General catch-all', idx('Closeout'), ORDER.length - 2);
expect('General remains the final entry', ORDER[ORDER.length - 1], 'General');

// other lenient defaults
expect('normalize defaults missing duration → 3', normalizeGeneratedTask({ id: 'x' }, 0).duration, 3);
expect('normalize coerces non-array predecessorIds → []', normalizeGeneratedTask({ predecessorIds: 'nope' as any }, 0).predecessorIds, []);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
