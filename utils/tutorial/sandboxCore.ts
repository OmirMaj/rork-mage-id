// utils/tutorial/sandboxCore.ts — which project a tutorial may run on, pure.
//
// A SANDBOX is one of the user's OWN sample projects: its name carries the
// byte-exact 'Sample — ' prefix (U+2014) that the server's free-cap trigger
// exempts (utils/projectCap). These are NEVER a sandbox:
//   • a project renamed out of the prefix — it is real now, and renaming it
//     spent his cap slot;
//   • another contractor's job, even a sample one shared with him;
//   • for an invited field seat, anything but his own seeded sample — the
//     tutorial never touches the GC's job.
// Samples are real synced rows on purpose: the real save paths run and the
// celebration fires on the real success. They are deleted with the sample.

import type { Project } from '@/types';
import { isSampleProjectName } from '@/utils/projectCap';
import type { HandoffRole } from './types';

type ProjectLike = Pick<Project, 'id' | 'name' | 'ownerUserId' | 'myRole' | 'createdAt' | 'updatedAt'>;

/** Owned by `userId`. An unset ownerUserId counts as owned (created on this
 *  phone before its first sync), matching utils/projectCap; a collaborator
 *  role marks a job someone shared with him. */
export function isOwnedBy(p: Pick<Project, 'ownerUserId' | 'myRole'>, userId: string | null | undefined): boolean {
  if (p.myRole && p.myRole !== 'owner') return false;
  if (!p.ownerUserId) return true;
  return !!userId && p.ownerUserId === userId;
}

function stamp(p: Pick<Project, 'createdAt' | 'updatedAt'>): number {
  const t = Date.parse(p.createdAt ?? '') || Date.parse(p.updatedAt ?? '') || 0;
  return Number.isFinite(t) ? t : 0;
}

/** The newest OWNED project named exactly `name` (e.g. "Sample — Sarah's
 *  Place"), or null — then the caller seeds one. The name must itself be a
 *  sample name, so a mistyped constant can never pick a real job. */
export function pickSandboxProject<P extends ProjectLike>(projects: readonly P[], userId: string | null | undefined, name: string): P | null {
  if (!isSampleProjectName(name)) return null;
  let best: P | null = null;
  for (const p of projects) {
    if (p.name !== name || !isOwnedBy(p, userId)) continue;
    if (!best || stamp(p) > stamp(best)) best = p;
  }
  return best;
}

/** True while `projectId` is still a sandbox for `userId` — the host exits
 *  the run ('sample_gone') the moment this turns false (deleted, renamed out
 *  of the prefix, or no longer his). */
export function sandboxStillValid(projects: readonly ProjectLike[], userId: string | null | undefined, projectId: string): boolean {
  const p = projects.find(x => x.id === projectId);
  return !!p && isSampleProjectName(p.name) && isOwnedBy(p, userId);
}

/** His newest REAL job for the finale's 'Do it on your job': not a sample,
 *  and either his own or a shared job where his role can do the real thing
 *  (`roles` — a viewer can't file a report; a field seat can't invoice). */
export function newestRealProject<P extends ProjectLike>(
  projects: readonly P[],
  userId: string | null | undefined,
  roles: readonly HandoffRole[] = ['owner', 'editor', 'field'],
  /** Extra per-job filter (the handoff passes "this feature opens on this
   *  job", which for a shared job is the OWNER's plan, not his). */
  accept?: (p: P, role: HandoffRole) => boolean,
): P | null {
  let best: P | null = null;
  for (const p of projects) {
    if (isSampleProjectName(p.name)) continue;
    // Not his and no collaborator role on record → treat as read-only.
    const role: HandoffRole | 'viewer' = isOwnedBy(p, userId) ? 'owner' : (p.myRole ?? 'viewer');
    if (role === 'viewer' || !roles.includes(role)) continue;
    if (accept && !accept(p, role)) continue;
    if (!best || stampUpdated(p) > stampUpdated(best)) best = p;
  }
  return best;
}

function stampUpdated(p: Pick<Project, 'createdAt' | 'updatedAt'>): number {
  const t = Date.parse(p.updatedAt ?? '') || Date.parse(p.createdAt ?? '') || 0;
  return Number.isFinite(t) ? t : 0;
}

/** An invited field seat with no job of his own: every real project he can
 *  see is shared with him as 'field'. His own sample doesn't change that. */
export function isFieldOnlyUser(projects: readonly Pick<Project, 'name' | 'ownerUserId' | 'myRole'>[], userId: string | null | undefined): boolean {
  let fieldJobs = 0;
  for (const p of projects) {
    if (isSampleProjectName(p.name)) continue;
    if (isOwnedBy(p, userId)) return false;
    if (p.myRole !== 'field') return false;
    fieldJobs += 1;
  }
  return fieldJobs > 0;
}

// ── Report day ──────────────────────────────────────────────────────────────

/** YYYY-MM-DD in the device's local zone (a report 'day' is a local day). */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayBefore(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1));
}

/** The day the DFR tutorial files: today, or — when the sample already has
 *  today's report (a replay) — the most recent earlier day without one, so a
 *  replay never opens an existing report and 'saves' nothing new. Report dates
 *  may be full ISO stamps; only their first 10 chars are compared. */
export function tutorialReportDay(
  reports: readonly { projectId: string; date: string }[],
  projectId: string,
  today: string,
  maxLookback = 120,
): string {
  const taken = new Set<string>();
  for (const r of reports) if (r.projectId === projectId && typeof r.date === 'string') taken.add(r.date.slice(0, 10));
  let day = today;
  for (let i = 0; i <= maxLookback; i += 1) {
    if (!taken.has(day)) return day;
    day = dayBefore(day);
  }
  return today;
}
