// laborSamples.ts — self-perform labor into the cost book.
//
// Crew time tracking captures the largest actual-cost stream a self-perform
// GC has: real clocked hours, per worker, per project, per trade — and until
// this bridge existed, every learning engine discarded them. This module
// converts finished shifts into Cost Database samples so the GC's OWN labor
// shows up in estimate grounding, instant bids, judges, and the price book.
//
// Honesty note (verified against the data model, 2026-07): TimeEntry carries
// NO pay rate — not on the entry, not on CrewMember, not in the Supabase
// schema. The payroll CSV has no rate column either. So the dollars here are
// hours (measured, real) × the GC's configured loaded rate per trade
// (hooks/useLaborRates.ts — entered once by the GC, their real payroll
// number, wages + burden). No rate configured for a trade ⇒ NO samples for
// that trade. We never substitute market-average rates and call them "your
// learned rate" — that would poison the book's core promise.
//
// Trade attribution (verified): TimeEntry has a direct `trade` field (set
// from the crew member's first trade at clock-in) — no task linkage exists,
// so no tradeKeyForTask inference is needed. Placeholder trades ('', 'Crew')
// fall back to the 'general' bucket, labeled "Labor — general".
//
// Pure functions — no storage, no network. Mirrors utils/materialReceipt.ts
// receiptToCostSamples (the receipts template this bridge was modeled on).

import type { TimeEntry } from '@/types';
import type { CostSample } from '@/utils/costDatabase';
import { toCalendarDayString } from '@/utils/calendarDate';
import { computeOvertime, overtimeFor, normalizeOvertimeRule, DEFAULT_OVERTIME_RULE, type OvertimeRule } from '@/utils/overtime';

/** The local calendar day a shift was worked, from its clock-in instant; the
 *  stored `date` only when there is no usable clock-in. Older rows wrote
 *  `date` as the UTC day, so an evening shift's cost sample was dated the
 *  next day (integration round 1 — the #9 reader class the time clock, the
 *  DFR and timesheets already moved). Same rule as dfrClockCrew.clockInLocalDay
 *  (which imports THIS module, so the rule is restated rather than imported). */
function shiftDay(e: Pick<TimeEntry, 'clockIn' | 'date'>): string {
  if (e.clockIn) {
    const d = new Date(e.clockIn);
    if (!Number.isNaN(d.getTime())) return toCalendarDayString(d);
  }
  return e.date || '';
}

/** Normalized trade key → loaded $/hour the GC pays for that trade. */
export type LaborRateMap = Record<string, number>;

/** All labor samples share this unit — the book keys on `trade|unit`. */
export const LABOR_UNIT = 'hour';

/** The leading words of every labor sample's trade label. Exported so the cost
 *  book can recover the underlying trade from a sample it was handed
 *  (self-perform derivation in utils/costDatabase).
 *
 *  NOT named *_PREFIX on purpose: scripts/validate-storage-hygiene.ts treats a
 *  `*_PREFIX` / `*_KEY` const as an AsyncStorage key literal and would demand a
 *  tenant-wipe prefix for it. This string never goes near storage. */
export const LABOR_LABEL_LEAD = 'Labor — ';

/** Recover the normalized trade key from a labor sample's display label —
 *  the inverse of laborTradeLabel. Returns '' for a non-labor label. */
export function laborSampleTradeKey(label: string | undefined): string {
  const l = (label ?? '').trim();
  if (!l.startsWith(LABOR_LABEL_LEAD)) return '';
  return normalizeTradeKey(l.slice(LABOR_LABEL_LEAD.length));
}

/** Roster placeholders that mean "no specific trade was set at clock-in". */
const GENERIC_TRADES = new Set(['', 'crew', 'general', 'labor']);

/** Canonical map key for a raw TimeEntry.trade value. */
export function normalizeTradeKey(trade: string | undefined): string {
  const t = (trade ?? '').trim().toLowerCase();
  return GENERIC_TRADES.has(t) ? 'general' : t;
}

/** Price-book display label: "Labor — Framing" / "Labor — general". Prefixed
 *  so a self-perform labor entry never masquerades as a subcontract scope. */
