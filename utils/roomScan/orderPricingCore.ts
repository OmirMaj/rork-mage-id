// utils/roomScan/orderPricingCore.ts — the order list as material lines for the
// estimate, through the SAME takeoff-to-estimate path the room draft uses.
//
// Nothing here prices or writes by rules of its own (read the top of
// utils/roomScan/pricingCore.ts for the path):
//   an order line          becomes a TakeoffCondition          (utils/takeoff/conditions)
//   its amount             is priceCondition(db, condition)
//   what the push writes   is pricingCore.draftPushLines        (pushLinesFrom)
//   the estimate and save  are pricingCore.buildEstimatePatch   (applyTakeoffPush, commitEstimatePatch)
// The order draft is a `PushableDraft`, so the confirm, the seat check, the
// markup rule for a project with no estimate and the "is it really there"
// check are the room draft's own functions, not copies.
//
// WHERE A MATERIAL PRICE COMES FROM, and why it is never "Your Price":
//   'manual'  he typed a price for one sheet, one gallon, one stick. It wins.
//   'engine'  a catalog price for that one named material (constants/materials,
//             the material cost only, moved by the regional factor), labelled
//             as a catalog price.
//   null      no price. "No Price Yet", nothing in the total, NOT pushed.
// His own cost book is NOT read here. It holds what work cost him installed,
// by the square foot or the foot (utils/costDatabase). A sheet of drywall
// priced from his installed drywall rate would be a wrong number wearing the
// "Your Price" label. When the app holds what he pays for materials by the
// piece, this is where it plugs in.
//
// MATERIAL ONLY. These lines are what to buy. If the estimate already prices
// the same work installed (the room draft's "Drywall, Walls"), the material is
// in there twice: the confirm sheet says so in plain words.
//
// SENDING THE LIST A SECOND TIME. He changes the list (16 ft sticks only, paint
// off, a line typed to zero) and sends again. `planOrderResend` works out,
// BEFORE the confirm sheet opens, what the yes will do beyond adding and
// updating:
//   remove      a line an earlier send of THIS scan's order list wrote, that
//               the list no longer has, and that he has not touched since. The
//               sheet names every one of them before the yes.
//   leave alone a line he changed by hand in the estimate after the send (its
//               name, unit, quantity or price is no longer what the send
//               wrote). It is neither updated nor removed, and the sheet names
//               it and says why.
// A line is only ever matched by BOTH ids the send recorded (the order line's
// id, which carries this scan's id, and the estimate line the send wrote), so
// a line that came from anywhere else, another scan, the room draft, or his
// own typing, cannot be touched. `OrderWrote` is the record that makes "has he
// changed it" answerable: what each line said the moment the send wrote it.
//
// THE PRICE SOURCE ON THE ESTIMATE LINE. The takeoff push leaves a typed or a
// catalog price with no `priceSource`. These lines say it instead, in the
// estimate's own words (types LinkedEstimateItem.priceSource):
//   'regional'  a catalog price for the material, moved by the regional factor;
//   'seeded'    a price he typed himself.
// Never 'learned': nothing here is read from his measured cost book.
//
// Pure: no React, no storage.

import { getLivePrices, getMaterialCostBreakdown, getRegionMultiplier } from '@/constants/materials';
import type { LinkedEstimate } from '@/types';
import type { CostDatabase } from '@/utils/costDatabase';
import type { PushLine } from '@/utils/takeoff/conditionPush';
import { priceCondition, type ConditionKind, type ConditionTotals, type RollupRow, type TakeoffCondition } from '@/utils/takeoff/conditions';
import type { SheetKey } from './cutPlanCore';
import { orderLinesToBuy, type OrderLine, type OrderList } from './orderListCore';
import type { EstimatePatchResult, PushRemoval, PushableDraft, PushedPriceSource, ScanPriceSource } from './pricingCore';
import type { RoomScan } from './types';

export type OrderPriceSource = Extract<ScanPriceSource, 'manual' | 'engine'>;

