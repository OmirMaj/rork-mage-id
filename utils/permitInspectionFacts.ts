// utils/permitInspectionFacts.ts — what the contractor's OWN inspection record
// says, rendered once, for the prompt and the chip together. Pure: no React,
// no RN, no storage — scripts/validate-inspection-history-facts.ts drives it
// under bun.
//
// THE THING THIS EXISTS TO SAY
//   "You have had 4 rough-electrical inspections with the City of Phoenix. One
//   failed. The inspector wrote: 'no AFCI on the bedroom circuits, box fill at
//   J-3.'"
//   No chatbot knows that. No code-lookup subscription knows that. MAGE has
//   stored it since the 2026-09-07 inspection-history fix and, until this file,
//   read it on exactly one screen (app/permits.tsx). `grep -rln PermitInspection
//   app utils components hooks contexts` returned ONE file. The AI had never
//   seen the one body of evidence the contractor actually owns.
//
// THE FIREWALL APPLIES HERE TOO (utils/codeJurisdiction.ts, top of file)
//   Nothing in this module is written from recall. Every sentence it emits is
//   arithmetic over dated rows the contractor typed, and every inspector note
//   is reproduced VERBATIM, in quotation marks, with its date and its permit
//   number. The model is told, in the prompt block itself, that a correction
//   note is one inspector's words on one job and must never be restated as a
//   code requirement. That instruction is not decoration: "the inspector said
//   X" becoming "code requires X" is the same failure mode as a recalled
//   edition printed beside a real URL — it passes every automated check.
//
// THE SAMPLE FLOOR (utils/brain/accuracyReport.ts:8 — "suppress any kind with
// n < 3")
//   One failed inspection is not a tendency. Below INSPECTION_PATTERN_FLOOR
//   this module states the RAW COUNT and shows the note, and makes no claim
//   about a pattern, a rate, or what "usually" happens — and it tells the model
//   not to either. That is the difference between a record and a horoscope.
//
// ONE RENDERER, SO THE CHIP AND THE PROMPT CANNOT DRIFT
//   Same shape as groundingFactsFor in utils/codeJurisdiction.ts: `headline` is
//   built once and appears VERBATIM inside both `promptBlock` and `chipLabel`,
//   so the chip can never count something the prompt was not told. `kind:
//   'unknown'` / `'none'` are real answers, said out loud, never silence.
//
// THE MATCH IS A ROW LOOKUP, NOT A STRING GUESS
//   The first cut compared bare place tokens, and the authority names this app
//   actually emits carry parenthesised acronyms and office words ("(PDD)",
//   "(LADBS)", "Permitting Center") that survive the stopword list as PLACE
//   tokens. Adding a state code then broke containment in both directions, so
//   eleven of the fifteen seeded cities reported an EMPTY file — in the very
//   format app/permits.tsx suggests. Both sides now resolve through
//   LOCAL_ADOPTIONS and are compared as rows; token containment is only the
//   fallback for an office MAGE has no row for, and even then a state typed on
//   both sides must agree.

import type { Permit, PermitInspection } from '@/types';
import { decodePermitInspectionNotes, sortPermitInspections } from '@/utils/permitInspectionHistory';
import {
  LOCAL_ADOPTIONS,
  normalizePlace,
  normalizeState,
  splitLocationText,
  type LocalAdoption,
} from '@/utils/codeJurisdiction';

/**
 * Below this many DISTINCT called inspections (passed or failed), no claim
 * about a pattern may be made — only the raw count and the notes themselves.
 * Deliberately the same number as accuracyReport's honesty gate.
 */
export const INSPECTION_PATTERN_FLOOR = 3;

/**
 * What kind of answer the record supports.
 *   unknown — MAGE has no issuing authority for this address, so it cannot
 *             even ask the question. (Mirrors ResolvedCodeJurisdiction's
 *             'unknown': an absent row is a correct answer.)
 *   none    — an authority is known and the contractor has no called
 *             inspection on file with it that matches.
 *   thin    — below the floor once re-inspections are collapsed. Counts and
 *             notes only. NO pattern.
 *   record  — floor or more DISTINCT called inspections. Counts, rate, notes.
 */
