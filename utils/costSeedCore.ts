// utils/costSeedCore.ts — cold-start cost seeding: the pure parse / normalize
// / merge core.
//
// THE PROBLEM THIS SOLVES. utils/costDatabase learns ONLY from jobs closed
// inside MAGE. A contractor with twenty years of history and zero closed jobs
// here gets `entries: []`, which means app/estimate-wizard computes no
// grounding facts and the estimate falls back to generic LLM pricing. Their
// day-one number is identical to a beginner's and stays that way for months.
// This module is the way in: paste the rates you already know, or type them.
//
// A SEED IS A CLAIM, NOT A MEASUREMENT. The product's credibility rests on not
// conflating "you told me this" with "I watched this happen," so the split is
// structural, not cosmetic:
//   * a seed becomes a CostSample with basis 'seeded' AND source 'seed'
//   * its synthetic projectId is prefixed `seed:` and is excluded from
//     CostBookEntry.jobCount and CostDatabase.jobsAnalyzed — a seeded book
//     still reads "0 closed jobs"
//   * its quantity is 1, so the first real closed job (hundreds of SF at a
//     measured rate) outweighs the seed immediately. The claim is a prior;
//     measurement washes it out. That is the honest blend.
//
// PARSING IS DELIBERATELY FORGIVING. Contractors paste out of spreadsheets,
// Notes, and texts. We accept comma / tab / semicolon / pipe delimiters, an
// optional header row, `$` and thousands separators, `12.50/SF` and
// `$12.50 per sf`, unit aliases (SF/SQFT/SQ FT, LF/LNFT, EA/each), an optional
// self-reported job count and an optional date — in any column order.
//
// Pure: no React, no React Native, no storage, no network, no clock beyond
// what the caller passes in. bun runs it directly (scripts/validate-cost-seed.ts).

import type { CostSample } from '@/utils/costDatabase';
// formatters is dependency-free (no React, no RN), so importing it keeps this
// module runnable by bun for scripts/validate-cost-seed.ts.
import { formatMoney } from '@/utils/formatters';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SeedEntryMethod = 'paste' | 'manual';

export interface SeededRate {
  /** Deterministic — derived from trade+unit, so re-importing the same scope
   *  updates the row in place instead of stacking duplicates. */
  id: string;
  trade: string;
  /** Canonical display unit — 'SF', 'LF', 'EA', 'HR', … */
  unit: string;
  /** Dollars per unit, as the contractor states it. */
  rate: number;
  /** Self-reported jobs behind the number. DISPLAY ONLY — never folded into
   *  CostBookEntry.jobCount. A contractor saying "I've done this 40 times" is
   *  not the same evidence as forty closed jobs in the ledger. */
  reportedJobs?: number;
  /** Self-reported as-of date (ISO yyyy-mm-dd) when the paste carried one. */
  asOf?: string;
  /** Leftover free text from the pasted row, kept so the review step can show
   *  what we read it from. */
  note?: string;
  createdAt: string;
  method: SeedEntryMethod;
  /** Server-stamped `updated_at`, present only on a row that has been to
   *  Postgres. THE conflict tiebreaker when both sides have one: createdAt is
   *  client-supplied, so a device with a skewed clock could otherwise pin a
   *  stale rate as permanently "newest". The DB trigger owns this value; the
   *  client never sends it. */
  updatedAt?: string;
  /** Tombstone. A delete is a soft delete because a hard one cannot be
   *  represented in a union-merge: the row simply reappeared from whichever
   *  device had not yet heard about it. Set = this rate is gone; it stays in
   *  the set (hidden by activeSeeds) long enough to out-live every stale copy,
   *  then pruneTombstones drops it. */
  deletedAt?: string;
}

/** A parsed-but-not-yet-committed row. The review step renders these. */
export interface SeededRateDraft {
  trade: string;
  unit: string;
  rate: number;
  reportedJobs?: number;
  asOf?: string;
  note?: string;
  /** The original line, so the review step can show what we parsed it from. */
  raw: string;
}

export interface SeedParseRejection {
  raw: string;
  reason: string;
}

export type SeedLineOutcome =
  | { status: 'row'; draft: SeededRateDraft }
  | { status: 'rejected'; reason: string }
  | { status: 'skipped'; reason: 'blank' | 'header' };

export interface SeedParseResult {
  rows: SeededRateDraft[];
  rejected: SeedParseRejection[];
  /** True when we recognized and dropped a spreadsheet header row. */
  headerSkipped: boolean;
  /** Rows collapsed because the same trade+unit appeared twice (last wins). */
  duplicates: number;
}

