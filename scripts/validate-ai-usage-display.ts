// validate-ai-usage-display.ts — the AI allowance is shown as it really is.
//
// THE FOUNDER (2026-09-24): "AI I see you have 10 attempts. After that is it
// done or do you pay for more?" No plan has a 10. Settings > AI USAGE opened on
// `useState(10)` / `useState(3)` — the retired v1 free cap and a number no plan
// ever had — and printed them as "Today: 0 of 10 requests" until the usage read
// landed, and forever when it threw (`.catch(() => {})`). A tier change mid-read
// could also let the older answer land last. Separately, two copy sites still
// implied AI is "unlimited" on a paid plan, and a Pro user at the daily cap was
// told to upgrade with no word on when the allowance comes back.
//
// This guard pins, by EXECUTING the code where it can:
//   1. describeAIUsageCard: numbers only when they are real (caps from LIMITS for
//      the tier on screen, usage from the server counter); loading while a read
//      is in flight or stale; a visible "couldn't load" when it failed or only
//      the device cache answered.
//   2. getAIUsageStats reports where its count came from, and a corrupt local
//      cache surfaces as a failure (the card's retry), not a silent placeholder.
//   3. checkAILimit / showAILimitAlert: the cap message is unchanged, plus the
//      reset time in the reader's clock — once, and only where waiting helps.
//   4. No "unlimited" AI promise in the sites this lane owns.
//   5. The Settings card is wired to all of the above (source shape).
//
// Run: bun run scripts/validate-ai-usage-display.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Code only — the WHY comments quote the old copy on purpose. */
const code = (s: string) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

// ── Fakes: AsyncStorage (a Map), Supabase (a controllable RPC), the alert shim.
const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};

const store = new Map<string, string>();
const fakeStorage = {
  getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: async (k: string, v: string) => { store.set(k, v); },
  removeItem: async (k: string) => { store.delete(k); },
};
mock.module('@react-native-async-storage/async-storage', () => ({ default: fakeStorage, ...fakeStorage }));

type Rpc = { data: unknown; error: unknown };
let dailyRow: Rpc = { data: [{ count: 0, smart_count: 0 }], error: null };
const fakeSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  rpc: async (name: string) => (name === 'ai_daily_usage_get' ? dailyRow : { data: null, error: { message: 'nope' } }),
};
mock.module('@/lib/supabase', () => ({ supabase: fakeSupabase, isSupabaseConfigured: true }));

const alerts: { title: string; body: string; buttons: { text: string }[] }[] = [];
mock.module('@/utils/alert', () => ({
  showAlert: (title: string, body: string, buttons: { text: string }[]) => { alerts.push({ title, body, buttons }); },
}));
mock.module('react-native', () => ({ Platform: { OS: 'web' } }));

const limiter = await import('../utils/aiRateLimiter');
const {
  describeAIUsageCard, aiPlanAllowanceSentence, withDailyResetSentence,
  getAIUsageStats, checkAILimit, LIMITS, nextAiResetLabel,
  AI_USAGE_LOADING_COPY, AI_USAGE_FAILED_COPY,
} = limiter;
const { showAILimitAlert } = await import('../utils/aiLimitAlert');

type Tier = 'free' | 'pro' | 'business' | 'enterprise';
const TIERS: Tier[] = ['free', 'pro', 'business', 'enterprise'];

// ── 1. describeAIUsageCard ──────────────────────────────────────────────────
console.log('\n1. the card shows a number only when it is the real one');

const server = (used: number, smartUsed: number) => ({ used, smartUsed, source: 'server' as const });

ok('no read yet → loading, not a placeholder cap',
  describeAIUsageCard({ tier: 'business', loaded: null, failed: false }).kind === 'loading');
ok('loading copy says it is loading',
  JSON.stringify(describeAIUsageCard({ tier: 'pro', loaded: null, failed: false })) === JSON.stringify({ kind: 'loading', message: AI_USAGE_LOADING_COPY }));

const stale = describeAIUsageCard({ tier: 'business', loaded: { tier: 'free', stats: server(2, 0) }, failed: false });
ok('an answer read for a tier the screen has left is not shown (stale guard)', stale.kind === 'loading', JSON.stringify(stale));

