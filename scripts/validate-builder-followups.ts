// scripts/validate-builder-followups.ts — pure-fn validator for the
// adaptive Schedule Builder follow-up generator. Tests validateFollowupResponse
// and the scope-length gate without making any network calls.

import { validateFollowupResponse } from '../utils/copilot/scheduleBuilder/followupsValidator';

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

// ----- summary ---------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
