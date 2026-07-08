// inspectionScore.ts — pure inspection scoring + derivations.
// No React Native imports.
//
//  - scoreInspection: pass / (pass+fail); N/A items are excluded from the
//    denominator. An inspection with nothing scored (all N/A or empty) returns
//    score 1 ("nothing failed"), documented so the UI can badge it distinctly.
//  - inspectionItemsFromTemplate: turn a form template's ordered fields into a
//    fresh checklist (every item starts 'na').
//  - hazardFromFailedItem: build a Wave-A Hazard draft from a failed item; the
//    "log as hazard" affordance hands this to SafetyContext.addHazard.

import type { InspectionItem, Hazard } from '@/types';

export interface InspectionScore {
  pass: number;
  fail: number;
  na: number;
  total: number;
  /** pass / (pass + fail); 1 when nothing was scored. */
  score: number;
}

export function scoreInspection(items: InspectionItem[]): InspectionScore {
  let pass = 0, fail = 0, na = 0;
  for (const it of items) {
    if (it.result === 'pass') pass++;
    else if (it.result === 'fail') fail++;
    else na++;
  }
  const scored = pass + fail;
  const score = scored === 0 ? 1 : pass / scored;
  return { pass, fail, na, total: items.length, score };
}

/** Derive a fresh checklist from a template's ordered fields. Each item
 *  starts 'na'. makeId supplies unique ids (generateUUID in the app). */
export function inspectionItemsFromTemplate(
  template: { fields: { id: string; label: string }[] },
  makeId: () => string,
): InspectionItem[] {
  return template.fields.map((f) => ({
    id: makeId(),
    prompt: f.label,
    result: 'na' as const,
  }));
}

/**
 * Build a Hazard draft from a failed inspection item. Severity/likelihood
 * default to a mid 3×3 (riskScore 9) — a failed safety-inspection line is a
 * known deficiency, not a speculative risk; the inspector can adjust before
 * saving. riskScore mirrors the Wave-A risk matrix (severity × likelihood).
 */
export function hazardFromFailedItem(
  inspection: { id: string; projectId: string; createdBy: string },
  item: InspectionItem,
  now: string,
  id: string,
): Hazard {
  return {
    id,
    projectId: inspection.projectId,
    description: item.prompt,
    location: '',
    photoUrl: item.photoUrl,
    severity: 3,
    likelihood: 3,
    riskScore: 9,
    correctiveAction: item.note,
    status: 'open',
    sourceInspectionId: inspection.id,
    createdAt: now,
    updatedAt: now,
    createdBy: inspection.createdBy,
  };
}
