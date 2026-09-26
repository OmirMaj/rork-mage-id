// utils/takeoff/conditions.ts — the desktop takeoff's pure core (wave 4).
//
// A CONDITION is one thing he is measuring ("5/8 drywall", "LVT flooring",
// "Duplex outlets") with a kind (area / linear / count), a trade that keys his
// cost book, a waste factor and an optional rate he typed. MEASUREMENTS are the
// shapes drawn for it, on any sheet. This file turns the two into quantities
// and money. No React, no storage, no network — scripts/validate-takeoff-
// conditions.ts executes it.
//
// ── ONE REFERENCE FRAME ─────────────────────────────────────────────────────
// Every measurement is measured in a FIXED frame, REF_W wide and REF_W/aspect
// tall, where `aspect` is the sheet image's width/height captured when it was
// drawn and stored ON the measurement. feetPerPixel scales inversely with the
// frame, so the answer is the phone screen's (which measures in the displayed
// image rect) for the same calibration — and zoom, pan, window size, and which
// sheet happens to be open never change a number.
//
// ── MONEY ───────────────────────────────────────────────────────────────────
// The panel prices exactly what the push writes: qty = pushQuantity (the
// phone's rounding rule), rateCents = the rate on the cent grid, amountCents =
// qty × rateCents (an integer). utils/takeoff/conditionPush writes the same
// qty and rateCents / 100, so the footer and the estimate agree to the cent.
// "No rate" is null everywhere, never $0.

import {
  feetPerPixel, polygonAreaSqFt, polylineLengthFt, type NormPoint,
} from '@/utils/takeoffGeometry';
import type { CostBookEntry, CostDatabase } from '@/utils/costDatabase';
import { priceTakeoff } from '@/utils/takeoffEstimate';
import { TAKEOFF_CONDITION_PALETTE } from '@/constants/colors';

export type ConditionKind = 'area' | 'linear' | 'count';

export const KIND_UNIT: Record<ConditionKind, 'SF' | 'LF' | 'EA'> = { area: 'SF', linear: 'LF', count: 'EA' };

export const WASTE_STEPS = [0, 5, 10, 15, 20] as const;
export type WastePct = typeof WASTE_STEPS[number];

export interface TakeoffCondition {
  id: string;
  name: string;
  kind: ConditionKind;
  trade: string | null;
  /** $/unit he typed; wins over the cost book when set. null = use the book. */
  rateOverride: number | null;
  wastePct: WastePct;
  heightFt: number | null;
  color: string;
  createdAt: string;
}

export interface TakeoffMeasurement {
  id: string;
  conditionId: string;
  sheetId: string;
  kind: ConditionKind;
  points: NormPoint[];
  createdAt: string;
  /** The sheet image's width/height at the moment it was drawn (T2 reads it with Image.getSize before
   *  any tool is enabled). Stored ON the measurement, so a quantity never depends on a sheet being
   *  open, loaded or even still on this device. A row without a finite aspect > 0 is malformed and
   *  dropped by parseTakeoffDoc. */
  aspect: number;
}

export interface TakeoffDoc {
  version: 1;
  conditions: TakeoffCondition[];
  measurements: TakeoffMeasurement[];
  /** conditionId → the estimate line's materialId the last push wrote (the §G fallback match). */
  pushed: Record<string, string>;
  lastPush?: { at: string; projectId: string; before: number; after: number; added: number; updated: number };
}

/** Frozen all the way down: a caller that mutates it instead of returning a
 *  new doc from update() throws instead of leaking rows between jobs. */
export const EMPTY_TAKEOFF_DOC: TakeoffDoc = Object.freeze({
  version: 1,
  conditions: Object.freeze([]) as unknown as TakeoffCondition[],
  measurements: Object.freeze([]) as unknown as TakeoffMeasurement[],
  pushed: Object.freeze({}) as Record<string, string>,
}) as TakeoffDoc;

// ── parse (never throws; drops malformed rows) ─────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isKind = (v: unknown): v is ConditionKind => v === 'area' || v === 'linear' || v === 'count';

