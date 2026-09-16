// OAC meeting engine — AI agenda + voice-to-minutes generator.
//
// Responsibilities:
//   1. buildAgendaFromProjectState — pulls live project data (RFIs,
//      submittals, COs, schedule, recent DFRs) and produces a structured
//      agenda. The GC can edit before the meeting; manual notes survive
//      a regenerate.
//   2. generateMinutesFromTranscript — takes the meeting transcript +
//      agenda, returns structured minutes ready for distribution.
//
// Both flow through mageAI (Gemini) with strict Zod schemas + the salvage
// path so partial AI responses still produce usable output. The agenda
// itself is also computed deterministically from project state — the AI
// is just used to phrase items naturally and to triage urgency.

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type {
  Project, ProjectSchedule, ScheduleTask, RFI, Submittal, ChangeOrder,
  DailyFieldReport, OACAgendaItem, OACAgendaSection, OACMeeting, OACActionItem,
} from '@/types';
import { computeRFILatency } from '@/utils/rfiLatency';

import { generateUUID } from '@/utils/generateId';
import { calendarDayStart, calendarDayOf, daysUntilCalendarDay, formatCalendarDay } from '@/utils/calendarDate';

const ONE_DAY_MS = 86_400_000;

function createId(_prefix: string): string {
  return generateUUID();
}

function daysBetween(iso: string, ref: number = Date.now()): number {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.round((ref - t) / ONE_DAY_MS);
}

// ─── Action items — the commitments the meeting actually produced ──
//
// An OACActionItem is the app's cleanest statement of who-owes-what: a
// description, a `ballInCourt` (free text — "Owner", "Sarah Chen, AIA", "Building
// engineer"), an optional `dueBy`, and a status. On a tenant fit-out these are the
// only records the app holds for the owner, the architect, the landlord and the
// building engineer, because none of those four is a subcontractor with a schedule
// row or an invoice.
//
// They used to die in the meeting that minted them: nothing could close one, and
// nothing outside `active.actionItems` ever read them, so the PM walked into next
// Thursday's OAC reconstructing last week from memory. The three exports below are
// the join that fixes that — one collector, one agenda builder, one status
// transition — all pure so the guard can hold them to a fixed clock.

/**
 * How long an action with NO agreed due date is allowed to sit before the app
 * starts treating it as pressing.
 *
 * `dueBy` is routinely empty by design: generateMinutesFromTranscript instructs
 * the model to leave it blank when no date was named in the room, and on a fit-out
 * the commitments nobody dates are usually the OWNER decisions — the expensive
 * ones. An overdue-only rule would therefore lose exactly the items that matter
 * most, so an undated action gets a fallback clock from its own `createdAt`.
 *
 * Seven days = one OAC cycle. If a commitment survives a whole meeting-to-meeting
 * cycle without a date, the meeting needs to give it one or close it.
 */
export const UNDATED_STALE_DAYS = 7;

/** One still-open action, with the clock resolved against a fixed `now`. */
export interface OpenOACAction {
  action: OACActionItem;
  /** The meeting that minted it — where a status write has to land. */
  meetingId: string;
  meetingNumber: number;
  /**
   * Whole local days until `dueBy`: 0 today, negative already past. `null` means
   * NO DATE WAS AGREED — deliberately distinct from 0, because "due today" and
   * "nobody ever said when" are different facts and the UI must not print one as
   * the other.
   */
  dueInDays: number | null;
  /** Days since it was minted. The only clock an undated action has. */
  ageDays: number;
  /** Past its agreed date, or undated and older than UNDATED_STALE_DAYS. */
  needsChasing: boolean;
}

/**
 * Every action still open across a project's meetings, newest meeting last.
 *
 * `excludeMeetingId` drops the meeting currently on screen — its own actions are
 * rendered in full on that screen, so carrying them onto its own agenda would
 * print each one twice.
 */
