// utils/qbo/qboCostMap.ts — staged QBO cost line → MaterialReceipt mapping.
//
// Pure. No React, no network, no storage.
//
// F5 (Friday Close campaign, D2): confirmed QBO Purchase/Bill lines
// materialize as MaterialReceipt{origin:'qbo'} with DETERMINISTIC ids —
// one conversion buys the entire downstream for free (job-cost actuals via
// JobCostInput.receipts, cost-book samples via receiptToCostSamples) with
// zero edits to jobCostEngine or its callers.
//
// Receipts are deliberately device-local (useMaterialReceipts, AsyncStorage)
// and die on re-auth; the qbo_cost_lines staging table is the durable truth.
// Deterministic ids make re-materialization idempotent: any device can replay
// confirmed rows into its local store without doubles.
//
// G11: nothing silent into the cost book — stagedLineToReceipt returns null
// for unmapped rows (no project), forcing the confirm queue to assign one,
// and findLikelyDuplicate powers the scanned-receipt double-count warning
// (silent bulk-confirm of flagged duplicates is forbidden in the UI).

import type { MaterialReceipt } from '@/types';

/** Client-side read shape of a public.qbo_cost_lines row
 *  (migration 20260726120100). */
export interface QboCostLineRow {
  id: string;
  qbo_type: 'purchase' | 'bill';
  qbo_id: string;
  qbo_line_id: string;
  doc_number: string | null;
  vendor: string | null;
  /** YYYY-MM-DD (Postgres date). */
  txn_date: string | null;
  amount: number;
  description: string | null;
  account_name: string | null;
  qbo_customer_ref: string | null;
  /** Resolved via projects.qbo_customer_id; null = needs assignment. */
  project_id: string | null;
  status: 'staged' | 'confirmed' | 'rejected';
  created_at?: string;
  updated_at?: string;
}

/** Deterministic receipt id for a staged line: `qbo-<type>-<qboId>-<lineId>`.
 *  Same row always yields the same id — idempotent re-materialization. An
 *  empty line id (header-level rows) normalizes to '0'. */
export function qboReceiptId(row: Pick<QboCostLineRow, 'qbo_type' | 'qbo_id' | 'qbo_line_id'>): string {
  return `qbo-${row.qbo_type}-${row.qbo_id}-${row.qbo_line_id || '0'}`;
}

export interface StagedLineToReceiptOpts {
  /** Confirm-queue project assignment for unmapped rows. The row's own
   *  resolved project_id wins when both are present. */
  projectId?: string;
  /** ISO timestamp for createdAt/updatedAt — pass for deterministic tests;
   *  defaults to now. */
  now?: string;
}

/**
 * Convert a staged QBO cost line into a MaterialReceipt ready for
 * useMaterialReceipts.addReceipt.
 *
 * Returns null when:
 *  - no project is known (row unresolved AND no confirm-time assignment) —
 *    the confirm queue must assign one first; we never guess, and
 *  - the amount is not positive (credits/refunds are skipped server-side;
 *    this is the belt-and-suspenders client guard).
 */
export function stagedLineToReceipt(
  row: QboCostLineRow,
  opts: StagedLineToReceiptOpts = {},
): MaterialReceipt | null {
  const projectId = row.project_id ?? opts.projectId;
  if (!projectId) return null;
  if (!(row.amount > 0)) return null;

  const now = opts.now ?? new Date().toISOString();
  const id = qboReceiptId(row);
  const description =
    (row.description ?? '').trim() ||
    (row.account_name ?? '').trim() ||
    'QuickBooks cost';

  return {
    id,
    projectId,
    vendor: (row.vendor ?? '').trim() || 'QuickBooks',
    receiptDate: row.txn_date ?? undefined,
    documentNumber: row.doc_number ?? undefined,
    lines: [
      {
        id: `${id}-l1`,
        description,
        // account_name doubles as the cost-book trade key (receiptToCostSamples
        // groups by line.category) — raw QBO account labels, editable later.
        category: (row.account_name ?? '').trim() || undefined,
        quantity: 1,
        unit: 'ea',
        unitPrice: row.amount,
        lineTotal: row.amount,
      },
    ],
    subtotal: row.amount,
    total: row.amount,
    status: 'reviewed',
    origin: 'qbo',
    createdAt: now,
    updatedAt: now,
  };
}

/** Dup heuristic thresholds — the scanned-receipt double-count guard (D2). */
const DUP_UNDER_TOLERANCE = 0.05;  // receipt may read 5% BELOW the QBO figure (OCR noise, discounts)
const DUP_OVER_TOLERANCE = 0.12;   // receipt may read 12% ABOVE it (QBO lines are pre-tax; scans include sales tax)
const DUP_DATE_WINDOW_DAYS = 7;