function parseCondition(r: unknown): TakeoffCondition | null {
  if (!isObj(r)) return null;
  if (!isNonEmptyStr(r.id) || !isStr(r.name) || !isKind(r.kind)) return null;
  const trade = isNonEmptyStr(r.trade) ? r.trade : null;
  const rateOverride = isFiniteNum(r.rateOverride) && r.rateOverride > 0 ? r.rateOverride : null;
  const wastePct = (WASTE_STEPS as readonly number[]).includes(r.wastePct as number) ? (r.wastePct as WastePct) : 0;
  const heightFt = isFiniteNum(r.heightFt) && r.heightFt > 0 ? r.heightFt : null;
  const color = isNonEmptyStr(r.color) ? r.color : TAKEOFF_CONDITION_PALETTE[0];
  const createdAt = isStr(r.createdAt) ? r.createdAt : '';
  return { id: r.id, name: r.name, kind: r.kind, trade, rateOverride, wastePct, heightFt, color, createdAt };
}

function parsePoint(p: unknown): NormPoint | null {
  if (!isObj(p) || !isFiniteNum(p.x) || !isFiniteNum(p.y)) return null;
  return { x: p.x, y: p.y };
}

function parseMeasurement(r: unknown): TakeoffMeasurement | null {
  if (!isObj(r)) return null;
  if (!isNonEmptyStr(r.id) || !isNonEmptyStr(r.conditionId) || !isNonEmptyStr(r.sheetId) || !isKind(r.kind)) return null;
  if (!isFiniteNum(r.aspect) || r.aspect <= 0) return null;
  if (!Array.isArray(r.points)) return null;
  const points: NormPoint[] = [];
  for (const p of r.points) {
    const q = parsePoint(p);
    if (!q) return null;
    points.push(q);
  }
  return {
    id: r.id, conditionId: r.conditionId, sheetId: r.sheetId, kind: r.kind, points,
    createdAt: isStr(r.createdAt) ? r.createdAt : '', aspect: r.aspect,
  };
}

export function parseTakeoffDoc(raw: string | null | undefined): TakeoffDoc {
  const empty = (): TakeoffDoc => ({ version: 1, conditions: [], measurements: [], pushed: {} });
  if (!raw) return empty();
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return empty(); }
  if (!isObj(v)) return empty();
  const conditions: TakeoffCondition[] = [];
  const seen = new Set<string>();
  if (Array.isArray(v.conditions)) {
    for (const r of v.conditions) {
      const c = parseCondition(r);
      if (c && !seen.has(c.id)) { seen.add(c.id); conditions.push(c); }
    }
  }
  const byId = new Map(conditions.map(c => [c.id, c]));
  const measurements: TakeoffMeasurement[] = [];
  if (Array.isArray(v.measurements)) {
    for (const r of v.measurements) {
      const m = parseMeasurement(r);
      // An orphan (its condition is gone) or a kind mismatch can never be
      // totalled, so it is dropped rather than carried forever.
      if (m && byId.get(m.conditionId)?.kind === m.kind) measurements.push(m);
    }
  }
  const pushed: Record<string, string> = {};
  if (isObj(v.pushed)) {
    for (const [k, val] of Object.entries(v.pushed)) if (isNonEmptyStr(val)) pushed[k] = val;
  }
  const doc: TakeoffDoc = { version: 1, conditions, measurements, pushed };
  const lp = v.lastPush;
  if (isObj(lp) && isStr(lp.at) && isStr(lp.projectId) && isFiniteNum(lp.before) && isFiniteNum(lp.after)
    && isFiniteNum(lp.added) && isFiniteNum(lp.updated)) {
    doc.lastPush = { at: lp.at, projectId: lp.projectId, before: lp.before, after: lp.after, added: lp.added, updated: lp.updated };
  }
  return doc;
}

// ── quantities ──────────────────────────────────────────────────────────────

/** Quantities in a FIXED reference frame (W = 1000, H = 1000 / aspect), so zoom, pan and window size never change a number. feetPerPixel scales inversely with the frame, so this equals the phone screen's maths (which uses the displayed image rect) for the same calibration and aspect — the validator asserts that. */
export const REF_W = 1000;

export type SheetCal = { p1: NormPoint; p2: NormPoint; realDistanceFt: number };

/** Feet per REF-frame pixel for this calibration and aspect, or null when the
 *  calibration is unusable (missing, non-positive distance, coincident points). */
