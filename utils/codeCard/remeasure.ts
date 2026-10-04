// utils/codeCard/remeasure.ts — the − / + re-measure belongs to ONE card, as it
// was shown.
//
// Pure: no React, no RN, no storage. scripts/validate-code-cards.ts drives it
// under bun.
//
// WHY. A card's id is made from its words (edition, section, line), so the
// same requirement asked again gets the same id: that is what lets a pin and a
// save still show on it. A re-measure is different. It is one number he
// stepped to, from the number that card showed, against the trigger that card
// showed, on the job that card was asked for. The same line on a LATER answer
// can carry another job number (a 40 in. deck after a 34 in. one), another
// trigger, another job, or no number at all, and an old re-measure laid over
// that card would print a number nobody measured and re-check it.
//
// THE RULE, in one function. Each re-measure remembers what it was stepped
// from:
//   * the job (project id, or none),
//   * the card id,
//   * the card's verdict,
//   * the card's OWN job number (value and unit) at that moment,
//   * the trigger (value, unit, sign).
// `remeasureFor` returns it only for a card that matches on every one of
// those. Anything else gets nothing, so the card shows its own number. A card
// with no job number of its own, or no trigger, never gets one.
//
// The map is session state (a hook's useState); nothing here is stored. Save
// keeps the number `remeasureFor` returns for the card on screen, so what is
// saved is exactly what is shown.
//
// THE SAME RULE FOR THE "SAVED" AND "ON … CHECKLIST" MARKS (`keptIsShown`). A
// card's id is its words, so a saved card or a pin with the same id may be an
// EARLIER card: another verdict, another trigger, another job number. A kept
// card counts as the card on screen only when all three are the same:
//   * the verdict,
//   * the trigger (value, unit, sign), or neither has one,
//   * the job number each one SHOWS (value, unit, where it came from): the
//     re-measure when there is one, else the card's own; or neither has one.
// Anything else and the mark is off: Save / Checklist is ready again and
// replaces the kept copy (both reducers replace by id), so what is kept is
// what is on screen. A step of − / + after a save turns the Saved mark off
// the same way.

import type { CodeCardItem, CodeJobValue, CodeTrigger, CodeVerdict } from './types';
import { canRecheck } from './verdict';

/** One re-measure and the card it was stepped from. */
export interface Remeasure {
  projectId: string | null;
  itemId: string;
  verdict: CodeVerdict;
  /** The card's own job number when he stepped from it. */
  from: { value: number; unit: CodeTrigger['unit'] };
  trigger: CodeTrigger;
  /** The number now on screen. */
  jobValue: CodeJobValue;
}

/** Keyed by card id: one re-measure per id, the latest card that carried it. */
export type RemeasureMap = Readonly<Record<string, Remeasure>>;

export const EMPTY_REMEASURES: RemeasureMap = Object.freeze({});

type RemeasureCard = Pick<CodeCardItem, 'id' | 'verdict' | 'jobValue' | 'trigger'>;
/** What a card states in numbers (see keptIsShown). */
type StatedCard = Pick<CodeCardItem, 'verdict' | 'jobValue' | 'trigger'>;

function sameTrigger(a: CodeTrigger | null | undefined, b: CodeTrigger | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.value === b.value && a.unit === b.unit && a.comparison === b.comparison;
}
function sameShownNumber(a: CodeJobValue | null | undefined, b: CodeJobValue | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.value === b.value && a.unit === b.unit && a.source === b.source;
}

/**
 * Is the kept card (a saved card with its re-measure, or a pin) the card ON
 * SCREEN? `shown` is the re-measure on screen for `item` (remeasureFor), if
 * any. See the rule in the header: the verdict, the trigger and the job number
 * each one shows must all be the same. No kept card, or no card: false.
 */
export function keptIsShown(
  kept: { item: StatedCard; jobValue?: CodeJobValue | null } | null | undefined,
  item: StatedCard | null | undefined,
  shown?: CodeJobValue | null,
): boolean {
  if (!kept || !kept.item || !item) return false;
  if (kept.item.verdict !== item.verdict) return false;
  if (!sameTrigger(kept.item.trigger, item.trigger)) return false;
  return sameShownNumber(kept.jobValue ?? kept.item.jobValue, shown ?? item.jobValue);
}

/** May this card carry a re-measure at all? It needs its own number and a trigger it can be checked against. */
function remeasurable(item: RemeasureCard | null | undefined): item is RemeasureCard & { jobValue: CodeJobValue; trigger: CodeTrigger } {
  return !!item && !!item.jobValue && !!item.trigger && canRecheck(item);
}

/**
 * The map after he stepped `item` to `jobValue` on job `projectId` (null = no
 * job linked). A card that cannot carry a re-measure, or a number in another
 * unit, leaves the map as it was. Stepping back to the card's own number takes
 * the re-measure off.
 */
export function recordRemeasure(
  map: RemeasureMap,
  item: RemeasureCard,
  projectId: string | null | undefined,
  jobValue: CodeJobValue,
): RemeasureMap {
  if (!remeasurable(item) || !jobValue || jobValue.unit !== item.jobValue.unit) return map;
  if (typeof jobValue.value !== 'number' || !Number.isFinite(jobValue.value)) return map;
  const own = item.jobValue;
  const back = jobValue.value === own.value && jobValue.source === own.source && jobValue.sourceLabel === own.sourceLabel;
  if (back) {
    if (!(item.id in map)) return map;
    const next: Record<string, Remeasure> = { ...map };
    delete next[item.id];
    return next;
  }
  return {
    ...map,
    [item.id]: {
      projectId: projectId ?? null,
      itemId: item.id,
      verdict: item.verdict,
      from: { value: own.value, unit: own.unit },
      trigger: { value: item.trigger.value, unit: item.trigger.unit, comparison: item.trigger.comparison },
      jobValue,
    },
  };
}

/**
 * The re-measure that belongs to THIS card on THIS job, or undefined. See the
 * rule in the header: the job, the id, the verdict, the card's own job number
 * and the trigger must all be the ones it was stepped from.
 */
export function remeasureFor(
  item: RemeasureCard | null | undefined,
  projectId: string | null | undefined,
  map: RemeasureMap | null | undefined,
): CodeJobValue | undefined {
  if (!map || !remeasurable(item)) return undefined;
  const r = map[item.id];
  if (!r) return undefined;
  if (r.itemId !== item.id) return undefined;
  if (r.projectId !== (projectId ?? null)) return undefined;
  if (r.verdict !== item.verdict) return undefined;
  if (r.from.value !== item.jobValue.value || r.from.unit !== item.jobValue.unit) return undefined;
  if (r.trigger.value !== item.trigger.value || r.trigger.unit !== item.trigger.unit) return undefined;
  if (r.trigger.comparison !== item.trigger.comparison) return undefined;
  if (r.jobValue.unit !== item.jobValue.unit) return undefined;
  return r.jobValue;
}
