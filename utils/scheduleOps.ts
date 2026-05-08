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
  /** Reason this baseline was captured/rebaselined. Drives the audit
   *  trail when an owner asks "why did this change?" — typical values:
   *  "permit delay", "scope change", "weather", "client direction", etc. */
  reasonCode?: BaselineReasonCode;
  /** Captured-by user identifier — email, name, or 'anonymous'. */
  capturedBy?: string;
}

/** Stable reason codes for re-baselines. Free text via `reasonOther` if
 *  the user picks "other." */
export type BaselineReasonCode =
  | 'as_bid'
  | 'permit_delay'
  | 'scope_change'
  | 'weather'
  | 'client_direction'
  | 'sub_unavailability'
  | 'design_revision'
  | 'material_delay'
  | 'other';

export const BASELINE_REASON_LABELS: Record<BaselineReasonCode, string> = {
  as_bid: 'As-bid baseline',
  permit_delay: 'Permit delay',
  scope_change: 'Scope change',
  weather: 'Weather',
  client_direction: 'Client direction',
  sub_unavailability: 'Sub unavailable',
  design_revision: 'Design revision',
  material_delay: 'Material delay',
  other: 'Other',
};

export interface CaptureBaselineOpts {
  reasonCode?: BaselineReasonCode;
  capturedBy?: string;
}

