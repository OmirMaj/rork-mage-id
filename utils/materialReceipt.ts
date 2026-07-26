// materialReceipt.ts — turn a snapped supplier invoice into clean, costed data.
//
// The GC photographs a lumber-yard or supply-house invoice; analyze-photos
// (task 'receipt') reads it into a rough JSON shape. This module is the pure
// layer that (a) NORMALIZES that rough extraction into a trustworthy
// MaterialReceipt — coercing numbers, recomputing every total so we never trust
// an OCR'd sum, parsing the date — and (b) converts a receipt's line items into
// CostSamples that feed the personal Cost Database, so the next estimate is
// priced off what materials ACTUALLY cost you.
//
// No network, no storage. The screen does the AI call + persistence; this module
// is the deterministic math both sides rely on.

import type { MaterialReceipt, MaterialReceiptLine } from '@/types';
import type { CostSample } from '@/utils/costDatabase';

/** The loose JSON the vision model returns — every field optional/untrusted. */
export interface RawReceiptExtraction {
  vendor?: string;
  receiptDate?: string;
  documentNumber?: string;
  subtotal?: number | string;
  tax?: number | string;
  total?: number | string;
  confidence?: number | string;
  lines?: Array<{
    description?: string;
    category?: string;
    quantity?: number | string;
    unit?: string;
    unitPrice?: number | string;
    lineTotal?: number | string;
  }>;
}

/** JSON example we hand the vision model (schemaHint). */
export const RECEIPT_SCHEMA_HINT = {
  vendor: 'string',
  receiptDate: 'YYYY-MM-DD',
  documentNumber: 'string',
  subtotal: 0,
  tax: 0,
  total: 0,
  confidence: 0,
  lines: [
    { description: 'string', category: 'string', quantity: 0, unit: 'string', unitPrice: 0, lineTotal: 0 },
  ],
};

/** Coerce a possibly-stringy ("$1,234.50") number to a finite non-negative float. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function clampPct(v: unknown): number | undefined {
  const n = num(v);
  if (n <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Best-effort date normalization to YYYY-MM-DD; returns the raw string if it
 *  can't be parsed (better to show what was printed than to drop it). */
function normalizeDate(raw?: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const s = raw.trim();
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return s;
}

let lineSeq = 0;
function lineId(): string {
  lineSeq += 1;
  return `mrl_${Date.now().toString(36)}_${lineSeq.toString(36)}`;
}

/**
 * Normalize a raw extraction into a trustworthy MaterialReceipt.
 *
 * Trust rules:
 *  - Every lineTotal is RECOMPUTED as quantity × unitPrice. If the model gave a
 *    lineTotal but no unitPrice (common — the line only printed an extended
 *    price), we back out unitPrice = lineTotal / quantity instead.
 *  - subtotal is recomputed from the lines (the document's printed subtotal is
 *    kept as `total` reconciliation context, not as the source of truth).
 *  - Lines with no description AND no money are dropped (OCR noise).
 */
