// scripts/validate-w5-copilot-estimate.ts — audit wave 5, #7 + #38: the
// Copilot estimate is priced BEFORE review, carries a markup he chose inside
// every lineTotal, marks which prices are his, and says "priced from your
// jobs" only when his costs actually priced something.
//
// Before: grandTotal = base × 1.18 with every line at markup 0 (the next voice
// edit or calibration rebuilt grandTotal = Σ lineTotal and the 18% vanished);
// "priced from your jobs" whatever the cost book held; the review card had no
// total; Build silently replaced the job's estimate.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCopilotLinkedEstimate, buildCostItems, lineSourceFor, pricedHeadline, replaceWarning,
  resolveCopilotMarkup, copilotEstimateMarkup,
} from '../utils/copilot/estimate/estimatePricing';
import { matchGroundingEntries, buildEstimateGrounding } from '../utils/copilot/estimate/estimateGrounding';
import { estimateGaps, ESTIMATE_ASK_THRESHOLD } from '../utils/copilot/estimate/estimateGaps';
import { recomputeEstimate } from '../utils/copilot/estimateEdit/estimateOps';
import { interpretEstimateOps } from '../utils/copilot/estimateEdit/interpretEstimateOps';
import { MARKUP_CHOICES } from '../utils/estimateMarkup';
import { draftsToSeeds } from '../utils/costSeedCore';
import type { CopilotContext } from '../utils/copilot/types';
import type { Project } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''); }
}
const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

let n = 0;
const id = () => `m${++n}`;
const LINES = [
  { category: 'Demolition', name: 'Kitchen demo', unit: 'ls', quantity: 1, unitPrice: 2500, basis: 'regional' },
  { category: 'Tile', name: 'Floor tile install', unit: 'sf', quantity: 200, unitPrice: 12.35, basis: 'learned' },
  { category: 'Cabinets', name: 'Base cabinets', unit: 'lf', quantity: 18, unitPrice: 310.4, basis: 'learned' },
];
const TILE_ENTRY = [{ trade: 'Tile', provenance: 'earned' as const }];

