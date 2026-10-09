// utils/roomScan/pricingCore.ts — scan quantities to a priced draft, through
// the app's EXISTING takeoff-to-estimate path. Nothing here prices or writes
// an estimate by its own rules:
//
//   a recipe line          becomes a TakeoffCondition          (utils/takeoff/conditions)
//   its price              is priceCondition(db, condition)    (his typed rate, else his own cost book)
//   what the push writes   is pushLinesFrom(rows)              (utils/takeoff/conditionPush)
//   the estimate           is applyTakeoffPush(estimate, ...)  (markup inside lineTotal, re-push updates in place)
//   the save               is commitEstimatePatch(...)         (utils/estimateCommit: snapshots the old estimate first)
//
// WHERE A PRICE CAME FROM, in the takeoff's own vocabulary
// (utils/takeoffPricing PriceSource: 'yours' | 'engine' | 'manual'):
//   'manual'  the person typed a rate on the price screen. It wins.
//   'yours'   his own cost book. What it may claim (measured on N jobs, signed
//             not yet paid, a rate he set) is decided by
//             utils/rateProvenance.provenanceClaimModel, the one firewall the
//             estimate chip and the takeoff sentence already share.
//   'engine'  no price of his own: a catalog price, labelled as one.
//   null      no price at all. The line is shown as "No Price Yet", adds
//             nothing to the total and is NOT pushed. Never $0.
// EVERY priced line carries its source. scripts/validate-scan-room.ts fails on
// a priced line without one.
//
// NOTHING IS SAVED HERE. buildEstimatePatch needs `confirmed: true`, set only
// by the person's tap on the confirm sheet, AND `mayEdit: true` (his seat on
// the project may change its estimate), and returns the patch for the caller
// to hand to updateProject. The pure core cannot write anything.
//
// A PROJECT WITH NO ESTIMATE YET. The same confirm starts one, through the
// app's own creation path: the lines at cost, then
// utils/estimateLanding.buildNewEstimate at HIS stated markup (what
// app/takeoff-estimate.tsx's Replace and the Drawing Analyzer do). A markup he
// never chose is never written: with none on file the draft is blocked and
// says so.
//
// Pure: no React, no storage. The caller passes the cost book and the clock.

import type { LinkedEstimate, LinkedEstimateItem, Project } from '@/types';
import { roundCents } from '@/utils/invoiceBilling';
import { lookupRate, type CostBookEntry, type CostDatabase } from '@/utils/costDatabase';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { buildNewEstimate } from '@/utils/estimateLanding';
import { isMarkupSet, type MarkupPct } from '@/utils/estimateMarkup';
import {
  KIND_UNIT, priceCondition,
  type ConditionPrice, type ConditionTotals, type RollupRow, type TakeoffCondition,
} from '@/utils/takeoff/conditions';
import { applyTakeoffPush, pushBlockReason, pushLinesFrom, type PushLine } from '@/utils/takeoff/conditionPush';
import { matchOwnRate, type PriceSource } from '@/utils/takeoffPricing';
import { provenanceClaimModel, type RateProvenanceTone } from '@/utils/rateProvenance';
import type { CatalogRater } from './catalogRate';
import { RECIPE_NAMES_EN, ROOM_RECIPES, recipeQuantity, type RecipeKey, type RecipeLine } from './recipesCore';
import type { RoomScan, ScanQuantities } from './types';

export type ScanPriceSource = Extract<PriceSource, 'yours' | 'engine' | 'manual'>;

/** What a 'yours' price may say about itself. */
export interface OwnPriceClaim {
  /** 'measured' = paid jobs. 'contracted' = signed, not yet paid. 'stated' = a rate he set, or one real jobs have begun to correct. */
  tone: RateProvenanceTone;
  provenance: 'earned' | 'seeded' | 'mixed';
  /** Real jobs behind the rate. 0 for a rate he only set. */
  jobCount: number;
  /** His own name for the trade the price came from. */
  trade: string;
  /**
   * False when the price came from one of his trades that is NOT the line's
   * own default trade (his "Doors" for an interior door). The label then names
   * the trade, so he can see which of his prices was used.
   */
  exactTrade: boolean;
}

