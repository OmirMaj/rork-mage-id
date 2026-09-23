// utils/projectStage.ts — ONE name for where a job is in its life.
//
// PURE: no React, no react-native import (bun-executable; see
// scripts/validate-desktop-workspace.ts).
//
// WHY THIS EXISTS. The web-PM audit (wave 6b, plan.bugs "Stage names disagree")
// found the same word meaning two different jobs:
//
//   • the job page (app/project-detail.tsx, LIFECYCLE_STAGES + statusToStage)
//     calls status 'completed' "Post-Con" and status 'closed' "Closeout";
//   • Home (app/(tabs)/(home)/index.tsx, STATUS_FILTER_LABEL + statusBuckets)
//     calls status 'completed' "Closeout" and status 'closed' "Closed";
//   • the project row (components/ProjectRow.tsx STATUS_LABEL) says
//     "Completed" / "Closed".
//
// So a GC who taps "Closeout" on Home sees his finished-but-not-closed jobs,
// opens one, and the job page tells him it is in "Post-Con" — and the job he
// actually closed says "Closeout". This module is the single mapping; screens
// adopt it in wave 6c (nothing imports it yet).
//
// THE CANONICAL STAGES are the job page's four lifecycle names — the names the
// web-PM audit's fix specifies (STAGE_LABEL "Pre-Con / Construction / Post-Con
// / Closeout", Home chips "Pre-Con · Construction · Post-Con · Closeout · All")
// and the ones the 6c job stepper and Home chips are laid out with:
//   precon        draft, estimated   Pre-Con       bidding / pre-construction
//   construction  in_progress        Construction  on site
//   postcon       completed          Post-Con      work done; punch, docs, billing
//   closeout      closed             Closeout      closed out and filed
// So the job page (and its phone stepper) keeps every word it shows today, and
// Home is the screen that moves: its "Closeout" chip becomes "Post-Con" and its
// "Closed" chip becomes "Closeout". A saved Home filter key is translated by
// migrateStageKey(key, 'home-filter') so a GC's remembered chip still selects
// the same jobs.

/** Project.status (types/index.ts Project['status']) — repeated here as a
 *  string union so this file stays import-free and bun-executable. */
export type ProjectStatus = 'draft' | 'estimated' | 'in_progress' | 'completed' | 'closed';

export type ProjectStage = 'precon' | 'construction' | 'postcon' | 'closeout';

/** Lifecycle order — the job page's stage track draws these left to right. */
export const PROJECT_STAGES: readonly ProjectStage[] = ['precon', 'construction', 'postcon', 'closeout'];

export interface StageLabels {
  /** Chips, headings, filters, the stepper — one word per stage, everywhere. */
  label: string;
  /** The compact stepper on a phone — the job page's own short forms today
   *  (app/project-detail.tsx LIFECYCLE_STAGES), so adopting this keeps the
   *  iPhone stepper identical. */
  short: string;
}

export const STAGE_LABELS: Readonly<Record<ProjectStage, StageLabels>> = {
  precon:       { label: 'Pre-Con',      short: 'Pre' },
  construction: { label: 'Construction', short: 'Con' },
  postcon:      { label: 'Post-Con',     short: 'Post' },
  closeout:     { label: 'Closeout',     short: 'Done' },
};

/** Finer than a stage only where the stage hides a real difference (a draft
 *  is not yet priced); past that, a status reads as its stage name, so a row
 *  badge can never contradict the chip it was filtered by. */
export const STATUS_LABELS: Readonly<Record<ProjectStatus, string>> = {
  draft: 'Draft',
  estimated: 'Estimated',
  in_progress: STAGE_LABELS.construction.label,
  completed: STAGE_LABELS.postcon.label,
  closed: STAGE_LABELS.closeout.label,
};

const STATUS_TO_STAGE: Readonly<Record<ProjectStatus, ProjectStage>> = {
  draft: 'precon',
  estimated: 'precon',
  in_progress: 'construction',
  completed: 'postcon',
  closed: 'closeout',
};

/** The status a stage lands on when he ADVANCES a job to it (the most settled
 *  status in that stage — the job page's STAGE_TO_STATUS rule). */
export const STAGE_TO_STATUS: Readonly<Record<ProjectStage, Exclude<ProjectStatus, 'draft'>>> = {
  precon: 'estimated',
  construction: 'in_progress',
  postcon: 'completed',
  closeout: 'closed',
};

export function isProjectStatus(s: unknown): s is ProjectStatus {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(STATUS_TO_STAGE, s);
}

/** The stage for a status. Unknown / missing → precon (a job with no status
 *  has not started; the job page's statusToStage made the same call). */
export function stageForStatus(status: string | null | undefined): ProjectStage {
  return isProjectStatus(status) ? STATUS_TO_STAGE[status] : 'precon';
}

export function stageLabel(stage: ProjectStage): string {
  return STAGE_LABELS[stage].label;
}

export function statusLabel(status: string | null | undefined): string {
  return isProjectStatus(status) ? STATUS_LABELS[status] : STATUS_LABELS.draft;
}

/** Statuses in a stage — what a stage filter keeps. */
export function statusesInStage(stage: ProjectStage): ProjectStatus[] {
  return (Object.keys(STATUS_TO_STAGE) as ProjectStatus[]).filter((s) => STATUS_TO_STAGE[s] === stage);
}

/** Home's filter: 'all' or one stage. */
export type StageFilter = 'all' | ProjectStage;

export function projectInStageFilter(status: string | null | undefined, filter: StageFilter): boolean {
  return filter === 'all' || stageForStatus(status) === filter;
}

/**
 * Old stage/filter keys → canonical, for the one-time migration of anything
 * saved under the old names (and for reading deep links written before 6c).
 *
 *   Job-page keys (app/project-detail LifecycleStage) — `from: 'job-page'`:
 *     precon, construction, postcon, closeout are already canonical.
 *   Home filter keys (utils/projectClone HomeStatusFilter) — `from: 'home-filter'`:
 *     all, precon keep their meaning; active → construction; Home's
 *     'closeout' (status completed) → postcon; Home's 'closed' → closeout.
 *
 * The same word 'closeout' maps differently by SOURCE, which is exactly the
 * bug — so the caller must say where the key came from. Unknown → null.
 */
export function migrateStageKey(key: string | null | undefined, from: 'home-filter' | 'job-page'): StageFilter | null {
  if (typeof key !== 'string') return null;
  if (from === 'job-page') {
    switch (key) {
      case 'precon': return 'precon';
      case 'construction': return 'construction';
      case 'postcon': return 'postcon';
      case 'closeout': return 'closeout';
      default: return null;
    }
  }
  switch (key) {
    case 'all': return 'all';
    case 'precon': return 'precon';
    case 'active': return 'construction';
    case 'closeout': return 'postcon';
    case 'closed': return 'closeout';
    default: return null;
  }
}
