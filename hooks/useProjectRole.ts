// hooks/useProjectRole.ts
//
// The current user's role on a project (owner/editor/viewer) or null while
// loading / signed out. Pure logic lives in utils/projectRole.ts (unit-tested).

import { useAuth } from '@/contexts/AuthContext';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { roleForUser, type ProjectRole } from '@/utils/projectRole';

export type { ProjectRole } from '@/utils/projectRole';

export function useProjectRole(projectId: string | undefined): ProjectRole {
  const { user } = useAuth();
  const { collaborators, isLoading, isError } = useProjectCollaborators(projectId);
  // NULL on error, never 'owner'. roleForUser falls back to 'owner' when the
  // caller is absent from the collaborator list, which is right when the list
  // actually loaded — and a privilege escalation when the query merely failed
  // and handed back an empty array.
  //
  // Null is safe here, not a lockout: canViewFinancials(null) is false (blinds
  // margin, the conservative outcome) while resolveProjectAccess still falls
  // through to the user's OWN tier, so an owner keeps everything they pay for
  // and simply cannot see financials until the role resolves.
  if (!projectId || isLoading || isError) return null;
  return roleForUser(collaborators, user?.id);
}
