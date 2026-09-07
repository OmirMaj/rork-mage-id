// hooks/useBrainWatch.ts — THE canonical "needs your attention" set.
//
// One composition of the pure brainWatch builders (deduped certs, grouped
// signals) consumed by every surface that says "needs attention" / "needs
// you": the home Brain Watch card, the Summary hero pill + NEEDS YOU card,
// and the Your-Projects tab badge. Before this hook each surface rolled its
// own aggregation, so the same account showed "1" on Summary, "11" on the
// tab badge, and "5" on the Brain Watch card at the same time (sim-audit
// top-15 #15).
//
// Scoped counters that are NOT this number (and are labeled as such):
//   • the Bell badge — unread NOTIFICATIONS (opens notifications-inbox)
//   • the home "Inbox" card — the dismissible Smart Inbox feed
//   • the Morning Brief "N need you" line — the brief's own composed
//     document (canonical set + brief-only rollups like leak flags)
//
// RT-R1: the builders read contexts that swallow fetch errors and serve the
// local cache, so an empty set can mean "quiet" OR "every read 401'd". The
// hook therefore also carries `sourceFailed` from useMageReachability, and a
// surface that says "all clear" must gate on it.

import { useMemo } from 'react';
import { useCoreData, useFinancialsData, useDocsData, useFieldData } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useMageReachability } from '@/hooks/useMageReachability';
import { localDateISO } from '@/utils/brief/composeBrief';
import {
  scheduleAttention,
  invoiceAttention,
  permitAttention,
  certAttention,
  closeoutAttention,
  punchAttention,
  changeOrderAttention,
  rankAttention,
  summarize,
  type AttentionItem,
  type AttnKind,
} from '@/utils/brainWatch';

export interface BrainWatchResult {
  /** Ranked (critical → high → medium), deduped attention items. */
  items: AttentionItem[];
  /** THE canonical needs-attention count. */
  total: number;
  byKind: Record<AttnKind, number>;
  /** RT-R1: true when MAGE's backend could not be reached as this user (dead
   *  session, no network). `items`/`total` are then whatever this device last
   *  cached — a surface must not present total === 0 as "all clear". */
  sourceFailed: boolean;
}

export function useBrainWatch(): BrainWatchResult {
  const { projects } = useCoreData();
  const { invoices, changeOrders } = useFinancialsData();
  const { getPermitsForProject } = useDocsData();
  const { punchItems } = useFieldData();
  const safety = useSafety();
  const reachability = useMageReachability();

  const items: AttentionItem[] = useMemo(() => {
    const nowMs = Date.now();
    // Local calendar day (not UTC toISOString) — same cert-expiry cutoff
    // discipline as useMorningBrief/ask.
    const todayISO = localDateISO(new Date());

    const all: AttentionItem[] = [];

    for (const project of projects) {
      // Closed/completed jobs rarely need daily attention.
      if (project.status === 'closed' || project.status === 'completed') continue;
      all.push(...scheduleAttention(project));
      all.push(...invoiceAttention(project, invoices, nowMs));
      all.push(...permitAttention(project, getPermitsForProject(project.id), nowMs));
      all.push(...closeoutAttention(project));
    }

    // Company-scoped signals + portfolio rollups.
    const expiring = safety.expiringCertifications(todayISO) as Parameters<typeof certAttention>[0];
    all.push(...certAttention(expiring, nowMs));
    all.push(...punchAttention(punchItems));
    all.push(...changeOrderAttention(changeOrders));

    return rankAttention(all);
  }, [projects, invoices, changeOrders, punchItems, getPermitsForProject, safety]);

  const summary = useMemo(() => summarize(items), [items]);

  return { items, total: summary.total, byKind: summary.byKind, sourceFailed: reachability.failed };
}

export default useBrainWatch;
