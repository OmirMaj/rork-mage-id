// utils/estimateLanding.ts — where AI and takeoff lines land on a project's
// estimate, and which project a project-less estimating screen opens on.
//
// Pure: no React, no storage, no network, so scripts/validate-w5-estimating-*.ts
// executes the same functions the screens ship.
//
// ── WHY ONE FILE ────────────────────────────────────────────────────────────
//
// Four screens write priced lines onto `project.linkedEstimate`: the Drawing
// Analyzer ("Use as starting point"), the AI takeoff's priced estimate
// (Replace / Append), Visual Takeoff and Plan Intelligence. Each rebuilt the
// same three totals by hand, and each got a different part of it wrong (audit
// 2026-09-23):
//
//   #8  the Drawing Analyzer wrote the lines at COST with `globalMarkup: 0`,
//       dropped the contingency the screen had just shown, and replaced the
//       job's existing estimate without asking;
//   #91 the takeoff's Replace wrote `qty × unit × (1 + m)` unrounded, so the
//       contract value, the deposit and the SOV started from $485.087…;
//
// The arithmetic every writer needs is already in utils/estimateMarkup
// (withMarkup / round2 — unitPrice is COST, lineTotal is SELL, Σ lineTotal ===
// grandTotal). This file is the two shapes a writer actually has: "a new
// estimate from these cost lines at his markup" and "these cost lines added to
// the estimate he already has, at that estimate's own ratio".

import type { LinkedEstimate, LinkedEstimateItem, Project, Commitment } from '@/types';
import { round2, withMarkup, isMarkupSet, type MarkupPct } from '@/utils/estimateMarkup';

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

// ── A cost line ─────────────────────────────────────────────────────────────

/** One line at COST: markup 0, lineTotal = round2(qty × unit). The markup is
 *  applied by buildNewEstimate / appendAtEstimateRatio, never here. */
export function costItem(input: {
  id: string; name: string; category: string; unit: string;
  quantity: number; unitPrice: number; supplier?: string; csiDivision?: string;
}): LinkedEstimateItem {
  const quantity = finite(input.quantity);
  const unitPrice = finite(input.unitPrice);
  const item: LinkedEstimateItem = {
    materialId: input.id,
    name: input.name,
    category: input.category,
    unit: input.unit,
    quantity,
    unitPrice,
    bulkPrice: unitPrice,
    markup: 0,
    usesBulk: false,
    lineTotal: round2(quantity * unitPrice),
    supplier: input.supplier ?? '',
  };
  if (input.csiDivision) item.csiDivision = input.csiDivision;
  return item;
}

// ── #8 The Drawing Analyzer's result → cost lines ───────────────────────────

export interface AnalyzerLineInput {
  name: string; category: string; unit: string; quantity: number; unitPrice: number;
}

/**
 * The analyzer's line items at cost, PLUS the contingency the result card
 * showed as its own row.
 *
 * "Use as starting point" used to write only the line items, so a $100,000
 * subtotal with a $10,000 (10%) contingency on screen saved as $100,000. The
 * contingency is now a 'Contingency (N%)' LS line on the cent grid, so what
 * he saw as the "AI starting estimate" is what lands at cost, and the markup
 * pass (buildNewEstimate) carries it like every other line — see
 * estimateMarkup.applyMarkupToItems for why contingency takes markup.
 *
 * A model line whose category names contingency is dropped when the totals
 * carry one, the same rule utils/drawingAnalyzer.settleDrawingTotals applies:
 * the model can put contingency in a line AND in totals, and writing both
 * would charge it twice.
 */
export function analyzerCostItems(
  lines: AnalyzerLineInput[],
  totals: { contingencyPercent: number; contingencyAmount: number },
  newId: () => string,
): LinkedEstimateItem[] {
  const contingency = round2(finite(totals.contingencyAmount));
  const keep = contingency > 0
    ? lines.filter(li => !/contingency/i.test(String(li?.category ?? '')))
    : lines;
  const items = keep.map(li => costItem({
    id: newId(), name: li.name, category: li.category, unit: li.unit,
    quantity: li.quantity, unitPrice: li.unitPrice,
  }));
  if (contingency > 0) {
    const pct = finite(totals.contingencyPercent);
    items.push(costItem({
      id: newId(),
      name: pct > 0 ? `Contingency (${pct}%)` : 'Contingency',
      category: 'Contingency',
      unit: 'LS',
      quantity: 1,
      unitPrice: contingency,
    }));
  }
  return items;
}

// ── #91 The takeoff's priced lines → cost lines ─────────────────────────────

export interface TakeoffLineInput {
  id: string; description: string; csiDivision: string; unit: string;
  quantity: number; unitPrice: number;
}

/** The takeoff screen's priced lines at cost, on the cent grid. */
export function takeoffCostItems(lines: TakeoffLineInput[]): LinkedEstimateItem[] {
  return lines.map(l => costItem({
    id: l.id,
    name: l.description,
    category: l.csiDivision,
    unit: l.unit,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    supplier: 'AI Takeoff',
    csiDivision: l.csiDivision.split(' ')[0],
  }));
}

// ── Writing: a NEW estimate, or lines ADDED to the one he has ──────────────

/**
 * A new estimate from cost lines at HIS markup, footed by withMarkup: every
 * lineTotal is round2(cost × (1 + m)), baseTotal is Σ cost, grandTotal is Σ of
 * the rounded lines, markupTotal the difference. 123.45 SF × $3.33 at 18% →
 * lineTotal 485.08, baseTotal 411.09, grandTotal 485.08 (#91).
 *
 * `force` stamps his markup over every line — the cost lines all arrive at 0,
 * and a Replace is the one place his stated markup is the whole answer.
 */
