// utils/copilot/toolbox/toolboxGaps.ts — Toolbox Talk interview gap rules.
//
// A toolbox talk needs exactly one thing before MAGE can write it: the topic.
// The moat is WHERE the topic comes from — the interview offers topics grounded
// in this job's own recent incidents and open hazards ("turn Tuesday's near-miss
// into today's talk") ahead of evergreen fallbacks, so the daily safety meeting
// is about what's actually biting this crew. Pure — no mageAI/RN imports.
import type { Gap, Grounding } from '../types';

export interface ToolboxDraft {
  topic?: string | null;
  presenter?: string | null;
  /** ToolboxTopicSource — kept loose (string) to stay RN/type-free here. */
  source?: string | null;
}

export interface SuggestedTopic { label: string; value: string; basis: string; source: string }

/** Always-available topics when the job has no recent incidents/hazards to
 *  learn from — ordered by how universal the exposure is. */
const EVERGREEN: SuggestedTopic[] = [
  { label: 'Fall protection', value: 'Fall protection', basis: 'the #1 OSHA citation, every year', source: 'manual' },
  { label: 'Ladders & scaffolds', value: 'Ladder and scaffold safety', basis: 'daily exposure on most sites', source: 'manual' },
  { label: 'Housekeeping & trip hazards', value: 'Housekeeping and trip hazards', basis: 'keeps the deck clear', source: 'manual' },
  { label: 'PPE — right gear for today', value: 'PPE — the right gear for today', basis: 'a quick daily reset', source: 'manual' },
];

const MAX_CHOICES = 5;

export function toolboxGaps(draft: ToolboxDraft, grounding: Grounding): Gap[] {
  if (draft.topic != null) return [];

  const suggested = Array.isArray((grounding.data as { suggestedTopics?: unknown })?.suggestedTopics)
    ? ((grounding.data as { suggestedTopics: SuggestedTopic[] }).suggestedTopics)
    : [];

  const seen = new Set<string>();
  const merged: SuggestedTopic[] = [];
  for (const s of [...suggested, ...EVERGREEN]) {
    const key = s.value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(s);
    if (merged.length >= MAX_CHOICES) break;
  }

  const top = merged[0];
  return [{
    field: 'topic', impact: 0.7, kind: 'choice',
    question: 'What’s today’s topic?',
    groundedDefault: {
      value: top?.value ?? 'Fall protection',
      basis: top?.basis ?? 'the #1 OSHA citation',
    },
    choices: merged.map((s, i) => ({ label: s.label, value: s.value, basis: s.basis, recommended: i === 0 })),
  }];
}