/** Prefix on the synthetic projectId of every seed-derived CostSample. The
 *  ONLY thing that separates a claim from a closed job downstream. */
export const SEED_PROJECT_PREFIX = 'seed:';

/** Shown in the cost book's sample list for a seeded row. */
export const SEED_SAMPLE_LABEL = 'You set this rate';

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
// Canonical token -> display label. The canonical tokens MUST agree with
// utils/takeoffPricing.normalizeUnit or a seeded SF rate will never match an
// SF takeoff line; scripts/validate-cost-seed.ts pins that round-trip. We
// don't import normalizeUnit here on purpose — this module stays dependency-
// free so the validator (and any future worker) can run it in isolation.

const UNIT_DISPLAY: Record<string, string> = {
  sf: 'SF', lf: 'LF', ea: 'EA', hr: 'HR', cy: 'CY', ls: 'LS',
  sy: 'SY', sq: 'SQ', ton: 'TON', gal: 'GAL', bf: 'BF', cf: 'CF',
  day: 'DAY', wk: 'WK', mo: 'MO',
};

/** Everything a contractor might actually type, folded onto a canonical key. */
const UNIT_ALIASES: Record<string, string> = {
  // area
  sf: 'sf', sqft: 'sf', sqf: 'sf', ft2: 'sf', sfa: 'sf',
  squarefoot: 'sf', squarefeet: 'sf', sqfeet: 'sf', squarefeat: 'sf',
  // linear
  lf: 'lf', lnft: 'lf', lin: 'lf', linft: 'lf', lft: 'lf',
  linearfoot: 'lf', linearfeet: 'lf', linealfoot: 'lf', linealfeet: 'lf',
  // each
  ea: 'ea', each: 'ea', unit: 'ea', pc: 'ea', pcs: 'ea', piece: 'ea',
  pieces: 'ea', item: 'ea', items: 'ea', qty: 'ea',
  // volume / weight
  cy: 'cy', cuyd: 'cy', cubicyard: 'cy', cubicyards: 'cy', yd3: 'cy',
  cf: 'cf', cuft: 'cf', cubicfoot: 'cf', cubicfeet: 'cf',
  ton: 'ton', tons: 'ton', tn: 'ton',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  bf: 'bf', bdft: 'bf', boardfoot: 'bf', boardfeet: 'bf',
  // roofing / paving
  sq: 'sq', square: 'sq', squares: 'sq',
  sy: 'sy', sqyd: 'sy', squareyard: 'sy', squareyards: 'sy',
  // time
  hr: 'hr', hour: 'hr', hours: 'hr', hrs: 'hr', manhour: 'hr',
  manhours: 'hr', mh: 'hr',
  day: 'day', days: 'day', dy: 'day',
  wk: 'wk', week: 'wk', weeks: 'wk',
  mo: 'mo', month: 'mo', months: 'mo',
  // lump
  ls: 'ls', lot: 'ls', lumpsum: 'ls', allowance: 'ls', job: 'ls',
};

/** The unit chips offered on the manual-entry form, in the order shown. */
export const SEED_UNITS: readonly string[] = [
  'SF', 'LF', 'EA', 'HR', 'CY', 'SY', 'SQ', 'CF', 'BF', 'TON', 'GAL',
  'DAY', 'WK', 'MO', 'LS',
];

/**
 * Resolve any unit token a contractor might type to its canonical display
 * label, or null when the token is not a unit at all (that null is what lets
 * the row parser tell "SF" apart from "Framing").
 */
