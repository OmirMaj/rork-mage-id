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
ok("Pro card lists 'Unlimited projects' + planCardLines('pro')", /features: \['Unlimited projects', \.\.\.planCardLines\('pro'\)\]/.test(cards));
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
ok('the plan viewer is on the Pro card', planFeatureLines('pro').some((l) => /Plan Viewer/.test(l)));

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
ok('the row reads planSource (CONTRACT 1)', /const \{ planSource[^}]*\} = useSubscription\(\);/.test(src));
ok("the store deep link is only for planSource 'store' on iOS/Android",
  /if \(planSource === 'store' && \(Platform\.OS === 'ios' \|\| Platform\.OS === 'android'\)\)/.test(src));
ok('no apps.apple.com link for the web', !/'https:\/\/apps\.apple\.com\/account\/subscriptions'/.test(src));
ok('a hand-granted plan: "Your plan was turned on by MAGE ID" + mailto help@mageid.app',
  /label: 'Your plan was turned on by MAGE ID'/.test(src)
  && /'mailto:help@mageid\.app\?subject=Change%20my%20MAGE%20ID%20plan'/.test(src)
  && /Email help@mageid\.app to change or cancel \\u2014 nothing is deleted/.test(src));
ok('never "no support call needed"', !/no support call needed/.test(src));
ok('the Free-card downgrade alert uses the same branch', /showAlert\('Switch to Free', planChangeRoute\.downgradeMessage\)/.test(src));
ok('the downgrade copy no longer sends him to support@', !/To downgrade to Free[^']*support@mageid\.app/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
