// crossProjectLoad.ts — is the SAME NAMED sub or crew standing on two different
// jobs on the same day?
//
// This is the scheduling failure a remodeler running five to eight concurrent
// jobs actually hits: the drywall sub is booked Monday on Henderson and Monday
// on Ridgeline. Both schedules render green, because each one is internally
// consistent, and the GC finds out when nobody shows up. Nothing in the repo
// could see it before this file: every resource check we had is scoped to ONE
// ProjectSchedule — utils/cpm's `levelResources` groups by `assignedSubId`
// within a schedule, and scheduleHealthScore's overload check and
// ResourceSwimlanes do the same. A per-project CPM engine cannot see a clash
// that only exists BETWEEN two schedules, no matter how good it is.
//
// NOT the same question as utils/judges/capacityLoad.ts. That one is an
// AGGREGATE: "am I booked solid in this window", summed as union-of-span
// coverage across all projects, resource-blind. It would say the same thing
// whether Monday belongs to one sub twice or to two different subs once. This
// file asks the NAMED-RESOURCE question, which is the one that leaves a crew
// missing from a jobsite.
//
// Pure over Project[] — no React, no storage, no I/O, no `new Date()` for
// anything but the caller's explicit window — so scripts/validate-cross-project-load.ts
// can run the real engine on constructed fixtures.

import type { Project, ScheduleTask } from '@/types';
// The CPM engine's own working-day predicate. taskWindow already uses it, so
// asking it here means the clash detector and the Gantt cannot disagree about
// which calendar days are workdays.
import { isWorkingDay } from '@/utils/cpm';
// Canonical task-window math (working-day aware). Its header documents why a
// private calendar-day copy is wrong: durations are WORKING-day counts while
// startDay is a CALENDAR index, so spanning one as the other ends a 20-day task
// four days early. capacityLoad had that bug and it flipped a signal.
import { taskWindow, type TaskWindowCalendar } from '@/utils/lastPlanner';
// The repo's single answer to "does this task put anyone on site at all" —
// it is false for a done task and for a 0-day milestone (an event, not work).
import { isTaskActiveOnScheduleDay } from '@/utils/scheduleOps';

const DAY_MS = 86_400_000;

export type ResourceKind = 'sub' | 'crew';

/** One job's claim on a resource for one day. */
export interface ClashJob {
  projectId: string;
  projectName: string;
  /** One task to NAME in a warning — the lowest task id, so prose is stable. */
  taskId: string;
  taskTitle: string;
  /**
   * EVERY task on this job that books the resource that day, not just the one
   * named above. `taskId` alone was a partial answer and `clashesForTask` was
   * built on it: with "Hang drywall" and "Tape drywall" both assigned to Ace on
   * Monday, only one of the two boxes refused to commit and the other promised
   * Ace to a second job in silence — the exact failure this module exists to
   * stop, reintroduced by the lookup in front of it.
   */
  taskIds: string[];
}

/** One named resource, one calendar day, two or more jobs. */
export interface CrossProjectClash {
  /** `sub:<id>` or `crew:<lowercased name>` — see `resourceOf` on identity. */
  resourceKey: string;
  resourceKind: ResourceKind;
  /** Human name for the resource. Falls back to the raw sub id if nothing better exists. */
  resourceLabel: string;
  /** The contested day, ISO yyyy-mm-dd. */
  dateISO: string;
  /** UTC midnight of `dateISO`. */
  dayMs: number;
  /** The competing jobs — always 2+, one entry per project, sorted by name. */
  jobs: ClashJob[];
}

export interface CrossProjectLoadOptions {
  /** Inclusive first calendar day of the window, yyyy-mm-dd. */
  startISO: string;
  /** Inclusive last calendar day of the window, yyyy-mm-dd. */
  endISO: string;
  /**
   * Optional sub-directory lookup so a `sub:` key can be labelled with the
   * company name instead of a uuid. A plain function keeps this module pure —
   * callers pass `getSubcontractor(id)?.companyName`.
   */
  resolveSubName?: (subId: string) => string | null | undefined;
}

