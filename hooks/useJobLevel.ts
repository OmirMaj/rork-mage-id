// hooks/useJobLevel.ts — the inputs of the Level (utils/jobLevel) for a list
// of projects, read once for the whole list.
//
// WHY NOT useProjectPulse PER ROW. The pulse is the job page's single read and
// gives the right number, but per row it would also run a collaborator query
// per project (useProjectRoleState), a lookahead and an A/R aging each, and
// mount a time-entry mirror observer per card (that query refetches on every
// mount). Home lists every project. So this reads the cost streams ONCE, with
// the same three hooks and the same seven streams the Margin risk screen and
// the pulse use (scripts/validate-job-level.ts pins the bundle, as
// validate-margin-cost-sources pins theirs), and calls the same
// computeMarginRisk with the same whole-account lists app/margin-risk.tsx
// passes (the engines filter by project). Same inputs, same function: the Level
// can never disagree with the Margin risk screen or the margin alert.
//
// READINESS. Those stores default to [] / {} while they load; a score taken
// then prices a self-perform project at its bid margin. Until all three have
// loaded the margin half is withheld as 'loading' (the Level says so), never
// scored.
//
// VISIBILITY. The margin half is shown only for projects in `marginVisible`
// (Home passes burnByProject: its visibility rule already leaves out projects
// someone else owns, field seats and unread invoices / change orders — the
// rule the Contract and A/R columns print by).
//
// SCHEDULE. The caller passes the PortfolioSchedule it already has (the
// desktop table's rows); for any project without one, the schedule half is
// derived by utils/portfolio/portfolioRow's own buildPortfolioRows, so the
// Level, the Schedule column and the Schedule tab read one slip.

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Project } from '@/types';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import { TIME_ENTRIES_MIRROR_QUERY_KEY } from '@/hooks/useTimeEntries';
import type { JobCostActualSources } from '@/utils/jobCostEngine';
import { computeMarginRisk } from '@/utils/marginRiskScore';
import { buildPortfolioRows, type PortfolioRow } from '@/utils/portfolio/portfolioRow';
import { computeJobLevel, marginForLevel, type JobLevelReading } from '@/utils/jobLevel';

const NO_BURN = new Map<string, never>();

export interface UseJobLevelsInput {
  projects: readonly Project[];
  /** The rows' schedule verdicts, when the caller already built them. */
  schedules?: ReadonlyMap<string, PortfolioRow['schedule']> | null;
  /** Projects whose money may be shown here (Home: burnByProject). */
  marginVisible: { has(projectId: string): boolean };
  /** "Now" for the schedule half; injectable for tests. */
  now?: Date;
}

/** One reading per project id. */
export function useJobLevels({ projects, schedules, marginVisible, now }: UseJobLevelsInput): ReadonlyMap<string, JobLevelReading> {
  const { changeOrders, commitments, invoices, equipment, permits, subcontractors } = useProjects();
  const { receipts, isLoading: receiptsLoading } = useMaterialReceipts();
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier, overtimeRule, isLoading: ratesLoading } = useLaborRates();
  const costSources = useMemo<JobCostActualSources>(() => ({
    receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits, subcontractors,
  }), [receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits, subcontractors]);
  const queryClient = useQueryClient();
  const mirrorLoaded = queryClient.getQueryState(TIME_ENTRIES_MIRROR_QUERY_KEY)?.data !== undefined;
  const costSourcesReady = !receiptsLoading && !ratesLoading && mirrorLoaded;

  // The schedule half for projects the caller gave no verdict for.
  const nowMs = now?.getTime();
  const derivedSchedules = useMemo(() => {
    const missing = projects.filter((p) => !schedules?.has(p.id));
    const m = new Map<string, PortfolioRow['schedule']>();
    if (missing.length === 0) return m;
    const rows = buildPortfolioRows({
      projects: missing, invoices: [], changeOrders: [], rfis: [], punchItems: [],
      burnByProject: NO_BURN, now: nowMs != null ? new Date(nowMs) : new Date(),
    });
    for (const r of rows) m.set(r.id, r.schedule);
    return m;
  }, [projects, schedules, nowMs]);

  return useMemo(() => {
    const out = new Map<string, JobLevelReading>();
    for (const project of projects) {
      const schedule = schedules?.has(project.id) ? schedules.get(project.id) ?? null : derivedSchedules.get(project.id) ?? null;
      if (!marginVisible.has(project.id)) {
        out.set(project.id, computeJobLevel({ schedule, margin: null, marginWithheld: 'no_access' }));
        continue;
      }
      if (!costSourcesReady) {
        out.set(project.id, computeJobLevel({ schedule, margin: null, marginWithheld: 'loading' }));
        continue;
      }
      const risk = computeMarginRisk({ project, changeOrders, commitments, invoices, costSources });
      out.set(project.id, computeJobLevel({ schedule, margin: marginForLevel(risk) }));
    }
    return out;
  }, [projects, schedules, derivedSchedules, marginVisible, costSourcesReady, changeOrders, commitments, invoices, costSources]);
}

/** One project's reading (a detail surface). Lists call useJobLevels once. */
export function useJobLevel(
  project: Project | null,
  opts: { schedule?: PortfolioRow['schedule']; marginVisible: boolean; now?: Date },
): JobLevelReading | null {
  const projects = useMemo(() => (project ? [project] : []), [project]);
  const hasSchedule = opts.schedule !== undefined;
  const schedule = opts.schedule;
  const schedules = useMemo(
    () => (project && hasSchedule ? new Map([[project.id, schedule ?? null]]) : null),
    [project, hasSchedule, schedule],
  );
  const visible = opts.marginVisible;
  const marginVisible = useMemo(() => ({ has: () => visible }), [visible]);
  const map = useJobLevels({ projects, schedules, marginVisible, now: opts.now });
  return project ? map.get(project.id) ?? null : null;
}
