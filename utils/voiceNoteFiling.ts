// ============================================================================
// utils/voiceNoteFiling.ts — where a voice note from the global mic goes
// (UX wave, A3 / A4 / A6).
//
// Three small jobs, all about "which project, which report":
//
//   1. voiceJobChips — the mic's project chips. The jobs he opened most
//      recently, the default first, and a "More…" list with every live job
//      (the old picker showed projectsList.slice(0, 4), so a fifth job could
//      not be picked at all).
//   2. voiceReportBase — the one report shape a voice note creates, shared by
//      the mic's online path and the offline filing below, so both write the
//      same record.
//   3. Filing a parked clip. A voice note recorded with no signal is queued
//      by utils/audioTranscribeQueue under `voice-note:<projectId>`. When its
//      transcript arrives, fileReadyVoiceNotes() takes it ONCE (takeTranscript
//      is the single-consumer guard: it removes the text from the queue in the
//      same locked step, so a second pass, a second device-open or the capture
//      sheet's own "Use it" can never file the same clip twice) and files it
//      with planVoiceLogWrite, using the RECORDED time — a note spoken
//      yesterday lands on yesterday's report, not today's.
//
// A clip whose project is gone from this phone, or closed, is never filed and
// never dropped: it stays in the queue and the backlog sheet says why.
//
// Pure except fileReadyVoiceNotes, whose every side effect is an injected
// dependency so scripts/validate-ux-lane-a.ts runs it under bun.
// ============================================================================

import type { DailyFieldReport, Project } from '@/types';
import { isDefaultableJob } from '@/utils/defaultProjectId';
import { sortJobsForPicker } from '@/utils/uxDoors';
import {
  planVoiceLogWrite, localDayKey, voiceLineStamp,
  type VoiceLogReport, type VoiceLogWrite,
} from '@/utils/dailyLogCompletion';
import {
  recordedAtMs, voiceClipState, voiceNoteProjectIdOf,
  type AudioTranscribeTask,
} from '@/utils/audioTranscribeCore';

type JobLike = Pick<Project, 'id' | 'name' | 'status' | 'updatedAt'>;

// ── 1. The mic's project chips ──────────────────────────────────────────────

export const VOICE_CHIP_MAX = 4;

export interface VoiceJobChipsInput<T extends JobLike> {
  projects: readonly T[];
  /** useActiveProject().recentProjectIds, most recent first. */
  recentProjectIds?: readonly string[] | null;
  /** pickDefaultProjectId(...) — may be null. */
  defaultId?: string | null;
  /** The chip he tapped in this open of the sheet, if any. */
  pickedId?: string | null;
  max?: number;
}

export interface VoiceJobChips<T extends JobLike> {
  /** At most `max` chips: his pick, the default, recent jobs, then the rest
   *  of the live jobs in picker order. Nothing here is preselected by virtue
   *  of being a chip — the caller preselects only pickedId ?? defaultId. */
  chips: T[];
  /** Every live job in picker order — the "More…" list. */
  all: T[];
  /** True when "More…" would show a job the chips do not. */
  hasMore: boolean;
}

export function voiceJobChips<T extends JobLike>(input: VoiceJobChipsInput<T>): VoiceJobChips<T> {
  const max = Math.max(1, input.max ?? VOICE_CHIP_MAX);
  const recent = (input.recentProjectIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0);
  const live = input.projects.filter(p => isDefaultableJob(p));
  const all = sortJobsForPicker(live, recent);
  const byId = new Map(all.map(p => [p.id, p] as const));
  const out: T[] = [];
  const seen = new Set<string>();
  const push = (id: string | null | undefined) => {
    if (!id || seen.has(id) || out.length >= max) return;
    const p = byId.get(id);
    if (!p) return;
    seen.add(id);
    out.push(p);
  };
  push(input.pickedId);
  push(input.defaultId);
  for (const id of recent) push(id);
  for (const p of all) push(p.id);
  return { chips: out, all, hasMore: all.some(p => !seen.has(p.id)) };
}

// ── 2. The report a voice note creates ──────────────────────────────────────

/** The full report base a voice note's `create` write spreads its seed over.
 *  `at` is the note's instant; its LOCAL day is the report's day. */