export function collectOpenOACActions(
  meetings: OACMeeting[],
  opts: { excludeMeetingId?: string; now?: Date } = {},
): OpenOACAction[] {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const out: OpenOACAction[] = [];
  const seen = new Set<string>();

  for (const m of meetings ?? []) {
    if (!m || m.id === opts.excludeMeetingId) continue;
    for (const action of m.actionItems ?? []) {
      // 'done' stops nagging but is kept for audit (see OACMeeting.actionItems).
      if (!action || action.status === 'done') continue;
      // A meeting row synced twice, or an action duplicated by a re-merge, must
      // not produce two agenda lines for one commitment.
      if (seen.has(action.id)) continue;
      seen.add(action.id);

      const dueInDays = action.dueBy ? daysUntilCalendarDay(calendarDayOf(action.dueBy), now) : null;
      const ageDays = Math.max(0, Math.round((nowMs - new Date(action.createdAt).getTime()) / ONE_DAY_MS));
      out.push({
        action,
        meetingId: m.id,
        meetingNumber: m.number ?? 0,
        dueInDays,
        ageDays,
        needsChasing: dueInDays != null ? dueInDays < 0 : ageDays >= UNDATED_STALE_DAYS,
      });
    }
  }
  return out;
}

/**
 * Sort key — smaller is more pressing. A dated action ranks by days-to-due, so
 * the most overdue sorts first. An undated one has no such number: once it is
 * stale it is treated as due today (0), and while it is fresh it parks behind
 * everything that has a real date on it rather than pretending to a deadline.
 */
function urgencyRank(o: OpenOACAction): number {
  if (o.dueInDays != null) return o.dueInDays;
  return o.ageDays >= UNDATED_STALE_DAYS ? 0 : 365;
}

/** Plain-language state of the clock, for the agenda sub-line. */
export function actionDueLabel(o: OpenOACAction): string {
  if (o.dueInDays == null) {
    // Never invent a deadline nobody agreed to. Say what is actually known.
    return `No due date agreed · ${o.ageDays}d open`;
  }
  const on = formatCalendarDay(calendarDayOf(o.action.dueBy)) || o.action.dueBy || '';
  if (o.dueInDays < 0) {
    const late = -o.dueInDays;
    return `Due ${on} · ${late} day${late === 1 ? '' : 's'} overdue`;
  }
  if (o.dueInDays === 0) return `Due ${on} · today`;
  return `Due ${on} · in ${o.dueInDays} day${o.dueInDays === 1 ? '' : 's'}`;
}

/** Titles wrap in the agenda list, but an unbounded AI sentence should not own
 *  the whole card. Deterministic so the title stays stable across regenerations. */
function shortDescription(text: string, max = 90): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/**
 * One agenda row per still-open action from EARLIER meetings, grouped by who owes
 * it, each group ordered by its most pressing item.
 *
 * ── Why one row per action and not a summary line ──
 * mergeAgenda (below) de-dups on the EXACT title string, so a count-bearing title
 * like "Carried forward: 4 open actions, 2 overdue" appends a second copy of
 * itself the moment a count changes — every Refresh, forever. The title here is
 * keyed to the action's own words plus its origin meeting number, both of which
 * are stable; everything that moves with the calendar (overdue day counts) lives
 * in `detail`, which is not part of the de-dup key.
 *
 * The id is derived from the action id for the same reason: a regenerated agenda
 * has to produce the SAME row, not a new one with a fresh UUID.
 */
export function buildCarryForwardAgendaItems(open: OpenOACAction[]): OACAgendaItem[] {
  if (open.length === 0) return [];

  // Group by ball-in-court. ballInCourt is FREE TEXT the AI or the GC wrote — it
  // is never resolved to a Contact — so grouping keys off the trimmed string as
  // written, case-insensitively, and the label printed is the original spelling.
  const groups = new Map<string, { label: string; items: OpenOACAction[] }>();
  for (const o of open) {
    const label = (o.action.ballInCourt ?? '').trim();
    const key = label.toLowerCase();
    const g = groups.get(key);
    if (g) g.items.push(o);
    else groups.set(key, { label, items: [o] });
  }

  const byUrgency = (a: OpenOACAction, b: OpenOACAction): number =>
    urgencyRank(a) - urgencyRank(b) ||
    new Date(a.action.createdAt).getTime() - new Date(b.action.createdAt).getTime() ||
    a.action.id.localeCompare(b.action.id);

  const ordered = [...groups.values()]
    .map(g => ({ ...g, items: g.items.slice().sort(byUrgency) }))
    .sort((a, b) => urgencyRank(a.items[0]) - urgencyRank(b.items[0]) || a.label.localeCompare(b.label));

  const items: OACAgendaItem[] = [];
  for (const g of ordered) {
    for (const o of g.items) {
      const overdue = o.dueInDays != null && o.dueInDays < 0;
      items.push({
        id: `oac-carry-${o.action.id}`,
        section: 'action_items',
        title: `Carried forward (OAC #${o.meetingNumber}) — ${shortDescription(o.action.description)}`,
        // The row's OWN spelling, not the group's. Grouping folds "Owner" and
        // "owner" together for ordering, but each line still prints the words
        // that were written down — normalising free text on the way to the
        // screen is how a record stops matching the minutes it came from.
        detail: `${(o.action.ballInCourt ?? '').trim() || 'Owner unnamed'} · ${actionDueLabel(o)}`,
        status: overdue ? 'urgent' : o.needsChasing ? 'warn' : 'info',
        referenceId: o.action.id,
        referenceType: 'oac_action',
      });
    }
  }
  return items;
}

