// fieldMeasuredQuantity.ts — the tape measure reaches the cost book.
//
// THE DEFECT THIS EXISTS TO CLOSE (audit 2026-09-11, F6). The GC stands in the
// room, photographs the wall, types what he measured, and
// components/TakeoffFieldVerifyButton writes it to
// `mageid_takeoff_field::<projectId>` — where, until this module, NOTHING read
// it. A full-repo grep for `measuredQuantity` returned the type that declares
// it, the component that writes it, and the same component printing it back on
// the photo. It was a photo album.
//
// That is a hole in the product's central claim. utils/costDatabase learns a
// unit rate as `cost / l.quantity` — the cost of a closed scope over the
// quantity of that scope — and `l.quantity` is the ESTIMATE LINE quantity,
// which on the takeoff path is whatever the AI read off a PDF. So a plan that
// says 2,400 SF against a wall that is really 2,600 SF teaches a rate 8.3% high
// FOREVER, on a job where the correct denominator was measured with a tape and
// stored two AsyncStorage keys away. "Cost divided by measurement" was cost
// divided by a drawing.
//
// WHY THE ROUTE IS THE TAKEOFF QUANTITY AND NOT A SIDE CHANNEL. There is
// exactly one join key between a field measurement and the quantity the cost
// book divides by: the takeoff row key (`<section>:<id>`), which
// `PersistedTakeoff.overrides` already uses as the quantity of record. Nothing
// carries a takeoff row identity onto an estimate line — utils/takeoffEstimate
// has no rowKey and no materialId — so a parallel "measured quantity" channel
// keyed to estimate lines would mean inventing that key, and would leave the
// BID quantity wrong while claiming to have fixed the rate. Routing through the
// quantity of record fixes both at once, in the order a contractor would: you
// bid what you measured, and the closeout divides the sub's price by what you
// measured.
//
// WHY IT IS NEVER APPLIED SILENTLY. The capture modal's own placeholder is
// `AI says 480` and its note example is "used 25 ft tape" — a GC can quite
// reasonably type a PARTIAL measurement into a row that aggregates a whole
// elevation. Auto-adopting that would divide a sub's contract by 25 instead of
// 480, publish a 19x rate stamped as measured, and be indistinguishable from
// the mobilization-deposit blocker this codebase has already been bitten by.
// So this module decides and describes; it never writes. The write is one
// explicit tap with the delta on screen (the button), and the rows still
// waiting on that decision are counted out loud on the review screen so the
// data cannot go quiet again.
//
// Pure — no storage, no React, no network. Typed on a minimal structural
// shape rather than on `TakeoffFieldVerification` so the guard can execute it.

/** The fields of a takeoff field verification this module needs. */
export interface FieldMeasurement {
  rowKey: string;
  /** What the GC measured on site. Absent when they only took the photo. */
  measuredQuantity?: number;
  /** ISO stamp — newest wins when a row was verified more than once. */
  capturedAt: string;
}

/**
 * How far the tape and the plan may differ and still be called agreement.
 *
 * A JUDGEMENT CALL, NOT A STANDARD — and deliberately the SAME number the
 * verify button already used to colour its delta green
 * (`Math.abs(delta) / Math.max(1, quantity) < 0.05`), so one threshold governs
 * what the contractor sees and what the app does about it. 5% is inside the
 * noise of either input: a scaled PDF read and a tape run by one person over a
 * bowed wall. Below it there is nothing to decide; above it the plan and the
 * field disagree about the size of the job and somebody has to say which one
 * prices the work.
 */
export const MEASUREMENT_AGREEMENT_TOLERANCE = 0.05;

/**
 * The denominator of `deltaPct` is `max(1, current)`, carried over from the
 * button's own tone maths: it keeps a row the AI read as 0 (or as a fraction)
 * from dividing by ~nothing and reporting an infinite disagreement. The cost
 * of it is that a 1-vs-2 door count reads as 100% rather than as a doubling,
 * which is the correct direction anyway — that row DOES disagree.
 */
function deltaFraction(current: number, measured: number): number {
  return Math.abs(measured - current) / Math.max(1, current);
}

export type MeasurementVerdict =
  /** No usable number was captured — a photo, or a blank/garbage input. */
  | { kind: 'none' }
  /** The tape confirms the plan. Nothing to apply. */
  | { kind: 'agrees'; measured: number; delta: number; deltaPct: number }
  /** The tape and the plan disagree about the size of this scope. */
  | { kind: 'disagrees'; measured: number; delta: number; deltaPct: number };

/**
 * What, if anything, a field measurement says about the quantity currently of
 * record for its row.
 *
 * `current` is the quantity the app is pricing RIGHT NOW — the override if the
 * GC has already edited the row, else the AI's read. It is not "the AI value":
 * the verify button is handed the override-aware number, and a measurement that
 * has already been adopted must read as agreement rather than offering itself a
 * second time.
 *
 * A non-finite or non-positive measurement is 'none'. Zero is deliberately not
 * a measurement: the capture modal parses an empty box to NaN, and a row whose
 * real quantity is nothing is expressed by rejecting the row (which the takeoff
 * screen already supports), not by pricing a sub's contract over zero units.
 */
