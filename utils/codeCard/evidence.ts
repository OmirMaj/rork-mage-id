// utils/codeCard/evidence.ts — what the four-bar evidence meter on a code card
// shows. One bar per rung of utils/codeAmendments.ts, strongest = four bars:
//
//   amended     4 bars  teal   a state register amends this section
//   named       3 bars  teal   a government document names this section
//   edition     2 bars  grey   model recall; the governing edition is known
//   unresolved  1 bar   grey   model recall; no adoption record here
//   (null)      1 bar   grey   model recall; nothing checked yet
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
}

export const RECALL_LABEL = 'Model recall · confirm';
export const NULL_EVIDENCE_BADGE = 'MODEL RECALL · NOT CHECKED';
export const NULL_EVIDENCE_DETAIL =
  'MAGE has not checked this section against any record for this address. The section number is the model’s own recall.';

export function evidenceView(ev: CitationEvidence | null | undefined): EvidenceView {
  if (!ev) return { bars: 1, tone: 'recall', short: RECALL_LABEL, badge: NULL_EVIDENCE_BADGE, detail: NULL_EVIDENCE_DETAIL };
  switch (ev.rung) {
    case 'amended':
      return { bars: 4, tone: 'government', short: ev.parentMatch ? 'Parent section amended' : 'State amendment', badge: ev.badge, detail: ev.detail };
    case 'named':
      return { bars: 3, tone: 'government', short: ev.parentMatch ? 'Parent section named in law' : 'Named in law', badge: ev.badge, detail: ev.detail };
    case 'edition':
      return { bars: 2, tone: 'recall', short: RECALL_LABEL, badge: ev.badge, detail: ev.detail };
    default:
      return { bars: 1, tone: 'recall', short: RECALL_LABEL, badge: ev.badge, detail: ev.detail };
  }
}

/** "Model recall · edition known" style: the badge in sentence case, for the sheet. */
export function badgeSentence(badge: string): string {
  const lower = badge.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