export function canonicalSeedUnit(raw: string): string | null {
  const cleaned = (raw ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleaned) return null;
  const key = UNIT_ALIASES[cleaned];
  if (!key) return null;
  return UNIT_DISPLAY[key] ?? null;
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

const HEADER_WORDS = new Set([
  'trade', 'trades', 'category', 'scope', 'item', 'description', 'desc',
  'unit', 'units', 'uom', 'rate', 'rates', 'cost', 'costs', 'price',
  'unitcost', 'unitprice', 'amount', 'jobs', 'job', 'count', 'n', 'date',
  'asof', 'lastused', 'notes', 'note', 'division', 'csi', 'code', 'my',
  'myrate', 'yourrate', 'per',
]);

const DATE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DATE_US = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
/** "14 jobs", "14 projects", "3x", "n=14" */
const JOBS_TRAILING = /^(?:n\s*[:=]\s*)?(\d{1,4})\s*(?:jobs?|projects?|times|x)$/i;
/** "jobs: 14", "count 14" */
const JOBS_LEADING = /^(?:jobs?|projects?|count|n)\s*[:=]?\s*(\d{1,4})$/i;
/** "$12.50", "12.50", "$12.50/SF", "12.50 per sf" */
const MONEY = /^\$?\s*(\d+(?:\.\d+)?)\s*(?:(?:\/|per)\s*([a-z0-9 .\-]+))?$/i;

/** Sanity ceiling. High enough for a real big-ticket EA line (a modular unit
 *  at $1.25M each is a legitimate rate); low enough to catch a fat-fingered
 *  paste before it poisons the price book.
 *
 *  EXPORTED because it is not just a parser limit: the cost_seeds CHECK
 *  constraint mirrors it, and a row that breaks the CHECK fails its upsert with
 *  "violates check constraint" — which utils/offlineQueue classifies TERMINAL
 *  and DISCARDS. Any entry path that doesn't enforce this ceiling saves the rate
 *  on device and silently never persists it. app/cost-seed enforces it on the
 *  manual form; clampSeedRate below is the backstop for every other path. */
export const MAX_SEED_RATE = 10_000_000;
/** A self-reported job count above this is not a job count. Mirrored by the
 *  reported_jobs CHECK — same terminal-discard consequence as MAX_SEED_RATE. */
export const MAX_REPORTED_JOBS = 500;

/** Round to cents and hold inside the table's CHECK. Returns null for anything
 *  that could never be a rate, so callers drop the row rather than write a
 *  value Postgres will reject. */
export function clampSeedRate(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(Math.round(raw * 100) / 100, MAX_SEED_RATE);
}

/** Same for the display-only job count. Returns null to mean "don't store one". */
export function clampReportedJobs(raw: number | undefined | null): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  if (n <= 0) return null;
  return Math.min(n, MAX_REPORTED_JOBS);
}

type Part =
  | { type: 'text'; text: string }
  | { type: 'unit'; unit: string }
  | { type: 'jobs'; jobs: number }
  | { type: 'date'; iso: string }
  | { type: 'money'; value: number; strong: boolean; inlineUnit: string | null };

/** Collapse thousands separators INSIDE numbers ("$1,250" → "$1250") so the
 *  comma field-split below doesn't shred a rate. Only true 3-digit groups are
 *  collapsed, so "12.50, 8" keeps its field comma. */
