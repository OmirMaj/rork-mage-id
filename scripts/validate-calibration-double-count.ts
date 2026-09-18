// validate-calibration-double-count.ts — "Apply your cost corrections" must
// not count his bias twice (audit round 2, #2).
// Run via: bun run scripts/validate-calibration-double-count.ts
//
// THE BUG. Two mechanisms correct the same bias:
//   (a) utils/costDatabase suggestedRate already moves his rate toward actuals
//       (baseline·(1−w) + personal·w);
//   (b) utils/estimateCalibration measures bias = actual ÷ OLD BID on the same
//       closed jobs, and the ×multiplier he saves was applied by
//       app/estimate-confidence → applyCalibrationToEstimate to EVERY line in
//       the category, whatever its price came from.
// Repro: 3 closed jobs, 400 SF of Tile bid at $10/SF, settled at $12/SF. Book
// rate $11, calibration ×1.20. A new Tile line priced at the book's $11 read
// 'Aligned'; Apply took it to $13.20 and the same screen flagged it 'Padded'
// and dropped it out of backedCost.
//
// Pins:
//   1. the repro: book rate 11, bias 1.20;
//   2. a line AT the book rate comes out of Apply unchanged, still 'aligned',
//      backedCost does not drop, and the result names it as skipped;
//   3. a line clearly below the book rate moves only UP TO the rate it is
//      backed by ($9.50 → $11, not $11.40), never past, and then reads
//      'aligned'; one inside the aligned band (his old $10) is left alone;
//   4. a line whose category has NO book entry takes the full multiplier;
//   5. the stamp is per changed line — a revisit is a no-op, and a skipped
//      line is not banked as corrected;
//   6. WIRING: estimate-confidence passes its line checks; the wizard's
//      calibration sentence skips trades already grounded in the prompt;
//      ALIGNED_BAND equals estimateConfidence's DEVIATION_THRESHOLD.
import { readFileSync } from 'node:fs';
import { buildCostDatabase, lookupRate } from '../utils/costDatabase';
import { computeCalibration } from '../utils/estimateCalibration';
import { computeEstimateConfidence } from '../utils/estimateConfidence';
import { applyCalibrationToEstimate, ALIGNED_BAND } from '../utils/applyCalibration';
import type { Project, Commitment, LinkedEstimate } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function estimate(items: Array<{ id: string; name: string; category: string; unit: string; qty: number; price: number }>): LinkedEstimate {
  const its = items.map(i => ({
    materialId: i.id, name: i.name, category: i.category, unit: i.unit, quantity: i.qty,
    unitPrice: i.price, bulkPrice: i.price, markup: 0, usesBulk: false, lineTotal: i.price * i.qty, supplier: '',
  }));
  const total = its.reduce((s, i) => s + i.lineTotal, 0);
  return { id: 'e', items: its, globalMarkup: 0, baseTotal: total, markupTotal: 0, grandTotal: total, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as LinkedEstimate;
}

// ── the three closed Tile jobs ──────────────────────────────────────────────
const projects: Project[] = [];
const commitments: Commitment[] = [];
for (const n of [1, 2, 3]) {
  const id = `tile-${n}`;
  projects.push({
    id, name: id, type: 'remodel', status: 'completed', closedAt: `2026-0${n}-15`,
    linkedEstimate: estimate([{ id: 'm0', name: 'Floor tile', category: 'Tile', unit: 'SF', qty: 400, price: 10 }]),
  } as unknown as Project);
  commitments.push({
    id: `c-${n}`, projectId: id, number: `BO-${n}`, type: 'subcontract', description: 'Tile sub',
    amount: 4800, changeAmount: 0, paidToDate: 4800, signedDate: `2026-0${n}-01`,
    linkedEstimateItems: ['m0'], status: 'active',
  } as unknown as Commitment);
}
const db = buildCostDatabase(projects, commitments);
const entry = lookupRate(db, 'Tile', 'SF');
const cal = computeCalibration({ projects, commitments });
const tileCal = cal.categories.find(c => c.category === 'Tile');

console.log('\n1. the repro');
ok('book rate for Tile is $11.00 (baseline 10, personal 12, w = 3/(3+3))', !!entry && r2(entry.suggestedRate) === 11, `got ${entry?.suggestedRate}`);
ok('book has 3 closed jobs behind it', entry?.jobCount === 3, `got ${entry?.jobCount}`);
ok('calibration suggests ×1.20 on Tile', tileCal?.suggestedMultiplier === 1.2, `got ${tileCal?.suggestedMultiplier}`);
const corrections = [{ category: 'Tile', multiplier: 1.2, appliedAt: '2026-04-01T00:00:00.000Z' }] as never[];

// ── 2. a line AT the book rate ──────────────────────────────────────────────
console.log('\n2. a line priced at the book rate is left alone');
const atRate = { id: 'new', name: 'New bath', linkedEstimate: estimate([{ id: 'n0', name: 'Floor tile', category: 'Tile', unit: 'SF', qty: 400, price: 11 }]) } as unknown as Project;
const before = computeEstimateConfidence(atRate, db);
ok('before Apply the line reads aligned', before.lines[0].flag === 'aligned', `got ${before.lines[0].flag}`);
const applied = applyCalibrationToEstimate(atRate.linkedEstimate!, corrections, { lineChecks: before.lines });
const after = computeEstimateConfidence({ ...atRate, linkedEstimate: applied.estimate } as Project, db);
ok('Apply leaves the $11 line at $11 (it was $13.20)', r2(applied.estimate.items[0].unitPrice) === 11, `got ${applied.estimate.items[0].unitPrice}`);
ok('…still aligned, not Padded', after.lines[0].flag === 'aligned', `got ${after.lines[0].flag}`);
ok('…backedCost does not drop', after.backedCost >= before.backedCost, `${before.backedCost} → ${after.backedCost}`);
ok('…and the result names it as skipped at his book rate',
  applied.changedCount === 0 && applied.skippedAtBookRate.length === 1 && applied.skippedAtBookRate[0].name === 'Floor tile');
ok('…and it is NOT reported as "already applied" (nothing was)', applied.alreadyApplied === false);

// ── 3. a line below the book rate ───────────────────────────────────────────
// The evidence rate is the one this screen grades against (the book's
// suggestedRate, EstimateLineCheck.learnedRate). A line within the 'aligned'
// band of it is already where his jobs put it and is left alone — his old $10
// is 9% under $11 and the screen calls it aligned. A line clearly under it
// moves toward it by at most the multiplier, and never past it.
console.log('\n3. a line below the book rate moves only up to the rate his jobs support');
const lineAt = (price: number) => ({ id: `p${price}`, name: 'Bid', linkedEstimate: estimate([{ id: 'o0', name: 'Floor tile', category: 'Tile', unit: 'SF', qty: 400, price }]) } as unknown as Project);
const tenApplied = applyCalibrationToEstimate(lineAt(10).linkedEstimate!, corrections, { lineChecks: computeEstimateConfidence(lineAt(10), db).lines });
ok('his old $10 (inside the aligned band of $11) is left alone, not taken to $12',
  r2(tenApplied.estimate.items[0].unitPrice) === 10 && tenApplied.skippedAtBookRate.length === 1);
const low = lineAt(9.5);
const lowBefore = computeEstimateConfidence(low, db);
ok('a $9.50 line reads underpriced before Apply', lowBefore.lines[0].flag === 'underpriced', `got ${lowBefore.lines[0].flag}`);
const lowApplied = applyCalibrationToEstimate(low.linkedEstimate!, corrections, { lineChecks: lowBefore.lines });
ok('…lands on $11 (his book rate), not $11.40 (×1.20)', r2(lowApplied.estimate.items[0].unitPrice) === 11, `got ${lowApplied.estimate.items[0].unitPrice}`);
ok('…reported as capped to his measured rate', lowApplied.cappedToBookRate === 1);
ok('…lineTotal and grandTotal follow', r2(lowApplied.estimate.items[0].lineTotal) === 4400 && r2(lowApplied.estimate.grandTotal) === 4400);
const lowAfter = computeEstimateConfidence({ ...low, linkedEstimate: lowApplied.estimate } as Project, db);
ok('…and then reads aligned', lowAfter.lines[0].flag === 'aligned', `got ${lowAfter.lines[0].flag}`);
const again = applyCalibrationToEstimate(lowApplied.estimate, corrections, { lineChecks: lowAfter.lines });
ok('a revisit is a no-op (already applied)', again.changedCount === 0 && again.alreadyApplied === true);
const deep = lineAt(8);
const deepApplied = applyCalibrationToEstimate(deep.linkedEstimate!, corrections, { lineChecks: computeEstimateConfidence(deep, db).lines });
ok('a line far below the rate takes the multiplier and no more ($8 → $9.60)', r2(deepApplied.estimate.items[0].unitPrice) === 9.6);

// ── 4. no book entry: the multiplier is the only evidence ──────────────────
console.log('\n4. a category with no book entry takes the full multiplier');
const noBook = { id: 'nb', name: 'No book', linkedEstimate: estimate([{ id: 'x0', name: 'Wall tile', category: 'Tile', unit: 'EA', qty: 10, price: 50 }]) } as unknown as Project;
const nbChecks = computeEstimateConfidence(noBook, db).lines;
ok('the EA line has no book entry (flag unknown)', nbChecks[0].flag === 'unknown');
const nbApplied = applyCalibrationToEstimate(noBook.linkedEstimate!, corrections, { lineChecks: nbChecks });
ok('…and takes ×1.20 ($50 → $60)', r2(nbApplied.estimate.items[0].unitPrice) === 60, `got ${nbApplied.estimate.items[0].unitPrice}`);

// ── 5. stamps are per changed line ──────────────────────────────────────────
console.log('\n5. only lines it changed are recorded as corrected');
const mixed = { id: 'mx', name: 'Mixed', linkedEstimate: estimate([
  { id: 'a', name: 'At rate', category: 'Tile', unit: 'SF', qty: 100, price: 11 },
  { id: 'b', name: 'Under', category: 'Tile', unit: 'SF', qty: 100, price: 9.5 },
]) } as unknown as Project;
const mxApplied = applyCalibrationToEstimate(mixed.linkedEstimate!, corrections, { lineChecks: computeEstimateConfidence(mixed, db).lines });
const byLine = (mxApplied.estimate as unknown as { calibrationAppliedByLine?: Record<string, number> }).calibrationAppliedByLine ?? {};
ok('the changed line is stamped', byLine.b === 1.2);
ok('the skipped line is not', byLine.a === undefined);
// He later reprices the skipped line down to $9: the correction now reaches it.
const repriced = { ...mixed, linkedEstimate: { ...mxApplied.estimate, items: mxApplied.estimate.items.map(i => i.materialId === 'a' ? { ...i, unitPrice: 9, bulkPrice: 9, lineTotal: 900 } : i) } } as unknown as Project;
const rpApplied = applyCalibrationToEstimate(repriced.linkedEstimate!, corrections, { lineChecks: computeEstimateConfidence(repriced, db).lines });
ok('a skipped line priced below the rate later still takes the correction ($9 → $10.80)',
  r2(rpApplied.estimate.items.find(i => i.materialId === 'a')!.unitPrice) === 10.8);

// ── 6. wiring ───────────────────────────────────────────────────────────────
console.log('\n6. wiring');
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
ok('estimate-confidence passes its line checks into Apply',
  /applyCalibrationToEstimate\(project\.linkedEstimate, corrections, \{ lineChecks: report\?\.lines/.test(read('app/estimate-confidence.tsx')));
ok('estimate-confidence names the skipped lines in the CTA', /skippedAtBookRate/.test(read('app/estimate-confidence.tsx')));
const wiz = read('app/estimate-wizard.tsx');
ok('the wizard hands the prompt\'s grounded entries to calibrationFactFor',
  /calibrationFactFor\(projects, commitments, entries\)/.test(wiz));
ok('calibrationFactFor skips a category whose trade is grounded', /!grounded\.has\(key\(c\.category\)\)/.test(wiz));
const thr = /const DEVIATION_THRESHOLD = ([0-9.]+);/.exec(read('utils/estimateConfidence.ts'));
ok('ALIGNED_BAND matches estimateConfidence DEVIATION_THRESHOLD', !!thr && Number(thr[1]) === ALIGNED_BAND);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
