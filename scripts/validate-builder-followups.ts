// scripts/validate-builder-followups.ts — pure-fn validator for the
// adaptive Schedule Builder follow-up generator. Tests validateFollowupResponse
// and the scope-length gate without making any network calls.

import { validateFollowupResponse, coerceFollowupAnswer } from '../utils/copilot/scheduleBuilder/followupsValidator';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

// ----- valid responses -------------------------------------------------

ok('0 follow-ups is valid', validateFollowupResponse({ followups: [] }).valid === true);

ok('1 valid text follow-up passes', validateFollowupResponse({
  followups: [{
    field: 'longLead',
    eyebrow: 'PROCUREMENT',
    question: 'Custom cabinets — what is the lead time?',
    subtext: 'Lead time sets when install can start.',
    kind: 'text',
    skipLabel: 'Skip',
  }],
}).valid === true);

ok('1 valid choice follow-up passes', validateFollowupResponse({
  followups: [{
    field: 'occupancy',
    eyebrow: 'SITE',
    question: 'Will occupants be present during framing?',
    subtext: 'Occupied work reshapes the sequence.',
    kind: 'choice',
    skipLabel: 'Skip',
    choices: [
      { label: 'Occupied — phase the work', value: 'occupied' },
      { label: 'Vacant', value: 'vacant' },
    ],
  }],
}).valid === true);

ok('2 valid follow-ups passes', validateFollowupResponse({
  followups: [
    { field: 'knownRisks', eyebrow: 'RISKS', question: 'Is the structural beam permitted?', subtext: '', kind: 'text', skipLabel: 'Skip' },
    { field: 'longLead', eyebrow: 'PROCUREMENT', question: 'Windows lead time?', subtext: '', kind: 'text', skipLabel: 'Skip' },
  ],
}).valid === true);

ok('coercedCount matches item count', validateFollowupResponse({
  followups: [
    { field: 'crewSize', eyebrow: 'CREW', question: 'How many on demo?', subtext: '', kind: 'text', skipLabel: 'Skip' },
  ],
}).coercedCount === 1);

// ----- invalid responses -----------------------------------------------

ok('not an object → invalid', validateFollowupResponse(null).valid === false);
ok('missing followups array → invalid', validateFollowupResponse({ items: [] }).valid === false);
ok('disallowed field → invalid', validateFollowupResponse({
  followups: [{ field: 'startDate', eyebrow: 'START', question: 'When?', subtext: '', kind: 'text', skipLabel: 'Skip' }],
}).valid === false);

ok('too many follow-ups → errors includes count msg', (() => {
  const r = validateFollowupResponse({
    followups: [
      { field: 'longLead', eyebrow: 'E', question: 'Q1', subtext: '', kind: 'text', skipLabel: 'Skip' },
      { field: 'knownRisks', eyebrow: 'E', question: 'Q2', subtext: '', kind: 'text', skipLabel: 'Skip' },
      { field: 'buffer', eyebrow: 'E', question: 'Q3', subtext: '', kind: 'text', skipLabel: 'Skip' },
    ],
  });
  return r.errors.some(e => e.includes('3'));
})());

ok('missing question string → invalid', validateFollowupResponse({
  followups: [{ field: 'longLead', eyebrow: 'E', question: '', subtext: '', kind: 'text', skipLabel: 'Skip' }],
}).valid === false);

ok('bad kind → invalid', validateFollowupResponse({
  followups: [{ field: 'longLead', eyebrow: 'E', question: 'Q', subtext: '', kind: 'date', skipLabel: 'Skip' }],
}).valid === false);

ok('choice kind with only 1 option → invalid', validateFollowupResponse({
  followups: [{
    field: 'occupancy', eyebrow: 'E', question: 'Q', subtext: '', kind: 'choice', skipLabel: 'Skip',
    choices: [{ label: 'One', value: 'a' }],
  }],
}).valid === false);