/**
 * Tap-to-advance for an action's status: open → in progress → done → open.
 *
 * `closedAt` is stamped on the way into 'done' and CLEARED on the way out, so a
 * reopened action never carries a closing date it no longer has. Pure: the screen
 * hands it the row and writes back what comes out, which is what lets the guard
 * assert the transition without a render.
 */
export function cycleOACActionStatus(action: OACActionItem, now: Date = new Date()): OACActionItem {
  const next: OACActionItem['status'] =
    action.status === 'open' ? 'in_progress'
    : action.status === 'in_progress' ? 'done'
    : 'open';
  const stamp = now.toISOString();
  return {
    ...action,
    status: next,
    closedAt: next === 'done' ? stamp : undefined,
    updatedAt: stamp,
  };
}

/**
 * A typed-in action item. Until this existed the ONLY producer was the AI minutes
 * merge, which needs a recorded transcript of 50+ characters — so a PM who ran the
 * meeting without recording it had no way to enter a commitment at all, and the
 * carry-forward above would have shipped over a permanently empty set.
 */
export function makeManualOACActionItem(input: {
  description: string;
  ballInCourt: string;
  dueBy?: string;
  meetingId?: string;
  now?: Date;
}): OACActionItem {
  const stamp = (input.now ?? new Date()).toISOString();
  return {
    id: generateUUID(),
    description: input.description.trim(),
    ballInCourt: input.ballInCourt.trim(),
    dueBy: input.dueBy?.trim() || undefined,
    status: 'open',
    createdAt: stamp,
    updatedAt: stamp,
    meetingId: input.meetingId,
    source: 'manual',
  };
}

// ─── Deterministic agenda from project state ─────────────────────

interface AgendaInputs {
  project: Project;
  rfis: RFI[];
  submittals: Submittal[];
  changeOrders: ChangeOrder[];
  dailyReports: DailyFieldReport[];
  schedule?: ProjectSchedule | null;
  tasks?: ScheduleTask[];
  /**
   * Every OTHER meeting on this project. Their still-open action items are
   * carried onto this agenda — without them the agenda's closing row was a
   * hardcoded "confirm owner of action items, due-bys" printed while the app was
   * holding last week's unclosed commitments and naming not one of them.
   */
  priorMeetings?: OACMeeting[];
  /** The meeting being built/refreshed, so its own actions aren't carried onto it. */
  currentMeetingId?: string;
  /** Injected clock — the guard fixes it; production leaves it undefined. */
  now?: Date;
}

/**
 * Build a fresh agenda from current project state. Sections appear in the
 * standard CM cadence: safety → schedule → RFIs → submittals → COs →
 * decisions → action items → next meeting. Each section emits 0-N items
 * based on what's actually outstanding — no empty headings.
 */
