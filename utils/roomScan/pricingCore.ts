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
// by the person's tap on the confirm sheet, and returns the patch for the
// caller to hand to updateProject. The pure core cannot write anything.
//
// Pure: no React, no storage. The caller passes the cost book and the clock.

import type { LinkedEstimate, Project } from '@/types';
import { lookupRate, type CostBookEntry, type CostDatabase } from '@/utils/costDatabase';
import { commitEstimatePatch } from '@/utils/estimateCommit';
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

/** His own trade for a recipe line: the exact trade when his book has it, else the best word match, else the default. */
export function resolveTrade(db: CostDatabase, line: RecipeLine): string {
  const unit = KIND_UNIT[line.kind];
  if (lookupRate(db, line.defaultTrade, unit)) return line.defaultTrade;
  const m = matchOwnRate({ description: line.matchWords, unit }, db.entries);
  return m ? m.trade : line.defaultTrade;
}

function claimFor(entry: CostBookEntry): OwnPriceClaim {
  const provenance = entry.provenance ?? 'earned';
  const model = provenanceClaimModel({ provenance, jobCount: entry.jobCount ?? 0, earnedBasis: entry.earnedBasis });
  // No model = an earned entry with no measured job behind it. It may claim nothing beyond being his.
  return model
    ? { tone: model.tone, provenance: model.provenance, jobCount: model.jobCount, trade: entry.trade }
    : { tone: 'stated', provenance: 'seeded', jobCount: 0, trade: entry.trade };
}

/** Price every recipe line for this room. Reads only: no estimate is touched. */
export function buildScanDraft(
  scan: Pick<RoomScan, 'id' | 'roomType' | 'capturedAt'>,
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
      claim: source === 'yours' && price.entry ? claimFor(price.entry) : null,
      included: !excluded.has(recipe.key),
      row: { condition, totals, price },
    });
  }
  const live = lines.filter((l) => l.included);
  const priced = live.filter((l) => l.amountCents != null);
  return {
    scanId: scan.id,
    lines,
    totalCents: priced.reduce((s, l) => s + (l.amountCents as number), 0),
    pricedCount: priced.length,
    unpricedCount: live.length - priced.length,
    ownCount: priced.filter((l) => l.source === 'yours').length,
    catalogCount: priced.filter((l) => l.source === 'engine').length,
    manualCount: priced.filter((l) => l.source === 'manual').length,
  };
}

/** The lines the push would write: included, with a quantity and a rate. */
export function draftPushLines(draft: ScanDraft): PushLine[] {
  return pushLinesFrom(draft.lines.filter((l) => l.included).map((l) => l.row)).lines;
}

export type DraftBlock = 'no_project' | 'nothing_priced' | 'no_estimate';

/** Why the draft cannot go to the estimate, or null. The takeoff's own rule (pushBlockReason), as a code the screen puts into words. */
export function draftBlock(project: Project | null, draft: ScanDraft): DraftBlock | null {
  const lines = draftPushLines(draft);
  if (!project) return 'no_project';
  if (!lines.length) return 'nothing_priced';
  if (!project.linkedEstimate) return 'no_estimate';
  return pushBlockReason(project, lines) ? 'no_estimate' : null;
}

export interface EstimatePatchResult {
  patch: Partial<Project>;
  next: LinkedEstimate;
  pushed: Record<string, string>;
  added: number;
  updated: number;
  beforeGrand: number;
  afterGrand: number;
}

/**
 * The project patch that puts the draft into the estimate, or null.
 *
 * `confirmed` must be the literal `true` from the person's tap on the confirm
 * sheet. Without it this returns null: there is no code path that builds a
 * patch, and so none that saves, before the person has said yes.
 * `pushed` is the scan's record of which estimate line each draft line became,
 * so pricing the same scan twice updates those lines instead of adding copies.
 */
export function buildEstimatePatch(args: {
  confirmed: boolean;
  project: Project | null;
  draft: ScanDraft;
  pushed: Record<string, string>;
  newId: () => string;
}): EstimatePatchResult | null {
  if (args.confirmed !== true) return null;
  if (draftBlock(args.project, args.draft) !== null) return null;
  const project = args.project as Project;
  const est = project.linkedEstimate as LinkedEstimate;
  const res = applyTakeoffPush(est, draftPushLines(args.draft), args.pushed, args.newId);
  const patch = commitEstimatePatch(project, res.next, { reason: 'pre_overwrite' });
  return { patch, next: res.next, pushed: res.pushed, added: res.added, updated: res.updated, beforeGrand: res.beforeGrand, afterGrand: res.afterGrand };
}
