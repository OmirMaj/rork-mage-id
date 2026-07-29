// utils/projectRole.ts
//
// Pure role derivation for multi-user projects (Live Schedule Collaboration
// Phase 1). Kept React-free so it's unit-testable in a plain bun script.

import type { ProjectCollaborator } from '@/types';

export type ProjectRole = 'owner' | 'editor' | 'viewer' | null;

/**
 * The current user's role on a project, given the collaborator rows visible to
 * them. RLS only exposes a project to its owner OR an accepted collaborator, so:
 *   - if an ACCEPTED collaborator row matches this user → that role;
 *   - otherwise, if they can see the project at all, they are the owner.
 * Returns null when the user id is unknown (not signed in / still loading).
 */
export function roleForUser(
  collaborators: ProjectCollaborator[],
  uid: string | null | undefined,
): ProjectRole {
  if (!uid) return null;
  const row = collaborators.find((c) => c.userId === uid && c.status === 'accepted');
  return row ? row.role : 'owner';
}
