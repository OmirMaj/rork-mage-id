// components/project/ProjectKpiStrip.tsx — the job's eight numbers in one row.
//
// Desktop only (app/project-detail.tsx mounts it inside its `isDesktop ?`
// branch). The numbers come from hooks/useProjectPulse — the same read the
// phone's ProjectHero shows — and the cells are decided by the pure
// utils/projectWorkspaceLayout buildKpiCells, so every honesty rule (a value
// it does not know is '—' with the reason, never 0; money cells LEFT OUT for a
// role that may not see money, or while that access could not be verified) is
// a tested function, not markup. This file only mounts the 6b KpiStrip.

import React, { useMemo } from 'react';
import { KpiStrip } from '@/components/desktop/KpiStrip';
import { buildKpiCells, type LogSectionKey, type ProjectPulse } from '@/utils/projectWorkspaceLayout';

export interface ProjectKpiStripProps {
  projectId: string;
  pulse: ProjectPulse;
  /** '% complete' → the schedule (router.replace to the schedule tab). */
  onOpenSchedule: () => void;
  /** Desktop web: log cells are links. Elsewhere they open in place. */
  listLinks: boolean;
  onOpenSection: (key: LogSectionKey) => void;
}

export function ProjectKpiStrip({ projectId, pulse, onOpenSchedule, listLinks, onOpenSection }: ProjectKpiStripProps) {
  const cells = useMemo(
    () => buildKpiCells(pulse, { projectId, onOpenSchedule, listLinks, onOpenSection }),
    [pulse, projectId, onOpenSchedule, listLinks, onOpenSection],
  );
  return <KpiStrip cells={cells} canViewFinancials={pulse.canSeeMoney} testID="project-kpi-strip" />;
}

export default ProjectKpiStrip;
