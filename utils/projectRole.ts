// utils/projectRole.ts
//
// Pure role derivation for multi-user projects (Live Schedule Collaboration
// Phase 1). Kept React-free so it's unit-testable in a plain bun script.

import type { ProjectCollaborator } from '@/types';

export type ProjectRole = 'owner' | 'editor' | 'viewer' | 'field' | null;

/**
 * The current user's role on a project, given the collaborator rows visible to
 * them and (when known) the project's owner:
 *   - an ACCEPTED collaborator row for this user → that role;
 *   - otherwise 'owner' only when the project is HIS (ownerUserId === uid), or
 *     when its owner is unknown — a legacy cache from before the owner stamp,
 *     or his own create the server has not seen. Never lock an owner out.
 *   - a KNOWN, different owner and no accepted row → null: he is not on this
 *     job (#90 — the GC removed him; the old fallback handed him 'owner').
 * Returns null when the user id is unknown (not signed in / still loading).
 *
 * `ownerUserId` is optional so every older caller (and its tests) keeps its
 * answer; the runtime caller, useProjectRoleState, always passes it.
 */
export function roleForUser(
  collaborators: ProjectCollaborator[],
  uid: string | null | undefined,
  ownerUserId?: string | null,
): ProjectRole {
  if (!uid) return null;
  const row = collaborators.find((c) => c.userId === uid && c.status === 'accepted');
  if (row) return row.role;
  if (!ownerUserId || ownerUserId === uid) return 'owner';
  return null;
}

/** What the role hook reports. `isPaused`: the collaborator read is waiting
 *  for a network it does not have (react-query's paused fetch) — the answer
 *  below is the last one this device knew, or still loading. */
export interface ResolvedRoleState {
  role: ProjectRole;
  isLoading: boolean;
  isError: boolean;
  isPaused: boolean;
  /** Set only on a settled-null PAUSED answer: why the role cannot be known
   *  offline, for the gate to say instead of spinning. */
  reason?: string;
}

/** Review round 1 · the reasons a paused (offline) read gives for no role. */
export const ROLE_PAUSED_NOT_ON_PHONE = 'This job is not on this phone, so your access to it cannot be checked offline. Connect to the internet and try again.';
export const ROLE_PAUSED_UNKNOWN = 'Your access to this job cannot be checked offline. Connect to the internet and try again.';

/**
 * The one decision behind useProjectRoleState, pure so it is tested (#90 and
 * the paused-read handoff):
 *  - no project → null, settled;
 *  - HIS project (the server's owner stamp, cached) → 'owner' at once, even
 *    offline or after a failed collaborator read — the owner is never a row
 *    in that table, and locking him out of his own job on a blip is worse
 *    than useless;
 *  - the read failed → null with isError (the screen offers Retry);
 *  - the read answered → roleForUser, with the owner stamp;
 *  - the read is in flight → null, loading;
 *  - the read is PAUSED (offline, never answered on this launch) → the role
 *    the projects load last stamped on the cached job, if any; otherwise
 *    'owner' when the owner is unknown AND the job is in the cached list (his
 *    own offline create); otherwise null, settled, with a reason ("cannot be
 *    checked offline" / "not on this phone") — never a silent 'owner' (the
 *    old fallback: a paused read looked settled with an empty list, which
 *    read as owner), and never a spinner that lasts as long as the outage;
 *  - pending but not yet fetching (about to start) → loading.
 */
export function resolveRoleState(a: {
  projectId: string | undefined;
  uid: string | null | undefined;
  ownerUserId?: string | null;
  cachedRole?: ProjectCollaborator['role'] | null;
  collaborators: ProjectCollaborator[];
  isLoading: boolean;
  isError: boolean;
  /** The query has never produced data or an error (status 'pending'). */
  isPending: boolean;
  /** The job is in this device's cached project list (useCachedProjectRoleHint
   *  found it). Absent = not known to be cached. */
  inCache?: boolean;
  /** react-query's fetchStatus is 'paused' (waiting for a network). Absent =
   *  unknown (legacy callers: treated as paused-and-waiting, i.e. loading). */
  fetchPaused?: boolean;
}): ResolvedRoleState {
  const settled = (role: ProjectRole): ResolvedRoleState => ({ role, isLoading: false, isError: false, isPaused: false });
  if (!a.projectId || !a.uid) return settled(null);
  if (a.ownerUserId && a.ownerUserId === a.uid) return settled('owner');
  if (a.isError) return { role: null, isLoading: false, isError: true, isPaused: false };
  if (a.isLoading) return { role: null, isLoading: true, isError: false, isPaused: false };
  if (a.isPending) {
    if (a.cachedRole && a.cachedRole !== 'owner') return { role: a.cachedRole, isLoading: false, isError: false, isPaused: true };
    // Review round 1: "owner unknown" means HIS unsynced create only when the
    // job IS in the cached list — a deep link to a job this phone never held
    // (or already forgot) has no owner stamp either, and must not be handed
    // owner controls.
    if (!a.ownerUserId && a.inCache === true) return { role: 'owner', isLoading: false, isError: false, isPaused: true };
    // Truly paused (offline): say why instead of spinning for as long as the
    // phone has no signal. Not yet started (about to fetch): loading.
    if (a.fetchPaused === true) {
      return { role: null, isLoading: false, isError: false, isPaused: true, reason: a.inCache === true ? ROLE_PAUSED_UNKNOWN : ROLE_PAUSED_NOT_ON_PHONE };
    }
    return { role: null, isLoading: true, isError: false, isPaused: a.fetchPaused === undefined };
  }
  return settled(roleForUser(a.collaborators, a.uid, a.ownerUserId));
}
