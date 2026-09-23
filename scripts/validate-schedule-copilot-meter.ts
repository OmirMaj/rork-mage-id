import { evaluateLimit, type AIFeature, type RequestTier } from '../utils/aiRateLimiterCore';
import { createInterviewMeter, interviewMeterPlan } from '../utils/copilot/turnMeter';

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

// #35: a schedule interview is ONE trial, not one per turn. maxQuestions 4 →
// the opening utterance + 4 answers = 5 turns; the per-turn meter spent all 3
// free trials by turn 3 and the interview died before its last question.
(async () => {
  let lifetime = 0, count = 0, smart = 0;
  const meter = createInterviewMeter({
    plan: () => interviewMeterPlan({ aiFeature: 'scheduleCopilot' }),
    check: async (req: RequestTier, f: AIFeature) => evaluateLimit('free', req, f, count, smart, lifetime),
    record: (req: RequestTier) => { lifetime++; count++; if (req === 'smart') smart++; },
  });
  let ran = 0;
  for (let t = 0; t < 5; t++) { const l = await meter.gate(); if (!l.allowed) break; meter.settle(true); ran++; }
  expect('free 5-turn schedule interview completes', ran, 5);
  expect('…on exactly 1 scheduleCopilot trial', lifetime, 1);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
})();