export function buildAgendaFromProjectState(inputs: AgendaInputs): OACAgendaItem[] {
  const { project, rfis, submittals, changeOrders, dailyReports, schedule, tasks } = inputs;
  const items: OACAgendaItem[] = [];
  const carriedForward = buildCarryForwardAgendaItems(
    collectOpenOACActions(inputs.priorMeetings ?? [], {
      excludeMeetingId: inputs.currentMeetingId,
      now: inputs.now,
    }),
  );

  // ── 1. Safety — recent DFR safety notes / incidents ─────────
  const recentDfrs = (dailyReports ?? [])
    .filter(d => daysBetween(d.date) <= 7)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const incidents = recentDfrs.filter(d => d.incident?.hasIncident);
  if (incidents.length > 0) {
    items.push({
      id: createId('agenda'),
      section: 'safety',
      title: `${incidents.length} safety incident${incidents.length === 1 ? '' : 's'} this week`,
      detail: incidents.map(i => `${new Date(i.date).toLocaleDateString()} — ${i.incident?.description?.slice(0, 80) ?? 'incident logged'}`).join('; '),
      status: 'urgent',
    });
  } else {
    items.push({
      id: createId('agenda'),
      section: 'safety',
      title: 'Safety review',
      detail: recentDfrs.length > 0
        ? `${recentDfrs.length} DFRs reviewed; no incidents reported.`
        : 'No DFRs filed in the last 7 days. Confirm jobsite is staffed and walks are happening.',
      status: recentDfrs.length === 0 ? 'warn' : 'info',
    });
  }

  // ── 2. Schedule — variance, critical path, this-week / next-week ──
  if (schedule && tasks && tasks.length > 0) {
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    const blocked = tasks.filter(t => t.status === 'in_progress' && t.progress === 0);
    const overdue = tasks.filter(t => {
      if (t.status === 'done' || t.progress >= 100) return false;
      const expectedEnd = t.startDay + t.durationDays;
      const todayDay = Math.round((Date.now() - new Date(project.createdAt).getTime()) / ONE_DAY_MS);
      return todayDay > expectedEnd;
    });
    const criticalPathBlocked = tasks.filter(t => t.isCriticalPath && (t.status === 'on_hold' || (t.status === 'in_progress' && t.progress < 10)));

    items.push({
      id: createId('agenda'),
      section: 'schedule',
      title: `Schedule status — ${inProgress.length} in progress, ${overdue.length} overdue`,
      detail: schedule.healthScore != null
        ? `Health score: ${schedule.healthScore}/100. ${overdue.length > 0 ? `${overdue.length} task(s) past expected end.` : 'On track.'}`
        : `${overdue.length} task(s) past expected end. ${blocked.length} not started despite being scheduled.`,
      status: schedule.healthScore != null && schedule.healthScore < 60 ? 'urgent'
            : overdue.length > 2 ? 'warn'
            : 'info',
    });

    if (criticalPathBlocked.length > 0) {
      items.push({
        id: createId('agenda'),
        section: 'schedule',
        title: `Critical path blocked: ${criticalPathBlocked.length} task${criticalPathBlocked.length === 1 ? '' : 's'}`,
        detail: criticalPathBlocked.slice(0, 3).map(t => `• ${t.title} (${t.progress}%)`).join('  '),
        status: 'urgent',
      });
    }
  } else {
    items.push({
      id: createId('agenda'),
      section: 'schedule',
      title: 'Schedule review',
      detail: 'No active schedule loaded for this project. Review milestones manually.',
      status: 'warn',
    });
  }

  // ── 3. RFIs — open + overdue (>7 days) ──────────────────────
  const openRfis = (rfis ?? []).filter(r => r.status === 'open');
  const overdueRfis = openRfis.filter(r => {
    // calendarDayStart: dateRequired is a bare 'YYYY-MM-DD' in the common
    // case; `new Date()` read it as UTC midnight — overdue the evening BEFORE
    // the due day west of Greenwich (B4 review A2).
    const due = calendarDayStart(r.dateRequired)?.getTime() ?? 0;
    return due > 0 && due < Date.now();
  });
  const agingRfis = openRfis.filter(r => daysBetween(r.dateSubmitted) > 7);

  if (openRfis.length > 0) {
    items.push({
      id: createId('agenda'),
      section: 'rfis',
      title: `${openRfis.length} open RFI${openRfis.length === 1 ? '' : 's'}${overdueRfis.length > 0 ? ` (${overdueRfis.length} overdue)` : ''}`,
      detail: openRfis.slice(0, 5).map(r => {
        const age = daysBetween(r.dateSubmitted);
        return `• #${r.number} ${r.subject} — ${age}d open${r.assignedTo ? ` (waiting on ${r.assignedTo})` : ''}`;
      }).join('\n'),
      status: overdueRfis.length > 0 ? 'urgent' : agingRfis.length > 0 ? 'warn' : 'info',
    });
  }

  // ── 3b. RFI latency grounding — when overdue RFIs exist, add a grounded
  //        agenda item with the architect's historical response average so
  //        the GC has leverage in the meeting ("architect averages Yd").
  if (overdueRfis.length > 0) {
    const latency = computeRFILatency(rfis ?? []);
    const oldestOverdue = overdueRfis.reduce((oldest, r) => {
      const t = new Date(r.dateSubmitted).getTime();
      return t < new Date(oldest.dateSubmitted).getTime() ? r : oldest;
    }, overdueRfis[0]);
    const oldestAge = daysBetween(oldestOverdue.dateSubmitted);
    const avgNote = latency.medianResponseDays > 0
      ? ` (architect averages ${latency.medianResponseDays}d)`
      : '';
    items.push({
      id: createId('agenda'),
      section: 'rfis',
      title: `${overdueRfis.length} RFI${overdueRfis.length === 1 ? '' : 's'} overdue — oldest #${oldestOverdue.number} (${oldestAge}d old)${avgNote}`,
      detail: overdueRfis.slice(0, 3).map(r => {
        const age = daysBetween(r.dateSubmitted);
        // Whole local days past the due DAY (not rounded elapsed ms from a
        // UTC-midnight parse, which said 4 for a three-day-old due date).
        const dueAge = r.dateRequired ? -(daysUntilCalendarDay(calendarDayOf(r.dateRequired)) ?? 0) : 0;
        return `• #${r.number} ${r.subject} — ${age}d open, ${dueAge}d past due`;
      }).join('\n'),
      status: 'urgent',
      referenceId: oldestOverdue.id,
      referenceType: 'rfi',
    });
  }

  // ── 4. Submittals — pending + in-review ─────────────────────
  const pendingSubs = (submittals ?? []).filter(s => ['pending', 'in_review'].includes(s.currentStatus));
  if (pendingSubs.length > 0) {
    items.push({
      id: createId('agenda'),
      section: 'submittals',
      title: `${pendingSubs.length} submittal${pendingSubs.length === 1 ? '' : 's'} pending review`,
      detail: pendingSubs.slice(0, 5).map(s => {
        const age = daysBetween(s.submittedDate);
        return `• #${s.number} ${s.title}${s.specSection ? ` (Spec ${s.specSection})` : ''} — ${age}d in review`;
      }).join('\n'),
      status: pendingSubs.some(s => daysBetween(s.submittedDate) > 14) ? 'warn' : 'info',
    });
  }

  // ── 5. Change orders — pending owner approval ───────────────
  const pendingCOs = (changeOrders ?? []).filter(c => c.status === 'submitted' || c.status === 'under_review');
  const approvedCOTotal = (changeOrders ?? []).filter(c => c.status === 'approved').reduce((s, c) => s + (c.changeAmount ?? 0), 0);
  if (pendingCOs.length > 0 || approvedCOTotal !== 0) {
    items.push({
      id: createId('agenda'),
      section: 'change_orders',
      title: pendingCOs.length > 0
        ? `${pendingCOs.length} change order${pendingCOs.length === 1 ? '' : 's'} awaiting owner approval`
        : `Change order log review`,
      detail: [
        approvedCOTotal !== 0 ? `Approved net: $${approvedCOTotal.toLocaleString()}` : null,
        ...pendingCOs.slice(0, 3).map(c => `• #${c.number} ${c.description?.slice(0, 60) ?? ''} — $${(c.changeAmount ?? 0).toLocaleString()}`),
      ].filter(Boolean).join('\n'),
      status: pendingCOs.length > 0 ? 'warn' : 'info',
    });
  }

  // ── 6. Decisions / open discussion / next meeting ────────────
  items.push({
    id: createId('agenda'),
    section: 'decisions',
    title: 'Open decisions needed from owner / architect',
    detail: '(Add any decisions you need cleared today.)',
    status: 'info',
  });
  items.push({
    id: createId('agenda'),
    section: 'open_discussion',
    title: 'Open discussion',
    status: 'info',
  });

  // ── 7. Carried-forward action items ──────────────────────────
  // Named individually, before "next meeting", because the point of the weekly
  // is to close last week's commitments — not to agree new ones on top of them.
  items.push(...carriedForward);

  items.push({
    id: createId('agenda'),
    section: 'next_meeting',
    // Static, count-free strings on purpose: mergeAgenda de-dups on the title,
    // and a number in either field would re-append this row on every Refresh.
    title: 'Next meeting + action items',
    detail: 'Confirm next OAC date, owner of action items, due-bys.',
    status: 'info',
  });

  return items;
}

