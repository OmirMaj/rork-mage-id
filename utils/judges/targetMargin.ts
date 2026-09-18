// utils/judges/targetMargin.ts — the margin Bid Advisor scores a job against,
// and where that number came from. Pure.
//
// WHY THIS EXISTS (audit round 2, #6). app/judges.tsx scored every describe-
// mode job at a hardcoded `targetMargin: 0.2`, and pick mode fell back to the
// same 0.2 whenever the estimate carried no markup (`m > 0 ? m/(1+m) : 0.2`).
// 20% margin is 25% markup: a GC who marks up 15% got a recommended range ~9%
// above what he would quote, a verdict computed at a margin he never picked,
// and — in pick mode — a prediction-ledger row with `targetMarginPct: 20` that
// gradeJudges later graded his real job against. Nothing on the card said the
// number was a guess.
//
// The markup he DID record is one answer in MaterialCartContext
// (globalMarkup + markupDecided — the same one the wizard, Quick Quote and
// takeoff-estimate honor). This resolves, in order:
//   1. pick mode: the picked estimate's own globalMarkup, when > 0 (the price
//      he actually built);
//   2. his saved markup, when markupDecided === true (0 is a real answer —
//      "I quote at cost" — and scores at a 0% margin);
//   3. otherwise BLOCKED, with the reason, never a default.
import { isMarkupSet, marginOf } from '@/utils/estimateMarkup';

export type MarginSource = 'estimate' | 'settings';

export type TargetMarginResolution =
  | { ok: true; targetMargin: number; markupPct: number; source: MarginSource; label: string }
  | { ok: false; reason: string };

export function resolveTargetMargin(input: {
  /** The picked estimate's globalMarkup (pick mode). Omit in describe mode. */
  estimateMarkupPct?: number | null;
  /** MaterialCartContext.globalMarkup */
  savedMarkupPct: number;
  /** MaterialCartContext.markupDecided — null while storage answers. */
  markupDecided: boolean | null;
}): TargetMarginResolution {
  const est = input.estimateMarkupPct;
  if (typeof est === 'number' && Number.isFinite(est) && est > 0) {
    return {
      ok: true, targetMargin: marginOf(est), markupPct: est, source: 'estimate',
      label: `this estimate's ${fmtPct(est)} markup`,
    };
  }
  const saved = input.markupDecided === true ? input.savedMarkupPct : null;
  if (isMarkupSet(saved)) {
    return {
      ok: true, targetMargin: marginOf(saved), markupPct: saved, source: 'settings',
      label: `your ${fmtPct(saved)} markup`,
    };
  }
  return {
    ok: false,
    reason: input.estimateMarkupPct === undefined
      ? 'Set your markup first — Bid Advisor prices the job at the markup you use, and you haven’t told MAGE yours yet.'
      : 'No markup on this estimate or in your settings — set your markup first so the verdict is scored at your number, not a guess.',
  };
}

function fmtPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}
