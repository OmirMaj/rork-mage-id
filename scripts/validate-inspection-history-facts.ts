// validate-inspection-history-facts.ts — pins utils/permitInspectionFacts.ts,
// the module that finally reads the contractor's OWN inspection record into a
// prompt and a chip.
//
// WHAT IT PROTECTS
//   • the drift invariant: the headline appears VERBATIM in both promptBlock
//     and chipLabel. groundingFactsFor's whole shape exists for this, and the
//     estimate surface has already been bitten once by a chip counting
//     something the prompt did not (AI-F4).
//   • the sample floor (accuracyReport.ts:8). Below 3 CALLED inspections there
//     is no pattern, no rate, and the model is told so in the prompt itself.
//     "1 of 1 failed" is not a tendency.
//   • the quote rule. An inspector's correction note is reproduced EXACTLY,
//     inside quotation marks, with its date and its permit number, and the
//     model is instructed never to restate one as a code requirement.
//   • the honest empty: 'unknown' when there is no authority, 'none' when
//     there is an authority and no record — never silence, never a soft yes.
//   • the history actually comes off the real encoded column, through the real
//     codec, not a hand-built `inspections` array.
//
// Run: bun run scripts/validate-inspection-history-facts.ts

import {
  inspectionHistoryFactsFor,
  authorityPlaceTokens,
  sameAuthority,
  categoryNarrows,
  inspectionsOnPermit,
  INSPECTION_PATTERN_FLOOR,
} from '../utils/permitInspectionFacts';
import { encodePermitInspectionNotes } from '../utils/permitInspectionHistory';
import { issuingAuthorityForAddress, LOCAL_ADOPTIONS, normalizePlace } from '../utils/codeJurisdiction';
import type { Permit, PermitInspection, PermitType } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, actual: T, expected: T, detail?: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  ok(name, a === b, detail ? `${detail}\n      got ${a}, want ${b}` : `got ${a}, want ${b}`);
}

// THE STRING THE PRODUCT ACTUALLY PRODUCES, never a literal typed here.
// This guard previously hard-coded 'City of Phoenix Planning & Development
// Department' — a name that appears nowhere in the shipped adoption table —
// and was 58/0 green over an authority the app can never emit. The real value
// carries a parenthesised acronym, and that acronym is exactly what broke the
// matcher for eleven of the fifteen seeded cities.
const PHOENIX = issuingAuthorityForAddress({ city: 'Phoenix', state: 'AZ' });
if (!PHOENIX) throw new Error('the seeded Phoenix row is gone — this guard has nothing to test');

function insp(over: Partial<PermitInspection> = {}): PermitInspection {
  return {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Rough electrical',
    scheduledFor: '2026-05-04',
    result: 'failed',
    notes: 'no AFCI on the bedroom circuits, box fill at J-3',
    recordedAt: '2026-05-04T18:00:00.000Z',
    ...over,
  };
}

/** A permit whose history rides in the REAL encoded column, through the REAL
 *  encoder — so this guard exercises the decode path the app uses and not a
 *  convenient shortcut around it. */