const failed = describeAIUsageCard({ tier: 'business', loaded: { tier: 'business', stats: server(4, 1) }, failed: true });
ok('a failed read → unavailable, never the last or a placeholder number', failed.kind === 'unavailable', JSON.stringify(failed));
ok('unavailable says so in words', failed.kind === 'unavailable' && failed.message === AI_USAGE_FAILED_COPY && /Couldn.t load/.test(failed.message));
ok('unavailable still states the plan allowance from LIMITS',
  failed.kind === 'unavailable' && failed.allowance === 'Your plan: 80 AI requests a day, 18 of them advanced.', failed.kind === 'unavailable' ? failed.allowance : '');

const device = describeAIUsageCard({ tier: 'pro', loaded: { tier: 'pro', stats: { used: 0, smartUsed: 0, source: 'device' } }, failed: false });
ok('only the device cache answered (server unreachable) → unavailable, not "today"', device.kind === 'unavailable', JSON.stringify(device));

for (const t of TIERS) {
  const v = describeAIUsageCard({ tier: t, loaded: { tier: t, stats: server(3, 1) }, failed: false });
  ok(`${t}: ready caps are LIMITS.${t} (${LIMITS[t].daily}/${LIMITS[t].smart}) and usage is the server's`,
    v.kind === 'ready' && v.limit === LIMITS[t].daily && v.smartLimit === LIMITS[t].smart && v.used === 3 && v.smartUsed === 1,
    JSON.stringify(v));
}
ok('no tier has a daily cap of 10 or an advanced cap of 3 (the retired placeholders)',
  TIERS.every(t => (LIMITS[t].daily as number) !== 10 && (LIMITS[t].smart as number) !== 3));

ok('allowance sentence, business', aiPlanAllowanceSentence('business') === 'Your plan: 80 AI requests a day, 18 of them advanced.', aiPlanAllowanceSentence('business'));
ok('allowance sentence, free (no advanced quota → not mentioned)', aiPlanAllowanceSentence('free') === 'Your plan: 5 AI requests a day.', aiPlanAllowanceSentence('free'));
ok('allowance sentence never says unlimited', TIERS.every(t => !/unlimited/i.test(aiPlanAllowanceSentence(t))));

// ── 2. getAIUsageStats ──────────────────────────────────────────────────────
console.log('\n2. getAIUsageStats says where its number came from');

store.clear();
dailyRow = { data: [{ count: 7, smart_count: 2 }], error: null };
let s = await getAIUsageStats('business');
ok('server answered → source "server", its count', s.source === 'server' && s.used === 7 && s.smartUsed === 2, JSON.stringify(s));

dailyRow = { data: null, error: { message: 'rpc down' } };
store.clear();
s = await getAIUsageStats('business');
ok('server failed → source "device" (the card then says it could not load)', s.source === 'device', JSON.stringify(s));

store.set('mage_ai_usage', '{corrupt');
let threw = false;
try { await getAIUsageStats('business'); } catch { threw = true; }
ok('a corrupt local cache throws to the caller (the card shows its retry, not 10)', threw);
store.clear();

// ── 3. At the cap: the message as-is, plus the local reset ─────────────────
console.log('\n3. at the cap the message names the reset in the reader\'s clock');

const label = nextAiResetLabel().daily;
store.clear(); // the limiter caches the merged count locally
dailyRow = { data: [{ count: 30, smart_count: 0 }], error: null };
const proCap = await checkAILimit('pro', 'fast');
ok('pro daily cap: original upgrade copy kept', !!proCap.message && proCap.message.startsWith("You've used today's 30 AI requests. Upgrade to Business for 80/day."), proCap.message);
ok('pro daily cap: ends with the real reset in local time', proCap.message === `You've used today's 30 AI requests. Upgrade to Business for 80/day. ${label}.`, proCap.message);

store.clear(); // the limiter caches the merged count locally
dailyRow = { data: [{ count: 150, smart_count: 0 }], error: null };
const entCap = await checkAILimit('enterprise', 'fast');
ok('enterprise daily cap: reset named exactly once', (entCap.message?.match(/Resets/g) ?? []).length === 1, entCap.message);

store.clear(); // the limiter caches the merged count locally
dailyRow = { data: [{ count: 20, smart_count: 18 }], error: null };
const bizSmart = await checkAILimit('business', 'smart');
ok('business smart cap: reset appended', bizSmart.reason === 'smart_cap' && !!bizSmart.message?.endsWith(`${label}.`), bizSmart.message);

