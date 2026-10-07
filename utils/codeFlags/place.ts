// utils/codeFlags/place.ts — Code Flags: which place a line is in, and the
// official pages and section numbers the app ALREADY holds for that place.
//
// PLACES. New York City, Baltimore City and Baltimore County only. They come
// from the app's one resolver (utils/codeJurisdiction.resolveCodeJurisdiction),
// never from a second reading of the address. Everything else is 'other': the
// flag still shows, with no section number and no local link, and the sheet
// says the app has no local rules for the place. A Maryland address that could
// be the City or the County (the resolver's localAmbiguity) is 'other' too,
// with `unsettledBaltimore` set so the sheet can ask for the county or ZIP.
//
// THE FIREWALL (the utils/codeJurisdiction rule, carried over). Nothing here
// is written from recall. Every link is taken BY REFERENCE from data the repo
// already checked against the agency's own page:
//   - utils/permitPath/packs/sources.ts (SOURCE_REFS: nyc.gov pages, each with
//     the phrase the verifier looks for and the day it was checked);
//   - the New York City, Baltimore City and Baltimore County rows of
//     utils/codeJurisdiction.ts (their department channels and code pages).
// A link this file cannot find in that data is simply absent.
//
// SECTION NUMBERS. The app's checked data holds exactly two that bear on a
// kind of work here, both in the notes of a jurisdiction row:
//   - Baltimore City Building Code § 105.1.3 (who applies for the permit for
//     underpinning), shown only on a line that says underpinning;
//   - Baltimore County Code § 21-7-303 (when each new edition of the
//     electrical code takes effect), shown on electrical service lines.
// New York City has NONE on file. The study's "section number and official
// link on every flag" is Phase 2 (a licensed architect or expediter checks a
// real table); Phase 1 says "no checked section number yet" everywhere else.
// scripts/validate-code-flags.ts fails if a section label here is not found,
// character for character, in the row it is credited to.
//
// Pure: no React, no storage, no network.
import {
  LOCAL_ADOPTIONS, resolveCodeJurisdiction,
  type AddressQuery, type DepartmentQuestionStage, type LocalAdoption,
} from '@/utils/codeJurisdiction';
import { SOURCE_REFS, type SourceId } from '@/utils/permitPath/packs/sources';
import { UNDERPINNING_WORDS, type CodeFlagFamilyId } from '@/utils/codeFlags/rules';

export type CodeFlagPlaceId = 'nyc' | 'baltimore_city' | 'baltimore_county' | 'other';

export interface CodeFlagPlace {
  id: CodeFlagPlaceId;
  /** The row's own display name ('New York City'), or null for 'other'. */
  name: string | null;
  /** False when the line has no project, or the project has no state. */
  hasAddress: boolean;
  /** A Maryland address that could be Baltimore City or Baltimore County. */
  unsettledBaltimore: boolean;
  /** Two-letter state when the resolver knew it ('MD', 'NY'), else ''. */
  state: string;
}

export const NO_PLACE: CodeFlagPlace = Object.freeze({
  id: 'other', name: null, hasAddress: false, unsettledBaltimore: false, state: '',
});

const ROW_NAME: Record<Exclude<CodeFlagPlaceId, 'other'>, string> = {
  nyc: 'New York City',
  baltimore_city: 'Baltimore City',
  baltimore_county: 'Baltimore County',
};

function placeIdOfRow(name: string): CodeFlagPlaceId {
  if (name === ROW_NAME.nyc) return 'nyc';
  if (name === ROW_NAME.baltimore_city) return 'baltimore_city';
  if (name === ROW_NAME.baltimore_county) return 'baltimore_county';
  return 'other';
}

/** The place a project's address resolves to. Null or an empty query is NO_PLACE. */
export function resolveCodeFlagPlace(q: AddressQuery | null | undefined): CodeFlagPlace {
  if (!q || !((q.state ?? '').trim() || (q.city ?? '').trim() || (q.zip ?? '').trim())) return NO_PLACE;
  const r = resolveCodeJurisdiction(q);
  if (r.kind === 'unknown') return { ...NO_PLACE, hasAddress: !!(q.state ?? '').trim() };
  if (r.kind === 'state') {
    return { id: 'other', name: null, hasAddress: true, unsettledBaltimore: !!r.localAmbiguity, state: r.state };
  }
  const id = placeIdOfRow(r.entry.name);
  return { id, name: id === 'other' ? null : r.entry.name, hasAddress: true, unsettledBaltimore: false, state: r.state };
}

// ── links and sections ───────────────────────────────────────────────────────

export interface CodeFlagLink {
  /** The agency's own name for the page, as the app's data holds it. */
  label: string;
  url: string;
  /** The day the app's data was last checked against that page (ISO day). */
  checkedOn: string;
}

export type CodeFlagSectionId = 'baltimore_city_105_1_3' | 'baltimore_county_21_7_303';

export interface CodeFlagSection {
  id: CodeFlagSectionId;
  /** Exactly as the jurisdiction row writes it. */
  label: string;
  /** The code page the row cites for it. */
  link: CodeFlagLink;
}

export interface CodeFlagLocalRefs {
  links: CodeFlagLink[];
  section: CodeFlagSection | null;
}

