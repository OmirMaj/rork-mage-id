// utils/codeCard/summary.ts — the list-level words and groups for a code-card
// list: the headline, the tally squares, By status / By inspection groups and
// the bulk-button labels.
//
// Pure: no React, no RN. scripts/validate-code-cards.ts drives it under bun.

import type { CodeCardItem, CodeCardStatus, CodeStage } from './types';
import { CODE_STAGES, stageLabel } from './verdict';
import { architectFixRows } from './shareText';

export interface CodeTally {
  fix: number;
  ask: number;
  ok: number;
  /** Items with no plan-check status (Ask answers). */
  none: number;
  total: number;
}

export function tallyFor(items: readonly CodeCardItem[]): CodeTally {
  const t: CodeTally = { fix: 0, ask: 0, ok: 0, none: 0, total: items.length };
  for (const i of items) {
    if (i.status === 'fix') t.fix++;
    else if (i.status === 'ask') t.ask++;
    else if (i.status === 'ok') t.ok++;
    else t.none++;
  }
  return t;
}

/** A plan-check list: at least one item carries a status. */
export function isPlanCheck(items: readonly CodeCardItem[]): boolean {
  return items.some((i) => !!i.status);
}

/** The tally squares, in order: fixes, then asks, then look-right. */
export function tallySquares(items: readonly CodeCardItem[]): CodeCardStatus[] {
  const t = tallyFor(items);
  return [
    ...Array<CodeCardStatus>(t.fix).fill('fix'),
    ...Array<CodeCardStatus>(t.ask).fill('ask'),
    ...Array<CodeCardStatus>(t.ok).fill('ok'),
  ];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 things to fix before you submit." + "2 need an answer first. 5 look right on the drawing." */
export function planHeadline(items: readonly CodeCardItem[]): { headline: string; subline: string } {
  const t = tallyFor(items);
  const headline = t.fix > 0
    ? `${plural(t.fix, 'thing', 'things')} to fix before you submit.`
    : 'Nothing to fix on the drawing.';
  const bits: string[] = [];
  if (t.ask > 0) bits.push(`${t.ask} ${t.ask === 1 ? 'needs' : 'need'} an answer first.`);
  if (t.ok > 0) bits.push(`${t.ok} ${t.ok === 1 ? 'looks' : 'look'} right on the drawing.`);
  return { headline, subline: bits.join(' ') };
}

/** "3 requirements" for an Ask answer's section head. */
export function requirementsCount(items: readonly CodeCardItem[]): string {
  return plural(items.length, 'requirement', 'requirements');
}

export interface CodeGroup<K extends string> {
  key: K;
  label: string;
  items: CodeCardItem[];
}

export const STATUS_GROUP_LABEL: Readonly<Record<CodeCardStatus, string>> = Object.freeze({
  fix: 'Fix before you submit',
  ask: 'Needs an answer',
  ok: 'Look right on the drawing',
});

const STATUS_ORDER: readonly CodeCardStatus[] = ['fix', 'ask', 'ok'];

/** By status: fix, ask, ok; empty groups dropped; items with no status last, under "Other items". */
export function groupByStatus(items: readonly CodeCardItem[]): CodeGroup<CodeCardStatus | 'none'>[] {
  const groups: CodeGroup<CodeCardStatus | 'none'>[] = STATUS_ORDER.map((key) => ({
    key,
    label: STATUS_GROUP_LABEL[key],
    items: items.filter((i) => i.status === key),
  }));
  groups.push({ key: 'none', label: 'Other Items', items: items.filter((i) => !i.status) });
  return groups.filter((g) => g.items.length > 0);
}

function statusRank(s: CodeCardStatus | undefined): number {
  return s === 'fix' ? 0 : s === 'ask' ? 1 : s === 'ok' ? 2 : 3;
}

/**
 * By inspection: one group per stage in inspection order (footing → final),
 * fixes first inside each; items with no stage go under "Inspection not set".
 * `stageOf` lets a caller apply the contractor's own edits over the AI guess.
 */
export function groupByStage(
  items: readonly CodeCardItem[],
  stageOf: (i: CodeCardItem) => CodeStage | undefined = (i) => i.stage,
): CodeGroup<CodeStage | 'unset'>[] {
  const sort = (list: CodeCardItem[]) => list
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => statusRank(a.item.status) - statusRank(b.item.status) || a.idx - b.idx)
    .map((x) => x.item);
  const groups: CodeGroup<CodeStage | 'unset'>[] = CODE_STAGES.map((stage) => ({
    key: stage,
    label: stageLabel(stage),
    items: sort(items.filter((i) => stageOf(i) === stage)),
  }));
  groups.push({ key: 'unset', label: 'Inspection Not Set', items: sort(items.filter((i) => !stageOf(i))) });
  return groups.filter((g) => g.items.length > 0);
}

/** The one stage every item shares, or null. */
export function sharedStage(items: readonly CodeCardItem[]): CodeStage | null {
  if (items.length === 0) return null;
  const first = items[0].stage;
  if (!first) return null;
  return items.every((i) => i.stage === first) ? first : null;
}

/** "Add all 3 to Final inspection" / "Add all 3 to their inspections" / "Add to Final inspection". */
export function addAllLabel(items: readonly CodeCardItem[]): string {
  const stage = sharedStage(items);
  const target = stage ? `${stageLabel(stage)} inspection` : 'their inspections';
  if (items.length === 1) return stage ? `Add to ${target}` : 'Add to its inspection';
  return `Add all ${items.length} to ${target}`;
}

/** "Send 3 fixes + 1 question to architect"; null when there is nothing to send. */
export function architectButtonLabel(items: readonly CodeCardItem[]): string | null {
  // The rows the email can list (a stand-in row with no section is not one).
  const fixes = architectFixRows(items).length;
  const questions = items.filter((i) => i.status === 'ask' && (i.question ?? '').trim()).length;
  if (fixes === 0 && questions === 0) return null;
  const parts: string[] = [];
  if (fixes) parts.push(plural(fixes, 'fix', 'fixes'));
  if (questions) parts.push(plural(questions, 'question', 'questions'));
  return `Send ${parts.join(' + ')} to architect`;
}

export const ARCHITECT_BLOCKED = 'Nothing to send yet: no fixes and no questions for the architect on this check.';