// ── Identity: what counts as "the same resource" ─────────────────────────────
//
// WHAT WE MATCH:
//   • `assignedSubId` — the same sub record referenced from two projects. Exact
//     id equality. This is the reliable case and the one the app steers toward.
//   • `crew` — free text, trimmed and lowercased. Deliberately the SAME key
//     shape utils/cpm's `resourceKey` uses (`sub:` / `crew:` prefixes), so
//     intra-project leveling and this cross-project detector cannot disagree
//     about what one resource is.
//
// WHAT WE DELIBERATELY DO NOT MATCH — do not read a guarantee into this:
//   • Crew names that differ by spelling, abbreviation or suffix. "Ace Drywall",
//     "Ace Drywall LLC" and "ace dwl" are three resources here, and a real
//     double-booking spelled two ways is MISSED. That is the direction we chose
//     to be wrong in on purpose: the last-planner surface BLOCKS a commitment on
//     this signal, and a fuzzy match that wrongly fuses two different crews
//     blocks work the GC could legitimately have done. A warning that cries wolf
//     gets trained away, and then it is worth nothing on the day it is right.
//   • A `crew` string against a sub id or a sub's company name. If Henderson
//     assigns sub id `s1` and Ridgeline types "Ace Drywall" by hand, they are
//     two resources. Assign the sub on both jobs and the clash appears.
//   • Crew SIZE / a sub who can field two crews. One named resource on two jobs
//     on one day is reported, full stop. The human decides whether they can
//     actually split — which is why the block has an explicit override.

/** A resource's claim on one day from one job, while it is being accumulated. */
interface DayClaim {
  projectId: string;
  projectName: string;
  taskIds: Set<string>;
}

interface ResourceRef {
  key: string;
  kind: ResourceKind;
  label: string;
  /** True when `label` is only the raw id — a better label from another project wins. */
  labelIsFallback: boolean;
}

function resourceOf(
  task: ScheduleTask,
  resolveSubName?: CrossProjectLoadOptions['resolveSubName'],
): ResourceRef | null {
  const subId = task.assignedSubId?.trim();
  if (subId) {
    const named = resolveSubName?.(subId)?.trim() || task.assignedSubName?.trim() || task.crew?.trim() || '';
    return { key: `sub:${subId}`, kind: 'sub', label: named || subId, labelIsFallback: !named };
  }
  const crew = task.crew?.trim();
  if (crew) return { key: `crew:${crew.toLowerCase()}`, kind: 'crew', label: crew, labelIsFallback: false };
  return null;
}

// ── Date helpers (UTC midnight, matching lastPlanner + cpm) ──────────────────