function refFeetPerPixel(cal: SheetCal | null, aspect: number): number | null {
  if (!cal || !isFiniteNum(cal.realDistanceFt) || cal.realDistanceFt <= 0) return null;
  if (!isFiniteNum(aspect) || aspect <= 0) return null;
  const f = feetPerPixel(cal, REF_W, REF_W / aspect);
  return f != null && Number.isFinite(f) && f > 0 ? f : null;
}

/**
 * area: shoelace SF (>= 3 pts); linear: polyline LF (>= 2 pts); count:
 * points.length (needs no scale). null when an area/linear measurement's sheet
 * has no usable calibration — 'not measured', never 0.
 */
export function measurementQuantity(m: TakeoffMeasurement, cal: SheetCal | null): number | null {
  if (m.kind === 'count') return m.points.length;
  const ftpp = refFeetPerPixel(cal, m.aspect);
  if (ftpp == null) return null;
  const w = REF_W;
  const h = REF_W / m.aspect;
  if (m.kind === 'area') return m.points.length >= 3 ? polygonAreaSqFt(m.points, w, h, ftpp) : 0;
  return m.points.length >= 2 ? polylineLengthFt(m.points, w, h, ftpp) : 0;
}

export interface ConditionTotals {
  conditionId: string;
  net: number;
  billable: number;
  unit: 'SF' | 'LF' | 'EA';
  wallSf: number | null;
  unmeasuredCount: number;
  measuredCount: number;
  unmeasuredSheetIds: string[];
}

/**
 * billable = count ? net : net × (1 + waste/100). A linear condition with a
 * height also reports wallSf = billable LF × height (info only — the PRICED
 * unit stays LF). unmeasuredCount = area/linear measurements whose sheet has no
 * usable scale; they add nothing. That is the ONLY unmeasured cause: a sheet
 * with a scale always measures, active or not, because the aspect travels with
 * the measurement. `sheetFilter` limits the totals to one sheet.
 */
export function conditionTotals(
  c: TakeoffCondition,
  measurements: TakeoffMeasurement[],
  calFor: (sheetId: string) => SheetCal | null,
  sheetFilter?: string,
): ConditionTotals {
  let net = 0;
  let measuredCount = 0;
  let unmeasuredCount = 0;
  const unmeasured: string[] = [];
  for (const m of measurements) {
    if (m.conditionId !== c.id || m.kind !== c.kind) continue;
    if (sheetFilter != null && m.sheetId !== sheetFilter) continue;
    const q = measurementQuantity(m, c.kind === 'count' ? null : calFor(m.sheetId));
    if (q == null) {
      unmeasuredCount++;
      if (!unmeasured.includes(m.sheetId)) unmeasured.push(m.sheetId);
      continue;
    }
    measuredCount++;
    net += q;
  }
  const billable = c.kind === 'count' ? net : net * (1 + c.wastePct / 100);
  const wallSf = c.kind === 'linear' && c.heightFt != null && c.heightFt > 0 ? billable * c.heightFt : null;
  return {
    conditionId: c.id, net, billable, unit: KIND_UNIT[c.kind], wallSf,
    unmeasuredCount, measuredCount, unmeasuredSheetIds: unmeasured,
  };
}

// ── price ───────────────────────────────────────────────────────────────────

/** The ONE quantity and rate the push writes — the panel prices exactly these, so the footer and the estimate agree to the cent. */
export function pushQuantity(kind: ConditionKind, billable: number): number {
  if (!Number.isFinite(billable) || billable <= 0) return 0;
  return kind === 'count' ? billable : Math.round(billable);
}

/** The rate on the cent grid (utils/scopeGaps' Math.round(q × toCents(rate)) convention). */
export function rateToCents(rate: number): number {
  return Math.round(rate * 100);
}

export interface ConditionPrice {
  rate: number | null;
  rateCents: number | null;
  rateSource: 'override' | 'book' | null;
  entry: CostBookEntry | null;
  qty: number;
  amountCents: number | null;
  spreadMeaningful: boolean;
  low: number | null;
  high: number | null;
}

/**
 * Override wins; else his cost book (priceTakeoff — exact trade|unit key and
 * its spreadMeaningful rule). No trade and no override → rate / rateCents /
 * amountCents null ("No rate yet — set one"). NEVER an engine/catalog rate: the
 * phone's materials-engine fallback is a phone feature. A rate that rounds to
 * 0¢ is treated as no rate, so a priced row can never read $0 by accident.
 */