export type InspectionHistoryKind = 'unknown' | 'none' | 'thin' | 'record';

/** One inspector note, rendered once for the prompt and the UI. */
export interface InspectionNoteQuote {
  /** EXACTLY the line the prompt carries AND the UI shows. Contains the
   *  inspector's words inside quotation marks, never paraphrased. */
  line: string;
  /** Calendar day the inspection was called, 'YYYY-MM-DD'. */
  date: string;
  result: 'passed' | 'failed';
}

/**
 * What ONE answer is grounded on from the contractor's own file. `promptBlock`
 * goes into the model prompt verbatim and `chipLabel` is shown to the
 * contractor verbatim — both built here, from the same counts, so the two
 * cannot drift.
 */
export interface InspectionHistoryGrounding {
  kind: InspectionHistoryKind;
  /** The one-sentence count, used inside BOTH promptBlock and chipLabel. */
  headline: string;
  /** One fact per line, in the order they reach the model. */
  facts: string[];
  /** EXACTLY the text the prompt carries. */
  promptBlock: string;
  /** EXACTLY the text the grounding chip shows. */
  chipLabel: string;
  /** True when at least one CALLED inspection backed the facts. */
  grounded: boolean;
  /** True only when kind === 'record' — the caller may show a rate. */
  patternAllowed: boolean;
  /** Inspections matched (any result, including still-scheduled). */
  matched: number;
  /** Of those, the ones with a verdict. */
  called: number;
  /** Of those, collapsing a failure and its re-inspections of the SAME item on
   *  the SAME permit into one. This is the `n` the floor applies to. */
  distinctCalled: number;
  failed: number;
  /** Verbatim inspector notes, failures first, newest first. */
  quotes: InspectionNoteQuote[];
  /** Stable fragment for a prompt cache key. It digests the FACTS, notes
   *  included, so two records that differ only in what the inspector wrote
   *  cannot collide — a cached answer reasoned over note A must never be
   *  served beneath a chip quoting note B. */
  cacheKey: string;
}

// ─────────────────────────────────────────────────────────────────────
// Matching the contractor's file to the authority on screen
// ─────────────────────────────────────────────────────────────────────

// Words that name the KIND of office rather than the place. Two strings that
// share only these are not the same building department.
const AUTHORITY_STOPWORDS = new Set([
  'city', 'county', 'town', 'township', 'village', 'borough', 'of', 'the',
  'and', 'department', 'dept', 'division', 'bureau', 'office', 'building',
  'buildings', 'safety', 'development', 'developmental', 'services', 'service',
  'planning', 'permit', 'permits', 'permitting', 'inspection', 'inspections',
  'inspectional', 'construction', 'code', 'codes', 'enforcement', 'authority',
  'district', 'municipal', 'municipality', 'government', 'govt', 'community',
  'land', 'use', 'zoning', 'fire', 'marshal', 'regional', 'metropolitan',
  'metro', 'state', 'usa', 'us',
]);

/**
 * Everything after an opening parenthesis or an em/en dash is the office's own
 * branding, never the place: "(PDD)", "(LADBS)", "— Construction, Permitting
 * and Building Code Division". Those acronyms survive AUTHORITY_STOPWORDS as
 * PLACE tokens, and two offices carrying DIFFERENT acronyms then fail
 * containment in both directions.
 *
 * BE PRECISE ABOUT WHAT THIS DOES AND DOES NOT FIX. It is not what repaired
 * the eleven seeded cities that reported an empty file — the row lookup in
 * `localEntryFor` is. Removing this line leaves every seeded-city assertion
 * green. It matters only on the FALLBACK path, where neither side is a row
 * MAGE has: "City of Gilbert Development Services (DSD)" against "Town of
 * Gilbert Building Safety (BSD)" is one office, and without this it is two.
 */