ok('scope field not in allowed list → invalid', validateFollowupResponse({
  followups: [{ field: 'scope', eyebrow: 'E', question: 'Q', subtext: '', kind: 'text', skipLabel: 'Skip' }],
}).valid === false);

ok('deadline field not in allowed list → invalid', validateFollowupResponse({
  followups: [{ field: 'deadline', eyebrow: 'E', question: 'Q', subtext: '', kind: 'text', skipLabel: 'Skip' }],
}).valid === false);

// ----- per-field answer coercion (dynamic follow-up answers) ------------
// Dynamic follow-ups are only kind text/choice, so typed fields
// (occupancy/buffer enums, crewSize/workDaysPerWeek numbers) need coercion
// before the answer enters ScheduleBuilderAnswers. ok:false = treat as SKIP.

function coerces(field: Parameters<typeof coerceFollowupAnswer>[0], raw: unknown, expected: string | number): boolean {
  const r = coerceFollowupAnswer(field, raw);
  return r.ok && r.value === expected;
}
function drops(field: Parameters<typeof coerceFollowupAnswer>[0], raw: unknown): boolean {
  return coerceFollowupAnswer(field, raw).ok === false;
}

ok("occupancy 'Yes, occupied' → 'occupied'", coerces('occupancy', 'Yes, occupied', 'occupied'));
ok("occupancy 'Family staying in the home' → 'occupied'", coerces('occupancy', 'Family staying in the home', 'occupied'));
ok("occupancy 'Owners staying' → 'occupied'", coerces('occupancy', 'Owners staying', 'occupied'));
ok("occupancy 'unoccupied' → 'vacant' (negative form wins over substring)", coerces('occupancy', 'unoccupied', 'vacant'));
ok("occupancy 'Empty' → 'vacant'", coerces('occupancy', 'Empty', 'vacant'));
ok("occupancy canonical 'vacant' passes through", coerces('occupancy', 'vacant', 'vacant'));
ok("occupancy unrecognized → dropped", drops('occupancy', 'banana'));
ok('occupancy non-string → dropped', drops('occupancy', 7));

ok("workDaysPerWeek '6 days' → 6", coerces('workDaysPerWeek', '6 days', 6));
ok("workDaysPerWeek '5 or 6' → 5 (first number wins, never clamped)", coerces('workDaysPerWeek', '5 or 6', 5));
ok('workDaysPerWeek numeric 7 passes through', coerces('workDaysPerWeek', 7, 7));
ok("workDaysPerWeek '12' → dropped (outside 1–7, NOT clamped to 7)", drops('workDaysPerWeek', '12'));
ok("workDaysPerWeek '0' → dropped", drops('workDaysPerWeek', '0'));
ok("workDaysPerWeek 'every day' → dropped (no number)", drops('workDaysPerWeek', 'every day'));

ok("crewSize '8 guys' → 8", coerces('crewSize', '8 guys', 8));
ok("crewSize '4' → 4", coerces('crewSize', '4', 4));
ok("crewSize 'a few' → dropped", drops('crewSize', 'a few'));
ok('crewSize 0 → dropped', drops('crewSize', 0));
ok('crewSize 1200 → dropped (implausible)', drops('crewSize', 1200));

ok("buffer 'Tight' → 'tight'", coerces('buffer', 'Tight', 'tight'));
ok("buffer 'padded — leave a cushion' → 'padded'", coerces('buffer', 'padded — leave a cushion', 'padded'));
ok("buffer 'standard' → 'standard'", coerces('buffer', 'standard', 'standard'));
ok("buffer unrecognized → dropped", drops('buffer', 'whatever'));

ok('longLead free text passes through trimmed', coerces('longLead', '  custom cabinets (8 wk) ', 'custom cabinets (8 wk)'));
ok('knownRisks empty string → dropped', drops('knownRisks', '   '));
ok('non-followup field → dropped', drops('scope', 'kitchen remodel'));

// ----- summary ---------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