function collapseThousands(line: string): string {
  let out = line;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** A timestamp normalized to canonical ISO-8601 Z, or '' when it is missing or
 *  unreadable. '' means UNKNOWN and is treated as such by seedStamp — never as
 *  "very old", which is what the old `new Date(0)` fallback silently meant. */
function isoOrEmpty(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  const t = Date.parse(raw);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toIsoDate(token: string): string | null {
  const iso = DATE_ISO.exec(token);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  const us = DATE_US.exec(token);
  if (us) {
    const m = Number(us[1]);
    const d = Number(us[2]);
    let y = Number(us[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  return null;
}

/** Split a row into fields. Real delimiters first (that's the spreadsheet
 *  case); em/en-dash and 2+ spaces as the hand-typed fallback. */
function splitRow(line: string): string[] {
  if (/[\t;|,]/.test(line)) {
    return line.split(/[\t;|,]/).map(t => t.trim()).filter(Boolean);
  }
  return line.split(/\s*[—–]\s*|\s{2,}/).map(t => t.trim()).filter(Boolean);
}

function classify(part: string): Part {
  const token = part.trim();

  const iso = toIsoDate(token);
  if (iso) return { type: 'date', iso };

  const jobsA = JOBS_TRAILING.exec(token);
  if (jobsA) return { type: 'jobs', jobs: Number(jobsA[1]) };
  const jobsB = JOBS_LEADING.exec(token);
  if (jobsB) return { type: 'jobs', jobs: Number(jobsB[1]) };

  const money = MONEY.exec(token);
  if (money) {
    const value = Number(money[1]);
    const inlineUnit = money[2] ? canonicalSeedUnit(money[2]) : null;
    // A "strong" rate carries a $, a decimal, or an inline /unit — that's how
    // "$12.50" wins the rate slot over a bare "8" that means eight jobs.
    const strong = token.includes('$') || money[1].includes('.') || inlineUnit != null;
    if (Number.isFinite(value)) return { type: 'money', value, strong, inlineUnit };
  }

  const unit = canonicalSeedUnit(token);
  if (unit) return { type: 'unit', unit };

  return { type: 'text', text: token };
}

function looksLikeHeader(parts: string[]): boolean {
  if (parts.length < 2) return false;
  let hits = 0;
  for (const p of parts) {
    const w = p.toLowerCase().replace(/[^a-z]/g, '');
    if (w && HEADER_WORDS.has(w)) hits++;
  }
  return hits >= 2;
}

function cleanTrade(raw: string): string {
  return raw
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function assemble(parts: Part[], raw: string): SeedLineOutcome {
  // Rate: the first "strong" money token, else the first money token at all.
  const moneys = parts.filter((p): p is Extract<Part, { type: 'money' }> => p.type === 'money');
  const ratePart = moneys.find(m => m.strong) ?? moneys[0];
  if (!ratePart) {
    return { status: 'rejected', reason: 'No rate found — add a price like $12.50' };
  }
  const rate = ratePart.value;
  if (!(rate > 0)) {
    return { status: 'rejected', reason: 'Rate must be greater than zero' };
  }
  if (rate > MAX_SEED_RATE) {
    return { status: 'rejected', reason: 'Rate looks like a typo (over $10,000,000 per unit)' };
  }

  // Unit: an explicit unit column wins, then a "/SF" riding on the rate.
  const unitPart = parts.find((p): p is Extract<Part, { type: 'unit' }> => p.type === 'unit');
  const unit = unitPart?.unit ?? ratePart.inlineUnit ?? null;
  if (!unit) {
    return { status: 'rejected', reason: 'No unit found — add SF, LF, EA, HR…' };
  }

  // Jobs: a labeled count wins; otherwise a leftover bare integer is read as
  // one (that's the "Framing, SF, 12.50, 8" shape).
  const labeledJobs = parts.find((p): p is Extract<Part, { type: 'jobs' }> => p.type === 'jobs');
  let reportedJobs = labeledJobs?.jobs;
  if (reportedJobs == null) {
    const spare = moneys.find(
      m => m !== ratePart && !m.strong && Number.isInteger(m.value) &&
        m.value > 0 && m.value <= MAX_REPORTED_JOBS,
    );
    if (spare) reportedJobs = spare.value;
  }
  if (reportedJobs != null && (reportedJobs <= 0 || reportedJobs > MAX_REPORTED_JOBS)) {
    reportedJobs = undefined;
  }

  const datePart = parts.find((p): p is Extract<Part, { type: 'date' }> => p.type === 'date');

  // Trade: the run of leading text fields (so "Interior Paint" survives a
  // whitespace split). Anything textual after that is a note.
  const texts = parts.filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text');
  const leading: string[] = [];
  for (const p of parts) {
    if (p.type !== 'text') break;
    leading.push(p.text);
  }
  const tradeSource = leading.length > 0 ? leading : texts.map(t => t.text);
  const trade = cleanTrade(tradeSource.join(' '));
  if (!trade || !/[a-z]/i.test(trade)) {
    return { status: 'rejected', reason: 'No trade name — put the scope first (e.g. Framing)' };
  }
  const noteParts = texts.map(t => t.text).slice(leading.length > 0 ? leading.length : texts.length);
  const note = noteParts.join(' ').trim() || undefined;

  return {
    status: 'row',
    draft: {
      trade,
      unit,
      rate: Math.round(rate * 100) / 100,
      ...(reportedJobs != null ? { reportedJobs } : {}),
      ...(datePart ? { asOf: datePart.iso } : {}),
      ...(note ? { note } : {}),
      raw,
    },
  };
}

/** Parse one pasted line. Blank lines and a spreadsheet header row are
 *  skipped; anything that can't yield a trade + unit + rate is rejected WITH
 *  a reason so the review step can show the contractor what we couldn't read. */
export function parseSeedLine(line: string): SeedLineOutcome {
  const raw = (line ?? '').trim();
  if (!raw) return { status: 'skipped', reason: 'blank' };

  const working = collapseThousands(raw);
  let fields = splitRow(working);
  if (fields.length === 0) return { status: 'skipped', reason: 'blank' };

  let parts = fields.map(classify);

  // Nothing money-shaped in the delimited fields? The row may be a header, or
  // it may be single-space separated ("Framing $12.50/SF 14 jobs") — retry on
  // whitespace before giving up.
  if (!parts.some(p => p.type === 'money')) {
    if (looksLikeHeader(fields)) return { status: 'skipped', reason: 'header' };
    const wsFields = working.split(/\s+/).map(t => t.trim()).filter(Boolean);
    if (wsFields.length > fields.length) {
      const wsParts = wsFields.map(classify);
      if (wsParts.some(p => p.type === 'money')) {
        fields = wsFields;
        parts = wsParts;
      }
    }
  }

  if (!parts.some(p => p.type === 'money') && looksLikeHeader(fields)) {
    return { status: 'skipped', reason: 'header' };
  }

  return assemble(parts, raw);
}

/** Stable dedupe key. Matches how utils/costDatabase keys its entries
 *  (`trade|unit`, both lowercased) so a seed lands on the same row a closed
 *  job for that scope would. */
export function seedKey(trade: string, unit: string): string {
  return `${(trade ?? '').trim().toLowerCase()}|${(unit ?? '').trim().toLowerCase()}`;
}

/** Deterministic id from trade+unit — re-importing the same scope updates the
 *  existing row rather than stacking a second one. */
export function seedId(trade: string, unit: string): string {
  const slug = seedKey(trade, unit).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `seed-${slug || 'row'}`;
}

/** Parse a whole paste blob. Later rows win when the same trade+unit repeats
 *  inside one paste, so a contractor correcting a line further down gets the
 *  correction, not a duplicate. */
export function parseSeedBlob(blob: string): SeedParseResult {
  const rejected: SeedParseRejection[] = [];
  const byKey = new Map<string, SeededRateDraft>();
  let headerSkipped = false;
  let duplicates = 0;

  for (const line of (blob ?? '').split(/\r?\n/)) {
    const outcome = parseSeedLine(line);
    if (outcome.status === 'skipped') {
      if (outcome.reason === 'header') headerSkipped = true;
      continue;
    }
    if (outcome.status === 'rejected') {
      rejected.push({ raw: line.trim(), reason: outcome.reason });
      continue;
    }
    const key = seedKey(outcome.draft.trade, outcome.draft.unit);
    if (byKey.has(key)) duplicates++;
    byKey.set(key, outcome.draft);
  }

  return { rows: Array.from(byKey.values()), rejected, headerSkipped, duplicates };
}

// ---------------------------------------------------------------------------
// Drafts → seeds → cost samples
// ---------------------------------------------------------------------------

/** Shape review-step drafts into storable seeds. `now` is injected so this
 *  stays a pure function (and so the validator can pin timestamps). */
export function draftsToSeeds(
  drafts: SeededRateDraft[],
  opts: { now: string; method?: SeedEntryMethod },
): SeededRate[] {
  const method = opts.method ?? 'paste';
  const out: SeededRate[] = [];
  for (const d of drafts) {
    // Clamp HERE, not only in the parser: app/cost-seed's manual form builds a
    // draft directly, and a rate past the table's CHECK is a write the offline
    // queue discards as terminal — saved on device, never persisted.
    const rate = clampSeedRate(d.rate);
    if (rate == null) continue;
    const jobs = clampReportedJobs(d.reportedJobs);
    out.push({
      id: seedId(d.trade, d.unit),
      trade: d.trade,
      unit: d.unit,
      rate,
      ...(jobs != null ? { reportedJobs: jobs } : {}),
      ...(d.asOf ? { asOf: d.asOf } : {}),
      ...(d.note ? { note: d.note } : {}),
      createdAt: opts.now,
      method,
    });
  }
  return out;
}

export interface SeedMergeResult {
  merged: SeededRate[];
  added: number;
  replaced: number;
}

/** Merge incoming seeds into the stored set. Same trade+unit = one row;
 *  incoming wins (an import is the contractor restating their number). */
export function mergeSeeds(existing: SeededRate[], incoming: SeededRate[]): SeedMergeResult {
  const byKey = new Map<string, SeededRate>();
  for (const s of existing) byKey.set(seedKey(s.trade, s.unit), s);

  let added = 0;
  let replaced = 0;
  for (const s of incoming) {
    const key = seedKey(s.trade, s.unit);
    if (byKey.has(key)) replaced++;
    else added++;
    byKey.set(key, s);
  }

  return { merged: Array.from(byKey.values()), added, replaced };
}

/** True when a cost sample came from a seed rather than a real job. */
export function isSeedSample(sample: { projectId?: string; source?: string }): boolean {
  return sample.source === 'seed' || (sample.projectId ?? '').startsWith(SEED_PROJECT_PREFIX);
}

/**
 * Turn seeds into CostSamples that utils/costDatabase can fold into the book.
 *
 * Two choices here carry the whole honesty story:
 *   * `quantity: 1` — a single unit-weight vote. The moment a real job lands
 *     with a real quantity, the measured rate dominates the weighted mean.
 *   * `bidUnit: 0` — a seed is not a bid, so it never pollutes bidBias (the
 *     "you bid this 8% under actual" read stays about real bids only).
 */
export function seedsToCostSamples(seeds: SeededRate[]): CostSample[] {
  const out: CostSample[] = [];
  for (const s of seeds) {
    if (!(s.rate > 0)) continue;
    const trade = (s.trade ?? '').trim();
    const unit = (s.unit ?? '').trim();
    if (!trade || !unit) continue;
    out.push({
      projectId: `${SEED_PROJECT_PREFIX}${seedKey(trade, unit)}`,
      projectName: SEED_SAMPLE_LABEL,
      trade,
      unit,
      quantity: 1,
      bidUnit: 0,
      actualUnit: s.rate,
      basis: 'seeded',
      // Empty unless the contractor told us when it was true. A seed must
      // never claim to be the most recent sighting of a trade.
      closedAt: s.asOf ?? '',
      source: 'seed',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Postgres round-trip (public.cost_seeds)
// ---------------------------------------------------------------------------
// Seeds were AsyncStorage-only in V1, which meant the data the whole cost moat
// depends on did not survive a reinstall and never reached a second device.
// supabase/migrations/20260805120000_cost_seeds.sql adds the table;
// hooks/useCostSeeds writes through utils/offlineQueue.supabaseWrite.
//
// These two functions live HERE, not in the hook, for one reason: the hook
// imports AsyncStorage and react-query, so bun can't run it — and the
// deterministic-id round-trip is exactly the thing that has to be pinned by a
// test. scripts/validate-cost-seed.ts exercises them directly.

/** A `public.cost_seeds` row. snake_case because it goes straight to PostgREST. */
export interface CostSeedRow {
  id: string;
  user_id: string;
  trade: string;
  unit: string;
  rate: number;
  reported_jobs: number | null;
  as_of: string | null;
  note: string | null;
  method: SeedEntryMethod;
  created_at: string;
  /** Soft-delete tombstone — see SeededRate.deletedAt. Added by
   *  supabase/migrations/20260812093000_cost_seeds_soft_delete.sql.
   *  NOT `updated_at`: that column is owned by the BEFORE UPDATE trigger, and a
   *  client-supplied value would defeat the whole point of trusting it. */
  deleted_at: string | null;
}

/**
 * Seed → row. The id is NOT regenerated here: it is carried through verbatim so
 * a re-imported correction upserts onto the row it is correcting instead of
 * creating a second one. (The table's PK is (user_id, id) — the id is
 * deterministic from trade+unit and therefore only unique per contractor; see
 * the migration's header for why that matters.)
 */
export function seedToRow(s: SeededRate, userId: string): CostSeedRow {
  return {
    id: s.id || seedId(s.trade, s.unit),
    user_id: userId,
    trade: s.trade,
    unit: s.unit,
    // Last line of defence before PostgREST: a rate or job count past the
    // table's CHECK fails the upsert with "violates check constraint", which
    // utils/offlineQueue treats as TERMINAL and drops. Clamping beats
    // discarding — the contractor keeps a rate, just a sane one.
    rate: clampSeedRate(s.rate) ?? 0,
    reported_jobs: clampReportedJobs(s.reportedJobs),
    as_of: s.asOf ?? null,
    note: s.note ?? null,
    method: s.method === 'manual' ? 'manual' : 'paste',
    created_at: s.createdAt,
    deleted_at: s.deletedAt ?? null,
  };
}

/**
 * Row → seed. Returns null for anything that couldn't price a line — a row with
 * no usable trade/unit/rate must never reach the cost book, whether it came
 * from a hand-edited cache or a hand-crafted API call.
 *
 * The id is taken from the row when present and RE-DERIVED otherwise, so the
 * deterministic trade+unit identity survives the round-trip either way.
 * created_at is normalized back to a canonical ISO-8601 Z string because
 * Postgres hands back `+00:00`, and the local-vs-server merge compares these
 * as timestamps.
 */
export function rowToSeed(raw: unknown): SeededRate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const trade = typeof r.trade === 'string' ? r.trade.trim() : '';
  const unit = typeof r.unit === 'string' ? r.unit.trim() : '';
  const rate = Number(r.rate);
  if (!trade || !unit || !Number.isFinite(rate) || rate <= 0) return null;

  const reported = clampReportedJobs(Number(r.reported_jobs));
  // NOT `new Date(0)` on an unreadable stamp. Epoch is not "unknown" — it is
  // "older than everything", so an unparseable server row used to lose every
  // reconcile forever. An empty string means unknown, and seedStamp treats
  // unknown as unknown (see the resolution table in reconcileSeeds).
  const createdAt = isoOrEmpty(r.created_at);
  const updatedAt = isoOrEmpty(r.updated_at);
  const deletedAt = isoOrEmpty(r.deleted_at);

  return {
    id: typeof r.id === 'string' && r.id ? r.id : seedId(trade, unit),
    trade,
    unit,
    rate,
    ...(reported != null ? { reportedJobs: reported } : {}),
    ...(typeof r.as_of === 'string' && r.as_of ? { asOf: r.as_of } : {}),
    ...(typeof r.note === 'string' && r.note ? { note: r.note } : {}),
    createdAt,
    method: r.method === 'manual' ? 'manual' : 'paste',
    ...(updatedAt ? { updatedAt } : {}),
    ...(deletedAt ? { deletedAt } : {}),
  };
}

/**
 * Reconcile the local cache against what the server returned.
 *
 * Same domain rule mergeSeeds already applies — the LAST time the contractor
 * stated a rate wins — extended across devices by comparing createdAt (which
 * draftsToSeeds re-stamps on every import, so it really is "last stated at").
 *
 * Why not "server always wins", the shape useRateOverrides uses? Because an
 * edit made offline sits in the offline queue, and a plain server-wins refetch
 * would visibly revert it until the queue drained. Why not "local always wins"?
 * Because then a reinstall — the case this whole table exists for — would keep
 * the empty local set. Comparing the timestamp gets both right, and the reads
 * are unioned so a row that exists on only one side is never dropped.
 */
export function reconcileSeeds(
  local: SeededRate[],
  server: SeededRate[],
  opts?: { now?: number },
): SeededRate[] {
  const now = opts?.now ?? Date.now();
  const byKey = new Map<string, SeededRate>();
  for (const s of local) byKey.set(seedKey(s.trade, s.unit), s);
  for (const s of server) {
    const key = seedKey(s.trade, s.unit);
    const mine = byKey.get(key);
    if (!mine || serverWins(s, mine, now)) byKey.set(key, s);
  }
  return Array.from(byKey.values());
}

/**
 * The resolution table, stated once.
 *
 *   server stamp | local stamp | winner   why
 *   -------------+-------------+---------------------------------------------
 *   known        | known       | later one (ties → server)
 *   known        | UNKNOWN     | server    a stamp we can read beats one we can't
 *   UNKNOWN      | known       | local     same rule, other direction
 *   UNKNOWN      | UNKNOWN     | server    the copy every other device also sees
 *
 * The old form was `Date.parse(server) >= Date.parse(local)`, which collapses
 * all three unknown cases into "local wins" — because every comparison against
 * NaN is false. That is how one unreadable timestamp made a stale local rate
 * permanently unbeatable.
 */
function serverWins(server: SeededRate, local: SeededRate, now: number): boolean {
  const s = seedStamp(server, now);
  const l = seedStamp(local, now);
  if (s == null && l == null) return true;
  if (s == null) return false;
  if (l == null) return true;
  return s >= l;
}

/**
 * When this copy was last written, as a comparable number — or null if we
 * genuinely cannot tell.
 *
 * The latest of updated_at / deleted_at / created_at that is not in the future.
 * updated_at is stamped by the DB trigger, so for anything that has synced the
 * SERVER is the ordering authority; created_at is only whatever the writing
 * device's clock said. deleted_at is in the list because for a tombstone that
 * IS the moment it was last written, and a delete has to be able to out-rank
 * the live copy it is deleting.
 */
export function seedStamp(s: SeededRate, now: number = Date.now()): number | null {
  let best: number | null = null;
  for (const raw of [s.updatedAt, s.deletedAt, s.createdAt]) {
    if (!raw) continue;
    const t = Date.parse(raw);
    // A stamp in the future is not late, it is WRONG — the writing device's
    // clock is off. Discarding it as unknown (rather than clamping it to now,
    // which would still make it the newest thing in the set) is what stops a
    // skewed phone from pinning a stale rate as permanently authoritative.
    if (Number.isNaN(t) || t > now) continue;
    if (best == null || t > best) best = t;
  }
  return best;
}

/** The seeds a consumer should actually see. Tombstones stay in the stored set
 *  so the delete can still be pushed and can still beat a stale copy — but they
 *  are not rates, and nothing downstream should ever price from one. */
export function activeSeeds(seeds: SeededRate[]): SeededRate[] {
  return seeds.filter(s => !s.deletedAt);
}

/** Mark a seed deleted rather than dropping it. `now` is injected so this stays
 *  pure (and so the validator can pin the stamp). */
export function tombstoneSeed(s: SeededRate, now: string): SeededRate {
  return { ...s, deletedAt: now, updatedAt: undefined };
}

/**
 * Drop tombstones old enough that no device can still be holding a copy that
 * predates them. Without this the set grows forever; with too short a window a
 * device offline past it would resurrect the rate on its next sync. 180 days is
 * far past any plausible offline window and still bounds the cache.
 */
export function pruneTombstones(
  seeds: SeededRate[],
  opts?: { now?: number; maxAgeDays?: number },
): SeededRate[] {
  const now = opts?.now ?? Date.now();
  const maxAge = (opts?.maxAgeDays ?? 180) * 86400000;
  return seeds.filter(s => {
    if (!s.deletedAt) return true;
    const t = Date.parse(s.deletedAt);
    if (Number.isNaN(t)) return false;
    return now - t < maxAge;
  });
}

/**
 * Repair a cached seed before it is allowed to decide a merge.
 *
 * The local cache is the one input nobody validates on the way in — it survives
 * app versions, hand edits, and half-written writes. Returns null for anything
 * that could never price a line, so a bad row is dropped rather than carried.
 */
export function normalizeSeed(raw: unknown): SeededRate | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const trade = typeof s.trade === 'string' ? s.trade.trim() : '';
  const unit = typeof s.unit === 'string' ? s.unit.trim() : '';
  const rate = clampSeedRate(Number(s.rate));
  if (!trade || !unit || rate == null) return null;
  const jobs = clampReportedJobs(Number(s.reportedJobs));
  return {
    id: typeof s.id === 'string' && s.id ? s.id : seedId(trade, unit),
    trade,
    unit,
    rate,
    ...(jobs != null ? { reportedJobs: jobs } : {}),
    ...(typeof s.asOf === 'string' && s.asOf ? { asOf: s.asOf } : {}),
    ...(typeof s.note === 'string' && s.note ? { note: s.note } : {}),
    createdAt: isoOrEmpty(s.createdAt),
    method: s.method === 'manual' ? 'manual' : 'paste',
    ...(isoOrEmpty(s.updatedAt) ? { updatedAt: isoOrEmpty(s.updatedAt) } : {}),
    ...(isoOrEmpty(s.deletedAt) ? { deletedAt: isoOrEmpty(s.deletedAt) } : {}),
  };
}

/** True when a seed can actually be written to cost_seeds — every CHECK the
 *  table declares, asserted before the row goes near the offline queue (which
 *  discards a constraint violation as terminal). */
export function isPersistableSeed(s: SeededRate): boolean {
  return clampSeedRate(s.rate) != null && !!(s.trade ?? '').trim() && !!(s.unit ?? '').trim();
}

/** Collapse a batch onto one row per deterministic id, last wins — the same
 *  rule mergeSeeds applies locally. Without it a batch carrying two rows that
 *  canonicalize to the same id enqueues two writes for one primary key. */
export function dedupeSeeds(seeds: SeededRate[]): SeededRate[] {
  const byKey = new Map<string, SeededRate>();
  for (const s of seeds) byKey.set(seedKey(s.trade, s.unit), s);
  return Array.from(byKey.values());
}

/** True when two copies of a rate carry the same user-visible values, so the
 *  backfill can tell "the server already has this" from "the server has a
 *  DIFFERENT one and needs mine". */
export function sameSeedValue(a: SeededRate, b: SeededRate): boolean {
  return a.rate === b.rate &&
    (a.reportedJobs ?? null) === (b.reportedJobs ?? null) &&
    (a.asOf ?? '') === (b.asOf ?? '') &&
    (a.note ?? '') === (b.note ?? '') &&
    (a.deletedAt ? 1 : 0) === (b.deletedAt ? 1 : 0);
}

/** One-line human summary for the review step / settings row. formatMoney (not
 *  toFixed) so a $12,500/EA modular unit reads like every other price in the
 *  app instead of '$12500.00'. */
export function describeSeed(s: SeededRate): string {
  const jobs = s.reportedJobs != null
    ? ` · you say ${s.reportedJobs} job${s.reportedJobs === 1 ? '' : 's'}`
    : '';
  return `${formatMoney(s.rate, 2)}/${s.unit}${jobs}`;
}
