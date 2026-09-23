// scripts/validate-w5-paywall-copy.ts — prices and plan copy on the three
// upgrade screens and the pricing/support pages. Audit wave 5: #42, #125,
// #129, #171, #175, #176 (+ carries #39, #41, #127).
//
// #42  three screens, three price tables ($29 / $29.00 / $29.99), and a
//      first-run paywall printing a typed $23.20/mo and "SAVE 20%" beside the
//      store's real $289.99/yr. Now: ONE list-rate table (constants/pricing.ts),
//      no typed annual figure anywhere, per-month and savings computed from the
//      store packages and floored.
// #125 / #171  Plan Viewer and RFIs/Submittals sold as Business (they are Pro)
//      on the upgrade modal, the web plan tile and pricing.html. The copy is
//      now placed by REQUIRED_TIER.
// #129 a plan with no store package showed a live Subscribe and, on tap, a
//      developer setup instruction.
// #175 pricing.html sold voice-to-log as included on Free (3 tries) and a
//      free takeoff trial that does not exist.
// #176 support.html sent every customer to a store page; hand-granted plans
//      have nothing there.
//
// Run: bun run scripts/validate-w5-paywall-copy.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_TIER } from '../utils/featureTiers';
import type { FeatureKey } from '../utils/featureTiers';
import {
  LIST_PRICE_MONTHLY, annualPerMonth, annualSavingsPercent, annualSavingsAmount, formatLikeStorePrice,
} from '../constants/pricing';
import { PLAN_FEATURE_LINES, planFeatureLines, planFeatureBlurb, lineTier } from '../utils/planFeatureCopy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const html = (rel: string) => read(rel).replace(/<!--[\s\S]*?-->/g, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

// ── #42 price arithmetic (the real functions) ───────────────────────────────
console.log('\n#42 — per-month and savings come from the store, floored:');
eq('annual $289.99 → $24.16/mo (floored, not $24.17, not a typed $23.20)', annualPerMonth({ price: 289.99, priceString: '$289.99' }), '$24.16');
eq('annual $290.00 → $24.16 (24.1666… floors)', annualPerMonth({ price: 290, priceString: '$290.00' }), '$24.16');
eq('euro format is kept: 289,99 € → 24,16 €', annualPerMonth({ price: 289.99, priceString: '289,99 €' }), '24,16 €');
eq('no-decimal currency: ¥2,900 → ¥241', annualPerMonth({ price: 2900, priceString: '¥2,900' }), '¥241');
eq('grouping kept: $1,199.99 → $99.99', annualPerMonth({ price: 1199.99, priceString: '$1,199.99' }), '$99.99');
eq('no annual package → null (the screen says "Price shown at checkout")', annualPerMonth(null), null);
eq('Swiss grouping (’): CHF 1’440.00 → CHF 120.00, never spliced into the store number', annualPerMonth({ price: 1440, priceString: 'CHF 1’440.00' }), 'CHF 120.00');
eq("Swiss grouping ('): CHF 1'299.00 → CHF 108.25", annualPerMonth({ price: 1299, priceString: "CHF 1'299.00" }), 'CHF 108.25');
eq('Swiss grouping kept on a big figure: CHF 14’400.00 → CHF 1’200.00', annualPerMonth({ price: 14400, priceString: 'CHF 14’400.00' }), 'CHF 1’200.00');
eq('a number only partly understood → null ("Price shown at checkout"), never a splice', formatLikeStorePrice('CHF 1ʼ299.00', 108.25), null);
eq('narrow-NBSP grouping still works: 1 199,99 € → 99,99 €', annualPerMonth({ price: 1199.99, priceString: '1 199,99 €' }), '99,99 €');
eq('savings 12 x $29.99 vs $289.99 → 19% (floored, never the typed 20%)', annualSavingsPercent({ price: 29.99, priceString: '$29.99' }, { price: 289.99, priceString: '$289.99' }), 19);
eq('savings with a missing monthly package → null (badge hidden)', annualSavingsPercent(null, { price: 289.99, priceString: '$289.99' }), null);
eq('annual no cheaper than monthly → null', annualSavingsPercent({ price: 20, priceString: '$20.00' }, { price: 240, priceString: '$240.00' }), null);
eq('savings amount $359.88 − $289.99 = $69.89', annualSavingsAmount({ price: 29.99, priceString: '$29.99' }, { price: 289.99, priceString: '$289.99' }), '$69.89');
eq('formatLikeStorePrice floors: 24.169 → $24.16', formatLikeStorePrice('$0.00', 24.169), '$24.16');

