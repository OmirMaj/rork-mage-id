import { evaluateLimit } from '../utils/aiRateLimiterCore';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule copilot metering validation:');

// scheduleCopilot — smart tier, free lifetime cap 3 (matches scheduleBuilder)
expect('copilot free 0/3 → allowed', evaluateLimit('free', 'smart', 'scheduleCopilot', 0, 0, 0).allowed, true);
expect('copilot free 2/3 → allowed', evaluateLimit('free', 'smart', 'scheduleCopilot', 0, 0, 2).allowed, true);
expect('copilot free 3/3 → blocked', evaluateLimit('free', 'smart', 'scheduleCopilot', 0, 0, 3).allowed, false);
expect('copilot free 3/3 → lifetime_cap', evaluateLimit('free', 'smart', 'scheduleCopilot', 0, 0, 3).reason, 'lifetime_cap');
expect('copilot pro not lifetime-capped', evaluateLimit('pro', 'smart', 'scheduleCopilot', 0, 0, 5).allowed, true);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
