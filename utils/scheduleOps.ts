// scheduleOps.ts — higher-level operations on a schedule: reflow from
// actuals, named baselines, CSV export, share-link encode/decode.
//
// Keep each op pure (input → output). The caller commits via their own
// state manager / persist layer.

import type { ScheduleTask, ScheduleBaseline } from '@/types';

// ---------------------------------------------------------------------------
// 1) Reflow from actuals
// ---------------------------------------------------------------------------
// Philosophy: the plan is sacred until the PM says "reality is the plan now."
// This op takes the observed variance on each task with actuals and cascades
// it to downstream successors.
//
// Algorithm (simple & deterministic):
//   For each task with `actualStartDay` set:
//     delta = actualStartDay - baselineStartDay  (or startDay if no baseline)
//     If delta > 0, push every transitive successor's startDay by `delta` days
//       (unless that successor also already has an actualStartDay, in which
//        case its actuals override the cascade — they've already happened).
//   Idempotent: running twice on the same data produces the same output.
//
// This does NOT recompute the critical path — the caller re-runs `runCpm`
// after applying the reflow so all float numbers are fresh.

export function reflowFromActuals(tasks: ScheduleTask[]): ScheduleTask[] {
  const byId = new Map<string, ScheduleTask>();
  for (const t of tasks) byId.set(t.id, { ...t });

  // Build successor index.
  const successors = new Map<string, string[]>();
  for (const t of tasks) {
    for (const depId of t.dependencies) {
      const arr = successors.get(depId) ?? [];
      arr.push(t.id);
      successors.set(depId, arr);
    }
  }

  // For each task with actuals, compute delta and propagate.
  for (const seed of tasks) {
    if (seed.actualStartDay == null) continue;
    const basis = seed.baselineStartDay ?? seed.startDay;
    const delta = seed.actualStartDay - basis;
    // Also factor in a finished task that ran longer than baseline.
    let finishDelta = 0;
    if (seed.actualEndDay != null) {
      const baseEnd = seed.baselineEndDay ?? (basis + Math.max(0, seed.durationDays - 1));
      finishDelta = seed.actualEndDay - baseEnd;
    }
    const push = Math.max(delta, finishDelta);
    if (push <= 0) continue;

    // BFS through successors. Stop at any successor that has its own actuals
    // (they're already grounded in reality and should be trusted).
    const seen = new Set<string>();
    const q = [...(successors.get(seed.id) ?? [])];
    while (q.length) {
      const sid = q.shift()!;
      if (seen.has(sid)) continue;
      seen.add(sid);
      const succ = byId.get(sid);
      if (!succ) continue;
      if (succ.actualStartDay != null) continue; // don't touch started work
      succ.startDay = succ.startDay + push;
      // Keep baseline as-is — baseline = the original promise, not the new plan.
      for (const next of successors.get(sid) ?? []) q.push(next);
    }
  }

  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// 2) Named baselines
// ---------------------------------------------------------------------------
// Extends the existing single-baseline model non-breakingly: we keep the
// legacy `schedule.baseline` for back-compat and add a sidecar list of named
// versions captured over time.

export interface NamedBaseline extends ScheduleBaseline {
  id: string;
  name: string;          // "v1", "Signed", "Approved rev 2", ...
  note?: string;
}

export function captureBaseline(tasks: ScheduleTask[], name: string, note?: string): NamedBaseline {
  return {
    id: `baseline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    note,
    savedAt: new Date().toISOString(),
    tasks: tasks.map(t => ({
      id: t.id,
      startDay: t.startDay,
      endDay: t.startDay + Math.max(0, t.durationDays - 1),
    })),
  };
}

/** Apply a captured baseline onto each task's baselineStartDay/baselineEndDay. */
export function applyBaselineToTasks(tasks: ScheduleTask[], baseline: NamedBaseline): ScheduleTask[] {
  const byId = new Map(baseline.tasks.map(b => [b.id, b]));
  return tasks.map(t => {
    const b = byId.get(t.id);
    if (!b) return t;
    return { ...t, baselineStartDay: b.startDay, baselineEndDay: b.endDay };
  });
}

export interface BaselineDiff {
  taskId: string;
  title: string;
  startDelta: number;    // newStart - baselineStart
  durationDelta: number;
  endDelta: number;
}

/** Show variance between the current plan and a named baseline. */
export function diffAgainstBaseline(tasks: ScheduleTask[], baseline: NamedBaseline): BaselineDiff[] {
  const byId = new Map(baseline.tasks.map(b => [b.id, b]));
  const out: BaselineDiff[] = [];
  for (const t of tasks) {
    const b = byId.get(t.id);
    if (!b) continue;
    const end = t.startDay + Math.max(0, t.durationDays - 1);
    const bDur = b.endDay - b.startDay + 1;
    if (t.startDay === b.startDay && t.durationDays === bDur) continue; // unchanged
    out.push({
      taskId: t.id,
      title: t.title,
      startDelta: t.startDay - b.startDay,
      durationDelta: t.durationDays - bDur,
      endDelta: end - b.endDay,
    });
  }
  return out.sort((a, b) => Math.abs(b.endDelta) - Math.abs(a.endDelta));
}

// ---------------------------------------------------------------------------
// 3) CSV export
// ---------------------------------------------------------------------------

export function exportTasksToCsv(tasks: ScheduleTask[], projectStartDate: Date): string {
  const fmtDate = (dayNum: number) => {
    const d = new Date(projectStartDate);
    d.setDate(d.getDate() + dayNum - 1);
    return d.toISOString().slice(0, 10);
  };
  const headers = [
    'WBS', 'Task', 'Phase', 'Duration (d)', 'Start day', 'Start date',
    'Finish day', 'Finish date', 'Crew', 'Progress %', 'Status',
    'Dependencies', 'Baseline start', 'Baseline end', 'Actual start', 'Actual end',
  ];
  const rows: string[] = [headers.join(',')];
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const t of tasks) {
    const finishDay = t.startDay + Math.max(0, t.durationDays - 1);
    const depTitles = t.dependencies
      .map(id => byId.get(id)?.title ?? id)
      .join('; ');
    const row = [
      t.wbsCode ?? '',
      csvEscape(t.title),
      t.phase,
      t.durationDays,
      t.startDay,
      fmtDate(t.startDay),
      finishDay,
      fmtDate(finishDay),
      csvEscape(t.crew),
      t.progress,
      t.status,
      csvEscape(depTitles),
      t.baselineStartDay ?? '',
      t.baselineEndDay ?? '',
      t.actualStartDay ?? '',
      t.actualEndDay ?? '',
    ];
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

function csvEscape(v: string): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Trigger a CSV download in the browser. Returns true on success. */
export function downloadCsvInBrowser(csv: string, filename: string): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// 4) Share-link encode/decode (client-only, no backend)
// ---------------------------------------------------------------------------
//
// We stuff a minimal projection of the schedule into base64 in the URL hash.
// Downsides: 50-task schedule is ~6KB URL, which is fine. No server = no
// database migrations = ships immediately.
//
// The projection is intentionally minimal — we don't ship notes, progress
// history, or internal ids. The shared view is read-only so that's fine.

export interface SharedSchedulePayload {
  v: 1;
  name: string;
  projectStartISO: string;
  tasks: Array<{
    id: string;
    title: string;
    phase: string;
    startDay: number;
    durationDays: number;
    dependencies: string[];
    crew?: string;
    isMilestone?: boolean;
    baselineStartDay?: number;
    baselineEndDay?: number;
    actualStartDay?: number;
    actualEndDay?: number;
    progress?: number;
  }>;
}

export function encodeShareToken(payload: SharedSchedulePayload): string {
  const json = JSON.stringify(payload);
  // btoa only handles ASCII; use utf-8 round-trip.
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map(b => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  // Make URL-safe.
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShareToken(token: string): SharedSchedulePayload | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const ascii = typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('binary');
    const bytes = Uint8Array.from(ascii, c => c.charCodeAt(0));
    const json = typeof TextDecoder !== 'undefined'
      ? new TextDecoder().decode(bytes)
      : ascii;
    const parsed = JSON.parse(json) as SharedSchedulePayload;
    if (parsed.v !== 1 || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildSharePayload(
  name: string,
  projectStartDate: Date,
  tasks: ScheduleTask[],
): SharedSchedulePayload {
  return {
    v: 1,
    name,
    projectStartISO: projectStartDate.toISOString(),
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      phase: t.phase,
      startDay: t.startDay,
      durationDays: t.durationDays,
      dependencies: t.dependencies,
      crew: t.crew || undefined,
      isMilestone: t.isMilestone,
      baselineStartDay: t.baselineStartDay,
      baselineEndDay: t.baselineEndDay,
      actualStartDay: t.actualStartDay,
      actualEndDay: t.actualEndDay,
      progress: t.progress,
    })),
  };
}

/** Reconstruct ScheduleTask[] from the shared payload so our viewer can render. */
export function tasksFromSharePayload(payload: SharedSchedulePayload): ScheduleTask[] {
  return payload.tasks.map(t => ({
    id: t.id,
    title: t.title,
    phase: t.phase,
    durationDays: t.durationDays,
    startDay: t.startDay,
    progress: t.progress ?? 0,
    crew: t.crew ?? '',
    dependencies: t.dependencies,
    notes: '',
    status: 'not_started',
    isMilestone: t.isMilestone,
    baselineStartDay: t.baselineStartDay,
    baselineEndDay: t.baselineEndDay,
    actualStartDay: t.actualStartDay,
    actualEndDay: t.actualEndDay,
  }));
}