export function priceCondition(db: CostDatabase, c: TakeoffCondition, billable: number): ConditionPrice {
  const unit = KIND_UNIT[c.kind];
  const qty = pushQuantity(c.kind, billable);
  const none: ConditionPrice = {
    rate: null, rateCents: null, rateSource: null, entry: null, qty,
    amountCents: null, spreadMeaningful: false, low: null, high: null,
  };
  if (c.rateOverride != null && Number.isFinite(c.rateOverride) && c.rateOverride > 0) {
    const rateCents = rateToCents(c.rateOverride);
    if (rateCents <= 0) return none;
    return {
      rate: c.rateOverride, rateCents, rateSource: 'override', entry: null, qty,
      amountCents: qty * rateCents, spreadMeaningful: false, low: null, high: null,
    };
  }
  if (!c.trade) return none;
  const p = priceTakeoff(db, c.trade, unit, qty);
  if (!p.matched || p.rate == null || !p.entry) return none;
  const rateCents = rateToCents(p.rate);
  if (rateCents <= 0) return none;
  return {
    rate: p.rate, rateCents, rateSource: 'book', entry: p.entry, qty,
    amountCents: qty * rateCents, spreadMeaningful: p.spreadMeaningful, low: p.low, high: p.high,
  };
}

// ── colour ──────────────────────────────────────────────────────────────────

// Keyword → palette slot. The slots are TAKEOFF_CONDITION_PALETTE's order
// (constants/colors.ts — the one place the hues are written):
// 0 slate, 1 green, 2 violet, 3 amber, 4 sky, 5 teal, 6 cyan, 7 blue, 8 red, 9 rose.
const COLOR_RULES: [RegExp, number][] = [
  [/drywall|partition/, 0],
  [/floor|lvt|tile|carpet|finish/, 1],
  [/fram|stud|lumber/, 2],
  [/electric/, 3],
  [/plumb/, 4],
  [/hvac|duct|mechanical/, 5],
  [/roof/, 6],
  [/concrete|slab|site|footing/, 7],
  [/demo/, 8],
  [/paint|interior/, 9],
];

/** A trade's default swatch (the Gantt's families), else the first palette
 *  entry not yet used, else round-robin. */
export function defaultConditionColor(name: string, trade: string | null, used: readonly string[]): string {
  const hay = `${name} ${trade ?? ''}`.toLowerCase();
  for (const [re, slot] of COLOR_RULES) if (re.test(hay)) return TAKEOFF_CONDITION_PALETTE[slot];
  const usedSet = new Set(used.map(u => u.toUpperCase()));
  const free = TAKEOFF_CONDITION_PALETTE.find(p => !usedSet.has(p.toUpperCase()));
  if (free) return free;
  return TAKEOFF_CONDITION_PALETTE[used.length % TAKEOFF_CONDITION_PALETTE.length];
}

// ── rollup ──────────────────────────────────────────────────────────────────

export interface RollupRow {
  condition: TakeoffCondition;
  totals: ConditionTotals;
  price: ConditionPrice;
}

export interface TakeoffRollup {
  rows: RollupRow[];
  /** Σ price.amountCents of PRICED rows only. */
  costCents: number;
  pricedCount: number;
  /** Rows with no rate. They add nothing and are counted, never read as $0. */
  unpricedCount: number;
  /** Priced from his cost book on an entry that is not seeded-only. */
  fromYourJobsCount: number;
}

export function rollup(
  doc: TakeoffDoc,
  db: CostDatabase,
  calFor: (sheetId: string) => SheetCal | null,
  sheetFilter?: string,
): TakeoffRollup {
  const rows: RollupRow[] = [];
  let costCents = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let fromYourJobsCount = 0;
  for (const condition of doc.conditions) {
    const totals = conditionTotals(condition, doc.measurements, calFor, sheetFilter);
    const price = priceCondition(db, condition, totals.billable);
    rows.push({ condition, totals, price });
    if (price.amountCents == null) { unpricedCount++; continue; }
    pricedCount++;
    costCents += price.amountCents;
    if (price.rateSource === 'book' && price.entry && price.entry.provenance !== 'seeded') fromYourJobsCount++;
  }
  return { rows, costCents, pricedCount, unpricedCount, fromYourJobsCount };
}
