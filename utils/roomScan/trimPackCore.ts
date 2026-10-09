// utils/roomScan/trimPackCore.ts — trim runs to sticks to buy, with the cut list.
//
// Scan The Room, the order list (lane SCANORDER, dark behind SCAN_ROOM_ENABLED).
// Pure. Inches for cuts, feet for the sticks a yard sells (8, 12 and 16 ft).
//
// THE PROBLEM. Each wall run of baseboard or crown, and each leg and head of
// casing, is a length to cut. Sticks come in a few stock lengths. Buy few feet
// and still cut every piece. That is bin packing, which has no fast method
// that is always best.
//
// THE METHOD, in three steps.
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
//    THIS IS NOT ALWAYS THE FEWEST FEET. On random lists it bought more than
//    the best grouping about three times in a hundred. Nothing on screen says
//    it is the fewest.
//
// 3. A SHORT LIST IS SEARCHED. With OPTIMAL_MAX_PIECES pieces or fewer, every
//    way of grouping the pieces into sticks is tried (`fewestFeet` below) and
//    the grouping that buys the fewest feet is used, fewest sticks among
//    equals. `method` is then 'searched', and only then may the screen say
//    that no grouping of these pieces buys fewer feet. That is a statement
//    about grouping these pieces into the stick lengths he chose, with joints
//    cut as in step 1. It says nothing about the room.
//
// THE GUARANTEE: NEVER WORSE THAN ONE STICK PER PIECE. "One stick per piece" is
// buying, for each piece, the shortest stock length that holds it.
//   Sticks:  each stick holds at least one piece: sticks <= pieces.
//   Feet:    the result is compared with one stick per piece and the cheaper
//            of the two is returned (`method` says which), so the feet bought
//            are never more.
// And no cut is ever longer than its stick: step 1 makes every piece at most
// the longest stick, and a stick is only swapped for one that holds its cuts.
// scripts/validate-scan-order.ts checks all of this against figures it works
// out for itself, on every fixture and on a few thousand random lists.
//
// WHAT IT DOES NOT KNOW: the saw kerf, the extra a cope eats, and bad ends on
// a stick. `allowanceIn` adds a fixed length to every piece for those, and is
// shown as an assumption. The mitres on casing are NOT left to that: the
// order list adds the casing's own width to each piece (orderListCore).

export const STOCK_LENGTHS_FT = [8, 12, 16] as const;
export type StockFt = typeof STOCK_LENGTHS_FT[number];

/** The shortest piece a joint may leave at the end of a run. */
export const MIN_JOINT_PIECE_IN = 24;
/** A run shorter than this is not a cut: nobody nails a sliver of baseboard between a casing and a corner. */
export const MIN_RUN_IN = 1;
/** Lists this short are searched for the grouping that buys the fewest feet. 3 to the 10th groupings at most. */
export const OPTIMAL_MAX_PIECES = 10;

const EPS = 1e-6;
const r8 = (n: number): number => Math.round(n * 8) / 8;