export function laborTradeLabel(trade: string | undefined): string {
  // Built from the same constant laborSampleTradeKey slices back off, so the
  // label and its inverse can never drift apart — the self-perform derivation
  // in utils/costDatabase depends on that round-trip to know which trade a
  // labor sample belongs to.
  if (normalizeTradeKey(trade) === 'general') return `${LABOR_LABEL_LEAD}general`;
  return `${LABOR_LABEL_LEAD}${(trade ?? '').trim()}`;
}

/** An entry is labor evidence only when the shift is FINISHED (live shifts
 *  have provisional hours), has positive hours, and is attributed to a real
 *  project ('unassigned' clock-ins carry no job context — the configured
 *  rate is the only dollar content, so they'd teach the book nothing). */
export function isEligibleLaborEntry(e: TimeEntry): boolean {
  return (
    e.status === 'clocked_out' &&
    Number.isFinite(e.totalHours) &&
    e.totalHours > 0 &&
    !!e.projectId &&
    e.projectId !== 'unassigned'
  );
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Time-and-a-half — the FLSA default and what nearly every GC pays. The
 *  per-GC override lives in hooks/useLaborRates.ts (overtimeMultiplier), set
 *  in Time Tracking's Labor rates sheet ("Overtime pays ×", #153). */
export const DEFAULT_OVERTIME_MULTIPLIER = 1.5;
/** Ceiling for a typed multiplier — "15" meant as "1.5" must not price OT at 15×. */
export const MAX_OVERTIME_MULTIPLIER = 3;

/** Sane a per-GC overtime multiplier before it prices anything: junk / unset
 *  → the default; below 1× (overtime cheaper than straight time) → 1×; above
 *  the ceiling → the ceiling. */
export function normalizeOvertimeMultiplier(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_OVERTIME_MULTIPLIER;
  return Math.min(MAX_OVERTIME_MULTIPLIER, Math.max(1, n));
}

/**
 * MONEY-F19: the DOLLAR cost of one shift — straight hours at the loaded rate,
 * overtime hours at rate × multiplier. Nothing downstream used to price the
 * premium: a 10-hour day at $50 booked $500 when the crew cost $550, so every
 * OT day understated self-perform actuals and the cost book learned a $/hr no
 * crew on overtime ever achieves.
 *
 * `overtimeHours` here is whatever the CALLER hands in, and since #65 every
 * production caller hands in the ALLOCATED figure from utils/overtime
 * (computeOvertime — per worker, per day/week, under the GC's rule), never
 * the per-shift number stored on the row, which went stale the moment another
 * shift landed in the same day or week. OT is clamped to [0, totalHours] so a
 * corrupt input can never price more hours than the shift has.
 */
export function priceLaborEntry(
  e: Pick<TimeEntry, 'totalHours' | 'overtimeHours'>,
  rate: number,
  overtimeMultiplier: number = DEFAULT_OVERTIME_MULTIPLIER,
): number {
  const total = Number.isFinite(e.totalHours) ? Math.max(0, e.totalHours) : 0;
  const otRaw = Number.isFinite(e.overtimeHours) ? e.overtimeHours : 0;
  const ot = Math.min(total, Math.max(0, otRaw));
  const m = normalizeOvertimeMultiplier(overtimeMultiplier);
  return (total - ot) * rate + ot * rate * m;
}

/**
 * Convert time entries into Cost Database samples: one sample per
 * (project, trade), quantity = summed hours, actualUnit = the GC's loaded
 * rate — or, once a shift ran into overtime, the EFFECTIVE $/hr (priced cost
 * ÷ hours, MONEY-F19) so hours × actualUnit reproduces what the crew really
 * cost. bidUnit is 0 (clocked hours carry no bid context — same as
 * receipts), so labor never distorts bid-bias math. Entries whose trade has
 * no configured rate are skipped entirely.
 *
 * Overtime is allocated across ALL of `entries` (every project, unpriced
 * trades included — a worker's 41st hour is overtime whatever job the first 40
 * were on) under `overtimeRule`, then priced per entry (#65).
 */
export function buildLaborSamples(
  entries: TimeEntry[],
  rates: LaborRateMap,
  overtimeMultiplier: number = DEFAULT_OVERTIME_MULTIPLIER,
  overtimeRule: OvertimeRule = DEFAULT_OVERTIME_RULE,
): CostSample[] {
  interface Group {
    projectId: string;
    projectName: string;
    label: string;
    rate: number;
    hours: number;
    /** Priced dollars (straight + overtime premium) across the group. */
    cost: number;
    /** Whether any shift in the group carried overtime — a straight-time
     *  group keeps actualUnit === rate exactly (no division noise). */
    overtime: boolean;
    lastDate: string;
  }
  const groups = new Map<string, Group>();
  const ot = computeOvertime(entries, overtimeRule);

  for (const e of entries ?? []) {
    if (!isEligibleLaborEntry(e)) continue;
    const tradeKey = normalizeTradeKey(e.trade);
    const rate = rates?.[tradeKey];
    if (!Number.isFinite(rate) || (rate as number) <= 0) continue;

    const otHours = overtimeFor(ot, e.id);
    const cost = priceLaborEntry({ totalHours: e.totalHours, overtimeHours: otHours }, rate as number, overtimeMultiplier);
    const overtime = otHours > 0;
    const key = `${e.projectId}|${tradeKey}`;
    const g = groups.get(key);
    if (g) {
      g.hours += e.totalHours;
      g.cost += cost;
      g.overtime = g.overtime || overtime;
      const day = shiftDay(e);
      if (day > g.lastDate) g.lastDate = day;
    } else {
      groups.set(key, {
        projectId: e.projectId,
        projectName: e.projectName || 'Project',
        label: laborTradeLabel(e.trade),
        rate: rate as number,
        hours: e.totalHours,
        cost,
        overtime,
        lastDate: shiftDay(e),
      });
    }
  }

  const out: CostSample[] = [];
  for (const g of groups.values()) {
    out.push({
      projectId: g.projectId,
      projectName: g.projectName,
      trade: g.label,
      unit: LABOR_UNIT,
      quantity: round2(g.hours),
      bidUnit: 0,
      actualUnit: g.overtime && g.hours > 0 ? g.cost / g.hours : g.rate,
      basis: 'actual',
      closedAt: g.lastDate,
      // MEASURED QUANTITY, STATED PRICE. The hours are real; the $/hr is the
      // number the GC typed once in settings (see the honesty note at the top
      // of this file). Every sample for a trade therefore carries the SAME
      // price, so the cost book's spread computes to exactly 0 and the card
      // printed "±0%" — the strongest precision claim the UI can make — beside
      // a rate nothing has measured, and six clocked shifts bought 'high'
      // confidence. The tag lets utils/costDatabase refuse both claims without
      // discarding the sample, which is genuinely useful: it IS his rate.
      source: 'labor_rate',
    });
  }
  return out;
}

export interface LaborSampleStats {
  /** Finished shifts with hours on a real project — the raw feedstock. */
  eligibleEntries: number;
  /** Of those, entries whose trade has a configured rate (became samples). */
  sampledEntries: number;
  /** Total hours across sampled entries. */
  sampledHours: number;
  /** Normalized trade keys present in eligible entries but missing a rate —
   *  the honest "set a rate to unlock these" list. */
  tradesMissingRates: string[];
}

/** Stats for the time-tracking honesty surface ("Feeding your labor rates:
 *  N entries → your cost book" / "set rates to unlock N shifts"). */
export function computeLaborStats(entries: TimeEntry[], rates: LaborRateMap): LaborSampleStats {
  let eligibleEntries = 0;
  let sampledEntries = 0;
  let sampledHours = 0;
  const missing = new Set<string>();
  for (const e of entries ?? []) {
    if (!isEligibleLaborEntry(e)) continue;
    eligibleEntries++;
    const tradeKey = normalizeTradeKey(e.trade);
    const rate = rates?.[tradeKey];
    if (Number.isFinite(rate) && (rate as number) > 0) {
      sampledEntries++;
      sampledHours += e.totalHours;
    } else {
      missing.add(tradeKey);
    }
  }
  return {
    eligibleEntries,
    sampledEntries,
    sampledHours: round2(sampledHours),
    tradesMissingRates: [...missing].sort(),
  };
}

// ── The rate book: device cache + the account copy (#61) ────────────────────
//
// Rates used to live ONLY in AsyncStorage on the device where he typed them,
// and the tenant sweep (utils/localCacheKeys — every `mageid_` key goes on
// sign-in and sign-out) erased them. On the web app, or after any sign-out,
// every clocked hour priced at $0 on Job Costing, the Living Estimate and
// Margin Alerts, and in the cost book grounding his estimates.
//
// The account copy is two per-user tables (migration 20260919180000):
// gc_labor_rates (one row per trade) and gc_labor_settings (one row: the OT
// multiplier and the OT rule). The device keeps a cache so a jobsite with no
// signal still prices labor. Adding the keys to DEVICE_SCOPED_KEYS instead
// was rejected: that keeps one GC's rates on a shared phone for the next
// tenant.
//
// MERGE RULE — the simplest provable one: every cell (a trade's rate, or the
// settings row) carries the instant it was edited, and the newer edit wins,
// on the device AND on the server (a trigger there refuses an older write, so
// a queued edit that lands late can never roll back a newer one from another
// device). A cleared rate is written as rate = null, never a delete, so a
// clear is just another dated edit and needs no tombstone. A cell the device
// holds newer than the account (an offline edit, or a rate from before the
// sync existed) is pushed up on the next load.

export interface RateCell { rate: number | null; updatedAt: string }
export interface LaborSettingsCell {
  overtimeMultiplier: number;
  overtimeRule: OvertimeRule;
  updatedAt: string;
}
export interface LaborRateBook {
  rates: Record<string, RateCell>;
  settings: LaborSettingsCell | null;
}

/** Cells from before the sync existed carry this — any account edit beats it. */
export const LEGACY_CELL_TIME = '1970-01-01T00:00:00.000Z';

const ms = (iso: string | undefined | null): number => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : 0;
};

