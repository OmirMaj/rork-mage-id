// utils/roomScan/trimPackCore.ts — trim runs to sticks to buy, with the cut list.
//
// Scan The Room, the order list (lane SCANORDER, dark behind SCAN_ROOM_ENABLED).
// Pure. Inches for cuts, feet for the sticks a yard sells (8, 12 and 16 ft).
//
// THE PROBLEM. Each wall run of baseboard or crown, and each leg and head of
// casing, is a length to cut. Sticks come in a few stock lengths. Buy the
// fewest feet that cut every piece. That is bin packing, which has no fast
// method that is always best, so this file uses a known good rule of thumb and
// says which.
//
// THE METHOD, in two steps.
//
// 1. FEWEST JOINTS. A run no longer than the longest stick he buys is ONE
//    piece: no joint. A longer run is cut into ceil(run / longest) pieces: full
//    sticks and one remainder. No way of cutting it has fewer pieces, because
//    k pieces of at most `longest` cover at most k times `longest`.
//
// 2. FIRST FIT, LONGEST FIRST ("first-fit decreasing"). Sort the pieces longest
//    first. Put each into the first open stick of the LONGEST stock length that
//    still has room; open a new one only when none does. Then swap every stick
//    for the shortest stock length that still holds what was put in it.
//
// THE GUARANTEE: NEVER WORSE THAN ONE STICK PER PIECE. "One stick per piece" is
// buying, for each piece, the shortest stock length that holds it.
//   Sticks:  a new stick is opened only for a piece that fits no open stick,
//            so each stick holds at least one piece: sticks <= pieces.
//   Feet:    the result is compared with one stick per piece and the cheaper
//            of the two is returned (`method` says which), so the feet bought
//            are never more. (For 8, 12 and 16 ft, first fit already wins or
//            ties every time: two of the shortest stick are as long as the
//            longest, so putting two pieces in one stick cannot cost more than
//            giving each its own.)
// And no cut is ever longer than its stick: step 1 makes every piece at most
// the longest stick, and a stick is only swapped for one that holds its cuts.
// scripts/validate-scan-order.ts checks all three on every fixture and on a
// few thousand random lists.
//
// WHAT IT DOES NOT KNOW: the saw kerf, the extra a mitre or a cope eats, and
// bad ends on a stick. `allowanceIn` adds a fixed length to every piece for
// those, and is shown as an assumption.

export const STOCK_LENGTHS_FT = [8, 12, 16] as const;
export type StockFt = typeof STOCK_LENGTHS_FT[number];

/** The shortest piece a joint may leave at the end of a run. */
export const MIN_JOINT_PIECE_IN = 24;

const EPS = 1e-6;
const r8 = (n: number): number => Math.round(n * 8) / 8;

export interface TrimRun {
  id: string;
  lengthIn: number;
  /** The wall, door or window this run is on, for the cut list. */
  on: string;
  what: 'wall' | 'leg' | 'head' | 'sill';
}

export interface TrimCut {
  runId: string;
  on: string;
  what: TrimRun['what'];
  lengthIn: number;
  /** 1-based part of a run that had to be jointed, and how many parts it has. 1 of 1 for a run in one piece. */
  part: number;
  of: number;
}

export interface TrimStick {
  stockFt: number;
  cuts: TrimCut[];
  usedIn: number;
  /** What is left of the stick after its cuts. */
  dropIn: number;
}

export interface TrimPlan {
  /** The stock lengths the person chose, shortest first. */
  stockFt: number[];
  sticks: TrimStick[];
  /** How many sticks of each stock length, shortest first. Lengths with none are left out. */
  counts: { stockFt: number; count: number }[];
  stickCount: number;
  /** Total feet bought. */
  boughtFt: number;
  /** Total feet of the pieces (with the allowance). */
  cutFt: number;
  /** Joints in runs longer than the longest stick. */
  joints: number;
  pieceCount: number;
  /** 'first_fit' = the packing above. 'one_per_piece' = it did not beat one stick per piece, so that is returned. */
  method: 'first_fit' | 'one_per_piece';
  /** What one stick per piece would have bought, for the comparison on screen and in the tests. */
  onePerPiece: { stickCount: number; boughtFt: number };
  allowanceIn: number;
}

/** The chosen stock lengths, cleaned: known lengths only, shortest first, at least one. */
export function cleanStock(stockFt: readonly number[]): number[] {
  const set = [...new Set(stockFt.filter((n) => (STOCK_LENGTHS_FT as readonly number[]).includes(n)))].sort((a, b) => a - b);
  return set.length ? set : [...STOCK_LENGTHS_FT];
}

/** Step 1: every run as the fewest pieces that the longest stick can cut. */
export function splitRuns(runs: readonly TrimRun[], longestIn: number, allowanceIn = 0): TrimCut[] {
  const cuts: TrimCut[] = [];
  for (const run of runs) {
    const len = r8(run.lengthIn);
    if (!(len > EPS)) continue;
    const of = Math.max(1, Math.ceil((len - EPS) / longestIn));
    // Full sticks first, then the remainder. A remainder shorter than
    // MIN_JOINT_PIECE_IN is lengthened to it and the stick before gives up the
    // difference, so a joint never leaves a sliver at the end of a wall. The
    // number of pieces does not change.
    const parts: number[] = [];
    let left = len;
    for (let part = 1; part <= of; part++) { const raw = part < of ? longestIn : left; parts.push(raw); left -= raw; }
    if (of > 1 && parts[of - 1] < MIN_JOINT_PIECE_IN && parts[of - 2] - (MIN_JOINT_PIECE_IN - parts[of - 1]) >= MIN_JOINT_PIECE_IN) {
      parts[of - 2] -= MIN_JOINT_PIECE_IN - parts[of - 1];
      parts[of - 1] = MIN_JOINT_PIECE_IN;
    }
    // The allowance is added to a piece only where the stick has room for it.
    parts.forEach((raw, i) => cuts.push({ runId: run.id, on: run.on, what: run.what, lengthIn: Math.min(longestIn, r8(raw + allowanceIn)), part: i + 1, of }));
  }
  return cuts;
}

