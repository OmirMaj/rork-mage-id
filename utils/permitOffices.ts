// utils/permitOffices.ts — WHICH office issues the permit, for a NY / NJ / CT
// jobsite outside the city rows in utils/codeJurisdiction.ts. PURE: no React,
// no storage, no network, so bun validators drive it directly
// (scripts/validate-permit-offices.ts). The I/O half — the edge-function call
// and the mageid_place_* cache — is utils/placeLookup.ts.
//
// INPUT is a Census answer from the place-lookup edge function: the county
// subdivision (the town / township / borough / city), the incorporated place
// (a village or city), the census-designated place (a hamlet) and the county,
// with how it was found ('address' | 'approximate' from the map pin | 'none').
//
// THE RULES
//   NY  an incorporated VILLAGE or CITY first, otherwise the TOWN; a hamlet
//       (CDP) has no government, so it maps to its town. The five NYC counties
//       answer 'nyc' so the caller keeps the existing NYC DOB card.
//   NJ  the municipality: the Census county subdivision, joined to the NJ DCA
//       roster by its GEOID (the roster's 4-digit code is carried alongside).
//   CT  the town, plus the DAS list's sub-town offices (City of Groton,
//       Groton Long Point, Fenwick …) when the Census place at the address is
//       one of them, plus its "See <town>" aliases for a mailing-town guess.
// HONESTY
//   approximate → "Looks like X (from the map pin) — confirm."
//   none        → never picks one; NY says it could be the town or a village.
//   NY village  → villages usually run their own department but can hand
//                 enforcement to the county — confirm.
//   Every office carries where its facts came from. A NY office MAGE has not
//   read off the office's own site is a NAME-ONLY card that says so.
//
// DEPARTMENTS is keyed by state + municipality id: 'NJ:<4-digit code>',
// 'CT:<office id>', 'NY:<Census GEOID>'. No code-adoption row is needed (or
// invented) to carry a phone number.

import njRoster from './generated/njConstructionOffices.json';
import ctList from './generated/ctBuildingOfficials.json';
import { jobsiteAddressForProject, normalizeState, type AddressableProject } from './codeJurisdiction';

// ─────────────────────────────────────────────────────────────────────
// The Census answer (wire shape of supabase/functions/place-lookup)
// ─────────────────────────────────────────────────────────────────────

export type PlaceMatch = 'address' | 'approximate' | 'none';
export type TristateCode = 'NY' | 'NJ' | 'CT';
export const TRISTATE: readonly TristateCode[] = ['NY', 'NJ', 'CT'];

/** One Census geography. `kind` is the Census type word after the name
 *  ("Garden City village" → 'village'; "Levittown CDP" → 'CDP'; '' when the
 *  NAME carries none, e.g. "Princeton"). */
export interface PlaceUnit {
  name: string;
  basename: string;
  geoid: string;
  kind: string;
}

export interface PlaceLookupResult {
  state: TristateCode | null;
  county: { name: string; geoid: string } | null;
  town: PlaceUnit | null;
  incorporatedPlace: PlaceUnit | null;
  cdp: PlaceUnit | null;
  match: PlaceMatch;
  matchedAddress: string | null;
  source: string;
  asOf: string;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

function unitFrom(v: unknown): PlaceUnit | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.name) || !isStr(o.basename) || !isStr(o.geoid) || !isStr(o.kind)) return null;
  if (!/^\d{5,12}$/.test(o.geoid) || !o.basename.trim()) return null;
  return { name: o.name.slice(0, 120), basename: o.basename.slice(0, 120), geoid: o.geoid, kind: o.kind.slice(0, 20) };
}

/** Validate an untrusted place-lookup response. Anything malformed is null —
 *  the caller shows nothing rather than a half-read answer. */