/** Cents — the column is numeric(10,2); a device must price what the server holds. */
export function roundRate(rate: number): number {
  return Math.round(rate * 100) / 100;
}

/** A book's live rate map: only trades with a positive rate. */
export function rateMapOf(book: LaborRateBook | null | undefined): LaborRateMap {
  const out: LaborRateMap = {};
  for (const [k, c] of Object.entries(book?.rates ?? {})) {
    if (c && typeof c.rate === 'number' && Number.isFinite(c.rate) && c.rate > 0) out[k] = c.rate;
  }
  return out;
}

/** Read whatever the device cache holds — the v2 book, or the v1 bare
 *  `{trade: rate}` map every build before #61 wrote (dated LEGACY_CELL_TIME so
 *  the account wins wherever it has a value). Corrupt values are dropped. */
export function parseCachedBook(raw: unknown, legacyMultiplier?: unknown): LaborRateBook {
  const book: LaborRateBook = { rates: {}, settings: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return book;
  const o = raw as Record<string, unknown>;
  if (o.v === 2 && o.rates && typeof o.rates === 'object') {
    for (const [k, c] of Object.entries(o.rates as Record<string, unknown>)) {
      const cell = c as Partial<RateCell> | null;
      if (!cell || typeof cell !== 'object') continue;
      const rate = typeof cell.rate === 'number' && Number.isFinite(cell.rate) && cell.rate > 0 ? cell.rate : null;
      book.rates[k] = { rate, updatedAt: typeof cell.updatedAt === 'string' ? cell.updatedAt : LEGACY_CELL_TIME };
    }
    const st = o.settings as Partial<LaborSettingsCell> | null | undefined;
    if (st && typeof st === 'object') {
      book.settings = {
        overtimeMultiplier: normalizeOvertimeMultiplier(st.overtimeMultiplier),
        overtimeRule: normalizeOvertimeRule(st.overtimeRule),
        updatedAt: typeof st.updatedAt === 'string' ? st.updatedAt : LEGACY_CELL_TIME,
      };
    }
    return book;
  }
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) book.rates[k] = { rate: v, updatedAt: LEGACY_CELL_TIME };
  }
  if (legacyMultiplier != null && legacyMultiplier !== '') {
    book.settings = {
      overtimeMultiplier: normalizeOvertimeMultiplier(Number(legacyMultiplier)),
      overtimeRule: DEFAULT_OVERTIME_RULE,
      updatedAt: LEGACY_CELL_TIME,
    };
  }
  return book;
}

