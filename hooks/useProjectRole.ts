// hooks/useProjectRole.ts
//
// The current user's role on a project (owner/editor/viewer) or null while
// loading / signed out. Pure logic lives in utils/projectRole.ts (unit-tested).

import { useAuth } from '@/contexts/AuthContext';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { roleForUser, type ProjectRole } from '@/utils/projectRole';

export type { ProjectRole } from '@/utils/projectRole';

export interface ProjectRoleState {
  /** owner/editor/viewer/field, or null while loading, on error, or with no project. */
  role: ProjectRole;
  isLoading: boolean;
  /** The collaborator read FAILED — distinct from "still resolving". A screen
   *  that renders nothing for null must say which one it is and offer
   *  `refetch` (audit RT-R2 / UX-F6: Job Costing sat on a blank sheet forever
   *  after a failed read; the money hero vanished silently). */
  isError: boolean;
  refetch: () => void;
}

export function useProjectRoleState(projectId: string | undefined): ProjectRoleState {
  const { user } = useAuth();
  const { collaborators, isLoading, isError, refetch } = useProjectCollaborators(projectId);
  // NULL on error, never 'owner'. roleForUser falls back to 'owner' when the
  // caller is absent from the collaborator list, which is right when the list
  // actually loaded — and a privilege escalation when the query merely failed
  // and handed back an empty array.
  //
  // Null is safe here, not a lockout: canViewFinancials(null) is false (blinds
  // margin, the conservative outcome) while resolveProjectAccess still falls
  // through to the user's OWN tier, so an owner keeps everything they pay for
  // and simply cannot see financials until the role resolves.
  const role: ProjectRole = (!projectId || isLoading || isError) ? null : roleForUser(collaborators, user?.id);
  return { role, isLoading: !!projectId && isLoading, isError: !!projectId && isError, refetch };
}

export function useProjectRole(projectId: string | undefined): ProjectRole {
  return useProjectRoleState(projectId).role;
}
