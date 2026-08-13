// scripts/validate-signup-intent.ts — permanent validator for utils/signupIntent.ts.
//
// Guards the parsing invariants of parseSignupIntent:
//   • Valid plan + trial → correct SignupIntent
//   • Valid plan, no trial → trialDays 0
//   • Plan 'free' with trial '0' → trialDays 0
//   • Uppercase input normalised to lowercase plan
//   • Invalid plan → null
//   • Missing plan → null
//   • Garbage trial string → trialDays 0
//   • Negative trial → trialDays 0
//   • URLSearchParams input (real-world handoff)
//   • Whitespace-padded plan normalised
import { parseSignupIntent } from '../utils/signupIntent';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}

// ── Basic valid cases ─────────────────────────────────────────────────────────
eq('pro + trial 14',
  parseSignupIntent({ plan: 'pro', trial: '14' }),
  { plan: 'pro', trialDays: 14 });

eq('business, no trial → trialDays 0',
  parseSignupIntent({ plan: 'business' }),
  { plan: 'business', trialDays: 0 });

eq('free + trial 0 → trialDays 0',
  parseSignupIntent({ plan: 'free', trial: '0' }),
  { plan: 'free', trialDays: 0 });

eq('enterprise + trial 30',
  parseSignupIntent({ plan: 'enterprise', trial: '30' }),
  { plan: 'enterprise', trialDays: 30 });

// ── Case normalisation ────────────────────────────────────────────────────────
eq('uppercase PRO → pro',
  parseSignupIntent({ plan: 'PRO', trial: '7' }),
  { plan: 'pro', trialDays: 7 });

eq('mixed case Business → business',
  parseSignupIntent({ plan: 'Business' }),
  { plan: 'business', trialDays: 0 });

// ── Invalid plan → null ───────────────────────────────────────────────────────
eq('invalid plan "hacker" → null',
  parseSignupIntent({ plan: 'hacker' }),
  null);

eq('invalid plan "starter" → null',
  parseSignupIntent({ plan: 'starter' }),
  null);

// ── Missing plan → null ───────────────────────────────────────────────────────
eq('missing plan → null',
  parseSignupIntent({}),
  null);

eq('empty string plan → null',
  parseSignupIntent({ plan: '' }),
  null);

// ── Garbage trial value → trialDays 0 ────────────────────────────────────────
eq('garbage trial "abc" → trialDays 0',
  parseSignupIntent({ plan: 'pro', trial: 'abc' }),
  { plan: 'pro', trialDays: 0 });

eq('NaN trial "NaN" → trialDays 0',
  parseSignupIntent({ plan: 'pro', trial: 'NaN' }),
  { plan: 'pro', trialDays: 0 });

// ── Negative trial → trialDays 0 ─────────────────────────────────────────────
eq('negative trial "-5" → trialDays 0',
  parseSignupIntent({ plan: 'pro', trial: '-5' }),
  { plan: 'pro', trialDays: 0 });

// ── URLSearchParams input ─────────────────────────────────────────────────────
eq('URLSearchParams plan=pro&trial=7',
  parseSignupIntent(new URLSearchParams('plan=pro&trial=7')),
  { plan: 'pro', trialDays: 7 });

eq('URLSearchParams plan=enterprise (no trial)',
  parseSignupIntent(new URLSearchParams('plan=enterprise')),
  { plan: 'enterprise', trialDays: 0 });

eq('URLSearchParams invalid plan → null',
  parseSignupIntent(new URLSearchParams('plan=unknown&trial=14')),
  null);

// ── Whitespace-padded plan ────────────────────────────────────────────────────
eq('whitespace padded "  pro  " → pro',
  parseSignupIntent({ plan: '  pro  ' }),
  { plan: 'pro', trialDays: 0 });

// ── Fractional trial → floored ────────────────────────────────────────────────
eq('fractional trial "14.9" → trialDays 14 (floored)',
  parseSignupIntent({ plan: 'pro', trial: '14.9' }),
  { plan: 'pro', trialDays: 14 });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
