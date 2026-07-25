// utils/copilot/scheduleBuilder/followups.ts — adaptive follow-up generator
// for the AI Schedule Builder interview.
//
// After the contractor answers the scope question, we run ONE fast mageAI call
// that inspects the scope text and returns 0-2 targeted follow-up questions
// keyed to existing ScheduleBuilderAnswers fields — things a scheduler would
// actually probe (structural elements, occupied-during-work nuances, demo
// scope, long-lead items that deserve naming, permit requirements, etc.).
//
// Design constraints:
//   • One call, "fast" tier, ≤300 maxTokens — must not slow the interview.
//   • Returns QuestionSpec objects so ScheduleBuilderInterview can render them
//     through the IDENTICAL pipeline as the static QUESTIONS list.
//   • Degrade silently to zero follow-ups on ANY failure — never block the
//     interview flow.
//   • Scope-length gate: if the contractor's scope is too short to mine we skip
//     the mageAI call entirely and return a "scope too thin" reason instead.
//
// The followup fields MUST be existing ScheduleBuilderAnswers fields so
// downstream answer collection and writeback work without new plumbing.

import { mageAI } from '@/utils/mageAI';
import { stableHash } from '@/utils/stableHash';
import type { QuestionSpec, ScheduleBuilderAnswers } from './questions';
import { ALLOWED_FOLLOWUP_FIELDS, coerceFollowupAnswer } from './followupsValidator';

// Minimum scope length (chars) before we bother hitting the AI.
const MIN_SCOPE_LENGTH = 15;

/** Reason returned when we can tell up-front the scope is too short to mine. */
export type FollowupThinReason =
  | 'scope_too_thin'     // scope under MIN_SCOPE_LENGTH — show a hint to the user
  | null;                // scope is fine, proceed

/** Result from generateFollowups. */
export interface FollowupResult {
  /** 0-2 extra QuestionSpecs to inject after the static questions complete. */
  followups: QuestionSpec[];
  /** Non-null when we short-circuited before calling the AI. */
  thinReason: FollowupThinReason;
}

const ALLOWED_FIELDS = ALLOWED_FOLLOWUP_FIELDS;

const SCHEMA_HINT = {
  followups: [
    {
      field: 'longLead',
      eyebrow: 'PROCUREMENT',
      question: 'Custom cabinets — what\'s the lead time?',
      subtext: 'Lead time sets when install can start.',
      kind: 'text',
      placeholder: 'e.g. 8 weeks',
      skipLabel: 'Skip',
    },
  ],
};

function buildPrompt(scope: string, knownRisks: string | null): string {
  const knownCtx = knownRisks ? `\nKnown risks already captured: "${knownRisks}".` : '';
  return `You are an expert construction scheduler reviewing a project scope to identify 0-2 SHORT follow-up questions that would materially change the schedule — things the contractor's description suggests but doesn't resolve.

SCOPE: "${scope}"${knownCtx}

RULES:
- Return AT MOST 2 follow-ups. Return 0 if the scope resolves everything clearly.
- Only use fields from this allowed list: ${ALLOWED_FIELDS.join(', ')}.
- Each question must be SPECIFIC to what you read in the scope (mention the actual element — "the structural beam" not "any structural work").
- "kind" must be "text" or "choice". For choice, supply 2-3 concrete options.
- "skipLabel" must always be "Skip".
- Do NOT ask about scope, startDate, deadline, sizeSqft, weather, or workDaysPerWeek unless absolutely critical — those are covered by the static questions.
- Do NOT ask about anything already answered.

Return JSON matching the schema exactly.`;
}

/**
 * Generate 0-2 adaptive follow-up questions from the contractor's scope text.
 * Returns the followups array + a thinReason if the scope was too short to mine.
 * Degrades silently to an empty array on any AI or validation failure.
 */
export async function generateFollowups(
  scope: string,
  knownRisks: string | null,
): Promise<FollowupResult> {
  const trimmedScope = scope.trim();

  // Gate: if the scope is too thin, don't waste a call — return reason instead.
  if (trimmedScope.length < MIN_SCOPE_LENGTH) {
    return { followups: [], thinReason: 'scope_too_thin' };
  }

  // Key on the FULL scope + knownRisks content (both are in the prompt): an
  // 80-char prefix collides for long scopes sharing an opening, and omitting
  // knownRisks replayed follow-ups generated without them for 24h.
  const cacheKey = `sb_followups_${stableHash(`${trimmedScope}\n${knownRisks ?? ''}`)}`;

  try {
    const res = await mageAI({
      prompt: buildPrompt(trimmedScope, knownRisks),
      schemaHint: SCHEMA_HINT,
      tier: 'fast',
      maxTokens: 350,
      cacheKey,
      cacheHours: 24,
      feature: 'scheduleBuilder',
    });

    if (!res.success || !res.data) return { followups: [], thinReason: null };

    const raw = res.data?.followups;
    if (!Array.isArray(raw) || raw.length === 0) return { followups: [], thinReason: null };

    // Validate and coerce each returned item into a safe QuestionSpec.
    const validated: QuestionSpec[] = [];
    for (const item of raw.slice(0, 2)) {
      if (typeof item !== 'object' || !item) continue;
      const field = item.field as keyof ScheduleBuilderAnswers;
      if (!ALLOWED_FIELDS.includes(field)) continue;
      if (typeof item.question !== 'string' || !item.question.trim()) continue;
      const kind = item.kind === 'choice' ? 'choice' : 'text';

      const spec: QuestionSpec = {
        field,
        eyebrow: typeof item.eyebrow === 'string' ? item.eyebrow.toUpperCase().slice(0, 40) : 'FOLLOW-UP',
        question: item.question.trim(),
        subtext: typeof item.subtext === 'string' ? item.subtext.trim() : '',
        kind,
        skipLabel: 'Skip',
        ...(kind === 'text' && item.placeholder ? { placeholder: item.placeholder } : {}),
        ...(kind === 'choice' && Array.isArray(item.choices) && item.choices.length >= 2
          ? {
              choices: item.choices.slice(0, 3).map((c: any, i: number) => {
                const label = typeof c.label === 'string' ? c.label : String(c);
                const rawValue = c.value ?? c.label ?? c;
                // Canonicalize enum/number values up front (label "Owners
                // staying" on field occupancy → 'occupied') so a choice tap
                // stores the TYPED value, not the AI's display string. The
                // interview applies the same coercion as a backstop.
                const coerced = coerceFollowupAnswer(field, rawValue);
                return { label, value: coerced.ok ? coerced.value : rawValue, recommended: i === 0 };
              }),
            }
          : kind === 'choice'
          ? undefined
          : {}),
      };

      // Choice questions without valid choices fall back to text.
      if (kind === 'choice' && !spec.choices?.length) {
        (spec as any).kind = 'text';
        delete (spec as any).choices;
      }

      validated.push(spec);
    }

    return { followups: validated, thinReason: null };
  } catch {
    // Any error → degrade to zero follow-ups silently.
    return { followups: [], thinReason: null };
  }
}

// ---------------------------------------------------------------------------
// Pure validator — re-exported from followupsValidator.ts (zero RN deps) so
// the test:builder-followups script can run without touching RN modules.
// ---------------------------------------------------------------------------
export { validateFollowupResponse, type ValidationResult } from './followupsValidator';