export function captureBaseline(
  tasks: ScheduleTask[],
  name: string,
  note?: string,
  opts: CaptureBaselineOpts = {},
): NamedBaseline {
  return {
    id: `baseline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    note,
    reasonCode: opts.reasonCode,
    capturedBy: opts.capturedBy,
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

/** Compare two named baselines (e.g. as-bid vs. as-permitted) without
 *  involving the current plan. Used by the multi-baseline UI to show
 *  "what changed when the GC re-baselined after permit delay." */
export function diffTwoBaselines(a: NamedBaseline, b: NamedBaseline): BaselineDiff[] {
  const aById = new Map(a.tasks.map(t => [t.id, t]));
  const out: BaselineDiff[] = [];
  for (const bt of b.tasks) {
    const at = aById.get(bt.id);
    if (!at) continue;
    const aDur = at.endDay - at.startDay + 1;
    const bDur = bt.endDay - bt.startDay + 1;
    if (at.startDay === bt.startDay && aDur === bDur) continue;
    out.push({
      taskId: bt.id,
      title: bt.id, // caller can re-resolve via tasks[] if needed
      startDelta: bt.startDay - at.startDay,
      durationDelta: bDur - aDur,
      endDelta: bt.endDay - at.endDay,
    });
  }
  return out.sort((a, b) => Math.abs(b.endDelta) - Math.abs(a.endDelta));
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
  /** v=1 legacy; v=2 adds GC contact + per-task assignedSub for sub-confirm flow.
   *  v=3 adds projectId for the Sub Schedule Collab daily-update flow. */
  v: 1 | 2 | 3;
  name: string;
  projectStartISO: string;
  /** v3+: project this schedule belongs to. Lets the sub post updates
   *  that the GC's app picks up under the right project context. */
  projectId?: string;
  /** v2+: GC contact info — used to compose mailto/sms responses when the
   *  link is shared in "for sub" mode (?asSub= query param). Optional so
   *  v1 payloads keep decoding cleanly. */
  gc?: {
    name: string;
    email?: string;
    phone?: string;
    company?: string;
  };
  tasks: {
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
    /** v2+: sub assignment — when ?asSub= matches this string we filter
     *  the confirm UI to just the sub's tasks. Plain text for back-compat. */
    assignedSub?: string;
  }[];
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
    // Accept v1 (legacy GC-only), v2 (with sub-assignment + GC contact),
    // and v3 (with projectId for sub daily updates). Pre-fix the decoder
    // hardcoded v !== 1 which silently rejected every link emitted by
    // schedule-pro (handleShare always sets projectId → buildSharePayload
    // always emits v3 → 100% of new-screen share links broken). When a
    // future v4 ships, raise the upper bound here AND add a migration
    // for older payloads if the shape changes.
    if (typeof parsed.v !== 'number' || parsed.v < 1 || parsed.v > 3 || !Array.isArray(parsed.tasks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface BuildSharePayloadOpts {
  /** GC contact info — drives the sub-confirm reply (mailto/sms). Optional. */
  gc?: SharedSchedulePayload['gc'];
  /** Project this schedule belongs to. Required for Sub Schedule Collab
   *  daily updates so posts route to the right project context. */
  projectId?: string;
}

export function buildSharePayload(
  name: string,
  projectStartDate: Date,
  tasks: ScheduleTask[],
  opts: BuildSharePayloadOpts = {},
): SharedSchedulePayload {
  // Bump to v3 when projectId is provided (enables sub daily updates),
  // v2 when only GC contact / sub assignment is set, v1 otherwise.
  const anySub = tasks.some(t => t.assignedSubName);
  const hasGc = !!(opts.gc?.name || opts.gc?.email || opts.gc?.phone);
  const v: 1 | 2 | 3 = opts.projectId ? 3 : (anySub || hasGc) ? 2 : 1;
  return {
    v,
    name,
    projectStartISO: projectStartDate.toISOString(),
    projectId: opts.projectId,
    gc: opts.gc,
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
      assignedSub: t.assignedSubName,
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
    assignedSubName: t.assignedSub,
  }));
}

// ───────────────────────────────────────────────────────────────────────
// Sub-confirm response composers — login-less reply flow for shareable
// schedule URLs. Sub taps "Confirm" / "Need to reschedule" → we open a
// pre-filled mailto: + sms: so the GC gets a structured response without
// the sub ever creating an account. Wedge against Buildertrend's sub
// portal which requires login.
// ───────────────────────────────────────────────────────────────────────

export type SubConfirmAction = 'confirm' | 'reschedule' | 'decline';

export interface ComposeReplyArgs {
  action: SubConfirmAction;
  projectName: string;
  taskTitle: string;
  taskDateRange: string;
  subName: string;
  gcName?: string;
  reason?: string;
}

/** Build a one-liner subject + multi-line body the sub can send to GC. */
export function composeSubReply(args: ComposeReplyArgs): { subject: string; body: string } {
  const { action, projectName, taskTitle, taskDateRange, subName, gcName, reason } = args;
  const verb = action === 'confirm'
    ? 'CONFIRMED'
    : action === 'reschedule'
      ? 'NEED TO RESCHEDULE'
      : 'DECLINED';
  const subject = `[${verb}] ${projectName} — ${taskTitle} (${taskDateRange})`;
  const lines: string[] = [];
  lines.push(`Hi${gcName ? ' ' + gcName : ''},`);
  lines.push('');
  if (action === 'confirm') {
    lines.push(`Confirming the following on the ${projectName} schedule:`);
    lines.push(`  • ${taskTitle}`);
    lines.push(`  • ${taskDateRange}`);
    lines.push('');
    lines.push('We\'ll be on site as scheduled.');
  } else if (action === 'reschedule') {
    lines.push(`Need to reschedule the following on the ${projectName} schedule:`);
    lines.push(`  • ${taskTitle}`);
    lines.push(`  • Currently: ${taskDateRange}`);
    if (reason) {
      lines.push('');
      lines.push(`Reason: ${reason}`);
    }
    lines.push('');
    lines.push('Let me know what works on your end.');
  } else {
    lines.push(`Have to decline the following on the ${projectName} schedule:`);
    lines.push(`  • ${taskTitle}`);
    lines.push(`  • ${taskDateRange}`);
    if (reason) {
      lines.push('');
      lines.push(`Reason: ${reason}`);
    }
  }
  lines.push('');
  lines.push(`— ${subName}`);
  lines.push('');
  lines.push('(Sent via MAGE ID schedule link)');
  return { subject, body: lines.join('\n') };
}

/** mailto: URL builder. Falls back gracefully when email is empty. */
export function buildMailtoUrl(args: ComposeReplyArgs & { gcEmail?: string }): string {
  const { gcEmail, ...rest } = args;
  const { subject, body } = composeSubReply(rest);
  const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${gcEmail ?? ''}?${params}`;
}

/** sms: URL builder. iOS uses & or ?, Android uses ?, both accept ?body=. */
export function buildSmsUrl(args: ComposeReplyArgs & { gcPhone?: string }): string {
  const { gcPhone, ...rest } = args;
  const { subject, body } = composeSubReply(rest);
  // Keep SMS short — strip the long body for SMS, just use subject + name.
  const text = `${subject}\n\n— ${rest.subName}`;
  void body;
  return `sms:${gcPhone ?? ''}?body=${encodeURIComponent(text)}`;
}