function permit(over: {
  id?: string; type?: PermitType; jurisdiction?: string; permitNumber?: string;
  inspections?: PermitInspection[]; appliedDate?: string; approvedDate?: string;
  projectName?: string;
} = {}): Permit {
  const rows = over.inspections ?? [];
  return {
    id: over.id ?? 'p1',
    projectId: 'proj1',
    projectName: over.projectName ?? 'Henderson',
    type: over.type ?? 'electrical',
    permitNumber: over.permitNumber,
    jurisdiction: over.jurisdiction ?? 'City of Phoenix, AZ',
    status: 'inspection_failed',
    appliedDate: over.appliedDate ?? '2026-04-01',
    approvedDate: over.approvedDate,
    inspectionNotes: encodePermitInspectionNotes('', rows),
    fee: 250,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nauthority matching — his free text vs the cited table:');

eq('office words are not place words', authorityPlaceTokens('City of Phoenix, AZ'), ['az', 'phoenix']);
ok('the typed jurisdiction matches the table authority',
  sameAuthority('City of Phoenix, AZ', PHOENIX), PHOENIX);

// THE GUARD THAT DID NOT EXIST. Nothing in scripts/ drove issuingAuthorityForAddress
// alongside sameAuthority, so the matcher was never tested against the data it
// has to match. Every seeded city, crossed with the formats app/permits.tsx
// suggests ("City of Phoenix, AZ") and the plain ones contractors type.
{
  const misses: string[] = [];
  for (const entry of LOCAL_ADOPTIONS) {
    for (const raw of entry.matchCity ?? []) {
      const authority = issuingAuthorityForAddress({ city: raw, state: entry.state });
      if (!authority) { misses.push(`${raw}, ${entry.state}: no authority resolved`); continue; }
      for (const typed of [`${raw}, ${entry.state}`, `City of ${raw}, ${entry.state}`, raw, authority]) {
        if (!sameAuthority(typed, authority)) misses.push(`${JSON.stringify(typed)} ↛ ${authority}`);
      }
    }
  }
  ok('EVERY seeded city matches the authority the app emits, in every format it suggests',
    misses.length === 0, misses.slice(0, 8).join('\n      '));
}
ok('a permit typed by hand and one written by "Add to permits" reach the SAME record',
  sameAuthority('City of Phoenix, AZ', PHOENIX) && sameAuthority(PHOENIX, PHOENIX));
ok('a different city does NOT match', !sameAuthority('City of Mesa, AZ', PHOENIX));
ok('an empty side never matches', !sameAuthority('', PHOENIX) && !sameAuthority(PHOENIX, null));
ok('two offices sharing only stopwords do not match',
  !sameAuthority('City of Mesa Building Safety', 'City of Tempe Building Safety'));

// Same place name, different state. Measured leaks, all three: a same-named
// town, a county reported as its city, and a STATE reported as a city.
ok('a same-named town in another state is NOT this authority',
  !sameAuthority('Phoenix, OR', PHOENIX), 'Phoenix, OR vs ' + PHOENIX);
ok('a county AHJ is not the city AHJ inside it',
  !sameAuthority('Maricopa County', 'Mesa, AZ (Maricopa County)'));
ok('a bare state name is not an office in a city that shares it',
  !sameAuthority('Kansas', 'Kansas City Planning'));
ok('...and the state a contractor typed is honoured even when neither side is a known row',
  !sameAuthority('City of Springfield, IL', 'City of Springfield, MO'));
// An office MAGE has no adoption row for, named two ways. The acronyms are the
// office's branding, not the place, and without stripping them this is two
// different towns. (This is the ONLY thing the tail-strip buys: delete it and
// every seeded-city assertion above stays green — the row lookup carries those.)
ok('two spellings of an UNLISTED office are still one office',
  sameAuthority('City of Gilbert Development Services (DSD)', 'Town of Gilbert Building Safety (BSD)'));
{
  // localEntryFor REFUSES an ambiguous place rather than guessing at one. That
  // refusal is dormant today because no two seeded rows answer to the same
  // state-less place name — this pins that precondition, so adding a second
  // Springfield lights up here instead of silently resolving to whichever row
  // is listed first.
  const collisions: string[] = [];
  for (const e of LOCAL_ADOPTIONS) {
    for (const raw of [...(e.matchCity ?? []), ...(e.matchCounty ?? [])]) {
      const hits = LOCAL_ADOPTIONS.filter((o) =>
        [...(o.matchCity ?? []), ...(o.matchCounty ?? [])].some((n) => normalizePlace(n) === normalizePlace(raw)));
      if (hits.length > 1) collisions.push(`${raw}: ${hits.map((h) => h.name).join(' / ')}`);
    }
  }
  ok('no two seeded rows answer to the same state-less place name',
    collisions.length === 0, collisions.slice(0, 5).join('\n      '));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe honest empties:');

{
  const g = inspectionHistoryFactsFor([permit()], null, 'electrical');
  eq('no authority → kind unknown', g.kind, 'unknown');
  eq('...and nothing is counted', [g.called, g.matched, g.quotes.length], [0, 0, 0]);
  ok('...and the model is TOLD not to claim a history',
    /Do not claim anything about what his inspectors have flagged/.test(g.promptBlock));
  ok('...and it is not silence: the chip says so',
    g.chipLabel.length > 20 && /no issuing authority/i.test(g.chipLabel));
}
{
  const g = inspectionHistoryFactsFor([], PHOENIX, 'electrical');
  eq('an authority with no permits → kind none', g.kind, 'none');
  eq('...not grounded', g.grounded, false);
  ok('...and the model is told to say nothing rather than invent a tendency',
    /inventing a tendency for him is worse/.test(g.promptBlock));
}
{
  // The permit is in the record but the trade is not. Saying "no record" would
  // be true-ish and useless; the count of what IS there is the honest answer.
  const g = inspectionHistoryFactsFor(
    [permit({ type: 'plumbing', inspections: [insp({ name: 'Water service', result: 'passed', notes: undefined })] })],
    PHOENIX, 'electrical');
  eq('a record with no rows in this trade → none', g.kind, 'none');
  ok('...but it still says how much IS on file there',
    /1 inspection on file there, none of them electrical/.test(g.headline), g.headline);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe drift invariant — one headline, both surfaces:');

const oneFail = [permit({ permitNumber: 'BP-2026-1188', inspections: [insp()] })];
{
  const g = inspectionHistoryFactsFor(oneFail, PHOENIX, 'electrical');
  ok('the chip carries the headline VERBATIM', g.chipLabel.startsWith(g.headline),
    `headline=${JSON.stringify(g.headline)} chip=${JSON.stringify(g.chipLabel)}`);
  ok('the prompt carries the same headline VERBATIM', g.promptBlock.includes(g.headline));
  ok('the counts in the headline are the counts in the object',
    g.headline.includes(`${g.called} electrical inspection${g.called === 1 ? '' : 's'} called`)
    && g.headline.includes(`${g.failed} failed`), g.headline);
  // Caught by reading the REAL output of the shipped function: the headline
  // read "1 electrical inspections called". A record that cannot count to one
  // is not a record a contractor trusts with the rest of its arithmetic.
  ok('one inspection is not "1 inspections"',
    !/\b1 [a-z /]*inspections\b/.test(g.headline), g.headline);
}
{
  // The chip must not be able to report a number the prompt was never handed.
  const a = inspectionHistoryFactsFor(oneFail, PHOENIX, 'electrical');
  const b = inspectionHistoryFactsFor(
    [permit({ permitNumber: 'BP-2026-1188', inspections: [insp(), insp({ id: 'i2', scheduledFor: '2026-06-11', result: 'passed', notes: undefined })] })],
    PHOENIX, 'electrical');
  ok('a new inspection changes the cache key', a.cacheKey !== b.cacheKey,
    'a stale cached answer would be shown under a chip describing a newer record');
}
{
  // THE COLLISION THAT WAS SHIPPING. The key was `insp:<kind>:<place>:<cat>:
  // <called>:<failed>` — no digest of the NOTES. Two records identical in
  // counts but carrying different inspector notes produced one key while their
  // prompts differed, so a Code Check answer reasoned over note A was served
  // beneath a result chip quoting note B verbatim: the exact chip/prompt drift
  // the one-renderer design exists to prevent. Only one cacheKey assertion
  // existed and it added an inspection, which changes the counts.
  const three = (note: string) => inspectionHistoryFactsFor([permit({
    permitNumber: 'BP-1', inspections: [
      insp({ id: '1', name: 'Rough electrical', result: 'failed', notes: note }),
      insp({ id: '2', name: 'Service panel', result: 'passed', notes: undefined }),
      insp({ id: '3', name: 'Electrical final', result: 'passed', notes: undefined }),
    ] })], PHOENIX, 'electrical');
  const a2 = three('no AFCI on the bedroom circuits');
  const b2 = three('ALL panel bonding wrong, service must be re-pulled');
  eq('the two records really are identical in counts', [a2.called, a2.failed], [b2.called, b2.failed]);
  ok('...their prompts differ', a2.promptBlock !== b2.promptBlock);
  ok('two records differing ONLY in the inspector\'s words get different cache keys',
    a2.cacheKey !== b2.cacheKey, `${a2.cacheKey} === ${b2.cacheKey}`);
  ok('...and an inspector CORRECTING a note changes it too',
    three('no AFCI on the bedroom circuits').cacheKey !== three('no AFCI on the bedroom circuits.').cacheKey);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\nthe sample floor (n < ${INSPECTION_PATTERN_FLOOR} is not a pattern):`);

{
  const g = inspectionHistoryFactsFor(oneFail, PHOENIX, 'electrical');
  eq('1 called → kind thin', g.kind, 'thin');
  eq('...and a pattern is NOT allowed', g.patternAllowed, false);
  eq('...counts are exact', [g.called, g.failed], [1, 0 + 1]);
  ok('...the prompt forbids a tendency in so many words',
    /Do NOT describe a tendency, a pass rate, a habit/.test(g.promptBlock));
  ok('...the chip says it is too few', /Too few to call a pattern/.test(g.chipLabel), g.chipLabel);
  ok('...but the note is STILL shown — suppression is of the claim, not the evidence',
    g.quotes.length === 1);
}
{
  // THREE DIFFERENT ITEMS. The fixture this replaced was three rows all named
  // "Rough electrical" on ONE permit — one defect and its two re-inspections —
  // and it asserted kind 'record'. The guard encoded the bug it was written to
  // prevent: a single failure was licensing a stated 67% failure rate.
  const rows = [
    insp({ id: 'a', name: 'Rough electrical', scheduledFor: '2026-05-04', result: 'failed' }),
    insp({ id: 'b', name: 'Service panel', scheduledFor: '2026-05-18', result: 'passed', notes: undefined }),
    insp({ id: 'c', name: 'Electrical final', scheduledFor: '2026-06-02', result: 'passed', notes: undefined }),
  ];
  const g = inspectionHistoryFactsFor([permit({ permitNumber: 'BP-2026-1188', inspections: rows })], PHOENIX, 'electrical');
  ok('three inspections ARE "3 inspections"', /3 electrical inspections called/.test(g.headline), g.headline);
  eq(`${INSPECTION_PATTERN_FLOOR} DISTINCT called → kind record`, g.kind, 'record');
  eq('...a pattern IS allowed', g.patternAllowed, true);
  eq('...counts are exact', [g.called, g.distinctCalled, g.failed], [3, 3, 1]);
  ok('...the "too few" sentence is GONE', !/Too few to call a pattern/.test(g.chipLabel), g.chipLabel);
  ok('...and the counts are still scoped to HIM and THIS office',
    /not the jurisdiction generally, and not any other contractor/.test(g.promptBlock));
}
{
  // ONE defect, re-inspected twice, then passed. Three ROWS, one ITEM. This is
  // precisely the evidence the floor exists to refuse, and counting rows let it
  // cross the floor and drop THIN_INSTRUCTION.
  const rows = [
    insp({ id: '1', scheduledFor: '2026-05-04', result: 'failed', notes: 'no AFCI on the bedroom circuits' }),
    insp({ id: '2', scheduledFor: '2026-05-11', result: 'failed', notes: 'AFCI still missing' }),
    insp({ id: '3', scheduledFor: '2026-05-18', result: 'passed', notes: undefined }),
  ];
  const g = inspectionHistoryFactsFor([permit({ permitNumber: 'BP-2026-1188', inspections: rows })], PHOENIX, 'electrical');
  eq('a failure and its two re-inspections are ONE item, not a pattern', g.kind, 'thin');
  eq('...rows are still counted honestly', [g.called, g.failed], [3, 2]);
  eq('...but distinct items are what the floor sees', g.distinctCalled, 1);
  eq('...and no pattern is allowed', g.patternAllowed, false);
  ok('...the model is still forbidden a rate',
    /Do NOT describe a tendency, a pass rate, a habit/.test(g.promptBlock));
  ok('...and is NOT told it may state the counts as counts',
    !/You may state the counts above as counts/.test(g.promptBlock));
  ok('...the chip says how many are re-inspections, in the string the prompt also carries',
    /1 distinct item, 2 re-inspections/.test(g.chipLabel), g.chipLabel);
  ok('...and the prompt says it too', /re-inspections of an item already counted/.test(g.promptBlock));
}
{
  // Same three-row shape, but on three DIFFERENT permits: three real items.
  const g = inspectionHistoryFactsFor([
    permit({ id: 'x1', permitNumber: 'X-1', inspections: [insp({ id: '1', result: 'failed' })] }),
    permit({ id: 'x2', permitNumber: 'X-2', inspections: [insp({ id: '2', result: 'passed', notes: undefined })] }),
    permit({ id: 'x3', permitNumber: 'X-3', inspections: [insp({ id: '3', result: 'passed', notes: undefined })] }),
  ], PHOENIX, 'electrical');
  eq('the same row name on three different permits is three items', g.distinctCalled, 3);
  eq('...and that IS a record', g.kind, 'record');
}
{
  // A scheduled visit has no verdict. Counting it would let three future
  // bookings unlock a "pattern" that has never happened.
  const rows = [
    insp({ id: 'a', result: 'scheduled', notes: undefined }),
    insp({ id: 'b', result: 'scheduled', notes: undefined }),
    insp({ id: 'c', result: 'scheduled', notes: undefined }),
    insp({ id: 'd', result: 'cancelled', notes: undefined }),
  ];
  const g = inspectionHistoryFactsFor([permit({ inspections: rows })], PHOENIX, 'electrical');
  eq('four bookings with no verdict are not a record', g.kind, 'none');
  eq('...matched counts them, called does not', [g.matched, g.called], [4, 0]);
  // The suppression always worked; the SENTENCE it emitted did not. All four
  // rows ARE electrical, and it said "none of them electrical" — a trade
  // composition it never computed, asserted about his own file.
  ok('...and it does not claim a trade composition it never measured',
    !/none of them electrical/.test(g.headline), g.headline);
  ok('...it states what WAS measured instead',
    /4 electrical inspections on file with .+, none called yet \(3 scheduled, 1 cancelled\)/.test(g.headline),
    g.headline);
  ok('...the chip carries that same sentence verbatim', g.chipLabel.startsWith(g.headline));
}
{
  // "none of them <category>" is only true when nothing matched the trade.
  const g = inspectionHistoryFactsFor(
    [permit({ type: 'plumbing', inspections: [insp({ name: 'Water service', result: 'scheduled', notes: undefined })] })],
    PHOENIX, 'electrical');
  ok('the trade-composition sentence survives where it is actually true',
    /1 inspection on file there, none of them electrical/.test(g.headline), g.headline);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe inspector\'s own words — quoted, never paraphrased:');

{
  const g = inspectionHistoryFactsFor(oneFail, PHOENIX, 'electrical');
  const line = g.quotes[0]?.line ?? '';
  ok('the note appears EXACTLY as written, inside quotation marks',
    line.includes('"no AFCI on the bedroom circuits, box fill at J-3"'), line);
  ok('...with the date', line.includes('2026-05-04'), line);
  ok('...with the permit number', line.includes('permit BP-2026-1188'), line);
  ok('...and the verbatim line is what reaches the model too', g.promptBlock.includes(line));
  ok('the model is forbidden from restating a note as a code requirement',
    /NEVER restate an inspector's correction note as a code requirement/.test(g.promptBlock));
}
{
  const g = inspectionHistoryFactsFor([permit({ inspections: [insp()] })], PHOENIX, 'electrical');
  const line = g.quotes[0]?.line ?? '';
  ok('with no permit number the row names the permit TYPE, never prints undefined',
    line.includes('on the electrical permit') && !/undefined/.test(line), line);
}
{
  const g = inspectionHistoryFactsFor(
    [permit({ inspections: [insp({ id: 'x', inspectorName: 'M. Ruiz' })] })], PHOENIX, 'electrical');
  ok('a named inspector is named', /Inspector M\. Ruiz failed/.test(g.quotes[0]?.line ?? ''), g.quotes[0]?.line);
}
{
  const rows = [
    insp({ id: 'p1', scheduledFor: '2026-06-01', result: 'passed', notes: 'clean' }),
    insp({ id: 'p2', scheduledFor: '2026-06-02', result: 'passed', notes: 'clean' }),
    insp({ id: 'f1', scheduledFor: '2026-01-09', result: 'failed', notes: 'grounding electrode conductor undersized' }),
  ];
  const g = inspectionHistoryFactsFor([permit({ inspections: rows })], PHOENIX, 'electrical');
  eq('the FAILURE is quoted first, however old — it is the whole value of the record',
    g.quotes[0]?.result, 'failed');
  ok('...and it is the right failure',
    (g.quotes[0]?.line ?? '').includes('grounding electrode conductor undersized'));
}
{
  const g = inspectionHistoryFactsFor(
    [permit({ inspections: [insp({ notes: undefined })] })], PHOENIX, 'electrical');
  eq('a failure with no note yields no quote', g.quotes.length, 0);
  ok('...and the absence is stated rather than glossed over',
    /None of the failures carry a correction note/.test(g.promptBlock));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nscoping — the right rows, from the right office:');

{
  const rows = [insp({ id: 'e', name: 'Rough electrical', result: 'failed' })];
  const g = inspectionHistoryFactsFor(
    [permit({ inspections: rows }), permit({ id: 'p2', jurisdiction: 'City of Mesa, AZ', inspections: [insp({ id: 'm', result: 'failed' })] })],
    PHOENIX, 'electrical');
  eq('another city\'s inspections are not his record HERE', g.called, 1);
}
{
  const plumbing = permit({ id: 'pp', type: 'plumbing', inspections: [insp({ id: 'w', name: 'Water service', result: 'failed', notes: 'no backflow preventer' })] });
  const electrical = permit({ id: 'pe', type: 'electrical', inspections: [insp({ id: 'e', result: 'failed' })] });
  const elec = inspectionHistoryFactsFor([plumbing, electrical], PHOENIX, 'electrical');
  eq('an electrical question does not count the plumbing failure', elec.called, 1);
  ok('...and does not quote it', !(elec.quotes[0]?.line ?? '').includes('backflow'));
  const all = inspectionHistoryFactsFor([plumbing, electrical], PHOENIX, null);
  eq('no category counts everything', all.called, 2);
}
{
  // 'residential' describes the building, not the trade. Narrowing on it would
  // silently drop every relevant row.
  ok('residential does not narrow', !categoryNarrows('residential'));
  ok('commercial does not narrow', !categoryNarrows('commercial'));
  ok('electrical does narrow', categoryNarrows('electrical'));
  const g = inspectionHistoryFactsFor(
    [permit({ type: 'plumbing', inspections: [insp({ id: 'w', name: 'Water service', result: 'passed', notes: undefined })] })],
    PHOENIX, 'residential');
  eq('a residential question sees the plumbing row', g.called, 1);
}
{
  // The row is on the electrical permit but the GC named it "Rough-in".
  const g = inspectionHistoryFactsFor(
    [permit({ type: 'electrical', inspections: [insp({ id: 'r', name: 'Rough-in', result: 'failed' })] })],
    PHOENIX, 'electrical');
  eq('the PERMIT type matches even when the row name does not', g.called, 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nwhose job, whose town — the record spans both:');

{
  // The record is every job with this authority. A quote citing only a permit
  // number let a defect from Maple St be reasoned about as this job's.
  const g = inspectionHistoryFactsFor([
    permit({ id: 'a', projectName: 'Maple St', permitNumber: 'A-1', inspections: [insp({ inspectorName: 'M. Ruiz' })] }),
    permit({ id: 'b', projectName: 'Oak Ave', permitNumber: 'B-1', inspections: [insp({ id: 'z', result: 'passed', notes: 'clean' })] }),
  ], PHOENIX, 'electrical');
  ok('a quote names the JOB it came from, not only the permit number',
    (g.quotes[0]?.line ?? '').includes('permit A-1 (Maple St)'), g.quotes[0]?.line);
  ok('...and the prompt says the record spans more than one job',
    /These come from 2 of your jobs with this authority \(Maple St, Oak Ave\)/.test(g.promptBlock), g.promptBlock);
  ok('...and the chip says so too — the contractor sees what the model sees',
    /Across 2 of your jobs/.test(g.chipLabel), g.chipLabel);
  const one = inspectionHistoryFactsFor([permit({ projectName: 'Maple St', permitNumber: 'A-1', inspections: [insp()] })], PHOENIX, 'electrical');
  ok('one job says nothing about spanning jobs', !/of your jobs/.test(one.chipLabel), one.chipLabel);
}
{
  // A match made on bare place tokens may be a same-named town. Keeping the
  // wider record is the deliberate trade; hiding that it was widened is not.
  const g = inspectionHistoryFactsFor([
    permit({ id: 's1', jurisdiction: 'City of Springfield, IL', permitNumber: 'IL-1', inspections: [insp({ id: 'a', result: 'failed', notes: 'IL job: no AFCI' })] }),
    permit({ id: 's2', jurisdiction: 'Springfield', permitNumber: 'MO-1', inspections: [insp({ id: 'b', result: 'passed', notes: undefined })] }),
  ], 'City of Springfield Building & Zoning Department', 'electrical');
  ok('a place-name match is disclosed in the chip',
    /matched by place name — one may be a same-named town/.test(g.chipLabel), g.chipLabel);
  ok('...in the same words the prompt carries',
    /matched by place name rather than by an authority MAGE has a record for/.test(g.promptBlock));
  const known = inspectionHistoryFactsFor([permit({ inspections: [insp()] })], PHOENIX, 'electrical');
  ok('a record matched on a KNOWN row says no such thing',
    !/matched by place name/.test(known.chipLabel), known.chipLabel);
}
{
  // Nine notes, four shown. Silence about the five dropped is a truncation of
  // an inspector's correction with nothing on screen admitting it.
  const rows = Array.from({ length: 9 }, (_, i) =>
    insp({ id: `q${i}`, name: `Item ${i}`, scheduledFor: `2026-0${i + 1}-01`, result: 'failed', notes: `note ${i}` }));
  const g = inspectionHistoryFactsFor([permit({ permitNumber: 'N-1', inspections: rows })], PHOENIX, 'electrical');
  eq('the block stays a block', g.quotes.length, 4);
  ok('...and says how many notes it is NOT showing',
    /the 4 most recent of 9 notes, verbatim/.test(g.promptBlock), g.promptBlock);
  ok('...and shows the most RECENT ones, whatever order the rows arrived in',
    (g.quotes[0]?.date ?? '') === '2026-09-01' && (g.quotes[3]?.date ?? '') === '2026-06-01',
    g.quotes.map((q) => q.date).join(','));
  const four = inspectionHistoryFactsFor([permit({ permitNumber: 'N-1', inspections: rows.slice(0, 4) })], PHOENIX, 'electrical');
  ok('nothing is claimed to be hidden when nothing is',
    !/most recent of/.test(four.promptBlock));
}
{
  // The fallback path (a caller that hydrated permit.inspections) must be
  // sorted too, or the note the cap drops can be the newest one.
  const rows = [
    insp({ id: 'old', name: 'A', scheduledFor: '2026-01-01', result: 'failed', notes: 'oldest' }),
    insp({ id: 'new', name: 'B', scheduledFor: '2026-08-01', result: 'failed', notes: 'newest' }),
  ];
  const p: Permit = { ...permit(), inspectionNotes: 'plain note', inspections: rows };
  eq('the hydrated fallback comes back newest first', inspectionsOnPermit(p)[0]?.id, 'new');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe history really comes off the encoded column:');

{
  const p = permit({ inspections: [insp()] });
  ok('the raw column is machine text, not display text',
    (p.inspectionNotes ?? '').includes('[[mage:inspections]]'));
  eq('and the module decodes it', inspectionsOnPermit(p).length, 1);
  const g = inspectionHistoryFactsFor([p], PHOENIX, 'electrical');
  ok('nothing prints the sentinel at the contractor',
    !g.chipLabel.includes('[[mage:') && !g.promptBlock.includes('[[mage:'));
}
{
  // A permit written by a seeder or the Supabase console: plain notes, no
  // block. It must read as "no history", never as a parse crash.
  const p: Permit = { ...permit(), inspectionNotes: 'Corrections due Friday.' };
  eq('a plain note decodes to no history', inspectionsOnPermit(p).length, 0);
  eq('...and the module says none', inspectionHistoryFactsFor([p], PHOENIX, null).kind, 'none');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
