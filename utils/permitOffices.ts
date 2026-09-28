// utils/permitOffices.ts — WHICH office issues the permit, for a NY / NJ / CT /
// MD jobsite outside the city rows in utils/codeJurisdiction.ts. PURE: no React,
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
//   MD  the COUNTY, never the town: Maryland's Census county subdivisions are
//       election districts ("District 9"), not governments. 24510 Baltimore
//       city and 24005 Baltimore County are hand-verified cards built from
//       the department blocks in utils/codeJurisdiction.ts (one source, so
//       the two cannot drift); every other county is a NAME-ONLY card, and
//       an incorporated city or town inside it gets a caution to check
//       whether it runs its own permits. MAGE claims neither.
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
import {
  LOCAL_ADOPTIONS,
  jobsiteAddressForProject,
  normalizeState,
  type AddressableProject,
  type BuildingDepartment,
  type LocalAdoption,
} from './codeJurisdiction';

// ─────────────────────────────────────────────────────────────────────
// The Census answer (wire shape of supabase/functions/place-lookup)
// ─────────────────────────────────────────────────────────────────────

export type PlaceMatch = 'address' | 'approximate' | 'none';
/** The states this lookup answers for. The name predates Maryland; it is
 *  kept so callers do not change. */
export type TristateCode = 'NY' | 'NJ' | 'CT' | 'MD';
export const TRISTATE: readonly TristateCode[] = ['NY', 'NJ', 'CT', 'MD'];

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

/** The lookup a project implies, or null when it isn't a NY/NJ/CT/MD jobsite
 *  or names no address to look up. A location-only project sends its whole
 *  `location`, so a trailing ZIP reaches the Census geocoder. */
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

