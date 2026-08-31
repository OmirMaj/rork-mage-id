// validate-job-cost-variance.ts — pins the sign convention of job-cost
// variance and the words the Job Costing screen puts next to it.
//
// WHY THIS EXISTS. The web audit (docs/audits/2026-08-17-web-audit.md, P0)
// caught the Henderson project reading "UNDER BY $49K" in green, with the
// banner "On track to finish $49K under budget", while it was $49K OVER.
// Three independent mechanisms hid the same overrun:
//
//   1. SIGN. jobCostEngine computes `variance = projectedFinal - budget`, so
//      POSITIVE MEANS OVER. The engine's own header comment claimed the
//      opposite ("shows up negative"), and app/job-costing.tsx trusted the
//      prose over the arithmetic: `variance >= 0` was labelled 'Under by'
//      and painted with the success colour.
//   2. CLAMP. `Math.min(100, ...)` on spendPercent / commitmentCoverage meant
//      $49K against a $48K budget displayed "100% of budget". An over-budget
//      job could never LOOK over-budget.
//   3. UNBUDGETED PHASES. classify() guarded its `over` rule on `budget > 0`,
//      so a phase holding real spend against no budget line at all fell all
//      the way through to `on_track` — green, with the money on screen.
//
// This is a cost-tracking product. Reporting an overrun as an underrun is
// the worst failure it can have, so every one of those three is pinned here
// rather than left to review.
//
// Pins INTENDED semantics:
//   • variance > 0 means OVER budget, always, and equals projectedFinal-budget
//   • committed > budget produces a POSITIVE variance (the case the old
//     header comment claimed went negative — arithmetically impossible)
//   • describeVariance maps sign → tone/label/banner/colour/trend, and an
//     exactly-on-budget project reads as NEITHER over nor under
//   • spendPercent / commitmentCoverage are NOT clamped: 102% reads 102%
//   • a phase with spend but no budget is not 'on_track'
//   • app/job-costing.tsx renders through describeVariance and never
//     re-derives the sign inline (source-level — bun cannot import a .tsx)
//   • no source comment claims the negative convention any more
//
// Run via: bun run test:job-cost

import {
  computeJobCost, describeVariance, formatMoney,
  VARIANCE_EPSILON,
} from '../utils/jobCostEngine';
import type { Project, Invoice, Commitment, LinkedEstimate } from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Blank out comments, preserving offsets and line count.
 *
 * The alpha-suffix check below scans for `${token}22` shapes, and the code it
 * guards is now documented with comments that QUOTE those shapes verbatim.
 * Without this the guard flags its own explanation — which it did, on the first
 * run. Same helper, same reason, as scripts/validate-contrast.ts.
 */
function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; i++; continue; }
      blank(i); i++; continue;
    }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) {
      mode = 'code';
    }
    i++;
  }
  return out.join('');
}

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { pass++; console.log('  ✓', name); }
  else {
    fail++;
    console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want));
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────
// The Henderson shape, straight off the audit: a $48K estimate, one fully
// paid $49K invoice whose lines carry no sourceEstimateItemId, nothing
// committed. EAC = 49K paid + 0 remaining committed + 48K uncommitted budget
// floor = $97K projected, which is $49K over a $48K budget.

function estimate(items: { category: string; lineTotal: number }[]): LinkedEstimate {
  const baseTotal = items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    id: 'est1',
    items: items.map((i, n) => ({
      materialId: `m${n}`, name: `Item ${n}`, category: i.category, unit: 'ls',
      quantity: 1, unitPrice: i.lineTotal, bulkPrice: i.lineTotal, markup: 0,
      usesBulk: false, lineTotal: i.lineTotal, supplier: 'Acme',
    })),
    globalMarkup: 0, baseTotal, markupTotal: 0, grandTotal: baseTotal,
    createdAt: '2026-01-02T00:00:00.000Z',
  } as LinkedEstimate;
}

function project(items: { category: string; lineTotal: number }[]): Project {
  return {
    id: 'p1', name: 'Henderson Remodel', linkedEstimate: estimate(items),
  } as unknown as Project;
}

/** A fully paid invoice whose lines trace to no estimate item. */
function paidInvoice(amount: number, sourceEstimateItemId?: string): Invoice {
  return {
    id: 'inv1', projectId: 'p1', amountPaid: amount,
    lineItems: [{ id: 'l1', description: 'Progress billing', total: amount, sourceEstimateItemId }],
  } as unknown as Invoice;
}