export function parsePlaceLookupResponse(raw: unknown): PlaceLookupResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.status !== 'ok') return null;
  const match = o.match;
  if (match !== 'address' && match !== 'approximate' && match !== 'none') return null;
  const state = o.state === null ? null : (TRISTATE as readonly unknown[]).includes(o.state) ? (o.state as TristateCode) : undefined;
  if (state === undefined) return null;
  let county: PlaceLookupResult['county'] = null;
  if (o.county && typeof o.county === 'object') {
    const c = o.county as Record<string, unknown>;
    if (isStr(c.name) && isStr(c.geoid) && /^\d{5}$/.test(c.geoid)) county = { name: c.name.slice(0, 80), geoid: c.geoid };
  }
  if (!isStr(o.source) || !isStr(o.asOf)) return null;
  const result: PlaceLookupResult = {
    state,
    county,
    town: unitFrom(o.town),
    incorporatedPlace: unitFrom(o.incorporatedPlace),
    cdp: unitFrom(o.cdp),
    match,
    matchedAddress: isStr(o.matchedAddress) ? o.matchedAddress.slice(0, 200) : null,
    source: o.source.slice(0, 200),
    asOf: o.asOf.slice(0, 40),
  };
  // A match that names no geography at all is not a match.
  if (match !== 'none' && !result.town && !result.incorporatedPlace && !result.county) return null;
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// What to ask for, and how long to remember the answer
// ─────────────────────────────────────────────────────────────────────

export interface PlaceQuery {
  address: string;
  lat: number | null;
  lon: number | null;
  state: TristateCode;
  postalCity: string;
}

export interface PlaceQueryProject extends AddressableProject {
  locationLatitude?: number | null;
  locationLongitude?: number | null;
}

/** The lookup a project implies, or null when it isn't a NY/NJ/CT jobsite or
 *  names no address to look up. */
export function placeQueryForProject(project: PlaceQueryProject | null | undefined): PlaceQuery | null {
  if (!project) return null;
  const a = jobsiteAddressForProject(project);
  const state = normalizeState(a.state);
  if (!(TRISTATE as readonly string[]).includes(state)) return null;
  const address = a.street
    ? [a.street, a.city, [state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    : (project.location ?? '').trim();
  if (!address) return null;
  const lat = project.locationLatitude;
  const lon = project.locationLongitude;
  const pin = typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon);
  return {
    address: address.slice(0, 200),
    lat: pin ? lat : null,
    lon: pin ? lon : null,
    state: state as TristateCode,
    postalCity: a.city,
  };
}

/** Every cached answer lives under this prefix, so the tenant wipe's prefix
 *  sweep (utils/localCacheKeys.ts, 'mageid_') removes it on sign-out. */
export const PLACE_CACHE_KEY_PREFIX = 'mageid_place_';

/** FNV-1a, 32-bit: the key names a hash of the address, not the address. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function placeCacheKey(q: PlaceQuery): string {
  const addr = q.address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const pin = q.lat != null && q.lon != null ? `${q.lat.toFixed(4)},${q.lon.toFixed(4)}` : '-';
  return `${PLACE_CACHE_KEY_PREFIX}${fnv1a(`${addr}|${pin}`)}`;
}

/** A found place is remembered 30 days; "not found" only one, so a corrected
 *  address or a Census fix shows up quickly. Errors are never cached. */
export const PLACE_TTL_FOUND_MS = 30 * 24 * 60 * 60 * 1000;
export const PLACE_TTL_NONE_MS = 24 * 60 * 60 * 1000;

export interface CachedPlace {
  savedAt: number;
  place: PlaceLookupResult;
}

export function cachedPlaceIsFresh(entry: CachedPlace, now: number): boolean {
  const ttl = entry.place.match === 'none' ? PLACE_TTL_NONE_MS : PLACE_TTL_FOUND_MS;
  const age = now - entry.savedAt;
  return age >= 0 && age < ttl;
}

export function parseCachedPlace(raw: string | null): CachedPlace | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.savedAt !== 'number') return null;
    const place = parsePlaceLookupResponse({ status: 'ok', ...(o.place as object) });
    return place ? { savedAt: o.savedAt, place } : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// The offices
// ─────────────────────────────────────────────────────────────────────

/** hand-verified: read off the office's own site on `checkedOn`.
 *  state-list:    a dated state roster (NJ DCA, CT DAS), `asOf`.
 *  name-only:     the name comes from Census geography; nothing else is known. */
export type OfficeVerification = 'hand-verified' | 'state-list' | 'name-only';

export interface PermitOffice {
  key: string;
  /** The municipality, as a contractor would say it: "Town of Hempstead". */
  jurisdiction: string;
  /** The card title: "Town of Hempstead Department of Buildings". */
  title: string;
  subtitle: string | null;
  verification: OfficeVerification;
  address: readonly string[];
  phone: string | null;
  email: string | null;
  portalUrl: string | null;
  hours: string | null;
  /** Fixed facts about this office from its source (never advice). */
  facts: readonly string[];
  /** "NJ DCA roster, as of 2026-09-02" / "hempsteadny.gov, checked 2026-09-26". */
  sourceLabel: string;
  sourceUrl: string | null;
}

