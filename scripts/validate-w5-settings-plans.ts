// validate-w5-settings-plans.ts — audit wave 5, lane settings, #134 (+ #127,
// #176 carries).
//
// The Settings plan cards and FAQ were typed lists that had drifted from the
// gates: Free "No cloud sync" (sync has no tier), "No PDF export" / "No
// schedule maker" (neither gated), Pro sold "Cloud sync", "Daily field
// reports" and "Material price alerts" (open on Free), the FAQ put RFIs /
// submittals and the plan viewer on Business (both Pro). The cards are now
// built from utils/planFeatureCopy (which reads REQUIRED_TIER) plus a short
// Settings-only list whose FeatureKeys this script checks against the gates.
//
// Run: bun run scripts/validate-w5-settings-plans.ts

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { REQUIRED_TIER, type FeatureKey } from '../utils/featureTiers';
import { planFeatureLines, planFeatureBlurb } from '../utils/planFeatureCopy';
import { manageSubscriptionRoute, APPLE_SUBSCRIPTIONS_IOS_URL, GOOGLE_PLAY_SUBSCRIPTIONS_URL } from '../utils/manageSubscription';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const raw = read('app/(tabs)/settings/index.tsx');
const src = stripComments(raw);

console.log('\n── the plan cards are built from the gates ──');
const cardsAt = src.indexOf("id: 'free' as const");
const cardsEnd = src.indexOf("id: 'enterprise' as const");
const cards = cardsAt > -1 && cardsEnd > cardsAt ? src.slice(cardsAt, cardsEnd) : '';
ok('the Free/Pro/Business card block was found', cards.length > 0);
ok("Pro card lists 'More Than One Project' + planCardLines('pro')", /features: \['More Than One Project', \.\.\.planCardLines\('pro'\)\]/.test(cards));
ok("Business card lists 'Everything in Pro' + planCardLines('business')", /features: \['Everything in Pro', \.\.\.planCardLines\('business'\)\]/.test(cards));
ok('planCardLines reads planFeatureLines and filters the extra lines by lineTier',
  /\.\.\.planFeatureLines\(tier\),\s*\.\.\.SETTINGS_EXTRA_PLAN_LINES\.filter\(\(l\) => lineTier\(l\) === tier\)/.test(src));
for (const banned of ['No cloud sync', "'Cloud sync'", 'No PDF export', 'No schedule maker', 'Branded PDF export', 'Material price alerts', '1 active project']) {
  ok(`no card or FAQ says ${banned}`, !src.includes(banned));
}
ok("Free's missing features are read from the Pro gates", /disabled: \[`Not on Free: \$\{planFeatureBlurb\('pro'\)\}`\]/.test(cards));