export function normalizeExtraction(
  raw: RawReceiptExtraction,
  ctx: { projectId: string; commitmentId?: string; imageUri?: string; now?: string },
): MaterialReceipt {
  const now = ctx.now ?? new Date().toISOString();

  const lines: MaterialReceiptLine[] = (raw.lines ?? [])
    .map((l): MaterialReceiptLine | null => {
      const description = (l.description ?? '').trim();
      const quantity = num(l.quantity);
      let unitPrice = num(l.unitPrice);
      const printedLineTotal = num(l.lineTotal);

      // Recover unit price from an extended total when only the latter was read.
      if (unitPrice === 0 && printedLineTotal > 0 && quantity > 0) {
        unitPrice = printedLineTotal / quantity;
      }
      const qty = quantity > 0 ? quantity : printedLineTotal > 0 && unitPrice > 0 ? printedLineTotal / unitPrice : 0;
      const lineTotal = qty * unitPrice;

      if (!description && lineTotal === 0) return null; // noise row
      return {
        id: lineId(),
        description: description || 'Material',
        category: (l.category ?? '').trim() || undefined,
        quantity: qty,
        unit: (l.unit ?? '').trim() || 'ea',
        unitPrice,
        lineTotal,
      };
    })
    .filter((l): l is MaterialReceiptLine => l !== null);

  const subtotal = round2(lines.reduce((a, l) => a + l.lineTotal, 0));
  const tax = raw.tax != null ? round2(num(raw.tax)) : undefined;
  // Prefer the document's printed total; fall back to subtotal+tax.
  const printedTotal = num(raw.total);
  const total = printedTotal > 0 ? round2(printedTotal) : round2(subtotal + (tax ?? 0));

  return {
    id: `mr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    projectId: ctx.projectId,
    commitmentId: ctx.commitmentId,
    vendor: (raw.vendor ?? '').trim() || 'Unknown supplier',
    receiptDate: normalizeDate(raw.receiptDate),
    documentNumber: (raw.documentNumber ?? '').trim() || undefined,
    lines,
    subtotal,
    tax: tax && tax > 0 ? tax : undefined,
    total,
    imageUri: ctx.imageUri,
    status: 'extracted',
    confidence: clampPct(raw.confidence),
    createdAt: now,
    updatedAt: now,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum of line totals (the costed material spend on this receipt). */
export function receiptLinesTotal(r: MaterialReceipt): number {
  return round2(r.lines.reduce((a, l) => a + l.lineTotal, 0));
}

/**
 * Does the summed lines reconcile with the document's printed total? Surfaces
 * OCR drift to the user ("lines add to $4,180 but the invoice says $4,200").
 * Tolerance is the larger of $1 or 1% (tax/fees the lines don't carry).
 */
export function reconcile(r: MaterialReceipt): { ok: boolean; linesTotal: number; printedTotal: number; diff: number } {
  const linesTotal = receiptLinesTotal(r) + (r.tax ?? 0);
  const printedTotal = r.total;
  const diff = round2(printedTotal - linesTotal);
  const tol = Math.max(1, printedTotal * 0.01);
  return { ok: Math.abs(diff) <= tol, linesTotal: round2(linesTotal), printedTotal, diff };
}

/**
 * Convert a receipt's line items into Cost Database samples. Each line becomes
 * one `actual` sample keyed by its category (trade) + unit, with bidUnit 0 (a
 * material receipt has no bid context — it's pure paid cost). These augment the
 * closed-job samples buildCostDatabase derives, so material prices feed the
 * price book the day you buy, not at closeout.
 */
export function receiptToCostSamples(r: MaterialReceipt, projectName: string): CostSample[] {
  const closedAt = r.receiptDate || r.createdAt.slice(0, 10);
  const out: CostSample[] = [];
  for (const l of r.lines) {
    if (l.quantity <= 0 || l.unitPrice <= 0) continue;
    out.push({
      projectId: r.projectId,
      projectName,
      trade: (l.category || 'Materials').trim() || 'Materials',
      unit: l.unit || 'ea',
      quantity: l.quantity,
      bidUnit: 0,
      actualUnit: l.unitPrice,
      basis: 'actual',
      closedAt,
      // Provenance flows into the cost book (F5): confirmed QBO lines are
      // distinguishable from scanned supplier invoices downstream.
      source: r.origin === 'qbo' ? 'qbo' : 'receipt',
    });
  }
  return out;
}

export interface ReceiptRollup {
  /** keyed id → { label, count, total } */
  total: number;
  count: number;
  byCommitment: Map<string, number>;
  byVendor: Map<string, number>;
}

/** Aggregate a set of receipts for dashboards / per-PO spend. */
export function rollupReceipts(receipts: MaterialReceipt[]): ReceiptRollup {
  const byCommitment = new Map<string, number>();
  const byVendor = new Map<string, number>();
  let total = 0;
  for (const r of receipts) {
    const t = receiptLinesTotal(r);
    total += t;
    if (r.commitmentId) byCommitment.set(r.commitmentId, (byCommitment.get(r.commitmentId) ?? 0) + t);
    byVendor.set(r.vendor, (byVendor.get(r.vendor) ?? 0) + t);
  }
  return { total: round2(total), count: receipts.length, byCommitment, byVendor };
}