/** Account rows → a book. */
export function bookFromServer(
  rateRows: readonly { trade_key?: unknown; rate?: unknown; updated_at?: unknown }[] | null | undefined,
  settingsRow: {
    overtime_multiplier?: unknown; ot_weekly_threshold?: unknown; ot_daily_threshold?: unknown;
    week_starts_on?: unknown; updated_at?: unknown;
  } | null | undefined,
): LaborRateBook {
  const book: LaborRateBook = { rates: {}, settings: null };
  for (const r of rateRows ?? []) {
    if (typeof r.trade_key !== 'string' || !r.trade_key) continue;
    const n = r.rate == null ? null : Number(r.rate);
    book.rates[r.trade_key] = {
      rate: n != null && Number.isFinite(n) && n > 0 ? n : null,
      updatedAt: typeof r.updated_at === 'string' ? r.updated_at : LEGACY_CELL_TIME,
    };
  }
  if (settingsRow) {
    book.settings = {
      overtimeMultiplier: normalizeOvertimeMultiplier(Number(settingsRow.overtime_multiplier)),
      overtimeRule: normalizeOvertimeRule({
        weeklyThreshold: settingsRow.ot_weekly_threshold == null ? null : Number(settingsRow.ot_weekly_threshold),
        dailyThreshold: settingsRow.ot_daily_threshold == null ? null : Number(settingsRow.ot_daily_threshold),
        weekStartsOn: settingsRow.week_starts_on,
      }),
      updatedAt: typeof settingsRow.updated_at === 'string' ? settingsRow.updated_at : LEGACY_CELL_TIME,
    };
  }
  return book;
}

