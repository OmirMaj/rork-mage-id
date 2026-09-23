// hooks/useProjectCapGate.ts — one gate for every path that creates a project
// (audit wave 5, #57).
//
// WHY. Home's '+ Project' checked the free plan's one-project cap, but the
// other create paths (Duplicate, the estimate wizard's "new project", the
// Schedule tab, the voice mic, the new-project Copilot) called addProject with
// no check. On the free plan at the cap the server trigger refuses that insert,
// so the job — and everything he then files under it — lived on one phone and
// never synced. Each create path asks this gate first and, when it says no,
// explains why and offers the upgrade instead of making a job that will vanish.
//
// The count is utils/projectCap (the server's rule: non-sample projects he
// OWNS); the tier comparison is useTierAccess().canCreateProject. A name that
// is itself a sample ('Sample — …') is always allowed — the server exempts it.

import { useCallback, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { showAlert } from '@/utils/alert';
import { capProjectCount, isSampleProjectName } from '@/utils/projectCap';

/** The title and body the gate shows; exported so a guard can pin the copy. */
export const PROJECT_CAP_ALERT_TITLE = 'Free covers one project';
export const PROJECT_CAP_ALERT_BODY =
  'The free plan covers one job of your own, and this would make a second. '
  + 'A job you have finished still counts; jobs another contractor shares with you don’t. '
  + 'Pro takes the cap off.';

export interface ProjectCapGate {
  /**
   * True when a project named `nextName` may be created now. A sample name is
   * always allowed; anything else needs a free slot (or a paid plan).
   */
  canCreate(nextName?: string): boolean;
  /** Tells him why the create was stopped and offers the plans screen. */
  explainAndOfferUpgrade(): void;
}

export function useProjectCapGate(): ProjectCapGate {
  const router = useRouter();
  const { projects } = useProjects();
  const { user } = useAuth();
  const { canCreateProject } = useTierAccess();
  const userId = user?.id;

  const capCount = useMemo(() => capProjectCount(projects, userId), [projects, userId]);

  const canCreate = useCallback(
    (nextName?: string): boolean => {
      if (isSampleProjectName(nextName)) return true;
      return canCreateProject(capCount);
    },
    [canCreateProject, capCount],
  );

  const explainAndOfferUpgrade = useCallback(() => {
    showAlert(PROJECT_CAP_ALERT_TITLE, PROJECT_CAP_ALERT_BODY, [
      { text: 'Not now', style: 'cancel' },
      { text: 'See plans', onPress: () => router.push('/paywall' as never) },
    ]);
  }, [router]);

  return useMemo(() => ({ canCreate, explainAndOfferUpgrade }), [canCreate, explainAndOfferUpgrade]);
}

export default useProjectCapGate;
