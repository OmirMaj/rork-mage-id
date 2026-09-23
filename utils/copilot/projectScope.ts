// utils/copilot/projectScope.ts — which Copilot capabilities need a job, and
// whether the job he is on can run them. Pure (no React / RN) so a validator
// drives it over the whole intent table.
//
// WHY THIS EXISTS (#34). Home, the web sidebar and the hub open /copilot with
// no projectId. Every project-scoped capability then ran the whole interview —
// each answer a metered AI turn — and only apply() noticed: "No project for
// this RFI." The error screen's one button re-opened the mic, which led back to
// the same throw, and the draft was gone. The gate now runs in app/copilot.tsx
// BEFORE the shell mounts, so no metered turn can run without a job, and each
// capability's own apply() guard stays as the backstop.
import type { Project } from '@/types';
import type { CopilotCapabilityId } from './types';

/** The only capabilities that run with no job: they CREATE one (new_project)
 *  or come before one exists (lead). Everything else writes onto a project. */
export const PROJECT_FREE: ReadonlySet<CopilotCapabilityId> = new Set<CopilotCapabilityId>(['new_project', 'lead']);

/** Capabilities whose apply() draws against the job's linked estimate: the
 *  schedule is generated from it and billing draws against it. Checked before
 *  the first AI turn, not at Build (#34). */
export const NEEDS_LINKED_ESTIMATE: ReadonlySet<CopilotCapabilityId> = new Set<CopilotCapabilityId>(['schedule', 'invoice']);

export function isProjectScoped(id: CopilotCapabilityId): boolean {
  return !PROJECT_FREE.has(id);
}

/** Jobs the picker offers: every job that is not closed, most recently
 *  touched first. Completed jobs stay — warranties, punch and final billing
 *  are logged on them. */
export function pickableProjects<P extends Pick<Project, 'id' | 'name' | 'status' | 'updatedAt'>>(projects: readonly P[] | null | undefined): P[] {
  const list = Array.isArray(projects) ? projects : [];
  return list
    .filter((p) => p && typeof p.id === 'string' && p.id && p.status !== 'closed')
    .map((p, i) => ({ p, i, t: Date.parse(p.updatedAt ?? '') }))
    .sort((a, b) => (Number.isFinite(b.t) ? b.t : -Infinity) - (Number.isFinite(a.t) ? a.t : -Infinity) || a.i - b.i)
    .map((x) => x.p);
}

export type CopilotPrecondition =
  | { ok: true }
  | { ok: false; kind: 'no_project'; message: string }
  | { ok: false; kind: 'no_estimate'; message: string };

/** Can this capability run on this job right now? Checked by the host before
 *  the interview starts and by the conversation hook to classify a Build
 *  failure, so both say the same thing. */
export function copilotPrecondition(
  id: CopilotCapabilityId,
  project: Pick<Project, 'linkedEstimate'> | null | undefined,
): CopilotPrecondition {
  if (!isProjectScoped(id)) return { ok: true };
  if (!project) return { ok: false, kind: 'no_project', message: 'Pick the job this is for first.' };
  if (NEEDS_LINKED_ESTIMATE.has(id) && !project.linkedEstimate) {
    return { ok: false, kind: 'no_estimate', message: 'This job has no estimate yet — build one first.' };
  }
  return { ok: true };
}

/** CARRY #53 (owner-only interim, permits-warranties lane): a warranty is kept
 *  on the project owner's account, so an invited PM / foreman is told why
 *  instead of running an interview whose Build would write it nowhere useful. */
export const WARRANTY_OWNER_ONLY_COPY = 'Warranties are kept on the project owner’s account — ask them to log it.';
