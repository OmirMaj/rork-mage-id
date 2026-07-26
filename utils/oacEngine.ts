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
  DailyFieldReport, OACAgendaItem, OACAgendaSection,
} from '@/types';
import { computeRFILatency } from '@/utils/rfiLatency';

import { generateUUID } from '@/utils/generateId';

const ONE_DAY_MS = 86_400_000;

function createId(_prefix: string): string {
  return generateUUID();
}

function daysBetween(iso: string, ref: number = Date.now()): number {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.round((ref - t) / ONE_DAY_MS);
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
    const due = r.dateRequired ? new Date(r.dateRequired).getTime() : 0;
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
        const dueAge = r.dateRequired ? daysBetween(r.dateRequired) : 0;
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
  items.push({
    id: createId('agenda'),
    section: 'next_meeting',
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