function commitment(amount: number, phase?: string): Commitment {
  return {
    id: 'c1', projectId: 'p1', status: 'active', type: 'subcontract',
    amount, phase,
  } as unknown as Commitment;
}

const HENDERSON = computeJobCost({
  project: project([{ category: 'Framing', lineTotal: 30_000 }, { category: 'Electrical', lineTotal: 18_000 }]),
  commitments: [],
  invoices: [paidInvoice(49_000)],
  changeOrders: [],
});

// ── 1. Sign convention, asserted against the engine itself ───────────────

console.log('\nsign convention (asserted directly against jobCostEngine):');
expect('Henderson budget is $48K', HENDERSON.budget, 48_000);
expect('Henderson actual is $49K', HENDERSON.actual, 49_000);
expect('Henderson EAC is $97K (paid + uncommitted budget floor)', HENDERSON.projectedFinal, 97_000);
expect('variance === projectedFinal - budget', HENDERSON.variance, HENDERSON.projectedFinal - HENDERSON.budget);
ok('an OVER-budget project produces a POSITIVE variance',
  HENDERSON.variance > 0,
  `variance = ${HENDERSON.variance}; positive must mean OVER`);
expect('Henderson is $49K over', HENDERSON.variance, 49_000);

{
  // The exact case the old header comment claimed "shows up negative":
  // commitments already exceed budget. EAC = committed, so variance =
  // committed - budget, which is strictly positive. Arithmetically the
  // comment could never have been true.
  const jc = computeJobCost({
    project: project([{ category: 'Framing', lineTotal: 20_000 }]),
    commitments: [commitment(35_000, 'Framing')],
    invoices: [],
    changeOrders: [],
  });
  expect('commitments over budget ⇒ EAC = committed', jc.projectedFinal, 35_000);
  ok('commitments over budget ⇒ variance POSITIVE (not negative)',
    jc.variance > 0, `variance = ${jc.variance}`);
  expect('…and equals committed - budget', jc.variance, 15_000);
}

{
  // Under budget: buyout came in cheap and everything is signed.
  const jc = computeJobCost({
    project: project([{ category: 'Framing', lineTotal: 50_000 }]),
    commitments: [commitment(50_000, 'Framing')],
    invoices: [paidInvoice(40_000, 'm0')],
    changeOrders: [],
  });
  ok('a job that will land at budget is not reported as over',
    jc.variance <= 0, `variance = ${jc.variance}`);
}

// ── 2. describeVariance — the words and colours on screen ────────────────

console.log('\ndescribeVariance (the pure display mapping the screen renders):');
{
  const over = describeVariance(49_000);
  expect('over → tone', over.tone, 'over');
  expect('over → KPI label', over.label, 'Over by');
  ok('over → banner says over budget',
    /over budget/i.test(over.banner) && !/under budget/i.test(over.banner), over.banner);
  expect('over → danger tone token', over.colorKey, 'danger');
  expect('over → trend arrow points up (costs rising past budget)', over.trend, 'up');
  expect('over → magnitude is the absolute dollars', over.amount, 49_000);
  ok('over → banner never says "on track"', !/on track/i.test(over.banner), over.banner);
}
{
  const under = describeVariance(-6_000);
  expect('under → tone', under.tone, 'under');
  expect('under → KPI label', under.label, 'Under by');
  ok('under → banner says under budget',
    /under budget/i.test(under.banner) && !/\bover budget/i.test(under.banner), under.banner);
  expect('under → success tone token', under.colorKey, 'success');
  expect('under → trend arrow points down', under.trend, 'down');
  expect('under → magnitude is positive dollars', under.amount, 6_000);
}
{
  const flat = describeVariance(0);
  expect('exactly on budget → tone is neither over nor under', flat.tone, 'on_budget');
  ok('exactly on budget → label does not read "Under by"', flat.label !== 'Under by', flat.label);
  ok('exactly on budget → label does not read "Over by"', flat.label !== 'Over by', flat.label);
  ok('exactly on budget → banner claims neither over nor under budget',
    !/under budget/i.test(flat.banner) && !/over budget/i.test(flat.banner), flat.banner);
  expect('exactly on budget → neutral tone token', flat.colorKey, 'neutral');
  expect('exactly on budget → flat trend', flat.trend, 'flat');
  expect('exactly on budget → zero magnitude', flat.amount, 0);
}
{
  // Sub-dollar float noise displays as "$0", so it must not read as a
  // direction either — otherwise a rounding artefact paints the card red.
  ok('sub-dollar rounding noise reads as on budget',
    describeVariance(0.004).tone === 'on_budget' && describeVariance(-0.004).tone === 'on_budget');
  ok('a whole dollar over is over', describeVariance(1).tone === 'over');
  ok('a whole dollar under is under', describeVariance(-1).tone === 'under');
  ok('VARIANCE_EPSILON is sub-dollar', VARIANCE_EPSILON > 0 && VARIANCE_EPSILON < 1);
}
{
  // The regression as the user saw it, end to end.
  const d = describeVariance(HENDERSON.variance);
  expect('Henderson KPI reads "Over by $49K"', `${d.label} ${formatMoney(d.amount)}`, 'Over by $49K');
  ok('Henderson banner reports the overrun',
    /over budget/i.test(d.banner) && /\$49K/.test(d.banner), d.banner);
  expect('Henderson KPI is painted danger, not success', d.colorKey, 'danger');
}

