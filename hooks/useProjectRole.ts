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
  const { collaborators, isLoading } = useProjectCollaborators(projectId);
  if (!projectId || isLoading) return null;
  return roleForUser(collaborators, user?.id);
}
