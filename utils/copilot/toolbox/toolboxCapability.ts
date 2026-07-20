// utils/copilot/toolbox/toolboxCapability.ts — the Toolbox Talk Copilot capability.
//
// Say the topic (or let MAGE suggest one from this job's own recent incidents /
// open hazards) → MAGE writes the talking points → addToolboxTalk persists the
// meeting record and drops the foreman on the toolbox-talk log to take
// attendance. Generate-and-persist via SafetyContext (ctx.safety); AI writes the
// notes but never blocks — a stub is still a usable meeting if the relay is down.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import type { ToolboxTopicSource } from '@/types';
import { toolboxGaps, type ToolboxDraft, type SuggestedTopic } from './toolboxGaps';
import { buildToolboxGrounding } from './toolboxGrounding';
import { mageAI } from '@/utils/mageAI';
import { createId } from '@/utils/scheduleEngine';

export interface ToolboxApplied { route: '/safety-toolbox'; projectId: string; params: { projectId: string } }

const SOURCES: ToolboxTopicSource[] = ['incident', 'hazard', 'weather', 'manual'];
const asSource = (v: unknown): ToolboxTopicSource =>
  typeof v === 'string' && (SOURCES as string[]).includes(v) ? (v as ToolboxTopicSource) : 'manual';

/** Turn the AI's structured points into the flat notes string the record holds. */
function formatNotes(data: unknown, topic: string): string {
  const d = (data ?? {}) as { talkingPoints?: unknown; keyReminder?: unknown };
  const points = Array.isArray(d.talkingPoints)
    ? d.talkingPoints.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];
  if (points.length === 0) {
    return `Topic: ${topic}. Walk the crew through the hazards for this task, the controls we use, and today's plan. Ask if anyone sees a concern.`;
  }
  const body = points.map((p) => `• ${p.trim()}`).join('\n');
  const reminder = typeof d.keyReminder === 'string' && d.keyReminder.trim()
    ? `\n\nKey reminder: ${d.keyReminder.trim()}`
    : '';
  return `${body}${reminder}`;
}

export const toolboxCapability: CopilotCapability<ToolboxDraft, ToolboxApplied> = {
  id: 'toolbox_talk',
  label: 'Run a toolbox talk',
  aiFeature: 'voiceCapture',
  maxQuestions: 1,
  askThreshold: 0.4,
  suggestions: [
    'Ladder safety — we’ve got a lot of overhead work today',
    'Heat illness — it’s going to be 95 out there',
  ],
  topicChecklist: [
    { label: 'Topic', hint: 'what today’s talk covers' },
  ],
  copy: {
    voiceTitle: 'Run a toolbox talk',
    composeEyebrow: 'TODAY’S SAFETY TALK',
    composeQuestion: 'What are we covering?',
    composeHint: 'Name the topic — or ask MAGE, and it’ll pull one from this job’s recent incidents.',
    reviewHeadline: 'Here’s your toolbox talk, ready to run.',
    reviewSub: 'Review the talking points, then log it. You’ll take attendance on the toolbox-talk log.',
    buildingLabel: 'Writing the talk…',
    webRoute: '/safety-toolbox',
  },
  buildGrounding: buildToolboxGrounding,
  gaps: (draft: ToolboxDraft, grounding: Grounding): Gap[] => toolboxGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot helping a foreman set up a jobsite toolbox talk.',
      'Extract ONLY what they stated — a null field is how you ASK, never invent:',
      '• topic: a short subject for the talk (e.g. "Ladder safety", "Heat illness").',
      '• presenter: who is leading it, only if they named someone; else null.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { topic: 'Ladder safety', presenter: null },
  }),

  mergeDraft: (draft, aiJson, meta): ToolboxDraft => ({
    topic: (typeof aiJson?.topic === 'string' && aiJson.topic.trim() ? aiJson.topic : draft.topic) ?? meta?.transcript ?? null,
    presenter: typeof aiJson?.presenter === 'string' ? aiJson.presenter : draft.presenter ?? null,
    source: draft.source ?? null,
  }),

  apply: async (draft: ToolboxDraft, ctx: CopilotContext): Promise<ToolboxApplied> => {
    const project = ctx.project;
    if (!project) throw new Error('No project for this toolbox talk.');
    const topic = (draft.topic ?? '').trim();
    if (!topic) throw new Error('Tell me the topic first.');

    // Recover where the topic came from (incident / hazard / manual) for the record.
    const grounding = await buildToolboxGrounding(ctx);
    const suggested = ((grounding.data as { suggestedTopics?: SuggestedTopic[] })?.suggestedTopics ?? []);
    const match = suggested.find((s) => s.value.trim().toLowerCase() === topic.toLowerCase());
    const source = asSource(match?.source);

    // Write the talking points. Never block the meeting on the AI relay.
    let notes: string;
    try {
      const gen = await mageAI({
        prompt: [
          'You are MAGE Copilot writing a short, practical construction toolbox talk.',
          `TOPIC: ${topic}`,
          project.name ? `PROJECT: ${project.name}` : '',
          ...grounding.facts,
          '',
          'Write 4-6 concrete talking points a foreman can read aloud in 5 minutes —',
          'specific hazards, the controls the crew uses, and what to watch for TODAY.',
          'Plain jobsite language, no fluff, no legal boilerplate. Then one key reminder.',
        ].filter(Boolean).join('\n'),
        schemaHint: { talkingPoints: ['Inspect ladders before use — no bent rails or missing feet'], keyReminder: 'Three points of contact, every time.' },
        tier: 'fast',
        maxTokens: 900,
        feature: 'voiceCapture',
      });
      notes = formatNotes(gen.success ? gen.data : null, topic);
    } catch {
      notes = formatNotes(null, topic);
    }

    const now = new Date().toISOString();
    ctx.safety?.addToolboxTalk?.({
      id: createId('tbt'),
      projectId: ctx.projectId,
      topic: topic.slice(0, 80),
      date: now.slice(0, 10),
      presenter: (draft.presenter ?? '').trim(),
      notes,
      attendees: [],
      aiTopicSource: source,
      createdBy: '',
      createdAt: now,
      updatedAt: now,
    });
    return { route: '/safety-toolbox', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
