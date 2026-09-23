// scripts/validate-w5-paywall-tiers.ts — the tier the app runs on, and what a
// Restore tap says. Audit wave 5: #2 (blocker), #126, #176.
//
// #2. Every paid plan today is turned on BY HAND (the founder sets
// subscriptions.tier with the service key). contexts/SubscriptionContext.tsx
// resolved RevenueCat FIRST: a hand-granted customer has no store entitlement,
// so on the iPhone — where RevenueCat is configured — he read as Free and hit a
// paywall on every paid screen while every edge function served him as Pro.
// The rule now: the higher rank of RevenueCat and the server row; the local
// cache stands in for the server only while the server has not answered; the
// owner override last. The RevenueCat listener (which fires on launch) must
// apply the same rule, or the first push undoes it.
//
// #126. Restore said "Your purchases have been restored" whenever the call
// returned — including when the store found nothing — and the first-run
// paywall then left the screen as if he had paid. On web it echoed the local
// cache back as the store's answer.
//
// #176. planSource tells Settings whether a store subscription backs the plan
// (send him to the store) or MAGE ID turned it on (send him to email).
//
// The pure block is EXTRACTED from the shipped file between its sentinels and
// executed, so this cannot pass against a copy. The wiring around it (which
// callers use it) is pinned by source shape below.
//
// Run: bun run scripts/validate-w5-paywall-tiers.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync: (c: string) => string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with // line comments and block comments removed, for shape checks. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

type Tier = 'free' | 'pro' | 'business' | 'enterprise';
const CTX = 'contexts/SubscriptionContext.tsx';
const ctxSrc = read(CTX);
const BEGIN = '// --- BEGIN subscriptionResolve';
const END = '// --- END subscriptionResolve ---';
const from = ctxSrc.indexOf(BEGIN), to = ctxSrc.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`\n  ✗ could not find the subscriptionResolve sentinels in ${CTX}.`);
  console.error('    The tier resolution would go unpinned and could drift back to "RevenueCat wins". Restore them.');
  process.exit(1);
}
const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(ctxSrc.slice(from, to).replace(/^export /gm, ''));
const mod = new Function(`${js}\nreturn { maxTier, resolveTier, planSourceFor, storeOfActiveEntitlement, restoreOutcome, RestoreUnavailableError };`)() as {
  maxTier: (...t: (Tier | null | undefined)[]) => Tier | null;
  resolveTier: (o: { rcTier: Tier | null; serverTier: Tier | null | undefined; localTier: Tier | null | undefined; isOwner: boolean }) => Tier;
  planSourceFor: (tier: Tier, store: string | null | undefined) => 'store' | 'manual' | 'none';
  storeOfActiveEntitlement: (info: unknown, tier: Tier) => string | null;
  restoreOutcome: (r: unknown, store: 'App Store' | 'Google Play') => { title: string; body: string; leave: boolean };
  RestoreUnavailableError: new () => Error;
};
const { resolveTier, planSourceFor, storeOfActiveEntitlement, restoreOutcome, RestoreUnavailableError } = mod;

console.log('\n#2 — the tier is the higher of RevenueCat and the server row:');
const r = (rcTier: Tier | null, serverTier: Tier | null | undefined, localTier: Tier | null = null, isOwner = false) =>
  resolveTier({ rcTier, serverTier, localTier, isOwner });
eq('server business + RevenueCat none (free) → business  [the blocker]', r('free', 'business'), 'business');
eq('server pro + RevenueCat free → pro', r('free', 'pro'), 'pro');
eq('RevenueCat business + server free → business (a store purchase the webhook has not written yet)', r('business', 'free'), 'business');
eq('RevenueCat enterprise + server business → enterprise', r('enterprise', 'business'), 'enterprise');
eq('both free → free', r('free', 'free'), 'free');
eq('server answered "no row" (null) + RevenueCat free → free, the cache is NOT consulted', r('free', null, 'business'), 'free');
eq('web: server "no row" + RevenueCat unknown + cached business → free (a previous account\'s cached plan never leaks)', r(null, null, 'business'), 'free');
eq('signed out (server null) + RevenueCat unknown + cached enterprise → free', r(null, null, 'enterprise'), 'free');
eq('server not answered yet (undefined) → the cached tier stands in (offline hand grant stays Pro)', r('free', undefined, 'pro'), 'pro');
eq('neither source known → the cache', r(null, undefined, 'enterprise'), 'enterprise');
eq('RevenueCat unconfigured (null) + server business → business', r(null, 'business', 'free'), 'business');
eq('nothing known at all → free', r(null, undefined, null), 'free');
eq('owner override is applied last', r('enterprise', 'enterprise', null, true), 'business');
eq('owner override lifts a free account', r('free', null, null, true), 'business');

console.log('\n#176 — planSource (CONTRACT 1):');
const info = (tier: string, store: string, isActive = true) => ({ entitlements: { active: { [tier]: { isActive, store } } } });
eq('free → none', planSourceFor('free', 'APP_STORE'), 'none');
eq('pro backed by an App Store entitlement → store', planSourceFor('pro', storeOfActiveEntitlement(info('pro', 'APP_STORE'), 'pro')), 'store');
eq('business backed by Google Play → store', planSourceFor('business', storeOfActiveEntitlement(info('business', 'PLAY_STORE'), 'business')), 'store');
eq('business from the server row, no entitlement → manual', planSourceFor('business', storeOfActiveEntitlement(null, 'business')), 'manual');
eq('store Pro under a hand-granted Business → manual (the store has nothing that changes Business)',
  planSourceFor('business', storeOfActiveEntitlement(info('pro', 'APP_STORE'), 'business')), 'manual');
