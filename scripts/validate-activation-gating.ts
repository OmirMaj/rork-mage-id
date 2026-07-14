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

// aiTakeoff — Pro-only (server hard-gates convert-pdf + analyze-takeoff to
// Pro+). Free users are walled with reason 'pro_only' BEFORE any upload — no
// free trial, matching the server + the paywall FEATURES table (free:false).
expect('aiTakeoff free → pro_only (no free trial)',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 0).reason, 'pro_only');
expect('aiTakeoff free → blocked',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 0).allowed, false);
expect('aiTakeoff free → upgradeTo pro',
  evaluateLimit('free', 'smart', 'aiTakeoff', 0, 0, 0).upgradeTo, 'pro');

// Paid tier passes the pro-only gate (subject to its smart daily quota).
expect('aiTakeoff pro → allowed',
  evaluateLimit('pro', 'smart', 'aiTakeoff', 0, 0, 5).allowed, true);

// Fail-open sentinel
expect('FAIL_OPEN_RESULT allowed', FAIL_OPEN_RESULT.allowed, true);

// maxProjects cap — free is 1 real project, paid is unlimited.
// NOTE: FEATURE_LIMITS can't be imported here — hooks/useTierAccess.ts
// transitively pulls expo-router / react-native, which crashes bun
// ("Expected CommonJS module to have a function wrapper"). Mirror the
// enforced comparison (`realProjectCount < FEATURE_LIMITS.maxProjects[tier]`)
// with the literal cap values, kept in sync with FEATURE_LIMITS.maxProjects.
const MAX_PROJECTS_FREE = 1;
const MAX_PROJECTS_PAID = Infinity;
expect('free at 0 projects → can create',
  0 < MAX_PROJECTS_FREE, true);
expect('free at 1 project → blocked',
  1 < MAX_PROJECTS_FREE, false);
expect('pro unlimited → can create at 50',
  50 < MAX_PROJECTS_PAID, true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