/** A `tel:` URL for a listed phone, dialling the main number only:
 *  "(516) 624-6200 ext. 1" → "tel:5166246200". Null when fewer than ten
 *  digits remain (a malformed listing is shown, never dialled). */
export function telUrlFor(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const main = phone.split(/\s*(?:x|ext\.?|ex)\s*\d/i)[0];
  const digits = main.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 11 ? `tel:${digits}` : null;
}

export const NAME_ONLY_NOTE = "Derived from Census geography; MAGE hasn't verified this office's contact details.";
export const NAME_ONLY_BADGE = 'Contact details not verified by MAGE';

// ── NY: hand-verified Nassau towns ──────────────────────────────────
// Each fact below was read off the town's own page on `checkedOn`; the portal
// link is the one that page publishes. Keyed by the town's Census GEOID
// (TIGERweb county subdivisions, Nassau County 36059).
interface HandCard {
  geoid: string;
  jurisdiction: string;
  title: string;
  address: string[];
  phone: string;
  hours: string | null;
  portalUrl: string;
  portalSeenOn: string;
  sourceUrl: string;
  checkedOn: string;
  facts: string[];
}

export const NY_HAND_VERIFIED: readonly HandCard[] = [
  {
    geoid: '3605934000',
    jurisdiction: 'Town of Hempstead',
    title: 'Town of Hempstead Department of Buildings',
    address: ['One Washington Street, 2nd Floor', 'Hempstead, NY 11550'],
    phone: '516-538-8500',
    hours: 'Front counter 8 am to 4:45 pm',
    portalUrl: 'https://hempsteadny.viewpointcloud.com/',
    portalSeenOn: 'https://hempsteadny.gov/622/Online-Permit-Center',
    sourceUrl: 'https://hempsteadny.gov/191/Building-Department',
    checkedOn: '2026-09-26',
    facts: ['Plans examiners: 516-812-3073, 9 am to noon; call the day before for an appointment.'],
  },
  {
    geoid: '3605953000',
    jurisdiction: 'Town of North Hempstead',
    title: 'Town of North Hempstead Department of Buildings',
    address: ['176 Plandome Road', 'Manhasset, NY 11030'],
    phone: '516-869-7660',
    hours: 'Office 7:00 a.m. to 4:45 p.m.; inspectors 7:00 a.m. to 2:45 p.m.',
    portalUrl: 'https://mytonh.com/',
    portalSeenOn: 'https://www.northhempsteadny.gov/departments/buildings/index.php',
    sourceUrl: 'https://www.northhempsteadny.gov/departments/buildings/index.php',
    checkedOn: '2026-09-26',
    facts: [],
  },
  {
    geoid: '3605956000',
    jurisdiction: 'Town of Oyster Bay',
    title: 'Town of Oyster Bay Building Division',
    address: ['74 Audrey Ave', 'Oyster Bay, NY'],
    phone: '(516) 624-6200 ext. 1',
    hours: null,
    portalUrl: 'https://oysterbaytown.com/departments/planning-and-development/building-portal/',
    portalSeenOn: 'https://oysterbaytown.com/departments/planning-and-development/',
    sourceUrl: 'https://oysterbaytown.com/departments/planning-and-development/building/',
    checkedOn: '2026-09-26',
    facts: ['Applications are also taken at the Building Division Annex, Town Hall South, 977 Hicksville Rd, Massapequa.'],
  },
];

// ── NJ: the DCA roster ─────────────────────────────────────────────
interface NjEntry {
  code: string; name: string; county: string; censusGeoid: string;
  address: string[]; phone: string | null; fax: string | null; dcaEnforced: boolean;
}
const NJ_TYPE_WORDS: Record<string, string> = { TWP: 'Township', BORO: 'Borough' };