export interface ScanDraftLine {
  key: RecipeKey;
  conditionId: string;
  name: string;
  unit: 'SF' | 'LF' | 'EA';
  /** The scan's quantity, before waste. */
  netQuantity: number;
  wastePct: number;
  /** What is priced and pushed: the takeoff's rounding of quantity plus waste. */
  quantity: number;
  rate: number | null;
  amountCents: number | null;
  source: ScanPriceSource | null;
  claim: OwnPriceClaim | null;
  included: boolean;
  row: RollupRow;
}

export interface ScanDraft {
  scanId: string;
  /** The room's name, trimmed. '' blocks the push: the name goes on every estimate line. */
  roomName: string;
  lines: ScanDraftLine[];
  /** Cost of the included, priced lines, in cents. His markup is added in the estimate. */
  totalCents: number;
  pricedCount: number;
  unpricedCount: number;
  /** Included lines priced from his own cost book. */
  ownCount: number;
  catalogCount: number;
  manualCount: number;
}

export interface DraftChoices {
  /** Rates the person typed, by recipe key. */
  manualRates?: Partial<Record<RecipeKey, number>>;
  /** Lines the person took out of the draft. */
  excluded?: readonly RecipeKey[];
  names?: Partial<Record<RecipeKey, string>>;
}

export function scanConditionId(scanId: string, key: RecipeKey): string {
  return `scan:${scanId}:${key}`;
}

/**
 * EVERY word of his trade label must be one of the line's words. The takeoff
 * matcher's default (0.34) takes a trade that shares ONE word, which priced an
 * interior door from "Garage Door" and baseboard from "Base Cabinets" and
 * called it his own price. The default is left alone for its other callers.
 */
export const STRICT_TRADE_MATCH = { minScore: 1 } as const;

/** His own trade for a recipe line: the exact trade when his book has it, else a trade whose every word names this work, else the default. */
export function resolveTrade(db: CostDatabase, line: RecipeLine): string {
  const unit = KIND_UNIT[line.kind];
  if (lookupRate(db, line.defaultTrade, unit)) return line.defaultTrade;
  const m = matchOwnRate({ description: line.matchWords, unit }, db.entries, STRICT_TRADE_MATCH);
  return m ? m.trade : line.defaultTrade;
}

const sameTrade = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function claimFor(entry: CostBookEntry, line: RecipeLine): OwnPriceClaim {
  const provenance = entry.provenance ?? 'earned';
  const model = provenanceClaimModel({ provenance, jobCount: entry.jobCount ?? 0, earnedBasis: entry.earnedBasis });
  const exactTrade = sameTrade(entry.trade, line.defaultTrade);
  // No model = an earned entry with no measured job behind it. It may claim nothing beyond being his.
  return model
    ? { tone: model.tone, provenance: model.provenance, jobCount: model.jobCount, trade: entry.trade, exactTrade }
    : { tone: 'stated', provenance: 'seeded', jobCount: 0, trade: entry.trade, exactTrade };
}

