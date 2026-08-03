// utils/rfiHoldTime.ts — how long the ball actually sat in the owner's or
// architect's court, folded out of the append-only RFIHandoff chain.
//
// WHY THIS IS NOT ROUND-TRIP TIME
// ------------------------------------------------------------------------
// Caddell Constr. Co. v. United States (Fed. Cl. 2007) is the cautionary
// case. The claimant measured total RFI turnaround "including the time the
// RFIs were in Caddell's hands" and lost on it. Elapsed-time-from-open-to-
// answered is not a claim measure — it is a number that contains the GC's own
// turnaround and therefore proves nothing about the owner's responsiveness.
// The same court also noted that merely issuing a lot of RFIs "is not an
// indication that the plans were defective," so the count is not the claim
// either. The claimable number is HOLD TIME: the summed duration of the
// intervals during which a non-GC party had the ball.
//
// MAGE already captures the input. RFIHandoff (types/index.ts) is an
// append-only custody chain of {fromParty, toParty, at, ...}. Between
// consecutive handoffs the ball is held by handoffs[i].toParty. So hold time
// is a fold over data that already exists — no new capture, no new field.
//
// THE `sub` DECISION — sub time is NOT owner-side.
// ------------------------------------------------------------------------
// RFIBallInCourt is 'gc' | 'architect' | 'engineer' | 'owner' | 'sub' |
// 'closed'. Owner-side is 'architect' | 'engineer' | 'owner' only.
//
// A subcontractor is the GC's own party. Under the standard prime-contract
// structure the GC is answerable for its subs; there is no privity between
// the owner and the sub, and the owner is not the cause of a delay that
// happened inside the GC's own tier. Rolling `sub` into the owner-side figure
// would be exactly the Caddell defect one level down — padding the number
// with time the claimant itself controlled. A defense expert would find it in
// one pass through the handoff log and the whole figure would lose its
// credibility, not just the sub portion.
//
// So `sub` days are counted, reported, and kept OUT of the claim number. They
// are tracked separately from `gc` days rather than merged into them, because
// "I sat on it for nine days" and "my framer sat on it for nine days" are
// different management problems even though they are the same claim answer:
// neither is the owner's fault.
//
// Caveat worth stating out loud: 'architect'/'engineer' are treated as
// owner-side because under the usual design-bid-build arrangement the design
// professional is the owner's agent. On a design-build job where the GC holds
// the design contract, that mapping is wrong and the architect is GC-side.
// MAGE has no field that records the delivery method, so this module does not
// guess — it applies the design-bid-build mapping and the UI labels the figure
// "owner side (architect, engineer, owner)" so a design-build GC can see what
// was counted.
//
// LEGACY ROWS
// ------------------------------------------------------------------------
// `RFI.handoffs` is optional for back-compat. An RFI with no chain yields
// measurable=false and zeroed day counts, and every aggregate excludes it.
// Zero-because-unknown must never be shown as zero-because-nobody-held-it;
// callers must branch on `measurable` before rendering a number.
//
// Pure: no React, no React Native, no network, no ambient clock (`nowMs` is
// injectable). Safe to import from a bun validator script.

import type { RFI, RFIBallInCourt, RFIHandoff } from '@/types';

const MS_PER_DAY = 86_400_000;

/** The parties whose hold time is claimable against the owner. */
export const OWNER_SIDE_PARTIES: readonly RFIBallInCourt[] = ['architect', 'engineer', 'owner'];

/** Which bucket a party's hold time lands in. */
export type HoldSide = 'owner' | 'gc' | 'sub' | 'none';

export function holdSideOf(party: RFIBallInCourt): HoldSide {
  switch (party) {
    case 'architect':
    case 'engineer':
    case 'owner':
      return 'owner';
    case 'gc':
      return 'gc';
    case 'sub':
      return 'sub';
    case 'closed':
      return 'none';
  }
}

