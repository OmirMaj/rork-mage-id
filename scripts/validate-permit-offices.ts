// scripts/validate-permit-offices.ts — the NY / NJ / CT permit-office lookup,
// offline.
//
// Pure: no network. It drives
//   - the generated rosters (utils/generated/njConstructionOffices.json,
//     utils/generated/ctBuildingOfficials.json): counts, freshness, the Census
//     join, and what must never be in them (officials' names, private email);
//   - the resolver and cache rules (utils/permitOffices.ts) over Census answers
//     recorded from the live geocoder on 2026-09-26;
//   - the place-lookup edge function's pure helpers
//     (supabase/functions/place-lookup/index.ts, imported under a stubbed Deno
//     global), including its fallback order with a fake Census;
// and holds the honesty rules: 'none' never picks an office, a pin answer says
// "confirm", a NY village says it can hand enforcement to the county, an
// unverified NY office is a name-only card that says so, and an upstream
// failure is an error, never "no match".
//
// Run: bun run scripts/validate-permit-offices.ts

import { readFileSync } from 'node:fs';
import njRoster from '../utils/generated/njConstructionOffices.json';
import ctList from '../utils/generated/ctBuildingOfficials.json';
import {
  DEPARTMENTS,
  MD_COUNTY_OFFICES,
  NAME_ONLY_BADGE,
  NAME_ONLY_NOTE,
  NY_HAND_VERIFIED,
  PIN_TOWN_CAUTION,
  PLACE_CACHE_KEY_PREFIX,
  PLACE_TTL_FOUND_MS,
  PLACE_TTL_NONE_MS,
  VILLAGE_CAUTION,
  cachedPlaceIsFresh,
  parseCachedPlace,
  parsePlaceLookupResponse,
  permitOfficeFor,
  placeCacheKey,
  placeQueryForProject,
  telUrlFor,
  titleCaseNjName,
  type PlaceLookupResult,
  type PlaceUnit,
} from '../utils/permitOffices';
import {
  BALTIMORE_SPLIT_ZCTAS,
  LOCAL_ADOPTIONS,
  departmentFor,
  groundingFactsFor,
  issuingAuthorityForAddress,
  jobsiteAddressForProject,
  jurisdictionQueryForProject,
  resolveCodeJurisdiction,
  zipFromLocationText,
  type AddressableProject,
} from '../utils/codeJurisdiction';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── 1. NJ DCA roster ────────────────────────────────────────────────────────
console.log('\n── 1. NJ DCA roster ─────────────────────────────────────────');
type Nj = { code: string; name: string; county: string; censusGeoid: string; address: string[]; phone: string | null; fax: string | null; dcaEnforced: boolean };
const nj = njRoster.offices as Nj[];
ok('NJ source URL is the DCA roster PDF', njRoster.sourceUrl === 'https://www.nj.gov/dca/codes/publications/pdf_ora/muniroster.pdf');
ok('NJ asOf and checkedOn are dates', ISO_DATE.test(njRoster.asOf) && ISO_DATE.test(njRoster.checkedOn));
ok('NJ roster has 565 entries (the PDF\'s own count)', njRoster.rosterEntries === 565, String(njRoster.rosterEntries));
ok('NJ: 564 offices — one per current municipality', nj.length === 564, String(nj.length));
ok('NJ: the one unmatched entry is 0429 Pine Valley (no current Census twin)',
  njRoster.unmatched.length === 1 && njRoster.unmatched[0].code === '0429', JSON.stringify(njRoster.unmatched));
ok('NJ codes are 4 digits and unique', nj.every((e) => /^\d{4}$/.test(e.code)) && new Set(nj.map((e) => e.code)).size === nj.length);
ok('NJ Census GEOIDs are NJ county subdivisions and unique', nj.every((e) => /^34\d{8}$/.test(e.censusGeoid)) && new Set(nj.map((e) => e.censusGeoid)).size === nj.length);
ok('NJ keeps no officials: no field or line names one',
  nj.every((e) => Object.keys(e).every((k) => !/official/i.test(k)) && e.address.every((l) => !/OFFICIAL/.test(l))));
ok('NJ every office has an address line', nj.every((e) => e.address.length >= 1));
ok('NJ phones are 10-digit numbers as the roster prints them', nj.every((e) => e.phone === null || /^\d{3}-\d{3}[- ]\d{4}$/.test(e.phone)));
const hob = nj.find((e) => e.code === '0905');
ok('NJ 0905 Hoboken: 94 Washington St, 201-420-2066, Census 3401732250',
  !!hob && hob.address[0] === '94 WASHINGTON STREET' && hob.phone === '201-420-2066' && hob.censusGeoid === '3401732250' && !hob.dcaEnforced);
ok('NJ dcaEnforced is a boolean and some municipalities have it', nj.every((e) => typeof e.dcaEnforced === 'boolean') && nj.some((e) => e.dcaEnforced));

// ── 2. CT DAS list ──────────────────────────────────────────────────────────
console.log('\n── 2. CT DAS list ───────────────────────────────────────────');
type Ct = { id: string; name: string; qualifier: string | null; staffing: string | null; censusGeoid: string | null; address: string[]; addressOmitted: string | null; phone: string | null; email: string | null };
const ct = ctList.offices as Ct[];
const aliases = ctList.aliases as { name: string; seeTowns: string[] }[];
ok('CT source URL is the DAS list PDF', ctList.sourceUrl === 'https://portal.ct.gov/-/media/DAS/OEDM/BO-List/bolist.pdf');
ok('CT asOf and checkedOn are dates', ISO_DATE.test(ctList.asOf) && ISO_DATE.test(ctList.checkedOn));
ok('CT list has 220 rows = 174 offices + 46 "See <town>" aliases',
  ctList.listEntries === 220 && ct.length === 174 && aliases.length === 46, `${ctList.listEntries} = ${ct.length} + ${aliases.length}`);
const ctTownOffices = ct.filter((e) => e.censusGeoid);
ok('CT: 168 of 169 towns joined; only Stafford has no row under its own name',
  ctTownOffices.length === 168 && JSON.stringify(ctList.townsWithoutOffice) === '["Stafford"]', JSON.stringify(ctList.townsWithoutOffice));
ok('CT town GEOIDs are CT county subdivisions and unique',
  ctTownOffices.every((e) => /^09\d{8}$/.test(e.censusGeoid!)) && new Set(ctTownOffices.map((e) => e.censusGeoid)).size === ctTownOffices.length);
ok('CT office ids unique', new Set(ct.map((e) => e.id)).size === ct.length);
ok('CT emails only on .gov / .ct.us domains', ct.every((e) => e.email === null || /@[^@]+\.(gov|ct\.us)$/i.test(e.email)),
  ct.filter((e) => e.email && !/\.(gov|ct\.us)$/i.test(e.email)).map((e) => e.email).join(', '));
const ctText = JSON.stringify({ offices: ctList.offices, aliases: ctList.aliases });
ok('CT keeps no gmail / hotmail / icloud address', !/@(gmail|hotmail|icloud|yahoo)\./i.test(ctText));
ok('CT keeps no official names (sample from the Building Official column: Rich McKinnon, John Vallerie, John Worthington)',
  !/Rich McKinnon|John Vallerie|John Worthington/i.test(ctText));
ok('CT every alias points at an office', aliases.every((a) => a.seeTowns.length >= 1 && a.seeTowns.every((t) => ct.some((e) => e.name === t))));
ok('CT Byram → Greenwich and Mystic → Stonington + Groton',
  aliases.some((a) => a.name === 'Byram' && a.seeTowns[0] === 'Greenwich')
  && aliases.some((a) => a.name === 'Mystic' && a.seeTowns.join('|') === 'Stonington|Groton'));
ok('CT sub-town offices carry no town GEOID (City of Groton, Groton Long Point, Fenwick)',
  ['city-of-groton', 'groton-long-point', 'fenwick'].every((id) => ct.some((e) => e.id === id && e.censusGeoid === null)));
ok('CT the garbled Somers row keeps no address and says why',
  ct.some((e) => e.id === 'somers' && e.address.length === 0 && !!e.addressOmitted));
ok('CT every other office has an address', ct.filter((e) => e.id !== 'somers').every((e) => e.address.length >= 1));

// ── 3. freshness: re-import within 120 days ─────────────────────────────────
console.log('\n── 3. freshness ─────────────────────────────────────────────');
const now = Date.now();
for (const [label, doc] of [['NJ', njRoster], ['CT', ctList]] as const) {
  const checked = Date.parse(`${doc.checkedOn}T00:00:00Z`);
  const asOf = Date.parse(`${doc.asOf}T00:00:00Z`);
  ok(`${label}: source re-read (checkedOn ${doc.checkedOn}) within 120 days`, now - checked <= 120 * DAY && checked <= now + DAY,
    `re-run scripts/import-${label === 'NJ' ? 'nj-construction-offices' : 'ct-building-officials'}.ts`);
  ok(`${label}: asOf ${doc.asOf} is not after checkedOn`, asOf <= checked);
}

