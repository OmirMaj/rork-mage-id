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
// UX wave, lane A (A7): overdue RFIs and stale submittals are IN the canonical
// set now (rfiAttention / submittalAttention). They used to be counted on the
// side by the Action Required page, the desktop dock and the Brain Watch card
// only to hold back the "all caught up" line — so the pill said 1 while a
// 23-day-late RFI to the architect sat outside it, found only after the GC had
// cleared everything else. With them in the set, the pill count IS the row
// count on every surface that reads this hook (Summary pill, tab badge, dock,
// /attention). Punch now arrives as one row per job (its punch list), and the
// change-order rollup opens /waiting-on — see utils/brainWatch
// scopePunchToProject / coRollupToWaitingOn.
//
// RT-R1: the builders read contexts that swallow fetch errors and serve the
// local cache, so an empty set can mean "quiet" OR "every read 401'd". The
// hook therefore also carries `sourceFailed`, and a surface that says "all
// clear" must gate on it. It is FORWARDED from ProjectContext (which owns the
// probe, because it owns the loaders that do the swallowing) rather than
// re-derived here — one fact, one owner, and a screen that shows project data
// without the attention set can gate on the same flag through useCoreData
// (audit 2026-09-07 "Do now" #1).

import { useMemo } from 'react';
import { useCoreData, useFinancialsData, useDocsData, useFieldData } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { localDateISO } from '@/utils/brief/composeBrief';
import {
  scheduleAttention,
  invoiceAttention,
  permitAttention,
  certAttention,
  closeoutAttention,
  changeOrderAttention,
  rfiAttention,
  submittalAttention,
  coRollupToWaitingOn,
  rankAttention,
  summarize,
  type AttentionItem,
  type AttnKind,
} from '@/utils/brainWatch';
import { punchAttentionByJob } from '@/utils/portfolio/attentionRows';

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
  const { projects, sourceFailed } = useCoreData();
  const { invoices, changeOrders } = useFinancialsData();
  const { getPermitsForProject, rfis, submittals } = useDocsData();
  const { punchItems } = useFieldData();
  const safety = useSafety();

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
      // UX A7: the replies that stop work — in the count, not beside it.
      all.push(...rfiAttention(project, rfis, nowMs));
      all.push(...submittalAttention(project, submittals, nowMs));
    }

    // UX A7: one punch row per job, opening that job's punch list — over
    // EVERY punch item (HEAD's population), outside the loop above, which
    // skips completed jobs: Post-Con is where punch matters most.
    all.push(...punchAttentionByJob(punchItems, projects));

    // Company-scoped signals + portfolio rollups.
    const expiring = safety.expiringCertifications(todayISO) as Parameters<typeof certAttention>[0];
    all.push(...certAttention(expiring, nowMs));
    all.push(...changeOrderAttention(changeOrders).map(coRollupToWaitingOn));

    return rankAttention(all);
  }, [projects, invoices, changeOrders, punchItems, getPermitsForProject, rfis, submittals, safety]);

  const summary = useMemo(() => summarize(items), [items]);

  return { items, total: summary.total, byKind: summary.byKind, sourceFailed };
}

export default useBrainWatch;