export function voiceReportBase(o: { id: string; projectId: string; at: number | Date; nowISO: string }): Omit<DailyFieldReport, 'workPerformed' | 'manpower' | 'materialsDelivered' | 'status'> {
  const at = o.at instanceof Date ? o.at : new Date(o.at);
  return {
    id: o.id,
    projectId: o.projectId,
    date: at.toISOString(),
    weather: { temperature: '', conditions: '', wind: '', isManual: true },
    issuesAndDelays: '',
    photos: [],
    createdAt: o.nowISO,
    updatedAt: o.nowISO,
  };
}

// ── 3. Filing parked voice notes ────────────────────────────────────────────

export type VoiceClipHold = 'project_missing' | 'project_closed';

export interface VoiceClipRow {
  task: AudioTranscribeTask;
  /** The project named by the clip's queue key; null for a form's own
   *  dictation (it goes back to that form, never to a report). */
  projectId: string | null;
  state: ReturnType<typeof voiceClipState>;
  /** Set when a READY voice note cannot be filed, with the reason. */
  hold: VoiceClipHold | null;
}

/** Why a ready voice note is still listed. Whole sentences. */
export function voiceClipHoldLine(hold: VoiceClipHold): string {
  return hold === 'project_missing'
    ? 'Its project is no longer on this phone, so it was not added to a report.'
    : 'Its project is closed, so it was not added to a report.';
}

export interface VoiceFilingInput {
  tasks: readonly AudioTranscribeTask[];
  ownUserId: string | null | undefined;
  projects: readonly Pick<Project, 'id' | 'status'>[];
  /** False during the cold-start window before the project list has loaded:
   *  nothing is filed and nothing is called missing. */
  projectsLoaded: boolean;
}

export interface VoiceFilingPlan {
  /** Every own clip, oldest recording first, with its state and hold. */
  rows: VoiceClipRow[];
  /** Ready voice notes to file now, oldest recording first. */
  toFile: { taskId: string; projectId: string; at: number }[];
}

/**
 * Which own clips can be filed now. Only READY clips recorded by the global
 * mic (`voice-note:<projectId>`) are filed; a form's dictation waits for its
 * form. A ready note for a project missing from this phone or closed is held
 * with the reason — never filed elsewhere, never dropped.
 */
export function planVoiceNoteFilings(input: VoiceFilingInput): VoiceFilingPlan {
  const own = input.ownUserId ? input.tasks.filter(t => t && t.userId === input.ownUserId) : [];
  const status = new Map(input.projects.map(p => [p.id, p.status] as const));
  const rows: VoiceClipRow[] = own
    .map(task => {
      const projectId = voiceNoteProjectIdOf(task.contextKey);
      const state = voiceClipState(task);
      let hold: VoiceClipHold | null = null;
      if (state === 'ready' && projectId && input.projectsLoaded) {
        if (!status.has(projectId)) hold = 'project_missing';
        else if (status.get(projectId) === 'closed') hold = 'project_closed';
      }
      return { task, projectId, state, hold };
    })
    .sort((a, b) => recordedAtMs(a.task) - recordedAtMs(b.task) || a.task.id.localeCompare(b.task.id));
  const toFile = input.projectsLoaded
    ? rows
      .filter(r => r.state === 'ready' && r.projectId && !r.hold && !!r.task.transcript)
      .map(r => ({ taskId: r.task.id, projectId: r.projectId as string, at: recordedAtMs(r.task) }))
    : [];
  return { rows, toFile };
}

/** "7:42 AM" today, "yesterday 7:42 AM", else "Sep 27 7:42 AM" — the time in
 *  the filing toast, so a note from yesterday says so. */
export function voiceNoteWhen(at: number, now: number): string {
  const stamp = voiceLineStamp(at);
  const day = localDayKey(at);
  const today = localDayKey(now);
  if (!day || !today || day === today) return stamp;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day === localDayKey(y)) return `yesterday ${stamp}`;
  const d = new Date(at);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${month} ${d.getDate()} ${stamp}`;
}

/** The toast after a parked note is filed. */
export function voiceNoteFiledLine(at: number, now: number, projectName: string): string {
  return `Voice note from ${voiceNoteWhen(at, now)} added to ${projectName}'s report`;
}