const NONE: CodeFlagLocalRefs = Object.freeze({ links: [], section: null }) as CodeFlagLocalRefs;

function row(id: Exclude<CodeFlagPlaceId, 'other'>): LocalAdoption | null {
  return LOCAL_ADOPTIONS.find((e) => e.name === ROW_NAME[id]) ?? null;
}
function fromSource(id: SourceId): CodeFlagLink {
  const s = SOURCE_REFS[id];
  return { label: s.label, url: s.url, checkedOn: s.checkedOn };
}
/** The first department channel of a stage that carries a URL. */
function channel(r: LocalAdoption | null, stage: DepartmentQuestionStage, labelStarts?: string): CodeFlagLink | null {
  const d = r?.department;
  if (!d) return null;
  const c = d.questionChannels.find((x) => x.stage === stage && !!x.url && (!labelStarts || x.label.startsWith(labelStarts)));
  return c?.url ? { label: c.label, url: c.url, checkedOn: d.checkedOn } : null;
}
function compact(list: readonly (CodeFlagLink | null)[]): CodeFlagLink[] {
  const out: CodeFlagLink[] = [];
  for (const l of list) if (l && !out.some((o) => o.url === l.url)) out.push(l);
  return out;
}

/** The exact section labels, and the row each must be found in (validator pin). */
export const CODE_FLAG_SECTION_LABELS: Readonly<Record<CodeFlagSectionId, { label: string; place: Exclude<CodeFlagPlaceId, 'other'>; needle: string }>> = {
  baltimore_city_105_1_3: { label: 'Baltimore City Building Code § 105.1.3', place: 'baltimore_city', needle: 'Building Code § 105.1.3' },
  baltimore_county_21_7_303: { label: 'Baltimore County Code § 21-7-303', place: 'baltimore_county', needle: 'County Code § 21-7-303' },
};

function nycRefs(family: CodeFlagFamilyId): CodeFlagLocalRefs {
  const r = row('nyc');
  const inspections = channel(r, 'inspection');
  const permit = fromSource('V5');
  const byFamily: Partial<Record<CodeFlagFamilyId, CodeFlagLink[]>> = {
    egress: [fromSource('V3')],
    change_of_use: [fromSource('V3'), fromSource('V4')],
    plumbing: [fromSource('V6')],
    gas: [fromSource('V6')],
    electrical_service: [fromSource('V6')],
    asbestos_age: [fromSource('V7')],
  };
  if (family === 'lead_age') return NONE;
  if (family === 'asbestos_age') return { links: compact(byFamily.asbestos_age ?? []), section: null };
  return { links: compact([permit, ...(byFamily[family] ?? []), inspections]), section: null };
}

function baltimoreCityRefs(family: CodeFlagFamilyId, matched: readonly string[]): CodeFlagLocalRefs {
  const r = row('baltimore_city');
  if (!r || family === 'lead_age' || family === 'asbestos_age') return NONE;
  // The City's own code library (the row's sourceUrl), under the name the row gives the code.
  const code: CodeFlagLink = { label: r.codes[0]?.name ?? r.name, url: r.sourceUrl, checkedOn: r.checkedOn };
  const links = compact([
    channel(r, 'pre_filing', 'DHCD Permits'),
    channel(r, 'pre_filing', 'Work exempt'),
    channel(r, 'inspection'),
    code,
  ]);
  const meta = CODE_FLAG_SECTION_LABELS.baltimore_city_105_1_3;
  const underpinning = family === 'structural' && matched.some((m) => UNDERPINNING_WORDS.includes(m));
  const section: CodeFlagSection | null = underpinning && (r.notes ?? '').includes(meta.needle)
    ? { id: 'baltimore_city_105_1_3', label: meta.label, link: code }
    : null;
  return { links, section };
}

function baltimoreCountyRefs(family: CodeFlagFamilyId): CodeFlagLocalRefs {
  const r = row('baltimore_county');
  if (!r || family === 'lead_age' || family === 'asbestos_age') return NONE;
  // The County's current-codes page is its plans-review channel.
  const codePage = channel(r, 'in_review');
  const links = compact([channel(r, 'pre_filing'), channel(r, 'inspection'), codePage]);
  const meta = CODE_FLAG_SECTION_LABELS.baltimore_county_21_7_303;
  const section: CodeFlagSection | null = family === 'electrical_service' && (r.notes ?? '').includes(meta.needle) && codePage
    ? { id: 'baltimore_county_21_7_303', label: meta.label, link: codePage }
    : null;
  return { links, section };
}

/**
 * The local links and section number for one family on one line. Outside the
 * three places this is ALWAYS empty: no section, no link. `matched` is the
 * list of rule phrases that fired (a section can depend on the word).
 */
export function codeFlagLocalRefs(
  place: CodeFlagPlace,
  family: CodeFlagFamilyId,
  matched: readonly string[] = [],
): CodeFlagLocalRefs {
  if (place.id === 'other') return NONE;
  if (place.id === 'nyc') return nycRefs(family);
  if (place.id === 'baltimore_city') return baltimoreCityRefs(family, matched);
  return baltimoreCountyRefs(family);
}
