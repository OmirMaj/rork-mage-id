// utils/estimateWizardDesktop.ts — the pure rules behind the one-page estimate
// wizard on desktop web (wave 6d, lane P2; components/estimate/EstimateWizardDesktop).
//
// WHY. On a 1,512 px MacBook the wizard's question view spanned the whole
// window: one question at a time, "Step 1 of 8" and six lines of content on a
// monitor. On desktop web all eight questions sit on one page between an index
// (which step is done, which is still needed) and a rail that echoes what the
// AI will be asked to price. The phone keeps its stepper.
//
// Pure on purpose: scripts/validate-w6d-forms.ts runs these under bun.

import { Layout } from '@/constants/designTokens';
import { SCOPE_STEPS, stepCanAdvance, type WizardAnswers } from '@/utils/scopeQuestions';

/** The narrowest container that still holds index + questions + rail:
 *  220 + 360 + 560 + 2 × 24 = 1188. Below it the rail hides. */
export const WIZARD_RAIL_MIN = Layout.column.index + Layout.column.rail + Layout.sheet.form + 2 * Layout.gutter;

/** Does the "What the AI will price" rail fit a container this wide? */
export function wizardRailFits(w: number): boolean {
  return w >= WIZARD_RAIL_MIN;
}

export type StepState = 'done' | 'needed' | 'optional';

/** One state per SCOPE_STEPS entry, in order:
 *   - required + answered enough to advance → 'done'
 *   - required + not                       → 'needed'
 *   - optional + filled in                  → 'done'
 *   - optional + empty                      → 'optional' */
export function stepStates(answers: WizardAnswers): StepState[] {
  return SCOPE_STEPS.map((s, i) => {
    if (!s.optional) return stepCanAdvance(i, answers) ? 'done' : 'needed';
    const v = answers[s.key];
    return typeof v === 'string' && v.trim().length > 0 ? 'done' : 'optional';
  });
}

/** The first REQUIRED step that cannot advance, or -1 when Generate may run. */
export function firstBlockedStep(answers: WizardAnswers): number {
  return SCOPE_STEPS.findIndex((s, i) => !s.optional && !stepCanAdvance(i, answers));
}

export type FieldSpan = 'full' | 'half';

/** How wide each question would sit in a two-column FormGrid. Only read when
 *  the middle column is >= FORM_GRID_TWO_COL_MIN (1100), which it never is
 *  beside the index and the rail (604-652 px) — kept for the day the rail is
 *  hidden and the column widens. */
export const FIELD_SPAN: Record<keyof WizardAnswers, FieldSpan> = {
  projectType: 'full',
  sizeSqft: 'half',
  location: 'half',
  quality: 'full',
  scope: 'full',
  timelineWeeks: 'half',
  specialRequirements: 'full',
  targetBudget: 'half',
};