/** Price every recipe line for this room. Reads only: no estimate is touched. */
export function buildScanDraft(
  scan: Pick<RoomScan, 'id' | 'roomType' | 'capturedAt'> & { name?: string },
  q: ScanQuantities,
  db: CostDatabase,
  catalog: CatalogRater,
  choices: DraftChoices = {},
): ScanDraft {
  const lines: ScanDraftLine[] = [];
  const excluded = new Set(choices.excluded ?? []);
  for (const recipe of ROOM_RECIPES[scan.roomType]) {
    const net = recipeQuantity(recipe.key, q);
    if (net == null || !(net > 0)) continue;
    const unit = KIND_UNIT[recipe.kind];
    const manual = choices.manualRates?.[recipe.key];
    const hasManual = typeof manual === 'number' && Number.isFinite(manual) && manual > 0;
    const condition: TakeoffCondition = {
      id: scanConditionId(scan.id, recipe.key),
      name: choices.names?.[recipe.key] ?? RECIPE_NAMES_EN[recipe.key],
      kind: recipe.kind,
      trade: resolveTrade(db, recipe),
      rateOverride: hasManual ? (manual as number) : null,
      wastePct: recipe.wastePct,
      heightFt: null,
      color: '',
      createdAt: scan.capturedAt,
    };
    const billable = recipe.kind === 'count' ? net : net * (1 + recipe.wastePct / 100);
    let price: ConditionPrice = priceCondition(db, condition, billable);
    let source: ScanPriceSource | null =
      price.rateSource === 'override' ? 'manual' : price.rateSource === 'book' ? 'yours' : null;
    if (source == null) {
      // No price of his own. A catalog price rides the same override slot the
      // takeoff uses for a typed rate, so the push treats it identically and
      // the estimate line is NOT stamped as learned.
      const rate = catalog(recipe);
      if (rate != null && rate > 0) {
        condition.rateOverride = rate;
        price = priceCondition(db, condition, billable);
        if (price.rateSource === 'override') source = 'engine';
      }
    }
    // A sliver that rounds to nothing is not a line: it would read as work priced at $0.00.
    if (!(price.qty > 0)) continue;
    const totals: ConditionTotals = {
      conditionId: condition.id, net, billable, unit, wallSf: null,
      unmeasuredCount: 0, measuredCount: 1, unmeasuredSheetIds: [], source: 'measured', aiReadQty: null,
    };
    lines.push({
      key: recipe.key,
      conditionId: condition.id,
      name: condition.name,
      unit,
      netQuantity: net,
      wastePct: recipe.wastePct,
      quantity: price.qty,
      rate: price.rate,
      amountCents: price.amountCents,
      source: price.amountCents == null ? null : source,
      claim: source === 'yours' && price.entry ? claimFor(price.entry, recipe) : null,
      included: !excluded.has(recipe.key),
      row: { condition, totals, price },
    });
  }
  const live = lines.filter((l) => l.included);
  const priced = live.filter((l) => l.amountCents != null);
  return {
    scanId: scan.id,
    roomName: (scan.name ?? '').trim(),
    lines,
    totalCents: priced.reduce((s, l) => s + (l.amountCents as number), 0),
    pricedCount: priced.length,
    unpricedCount: live.length - priced.length,
    ownCount: priced.filter((l) => l.source === 'yours').length,
    catalogCount: priced.filter((l) => l.source === 'engine').length,
    manualCount: priced.filter((l) => l.source === 'manual').length,
  };
}

/**
 * What the push reads from a draft. The room draft above is one; the order
 * list's draft (utils/roomScan/orderPricingCore) is another. Both go through
 * the SAME functions below, so there is one way into the estimate.
 */
export interface PushableDraft {
  roomName: string;
  lines: readonly { included: boolean; row: RollupRow }[];
}

/** The lines the push would write: included, with a quantity and a rate. */
export function draftPushLines(draft: PushableDraft): PushLine[] {
  return pushLinesFrom(draft.lines.filter((l) => l.included).map((l) => l.row)).lines;
}

export type DraftBlock = 'no_project' | 'no_access' | 'no_name' | 'nothing_priced' | 'no_markup';

/** What the push needs to know beyond the draft: his seat on the project, and the markup he has stated. */
export interface PushContext {
  /** True only for a seat that may change this project's estimate (owner or editor). */
  mayEdit: boolean;
  /** His stated markup, or null when he was never asked. Used ONLY to start an estimate on a project that has none. */
  markupPct: MarkupPct;
}

/** True when the confirm would START this project's estimate instead of adding to one. */
export function startsEstimate(project: Project | null): boolean {
  return !!project && !project.linkedEstimate;
}

/**
 * Why the draft cannot go to the estimate, or null. A code the screen puts
 * into words. A project with an estimate follows the takeoff's own rule
 * (pushBlockReason). A project with none is not blocked for that: the confirm
 * starts the estimate at his stated markup, and is blocked only when he has
 * never stated one.
 */
