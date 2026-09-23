// utils/copilot/scheduleEdit/scheduleEditCapability.ts — conversational editing
// of an existing schedule. AI → EditOp[] → interpret → commit via the editor's
// own undo-safe commit(). Review renders a diff (ScheduleDiffView).
import { createElement } from 'react';
import { commitRefused, COMPLETE_DRAFT_RULE, type CopilotCapability, type CopilotContext, type Gap, type Grounding } from '../types';
import { normalizeEditOps, adoptCompleteDraft, describeEditOp, describeDropped, PARALLEL_RE, type EditOp, type DroppedOp } from './editOps';
import { interpretScheduleOps, applyEditEffects } from './interpretOps';
import { buildScheduleEditGrounding } from './scheduleEditGrounding';
import ScheduleDiffView from '@/components/copilot/ScheduleDiffView';

/** `dropped`: ops the AI sent that the app couldn't use — kept so the review
 *  says what it couldn't read instead of silently applying the rest. */
export interface ScheduleEditDraft { ops: EditOp[]; dropped?: DroppedOp[] }
/** `landed` / `notLanded`: one plain line per op, so the shell can list what
 *  actually changed after Apply (with Undo) instead of just closing. */
export interface ScheduleEditApplied { done: true; landed: string[]; notLanded: string[] }

/** One example per op SHAPE. The relay (supabase/functions/_shared/inferSchema)
 *  unions a multi-example array into one item schema whose only required key is
 *  `op`, so every op kind can be expressed. The single `move` example this
 *  replaced let Gemini emit only {op, task, deltaDays}: an add had nowhere to put
 *  its title or duration and was dropped — "add three tasks" came back as one
 *  move, or nothing.
 *
 *  ORDER MATTERS: move(deltaDays) stays FIRST, so a relay that has not been
 *  redeployed (it reads val[0] only) infers exactly today's schema — the OTA and
 *  the function deploy are safe in either order.
 *
 *  Refs are placeholders ('<task id>') so an echoed example can never touch a
 *  real task: normalizeEditOps discards any ref that starts with '<'. `level`
 *  carries no ref, so it is NOT listed — an echoed example must not re-level the
 *  crew; the op is still expressible (only `op` is required) and the prompt
 *  lists it. */
export const SCHEDULE_EDIT_SCHEMA_HINT = {
  ops: [
    { op: 'move', task: '<task id>', deltaDays: 7 },
    { op: 'move', task: '<task id>', toStartDay: 30 },
    { op: 'setDuration', task: '<task id>', days: 5 },
    { op: 'setCrew', task: '<task id>', crewSize: 4 },
    { op: 'setProgress', task: '<task id>', pct: 50 },
    { op: 'addDependency', from: '<task id>', to: '<task id>', type: 'FS', lag: 0 },
    { op: 'removeDependency', from: '<task id>', to: '<task id>' },
    { op: 'addTask', title: '<new task title>', durationDays: 3, after: '<task id, or the exact title of a task you added just before>', isMilestone: false },
    { op: 'removeTask', task: '<task id>' },
  ],
};