/** Apply a planned write to a working copy of the reports, so a second clip
 *  for the same project and day in the same pass appends to the report the
 *  first one created instead of creating another. */
export function applyVoiceLogWrite(
  reports: readonly VoiceLogReport[],
  write: VoiceLogWrite,
  created: VoiceLogReport | null,
): VoiceLogReport[] {
  if (write.kind === 'create') return created ? [created, ...reports] : [...reports];
  return reports.map(r => (r.id === write.reportId ? { ...r, ...write.patch } : r));
}

export interface VoiceFilingDeps {
  /** The persisted queue (the caller's own filter is applied here too). */
  readQueue: () => Promise<AudioTranscribeTask[]>;
  ownUserId: () => Promise<string | null>;
  /** audioTranscribeQueue.takeTranscript — removes the text in the same step. */
  takeTranscript: (id: string) => Promise<string | null>;
  projects: () => readonly Pick<Project, 'id' | 'name' | 'status'>[];
  reports: () => readonly VoiceLogReport[];
  addDailyReport: (report: DailyFieldReport) => void;
  updateDailyReport: (id: string, patch: Partial<DailyFieldReport>) => void;
  newId: () => string;
  now: () => number;
  toast: (message: string) => void;
}

export interface VoiceFilingResult {
  filed: number;
  held: number;
}

// One pass at a time: the mount, a reconnect, a foreground and the queue's
// change feed can all ask at once. The takeTranscript lock already makes a
// double file impossible; this only stops a pile-up of empty passes.
let filingInFlight: Promise<VoiceFilingResult> | null = null;

/** File every ready voice note that can be filed. Never throws. */
export function fileReadyVoiceNotes(deps: VoiceFilingDeps): Promise<VoiceFilingResult> {
  if (filingInFlight) return filingInFlight;
  filingInFlight = runFiling(deps)
    .catch(() => ({ filed: 0, held: 0 }))
    .finally(() => { filingInFlight = null; });
  return filingInFlight;
}

async function runFiling(deps: VoiceFilingDeps): Promise<VoiceFilingResult> {
  const ownUserId = await deps.ownUserId();
  if (!ownUserId) return { filed: 0, held: 0 };
  const projects = deps.projects();
  const plan = planVoiceNoteFilings({
    tasks: await deps.readQueue(),
    ownUserId,
    projects,
    projectsLoaded: projects.length > 0,
  });
  const held = plan.rows.filter(r => r.hold).length;
  let working: VoiceLogReport[] = [...deps.reports()];
  let filed = 0;
  for (const item of plan.toFile) {
    const project = projects.find(p => p.id === item.projectId);
    if (!project) continue;
    // The single consumer. null = someone else took it (the capture sheet's
    // "Use it", another pass) or it is gone — either way, not ours to file.
    const text = (await deps.takeTranscript(item.taskId))?.trim();
    if (!text) continue;
    const write = planVoiceLogWrite({ reports: working, projectId: item.projectId, at: item.at, line: text });
    let created: VoiceLogReport | null = null;
    if (write.kind === 'append') {
      deps.updateDailyReport(write.reportId, write.patch);
    } else {
      const nowISO = new Date(deps.now()).toISOString();
      const report: DailyFieldReport = {
        ...voiceReportBase({ id: deps.newId(), projectId: item.projectId, at: item.at, nowISO }),
        ...write.seed,
      };
      deps.addDailyReport(report);
      created = report;
    }
    working = applyVoiceLogWrite(working, write, created);
    filed++;
    deps.toast(voiceNoteFiledLine(item.at, deps.now(), project.name));
  }
  return { filed, held };
}

// ── Asking the mounted mic to file ──────────────────────────────────────────
//
// The filing pass needs the project list and the report writers, which only
// the always-mounted mic holds. The backlog sheet (opened from the sync pill)
// asks for a pass through this tiny signal after it has run the queue.

type FilingRequestListener = () => void;
const filingRequestListeners = new Set<FilingRequestListener>();

export function onVoiceNoteFilingRequested(listener: FilingRequestListener): () => void {
  filingRequestListeners.add(listener);
  return () => { filingRequestListeners.delete(listener); };
}

export function requestVoiceNoteFiling(): void {
  for (const l of [...filingRequestListeners]) {
    try { l(); } catch {/* the listener's own failure */}
  }
}