export function draftBlock(project: Project | null, draft: PushableDraft, ctx: PushContext): DraftBlock | null {
  const lines = draftPushLines(draft);
  if (!project) return 'no_project';
  if (ctx.mayEdit !== true) return 'no_access';
  if (!draft.roomName) return 'no_name';
  if (!lines.length) return 'nothing_priced';
  if (!project.linkedEstimate) return isMarkupSet(ctx.markupPct) ? null : 'no_markup';
  return pushBlockReason(project, lines) ? 'nothing_priced' : null;
}

/** One estimate line a re-send takes out: the draft line it was pushed from and the estimate line it became. */
export interface PushRemoval { conditionId: string; materialId: string }

/** Where a pushed line's unit price came from, in the estimate's own words (types LinkedEstimateItem.priceSource). */
export type PushedPriceSource = NonNullable<LinkedEstimateItem['priceSource']>;

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * Take lines out of an estimate, moving the three totals by each line's own
 * amounts (the takeoff push's UPDATE arithmetic run to zero; never a re-total,
 * which would drop permits and contingency carried outside the lines). A line
 * is removed only when BOTH ids match: the draft line it was pushed from and
 * the estimate line that push wrote. Anything else is left where it is.
 */
export function removePushedLines(est: LinkedEstimate, removals: readonly PushRemoval[]): { next: LinkedEstimate; removedIds: string[] } {
  let { baseTotal, markupTotal, grandTotal } = est;
  const removedIds: string[] = [];
  const items = est.items.filter((it) => {
    const hit = removals.find((r) => r.materialId === it.materialId && r.conditionId === it.sourceTakeoffConditionId);
    if (!hit) return true;
    const cost = roundCents(num(it.quantity) * num(it.usesBulk ? it.bulkPrice : it.unitPrice));
    const line = num(it.lineTotal);
    baseTotal = roundCents(baseTotal - cost);
    grandTotal = roundCents(grandTotal - line);
    markupTotal = roundCents(markupTotal - roundCents(line - cost));
    removedIds.push(hit.conditionId);
    return false;
  });
  return removedIds.length ? { next: { ...est, items, baseTotal, markupTotal, grandTotal }, removedIds } : { next: est, removedIds };
}

/** Write where each pushed line's price came from onto its estimate line. Lines not named are left as they are. */
function stampSources(est: LinkedEstimate, sources: Record<string, PushedPriceSource> | undefined): LinkedEstimate {
  if (!sources) return est;
  let changed = false;
  const items = est.items.map((it) => {
    const src = it.sourceTakeoffConditionId ? sources[it.sourceTakeoffConditionId] : undefined;
    if (!src || it.priceSource === src) return it;
    changed = true;
    return { ...it, priceSource: src };
  });
  return changed ? { ...est, items } : est;
}

/** How many of the lines a push recorded are still on the project's estimate, under both ids the push wrote. */
export function pushedLinesInEstimate(project: Project | null, pushed: Record<string, string> | undefined): number {
  const items = project?.linkedEstimate?.items;
  if (!items || !pushed) return 0;
  return Object.entries(pushed).filter(([conditionId, materialId]) => items.some((it) => it.materialId === materialId && it.sourceTakeoffConditionId === conditionId)).length;
}

export interface EstimatePatchResult {
  patch: Partial<Project>;
  next: LinkedEstimate;
  pushed: Record<string, string>;
  added: number;
  updated: number;
  /** Lines this patch took out of the estimate (a re-send of an order list that no longer has them), by draft line id. */
  removedIds: string[];
  beforeGrand: number;
  afterGrand: number;
  /** True when this patch started the project's estimate. */
  started: boolean;
}