/** The one catalog item an order line is priced from, by its id in constants/materials. null = the catalog names nothing honest for it. */
export function catalogItemFor(line: Pick<OrderLine, 'key'>, sheet: SheetKey): string | null {
  switch (line.key) {
    case 'drywall_walls':
    case 'drywall_ceiling':
    case 'drywall_spare': return sheet === '4x8' ? 'd1' : sheet === '4x12' ? 'd2' : null;
    case 'screws': return 'd12';
    case 'compound': return 'd6';
    case 'tape': return 'd8';
    case 'corner_bead': return 'd10';
    case 'paint_walls':
    case 'paint_ceiling': return 'pa1';
    case 'primer': return 'pa6';
    // Flooring, tile and trim are chosen by the client and the profile: no one catalog item stands for them.
    default: return null;
  }
}

export type MaterialRater = (line: Pick<OrderLine, 'key'>, sheet: SheetKey) => number | null;

/** Catalog material prices for one job location ('' is the US average). Read once. */
export function makeMaterialRater(location: string): MaterialRater {
  const priced = getLivePrices(100, getRegionMultiplier(location ?? ''));
  return (line, sheet) => {
    const id = catalogItemFor(line, sheet);
    const item = id ? priced.find((m) => m.id === id) : undefined;
    if (!item) return null;
    const rate = Number(getMaterialCostBreakdown(item).materialCost.toFixed(2));
    return rate > 0 ? rate : null;
  };
}

export interface OrderDraftLine {
  key: string;
  conditionId: string;
  name: string;
  unit: 'SF' | 'LF' | 'EA';
  quantity: number;
  rate: number | null;
  amountCents: number | null;
  source: OrderPriceSource | null;
  included: boolean;
  row: RollupRow;
}

export interface OrderDraft extends PushableDraft {
  scanId: string;
  lines: OrderDraftLine[];
  totalCents: number;
  pricedCount: number;
  unpricedCount: number;
  catalogCount: number;
  manualCount: number;
}

export function orderConditionId(scanId: string, key: string): string {
  return `scanorder:${scanId}:${key}`;
}

/** Price every line of the order list that has something to buy. Reads only: no estimate is touched. */
export function buildOrderDraft(
  scan: Pick<RoomScan, 'id' | 'capturedAt'> & { name?: string },
  list: OrderList,
  db: CostDatabase,
  catalog: MaterialRater,
  choices: { manualRates?: Record<string, number>; names?: Record<string, string> } = {},
): OrderDraft {
  const lines: OrderDraftLine[] = [];
  for (const l of orderLinesToBuy(list)) {
    const kind: ConditionKind = l.unit === 'sqft' ? 'area' : l.unit === 'foot' ? 'linear' : 'count';
    const unit = kind === 'area' ? 'SF' : kind === 'linear' ? 'LF' : 'EA';
    const manual = choices.manualRates?.[l.key];
    const hasManual = typeof manual === 'number' && Number.isFinite(manual) && manual > 0;
    const catalogRate = hasManual ? null : catalog(l, list.options.sheet);
    const rate = hasManual ? (manual as number) : catalogRate != null && catalogRate > 0 ? catalogRate : null;
    const condition: TakeoffCondition = {
      id: orderConditionId(scan.id, l.key),
      name: choices.names?.[l.key] ?? l.key,
      kind,
      // No trade: his cost book holds installed rates, not what a sheet or a gallon costs (see the top of this file).
      trade: null,
      rateOverride: rate,
      // The list's own allowance is already in the quantity. None is added a second time.
      wastePct: 0,
      heightFt: null,
      color: '',
      createdAt: scan.capturedAt,
    };
    const price = priceCondition(db, condition, l.quantity);
    if (!(price.qty > 0)) continue;
    const totals: ConditionTotals = {
      conditionId: condition.id, net: l.quantity, billable: l.quantity, unit, wallSf: null,
      unmeasuredCount: 0, measuredCount: 1, unmeasuredSheetIds: [], source: 'measured', aiReadQty: null,
    };
    const priced = price.amountCents != null && price.rateSource === 'override';
    lines.push({
      key: l.key,
      conditionId: condition.id,
      name: condition.name,
      unit,
      quantity: price.qty,
      rate: priced ? price.rate : null,
      amountCents: priced ? price.amountCents : null,
      source: priced ? (hasManual ? 'manual' : 'engine') : null,
      included: true,
      row: { condition, totals, price },
    });
  }
  const priced = lines.filter((l) => l.amountCents != null);
  return {
    scanId: scan.id,
    roomName: (scan.name ?? '').trim(),
    lines,
    totalCents: priced.reduce((s, l) => s + (l.amountCents as number), 0),
    pricedCount: priced.length,
    unpricedCount: lines.length - priced.length,
    catalogCount: priced.filter((l) => l.source === 'engine').length,
    manualCount: priced.filter((l) => l.source === 'manual').length,
  };
}

