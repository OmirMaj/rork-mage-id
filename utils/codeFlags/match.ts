// utils/codeFlags/match.ts — Code Flags: the matcher. One line in, the
// families it touches out, each with the exact rule words that fired.
//
// DETERMINISTIC. No model call, no network, no clock, no storage: the same
// line, place and year always give the same answer, and every hit names the
// words that caused it (the sheet prints them). scripts/validate-code-flags.ts
// fails this file if it ever imports an AI or network module.
//
// WHAT A RESULT MEANS. `flagged: true` says only "this kind of work is
// commonly looked at on a permit or by an inspector". It is never a finding
// about this job, and `flagged: false` says nothing at all: a line with no
// flag can still need a permit. Nothing here can stop an action; the result
// carries no "blocked" or "must" field on purpose.
//
// TWO ANSWERS. flagLine is the chip on ONE line: permit kinds only. The two
// building-age rules (lead, asbestos) are answered once for the whole change
// order or estimate by flagBuildingAge, so an older home shows one quiet row
// above its lines instead of a chip on a third of them.
//
// COST. Every rule phrase is split into words ONCE, when this module loads,
// and filed under its first word. A line is split once per field, and each
// word is a map lookup, not a scan of the whole table.
//
// Pure: no React, no storage, no network.
import {
  ASBESTOS_LAST_YEAR, CODE_FLAG_FAMILIES, LEAD_BUILT_BEFORE,
  type CodeFlagFamily, type CodeFlagFamilyId, type CodeFlagKind, type CodeFlagPair,
} from '@/utils/codeFlags/rules';
import {
  BREAK, BREAK_WORDS, HEAD_TAIL_WORDS, NEGATION_SKIP, NEGATORS, NEGATOR_FIRST, NEGATOR_SECOND, PAIR_WINDOW, QUIET_AFTER,
  baseForms, isFormOf, isSkipWord, phraseTokens, tokenize,
} from '@/utils/codeFlags/text';
import { NO_PLACE, codeFlagLocalRefs, type CodeFlagLocalRefs, type CodeFlagPlace } from '@/utils/codeFlags/place';

export interface CodeFlagLine {
  name: string;
  description?: string | null;
  /** A CATEGORY_META key or label ('electrical'), when the line has one. */
  category?: string | null;
  /** A CSI division ('26', '26 0500'), when the line has one. */
  csiDivision?: string | null;
}

export interface CodeFlagContext {
  place: CodeFlagPlace;
  /** The building's year built, when the project has one on file. Null = unknown. */
  yearBuilt: number | null;
  jobKind: 'residential' | 'commercial';
}

export const DEFAULT_CODE_FLAG_CONTEXT: CodeFlagContext = Object.freeze({
  place: NO_PLACE, yearBuilt: null, jobKind: 'residential',
});

export type CodeFlagTriggerVia =
  /** A rule phrase found in the line's words. */
  | 'words'
  /** A verb and its noun, found within a few words of each other. */
  | 'pair'
  /** A rule phrase that counts only because of the line's category or CSI division. */
  | 'category'
  /** Asbestos only: the line already carries a permit flag. */
  | 'permit_flag';

export interface CodeFlagTrigger {
  via: CodeFlagTriggerVia;
  /** The rule phrase, exactly as the table writes it ('' for 'permit_flag').
   *  For a 'pair' it is the two rule words, "remove, wall". */
  phrase: string;
  /** 'pair' only: the verb and the noun, as the table writes them. */
  pair?: [string, string];
  /** Which part of the line it was found in. */
  field: 'name' | 'description' | null;
  /** The category word that let a 'category' trigger count. */
  category?: string;
}

export interface CodeFlagHit {
  familyId: CodeFlagFamilyId;
  kind: CodeFlagKind;
  /** At most MAX_TRIGGERS_SHOWN, in the table's order. */
  triggers: CodeFlagTrigger[];
  /** Local links and section. Always empty outside the three places. */
  local: CodeFlagLocalRefs;
  /** Building-age hits: the year the rule read. */
  yearBuilt?: number;
  /** Building-age hits: how many lines of the change order or estimate had the words. */
  lineCount?: number;
}