store.clear(); // the limiter caches the merged count locally
dailyRow = { data: [{ count: 0, smart_count: 0 }], error: null };
store.set('mage_ai_lifetime', JSON.stringify({ quickEstimate: 3 }));
const life = await checkAILimit('free', 'smart', 'quickEstimate');
ok('free lifetime cap: no reset (trials never come back)', life.reason === 'lifetime_cap' && !/Resets/.test(life.message ?? ''), life.message);
const proOnly = await checkAILimit('free', 'smart', 'aiTakeoff');
ok('pro-only gate: no reset', proOnly.reason === 'pro_only' && !/Resets/.test(proOnly.message ?? ''), proOnly.message);
const freeSmart = await checkAILimit('free', 'smart', 'projectMemory');
ok('free smart cap (0 advanced a day): no reset — waiting brings nothing', freeSmart.reason === 'smart_cap' && !/Resets/.test(freeSmart.message ?? ''), freeSmart.message);
store.clear();
const allowed = await checkAILimit('pro', 'fast');
ok('under the cap: untouched', allowed.allowed === true && allowed.message === undefined);

const pure = withDailyResetSentence({ allowed: false, remaining: 0, reason: 'daily_cap', message: 'X.' }, 'free', 'Resets at 8:00 PM');
ok('withDailyResetSentence (pure): "X. Resets at 8:00 PM."', pure.message === 'X. Resets at 8:00 PM.', pure.message);

store.clear(); // the limiter caches the merged count locally
alerts.length = 0;
dailyRow = { data: [{ count: 30, smart_count: 0 }], error: null };
showAILimitAlert({ limit: await checkAILimit('pro', 'fast'), router: { push: () => {} } as never });
const a = alerts[0];
ok('limit alert: body carries the cap copy and the reset exactly once',
  !!a && a.body.includes('Upgrade to Business for 80/day.') && (a.body.match(/Resets/g) ?? []).length === 1, a?.body);