// ── 3. Percentages are not clamped ───────────────────────────────────────

console.log('\npercentages are not clamped (an over-budget job must LOOK over-budget):');
ok('spendPercent exceeds 100 when actual exceeds budget',
  HENDERSON.spendPercent > 100, `spendPercent = ${HENDERSON.spendPercent}`);
expect('spendPercent is $49K / $48K to the displayed digit',
  HENDERSON.spendPercent.toFixed(0), '102');
{
  const jc = computeJobCost({
    project: project([{ category: 'Framing', lineTotal: 20_000 }]),
    commitments: [commitment(35_000, 'Framing')],
    invoices: [],
    changeOrders: [],
  });
  ok('commitmentCoverage exceeds 100 when committed exceeds budget',
    jc.commitmentCoverage > 100, `commitmentCoverage = ${jc.commitmentCoverage}`);
  expect('commitmentCoverage is $35K / $20K to the displayed digit',
    jc.commitmentCoverage.toFixed(0), '175');
}
expect('no budget ⇒ percentages stay 0 rather than dividing by zero',
  (() => {
    const jc = computeJobCost({
      project: { id: 'p1', name: 'No estimate' } as unknown as Project,
      commitments: [], invoices: [paidInvoice(5_000)], changeOrders: [],
    });
    return [jc.spendPercent, jc.commitmentCoverage];
  })(), [0, 0]);

// ── 4. Unbudgeted phases must not read green ─────────────────────────────

console.log('\nunbudgeted phases (the $49K sitting in "(Uncategorized)"):');
{
  const unc = HENDERSON.byPhase.find(p => /uncategorized/i.test(p.phase));
  ok('the untraceable spend is surfaced as its own row, not distributed', !!unc,
    `phases: ${HENDERSON.byPhase.map(p => p.phase).join(', ')}`);
  expect('that row holds the whole $49K against a $0 budget',
    unc ? { budget: unc.budget, actual: unc.actual } : null,
    { budget: 0, actual: 49_000 });
  ok('a phase with real spend and no budget is NOT on_track',
    unc?.status !== 'on_track', `status = ${unc?.status}`);
  ok('its own variance already says over — status must agree',
    !!unc && unc.variance > 0 && unc.status !== 'on_track',
    `variance = ${unc?.variance}, status = ${unc?.status}`);
  ok('the budgeted phases with nothing spent stay on_track',
    HENDERSON.byPhase.filter(p => p.budget > 0).every(p => p.status === 'on_track'),
    HENDERSON.byPhase.map(p => `${p.phase}:${p.status}`).join(', '));
}
{
  const jc = computeJobCost({
    project: project([{ category: 'Framing', lineTotal: 20_000 }]),
    commitments: [commitment(9_000, 'Sitework')], // phase the estimate never priced
    invoices: [], changeOrders: [],
  });
  const site = jc.byPhase.find(p => p.phase === 'Sitework');
  ok('an unbudgeted signed commitment does not read on_track either',
    site?.status !== 'on_track', `status = ${site?.status}`);
}

// ── 5. The screen renders through the pure function ──────────────────────
// Source-level on purpose: bun cannot import a .tsx screen, and the exact
// failure that shipped was a correct engine wired to inverted prose in the
// view. Behavioural tests of the engine alone cannot catch that.