export interface CodeFlagLineResult {
  flagged: boolean;
  /** 'permit' when a permit family fired, else null. A line never carries a building-age hit. */
  kind: 'permit' | null;
  hits: CodeFlagHit[];
  place: CodeFlagPlace;
}

/** The building-age answer for a whole change order or estimate. */
export interface CodeFlagAgeResult {
  flagged: boolean;
  /** At most one hit per building-age family. */
  hits: CodeFlagHit[];
  place: CodeFlagPlace;
  /** True when a building-age rule could not be checked for want of a year. */
  ageNotChecked: boolean;
}

export const MAX_TRIGGERS_SHOWN = 3;

// ── the compiled table (built once, at module load) ──────────────────────────

interface Entry {
  /** The phrase's words. */
  tokens: string[];
  /** The phrase as the table writes it. */
  phrase: string;
  /** Where it sits in the table (the order triggers are shown in). */
  order: number;
}
interface Found { entry: Entry; end: number }

/** Phrases filed under their first word. A one-word phrase is filed under its singular. */
class PhraseIndex {
  private readonly byFirst = new Map<string, Entry[]>();
  size = 0;
  add(phrase: string, order: number): void {
    const tokens = phraseTokens(phrase);
    if (!tokens.length) return;
    const list = this.byFirst.get(tokens[0]);
    const entry = { tokens, phrase, order };
    if (list) list.push(entry); else this.byFirst.set(tokens[0], [entry]);
    this.size += 1;
  }
  /** Every phrase that starts at word `i` (the last word may be a plural). */
  at(words: readonly (string | null)[], i: number, out: Found[]): void {
    const w = words[i];
    if (!w || w === BREAK || !this.size) return;
    const forms = baseForms(w);
    for (let f = 0; f < forms.length; f++) {
      const list = this.byFirst.get(forms[f]);
      if (!list) continue;
      for (const entry of list) {
        const t = entry.tokens;
        const n = t.length;
        if (n === 1) { if (isFormOf(w, t[0])) out.push({ entry, end: i + 1 }); continue; }
        if (f !== 0 || i + n > words.length) continue;
        let ok = true;
        for (let k = 1; k < n - 1; k++) if (words[i + k] !== t[k]) { ok = false; break; }
        const last = words[i + n - 1];
        if (ok && last && isFormOf(last, t[n - 1])) out.push({ entry, end: i + n });
      }
    }
  }
}

interface CompiledPair { first: PhraseIndex; then: PhraseIndex; order: number }
interface CompiledFamily {
  family: CodeFlagFamily;
  triggers: PhraseIndex;
  pairs: CompiledPair[];
  category: { categories: string[][]; index: PhraseIndex }[];
  mask: PhraseIndex;
  maskPairs: CompiledPair[];
}

function indexOf(phrases: readonly string[], from = 0): PhraseIndex {
  const ix = new PhraseIndex();
  phrases.forEach((p, i) => ix.add(p, from + i));
  return ix;
}
function compilePairs(pairs: readonly CodeFlagPair[] | undefined, from: number): CompiledPair[] {
  return (pairs ?? []).map((p, i) => ({ first: indexOf(p.first), then: indexOf(p.then), order: from + i * 1000 }));
}
function compile(family: CodeFlagFamily): CompiledFamily {
  return {
    family,
    triggers: indexOf([...family.triggers, ...family.es]),
    pairs: compilePairs(family.pairs, 100000),
    category: (family.categoryTriggers ?? []).map((ct, i) => ({
      categories: ct.categories.map((c) => phraseTokens(c)),
      index: indexOf(ct.phrases, 900000 + i * 1000),
    })),
    mask: indexOf(family.mask),
    maskPairs: compilePairs(family.maskPairs, 0),
  };
}

const COMPILED: readonly CompiledFamily[] = CODE_FLAG_FAMILIES.map(compile);
const PERMIT = COMPILED.filter((c) => c.family.kind === 'permit');
const LEAD = COMPILED.find((c) => c.family.id === 'lead_age') as CompiledFamily;
const ASBESTOS = COMPILED.find((c) => c.family.id === 'asbestos_age') as CompiledFamily;

// ── reading a line ───────────────────────────────────────────────────────────