// ── NY: hand-verified Nassau, Suffolk and Westchester offices ───────
// Nassau (36059), Suffolk (36103) and Westchester (36119) towns and cities.
// Keyed by the Census county-subdivision GEOID (a NY city is its own county
// subdivision, which is how resolveNy keys a city); each fact read off the
// municipality's own page on checkedOn. The portal link is the one that
// municipality's page publishes (portalSeenOn); when its pages link no online
// portal, both are null. A municipality whose own page could not be read, or
// does not state every required fact, has no entry and stays a name-only card.
interface HandCard {
  geoid: string;
  jurisdiction: string;
  title: string;
  address: string[];
  phone: string;
  hours: string | null;
  /** Null together with portalSeenOn: the municipality's pages link no portal. */
  portalUrl: string | null;
  portalSeenOn: string | null;
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
  // ── Suffolk County (36103). Town of Islip has no entry: islipny.gov answers
  //    403 to every fetch, so nothing could be read off its own page.
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=100+Main+Street%2C+Huntington%2C+NY+11743&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → Huntington town
    geoid: '3610337000',
    jurisdiction: 'Town of Huntington',
    title: 'Town of Huntington Building & Housing Division',
    address: ['Town Hall, Room 115, 100 Main Street', 'Huntington, NY 11743'],
    phone: '(631) 351-2821',
    hours: 'Monday to Friday, 8:30 am to 3:00 pm',
    portalUrl: 'https://townofhuntingtonny.viewpointcloud.com/categories/1071',
    portalSeenOn: 'https://www.huntingtonny.gov/building-housing',
    sourceUrl: 'https://www.huntingtonny.gov/building-housing',
    checkedOn: '2026-09-26',
    facts: ['Paper applications and payments can be mailed or dropped off at Town Hall, Room 115 (1st floor); fees can be paid in person or by credit card over the phone.'],
  },
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=1+Independence+Hill%2C+Farmingville%2C+NY+11738&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → Brookhaven town
    geoid: '3610310000',
    jurisdiction: 'Town of Brookhaven',
    title: 'Town of Brookhaven Building Division',
    address: ['1 Independence Hill', 'Farmingville, NY 11738'],
    phone: '631-451-8696',
    hours: 'Monday to Friday, 9:00 am to 4:15 pm',
    portalUrl: 'https://brookhavenny.gov/NewApplication',
    portalSeenOn: 'https://www.brookhavenny.gov/284/Building-Division',
    sourceUrl: 'https://www.brookhavenny.gov/284/Building-Division',
    checkedOn: '2026-09-26',
    facts: ['The division moves to Town of Brookhaven Digital Services (digitalservices.brookhavenny.gov) on September 28, 2026; from then, drop-offs are no longer accepted.'],
  },
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=200+East+Sunrise+Highway%2C+Lindenhurst%2C+NY+11757&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → Babylon town
    geoid: '3610304000',
    jurisdiction: 'Town of Babylon',
    title: 'Town of Babylon Building Department',
    address: ['Babylon Town Hall, West Wing, 200 East Sunrise Highway', 'Lindenhurst, NY 11757'],
    phone: '(631) 957-3058',
    hours: 'Monday to Friday, 9:00 am to 4:30 pm',
    portalUrl: 'https://babylonny.portal.opengov.com/',
    portalSeenOn: 'https://www.townofbabylonny.gov/797/Building-Department',
    sourceUrl: 'https://www.townofbabylonny.gov/797/Building-Department',
    checkedOn: '2026-09-26',
    facts: ['Since February 2, 2026, all applications and supporting materials must be submitted online through the Online Permit Center.'],
  },
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=23+Redwood+Lane%2C+Smithtown%2C+NY+11787&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → Smithtown town
    geoid: '3610368000',
    jurisdiction: 'Town of Smithtown',
    title: 'Town of Smithtown Building Department',
    address: ['23 Redwood Lane', 'Smithtown, NY 11787'],
    phone: '(631) 360-7520',
    hours: 'Monday to Friday, 9:00 am to 4:00 pm (July 1 to August 31: 9:00 am to 3:00 pm)',
    portalUrl: 'https://citysquared.com/#/app/SmithtownTownNY/landing',
    portalSeenOn: 'https://www.smithtownny.gov/726/ONLINE-RESIDENTIAL-BUILDING-PERMITS',
    sourceUrl: 'https://www.smithtownny.gov/109/Building-Department',
    checkedOn: '2026-09-26',
    facts: ['To schedule an inspection, call (631) 360-7522.'],
  },
  // ── Westchester County (36119). Each city is keyed on its county
  //    subdivision, which the Census names as the same city.
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=20+South+Broadway%2C+Yonkers%2C+NY+10701&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → Yonkers city (place 3684000)
    geoid: '3611984000',
    jurisdiction: 'City of Yonkers',
    title: 'City of Yonkers Department of Housing and Buildings',
    address: ['20 South Broadway, 3rd Floor', 'Yonkers, NY 10701'],
    phone: '914-377-6500',
    hours: null,
    portalUrl: 'https://www.citysquared.com/#/app/Yonkers/landing',
    portalSeenOn: 'https://www.yonkersny.gov/217/Housing-Buildings',
    sourceUrl: 'https://www.yonkersny.gov/217/Housing-Buildings',
    checkedOn: '2026-09-26',
    facts: [
      "Renovating an existing 1-to-3-family dwelling needs a Home Improvement Contractor's License from the City's Consumer Protection Bureau before the permit.",
      "Expediters need an Expeditor's License from the Consumer Protection Bureau (914-377-3000).",
    ],
  },
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=515+North+Avenue%2C+New+Rochelle%2C+NY+10801&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → New Rochelle city (place 3650617)
    geoid: '3611950617',
    jurisdiction: 'City of New Rochelle',
    title: 'City of New Rochelle Bureau of Buildings',
    address: ['515 North Ave.', 'New Rochelle, NY 10801'],
    phone: '(914) 654-2035',
    hours: null,
    portalUrl: 'https://www.citysquared.com/#/app/map/NewRochelleCityNY',
    portalSeenOn: 'https://www.newrochelleny.gov/1612/How-to-Apply-for-a-Permit',
    sourceUrl: 'https://www.newrochelleny.gov/233/Buildings',
    checkedOn: '2026-09-26',
    facts: [],
  },
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=1+Roosevelt+Square%2C+Mount+Vernon%2C+NY+10550&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → Mount Vernon city (place 3649121)
    geoid: '3611949121',
    jurisdiction: 'City of Mount Vernon',
    title: 'City of Mount Vernon Building Department',
    address: ['1 Roosevelt Square, City Hall, Room 11', 'Mount Vernon, NY 10550'],
    phone: '914-665-2483',
    hours: 'Monday, Tuesday, Thursday and Friday, 9:00 am to 3:00 pm; closed to the public on Wednesday',
    portalUrl: 'https://www.mountvernonny.gov/opengovbldpermits',
    portalSeenOn: 'https://www.mountvernonny.gov/187/Buildings',
    sourceUrl: 'https://www.mountvernonny.gov/directory.aspx?did=8',
    checkedOn: '2026-09-26',
    facts: [],
  },
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=70+Church+Street%2C+White+Plains%2C+NY+10601&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → White Plains city (place 3681677)
    geoid: '3611981677',
    jurisdiction: 'City of White Plains',
    title: 'City of White Plains Department of Building',
    address: ['70 Church St.', 'White Plains, NY 10601'],
    phone: '914-422-1269',
    hours: null,
    portalUrl: 'https://www.citysquared.com/#/app/landing',
    portalSeenOn: 'https://www.cityofwhiteplains.com/86/Building',
    sourceUrl: 'https://www.cityofwhiteplains.com/86/Building',
    checkedOn: '2026-09-26',
    facts: [],
  },
  {
    // Census: https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=177+Hillside+Avenue%2C+Greenburgh%2C+NY+10607&benchmark=Public_AR_Current&vintage=Current_Current&layers=County+Subdivisions,Incorporated+Places&format=json → Greenburgh town
    geoid: '3611930367',
    jurisdiction: 'Town of Greenburgh',
    title: 'Town of Greenburgh Building Department',
    address: ['177 Hillside Avenue', 'Greenburgh, NY 10607'],
    phone: '(914) 989-1560',
    hours: 'In-person submissions Monday to Friday, 8:00 am to 3:30 pm (excluding Town holidays)',
    portalUrl: null,
    portalSeenOn: null,
    sourceUrl: 'https://www.greenburghny.com/176/Building-Department',
    checkedOn: '2026-09-26',
    facts: ['Applications may be submitted in person or by mail.'],
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

// ── MD: the two Baltimore governments ──────────────────────────────
// Keyed by Census county GEOID (checked 2026-09-28 against the live Census
// geocoder: "620 E 31st St, Baltimore, MD 21218" → Counties "Baltimore city"
// 24510; "400 Washington Ave, Towson, MD 21204" → "Baltimore County" 24005;
// "100 State Cir, Annapolis, MD 21401" → "Anne Arundel County" 24003, with the
// incorporated place "Annapolis city" and the county subdivision "District 6").
// Phone, email, portal, hours and source come from the row's `department`
// block, so this card and the code-jurisdiction card are the same facts. Only
// the street address is added here, each read 2026-09-28:
//   City   "Visit us at the One Stop Shop at 417 E. Fayette Street, Room 100"
//          (https://www.baltimorecity.gov/dhcd/our-work/permits-and-inspections);
//          the ZIP 21202 is on DHCD's building-permits page for 417 E.
//          Fayette Street.
//   County "County Office Building, 111 West Chesapeake Avenue, Towson,
//          Maryland 21204" (https://www.baltimorecountymd.gov/departments/pai).
export const MD_COUNTY_OFFICES: Readonly<Record<string, { row: string; address: readonly string[] }>> = {
  '24510': { row: 'Baltimore City', address: ['One Stop Shop, 417 E. Fayette Street, Room 100', 'Baltimore, MD 21202'] },
  '24005': { row: 'Baltimore County', address: ['County Office Building, 111 West Chesapeake Avenue', 'Towson, MD 21204'] },
};

function mdHandOffice(geoid: string): PermitOffice | null {
  const spec = MD_COUNTY_OFFICES[geoid];
  const row: LocalAdoption | undefined = spec
    ? LOCAL_ADOPTIONS.find((e) => e.state === 'MD' && e.name === spec.row)
    : undefined;
  const d: BuildingDepartment | undefined = row?.department;
  if (!spec || !row || !d) return null;
  return {
    key: `MD:${geoid}`,
    jurisdiction: row.name,
    title: row.authorityName,
    subtitle: 'Maryland',
    verification: 'hand-verified',
    address: spec.address,
    phone: d.phone ?? null,
    email: d.email ?? null,
    portalUrl: d.portalUrl,
    hours: d.hours ?? null,
    facts: [d.afterHours, d.applicantOfRecordNote].filter((f): f is string => !!f),
    sourceLabel: `${d.sourceLabel ?? hostOf(d.sourceUrl)}, checked ${d.checkedOn}`,
    sourceUrl: d.sourceUrl,
  };
}

/** The office map, keyed by state + municipality id. */
export const DEPARTMENTS: Readonly<Record<string, PermitOffice>> = (() => {
  const m: Record<string, PermitOffice> = {};
  for (const e of njRoster.offices as NjEntry[]) m[`NJ:${e.code}`] = njOffice(e);
  for (const e of ctList.offices as CtEntry[]) m[`CT:${e.id}`] = ctOffice(e);
  for (const h of NY_HAND_VERIFIED) m[`NY:${h.geoid}`] = nyHandOffice(h);
  for (const geoid of Object.keys(MD_COUNTY_OFFICES)) {
    const o = mdHandOffice(geoid);
    if (o) m[o.key] = o;
  }
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

/** The name-only card for a municipality (or, in Maryland, a county) MAGE
 *  hasn't verified. */
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
  if (state === 'MD') {
    return `MAGE couldn't place this address on the Census map. ${postalCity.trim() ? `A Maryland mailing town like ${postalCity.trim()}` : 'A Maryland mailing address'} doesn't always tell you the county, and a "Baltimore" address can be in Baltimore City or Baltimore County. Confirm which government issues the permit before you file.`;
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

/**
 * MD: keyed on the COUNTY. Baltimore city (24510) and Baltimore County (24005)
 * are hand-verified; any other county is a name-only card. The Census county
 * subdivision (an election district in Maryland) is never used.
 */
function resolveMd(place: PlaceLookupResult): PermitOfficeAnswer {
  const county = place.county;
  if (!county) return { kind: 'unresolved', office: null, headline: noneHeadline('MD', ''), cautions: [] };
  const hand = DEPARTMENTS[`MD:${county.geoid}`];
  if (hand) return { kind: 'office', office: hand, headline: pinHeadline(place.match, hand.jurisdiction), cautions: [] };
  const office = nameOnlyOffice('MD', county.name, county.geoid);
  const ip = place.incorporatedPlace;
  const cautions = ip
    ? [`${ip.name} is an incorporated place inside ${county.name}. Check whether it issues its own permits before you file.`]
    : [];
  return { kind: 'office', office, headline: pinHeadline(place.match, county.name), cautions };
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
  if (state === 'MD') return resolveMd(place);
  return resolveCt(place);
}