ok('limit alert: plus the countdown', !!a && /That's in \d/.test(a.body), a?.body);

alerts.length = 0;
showAILimitAlert({ limit: { allowed: false, remaining: 0, reason: 'lifetime_cap' }, router: { push: () => {} } as never });
const b = alerts[0];
ok('lifetime fallback (no message): no "unlimited"', !!b && !/unlimited/i.test(b.body), b?.body);
ok('lifetime fallback names Pro\'s real allowance from LIMITS',
  !!b && b.body.includes(`Pro includes ${LIMITS.pro.daily} AI requests a day, ${LIMITS.pro.smart} of them advanced.`), b?.body);

// ── 4. No "unlimited" AI promise ────────────────────────────────────────────
console.log('\n4. no copy promises unlimited AI');

const pricing = read('marketing/pricing.html');
ok('pricing.html: "AI estimating & takeoff (unlimited)" is gone',
  !/AI estimating &amp; takeoff \(unlimited\)/.test(pricing) && pricing.includes('<li class="muted">AI estimating &amp; takeoff</li>'));
const aiLines = code(pricing).split('\n').filter(l => /\bAI\b/.test(l) && /unlimited/i.test(l));
ok('pricing.html: no line pairs AI with "unlimited"', aiLines.length === 0, aiLines.join(' | '));
ok('aiLimitAlert.ts: no "unlimited" in code', !/unlimited/i.test(code(read('utils/aiLimitAlert.ts'))));
ok('aiRateLimiter.ts: no "unlimited" anywhere (comments included — it is the header users\' copy is written from)',
  !/unlimited/i.test(read('utils/aiRateLimiter.ts')));

// Wave 6d (Z2): the leftovers fixq did not reach. Enterprise's daily code-check
// and roadmap caps are Infinity client-side, but the relay meters every run.
const constructionAi = code(read('app/(tabs)/construction-ai/index.tsx'));
ok('construction-ai: no "Unlimited code checks / roadmaps / plan reviews"',
  !/Unlimited (code checks|roadmaps|plan reviews)/.test(constructionAi),
  (constructionAi.match(/Unlimited (code checks|roadmaps|plan reviews)[^'`]*/g) ?? []).join(' | '));
ok('construction-ai: an uncapped plan says each run still counts toward the AI requests',
  constructionAi.includes("'No daily cap on code checks · each run counts toward your AI requests'")
  && constructionAi.includes("'No daily cap on roadmaps · each run counts toward your AI requests'"));
ok('construction-ai: the plan-review quota line has no Infinity branch (every tier has a monthly number)',
  constructionAi.includes('{`Monthly limit: ${planMonthlyCap} reviews`}') && !/planMonthlyCap === Infinity/.test(constructionAi));
const onboardingPaywall = code(read('app/onboarding-paywall.tsx'));
ok('onboarding-paywall: no "Teams & unlimited"', !onboardingPaywall.includes('Teams & unlimited'));
ok('onboarding-paywall: the Business tagline counts its seats from INCLUDED_ADMIN_SEATS.business',
  onboardingPaywall.includes('tagline={`Teams · ${INCLUDED_ADMIN_SEATS.business} office seats`}'));
const marketingHome = code(read('marketing/index.html'));
const unlimitedEstimating = marketingHome.split('\n').filter(l => /Unlimited estimating/i.test(l));
ok('marketing/index.html: no line pairs "Unlimited estimating"', unlimitedEstimating.length === 0, unlimitedEstimating.join(' | '));
// The number on the Pro card, read against the LITERAL in the limiter's table
// (utils/aiRateLimiterCore.ts, re-exported by utils/aiRateLimiter.ts) as well
// as the imported value, so neither side can drift alone.
const limiterSrc = read('utils/aiRateLimiterCore.ts');
const proDailyLiteral = Number(limiterSrc.match(/\bpro:\s*\{\s*daily:\s*(\d+)/)?.[1] ?? NaN);
const marketingAi = [...marketingHome.matchAll(/(\d+) AI requests a day/g)].map(m => Number(m[1]));
ok(`marketing/index.html: the Pro card's AI number equals LIMITS.pro.daily (${LIMITS.pro.daily}, literal ${proDailyLiteral})`,
  marketingAi.length === 1 && marketingAi[0] === proDailyLiteral && proDailyLiteral === LIMITS.pro.daily,
  `marketing ${JSON.stringify(marketingAi)}`);

// ── 5. Settings wiring ──────────────────────────────────────────────────────
console.log('\n5. Settings > AI USAGE is wired to the honest card');

const settings = code(read('app/(tabs)/settings/index.tsx'));
ok('no placeholder caps: no useState(10) / useState(3)', !/useState\(10\)/.test(settings) && !/useState\(3\)/.test(settings));
ok('the usage read no longer swallows its error', !/getAIUsageStats\([^)]*\)[\s\S]{0,400}?\.catch\(\(\) => \{\}\)/.test(settings));
ok('a failed read flips the card to "couldn\'t load" (the catch sets the failure)',
  /getAIUsageStats\(readFor\)[\s\S]{0,200}\.catch\(\(err\) => \{[\s\S]{0,200}if \(!cancelled\) setAiUsageFailed\(true\);/.test(settings));
ok('the read is guarded against a stale tier (cancelled + cleanup)',
  /let cancelled = false;[\s\S]{0,700}getAIUsageStats\(readFor\)[\s\S]{0,300}if \(!cancelled\) setAiUsage\([\s\S]{0,300}return \(\) => \{ cancelled = true; \};\s*\}, \[tier, aiUsageAttempt\]\)/.test(settings));
ok('the card goes through describeAIUsageCard', /describeAIUsageCard\(\{ tier: tier as SubscriptionTierKey, loaded: aiUsage, failed: aiUsageFailed \}\)/.test(settings));
ok('loading branch renders the loading copy', /aiCard\.kind === 'loading' \?[\s\S]{0,400}\{aiCard\.message\}/.test(settings));
ok('unavailable branch renders the failure, the allowance and a Retry that re-reads',
  /aiCard\.kind === 'unavailable' \?[\s\S]{0,700}\{aiCard\.message\}[\s\S]{0,200}\{aiCard\.allowance\}[\s\S]{0,200}setAiUsageAttempt\(n => n \+ 1\)[\s\S]{0,500}>Retry</.test(settings));
ok('the ready rows are unchanged and only in the ready branch',
  settings.indexOf('Today: {aiUsed} of {aiLimit} requests') > settings.indexOf(") : (<>")
  && settings.indexOf(") : (<>") > settings.indexOf("aiCard.kind === 'unavailable' ?"));
ok('ready numbers come only from the card view', /const aiLimit = aiCard\.kind === 'ready' \? aiCard\.limit : 0;/.test(settings)
  && /const aiSmartLimit = aiCard\.kind === 'ready' \? aiCard\.smartLimit : 0;/.test(settings));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