type Words = readonly (string | null)[];

/** True when the trigger starting at `i` is right after "no", "excluding", "not including" (or the Spanish). */
function negated(words: Words, i: number): boolean {
  let p = i - 1;
  while (p >= 0 && words[p] && NEGATION_SKIP.has(words[p] as string)) p -= 1;
  const w = p >= 0 ? words[p] : null;
  if (!w) return false;
  if (NEGATORS.has(w)) return true;
  const before = p >= 1 ? words[p - 1] : null;
  return NEGATOR_SECOND.has(w) && !!before && NEGATOR_FIRST.has(before);
}

/** True when the trigger ending at `end` is followed by "cover", "sticker", "delivery" and the like. */
function quietAfter(words: Words, end: number): boolean {
  const a = words[end];
  if (!a || a === BREAK) return false;
  if (QUIET_AFTER.has(a)) return true;
  const b = words[end + 1];
  return !BREAK_WORDS.has(a) && !!b && QUIET_AFTER.has(b);
}

/** True when the noun ending at `end` is the thing itself ("wall"), not a describing word ("wall tile"). */
function isHead(words: Words, end: number): boolean {
  if (end >= words.length) return true;
  const w = words[end];
  if (w === null) return false;
  if (w === BREAK) return end + 1 >= words.length || words[end + 1] !== null;
  return BREAK_WORDS.has(w) || /^\d/.test(w) || HEAD_TAIL_WORDS.has(w);
}

interface PairFound { start: number; end: number; first: Entry; then: Entry }

/**
 * Every verb-and-noun pair in `words`: the verb, then the noun within
 * PAIR_WINDOW ordinary words. Articles, room names, positions and numbers are
 * free. A break word ("and", "at", "for"), a comma or a blanked-out word ends
 * the verb's reach. With `head`, the noun must be the thing itself.
 */
function findPairs(words: Words, pair: CompiledPair, head: boolean, out: PairFound[]): void {
  if (!pair.first.size || !pair.then.size) return;
  const firsts: Found[] = [];
  const thens: Found[] = [];
  for (let i = 0; i < words.length; i++) {
    firsts.length = 0;
    pair.first.at(words, i, firsts);
    for (const f of firsts) {
      let gap = 0;
      for (let k = f.end; k < words.length; k++) {
        const w = words[k];
        if (w === null || w === BREAK) break;
        thens.length = 0;
        pair.then.at(words, k, thens);
        // The longest noun first ("door opening" before "door").
        thens.sort((a, b) => b.end - a.end);
        const hit = thens.find((t) => !head || isHead(words, t.end));
        if (hit) { out.push({ start: i, end: hit.end, first: f.entry, then: hit.entry }); break; }
        if (BREAK_WORDS.has(w)) break;
        if (isSkipWord(w)) continue;
        gap += 1;
        if (gap > PAIR_WINDOW) break;
      }
    }
  }
}

/** `words` with every mask phrase and mask pair of the family blanked out. */
function masked(c: CompiledFamily, words: readonly string[]): Words {
  if (!c.mask.size && !c.maskPairs.length) return words;
  let out: (string | null)[] | null = null;
  const found: Found[] = [];
  for (let i = 0; i < words.length; i++) {
    found.length = 0;
    c.mask.at(words, i, found);
    for (const m of found) {
      out = out ?? [...words];
      for (let k = i; k < m.end; k++) out[k] = null;
    }
  }
  if (c.maskPairs.length) {
    const pairs: PairFound[] = [];
    for (const mp of c.maskPairs) findPairs(out ?? words, mp, false, pairs);
    for (const m of pairs) {
      out = out ?? [...words];
      for (let k = m.start; k < m.end; k++) out[k] = null;
    }
  }
  return out ?? words;
}

interface Fields { name: readonly string[]; description: readonly string[]; category: readonly string[] }

function fieldsOf(line: CodeFlagLine): Fields {
  const csi = /^\s*(\d{2})/.exec(line.csiDivision ?? '')?.[1] ?? '';
  return {
    name: tokenize(line.name),
    description: tokenize(line.description),
    category: tokenize(`${line.category ?? ''} ${csi}`).filter((t) => t !== BREAK),
  };
}

