// utils/paymentsDesk.ts — the Payments desk on a laptop (wave 6d, lane M2).
//
// WHY THIS EXISTS. On desktop the Payments screen is an A/R desk: a KPI strip
// that splits Pending by age, and a register of every row with Applied to /
// Fee / Net columns and a footer per tab. Every figure here is derived from
// the SAME feed rows the phone cards print (app/payments.tsx derivePayments /
// summarizePayments — the sentinel block) plus the A/R aging report the
// Reports screen prints (utils/financialReports computeARAgingReport), so the
// desk can never show a number the phone and the report do not.
//
// PURE. The one runtime import is utils/formatters (no imports of its own), so
// the money reads exactly as every other screen prints it; everything else is
// a type. Executed by scripts/validate-money-desk.ts.

import type { ARAgingRow } from '@/utils/financialReports';
import { formatMoney } from '@/utils/formatters';

/**
 * The fields of a Payments feed row (app/payments.tsx PaymentRow) this module
 * reads. Structural, so the route file's own type satisfies it without this
 * pure module importing a route.
 */
export interface PaymentDeskRow {
  id: string;
  invoiceId?: string;
  projectId: string;
  projectName: string;
  clientName: string;
  amount: number;
  fee: number;
  netAmount: number;
  provider: string;
  processedByMage: boolean;
  status: string;
  description: string;
  createdAt: string;
}

const roundCents = (n: number): number => Math.round(n * 100) / 100;
const toCents = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100);

// ─────────────────────────────────────────────────────────────────────────────
// A/R aging of the Pending figure
// ─────────────────────────────────────────────────────────────────────────────

export type PaymentsArBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90p';
export const PAYMENTS_AR_BUCKET_KEYS: readonly PaymentsArBucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90p'];

export interface PaymentsArBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90p: number;
  /** Pending rows (one per invoice) in each bucket. */
  counts: Record<PaymentsArBucketKey, number>;
  /** Σ buckets, to the cent. */
  total: number;
  /** Σ buckets === Σ pending amounts, to the cent. The strip says so when not. */
  reconciles: boolean;
}

const BUCKET_FOR: Record<ARAgingRow['bucket'], PaymentsArBucketKey> = {
  current: 'current',
  '0-30': 'd1_30',
  '31-60': 'd31_60',
  '61-90': 'd61_90',
  '90+': 'd90p',
};

/**
 * Split the Pending rows by how late their invoice is. Each pending row (one
 * per invoice, amount = invoiceOutstanding) is bucketed by its invoice's A/R
 * aging row; a row the report does not list (it skips balances ≤ $0.50, and
 * an unknown invoice has no row) counts as current. The buckets are summed in
 * whole cents, so they add up to the Pending figure exactly.
 */
export function paymentsArBuckets(
  pending: readonly { invoiceId?: string; amount: number }[],
  agingRows: readonly Pick<ARAgingRow, 'invoiceId' | 'bucket'>[],
): PaymentsArBuckets {
  const bucketOf = new Map<string, PaymentsArBucketKey>();
  for (const r of agingRows) bucketOf.set(r.invoiceId, BUCKET_FOR[r.bucket] ?? 'current');
  const cents: Record<PaymentsArBucketKey, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  const counts: Record<PaymentsArBucketKey, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  let pendingCents = 0;
  for (const p of pending) {
    const key = (p.invoiceId && bucketOf.get(p.invoiceId)) || 'current';
    const c = toCents(p.amount);
    cents[key] += c;
    counts[key] += 1;
    pendingCents += c;
  }
  const out = {
    current: cents.current / 100,
    d1_30: cents.d1_30 / 100,
    d31_60: cents.d31_60 / 100,
    d61_90: cents.d61_90 / 100,
    d90p: cents.d90p / 100,
  };
  const totalCents = PAYMENTS_AR_BUCKET_KEYS.reduce((s, k) => s + cents[k], 0);
  const rawTotal = roundCents(pending.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0));
  return {
    ...out,
    counts,
    total: totalCents / 100,
    reconciles: totalCents === pendingCents && totalCents === toCents(rawTotal),
  };
}