export const scheduleEditCapability: CopilotCapability<ScheduleEditDraft, ScheduleEditApplied> = {
  id: 'scheduleEdit',
  label: 'Edit the schedule',
  aiFeature: 'scheduleCopilot',
  maxQuestions: 0,
  askThreshold: 1,
  suggestions: [
    'Push framing back a week and re-level the crew',
    'Add a two-week cabinet procurement milestone before install',
  ],
  copy: {
    voiceTitle: 'Edit the schedule',
    composeEyebrow: 'CHANGE THE SCHEDULE',
    composeQuestion: 'What should change?',
    composeHint: 'Say the change — push a task, add a milestone, re-level the crew. I’ll show the ripple before it sticks.',
    reviewHeadline: 'Here’s the change.',
    reviewSub: 'Review the ripple, then apply.',
    buildingLabel: 'Applying the change…',
    webRoute: '/schedule-pro',
  },
  buildGrounding: buildScheduleEditGrounding,
  gaps: (_draft: ScheduleEditDraft, _g: Grounding): Gap[] => [],
  buildTurnPrompt: ({ transcript, draft, grounding }) => ({
    prompt: [
      'You are MAGE Copilot EDITING an existing construction schedule.',
      'Output edit OPERATIONS against the tasks below — reference tasks by their',
      'id (the token in quotes is the name; use the id). Emit ONLY changes the',
      'contractor actually asked for. Ops:',
      '• {op:"move", task, deltaDays} or {op:"move", task, toStartDay}',
      '• {op:"setDuration", task, days}  • {op:"setCrew", task, crewSize}',
      '• {op:"setProgress", task, pct}',
      '• {op:"addDependency", from, to, type:"FS|SS|FF|SF", lag}  • {op:"removeDependency", from, to}',
      '• {op:"addTask", title, durationDays, after, isMilestone}  • {op:"removeTask", task}',
      '• {op:"level"}  (re-level / fix crew overloads)',
      '',
      'CURRENT TASKS:', ...((grounding.data.taskList as string[]) ?? []),
      '',
      'The example shows every op SHAPE — emit only the ops asked for, one addTask',
      'per new task, in the order they happen. To chain new tasks, set `after` to',
      'the exact title of the task you added just before it.',
      'DRAFT OPS SO FAR (from what they said before): ' + JSON.stringify(draft.ops ?? []),
      COMPLETE_DRAFT_RULE,
      'WHAT THEY SAID (earlier turns first, separated by " | "): ' + transcript,
      'Return ONLY JSON: { "ops": [ ... ] }.',
    ].join('\n'),
    schemaHint: SCHEDULE_EDIT_SCHEMA_HINT,
  }),
  mergeDraft: (draft, aiJson, meta): ScheduleEditDraft => {
    // No ops array is not an answer to the protocol — keep what is queued
    // rather than wipe it. (The relay's schema requires `ops`, so this is the
    // off-schema case only.)
    if (!Array.isArray(aiJson?.ops)) return draft;
    // THE COMPLETE-DRAFT RULE: the answer is the whole list for everything he
    // has asked so far (COMPLETE_DRAFT_RULE in the prompt), so it REPLACES the
    // draft — see adoptCompleteDraft for why nothing is merged or guessed.
    // "In parallel" is read from THIS turn's words (the hook joins turns with
    // ' | '), deterministically, and applies only to adds new this turn; an
    // add that was already queued keeps its own flag.
    const lastTurn = meta?.transcript ? meta.transcript.split(' | ').pop() ?? '' : '';
    return adoptCompleteDraft(draft, normalizeEditOps(aiJson.ops), { parallelThisTurn: PARALLEL_RE.test(lastTurn) });
  },
  apply: async (draft: ScheduleEditDraft, ctx: CopilotContext): Promise<ScheduleEditApplied> => {
    const ops = draft.ops ?? [];
    const before = ctx.currentTasks ?? [];
    const notLanded = (draft.dropped ?? []).map(d => `Couldn't read: ${describeDropped(d, before)}`);
    if (!ctx.commitTasks) return { done: true, landed: [], notLanded: [...notLanded, 'No schedule editor is open to apply this to.'] };
    // The same interpretation the review showed (against the tasks on screen),
    // so the "what landed" list names exactly what Apply changed.
    const { results, nextTasks } = interpretScheduleOps(ops, before, ctx.cpmOptions ?? {});
    const wrote = ctx.commitTasks((prev) => {
      const { nextTasks: n } = interpretScheduleOps(ops, prev, ctx.cpmOptions ?? {});
      return applyEditEffects(ops, n, ctx.cpmOptions ?? {});
    });
    // Name tasks by title, including the rows this batch added.
    const beforeIds = new Set(before.map(t => t.id));
    const named = [...before, ...nextTasks.filter(t => !beforeIds.has(t.id))];
    const lines = results.filter(r => r.ok).map(r => describeEditOp(r.op, named, r, ctx.cpmOptions));
    const skipped = results.filter(r => !r.ok).map(r => `Skipped: ${r.reason ?? 'couldn’t apply'}`);
    // The host refused the write (and has said why). Never a ticked "Added …"
    // card over an alert that says nothing was saved.
    if (commitRefused(wrote)) {
      // The host's reason is a full sentence ("You have view-only access…").
      const why = typeof wrote === 'string' ? [wrote] : ['Nothing was saved.'];
      return { done: true, landed: [], notLanded: [...why, ...lines.map(l => `Not saved — ${l}`), ...notLanded, ...skipped] };
    }
    return { done: true, landed: lines, notLanded: [...notLanded, ...skipped] };
  },
  renderReview: ({ draft, ctx, confirm, cancel }) =>
    createElement(ScheduleDiffView, { ops: (draft as ScheduleEditDraft).ops ?? [], dropped: (draft as ScheduleEditDraft).dropped ?? [], ctx, onApply: confirm, onDiscard: cancel }),
};
