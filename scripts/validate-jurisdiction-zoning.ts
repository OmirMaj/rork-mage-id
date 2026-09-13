// validate-jurisdiction-zoning.ts — pins utils/automation/jurisdiction.ts.
//
// The non-negotiable principle under test: a GUESS is never truth, and
// downstream stays BLOCKED until a human confirm. Invariants:
//   • isZoningConfirmed is false for: no address, guess source, missing
//     timestamp, empty district, malformed timestamp.
//   • resolveZoning never returns source 'confirmed' unless isZoningConfirmed.
//   • resolveZoningAsync NEVER returns 'confirmed' for an unconfirmed project,
//     regardless of what the (injected) guess source reports — including a
//     source that tries to fabricate a district.
//   • confirmZoning is the ONLY path to 'confirmed': it stamps zoningConfirmedAt
//     + zoningSource='confirmed', flips isZoningConfirmed true, unblocks reason.
//   • confirmZoning refuses an empty district (can't confirm nothing).
//   • the guess source is pluggable (a custom source is honoured).
//
// AND THE THREE HOLES THE 2026-09-12 AUDIT FOUND, each with the test that would
// have caught it. These are executed against the real functions — never a grep
// for a call — because the bugs were all "the code is present and does the
// wrong thing":
//   1. A STREET ADDRESS LAUNDERED INTO A CONFIRMED DISTRICT. A confirmed
//      district may never be the project's location / street, on the write
//      (confirmZoning throws) or on the read (isZoningConfirmed refuses a row
//      already written that way).
//   2. A CONFIRM OUTLIVING ITS ADDRESS. State, city and street changes
//      invalidate a confirm; ZIP, county, unit number and spelling do not. Both
//      halves are tested — over-invalidating is its own failure — and both are
//      tested TWICE: once on a hand-built structuredAddress, and once ("LIVE
//      SHAPE") on the only shape the app can actually produce, a free-text
//      `location`. The first fix was pinned by structured fixtures alone, which
//      is how a municipality-only key passed as parcel-level for months.
//      A stale confirm is also not SURFACED: the sheet renders a one-tap
//      Confirm for any district handed to it, so a stale district in that field
//      is one tap from being re-stamped onto a different parcel.
//   3. STORED COORDINATES, AND A VISIBLE GEOCODE FAILURE. resolveZoningAsync
//      must not hit the network when the project already has coordinates
//      (asserted by counting fetch calls), and 'failed' must be tellable from
//      'unattempted' and from a successful lookup. THIS HOLE WAS LATENT, NOT
//      LIVE: resolveZoningAsync has no production caller (the screen uses the
//      pure resolveZoning), so no user ever paid for the repeated requests. The
//      assertions below pin an UNUSED SEAM that a real parcel API will use —
//      worth keeping, and worth labelling as such rather than implying traffic.
//
// Run: bun run scripts/validate-jurisdiction-zoning.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Project } from '../types';
import {
  resolveZoning,
  resolveZoningAsync,
  isZoningConfirmed,
  confirmZoning,
  canConfirmZoning,
  zoningBlockedReason,
  zoningGateState,
  zoningAddressKey,
  looksLikeAddressNotDistrict,
  describeZoningUnknown,
  zoningPropForProject,
  stubGuessSource,
  type ZoningGuessSource,
} from '../utils/automation/jurisdiction';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

type SA = NonNullable<Project['structuredAddress']>;

// Minimal Project stub — only the fields jurisdiction reads matter; cast the
// rest so we don't have to build a full domain object.
function makeProject(sa?: Project['structuredAddress'], location?: string, coords?: { lat: number; lng: number }): Project {
  return {
    id: 'p1',
    name: 'Test',
    location: location ?? '',
    structuredAddress: sa,
    locationLatitude: coords?.lat,
    locationLongitude: coords?.lng,
  } as unknown as Project;
}

/** A real, complete jobsite: the fixtures below edit ONE field off this so a
 *  failure names exactly which edit did (or did not) invalidate the confirm. */
const GARDEN_CITY: SA = { street: '123 Main St', city: 'Garden City', state: 'NY', zip: '11530' };
const CONFIRMED_AT = '2026-08-20T12:00:00.000Z';

/** Confirm 'R-5' for an address, then read the gate back on a possibly
 *  DIFFERENT address — the whole point of hole 2. */
function confirmThenMoveTo(from: SA, to: SA): Project {
  const patch = confirmZoning(makeProject(from), 'R-5', CONFIRMED_AT);
  return makeProject({ ...to, zoningDistrict: patch.zoningDistrict, zoningConfirmedAt: patch.zoningConfirmedAt, zoningSource: patch.zoningSource, zoningConfirmedFor: patch.zoningConfirmedFor });
}

