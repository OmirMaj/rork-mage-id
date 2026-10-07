// components/codeFlags/CodeFlagsProbe.tsx — Code Flags: mounted ONCE on a
// screen that shows flag chips. Works out the project's place (the app's one
// resolver), the building's year (the same hook the code card uses: a year he
// entered, else the public record he confirmed) and the kind of job, and
// publishes them for the chips. Also reads this account's hidden flags.
//
// Renders nothing, and nothing at all while CODE_FLAGS_ENABLED is false.
import { useEffect, useMemo } from 'react';
import { CODE_FLAGS_ENABLED } from '@/constants/featureFlags';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildingYear } from '@/hooks/useBuildingYear';
import { jurisdictionQueryForProject } from '@/utils/codeJurisdiction';
import { resolveCodeFlagPlace } from '@/utils/codeFlags/place';
import type { CodeFlagContext } from '@/utils/codeFlags/match';
import { loadDismissals } from '@/utils/codeFlags/dismissStore';
import { clearCodeFlagContext, publishCodeFlagContext } from '@/components/codeFlags/contextStore';

function ProbeOn({ projectId }: { projectId?: string | null }) {
  const { getProject } = useProjects();
  const { user } = useAuth();
  const project = projectId ? getProject(projectId) : null;
  const building = useBuildingYear(project);
  const year = building.year?.year ?? null;

  const ctx = useMemo<CodeFlagContext | null>(() => {
    if (!project) return null;
    return {
      place: resolveCodeFlagPlace(jurisdictionQueryForProject(project)),
      yearBuilt: year,
      jobKind: project.type === 'commercial' ? 'commercial' : 'residential',
    };
  }, [project, year]);

  useEffect(() => {
    if (!projectId || !ctx) return;
    publishCodeFlagContext(projectId, ctx);
  }, [projectId, ctx]);
  useEffect(() => {
    if (!projectId) return;
    return () => clearCodeFlagContext(projectId);
  }, [projectId]);

  const account = user?.id ?? '';
  useEffect(() => { void loadDismissals(account); }, [account]);
  return null;
}

export default function CodeFlagsProbe(props: { projectId?: string | null }) {
  if (!CODE_FLAGS_ENABLED) return null;
  return <ProbeOn {...props} />;
}
