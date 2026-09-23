// ============================================================================
// utils/activeProject.ts — the pure half of the job context (wave 6b, L2).
//
// contexts/ActiveProjectContext.tsx owns the React state; everything that can
// be wrong about WHICH job is active lives here instead, so
// scripts/validate-active-project.ts can prove it under bun. No React, no
// React Native, no expo-router value imports — bun crashes on those.
//
// WHY A JOB CONTEXT AT ALL. The founder runs the web app on a laptop, and the
// desktop sidebar had no idea which job he was on: every project tool opened
// on a "Pick a project" list, a copied URL lost the job, and "Recent" was just
// the first three rows of the project array. The active job is the thing a GC
// is working IN; the sidebar, the job switcher and every picker now agree on
// one answer, and this file is where that answer is computed.
// ============================================================================

import type { Project } from '@/types';
import { isSampleProjectName } from '@/utils/projectCap';

/** Storage keys. All three sit under `mageid_`, one of APP_STORAGE_PREFIXES,
 *  so AuthContext.wipeLocalUserCache's prefix sweep removes them on sign-out
 *  and on a tenant switch with no list to maintain (see utils/localCacheKeys). */
export const ACTIVE_PROJECT_KEY = 'mageid_active_project';
export const RECENT_PROJECTS_KEY = 'mageid_recent_projects';
export const SIDEBAR_SECTIONS_KEY = 'mageid_sidebar_sections';

/** Stored MRU depth. Deeper than what is shown, so closing two jobs does not
 *  empty the visible list. */
export const RECENT_MAX = 8;
/** How many recent jobs the sidebar and the switcher show. */
export const RECENT_VISIBLE = 5;

type JobLike = Pick<Project, 'id' | 'name' | 'status' | 'updatedAt'>;

/**
 * A job the context may point at: it exists, it is not closed, and it is not
 * seeded demo data. Deleted jobs are simply absent from `projects`, which is
 * also how another account's job reads — the project list is per-user, so an
 * id that is not in it is never shown, whatever wrote it.
 */
export function isEligibleJob(p: JobLike): boolean {
  return p.status !== 'closed' && !isSampleProjectName(p.name);
}

function eligibleById(projects: readonly JobLike[]): Map<string, JobLike> {
  const m = new Map<string, JobLike>();
  for (const p of projects) if (isEligibleJob(p)) m.set(p.id, p);
  return m;
}

function updatedMs(p: JobLike): number {
  const t = Date.parse(p.updatedAt ?? '');
  return Number.isFinite(t) ? t : 0;
}

export interface ResolveInput {
  /** The id the current URL names (see urlProjectIdFrom), if any. */
  urlProjectId: string | null;
  /** The last explicit pick, from ACTIVE_PROJECT_KEY. */
  storedId: string | null;
  /** MRU, most recent first, from RECENT_PROJECTS_KEY. */
  recentIds: readonly string[];
  projects: readonly JobLike[];
}

/**
 * The active job, in the order the spec fixes:
 *   1. the URL's job, when it names a live one (a copied link wins);
 *   2. the stored pick;
 *   3. the most recently opened live job;
 *   4. the most recently updated in-progress job.
 * Each step skips anything that is not eligible, so a stale id from any source
 * falls through instead of pinning the sidebar to a job that is gone.
 */
export function resolveActiveProjectId(input: ResolveInput): string | null {
  const live = eligibleById(input.projects);
  if (input.urlProjectId && live.has(input.urlProjectId)) return input.urlProjectId;
  if (input.storedId && live.has(input.storedId)) return input.storedId;
  for (const id of input.recentIds) if (live.has(id)) return id;
  let best: JobLike | null = null;
  for (const p of live.values()) {
    if (p.status !== 'in_progress') continue;
    if (!best || updatedMs(p) > updatedMs(best)) best = p;
  }
  return best ? best.id : null;
}

/**
 * Push `id` to the front of the MRU: deduped, capped at RECENT_MAX, and pruned
 * to ids that still exist in `existingIds`. Pruning happens on WRITE, where the
 * project list is known to be loaded (the user just opened a job from it) — a
 * prune on read would wipe the list during the cold-start window when the
 * project array is still empty.
 */
