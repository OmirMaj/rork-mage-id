// ============================================================================
// utils/uxDoors.ts — the pure rules behind Lane D's doors (UX wave).
//
// "The doors" are the ways into a job's work: the + New… menu (CreateMenu),
// the job page's quick row (project-detail), the New Project form (Home) and
// the desktop sidebar. Their DECISIONS live here so a bun validator
// (scripts/validate-ux-doors.ts) can prove them without React:
//
//   - sortJobsForPicker   every job picker: live jobs first, the one he last
//                         touched on top, completed then closed at the bottom
//                         (D1: a closed job is never the top row);
//   - alwaysPicksJob      Estimate, Schedule and Scope Sheet ALWAYS ask which
//                         job, with "+ New job" first (D1: "+ > Estimate" for
//                         a new lead must not rewrite the live job's estimate);
//   - fieldGroupFirst     the + menu floats its Field group to the top before
//                         11 am on a weekday, or for the field role (D3);
//   - showsFieldRow       only a live (in_progress) job trades the office
//                         quick row for the field one (D2);
//   - clientFieldsProblem the New Project / edit-job client fields: optional,
//                         but a typed email or phone that cannot be used is
//                         said out loud rather than dropped (D4);
//   - combineRowCounts    the "More for this job" toggle carries the RFI and
//                         Submittal counts that moved behind it (D6).
//
// Pure: no React, no React Native, no storage. It imports only pure modules.
// ============================================================================

import type { Project } from '@/types';
import { isUsableEmail, isUsablePhone, seedClientEverywhere } from '@/utils/clientContact';
import { countPill, type RowCount } from '@/utils/sidebarCounts';

type JobLike = Pick<Project, 'id' | 'status' | 'updatedAt'>;

/** 0 = a job still being priced or built; 1 = completed; 2 = closed. */
export function pickerRank(status: Project['status'] | string | undefined): number {
  if (status === 'closed') return 2;
  if (status === 'completed') return 1;
  return 0;
}

/**
 * The order every job picker lists jobs in. Open jobs first; inside a rank,
 * the jobs he opened most recently (recentProjectIds order) lead, then the
 * rest by last update, newest first. Completed jobs follow, closed jobs last.
 * Stable for ties (the input order decides). Never drops or adds a job.
 */
export function sortJobsForPicker<T extends JobLike>(projects: readonly T[], recentProjectIds: readonly string[] = []): T[] {
  const recentIdx = new Map<string, number>();
  recentProjectIds.forEach((id, i) => { if (!recentIdx.has(id)) recentIdx.set(id, i); });
  const time = (p: JobLike) => {
    const t = Date.parse(p.updatedAt ?? '');
    return Number.isFinite(t) ? t : 0;
  };
  return projects
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const r = pickerRank(a.p.status) - pickerRank(b.p.status);
      if (r !== 0) return r;
      const ra = recentIdx.get(a.p.id);
      const rb = recentIdx.get(b.p.id);
      if (ra !== undefined || rb !== undefined) {
        if (ra === undefined) return 1;
        if (rb === undefined) return -1;
        if (ra !== rb) return ra - rb;
      }
      const t = time(b.p) - time(a.p);
      if (t !== 0) return t;
      return a.i - b.i;
    })
    .map(x => x.p);
}

/** The + menu rows that always show the job picker, "+ New job" first. */
export const ALWAYS_PICK_JOB_LABELS: readonly string[] = ['Estimate', 'Schedule', 'Scope Sheet'];

export function alwaysPicksJob(label: string): boolean {
  return ALWAYS_PICK_JOB_LABELS.includes(label);
}

/** What the "+ New job" row asks Home to chain to once the job exists:
 *  the estimate wizard, or the schedule wizard. Scope Sheet needs an estimate
 *  first, so it lands on Home's usual next-step sheet (no chain). */
export type NewJobThen = 'estimate' | 'schedule';

export function newJobThenFor(label: string): NewJobThen | null {
  if (label === 'Estimate') return 'estimate';
  if (label === 'Schedule') return 'schedule';
  return null;
}

/** Home's `?then=` param, read strictly: anything unknown is no chain. */
export function readNewJobThen(v: string | string[] | undefined | null): NewJobThen | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s === 'estimate' || s === 'schedule' ? s : null;
}

/** The hour (local, 24 h) before which a weekday counts as "morning on site". */
export const FIELD_MORNING_END_HOUR = 11;

/**
 * Float the + menu's Field group to the top: before 11 am Monday–Friday
 * (local time), or whenever the job he is creating for gives him the field
 * role. Saturday and Sunday mornings are not floated: the rule is about the
 * crew's working morning, and a weekend visit is the exception, not the rule.
 */