export interface RfiHoldSegment {
  /** Who held the ball for this interval. */
  party: RFIBallInCourt;
  side: HoldSide;
  /** Epoch ms the interval opened (the handoff that gave them the ball). */
  fromMs: number;
  /** Epoch ms the interval closed (next handoff, resolution, or `nowMs`). */
  toMs: number;
  /** Interval length in days, rounded for display only. Totals are summed
   *  in milliseconds first — see computeRfiHoldTime. */
  days: number;
  /** True when this interval is still running against `nowMs`. */
  running: boolean;
}

export interface RfiHoldTime {
  /** Days held by architect / engineer / owner. THE claim measure. */
  ownerSideDays: number;
  /** Days held by the GC. The GC's own turnaround — never claimable. */
  gcDays: number;
  /** Days held by a subcontractor. GC-side. Reported, never added to
   *  ownerSideDays. See the header note. */
  subDays: number;
  /** Total elapsed days from dateSubmitted to resolution (or now). This is
   *  the ROUND-TRIP figure. Kept so a surface can show both, clearly
   *  labelled — it is not a claim measure. */
  elapsedDays: number;
  /** False when the RFI has no handoff chain. All day counts above are 0 and
   *  mean UNKNOWN, not zero. Branch on this before rendering. */
  measurable: boolean;
  /** True when an owner-side interval is still running at `nowMs`. */
  accruing: boolean;
  /** Ordered custody intervals. Useful for an audit view. */
  segments: RfiHoldSegment[];
}

