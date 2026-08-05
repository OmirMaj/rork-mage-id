import { parseSignupIntent } from '@/utils/signupIntent';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

eq('pro.trial', parseSignupIntent({ plan: 'pro', trial: '14' }), { plan: 'pro', trialDays: 14 });
eq('business.notrial', parseSignupIntent({ plan: 'business' }), { plan: 'business', trialDays: 0 });
eq('free', parseSignupIntent({ plan: 'free', trial: '0' }), { plan: 'free', trialDays: 0 });
eq('uppercase', parseSignupIntent({ plan: 'PRO', trial: '14' }), { plan: 'pro', trialDays: 14 });
eq('invalid.plan', parseSignupIntent({ plan: 'hacker', trial: '14' }), null);
eq('missing.plan', parseSignupIntent({ trial: '14' }), null);
eq('garbage.trial', parseSignupIntent({ plan: 'pro', trial: 'abc' }), { plan: 'pro', trialDays: 0 });
eq('negative.trial', parseSignupIntent({ plan: 'pro', trial: '-5' }), { plan: 'pro', trialDays: 0 });

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
if (failures) process.exit(1);