export function fieldGroupFirst(now: Date, role: string | null | undefined): boolean {
  if (role === 'field') return true;
  const day = now.getDay(); // 0 Sunday … 6 Saturday
  if (day === 0 || day === 6) return false;
  return now.getHours() < FIELD_MORNING_END_HOUR;
}

/** The + menu's Money rows are hidden from the field role (canViewFinancials
 *  blinds it from money): when the job he is creating for makes him field, or,
 *  with no default job, when EVERY job he could pick makes him field. A known
 *  default job decides alone. An owner with no jobs yet (empty list) still
 *  sees them. */
export function moneyRowsHidden(defaultRole: string | null | undefined, jobRoles: readonly (string | null | undefined)[]): boolean {
  if (defaultRole) return defaultRole === 'field';
  return jobRoles.length > 0 && jobRoles.every(r => r === 'field');
}

/** Only a live job trades the office quick row for the field one. Draft and
 *  estimated jobs keep This Week / Cash Flow / Estimate / Schedule / Forecast. */
export function showsFieldRow(status: Project['status'] | string | undefined): boolean {
  return status === 'in_progress';
}

export interface ClientFieldsInput {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Why the optional client fields cannot be saved as typed, or null.
 * Blank is fine (the fields are optional). A typed email without a usable
 * address, or a typed phone with fewer than 7 digits, is a problem to say —
 * seedClientEverywhere would quietly drop it, and he would think the client
 * was on file when the contract email later has nobody to go to.
 */
export function clientFieldsProblem(input: ClientFieldsInput): string | null {
  const email = (input.email ?? '').trim();
  const phone = (input.phone ?? '').trim();
  if (email && !isUsableEmail(email)) return "That client email doesn't look complete. Fix it or clear it; the other details save either way.";
  if (phone && !isUsablePhone(phone)) return 'That client phone number is too short. Fix it or clear it; the other details save either way.';
  return null;
}

type Contact = NonNullable<Project['primaryContact']>;

/**
 * The job's client after the New Project form or the edit-job sheet.
 * Written THROUGH seedClientEverywhere (Lane 0's one write path for "the
 * client is on the job"): a typed field is merged in, never invented. The
 * edit sheet shows what is on file, so a field he CLEARS there is removed —
 * seedClientEverywhere alone never erases, and a cleared email that quietly
 * stayed on file would be the next contract's recipient without his knowing.
 * Only name / email / phone are touched; any other key on file is kept.
 * The portal is never touched here (portalBeingEnabled: false).
 *
 * Returns `changed: false` when the result equals what is on file. `next` is
 * undefined when nothing is left (the column is then written as null).
 */
export function editedPrimaryContact(
  prev: Contact | null | undefined,
  typed: ClientFieldsInput,
): { changed: boolean; next: Contact | undefined } {
  const seeded = seedClientEverywhere(
    { primaryContact: prev ?? undefined, clientPortal: undefined },
    typed,
    { portalBeingEnabled: false, newId: () => '', nowIso: '' },
  ).primaryContact ?? { ...(prev ?? {}) };
  const next: Contact = { ...seeded };
  for (const k of ['name', 'email', 'phone'] as const) {
    if (!(typed[k] ?? '').trim()) delete next[k];
  }
  const norm = (c: Contact | null | undefined) => JSON.stringify(
    Object.keys(c ?? {}).sort().map(k => [k, (c as Record<string, unknown>)[k]]),
  );
  const empty = Object.keys(next).length === 0;
  const changed = norm(empty ? undefined : next) !== norm(prev && Object.keys(prev).length ? prev : undefined);
  return { changed, next: empty ? undefined : next };
}

/** True when any client field has something typed in it. */
export function hasClientInput(input: ClientFieldsInput): boolean {
  return [input.name, input.phone, input.email].some(v => (v ?? '').trim().length > 0);
}

/**
 * One count for a toggle that hides several counted rows (D6: RFIs and
 * Submittals moved behind "More for this job"). Only rows that carry a count
 * contribute; with none, undefined — never a 0. The alert (overdue RFIs, late
 * submittals) adds up and keeps the red dot; the label spells each part.
 */
export function combineRowCounts(parts: readonly (RowCount | undefined)[], words: readonly string[]): RowCount | undefined {
  let open = 0;
  let alert = 0;
  const bits: string[] = [];
  parts.forEach((c, i) => {
    if (!c) return;
    open += c.open;
    alert += c.alert;
    bits.push(`${words[i] ?? ''} ${c.label}`.trim());
  });
  if (!(open > 0)) return undefined;
  return { open, alert, pill: countPill(open), label: bits.join('; ') };
}
