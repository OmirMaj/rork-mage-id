// utils/groundingChip.ts — what the estimate's grounding chip may CLAIM, and
// which cost-book entries the estimate is grounded ON. Pure: no React, no RN,
// no storage — scripts/validate-ai-honesty.ts drives it under bun.
//
// THE FIREWALL (brain-center directive, HONEST leg)
//   A rate the contractor STATED (a cost seed, provenance 'seeded') is never
//   presented as a rate MAGE MEASURED. utils/activationSignals, utils/costXray
//   and the RateProvenanceChip all keep that split; the wizard / Quick Estimate
//   chip did not (AI-F4): it printed "Priced with your cost history · N learned
//   rates" where N counted seeds AND the calibration sentence. Every chip on an
//   AI estimate now goes through groundingChipLabel, which only ever calls the
//   MEASURED count "learned" and names stated rates as "rates you set".
//
// SCOPE-RELEVANT GROUNDING (PRODUCT-F18)
//   The wizard used to hand the model the six largest-exposure entries in the
//   book regardless of what was being priced — a bathroom got roofing, concrete
//   and siding. selectGroundingEntries picks by relevance to the wizard's
//   answers (project type → trade keywords, plus trades named in the scope
//   text) and falls back to the exposure top-N only when nothing matches.
//
// ONE BUNDLE PER RUN
//   buildGroundingFacts returns everything a surface needs to describe ONE
//   model call — the fact lines that went into the prompt, the MEASURED/STATED
//   counts of the entries behind them, and whether a calibration sentence rode
//   along. The wizard stores that bundle next to the result so the chip, the
//   seed CTA and the loader copy all describe the prompt that was actually
//   sent, never a memo that re-rendered from newer answers.
//
// THE LOADER IS A CLAIM TOO
//   "Pricing from your history…" on the loading screen is the same promise as
//   the chip, so it goes through the same firewall: estimateThinkingSteps
//   picks the "your history" copy ONLY when the run carried a MEASURED entry,
//   the "rates you set" copy for a seeded-only run, and market averages
//   otherwise. The wizard used to key it on selectedCount > 0, so a contractor
//   who had typed two rates and closed zero jobs watched "your history" for
//   the whole run while the chip underneath said "rates you set".

/** The two provenance buckets the chip is allowed to distinguish. */
export interface GroundingCounts {
  /** Entries with real jobs behind them: 'earned', 'mixed', or a legacy entry
   *  with no provenance stamp (pre-seed data is measured data — same rule as
   *  activationSignals.learned_rate_count). */
  measured: number;
  /** Entries whose ONLY evidence is a rate the contractor typed. */
  seeded: number;
}

type ProvenanceLike = { provenance?: 'earned' | 'seeded' | 'mixed' };

/** Count MEASURED vs STATED entries. Counts only what it is handed, so pass
 *  the entries the model was actually given, not the whole book. */
export function countGroundingEntries(entries: readonly ProvenanceLike[]): GroundingCounts {
  let measured = 0;
  let seeded = 0;
  for (const e of entries) {
    if (e.provenance === 'seeded') seeded += 1;
    else measured += 1;
  }
  return { measured, seeded };
}