// ── 4. NY hand-verified cards ───────────────────────────────────────────────
console.log('\n── 4. NY hand-verified Nassau / Suffolk / Westchester ───────');
const wantTowns = ['Town of Hempstead', 'Town of North Hempstead', 'Town of Oyster Bay'];
ok('the three Nassau towns are hand-verified', wantTowns.every((t) => NY_HAND_VERIFIED.some((h) => h.jurisdiction === t)));
const WANT_NEW = [
  'Town of Huntington', 'Town of Brookhaven', 'Town of Babylon', 'Town of Smithtown',
  'City of Yonkers', 'City of New Rochelle', 'City of Mount Vernon', 'City of White Plains', 'Town of Greenburgh',
];
ok('the nine Suffolk / Westchester cards read this pass are hand-verified', WANT_NEW.every((t) => NY_HAND_VERIFIED.some((h) => h.jurisdiction === t)));
ok('Town of Islip has no hand card (its own site answered 403: nothing read)', !NY_HAND_VERIFIED.some((h) => /Islip/.test(h.jurisdiction)));
ok('hand-card GEOIDs are unique', new Set(NY_HAND_VERIFIED.map((h) => h.geoid)).size === NY_HAND_VERIFIED.length);
const AGGREGATOR = /yelp|manta|mapquest|yellowpages|facebook|wikipedia|google/i;
const hostOfUrl = (u: string): string => /^https:\/\/(?:www\.)?([^/#?]+)/i.exec(u)?.[1]?.toLowerCase() ?? '';
for (const h of NY_HAND_VERIFIED) {
  const host = hostOfUrl(h.sourceUrl);
  const checked = Date.parse(`${h.checkedOn}T00:00:00Z`);
  ok(`${h.jurisdiction}: Nassau / Suffolk / Westchester county-subdivision GEOID`, /^36(059|103|119)\d{5}$/.test(h.geoid), h.geoid);
  ok(`${h.jurisdiction}: checkedOn ${h.checkedOn} is a date within 120 days`,
    ISO_DATE.test(h.checkedOn) && now - checked <= 120 * DAY && checked <= now + DAY);
  ok(`${h.jurisdiction}: https source on the municipality's own domain, not an aggregator`,
    h.sourceUrl.startsWith('https://') && !!host && !AGGREGATOR.test(host), h.sourceUrl);
  ok(`${h.jurisdiction}: portal is null with portalSeenOn null, or https read off the municipality's own site`,
    h.portalUrl === null
      ? h.portalSeenOn === null
      : h.portalUrl.startsWith('https://') && !!h.portalSeenOn && h.portalSeenOn.startsWith('https://') && hostOfUrl(h.portalSeenOn) === host,
    `${h.portalUrl} / ${h.portalSeenOn}`);
  ok(`${h.jurisdiction}: phone dials`, telUrlFor(h.phone) !== null);
  ok(`${h.jurisdiction}: a title, and every fact is a sentence`,
    !!h.title.trim() && h.facts.every((f) => f.trim().length > 0));
  // Oyster Bay's own page prints no ZIP ('Oyster Bay, NY'); the Nassau cards
  // stay as read, so the ZIP rule holds for every card added since.
  if (!h.geoid.startsWith('36059')) {
    ok(`${h.jurisdiction}: address has a line ending in "NY 1xxxx"`, h.address.some((l) => /NY 1\d{4}$/.test(l)), JSON.stringify(h.address));
  }
}
ok('Greenburgh links no online portal: its card carries none', NY_HAND_VERIFIED.find((h) => h.jurisdiction === 'Town of Greenburgh')?.portalUrl === null);

// ── 5. the resolver over recorded Census answers ────────────────────────────
console.log('\n── 5. permitOfficeFor ───────────────────────────────────────');
const unit = (name: string, basename: string, geoid: string, kind: string): PlaceUnit => ({ name, basename, geoid, kind });
const place = (p: Partial<PlaceLookupResult>): PlaceLookupResult => ({
  state: null, county: null, town: null, incorporatedPlace: null, cdp: null,
  match: 'address', matchedAddress: null, source: 'US Census Geocoder', asOf: '2026-09-26T00:00:00Z', ...p,
});
const NASSAU = { name: 'Nassau County', geoid: '36059' };
const HEMPSTEAD = unit('Hempstead town', 'Hempstead', '3605934000', 'town');
const SUFFOLK = { name: 'Suffolk County', geoid: '36103' };
const WESTCHESTER = { name: 'Westchester County', geoid: '36119' };

// Garden City (recorded: Hempstead town + Garden City village)
const gc = permitOfficeFor(place({ state: 'NY', county: NASSAU, town: HEMPSTEAD, incorporatedPlace: unit('Garden City village', 'Garden City', '3628178', 'village') }));
ok('NY village first: Garden City → Village of Garden City', gc.kind === 'office' && gc.office?.jurisdiction === 'Village of Garden City');
ok('NY village: name-only card, labelled unverified, no invented contact',
  gc.office?.verification === 'name-only' && gc.office.facts.includes(NAME_ONLY_NOTE) && !gc.office.phone && !gc.office.address.length && !gc.office.portalUrl);
ok('NY village: carries the county-enforcement caution', gc.cautions.includes(VILLAGE_CAUTION));
ok('NY exact address: no "from the map pin" headline', gc.headline === null);

// Levittown (recorded at the pin: Hempstead town + Levittown CDP)
const lv = permitOfficeFor(place({ state: 'NY', match: 'approximate', county: NASSAU, town: HEMPSTEAD, cdp: unit('Levittown CDP', 'Levittown', '3642081', 'CDP') }));
ok('NY hamlet → its town, and the Hempstead card is the hand-verified one',
  lv.office?.jurisdiction === 'Town of Hempstead' && lv.office.verification === 'hand-verified' && lv.office.phone === '516-538-8500');
ok('NY pin answer: "Looks like … (from the map pin). Confirm."', lv.headline === 'Looks like Town of Hempstead (from the map pin). Confirm.', String(lv.headline));
ok('NY pin answer in a town warns it may be a village', lv.cautions.includes(PIN_TOWN_CAUTION));
ok('NY hamlet caution names the hamlet and the town', lv.cautions.some((c) => c.includes('Levittown') && c.includes('Town of Hempstead')));
ok('NY town: no village caution', !lv.cautions.includes(VILLAGE_CAUTION));

const nh = permitOfficeFor(place({ state: 'NY', county: NASSAU, town: unit('North Hempstead town', 'North Hempstead', '3605953000', 'town') }));
ok('North Hempstead → hand card, 176 Plandome Road', nh.office?.verification === 'hand-verified' && nh.office.address[0] === '176 Plandome Road');
const ob = permitOfficeFor(place({ state: 'NY', county: NASSAU, town: unit('Oyster Bay town', 'Oyster Bay', '3605956000', 'town') }));
ok('Oyster Bay → hand card with its portal', ob.office?.verification === 'hand-verified' && !!ob.office.portalUrl);

const glen = permitOfficeFor(place({ state: 'NY', county: NASSAU, town: unit('Glen Cove city', 'Glen Cove', '3605929113', 'city'), incorporatedPlace: unit('Glen Cove city', 'Glen Cove', '3629113', 'city') }));
ok('NY city → City of Glen Cove, name-only, keyed on its county-subdivision GEOID, no village caution',
  glen.office?.jurisdiction === 'City of Glen Cove' && glen.office.verification === 'name-only' && glen.office.key === 'NY:3605929113' && glen.cautions.length === 0);
// Smithtown was this check's name-only example until its card was read
// (2026-09-26); Islip stays name-only (its own site answers 403).
const islip = permitOfficeFor(place({ state: 'NY', county: SUFFOLK, town: unit('Islip town', 'Islip', '3610338000', 'town'), cdp: unit('Islip CDP', 'Islip', '3637869', 'CDP') }));
ok('An unverified NY town is a name-only "Town of X" card', islip.office?.title === 'Town of Islip' && islip.office.verification === 'name-only' && islip.office.facts.includes(NAME_ONLY_NOTE));

// Suffolk + Westchester hand cards, over Census answers recorded 2026-09-26
// (the county subdivision + CDP / incorporated place at each hall's address).
const handCases: { label: string; p: Partial<PlaceLookupResult>; title: string; phone: string }[] = [
  { label: 'Huntington CDP → Town of Huntington', title: 'Town of Huntington Building & Housing Division', phone: '(631) 351-2821',
    p: { county: SUFFOLK, town: unit('Huntington town', 'Huntington', '3610337000', 'town'), cdp: unit('Huntington CDP', 'Huntington', '3636233', 'CDP') } },
  { label: 'Coram CDP → Town of Brookhaven', title: 'Town of Brookhaven Building Division', phone: '631-451-8696',
    p: { county: SUFFOLK, town: unit('Brookhaven town', 'Brookhaven', '3610310000', 'town'), cdp: unit('Coram CDP', 'Coram', '3618157', 'CDP') } },
  { label: 'North Lindenhurst CDP → Town of Babylon', title: 'Town of Babylon Building Department', phone: '(631) 957-3058',
    p: { county: SUFFOLK, town: unit('Babylon town', 'Babylon', '3610304000', 'town'), cdp: unit('North Lindenhurst CDP', 'North Lindenhurst', '3653198', 'CDP') } },
  { label: 'Smithtown CDP → Town of Smithtown', title: 'Town of Smithtown Building Department', phone: '(631) 360-7520',
    p: { county: SUFFOLK, town: unit('Smithtown town', 'Smithtown', '3610368000', 'town'), cdp: unit('Smithtown CDP', 'Smithtown', '3667851', 'CDP') } },
  { label: 'Greenville CDP → Town of Greenburgh', title: 'Town of Greenburgh Building Department', phone: '(914) 989-1560',
    p: { county: WESTCHESTER, town: unit('Greenburgh town', 'Greenburgh', '3611930367', 'town'), cdp: unit('Greenville CDP', 'Greenville', '3630642', 'CDP') } },
  { label: 'Yonkers city → City of Yonkers', title: 'City of Yonkers Department of Housing and Buildings', phone: '914-377-6500',
    p: { county: WESTCHESTER, town: unit('Yonkers city', 'Yonkers', '3611984000', 'city'), incorporatedPlace: unit('Yonkers city', 'Yonkers', '3684000', 'city') } },
  { label: 'New Rochelle city → City of New Rochelle', title: 'City of New Rochelle Bureau of Buildings', phone: '(914) 654-2035',
    p: { county: WESTCHESTER, town: unit('New Rochelle city', 'New Rochelle', '3611950617', 'city'), incorporatedPlace: unit('New Rochelle city', 'New Rochelle', '3650617', 'city') } },
  { label: 'Mount Vernon city → City of Mount Vernon', title: 'City of Mount Vernon Building Department', phone: '914-665-2483',
    p: { county: WESTCHESTER, town: unit('Mount Vernon city', 'Mount Vernon', '3611949121', 'city'), incorporatedPlace: unit('Mount Vernon city', 'Mount Vernon', '3649121', 'city') } },
  { label: 'White Plains city → City of White Plains', title: 'City of White Plains Department of Building', phone: '914-422-1269',
    p: { county: WESTCHESTER, town: unit('White Plains city', 'White Plains', '3611981677', 'city'), incorporatedPlace: unit('White Plains city', 'White Plains', '3681677', 'city') } },
];
for (const c of handCases) {
  const a = permitOfficeFor(place({ state: 'NY', ...c.p }));
  ok(`${c.label}: the hand-verified card`,
    a.kind === 'office' && a.office?.verification === 'hand-verified' && a.office.title === c.title && a.office.phone === c.phone
      && !a.office.facts.includes(NAME_ONLY_NOTE) && !a.cautions.includes(VILLAGE_CAUTION),
    `${a.office?.verification} ${a.office?.title} ${a.office?.phone}`);
}
const wpCity = permitOfficeFor(place({ state: 'NY', county: WESTCHESTER, ...handCases[8].p }));
ok('a hand-verified city card is keyed on the county subdivision and names its source and date',
  wpCity.office?.key === 'NY:3611981677' && wpCity.office.sourceLabel === 'cityofwhiteplains.com, checked 2026-09-26');
const ardsley = permitOfficeFor(place({ state: 'NY', county: WESTCHESTER, town: unit('Greenburgh town', 'Greenburgh', '3611930367', 'town'), incorporatedPlace: unit('Ardsley village', 'Ardsley', '3602506', 'village') }));
ok('Ardsley (a village inside Greenburgh) → still the name-only Village of Ardsley card, with the village caution',
  ardsley.office?.jurisdiction === 'Village of Ardsley' && ardsley.office.verification === 'name-only' && ardsley.cautions.includes(VILLAGE_CAUTION));

const queens = permitOfficeFor(place({ state: 'NY', county: { name: 'Queens County', geoid: '36081' }, town: unit('Queens borough', 'Queens', '3608160323', 'borough'), incorporatedPlace: unit('New York city', 'New York', '3651000', 'city') }));
ok('Queens (recorded Astoria answer) → nyc: keep the NYC DOB card', queens.kind === 'nyc' && queens.office === null);
for (const g of ['36005', '36047', '36061', '36085']) {
  ok(`NYC county ${g} → nyc`, permitOfficeFor(place({ state: 'NY', county: { name: 'x', geoid: g }, town: HEMPSTEAD })).kind === 'nyc');
}

const nyNone = permitOfficeFor(place({ state: 'NY', match: 'none' }), { state: 'NY', postalCity: 'Massapequa' });
ok('NY none: never picks an office', nyNone.kind === 'unresolved' && nyNone.office === null);
ok('NY none: says it could be the town or one of its villages, and to confirm',
  !!nyNone.headline && /town or in one of its villages/.test(nyNone.headline) && /Massapequa/.test(nyNone.headline) && /Confirm/.test(nyNone.headline));
ok('null place + NY hint behaves like none', permitOfficeFor(null, { state: 'New York', postalCity: 'Massapequa' }).office === null);

// NJ
const hoboken = permitOfficeFor(place({ state: 'NJ', county: { name: 'Hudson County', geoid: '34017' }, town: unit('Hoboken city', 'Hoboken', '3401732250', 'city'), incorporatedPlace: unit('Hoboken city', 'Hoboken', '3432250', 'city') }));
ok('NJ Hoboken → NJ:0905 from the DCA roster', hoboken.office?.key === 'NJ:0905' && hoboken.office.verification === 'state-list' && hoboken.office.phone === '201-420-2066');
ok('NJ card names its source and date', hoboken.office?.sourceLabel === `NJ DCA roster, as of ${njRoster.asOf}`);
const princeton = permitOfficeFor(place({ state: 'NJ', town: unit('Princeton', 'Princeton', '3402160900', '') }));
ok('NJ Princeton (Census NAME has no type word) → 1114', princeton.office?.key === 'NJ:1114');
const dca = nj.find((e) => e.dcaEnforced)!;
const dcaAns = permitOfficeFor(place({ state: 'NJ', town: unit('x', 'x', dca.censusGeoid, 'township') }));
ok('NJ DCA-enforced municipality says the state enforces the code', !!dcaAns.office?.facts.some((f) => /Department of Community Affairs/.test(f)));
ok('NJ unknown GEOID → unresolved, no office', permitOfficeFor(place({ state: 'NJ', town: unit('Nowhere township', 'Nowhere', '3499999999', 'township') })).office === null);
const njNone = permitOfficeFor(null, { state: 'NJ', postalCity: 'Milford' });
ok('NJ none: unresolved, never guesses from the mailing town', njNone.kind === 'unresolved' && njNone.office === null);
ok('NJ card titles read naturally', titleCaseNjName('HI-NELLA BORO') === 'Hi-Nella Borough' && titleCaseNjName('ABERDEEN TWP') === 'Aberdeen Township');

// CT (recorded: Stamford town + Stamford city; Groton town + Groton city / Groton Long Point borough)
const stamford = permitOfficeFor(place({ state: 'CT', town: unit('Stamford town', 'Stamford', '0919073070', 'town'), incorporatedPlace: unit('Stamford city', 'Stamford', '0973000', 'city') }));
ok('CT Stamford → the Stamford office (a coextensive city is not a sub-town office)', stamford.office?.key === 'CT:stamford' && stamford.cautions.length === 0);
const grotonCity = permitOfficeFor(place({ state: 'CT', town: unit('Groton town', 'Groton', '0918034250', 'town'), incorporatedPlace: unit('Groton city', 'Groton', '0934180', 'city') }));
ok('CT City of Groton → its own office, with a confirm caution', grotonCity.office?.key === 'CT:city-of-groton' && grotonCity.cautions.length === 1);
const glp = permitOfficeFor(place({ state: 'CT', town: unit('Groton town', 'Groton', '0918034250', 'town'), incorporatedPlace: unit('Groton Long Point borough', 'Groton Long Point', '0934460', 'borough') }));
ok('CT Groton Long Point → its own office', glp.office?.key === 'CT:groton-long-point');
const grotonTown = permitOfficeFor(place({ state: 'CT', town: unit('Groton town', 'Groton', '0918034250', 'town') }));
ok('CT Town of Groton → the town office', grotonTown.office?.key === 'CT:groton');
const stafford = permitOfficeFor(place({ state: 'CT', town: unit('Stafford town', 'Stafford', '0901373070', 'town') }));
ok('CT town with no DAS row → name-only card, says so', stafford.office?.verification === 'name-only' && stafford.cautions.length === 1);
const cosCob = permitOfficeFor(null, { state: 'CT', postalCity: 'Cos Cob' });
ok('CT none + a DAS alias → the aliased town, and "Confirm."', cosCob.office?.key === 'CT:greenwich' && /Confirm\.$/.test(cosCob.headline ?? ''));
ok('CT none + an unknown mailing town → unresolved', permitOfficeFor(null, { state: 'CT', postalCity: 'Atlantis' }).office === null);
ok('CT none + Mystic (two towns) → never picks one', permitOfficeFor(null, { state: 'CT', postalCity: 'Mystic' }).office === null);

// Outside the tristate
ok('Portland OR → unsupported', permitOfficeFor(null, { state: 'OR', postalCity: 'Portland' }).kind === 'unsupported');
ok('no state at all → unsupported', permitOfficeFor(null).kind === 'unsupported');
ok('the name-only badge says contact details are not verified', /not verified by MAGE/.test(NAME_ONLY_BADGE));

// Every card
const cards = Object.values(DEPARTMENTS);
ok(`DEPARTMENTS holds ${cards.length} cards = 564 NJ + 174 CT + 12 NY + 2 MD`, cards.length === 564 + 174 + 12 + 2 && NY_HAND_VERIFIED.length === 12);
ok('every card key is <state>:<id>', cards.every((c) => /^(NJ|CT|NY|MD):[\w-]+$/.test(c.key)));
ok('every card names its source', cards.every((c) => !!c.sourceLabel && (c.sourceUrl === null || c.sourceUrl.startsWith('https://'))));
ok('every listed card phone either dials or is shown undialled (never a wrong number)',
  cards.every((c) => !c.phone || telUrlFor(c.phone) === null || /^tel:\d{10,11}$/.test(telUrlFor(c.phone)!)));

// ── 6. phone links ──────────────────────────────────────────────────────────
console.log('\n── 6. telUrlFor ─────────────────────────────────────────────');
ok('extension dropped', telUrlFor('(516) 624-6200 ext. 1') === 'tel:5166246200');
ok('x extension dropped', telUrlFor('860-649-8066 x6103') === 'tel:8606498066');
ok('plain', telUrlFor('201-420-2066') === 'tel:2014202066');
ok('too short → null', telUrlFor('420-2066') === null && telUrlFor(null) === null);

// ── 7. the wire parser ──────────────────────────────────────────────────────
console.log('\n── 7. parsePlaceLookupResponse ──────────────────────────────');
const good = { status: 'ok', state: 'NJ', county: { name: 'Hudson County', geoid: '34017' }, town: { name: 'Hoboken city', basename: 'Hoboken', geoid: '3401732250', kind: 'city' }, incorporatedPlace: null, cdp: null, match: 'address', matchedAddress: '94 WASHINGTON ST, HOBOKEN, NJ, 07030', source: 'US Census Geocoder', asOf: '2026-09-26T00:00:00Z' };
ok('accepts a good answer', parsePlaceLookupResponse(good)?.town?.geoid === '3401732250');
ok('rejects an error body', parsePlaceLookupResponse({ status: 'error', code: 'upstream', error: 'x' }) === null);
ok('rejects a state outside the tristate', parsePlaceLookupResponse({ ...good, state: 'PA' }) === null);
ok('rejects an unknown match', parsePlaceLookupResponse({ ...good, match: 'exact' }) === null);
ok('rejects a found match that names no geography', parsePlaceLookupResponse({ ...good, county: null, town: null }) === null);
ok('drops a malformed unit', parsePlaceLookupResponse({ ...good, cdp: { name: 'x', basename: 'x', geoid: 'abc', kind: 'CDP' } })?.cdp === null);
ok('accepts none', parsePlaceLookupResponse({ ...good, state: null, county: null, town: null, match: 'none' })?.match === 'none');

// ── 8. the query and the cache ──────────────────────────────────────────────
console.log('\n── 8. placeQueryForProject + cache ──────────────────────────');
ok('Portland → no lookup', placeQueryForProject({ location: '4218 SE Rex St, Portland, OR 97206' }) === null);
ok('no project → no lookup', placeQueryForProject(null) === null);
const q1 = placeQueryForProject({ structuredAddress: { street: '94 Washington St', city: 'Hoboken', state: 'NJ', zip: '07030' } });
ok('structured address → one line', q1?.address === '94 Washington St, Hoboken, NJ 07030' && q1.state === 'NJ' && q1.lat === null);
const q2 = placeQueryForProject({ location: '11 Seventh St, Garden City, NY 11530', locationLatitude: 40.7259, locationLongitude: -73.6343 });
ok('free text + pin → address and pin', q2?.address === '11 Seventh St, Garden City, NY 11530' && q2.lat === 40.7259 && q2.postalCity === 'Garden City');
ok('a half pin is no pin', placeQueryForProject({ location: 'Garden City, NY', locationLatitude: 40.7, locationLongitude: NaN })?.lat === null);
const k2 = placeCacheKey(q2!);
ok('cache key is mageid_place_<hash>', k2.startsWith(PLACE_CACHE_KEY_PREFIX) && PLACE_CACHE_KEY_PREFIX === 'mageid_place_' && /^mageid_place_[0-9a-f]{8}$/.test(k2));
ok('cache key never carries the address', !/seventh|garden/i.test(k2));
ok('a different pin is a different key', placeCacheKey({ ...q2!, lat: 40.8 }) !== k2);
ok('the key ignores case and punctuation', placeCacheKey({ ...q2!, address: '11 SEVENTH ST. GARDEN CITY NY 11530' }) === k2);
const found = { savedAt: 1_000, place: parsePlaceLookupResponse(good)! };
const none = { savedAt: 1_000, place: parsePlaceLookupResponse({ ...good, state: null, county: null, town: null, match: 'none' })! };
ok('found is fresh for 30 days', cachedPlaceIsFresh(found, 1_000 + PLACE_TTL_FOUND_MS - 1) && !cachedPlaceIsFresh(found, 1_000 + PLACE_TTL_FOUND_MS));
ok('none is fresh for 1 day only', PLACE_TTL_NONE_MS === DAY && cachedPlaceIsFresh(none, 1_000 + DAY - 1) && !cachedPlaceIsFresh(none, 1_000 + DAY));
ok('a clock set backwards is not fresh', !cachedPlaceIsFresh(found, 0));
ok('cache entry round-trips', parseCachedPlace(JSON.stringify(found))?.place.town?.geoid === '3401732250');
ok('corrupt cache entry → null', parseCachedPlace('{nope') === null && parseCachedPlace(null) === null && parseCachedPlace('{"savedAt":"x"}') === null);

// ── 9. the edge function's pure helpers, under a stubbed Deno ───────────────
console.log('\n── 9. place-lookup edge function ────────────────────────────');
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => '' }, serve: () => undefined };
const FN_PATH = '../supabase/functions/place-lookup/index.ts';
// deno-lint-ignore no-explicit-any
const fn: any = await import(FN_PATH);
ok('parseRequest: rejects a missing / short address', fn.parseRequest({}) === null && fn.parseRequest({ address: 'ab' }) === null && fn.parseRequest(null) === null);
const pr = fn.parseRequest({ address: '  94 Washington St,\u0000 Hoboken, NJ  ', lat: 40.73, lon: -74.03 });
ok('parseRequest: trims, strips control characters, keeps a full pin', pr?.address === '94 Washington St, Hoboken, NJ' && pr.lat === 40.73 && pr.lon === -74.03);
ok('parseRequest: drops a half / out-of-range pin', fn.parseRequest({ address: '94 Washington St', lat: 95, lon: -74 }).lat === null && fn.parseRequest({ address: '94 Washington St', lat: 40 }).lon === null);
ok('parseRequest: caps the address at 200', fn.parseRequest({ address: 'x'.repeat(500) }).address.length === 200);
const au = fn.censusAddressUrl('94 Washington St, Hoboken, NJ');
ok('address URL: onelineaddress, current benchmark + vintage, the four layers',
  au.startsWith('https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?')
  && au.includes('benchmark=Public_AR_Current') && au.includes('vintage=Current_Current')
  && decodeURIComponent(au.replace(/\+/g, ' ')).includes('layers=County Subdivisions,Incorporated Places,Census Designated Places,Counties'));