export function buildNewEstimate(
  costItems: LinkedEstimateItem[],
  markupPct: MarkupPct,
  id: string,
  createdAt: string,
): LinkedEstimate {
  const base: LinkedEstimate = {
    id, items: costItems, globalMarkup: isMarkupSet(markupPct) ? markupPct : 0,
    baseTotal: 0, markupTotal: 0, grandTotal: 0, createdAt,
  };
  return withMarkup(base, markupPct, { force: true });
}

/**
 * Add cost lines to an EXISTING estimate at that estimate's own realized
 * markup ratio (markupTotal ÷ baseTotal), the rule app/area-takeoff.tsx's
 * append already follows.
 *
 * Deliberately NOT a retotal of the whole estimate: its markupTotal can carry
 * permits or contingency that sit in no item's lineTotal, and Σ lineTotal
 * would wipe them. Only the NEW lines are footed; each is rounded to the cent
 * and the three totals move by the rounded sums.
 *
 * `fallbackPct` is used only when the existing estimate has no cost base at
 * all (a degenerate estimate) — his stated markup, or nothing.
 */
export function appendAtEstimateRatio(
  est: LinkedEstimate,
  costItems: LinkedEstimateItem[],
  fallbackPct: MarkupPct = null,
): { next: LinkedEstimate; addedBase: number; addedSell: number; markupPct: number } {
  const ratio = est.baseTotal > 0
    ? est.markupTotal / est.baseTotal
    : (isMarkupSet(fallbackPct) ? fallbackPct / 100 : 0);
  const markupPct = ratio * 100;
  const items = costItems.map(it => {
    const cost = finite(it.unitPrice) * finite(it.quantity);
    return { ...it, markup: markupPct, lineTotal: round2(cost * (1 + markupPct / 100)) };
  });
  const addedBase = round2(items.reduce((s, i) => s + finite(i.unitPrice) * finite(i.quantity), 0));
  const addedSell = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const next: LinkedEstimate = {
    ...est,
    items: [...est.items, ...items],
    baseTotal: round2(est.baseTotal + addedBase),
    markupTotal: round2(est.markupTotal + round2(addedSell - addedBase)),
    grandTotal: round2(est.grandTotal + addedSell),
  };
  return { next, addedBase, addedSell, markupPct };
}

// ── #87 Which project a project-less estimating screen opens on ─────────────

const ts = (s: string | undefined): number => {
  const n = s ? Date.parse(s) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Projects with an estimate that has at least one line, most recently
 *  updated first — the jobs Estimate Risk, Bid vs Actual and Visual Takeoff
 *  can actually do something with. */
export function estimateProjectCandidates<P extends Pick<Project, 'id' | 'updatedAt' | 'linkedEstimate'>>(
  projects: P[],
): P[] {
  return projects
    .filter(p => (p.linkedEstimate?.items?.length ?? 0) > 0)
    .slice()
    .sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt));
}

/**
 * The project a hub-opened screen defaults to when it was pushed with no
 * projectId (the Estimate hub, the Summary tools sheet and the web sidebar
 * all push bare routes).
 *
 *   'estimate' — the most recently updated project with estimate lines.
 *   'accuracy' — Bid vs Actual measures a job against what was signed and
 *                paid, so prefer the most recent COMPLETED / CLOSED job that
 *                has commitments; then any job with commitments; then any job
 *                with an estimate (whose screen then explains what's missing).
 *
 * null when no project has an estimate: the screen says so and offers to
 * build one instead of "Project not found".
 */
export function pickEstimateProject<P extends Pick<Project, 'id' | 'updatedAt' | 'linkedEstimate' | 'status'>>(
  projects: P[],
  mode: 'estimate' | 'accuracy' = 'estimate',
  commitments: Pick<Commitment, 'projectId'>[] = [],
): P | null {
  const candidates = estimateProjectCandidates(projects);
  if (candidates.length === 0) return null;
  if (mode === 'accuracy') {
    const committed = new Set(commitments.map(c => c.projectId));
    const done = candidates.find(p => (p.status === 'completed' || p.status === 'closed') && committed.has(p.id));
    if (done) return done;
    const any = candidates.find(p => committed.has(p.id));
    if (any) return any;
  }
  return candidates[0];
}

// ── #10 A decimal typed on a phone keypad ───────────────────────────────────

/**
 * A money or percent box → number, or null when it can't be read.
 *
 * The iOS decimal-pad shows ',' instead of '.' in comma-decimal regions, so a
 * GC there types "7,5" for 7.5% tax. The old Quick Quote parser stripped every
 * non-digit and read "7,5" as 75. A comma is read as the decimal point only
 * when that is the ONLY reading: one comma, no dot, one or two digits after it
 * ("7,5", "12,50"). US grouping ("12,500", "$1,234.56") is de-grouped, the way
 * utils/cashFlowEngine.parseMoneyInput reads it. "1,234" stays twelve hundred
 * and thirty-four — this is a US-first app and that is a grouped thousand.
 * Anything else with a comma is refused rather than guessed.
 */
export function parseDecimalInput(text: string): number | null {
  const s = String(text ?? '').replace(/[$%\s]/g, '');
  if (s.length === 0) return null;
  let norm = s;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) norm = s.replace(/,/g, '');
  else if (/^-?\d*,\d{1,2}$/.test(s)) norm = s.replace(',', '.');
  if (norm.includes(',')) return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}
