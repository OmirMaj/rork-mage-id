// utils/takeoff/conditionPush.ts — "Push N lines to estimate" (wave 4, pure).
//
// THE MONEY CONTRACT. Each priced condition becomes ONE estimate line. A
// re-push UPDATES that line (matched by sourceTakeoffConditionId, else by the
// materialId the last push wrote) instead of appending a duplicate.
//
// Markup lives INSIDE lineTotal (AIA-F11 — the long comment above
// "--- BEGIN takeoff append ---" in app/area-takeoff.tsx): Σ items.lineTotal
// === grandTotal, and G703 column C (built from lineTotal) foots to G702
// line 3 (grandTotal). So:
//   • APPEND is the phone block's arithmetic exactly: markup % = the estimate's
//     realized ratio markupTotal / baseTotal, lineTotal = roundCents(cost ×
//     (1 + m)), and the three totals move by the new line only.
//   • UPDATE keeps the line's materialId and its OWN markup % (he may have
//     edited it in the estimator) and moves the totals by the line's deltas —
//     measured against the line's EFFECTIVE old price (bulkPrice when he
//     switched it to bulk). Never recomputeEstimate: its Σ-lineTotal retotal
//     would drop permits / contingency carried outside the lines.
// quantity and rate are exactly what the panel priced (row.price.qty and
// row.price.rateCents / 100), so the footer and the estimate agree to the cent.

import type { LinkedEstimate, LinkedEstimateItem, Project } from '@/types';
import { roundCents } from '@/utils/invoiceBilling';
import type { TakeoffRollup } from '@/utils/takeoff/conditions';

export interface PushLine {
  conditionId: string;
  name: string;
  trade: string | null;
  unit: 'SF' | 'LF' | 'EA';
  quantity: number;
  rate: number;
  priceSource: 'learned' | 'seeded' | undefined;
}

export type PushSkipReason = 'no_rate' | 'no_quantity' | 'not_measured';

export function pushLinesFrom(rows: TakeoffRollup['rows']): {
  lines: PushLine[];
  skipped: { conditionId: string; reason: PushSkipReason }[];
} {
  const lines: PushLine[] = [];
  const skipped: { conditionId: string; reason: PushSkipReason }[] = [];
  for (const row of rows) {
    const id = row.condition.id;
    const quantity = row.price.qty;
    if (!(quantity > 0)) {
      skipped.push({ conditionId: id, reason: row.totals.unmeasuredCount > 0 ? 'not_measured' : 'no_quantity' });
      continue;
    }
    if (row.price.rateCents == null || row.price.rateCents <= 0) {
      skipped.push({ conditionId: id, reason: 'no_rate' });
      continue;
    }
    const priceSource: PushLine['priceSource'] = row.price.rateSource === 'book'
      ? (row.price.entry?.provenance === 'seeded' ? 'seeded' : 'learned')
      : undefined;
    lines.push({
      conditionId: id,
      name: row.condition.name,
      trade: row.condition.trade,
      unit: row.totals.unit,
      quantity,
      rate: row.price.rateCents / 100,
      priceSource,
    });
  }
  return { lines, skipped };
}

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

function withSource(item: LinkedEstimateItem, src: PushLine['priceSource']): LinkedEstimateItem {
  const out: LinkedEstimateItem = { ...item };
  if (src) out.priceSource = src;
  else delete out.priceSource;
  return out;
}

export function applyTakeoffPush(
  est: LinkedEstimate,
  lines: PushLine[],
  pushed: Record<string, string>,
  newId: () => string,
): {
  next: LinkedEstimate;
  pushed: Record<string, string>;
  added: number;
  updated: number;
  beforeGrand: number;
  afterGrand: number;
} {
  // Every APPEND in this push takes the ratio of the estimate as it stood
  // before the push — the phone's rule, applied once per push.
  const ratio = est.baseTotal > 0 ? est.markupTotal / est.baseTotal : 0;
  const markupPct = ratio * 100;
  const items = [...est.items];
  let baseTotal = est.baseTotal;
  let markupTotal = est.markupTotal;
  let grandTotal = est.grandTotal;
  const outPushed: Record<string, string> = { ...pushed };
  let added = 0;
  let updated = 0;

  for (const line of lines) {
    const cost = roundCents(line.quantity * line.rate);
    const name = line.name;
    const category = line.trade ?? line.name;
    let idx = items.findIndex(it => it.sourceTakeoffConditionId === line.conditionId);
    if (idx < 0 && pushed[line.conditionId]) {
      const mid = pushed[line.conditionId];
      idx = items.findIndex(it => it.materialId === mid
        && (!it.sourceTakeoffConditionId || it.sourceTakeoffConditionId === line.conditionId));
    }

    if (idx >= 0) {
      // ── UPDATE in place ──
      const old = items[idx];
      const markup = Number.isFinite(old.markup) ? old.markup : 0;
      const oldCost = roundCents(num(old.quantity) * num(old.usesBulk ? old.bulkPrice : old.unitPrice));
      const oldLineTotal = num(old.lineTotal);
      const lineTotal = roundCents(cost * (1 + markup / 100));
      const dCost = roundCents(cost - oldCost);
      const dLine = roundCents(lineTotal - oldLineTotal);
      const nextItem = withSource({
        ...old,
        name,
        category,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.rate,
        bulkPrice: line.rate,
        usesBulk: false,
        markup,
        lineTotal,
        sourceTakeoffConditionId: line.conditionId,
      }, line.priceSource);
      if (JSON.stringify(nextItem) !== JSON.stringify(old)) updated++;
      items[idx] = nextItem;
      baseTotal = roundCents(baseTotal + dCost);
      grandTotal = roundCents(grandTotal + dLine);
      markupTotal = roundCents(markupTotal + roundCents(dLine - dCost));
      outPushed[line.conditionId] = old.materialId;
      continue;
    }

    // ── APPEND (the phone block's footing) ──
    const lineTotal = roundCents(cost * (1 + markupPct / 100));
    const materialId = newId();
    const item = withSource({
      materialId,
      name,
      category,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.rate,
      bulkPrice: line.rate,
      markup: markupPct,
      usesBulk: false,
      lineTotal,
      supplier: '',
      sourceTakeoffConditionId: line.conditionId,
    }, line.priceSource);
    items.push(item);
    baseTotal = roundCents(baseTotal + cost);
    markupTotal = roundCents(markupTotal + roundCents(lineTotal - cost));
    grandTotal = roundCents(grandTotal + lineTotal);
    outPushed[line.conditionId] = materialId;
    added++;
  }

  const next: LinkedEstimate = { ...est, items, baseTotal, markupTotal, grandTotal };
  return { next, pushed: outPushed, added, updated, beforeGrand: est.grandTotal, afterGrand: grandTotal };
}

/**
 * Why the push button is blocked, in words — or null when it can push.
 *
 * A job with NO estimate is blocked rather than given one here: an empty
 * estimate has baseTotal 0, so the append ratio is 0 and every pushed line
 * would land with NO markup — silently giving away his margin — and his
 * stated default markup lives in settings, not on the project.
 */
export function pushBlockReason(project: Project | null, lines: PushLine[]): string | null {
  if (!project) return 'Pick a job to push to.';
  if (!lines.length) return 'Nothing to push — every condition needs a quantity and a rate.';
  if (!project.linkedEstimate) return 'This job has no estimate yet — start one in Estimate, then push.';
  return null;
}