function stripAuthorityTails(raw: string): string {
  return raw.replace(/\([^)]*\)?/g, ' ').replace(/[\u2014\u2013].*$/, ' ').trim();
}

/**
 * The PLACE tokens in an authority string.
 *
 * `Permit.jurisdiction` is free text the contractor typed ("City of Phoenix,
 * AZ"); the authority on screen is a canonical `authorityName` off the cited
 * adoption table ("City of Phoenix Planning and Development Department
 * (PDD)"). Neither will equal the other, and equality was never the question.
 *
 * This is the FALLBACK comparison only — `authorityIdentity` resolves both
 * sides through LOCAL_ADOPTIONS first, which is what makes the real, shipped
 * authority names match the formats contractors actually type.
 */
export function authorityPlaceTokens(raw: string | null | undefined): string[] {
  const text = (raw ?? '').toLowerCase();
  const parts = text
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !AUTHORITY_STOPWORDS.has(t));
  return Array.from(new Set(parts)).sort();
}

/** True when `needle`'s tokens are all present in `hay`. A one-token name of
 *  two letters or fewer ("la", "dc") must match the WHOLE token set — without
 *  that, "La Grange" resolves to Los Angeles. */
function tokensContained(needle: readonly string[], hay: Set<string>): boolean {
  if (needle.length === 0) return false;
  if (needle.length === 1 && needle[0].length <= 2) {
    return hay.size === 1 && hay.has(needle[0]);
  }
  return needle.every((t) => hay.has(t));
}

/**
 * The LOCAL_ADOPTIONS row an authority string names, or null.
 *
 * Two ways in, in order:
 *   1. the canonical `authorityName` itself — what issuingAuthorityForAddress
 *      returns, and what the Roadmap's "Add to permits" writes.
 *   2. free text the contractor typed. Its state (when it carries one) must
 *      AGREE with the row's, and the row's own `matchCity` / `matchCounty`
 *      names must appear in it. Ambiguity (more than one row) resolves to null
 *      rather than to a guess.
 */
function localEntryFor(cleaned: string): LocalAdoption | null {
  const norm = normalizePlace(cleaned);
  if (!norm) return null;
  for (const e of LOCAL_ADOPTIONS) {
    if (normalizePlace(stripAuthorityTails(e.authorityName)) === norm) return e;
  }
  const split = splitLocationText(cleaned);
  const state = normalizeState(split.state);
  const tokens = new Set(authorityPlaceTokens(split.city || cleaned));
  if (tokens.size === 0) return null;
  const hits: LocalAdoption[] = [];
  for (const e of LOCAL_ADOPTIONS) {
    if (state && e.state !== state) continue;
    const names = [...(e.matchCity ?? []), ...(e.matchCounty ?? [])];
    if (names.some((n) => tokensContained(authorityPlaceTokens(n), tokens))) hits.push(e);
  }
  return hits.length === 1 ? hits[0] : null;
}

interface AuthorityIdentity {
  /** `name|state` of the resolved adoption row, or '' when none resolved. */
  entryKey: string;
  /** Two-letter state, from the row or from the text. '' when unknown. */
  state: string;
  tokens: string[];
}

const IDENTITY_CACHE = new Map<string, AuthorityIdentity>();