/**
 * The project patch that puts the draft into the estimate, or null.
 *
 * `confirmed` must be the literal `true` from the person's tap on the confirm
 * sheet, and `mayEdit` the literal `true` from his seat on the project.
 * Without both this returns null: there is no code path that builds a patch,
 * and so none that saves, before the person has said yes or for a seat that
 * may not change the estimate.
 * `pushed` is the scan's record of which estimate line each draft line became,
 * so pricing the same scan twice updates those lines instead of adding copies.
 *
 * NO ESTIMATE YET: the lines are laid down at cost by the same takeoff push
 * (so each keeps its scan line id and its price source), then footed at his
 * stated markup by buildNewEstimate, the app's one "new estimate from cost
 * lines" writer. `now` is the new estimate's createdAt.
 *
 * `remove` (the order list only) names lines an earlier send wrote that the
 * list no longer has: they are taken out in the same patch, after the push.
 * `sources` stamps each written line with where its price came from.
 */
export function buildEstimatePatch(args: {
  confirmed: boolean;
  mayEdit: boolean;
  project: Project | null;
  draft: PushableDraft;
  pushed: Record<string, string>;
  newId: () => string;
  markupPct: MarkupPct;
  now: string;
  remove?: readonly PushRemoval[];
  sources?: Record<string, PushedPriceSource>;
}): EstimatePatchResult | null {
  if (args.confirmed !== true) return null;
  if (args.mayEdit !== true) return null;
  if (draftBlock(args.project, args.draft, { mayEdit: args.mayEdit, markupPct: args.markupPct }) !== null) return null;
  const project = args.project as Project;
  const lines = draftPushLines(args.draft);
  if (!project.linkedEstimate) {
    if (!isMarkupSet(args.markupPct)) return null;
    const blank: LinkedEstimate = { id: '', items: [], globalMarkup: 0, baseTotal: 0, markupTotal: 0, grandTotal: 0, createdAt: args.now };
    const atCost = applyTakeoffPush(blank, lines, {}, args.newId);
    const footed = buildNewEstimate(atCost.next.items, args.markupPct, args.newId(), args.now);
    const next: LinkedEstimate = stampSources({ ...footed, globalMarkup: args.markupPct }, args.sources);
    const patch = commitEstimatePatch(project, next, { reason: 'pre_overwrite' });
    return { patch, next, pushed: atCost.pushed, added: atCost.added, updated: 0, removedIds: [], beforeGrand: 0, afterGrand: next.grandTotal, started: true };
  }
  const est = project.linkedEstimate;
  const res = applyTakeoffPush(est, lines, args.pushed, args.newId);
  const cut = removePushedLines(stampSources(res.next, args.sources), args.remove ?? []);
  const pushed = { ...res.pushed };
  for (const id of cut.removedIds) delete pushed[id];
  const patch = commitEstimatePatch(project, cut.next, { reason: 'pre_overwrite' });
  return { patch, next: cut.next, pushed, added: res.added, updated: res.updated, removedIds: cut.removedIds, beforeGrand: res.beforeGrand, afterGrand: cut.next.grandTotal, started: false };
}

/**
 * Is the push in the project the app now holds? True when every line the
 * patch wrote is on the project's estimate, under the id the patch gave it and
 * carrying its scan line id. The screen says "Added to the estimate." only
 * after this is true for the project read back from the app's own state. A
 * line the patch took out must be gone too.
 */
export function estimateHoldsPush(project: Project | null, res: Pick<EstimatePatchResult, 'pushed' | 'next'> & { removedIds?: readonly string[] }): boolean {
  const items = project?.linkedEstimate?.items;
  if (!items || project?.linkedEstimate?.id !== res.next.id) return false;
  if ((res.removedIds ?? []).some((id) => items.some((it) => it.sourceTakeoffConditionId === id))) return false;
  const written = res.next.items.filter((it) => it.sourceTakeoffConditionId && res.pushed[it.sourceTakeoffConditionId] === it.materialId);
  if (written.length === 0) return false;
  return written.every((w) => items.some((it) =>
    it.materialId === w.materialId && it.sourceTakeoffConditionId === w.sourceTakeoffConditionId
    && it.quantity === w.quantity && it.unitPrice === w.unitPrice));
}