async function main() {
  console.log('\njurisdiction / zoning trust-but-verify:');

  // ── isZoningConfirmed: false for every un-confirmed shape ──
  ok('no structuredAddress → not confirmed', !isZoningConfirmed(makeProject(undefined)));
  ok('guess source → not confirmed',
    !isZoningConfirmed(makeProject({ ...GARDEN_CITY, zoningDistrict: 'R-5', zoningSource: 'guess' })));
  ok('confirmed source but no timestamp → not confirmed',
    !isZoningConfirmed(makeProject({ ...GARDEN_CITY, zoningDistrict: 'R-5', zoningSource: 'confirmed' })));
  ok('confirmed + timestamp but empty district → not confirmed',
    !isZoningConfirmed(makeProject({ ...GARDEN_CITY, zoningDistrict: '   ', zoningSource: 'confirmed', zoningConfirmedAt: CONFIRMED_AT })));
  ok('confirmed + district but malformed timestamp → not confirmed',
    !isZoningConfirmed(makeProject({ ...GARDEN_CITY, zoningDistrict: 'R-5', zoningSource: 'confirmed', zoningConfirmedAt: 'not-a-date' })));
  ok('fully confirmed FOR THIS ADDRESS → IS confirmed',
    isZoningConfirmed(confirmThenMoveTo(GARDEN_CITY, GARDEN_CITY)));

  // ── resolveZoning purity: never 'confirmed' unless the gate agrees ──
  const guessed = resolveZoning(makeProject({ ...GARDEN_CITY, zoningDistrict: 'R-5', zoningSource: 'guess' }));
  ok('stored unconfirmed district resolves as a GUESS', guessed.source === 'guess', `got ${guessed.source}`);
  ok('guessed district is surfaced (not hidden)', guessed.district === 'R-5', `got ${guessed.district}`);

  const empty = resolveZoning(makeProject(undefined));
  ok('nothing stored → district null, source guess', empty.district === null && empty.source === 'guess');

  const conf = resolveZoning(confirmThenMoveTo(GARDEN_CITY, GARDEN_CITY));
  ok('confirmed project resolves as CONFIRMED truth', conf.source === 'confirmed' && conf.district === 'R-5' && conf.confidence === 'high');

  // A GUESS NEVER READS AS CONFIRMED, even when it carries a perfectly valid
  // address stamp and timestamp — only zoningSource='confirmed' counts.
  const dressedUpGuess = makeProject({
    ...GARDEN_CITY,
    zoningDistrict: 'R-5',
    zoningSource: 'guess',
    zoningConfirmedAt: CONFIRMED_AT,
    zoningConfirmedFor: zoningAddressKey(makeProject(GARDEN_CITY)) ?? '',
  });
  ok('a guess wearing a timestamp AND a matching address stamp is still a guess',
    !isZoningConfirmed(dressedUpGuess) && zoningGateState(dressedUpGuess) === 'unconfirmed'
      && resolveZoning(dressedUpGuess).source === 'guess');

  // ── confirmZoning is the ONLY path to 'confirmed' ──
  const before = makeProject({ ...GARDEN_CITY, zoningDistrict: 'R-5', zoningSource: 'guess' });
  ok('before confirm: blocked (gate false)', !isZoningConfirmed(before));
  ok('before confirm: a blocked reason exists', zoningBlockedReason(before) !== null);

  const patch = confirmZoning(before, 'R-5', CONFIRMED_AT);
  const after = makeProject(patch);
  ok('confirmZoning stamps zoningSource=confirmed', patch.zoningSource === 'confirmed');
  ok('confirmZoning stamps zoningConfirmedAt', patch.zoningConfirmedAt === CONFIRMED_AT);
  ok('after confirm: gate true', isZoningConfirmed(after));
  ok('after confirm: no blocked reason', zoningBlockedReason(after) === null);

  // confirm trims + rejects empty
  ok('confirmZoning trims the district', confirmZoning(before, '  R-3  ').zoningDistrict === 'R-3');
  let threw = false;
  try { confirmZoning(before, '   '); } catch { threw = true; }
  ok('confirmZoning rejects an empty district', threw);

  // ── resolveZoningAsync NEVER auto-confirms, even with a lying source ──
  const lyingSource: ZoningGuessSource = {
    name: 'liar',
    async guess() {
      // A source that tries to claim high confidence / a district. The engine
      // must STILL treat it as a guess — never confirmed.
      return { district: 'C-6', confidence: 'high', rationale: 'totally sure (not)' };
    },
  };
  const asyncGuess = await resolveZoningAsync(makeProject(GARDEN_CITY, '', { lat: 40.72, lng: -73.63 }), lyingSource);
  ok('async guess is source=guess even from a confident source', asyncGuess.source === 'guess', `got ${asyncGuess.source}`);
  ok('async guess surfaces the district as a guess', asyncGuess.district === 'C-6');
  ok('async guess carries a rationale (provenance)', typeof asyncGuess.rationale === 'string' && asyncGuess.rationale.length > 0);
  ok('async on an unconfirmed project keeps gate FALSE',
    !isZoningConfirmed(makeProject({ ...GARDEN_CITY, zoningDistrict: asyncGuess.district ?? undefined, zoningSource: 'guess' })));

  // ── pluggable source honoured; stub is honest (no fabricated district) ──
  const stub = await stubGuessSource.guess({ structuredAddress: { street: '', city: '', state: '', zip: '' }, geocode: null, geocodeOrigin: 'unattempted' });
  ok('stub guess fabricates NO district (honest null)', stub.district === null);
  ok('stub guess carries a rationale', stub.rationale.length > 0);

  // ── async short-circuits a confirmed project (returns confirmed truth) ──
  const confAsync = await resolveZoningAsync(confirmThenMoveTo(GARDEN_CITY, GARDEN_CITY));
  ok('async on a confirmed project returns confirmed (no re-guess)', confAsync.source === 'confirmed' && confAsync.district === 'R-5');

  // ═══════════════════════════════════════════════════════════════════
  // HOLE 1 — a street address can NEVER become a confirmed district.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\nhole 1 — an address is not a district:');

  const freeText = makeProject(undefined, '124 Park Slope, Brooklyn NY 11215');

  for (const [what, district, project] of [
    ['the free-text location string', '124 Park Slope, Brooklyn NY 11215', freeText],
    ['the location with different spacing/case', '124 park slope,  brooklyn ny 11215', freeText],
    ['the structured street line', '123 Main St', makeProject(GARDEN_CITY)],
    ['the street with a suffix spelled out', '123 Main Street', makeProject(GARDEN_CITY)],
    ['a bare street address never stored anywhere', '900 Stewart Ave', makeProject(GARDEN_CITY)],
  ] as [string, string, Project][]) {
    let refused = false;
    try { confirmZoning(project, district); } catch { refused = true; }
    ok(`confirmZoning REFUSES ${what}`, refused, `"${district}" was accepted as a district`);
  }

  ok('a real district is NOT mistaken for an address',
    !looksLikeAddressNotDistrict(makeProject(GARDEN_CITY), 'R-5')
    && !looksLikeAddressNotDistrict(makeProject(GARDEN_CITY), 'C-2')
    && !looksLikeAddressNotDistrict(makeProject(GARDEN_CITY), 'MU-3')
    && !looksLikeAddressNotDistrict(freeText, 'R6A'));

  // THE HEURISTIC IS NARROWED, AND THIS IS THE LINE BETWEEN THE TWO SIDES.
  // It used to refuse "a number, a space, anything" — a SHAPE, not an address —
  // and there is no override path anywhere in the app, so any district named
  // that way was permanently unconfirmable and the contractor just got "That is
  // not a zoning district". Now it needs a STREET WORD after the number. What
  // the project's address actually is, is still caught by comparison above.
  for (const notAnAddress of ['4 Family Residence', '2 Acre Minimum', '1 Industrial']) {
    ok(`a district named "${notAnAddress}" is confirmable`,
      !looksLikeAddressNotDistrict(makeProject(GARDEN_CITY), notAnAddress)
      && confirmZoning(makeProject(GARDEN_CITY), notAnAddress).zoningDistrict === notAnAddress);
  }
  for (const isAnAddress of ['900 Stewart Ave', '125 Main Street', '9 North Broadway', '40 Gardiners Ave']) {
    ok(`a bare address "${isAnAddress}" is still refused`,
      looksLikeAddressNotDistrict(makeProject(GARDEN_CITY), isAnAddress));
  }
  ok('confirmZoning still ACCEPTS those real districts',
    confirmZoning(makeProject(GARDEN_CITY), 'R-5').zoningDistrict === 'R-5'
    && confirmZoning(freeText, 'R6A').zoningDistrict === 'R6A');

  // The row that is ALREADY on a device, written by the laundering path before
  // it was removed: a perfectly-formed confirm whose district is the address.
  // A write-side guard alone would let this keep reading as truth forever.
  const launderedKey = zoningAddressKey(freeText);
  const laundered = makeProject(
    { street: '', city: '', state: '', zip: '', zoningDistrict: '124 Park Slope, Brooklyn NY 11215', zoningSource: 'confirmed', zoningConfirmedAt: CONFIRMED_AT, zoningConfirmedFor: launderedKey ?? '' },
    '124 Park Slope, Brooklyn NY 11215',
  );
  ok('a legacy laundered confirm does NOT read as confirmed', !isZoningConfirmed(laundered));
  ok('a legacy laundered confirm resolves as a guess, not truth', resolveZoning(laundered).source === 'guess');
  // …and the address is not even offered as a guessed district: with a district
  // in hand the sheet shows a ONE-TAP confirm, so surfacing it would leave the
  // laundered value one tap from being truth again.
  ok('a laundered value is not surfaced as a district at all', resolveZoning(laundered).district === null,
    String(resolveZoning(laundered).district));
  ok('the gate names it: state = laundered', zoningGateState(laundered) === 'laundered');
  ok('the blocked reason says the stored value is the address',
    /jobsite address/i.test(zoningBlockedReason(laundered) ?? ''), zoningBlockedReason(laundered) ?? 'null');

  // THE INVARIANT ITSELF, stated once: a confirmed district can never equal the
  // project's location string. Swept over every confirmable fixture.
  for (const p of [makeProject(GARDEN_CITY), freeText, laundered, after, dressedUpGuess]) {
    const d = resolveZoning(p);
    const isAddr = d.district !== null && looksLikeAddressNotDistrict(p, d.district);
    ok(`a district that IS the address never resolves confirmed (${p.structuredAddress?.city || p.location || 'no address'})`,
      !(d.source === 'confirmed' && isAddr));
  }

  // The honest UNKNOWN surface: it must never print the street where a district
  // belongs, and it must not invent one — it has no district field at all.
  const facts = describeZoningUnknown(makeProject(GARDEN_CITY));
  const blob = JSON.stringify(facts);
  ok('the unknown panel never prints the street line', !blob.includes('123 Main'), blob);
  ok('the unknown panel reports the parsed place (a place, not an authority claim)',
    facts.zoningAuthorityLabel === 'Garden City, NY', String(facts.zoningAuthorityLabel));
  ok('the unknown panel asks for the district', /enter the district/i.test(facts.ask), facts.ask);
  ok('the unknown panel offers no district of its own',
    !('district' in (facts as unknown as Record<string, unknown>)));

  // Where the cited table HAS a record, the panel hands over the code + link,
  // labelled as the building code. Brooklyn resolves to the NYC row.
  const nycFacts = describeZoningUnknown(makeProject({ street: '124 Park Slope', city: 'Brooklyn', state: 'NY', zip: '11215' }));
  ok('a covered address gets the verified code record',
    !!nycFacts.codeSummary && !!nycFacts.codeSourceUrl && /^https:\/\//.test(nycFacts.codeSourceUrl ?? ''));
  ok('a covered address names the permit-issuing office',
    nycFacts.permitAuthority === 'New York City Department of Buildings', String(nycFacts.permitAuthority));
  // …and where it does not, null is passed through rather than papered over.
  const uncovered = describeZoningUnknown(makeProject({ street: '1 Oak', city: 'Garden City', state: 'NY', zip: '11530' }));
  ok('an uncovered address gets NO invented permit office', uncovered.permitAuthority === null);
  ok('an uncovered address still reports its parsed place',
    uncovered.zoningAuthorityLabel === 'Garden City, NY');

  // ── THE ZONING AUTHORITY IS NOT ASSERTED, BECAUSE IT WAS NEVER LOOKED UP ──
  //
  // The panel used to print "<place> writes the district map for this parcel"
  // for whatever the address parse produced. Every fixture below is a real
  // counter-example the old copy stated as fact, and the validator pinned only
  // Garden City (an actual incorporated village), so all four passed:
  //   Brooklyn      a BOROUGH — the panel's own next line correctly names the
  //                 NYC Department of Buildings, contradicting it
  //   Levittown /   census-designated places: no government, no building
  //   Elmont        department to ask
  //   Nassau County a COUNTY, which this module's header says does not zone
  // What IS verified (and all the copy now claims): zoning here is set locally,
  // and MAGE has not established which local body covers the parcel.
  for (const [label, loc] of [
    ['a NYC borough', '124 Park Slope, Brooklyn, NY 11215'],
    ['a census-designated place', '40 Gardiners Ave, Levittown, NY 11756'],
    ['another CDP', '7 Elm St, Elmont, NY 11003'],
    ['a county', '1 Main St, Nassau County, NY'],
    ['a real incorporated village', '1 Oak St, Garden City, NY 11530'],
  ] as [string, string][]) {
    const f = describeZoningUnknown(makeProject(undefined, loc));
    const note = f.zoningAuthorityNote ?? '';
    ok(`${label}: the note HEDGES instead of naming a governing body`,
      /has not verified which one covers/i.test(note)
      && /set locally/i.test(note)
      && !/writes the district map/i.test(note),
      note);
    // The strongest available form: the ask must not NAME the place at all.
    // Naming it is what turned an unverified parse into "ask them"; the note
    // above carries the jobsite, so nothing is lost by leaving it out here.
    ok(`${label}: the ask names no authority, and says zoning is local`,
      !!f.zoningAuthorityLabel && !f.ask.includes(f.zoningAuthorityLabel)
      && !/districts are set by/i.test(f.ask) && /village, town or city/i.test(f.ask), f.ask);
  }
  // The place label itself is still the parsed place — it is the CLAIM that was
  // withdrawn, not the address.
  ok('the parsed place is still reported (it is a place, not a claim)',
    describeZoningUnknown(makeProject(undefined, '124 Park Slope, Brooklyn, NY 11215'))
      .zoningAuthorityLabel === 'Brooklyn, NY');
  ok('no place at all → no note, and the ask asks for the address',
    describeZoningUnknown(makeProject(undefined, '')).zoningAuthorityNote === null
    && /Add the jobsite city and state/i.test(describeZoningUnknown(makeProject(undefined, '')).ask));

  // THE SCREEN'S PROP, EXECUTED — not grepped.
  //
  // This used to be two regexes over app/(tabs)/construction-ai/index.tsx. The
  // adversarial review reintroduced the laundering behaviourally, with an
  // intermediate binding (`const rz = { ...raw, district: raw.district ?? p.location }`)
  // while leaving both regex targets textually intact, and the validator still
  // reported 97 passed, 0 failed. One of the two was also a NAME GREP on the
  // identifier `rz`, which went red on a harmless rename. So the derivation was
  // extracted into zoningPropForProject and the rule is now asserted on its
  // OUTPUT, for the exact project shape every real user has: a free-text
  // location, no structured address, nothing confirmed.
  const addressOnly = makeProject(undefined, '124 Park Slope, Brooklyn NY 11215');
  const addressOnlyProp = zoningPropForProject(addressOnly);
  ok('the screen prop carries NO district for an address-only project',
    addressOnlyProp.district === undefined, String(addressOnlyProp.district));
  ok('…and nothing in the prop is the jobsite address wearing a district',
    !JSON.stringify(addressOnlyProp).includes('124 Park Slope'),
    JSON.stringify(addressOnlyProp));
  ok('…it is blocked, with a reason and the honest unknown panel',
    addressOnlyProp.status === 'guess' && !!addressOnlyProp.reason && !!addressOnlyProp.unknown);
  ok('…and it can be confirmed (Brooklyn NY places the municipality)',
    addressOnlyProp.canConfirm === true);
  // A CONFIRMED project's prop carries the real district and drops the panel.
  const confirmedProp = zoningPropForProject(confirmThenMoveTo(GARDEN_CITY, GARDEN_CITY));
  ok('a confirmed project\'s prop carries the district and status confirmed',
    confirmedProp.district === 'R-5' && confirmedProp.status === 'confirmed'
    && confirmedProp.reason === undefined && confirmedProp.unknown === undefined);
  // A LAUNDERED legacy row must not reach the prop either — the sheet would
  // render a one-tap Confirm for it.
  // (`laundered` is built a few lines above.)
  // The source regex is KEPT as a cheap extra, but it is no longer the proof.
  const screen = src('app/(tabs)/construction-ai/index.tsx');
  ok('the screen source still shows no location→district fallback',
    !/\.district\s*\?\?\s*[\w.]*[Ll]ocation/.test(screen)
    && !/district:\s*[\w.]*\.location/.test(screen));
  ok('the screen derives the prop from the pure function, not inline',
    /zoningPropForProject\(roadmapProject\)/.test(screen));
  ok('the confirm handler takes the district as an argument',
    /handleConfirmZoning\s*=\s*useCallback\(\(district: string\)/.test(screen));
  ok('a laundered legacy row never reaches the sheet as a district',
    zoningPropForProject(laundered).district === undefined,
    String(zoningPropForProject(laundered).district));

  // ── WHERE A CONFIRM LIVES — a SOURCE check, and labelled as one ──
  //
  // A confirm is written to structuredAddress, for which `projects` has no
  // column. The review proved the consequence: absent from the upsert payload
  // AND absent from the row→Project mapper, every confirm was destroyed by the
  // next successful projects fetch, because the loader then overwrites the
  // AsyncStorage copy with the server-shaped list. The fix is one line in the
  // mapper carrying the device's cached value forward.
  //
  // THIS IS A PRESENCE TEST and it is worth naming as such: the mapper is an
  // inline closure inside a 5,000-line provider, so nothing here executes it.
  // It pins the PAIR — no column in the payload, therefore a carry in the
  // mapper — which is the invariant that broke, and it goes red if either half
  // is removed. Behaviour is covered where it can be: the gate re-derives the
  // key from the CURRENT location, asserted by execution throughout this file.
  const ctx = src('contexts/ProjectContext.tsx');
  const payloadHasColumn = /structured_address\s*:/.test(ctx);
  ok('structuredAddress is carried forward by the projects mapper, or persisted',
    payloadHasColumn || /structuredAddress:\s*cached\?\.structuredAddress/.test(ctx),
    payloadHasColumn ? 'a column appeared — update this assertion' : 'neither a column nor the cached carry is present');

  // ═══════════════════════════════════════════════════════════════════
  // HOLE 2 — a confirm is tied to the address it was made for.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\nhole 2 — a confirm belongs to one address:');

  // INVALIDATING edits: a different parcel or a different municipality.
  const invalidating: [string, SA][] = [
    ['a different city', { ...GARDEN_CITY, city: 'Huntington' }],
    ['a different state', { ...GARDEN_CITY, state: 'NJ' }],
    ['a different house number on the same street', { ...GARDEN_CITY, street: '125 Main St' }],
    ['a different street in the same city', { ...GARDEN_CITY, street: '9 Stewart Ave' }],
  ];
  for (const [what, to] of invalidating) {
    const moved = confirmThenMoveTo(GARDEN_CITY, to);
    ok(`${what} INVALIDATES the confirm`, !isZoningConfirmed(moved) && zoningGateState(moved) === 'stale',
      `state=${zoningGateState(moved)}`);
    ok(`${what} → the reason explains the address changed`,
      /address changed/i.test(zoningBlockedReason(moved) ?? ''), zoningBlockedReason(moved) ?? 'null');
    // THIS ASSERTION USED TO ENCODE THE BUG. It required the stale district to
    // still be SURFACED ("the district is still shown, as a guess") — and the
    // review sheet renders a ONE-TAP Confirm for any district it is handed, so
    // surfacing it left Garden City's answer one tap from being re-stamped onto
    // Huntington's parcel. Executed, reproduced, and now inverted: hidden from
    // the district field, still QUOTED in the reason so the contractor learns
    // what was dropped and why.
    ok(`${what} → the stale district is NOT offered as confirmable`,
      resolveZoning(moved).district === null, String(resolveZoning(moved).district));
    ok(`${what} → the reason still names the district that was dropped`,
      (zoningBlockedReason(moved) ?? '').includes('R-5'), zoningBlockedReason(moved) ?? 'null');
    ok(`${what} → the sheet therefore gets the district INPUT, not a one-tap`,
      zoningPropForProject(moved).district === undefined
      && zoningPropForProject(moved).canConfirm === true,
      JSON.stringify({ d: zoningPropForProject(moved).district, c: zoningPropForProject(moved).canConfirm }));
  }

  // HARMLESS edits: same parcel, better described. Invalidating on these would
  // nag the contractor into confirming blind, which is the other failure mode.
  const harmless: [string, SA][] = [
    ['a ZIP correction', { ...GARDEN_CITY, zip: '11531' }],
    ['a ZIP+4', { ...GARDEN_CITY, zip: '11530-1234' }],
    ['filling in the county', { ...GARDEN_CITY, county: 'Nassau' }],
    ['adding a unit number', { ...GARDEN_CITY, street: '123 Main St Apt 2' }],
    ['adding a suite', { ...GARDEN_CITY, street: '123 Main St Suite 300' }],
    ['a # unit', { ...GARDEN_CITY, street: '123 Main St #4' }],
    ['spelling the suffix out', { ...GARDEN_CITY, street: '123 Main Street' }],
    ['case and punctuation', { ...GARDEN_CITY, street: '123 MAIN ST.', city: 'garden city' }],
    ['stray whitespace', { ...GARDEN_CITY, street: '  123   Main St  ' }],
  ];
  for (const [what, to] of harmless) {
    const same = confirmThenMoveTo(GARDEN_CITY, to);
    ok(`${what} does NOT invalidate the confirm`, isZoningConfirmed(same),
      `state=${zoningGateState(same)} key=${zoningAddressKey(same)}`);
  }
  // The directional case runs off its own base so both sides are comparable.
  const dirBase: SA = { street: '123 N. Main Street', city: 'Garden City', state: 'NY', zip: '11530' };
  ok('a directional abbreviation does NOT invalidate the confirm',
    isZoningConfirmed(confirmThenMoveTo(dirBase, { ...dirBase, street: '123 North Main St' })));

  // A street NAME that contains a unit word must not be eaten by the unit
  // stripper — if it were, every address on Floor Ave would collapse to its
  // house number and two different streets would share one confirm.
  const floorAve: SA = { street: '12 Floor Ave', city: 'Garden City', state: 'NY', zip: '11530' };
  ok('a street named "Floor Ave" survives unit-stripping',
    isZoningConfirmed(confirmThenMoveTo(floorAve, floorAve))
    && !isZoningConfirmed(confirmThenMoveTo(floorAve, { ...floorAve, street: '12 Room Rd' })),
    `key=${zoningAddressKey(makeProject(floorAve))}`);

  // A confirm written before the address stamp existed cannot be honoured: we
  // do not know which jobsite it was made for.
  const legacy = makeProject({ ...GARDEN_CITY, zoningDistrict: 'R-5', zoningSource: 'confirmed', zoningConfirmedAt: CONFIRMED_AT });
  ok('a legacy confirm with no address stamp reads as STALE, not truth',
    !isZoningConfirmed(legacy) && zoningGateState(legacy) === 'stale');

  // No city/state → nothing to tie a confirm to. Refused at the setter AND
  // announced by canConfirmZoning so the UI never offers the control.
  const noWhere = makeProject({ street: '123 Main St', city: '', state: '', zip: '' });
  let refusedNoWhere = false;
  try { confirmZoning(noWhere, 'R-5'); } catch { refusedNoWhere = true; }
  ok('confirmZoning refuses a project with no city/state', refusedNoWhere);
  ok('canConfirmZoning says so, with a reason', canConfirmZoning(noWhere).ok === false);
  ok('canConfirmZoning is true for a real address', canConfirmZoning(makeProject(GARDEN_CITY)).ok === true);
  ok('zoningAddressKey is null when the municipality is unknown', zoningAddressKey(noWhere) === null);
  ok('zoningGateState calls that out', zoningGateState(noWhere) === 'unaddressable');

  // The free-text path uses the SAME address resolution as the code surfaces,
  // so a legacy project with only `location` can still confirm — and still
  // loses the confirm when the town changes.
  const ftPatch = confirmZoning(freeText, 'R6A', CONFIRMED_AT);
  const ftConfirmed = makeProject(ftPatch, '124 Park Slope, Brooklyn NY 11215');
  ok('a free-text-only project can confirm', isZoningConfirmed(ftConfirmed));
  const ftMoved = makeProject(ftPatch, '124 Park Slope, Huntington NY 11743');
  ok('moving that free-text job to another town invalidates it',
    !isZoningConfirmed(ftMoved) && zoningGateState(ftMoved) === 'stale');

  // ── THE SAME SEMANTICS, ON THE SHAPE EVERY REAL PROJECT ACTUALLY HAS ──
  //
  // The structured fixtures above are hand-built, and the review proved NOTHING
  // IN THE APP CAN PRODUCE THEM: the only writer of structuredAddress is the
  // zoning confirm's own patch, which writes street/city/state/zip as '', and
  // jobsiteAddressForProject's free-text branch hard-codes street: ''. So the
  // key was `state|city|` for 100% of projects and a confirm made for 123 Main
  // St silently covered a parcel a mile away — while four assertions about house
  // numbers passed in CI, on fixtures production cannot build. These run on the
  // production shape: a free-text `location` and nothing else.
  const liveConfirm = (location: string) => {
    const pt = confirmZoning(makeProject(undefined, location), 'R-5', CONFIRMED_AT);
    return (now: string) => makeProject(pt, now);
  };
  const atMain = liveConfirm('123 Main St, Garden City, NY 11530');
  ok('LIVE SHAPE: the key carries the parcel, not just the municipality',
    zoningAddressKey(makeProject(undefined, '123 Main St, Garden City, NY 11530'))
      === 'ny|garden city|123 main street',
    String(zoningAddressKey(makeProject(undefined, '123 Main St, Garden City, NY 11530'))));
  ok('LIVE SHAPE: the same address still reads confirmed',
    isZoningConfirmed(atMain('123 Main St, Garden City, NY 11530')));
  for (const [what, to] of [
    ['a different house number', '125 Main St, Garden City, NY 11530'],
    ['a different street in the same town', '9 Stewart Ave, Garden City, NY 11530'],
    ['a different street miles away in the same town', '1000 Franklin Ave, Garden City, NY 11530'],
    ['a different town', '123 Main St, Huntington, NY 11743'],
    ['a different state', '123 Main St, Garden City, NJ 07001'],
  ] as [string, string][]) {
    const p2 = atMain(to);
    ok(`LIVE SHAPE: ${what} INVALIDATES the confirm`,
      !isZoningConfirmed(p2) && zoningGateState(p2) === 'stale',
      `state=${zoningGateState(p2)} key=${zoningAddressKey(p2)}`);
  }
  for (const [what, to] of [
    ['a ZIP correction', '123 Main St, Garden City, NY 11531'],
    ['a ZIP+4', '123 Main St, Garden City, NY 11530-1234'],
    ['spelling the suffix out', '123 Main Street, Garden City, NY 11530'],
    ['a unit number', '123 Main St Apt 2, Garden City, NY 11530'],
    ['a # unit', '123 Main St #4, Garden City, NY 11530'],
    ['case and punctuation', '123 MAIN ST., garden city, ny 11530'],
    ['stray whitespace', '  123   Main St ,  Garden City ,  NY 11530'],
  ] as [string, string][]) {
    const p2 = atMain(to);
    ok(`LIVE SHAPE: ${what} does NOT invalidate the confirm`, isZoningConfirmed(p2),
      `state=${zoningGateState(p2)} key=${zoningAddressKey(p2)}`);
  }
  // A location that names only a town has no parcel to key on — and says so by
  // being empty, rather than by pretending the confirm is parcel-specific.
  ok('a town-only location keys the municipality and nothing more',
    zoningAddressKey(makeProject(undefined, 'Garden City, NY')) === 'ny|garden city|',
    String(zoningAddressKey(makeProject(undefined, 'Garden City, NY'))));
  // The street is found by the LAST occurrence of the city, so a street that
  // repeats the town's name keeps its street.
  ok('a street that repeats the town name keeps its street in the key',
    zoningAddressKey(makeProject(undefined, '9 Garden City Rd, Garden City, NY 11530'))
      === 'ny|garden city|9 garden city road',
    String(zoningAddressKey(makeProject(undefined, '9 Garden City Rd, Garden City, NY 11530'))));

  // ═══════════════════════════════════════════════════════════════════
  // HOLE 3 — stored coordinates first; a silent failure is visible.
  // ═══════════════════════════════════════════════════════════════════
  // NOTE THE SCOPE, stated where it is easy to check: everything in this
  // section drives resolveZoningAsync, which NOTHING in the app calls today.
  // These assertions pin the pluggable-guess seam's contract before a real
  // parcel source arrives; they are not evidence of a bug users hit.
  console.log('\nhole 3 — geocoding seam (no production caller yet): stored first, failure visible:');

  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  const withFetch = async <T,>(impl: typeof globalThis.fetch, fn: () => Promise<T>): Promise<T> => {
    fetchCalls = 0;
    globalThis.fetch = ((...args: Parameters<typeof globalThis.fetch>) => {
      fetchCalls += 1;
      return impl(...args);
    }) as typeof globalThis.fetch;
    try { return await fn(); } finally { globalThis.fetch = realFetch; }
  };
  const neverCalled: typeof globalThis.fetch = async () => {
    throw new Error('validate-jurisdiction-zoning: the network must not be touched here');
  };
  const alwaysFails: typeof globalThis.fetch = async () => new Response('nope', { status: 503 });
  const alwaysAnswers: typeof globalThis.fetch = async () =>
    new Response(JSON.stringify([{ lat: '40.7268', lon: '-73.6343', display_name: 'Garden City' }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });

  const stored = await withFetch(neverCalled, () =>
    resolveZoningAsync(makeProject(GARDEN_CITY, '', { lat: 40.7268, lng: -73.6343 })));
  ok('stored coordinates are used and the geocoder is NOT called', fetchCalls === 0, `${fetchCalls} fetch call(s)`);
  ok('…and the origin says so', stored.geocodeOrigin === 'stored', stored.geocodeOrigin);

  const geocoded = await withFetch(alwaysAnswers, () => resolveZoningAsync(makeProject(GARDEN_CITY)));
  ok('with no stored coordinates the geocoder IS called', fetchCalls === 1, `${fetchCalls} fetch call(s)`);
  ok('…and the origin says geocoded', geocoded.geocodeOrigin === 'geocoded', geocoded.geocodeOrigin);

  const failed = await withFetch(alwaysFails, () => resolveZoningAsync(makeProject(GARDEN_CITY)));
  ok('a silent geocode failure is reported as failed, not as "no district"',
    failed.geocodeOrigin === 'failed', failed.geocodeOrigin);
  ok('a failed lookup still returns NO district (it never invents one)', failed.district === null);

  const unattempted = await withFetch(neverCalled, () => resolveZoningAsync(makeProject(undefined)));
  ok('no address at all → unattempted, and no request made',
    unattempted.geocodeOrigin === 'unattempted' && fetchCalls === 0, `${unattempted.geocodeOrigin}/${fetchCalls}`);

  const rationales = [stored.rationale, geocoded.rationale, failed.rationale, unattempted.rationale];
  ok('all four situations read differently to the contractor',
    new Set(rationales).size === 4, rationales.join(' | '));
  ok('the failure rationale says the lookup did not resolve',
    /did not resolve/i.test(failed.rationale), failed.rationale);

  // Corrupt stored coordinates are not coordinates: fall through to the lookup
  // rather than handing a guess source a point in the middle of nowhere.
  const corrupt = await withFetch(alwaysAnswers, () =>
    resolveZoningAsync(makeProject(GARDEN_CITY, '', { lat: 991, lng: -73.6 })));
  ok('out-of-range stored coordinates are ignored', corrupt.geocodeOrigin === 'geocoded' && fetchCalls === 1,
    `${corrupt.geocodeOrigin}/${fetchCalls}`);
  const nanCoords = await withFetch(alwaysAnswers, () =>
    resolveZoningAsync(makeProject(GARDEN_CITY, '', { lat: Number.NaN, lng: -73.6 })));
  ok('NaN stored coordinates are ignored', nanCoords.geocodeOrigin === 'geocoded');
  // 0,0 IS a place (Gulf of Guinea) — it must NOT be treated as missing.
  const zeroZero = await withFetch(neverCalled, () =>
    resolveZoningAsync(makeProject(GARDEN_CITY, '', { lat: 0, lng: 0 })));
  ok('0,0 is treated as real coordinates, not as absent', zeroZero.geocodeOrigin === 'stored' && fetchCalls === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