function authorityIdentity(raw: string): AuthorityIdentity {
  const hit = IDENTITY_CACHE.get(raw);
  if (hit) return hit;
  const cleaned = stripAuthorityTails(raw);
  const entry = localEntryFor(cleaned);
  let out: AuthorityIdentity;
  if (entry) {
    out = { entryKey: `${normalizePlace(entry.name)}|${entry.state}`, state: entry.state, tokens: [] };
  } else {
    // A bare state name is not an office. "Kansas" must not answer for
    // "Kansas City Planning" — that collapse was a measured leak.
    const wholeState = normalizeState(cleaned);
    if (wholeState) {
      out = { entryKey: '', state: wholeState, tokens: [] };
    } else {
      const split = splitLocationText(cleaned);
      out = {
        entryKey: '',
        state: normalizeState(split.state),
        tokens: authorityPlaceTokens(split.city || cleaned),
      };
    }
  }
  if (IDENTITY_CACHE.size > 512) IDENTITY_CACHE.clear();
  IDENTITY_CACHE.set(raw, out);
  return out;
}

/**
 * True when two authority strings name the same permit office.
 *
 * Resolved rows are compared as rows, which is exact and cross-state-safe by
 * construction. Only when a side names an office MAGE has no row for does this
 * fall back to place-token containment — and even then a state the contractor
 * actually typed on BOTH sides must agree, so the two Springfields stay apart.
 */
export function sameAuthority(a: string | null | undefined, b: string | null | undefined): boolean {
  const ra = (a ?? '').trim();
  const rb = (b ?? '').trim();
  if (!ra || !rb) return false;
  const ia = authorityIdentity(ra);
  const ib = authorityIdentity(rb);
  if (ia.entryKey && ib.entryKey) return ia.entryKey === ib.entryKey;
  if (ia.state && ib.state && ia.state !== ib.state) return false;
  if (ia.entryKey || ib.entryKey) {
    // One side is a known row, the other is free text MAGE has no row for. The
    // row's own match names are the only place tokens it can be compared on.
    const known = ia.entryKey ? ra : rb;
    const other = ia.entryKey ? ib : ia;
    if (other.tokens.length === 0) return false;
    const knownTokens = new Set(authorityPlaceTokens(stripAuthorityTails(known)));
    return tokensContained(other.tokens, knownTokens);
  }
  const ta = ia.tokens;
  const tb = ib.tokens;
  if (ta.length === 0 || tb.length === 0) return false;
  const setA = new Set(ta);
  const setB = new Set(tb);
  return ta.every((t) => setB.has(t)) || tb.every((t) => setA.has(t));
}

/** True when a match was made on bare place tokens rather than on a row MAGE
 *  can name — the widened case the chip has to admit to. */
export function isWidenedAuthorityMatch(
  jurisdiction: string | null | undefined,
  authority: string | null | undefined,
): boolean {
  if (!sameAuthority(jurisdiction, authority)) return false;
  const ia = authorityIdentity((jurisdiction ?? '').trim());
  const ib = authorityIdentity((authority ?? '').trim());
  return !(ia.entryKey && ib.entryKey);
}

// ─────────────────────────────────────────────────────────────────────
// Matching the record to the question being asked
// ─────────────────────────────────────────────────────────────────────

/**
 * The Code Check categories that name a TRADE, and how an inspection row for
 * that trade actually reads on a jurisdiction's inspection card.
 *
 * `residential` and `commercial` are deliberately ABSENT: they describe the
 * building, not the inspection, so filtering by them would drop rows that are
 * plainly relevant. A category with no entry here matches the whole record and
 * says so.
 *
 * Permit TYPES are matched separately (a row on the electrical permit is an
 * electrical row even when the GC named it "Rough-in").
 */
const CATEGORY_NAME_PATTERNS: Record<string, RegExp> = {
  // NOT a bare /service/: "Water service" is a plumbing row, and the first
  // run of scripts/validate-inspection-history-facts.ts caught this regex
  // counting one as electrical. An electrical service is always qualified.
  electrical: /electric|panel|afci|gfci|feeder|circuit|low.?voltage|bonding|grounding|\bamps?\b|service (?:upgrade|entrance|panel|change)/i,
  plumbing: /plumb|gas|water|sewer|septic|drain|dwv|backflow|waste|vent|fixture/i,
  structural: /footing|foundation|framing|structur|shear|rebar|reinforc|slab|truss|anchor|masonry|steel|pier|caisson|underpin/i,
  egress_fire: /fire|sprinkler|alarm|egress|smoke|exit|extinguish|standpipe|hood|damper|rated/i,
  accessibility: /ada|accessib|ramp|grab.?bar|clearance|van.?accessible|path.?of.?travel/i,
  zoning: /zoning|setback|survey|site|grading|erosion|right.?of.?way|encroach/i,
};

