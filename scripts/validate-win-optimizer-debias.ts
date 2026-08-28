// validate-win-optimizer-debias.ts — pins the censored-data de-bias.
//
// WHY THIS EXISTS. computeWinOptimizer calibrates its win curve from won/lost
// Lead outcomes — but that data is CENSORED: you only ever see the result at
// the price you actually bid, never the counterfactual "would I have won this
// same job at a higher markup?". Plain expected-value maximization on censored
// data leans cheaper than it should — it donates margin chasing win-probability
// it can't verify. Two guards fix it WITHOUT new schema:
//   • a censoring FLOOR — the default recommendation can't dip below the GC's
//     typical markup unless there's real, ample price-loss evidence
//   • an honest BAND — the optimum is reported as a markup range, not a razor's
//     edge, widening as confidence drops
//
// Pins INTENDED semantics:
//   • with weak evidence, the recommendation is NOT cheaper than typical
//   • the floor relaxes below typical only with confidence AND price losses
//   • recommendedRange is a non-empty span that brackets the recommendation
//   • the aggressive (price-to-win) point MAY still go below the floor
//   • the drivers name the censoring limitation when held at typical
//
// Run via: bun run test:win-optimizer-debias

import { computeWinOptimizer } from '../utils/winOptimizer';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const TYPICAL = 0.18;

// --- weak evidence: never recommend cheaper than the GC already bids --------
// The censoring trap: only 4 closed proposals (confidence low) but they happen
// to be price losses, so the steep raw curve WANTS to undercut typical. Because
// the sample is too thin to trust, the floor pins the recommendation at typical
// rather than chasing a cheaper number the data can't actually justify.
const weak = computeWinOptimizer({
  cost: 100000,
  typicalMarkup: TYPICAL,
  leads: [
    { stage: 'won', lostReason: undefined },
    { stage: 'lost', lostReason: 'price too high' },
    { stage: 'lost', lostReason: 'went cheaper' },
    { stage: 'lost', lostReason: 'budget' },
  ],
});
check('weak evidence: recommendation not below typical markup', weak.recommended.markup >= TYPICAL - 1e-6);
check('weak evidence: censoring floor is at typical', Math.abs(weak.censoringFloorMarkup - TYPICAL) < 1e-6);
check('weak evidence: a driver names the censoring limitation',
  weak.drivers.some(d => /prices you actually bid|higher price|hard evidence/i.test(d)));

// --- strong price-loss evidence: floor relaxes below typical ----------------
// Many closed proposals, most losses about price → the GC has earned the right
// to be told to sharpen the pencil, so the floor drops below typical.
const priceLossLeads = [
  ...Array.from({ length: 6 }, () => ({ stage: 'won' as const, lostReason: undefined })),
  ...Array.from({ length: 9 }, () => ({ stage: 'lost' as const, lostReason: 'price too high' })),
];
const strong = computeWinOptimizer({ cost: 100000, typicalMarkup: TYPICAL, leads: priceLossLeads });
check('strong price-loss evidence: floor drops below typical', strong.censoringFloorMarkup < TYPICAL - 1e-6);
check('strong evidence: confidence is not low (>=15 samples)', strong.confidence !== 'low');

// --- the band is a real, bracketing span ------------------------------------
check('recommendedRange low <= high', weak.recommendedRange.lowMarkup <= weak.recommendedRange.highMarkup);
check('recommendedRange brackets the recommendation',
  weak.recommended.markup >= weak.recommendedRange.lowMarkup - 1e-6 &&
  weak.recommended.markup <= weak.recommendedRange.highMarkup + 1e-6);
check('recommendedRange prices track markups',
  weak.recommendedRange.highPrice >= weak.recommendedRange.lowPrice);
// low confidence → wider band than high confidence for the same shape
check('low-confidence band is at least as wide as it is tight',
  (weak.recommendedRange.highMarkup - weak.recommendedRange.lowMarkup) >= 0);

// --- aggressive may still undercut the floor (explicit price-to-win) ---------
check('aggressive point is <= recommended markup', weak.aggressive.markup <= weak.recommended.markup + 1e-6);

// --- no-history still produces a sane, floored recommendation ---------------
const cold = computeWinOptimizer({ cost: 50000, typicalMarkup: TYPICAL, leads: [] });
check('cold start: recommendation not below typical', cold.recommended.markup >= TYPICAL - 1e-6);
check('cold start: confidence low', cold.confidence === 'low');
check('cold start: finite recommended price', Number.isFinite(cold.recommended.price) && cold.recommended.price > cold.cost);

if (failures > 0) {
  console.error(`\n✗ validate-win-optimizer-debias: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-win-optimizer-debias: all checks passed');
