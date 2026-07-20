// utils/copilot/turnReducer.ts — pure state machine for the Copilot interview.
import type { CopilotState, CopilotAction, CopilotCapabilityId } from './types';

export function initialCopilotState<Draft = any>(capabilityId: CopilotCapabilityId, draft: Draft): CopilotState<Draft> {
  return {
    phase: 'idle', capabilityId, draft,
    grounding: { facts: [], data: {} },
    transcript: [], askedFields: [], currentGap: null, resolved: [],
    questionCount: 0,
  };
}

export function copilotReducer<Draft = any>(s: CopilotState<Draft>, a: CopilotAction<Draft>): CopilotState<Draft> {
  switch (a.type) {
    case 'START':
      return { ...s, phase: 'listening', grounding: a.grounding };
    case 'UTTERANCE':
      return { ...s, phase: 'thinking', transcript: [...s.transcript, { id: a.turnId, text: a.text }] };
    case 'EDIT_TRANSCRIPT':
      return {
        ...s, phase: 'thinking',
        transcript: s.transcript.map(t => t.id === a.turnId ? { ...t, text: a.text, edited: true } : t),
      };
    case 'AI_DRAFT': {
      const resolvedFields = new Set(s.resolved.map(r => r.field));
      const resolved = [...s.resolved, ...a.resolved.filter(r => !resolvedFields.has(r.field))];
      if (a.ready) return { ...s, phase: 'review', draft: a.draft, resolved, currentGap: null };
      if (a.nextGap) return { ...s, phase: 'asking', draft: a.draft, resolved, currentGap: a.nextGap };
      return { ...s, phase: 'confirming', draft: a.draft, resolved, currentGap: null };
    }
    case 'ANSWER':
      // Write the answer straight into the draft — it is authoritative. Relying
      // on the AI to re-extract it from a transcript line only works for fields
      // the capability's prompt happens to extract; a gap-only field (e.g. the
      // DFR critical-task %, which the prompt never asks the model for) would be
      // lost and the same question would re-fire forever. Not appending a raw
      // "field: value" line also keeps the "YOU SAID" chip showing the actual
      // utterance instead of machine text.
      return {
        ...s, phase: 'thinking',
        draft: { ...s.draft, [a.field]: a.value },
        askedFields: s.currentGap ? [...s.askedFields, s.currentGap.field] : s.askedFields,
        questionCount: s.questionCount + 1,
        currentGap: null,
      };
    case 'SKIP_QUESTION':
      return {
        ...s, phase: 'thinking',
        askedFields: s.currentGap ? [...s.askedFields, s.currentGap.field] : s.askedFields,
        questionCount: s.questionCount + 1,
        currentGap: null,
      };
    case 'CONFIRM':
      return { ...s, phase: 'applying' };
    case 'APPLY_OK':
      return { ...s, phase: 'done' };
    case 'APPLY_ERR':
      return { ...s, phase: 'error', errorKind: a.errorKind, errorMessage: a.message };
    case 'CANCEL':
      return initialCopilotState(s.capabilityId, {} as Draft);
    default:
      return s;
  }
}