const CATEGORY_PERMIT_TYPES: Record<string, readonly Permit['type'][]> = {
  electrical: ['electrical'],
  plumbing: ['plumbing'],
  structural: ['building', 'special_inspection'],
  egress_fire: ['fire'],
  accessibility: [],
  zoning: ['grading', 'demolition'],
};

/** Human name for a category, used in the sentences this module emits. */
const CATEGORY_LABELS: Record<string, string> = {
  electrical: 'electrical',
  plumbing: 'plumbing',
  structural: 'structural',
  egress_fire: 'fire / egress',
  accessibility: 'accessibility',
  zoning: 'zoning / site',
};

/** True when this category narrows the record at all. */
export function categoryNarrows(category: string | null | undefined): boolean {
  return !!category && Object.prototype.hasOwnProperty.call(CATEGORY_NAME_PATTERNS, category);
}

function matchesCategory(
  category: string | null | undefined,
  permitType: Permit['type'],
  inspectionName: string,
): boolean {
  if (!categoryNarrows(category)) return true;
  const key = category as string;
  if ((CATEGORY_PERMIT_TYPES[key] ?? []).includes(permitType)) return true;
  return CATEGORY_NAME_PATTERNS[key].test(inspectionName);
}

// ─────────────────────────────────────────────────────────────────────
// Reading the record
// ─────────────────────────────────────────────────────────────────────

/** How many inspector notes reach one prompt block. The count of notes NOT
 *  shown is stated in the fact line — a silent truncation of an inspector's
 *  correction is the same failure as paraphrasing it. */
const QUOTE_CAP = 4;

/** One inspection with the permit it hangs off, so a quote can cite it. */
interface MatchedInspection {
  inspection: PermitInspection;
  permitId: string;
  permitNumber?: string;
  permitType: Permit['type'];
  projectName: string;
  /** True when this row was matched on bare place tokens, not on a row MAGE
   *  can name. Those rows may be from a same-named town in another state. */
  widened: boolean;
}

/**
 * Every inspection on a permit, NEWEST FIRST. The history rides encoded inside
 * `inspectionNotes` (see utils/permitInspectionHistory.ts) and the decoder is
 * the source of truth; `permit.inspections`, when a caller has already
 * hydrated it, is the fallback. Never both — that would double-count.
 *
 * The fallback is sorted here too. It used to be returned in whatever order the
 * caller built it, so "newest first" held on the decoded path and not on the
 * hydrated one, and the note the quote cap dropped could be the most recent.
 */
export function inspectionsOnPermit(permit: Permit): PermitInspection[] {
  const decoded = decodePermitInspectionNotes(permit.inspectionNotes).inspections;
  if (decoded.length > 0) return sortPermitInspections(decoded);
  return sortPermitInspections(permit.inspections ?? []);
}

/** The item an inspection is OF, for collapsing a failure and its
 *  re-inspections into one event. */
function eventKey(m: MatchedInspection): string {
  return `${m.permitId}::${(m.inspection.name ?? '').trim().toLowerCase()}`;
}

