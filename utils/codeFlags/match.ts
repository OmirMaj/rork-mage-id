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
// Pure: no React, no storage, no network.
import { normalizeScopeText } from '@/utils/scopeCoverage';
import {
  ASBESTOS_LAST_YEAR, CODE_FLAG_FAMILIES, LEAD_BUILT_BEFORE,
  type CodeFlagFamily, type CodeFlagFamilyId, type CodeFlagKind,
} from '@/utils/codeFlags/rules';
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
  /** A rule phrase that counts only because of the line's category or CSI division. */
  | 'category'
  /** Asbestos only: the line already carries a permit flag. */
  | 'permit_flag';

export interface CodeFlagTrigger {
  via: CodeFlagTriggerVia;
  /** The rule phrase, exactly as the table writes it ('' for 'permit_flag'). */
  phrase: string;
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
}

export interface CodeFlagLineResult {
  flagged: boolean;
  /** 'permit' when any permit family fired, else 'building_age', else null. */
  kind: CodeFlagKind | null;
  hits: CodeFlagHit[];
  place: CodeFlagPlace;
  /** True when a building-age rule could not be checked for want of a year. */
  ageNotChecked: boolean;
}

export const MAX_TRIGGERS_SHOWN = 3;

// ── text ─────────────────────────────────────────────────────────────────────

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === ' ' || ch === '/';
}

/** Every whole-word occurrence of `phrase` (or `phrase` + "s") in `norm`: [start, end). */
function occurrences(norm: string, phrase: string): [number, number][] {
  const p = normalizeScopeText(phrase);
  const out: [number, number][] = [];
  if (!p || !norm) return out;
  let from = 0;
  for (;;) {
    const at = norm.indexOf(p, from);
    if (at < 0) return out;
    let end = at + p.length;
    if (norm[end] === 's' && !p.endsWith('s')) end += 1;
    if (isBoundary(at === 0 ? undefined : norm[at - 1]) && isBoundary(norm[end])) out.push([at, end]);
    from = at + 1;
  }
}

/** True when `phrase` (or its plural) is in `norm` as whole words. */
export function hasPhrase(norm: string, phrase: string): boolean {
  return occurrences(norm, phrase).length > 0;
}

/** `norm` with every mask phrase replaced by spaces (same length, so nothing joins up). */
export function maskText(norm: string, masks: readonly string[]): string {
  if (!masks.length || !norm) return norm;
  const chars = norm.split('');
  for (const m of masks) {
    for (const [a, b] of occurrences(norm, m)) for (let i = a; i < b; i++) chars[i] = ' ';
  }
  return chars.join('');
}

function categoryNorm(line: CodeFlagLine): string {
  const csi = /^\s*(\d{2})/.exec(line.csiDivision ?? '')?.[1] ?? '';
  return normalizeScopeText(`${line.category ?? ''} ${csi}`);
}

function wordTriggers(family: CodeFlagFamily, line: CodeFlagLine): CodeFlagTrigger[] {
  const fields: { field: 'name' | 'description'; norm: string }[] = [
    { field: 'name', norm: normalizeScopeText(line.name ?? '') },
    { field: 'description', norm: normalizeScopeText(line.description ?? '') },
  ];
  if (family.veto?.length && fields.some((f) => family.veto!.some((v) => hasPhrase(f.norm, v)))) return [];
  const cat = categoryNorm(line);
  const out: CodeFlagTrigger[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    if (!f.norm) continue;
    const text = maskText(f.norm, family.mask);
    for (const phrase of family.triggers) {
      if (seen.has(phrase) || !hasPhrase(text, phrase)) continue;
      seen.add(phrase);
      out.push({ via: 'words', phrase, field: f.field });
    }
    for (const ct of family.categoryTriggers ?? []) {
      const category = ct.categories.find((c) => hasPhrase(cat, c));
      if (!category) continue;
      for (const phrase of ct.phrases) {
        if (seen.has(phrase) || !hasPhrase(text, phrase)) continue;
        seen.add(phrase);
        out.push({ via: 'category', phrase, field: f.field, category });
      }
    }
  }
  return out;
}

/** A whole year the age rules may read, else null (0 and nonsense are "unknown"). */
function usableYear(y: number | null | undefined): number | null {
  return typeof y === 'number' && Number.isInteger(y) && y >= 1600 && y <= 2200 ? y : null;
}

/**
 * The flags for one line. Never throws; an empty line is unflagged.
 *
 * Building age: no year on file means neither age rule is looked at
 * (`ageNotChecked` says so when one of them would otherwise have had words to
 * read). Lead needs a residential job built before LEAD_BUILT_BEFORE. Asbestos
 * needs New York City and a year of ASBESTOS_LAST_YEAR or earlier.
 */
export function flagLine(line: CodeFlagLine | null | undefined, ctx: CodeFlagContext = DEFAULT_CODE_FLAG_CONTEXT): CodeFlagLineResult {
  const place = ctx.place ?? NO_PLACE;
  const empty: CodeFlagLineResult = { flagged: false, kind: null, hits: [], place, ageNotChecked: false };
  if (!line || !`${line.name ?? ''}${line.description ?? ''}`.trim()) return empty;
  const year = usableYear(ctx.yearBuilt);

  const hits: CodeFlagHit[] = [];
  let ageNotChecked = false;
  const push = (family: CodeFlagFamily, triggers: CodeFlagTrigger[], yearBuilt?: number) => {
    const phrases = triggers.map((t) => t.phrase).filter(Boolean);
    hits.push({
      familyId: family.id, kind: family.kind,
      triggers: triggers.slice(0, MAX_TRIGGERS_SHOWN),
      local: codeFlagLocalRefs(place, family.id, phrases),
      ...(yearBuilt != null ? { yearBuilt } : {}),
    });
  };

  for (const family of CODE_FLAG_FAMILIES) {
    if (family.kind !== 'permit') continue;
    const triggers = wordTriggers(family, line);
    if (triggers.length) push(family, triggers);
  }
  const hasPermitFlag = hits.length > 0;

  for (const family of CODE_FLAG_FAMILIES) {
    if (family.kind !== 'building_age') continue;
    const triggers = wordTriggers(family, line);
    if (family.id === 'lead_age') {
      if (ctx.jobKind !== 'residential' || !triggers.length) continue;
      if (year == null) { ageNotChecked = true; continue; }
      if (year < LEAD_BUILT_BEFORE) push(family, triggers, year);
    } else if (family.id === 'asbestos_age') {
      if (place.id !== 'nyc') continue;
      const all: CodeFlagTrigger[] = triggers.length || !hasPermitFlag
        ? triggers
        : [{ via: 'permit_flag', phrase: '', field: null }];
      if (!all.length) continue;
      if (year == null) { ageNotChecked = true; continue; }
      if (year <= ASBESTOS_LAST_YEAR) push(family, all, year);
    }
  }

  if (!hits.length) return { ...empty, ageNotChecked };
  return {
    flagged: true,
    kind: hits.some((h) => h.kind === 'permit') ? 'permit' : 'building_age',
    hits, place, ageNotChecked,
  };
}

/** The family ids a result carries, in order (what a dismissal remembers). */
export function hitFamilyIds(result: CodeFlagLineResult): CodeFlagFamilyId[] {
  return result.hits.map((h) => h.familyId);
}