const DEFAULT_EMPTY_LABEL = 'Priced from market averages — MAGE has none of your rates yet';
const HISTORY_ONLY_LABEL = 'Priced from market averages · calibrated to your job history — no learned rates yet';
const CALIBRATED_SUFFIX = ' · calibrated to your job history';
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The chip's grounding line.
 *   measured > 0, seeded = 0 → "Priced with your cost history · N learned rates"
 *   measured > 0, seeded > 0 → "… · N learned rates · M rates you set"
 *   measured = 0, seeded > 0 → "Priced from rates you set · M rates"
 *   nothing, calibration     → history-only label (a calibration sentence went
 *                              in, so "none of your rates" would be a lie)
 *   nothing                  → emptyLabel (caller's cold-start copy)
 * "learned" is reachable ONLY from the measured count. That is the firewall.
 */
export function groundingChipLabel(
  counts: GroundingCounts,
  opts?: { emptyLabel?: string; calibration?: boolean },
): string {
  const measured = Number.isFinite(counts.measured) ? Math.max(0, Math.floor(counts.measured)) : 0;
  const seeded = Number.isFinite(counts.seeded) ? Math.max(0, Math.floor(counts.seeded)) : 0;
  const cal = opts?.calibration ? CALIBRATED_SUFFIX : '';
  if (measured > 0) {
    const learned = `Priced with your cost history · ${plural(measured, 'learned rate')}`;
    return (seeded > 0 ? `${learned} · ${plural(seeded, 'rate')} you set` : learned) + cal;
  }
  if (seeded > 0) return `Priced from rates you set · ${plural(seeded, 'rate')}${cal}`;
  if (opts?.calibration) return HISTORY_ONLY_LABEL;
  return opts?.emptyLabel ?? DEFAULT_EMPTY_LABEL;
}

/** Which of the three honest stories a run's grounding tells. 'measured'
 *  needs at least one MEASURED entry; a seeded-only prompt is 'stated' no
 *  matter how many seeds went in; a calibration-only prompt is 'none' (the
 *  chip says "calibrated", the loader has no rates to price from). */
export type GroundingSource = 'measured' | 'stated' | 'none';
export function groundingSource(counts: GroundingCounts): GroundingSource {
  const measured = Number.isFinite(counts.measured) ? counts.measured : 0;
  const seeded = Number.isFinite(counts.seeded) ? counts.seeded : 0;
  if (measured > 0) return 'measured';
  if (seeded > 0) return 'stated';
  return 'none';
}

/** Loader copy for the estimate wizard, one list per grounding source. Only
 *  the pricing line differs; "your history" is reachable ONLY through the
 *  measured count — the same firewall as groundingChipLabel. Stable array
 *  instances on purpose (ThinkingStates receives them as a prop). */
export const ESTIMATE_THINKING_STEPS: Readonly<Record<GroundingSource, string[]>> = {
  measured: ['Reading your scope…', 'Pricing from your history…', 'Checking your margin…', 'Assembling line items…'],
  stated: ['Reading your scope…', 'Pricing from the rates you set…', 'Checking your margin…', 'Assembling line items…'],
  none: ['Reading your scope…', 'Pricing from market averages…', 'Checking your margin…', 'Assembling line items…'],
};

/** The loader steps for one run, from the counts of the bundle that was
 *  actually sent (GroundingBundle.counts) — never from selectedCount, which
 *  cannot tell a stated rate from a measured one. */
export function estimateThinkingSteps(counts: GroundingCounts): string[] {
  return ESTIMATE_THINKING_STEPS[groundingSource(counts)];
}

/** The minimal cost-book shape the fact line needs (CostBookEntry satisfies it). */
export interface GroundingEntryLike extends ProvenanceLike {
  trade: string;
  unit: string;
  suggestedRate: number;
  confidence?: 'low' | 'medium' | 'high';
  jobCount?: number;
}

/** One prompt fact per entry. A seeded rate is told to the model as
 *  told-to-us, never as measured history — handing the LLM "runs $X on your
 *  jobs" for a number the contractor typed would launder a claim into
 *  evidence. Same wording the wizard has always used; centralised so the
 *  validator can pin it. */
export function groundingFactLine(e: GroundingEntryLike): string {
  const rate = `$${Number(e.suggestedRate ?? 0).toFixed(2)}/${e.unit || 'unit'}`;
  if (e.provenance === 'seeded') {
    return `${e.trade}: the contractor's own stated rate is ${rate} (self-reported, no closed job yet — use it, but don't call it measured)`;
  }
  const jobs = e.jobCount ?? 0;
  return `${e.trade} runs ${rate} on your jobs (${e.confidence ?? 'low'} confidence, ${plural(jobs, 'job')})`;
}

/** Everything one model call's grounding is: the prompt lines and what they
 *  are made of. The calibration sentence is a FACT but never an ENTRY — it
 *  rides along in `facts`, is flagged in `calibration`, and is excluded from
 *  `counts` and `selectedCount`. */
export interface GroundingBundle {
  facts: string[];
  counts: GroundingCounts;
  /** Cost-book entries behind `facts` (the calibration line is not one). */
  selectedCount: number;
  /** True when a bid-vs-actual calibration sentence went into the prompt. */
  calibration: boolean;
}

export const EMPTY_GROUNDING: GroundingBundle = {
  facts: [], counts: { measured: 0, seeded: 0 }, selectedCount: 0, calibration: false,
};

export function buildGroundingFacts(
  selected: readonly GroundingEntryLike[],
  calibrationLine?: string | null,
): GroundingBundle {
  const facts = selected.map(groundingFactLine);
  const cal = (calibrationLine ?? '').trim();
  if (cal) facts.push(cal);
  return {
    facts,
    counts: countGroundingEntries(selected),
    selectedCount: selected.length,
    calibration: cal.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Scope-relevant selection (PRODUCT-F18)
// ---------------------------------------------------------------------------

/** What the wizard knows about the job being priced. All optional; free text
 *  is matched against trade names, projectType against the table below. */
export interface ScopeHints {
  /** utils/scopeQuestions PROJECT_TYPES label ("Bathroom Remodel") or a
   *  types/ProjectType id ("remodel", "roofing"); matched loosely. */
  projectType?: string;
  scope?: string;
  specialRequirements?: string;
}

/** Project type → the trades that typically price it. A keyword matches a
 *  cost-book trade label when it equals one of the label's word stems or is
 *  that stem minus a common suffix ('roof' ↔ "Roofing", 'plumb' ↔ "Plumbing",
 *  'tile' ↔ "Tiling") — never a bare substring, so 'fire' does not pull in
 *  "Fireplaces" and 'door' does not pull in "Outdoor". Deliberately a small
 *  hand table, not a classifier: a wrong exclusion here costs one grounding
 *  fact, and the exposure fallback still fires when nothing matches. */
const SHELL = ['concrete', 'foundation', 'footing', 'masonry', 'framing', 'frame', 'lumber', 'steel', 'roof', 'siding', 'exterior', 'window', 'door', 'insulation', 'drywall', 'electric', 'plumb', 'hvac', 'mechanical', 'paint', 'finish', 'floor', 'tile', 'trim', 'hardware', 'excavat', 'grading'];
const INTERIOR = ['demo', 'demolition', 'framing', 'frame', 'lumber', 'drywall', 'electric', 'lighting', 'plumb', 'hvac', 'paint', 'finish', 'floor', 'tile', 'trim', 'cabinet', 'countertop', 'window', 'door', 'insulation', 'hardware'];
const PROJECT_TYPE_TRADES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/kitchen/i, ['demo', 'demolition', 'cabinet', 'countertop', 'tile', 'floor', 'plumb', 'electric', 'lighting', 'drywall', 'paint', 'finish', 'appliance', 'hardware', 'trim']],
  [/bath/i, ['demo', 'demolition', 'tile', 'plumb', 'fixture', 'vanity', 'shower', 'tub', 'electric', 'lighting', 'drywall', 'paint', 'finish', 'floor', 'waterproof', 'cabinet', 'countertop', 'hardware']],
  [/basement/i, ['demo', 'demolition', 'framing', 'frame', 'lumber', 'insulation', 'drywall', 'electric', 'plumb', 'hvac', 'floor', 'paint', 'finish', 'egress', 'window', 'door', 'waterproof', 'trim']],
  [/roof/i, ['roof', 'shingle', 'underlayment', 'flashing', 'gutter', 'soffit', 'fascia', 'sheathing', 'lumber']],
  [/deck|outdoor|patio|fence|landscap|yard|pergola/i, ['deck', 'railing', 'footing', 'concrete', 'masonry', 'lumber', 'framing', 'frame', 'fenc', 'landscap', 'stain', 'paver', 'hardware', 'exterior']],
  [/commercial|tenant|\bti\b|office|retail/i, ['demo', 'demolition', 'framing', 'frame', 'steel', 'drywall', 'ceiling', 'electric', 'lighting', 'plumb', 'hvac', 'mechanical', 'fire', 'sprinkler', 'floor', 'paint', 'finish', 'door', 'hardware', 'glazing', 'storefront']],
  [/paint/i, ['paint', 'finish', 'drywall', 'caulk', 'stain', 'trim']],
  [/floor/i, ['floor', 'tile', 'carpet', 'hardwood', 'vinyl', 'subfloor', 'trim', 'finish']],
  [/plumb/i, ['plumb', 'fixture', 'water', 'sewer', 'drain', 'demo', 'demolition', 'drywall']],
  [/electric/i, ['electric', 'lighting', 'panel', 'wiring', 'fixture', 'drywall']],
  [/concrete|foundation|masonry/i, ['concrete', 'foundation', 'footing', 'masonry', 'rebar', 'excavat', 'grading', 'slab']],
  [/addition|adu|backyard|new.?build|new construction|ground.?up|full remodel|renovation|remodel/i, SHELL.concat(INTERIOR)],
];

/** Words that appear in trade labels but name a bucket, not a trade. A label
 *  made only of these ("Materials", "Other", "Labor — general") never matches
 *  by itself and reaches the prompt only through the exposure fallback. */
const STOP = new Set(['labor', 'labour', 'materials', 'material', 'general', 'other', 'misc', 'and', 'the', 'per', 'unit', 'work', 'sub', 'subs', 'self', 'perform', 'services', 'service']);

/** Suffixes a keyword may be missing from a label stem and still name the
 *  same trade: 'roof'+'ing', 'electric'+'al', 'landscap'+'e', 'cabinet'+'ry'. */
const TRADE_SUFFIXES = new Set(['', 'e', 's', 'es', 'ing', 'er', 'ers', 'ed', 'y', 'al', 'ial', 'ion', 'ry', 'work', 'works']);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `needle` starts a word in `text` — "tile" hits "tiled" but not
 *  "reptile"; "roof" hits "roofing" but not "waterproofing"; "door" does not
 *  hit "outdoor". */
function atWordStart(needle: string, text: string): boolean {
  return new RegExp('\\b' + escapeRegExp(needle)).test(text);
}

/** Lower-cased, de-pluralised significant words of a trade label. */
function tradeStems(trade: string): string[] {
  return trade
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .map((t) => t.replace(/(ies)$/, 'y').replace(/(es|s)$/, ''))
    .filter((t) => t.length >= 3);
}

/** Short forms contractors actually write for a trade that the label's own
 *  stem cannot reach at a word start: "re-roof the garage" names Roofing,
 *  "call the plumber" names Plumbing, "framer quoted three days" names
 *  Framing. Keyed by the label stem (tradeStems output); each alias is
 *  matched at a word start exactly like the stem, so "waterproofing" still
 *  does not reach 'roof'. A small hand table, not a stemmer: every entry is
 *  a form a contractor uses, and a miss here only costs a ranking nudge. */
const STEM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  roofing: ['roof', 'reroof'],        // re-roof · reroof · roofer · roofs
  roof: ['reroof'],
  electrical: ['electric'],           // electric · electrician
  electrician: ['electric'],
  plumbing: ['plumb'],                // plumber · plumb the island
  plumber: ['plumb'],
  framing: ['frame'],                 // framer · frame the wall · framed
  framer: ['frame', 'framing'],
  painting: ['paint'],                // painter · paint the trim
  painter: ['paint'],
  flooring: ['floor'],                // floors · floor the loft
  tiling: ['tile'],                   // tiled · tile setter
  masonry: ['mason'],                 // mason · masons
  landscaping: ['landscap'],          // landscape · landscaper
  cabinetry: ['cabinet'],             // cabinets
  insulation: ['insulat'],            // insulate · insulated
  demolition: ['demo'],               // demo the kitchen · demoed
  excavation: ['excavat'],            // excavate · excavator
  carpentry: ['carpenter'],
};

