// ============================================================================
// utils/defaultProjectId.ts — which job a WRITE defaults to (UX wave, Lane 0).
//
// WHY THIS IS NOT resolveActiveProjectId. utils/activeProject.ts answers
// "which job is the sidebar on", and its last step is a guess: the most
// recently updated in-progress job. That guess is fine for highlighting a
// sidebar row. It is not fine for payroll hours, a daily log or a voice note,
// where a wrong job is a wrong legal record and nobody notices until the
// invoice. So this file answers "which job may a picker PRESELECT":
//
//   1. the job the route names (the screen was opened from that job);
//   2. the stored / active pick — but only when it is a real pick, never the
//      resolver's in-progress guess (see isRealPick below);
//   3. the most recently opened job;
//   4. null. The caller shows the picker with nothing selected. Never
//      `projects[0]`, never "most recently updated".
//
// Every step skips a job that is not defaultable: closed, sample, or
// COMPLETED. isEligibleJob does not exclude completed jobs (the sidebar may
// still sit on one), but nobody clocks a crew onto a finished job by default.
// A screen that must honour an explicit route to a completed job (a punch list
// opened from that job's page) reads its own route param; this helper only
// decides what a picker may pre-fill.
//
// Pure: no React, no React Native. scripts/validate-ux-default-project.ts runs
// it under bun. It builds on isEligibleJob; it does not write a second
// resolution order for the sidebar.
// ============================================================================

import type { Project } from '@/types';
import { isEligibleJob } from '@/utils/activeProject';

type JobLike = Pick<Project, 'id' | 'name' | 'status' | 'updatedAt'>;

export interface DefaultProjectInput {
  /** The job the current screen's route names (`?projectId=`), if any. */
  routeProjectId?: string | null;
  /** useActiveProject().activeProjectId. May be the resolver's in-progress
   *  guess; this helper filters that out (isRealPick). */
  activeProjectId?: string | null;
  /** useActiveProject().recentProjectIds, most recent first. */
  recentProjectIds?: readonly string[] | null;
  projects: readonly JobLike[];
}

export type DefaultProjectSource = 'route' | 'active' | 'recent';

export interface DefaultProjectPick {
  id: string | null;
  /** Where the id came from; null when there is no safe default. */
  source: DefaultProjectSource | null;
}

/** A job a picker may preselect for a write: eligible (not closed, not a
 *  sample) AND not completed. */
export function isDefaultableJob(p: JobLike): boolean {
  return isEligibleJob(p) && p.status !== 'completed';
}

/**
 * The active id counts only when it is a pick the user made. The context
 * pushes every explicit pick and every URL job onto the recent list
 * (ActiveProjectContext.setActiveProject → pushRecent), so a real pick is
 * always in `recentProjectIds`. The resolver's fourth step (the in-progress
 * guess) only runs when NO recent id is live — so an active id that is absent
 * from the recent list is, by construction, the guess.
 */
function isRealPick(id: string, recent: readonly string[]): boolean {
  return recent.includes(id);
}

/** The default and where it came from. See the file header for the order. */
export function explainDefaultProjectId(input: DefaultProjectInput): DefaultProjectPick {
  const ok = new Map<string, JobLike>();
  for (const p of input.projects) if (isDefaultableJob(p)) ok.set(p.id, p);
  const recent = (input.recentProjectIds ?? []).filter(id => typeof id === 'string' && id.length > 0);

  const route = input.routeProjectId ?? null;
  if (route && ok.has(route)) return { id: route, source: 'route' };

  const active = input.activeProjectId ?? null;
  if (active && ok.has(active) && isRealPick(active, recent)) return { id: active, source: 'active' };

  for (const id of recent) if (ok.has(id)) return { id, source: 'recent' };

  return { id: null, source: null };
}

/** The job a picker may preselect, or null (show the picker, nothing picked). */
export function pickDefaultProjectId(input: DefaultProjectInput): string | null {
  return explainDefaultProjectId(input).id;
}

/** The line a blocked primary button shows when there is no default and the
 *  user has not picked yet (B1 "Clock in", A3 "Create note"). One string so
 *  every lane says the same thing. */
export const PICK_JOB_FIRST = 'Pick the project first';
