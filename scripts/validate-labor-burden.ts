// validate-labor-burden.ts — pins the labor-burden guardrail.
//
// WHY THIS EXISTS. The cost book learns labor cost from the $/hr rates a GC
// types in time-tracking. If those are BARE wages (no payroll tax, workers'
// comp, GL, PTO, vehicle, small tools), every estimate the moat "improves"
// prices labor 25-48% low — the engine confidently learns to bid at a loss.
//
// The fix is a NUDGE, never a silent multiply: the UI already asks for a
// loaded rate, so auto-applying a burden factor would DOUBLE-count for the GC
// who followed instructions, and real burden varies by state, carrier, and
// trade code (which is exactly why it's a moat and not a copyable constant).
// So we only DETECT a rate that looks unloaded and flag it, and offer to
// compute a loaded rate on demand.
//
// Pins INTENDED semantics:
//   • looksLikeBareWage flags a plainly-unloaded rate for the trade…
//   • …and stays quiet for a properly loaded rate, and for empty/zero input
//   • burden varies by trade — roofing/structural high, laborer/landscape low
//   • applyBurden is the OPT-IN helper: bare × (1+burden), rounded to 2dp,
//     and is defined (never NaN) for junk input
//   • categoryForTrade routes free-form keys by keyword, defaulting to general
//
// Run via: bun run test:labor-burden

import {
  looksLikeBareWage,
  applyBurden,
  burdenPctForTrade,
  burdenPercentLabel,
  categoryForTrade,
  BURDEN_BY_CATEGORY,
} from '../utils/laborBurdenModel';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}
function approx(a: number, b: number, eps = 0.001) {
  return Math.abs(a - b) < eps;
}

// --- looksLikeBareWage flags unloaded rates ---------------------------------
// A carpenter (structural, 40% burden, bare-low ~22) at a bare $22/hr is clearly
// unloaded; loaded should be ~$30+.
check('carpenter $22 bare wage is flagged', looksLikeBareWage('carpenter', 22));
check('carpenter $19 (below bare-low) is flagged', looksLikeBareWage('carpenter', 19));
check('roofer $19 bare wage is flagged', looksLikeBareWage('roofer', 19));
check('laborer $14 bare wage is flagged', looksLikeBareWage('general laborer', 14));

// --- …and stays quiet for loaded rates and empty input ----------------------
check('carpenter $34 loaded rate is NOT flagged', !looksLikeBareWage('carpenter', 34));
check('roofer $30 loaded rate is NOT flagged', !looksLikeBareWage('roofer', 30));
check('empty input (0) is NOT flagged', !looksLikeBareWage('carpenter', 0));
check('negative input is NOT flagged', !looksLikeBareWage('carpenter', -5));
check('NaN input is NOT flagged', !looksLikeBareWage('carpenter', NaN));

// --- burden varies by trade -------------------------------------------------
check('roofing burden > general burden', burdenPctForTrade('roofer') > burdenPctForTrade('general laborer'));
check('structural burden > landscape burden', burdenPctForTrade('carpenter') > burdenPctForTrade('landscaper'));
check('roofing burden is the ceiling (0.48)', approx(BURDEN_BY_CATEGORY.roofing, 0.48));
check('landscape burden is the floor (0.26)', approx(BURDEN_BY_CATEGORY.landscape, 0.26));

// --- applyBurden: opt-in helper, 2dp, safe on junk --------------------------
// carpenter bare $28.50 × 1.40 = $39.90
check('applyBurden(28.50, carpenter) = 39.90', approx(applyBurden(28.5, 'carpenter'), 39.9));
check('applyBurden rounds to 2 decimals', approx(applyBurden(33.33, 'carpenter'), Math.round(33.33 * 1.4 * 100) / 100));
check('applyBurden(0) = 0 (no NaN)', applyBurden(0, 'carpenter') === 0);
check('applyBurden(NaN) = 0 (no NaN)', applyBurden(NaN, 'carpenter') === 0);
check('applyBurden always raises a positive wage', applyBurden(25, 'plumber') > 25);

// --- categoryForTrade routing -----------------------------------------------
check('carpenter → structural', categoryForTrade('carpenter') === 'structural');
check('master electrician → electrical', categoryForTrade('Master Electrician') === 'electrical');
check('pipefitter → plumbing', categoryForTrade('pipefitter') === 'plumbing');
check('sheet metal → hvac', categoryForTrade('Sheet Metal Worker') === 'hvac');
check('unknown trade → general', categoryForTrade('zamboni driver') === 'general');
check('empty key → general (no throw)', categoryForTrade('') === 'general');

// --- display label is a whole percent ---------------------------------------
check('burdenPercentLabel(roofer) = 48', burdenPercentLabel('roofer') === 48);
check('burdenPercentLabel is an integer', Number.isInteger(burdenPercentLabel('carpenter')));

if (failures > 0) {
  console.error(`\n✗ validate-labor-burden: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-labor-burden: all checks passed');