/** "HI-NELLA BORO" → "Hi-Nella Borough"; "HOBOKEN CITY" → "Hoboken City". */
export function titleCaseNjName(name: string): string {
  return name.split(' ').map((w) => NJ_TYPE_WORDS[w]
    ?? w.toLowerCase().replace(/(^|[-'])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())).join(' ');
}

function njOffice(e: NjEntry): PermitOffice {
  const muni = titleCaseNjName(e.name);
  const county = titleCaseNjName(e.county);
  return {
    key: `NJ:${e.code}`,
    jurisdiction: muni,
    title: `${muni} construction office`,
    subtitle: `${county} County, NJ · municipal code ${e.code}`,
    verification: 'state-list',
    address: e.address,
    phone: e.phone,
    email: null,
    portalUrl: null,
    hours: null,
    facts: e.dcaEnforced
      ? ['The DCA roster lists the NJ Department of Community Affairs as the construction official here: the state enforces the code in this municipality.']
      : [],
    sourceLabel: `NJ DCA roster, as of ${njRoster.asOf}`,
    sourceUrl: njRoster.sourceUrl,
  };
}

// ── CT: the DAS list ───────────────────────────────────────────────
interface CtEntry {
  id: string; name: string; qualifier: string | null; staffing: string | null; censusGeoid: string | null;
  address: string[]; addressOmitted: string | null; phone: string | null; email: string | null;
}

function ctOffice(e: CtEntry): PermitOffice {
  const place = e.qualifier && !/^Town of /i.test(e.qualifier) ? e.qualifier : e.name;
  const facts: string[] = [];
  if (e.staffing) facts.push(`The DAS list marks this office ${e.staffing}.`);
  if (e.addressOmitted) facts.push(`No address shown: ${e.addressOmitted}.`);
  return {
    key: `CT:${e.id}`,
    jurisdiction: place,
    title: `${place} building official`,
    subtitle: 'Connecticut',
    verification: 'state-list',
    address: e.address,
    phone: e.phone,
    email: e.email,
    portalUrl: null,
    hours: null,
    facts,
    sourceLabel: `CT DAS list, as of ${ctList.asOf}`,
    sourceUrl: ctList.sourceUrl,
  };
}

/** "https://www.northhempsteadny.gov/…" → "northhempsteadny.gov". A regex, not
 *  `new URL()`: React Native's URL polyfill does not implement `hostname`. */
function hostOf(url: string): string {
  return (/^https?:\/\/([^/]+)/.exec(url)?.[1] ?? url).replace(/^www\./, '');
}

function nyHandOffice(h: HandCard): PermitOffice {
  return {
    key: `NY:${h.geoid}`,
    jurisdiction: h.jurisdiction,
    title: h.title,
    subtitle: 'New York',
    verification: 'hand-verified',
    address: h.address,
    phone: h.phone,
    email: null,
    portalUrl: h.portalUrl,
    hours: h.hours,
    facts: h.facts,
    sourceLabel: `${hostOf(h.sourceUrl)}, checked ${h.checkedOn}`,
    sourceUrl: h.sourceUrl,
  };
}

/** The office map, keyed by state + municipality id. */
export const DEPARTMENTS: Readonly<Record<string, PermitOffice>> = (() => {
  const m: Record<string, PermitOffice> = {};
  for (const e of njRoster.offices as NjEntry[]) m[`NJ:${e.code}`] = njOffice(e);
  for (const e of ctList.offices as CtEntry[]) m[`CT:${e.id}`] = ctOffice(e);
  for (const h of NY_HAND_VERIFIED) m[`NY:${h.geoid}`] = nyHandOffice(h);
  return m;
})();

const NJ_BY_GEOID = new Map((njRoster.offices as NjEntry[]).map((e) => [e.censusGeoid, e.code]));
const CT_BY_GEOID = new Map((ctList.offices as CtEntry[]).filter((e) => e.censusGeoid).map((e) => [e.censusGeoid as string, e.id]));

const placeNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** CT offices that are NOT a whole town (City of Groton, Groton Long Point,
 *  Fenwick …), keyed by the place name they cover. */
const CT_SUB_TOWN = new Map<string, string>();
for (const e of ctList.offices as CtEntry[]) {
  if (e.censusGeoid) continue;
  const q = e.qualifier && /^City of (.+)$/i.exec(e.qualifier);
  CT_SUB_TOWN.set(q ? `${placeNorm(q[1])} city` : placeNorm(e.name), e.id);
}
const CT_BY_NAME = new Map((ctList.offices as CtEntry[]).filter((e) => e.censusGeoid).map((e) => [placeNorm(e.name), e.id]));
const CT_ALIAS = new Map((ctList.aliases as { name: string; seeTowns: string[] }[]).map((a) => [placeNorm(a.name), a.seeTowns]));

/** The name-only card for a NY municipality MAGE hasn't verified. */
export function nameOnlyOffice(state: TristateCode, jurisdiction: string, geoid: string): PermitOffice {
  return {
    key: `${state}:${geoid}`,
    jurisdiction,
    title: jurisdiction,
    subtitle: null,
    verification: 'name-only',
    address: [],
    phone: null,
    email: null,
    portalUrl: null,
    hours: null,
    facts: [NAME_ONLY_NOTE],
    sourceLabel: 'US Census geography',
    sourceUrl: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// The resolver
// ─────────────────────────────────────────────────────────────────────

export interface PermitOfficeAnswer {
  /** nyc: keep the existing NYC DOB card. office: show `office`.
   *  unresolved: show `headline` only. unsupported: show nothing. */
  kind: 'nyc' | 'office' | 'unresolved' | 'unsupported';
  office: PermitOffice | null;
  headline: string | null;
  cautions: readonly string[];
}

export const NYC_COUNTY_GEOIDS: readonly string[] = ['36005', '36047', '36061', '36081', '36085'];

export const VILLAGE_CAUTION =
  'Villages usually run their own building department, but a village can hand enforcement to the county. Confirm with the village before you file.';
export const PIN_TOWN_CAUTION =
  "This comes from the map pin, not the street address. If the job sits inside one of the town's villages, the village's department issues the permit.";

const UNSUPPORTED: PermitOfficeAnswer = { kind: 'unsupported', office: null, headline: null, cautions: [] };

function pinHeadline(match: PlaceMatch, jurisdiction: string): string | null {
  return match === 'approximate' ? `Looks like ${jurisdiction} (from the map pin). Confirm.` : null;
}

function noneHeadline(state: TristateCode, postalCity: string): string {
  const city = postalCity.trim();
  if (state === 'NY') {
    return `MAGE couldn't place this address on the Census map. ${city ? `A New York mailing town like ${city}` : 'A New York address'} could be in a town or in one of its villages, and each runs its own building department. Confirm which one before you file.`;
  }
  if (state === 'NJ') {
    return "MAGE couldn't place this address on the Census map. In New Jersey the mailing town is often not the municipality, so confirm the municipality before you file.";
  }
  return "MAGE couldn't place this address on the Census map. Confirm the town before you file.";
}

function resolveNy(place: PlaceLookupResult): PermitOfficeAnswer {
  if (place.county && NYC_COUNTY_GEOIDS.includes(place.county.geoid)) {
    return { kind: 'nyc', office: null, headline: pinHeadline(place.match, 'New York City'), cautions: [] };
  }
  const ip = place.incorporatedPlace;
  if (ip && (ip.kind === 'village' || ip.kind === 'city')) {
    const isCity = ip.kind === 'city';
    const jurisdiction = `${isCity ? 'City' : 'Village'} of ${ip.basename}`;
    // A NY city is also a county subdivision; key it on that GEOID so a hand
    // card for the city (keyed like a town) is found.
    const geoid = isCity && place.town?.kind === 'city' && place.town.basename === ip.basename ? place.town.geoid : ip.geoid;
    const office = DEPARTMENTS[`NY:${geoid}`] ?? nameOnlyOffice('NY', jurisdiction, geoid);
    const cautions = isCity ? [] : [VILLAGE_CAUTION];
    return { kind: 'office', office, headline: pinHeadline(place.match, jurisdiction), cautions };
  }
  const town = place.town;
  if (!town) return { kind: 'unresolved', office: null, headline: noneHeadline('NY', ''), cautions: [] };
  const jurisdiction = town.kind === 'city' ? `City of ${town.basename}` : `Town of ${town.basename}`;
  const office = DEPARTMENTS[`NY:${town.geoid}`] ?? nameOnlyOffice('NY', jurisdiction, town.geoid);
  const cautions: string[] = [];
  if (place.cdp) {
    cautions.push(`${place.cdp.basename} is a hamlet (a Census-designated place) with no government of its own, so the ${jurisdiction} issues permits there.`);
  }
  if (place.match === 'approximate' && town.kind !== 'city') cautions.push(PIN_TOWN_CAUTION);
  return { kind: 'office', office, headline: pinHeadline(place.match, jurisdiction), cautions };
}

function resolveNj(place: PlaceLookupResult): PermitOfficeAnswer {
  const code = place.town ? NJ_BY_GEOID.get(place.town.geoid) : undefined;
  const office = code ? DEPARTMENTS[`NJ:${code}`] : undefined;
  if (!office) {
    const name = place.town?.name ?? 'this municipality';
    return {
      kind: 'unresolved', office: null, cautions: [],
      headline: `MAGE couldn't match ${name} to the NJ DCA roster. Confirm the municipality's construction office before you file.`,
    };
  }
  return { kind: 'office', office, headline: pinHeadline(place.match, office.jurisdiction), cautions: [] };
}

function ctSubTownFor(place: PlaceLookupResult): string | undefined {
  for (const u of [place.incorporatedPlace, place.cdp]) {
    if (!u) continue;
    const key = u.kind === 'city' ? `${placeNorm(u.basename)} city` : placeNorm(u.basename);
    const id = CT_SUB_TOWN.get(key);
    if (id) return id;
  }
  return undefined;
}

function resolveCt(place: PlaceLookupResult): PermitOfficeAnswer {
  const subId = ctSubTownFor(place);
  const townId = place.town ? CT_BY_GEOID.get(place.town.geoid) : undefined;
  if (subId) {
    const office = DEPARTMENTS[`CT:${subId}`];
    const townName = place.town?.basename;
    const cautions = [`The DAS list names a separate building official for ${office.jurisdiction}${townName ? ` inside the town of ${townName}` : ''}. Confirm which office covers this address.`];
    return { kind: 'office', office, headline: pinHeadline(place.match, office.jurisdiction), cautions };
  }
  if (townId) {
    const office = DEPARTMENTS[`CT:${townId}`];
    return { kind: 'office', office, headline: pinHeadline(place.match, office.jurisdiction), cautions: [] };
  }
  if (place.town) {
    const jurisdiction = `Town of ${place.town.basename}`;
    return {
      kind: 'office', office: nameOnlyOffice('CT', jurisdiction, place.town.geoid),
      headline: pinHeadline(place.match, jurisdiction),
      cautions: [`The CT DAS list has no row under ${place.town.basename}'s own name.`],
    };
  }
  return { kind: 'unresolved', office: null, headline: noneHeadline('CT', ''), cautions: [] };
}

/** CT only: a mailing-town guess from the DAS list when Census found nothing. */
function ctGuessByPostalCity(postalCity: string): PermitOfficeAnswer | null {
  const n = placeNorm(postalCity);
  if (!n) return null;
  const direct = CT_BY_NAME.get(n);
  const seeTowns = CT_ALIAS.get(n);
  const targetId = direct ?? (seeTowns && seeTowns.length === 1 ? CT_BY_NAME.get(placeNorm(seeTowns[0])) : undefined);
  if (!targetId) return null;
  const office = DEPARTMENTS[`CT:${targetId}`];
  const via = direct ? `${postalCity.trim()} is a town on the DAS list` : `The DAS list files ${postalCity.trim()} under ${office.jurisdiction}`;
  return {
    kind: 'office', office,
    headline: `MAGE couldn't place this address on the Census map. ${via}, so it's probably that office. Confirm.`,
    cautions: [],
  };
}

/**
 * The permit office for a looked-up place. `hint` carries the project's own
 * state and mailing town for when Census found nothing.
 */
export function permitOfficeFor(
  place: PlaceLookupResult | null,
  hint: { state?: string; postalCity?: string } = {},
): PermitOfficeAnswer {
  const hintState = normalizeState(hint.state);
  const state: TristateCode | null = place?.state
    ?? ((TRISTATE as readonly string[]).includes(hintState) ? (hintState as TristateCode) : null);
  if (!state) return UNSUPPORTED;
  if (!place || place.match === 'none') {
    if (state === 'CT') {
      const guess = ctGuessByPostalCity(hint.postalCity ?? '');
      if (guess) return guess;
    }
    return { kind: 'unresolved', office: null, headline: noneHeadline(state, hint.postalCity ?? ''), cautions: [] };
  }
  if (state === 'NY') return resolveNy(place);
  if (state === 'NJ') return resolveNj(place);
  return resolveCt(place);
}