export interface RfiHoldOptions {
  /** Injectable clock in epoch ms. Defaults to Date.now(). */
  nowMs?: number;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function toDays(ms: number): number {
  return Math.round(ms / MS_PER_DAY);
}

/** An RFI is still live (accruing) only while its status is 'open'. */
function isLive(status: RFI['status'] | undefined): boolean {
  return status === 'open';
}

type HoldInput = Pick<RFI, 'handoffs' | 'status' | 'dateSubmitted' | 'dateResponded'>;

const EMPTY: RfiHoldTime = {
  ownerSideDays: 0,
  gcDays: 0,
  subDays: 0,
  elapsedDays: 0,
  measurable: false,
  accruing: false,
  segments: [],
};

/**
 * Fold one RFI's handoff chain into per-side hold totals.
 *
 * Interval semantics: after handoff i the ball is with `handoffs[i].toParty`,
 * and it stays there until `handoffs[i+1].at`. The trailing interval runs to
 * `nowMs` while the RFI is open; on a resolved RFI it is closed at
 * `dateResponded` when that is later than the last handoff, otherwise at the
 * last handoff itself (contributing zero). Closing short rather than long is
 * deliberate — a hold figure that over-counts is worth less than one that
 * under-counts, because the whole point is that it survives cross-examination.
 *
 * Bounces sum correctly because the per-side totals accumulate in
 * milliseconds and are converted to days once, at the end.
 */
export function computeRfiHoldTime(rfi: HoldInput, opts: RfiHoldOptions = {}): RfiHoldTime {
  const nowMs = opts.nowMs ?? Date.now();

  const submittedMs = parseMs(rfi?.dateSubmitted);
  const respondedMs = parseMs(rfi?.dateResponded);
  const live = isLive(rfi?.status);

  // Round-trip, for the labelled comparison only.
  const elapsedEnd = live ? nowMs : (respondedMs ?? nowMs);
  const elapsedDays = submittedMs === null ? 0 : Math.max(0, toDays(elapsedEnd - submittedMs));

  const chain: RFIHandoff[] = (rfi?.handoffs ?? [])
    .filter((h): h is RFIHandoff => !!h && parseMs(h.at) !== null)
    // Append-only in practice, but a defensive sort costs nothing and keeps a
    // hand-merged / out-of-order chain from producing negative intervals.
    .slice()
    .sort((a, b) => (parseMs(a.at) as number) - (parseMs(b.at) as number));

  if (chain.length === 0) {
    return { ...EMPTY, elapsedDays, segments: [] };
  }

  const lastMs = parseMs(chain[chain.length - 1].at) as number;
  // Where the trailing interval stops. See the doc comment.
  const tailEnd = live
    ? Math.max(nowMs, lastMs)
    : respondedMs !== null && respondedMs > lastMs
      ? respondedMs
      : lastMs;

  let ownerMs = 0;
  let gcMs = 0;
  let subMs = 0;
  let accruing = false;
  const segments: RfiHoldSegment[] = [];

  for (let i = 0; i < chain.length; i++) {
    const fromMs = parseMs(chain[i].at) as number;
    const isTail = i === chain.length - 1;
    const toMs = isTail ? tailEnd : (parseMs(chain[i + 1].at) as number);
    const span = Math.max(0, toMs - fromMs);
    const party = chain[i].toParty;
    const side = holdSideOf(party);

    if (side === 'owner') ownerMs += span;
    else if (side === 'gc') gcMs += span;
    else if (side === 'sub') subMs += span;

    const running = isTail && live && side !== 'none';
    if (running && side === 'owner') accruing = true;

    segments.push({ party, side, fromMs, toMs, days: toDays(span), running });
  }

  return {
    ownerSideDays: toDays(ownerMs),
    gcDays: toDays(gcMs),
    subDays: toDays(subMs),
    elapsedDays,
    measurable: true,
    accruing,
    segments,
  };
}

export interface RfiHoldSummary {
  /** RFIs with a handoff chain — the only ones in the numbers below. */
  measuredCount: number;
  /** RFIs with no chain. Excluded everywhere, reported so the gap is visible. */
  unmeasurableCount: number;
  totalOwnerSideDays: number;
  medianOwnerSideDays: number;
  maxOwnerSideDays: number;
  /** GC's own turnaround across the same RFIs. Shown to make the exclusion
   *  legible, never added to the owner-side total. */
  totalGcDays: number;
  /** Sub-held days across the same RFIs. GC-side. Same rule. */
  totalSubDays: number;
  /** Open RFIs where an owner-side hold is still running. */
  accruingCount: number;
  /** Prompt/report line, or null when nothing is measurable. */
  factLine: string | null;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Aggregate hold time across a project's RFIs. Legacy rows are excluded from
 *  every figure and counted separately. */
export function summarizeRfiHoldTime(rfis: HoldInput[], opts: RfiHoldOptions = {}): RfiHoldSummary {
  const measured: RfiHoldTime[] = [];
  let unmeasurableCount = 0;

  for (const rfi of rfis ?? []) {
    const h = computeRfiHoldTime(rfi, opts);
    if (h.measurable) measured.push(h);
    else unmeasurableCount++;
  }

  const ownerDays = measured.map(m => m.ownerSideDays);
  const totalOwnerSideDays = ownerDays.reduce((a, b) => a + b, 0);
  const totalGcDays = measured.reduce((a, m) => a + m.gcDays, 0);
  const totalSubDays = measured.reduce((a, m) => a + m.subDays, 0);
  const accruingCount = measured.filter(m => m.accruing).length;

  let factLine: string | null = null;
  if (measured.length > 0) {
    const parts = [
      `Owner-side hold on this project totals ${plural(totalOwnerSideDays, 'day')} across ${plural(measured.length, 'RFI')} with a handoff log (median ${median(ownerDays)}, longest ${ownerDays.length ? Math.max(...ownerDays) : 0}).`,
      `That measures only the time the architect, engineer, or owner held the ball; your own ${plural(totalGcDays, 'day')} of turnaround is excluded.`,
    ];
    if (totalSubDays > 0) {
      parts.push(`${plural(totalSubDays, 'day')} sat with a subcontractor and is counted on your side, not the owner's.`);
    }
    if (unmeasurableCount > 0) {
      parts.push(`${plural(unmeasurableCount, 'RFI')} has no handoff log and is excluded.`);
    }
    factLine = parts.join(' ');
  }

  return {
    measuredCount: measured.length,
    unmeasurableCount,
    totalOwnerSideDays,
    medianOwnerSideDays: median(ownerDays),
    maxOwnerSideDays: ownerDays.length ? Math.max(...ownerDays) : 0,
    totalGcDays,
    totalSubDays,
    accruingCount,
    factLine,
  };
}