console.log('\n── Settings-only lines sit on the tier their gate requires ──');
const extraBlock = /const SETTINGS_EXTRA_PLAN_LINES: PlanFeatureLine\[\] = \[([\s\S]*?)\];/.exec(src)?.[1] ?? '';
const extraKeys = [...extraBlock.matchAll(/keys: \[([^\]]*)\]/g)].map((m) => m[1].split(',').map((k) => k.trim().replace(/'/g, '')).filter(Boolean));
ok('the extra lines each name a FeatureKey', extraKeys.length >= 1 && extraKeys.every((ks) => ks.length > 0), extraBlock);
for (const ks of extraKeys) {
  const tiers = new Set(ks.map((k) => REQUIRED_TIER[k as FeatureKey]));
  ok(`extra line [${ks.join(', ')}] names real keys that share one paid tier`,
    ks.every((k) => k in REQUIRED_TIER) && tiers.size === 1 && !tiers.has('free'), [...tiers].join(','));
}
ok('RFIs & Submittals is on the Pro card, not Business',
  planFeatureLines('pro').some((l) => /RFIs/.test(l)) && !planFeatureLines('business').some((l) => /RFIs/.test(l)));
ok('the plan viewer is on the Pro card', planFeatureLines('pro').some((l) => /Plan viewer/i.test(l)));

console.log('\n── FAQ (#134, #127) ──');
ok('the FAQ tier answer is FREE_TIER_FAQ', /q: 'What\\u2019s the difference between Free, Pro and Business\?',\s*a: FREE_TIER_FAQ,/.test(src));
ok("FREE_TIER_FAQ reads planFeatureBlurb('pro') and ('business')",
  /\$\{planFeatureBlurb\('pro'\)\}/.test(src) && /\$\{planFeatureBlurb\('business'\)\}/.test(src));
ok("the business blurb no longer lists RFIs (they're Pro)", !/RFI/.test(planFeatureBlurb('business')));
ok('FAQ + Free card: finished jobs still count, shared jobs do not', /finished jobs still count/.test(src)
  && /jobs other contractors share with you don\\u2019t/.test(src));
ok('no copy says awarded / marketplace jobs are free (productDecision #127)', !/award[a-z]*[^.'`]{0,60}(free|don.t count|do not count)/i.test(src));
ok('the FAQ says every plan syncs', /every plan syncs/.test(src));
ok('prices come from constants/pricing (no typed $29/$79/$150)', !/'\$29\/mo'|'\$79\/mo'|'\$150\/mo'/.test(src) && /listPriceLabel\(t\)/.test(src));

console.log('\n── Manage Subscription follows where the plan came from (#176) ──');
// WEBCANCEL (2026-10-09): the route moved out of the screen into
// utils/manageSubscription (pure; run here), the words into
// hooks/useManageSubscriptionCopy and the row into
// components/ManageSubscriptionRow. scripts/validate-manage-subscription.ts
// holds the full set of states; these are the #176 pins, kept.
const rowSrc = stripComments(read('components/ManageSubscriptionRow.tsx'));
const hookSrc = stripComments(read('hooks/useManageSubscriptionCopy.ts'));
ok('the row reads where the plan came from (the entitlement’s store, CONTRACT 1)',
  /const store = sub\.planStore \?\? null;/.test(rowSrc) && /<ManageSubscriptionRow testID="manage-subscription" \/>/.test(src));
const route = (os: string, store: string | null, managementURL: string | null = null) =>
  manageSubscriptionRoute({ os, tier: 'business', store, managementURL, isOwner: false });
ok("the store deep link is only for the phone's own store",
  route('ios', 'APP_STORE').url === APPLE_SUBSCRIPTIONS_IOS_URL && route('android', 'PLAY_STORE').url === GOOGLE_PLAY_SUBSCRIPTIONS_URL
  && route('ios', null).url === null && route('ios', 'PLAY_STORE').url === null && route('android', 'APP_STORE').url === null && route('android', null).url === null
  && route('web', 'APP_STORE').url !== APPLE_SUBSCRIPTIONS_IOS_URL);
ok('on the web an apps.apple.com link is only for an App Store plan',
  /^https:\/\/apps\.apple\.com\//.test(route('web', 'APP_STORE').url ?? '')
  && [null, 'PLAY_STORE', 'RC_BILLING', 'STRIPE', 'PROMOTIONAL'].every((st) => !/apple\.com/.test(route('web', st).url ?? '')));
ok('a hand-granted plan: "Your Plan Was Turned On by MAGE ID" + mailto help@mageid.app',
  route('web', null).kind === 'by-hand' && route('web', null).url === 'mailto:help@mageid.app?subject=Change%20my%20MAGE%20ID%20plan'
  && /'office\.manageSub\.byHand\.label', 'Your Plan Was Turned On by MAGE ID'/.test(hookSrc)
  && /Email help@mageid\.app to change or cancel\. Nothing is deleted\./.test(hookSrc));
ok('never "no support call needed"', !/no support call needed/.test(src));
ok('the Free-card downgrade alert uses the same branch', /showAlert\('Switch to Free', manageSubscription\.lines\.downgrade\)/.test(src) && /const manageSubscription = useManageSubscription\(\);/.test(src));
ok('the downgrade copy no longer sends him to support@', !/To downgrade to Free[^']*support@mageid\.app/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
