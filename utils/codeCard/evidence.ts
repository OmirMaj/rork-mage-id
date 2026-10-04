// utils/codeCard/evidence.ts — what the four-bar evidence meter on a code card
// shows. One bar per rung of utils/codeAmendments.ts, strongest = four bars:
//
//   amended     4 bars  teal   a state register amends THIS section
//   named       3 bars  teal   a government document names THIS section
//   edition     2 bars  grey   model recall; the governing edition is known
//   unresolved  1 bar   grey   model recall; no adoption record here
//   (null)      1 bar   grey   model recall; nothing checked yet
//
// A PARENT MATCH IS NOT BACKING. codeAmendments returns rung 'amended' or
// 'named' with `parentMatch: true` when the record names the PARENT of the
// cited number (R312 for a cited R312.1.3), and its own detail sentence says
// MAGE "did NOT verify" the cited section. So a parent match is drawn exactly
// like "edition known": 2 grey bars and the recall label, in the same place.
// The parent badge and that detail sentence still show on the opened card,
// under the recall label, never instead of it. `sectionIsBacked` is the ONE
// test every code-card surface uses for "may the recall label come off".
//
// Recall stays labelled in the same place at the same size on every card
// ("Model recall · confirm"); only its tone moved from amber to neutral grey
// (founder decision, 2026-10-03), so amber is left for real warnings. The
// badge and the detail sentence are codeAmendments' own words, reused.
//
// Pure: no React, no RN.

import type { CitationEvidence } from '../codeAmendments';

export type EvidenceTone = 'government' | 'recall';

export interface EvidenceView {
  /** 1–4 filled bars. */
  bars: 1 | 2 | 3 | 4;
  tone: EvidenceTone;
  /** The short label on the card's meta line. */
  short: string;
  /** codeAmendments' badge, verbatim (or the null-evidence equivalent). */
  badge: string;
  /** codeAmendments' detail sentence, verbatim (or the null-evidence equivalent). */
  detail: string;
  /** True when the record is about the PARENT section: recall, with a parent badge under it. */
  parent: boolean;
}

/**
 * True only when a government document stands behind the CITED SECTION ITSELF:
 * rung 'amended' or 'named', and not a parent-only match. Everything else is
 * model recall and keeps its label.
 */
export function sectionIsBacked(ev: { rung: string; parentMatch?: boolean } | null | undefined): boolean {
  return !!ev && (ev.rung === 'amended' || ev.rung === 'named') && ev.parentMatch !== true;
}

export const RECALL_LABEL = 'Model recall · confirm';
export const NULL_EVIDENCE_BADGE = 'MODEL RECALL · NOT CHECKED';
export const NULL_EVIDENCE_DETAIL =
  'MAGE has not checked this section against any record for this address. The section number is the model’s own recall.';

export function evidenceView(ev: CitationEvidence | null | undefined): EvidenceView {
  if (!ev) return { bars: 1, tone: 'recall', short: RECALL_LABEL, badge: NULL_EVIDENCE_BADGE, detail: NULL_EVIDENCE_DETAIL, parent: false };
  const own = { badge: ev.badge, detail: ev.detail };
  if ((ev.rung === 'amended' || ev.rung === 'named') && !sectionIsBacked(ev)) {
    return { bars: 2, tone: 'recall', short: RECALL_LABEL, ...own, parent: true };
  }
  switch (ev.rung) {
    case 'amended':
      return { bars: 4, tone: 'government', short: 'State amendment', ...own, parent: false };
    case 'named':
      return { bars: 3, tone: 'government', short: 'Named in law', ...own, parent: false };
    case 'edition':
      return { bars: 2, tone: 'recall', short: RECALL_LABEL, ...own, parent: false };
    default:
      return { bars: 1, tone: 'recall', short: RECALL_LABEL, ...own, parent: false };
  }
}

/** The one word a compact list row has room for when the section is recall. */
export const RECALL_ROW_WORD = 'Recall';

/**
 * The evidence word on a compact list row: the government label ("Named in
 * law", "State amendment") ONLY when the cited section itself is backed;
 * everything else, a parent match included, reads "Recall".
 */
export function rowEvidenceWord(ev: CitationEvidence | null | undefined): string {
  const v = evidenceView(ev);
  return v.tone === 'government' ? v.short : RECALL_ROW_WORD;
}

/** "Model recall · edition known" style: the badge in sentence case, for the sheet. */
export function badgeSentence(badge: string): string {
  const lower = badge.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