/** True when the trade stem — or one of its short forms — starts a word in
 *  the free text. */
function stemNamedIn(stem: string, text: string): boolean {
  if (atWordStart(stem, text)) return true;
  const aliases = STEM_ALIASES[stem];
  return aliases !== undefined && aliases.some((a) => atWordStart(a, text));
}

/** Keyword ↔ stem: equal, or the stem is the keyword plus a trade suffix
 *  (with the keyword's trailing 'e' allowed to drop: 'tile' ↔ 'tiling'). */
function keywordMatchesStem(kw: string, stem: string): boolean {
  if (stem === kw) return true;
  if (stem.startsWith(kw)) return TRADE_SUFFIXES.has(stem.slice(kw.length));
  const noE = kw.replace(/e$/, '');
  if (noE.length >= 3 && noE !== kw && stem.startsWith(noE)) return TRADE_SUFFIXES.has(stem.slice(noE.length));
  return false;
}

function typeKeywordsFor(projectType: string | undefined): readonly string[] {
  const pt = (projectType ?? '').trim();
  if (!pt) return [];
  for (const [re, kws] of PROJECT_TYPE_TRADES) if (re.test(pt)) return kws;
  return [];
}

/**
 * Score one entry against the hints.
 *   +2 the trade is named in the free text (scope / special requirements) —
 *      by its label stem or a short form of it (STEM_ALIASES)
 *   +1 the trade belongs to the project type's usual trade list
 * 0 means "not this job".
 */