/**
 * Merge a freshly-built agenda with the user's existing one, preserving
 * any items that have a manualNote or coveredAt set. Used when the GC
 * taps "Refresh agenda" mid-week to pick up new RFIs/submittals without
 * losing edits.
 */
export function mergeAgenda(existing: OACAgendaItem[], fresh: OACAgendaItem[]): OACAgendaItem[] {
  const out: OACAgendaItem[] = [];
  // Keep items the user manually added or annotated, regardless of whether
  // they appear in the fresh list. Drop auto-built items that aren't in
  // the fresh list (they're stale).
  for (const e of existing) {
    if (e.manualNote || e.covered) {
      out.push(e);
    }
  }
  // Append fresh auto items that don't duplicate something the user kept.
  // Crude dedup on title — agendas are short, this is good enough.
  const seenTitles = new Set(out.map(i => i.title));
  for (const f of fresh) {
    if (!seenTitles.has(f.title)) out.push(f);
  }
  return out;
}

// ─── AI minutes generator ────────────────────────────────────

const minutesSchema = z.object({
  /** Cleaned-up narrative organized by section, ready for email. */
  body: z.string().default(''),
  /** New action items the AI extracted from the discussion. */
  actionItems: z.array(z.object({
    description: z.string().default(''),
    ballInCourt: z.string().default(''),
    dueBy: z.string().optional(),
  })).default([]),
  /** Decisions made during the meeting. */
  decisions: z.array(z.string()).default([]),
});

