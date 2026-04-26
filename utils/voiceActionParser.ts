// voiceActionParser.ts — universal voice → in-app action.
//
// The GC taps the floating mic anywhere in the app and speaks. We
// transcribe, then this util reads intent and returns a structured
// draft for one of four action kinds:
//
//   - 'rfi'   — Question for the architect / engineer / owner.
//   - 'co'    — Change order; out-of-scope work that changes price.
//   - 'note'  — Internal field note (no formal doc).
//   - 'unsure'— AI couldn't tell; the UI asks the GC to retry / clarify.
//
// The parser also gets a tiny project context (name, type, recent
// schedule items) so it can pick a sensible priority + assignee.

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { Project, ScheduleTask } from '@/types';

export const voiceActionSchema = z.object({
  kind: z.enum(['rfi', 'co', 'note', 'unsure']).catch('unsure').default('unsure'),
  // Why we chose this kind. Surfaces in the confirmation toast so the GC
  // can see the AI's read and quickly correct it.
  reasoning: z.string().default(''),

  // RFI fields
  subject: z.string().default(''),
  question: z.string().default(''),
  priority: z.enum(['low', 'normal', 'urgent']).catch('normal').default('normal'),
  assignedTo: z.string().default(''),

  // Change-order fields
  description: z.string().default(''),
  reason: z.string().default(''),
  changeAmount: z.number().default(0),
  lineItems: z.array(z.object({
    name: z.string().default(''),
    description: z.string().default(''),
    quantity: z.number().default(1),
    unit: z.string().default('lump'),
    unitPrice: z.number().default(0),
  })).default([]),

  // Note fields
  noteBody: z.string().default(''),
});

export type VoiceActionResult = z.infer<typeof voiceActionSchema>;

interface ParseOpts {
  transcript: string;
  project?: Project | null;
}

export async function parseVoiceAction(opts: ParseOpts): Promise<VoiceActionResult> {
  const { transcript, project } = opts;

  // Compact project context — the AI doesn't need the whole project, just
  // enough to set priority + a sensible default assignee.
  const ctxLines: string[] = [];
  if (project) {
    ctxLines.push(`Project: ${project.name}`);
    if (project.type) ctxLines.push(`Type: ${project.type}`);
    if (project.location) ctxLines.push(`Location: ${project.location}`);
    const tasks: ScheduleTask[] = (project.schedule?.tasks ?? []).slice(0, 8);
    if (tasks.length) {
      ctxLines.push('Recent schedule items:');
      for (const t of tasks) {
        ctxLines.push(`  - ${t.title} (${t.phase ?? 'phase ?'}) — ${t.progress}% ${t.status}`);
      }
    }
  } else {
    ctxLines.push('No project context — pick the most likely action kind based on the transcript alone.');
  }

  const aiResult = await mageAI({
    prompt: `You are a construction superintendent's voice assistant. The contractor just dictated something on site. Decide what kind of in-app action they want, then return a structured draft.

KINDS
- rfi: They have a question that needs an answer from architect / engineer / owner. Examples: "ask the architect about the steel beam size", "we need to know the tile pattern", "submit an RFI about knob-and-tube wiring".
- co: Out-of-scope work that needs a change order. Examples: "owner wants the heat pump upgrade", "create a change order for $4,500 to redo the bath tile", "need to add a window in the basement".
- note: Internal field note — no formal document needed. Examples: "remind me to call the inspector tomorrow", "framing on second floor is half done".
- unsure: The intent is ambiguous and the contractor should re-record.

OUTPUT RULES
- For rfi: subject (≤80 chars), question (full re-statement), priority (urgent / normal / low), assignedTo (best guess: "Architect", "Engineer", "Owner", "Inspector", or specific name if mentioned).
- For co: description (≤80 chars), reason ("Owner direction", "Field condition", etc.), changeAmount if explicitly stated (else 0), lineItems if itemized (else empty).
- For note: noteBody (the cleaned-up note text).
- For unsure: leave fields blank, set reasoning.

Always set 'reasoning' to a one-sentence explanation of why you picked this kind, in the contractor's voice ("Sounds like an RFI because…").

CONTEXT
${ctxLines.join('\n')}

TRANSCRIPT
${transcript}`,
    schema: voiceActionSchema,
    schemaHint: {
      kind: 'rfi',
      reasoning: 'Sounds like an RFI because they asked about a spec.',
      subject: 'LVL beam size for kitchen island',
      question: 'What LVL spec should we use for the new kitchen island beam?',
      priority: 'urgent',
      assignedTo: 'Engineer',
      description: '',
      reason: '',
      changeAmount: 0,
      lineItems: [],
      noteBody: '',
    },
    tier: 'fast',
  });

  if (!aiResult.success) {
    return {
      kind: 'unsure',
      reasoning: 'AI is unavailable right now — try again in a moment.',
      subject: '', question: '', priority: 'normal', assignedTo: '',
      description: '', reason: '', changeAmount: 0, lineItems: [],
      noteBody: '',
    };
  }
  return aiResult.data as VoiceActionResult;
}