ok('coordinates URL: x is longitude, y is latitude', /\/coordinates\?.*x=-74\.030000.*y=40\.730000/.test(fn.censusCoordinatesUrl(40.73, -74.03)));
ok('unitFrom: type word after the base name', fn.unitFrom({ NAME: 'Garden City village', BASENAME: 'Garden City', GEOID: '3628178' })?.kind === 'village'
  && fn.unitFrom({ NAME: 'Princeton', BASENAME: 'Princeton', GEOID: '3402160900' })?.kind === ''
  && fn.unitFrom({ NAME: 'City of Orange township', BASENAME: 'City of Orange', GEOID: '3401313045' })?.kind === 'township');
ok('unitFrom: refuses "County subdivisions not defined" and bad GEOIDs',
  fn.unitFrom({ NAME: 'County subdivisions not defined', BASENAME: 'County subdivisions not defined', GEOID: '3400100000' }) === null
  && fn.unitFrom({ NAME: 'x', BASENAME: 'x', GEOID: 'x' }) === null);

// Recorded 2026-09-26 (trimmed to the fields read).
const HOBOKEN_GEOS = {
  'County Subdivisions': [{ GEOID: '3401732250', NAME: 'Hoboken city', BASENAME: 'Hoboken', STATE: '34' }],
  'Incorporated Places': [{ GEOID: '3432250', NAME: 'Hoboken city', BASENAME: 'Hoboken', STATE: '34' }],
  Counties: [{ GEOID: '34017', NAME: 'Hudson County', BASENAME: 'Hudson', STATE: '34' }],
};
const LEVITTOWN_GEOS = {
  'County Subdivisions': [{ GEOID: '3605934000', NAME: 'Hempstead town', BASENAME: 'Hempstead', STATE: '36' }],
  'Census Designated Places': [{ GEOID: '3642081', NAME: 'Levittown CDP', BASENAME: 'Levittown', STATE: '36' }],
  Counties: [{ GEOID: '36059', NAME: 'Nassau County', BASENAME: 'Nassau', STATE: '36' }],
};
const hobAns = fn.answerFromGeographies(HOBOKEN_GEOS, 'address', '94 WASHINGTON ST, HOBOKEN, NJ, 07030', 'T');
ok('answerFromGeographies: Hoboken → NJ, Hudson, Hoboken city', hobAns.state === 'NJ' && hobAns.county.geoid === '34017' && hobAns.town.geoid === '3401732250' && hobAns.cdp === null);
ok('the edge answer parses on the client', parsePlaceLookupResponse(hobAns)?.town?.kind === 'city');
ok('the edge answer resolves end to end → NJ:0905', permitOfficeFor(parsePlaceLookupResponse(hobAns)).office?.key === 'NJ:0905');
const pa = fn.answerFromGeographies({ Counties: [{ GEOID: '42101', NAME: 'Philadelphia County', BASENAME: 'Philadelphia', STATE: '42' }] }, 'address', null, 'T');
ok('outside NY / NJ / CT → none', pa.match === 'none' && pa.state === null && pa.county === null);

