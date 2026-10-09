// utils/roomScan/learnCore.ts — what this phone learns from the person's own
// tape, and from what he really buys.
//
// Scan The Room, the order list (lane SCANORDER, dark behind SCAN_ROOM_ENABLED).
// Pure: no React, no storage, no clock.
//
// ── 1. WHAT YOUR TAPE SAYS ──────────────────────────────────────────────────
// Every time he types a taped length over a scanned one, the pair is kept:
// what the scan said, what the tape said, how long the wall is (short, mid or
// long), the phone model when the scan knows it, and the kind of room. From
// the pairs this file works out FACTS, and only facts:
//   how many walls he taped, on how many of them the scan was within one inch,
//   the typical difference (the middle one), and the largest.
// The rules, each pinned by scripts/validate-scan-order.ts:
//   * NO SCORE. There is no percentage and no grade anywhere in the result.
//     The result has counts and inches and nothing else.
//   * NO CLAIM PAST THE PAIRS. The facts are about the walls he taped. Nothing
//     here says anything about a wall, a room or a scan he did not check.
//   * A MINIMUM COUNT. With fewer than MIN_TAPE_PAIRS pairs the result is
//     `enough: false` and carries NO differences at all, so a screen cannot
//     show a number that three walls do not support.
//   * A pair where the tape is more than double or less than half the scan is
//     a wall the scan got wrong outright (a mirror, a doorway read as a wall)
//     or a slip of the thumb. It is counted, said, and left out of the inches.
//
// ── 2. USING IT, AS A SUGGESTION ────────────────────────────────────────────
// When his own long walls (12 ft and over) have taped LONGER than the scan,
// by half an inch or more, on at least three in four of at least
// MIN_LONG_PAIRS walls, `longWallSuggestion` offers to add the typical
// shortfall to each long wall he has NOT taped, in the order list only. It
// returns a suggestion. It changes nothing: the order list reads
// `options.longWallAddIn`, which is set only when he accepts. Scans that run
// LONG get no suggestion: this file never suggests ordering less.
//
// ── 3. BOUGHT VERSUS SCANNED ────────────────────────────────────────────────
// The cost book learns prices from closed jobs (utils/costDatabase). The
// parallel idea for quantities: on a finished job, compare what the order list
// said the room measures for a trade (before waste) with what was really
// bought, and after a few jobs offer his own waste figure: "On your last 4
// jobs you bought about 9 percent more tile than the scan said."
// `wasteFactors` is that maths. IT IS NOT WIRED TO ANY DATA IN THIS LANE. The
// app does not hold bought quantities well enough yet (the reasons, with file
// paths, are in docs/scan-the-room-native-checklist.md), and a learner fed
// with guesses would print a confident wrong number. The tests run it on
// fixtures.

import { metresToInches, tapeFarFromScan } from './units';
import type { RoomScan, RoomType } from './types';

export type LengthClass = 'short' | 'mid' | 'long';
/** Under 6 ft is short, 12 ft and over is long. */
export const SHORT_WALL_M = 6 / 3.28084;
export const LONG_WALL_M = 12 / 3.28084;
export const lengthClass = (m: number): LengthClass => (m >= LONG_WALL_M - 1e-9 ? 'long' : m < SHORT_WALL_M ? 'short' : 'mid');

export interface TapePair {
  scanId: string;
  wallId: string;
  /** What the scan said, metres. */
  scannedM: number;
  /** What the tape said, metres. */
  tapedM: number;
  lengthClass: LengthClass;
  /** The phone model the scan came from, '' when the scan did not say. */
  deviceModel: string;
  roomType: RoomType;
  at: string;
}

/** The fewest taped walls the facts are stated from. */
export const MIN_TAPE_PAIRS = 5;
/** The fewest taped LONG walls a suggestion is made from. */
export const MIN_LONG_PAIRS = 4;
/** A difference smaller than this is not "running short". */
export const LEAN_MIN_IN = 0.5;
/** The most a suggestion ever adds to a wall. */
export const MAX_SUGGEST_IN = 3;
export const WITHIN_IN = 1;
export const MAX_TAPE_PAIRS = 500;

const usable = (m: unknown): m is number => typeof m === 'number' && Number.isFinite(m) && m > 0.025 && m < 61;
const quarter = (inches: number): number => Math.round(inches * 4) / 4;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * The pair a typed wall length makes, or null. `scan` is the scan BEFORE the
 * edit. Only a wall whose length is still the scan's own gives a pair: a wall
 * the app moved to keep the outline closed is not a scan reading. Typing a
 * wall a second time keeps the scan's first number (pass the pairs so far).
 */
