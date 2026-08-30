// hooks/useWeekClose.ts — assembles the Friday Close inputs and runs the
// pure composeWeekClose composer.
//
// Mirrors useMorningBrief's additive pattern: each async source loads in
// its own try/catch so a failing source degrades to an honest fallback
// rather than blanking the close.
//
// Sync inputs come from ProjectContext. Async inputs:
//   - payment predictions (predictInvoicePayments)
//   - WWP commitments + PPC (from the mageid_last_planner AsyncStorage store)
//   - lookahead constraint-clear count (totalTasks − constrainedCount)
//
// F3: autoDraftedCOs are filtered from changeOrders by the auditTrail
// marker inside the useMemo that feeds composeWeekClose.

import { useEffect, useMemo, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import {
  composeWeekClose,
  type ComposeWeekCloseInput,
  type WeekCloseWipRow,
} from '@/utils/weekClose/composeWeekClose';
import {
  computeWipRow, deriveOriginalContract, deriveEstimatedCost,
  suggestBilledToDate, suggestCostToDate, sumApprovedChangeOrders,
} from '@/utils/wip';
import type { WeekClose } from '@/utils/weekClose/types';

interface AsyncInputs {
  paymentPredictions: ComposeWeekCloseInput['paymentPredictions'];
  wwp: ComposeWeekCloseInput['wwp'];
  lookaheadReadyCount: number | undefined;
  unsentClientItemCount: number | undefined;
  qboPendingCount: number | undefined;
}

const EMPTY_ASYNC: AsyncInputs = {
  paymentPredictions: null,
  wwp: null,
  lookaheadReadyCount: undefined,
  unsentClientItemCount: undefined,
  qboPendingCount: 0,
};

// AsyncStorage key for the last-planner store (per hooks/useLastPlanner.ts).
const LAST_PLANNER_KEY = 'mageid_last_planner';

export function useWeekClose(opts: { enabled?: boolean } = {}): {
  close: WeekClose | null;
  loading: boolean;
  refresh: () => void;
} {
  const enabled = opts.enabled !== false;
  const {
    projects, invoices, changeOrders, dailyReports, commitments, aiaPayApps,
  } = useProjects();
  const { receipts } = useMaterialReceipts();

  const [asyncInputs, setAsyncInputs] = useState<AsyncInputs>(EMPTY_ASYNC);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const next: AsyncInputs = { ...EMPTY_ASYNC };

      // Payment predictions — for the chase leg's landing-date lines.
      try {
        const { predictInvoicePayments } = await import('@/utils/paymentPrediction');
        const projectsById: Record<string, typeof projects[number]> = {};
        for (const p of projects) projectsById[p.id] = p;
        next.paymentPredictions = await predictInvoicePayments(invoices, projectsById);
      } catch { /* additive */ }

      // QBO staged-cost count — leg 1's "N QBO costs need review" line (F6).
      // fetchQboPendingCount fails soft to 0, so no try/catch dance needed,
      // but keep the additive wrapper for symmetry with the other sources.
      try {
        const { fetchQboPendingCount } = await import('@/hooks/useQboCostLines');
        next.qboPendingCount = await fetchQboPendingCount();
      } catch { /* additive */ }

      // WWP commitments + lookahead count — for the close/commit legs.
      // Load raw from AsyncStorage (same key as useLastPlanner).
      try {
        const { computePpc, buildLookahead } = await import('@/utils/lastPlanner');

        const raw = await AsyncStorage.getItem(LAST_PLANNER_KEY);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store: Record<string, any> = raw ? JSON.parse(raw) : {};

        // Aggregate commitments across all projects.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allCommitments = (Object.values(store) as any[]).flatMap((b: any) => (b.commitments ?? []) as import('@/utils/lastPlanner').WeeklyCommitment[]);

        // PPC for the current (ending) week.
        const ppcNow = new Date();
        const ppcDow = ppcNow.getDay();
        const ppcShift = ppcDow === 0 ? -6 : 1 - ppcDow;
        const thisMon = new Date(ppcNow);
        thisMon.setDate(ppcNow.getDate() + ppcShift);
        const thisMonISO = thisMon.toISOString().slice(0, 10);
        const ppcRecord = computePpc(allCommitments, thisMonISO);
        next.wwp = {
          commitments: allCommitments,
          ppc: ppcRecord.committed > 0 ? ppcRecord.ppc : null,
        };

        // Lookahead: constraint-clear tasks across all active projects.
        let readyCount = 0;
        for (const project of projects) {
          if (project.status !== 'in_progress') continue;
          const tasks = project.schedule?.tasks ?? [];
          if (tasks.length === 0) continue;
          const constraints = (store[project.id]?.constraints ?? []) as unknown as Parameters<typeof buildLookahead>[2];
          const result = buildLookahead(tasks, project.schedule?.startDate ?? null, constraints, { weeks: 2 });
          readyCount += result.totalTasks - result.constrainedCount;
        }
        next.lookaheadReadyCount = readyCount > 0 ? readyCount : undefined;
      } catch { /* additive */ }

      if (!cancelled) {
        setAsyncInputs(next);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, invoices, changeOrders, projects, refreshKey]);

  // Auto-drafted leak COs: COs with status 'draft' that carry the
  // auto_drafted_from_leak auditTrail marker (written by F3's sweep).
  const autoDraftedCOs = useMemo(
    () => changeOrders.filter(
      co => co.status === 'draft' &&
        (co.auditTrail ?? []).some(e => e.action === 'auto_drafted_from_leak'),
    ),
    [changeOrders],
  );

  // WIP rows for the bill leg — computed synchronously with the REAL WIP
  // engine (utils/wip computeWipRow, cost-basis earned value), the same math
  // the WIP Report screen shows, so the close's "$X unbilled" agrees with the
  // screen the GC checks. Two deliberate departures from what was here before:
  //  - static typed imports, not a require-with-cast (the old wiring called a
  //    4-arg function with 2 args and the wrong return shape; the throw was
  //    swallowed to [] on every render, leaving the flagship leg dead);
  //  - financialReports.computeWIPReport is NOT usable here even correctly
  //    wired: its percent basis is billed/revised, making earned ≡ billed and
  //    unbilled structurally 0.
  const wipRows = useMemo<WeekCloseWipRow[]>(() => {
    try {
      return projects
        .filter(p => p.status === 'in_progress')
        .map(p => {
          const projectCOs = changeOrders.filter(co => co.projectId === p.id);
          const projectPayApps = aiaPayApps.filter(a => a.projectId === p.id);
          const projectCommitments = commitments.filter(c => c.projectId === p.id);
          const out = computeWipRow({
            originalContract: deriveOriginalContract(p, projectCOs, projectPayApps),
            approvedChangeOrders: sumApprovedChangeOrders(projectCOs),
            // CO cost must track CO revenue — see deriveEstimatedCost. This
            // path runs unattended in the week-close, with no human to notice
            // an inflated margin.
            totalEstimatedCost: deriveEstimatedCost(p, projectCommitments, {
              approvedChangeOrders: sumApprovedChangeOrders(projectCOs),
              originalContract: deriveOriginalContract(p, projectCOs, projectPayApps),
            }),
            costToDate: suggestCostToDate(
              projectCommitments,
              receipts.filter(r => r.projectId === p.id),
            ),
            billedToDate: suggestBilledToDate(
              invoices.filter(i => i.projectId === p.id),
              projectPayApps,
            ),
          });
          return {
            projectId: p.id,
            projectName: p.name,
            unbilled: out.underbilling,
            percentComplete: out.percentComplete * 100,
          };
        });
    } catch {
      return [];
    }
  }, [projects, invoices, changeOrders, commitments, aiaPayApps, receipts]);

  const close = useMemo<WeekClose | null>(() => {
    if (!enabled) return null;
    return composeWeekClose({
      projects,
      invoices,
      changeOrders,
      dailyReports,
      wipRows,
      paymentPredictions: asyncInputs.paymentPredictions,
      wwp: asyncInputs.wwp,
      lookaheadReadyCount: asyncInputs.lookaheadReadyCount,
      unsentClientItemCount: asyncInputs.unsentClientItemCount,
      qboPendingCount: asyncInputs.qboPendingCount,
      autoDraftedCOs,
    });
  }, [
    enabled, projects, invoices, changeOrders, dailyReports, wipRows,
    asyncInputs, autoDraftedCOs,
  ]);

  return { close, loading, refresh };
}
