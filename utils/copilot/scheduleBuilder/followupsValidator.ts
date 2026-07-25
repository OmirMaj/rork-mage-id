// utils/copilot/scheduleBuilder/followupsValidator.ts — pure (zero-dep)
// validator for the adaptive follow-up response shape. No React Native imports.
// Used by both followups.ts and the test:builder-followups script.

import type { ScheduleBuilderAnswers } from './questions';

// Fields the AI is allowed to request follow-ups on — must be existing keys in
// ScheduleBuilderAnswers so the answer value slots into the same answers object
// without any new state.
export const ALLOWED_FOLLOWUP_FIELDS: (keyof ScheduleBuilderAnswers)[] = [
  'occupancy',
  'longLead',
  'knownRisks',
  'buffer',
  'crewSize',
  'workDaysPerWeek',
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  coercedCount: number;
}

/**
 * Validates that a raw AI response object coerces cleanly to ≤2 QuestionSpecs
 * with only allowed fields, required string properties, and valid kind values.
 */
export function validateFollowupResponse(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as any).followups)) {
    errors.push('Response must be an object with a "followups" array');
    return { valid: false, errors, coercedCount: 0 };
  }
  const items = (raw as any).followups;
  if (items.length > 2) errors.push(`Too many follow-ups: ${items.length} (max 2)`);
  let coercedCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item !== 'object' || !item) { errors.push(`Item ${i}: not an object`); continue; }
    if (!ALLOWED_FOLLOWUP_FIELDS.includes(item.field)) {
      errors.push(`Item ${i}: field "${item.field}" not in allowed list`);
    }
    if (typeof item.question !== 'string' || !item.question.trim()) {
      errors.push(`Item ${i}: missing question string`);
    }
    if (item.kind !== 'text' && item.kind !== 'choice') {
      errors.push(`Item ${i}: kind must be "text" or "choice"`);
    }
    if (item.kind === 'choice') {
      if (!Array.isArray(item.choices) || item.choices.length < 2) {
        errors.push(`Item ${i}: choice kind requires at least 2 choices`);
      }
    }
    coercedCount++;
  }
  return { valid: errors.length === 0, errors, coercedCount };
}

// ── Per-field answer coercion ───────────────────────────────────────────────
// Dynamic follow-ups are only ever kind 'text' | 'choice', and choice values
// are AI-supplied strings — but ALLOWED_FOLLOWUP_FIELDS includes number- and
// enum-typed answer fields. Without coercion a typed reply like "6 days" is
// stored as a STRING in workDaysPerWeek (poisoning the working-calendar math
// downstream in generateScheduleFromAnswers → CPM weekend masking), and a
// choice value like "Yes, occupied" fails buildAnswersPrompt's strict
// === 'occupied' check — silently grounding the schedule on 'vacant', the
// OPPOSITE of what the user just said. coerceFollowupAnswer maps a raw
// dynamic-followup answer to the field's canonical typed value, or reports
// failure so the caller treats the answer as skipped (defaults win — garbage
// never enters the answers object).

export type CoercedFollowupAnswer =
  | { ok: true; value: string | number }
  | { ok: false };

/** Lenient numeric read (mirrors utils/formatters' parseLenientNumber, kept
 *  local so this module stays dependency-free for the test script): strips
 *  currency symbols/commas/spaces and takes the first decimal — "6 days" → 6,
 *  "5 or 6" → 5, "a few" → null. */
function lenientNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  const m = cleaned.match(/^-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function coerceFollowupAnswer(
  field: keyof ScheduleBuilderAnswers,
  raw: unknown,
): CoercedFollowupAnswer {
  switch (field) {
    case 'crewSize': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? lenientNumber(raw) : null;
      if (n == null || !Number.isFinite(n)) return { ok: false };
      const rounded = Math.round(n);
      // Outside any plausible crew → drop (keep the grounded default).
      if (rounded < 1 || rounded > 100) return { ok: false };
      return { ok: true, value: rounded };
    }
    case 'workDaysPerWeek': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? lenientNumber(raw) : null;
      if (n == null || !Number.isFinite(n)) return { ok: false };
      const rounded = Math.round(n);
      // Calendar domain is 1–7. Never clamp garbage INTO the domain — a
      // mis-parse clamped to 7 would silently disable weekend skipping.
      if (rounded < 1 || rounded > 7) return { ok: false };
      return { ok: true, value: rounded };
    }
    case 'occupancy': {
      if (typeof raw !== 'string') return { ok: false };
      // Negative forms FIRST — "unoccupied" contains "occupied".
      if (/\b(vacant|empty|unoccupied|no\s*one|nobody)\b/i.test(raw)) return { ok: true, value: 'vacant' };
      if (/(occupied|occupant|staying|living|tenant|in\s+the\s+home)/i.test(raw)) return { ok: true, value: 'occupied' };
      return { ok: false };
    }
    case 'buffer': {
      if (typeof raw !== 'string') return { ok: false };
      if (/tight|aggressive|lean/i.test(raw)) return { ok: true, value: 'tight' };
      if (/pad|cushion|extra|conservative/i.test(raw)) return { ok: true, value: 'padded' };
      if (/standard|normal|default/i.test(raw)) return { ok: true, value: 'standard' };
      return { ok: false };
    }
    // Free-text fields — any non-empty string passes through trimmed.
    case 'longLead':
    case 'knownRisks': {
      const s = typeof raw === 'string' ? raw.trim() : '';
      return s ? { ok: true, value: s } : { ok: false };
    }
    default:
      return { ok: false };
  }
}
