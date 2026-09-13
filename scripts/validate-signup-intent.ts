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
//   • Trial longer than MAX_TRIAL_DAYS → clamped, NOT echoed. ?trial=999 made
//     app/paywall.tsx print "999-day free trial" inside the paid app.
//   • URLSearchParams input (real-world handoff)
//   • Whitespace-padded plan normalised
import { readFileSync } from 'node:fs';
import { parseSignupIntent, MAX_TRIAL_DAYS } from '../utils/signupIntent';

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

// 30 is longer than anything on offer, so it comes back clamped, not echoed.
eq('enterprise + trial 30 → clamped to MAX_TRIAL_DAYS',
  parseSignupIntent({ plan: 'enterprise', trial: '30' }),
  { plan: 'enterprise', trialDays: MAX_TRIAL_DAYS });

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

// ── Upper clamp ───────────────────────────────────────────────────────────────
// The defect: trialDays was unbounded and app/paywall.tsx:420/458/496 render it
// straight into "{intentTrialDays}-day free trial", so a link was enough to make
// the paid app advertise a trial nobody would ever be given.
eq('trial 999 → clamped, not echoed',
  parseSignupIntent({ plan: 'pro', trial: '999' }),
  { plan: 'pro', trialDays: MAX_TRIAL_DAYS });

eq('trial 1e9 → clamped',
  parseSignupIntent({ plan: 'business', trial: '1e9' }),
  { plan: 'business', trialDays: MAX_TRIAL_DAYS });

eq('URLSearchParams trial=3650 → clamped',
  parseSignupIntent(new URLSearchParams('plan=enterprise&trial=3650')),
  { plan: 'enterprise', trialDays: MAX_TRIAL_DAYS });

eq(`trial exactly ${MAX_TRIAL_DAYS} still passes through`,
  parseSignupIntent({ plan: 'pro', trial: String(MAX_TRIAL_DAYS) }),
  { plan: 'pro', trialDays: MAX_TRIAL_DAYS });

eq('a trial shorter than the cap is untouched',
  parseSignupIntent({ plan: 'pro', trial: '3' }),
  { plan: 'pro', trialDays: 3 });

// MAX_TRIAL_DAYS is the promise the marketing site makes. Pin it to the only
// link on the site that carries one, so the two cannot drift apart.
{
  const html = readFileSync('marketing/pricing.html', 'utf8');
  const linked = [...html.matchAll(/[?&]trial=(\d+)/g)].map(m => Number(m[1]));
  const bad = linked.filter(d => d > MAX_TRIAL_DAYS);
  eq(`marketing/pricing.html links no trial longer than ${MAX_TRIAL_DAYS} (found ${linked.join(', ') || 'none'})`,
    bad, []);
}

// ── THE READ PATH ─────────────────────────────────────────────────────────────
// Everything above drives parseSignupIntent, which runs exactly once, on the
// web deep-link entry (app/_layout.tsx:1562). The function the PAYWALLS call is
// readSignupIntent (app/paywall.tsx:196, app/onboarding-paywall.tsx:173), and it
// reads AsyncStorage — which may hold a value written by a build that predates
// the clamp, because this app ships JS by OTA over installed native builds.
// A clamp in parse only is therefore half a fix, and these cases are what make
// that provable: they write a hostile value to storage and read it back through
// the real function.
{
  // The web build of AsyncStorage IS window.localStorage; give it one.
  const mem = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => { mem.clear(); },
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  (globalThis as unknown as { window: unknown }).window = { localStorage: shim };
  (globalThis as unknown as { localStorage: unknown }).localStorage = shim;

  const { readSignupIntent, persistSignupIntent, clearSignupIntent, normalizeStoredIntent, SIGNUP_INTENT_KEY } =
    await import('../utils/signupIntent');
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;

  const readAfterStoring = async (raw: string) => {
    await AsyncStorage.setItem(SIGNUP_INTENT_KEY, raw);
    return readSignupIntent();
  };

  console.log('\nthe read path (readSignupIntent — what the paywalls call):');

  eq('a pre-fix 999 on disk is clamped on read, not echoed',
    await readAfterStoring('{"plan":"pro","trialDays":999}'),
    { plan: 'pro', trialDays: MAX_TRIAL_DAYS });

  eq('a pre-fix 3650 on disk is clamped on read',
    await readAfterStoring('{"plan":"enterprise","trialDays":3650}'),
    { plan: 'enterprise', trialDays: MAX_TRIAL_DAYS });

  eq('negative on disk → 0',
    await readAfterStoring('{"plan":"pro","trialDays":-5}'),
    { plan: 'pro', trialDays: 0 });

  eq('a garbage trialDays on disk → 0, plan preserved',
    await readAfterStoring('{"plan":"business","trialDays":"lots"}'),
    { plan: 'business', trialDays: 0 });

  eq('a missing trialDays on disk → 0',
    await readAfterStoring('{"plan":"pro"}'),
    { plan: 'pro', trialDays: 0 });

  eq('an in-range trial on disk is untouched',
    await readAfterStoring('{"plan":"pro","trialDays":7}'),
    { plan: 'pro', trialDays: 7 });

  eq('an invalid plan on disk → null',
    await readAfterStoring('{"plan":"hacker","trialDays":7}'),
    null);

  eq('unparseable JSON on disk → null',
    await readAfterStoring('{not json'),
    null);

  await clearSignupIntent();
  eq('nothing stored → null', await readSignupIntent(), null);

  // The write door too: nothing over the cap should ever be persisted by this
  // build, even if a caller hand-builds the object.
  await persistSignupIntent({ plan: 'pro', trialDays: 999 });
  eq('persistSignupIntent clamps on the way in',
    JSON.parse((await AsyncStorage.getItem(SIGNUP_INTENT_KEY))!),
    { plan: 'pro', trialDays: MAX_TRIAL_DAYS });

  // And the pure normaliser both doors share, so a refactor that inlines it
  // still has something to fail against.
  eq('normalizeStoredIntent(null) → null', normalizeStoredIntent(null), null);
  eq('normalizeStoredIntent clamps',
    normalizeStoredIntent('{"plan":"pro","trialDays":1e9}'),
    { plan: 'pro', trialDays: MAX_TRIAL_DAYS });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
