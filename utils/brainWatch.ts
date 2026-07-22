// utils/brainWatch.ts — pure aggregator for the Brain Watch home card.
// No React / React Native imports — runs under Bun for the validator.
//
// All builders take already-fetched data and return AttentionItem[].
// No context calls, no side effects. Sorting + summarizing are separate.

import type { Project, Invoice, Permit, Certification } from '@/types';

// ─── Public types ────────────────────────────────────────────────────────────

export type AttnKind = 'schedule' | 'invoice' | 'permit' | 'cert';
export type AttnSeverity = 'critical' | 'high' | 'medium';

export interface AttentionItem {
  id: string;
  projectId: string;
  projectName: string;
  kind: AttnKind;
  severity: AttnSeverity;
  message: string;
  route: { pathname: string; params?: Record<string, string> };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function daysBetween(laterMs: number, earlierMs: number): number {
  return Math.floor((laterMs - earlierMs) / (24 * 60 * 60 * 1000));
}

// ─── scheduleAttention ────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem if the project's schedule health is at-risk.
 * Conditions:
 *   - health score < 70, OR
 *   - schedule exists with tasks but health score is absent (undefined/null),
 *     AND the schedule has at least one task that is behind (status === 'at_risk'
 *     or 'delayed', or riskItems.length > 0).
 * Severity: health < 40 → critical, < 60 → high, else medium.
 */
export function scheduleAttention(project: Project): AttentionItem[] {
  const schedule = project.schedule;
  if (!schedule) return [];

  const hasTasks = schedule.tasks.length > 0;
  if (!hasTasks) return [];

  const score = schedule.healthScore;

  // If health score is present and fine, skip.
  if (score !== undefined && score !== null && score >= 70) return [];

  // If score is absent, only flag when the schedule shows risk signals.
  if ((score === undefined || score === null) && schedule.riskItems.length === 0) return [];

  const effectiveScore = score ?? 0; // treat missing as unknown risk → use 0 for severity calc
  const severity: AttnSeverity =
    effectiveScore < 40 ? 'critical' : effectiveScore < 60 ? 'high' : 'medium';

  const displayScore = score !== undefined && score !== null ? String(Math.round(score)) : '?';

  return [
    {
      id: `schedule-${project.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'schedule',
      severity,
      message: `${project.name}: schedule at risk (health ${displayScore})`,
      route: { pathname: '/schedule-pro', params: { projectId: project.id } },
    },
  ];
}

// ─── invoiceAttention ─────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem per unpaid invoice that is overdue by > 7 days.
 * "Unpaid" = status 'sent' | 'partially_paid' | 'overdue'.
 * Severity: overdue > 30 days → critical, > 14 days → high, else medium.
 * Route: /invoice with projectId + invoiceId params.
 */
export function invoiceAttention(
  project: Project,
  invoices: Invoice[],
  nowMs: number,
): AttentionItem[] {
  const unpaidStatuses = new Set<string>(['sent', 'partially_paid', 'overdue']);
  const items: AttentionItem[] = [];

  for (const inv of invoices) {
    if (inv.projectId !== project.id) continue;
    if (!unpaidStatuses.has(inv.status)) continue;
    if (!inv.dueDate) continue;

    const dueMs = Date.parse(inv.dueDate);
    if (Number.isNaN(dueMs)) continue;

    const overdueDays = daysBetween(nowMs, dueMs);
    if (overdueDays <= 7) continue; // grace window

    const severity: AttnSeverity =
      overdueDays > 30 ? 'critical' : overdueDays > 14 ? 'high' : 'medium';

    const amt = (inv.totalDue - inv.amountPaid).toFixed(0);

    items.push({
      id: `invoice-${inv.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'invoice',
      severity,
      message: `${project.name}: invoice #${inv.number} is ${overdueDays}d overdue ($${amt})`,
      route: {
        pathname: '/invoice',
        params: { projectId: project.id, invoiceId: inv.id },
      },
    });
  }

  return items;
}

// ─── permitAttention ──────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem per permit with an upcoming inspection within 7 days.
 * Severity: ≤ 2 days → critical, else high.
 * Route: /permits with projectId param.
 */
export function permitAttention(
  project: Project,
  permits: Permit[],
  nowMs: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const permit of permits) {
    if (permit.projectId !== project.id) continue;
    if (!permit.inspectionDate) continue;

    const inspMs = Date.parse(permit.inspectionDate);
    if (Number.isNaN(inspMs)) continue;

    const daysUntil = daysBetween(inspMs, nowMs);
    if (daysUntil < 0 || daysUntil > 7) continue; // past or too far out

    const severity: AttnSeverity = daysUntil <= 2 ? 'critical' : 'high';
    const label = permit.permitNumber ?? permit.type;

    items.push({
      id: `permit-${permit.id}`,
      projectId: project.id,
      projectName: project.name,
      kind: 'permit',
      severity,
      message: `${project.name}: ${label} inspection in ${daysUntil}d`,
      route: {
        pathname: '/permits',
        params: { projectId: project.id },
      },
    });
  }

  return items;
}

// ─── certAttention ────────────────────────────────────────────────────────────

/**
 * Produces one AttentionItem per expiring/expired certification.
 * Takes the already-computed list from SafetyContext.expiringCertifications().
 * Severity: expired → critical, expiring < 14 days → high, else medium.
 * Route: /crew (company-scoped, no project anchor).
 *
 * @param expiring — output of useSafety().expiringCertifications(todayISO)
 * @param nowMs    — Date.now() for day math
 */
export function certAttention(
  expiring: (Certification & { status: 'expiring' | 'expired' })[],
  nowMs: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const cert of expiring) {
    if (cert.status === 'valid') continue; // shouldn't appear, but guard it

    let severity: AttnSeverity;
    let dayStr: string;

    if (cert.status === 'expired') {
      severity = 'critical';
      dayStr = 'expired';
    } else {
      // 'expiring'
      const expMs = cert.expiresDate ? Date.parse(cert.expiresDate) : NaN;
      const daysLeft = Number.isNaN(expMs) ? 0 : daysBetween(expMs, nowMs);
      severity = daysLeft < 14 ? 'high' : 'medium';
      dayStr = `expires in ${daysLeft}d`;
    }

    const workerLabel = cert.holderName ?? cert.workerId ?? 'Unknown worker';
    const certLabel = cert.type;

    items.push({
      id: `cert-${cert.id}`,
      projectId: '',
      projectName: '',
      kind: 'cert',
      severity,
      message: `${workerLabel} — ${certLabel} ${dayStr}`,
      route: { pathname: '/crew' },
    });
  }

  return items;
}

// ─── rankAttention ────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AttnSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

/**
 * Stable sort: critical first, then high, then medium.
 * Items of the same severity stay in their original order.
 */
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ─── summarize ────────────────────────────────────────────────────────────────

export function summarize(items: AttentionItem[]): {
  total: number;
  byKind: Record<AttnKind, number>;
} {
  const byKind: Record<AttnKind, number> = {
    schedule: 0,
    invoice: 0,
    permit: 0,
    cert: 0,
  };
  for (const item of items) {
    byKind[item.kind]++;
  }
  return { total: items.length, byKind };
}