function quoteLine(m: MatchedInspection, result: 'passed' | 'failed'): string | null {
  const note = (m.inspection.notes ?? '').trim();
  if (!note) return null;
  const job = m.projectName.trim();
  const where = m.permitNumber?.trim()
    ? `permit ${m.permitNumber.trim()}`
    : `the ${m.permitType.replace(/_/g, ' ')} permit`;
  // The JOB the note came from, always. The record spans every job with this
  // authority, and a quote that cites only a permit number lets a defect from
  // Maple St be reasoned about as if it were this job's.
  const onJob = job ? `${where} (${job})` : where;
  const who = (m.inspection.inspectorName ?? '').trim();
  const byWhom = who ? `Inspector ${who}` : 'The inspector';
  const verb = result === 'failed' ? 'failed' : 'passed';
  const name = (m.inspection.name || 'Inspection').trim();
  // The note is reproduced inside quotation marks and is never rewritten. If it
  // is long it is still reproduced whole: truncating an inspector's correction
  // is how "box fill at J-3" turns into a requirement nobody can act on.
  return `${m.inspection.scheduledFor} — ${byWhom} ${verb} "${name}" on ${onJob} and wrote: "${note}"`;
}

/** FNV-1a. Not a security hash — a content fingerprint, so the cache key
 *  changes when the inspector's WORDS change and not only when the counts do. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const UNKNOWN_INSTRUCTION =
  'MAGE cannot identify the issuing authority for this address, so it has not read this contractor\'s inspection history. Do not claim anything about what his inspectors have flagged before.';

const NONE_INSTRUCTION =
  'This contractor has no inspection on file with that authority. Say nothing about his past inspections — he has none here, and inventing a tendency for him is worse than saying nothing.';

const QUOTE_INSTRUCTION =
  'These are the contractor\'s OWN records, across every job of his with this authority. If you refer to a note, QUOTE it exactly as written and say which inspection, job and date it came from. NEVER restate an inspector\'s correction note as a code requirement: it is one inspector\'s words on one job, not a citation.';

const THIN_INSTRUCTION =
  `There are fewer than ${INSPECTION_PATTERN_FLOOR} DISTINCT called inspections here. State the raw count if you mention it at all. Do NOT describe a tendency, a pass rate, a habit, or what "usually" happens here — there is not enough of a record to support one.`;

const RECORD_INSTRUCTION =
  'You may state the counts above as counts. They describe THIS contractor with THIS authority, not the jurisdiction generally, and not any other contractor.';

/**
 * Render the contractor's inspection history for one authority and one
 * category.
 *
 * @param permits      Every permit MAGE holds for this account.
 * @param jurisdiction The issuing authority on screen, or null when MAGE has
 *                     no verified record for the address. Null is a real
 *                     answer and produces kind 'unknown'.
 * @param category     A Code Check category key, or null/undefined for the
 *                     whole record. Categories that name a building rather
 *                     than a trade (residential, commercial) do not narrow.
 */