const addrOk = { result: { addressMatches: [{ matchedAddress: '94 WASHINGTON ST, HOBOKEN, NJ, 07030', geographies: HOBOKEN_GEOS }] } };
const addrNone = { result: { addressMatches: [] } };
const coordsOk = { result: { geographies: LEVITTOWN_GEOS } };
function fake(address: unknown, coords: unknown) {
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url.includes('/onelineaddress?') ? 'address' : 'coords');
    const v = url.includes('/onelineaddress?') ? address : coords;
    if (v instanceof Error) throw v;
    return v;
  };
  return { calls, get };
}
const pin = { address: '11 Seventh St, Levittown, NY', lat: 40.7259, lon: -73.5143 };
const quiet = console.error;
console.error = () => undefined; // the failure-path cases below log by design
const nopin = { ...pin, lat: null, lon: null };
{
  const f = fake(addrOk, coordsOk);
  const a = await fn.lookup(pin, f.get);
  ok('lookup: address match → match "address", pin never asked', a.match === 'address' && f.calls.join() === 'address');
}
{
  const f = fake(addrNone, coordsOk);
  const a = await fn.lookup(pin, f.get);
  ok('lookup: no address match + pin → "approximate" from the pin', a.match === 'approximate' && a.town.basename === 'Hempstead' && a.cdp.basename === 'Levittown' && f.calls.join() === 'address,coords');
  ok('lookup: an approximate answer says it came from the pin', /map pin/.test(a.source));
}
{
  const f = fake(addrNone, coordsOk);
  const a = await fn.lookup(nopin, f.get);
  ok('lookup: no match, no pin → "none"', a.match === 'none' && f.calls.join() === 'address');
}
{
  const f = fake(new Error('down'), coordsOk);
  ok('lookup: Census down, no pin → null (an error, never "none")', (await fn.lookup(nopin, f.get)) === null);
}
{
  const f = fake(new Error('down'), coordsOk);
  const a = await fn.lookup(pin, f.get);
  ok('lookup: address call down + pin → approximate', a?.match === 'approximate');
}
{
  const f = fake(addrNone, new Error('down'));
  ok('lookup: pin call down → null (an error)', (await fn.lookup(pin, f.get)) === null);
}
{
  const f = fake({ nope: true }, coordsOk);
  ok('lookup: a non-geocoder body is a failure, not "none"', (await fn.lookup(nopin, f.get)) === null);
}
console.error = quiet;
ok('error texts are fixed sentences', Object.values(fn.ERRORS as Record<string, string>).every((e) => /\.$/.test(e) && !/\$\{/.test(e)));

// ── 10. wiring ──────────────────────────────────────────────────────────────
console.log('\n── 10. wiring ───────────────────────────────────────────────');
const fnSrc = read('supabase/functions/place-lookup/index.ts');
ok('edge fn: requireTier (JWT verified, every tier)', /requireTier\(req, \['free', 'pro', 'business', 'enterprise'\], 'place_lookup'\)/.test(fnSrc));
ok('edge fn: rate-limited per user', /rateLimitCount\(`place_lookup:\$\{auth\.userId\}`\)/.test(fnSrc));
ok('edge fn: CORS allows the four client headers', /'authorization, x-client-info, apikey, content-type'/.test(fnSrc));
ok('edge fn: no error text built from an exception', !/error:\s*String\(|\.message\b/.test(fnSrc));
const toml = read('supabase/config.toml');
ok('config.toml pins place-lookup verify_jwt = true', /\[functions\.place-lookup\]\s*\nverify_jwt = true/.test(toml));
const client = read('utils/placeLookup.ts');
ok('client: invokes the literal \'place-lookup\'', /functions\.invoke\('place-lookup'/.test(client));
ok('client: writes the disk cache only after a successful answer', /if \(res\.ok\) \{[\s\S]*?writeDisk\(key, entry\)/.test(client) && (client.match(/writeDisk\(/g) ?? []).length === 2);
ok('client: keys come from placeCacheKey (mageid_place_*)', /placeCacheKey\(q\)/.test(client) && !/AsyncStorage\.(?:get|set)Item\(\s*['"`]/.test(client));
const card = read('components/buildingRecord/DepartmentCard.tsx');
const outer = card.slice(card.indexOf('export function DepartmentCard('), card.indexOf('export default DepartmentCard'));
ok('DepartmentCard: the lookup runs only when departmentFor() is null and the job is NY/NJ/CT',
  /if \(!department\) \{\s*const query = placeQueryForProject\(project\);\s*if \(query\) return <PermitOfficeLookup/.test(outer));
ok('DepartmentCard: the outer component still calls no hook', !/\buse[A-Z]\w*\(/.test(outer));
ok('DepartmentCard: renders permitOfficeFor()\'s answer and the name-only badge', /permitOfficeFor\(lookup\.place/.test(card) && /NAME_ONLY_BADGE/.test(card));
ok('DepartmentCard: a nyc answer reuses the NYC block', /answer\.kind === 'nyc'/.test(card) && /NYC_DEPARTMENT/.test(card));

// ── 11. Maryland: Baltimore City vs Baltimore County ────────────────────────
// Lane PLACECODES (2026-09-28). These cases live here, not in the fenced
// validate-code-jurisdiction.ts. Census answers below were recorded that day
// from the live geocoder (see the header of supabase/functions/place-lookup).
console.log('\n── 11. Maryland ─────────────────────────────────────────────');
const MD_CITY = { name: 'Baltimore city', geoid: '24510' };
const MD_COUNTY = { name: 'Baltimore County', geoid: '24005' };
const ANNE_ARUNDEL = { name: 'Anne Arundel County', geoid: '24003' };
const cityRow = LOCAL_ADOPTIONS.find((e) => e.state === 'MD' && e.name === 'Baltimore City');
const countyRow = LOCAL_ADOPTIONS.find((e) => e.state === 'MD' && e.name === 'Baltimore County');
const cityDept = cityRow?.department;
const countyDept = countyRow?.department;
ok('MD rows exist, named exactly "Baltimore City" and "Baltimore County", each with a department block',
  !!cityDept && !!countyDept);

// 11a. the permit-office cards
const mdCity = permitOfficeFor(place({ state: 'MD', county: MD_CITY, incorporatedPlace: unit('Baltimore city', 'Baltimore', '2404000', 'city') }));
ok('24510 → the hand-verified Baltimore City DHCD card, 443-984-1809',
  mdCity.kind === 'office' && mdCity.office?.key === 'MD:24510' && mdCity.office.verification === 'hand-verified'
    && mdCity.office.phone === '443-984-1809' && /DHCD/.test(mdCity.office.title) && mdCity.cautions.length === 0,
  `${mdCity.office?.key} ${mdCity.office?.phone}`);
const mdCounty = permitOfficeFor(place({ state: 'MD', county: MD_COUNTY, cdp: unit('Towson CDP', 'Towson', '2478425', 'CDP') }));
ok('24005 → the hand-verified Baltimore County PAI card, 410-887-3353',
  mdCounty.kind === 'office' && mdCounty.office?.key === 'MD:24005' && mdCounty.office.verification === 'hand-verified'
    && mdCounty.office.phone === '410-887-3353' && /\(PAI\)/.test(mdCounty.office.title),
  `${mdCounty.office?.key} ${mdCounty.office?.phone}`);
ok('a Maryland election district in the town slot never changes the answer (MD keys on the county)',
  permitOfficeFor(place({ state: 'MD', county: MD_COUNTY, town: unit('District 9', '9', '2400590748', '') })).office?.key === 'MD:24005');
const annapolis = permitOfficeFor(place({ state: 'MD', county: ANNE_ARUNDEL, incorporatedPlace: unit('Annapolis city', 'Annapolis', '2401600', 'city') }));
ok('24003 (Annapolis) → a NAME-ONLY Anne Arundel County card, labelled unverified, no invented contact',
  annapolis.kind === 'office' && annapolis.office?.jurisdiction === 'Anne Arundel County' && annapolis.office.verification === 'name-only'
    && annapolis.office.facts.includes(NAME_ONLY_NOTE) && !annapolis.office.phone && !annapolis.office.portalUrl && annapolis.office.key === 'MD:24003');
ok('an incorporated city inside another MD county: a caution to check, never a claim either way',
  annapolis.cautions.length === 1 && /Annapolis city/.test(annapolis.cautions[0]) && /Check whether it issues its own permits/.test(annapolis.cautions[0]));
ok('no incorporated place → no such caution',
  permitOfficeFor(place({ state: 'MD', county: ANNE_ARUNDEL })).cautions.length === 0);
const mdPin = permitOfficeFor(place({ state: 'MD', match: 'approximate', county: MD_CITY }));
ok('MD pin answer: "Looks like Baltimore City (from the map pin). Confirm."',
  mdPin.headline === 'Looks like Baltimore City (from the map pin). Confirm.', String(mdPin.headline));
const mdNone = permitOfficeFor(null, { state: 'MD', postalCity: 'Baltimore' });
ok('MD none: never picks an office, and says a "Baltimore" address can be either government',
  mdNone.kind === 'unresolved' && mdNone.office === null && /Baltimore City or Baltimore County/.test(mdNone.headline ?? ''));
ok('Pennsylvania stays unsupported', permitOfficeFor(null, { state: 'PA', postalCity: 'Philadelphia' }).kind === 'unsupported'
  && parsePlaceLookupResponse({ ...good, state: 'PA' }) === null);
ok('the wire parser accepts a Maryland answer', parsePlaceLookupResponse({ ...good, state: 'MD', county: MD_CITY, town: null })?.state === 'MD');

// ONE SOURCE: the card and the code-jurisdiction department block must agree.
for (const [label, office, row] of [['City', mdCity.office, cityRow], ['County', mdCounty.office, countyRow]] as const) {
  const d = row?.department;
  ok(`MD ${label} card = the ${row?.name} department block (phone, email, portal, hours, source, title)`,
    !!office && !!d && !!row && office.phone === (d.phone ?? null) && office.email === (d.email ?? null) && office.portalUrl === d.portalUrl
      && office.hours === (d.hours ?? null) && office.sourceUrl === d.sourceUrl && office.title === row.authorityName
      && office.sourceLabel === `${d.sourceLabel}, checked ${d.checkedOn}`);
}
ok('MD cards are keyed on exactly the two Baltimore county GEOIDs', JSON.stringify(Object.keys(MD_COUNTY_OFFICES).sort()) === '["24005","24510"]');

// 11b. the query and the edge function
const mdQ = placeQueryForProject({ location: '620 E 31st St, Baltimore, MD 21218' });
ok('placeQueryForProject accepts MD and sends the whole location (the ZIP reaches Census)',
  mdQ?.state === 'MD' && mdQ.address === '620 E 31st St, Baltimore, MD 21218' && mdQ.postalCity === 'Baltimore');
ok('edge fn: FIPS 24 → MD, and Pennsylvania (42) is still not answered',
  fn.TRISTATE_FIPS['24'] === 'MD' && fn.TRISTATE_FIPS['42'] === undefined);
const BALT_GEOS = {
  'County Subdivisions': [{ GEOID: '2451090000', NAME: 'Baltimore city', BASENAME: 'Baltimore', STATE: '24' }],
  'Incorporated Places': [{ GEOID: '2404000', NAME: 'Baltimore city', BASENAME: 'Baltimore', STATE: '24' }],
  Counties: [{ GEOID: '24510', NAME: 'Baltimore city', BASENAME: 'Baltimore', STATE: '24' }],
};
const TOWSON_GEOS = {
  'County Subdivisions': [{ GEOID: '2400590748', NAME: 'District 9', BASENAME: '9', STATE: '24' }],
  'Census Designated Places': [{ GEOID: '2478425', NAME: 'Towson CDP', BASENAME: 'Towson', STATE: '24' }],
  Counties: [{ GEOID: '24005', NAME: 'Baltimore County', BASENAME: 'Baltimore', STATE: '24' }],
};
const baltAns = fn.answerFromGeographies(BALT_GEOS, 'address', '620 E 31ST ST, BALTIMORE, MD, 21218', 'T');
ok('edge fn: 620 E 31st St → MD, county {Baltimore city, 24510}, town null',
  baltAns.state === 'MD' && baltAns.county.name === 'Baltimore city' && baltAns.county.geoid === '24510' && baltAns.town === null);
const towsonAns = fn.answerFromGeographies(TOWSON_GEOS, 'address', null, 'T');
ok('edge fn: Towson → county 24005, the election district dropped, the CDP kept',
  towsonAns.county.geoid === '24005' && towsonAns.town === null && towsonAns.cdp.basename === 'Towson');
ok('edge fn → client → card, end to end: 24510 → MD:24510, 24005 → MD:24005',
  permitOfficeFor(parsePlaceLookupResponse(baltAns)).office?.key === 'MD:24510'
    && permitOfficeFor(parsePlaceLookupResponse(towsonAns)).office?.key === 'MD:24005');
ok('edge fn: NY answers still carry their town (the MD rule is MD only)',
  fn.answerFromGeographies(LEVITTOWN_GEOS, 'address', null, 'T').town?.geoid === '3605934000');

// 11c. the resolver (X2) — County and City are decided by geography, never
// by the postal name "Baltimore".
const r = resolveCodeJurisdiction;
const rowName = (x: ReturnType<typeof r>) => (x.kind === 'city' ? x.entry.name : x.kind === 'state' ? `state:${x.entry.state}` : 'unknown');
const amb = (x: ReturnType<typeof r>) => x.kind === 'state' && !!x.localAmbiguity;
ok('Baltimore + county "Baltimore city" → the City row', rowName(r({ state: 'MD', city: 'Baltimore', county: 'Baltimore city' })) === 'Baltimore City');
ok('Towson + county "Baltimore County" → the County row', rowName(r({ state: 'MD', city: 'Towson', county: 'Baltimore County' })) === 'Baltimore County');
{
  const plain = r({ state: 'MD', city: 'Baltimore' });
  ok('plain "Baltimore, MD" → the Maryland state row WITH localAmbiguity naming both rows',
    plain.kind === 'state' && plain.entry.state === 'MD' && JSON.stringify(plain.localAmbiguity?.candidates) === '["Baltimore City","Baltimore County"]');
}
ok('"Annapolis, MD" → the state row with NO localAmbiguity', (() => { const a = r({ state: 'MD', city: 'Annapolis' }); return a.kind === 'state' && !a.localAmbiguity; })());
ok('a City-only ZIP (21218) → the City row', rowName(r({ state: 'MD', city: 'Baltimore', zip: '21218' })) === 'Baltimore City');
ok('a County-only ZIP (21204) → the County row, even under the postal name "Baltimore"',
  rowName(r({ state: 'MD', city: 'Baltimore', zip: '21204' })) === 'Baltimore County');
ok('a ZIP split between City and County (21206) → the state row, ambiguous',
  (() => { const x = r({ state: 'MD', city: 'Rosedale', zip: '21206' }); return rowName(x) === 'state:MD' && amb(x); })());
ok('a ZIP split between Baltimore County and Harford (21013) → the state row, ambiguous between THOSE two (never the City)',
  (() => { const x = r({ state: 'MD', city: 'Kingsville', zip: '21013' }); return rowName(x) === 'state:MD' && x.kind === 'state'
    && JSON.stringify(x.localAmbiguity?.candidates) === '["Baltimore County","Harford County"]' && x.localAmbiguity?.askFor === 'county'; })());
ok('a ZIP split between the City and Anne Arundel (21225, "Brooklyn") → ambiguous between the City and Anne Arundel County',
  (() => { const x = r(jurisdictionQueryForProject({ location: '1 Main St, Brooklyn, MD 21225' })); return rowName(x) === 'state:MD' && x.kind === 'state'
    && JSON.stringify(x.localAmbiguity?.candidates) === '["Baltimore City","Anne Arundel County"]'; })());
ok('"Baltimore, MD 21225" → all three: the postal name adds the County to the ZIP\'s City + Anne Arundel',
  (() => { const x = r({ state: 'MD', city: 'Baltimore', zip: '21225' }); return x.kind === 'state'
    && JSON.stringify(x.localAmbiguity?.candidates) === '["Baltimore City","Baltimore County","Anne Arundel County"]'; })());
// 21230: the Census ZCTA is wholly City, but Baltimore County's own address
// points use the USPS ZIP (10 points on Patapsco Ave / Marmenco Ct,
// 2026-09-28), so it must never place an address in the City by itself.
ok('location-only "4600 Patapsco Ave, Baltimore, MD 21230" (a County address) → the state row WITH localAmbiguity, never the City',
  (() => { const x = r(jurisdictionQueryForProject({ location: '4600 Patapsco Ave, Baltimore, MD 21230' }));
    return rowName(x) === 'state:MD' && amb(x) && x.kind === 'state' && x.localAmbiguity?.askFor === 'county'
      && issuingAuthorityForAddress(jurisdictionQueryForProject({ location: '4600 Patapsco Ave, Baltimore, MD 21230' })) === null; })());
ok('21230 with county "Baltimore city" → the City row; with "Baltimore County" → the County row',
  rowName(r({ state: 'MD', city: 'Baltimore', county: 'Baltimore city', zip: '21230' })) === 'Baltimore City'
    && rowName(r({ state: 'MD', city: 'Baltimore', county: 'Baltimore County', zip: '21230' })) === 'Baltimore County');
ok('21230 is split (both governments), not in either row\'s ZIP list',
  JSON.stringify(BALTIMORE_SPLIT_ZCTAS['21230']) === '["24005","24510"]'
    && !(cityRow?.postalZip ?? []).includes('21230') && !(countyRow?.postalZip ?? []).includes('21230'));
ok('a county field of just "Baltimore" is read as Baltimore County (pinned by validate-code-jurisdiction: a row answers to its first matchCounty)',
  rowName(r({ state: 'MD', city: 'Baltimore', county: 'Baltimore' })) === 'Baltimore County');
ok('city "Baltimore City" + county "Baltimore County" contradict → the state row, askFor fix-address, no authority',
  (() => { const q = { state: 'MD', city: 'Baltimore City', county: 'Baltimore County' }; const x = r(q);
    return rowName(x) === 'state:MD' && x.kind === 'state' && x.localAmbiguity?.askFor === 'fix-address' && issuingAuthorityForAddress(q) === null; })());
ok('the contradiction rule is Maryland only (NYC with a stray county still answers NYC)',
  rowName(r({ state: 'NY', city: 'Brooklyn', county: 'Baltimore County' })) === 'New York City');
ok('a County ZIP with county "Baltimore city" given → the City row (the county wins)',
  rowName(r({ state: 'MD', city: 'Baltimore', county: 'Baltimore city', zip: '21204' })) === 'Baltimore City');
ok('a City ZIP with county "Baltimore County" given → the County row (the county wins)',
  rowName(r({ state: 'MD', city: 'Baltimore', county: 'Baltimore County', zip: '21218' })) === 'Baltimore County');
ok('a Baltimore ZIP with another county given → the state row, no ambiguity',
  (() => { const x = r({ state: 'MD', county: 'Anne Arundel County', zip: '21218' }); return rowName(x) === 'state:MD' && !amb(x); })());
ok('a Maryland ZIP never answers in another state', rowName(r({ state: 'PA', zip: '21218' })) !== 'Baltimore City');
ok('"Baltimore City" typed as the city → the City row', rowName(r({ state: 'MD', city: 'Baltimore City' })) === 'Baltimore City');
ok('a County postal name (Owings Mills) → the County row', rowName(r({ state: 'MD', city: 'Owings Mills' })) === 'Baltimore County');
ok('a line-crossing postal name (Catonsville, 21228 split) is NOT a County postal name',
  (() => { const x = r({ state: 'MD', city: 'Catonsville' }); return rowName(x) === 'state:MD'; })());

// The data behind it.
ok('no row matches the postal name "baltimore" (County addresses use it too)',
  LOCAL_ADOPTIONS.every((e) => ![...(e.matchCity ?? []), ...(e.postalCity ?? [])].some((m) => m.trim().toLowerCase() === 'baltimore')));
{
  const cz = new Set(cityRow?.postalZip ?? []);
  const kz = new Set(countyRow?.postalZip ?? []);
  const split = Object.keys(BALTIMORE_SPLIT_ZCTAS);
  ok('City and County ZIP lists are disjoint, and no split ZCTA is in either',
    cz.size === 14 && kz.size === 28 && [...cz].every((z) => !kz.has(z)) && split.every((z) => !cz.has(z) && !kz.has(z)),
    `${cz.size} / ${kz.size} / ${split.length}`);
  ok('every split ZIP touches Baltimore City or Baltimore County, and at least two counties (31 from the Census file + 21230)',
    split.length === 32 && split.every((z) => BALTIMORE_SPLIT_ZCTAS[z].length >= 2
      && (BALTIMORE_SPLIT_ZCTAS[z].includes('24510') || BALTIMORE_SPLIT_ZCTAS[z].includes('24005'))));
  ok('only Baltimore rows carry postalZip', LOCAL_ADOPTIONS.every((e) => !e.postalZip || (e.state === 'MD' && /^Baltimore /.test(e.name))));
}

// 11d. X4: the ZIP reaches the resolver from a location-only project.
ok('zipFromLocationText: trailing ZIP', zipFromLocationText('620 E 31st St, Baltimore, MD 21218') === '21218');
ok('zipFromLocationText: ZIP+4', zipFromLocationText('620 E 31st St, Baltimore, MD 21218-1234') === '21218');
ok('zipFromLocationText: no ZIP → ""', zipFromLocationText('Baltimore, MD') === '');
ok('zipFromLocationText: a leading house number is not a ZIP', zipFromLocationText('21218 Main St, Somewhere, MD') === '');
ok('zipFromLocationText: empty / null → ""', zipFromLocationText('') === '' && zipFromLocationText(null) === '' && zipFromLocationText(undefined) === '');
const loc = (location: string): AddressableProject => ({ location });
const cityJob = loc('620 E 31st St, Baltimore, MD 21218');
ok('location-only "620 E 31st St, Baltimore, MD 21218" → the City row (via the ZIP)',
  rowName(r(jurisdictionQueryForProject(cityJob))) === 'Baltimore City');
ok('…and jobsiteAddressForProject of the same job still has zip "" (the pinned AI-1 property)',
  jobsiteAddressForProject(cityJob).zip === '');
ok('location-only Towson 21204 (a County-only ZCTA) → the County row',
  rowName(r(jurisdictionQueryForProject(loc('400 Washington Ave, Towson, MD 21204')))) === 'Baltimore County');
ok('location-only "Baltimore, MD" 21204 (County ZIP, City-looking postal name) → the County row',
  rowName(r(jurisdictionQueryForProject(loc('9 Any St, Baltimore, MD 21204')))) === 'Baltimore County');
ok('location-only "Baltimore, MD" with no ZIP → the state row WITH localAmbiguity',
  amb(r(jurisdictionQueryForProject(loc('Baltimore, MD')))));
ok('…the same with confirmedCounty "Baltimore city" → the City row',
  rowName(r(jurisdictionQueryForProject(loc('Baltimore, MD'), 'Baltimore city'))) === 'Baltimore City');
ok('…the same with confirmedCounty "Baltimore County" → the County row',
  rowName(r(jurisdictionQueryForProject(loc('Baltimore, MD'), 'Baltimore County'))) === 'Baltimore County');
ok('structuredAddress { Baltimore, MD, 21218 } with no county → the City row',
  rowName(r(jurisdictionQueryForProject({ structuredAddress: { city: 'Baltimore', state: 'MD', zip: '21218' } }))) === 'Baltimore City');
ok('structuredAddress ZIP+4 is cut to five digits',
  jurisdictionQueryForProject({ structuredAddress: { city: 'Baltimore', state: 'MD', zip: '21218-1234' } }).zip === '21218');
ok("the address's own county wins over the confirmed side (a disagreement is never resolved silently the other way)",
  rowName(r(jurisdictionQueryForProject({ structuredAddress: { city: 'Baltimore', state: 'MD', zip: '21218', county: 'Baltimore County' } }, 'Baltimore city'))) === 'Baltimore County');
ok('issuingAuthorityForAddress: a location-only City job names the City authority',
  issuingAuthorityForAddress(jurisdictionQueryForProject(cityJob)) === cityRow?.authorityName);
ok('issuingAuthorityForAddress: the ambiguous shape stays null (a state row never issues permits)',
  issuingAuthorityForAddress(jurisdictionQueryForProject(loc('Baltimore, MD'))) === null);
ok('departmentFor: the City job gets the DHCD block; the ambiguous shape gets none',
  departmentFor(r(jurisdictionQueryForProject(cityJob)))?.phone === '443-984-1809'
    && departmentFor(r(jurisdictionQueryForProject(loc('Baltimore, MD')))) === null);

// 11e. the grounding for the ambiguous shape
{
  const g = groundingFactsFor(r(jurisdictionQueryForProject(loc('Baltimore, MD'))));
  const plainMd = groundingFactsFor(r({ state: 'MD', city: 'Annapolis' }));
  ok('ambiguous: the chip says statewide only and asks for the ZIP or county',
    g.chipLabel === "Maryland statewide codes only. Baltimore City or Baltimore County? Add the job's ZIP or county to get the local codes.", g.chipLabel);
  ok('ambiguous: the prompt names BOTH local fire codes and BOTH electrical codes, from the rows',
    /IFC 2021/.test(g.promptBlock) && /NFPA 1/.test(g.promptBlock) && /NEC 2020/.test(g.promptBlock) && /NEC 2026/.test(g.promptBlock));
  ok('ambiguous: the fact is built from the rows themselves (authority names + codesSummary)',
    !!cityRow && !!countyRow && g.promptBlock.includes(cityRow.authorityName) && g.promptBlock.includes(countyRow.authorityName));
  ok('ambiguous: the prompt says only the statewide editions are grounded and forbids citing either local code',
    /only Maryland's statewide editions are grounded/.test(g.promptBlock) && /Do not cite either local code/.test(g.promptBlock));
  ok("ambiguous: its own cache key, 'state:MD:maryland:baltimore-ambiguous', different from the plain MD key",
    g.cacheKey === 'state:MD:maryland:baltimore-ambiguous' && plainMd.cacheKey !== g.cacheKey && plainMd.cacheKey === 'state:MD:maryland (state adoption)');
  ok('ambiguous: every fact is in the prompt verbatim', g.facts.every((f) => g.promptBlock.includes(f)));
  {
    const zipAmb = groundingFactsFor(r(jurisdictionQueryForProject(loc('1 Main St, X, MD 21212'))));
    ok('split-ZIP ambiguity: the chip asks for the COUNTY, not the ZIP the job already has',
      zipAmb.chipLabel === "Maryland statewide codes only. Baltimore City or Baltimore County? Add the job's county to get the local codes." && /add the job's county\.$/.test(zipAmb.facts[zipAmb.facts.length - 1]), zipAmb.chipLabel);
    ok('split-ZIP ambiguity: its own cache key (never the plain-Baltimore one)',
      zipAmb.cacheKey !== g.cacheKey && zipAmb.cacheKey.startsWith('state:MD:maryland:baltimore-ambiguous:'), zipAmb.cacheKey);
    const aa = groundingFactsFor(r({ state: 'MD', city: 'Brooklyn', zip: '21225' }));
    ok('City/Anne Arundel ambiguity: Anne Arundel is named as NOT researched; no fire/electrical claim is made for it',
      /Anne Arundel County: not researched by MAGE/.test(aa.promptBlock) && !/own fire code/.test(aa.promptBlock)
        && aa.chipLabel === "Maryland statewide codes only. Baltimore City or Anne Arundel County? Add the job's county.", aa.chipLabel);
    ok('City/Anne Arundel ambiguity: the City half is still built from the City row', !!cityRow && aa.promptBlock.includes(cityRow.authorityName));
    const fix = groundingFactsFor(r({ state: 'MD', city: 'Baltimore City', county: 'Baltimore County' }));
    ok('contradicting fields: the chip asks to fix the address', fix.chipLabel === "Maryland statewide codes only. Baltimore City or Baltimore County? Fix the job's city or county so they agree.", fix.chipLabel);
  }
  ok('the County row names the State Fire Prevention Code its own sheet also lists (2024 NFPA 1 / 101, 23 June 2025)',
    !!countyRow && /State Fire Prevention Code \(COMAR 29\.06\.01: the 2024 NFPA 1 and NFPA 101, effective 23 June 2025\)/.test(countyRow.notes ?? ''));
  ok('plain MD (Annapolis): no Baltimore fact, the usual grounded chip',
    !/Baltimore County\?/.test(plainMd.chipLabel) && !/could be in Baltimore City/.test(plainMd.promptBlock) && /^Grounded on /.test(plainMd.chipLabel));
}

// 11f. NON-MD REGRESSION: for every existing row and the golden fixtures, the
// X4 query grounds exactly as the jobsiteAddressForProject path does.
{
  const fixtures: AddressableProject[] = [
    { location: '4218 SE Rex St, Portland, OR 97206' },
    { location: '124 Park Slope, Brooklyn NY 11215' },
    { location: '94 Washington St, Hoboken, NJ 07030' },
    { structuredAddress: { street: '1 Main St', city: 'Houston', state: 'TX', zip: '77002', county: 'Harris' } },
  ];
  for (const e of LOCAL_ADOPTIONS) {
    if (e.state === 'MD') continue;
    const m = e.matchCity?.[0];
    if (m) fixtures.push({ structuredAddress: { city: m, state: e.state } }, { location: `${m}, ${e.state}` });
  }
  const drift = fixtures.filter((p) => {
    const a = groundingFactsFor(r(jobsiteAddressForProject(p)));
    const b = groundingFactsFor(r(jurisdictionQueryForProject(p)));
    return a.promptBlock !== b.promptBlock || a.cacheKey !== b.cacheKey;
  });
  ok(`non-MD: ${fixtures.length} projects ground identically through jurisdictionQueryForProject`, drift.length === 0,
    drift.map((p) => JSON.stringify(p)).slice(0, 4).join('; '));
}

// 11g. honesty in the department blocks
{
  const emails = [cityDept, countyDept].flatMap((d) => [d?.email, ...(d?.questionChannels ?? []).map((c) => c.email)]).filter((x): x is string => !!x);
  ok('MD departments use only department mailboxes (no staff names)',
    emails.length > 0 && emails.every((m) => /^(DHCD\.[A-Za-z]+|BCFD\.Plans|deptofplanning)@baltimorecity\.gov$|^(paipermitstatus|paibldgrvw)@baltimorecountymd\.gov$/.test(m)), emails.join(', '));
  const review = countyDept?.questionChannels.find((c) => c.stage === 'in_review');
  ok('County plans review: the two published phone numbers are named, neither is picked as THE number',
    !!review && !review.phone && /410-887-3985/.test(review.note) && /410-887-3987/.test(review.note));
  const chap = cityDept?.questionChannels.find((c) => /CHAP/.test(c.label));
  ok('City CHAP phone is the one two official sources agree on (410-396-7526, not 410-396-4866)',
    chap?.phone === '410-396-7526' && !JSON.stringify(cityDept).includes('4866'));
  ok('City hours name the no-Wednesday rule AND the Help Center\'s conflicting listing',
    /no in-person help on Wednesdays/.test(cityDept?.hours ?? '') && /call ahead/.test(cityDept?.hours ?? ''));
  ok('no QuickTrac number (443-984-2776 was never on a City page)', !JSON.stringify([cityDept, countyDept]).includes('984-2776'));
  ok('fees are links, never amounts', [cityDept, countyDept].every((d) => (d?.feeScheduleUrls ?? []).length > 0) && !/\$\d/.test(JSON.stringify([cityDept, countyDept])));
  ok('portal labels and source labels are set (the card never falls back to NYC wording for MD)',
    cityDept?.portalLabel === 'E-Permits portal' && cityDept.sourceLabel === 'baltimorecity.gov'
      && countyDept?.portalLabel === 'Permits portal (PLL)' && countyDept.sourceLabel === 'baltimorecountymd.gov');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-permit-offices: ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