function utcMidnight(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isoFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The Monday-anchored 7-day window a weekly surface asks about. */
export function weekWindow(mondayISO: string): { startISO: string; endISO: string } {
  const start = utcMidnight(mondayISO);
  if (start === null) return { startISO: mondayISO, endISO: mondayISO };
  return { startISO: isoFromMs(start), endISO: isoFromMs(start + 6 * DAY_MS) };
}

// ── The engine ───────────────────────────────────────────────────────────────

/**
 * Every day inside [startISO, endISO] where one named resource is claimed by
 * two or more DIFFERENT projects.
 *
 * Two tasks on the SAME project never produce a clash here even when they
 * overlap — that is intra-project resource contention and utils/cpm's
 * `levelResources` already owns it. Reporting it twice would put a blocking
 * warning in front of a problem the schedule screen can actually fix.
 *
 * Projects with no schedule, no tasks, or no `startDate` are skipped: an
 * undated schedule's day numbers are real but its calendar dates are not
 * (utils/scheduleOps' anchor rule), so it cannot honestly be placed opposite
 * another job's Monday.
 */
export function findCrossProjectClashes(
  projects: Project[],
  opts: CrossProjectLoadOptions,
): CrossProjectClash[] {
  const winStart = utcMidnight(opts.startISO);
  const winEnd = utcMidnight(opts.endISO);
  if (winStart === null || winEnd === null || winEnd < winStart) return [];

  // resourceKey → dayMs → projectId → the claim
  const claims = new Map<string, Map<number, Map<string, DayClaim>>>();
  const refs = new Map<string, ResourceRef>();
  // `<projectId>|<taskId>` → title, so the representative task can be named
  // without carrying a title through every day of every claim.
  const tasksById = new Map<string, string>();

  for (const p of projects ?? []) {
    if (!p) continue;
    // A finished or unstarted job books nobody. Same exclusions capacityLoad uses.
    if (p.status === 'completed' || p.status === 'closed' || p.status === 'draft') continue;
    const sched = p.schedule;
    if (!sched || !Array.isArray(sched.tasks) || sched.tasks.length === 0) continue;
    const anchorIso = sched.startDate?.slice(0, 10);
    const baseMs = utcMidnight(anchorIso);
    if (!anchorIso || baseMs === null) continue;

    // Each project brings its OWN calendar — a 6-day sub and a Mon–Fri GC do
    // not occupy the same span for the same duration.
    const calendar: TaskWindowCalendar = {
      workingDaysPerWeek: sched.workingDaysPerWeek,
      nonWorkingDates: sched.nonWorkingDates,
    };
    const wdpw = sched.workingDaysPerWeek ?? 7;
    const closures = new Set(sched.nonWorkingDates ?? []);

    for (const task of sched.tasks) {
      if (!task || task.isSummary) continue; // a summary bar is a rollup, nobody is on site for it
      const ref = resourceOf(task, opts.resolveSubName);
      if (!ref) continue;
      // Done work and 0-day milestones put nobody on site. Asked on the task's
      // own first day so the answer is about the task, not about a date.
      if (!isTaskActiveOnScheduleDay(task, Math.max(1, task.startDay ?? 1))) continue;

      const win = taskWindow(task, anchorIso, calendar);
      if (!win) continue;
      tasksById.set(`${p.id}|${task.id}`, task.title);

      // Walk WHOLE DAY OFFSETS from this project's anchor, not raw milliseconds.
      // Two jobs only ever meet because their claims land on the same map key,
      // and that holds only while every key is an exact UTC midnight. Every
      // anchor is one; a task offset is one too, right up until some startDay
      // arrives as 1.5 (nothing in the type or the importers forbids it) — then
      // this task's claims key at noon, no other job's midnight claim can ever
      // meet them, and the double-booking vanishes silently instead of loudly.
      // Indexing the walk makes the shared grid structural rather than lucky.
      const startIdx = Math.round((win.startMs - baseMs) / DAY_MS);
      const endIdx = Math.round((win.endMs - baseMs) / DAY_MS);
      const fromIdx = Math.max(startIdx, Math.ceil((winStart - baseMs) / DAY_MS));
      const toIdx = Math.min(endIdx, Math.floor((winEnd - baseMs) / DAY_MS));
      for (let idx = fromIdx; idx <= toIdx; idx++) {
        // The span reaches ACROSS closed days (a Fri–Mon task on a 5-day week
        // spans four calendar days but works two). Nobody is double-booked on a
        // day nobody works, so the interior weekend must be dropped here.
        if (!isWorkingDay(idx + 1, wdpw, anchorIso, closures)) continue;
        const ms = baseMs + idx * DAY_MS;

        let byDay = claims.get(ref.key);
        if (!byDay) { byDay = new Map(); claims.set(ref.key, byDay); }
        let byProject = byDay.get(ms);
        if (!byProject) { byProject = new Map(); byDay.set(ms, byProject); }
        const existing = byProject.get(p.id);
        if (!existing) {
          byProject.set(p.id, { projectId: p.id, projectName: p.name, taskIds: new Set([task.id]) });
        } else {
          existing.taskIds.add(task.id);
        }
      }

      const known = refs.get(ref.key);
      // Prefer a real name over a bare uuid, whichever project supplies it —
      // then break a tie on the name itself. Two jobs can stamp DIFFERENT
      // `assignedSubName` values for one sub id (the field is a copy taken when
      // the sub was assigned, not a live join), and "first project wins" made
      // the crew rename itself on the Summary strip depending on which project
      // happened to load first.
      if (!known
        || (known.labelIsFallback && !ref.labelIsFallback)
        || (known.labelIsFallback === ref.labelIsFallback && ref.label < known.label)) {
        refs.set(ref.key, ref);
      }
    }
  }

  const out: CrossProjectClash[] = [];
  for (const [key, byDay] of claims) {
    const ref = refs.get(key);
    if (!ref) continue;
    for (const [dayMs, byProject] of byDay) {
      if (byProject.size < 2) continue; // one job = no clash; that is just work
      const jobs: ClashJob[] = Array.from(byProject.values())
        .map(claim => {
          const taskIds = Array.from(claim.taskIds).sort();
          const rep = tasksById.get(`${claim.projectId}|${taskIds[0]}`);
          return {
            projectId: claim.projectId,
            projectName: claim.projectName,
            taskId: taskIds[0],
            taskTitle: rep ?? taskIds[0],
            taskIds,
          };
        })
        .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.projectId.localeCompare(b.projectId));
      out.push({
        resourceKey: key,
        resourceKind: ref.kind,
        resourceLabel: ref.label,
        dateISO: isoFromMs(dayMs),
        dayMs,
        jobs,
      });
    }
  }
  return out.sort((a, b) => a.dayMs - b.dayMs || a.resourceLabel.localeCompare(b.resourceLabel) || a.resourceKey.localeCompare(b.resourceKey));
}

