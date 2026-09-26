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
ok(`DEPARTMENTS holds ${cards.length} cards = 564 NJ + 174 CT + 12 NY`, cards.length === 564 + 174 + 12 && NY_HAND_VERIFIED.length === 12);
ok('every card key is <state>:<id>', cards.every((c) => /^(NJ|CT|NY):[\w-]+$/.test(c.key)));
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

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-permit-offices: ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