(async () => {
  console.log('\n#7 — the markup lives inside lineTotal, so edits and recomputes keep it:');
  const cost = buildCostItems(LINES, TILE_ENTRY, id);
  const est = buildCopilotLinkedEstimate(cost, 18, 'e1', '2026-09-23T00:00:00Z');
  ok('every line carries the chosen 18%', est.items.every(i => i.markup === 18));
  ok('Σ lineTotal === grandTotal', sum(est.items.map(i => i.lineTotal)) === est.grandTotal, est);
  ok('baseTotal + markupTotal === grandTotal (to the cent)', Math.round((est.baseTotal + est.markupTotal) * 100) === Math.round(est.grandTotal * 100));
  ok('baseTotal is the cost (2500 + 2470 + 5587.20)', est.baseTotal === 10557.2, est.baseTotal);
  ok('grandTotal = cost × 1.18 line by line', est.grandTotal === sum(cost.map(i => Math.round(i.quantity * i.unitPrice * 1.18 * 100) / 100)), est.grandTotal);
  ok('unitPrice stays at COST (the cost engine learns from it)', est.items.every((i, k) => i.unitPrice === cost[k].unitPrice));
  ok('recomputeEstimate on a fresh build is a no-op', JSON.stringify(recomputeEstimate(est)) === JSON.stringify(est));
  {
    const { nextEstimate } = interpretEstimateOps([{ op: 'setQuantity', item: 'Floor tile install', quantity: 250 }], est);
    // tile 250 × 12.35 × 1.18 = 3643.25; the other two unchanged.
    const expected = sum([2950, 3643.25, est.items[2].lineTotal]);
    ok('build at 18% → voice setQuantity → grandTotal still includes the markup', nextEstimate.grandTotal === expected && nextEstimate.markupTotal > 0, { got: nextEstimate.grandTotal, expected });
  }
  ok('lines keep their price source through the build', (est.items as Array<{ priceSource?: string }>).map(i => i.priceSource).join(',') === 'regional,learned,regional');

  console.log('\n#7 — the markup is his, or it is asked:');
  ok('said → job → saved, in that order',
    resolveCopilotMarkup({ draftPct: 12, projectPct: 20, decidedPct: 25 })?.source === 'said'
    && resolveCopilotMarkup({ draftPct: null, projectPct: 20, decidedPct: 25 })?.source === 'job'
    && resolveCopilotMarkup({ draftPct: null, projectPct: null, decidedPct: 25 })?.pct === 25);
  ok('0% said in the interview is a decision (at cost)', resolveCopilotMarkup({ draftPct: 0 })?.pct === 0);
  ok('a job estimate at 0% is NOT read as a decision (the old wizard’s "never asked")', resolveCopilotMarkup({ projectPct: 0 }) === null);
  ok('nothing decided → null (never 18)', resolveCopilotMarkup({}) === null);
  {
    const ctx = (bag: Record<string, unknown>, project: Partial<Project> | null = null) => ({ project, ctx: bag } as unknown as CopilotContext);
    ok('saved markup is used only when markupDecided === true',
      copilotEstimateMarkup({}, ctx({ markupDecided: true, markup: 22 }))?.pct === 22
      && copilotEstimateMarkup({}, ctx({ markupDecided: false, markup: 15 })) === null
      && copilotEstimateMarkup({}, ctx({ markupDecided: null, markup: 15 })) === null);
  }
  {
    const g = estimateGaps({}, { facts: [], data: {} }).find(x => x.field === 'markupPct');
    ok('with nothing decided the markup gap is ASKED (impact ≥ the ask threshold)', !!g && g.impact >= ESTIMATE_ASK_THRESHOLD, g);
    ok('…offering the MARKUP_CHOICES ladder, no default value', JSON.stringify(g?.choices?.map(c => c.value)) === JSON.stringify([...MARKUP_CHOICES]) && g?.groundedDefault.value === null);
    ok('…and never filed as history', g?.groundedDefault.source === 'assumed');
    ok('a decided saved markup resolves the gap', !estimateGaps({}, { facts: [], data: { decidedMarkupPct: 20 } }).some(x => x.field === 'markupPct'));
  }
  const cap = src('utils/copilot/estimate/estimateCapability.ts');
  const gapsSrc = src('utils/copilot/estimate/estimateGaps.ts');
  ok('no hard-coded 18 left in the capability or its gaps', !/\?\?\s*18\b/.test(cap) && !/value:\s*18\b/.test(gapsSrc) && !/using 18%/.test(gapsSrc));

  console.log('\n#38 — which prices are his, and the headline that says so:');
  ok('a line claiming "learned" whose trade fed the prompt → learned', lineSourceFor({ category: 'Tile', name: 'Floor tile', basis: 'learned' }, TILE_ENTRY) === 'learned');
  ok('a line claiming "learned" with no matching entry → regional (never "your cost" on the model’s say-so)', lineSourceFor({ category: 'Roofing', name: 'Shingles', basis: 'learned' }, TILE_ENTRY) === 'regional');
  ok('a matched seeded entry reads seeded', lineSourceFor({ category: 'Tile', name: 'Tile', basis: 'learned' }, [{ trade: 'Tile', provenance: 'seeded' }]) === 'seeded');
  ok('a line that says regional stays regional even when its trade matched', lineSourceFor({ category: 'Tile', name: 'Tile', basis: 'regional' }, TILE_ENTRY) === 'regional');
  ok('no cost-book entry fed the prompt → "typical regional rates"', /typical regional rates/.test(pricedHeadline(['regional', 'regional'], 0)) && !/from your jobs/.test(pricedHeadline(['regional'], 0)));
  ok('entries fed but no line used them → still regional', /typical regional rates/.test(pricedHeadline(['regional'], 2)) && !/from your jobs/.test(pricedHeadline(['regional'], 2)));
  ok('"N of M lines from your costs" when some matched', pricedHeadline(['regional', 'learned', 'seeded'], 2).includes('2 of 3 lines from your costs'));
  ok('seeded-only lines never read "from your jobs"', !/your jobs/.test(pricedHeadline(['seeded', 'regional'], 1)) && /rates you set/.test(pricedHeadline(['seeded', 'regional'], 1)));
  ok('replace warning names the lines, the total and the saved version',
    replaceWarning({ items: new Array(7).fill(0) as never, grandTotal: 48250.5 }) === 'This replaces your current 7-line estimate ($48,250.50). The old version is saved.'
    && replaceWarning(null) === null && replaceWarning({ items: [], grandTotal: 0 }) === null);

  console.log('\n#38 — the cost book is narrowed to the scope, with no top-N fallback:');
  const book = [{ trade: 'Roofing' }, { trade: 'Framing' }, { trade: 'Tile' }, { trade: 'Electrical' }, { trade: 'Painting' }];
  ok('a kitchen-tile scope picks Tile, not the book’s top four', JSON.stringify(matchGroundingEntries(book, { scope: 'kitchen gut, 200 SF tile, repaint' }).map(e => e.trade)).includes('Tile')
    && !matchGroundingEntries(book, { scope: 'kitchen gut, 200 SF tile, repaint' }).some(e => e.trade === 'Roofing'));
  ok('nothing matching → nothing (unlike selectGroundingEntries’ exposure fallback)', matchGroundingEntries(book, { scope: 'install a hot tub' }).length === 0);
  {
    const seeds = draftsToSeeds([{ trade: 'Framing', unit: 'SF', rate: 12.5, raw: '' }], { now: '2026-09-01T00:00:00.000Z' });
    // No project type: a type's usual trades also count as a match (+1),
    // which is the estimator's rule too; this isolates the scope text.
    const project = { id: 'p1', name: 'Job', location: '', createdAt: '', updatedAt: '', estimate: null, status: 'in_progress' } as unknown as Project;
    const g1 = await buildEstimateGrounding({ project, projectId: 'p1', ctx: { projects: [project], seeds }, tier: 'pro' } as CopilotContext, 'install a hot tub on the deck');
    ok('an unrelated scope feeds no cost-book entry', (g1.data.groundingEntries as unknown[]).length === 0 && !g1.facts.some(f => /Framing/.test(f)), g1);
    const g2 = await buildEstimateGrounding({ project, projectId: 'p1', ctx: { projects: [project], seeds, markupDecided: true, markup: 20 }, tier: 'pro' } as CopilotContext, 'frame the new wall');
    ok('a framing scope feeds the framing rate, marked seeded', JSON.stringify(g2.data.groundingEntries) === JSON.stringify([{ trade: 'Framing', provenance: 'seeded' }]), g2.data);
    ok('the decided markup reaches the grounding data', g2.data.decidedMarkupPct === 20);
  }

  console.log('\n#38 — Build commits the priced preview, never a second model call:');
  ok('apply() calls no model', !/mageAI\(/.test(cap.slice(cap.indexOf('apply: async'))));
  ok('apply() refuses an unpriced draft and an undecided markup', /Price the estimate on the review card first/.test(cap) && /Pick a markup first/.test(cap));
  ok('apply() builds through buildCopilotLinkedEstimate (withMarkup)', /buildCopilotLinkedEstimate\(priced\.costItems, markup\.pct/.test(cap));
  ok('the capability renders its own review card', /renderReview:/.test(cap) && /EstimateCopilotReview/.test(cap));
  const review = src('components/copilot/EstimateCopilotReview.tsx');
  ok('the review shows the total, the split and each line’s badge', /copilot-estimate-total/.test(review) && /markupSourceLabel\(markup\.source\)/.test(review) && /'your cost'/.test(review) && /'MAGE estimate'/.test(review));
  ok('the review says it replaces an existing estimate and relabels the button', /replaceWarning\(/.test(review) && /'Replace estimate'/.test(review));
  ok('Build is disabled until a markup exists, and says why', /disabled=\{!markup\}/.test(review) && /won’t guess what you charge/.test(review));
  const price = src('utils/copilot/estimate/estimatePrice.ts');
  ok('the pricing call is metered as quickEstimate', /checkAILimit\([^)]*'quickEstimate'\)/.test(price) && /recordAIUsage\(reqTier, 'quickEstimate'\)/.test(price));
  const shell = src('components/copilot/CopilotShell.tsx');
  ok('assumed defaults are never headed "SET FROM YOUR HISTORY"', /ASSUMED — CHANGE ON THE GRID/.test(shell) && /r\.source === 'history'/.test(shell));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
})();