console.log('\n#42 — one fallback table, no typed annual figure on any screen:');
const SCREENS = ['app/paywall.tsx', 'components/Paywall.tsx', 'app/onboarding-paywall.tsx'];
for (const f of SCREENS) {
  const s = code(read(f));
  const literals = s.match(/['"`]\$\d[\d.,]*/g) ?? [];
  ok(`${f}: types no price literal of its own`, literals.length === 0, `found ${literals.join(', ')}`);
  ok(`${f}: prints no typed savings badge`, !/save 20%/i.test(s));
  ok(`${f}: reads constants/pricing`, /from '@\/constants\/pricing'/.test(s));
}
{
  const onb = code(read('app/onboarding-paywall.tsx'));
  ok('onboarding: the hand-typed FALLBACK_PRICING table is gone', !/FALLBACK_PRICING/.test(onb));
  ok('onboarding: per-month annual figure is derived from the package', /proAnnualPerMonth: annualPerMonth\(proAnnualPackage\?\.product\)/.test(onb)
    && /businessAnnualPerMonth: annualPerMonth\(businessAnnualPackage\?\.product\)/.test(onb));
  ok('onboarding: the save badge renders only when computed', /\{savePct !== null && \(/.test(onb));
  const modal = code(read('components/Paywall.tsx'));
  ok('Paywall modal: the FALLBACK_PRICES table is gone', !/FALLBACK_PRICES/.test(modal));
  ok('Paywall modal: savings badge only when computed', /\{pricing\.savePct !== null && \(/.test(modal));
  ok('Paywall modal: savings are not parsed back out of display strings', !/parseFloat\(pricing\./.test(modal));
}
const pricingHtml = html('marketing/pricing.html');
for (const [tier, rate] of Object.entries(LIST_PRICE_MONTHLY)) {
  ok(`pricing.html prints ${tier}'s list rate as the app's one table does (${rate})`,
    new RegExp(`<span class="price-num">\\${rate}</span>`).test(pricingHtml));
}

// ── #125 / #171 plan copy placed by REQUIRED_TIER ───────────────────────────
console.log('\n#125 / #171 — plan copy is placed by the gate table:');
const mixed = PLAN_FEATURE_LINES.filter(l => new Set(l.keys.map(k => REQUIRED_TIER[k])).size > 1);
ok('no copy line spans two tiers (the "AI Photo Triage / Punch" shape)', mixed.length === 0, mixed.map(l => l.label).join(' | '));
const freeLines = PLAN_FEATURE_LINES.filter(l => lineTier(l) === 'free');
ok('no copy line sells a Free feature as a paid one', freeLines.length === 0, freeLines.map(l => l.label).join(' | '));
const pro = planFeatureLines('pro'), biz = planFeatureLines('business');
ok('Pro lists the Plan Viewer (plan_markup is Pro)', pro.some(l => /Plan Viewer/.test(l)) && REQUIRED_TIER.plan_markup === 'pro');
ok('Pro lists RFIs & Submittals (rfis_submittals is Pro)', pro.some(l => /RFIs/.test(l)));
ok('Business names neither', !biz.some(l => /Plan Viewer|RFIs|Submittals/i.test(l)));
ok('Business lists Ask Your Plans', biz.some(l => /Ask Your Plans/.test(l)));
ok('Business web blurb names no Pro feature', !/RFI|submittal|plan viewer|(?<!Your )\bplans\b/i.test(planFeatureBlurb('business')), planFeatureBlurb('business'));
{
  const modal = code(read('components/Paywall.tsx'));
  ok('Paywall modal: PRO_BENEFITS / BUSINESS_BENEFITS come from planFeatureLines',
    /\.\.\.planFeatureLines\('pro'\)/.test(modal) && /\.\.\.planFeatureLines\('business'\)/.test(modal));
  ok('Paywall modal: no Free-tier items sold as Pro', !/Price Alerts|Daily Field Reports/.test(modal));
  const screen = code(read('app/paywall.tsx'));
  ok("web plan tiles' blurbs come from planFeatureBlurb", /planFeatureBlurb\('pro'\)/.test(screen) && /planFeatureBlurb\('business'\)/.test(screen));
  ok('the old Business blurb is gone', !/subs, RFIs, submittals, punch \+ closeout, plans/.test(screen));
  // carries: #41 split row, #39 label, #175 freeNote
  ok('#41: AI Photo Triage derives from photo_documentation', /\{ label: 'AI Photo Triage', key: 'photo_documentation' \}/.test(screen));
  ok('#41: AI Punch from Photos derives from punch_list_closeout', /\{ label: 'AI Punch from Photos', key: 'punch_list_closeout' \}/.test(screen));
  ok('#41: the mixed row is gone', !/'AI Photo Triage \/ Punch'/.test(screen));
  ok('#39: the drawing-analyses row says what shares it', /'Drawing analyses \/mo \(takeoff runs, spec books, Compare Drawings\)'/.test(screen));
  ok('#175: Voice-to-Report shows its 3 free tries', /label: 'Voice-to-Report \(Android: beta\)', free: false, pro: true, business: true, freeNote: '3 tries'/.test(screen));
  const onb = code(read('app/onboarding-paywall.tsx'));
  ok('#41: onboarding does not promise punch items on Pro', !/punch/i.test(/title: 'AI Photo Triage',\s*description: '([^']*)'/.exec(onb)?.[1] ?? 'punch'));
}

// pricing.html tier cards
function tierBlocks(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of src.split('<div class="tier-card')) {
    const name = /<h2>([^<]+)<\/h2>/.exec(chunk)?.[1]?.trim().toLowerCase();
    if (name) out[name] = chunk;
  }
  return out;
}
const cards = tierBlocks(pricingHtml);
const PLACEMENT: { pattern: RegExp; key: FeatureKey }[] = [
  { pattern: /RFIs?\s*(&amp;|&|and)\s*submittals/i, key: 'rfis_submittals' },
  { pattern: /Plans \+ drawing markup/i, key: 'plan_markup' },
  { pattern: /Punch list/i, key: 'punch_list_closeout' },
  { pattern: /Subcontractor management/i, key: 'subcontractor_management' },
  { pattern: /Ask Your Plans/i, key: 'ask_your_plans' },
];
for (const { pattern, key } of PLACEMENT) {
  const tier = REQUIRED_TIER[key];
  const home = tier === 'free' ? 'free' : tier;
  ok(`pricing.html sells /${pattern.source.slice(0, 24)}/ in the ${home} card (${key}='${tier}')`, pattern.test(cards[home] ?? ''));
  const higher = home === 'pro' ? ['business', 'enterprise'] : [];
  for (const t of higher) {
    ok(`…and not again, as if new, in the ${t} card`, !pattern.test(cards[t] ?? ''));
  }
}

// ── #175 / #127 Free card ───────────────────────────────────────────────────
console.log('\n#175 / #127 — the Free card:');
const freeCard = cards.free ?? '';
ok('voice is a 3-try trial on Free, not an included feature', /voice fill: 3 free tries/.test(freeCard) && !/voice-to-log<\/li>/.test(freeCard));
ok('no free takeoff trial is claimed (aiTakeoff is proOnly)', !/free AI trials \([^)]*takeoff/i.test(freeCard));
ok('the cap is "1 project (finished jobs still count)", not "1 active project"', /1 project \(finished jobs still count\)/.test(freeCard) && !/1 active project/.test(freeCard));
ok('no page copy says awarded jobs are free', !/awarded[^.<]{0,40}(don.t|do not|never) count/i.test(pricingHtml));
// The demo page's FAQ said "Free tier with one active project" — the cap
// counts finished jobs too (integration review, wave 5).
const demoHtml = read('marketing/demo.html');
ok('demo.html FAQ: one project of your own, finished jobs still count — no "one active project"',
  /Free covers one project of your own \(finished jobs still count\)/.test(demoHtml) && !/one active project/i.test(demoHtml));

// ── #176 support routes ─────────────────────────────────────────────────────
console.log('\n#176 — cancelling names both routes:');
const support = html('marketing/support.html');
const cancel = /How do I cancel my subscription\?<\/strong>\s*<p>([\s\S]*?)<\/p>/.exec(support)?.[1] ?? '';
ok('support: store subscribers → Settings → Manage Subscription', /Manage Subscription/.test(cancel));
ok('support: plans MAGE ID turned on → email help@mageid.app', /help@mageid\.app/.test(cancel) && /turned your plan on/.test(cancel));
ok('support: the one-route promise is gone', !/From Settings → Subscription, you can cancel or change plans anytime/.test(support));

// ── #129 per-package gate ───────────────────────────────────────────────────
console.log('\n#129 — a plan the store cannot sell leads to an email:');
{
  const screen = code(read('app/paywall.tsx'));
  ok('each card is gated on its own package', /enterprise: packagesLoaded && !enterprisePackage/.test(screen)
    && /pro: packagesLoaded && !proPackage/.test(screen) && /business: packagesLoaded && !businessPackage/.test(screen));
  ok('the unavailable Enterprise card says "Contact us for Enterprise"', /\{unavailable\.enterprise \? \([\s\S]{0,200}label="Contact us for Enterprise"/.test(screen));
  ok('…and opens mailto:support@mageid.app with an Enterprise subject', /mailto:support@mageid\.app\?subject=\$\{encodeURIComponent\(`MAGE ID \$\{plan\}`\)\}/.test(screen));
  ok('no purchase error text reaches showAlert', !/showAlert\([^)]*\bmsg\b/.test(screen) && !/showAlert\([^)]*err\.message/.test(screen));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