const shortestHolding = (stock: readonly number[], usedIn: number): number =>
  stock.find((ft) => ft * 12 >= usedIn - EPS) ?? stock[stock.length - 1];

function finish(stock: number[], bins: TrimCut[][], method: TrimPlan['method'], naive: TrimPlan['onePerPiece'], allowanceIn: number, joints: number): TrimPlan {
  const sticks: TrimStick[] = bins.map((cuts) => {
    const usedIn = r8(cuts.reduce((s, c) => s + c.lengthIn, 0));
    const stockFt = shortestHolding(stock, usedIn);
    return { stockFt, cuts, usedIn, dropIn: r8(stockFt * 12 - usedIn) };
  }).sort((a, b) => b.stockFt - a.stockFt || b.usedIn - a.usedIn);
  const counts = stock.map((ft) => ({ stockFt: ft, count: sticks.filter((s) => s.stockFt === ft).length })).filter((c) => c.count > 0);
  const pieceCount = sticks.reduce((s, x) => s + x.cuts.length, 0);
  return {
    stockFt: stock, sticks, counts,
    stickCount: sticks.length,
    boughtFt: sticks.reduce((s, x) => s + x.stockFt, 0),
    cutFt: sticks.reduce((s, x) => s + x.usedIn, 0) / 12,
    joints, pieceCount, method, onePerPiece: naive, allowanceIn,
  };
}

/** Pack trim runs into the stock lengths he buys. See the top of this file for the method and what it guarantees. */
export function packTrim(runs: readonly TrimRun[], stockFt: readonly number[], allowanceIn = 0): TrimPlan {
  const stock = cleanStock(stockFt);
  const longestIn = stock[stock.length - 1] * 12;
  const cuts = splitRuns(runs, longestIn, Math.max(0, allowanceIn));
  const joints = cuts.filter((c) => c.part > 1).length;
  const naiveBins = cuts.map((c) => [c]);
  const naive = { stickCount: cuts.length, boughtFt: cuts.reduce((s, c) => s + shortestHolding(stock, c.lengthIn), 0) };

  // Step 2: first fit, longest first, into sticks of the longest stock length.
  const sorted = [...cuts].sort((a, b) => b.lengthIn - a.lengthIn);
  const bins: { cuts: TrimCut[]; used: number }[] = [];
  for (const cut of sorted) {
    const bin = bins.find((b) => b.used + cut.lengthIn <= longestIn + EPS);
    if (bin) { bin.cuts.push(cut); bin.used += cut.lengthIn; }
    else bins.push({ cuts: [cut], used: cut.lengthIn });
  }
  const packed = finish(stock, bins.map((b) => b.cuts), 'first_fit', naive, Math.max(0, allowanceIn), joints);
  if (packed.boughtFt <= naive.boughtFt + EPS && packed.stickCount <= naive.stickCount) return packed;
  return finish(stock, naiveBins, 'one_per_piece', naive, Math.max(0, allowanceIn), joints);
}

/** A sentence for every way a plan breaks its own guarantees. Empty when it keeps them. For the tests. */
export function checkTrimPlan(plan: TrimPlan, runs: readonly TrimRun[]): string[] {
  const problems: string[] = [];
  const longestIn = plan.stockFt[plan.stockFt.length - 1] * 12;
  for (const s of plan.sticks) {
    if (!plan.stockFt.includes(s.stockFt)) problems.push(`a ${s.stockFt} ft stick is not a length he chose`);
    if (s.usedIn > s.stockFt * 12 + 1e-3) problems.push(`the cuts on a ${s.stockFt} ft stick add to ${s.usedIn} in`);
    for (const c of s.cuts) if (c.lengthIn > s.stockFt * 12 + 1e-3) problems.push(`a ${c.lengthIn} in cut is on a ${s.stockFt} ft stick`);
  }
  if (plan.stickCount > plan.onePerPiece.stickCount) problems.push(`${plan.stickCount} sticks is more than one stick per piece (${plan.onePerPiece.stickCount})`);
  if (plan.boughtFt > plan.onePerPiece.boughtFt + 1e-3) problems.push(`${plan.boughtFt} ft bought is more than one stick per piece (${plan.onePerPiece.boughtFt} ft)`);
  for (const run of runs) {
    const len = r8(run.lengthIn);
    if (!(len > EPS)) continue;
    const mine = plan.sticks.flatMap((s) => s.cuts).filter((c) => c.runId === run.id);
    const fewest = Math.max(1, Math.ceil((len - EPS) / longestIn));
    if (mine.length !== fewest) problems.push(`run ${run.id} (${len} in) is cut in ${mine.length} pieces, and ${fewest} is the fewest`);
    const got = mine.reduce((s, c) => s + c.lengthIn, 0);
    if (got < len - 1e-3) problems.push(`run ${run.id} needs ${len} in and its cuts add to ${got} in`);
  }
  return problems;
}