function parseDay(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw.length === 10 ? `${raw}T12:00:00` : raw);
  return Number.isNaN(t) ? null : t;
}

/** Filler tokens dropped before vendor comparison — corporate suffixes,
 *  articles, and store-number noise that QBO vendor records omit but OCR'd
 *  storefront names carry ("THE HOME DEPOT #1234" vs "Home Depot"). */
const VENDOR_STOP_TOKENS = new Set([
  'the', 'a', 'an', 'and', 'of', 'at',
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'co', 'corp', 'corporation',
  'company', 'ltd', 'limited', 'store', 'shop', 'no',
]);

/** Significant lowercase tokens of a vendor name (empty when nothing survives). */
export function vendorTokens(name: string | null | undefined): string[] {
  return (name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0 && !VENDOR_STOP_TOKENS.has(t) && !/^\d+$/.test(t));
}

/**
 * True when two vendor strings plausibly name the same vendor: exact
 * (case/space-insensitive) equality, or the significant tokens of one are a
 * subset of the other's. Token containment is what lets a QBO vendor record
 * ("Home Depot") match an OCR'd storefront ("THE HOME DEPOT #1234").
 * Either side blank → no match (we only warn when we can corroborate).
 */
export function vendorsLikelyMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const rawA = (a ?? '').trim().toLowerCase();
  const rawB = (b ?? '').trim().toLowerCase();
  if (!rawA || !rawB) return false;
  if (rawA === rawB) return true;
  const tokensA = vendorTokens(a);
  const tokensB = vendorTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const aInB = tokensA.every(t => setB.has(t));
  const bInA = tokensB.every(t => setA.has(t));
  return aInB || bInA;
}

/**
 * Find a SCANNED receipt that looks like the same real-world cost as a staged
 * QBO line.
 *
 * Match criteria:
 *  - vendor: normalized token containment (see vendorsLikelyMatch) — QBO
 *    vendor records rarely string-equal OCR'd storefront names;
 *  - amount: the receipt total is compared against BOTH the single line's
 *    amount AND the whole transaction's total (sum of staged siblings sharing
 *    qbo_type+qbo_id, when `allRows` is supplied) — QBO Purchases/Bills are
 *    routinely split into categorized lines while the scan carries one total.
 *    Tolerance is asymmetric: −5% … +12%, because QBO expense lines are
 *    pre-tax while scanned receipt totals include sales tax;
 *  - date: within 7 days;
 *  - project: when BOTH sides carry a project, different projects never flag
 *    (two identical supply runs for two jobs are not duplicates).
 *
 * Missing vendor or dates on either side → no flag (we only warn when we can
 * actually corroborate). QBO-origin receipts never flag — they are not scan
 * double-counts. Returns the first match or null.
 */
export function findLikelyDuplicate(
  receipts: MaterialReceipt[],
  row: QboCostLineRow,
  allRows?: QboCostLineRow[],
): MaterialReceipt | null {
  const vendor = (row.vendor ?? '').trim();
  if (!vendor) return null;
  const rowDay = parseDay(row.txn_date);
  if (rowDay == null) return null;
  if (!(row.amount > 0)) return null;

  // Whole-transaction total: staged siblings sharing the same QBO entity.
  const txnTotal = (allRows ?? [])
    .filter(l => l.qbo_type === row.qbo_type && l.qbo_id === row.qbo_id)
    .reduce((sum, l) => sum + (l.amount > 0 ? l.amount : 0), 0);
  const bases = txnTotal > row.amount ? [row.amount, txnTotal] : [row.amount];

  for (const r of receipts) {
    if (r.origin === 'qbo') continue;
    if (!vendorsLikelyMatch(r.vendor, vendor)) continue;

    // Cross-project guard: both sides know their job and they differ → skip.
    if (row.project_id && r.projectId && row.project_id !== r.projectId) continue;

    const amountMatches = bases.some(base =>
      base > 0 &&
      r.total >= base * (1 - DUP_UNDER_TOLERANCE) &&
      r.total <= base * (1 + DUP_OVER_TOLERANCE),
    );
    if (!amountMatches) continue;

    const rDay = parseDay(r.receiptDate);
    if (rDay == null) continue;
    const daysApart = Math.abs(rowDay - rDay) / 86_400_000;
    if (daysApart > DUP_DATE_WINDOW_DAYS) continue;

    return r;
  }
  return null;
}