/** "1 invoice" / "3 invoices". */
export function invoiceCountLabel(n: number): string {
  return `${n} invoice${n === 1 ? '' : 's'}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The register footer, per tab
// ─────────────────────────────────────────────────────────────────────────────

export type PaymentsTab = 'all' | 'pending' | 'completed';

export interface PaymentsFooter {
  amount?: number;
  fee?: number;
  net?: number;
  /** The All tab's Job-column line: the two totals side by side, never summed. */
  job?: string;
}

/**
 * The footer the register shows under each tab. Completed: Received (the same
 * figure as the KPI), the estimated fees on the money MAGE processed, and
 * Received less those fees. Pending: the Pending figure. All: no Amount sum at
 * all — money received and money still owed added together is no number
 * anyone can use — just the two totals, named.
 */
export function paymentsFooter(
  tab: PaymentsTab,
  rows: readonly PaymentDeskRow[],
  stats: { received: number; pending: number; totalFees: number },
): PaymentsFooter {
  if (tab === 'completed') {
    const settled = rows.filter(r => r.status === 'completed' || r.status === 'refunded');
    const mageFeeCents = settled.filter(r => r.processedByMage).reduce((s, r) => s + toCents(r.fee), 0);
    return {
      amount: stats.received,
      fee: stats.totalFees,
      net: roundCents(stats.received - mageFeeCents / 100),
    };
  }
  if (tab === 'pending') return { amount: stats.pending };
  return { job: `Received ${formatMoney(stats.received, 2)} · Pending ${formatMoney(stats.pending, 2)}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cells
// ─────────────────────────────────────────────────────────────────────────────

const SETTLED = new Set(['completed', 'refunded']);
const PENDING = new Set(['pending', 'processing']);

/**
 * Where the money was applied. Every ledger entry lives on exactly one
 * invoice, so there is no unapplied cash in this model: the column names the
 * invoice, it is not a split. Unknown invoice → null ('—').
 */
export function paymentAppliedLabel(
  row: Pick<PaymentDeskRow, 'invoiceId' | 'status'>,
  numberById: ReadonlyMap<string, number>,
): string | null {
  if (!row.invoiceId) return null;
  const n = numberById.get(row.invoiceId);
  if (n == null) return null;
  if (SETTLED.has(row.status)) return `#${n}`;
  if (PENDING.has(row.status)) return `Owed on #${n}`;
  return null;
}

/** A fee MAGE can state is money; a hand-keyed card's fee is Unknown; else '—'. */
export function paymentFeeCell(row: Pick<PaymentDeskRow, 'fee' | 'provider'>): string {
  if (row.fee > 0) return formatMoney(row.fee, 2);
  if (row.provider === 'card') return 'Unknown';
  return '—';
}

/** A hand-keyed card's fee is unknown, so its net is too. */
export function paymentNetCell(row: Pick<PaymentDeskRow, 'netAmount' | 'provider'>): string {
  if (row.provider === 'card') return '—';
  return formatMoney(row.netAmount, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

/** The method label, as the feed prints it (app/payments.tsx providerLabel;
 *  the brand labels mirror mocks/payments PROVIDER_INFO — the validator pins it). */
export const PAYMENT_METHOD_LABEL: Readonly<Record<string, string>> = {
  card: 'Card',
  other: 'Recorded',
  stripe: 'Stripe',
  square: 'Square',
  paypal: 'PayPal',
  venmo: 'Venmo',
  zelle: 'Zelle',
  check: 'Check',
  ach: 'ACH',
  cash: 'Cash',
};

export interface PaymentsCsvColumn {
  key: string;
  label: string;
  csvValue: (row: PaymentDeskRow) => string | number | null;
}

/**
 * The register as CSV (utils/dataTable rowsToCsv). Money is a plain number;
 * an unknown fee or net is an EMPTY cell, so a spreadsheet SUM is not lied to.
 */
export const PAYMENTS_CSV_COLUMNS: readonly PaymentsCsvColumn[] = [
  { key: 'date', label: 'Date', csvValue: r => r.createdAt },
  { key: 'job', label: 'Job', csvValue: r => r.projectName },
  { key: 'payer', label: 'Payer', csvValue: r => r.clientName },
  { key: 'description', label: 'Description', csvValue: r => r.description },
  { key: 'method', label: 'Method', csvValue: r => PAYMENT_METHOD_LABEL[r.provider] ?? PAYMENT_METHOD_LABEL.other },
  { key: 'status', label: 'Status', csvValue: r => r.status },
  { key: 'amount', label: 'Amount', csvValue: r => roundCents(r.amount) },
  { key: 'fee', label: 'Fee', csvValue: r => (r.fee > 0 ? roundCents(r.fee) : r.provider === 'card' ? null : 0) },
  { key: 'net', label: 'Net', csvValue: r => (r.provider === 'card' ? null : roundCents(r.netAmount)) },
];
