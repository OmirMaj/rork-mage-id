// hooks/useProjectRole.ts
//
// The current user's role on a project (owner/editor/viewer/field) or null
// while loading / signed out / not on the job. The decision lives in
// utils/projectRole.ts (resolveRoleState, unit-tested).

import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useCachedProjectRoleHint } from '@/contexts/ProjectContext';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { resolveRoleState, type ProjectRole } from '@/utils/projectRole';
import { isTransportError } from '@/utils/networkErrors';

export type { ProjectRole } from '@/utils/projectRole';

export interface ProjectRoleState {
  /** owner/editor/viewer/field, or null while loading, on error, with no
   *  project — or, settled (isLoading and isError both false), when he is NOT
   *  on this job: a known owner who is someone else and no accepted row
   *  (#90, a removed collaborator). A gate says why in that state; it never
   *  spins. */
  role: ProjectRole;
  isLoading: boolean;
  /** The collaborator read FAILED — distinct from "still resolving". A screen
   *  that renders nothing for null must say which one it is and offer
   *  `refetch` (audit RT-R2 / UX-F6: Job Costing sat on a blank sheet forever
   *  after a failed read; the money hero vanished silently). */
  isError: boolean;
  /** The read is waiting for a network (offline). `role` is then the last
   *  role this device knew for the job, or null while still loading. */
  isPaused: boolean;
  /** Why `role` is null while paused offline (the gate shows it). */
  reason?: string;
  refetch: () => void;
}

export function useProjectRoleState(projectId: string | undefined): ProjectRoleState {
  const { user } = useAuth();
  const hint = useCachedProjectRoleHint(projectId);
  const { collaborators, isLoading, isError, error, refetch } = useProjectCollaborators(projectId);
  const queryClient = useQueryClient();
  // react-query's isLoading is pending AND fetching: a read PAUSED offline is
  // pending but not fetching, so it looked settled with an empty list — which
  // roleForUser used to read as 'owner'. The status says it never answered.
  const queryState = projectId ? queryClient.getQueryState(['project_collaborators', projectId]) : undefined;
  const status = queryState?.status;
  const resolved = resolveRoleState({
    projectId,
    uid: user?.id,
    ownerUserId: hint?.ownerUserId,
    cachedRole: hint?.myRole,
    collaborators,
    isLoading: !!projectId && isLoading,
    isError: !!projectId && isError,
    isPending: !!projectId && (status === undefined || status === 'pending'),
    // Review round 1: a job missing from the cache is never "his own unsynced
    // create", and a read truly paused offline says why instead of spinning.
    inCache: !!hint,
    fetchPaused: queryState?.fetchStatus === 'paused',
    // #126: a read that never reached the server (no signal on native, where
    // react-query does not pause) serves the stamped field/editor role as
    // paused, instead of a paywall on the job he was invited to.
    errorIsTransport: !!projectId && isError && isTransportError(error),
  });
  return { ...resolved, refetch };
}

export function useProjectRole(projectId: string | undefined): ProjectRole {
  return useProjectRoleState(projectId).role;
}
