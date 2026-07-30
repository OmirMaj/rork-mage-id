// utils/coAdvance.ts
//
// Cash on work you've already done — advances against drafted/pending change
// orders.
//
// Why this is only possible here: factoring advances against ALREADY-APPROVED
// invoices, so the money stranded in done-but-unbilled work (especially change
// orders) is untouchable — 84% of contractors report cash-flow problems. MAGE
// (a) auto-drafts those COs from job-site notes, (b) grades how often its leak
// flags actually convert to billed COs, and (c) holds the contractor's full
// job-cost history. That's the "nontraditional data" contract-financing lenders
// want but don't have — so MAGE can price an advance EARLIER in the cycle than
// anyone, on real risk instead of a guess.
//
// SCOPE: this module underwrites and sizes an offer. It moves no money — the
// capital handoff is a partner referral (same pattern as utils/financing.ts).
//
// Pure: no React/network/clock (caller passes nowMs).

export type AdvanceTier = 'strong' | 'moderate' | 'thin' | 'ineligible';

/** Minimum CO size worth advancing against. */
export const MIN_ADVANCE_CO = 1000;
/** Max share of a CO we'd advance (the rest covers approval/dispute risk). */
export const MAX_ADVANCE_RATE = 0.8;

export interface AdvanceInput {
  /** The change order's amount. */
  amount: number;
  /** Days since the CO was drafted. Older + unsent = staler signal. */
  ageDays: number;
  /** Was this CO auto-drafted by MAGE from a leak scan? */
  isAuto: boolean;
  /**
   * The contractor's historical leak→CO conversion rate (0..1) from graded
   * brain_predictions — how often flagged work actually became a billed CO.
   * null when there's not enough graded history yet.
   */
  billedRate: number | null;
  /** How many graded leak scans back that rate (the honesty gate). */
  gradedCount: number;
}

export interface AdvanceOffer {
  tier: AdvanceTier;
  /** Cash we'd advance now. 0 when ineligible. */
  advanceAmount: number;
  /** Share of the CO advanced (0..MAX_ADVANCE_RATE). */
  advanceRate: number;
  /** Fee charged on the advance (dollars). */
  feeAmount: number;
  /** Fee as a fraction of the advance (e.g. 0.03 = 3%). */
  feeRate: number;
  /** Cash the contractor nets today. */
  netToday: number;
  /** Plain-English reason for the tier — shown to the user. */
  reason: string;
}

/** Graded leak scans needed before history can lift you above the base tier. */
const HISTORY_GATE = 5;

/**
 * Size and price an advance against one change order.
 *
 * Underwriting signal, in order of strength:
 *  - billedRate (graded history of flagged work actually converting) — the real
 *    risk signal, only trusted at >= HISTORY_GATE graded scans.
 *  - staleness: a CO sitting undrafted-and-unsent for a long time is riskier.
 *  - size: below MIN_ADVANCE_CO isn't worth the paperwork.
 */
export function buildAdvanceOffer(input: AdvanceInput, _nowMs?: number): AdvanceOffer {
  const { amount, ageDays, billedRate, gradedCount } = input;

  const ineligible = (reason: string): AdvanceOffer => ({
    tier: 'ineligible',
    advanceAmount: 0,
    advanceRate: 0,
    feeAmount: 0,
    feeRate: 0,
    netToday: 0,
    reason,
  });

  if (!(amount > 0)) return ineligible('No amount on this change order yet.');
  if (amount < MIN_ADVANCE_CO) {
    return ineligible(`Change orders under $${MIN_ADVANCE_CO.toLocaleString('en-US')} aren’t worth advancing.`);
  }
  // Very stale drafts (>120d) signal work that never gets billed.
  if (ageDays > 120) return ineligible('This draft is over 120 days old — send it before financing it.');

  const trustworthy = billedRate != null && gradedCount >= HISTORY_GATE;

  let tier: AdvanceTier;
  let advanceRate: number;
  let feeRate: number;
  let reason: string;

  if (trustworthy && (billedRate as number) >= 0.7) {
    tier = 'strong';
    advanceRate = MAX_ADVANCE_RATE;
    feeRate = 0.025;
    reason = `${Math.round((billedRate as number) * 100)}% of your flagged work has billed successfully across ${gradedCount} scans.`;
  } else if (trustworthy && (billedRate as number) >= 0.4) {
    tier = 'moderate';
    advanceRate = 0.6;
    feeRate = 0.035;
    reason = `${Math.round((billedRate as number) * 100)}% of your flagged work has billed across ${gradedCount} scans — solid, not spotless.`;
  } else if (trustworthy) {
    tier = 'thin';
    advanceRate = 0.4;
    feeRate = 0.05;
    reason = `Only ${Math.round((billedRate as number) * 100)}% of your flagged work has billed so far — smaller advance until that improves.`;
  } else {
    // No graded history yet: a conservative base offer, honestly labelled.
    tier = 'thin';
    advanceRate = 0.4;
    feeRate = 0.05;
    reason = `Not enough billing history yet (${gradedCount} of ${HISTORY_GATE} graded) — starting conservative.`;
  }

  // Staleness haircut: 60–120 days trims the advance.
  if (ageDays > 60) {
    advanceRate = Math.max(0.25, advanceRate - 0.15);
    reason += ' Trimmed because this draft has been sitting a while.';
  }

  const advanceAmount = Math.round(amount * advanceRate);
  const feeAmount = Math.round(advanceAmount * feeRate);

  return {
    tier,
    advanceAmount,
    advanceRate,
    feeAmount,
    feeRate,
    netToday: advanceAmount - feeAmount,
    reason,
  };
}

/** Roll a set of offers into one headline number for the card. */
export function totalAdvanceAvailable(offers: AdvanceOffer[]): number {
  return offers.reduce((s, o) => s + o.advanceAmount, 0);
}