export function scopeRelevance(entry: { trade: string }, hints: ScopeHints): number {
  const stems = tradeStems(entry.trade);
  if (stems.length === 0) return 0;
  const text = `${hints.scope ?? ''} ${hints.specialRequirements ?? ''}`.toLowerCase();
  let score = 0;
  if (text.trim() && stems.some((s) => stemNamedIn(s, text))) score += 2;
  const kws = typeKeywordsFor(hints.projectType);
  if (kws.some((k) => stems.some((s) => keywordMatchesStem(k, s) || keywordMatchesStem(s, k)))) score += 1;
  return score;
}

/**
 * The entries an estimate should be grounded on: relevance-ranked matches
 * (ties keep the book's exposure order), capped at n. When nothing in the
 * book matches the job, the exposure top-N — the previous behaviour — is the
 * honest fallback: it is still THEIR rates, and the prompt says to use them
 * "wherever the trade matches".
 */
export function selectGroundingEntries<T extends { trade: string }>(
  entries: readonly T[],
  hints: ScopeHints,
  n: number = 6,
): T[] {
  const cap = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 6;
  if (cap === 0 || entries.length === 0) return [];
  const scored = entries
    .map((e, i) => ({ e, i, score: scopeRelevance(e, hints) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  if (scored.length === 0) return entries.slice(0, cap);
  return scored.slice(0, cap).map((x) => x.e);
}