export interface BookMerge {
  merged: LaborRateBook;
  /** Trades whose device cell is NEWER than the account's (or missing there). */
  pushRates: string[];
  /** The device's settings cell is newer than the account's. */
  pushSettings: boolean;
}

/** Newest edit wins, cell by cell; a tie keeps the account's copy. */
export function mergeRateBooks(local: LaborRateBook, server: LaborRateBook): BookMerge {
  const merged: LaborRateBook = { rates: { ...server.rates }, settings: server.settings };
  const pushRates: string[] = [];
  for (const [k, cell] of Object.entries(local.rates)) {
    const s = server.rates[k];
    if (!s || ms(cell.updatedAt) > ms(s.updatedAt)) {
      merged.rates[k] = cell;
      pushRates.push(k);
    }
  }
  let pushSettings = false;
  if (local.settings && (!server.settings || ms(local.settings.updatedAt) > ms(server.settings.updatedAt))) {
    merged.settings = local.settings;
    pushSettings = true;
  }
  return { merged, pushRates: pushRates.sort(), pushSettings };
}

/** The gc_labor_rates row for one cell. The id is `<user>:<trade>` (the table
 *  CHECKs it), so the offline queue serializes two edits to one trade
 *  oldest-first instead of racing them. */
export function rateRowFor(userId: string, tradeKey: string, cell: RateCell): Record<string, unknown> {
  return {
    id: `${userId}:${tradeKey}`,
    user_id: userId,
    trade_key: tradeKey,
    rate: cell.rate == null ? null : roundRate(cell.rate),
    updated_at: cell.updatedAt,
  };
}

/** The gc_labor_settings row (id = user id, CHECKed). */
export function settingsRowFor(userId: string, s: LaborSettingsCell): Record<string, unknown> {
  return {
    id: userId,
    user_id: userId,
    overtime_multiplier: normalizeOvertimeMultiplier(s.overtimeMultiplier),
    ot_weekly_threshold: s.overtimeRule.weeklyThreshold,
    ot_daily_threshold: s.overtimeRule.dailyThreshold,
    week_starts_on: s.overtimeRule.weekStartsOn,
    updated_at: s.updatedAt,
  };
}
