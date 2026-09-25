// hooks/useProjectPulse.ts — one read of a job's numbers, for every surface
// that shows them.
//
// WHY THIS EXISTS (wave 6c, lane E). The job page showed TWO different
// "% complete" numbers: the hub's progress chip read computeProjectProgress
// (duration-weighted task progress) while ProjectHero's Schedule stat counted
// done tasks. And the cost streams that price the job's margin were read by
// ProjectHero alone, so the desktop KPI strip would have needed a second copy
// of them. This hook is the single source: ProjectHero (phone) and the desktop
// KPI strip / overview both read it, so the two surfaces cannot disagree.
//
// It is called in app/project-detail.tsx ABOVE the `if (!project)` early
// return, so a null project returns an inert pulse (every hook still runs).
//
// The cost-source block below was MOVED here from ProjectHero verbatim —
// scripts/validate-margin-cost-sources.ts matches its text (the seven streams,
// and readiness from all three stores by the exported mirror key).

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChangeOrder, Project, ProjectContract } from '@/types';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import { TIME_ENTRIES_MIRROR_QUERY_KEY } from '@/hooks/useTimeEntries';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import type { JobCostActualSources } from '@/utils/jobCostEngine';
import { computeLivingEstimate } from '@/utils/livingEstimate';
import { computeMarginRisk } from '@/utils/marginRiskScore';
import { canViewFinancials } from '@/utils/roleBlinding';
import { computeProjectProgress } from '@/utils/projectProgress';
import { scheduleFinishDate } from '@/utils/portalSnapshot';
import { resolveContractSum, getInvoicedToDate, getOutstandingBalance } from '@/utils/projectFinancials';
import { computeARAgingReport } from '@/utils/financialReports';
import { daysUntilCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import {
  INERT_PULSE,
  lookaheadRows,
  type ProjectPulse,
} from '@/utils/projectWorkspaceLayout';

export type { ProjectPulse } from '@/utils/projectWorkspaceLayout';

export function useProjectPulse(
  project: Project | null,
  opts: { contract?: ProjectContract | null; pendingChangeOrders: ChangeOrder[] },
): ProjectPulse {
  const {
    getInvoicesForProject, getChangeOrdersForProject, getCommitmentsForProject, getRFIsForProject,
    getPunchItemsForProject, getDailyReportsForProject,
    equipment, permits, subcontractors,
  } = useProjects();
  // The cost streams Job Costing prices (audit round 2, #16). Without receipts
  // and priced crew hours a self-perform overrun counted up to the bid margin
  // and read HEALTHY while Job Costing, one tap away, showed the job over.
  const { receipts, isLoading: receiptsLoading } = useMaterialReceipts();
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier, overtimeRule, isLoading: ratesLoading } = useLaborRates();
  const costSources = useMemo<JobCostActualSources>(() => ({
    receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits, subcontractors,
  }), [receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits, subcontractors]);
  // Those stores default to [] / {} while AsyncStorage is read; for that beat a
  // self-perform job would price at its bid margin. Readiness waits for all
  // three. The mirror hook has no loading flag, so read its cache entry; the
  // caller re-renders when it resolves because useTimeEntriesMirror subscribes.
  const queryClient = useQueryClient();
  const mirrorLoaded = queryClient.getQueryState(TIME_ENTRIES_MIRROR_QUERY_KEY)?.data !== undefined;
  const costSourcesReady = !receiptsLoading && !ratesLoading && mirrorLoaded;
  // The role that decides whether money is shown. canViewFinancials fails
  // CLOSED (null while loading → no money); a FAILED read is said, not hidden.
  const { role, isLoading, isError } = useProjectRoleState(project?.id);
  const roleLoading = isLoading;
  const roleError = isError;

  const pid = project?.id ?? '';
  const invoices = useMemo(() => (pid ? getInvoicesForProject(pid) : []), [pid, getInvoicesForProject]);
  const changeOrders = useMemo(() => (pid ? getChangeOrdersForProject(pid) : []), [pid, getChangeOrdersForProject]);
  const commitments = useMemo(() => (pid ? getCommitmentsForProject(pid) : []), [pid, getCommitmentsForProject]);
  const rfis = useMemo(() => (pid ? getRFIsForProject(pid) : []), [pid, getRFIsForProject]);
  const punch = useMemo(() => (pid ? getPunchItemsForProject(pid) : []), [pid, getPunchItemsForProject]);
  const reports = useMemo(() => (pid ? getDailyReportsForProject(pid) : []), [pid, getDailyReportsForProject]);

  const { living, risk } = useMemo(() => (project ? {
    living: computeLivingEstimate({ project, changeOrders, commitments, invoices, costSources }),
    risk: computeMarginRisk({ project, changeOrders, commitments, invoices, costSources }),
  } : { living: null, risk: null }), [project, changeOrders, commitments, invoices, costSources]);

  const contractRow = opts.contract;
  const pendingCOs = opts.pendingChangeOrders;

  return useMemo<ProjectPulse>(() => {
    if (!project) return { ...INERT_PULSE, role, roleLoading, roleError, costSourcesReady };
    const canSeeMoney = canViewFinancials(role);

    const sum = resolveContractSum(project, contractRow ?? null);
    const approvedCO = changeOrders
      .filter(co => co.status === 'approved')
      .reduce((a, co) => a + (co.changeAmount ?? 0), 0);
    const sent = invoices.filter(i => i.status !== 'draft');

    const schedule = project.schedule;
    const lookahead = lookaheadRows(
      schedule?.tasks,
      schedule?.startDate ?? null,
      { workingDaysPerWeek: schedule?.workingDaysPerWeek, nonWorkingDates: schedule?.nonWorkingDates },
      new Date(),
    );

    const last = reports[0];
    const committedSum = commitments
      .filter(c => c.status !== 'draft')
      .reduce((a, c) => a + (c.amount ?? 0) + (c.changeAmount ?? 0), 0);

    return {
      hasProject: true,
      role,
      roleLoading,
      roleError,
      canSeeMoney,
      living,
      risk,
      costSourcesReady,
      progress: computeProjectProgress(project),
      forecastFinish: scheduleFinishDate(schedule),
      contract: { value: sum.value, source: sum.source, approvedCO, total: sum.value + approvedCO },
      invoiced: getInvoicedToDate(invoices),
      owed: getOutstandingBalance(invoices),
      nonDraftInvoiceCount: sent.length,
      ar: sent.length > 0 ? computeARAgingReport(sent, []).totals : null,
      openRfis: rfis.filter(r => r.status === 'open').length,
      overdueRfis: rfis.filter(r => r.status === 'open' && (daysUntilCalendarDay(calendarDayOf(r.dateRequired)) ?? 0) < 0).length,
      punch: {
        open: punch.filter(p => p.status === 'open').length,
        inProgress: punch.filter(p => p.status === 'in_progress').length,
        readyForReview: punch.filter(p => p.status === 'ready_for_review').length,
      },
      lastDailyReport: last ? {
        date: last.date,
        conditions: last.weather?.conditions ?? '',
        temperature: last.weather?.temperature ?? '',
        crew: (last.manpower ?? []).reduce((a, m) => a + (m.headcount ?? 0), 0),
      } : null,
      lookahead,
      pendingCOs,
      pendingCOValue: pendingCOs.reduce((a, co) => a + (co.changeAmount ?? 0), 0),
      committed: living?.hasMarginBasis && living.original.cost > 0
        ? { committed: committedSum, budget: living.original.cost }
        : null,
    };
  }, [project, role, roleLoading, roleError, costSourcesReady, contractRow, changeOrders, invoices, commitments, rfis, punch, reports, living, risk, pendingCOs]);
}