// ── Slices the surfaces need ─────────────────────────────────────────────────

/** Clashes that involve `projectId` — what one project's screen must warn about. */
export function clashesInvolving(clashes: CrossProjectClash[], projectId: string): CrossProjectClash[] {
  return clashes.filter(c => c.jobs.some(j => j.projectId === projectId));
}

/**
 * Clashes caused by one specific task — what gates one commit checkbox.
 *
 * Asks `taskIds`, not the representative `taskId`: a job can put the same sub
 * on a day with two tasks, and a gate that only knows about one of them lets
 * the other make the promise anyway.
 */
export function clashesForTask(
  clashes: CrossProjectClash[],
  projectId: string,
  taskId: string,
): CrossProjectClash[] {
  return clashes.filter(c => c.jobs.some(j => j.projectId === projectId && j.taskIds.includes(taskId)));
}

/** The jobs in a clash OTHER than `projectId` — the ones a warning has to name. */
export function otherJobs(clash: CrossProjectClash, projectId: string): ClashJob[] {
  return clash.jobs.filter(j => j.projectId !== projectId);
}

/** 'Mon, Sep 14' — UTC so a clash day never renames itself by timezone. */
export function formatClashDay(dateISO: string): string {
  const ms = utcMidnight(dateISO);
  if (ms === null) return dateISO;
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The one sentence a blocked commit owes the GC: who, where else, which day.
 * Written from `projectId`'s point of view — the other job is the news.
 */
export function describeClash(clash: CrossProjectClash, projectId: string): string {
  const others = otherJobs(clash, projectId);
  if (others.length === 0) return `${clash.resourceLabel} is double-booked on ${formatClashDay(clash.dateISO)}.`;
  return `${clash.resourceLabel} is already committed to ${joinPhrases(others.map(o => o.projectName))} on ${formatClashDay(clash.dateISO)}.`;
}

/** A natural-language list: 'Mon', 'Mon and Tue', 'Mon, Tue and Wed'. */
function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Everything ONE task's commit box owes the GC, grouped by the other job
 * rather than by the day.
 *
 * `describeClash` answers about a single day, and a card that called it once
 * per contested day printed four near-identical sentences for one sub booked
 * Monday through Thursday — the shape that teaches the eye to skim past the
 * warning. Worse, the screen-reader hint could only carry the FIRST of them, so
 * a blocked commit announced one day and hid the rest.
 */
export function describeClashes(clashes: CrossProjectClash[], projectId: string): string[] {
  // Keyed by RESOURCE and job, not job alone. One task has one resource, so the
  // caller that gates a checkbox never sees a mix — but this is exported, and a
  // caller passing `clashesInvolving` output would otherwise get one sentence
  // that names the drywall sub and the framer's days together.
  const byJob = new Map<string, { name: string; label: string; days: Set<string> }>();
  for (const c of clashes) {
    for (const other of otherJobs(c, projectId)) {
      const key = `${c.resourceKey}|${other.projectId}`;
      let entry = byJob.get(key);
      if (!entry) { entry = { name: other.projectName, label: c.resourceLabel, days: new Set() }; byJob.set(key, entry); }
      entry.days.add(c.dateISO);
    }
  }
  return Array.from(byJob.values())
    .sort((a, b) => a.name.localeCompare(b.name) || a.label.localeCompare(b.label))
    .map(e => `${e.label} is already committed to ${e.name} on ${joinPhrases(Array.from(e.days).sort().map(formatClashDay))}.`);
}

/** One resource's whole story in a window — what a summary strip shows per row. */
export interface ClashDigest {
  resourceKey: string;
  resourceKind: ResourceKind;
  resourceLabel: string;
  /** Distinct project names in conflict over this resource, sorted. */
  jobNames: string[];
  /** The contested days, ISO, ascending. */
  dateISOs: string[];
}

/**
 * Collapse per-day clashes into one row per resource. A sub double-booked
 * Monday through Thursday is ONE problem the GC has to solve, not four
 * warnings — four rows saying the same name is how a real signal gets skimmed
 * past.
 */
export function digestClashes(clashes: CrossProjectClash[]): ClashDigest[] {
  const byResource = new Map<string, { ref: CrossProjectClash; names: Set<string>; days: Set<string> }>();
  for (const c of clashes) {
    let entry = byResource.get(c.resourceKey);
    if (!entry) { entry = { ref: c, names: new Set(), days: new Set() }; byResource.set(c.resourceKey, entry); }
    for (const j of c.jobs) entry.names.add(j.projectName);
    entry.days.add(c.dateISO);
  }
  return Array.from(byResource.values())
    .map(e => ({
      resourceKey: e.ref.resourceKey,
      resourceKind: e.ref.resourceKind,
      resourceLabel: e.ref.resourceLabel,
      jobNames: Array.from(e.names).sort((a, b) => a.localeCompare(b)),
      dateISOs: Array.from(e.days).sort(),
    }))
    .sort((a, b) => (a.dateISOs[0] ?? '').localeCompare(b.dateISOs[0] ?? '') || a.resourceLabel.localeCompare(b.resourceLabel));
}

/** 'Mon' / 'Mon + Tue' / 'Mon + 3 more' — the day list for a one-line digest row. */
export function summarizeClashDays(dateISOs: string[]): string {
  if (dateISOs.length === 0) return '';
  // Sorted here, not assumed: this is exported, and "Wed + Mon" reads as a
  // typo. digestClashes already sorts, which is exactly why nothing would have
  // caught a second caller that does not.
  const days = [...dateISOs].sort();
  const label = (iso: string) => {
    const ms = utcMidnight(iso);
    return ms === null ? iso : new Date(ms).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  };
  if (days.length === 1) return label(days[0]);
  if (days.length === 2) return `${label(days[0])} + ${label(days[1])}`;
  return `${label(days[0])} + ${days.length - 1} more`;
}
