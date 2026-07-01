import { evaluateLimit, FAIL_OPEN_RESULT } from '../utils/aiRateLimiterCore';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nactivation gating validation:');

// voiceCapture — free, fast tier, lifetime cap 3
expect('voiceCapture free 0/3 → allowed',
  evaluateLimit('free', 'fast', 'voiceCapture', 0, 0, 0).allowed, true);
expect('voiceCapture free 2/3 → allowed',
  evaluateLimit('free', 'fast', 'voiceCapture', 0, 0, 2).allowed, true);
expect('voiceCapture free 3/3 → lifetime_cap',
  evaluateLimit('free', 'fast', 'voiceCapture', 0, 0, 3).reason, 'lifetime_cap');
expect('voiceCapture free 3/3 → blocked',
  evaluateLimit('free', 'fast', 'voiceCapture', 0, 0, 3).allowed, false);

// aiEstimateWizard — free, SMART tier (proves the smart-cap-0 bypass), cap 2
expect('aiEstimateWizard free 1/2 → allowed (bypasses smart daily 0)',
  evaluateLimit('free', 'smart', 'aiEstimateWizard', 0, 0, 1).allowed, true);
expect('aiEstimateWizard free 2/2 → lifetime_cap',
  evaluateLimit('free', 'smart', 'aiEstimateWizard', 0, 0, 2).reason, 'lifetime_cap');

// aiTakeoff — free, SMART tier, cap 1
expect('aiTakeoff free 0/1 → allowed',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 0).allowed, true);
expect('aiTakeoff free 1/1 → lifetime_cap',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 1).reason, 'lifetime_cap');
expect('aiTakeoff free 1/1 → over cap stays lifetime_cap',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 5).reason, 'lifetime_cap');

// Paid tier ignores lifetime caps entirely
expect('aiTakeoff pro 5 lifetime → still allowed',
  evaluateLimit('pro', 'smart', 'aiTakeoff', 0, 0, 5).allowed, true);

// Fail-open sentinel
expect('FAIL_OPEN_RESULT allowed', FAIL_OPEN_RESULT.allowed, true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
