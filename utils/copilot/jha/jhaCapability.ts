// utils/copilot/jha/jhaCapability.ts — the Job Hazard Analysis Copilot capability.
//
// Say the task ("setting steel on the third floor today"), confirm the trade,
// and MAGE writes the whole analysis — sequenced steps, the hazards at each
// step, the controls that mitigate them, and the required PPE — then addJha
// persists it as a DRAFT (aiGenerated) for the competent person to review and
// the crew to sign. The deepest AI generation of the safety set. Persists via
// SafetyContext (ctx.safety); the AI does the heavy lifting but never blocks —
// a minimal one-step analysis is still a usable starting point if the relay is
// down.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import type { JHAStep } from '@/types';
import { jhaGaps, type JHADraft } from './jhaGaps';
import { buildJHAGrounding } from './jhaGrounding';
import { mageAI } from '@/utils/mageAI';
import { createId } from '@/utils/scheduleEngine';

export interface JHAApplied { route: '/safety-jha'; projectId: string; params: { projectId: string } }

interface GenStep { step?: string; hazards?: unknown; controls?: unknown }

const asStringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];

export const jhaCapability: CopilotCapability<JHADraft, JHAApplied> = {
  id: 'jha',
  label: 'Write a JHA',
  aiFeature: 'voiceCapture',
  maxQuestions: 1,
  askThreshold: 0.4,
  suggestions: [
    'Setting structural steel on the third floor with the crane today',
    'Cutting and grinding rebar in the foundation trench',
  ],
  topicChecklist: [
    { label: 'Task', hint: 'the work being done' },
    { label: 'Trade', hint: 'who’s performing it' },
  ],
  copy: {
    voiceTitle: 'Write a JHA',
    composeEyebrow: 'ANALYZE TODAY’S TASK',
    composeQuestion: 'What work are we analyzing?',
    composeHint: 'Name the task — I’ll break it into steps, hazards, controls, and the PPE.',
    reviewHeadline: 'Here’s your hazard analysis, ready to review.',
    reviewSub: 'It saves as a draft — have your competent person review it and the crew sign before work starts.',
    buildingLabel: 'Analyzing the hazards…',
    webRoute: '/safety-jha',
  },
  buildGrounding: buildJHAGrounding,
  gaps: (draft: JHADraft, grounding: Grounding): Gap[] => jhaGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot helping a contractor scope a Job Hazard Analysis.',
      'Extract ONLY what they stated — a null field is how you ASK, never invent:',
      '• taskDescription: the work being performed, in their words.',
      '• trade: the trade doing it (e.g. "Structural steel", "Concrete",',
      '  "Electrical") ONLY if the task makes it clear; else null.',
      '• title: a short label for the analysis (e.g. "Steel erection — L3").',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { taskDescription: 'Setting structural steel on level 3', trade: null, title: 'Steel erection — L3' },
  }),

  mergeDraft: (draft, aiJson, meta): JHADraft => ({
    taskDescription: (typeof aiJson?.taskDescription === 'string' && aiJson.taskDescription.trim() ? aiJson.taskDescription : draft.taskDescription) ?? meta?.transcript ?? null,
    trade: typeof aiJson?.trade === 'string' ? aiJson.trade : draft.trade ?? null,
    title: typeof aiJson?.title === 'string' ? aiJson.title : draft.title ?? null,
  }),

  apply: async (draft: JHADraft, ctx: CopilotContext): Promise<JHAApplied> => {
    const project = ctx.project;
    if (!project) throw new Error('No project for this JHA.');
    const task = (draft.taskDescription ?? '').trim();
    if (!task) throw new Error('Tell me the task first.');
    const trade = (draft.trade ?? '').trim() || 'General';

    let steps: JHAStep[] = [];
    let requiredPPE: string[] = [];
    try {
      const gen = await mageAI({
        prompt: [
          'You are MAGE Copilot writing a construction Job Hazard Analysis (JHA).',
          `TASK: ${task}`,
          `TRADE: ${trade}`,
          project.name ? `PROJECT: ${project.name}` : '',
          '',
          'Break the task into 3-6 sequential job steps. For EACH step give the',
          'specific hazards present and the controls that mitigate them (jobsite',
          'language, OSHA-aligned — falls, struck-by, caught-in, electrical, etc.).',
          'Then list the required PPE for the task overall. Be concrete, not generic.',
        ].filter(Boolean).join('\n'),
        schemaHint: {
          steps: [{ step: 'Rig and hoist the beam', hazards: ['Struck-by a swinging load', 'Falls from the leading edge'], controls: ['Tag lines on all loads', '100% tie-off at the edge'] }],
          requiredPPE: ['Hard hat', 'Safety glasses', 'Full-body harness'],
        },
        tier: 'smart',
        maxTokens: 1600,
        feature: 'voiceCapture',
      });
      if (gen.success && gen.data) {
        const rawSteps: GenStep[] = Array.isArray((gen.data as { steps?: GenStep[] }).steps) ? (gen.data as { steps: GenStep[] }).steps : [];
        steps = rawSteps
          .filter((s) => typeof s.step === 'string' && s.step.trim())
          .map((s) => ({ id: createId('jstep'), step: (s.step as string).trim(), hazards: asStringList(s.hazards), controls: asStringList(s.controls) }));
        requiredPPE = asStringList((gen.data as { requiredPPE?: unknown }).requiredPPE);
      }
    } catch {
      // fall through to the minimal stub below
    }

    if (steps.length === 0) {
      steps = [{ id: createId('jstep'), step: task, hazards: ['Identify hazards for this task'], controls: ['Review controls with the crew before starting'] }];
    }
    if (requiredPPE.length === 0) requiredPPE = ['Hard hat', 'Safety glasses', 'Work boots', 'Hi-vis vest'];

    const now = new Date().toISOString();
    ctx.safety?.addJha?.({
      id: createId('jha'),
      projectId: ctx.projectId,
      title: (draft.title ?? task).slice(0, 80),
      trade,
      taskDescription: task,
      date: now.slice(0, 10),
      steps,
      requiredPPE,
      signOffs: [],
      aiGenerated: true,
      status: 'draft',
      createdBy: '',
      createdAt: now,
      updatedAt: now,
    });
    return { route: '/safety-jha', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