export function measurementVerdict(
  current: number,
  m: Pick<FieldMeasurement, 'measuredQuantity'> | undefined,
): MeasurementVerdict {
  const measured = m?.measuredQuantity;
  if (typeof measured !== 'number' || !Number.isFinite(measured) || measured <= 0) {
    return { kind: 'none' };
  }
  if (!Number.isFinite(current)) return { kind: 'none' };
  const delta = measured - current;
  const deltaPct = deltaFraction(current, measured);
  return {
    kind: deltaPct <= MEASUREMENT_AGREEMENT_TOLERANCE ? 'agrees' : 'disagrees',
    measured,
    delta,
    deltaPct,
  };
}

/** Newest capture per row. Storage is newest-first, but nothing guarantees it
 *  stays that way, so the stamp decides rather than the array order. */
export function latestMeasurementByRow<T extends FieldMeasurement>(
  verifications: T[],
): Map<string, T> {
  const out = new Map<string, T>();
  for (const v of verifications) {
    const held = out.get(v.rowKey);
    if (!held || (v.capturedAt || '') > (held.capturedAt || '')) out.set(v.rowKey, v);
  }
  return out;
}

export interface PendingMeasuredRow {
  rowKey: string;
  /** The quantity that is pricing this scope, and that the cost book will
   *  divide a closed commitment by if nothing changes. */
  currentQuantity: number;
  measuredQuantity: number;
  /** measured − current. Positive = the field found MORE than the plan. */
  delta: number;
  deltaPct: number;
}

/**
 * Rows where a field measurement disagrees with the quantity of record — i.e.
 * the rows whose price, and whose contribution to the learned rate, are still
 * resting on the drawing rather than on the tape.
 *
 * `quantityOfRecord` returns null for a row that is not being priced at all
 * (rejected, or gone from the takeoff since the photo was taken); those rows
 * teach the cost book nothing, so an unapplied measurement on them is not a
 * pending decision.
 */
export function pendingMeasuredRows(args: {
  verifications: FieldMeasurement[];
  quantityOfRecord: (rowKey: string) => number | null;
}): PendingMeasuredRow[] {
  const out: PendingMeasuredRow[] = [];
  for (const [rowKey, m] of latestMeasurementByRow(args.verifications)) {
    const current = args.quantityOfRecord(rowKey);
    if (current == null) continue;
    const v = measurementVerdict(current, m);
    if (v.kind !== 'disagrees') continue;
    out.push({
      rowKey,
      currentQuantity: current,
      measuredQuantity: v.measured,
      delta: v.delta,
      deltaPct: v.deltaPct,
    });
  }
  // Biggest disagreement first — that is the row most worth a decision.
  return out.sort((a, b) => b.deltaPct - a.deltaPct || (a.rowKey < b.rowKey ? -1 : 1));
}

/** "2,600 LF" — the measurement, for a button that adopts it. */
export function formatMeasured(measured: number, unit: string): string {
  const n = Number.isInteger(measured)
    ? measured.toLocaleString()
    : measured.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${n} ${unit}` : n;
}

/**
 * The label on the adopt button, and the sentence under it.
 *
 * The copy lives here rather than in the component for one reason: it is the
 * only place that may promise the cost-book consequence, and a guard that
 * pins the promise has to be able to execute the thing that makes it. The
 * sentence names both halves of what the tap does, because the second half is
 * the whole point of the fix and is invisible on this screen.
 */
export function adoptMeasurementCopy(measured: number, unit: string): {
  label: string;
  consequence: string;
} {
  return {
    label: `Use ${formatMeasured(measured, unit)} as the quantity`,
    consequence:
      'Prices this scope off what you measured — and when the job closes, your '
      + 'cost book divides the sub’s price by the measured quantity instead of the plan’s.',
  };
}

/** Everything the adopt control needs, or null when there is nothing to offer. */
export interface AdoptOffer {
  measured: number;
  delta: number;
  deltaPct: number;
  label: string;
  consequence: string;
}

/**
 * WHETHER THE TAP IS OFFERED AT ALL — the decision itself, not a description of
 * it, so a guard can execute it instead of grepping the component for a call.
 *
 * The component used to make this decision inline (`verdict.kind === 'disagrees'
 * && onUseMeasured ? … : null`), which meant the one rule that decides whether
 * F6 is closed on screen was pinned only by a regex over JSX. A regex cannot
 * see a `return` above it and cannot see the second clause go inverted; this
 * function can be run.
 *
 * `canAdopt` is false when no writer was wired in. That case is not a
 * degradation to a read-only view — it IS the defect F6 named, a measurement
 * that goes to storage and comes back as a caption — so it is stated here as a
 * rule and asserted, rather than left as an optional-prop accident.
 */
export function adoptOffer(
  verdict: MeasurementVerdict,
  unit: string,
  canAdopt: boolean,
): AdoptOffer | null {
  if (verdict.kind !== 'disagrees' || !canAdopt) return null;
  const { label, consequence } = adoptMeasurementCopy(verdict.measured, unit);
  return {
    measured: verdict.measured,
    delta: verdict.delta,
    deltaPct: verdict.deltaPct,
    label,
    consequence,
  };
}

/** The review-screen notice: how many rows are still priced off the drawing. */
export function pendingMeasuredNotice(count: number): string {
  if (count <= 0) return '';
  const rows = count === 1 ? '1 row' : `${count} rows`;
  const verb = count === 1 ? 'was' : 'were';
  return `${rows} ${verb} measured on site and ${count === 1 ? 'disagrees' : 'disagree'} with the plan. `
    + 'Until you apply the measurement, the estimate — and the rate this job teaches your cost book — '
    + 'use the plan quantity.';
}
