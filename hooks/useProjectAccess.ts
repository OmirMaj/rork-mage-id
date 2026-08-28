// useProjectAccess — canAccess(), but for a screen scoped to ONE project.
//
// Use this instead of useTierAccess on any screen that operates on a single
// project's data. It answers the same question, plus: "…or was this person
// invited to this project to do exactly this?"
//
// Without it, an invited teammate hits a paywall on the work they were invited
// to do, because tier resolves purely from their OWN subscription — see the
// header of utils/collaboratorAccess for the full failure.
//
// Financial blinding for the 'field' role is a separate axis and still applies
// on top (utils/roleBlinding): this decides whether the screen opens, that
// decides whether money shows on it.

import { useCallback } from 'react';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectRole } from '@/hooks/useProjectRole';
import { resolveProjectAccess } from '@/utils/collaboratorAccess';

export function useProjectAccess(projectId: string | undefined) {
  const { tier, canAccess, requiredTierFor } = useTierAccess();
  const role = useProjectRole(projectId);

  /** Tier access OR the collaborator grant for this project. */
  const canAccessProject = useCallback(
    (feature: Parameters<typeof canAccess>[0]): boolean =>
      resolveProjectAccess(canAccess(feature), role, feature as string),
    [canAccess, role],
  );

  return { tier, role, canAccess: canAccessProject, canAccessOwnTier: canAccess, requiredTierFor };
}
