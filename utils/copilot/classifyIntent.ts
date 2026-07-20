// utils/copilot/classifyIntent.ts — route a free-form spoken/typed request to the
// right Copilot capability. This is the universal "just tell me what you need"
// entry: one utterance in, a capabilityId out, so a contractor never has to know
// where each feature lives. Reuses the mageAI relay (no new edge fn). The pure
// table + coercion live in intentTable.ts so they stay unit-testable.
import { mageAI } from '@/utils/mageAI';
import { INTENTS, coerceCapabilityId } from './intentTable';
import type { CopilotCapabilityId } from './types';

export interface IntentResult {
  capabilityId: CopilotCapabilityId | null;
  error?: string;
}

/** Classify a free-form request into one capability. Returns null capabilityId
 *  when nothing fits (the caller then shows the pick-a-capability grid). */
export async function classifyIntent(utterance: string): Promise<IntentResult> {
  const text = (utterance ?? '').trim();
  if (!text) return { capabilityId: null };

  const res = await mageAI({
    prompt: [
      'You route a contractor\'s request to ONE workflow. Choose the single best fit.',
      'WORKFLOWS:',
      ...INTENTS.map((i) => `- ${i.id}: ${i.hint}`),
      '',
      'REQUEST: ' + text,
      'Return {"capabilityId":"<id>"} using EXACTLY one id from the list, or',
      '{"capabilityId":null} if none clearly fit.',
    ].join('\n'),
    schemaHint: { capabilityId: 'daily_report' },
    tier: 'fast',
    feature: 'voiceCapture',
  });

  if (!res.success) return { capabilityId: null, error: res.error };
  return { capabilityId: coerceCapabilityId((res.data as { capabilityId?: unknown })?.capabilityId) };
}