export type AIMinutesResult = z.infer<typeof minutesSchema>;

/**
 * Take a meeting transcript + agenda + project name, ask Gemini to
 * produce structured minutes. The body is HTML-safe markdown that we
 * render in the meeting screen and email out.
 */
export async function generateMinutesFromTranscript(opts: {
  projectName: string;
  meetingNumber: number;
  meetingDate: string;
  attendees: string[];
  agendaTitles: string[];
  transcript: string;
}): Promise<AIMinutesResult> {
  const { projectName, meetingNumber, meetingDate, attendees, agendaTitles, transcript } = opts;
  const prompt = `You are a senior construction project manager writing the OFFICIAL meeting minutes for an Owner-Architect-Contractor (OAC) meeting on the project below. Use the live transcript and the agenda outline.

PROJECT: ${projectName}
MEETING: OAC #${meetingNumber} on ${meetingDate}
ATTENDEES: ${attendees.join(', ')}

AGENDA (covered in this meeting):
${agendaTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

TRANSCRIPT (raw, may be unstructured):
"""
${transcript.slice(0, 8000)}
"""

Produce minutes as:
- body: a clean, professional narrative organized BY THE AGENDA SECTIONS above. Use plain markdown (\`##\` headings, \`-\` bullets). Every concrete decision, deadline, dollar figure, name, or commitment from the transcript MUST appear. Don't invent. Don't editorialize. Where the transcript is silent on an agenda item, write "No discussion."
- actionItems: every "X will do Y by Z" in the transcript becomes one action item with description / ballInCourt / dueBy (ISO date if a date was named, otherwise leave dueBy empty).
- decisions: every concrete decision made (approved CO, picked finish, signed off RFI, etc.) becomes one short bullet — "Owner approved CO #4 ($3,200, kitchen pendant rerun)."

Tone: factual, third-person, professional. No filler. No "It was discussed that..." padding — say what was decided.`;

  const aiResult = await mageAI({
    prompt,
    schema: minutesSchema,
    schemaHint: {
      body: '## Safety\n- No incidents this week.\n\n## Schedule\n- Health score 88/100. Drywall on critical path; sub confirmed Friday completion.\n\n## RFIs\n- RFI #14 (kitchen island beam) discussed; architect committed Friday response.',
      actionItems: [
        { description: 'Architect to issue beam-size response on RFI #14', ballInCourt: 'Sarah Chen, AIA', dueBy: '2026-05-03' },
        { description: 'GC to send revised CO #5 with updated retention', ballInCourt: 'Mike (GC)', dueBy: '2026-05-02' },
      ],
      decisions: [
        'Owner approved CO #4 ($3,200, kitchen pendant rerun)',
        'Architect approved Submittal #7 — Quartz countertop sample',
      ],
    },
    tier: 'smart',
    maxTokens: 4000,
  });

  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Could not generate minutes.');
  }
  return aiResult.data as AIMinutesResult;
}
