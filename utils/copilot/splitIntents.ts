// utils/copilot/splitIntents.ts — turn ONE spoken update into SEVERAL actions.
//
// The differentiator: a contractor says one breath — "framed the third floor,
// owner wants a heat pump for about $4k, and a guy cut his hand" — and the hub
// recognizes it as a daily report + a change order + a safety incident, then
// routes each to its own interview (seeded with just that action's words). No
// competitor turns one utterance into a fan-out. The pure normalizer + type
// live in intentTable.ts so they stay unit-testable (this file pulls in mageAI).
import { mageAI } from '@/utils/mageAI';
import { INTENTS, normalizeSplitActions, type SplitAction } from './intentTable';

export type { SplitAction };

/** Split one utterance into 1+ actions. One action → route straight through;
 *  several → the hub shows them as a queue to handle. Empty → nothing matched. */
export async function splitIntents(utterance: string): Promise<SplitAction[]> {
  const text = (utterance ?? '').trim();
  if (!text) return [];

  const res = await mageAI({
    prompt: [
      'A contractor said ONE thing that may contain SEVERAL distinct actions.',
      'Split it into separate actions. For EACH, pick the best workflow id and the',
      'exact words for that action only. WORKFLOWS:',
      ...INTENTS.map((i) => `- ${i.id}: ${i.hint}`),
      '',
      'WHAT THEY SAID: ' + text,
      'Return {"actions":[{"capabilityId":"<id>","text":"<words for this action>","label":"<3-5 word summary>"}]}.',
      'If it is really just one action, return exactly one item. Only include an',
      'action if it clearly maps to a workflow above.',
    ].join('\n'),
    schemaHint: { actions: [{ capabilityId: 'daily_report', text: 'framed the third floor', label: 'Log the day' }] },
    tier: 'fast',
    feature: 'voiceCapture',
  });

  if (!res.success) return [];
  return normalizeSplitActions((res.data as { actions?: unknown })?.actions);
}