export function inspectionHistoryFactsFor(
  permits: readonly Permit[],
  jurisdiction: string | null | undefined,
  category?: string | null,
): InspectionHistoryGrounding {
  const authority = (jurisdiction ?? '').trim();
  if (!authority) {
    const headline = 'MAGE has no issuing authority for this address, so it has not read your inspection history.';
    return {
      kind: 'unknown',
      headline,
      facts: [headline],
      promptBlock: `CONTRACTOR'S INSPECTION HISTORY: unavailable. ${headline}\n${UNKNOWN_INSTRUCTION}`,
      chipLabel: headline,
      grounded: false,
      patternAllowed: false,
      matched: 0,
      called: 0,
      distinctCalled: 0,
      failed: 0,
      quotes: [],
      cacheKey: 'insp:unknown',
    };
  }

  const narrowed = categoryNarrows(category);
  const catLabel = narrowed ? (CATEGORY_LABELS[category as string] ?? String(category)) : '';

  // Everything on file with this authority, then the slice the question asked
  // about. Both counts are kept: "no electrical rows, but 6 inspections here"
  // is a more useful and more honest answer than "no record".
  let inJurisdiction = 0;
  const matched: MatchedInspection[] = [];
  for (const p of permits) {
    if (!sameAuthority(p.jurisdiction, authority)) continue;
    const widened = isWidenedAuthorityMatch(p.jurisdiction, authority);
    for (const insp of inspectionsOnPermit(p)) {
      inJurisdiction += 1;
      if (!matchesCategory(category, p.type, insp.name ?? '')) continue;
      matched.push({
        inspection: insp,
        permitId: p.id,
        permitNumber: p.permitNumber,
        permitType: p.type,
        projectName: p.projectName ?? '',
        widened,
      });
    }
  }

  const called = matched.filter((m) => m.inspection.result === 'passed' || m.inspection.result === 'failed');
  const failedRows = called.filter((m) => m.inspection.result === 'failed');
  const passedCount = called.length - failedRows.length;
  // ONE defect re-inspected twice is one defect. Counting rows let a single
  // rough-electrical failure and its two re-inspections cross the floor and
  // license a stated 67% failure rate — exactly the horoscope the floor exists
  // to refuse.
  const distinctCalled = new Set(called.map(eventKey)).size;
  const reinspections = called.length - distinctCalled;

  // Failures first (a failure's note is the whole value of the record), then
  // newest first inside each group. Capped so the prompt block stays a block.
  const byDateDesc = (a: MatchedInspection, b: MatchedInspection) =>
    a.inspection.scheduledFor < b.inspection.scheduledFor ? 1 : a.inspection.scheduledFor > b.inspection.scheduledFor ? -1 : 0;
  const ordered = [
    ...[...failedRows].sort(byDateDesc),
    ...called.filter((m) => m.inspection.result === 'passed').sort(byDateDesc),
  ];
  const withNotes = ordered.filter((m) => (m.inspection.notes ?? '').trim().length > 0);
  const quotes: InspectionNoteQuote[] = [];
  for (const m of withNotes) {
    if (quotes.length >= QUOTE_CAP) break;
    const result: 'passed' | 'failed' = m.inspection.result === 'failed' ? 'failed' : 'passed';
    const line = quoteLine(m, result);
    if (!line) continue;
    quotes.push({ line, date: m.inspection.scheduledFor, result });
  }

  const scope = (count: number) => {
    const noun = `inspection${count === 1 ? '' : 's'}`;
    return narrowed ? `${catLabel} ${noun}` : noun;
  };
  const jobs = Array.from(new Set(matched.map((m) => m.projectName.trim()).filter(Boolean)));
  const widenedRows = matched.filter((m) => m.widened).length;

  if (called.length === 0) {
    // Phrase it from what was MEASURED. The old ordering tested
    // `inJurisdiction > 0 && narrowed` before `matched.length > 0`, so four
    // electrical rows with no verdict produced "4 inspections on file there,
    // none of them electrical" — a flatly false statement about his own file.
    const scheduled = matched.filter((m) => m.inspection.result === 'scheduled').length;
    const cancelled = matched.length - scheduled;
    const headline = matched.length > 0
      ? `${matched.length} ${scope(matched.length)} on file with ${authority}, none called yet (${scheduled} scheduled, ${cancelled} cancelled).`
      : inJurisdiction > 0 && narrowed
        ? `No ${catLabel} inspection called yet with ${authority} — ${inJurisdiction} inspection${inJurisdiction === 1 ? '' : 's'} on file there, none of them ${catLabel}.`
        : `No inspection record with ${authority} yet.`;
    return {
      kind: 'none',
      headline,
      facts: [headline],
      promptBlock: `CONTRACTOR'S INSPECTION HISTORY (his own records):\n- ${headline}\n${NONE_INSTRUCTION}`,
      chipLabel: `${headline} Nothing of yours is in this answer.`,
      grounded: false,
      patternAllowed: false,
      matched: matched.length,
      called: 0,
      distinctCalled: 0,
      failed: 0,
      quotes: [],
      cacheKey: `insp:none:${digest(`${authority}|${narrowed ? category : 'all'}|${headline}`)}`,
    };
  }

  const kind: InspectionHistoryKind =
    called.length >= INSPECTION_PATTERN_FLOOR && distinctCalled >= INSPECTION_PATTERN_FLOOR ? 'record' : 'thin';
  const headline =
    `You have had ${called.length} ${scope(called.length)} called with ${authority}. ` +
    `${failedRows.length} failed, ${passedCount} passed.`;

  const reinspectionLine = reinspections > 0
    ? `${reinspections} of those ${called.length} are re-inspections of an item already counted — ${distinctCalled} distinct inspection${distinctCalled === 1 ? '' : 's'}.`
    : null;

  const facts = [headline];
  if (reinspectionLine) facts.push(reinspectionLine);
  if (kind === 'thin') {
    facts.push(
      distinctCalled < INSPECTION_PATTERN_FLOOR && reinspections > 0
        ? `That is fewer than ${INSPECTION_PATTERN_FLOOR} DISTINCT called inspections — too few to say anything about a pattern. The counts stand on their own.`
        : `That is fewer than ${INSPECTION_PATTERN_FLOOR} called inspections — too few to say anything about a pattern. The counts stand on their own.`,
    );
  }
  if (quotes.length > 0) {
    facts.push(
      withNotes.length > quotes.length
        ? `What the inspectors actually wrote — the ${quotes.length} most recent of ${withNotes.length} notes, verbatim:`
        : 'What the inspectors actually wrote, verbatim:',
    );
    for (const q of quotes) facts.push(q.line);
  } else if (failedRows.length > 0) {
    facts.push('None of the failures carry a correction note, so there is nothing of the inspector\'s to quote.');
  }
  if (jobs.length > 1) {
    facts.push(`These come from ${jobs.length} of your jobs with this authority (${jobs.join(', ')}) — a note from one job is not a finding on this one.`);
  }
  if (widenedRows > 0) {
    facts.push(`${widenedRows} of these were matched by place name rather than by an authority MAGE has a record for, so one may be a same-named town.`);
  }
  if (narrowed && inJurisdiction > matched.length) {
    facts.push(
      `Narrowed to ${catLabel}: ${inJurisdiction} inspection${inJurisdiction === 1 ? '' : 's'} total on file with this authority.`,
    );
  }

  const instruction = kind === 'thin'
    ? `${QUOTE_INSTRUCTION}\n${THIN_INSTRUCTION}`
    : `${QUOTE_INSTRUCTION}\n${RECORD_INSTRUCTION}`;

  const thinWhy = kind !== 'thin'
    ? ''
    : reinspections > 0
      ? ` — ${distinctCalled} distinct item${distinctCalled === 1 ? '' : 's'}, ${reinspections} re-inspection${reinspections === 1 ? '' : 's'}`
      : '';
  const chipTail = kind === 'thin'
    ? ` Too few to call a pattern${thinWhy}${quotes.length > 0 ? ' — the inspector\'s note is in the answer' : ''}.`
    : quotes.length > 0
      ? ' The inspector\'s own notes are in this answer.'
      : ' No correction notes on file to quote.';
  const chipExtra = [
    reinspections > 0 && kind === 'record' ? ` ${reinspectionLine}` : '',
    jobs.length > 1 ? ` Across ${jobs.length} of your jobs.` : '',
    widenedRows > 0 ? ` ${widenedRows} matched by place name — one may be a same-named town.` : '',
  ].join('');

  const promptBlock = `CONTRACTOR'S INSPECTION HISTORY (his own records, not model recall):\n${facts.map((f) => `- ${f}`).join('\n')}\n${instruction}`;
  return {
    kind,
    headline,
    facts,
    promptBlock,
    chipLabel: `${headline}${chipTail}${chipExtra}`,
    grounded: true,
    patternAllowed: kind === 'record',
    matched: matched.length,
    called: called.length,
    distinctCalled,
    failed: failedRows.length,
    quotes,
    cacheKey: `insp:${kind}:${digest(promptBlock)}`,
  };
}
