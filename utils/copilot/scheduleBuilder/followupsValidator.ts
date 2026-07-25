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