export interface TrimRun {
  id: string;
  lengthIn: number;
  /** The wall, door or window this run is on, for the cut list. */
  on: string;
  what: 'wall' | 'leg' | 'head' | 'sill' | 'apron';
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
  /** 'searched' = every grouping was tried and this buys the fewest feet. 'first_fit' = longest piece first, not proven fewest. 'one_per_piece' = packing did not beat one stick per piece, so that is returned. */
  method: 'searched' | 'first_fit' | 'one_per_piece';
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
    if (!Number.isFinite(len) || len < MIN_RUN_IN - EPS) continue;
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

/**
 * The grouping of `cuts` into sticks that buys the fewest feet (fewest sticks
 * among equals), by trying every grouping. Only for short lists: the work
 * grows as 3 to the number of pieces. Returns the groups as lists of indexes.
 */
export function fewestFeet(lengthsIn: readonly number[], stock: readonly number[]): number[][] {
  const n = lengthsIn.length;
  const longestIn = stock[stock.length - 1] * 12;
  const size = 1 << n;
  const sum = new Float64Array(size);
  for (let m = 1; m < size; m++) { const low = m & -m; sum[m] = sum[m ^ low] + lengthsIn[31 - Math.clz32(low)]; }
  // One stick's cost: its feet, and a thousandth so that fewer sticks wins among equal feet.
  const stickCost = (m: number): number => (sum[m] <= longestIn + EPS ? shortestHolding(stock, sum[m]) + 0.001 : Infinity);
  const best = new Float64Array(size).fill(Infinity);
  const pick = new Int32Array(size);
  best[0] = 0;
  for (let m = 1; m < size; m++) {
    const low = m & -m;
    const rest = m ^ low;
    // Every group that holds the lowest piece still unplaced.
    for (let sub = rest; ; sub = (sub - 1) & rest) {
      const group = sub | low;
      const cost = stickCost(group);
      if (cost + best[m ^ group] < best[m] - 1e-9) { best[m] = cost + best[m ^ group]; pick[m] = group; }
      if (sub === 0) break;
    }
  }
  const out: number[][] = [];
  for (let m = size - 1; m > 0; m ^= pick[m]) {
    const group: number[] = [];
    for (let i = 0; i < n; i++) if (pick[m] & (1 << i)) group.push(i);
    out.push(group);
  }
  return out;
}

/** Pack trim runs into the stock lengths he buys. See the top of this file for the method and what it guarantees. */
export function packTrim(runs: readonly TrimRun[], stockFt: readonly number[], allowanceIn = 0): TrimPlan {
  const stock = cleanStock(stockFt);
  const longestIn = stock[stock.length - 1] * 12;
  const allowance = Number.isFinite(allowanceIn) ? Math.min(12, Math.max(0, allowanceIn)) : 0;
  const cuts = splitRuns(runs, longestIn, allowance);
  const joints = cuts.filter((c) => c.part > 1).length;
  const naiveBins = cuts.map((c) => [c]);
  const naive = { stickCount: cuts.length, boughtFt: cuts.reduce((s, c) => s + shortestHolding(stock, c.lengthIn), 0) };
  const sorted = [...cuts].sort((a, b) => b.lengthIn - a.lengthIn);

  let packed: TrimPlan;
  if (sorted.length > 0 && sorted.length <= OPTIMAL_MAX_PIECES) {
    // Step 3: a short list is searched for the grouping that buys the fewest feet.
    const groups = fewestFeet(sorted.map((c) => c.lengthIn), stock);
    packed = finish(stock, groups.map((g) => g.map((i) => sorted[i])), 'searched', naive, allowance, joints);
  } else {
    // Step 2: first fit, longest first, into sticks of the longest stock length.
    const bins: { cuts: TrimCut[]; used: number }[] = [];
    for (const cut of sorted) {
      const bin = bins.find((b) => b.used + cut.lengthIn <= longestIn + EPS);
      if (bin) { bin.cuts.push(cut); bin.used += cut.lengthIn; }
      else bins.push({ cuts: [cut], used: cut.lengthIn });
    }
    packed = finish(stock, bins.map((b) => b.cuts), 'first_fit', naive, allowance, joints);
  }
  if (packed.boughtFt <= naive.boughtFt + EPS && packed.stickCount <= naive.stickCount) return packed;
  return finish(stock, naiveBins, 'one_per_piece', naive, allowance, joints);
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
    if (!Number.isFinite(len) || len < MIN_RUN_IN - EPS) continue;
    const mine = plan.sticks.flatMap((s) => s.cuts).filter((c) => c.runId === run.id);
    const fewest = Math.max(1, Math.ceil((len - EPS) / longestIn));
    if (mine.length !== fewest) problems.push(`run ${run.id} (${len} in) is cut in ${mine.length} pieces, and ${fewest} is the fewest`);
    const got = mine.reduce((s, c) => s + c.lengthIn, 0);
    if (got < len - 1e-3) problems.push(`run ${run.id} needs ${len} in and its cuts add to ${got} in`);
  }
  return problems;
}
