// utils/portalMessageWrite.ts — the ORDER a GC-authored portal_messages row
// goes out in, relative to its project's own write.
//
// Why this exists (post-ship review, 2026-09-18): migration 20260918140000
// ("lock 1") makes RLS refuse a GC message unless the SERVER's
// projects.client_portal.portalId already equals the row's portal_id. The
// device mints a new portalId on first enable / re-enable
// (client-portal-setup), and the project upsert that carries it waits ~800 ms
// in ProjectContext's debounce — or sits in the offline queue when offline. A
// message or system notice written in that window was refused and the composer
// showed the raw "new row violates row-level security policy" toast.
//
// The rule, in order:
//   1. a project write still waiting on its debounce is sent now;
//   2. one already on the wire is waited for (bounded);
//   3. if the project's write is (now) in the offline queue, the message joins
//      the queue too — the flush runs `projects` groups first and holds a child
//      whose parent has not landed (utils/offlineQueue.ts, tiers / B2);
//   4. otherwise it is written directly, and an RLS refusal is explained in
//      plain words instead of Postgres text.
// Pure and dependency-injected so scripts/validate-offline-group-abort can
// execute it with stubs.

import type { WriteOutcome } from '@/utils/offlineQueue';

export const PORTAL_STILL_SAVING = 'Your portal is still saving — try again in a moment.';

/** A refusal with NO project write of ours pending cannot be "still saving":
 *  the policy also refuses anyone but the project owner, and a portal whose
 *  server portalId no longer matches (disabled, or re-enabled on another
 *  device). Neither clears by waiting, so the copy names both conditions
 *  instead of guessing one (leftovers review). */
export const PORTAL_MESSAGE_REFUSED = 'The portal refused this message. Only the project owner can message the client, and only while the portal is on — check Client Portal setup.';

/** Words for an RLS refusal of a GC portal message. "Still saving" only when
 *  this device had a project write for the job unconfirmed when the send
 *  began — the one case where retrying in a moment actually helps. */
export function portalRefusalCopy(projectWritePending: boolean): string {
  return projectWritePending ? PORTAL_STILL_SAVING : PORTAL_MESSAGE_REFUSED;
}

/** How long a GC send waits for a project write already on the wire. */
export const PORTAL_SYNC_WAIT_MS = 8000;

export function isPortalLockRefusal(message: string, code?: string): boolean {
  return code === '42501' || /row-level security/i.test(message);
}

export interface PortalMessageWriteDeps {
  /** A project write for this id is waiting on its debounce (not yet sent). */
  projectSyncWaiting: (projectId: string) => boolean;
  /** Send every waiting project write now (sends or queues each). */
  flushProjectSyncs: () => Promise<void>;
  /** A project write for this id is waiting OR on the wire. */
  projectSyncUnconfirmed: (projectId: string) => boolean;
  /** Resolves when a project write reports, or after `ms`. */
  waitProjectSyncSettled: (projectId: string, ms: number) => Promise<void>;
  /** This session's offline queue holds a write for this project. May throw. */
  projectWriteQueued: (projectId: string) => Promise<boolean>;
  enqueue: (row: Record<string, unknown>) => Promise<void>;
  /** `projectWritePending`: a project write for this job was waiting or on
   *  the wire when the send began (see portalRefusalCopy). */
  writeNow: (row: Record<string, unknown>, ctx: { projectWritePending: boolean }) => Promise<WriteOutcome>;
}

export async function writePortalMessageOrdered(
  row: Record<string, unknown>,
  deps: PortalMessageWriteDeps,
): Promise<WriteOutcome> {
  const projectId = typeof row.project_id === 'string' && row.project_id ? row.project_id : null;
  // Read BEFORE the flush/wait below clears it: a refusal is only "still
  // saving" if our own project write was in flight when he pressed Send.
  const projectWritePending = !!projectId
    && (deps.projectSyncWaiting(projectId) || deps.projectSyncUnconfirmed(projectId));
  if (projectId) {
    if (deps.projectSyncWaiting(projectId)) {
      try { await deps.flushProjectSyncs(); } catch { /* each run reports its own failure */ }
    }
    // Bounded: a slow uplink must not freeze the composer. Past the wait the
    // queue check below still orders a write that fell back to the queue.
    const deadline = Date.now() + PORTAL_SYNC_WAIT_MS;
    while (deps.projectSyncUnconfirmed(projectId) && Date.now() < deadline) {
      await deps.waitProjectSyncSettled(projectId, Math.max(0, deadline - Date.now()));
    }
    let queued: boolean;
    // An unreadable queue counts as holding the project write: queueing the
    // message costs a flush at worst; sending it early costs a refusal.
    try { queued = await deps.projectWriteQueued(projectId); } catch { queued = true; }
    if (queued) {
      try {
        await deps.enqueue(row);
        return 'queued';
      } catch {
        return 'failed';
      }
    }
  }
  return deps.writeNow(row, { projectWritePending });
}