function hasCategory(category: readonly string[], want: readonly string[]): boolean {
  if (!want.length) return false;
  for (let i = 0; i + want.length <= category.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) if (category[i + k] !== want[k]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/** The family's triggers on one line, in the table's order (name first, then description). */
function familyTriggers(c: CompiledFamily, fields: Fields): CodeFlagTrigger[] {
  const out: (CodeFlagTrigger & { order: number })[] = [];
  const seen = new Set<string>();
  const found: Found[] = [];
  const pairs: PairFound[] = [];
  const cats = c.category
    .map((ct) => ({ ct, hit: ct.categories.find((want) => hasCategory(fields.category, want)) }))
    .filter((x) => !!x.hit);
  for (const field of ['name', 'description'] as const) {
    const raw = fields[field];
    if (!raw.length) continue;
    const words = masked(c, raw);
    const base = field === 'name' ? 0 : 10000000;
    for (let i = 0; i < words.length; i++) {
      if (!words[i] || words[i] === BREAK) continue;
      found.length = 0;
      c.triggers.at(words, i, found);
      for (const m of found) {
        if (seen.has(m.entry.phrase) || negated(words, i) || quietAfter(words, m.end)) continue;
        seen.add(m.entry.phrase);
        out.push({ via: 'words', phrase: m.entry.phrase, field, order: base + m.entry.order });
      }
      for (const { ct, hit } of cats) {
        found.length = 0;
        ct.index.at(words, i, found);
        for (const m of found) {
          if (seen.has(m.entry.phrase) || negated(words, i) || quietAfter(words, m.end)) continue;
          seen.add(m.entry.phrase);
          out.push({ via: 'category', phrase: m.entry.phrase, field, category: (hit as string[]).join(' '), order: base + m.entry.order });
        }
      }
    }
    for (const pair of c.pairs) {
      pairs.length = 0;
      findPairs(words, pair, true, pairs);
      for (const m of pairs) {
        const phrase = `${m.first.phrase}, ${m.then.phrase}`;
        if (seen.has(phrase) || negated(words, m.start) || quietAfter(words, m.end)) continue;
        seen.add(phrase);
        out.push({ via: 'pair', phrase, pair: [m.first.phrase, m.then.phrase], field, order: base + pair.order + m.first.order });
      }
    }
  }
  out.sort((a, b) => a.order - b.order);
  return out.map(({ order: _order, ...t }) => t);
}

/** A whole year the age rules may read, else null (0 and nonsense are "unknown"). */
function usableYear(y: number | null | undefined): number | null {
  return typeof y === 'number' && Number.isInteger(y) && y >= 1600 && y <= 2200 ? y : null;
}

function isBlank(line: CodeFlagLine | null | undefined): boolean {
  return !line || !`${line.name ?? ''}${line.description ?? ''}`.trim();
}

function permitHits(fields: Fields, place: CodeFlagPlace): CodeFlagHit[] {
  const hits: CodeFlagHit[] = [];
  for (const c of PERMIT) {
    const triggers = familyTriggers(c, fields);
    if (!triggers.length) continue;
    hits.push({
      familyId: c.family.id, kind: 'permit',
      triggers: triggers.slice(0, MAX_TRIGGERS_SHOWN),
      local: codeFlagLocalRefs(place, c.family.id, triggers.map((t) => t.phrase)),
    });
  }
  // A wall the structural family already flagged is not flagged a second time
  // as a layout change.
  if (hits.some((h) => h.familyId === 'structural')) return hits.filter((h) => h.familyId !== 'layout_change');
  return hits;
}

/**
 * The flags for ONE line: permit kinds only. Never throws; an empty line is
 * unflagged. The building-age rules are flagBuildingAge's, once per document.
 */
export function flagLine(line: CodeFlagLine | null | undefined, ctx: CodeFlagContext = DEFAULT_CODE_FLAG_CONTEXT): CodeFlagLineResult {
  const place = ctx.place ?? NO_PLACE;
  if (isBlank(line)) return { flagged: false, kind: null, hits: [], place };
  const hits = permitHits(fieldsOf(line as CodeFlagLine), place);
  return hits.length ? { flagged: true, kind: 'permit', hits, place } : { flagged: false, kind: null, hits: [], place };
}

/**
 * The building-age flags for a WHOLE change order or estimate: at most one hit
 * for lead and one for asbestos, however many lines have the words.
 *
 * No year on file means neither rule is looked at (`ageNotChecked` says so
 * when one of them would otherwise have had words to read). Lead needs a
 * residential job built before LEAD_BUILT_BEFORE. Asbestos needs New York City
 * and a year of ASBESTOS_LAST_YEAR or earlier, and a line with one of its
 * words or with a permit flag.
 */
export function flagBuildingAge(
  lines: readonly (CodeFlagLine | null | undefined)[] | null | undefined,
  ctx: CodeFlagContext = DEFAULT_CODE_FLAG_CONTEXT,
): CodeFlagAgeResult {
  const place = ctx.place ?? NO_PLACE;
  const year = usableYear(ctx.yearBuilt);
  const wantLead = ctx.jobKind === 'residential';
  const wantAsbestos = place.id === 'nyc';
  const none: CodeFlagAgeResult = { flagged: false, hits: [], place, ageNotChecked: false };
  if (!lines?.length || (!wantLead && !wantAsbestos)) return none;

  const lead = { lines: 0, triggers: [] as CodeFlagTrigger[] };
  const asbestos = { lines: 0, triggers: [] as CodeFlagTrigger[], permitLines: 0 };
  const add = (into: CodeFlagTrigger[], from: CodeFlagTrigger[]) => {
    for (const t of from) if (!into.some((x) => x.phrase === t.phrase)) into.push(t);
  };
  for (const line of lines) {
    if (isBlank(line)) continue;
    const fields = fieldsOf(line as CodeFlagLine);
    if (wantLead) {
      const t = familyTriggers(LEAD, fields);
      if (t.length) { lead.lines += 1; add(lead.triggers, t); }
    }
    if (wantAsbestos) {
      const t = familyTriggers(ASBESTOS, fields);
      if (t.length) { asbestos.lines += 1; add(asbestos.triggers, t); }
      else if (permitHits(fields, place).length) asbestos.permitLines += 1;
    }
  }

  const leadWords = lead.lines > 0;
  const asbestosWords = asbestos.lines > 0 || asbestos.permitLines > 0;
  if (!leadWords && !asbestosWords) return none;
  if (year == null) return { ...none, ageNotChecked: true };

  const hits: CodeFlagHit[] = [];
  if (leadWords && year < LEAD_BUILT_BEFORE) {
    hits.push({
      familyId: 'lead_age', kind: 'building_age', triggers: lead.triggers.slice(0, MAX_TRIGGERS_SHOWN),
      local: codeFlagLocalRefs(place, 'lead_age', []), yearBuilt: year, lineCount: lead.lines,
    });
  }
  if (asbestosWords && year <= ASBESTOS_LAST_YEAR) {
    const triggers: CodeFlagTrigger[] = asbestos.triggers.length
      ? asbestos.triggers.slice(0, MAX_TRIGGERS_SHOWN)
      : [{ via: 'permit_flag', phrase: '', field: null }];
    hits.push({
      familyId: 'asbestos_age', kind: 'building_age', triggers,
      local: codeFlagLocalRefs(place, 'asbestos_age', []), yearBuilt: year,
      lineCount: asbestos.lines || asbestos.permitLines,
    });
  }
  return hits.length ? { flagged: true, hits, place, ageNotChecked: false } : none;
}

/** The family ids a result carries, in order (what a dismissal remembers). */
export function hitFamilyIds(result: { hits: readonly CodeFlagHit[] }): CodeFlagFamilyId[] {
  return result.hits.map((h) => h.familyId);
}

/** How many rule phrases and pairs the table holds (for the validator's summary line). */
export function codeFlagTableSize(): { phrases: number; spanish: number; pairs: number } {
  let phrases = 0; let spanish = 0; let pairs = 0;
  for (const f of CODE_FLAG_FAMILIES) {
    phrases += f.triggers.length;
    spanish += f.es.length;
    pairs += (f.pairs ?? []).length;
  }
  return { phrases, spanish, pairs };
}