// ── sending the list again ──────────────────────────────────────────────────
/** What one estimate line said the moment a send wrote it. */
export interface OrderWrote { materialId: string; name: string; unit: string; quantity: number; unitPrice: number }

export const orderConditionPrefix = (scanId: string): string => `scanorder:${scanId}:`;

/** The record of what a send wrote, for the lines named in `conditionIds`. */
export function orderWroteFrom(res: Pick<EstimatePatchResult, 'next' | 'pushed'>, conditionIds: readonly string[]): Record<string, OrderWrote> {
  const out: Record<string, OrderWrote> = {};
  for (const id of conditionIds) {
    const materialId = res.pushed[id];
    const it = materialId ? res.next.items.find((x) => x.materialId === materialId && x.sourceTakeoffConditionId === id) : undefined;
    if (it) out[id] = { materialId: it.materialId, name: it.name, unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice };
  }
  return out;
}

export interface OrderResendLine extends PushRemoval { name: string }

export interface OrderResendPlan {
  /** Lines an earlier send wrote that the list no longer has and he has not touched: the yes takes them out. */
  remove: OrderResendLine[];
  /** Lines he changed by hand in the estimate after the send: neither updated nor removed. */
  leftAlone: OrderResendLine[];
  /** Order line ids on the list now that must NOT be written, because their estimate line is one he changed. */
  skip: string[];
}

/**
 * What a second send would do beyond adding and updating. Reads only. Read the
 * top of this file for the two rules. `lines` are the lines the list would
 * push now (pricingCore.draftPushLines of the current draft).
 */
export function planOrderResend(args: {
  estimate: LinkedEstimate | null | undefined;
  scanId: string;
  pushed: Record<string, string> | undefined;
  wrote: Record<string, OrderWrote> | undefined;
  lines: readonly Pick<PushLine, 'conditionId'>[];
}): OrderResendPlan {
  const plan: OrderResendPlan = { remove: [], leftAlone: [], skip: [] };
  const items = args.estimate?.items;
  if (!items) return plan;
  const prefix = orderConditionPrefix(args.scanId);
  const current = new Set(args.lines.map((l) => l.conditionId));
  for (const [conditionId, materialId] of Object.entries(args.pushed ?? {})) {
    if (!conditionId.startsWith(prefix)) continue;
    const it = items.find((x) => x.materialId === materialId && x.sourceTakeoffConditionId === conditionId);
    // Not on the estimate any more (he deleted it there): nothing to remove and nothing to protect.
    if (!it) continue;
    const w = args.wrote?.[conditionId];
    // With no record of what the send wrote, it cannot be shown that he has NOT changed it: it is left alone.
    const edited = !w || w.materialId !== it.materialId || it.name !== w.name || it.unit !== w.unit || it.quantity !== w.quantity || it.unitPrice !== w.unitPrice || it.usesBulk === true;
    const row: OrderResendLine = { conditionId, materialId, name: it.name };
    if (edited) {
      plan.leftAlone.push(row);
      if (current.has(conditionId)) plan.skip.push(conditionId);
    } else if (!current.has(conditionId)) plan.remove.push(row);
  }
  return plan;
}

/** The draft with the lines a re-send must not write taken out of the push. */
export function orderDraftWithout(draft: OrderDraft, skip: readonly string[]): OrderDraft {
  if (!skip.length) return draft;
  const gone = new Set(skip);
  return { ...draft, lines: draft.lines.map((l) => (gone.has(l.conditionId) ? { ...l, included: false } : l)) };
}

/** Where each priced line's price came from, in the estimate's own words, by order line id. */
export function orderPriceSources(draft: OrderDraft): Record<string, PushedPriceSource> {
  const out: Record<string, PushedPriceSource> = {};
  for (const l of draft.lines) {
    if (l.source === 'engine') out[l.conditionId] = 'regional';
    else if (l.source === 'manual') out[l.conditionId] = 'seeded';
  }
  return out;
}