export function tapePairFromEdit(scan: RoomScan, wallId: string, tapedM: number, at: string, soFar: readonly TapePair[] = []): TapePair | null {
  const wall = scan.walls.find((w) => w.id === wallId);
  if (!wall || !usable(tapedM)) return null;
  const before = soFar.find((p) => p.scanId === scan.id && p.wallId === wallId);
  const scannedM = before ? before.scannedM : wall.lengthSource === 'scan' ? wall.lengthM : null;
  if (!usable(scannedM)) return null;
  return {
    scanId: scan.id, wallId, scannedM, tapedM,
    lengthClass: lengthClass(scannedM),
    deviceModel: scan.device?.model ?? '',
    roomType: scan.roomType,
    at,
  };
}

/** Put pairs into a list, one per wall of one scan (the newest wins), newest first, capped. */
export function upsertTapePairs(list: readonly TapePair[], add: readonly TapePair[]): TapePair[] {
  const key = (p: TapePair) => `${p.scanId}\u0000${p.wallId}`;
  const fresh = new Map(add.map((p) => [key(p), p]));
  const merged = [...fresh.values(), ...list.filter((p) => !fresh.has(key(p)))];
  return merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, MAX_TAPE_PAIRS);
}

export function removeScanPairs(list: readonly TapePair[], scanId: string): TapePair[] {
  return list.filter((p) => p.scanId !== scanId);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Pairs read back from the phone. Never throws; a row that is not a pair is dropped. */
export function parseTapePairs(raw: unknown): TapePair[] {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return []; } }
  const rows = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.pairs) ? v.pairs : [];
  const out: TapePair[] = [];
  for (const r of rows) {
    if (!isObj(r) || typeof r.scanId !== 'string' || typeof r.wallId !== 'string' || !usable(r.scannedM) || !usable(r.tapedM)) continue;
    out.push({
      scanId: r.scanId, wallId: r.wallId, scannedM: r.scannedM, tapedM: r.tapedM,
      lengthClass: lengthClass(r.scannedM),
      deviceModel: typeof r.deviceModel === 'string' ? r.deviceModel : '',
      roomType: r.roomType === 'bathroom' || r.roomType === 'kitchen' || r.roomType === 'bedroom' ? r.roomType : 'room',
      at: typeof r.at === 'string' ? r.at : '',
    });
  }
  return out;
}

/** Counts and inches. There is no field here that is a share, a rate or a grade. */
export type TapeFacts =
  | { enough: false; count: number; needed: number; farCount: number }
  | {
    enough: true;
    /** Walls he taped that the numbers below are about. */
    count: number;
    /** How many of those the scan was within one inch on. */
    withinCount: number;
    withinIn: number;
    /** The middle difference, inches, to a quarter. */
    typicalIn: number;
    /** The largest difference, inches, to a quarter. */
    largestIn: number;
    /** Walls left out because the tape was more than double or less than half the scan. */
    farCount: number;
    longCount: number;
  };

const diffIn = (p: TapePair): number => metresToInches(p.tapedM - p.scannedM);
const isFar = (p: TapePair): boolean => tapeFarFromScan(p.tapedM, p.scannedM);

export function tapeFacts(pairs: readonly TapePair[]): TapeFacts {
  const far = pairs.filter(isFar);
  const good = pairs.filter((p) => !isFar(p));
  if (good.length < MIN_TAPE_PAIRS) return { enough: false, count: good.length, needed: MIN_TAPE_PAIRS, farCount: far.length };
  const abs = good.map((p) => Math.abs(diffIn(p)));
  return {
    enough: true,
    count: good.length,
    withinCount: abs.filter((d) => d <= WITHIN_IN + 1e-6).length,
    withinIn: WITHIN_IN,
    typicalIn: quarter(median(abs)),
    largestIn: quarter(Math.max(...abs)),
    farCount: far.length,
    longCount: good.filter((p) => p.lengthClass === 'long').length,
  };
}

export interface LongWallSuggestion {
  /** Inches to add to each long wall he has not taped, in the order list only. */
  addIn: number;
  /** Long walls he taped. */
  longCount: number;
  /** How many of them taped longer than the scan by LEAN_MIN_IN or more. */
  shortCount: number;
  /** The middle shortfall on those long walls, inches, to a quarter. */
  typicalIn: number;
}

/**
 * A suggestion to allow a little more on long walls, or null. Read the top of
 * this file for when. This returns words for a card; it changes no quantity.
 */
