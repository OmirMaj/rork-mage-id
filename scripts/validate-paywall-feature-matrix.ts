// validate-paywall-feature-matrix.ts — the pricing table must not out-price
// the gate.
//
// WHY THIS EXISTS. app/paywall.tsx renders the free/pro/business comparison
// grid. Every column used to be a hand-typed boolean, and one of them was
// wrong: "Plan Viewer · Sheet Pinning" shipped as
//
//     { label: 'Plan Viewer · Sheet Pinning (Android: beta)',
//       free: false, pro: false, business: true }
//
// — an XCircle in the Pro column for a feature the code unlocks at Pro
// (plan_markup = 'pro' in utils/featureTiers.ts, checked identically at
// app/plans.tsx:218 and app/plan-viewer.tsx:79). A Pro subscriber who wanted
// the plan viewer read the pricing table, concluded they had to move to
// Business, and was quoted an extra $50/mo for something already inside the
// plan they were paying for. The file's own header asserts rows appear "ONLY
// if there is a real, enforced gate", so the table was actively mispricing the
// product against itself.
//
// THE RULE ENFORCED HERE: a comparison row that corresponds to a FeatureKey
// must DERIVE its columns from REQUIRED_TIER (via the `key:` form), never
// restate them. Derivation makes the class of bug structurally impossible —
// there is no second number to get wrong.
//
// Literal rows are still allowed, because three kinds of row genuinely have no
// single FeatureKey: always-on rows, and AI features metered by
// utils/aiRateLimiter FEATURE_CONFIG (`proOnly` / `freeLifetimeCap`) rather
// than by a tier gate. Those must be named in LITERAL_ROW_ALLOWLIST below with
// a reason, so a new hand-typed row fails this guard until someone justifies
// it rather than sliding in by copy-paste.
//
// Companion to scripts/validate-paywall-tiers.ts, which enforces the same idea
// one layer down (a <Paywall requiredTier> literal vs. the gate behind it).
//
// Run via: bun run scripts/validate-paywall-feature-matrix.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REQUIRED_TIER, tierMeetsRequirement } from '@/utils/featureTiers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\npaywall feature matrix (columns derived from featureTiers.ts):');

const src = readFileSync(join(ROOT, 'app', 'paywall.tsx'), 'utf8');

// The rows whose access is genuinely not one FeatureKey. Anything else that
// hand-types columns is the defect this guard exists to stop.
const LITERAL_ROW_ALLOWLIST: Record<string, string> = {
  'Unlimited Projects': 'ungated — nothing checks a FeatureKey',
  'Manual Estimates': 'ungated — nothing checks a FeatureKey',
  'Manual Daily Reports': 'ungated — nothing checks a FeatureKey',
  'AI Takeoff (PDF → LF/SF)': "metered by FEATURE_CONFIG.aiTakeoff (proOnly), not a tier gate",
  'Voice-to-Report (Android: beta)': 'metered by FEATURE_CONFIG.voiceCapture (freeLifetimeCap), not a tier gate',
  'AI Photo Triage / Punch': 'spans two gates (photo_documentation Pro + punch_list_closeout Business)',
};

// Isolate the spec table so unrelated tables (FINTECH_PERKS, AI_LIMITS) and
// prose can never be parsed as feature rows.
const start = src.indexOf('const FEATURE_SPECS');
const end = src.indexOf('\n];', start);
ok('FEATURE_SPECS was found in app/paywall.tsx', start !== -1 && end > start,
  'the comparison table was renamed or reshaped — this guard is now blind');
const table = start !== -1 && end > start ? src.slice(start, end) : '';

// The table must be built through the derivation helper. Without this, a
// future edit can reintroduce a fully hand-typed FEATURES array and every
// other assertion here silently stops applying.
ok('FEATURES is derived from FEATURE_SPECS via toFeatureRow',
  /const\s+FEATURES\s*:\s*FeatureRow\[\]\s*=\s*FEATURE_SPECS\.map\(toFeatureRow\)/.test(src),
  'FEATURES must be FEATURE_SPECS.map(toFeatureRow) so keyed rows cannot be hand-typed');

ok('toFeatureRow derives each column with tierMeetsRequirement(REQUIRED_TIER[key])',
  /REQUIRED_TIER\[spec\.key\]/.test(src) && /tierMeetsRequirement\('pro',\s*required\)/.test(src),
  'the helper no longer reads the single source of truth');

// Every row in the table, in order: either `key: '<featureKey>'` or literals.
const rowRe = /\{\s*label:\s*'((?:[^'\\]|\\.)*)'\s*,\s*(key:\s*'([a-z0-9_]+)'|free:)/g;
const keyed: { label: string; key: string }[] = [];
const literal: string[] = [];
for (const m of table.matchAll(rowRe)) {
  const label = m[1].replace(/\\'/g, "'");
  if (m[3]) keyed.push({ label, key: m[3] });
  else literal.push(label);
}

ok('the comparison rows parsed', keyed.length + literal.length >= 15,
  `parsed only ${keyed.length + literal.length} rows — the row shape changed`);

const badKeys = keyed.filter(r => !(r.key in REQUIRED_TIER));
ok('every keyed row names a real FeatureKey', badKeys.length === 0,
  badKeys.map(r => `${r.label} → '${r.key}' is not in REQUIRED_TIER`).join('\n        '));

const unjustified = literal.filter(l => !(l in LITERAL_ROW_ALLOWLIST));
ok(
  'no row hand-types its columns without a stated reason',
  unjustified.length === 0,
  unjustified.length === 0 ? undefined :
    `${unjustified.length} hand-typed row(s):\n` +
    unjustified.map(l => `        • ${l}`).join('\n') +
    "\n\n      Give the row `key: '<featureKey>'` so its columns derive from " +
    'featureTiers.ts, or add it to LITERAL_ROW_ALLOWLIST here with the reason ' +
    'its access is not a single FeatureKey.',
);

// The specific row this guard was written for. Pinned by name because it is
// the one that cost a Pro subscriber a $50/mo upsell they did not need.
const planViewer = keyed.find(r => r.label.startsWith('Plan Viewer'));
ok("the Plan Viewer row derives from 'plan_markup'", planViewer?.key === 'plan_markup',
  planViewer
    ? `it derives from '${planViewer.key}' instead`
    : 'the Plan Viewer row is hand-typed (or gone) — it read "Business only" for a Pro feature');
ok('…and therefore shows a check in the Pro column',
  !!planViewer && tierMeetsRequirement('pro', REQUIRED_TIER.plan_markup),
  `plan_markup is '${REQUIRED_TIER.plan_markup}' — if that is intentional, the ` +
  'gates at app/plans.tsx and app/plan-viewer.tsx must move with it');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