console.log('\napp/job-costing.tsx wiring (source-level — bun cannot import a .tsx):');
{
  const screen = read('app/job-costing.tsx');
  ok('screen imports describeVariance from the engine',
    /describeVariance/.test(screen) && /from '@\/utils\/jobCostEngine'/.test(screen));
  ok('screen no longer derives the sign inline',
    !/variance\s*>=\s*0/.test(screen),
    (screen.match(/.*variance\s*>=\s*0.*/g) ?? []).join('\n      '));
  ok("no inline 'Under by' / 'Over by' label ternary left in the screen",
    !/\?\s*'Under by'/.test(screen) && !/\?\s*'Over by'/.test(screen));
  ok("no inline 'On track to finish … under budget' string left in the screen",
    !/On track to finish/.test(screen));
  ok('the phase drilldown uses the shared mapping too',
    (screen.match(/describeVariance\(/g) ?? []).length >= 2,
    `${(screen.match(/describeVariance\(/g) ?? []).length} call site(s)`);
  ok('the phase chip has an Unbudgeted state and does not fall through to On track',
    /'unbudgeted'/.test(screen) && /'Unbudgeted'/.test(screen));
  ok('screen paints the overrun with the themed danger tokens',
    /\bt\.danger\b/.test(screen) && /\bt\.dangerSoft\b/.test(screen));
  ok('screen never reaches for the non-theme Colors.error family',
    !/Colors\.error/.test(screen));
}

// Tokens verified against constants/colors.ts rather than assumed: every
// theme colour the variance path uses must actually be declared on
// ThemeColors, in BOTH themes.
{
  const colors = read('constants/colors.ts');
  // Scope to the two theme literals — the base `Colors` palette above them
  // declares its own `success`/`warning`, which are NOT the themed tokens.
  const themeType = colors.slice(colors.indexOf('export type ThemeColors'), colors.indexOf('export const Theme'));
  const themes = colors.slice(colors.indexOf('export const Theme'));
  for (const token of ['danger', 'dangerSoft', 'dangerLabel', 'success', 'successSoft', 'warningSoft', 'warningLabel', 'text', 'textSecondary', 'surfaceAlt', 'info']) {
    ok(`ThemeColors declares '${token}'`, new RegExp(`^\\s*${token}:\\s*string;`, 'm').test(themeType));
    ok(`both light and dark define '${token}'`,
      (themes.match(new RegExp(`^\\s*${token}:\\s*['"]`, 'gm')) ?? []).length === 2);
  }
  ok('the status label tokens are 6-digit hex in both themes, so an alpha suffix on one stays valid',
    (themes.match(/^\s*(danger|dangerLabel|warningLabel|success|info):\s*'#[0-9A-Fa-f]{6}',/gm) ?? []).length === 10,
    (themes.match(/^\s*(danger|dangerLabel|warningLabel|success|info):\s*'[^']*',/gm) ?? []).join(' | '));

  // ── Alpha suffixes only on 6-digit hex ─────────────────────────────────
  //
  // A chip fill written as `${token}22` is a 13%-alpha tint ONLY if `token` is
  // 6-digit hex. React Native's normalizeColor matches the `rgba(...)` form on
  // a prefix and silently DISCARDS anything trailing, so
  //
  //   normalizeColor('rgba(43,48,56,0.6)22') === normalizeColor('rgba(43,48,56,0.6)')
  //
  // and the fill resolves to the label token itself — foreground painted on its
  // own background, the punch-list/invoice invisible-label class wearing a
  // suffix as a disguise. That shipped here: StatusChip's 'draft' branch used
  // `${themeColors.textSecondary}22`, which is rgba in the light theme, and the
  // 9px uppercase label measured 2.10:1 on its own fill.
  //
  // So: enumerate every colour that is NOT 6-digit hex (either theme, plus the
  // base palette's theme-dependent getters, which are unresolvable here and so
  // are never safe to suffix), then assert the screen suffixes none of them.
  const nonHex = new Set<string>();
  for (const m of colors.matchAll(/^\s*(\w+):\s*'([^']+)',/gm)) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(m[2])) nonHex.add(m[1]);
  }
  for (const m of colors.matchAll(/^\s*get\s+(\w+)\s*\(\)/gm)) nonHex.add(m[1]);
  ok('constants/colors.ts still declares non-hex colours — otherwise this check is vacuous',
    nonHex.has('textSecondary') && nonHex.has('line'),
    `non-hex set: ${[...nonHex].sort().join(', ')}`);

  const code = stripComments(read('app/job-costing.tsx'));
  const suffixed = [
    ...code.matchAll(/`\$\{([^}]+)\}[0-9A-Fa-f]{2}`/g),
    ...code.matchAll(/([A-Za-z_$][\w.$]*)\s*\+\s*'[0-9A-Fa-f]{2}'/g),
  ].map(m => m[1].trim());

  // A local alias (`${statusColor}22`) hides WHICH token gets the suffix, so it
  // cannot be checked — and that opacity is precisely how an rgba token got
  // into the ternary unnoticed. Require a direct token access.
  const aliased = suffixed.filter(e => !/^(themeColors|t|Colors)\.\w+$/.test(e));
  ok('every alpha-suffixed colour in app/job-costing.tsx is a direct token access, not a local alias',
    aliased.length === 0,
    `${aliased.join(', ')} — name the fill token instead; an alias hides whether it is hex`);

  const suffixedNonHex = suffixed.filter(e => nonHex.has(e.split('.').pop() ?? ''));
  ok('no alpha suffix is applied to a colour that is rgba/theme-dependent',
    suffixedNonHex.length === 0,
    `${suffixedNonHex.join(', ')} — normalizeColor drops the suffix, so the fill becomes the token itself (fg === bg)`);
}

// ── 6. The prose no longer contradicts the arithmetic ────────────────────

console.log('\ndocumentation matches the formula:');
{
  const engine = read('utils/jobCostEngine.ts');
  ok('jobCostEngine no longer claims variance goes negative when over',
    !/negative\s*[—-]\s*which is the signal/i.test(engine) && !/[Nn]egative = over/.test(engine),
    (engine.match(/.*[Nn]egative.*over.*/g) ?? []).join('\n      '));
  ok('jobCostEngine states the positive = over convention',
    /[Pp]ositive = over/.test(engine));
  ok('portalSnapshot phase payload does not carry the inverted comment',
    !/[Nn]egative = over budget/.test(read('utils/portalSnapshot.ts')));

  // The two engines in this repo use OPPOSITE conventions on purpose.
  // marginRiskScore already re-derived the overrun by hand "to avoid
  // sign-convention ambiguity" and treated positive as over — independent
  // corroboration that the formula, not the old comment, was right.
  ok('marginRiskScore still reads positive (projectedFinal - budget) as the overrun',
    /Math\.max\(0,\s*jc\.projectedFinal\s*-\s*jc\.budget\)/.test(read('utils/marginRiskScore.ts')));
  ok('scheduleEarnedValue keeps the OPPOSITE EVM convention (VAC = BAC - EAC)',
    /const vac = bac - eac;/.test(read('utils/scheduleEarnedValue.ts')));
  ok('the engine header warns that the two conventions are opposite',
    /scheduleEarnedValue/.test(engine) && /OPPOSITE/.test(engine));
}

// ── the budget is COST, never the marked-up sell price ──────────────────────
// EVERY fixture above builds its estimate with markup: 0 and
// grandTotal === baseTotal, so cost and sell are the same number and this
// guard was structurally incapable of seeing the difference. It passed all
// 88 assertions while computeJobCost seeded the budget from `lineTotal` — the
// MARKED-UP figure (app/(tabs)/estimate/full.tsx:933) — which made
// budget === revenue and reported $0 projected profit on every job.
//
// A fixture that cannot distinguish cost from price cannot guard the one
// invariant that matters here. This one carries real markup.
{
  // $100,000 of cost at 15% markup = $115,000 contract. Nothing spent yet.
  const marked = {
    id: 'est-markup',
    items: [{
      materialId: 'm0', name: 'Framing package', category: 'Framing', unit: 'ls',
      quantity: 4, unitPrice: 25_000, bulkPrice: 25_000, markup: 15,
      usesBulk: false, lineTotal: 25_000 * 1.15 * 4, supplier: 'Acme',
    }],
    globalMarkup: 15,
    baseTotal: 100_000,
    markupTotal: 15_000,
    grandTotal: 115_000,
    createdAt: '2026-01-02T00:00:00.000Z',
  } as unknown as LinkedEstimate;
  const proj = { id: 'p-markup', name: 'Markup Job', linkedEstimate: marked } as unknown as Project;

  const summary = computeJobCost({ project: proj, commitments: [], invoices: [], changeOrders: [] });
  const budget = summary.budget;

  expect('budget is the COST basis, not the marked-up sell price', budget, 100_000);
  // Per-phase must agree with the total — the sum is what the Living Estimate
  // and the WIP row read.
  expect('per-phase budgets sum to the same cost basis',
    summary.byPhase.reduce((t, l) => t + l.budget, 0), 100_000);
  // The pre-fix value. Named explicitly so a regression is unmistakable.
  ok('budget is NOT grandTotal (the $115,000 pre-fix value)', budget !== 115_000,
    'seeding budget from lineTotal makes budget === revenue and profit === 0');
  // And it must reconcile with the estimate's own declared cost total, which is
  // the same basis utils/wip.deriveEstimatedCost uses.
  expect('budget reconciles with the estimate baseTotal', budget, marked.baseTotal);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
