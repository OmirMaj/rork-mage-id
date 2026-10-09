// utils/demoJob/marker.ts — what makes a project THE Demo Job (pure).
//
// ONE MARKER, read through ONE helper: `isDemoProject(project)`.
//
// The marker is the project's NAME: it starts with the app's existing sample
// prefix ('Sample — ', utils/projectCap) followed by 'Demo: '. The sample
// prefix is the fence the app and the server already enforce (no email to a
// client, no pay link, no payment reminder, no portal, no QuickBooks push, no
// slot of the free plan's cap: utils/sampleGuard.ts), so the demo inherits
// every one of them without a migration. The 'Demo: ' part is what tells this
// job from the tutorials' small samples, and it is what the learning and
// reporting paths test so a $23M made-up job can never teach the cost book.
//
// A second signal keeps the answer true if the job is ever renamed:
// `leadSource` is stamped DEMO_LEAD_SOURCE at creation and is not editable on
// any screen. Either signal makes a project a demo.
//
// Pure: no React, no storage. utils/costDatabase, utils/analytics and the
// other excluded paths import this file and nothing else from utils/demoJob.
import { SAMPLE_PROJECT_PREFIX } from '@/utils/projectCap';

export const DEMO_NAME_TAG = 'Demo: ';
export const DEMO_PROJECT_TITLE = 'Demo: Harbor Point Mixed-Use';
/** 'Sample — Demo: Harbor Point Mixed-Use'. */
export const DEMO_PROJECT_NAME = `${SAMPLE_PROJECT_PREFIX}${DEMO_PROJECT_TITLE}`;
export const DEMO_LEAD_SOURCE = 'mage_demo_job';

type MaybeDemo = { name?: string | null; leadSource?: string | null } | null | undefined;

/** True when `project` is the owner's Demo Job. */
export function isDemoProject(project: MaybeDemo): boolean {
  if (!project) return false;
  if (project.leadSource === DEMO_LEAD_SOURCE) return true;
  return typeof project.name === 'string' && project.name.startsWith(`${SAMPLE_PROJECT_PREFIX}${DEMO_NAME_TAG}`);
}

/** True when a bare project name is the Demo Job's (time entries carry only the name). */
export function isDemoProjectName(name: string | null | undefined): boolean {
  return isDemoProject({ name });
}

// ── Which ids are the demo's (for readers that are handed ids, not projects) ──
//
// Module state, replaced wholesale on every update (the same shape as
// utils/sampleGuard's registry), so a sign-out empties it.

let demoProjectIds: ReadonlySet<string> = new Set();

/** Replace the registry from the current project list (ProjectContext's effect). */
export function noteDemoScope(projects: readonly { id: string; name?: string | null; leadSource?: string | null }[]): void {
  const next = new Set<string>();
  for (const p of projects) if (isDemoProject(p)) next.add(p.id);
  demoProjectIds = next;
}

/** Add one id now (the builder, before its first write, so the very first event is already known). */
export function noteDemoProjectId(projectId: string): void {
  if (!projectId || demoProjectIds.has(projectId)) return;
  demoProjectIds = new Set(demoProjectIds).add(projectId);
}

export function isKnownDemoProjectId(projectId: string | null | undefined): boolean {
  return !!projectId && demoProjectIds.has(projectId);
}

/** The ids in `projects` that are demo jobs. */
export function demoProjectIdSet(projects: readonly { id: string; name?: string | null; leadSource?: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const p of projects) if (isDemoProject(p)) out.add(p.id);
  return out;
}

/** `rows` without the ones that belong to a demo project. */
export function withoutDemoRows<T extends { projectId?: string | null }>(rows: readonly T[], demoIds: ReadonlySet<string>): T[] {
  if (demoIds.size === 0) return rows as T[];
  return rows.filter((r) => !r.projectId || !demoIds.has(r.projectId));
}

/** `projects` without the demo jobs. */
export function withoutDemoProjects<T extends { name?: string | null; leadSource?: string | null }>(projects: readonly T[]): T[] {
  return projects.some((p) => isDemoProject(p)) ? projects.filter((p) => !isDemoProject(p)) : (projects as T[]);
}

/**
 * THE DEMO JOB KEEPS ITS NAME. Its name is the sample prefix every outbound
 * fence tests (no email to a client, no pay link, no reminder: utils/sampleGuard
 * and the server), so an edit that would take a demo job out of
 * 'Sample — Demo: ' is dropped, and so is one that would clear the second
 * marker. Everything else about the job can be edited. Any other project is
 * handed back untouched.
 */
export function demoSafeUpdates<T extends { name?: string | null; leadSource?: string | null }>(prior: MaybeDemo, updates: T): T {
  if (!isDemoProject(prior)) return updates;
  const renamesOut = typeof updates.name === 'string' && !isDemoProjectName(updates.name);
  const clearsMarker = 'leadSource' in updates && updates.leadSource !== DEMO_LEAD_SOURCE && prior?.leadSource === DEMO_LEAD_SOURCE;
  if (!renamesOut && !clearsMarker) return updates;
  const next = { ...updates };
  if (renamesOut) delete next.name;
  if (clearsMarker) delete next.leadSource;
  return next;
}
