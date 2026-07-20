// utils/copilot/scheduleEdit/scheduleEditCapability.ts — conversational editing
// of an existing schedule. AI → EditOp[] → interpret → commit via the editor's
// own undo-safe commit(). Review renders a diff (ScheduleDiffView).
import { createElement } from 'react';
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { normalizeEditOps, type EditOp } from './editOps';
import { interpretScheduleOps, applyEditEffects } from './interpretOps';
import { buildScheduleEditGrounding } from './scheduleEditGrounding';
import ScheduleDiffView from '@/components/copilot/ScheduleDiffView';

export interface ScheduleEditDraft { ops: EditOp[] }
export interface ScheduleEditApplied { done: true }

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
      'DRAFT OPS SO FAR: ' + JSON.stringify(draft.ops ?? []),
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY JSON: { "ops": [ ... ] }.',
    ].join('\n'),
    schemaHint: { ops: [{ op: 'move', task: 't1', deltaDays: 7 }] },
  }),
  mergeDraft: (draft, aiJson): ScheduleEditDraft => ({
    ops: [...(draft.ops ?? []), ...normalizeEditOps(aiJson?.ops)],
  }),
  apply: async (draft: ScheduleEditDraft, ctx: CopilotContext): Promise<ScheduleEditApplied> => {
    const ops = draft.ops ?? [];
    if (!ctx.commitTasks) return { done: true };
    ctx.commitTasks((prev) => {
      const { nextTasks } = interpretScheduleOps(ops, prev);
      return applyEditEffects(ops, nextTasks, ctx.cpmOptions ?? {});
    });
    return { done: true };
  },
  renderReview: ({ draft, ctx, confirm, cancel }) =>
    createElement(ScheduleDiffView, { ops: (draft as ScheduleEditDraft).ops ?? [], ctx, onApply: confirm, onDiscard: cancel }),
};