eq('a PROMOTIONAL entitlement → manual', planSourceFor('pro', storeOfActiveEntitlement(info('pro', 'PROMOTIONAL'), 'pro')), 'manual');
eq('an inactive entitlement is not a backing store', planSourceFor('pro', storeOfActiveEntitlement(info('pro', 'APP_STORE', false), 'pro')), 'manual');

console.log('\n#126 — restoreOutcome:');
const o = (x: unknown, s: 'App Store' | 'Google Play' = 'App Store') => restoreOutcome(x, s);
ok('a restored Pro says so by name and may leave', o('pro').leave && /Restored — you're on Pro/.test(o('pro').title));
ok('a restored Enterprise names Enterprise', /Enterprise/.test(o('enterprise').title) && o('enterprise').leave);
ok('nothing found → stays, and names the store account', !o('free').leave && /No active subscription found for this App Store account/.test(o('free').body));
ok('…Google Play on Android', /Google Play account/.test(o('free', 'Google Play').body));
ok('nothing found never says "restored"', !/restored/i.test(o('free').title + o('free').body));
ok('no store (web / no key) → restore is in the mobile app, stays', !o(new RestoreUnavailableError()).leave && /mobile app|iPhone or Android app/.test(o(new RestoreUnavailableError()).title + o(new RestoreUnavailableError()).body));
ok('a network error → try again, stays, not "Nothing to restore"', !o(new Error('network')).leave && /try again/i.test(o(new Error('network')).body) && !/nothing to restore/i.test(o(new Error('network')).title));

console.log('\nwiring (shape of the shipped provider):');
const ctx = code(ctxSrc);
ok('the "trusting RevenueCat" branch and its sync call are gone', !/trusting RevenueCat/.test(ctx));
ok('the resolve effect calls resolveTier with the server tier', /const resolved = resolveTier\(\{[\s\S]{0,400}serverTier:/.test(ctx));
ok('the RevenueCat listener resolves through resolveNow (the same max), not the entitlement alone',
  /const listener = \(info: CustomerInfo\) => \{[\s\S]{0,300}const newTier = resolveNow\(info\);/.test(ctx));
ok('resolveNow reads the server row from the query cache',
  /const resolveNow = useCallback\([\s\S]{0,400}getQueryData<ServerTierRow \| null>\(\['subscription-supabase', userId\]\)/.test(ctx));
ok('purchase success resolves too (a store Pro under a hand Business stays Business)',
  /onSuccess: async \(data\) => \{[\s\S]{0,700}resolveNow\(data\.customerInfo\)/.test(ctx));
ok('the server row is re-read when the app comes to the foreground',
  /AppState\.addEventListener\('change'[\s\S]{0,200}state === 'active'[\s\S]{0,200}invalidateQueries\(\{ queryKey: \['subscription-supabase', userId\] \}\)/.test(ctx));
// The resolve effect runs on the first render. Persisting then wrote 'free'
// over the cached tier before localTierQuery had read it, so the cache — the
// only stand-in while the server has not answered — held Free from then on.
ok('the resolve effect waits for the cached tier to be read before persisting anything',
  /useEffect\(\(\) => \{\s*if \(!localTierQuery\.isFetched\) return;[\s\S]{0,1200}const resolved = resolveTier\(\{/.test(ctx)
  && /\}, \[[^\]]*localTierQuery\.isFetched[^\]]*\]\);/.test(ctx));
ok('the server read does not name a column list that could fail before the migration', /from\('subscriptions'\)\s*\.select\('\*'\)/.test(ctx));
ok('restore with no store throws RestoreUnavailableError instead of echoing the cache',
  /if \(!rcConfigured\) throw new RestoreUnavailableError\(\);/.test(ctx) && !/const stored = await AsyncStorage\.getItem\(SUBSCRIPTION_KEY\);\s*return stored/.test(ctx));
ok('restorePurchases returns the restored tier (CONTRACT 2)', /const restorePurchases = useCallback\(async \(\): Promise<SubscriptionTier> =>/.test(ctx));
ok('planSource is on the context value (CONTRACT 1)', /return useMemo\(\(\) => \(\{\s*tier,\s*planSource,/.test(ctx));
ok('the Enterprise-missing error is customer-safe', !/Set up the product in App Store Connect/.test(ctx) && /Enterprise is not available for purchase in the app yet/.test(ctx));

for (const f of ['app/paywall.tsx', 'app/onboarding-paywall.tsx']) {
  const s = code(read(f));
  ok(`${f}: Restore goes through restoreOutcome`, /const outcome = restoreOutcome\(result, store\);/.test(s));
  ok(`${f}: never claims "Your purchases have been restored"`, !/Your purchases have been restored/.test(s));
}
{
  const s = code(read('app/onboarding-paywall.tsx'));
  ok('onboarding leaves only on a real restore', /if \(outcome\.leave\) void leaveToNextScreen\(\);/.test(s));
  ok('onboarding hides Restore on web', /\{Platform\.OS !== 'web' && \([\s\S]{0,300}onPress=\{handleRestore\}/.test(s));
  ok('onboarding no longer reuses "Nothing to Restore" for failures', !/'Nothing to Restore'/.test(s));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
