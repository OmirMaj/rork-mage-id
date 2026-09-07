// utils/portfolio/clientBook.ts — per-client relationship facts
//
// Normalizes project primaryContact into a client key, then computes:
//   payment latency (median days from issueDate to first-payment-covers-totalDue)
//   CO friction (count, rejection rate, counter rate, avg approval days)
//   lifetime revenue, project count, repeat flag
//
// RAW FACTS ONLY — no composite score v1 (deferred until Outcome Learning
// can calibrate weights).
//
// Pure. No React. No network. Never throws.

import type { Project, Invoice, ChangeOrder } from '@/types';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { invoiceOutstanding, invoiceIsSettled } from '@/utils/invoiceBilling';

// ─── Key normalization ─────────────────────────────────────────────────────

/**
 * Canonical client key: email (lowercased) → phone (digits only) → name (lowercased).
 * Returns null when none of the three fields is populated.
 */
export function normalizeClientKey(primaryContact?: {
  name?: string;
  phone?: string;
  email?: string;
} | null): string | null {
  if (!primaryContact) return null;
  if (primaryContact.email?.trim()) return primaryContact.email.trim().toLowerCase();
  const phone = primaryContact.phone?.replace(/\D/g, '');
  if (phone) return phone;
  if (primaryContact.name?.trim()) return primaryContact.name.trim().toLowerCase();
  return null;
}

// ─── Median helper ─────────────────────────────────────────────────────────

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

// ─── Payment latency ───────────────────────────────────────────────────────

/**
 * Days from invoice.issueDate to the date cumulative payments first settle the
 * invoice — net of held retention (MONEY-F5): a client who paid everything
 * they were asked for on day 20 paid on day 20, even if $10k of retention is
 * still held until closeout. Returns null when unpaid or without payments.
 */
function daysToFullyPaid(invoice: Invoice): number | null {
  if (!invoice.issueDate || !invoice.payments?.length) return null;
  const issueMs = Date.parse(invoice.issueDate);
  if (!Number.isFinite(issueMs)) return null;
  // Sort payments by date ascending
  const sorted = [...invoice.payments].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let cumulative = 0;
  for (const pmt of sorted) {
    cumulative += pmt.amount;
    if (invoice.totalDue > 0 && invoiceIsSettled({ ...invoice, amountPaid: cumulative })) {
      const pmtMs = Date.parse(pmt.date);
      if (!Number.isFinite(pmtMs)) return null;
      return Math.max(0, Math.round((pmtMs - issueMs) / 86_400_000));
    }
  }
  return null; // not fully paid yet
}

// ─── CO friction ──────────────────────────────────────────────────────────

export interface COFriction {
  count: number;
  rejectionRate: number; // 0–1, fraction of COs that hit 'rejected' status
  counterRate: number; // 0–1, fraction of COs with any counterAmount from an approver
  /** Median days from CO.date to first approver responseDate. null when no data. */
  avgApprovalDays: number | null;
}

function computeCOFriction(cos: ChangeOrder[]): COFriction {
  const count = cos.length;
  if (count === 0) {
    return { count: 0, rejectionRate: 0, counterRate: 0, avgApprovalDays: null };
  }
  const rejectedCount = cos.filter(co => co.status === 'rejected').length;
  const counterCount = cos.filter(co =>
    co.approvers?.some(a => a.counterAmount != null && a.counterAmount > 0),
  ).length;
  const approvalDaysArr: number[] = [];
  for (const co of cos) {
    const coMs = Date.parse(co.date);
    if (!Number.isFinite(coMs)) continue;
    const responseDate = co.approvers
      ?.map(a => a.responseDate)
      .filter(Boolean)
      .map(d => Date.parse(d!))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    if (responseDate != null) {
      const days = Math.max(0, Math.round((responseDate - coMs) / 86_400_000));
      approvalDaysArr.push(days);
    }
  }
  return {
    count,
    rejectionRate: rejectedCount / count,
    counterRate: counterCount / count,
    avgApprovalDays: median(approvalDaysArr),
  };
}

// ─── Client record ────────────────────────────────────────────────────────

export interface ClientRecord {
  key: string;
  /** Display name — first primaryContact.name encountered for this key */
  displayName: string;
  projectCount: number;
  /** Sum of effectiveEstimateTotal across all projects for this client */
  lifetimeRevenue: number;
  /** True when the client has 2+ projects */
  repeat: boolean;
  payment: {
    invoiceCount: number;
    /** Median calendar days from issue to full payment. null = insufficient data. */
    medianDaysToPaid: number | null;
    outstanding$: number; // sum of invoiceOutstanding() — net of held retention — on open invoices
    overdue$: number; // outstanding where status === 'overdue'
  };
  coFriction: COFriction;
}

export interface ClientBookResult {
  clients: ClientRecord[];
  /** Sum of projectCount for projects with no resolvable client identity */
  unattributedCount: number;
  /** Coverage note, e.g. "Client identity on 14 of 18 projects" */
  coverageNote: string;
}

export function buildClientBook(input: {
  projects: Project[];
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
}): ClientBookResult {
  const { projects, invoices, changeOrders } = input;

  const byKey = new Map<
    string,
    {
      displayName: string;
      projectIds: Set<string>;
      revenue: number;
      invoices: Invoice[];
      cos: ChangeOrder[];
    }
  >();
  let unattributedCount = 0;
  let attributedCount = 0;

  for (const p of projects) {
    const key = normalizeClientKey(p.primaryContact);
    if (!key) {
      unattributedCount++;
      continue;
    }
    attributedCount++;
    if (!byKey.has(key)) {
      byKey.set(key, {
        displayName: p.primaryContact?.name?.trim() || key,
        projectIds: new Set(),
        revenue: 0,
        invoices: [],
        cos: [],
      });
    }
    const entry = byKey.get(key)!;
    entry.projectIds.add(p.id);
    entry.revenue += effectiveEstimateTotal(p);
    // Attach invoices + COs for this project
    for (const inv of invoices) {
      if (inv.projectId === p.id) entry.invoices.push(inv);
    }
    for (const co of changeOrders) {
      if (co.projectId === p.id) entry.cos.push(co);
    }
  }

  const clients: ClientRecord[] = [];
  for (const [key, entry] of byKey) {
    const projectCount = entry.projectIds.size;
    // Payment latency
    const latencies = entry.invoices.map(daysToFullyPaid).filter((v): v is number => v !== null);
    // MONEY-F5: net of held retention on both figures.
    const outstanding$ = entry.invoices.reduce((s, inv) => s + invoiceOutstanding(inv), 0);
    const overdue$ = entry.invoices.reduce(
      (s, inv) => (inv.status === 'overdue' ? s + invoiceOutstanding(inv) : s),
      0,
    );
    clients.push({
      key,
      displayName: entry.displayName,
      projectCount,
      lifetimeRevenue: entry.revenue,
      repeat: projectCount >= 2,
      payment: {
        invoiceCount: entry.invoices.length,
        medianDaysToPaid: median(latencies),
        outstanding$,
        overdue$,
      },
      coFriction: computeCOFriction(entry.cos),
    });
  }

  // Sort by lifetime revenue descending
  clients.sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue);

  const totalProjects = projects.length;
  const coverageNote = `Client identity on ${attributedCount} of ${totalProjects} project${totalProjects === 1 ? '' : 's'}`;

  return { clients, unattributedCount, coverageNote };
}