export function longWallSuggestion(pairs: readonly TapePair[]): LongWallSuggestion | null {
  const long = pairs.filter((p) => !isFar(p) && p.lengthClass === 'long');
  if (long.length < MIN_LONG_PAIRS) return null;
  const diffs = long.map(diffIn);
  const short = diffs.filter((d) => d >= LEAN_MIN_IN - 1e-6);
  if (short.length < Math.ceil(long.length * 0.75)) return null;
  const typical = median(diffs);
  if (typical < LEAN_MIN_IN - 1e-6) return null;
  const addIn = Math.min(MAX_SUGGEST_IN, Math.ceil(typical * 2 - 1e-6) / 2);
  return { addIn, longCount: long.length, shortCount: short.length, typicalIn: quarter(typical) };
}

// ── bought versus scanned (the pure core; not wired to data in this lane) ───
/** One trade on one finished job: what the order list said the room measures, and what was bought, in the SAME unit. */
export interface BoughtRecord {
  jobId: string;
  /** When the job closed, ISO. The newest jobs are the ones read. */
  closedAt: string;
  /** 'tile', 'drywall', 'paint' ... the caller's own key. */
  trade: string;
  unit: string;
  /** The room's quantity from the order list, before any waste. */
  listed: number;
  bought: number;
}

/** The fewest finished jobs a waste figure is stated from. */
export const MIN_WASTE_JOBS = 3;
/** Only the newest few jobs are read, so an old habit does not hide a new one. */
export const MAX_WASTE_JOBS = 6;
/** A job that bought less than three quarters of the list, or more than 1.6 times it, was not the same scope (a missing receipt, extra work). It is set aside and counted. */
export const WASTE_SCOPE_LOW = -0.25;
export const WASTE_SCOPE_HIGH = 0.6;

export interface TradeWaste {
  trade: string;
  unit: string;
  /** Finished jobs the figure is from. */
  jobCount: number;
  /** How much more was bought than the list said, whole percent, the middle job. Can be zero or below. */
  pct: number;
  /** Jobs left out because they did not look like the same scope. */
  setAside: number;
}

/** His own waste by trade, from finished jobs. A trade with fewer than MIN_WASTE_JOBS comparable jobs is not in the result at all. */
export function wasteFactors(records: readonly BoughtRecord[]): TradeWaste[] {
  const norm = (s: string) => s.trim().toLowerCase();
  // One row per job per trade and unit: several receipts on one job add up.
  const jobs = new Map<string, BoughtRecord>();
  for (const r of records) {
    if (!r.jobId || !norm(r.trade) || !norm(r.unit)) continue;
    if (!(Number.isFinite(r.listed) && r.listed > 0) || !(Number.isFinite(r.bought) && r.bought > 0)) continue;
    const k = `${norm(r.trade)}\u0000${norm(r.unit)}\u0000${r.jobId}`;
    const cur = jobs.get(k);
    if (cur) jobs.set(k, { ...cur, listed: cur.listed + r.listed, bought: cur.bought + r.bought, closedAt: cur.closedAt > r.closedAt ? cur.closedAt : r.closedAt });
    else jobs.set(k, { ...r, trade: norm(r.trade), unit: norm(r.unit) });
  }
  const byTrade = new Map<string, BoughtRecord[]>();
  for (const j of jobs.values()) {
    const k = `${j.trade}\u0000${j.unit}`;
    byTrade.set(k, [...(byTrade.get(k) ?? []), j]);
  }
  const out: TradeWaste[] = [];
  for (const rows of byTrade.values()) {
    const newest = [...rows].sort((a, b) => (a.closedAt < b.closedAt ? 1 : a.closedAt > b.closedAt ? -1 : 0));
    const ratios: number[] = [];
    let setAside = 0;
    for (const j of newest) {
      if (ratios.length >= MAX_WASTE_JOBS) break;
      const over = j.bought / j.listed - 1;
      if (over < WASTE_SCOPE_LOW || over > WASTE_SCOPE_HIGH) { setAside += 1; continue; }
      ratios.push(over);
    }
    if (ratios.length < MIN_WASTE_JOBS) continue;
    out.push({ trade: rows[0].trade, unit: rows[0].unit, jobCount: ratios.length, pct: Math.round(median(ratios) * 100), setAside });
  }
  return out.sort((a, b) => a.trade.localeCompare(b.trade) || a.unit.localeCompare(b.unit));
}

/**
 * "Use 9 percent?" for one trade, or null. Offered only when his own figure is
 * above zero and is not the allowance already in use. It is an offer: the
 * order list's allowance changes only when he accepts it.
 */
export function wasteSuggestion(waste: TradeWaste | undefined, currentPct: number): { trade: string; pct: number; jobCount: number } | null {
  if (!waste || waste.jobCount < MIN_WASTE_JOBS || !(waste.pct > 0) || waste.pct === Math.round(currentPct)) return null;
  return { trade: waste.trade, pct: waste.pct, jobCount: waste.jobCount };
}
