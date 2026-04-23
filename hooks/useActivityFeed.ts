// ============================================================================
// hooks/useActivityFeed.ts
//
// Aggregates recent activity across every domain object attached to a project
// into one chronologically-sorted timeline. Each row is an `EntityRef` + a
// short human-readable description, so the activity-feed screen just has to
// render a list and hand each row to `useEntityNavigation().navigateTo(ref)`.
//
// Data source: `useProjects()` (client-side derivation — no extra network).
// ============================================================================

import { useMemo } from 'react';
import { useProjects } from '@/contexts/ProjectContext';
import type { EntityRef } from '@/types';

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'completed'
  | 'closed'
  | 'paid'
  | 'uploaded';

export interface ActivityItem {
  /** Stable key for React lists. */
  id: string;
  /** What object the row points to. Tap → `navigateTo(ref)`. */
  ref: EntityRef;
  /** When this activity happened (ISO). Used for sorting + display. */
  timestamp: string;
  /** Verb/action tag. */
  action: ActivityAction;
  /** Headline ("RFI #12 — Slab detail"). */
  title: string;
  /** Optional second line ("Submitted by John · Priority: high"). */
  summary?: string;
}

/**
 * Build an activity timeline for a single project. Most recent first.
 * Items are derived purely from client-state — no fetches, safe to call
 * inside any screen that lives below `ProjectProvider`.
 */
export function useActivityFeed(projectId: string | undefined): ActivityItem[] {
  const {
    getChangeOrdersForProject,
    getInvoicesForProject,
    getDailyReportsForProject,
    getPunchItemsForProject,
    getRFIsForProject,
    getSubmittalsForProject,
    getPhotosForProject,
    getWarrantiesForProject,
    getCommEventsForProject,
  } = useProjects();

  return useMemo(() => {
    if (!projectId) return [];

    const items: ActivityItem[] = [];

    // Change orders
    for (const co of getChangeOrdersForProject(projectId)) {
      items.push({
        id: `co-${co.id}`,
        ref: { kind: 'changeOrder', id: co.id, projectId },
        timestamp: co.updatedAt ?? co.date,
        action: co.status === 'approved' ? 'completed' : 'updated',
        title: `CO #${co.number} — ${co.description}`,
        summary: `${co.status.replace(/_/g, ' ')} · ${formatMoneyShort(co.changeAmount)}`,
      });
    }

    // Invoices
    for (const inv of getInvoicesForProject(projectId)) {
      const paid = inv.amountPaid >= inv.totalDue && inv.totalDue > 0;
      items.push({
        id: `inv-${inv.id}`,
        ref: { kind: 'invoice', id: inv.id, projectId },
        timestamp: inv.updatedAt ?? inv.issueDate,
        action: paid ? 'paid' : 'updated',
        title: `Invoice #${inv.number}`,
        summary: `${inv.type === 'progress' ? 'Progress bill' : 'Full invoice'} · ${formatMoneyShort(inv.totalDue)}`,
      });
    }

    // Daily reports
    for (const dr of getDailyReportsForProject(projectId)) {
      items.push({
        id: `dr-${dr.id}`,
        ref: { kind: 'dailyReport', id: dr.id, projectId },
        timestamp: dr.updatedAt ?? dr.date,
        action: dr.status === 'sent' ? 'completed' : 'updated',
        title: `Daily Report · ${dr.date}`,
        summary: dr.workPerformed ? truncate(dr.workPerformed, 80) : undefined,
      });
    }

    // Punch items
    for (const pi of getPunchItemsForProject(projectId)) {
      items.push({
        id: `pi-${pi.id}`,
        ref: { kind: 'punchItem', id: pi.id, projectId },
        timestamp: pi.closedAt ?? pi.createdAt,
        action: pi.status === 'closed' ? 'closed' : pi.status === 'ready_for_review' ? 'completed' : 'updated',
        title: truncate(pi.description, 60),
        summary: `${pi.assignedSub || 'Unassigned'} · ${pi.priority}`,
      });
    }

    // RFIs
    for (const rfi of getRFIsForProject(projectId)) {
      items.push({
        id: `rfi-${rfi.id}`,
        ref: { kind: 'rfi', id: rfi.id, projectId },
        timestamp: rfi.dateResponded ?? rfi.dateSubmitted,
        action: rfi.status === 'closed' ? 'closed' : rfi.status === 'answered' ? 'completed' : 'created',
        title: `RFI #${rfi.number} — ${rfi.subject}`,
        summary: `${rfi.assignedTo || 'Unassigned'} · ${rfi.priority}`,
      });
    }

    // Submittals
    for (const sub of getSubmittalsForProject(projectId)) {
      items.push({
        id: `sub-${sub.id}`,
        ref: { kind: 'submittal', id: sub.id, projectId },
        timestamp: sub.updatedAt ?? sub.submittedDate,
        action: sub.currentStatus === 'approved' ? 'completed' : 'updated',
        title: `Submittal #${sub.number} — ${sub.title}`,
        summary: `${sub.specSection || 'No spec'} · ${sub.currentStatus.replace(/_/g, ' ')}`,
      });
    }

    // Photos
    for (const ph of getPhotosForProject(projectId)) {
      items.push({
        id: `ph-${ph.id}`,
        ref: { kind: 'photo', id: ph.id, projectId },
        timestamp: ph.timestamp ?? ph.createdAt,
        action: 'uploaded',
        title: ph.tag ? `Photo · ${ph.tag}` : 'Photo uploaded',
        summary: ph.location || undefined,
      });
    }

    // Warranties
    for (const w of getWarrantiesForProject(projectId)) {
      items.push({
        id: `w-${w.id}`,
        ref: { kind: 'warranty', id: w.id, projectId },
        timestamp: w.updatedAt ?? w.createdAt,
        action: 'updated',
        title: w.title,
        summary: `${w.category} · expires ${w.endDate}`,
      });
    }

    // Communication events — no dedicated detail screen, so we point at the
    // parent project. Harmless — tapping re-opens the project-detail.
    for (const ev of getCommEventsForProject(projectId)) {
      items.push({
        id: `ev-${ev.id}`,
        ref: { kind: 'project', id: projectId },
        timestamp: ev.timestamp,
        action: 'updated',
        title: ev.summary || ev.type,
        summary: ev.detail ? truncate(ev.detail, 80) : undefined,
      });
    }

    // Most recent first; invalid dates sink to the bottom.
    items.sort((a, b) => {
      const ta = Date.parse(a.timestamp);
      const tb = Date.parse(b.timestamp);
      if (Number.isNaN(tb)) return -1;
      if (Number.isNaN(ta)) return 1;
      return tb - ta;
    });

    return items;
  }, [
    projectId,
    getChangeOrdersForProject,
    getInvoicesForProject,
    getDailyReportsForProject,
    getPunchItemsForProject,
    getRFIsForProject,
    getSubmittalsForProject,
    getPhotosForProject,
    getWarrantiesForProject,
    getCommEventsForProject,
  ]);
}

// ---------------------------------------------------------------------------
// Local formatting helpers (kept inline to avoid circular deps with utils/).
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatMoneyShort(amount: number): string {
  if (!Number.isFinite(amount)) return '$0';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}