export function pushRecent(
  prev: readonly string[],
  id: string,
  existingIds: ReadonlySet<string>,
): string[] {
  const out = [id];
  for (const p of prev) {
    if (p === id || !existingIds.has(p)) continue;
    out.push(p);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

/** The recent list a user sees: live jobs only, MRU order, at most `max`. */
export function visibleRecent(
  recentIds: readonly string[],
  projects: readonly JobLike[],
  max: number = RECENT_VISIBLE,
): string[] {
  const live = eligibleById(projects);
  const out: string[] = [];
  for (const id of recentIds) {
    if (!live.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The job switcher's list: recent jobs first (MRU order), then in-progress
 * jobs, then everything else, the last two by most recently updated. Only
 * eligible jobs, because picking a closed or sample job would set an active
 * job that resolveActiveProjectId immediately refuses. `query` filters by a
 * case-insensitive substring of the name.
 */
export function jobSwitcherList<P extends JobLike>(
  projects: readonly P[],
  recentIds: readonly string[],
  query: string,
): P[] {
  const q = query.trim().toLowerCase();
  const pool = projects.filter(p => isEligibleJob(p) && (!q || p.name.toLowerCase().includes(q)));
  const byId = new Map(pool.map(p => [p.id, p] as const));
  const seen = new Set<string>();
  const out: P[] = [];
  for (const id of recentIds) {
    const p = byId.get(id);
    if (p && !seen.has(id)) { out.push(p); seen.add(id); }
  }
  const rest = pool.filter(p => !seen.has(p.id));
  const byUpdated = (a: P, b: P) => updatedMs(b) - updatedMs(a);
  out.push(...rest.filter(p => p.status === 'in_progress').sort(byUpdated));
  out.push(...rest.filter(p => p.status !== 'in_progress').sort(byUpdated));
  return out;
}

// ── Route ↔ job ─────────────────────────────────────────────────────────────

/** Strip Expo Router group folders: '/(tabs)/(home)' → '/', '/(tabs)/subs' →
 *  '/subs'. The resolved pathname a screen sees never contains them. */
export function normalizeRoutePath(route: string): string {
  const segs = route.split('/').filter(s => s.length > 0 && !s.startsWith('('));
  return '/' + segs.join('/');
}

/** Screens that read the job from `?id=` rather than `?projectId=`. Every
 *  other project-scoped screen reads `projectId` (verified per screen by
 *  scripts/validate-active-project.ts, which greps each one). */
const ID_PARAM_ROUTES: ReadonlySet<string> = new Set(['/project-detail', '/client-portal-setup']);

/** The query param that carries the job on `route` (grouped or not). */
export function projectParamFor(route: string): 'id' | 'projectId' {
  return ID_PARAM_ROUTES.has(normalizeRoutePath(route)) ? 'id' : 'projectId';
}

function firstParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

/**
 * The job the current URL names. `?projectId=` counts on every route; `?id=`
 * only on the routes that use it for a PROJECT — on /invoice or /rfi an `id`
 * could be anything, and reading it as a job would point the sidebar at an
 * invoice id.
 */
export function urlProjectIdFrom(
  pathname: string,
  params: { projectId?: string | string[]; id?: string | string[] },
): string | null {
  const byProjectId = firstParam(params.projectId);
  if (byProjectId) return byProjectId;
  if (ID_PARAM_ROUTES.has(normalizeRoutePath(pathname))) return firstParam(params.id);
  return null;
}

/** A destination as plain data — the sidebar turns it into an Href. Generic
 *  over the path type so a caller that passes typed-route literals gets typed
 *  routes back (no cast at the call site), while bun can still run it. */
export interface JobTarget<P extends string = string> {
  pathname: P;
  params?: Record<string, string>;
}

/**
 * Where a sidebar row goes, given the active job.
 *
 *   * no active job              → the bare route (the screen's own picker
 *                                  asks, exactly as before this wave);
 *   * `jobRoute` set             → that route, carrying the job (the one row
 *                                  whose job-scoped home differs from its
 *                                  global one: Schedule's on-ramp ignores the
 *                                  job, the schedule tab honours `projectId`);
 *   * registry `projectScoped`   → the route, carrying the job under the param
 *                                  that screen reads (`id` on
 *                                  client-portal-setup, `projectId` elsewhere);
 *   * anything else              → the bare route. A global screen given a
 *                                  `projectId` it never reads would look
 *                                  job-scoped in the URL and not be.
 */
export function jobScopedTarget<P extends string>(
  route: P,
  opts: { projectScoped: boolean; jobRoute?: P; activeProjectId: string | null },
): JobTarget<P> {
  const id = opts.activeProjectId;
  if (!id) return { pathname: route };
  if (opts.jobRoute) return { pathname: opts.jobRoute, params: { [projectParamFor(opts.jobRoute)]: id } };
  if (!opts.projectScoped) return { pathname: route };
  return { pathname: route, params: { [projectParamFor(route)]: id } };
}

/**
 * Where picking `projectId` in the job switcher goes. On a project tool — a
 * key of `stay`, which maps a group-free path to the route to push — it stays
 * on that tool and swaps the job; anywhere else it opens the job's Overview
 * (project-detail). Pure because "stay on the tool" quietly becoming "go to
 * Overview" is invisible in review and obvious in a validator.
 */
export function jobSwitchTarget<P extends string>(
  currentPath: string,
  projectId: string,
  stay: ReadonlyMap<string, P>,
): JobTarget<P | '/project-detail'> {
  const route = stay.get(normalizeRoutePath(currentPath));
  if (route) return { pathname: route, params: { [projectParamFor(route)]: projectId } };
  return { pathname: '/project-detail', params: { id: projectId } };
}

// ── Stamped storage ─────────────────────────────────────────────────────────
// Every value is written with the user id it belongs to and read back only for
// that user. The prefix sweep already clears these keys on sign-out; the stamp
// is the second lock, for the window the sweep cannot cover (a crash between
// the new session and the wipe, a sweep that threw). "It must never show
// another account's job" should not rest on one mechanism.

export function stampActive(uid: string, id: string | null): string {
  return JSON.stringify({ uid, id });
}

export function stampRecent(uid: string, ids: readonly string[]): string {
  return JSON.stringify({ uid, ids });
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The stored active id, or null when absent, malformed, or another user's. */
export function readStampedActive(raw: string | null, uid: string | null): string | null {
  const o = parseObject(raw);
  if (!o || !uid || o.uid !== uid) return null;
  return typeof o.id === 'string' && o.id.length > 0 ? o.id : null;
}

/** The stored MRU, or [] when absent, malformed, or another user's. */
export function readStampedRecent(raw: string | null, uid: string | null): string[] {
  const o = parseObject(raw);
  if (!o || !uid || o.uid !== uid || !Array.isArray(o.ids)) return [];
  const out: string[] = [];
  for (const id of o.ids) {
    if (typeof id === 'string' && id.length > 0 && !out.includes(id)) out.push(id);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
}

/** Sidebar group open-state, sanitized: only boolean values survive, so a
 *  hand-edited or corrupted value cannot throw inside render. */
export function parseSectionState(raw: string | null): Record<string, boolean> {
  const o = parseObject(raw);
  const out: Record<string, boolean> = {};
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) if (typeof v === 'boolean') out[k] = v;
  return out;
}
