// scripts/validate-code-jurisdiction.ts — the guard on the code-adoption table
// and the AHJ resolver behind Code Check's address field.
//
// WHY THIS EXISTS
//   utils/codeJurisdiction.ts tells a contractor which building department
//   governs their jobsite and which code edition that department adopted. A
//   wrong row there sends someone to build to the wrong edition, which is a
//   failed inspection at best. So the table is only allowed to contain rows a
//   human verified against the authority's own page, and this script enforces
//   the parts of that promise a machine can check:
//
//     • every row cites a source URL and records WHEN it was checked
//     • a row older than a year fails — code cycles turn over, and a stale
//       row is exactly the kind of confident-but-wrong fact this repo keeps
//       having to delete (recall had Denver a full cycle out of date)
//     • resolution is deterministic and case-insensitive
//     • a city NEVER answers for a same-named city in another state
//     • 'unknown' always carries a reason a human can read
//     • the prompt text and the chip text both come from groundingFactsFor,
//       so they cannot drift apart (the AI-F4 failure mode)
//
// Same shape as scripts/validate-ai-honesty.ts: pure-function assertions plus
// source-text pins on the screen the pure functions cannot reach.

import { readFileSync } from 'node:fs';
import { departmentFor } from '../utils/codeJurisdiction';
import { sameAuthority } from '../utils/permitInspectionFacts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ALL_AMENDMENTS,
  HAND_VERIFIED_AMENDMENTS,
  RUNG_INDEX,
  bestAmendmentFor,
  citationEvidenceFor,
  familyFromCitedCode,
  iccViewerUrl,
  normalizeSection,
  rungSummaryLine,
  rungTally,
  viewerLinkForCitation,
  viewerLinksFor,
  weakestRung,
  type StateAmendment,
} from '../utils/codeAmendments';
import {
  EMPTY_JOBSITE_ADDRESS,
  LOCAL_ADOPTIONS,
  STATE_ADOPTIONS,
  codeClaimIds,
  codeLine,
  codeReceiptKey,
  codesSummary,
  groundingFactsFor,
  iccVolumeVerdict,
  issuingAuthorityForAddress,
  jobsiteAddressForProject,
  normalizePlace,
  normalizeState,
  resolveCodeJurisdiction,
  viewerUrlToOpen,
  sameJobsiteAddress,
  splitLocationText,
  type CodeVerdict,
  type LocalAdoption,
  type StateAdoption,
} from '../utils/codeJurisdiction';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const ALL: readonly (StateAdoption | LocalAdoption)[] = [...STATE_ADOPTIONS, ...LOCAL_ADOPTIONS];
const labelOf = (e: StateAdoption | LocalAdoption) =>
  'name' in e ? `${e.name}, ${e.state}` : `${(e as StateAdoption).stateName}`;

// ─────────────────────────────────────────────────────────────────────
console.log('\ncitations — every row is sourced and dated:');
// ─────────────────────────────────────────────────────────────────────

ok('the table is not empty', ALL.length > 0);

for (const e of ALL) {
  const who = labelOf(e);
  ok(`${who}: sourceUrl is a non-empty https URL`,
    typeof e.sourceUrl === 'string' && e.sourceUrl.trim().length > 0 && /^https:\/\/\S+$/.test(e.sourceUrl));
  ok(`${who}: authorityName is a real, non-generic office name`,
    typeof e.authorityName === 'string' && e.authorityName.trim().length > 3 &&
    !/^(the )?(local )?(building (department|dept)|ahj|authority)$/i.test(e.authorityName.trim()));
  ok(`${who}: checkedOn is an ISO date`, /^\d{4}-\d{2}-\d{2}$/.test(e.checkedOn) && Number.isFinite(Date.parse(e.checkedOn)));
  ok(`${who}: declares at least one adopted code, each with a family and an edition`,
    e.codes.length > 0 && e.codes.every((c) => !!c.family && typeof c.edition === 'string' && c.edition.trim().length > 0));
  if (e.noteSourceUrl !== undefined) {
    ok(`${who}: noteSourceUrl (when present) is a non-empty https URL`, /^https:\/\/\S+$/.test(e.noteSourceUrl));
  }
}

{
  // A row older than a year is not trustworthy: the I-Codes move on a 3-year
  // cycle and big cities re-adopt inside it. Re-verify or delete.
  const now = Date.now();
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const stale = ALL.filter((e) => now - Date.parse(e.checkedOn) > YEAR_MS);
  ok(`no row was checked more than a year ago${stale.length ? ` (stale: ${stale.map(labelOf).join(', ')})` : ''}`, stale.length === 0);
  const future = ALL.filter((e) => Date.parse(e.checkedOn) - now > 24 * 60 * 60 * 1000);
  ok('no row claims to have been checked in the future', future.length === 0);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\nthe verification receipt — every claim was read off a page:');
// ─────────────────────────────────────────────────────────────────────
{
  // THE HOLE THIS CLOSES. Everything above is shape: a URL that parses, a date
  // that is recent, a family with an edition string. None of it has ever
  // OPENED the page, so a row with a real, freshly-dated citation and a
  // recalled edition sailed through the whole suite — which is exactly how
  // "Dallas: NEC 2023" shipped against a page that says 2020, and how
  // "Minnesota: NEC 2020" shipped against a rule that says 2023.
  //
  // scripts/verify-code-sources.ts does the reading; it needs the network, so
  // it cannot run here. What it CAN do is leave evidence behind. It writes
  // utils/codeJurisdiction.receipt.json — one entry per row, one verdict per
  // claimed code, each with the sentence that confirmed it — and this block
  // refuses to pass a table the receipt does not cover.
  //
  // The receipt records each claim as `FAMILY|edition|the URL it was checked
  // against`, so it is not enough for a jurisdiction to merely APPEAR in the
  // file: change an edition, add a family, or re-point a citation, and the
  // claim no longer matches what was verified and this fails until somebody
  // re-runs the fetcher. That is the point — you cannot alter what this table
  // asserts about a building code without opening the page that proves it.
  interface ReceiptCode { claimId?: unknown; verdict?: unknown; evidence?: unknown }
  interface ReceiptRow {
    label?: unknown; verifiedOn?: unknown; checkedOn?: unknown;
    sourceUrl?: unknown; codes?: ReceiptCode[];
  }

  let receipt: Record<string, ReceiptRow> | null = null;
  let readErr = '';
  try {
    const parsed = JSON.parse(src('utils/codeJurisdiction.receipt.json')) as { rows?: unknown };
    if (parsed && typeof parsed === 'object' && parsed.rows && typeof parsed.rows === 'object') {
      receipt = parsed.rows as Record<string, ReceiptRow>;
    } else {
      readErr = 'the file has no `rows` object';
    }
  } catch (err) {
    readErr = err instanceof Error ? err.message : String(err);
  }

  ok(`utils/codeJurisdiction.receipt.json exists and parses${readErr ? ` (${readErr})` : ''}`, receipt !== null);

  if (receipt) {
    const rows = receipt;
    const now = Date.now();
    const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

    const missing: string[] = [];
    const drifted: string[] = [];
    const notConfirmed: string[] = [];
    const staleReceipt: string[] = [];

    for (const e of ALL) {
      const who = labelOf(e);
      const entry = rows[codeReceiptKey(e)];
      if (!entry) { missing.push(who); continue; }

      // The row must be verified AS IT STANDS: same check date, same primary
      // citation, same claims in the same order.
      const claims = codeClaimIds(e);
      const recorded = (entry.codes ?? []).map((c) => String(c.claimId ?? ''));
      if (entry.checkedOn !== e.checkedOn) {
        drifted.push(`${who}: checkedOn ${String(entry.checkedOn)} verified, table now says ${e.checkedOn}`);
      } else if (entry.sourceUrl !== e.sourceUrl) {
        drifted.push(`${who}: a different sourceUrl was verified`);
      } else if (recorded.length !== claims.length || claims.some((c, i) => c !== recorded[i])) {
        const added = claims.filter((c) => !recorded.includes(c));
        drifted.push(`${who}: ${added.length ? `unverified claim(s) ${added.join(', ')}` : 'the verified claim list no longer matches'}`);
      }

      for (const c of entry.codes ?? []) {
        const verdict = String(c.verdict ?? '') as CodeVerdict;
        if (verdict !== 'confirmed') notConfirmed.push(`${who}: ${String(c.claimId ?? '?')} → ${verdict || 'no verdict'}`);
      }

      const when = Date.parse(String(entry.verifiedOn ?? ''));
      if (!Number.isFinite(when) || now - when > YEAR_MS || when - now > 24 * 60 * 60 * 1000) {
        staleReceipt.push(`${who} (${String(entry.verifiedOn)})`);
      }
    }

    ok(`every row has a receipt${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`, missing.length === 0);
    ok(`no row changed since it was verified${drifted.length ? ` — ${drifted.join('; ')}` : ''}`, drifted.length === 0);
    // A MISMATCH receipt is the Dallas bug caught red-handed; an unconfirmed
    // one is a claim whose own citation does not state it. Neither ships.
    ok(`every verified claim came back 'confirmed'${notConfirmed.length ? ` — ${notConfirmed.join('; ')}` : ''}`, notConfirmed.length === 0);
    ok(`no receipt is older than a year${staleReceipt.length ? ` (stale: ${staleReceipt.join(', ')})` : ''}`, staleReceipt.length === 0);

    const live = new Set(ALL.map(codeReceiptKey));
    const orphans = Object.keys(rows).filter((k) => !live.has(k));
    ok(`the receipt has no entry for a row that no longer exists${orphans.length ? ` (${orphans.join(', ')})` : ''}`, orphans.length === 0);

    // Evidence is the difference between a receipt and a rubber stamp: it is
    // what lets a human re-read the sentence that confirmed a claim.
    const noEvidence = Object.entries(rows)
      .filter(([, r]) => (r.codes ?? []).some((c) => typeof c.evidence !== 'string' || !c.evidence.trim()))
      .map(([k]) => k);
    ok(`every receipted claim quotes the text that confirmed it${noEvidence.length ? ` (bare: ${noEvidence.join(', ')})` : ''}`, noEvidence.length === 0);
  }
}

{
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const e of LOCAL_ADOPTIONS) {
    const k = `${normalizePlace(e.name)}|${e.state}`;
    if (seen.has(k)) dupes.push(k);
    seen.add(k);
  }
  ok(`no duplicate city+state row${dupes.length ? ` (${dupes.join(', ')})` : ''}`, dupes.length === 0);
}
{
  const states = STATE_ADOPTIONS.map((e) => e.state);
  ok('no duplicate state row', new Set(states).size === states.length);
}
{
  // Two DIFFERENT rows in the same state claiming the same name would make
  // resolution order-dependent — i.e. not deterministic. City names and county
  // names are separate namespaces (Queens and San Francisco are legitimately
  // both, for the same row), and a row repeating a name against itself is a
  // harmless alias, not a clash.
  const clashes: string[] = [];
  // postalCity is the CITY namespace too: it is matched against the same
  // address field as matchCity.
  const namespaces = {
    matchCity: (e: (typeof LOCAL_ADOPTIONS)[number]) => [...(e.matchCity ?? []), ...(e.postalCity ?? [])],
    matchCounty: (e: (typeof LOCAL_ADOPTIONS)[number]) => [...(e.matchCounty ?? [])],
  };
  for (const field of ['matchCity', 'matchCounty'] as const) {
    const owner = new Map<string, string>();
    for (const e of LOCAL_ADOPTIONS) {
      for (const m of namespaces[field](e)) {
        const k = `${e.state}|${normalizePlace(m)}`;
        const prev = owner.get(k);
        if (prev !== undefined && prev !== e.name) clashes.push(`${field} ${k}: ${prev} vs ${e.name}`);
        owner.set(k, e.name);
      }
    }
  }
  ok(`no two rows in one state claim the same match name${clashes.length ? ` (${clashes.join(', ')})` : ''}`, clashes.length === 0);
}
ok('every local row declares at least one way to match it', LOCAL_ADOPTIONS.every((e) => (e.matchCity?.length ?? 0) + (e.matchCounty?.length ?? 0) > 0));
ok('every row uses a two-letter USPS state code', ALL.every((e) => /^[A-Z]{2}$/.test(e.state)));
ok('every local row names a state that normalizeState round-trips', LOCAL_ADOPTIONS.every((e) => normalizeState(e.state) === e.state));

// ─────────────────────────────────────────────────────────────────────
console.log('\nnormalizeState:');
// ─────────────────────────────────────────────────────────────────────
ok('two-letter code passes through, any case', normalizeState('ny') === 'NY' && normalizeState('NY') === 'NY');
ok('full name resolves', normalizeState('New York') === 'NY' && normalizeState('washington') === 'WA');
ok('whitespace and punctuation tolerant', normalizeState('  new   york  ') === 'NY' && normalizeState('Calif.') === '');
ok('a non-state is rejected rather than coerced', normalizeState('Ontario') === '' && normalizeState('XX') === '' && normalizeState('') === '');

// ─────────────────────────────────────────────────────────────────────
console.log('\nresolveCodeJurisdiction — determinism, case, and the state boundary:');
// ─────────────────────────────────────────────────────────────────────
{
  const a = resolveCodeJurisdiction({ city: 'Brooklyn', state: 'NY' });
  ok('Brooklyn NY resolves to a city-level authority', a.kind === 'city');
  ok('… and it is the NYC DOB (a borough is still NYC)', a.kind === 'city' && /Department of Buildings/i.test(a.entry.authorityName));
  const b = resolveCodeJurisdiction({ city: '  bRoOkLyN ', state: ' new york ' });
  ok('resolution is case- and whitespace-insensitive and deterministic', JSON.stringify(a) === JSON.stringify(b));
}
ok('the same call twice returns the same thing (no hidden state)', (() => {
  const q = { city: 'Seattle', state: 'WA' };
  return JSON.stringify(resolveCodeJurisdiction(q)) === JSON.stringify(resolveCodeJurisdiction(q));
})());

{
  // THE cross-state test. There are Springfields everywhere; a city row must
  // never answer for a same-named city in another state.
  const nyCity = LOCAL_ADOPTIONS.find((e) => e.state === 'NY');
  const claimed = nyCity?.matchCity?.[0] ?? 'new york';
  const wrongState = resolveCodeJurisdiction({ city: claimed, state: 'TX' });
  ok(`"${claimed}" in TX does NOT return the NY authority`,
    wrongState.kind !== 'city' || wrongState.entry.state === 'TX');
  ok('Phoenix, NY does not get the Phoenix, AZ authority (there is a Phoenix in NY)', (() => {
    const r = resolveCodeJurisdiction({ city: 'Phoenix', state: 'NY' });
    return r.kind !== 'city' || r.entry.state === 'NY';
  })());
  ok('every city row is unreachable from every OTHER state', LOCAL_ADOPTIONS.every((e) =>
    (e.matchCity ?? []).every((m) =>
      ALL.every((other) => {
        const r = resolveCodeJurisdiction({ city: m, state: other.state });
        return r.kind !== 'city' || r.entry.state === other.state;
      }))));
}

ok('a city with no row falls back to its STATE adoption when one exists', (() => {
  const r = resolveCodeJurisdiction({ city: 'Bakersfield', state: 'CA' });
  return r.kind === 'state' && r.entry.state === 'CA';
})());
ok('a county-keyed row resolves from the county alone, with or without the word "County"', (() => {
  const withWord = resolveCodeJurisdiction({ county: 'Miami-Dade County', state: 'FL' });
  const without = resolveCodeJurisdiction({ county: 'miami-dade', state: 'FL' });
  return withWord.kind === 'city' && without.kind === 'city' && withWord.entry.name === without.entry.name;
})());
ok('a city match beats a county match (the city is the more specific AHJ)', (() => {
  const r = resolveCodeJurisdiction({ city: 'Brooklyn', county: 'Miami-Dade', state: 'NY' });
  return r.kind === 'city' && r.matchedOn === 'city';
})());

// ─────────────────────────────────────────────────────────────────────
console.log('\nthe tristate — Queens postal cities, Nassau, Connecticut, New Jersey:');
// ─────────────────────────────────────────────────────────────────────
{
  // THE QUEENS BUG. A job saved as "Astoria, NY" carries no borough and no
  // county, and it used to resolve to the NEW YORK STATE row: the Uniform Code
  // instead of the NYC Construction Codes, no DOB card, no building record
  // (isNycJobsite reads this resolver). The addresses go through
  // jobsiteAddressForProject exactly as a project's free-text location does.
  const fromText = (location: string) => resolveCodeJurisdiction(jobsiteAddressForProject({ location }));
  const isNyc = (r: ReturnType<typeof resolveCodeJurisdiction>) => r.kind === 'city' && r.entry.name === 'New York City';
  for (const loc of ['Astoria, NY', 'Long Island City, NY', 'Flushing, NY', '31-10 Ditmars Blvd, Astoria NY 11105', 'Jamaica, NY', 'Far Rockaway, NY']) {
    const r = fromText(loc);
    ok(`"${loc}" resolves to New York City`, isNyc(r));
    ok(`"${loc}" gets the DOB department card and names the DOB as issuer`,
      departmentFor(r) !== null && issuingAuthorityForAddress(jobsiteAddressForProject({ location: loc })) === 'New York City Department of Buildings');
  }
  // Nassau places — a hamlet (Levittown), a village (Garden City) and a town
  // (Hempstead) — must NOT become New York City. They are the state row.
  for (const loc of ['Garden City, NY', 'Levittown, NY', 'Hempstead, NY']) {
    const r = fromText(loc);
    ok(`"${loc}" does NOT resolve to New York City`, !isNyc(r));
    ok(`"${loc}" resolves to the New York STATE row`, r.kind === 'state' && r.entry.state === 'NY');
  }
  // The three Queens postal names the source excluded, pinned so nobody adds
  // them back "for completeness": each is also an incorporated Nassau village.
  for (const loc of ['Bellerose, NY', 'Floral Park, NY', 'New Hyde Park, NY']) {
    ok(`"${loc}" does NOT resolve to New York City (it is also a Nassau village)`, !isNyc(fromText(loc)));
  }
  const nyc = LOCAL_ADOPTIONS.find((e) => e.name === 'New York City');
  ok('no NYC match name is a ZIP or a ZIP prefix (110xx is split with Nassau)',
    !!nyc && [...(nyc.matchCity ?? []), ...(nyc.postalCity ?? []), ...(nyc.matchCounty ?? [])].every((m) => !/\d/.test(m)));
  // A postal name is an ADDRESS fact. When the address names a county that is
  // not the row's own, the county wins: SAM files 15 "Far Rockaway" and 2
  // "Rosedale" address points under Nassau.
  for (const city of ['Far Rockaway', 'Rosedale']) {
    const r = resolveCodeJurisdiction({ city, county: 'Nassau County', state: 'NY' });
    ok(`"${city}" with county Nassau is NOT New York City (the county wins over a postal name)`,
      !isNyc(r) && r.kind === 'state' && r.entry.state === 'NY');
  }
  ok('"Astoria" with county Queens is still New York City',
    isNyc(resolveCodeJurisdiction({ city: 'Astoria', county: 'Queens County', state: 'NY' })));
  // LONG ISLAND MUST NOT BECOME THE DOB THROUGH THE PERMIT-RECORD MATCHER.
  // permitInspectionFacts reads matchCity as the permit OFFICE's names, word-set
  // style with "city"/"village" dropped: "long island city" there is any text
  // with "long" and "island" in it. That is why the postal names are
  // postalCity, which that matcher never reads (review 2026-09-26).
  const DOB = 'New York City Department of Buildings';
  for (const j of ['Town of Huntington, Long Island, NY', 'Town of Islip, Long Island, NY', 'Long Island, NY',
    'PSEG Long Island', 'Long Island Power Authority', 'Middle Island, NY',
    'Town of Brookhaven, Middle Island NY', 'Village of Ridgewood', 'Ridgewood Building Dept']) {
    ok(`permit jurisdiction "${j}" is NOT the NYC DOB's inspection record`, !sameAuthority(j, DOB));
  }
  ok('the borough names still fold into the DOB record ("Brooklyn, NY")', sameAuthority('Brooklyn, NY', DOB));
  ok('Queens postal cities do not leak across the state line ("Astoria, OR" is not NYC)',
    !isNyc(fromText('Astoria, OR')) && !isNyc(fromText('Ridgewood, NJ')));

  // NEW YORK OUTSIDE NYC: the permit office is the municipality, never the county.
  const nyState = STATE_ADOPTIONS.find((e) => e.state === 'NY');
  const nyNotes = nyState?.notes ?? '';
  ok('the NY row names all seven suburban counties it governs',
    ['Nassau', 'Suffolk', 'Westchester', 'Rockland', 'Putnam', 'Orange', 'Dutchess'].every((c) => nyNotes.includes(c)));
  ok('the NY row says the permit office is the village, city or town, not the county',
    /village, the city, or the town/.test(nyNotes) && /not the county/.test(nyNotes));

  // CONNECTICUT: a state row, keyed on the state and never on a county.
  const ct = STATE_ADOPTIONS.find((e) => e.state === 'CT');
  ok('Connecticut has a state row, from DAS\'s Office of the State Building Inspector',
    !!ct && /Department of Administrative Services/.test(ct.authorityName) && /State Building Inspector/.test(ct.authorityName));
  const stamford = fromText('Stamford, CT');
  ok('"Stamford, CT" resolves to the Connecticut state row', stamford.kind === 'state' && stamford.entry.state === 'CT');
  const region = resolveCodeJurisdiction({ city: 'Stamford', county: 'Western Connecticut Planning Region', state: 'CT' });
  ok('a Census planning region in the county slot still lands on the Connecticut row',
    region.kind === 'state' && region.entry.state === 'CT');
  const ctCountyKeyed = (rows: readonly { state: string; matchCounty?: readonly string[] }[]) =>
    rows.filter((e) => e.state === 'CT' && (e.matchCounty?.length ?? 0) > 0);
  ok('the CT county-key guard can fail (a synthetic CT row keyed on a county is caught)',
    ctCountyKeyed([{ state: 'CT', matchCounty: ['fairfield'] }, { state: 'NY', matchCounty: ['kings'] }]).length === 1);
  ok('no Connecticut local row is ever keyed on a county (the Census returns planning regions)',
    ctCountyKeyed(LOCAL_ADOPTIONS).length === 0);
  const ctCode = (f: string) => ct?.codes.find((c) => c.family === f);
  ok('CT claims the 2021 IBC as ICC\'s CT volume CTBC2022P1',
    ctCode('IBC')?.edition === '2021' && ctCode('IBC')?.iccVolumeId === 'CTBC2022P1' &&
    ctCode('IBC')?.name === '2022 Connecticut State Building Code - 2021 IBC Portion');
  ok('CT claims the 2021 IRC as ICC\'s CT volume CTRC2022P1',
    ctCode('IRC')?.edition === '2021' && ctCode('IRC')?.iccVolumeId === 'CTRC2022P1' &&
    ctCode('IRC')?.name === '2022 Connecticut State Building Code - 2021 IRC Portion');
  ok('CT claims IECC 2021, IEBC 2021 and NEC 2020, with no model-code link',
    ctCode('IECC')?.edition === '2021' && ctCode('IEBC')?.edition === '2021' && ctCode('NEC')?.edition === '2020' &&
    !ctCode('IECC')?.iccVolumeId && !ctCode('IEBC')?.iccVolumeId);
  const ctNotes = ct?.notes ?? '';
  ok('the CT note says the 2026 code is delayed pending the Regulation Review Committee',
    /delayed/.test(ctNotes) && /Regulation Review Committee/.test(ctNotes) && /which code your permit date falls under/.test(ctNotes));
  ok('the CT note cites DAS only — it never claims the package was rejected',
    !/reject/i.test(ctNotes) && (ct?.noteSourceUrl ?? '').startsWith('https://portal.ct.gov/das/'));

  // NEW JERSEY: its own editions, and no link to the model book in their place.
  const nj = STATE_ADOPTIONS.find((e) => e.state === 'NJ');
  const njCode = (f: string) => nj?.codes.find((c) => c.family === f);
  ok('NJ names the IBC and IRC as the NJ editions',
    /\(NJ edition\)/.test(njCode('IBC')?.name ?? '') && /\(NJ edition\)/.test(njCode('IRC')?.name ?? ''));
  ok('NJ never links the model IBC/IRC under its NJ-edition names (NJBC2024P1/NJRC2024P1 404 today)',
    !njCode('IBC')?.iccVolumeId && !njCode('IRC')?.iccVolumeId &&
    !viewerLinksFor(fromText('Hoboken, NJ')).some((l) => /IBC2024P1|IRC2024P1/.test(l.url)));
  ok('NJ keeps the 17 August 2026 effective date and claims no grace period',
    /17 August 2026/.test(nj?.notes ?? '') && /no grace period/.test(nj?.notes ?? '') &&
    !/grace period (of|until|ends|runs|lasts)/i.test(nj?.notes ?? ''));
}

// ─────────────────────────────────────────────────────────────────────
console.log('\nunknown always carries a reason:');
// ─────────────────────────────────────────────────────────────────────
{
  const cases: [string, ReturnType<typeof resolveCodeJurisdiction>][] = [
    ['no state at all', resolveCodeJurisdiction({ city: 'Springfield' })],
    ['empty everything', resolveCodeJurisdiction({})],
    ['a non-US state', resolveCodeJurisdiction({ city: 'Toronto', state: 'Ontario' })],
    ['a state with no row and no city row', resolveCodeJurisdiction({ city: 'Bozeman', state: 'MT' })],
  ];
  for (const [label, r] of cases) {
    ok(`${label} → kind 'unknown' with a non-empty reason`,
      r.kind === 'unknown' && typeof r.reason === 'string' && r.reason.trim().length > 0);
  }
  ok('the unknown reason is a sentence a contractor can read, not a code', cases.every(([, r]) => r.kind === 'unknown' && /\s/.test(r.reason.trim()) && /[.!]$/.test(r.reason.trim())));
}

// ─────────────────────────────────────────────────────────────────────
console.log('\ngroundingFactsFor — ONE renderer for the prompt and the chip:');
// ─────────────────────────────────────────────────────────────────────
{
  const g = groundingFactsFor(resolveCodeJurisdiction({ city: 'Brooklyn', state: 'NY' }));
  ok('grounded: flagged grounded', g.grounded);
  ok('grounded: the chip names the authority', g.chipLabel.includes('New York City Department of Buildings'));
  ok('grounded: the chip states the date the adoption was checked', /checked \d{4}-\d{2}-\d{2}/.test(g.chipLabel));
  ok('grounded: the chip still admits the code sections are recall', /model recall/i.test(g.chipLabel));
  ok('grounded: the prompt block names the same authority the chip does', g.promptBlock.includes('New York City Department of Buildings'));
  ok('grounded: the prompt block carries the source URL and the check date', g.promptBlock.includes('https://') && g.promptBlock.includes('2026-'));
  ok('grounded: the prompt instructs the model to answer against THAT edition', /answer against THAT/i.test(g.promptBlock));
  ok('grounded: every fact appears in the prompt block verbatim', g.facts.every((f) => g.promptBlock.includes(f)));
  ok('grounded: a cache key that is not the unknown one', g.cacheKey.length > 0 && g.cacheKey !== 'unknown');
}
{
  const g = groundingFactsFor(resolveCodeJurisdiction({ city: 'Bozeman', state: 'MT' }));
  ok('unknown: NOT flagged grounded', !g.grounded);
  ok('unknown: the chip says there is no adoption record', /no adoption record/i.test(g.chipLabel));
  ok('unknown: the chip says the answer is model recall', /model recall/i.test(g.chipLabel));
  ok('unknown: the chip sends them to the local building department', /building department/i.test(g.chipLabel));
  ok('unknown: the chip never claims a lookup happened', !/looked up|lookup of|we checked the code/i.test(g.chipLabel));
  ok('unknown: the prompt forbids stating a governing edition', /do not state which edition/i.test(g.promptBlock));
  ok('unknown: the prompt does not smuggle in an authority name', !/Department of Buildings/i.test(g.promptBlock));
}
{
  // THE anti-drift property: the chip and the prompt are the same value's two
  // faces. Two different jurisdictions must never produce the same pair.
  const seen = new Map<string, string>();
  let collision = '';
  for (const e of LOCAL_ADOPTIONS) {
    const m = e.matchCity?.[0] ?? e.matchCounty?.[0] ?? '';
    const g = groundingFactsFor(resolveCodeJurisdiction(e.matchCity?.length ? { city: m, state: e.state } : { county: m, state: e.state }));
    if (seen.has(g.cacheKey)) collision = `${seen.get(g.cacheKey)} vs ${e.name}`;
    seen.set(g.cacheKey, e.name);
    if (!g.grounded) collision = `${e.name} did not ground`;
  }
  ok(`every city row grounds and has its own cache key${collision ? ` (${collision})` : ''}`, collision === '');
  ok('a state result and a city result in the same state do not share a cache key',
    groundingFactsFor(resolveCodeJurisdiction({ city: 'Bakersfield', state: 'CA' })).cacheKey
    !== groundingFactsFor(resolveCodeJurisdiction({ city: 'San Francisco', state: 'CA' })).cacheKey);
  ok('a state-level result says out loud that it is the state adoption', /state adoption/i.test(
    groundingFactsFor(resolveCodeJurisdiction({ city: 'Bakersfield', state: 'CA' })).promptBlock));
}
// The edition is the whole point of the chip. It must never fall off the line
// — a LOCAL row once rendered as a bare "NYC Construction Codes", which tells
// a contractor nothing about WHICH code they are being answered against.
ok('no adopted code can render without its edition', ALL.every((e) => e.codes.every((c) => codeLine(c).includes(c.edition))));
ok('every row\'s chip carries an edition for each code it names', ALL.every((e) => {
  const summary = codesSummary(e.codes);
  return e.codes.every((c) => summary.includes(c.edition));
}));
ok('codesSummary collapses model codes published under ONE local name', (() => {
  const s = codesSummary([
    { family: 'IBC', edition: '2024', name: '2024 Phoenix Building Construction Code' },
    { family: 'IRC', edition: '2024', name: '2024 Phoenix Building Construction Code' },
    { family: 'IECC', edition: '2024' },
  ]);
  return s === '2024 Phoenix Building Construction Code (IBC/IRC 2024), IECC 2024';
})());
ok('… but keeps distinct editions distinct when the name is shared', (() => {
  const s = codesSummary([
    { family: 'IBC', edition: '2021', name: 'X Code' },
    { family: 'NEC', edition: '2020', name: 'X Code' },
  ]);
  return s === 'X Code (IBC 2021, NEC 2020)';
})());
ok('codeLine renders a model-code family as "<FAMILY> <edition>"', codeLine({ family: 'IBC', edition: '2021' }) === 'IBC 2021');
ok('codeLine appends the edition to a LOCAL name that lacks it', codeLine({ family: 'LOCAL', edition: '2022', name: 'NYC Construction Codes' }) === 'NYC Construction Codes (2022)');
ok('codeLine does not double-print an edition the LOCAL name already carries', codeLine({ family: 'LOCAL', edition: '2025', name: '2025 Uniform Code' }) === '2025 Uniform Code');
ok('codeLine keeps a local name and shows the model basis in parentheses', codeLine({ family: 'IBC', edition: '2021', name: '2021 Seattle Building Code' }) === '2021 Seattle Building Code (IBC 2021)');
ok('codeLine never invents a model-code family for a LOCAL code', (() => {
  const l = codeLine({ family: 'LOCAL', edition: '2022', name: 'NYC Construction Codes' });
  return !/\b(IBC|IRC|IECC|NEC|IEBC|IPC|IMC|IFC|IFGC|LOCAL)\b/.test(l);
})());
ok('codesSummary keeps table order', codesSummary([{ family: 'IBC', edition: '2021' }, { family: 'NEC', edition: '2020' }]) === 'IBC 2021, NEC 2020');

// ─────────────────────────────────────────────────────────────────────
console.log('\nsplitLocationText (prefilling from a legacy free-text location):');
// ─────────────────────────────────────────────────────────────────────
ok('"Brooklyn, NY" splits', JSON.stringify(splitLocationText('Brooklyn, NY')) === JSON.stringify({ city: 'Brooklyn', state: 'NY' }));
ok('"Seattle, Washington" splits on the full name', splitLocationText('Seattle, Washington').state === 'WA');
ok('"Austin TX" splits without a comma', JSON.stringify(splitLocationText('Austin TX')) === JSON.stringify({ city: 'Austin', state: 'TX' }));
ok('"San Francisco California" splits a multi-word city', JSON.stringify(splitLocationText('San Francisco California')) === JSON.stringify({ city: 'San Francisco', state: 'CA' }));
ok('a street address keeps the city and the state', (() => {
  const r = splitLocationText('123 Main St, Denver, CO');
  return r.city === 'Denver' && r.state === 'CO';
})());
ok('an unrecognisable string never invents a state', splitLocationText('somewhere out past the ridge').state === '' && splitLocationText('').state === '');
ok('a foreign location never invents a US state', splitLocationText('Toronto, Ontario').state === '');
// The founder's real projects are stored as "124 Park Slope, Brooklyn NY 11215".
// A trailing ZIP left attached made that come back as the STREET with no state,
// which resolved to no jurisdiction at all (runtime audit MISS-06).
ok('a trailing ZIP is peeled off rather than swallowing the state', (() => {
  const r = splitLocationText('124 Park Slope, Brooklyn NY 11215');
  return r.city === 'Brooklyn' && r.state === 'NY';
})());
ok('a ZIP+4 is peeled too', splitLocationText('12 Elm St, Springfield IL 62701-1234').state === 'IL');
ok('a comma-separated city/state/ZIP still splits', (() => {
  const r = splitLocationText('Houston, TX 77002');
  return r.city === 'Houston' && r.state === 'TX';
})());
ok('a bare city with no state is left alone rather than guessed', (() => {
  const r = splitLocationText('Portland');
  return r.city === 'Portland' && r.state === '';
})());

// ─────────────────────────────────────────────────────────────────────
console.log('\njobsiteAddressForProject — ONE complete value, never a merge:');
// ─────────────────────────────────────────────────────────────────────
{
  // AI-1 was a field-by-field prefill that only wrote a field when it was
  // still blank, so switching projects left the previous job's city under the
  // new job's name. The contract that replaces it: a project ALWAYS yields all
  // five fields, blanks included, so the caller can assign the whole value.
  const houston = jobsiteAddressForProject({
    structuredAddress: { street: '1 Main St', city: 'Houston', state: 'TX', zip: '77002', county: 'Harris' },
    location: 'ignored because structuredAddress wins',
  });
  ok('structuredAddress wins over the legacy free-text location', (() => (
    houston.street === '1 Main St' && houston.city === 'Houston' &&
    houston.state === 'TX' && houston.zip === '77002' && houston.county === 'Harris'
  ))());

  const brooklyn = jobsiteAddressForProject({ location: '124 Park Slope, Brooklyn NY 11215' });
  ok('the legacy location is the fallback and yields city + state', brooklyn.city === 'Brooklyn' && brooklyn.state === 'NY');
  ok('THE AI-1 PROPERTY: switching jobs blanks what the new job does not have',
    brooklyn.county === '' && brooklyn.zip === '' && brooklyn.street === '');

  ok('a project with no address at all returns every field blank, not undefined',
    sameJobsiteAddress(jobsiteAddressForProject({ location: '' }), EMPTY_JOBSITE_ADDRESS));
  ok('a null/undefined project returns the empty address rather than throwing',
    sameJobsiteAddress(jobsiteAddressForProject(null), EMPTY_JOBSITE_ADDRESS) &&
    sameJobsiteAddress(jobsiteAddressForProject(undefined), EMPTY_JOBSITE_ADDRESS));
  ok('an empty structuredAddress falls through to the legacy location',
    jobsiteAddressForProject({ structuredAddress: { street: '9 Oak' }, location: 'Austin TX' }).state === 'TX');
  ok('every field comes back trimmed', (() => {
    const a = jobsiteAddressForProject({ structuredAddress: { city: '  Seattle ', state: ' WA ' } });
    return a.city === 'Seattle' && a.state === 'WA';
  })());
  ok('the frozen EMPTY_JOBSITE_ADDRESS is never handed out as a shared mutable',
    jobsiteAddressForProject(null) !== EMPTY_JOBSITE_ADDRESS);
}
{
  ok('sameJobsiteAddress: identical values compare equal', sameJobsiteAddress(
    { street: 'a', city: 'b', state: 'CA', zip: '1', county: 'c' },
    { street: 'a', city: 'b', state: 'CA', zip: '1', county: 'c' }));
  ok('sameJobsiteAddress: a single edited field compares unequal', !sameJobsiteAddress(
    { street: 'a', city: 'b', state: 'CA', zip: '1', county: 'c' },
    { street: 'a', city: 'b', state: 'CA', zip: '1', county: 'd' }));
  ok('sameJobsiteAddress: a blanked field compares unequal (that is an edit too)', !sameJobsiteAddress(
    { street: 'a', city: 'b', state: 'CA', zip: '1', county: 'c' }, EMPTY_JOBSITE_ADDRESS));
}

// ─────────────────────────────────────────────────────────────────────
console.log('\nissuingAuthorityForAddress — the office that ISSUES the permit:');
// ─────────────────────────────────────────────────────────────────────
{
  // MISS-06: the roadmap wrote the jobsite STREET ADDRESS into
  // Permit.jurisdiction. This function is the replacement, and its `null` is a
  // real answer callers must pass through as a blank.
  ok('a city row answers with the permitting office', (() => {
    const a = issuingAuthorityForAddress({ city: 'Brooklyn', state: 'NY' });
    return a === 'New York City Department of Buildings';
  })());
  ok('a county-keyed row answers too', /Miami-Dade/i.test(issuingAuthorityForAddress({ county: 'Miami-Dade', state: 'FL' }) ?? ''));
  ok('a STATE-only match returns null — the Florida Building Commission does not issue permits in Orlando',
    issuingAuthorityForAddress({ city: 'Orlando', state: 'FL' }) === null);
  ok('an unknown jurisdiction returns null', issuingAuthorityForAddress({ city: 'Fargo', state: 'ND' }) === null);
  ok('no state returns null rather than a guess', issuingAuthorityForAddress({ city: 'Springfield' }) === null);
  ok('it NEVER returns an address — only a name from the table', (() => {
    const names = new Set(LOCAL_ADOPTIONS.map((e) => e.authorityName));
    return LOCAL_ADOPTIONS.every((e) => {
      const m = e.matchCity?.[0] ?? e.matchCounty?.[0] ?? '';
      const a = issuingAuthorityForAddress(e.matchCity?.length ? { city: m, state: e.state } : { county: m, state: e.state });
      return a !== null && names.has(a);
    });
  })());
  ok('MISS-06 end to end: the founder\'s stored location shape yields an AHJ', (() => {
    const addr = jobsiteAddressForProject({ location: '124 Park Slope, Brooklyn NY 11215' });
    return issuingAuthorityForAddress({ city: addr.city, county: addr.county, state: addr.state })
      === 'New York City Department of Buildings';
  })());
}

// ─────────────────────────────────────────────────────────────────────
console.log('\nsource assertions (the screen the pure functions cannot reach):');
// ─────────────────────────────────────────────────────────────────────
{
  const code = src('app/(tabs)/construction-ai/index.tsx');

  ok('screen: resolves the jurisdiction through the shared resolver', /resolveCodeJurisdiction\(\{ city, county, state: stateCode \}\)/.test(code));
  ok('screen: renders grounding through groundingFactsFor, once', /groundingFactsFor\(jurisdiction\)/.test(code));

  // THE anti-drift pins. Both prompts must take the block from the renderer,
  // and neither may hand-write a jurisdiction sentence of its own.
  ok('screen: the MAIN code-check prompt carries grounding.promptBlock', /\$\{grounding\.promptBlock\}/.test(code));
  ok('screen: the per-citation drill-in carries the SAME promptBlock', /grounding \? `\$\{grounding\.promptBlock\}\\n` : ''/.test(code) && /\$\{jurisdictionBlock\}/.test(code));
  ok('screen: the chip text is groundingFactsFor output, never re-worded on the screen',
    (code.match(/\{grounding\.chipLabel\}/g) ?? []).length >= 2 &&
    !/Adoption checked \$\{/.test(code) && !/authorityName\}/.test(code));

  // The cache keys. Two cities asked the same question must not share an answer.
  ok('screen: the code-check cache key includes the resolved jurisdiction', /const cacheKey = `code_check::\$\{codeCheckProjectId \?\? 'none'\}::\$\{grounding\.cacheKey\}/.test(code));
  ok('screen: the drill-in cache key includes it too', /const cacheKey = `code_detail::\$\{grounding\?\.cacheKey \?\? 'none'\}/.test(code));

  // The result chip must describe the run, not the live form.
  ok('screen: the grounding sent with a result is snapshotted next to it', /setResultGrounding\(grounding\)/.test(code) && /useState<JurisdictionGrounding \| null>/.test(code));
  ok('screen: a new run clears the previous snapshot', /setResultGrounding\(null\)/.test(code));
  ok('screen: the result modal is handed the SNAPSHOT, not the live grounding', /grounding=\{resultGrounding\}/.test(code));

  // The address block.
  ok('screen: the single free-text "Location (city, state)" field is gone', !/Location \(city, state\)/.test(code) && !/placeholder="e\.g\. Brooklyn, NY"/.test(code));
  ok('screen: street / city / state / ZIP inputs all exist with testIDs',
    ['code-check-street', 'code-check-city', 'code-check-state', 'code-check-zip'].every((t) => code.includes(`testID="${t}"`)));
  ok('screen: submitting needs city + state — never the street', /city\.trim\(\)\.length > 0 && stateCode\.trim\(\)\.length > 0/.test(code) && !/street\.trim\(\)\.length > 0 &&/.test(code));
  // THE AI-1 PINS. This slot used to pin the BUG: it required the
  // field-by-field prefill (`setCounty(sa.county)`, `splitLocationText(
  // codeCheckProject.location…)`) that reading each field only when it was
  // blank is exactly what left project A's city under project B's name. The
  // old predicate was true of the broken screen and false of the fixed one —
  // a guard that passes on the bug and fails on the fix is worse than no
  // guard, because reverting the fix turns the suite green. What replaces it
  // pins the CONTRACT: the address is one value, it is replaced whole, and it
  // is replaced in exactly one place.
  ok('screen: the address is ONE value, not five independent useStates',
    /useState<JobsiteAddress>\(EMPTY_JOBSITE_ADDRESS\)/.test(code) &&
    /const \{ street, city, state: stateCode, zip, county \} = address;/.test(code));
  ok('screen: the project link goes through selectCodeCheckProject and nothing else calls setCodeCheckProjectId',
    /const selectCodeCheckProject = useCallback/.test(code) &&
    (code.match(/setCodeCheckProjectId\(/g) ?? []).length === 1);
  ok('screen: every project chip (including "No project") dispatches through it',
    (code.match(/selectCodeCheckProject\(/g) ?? []).length === 2 &&
    /onPress=\{\(\) => selectCodeCheckProject\(null\)\}/.test(code) &&
    /onPress=\{\(\) => selectCodeCheckProject\(p\.id\)\}/.test(code));
  ok('screen: linking a project REPLACES the whole address via jobsiteAddressForProject',
    /setAddress\(jobsiteAddressForProject\(/.test(code) || /jobsiteAddressForProject\(projects\.find/.test(code));
  ok('screen: the old field-by-field, only-if-blank prefill is gone for good',
    !/if \(!city && /.test(code) && !/if \(!stateCode && /.test(code) && !/setCounty\(sa\.county\)/.test(code));
  ok('screen: an edited address is never clobbered — both branches gate on sameJobsiteAddress',
    (code.match(/sameJobsiteAddress\(/g) ?? []).length >= 3);
  ok('screen: a linked project whose address changes elsewhere is reconciled, not left stale',
    /const linkedProjectAddress = useMemo/.test(code) && /appliedProjectAddressRef/.test(code));
  ok('screen: the prefill note still tells the contractor the fields were filled in', /code-check-project-prefill/.test(code));
  ok('screen: a project with NO address says so instead of claiming a location',
    /no jobsite address on file/.test(code));

  // MISS-06 — the permit's issuing authority.
  ok('screen: an AI-generated permit records the resolved AHJ, never the jobsite address',
    /issuingAuthorityForAddress\(/.test(code) &&
    !/jurisdiction: roadmapProject\.location/.test(code) &&
    /jurisdiction: roadmapAuthority/.test(code));
  ok('screen: a null AHJ is passed through as a blank, not papered over',
    /roadmapAuthority \?\? ''/.test(code) && /roadmapAuthority \?\? undefined/.test(code));
  ok('screen: the contractor is told BEFORE tapping Add which jurisdiction gets recorded',
    /testID="roadmap-permit-authority"/.test(code) && /no verified building-department record/.test(code));

  // AI-3 / VIS-01 — four mode segments in one bar.
  ok('screen: mode-toggle segments stack the icon above the label and cannot spill across the boundary',
    /flexDirection: 'column' as const,\n\s*alignItems: 'center' as const,/.test(code) &&
    /minWidth: 0,/.test(code) && /overflow: 'hidden' as const,/.test(code));
  ok('screen: every mode label is wrap-capped so a long one cannot overrun its segment',
    (code.match(/numberOfLines=\{2\} ellipsizeMode="tail"/g) ?? []).length === 4);
  ok('screen: all four segments reserve the same label height, so the icons share a baseline',
    /minHeight: 30,/.test(code));

  // The honest-chip family the screen already ships stays intact.
  ok('screen: the model-recall chip above the code list is untouched', /From model recall — verify with your AHJ/.test(code));
}

// ─────────────────────────────────────────────────────────────────────
// THE LADDER — utils/codeAmendments.ts
//
// Everything below guards ONE promise: a citation is never shown standing on
// a higher rung than the evidence MAGE actually holds. The failure this is
// written against is not "the badge is missing", it is "the badge says
// STATE AMENDMENT over something nobody read off a government page" — the
// same shape as a recalled edition beside a real URL, one screen further in.
// ─────────────────────────────────────────────────────────────────────

console.log('\namendments — every row is government text, sourced and dated:');

// THE TABLE IS THE HAND-READ ROWS AND NOTHING ELSE. The generated register
// table, its generator and its provenance fingerprint were withdrawn: it
// rendered a green STATE AMENDMENT badge over the wrong code on 19 of its 141
// rows and every check it shipped with called that correct. This is not a
// weaker assertion than the seal it replaces — it is a different promise, and
// it fails the moment a row arrives that nobody read.
ok('every row MAGE holds was read by a human, off a named document',
  ALL_AMENDMENTS.length > 0 &&
  ALL_AMENDMENTS.length === HAND_VERIFIED_AMENDMENTS.length &&
  ALL_AMENDMENTS.every((a) => /^human pass \d{4}-\d{2}-\d{2} — /.test(a.readBy)));

const AMEND_MAX_AGE_DAYS = 400;
const todayMs = Date.now();
for (const a of ALL_AMENDMENTS) {
  const who = `${a.state} ${a.family} ${a.section}`;
  ok(`${who}: sourceUrl is a non-empty https URL`,
    /^https:\/\/\S+$/.test(a.sourceUrl));
  ok(`${who}: cites the document by its own citation`, a.cite.trim().length > 3);
  ok(`${who}: names the promulgating authority`, a.authorityName.trim().length > 10);
  ok(`${who}: checkedOn is an ISO date`, /^\d{4}-\d{2}-\d{2}$/.test(a.checkedOn));
  ok(`${who}: checkedOn is not in the future and not stale`, (() => {
    const t = Date.parse(`${a.checkedOn}T00:00:00Z`);
    return Number.isFinite(t) && t <= todayMs && (todayMs - t) / 86_400_000 < AMEND_MAX_AGE_DAYS;
  })());
  ok(`${who}: section carries no whitespace and is not empty`,
    a.section.length > 0 && a.section === normalizeSection(a.section));
  ok(`${who}: says who read the page`, a.readBy.trim().length > 10);
  // A row that claims to hold text in full must actually hold text.
  ok(`${who}: textComplete is false only when text was actually cut`,
    a.textComplete || a.amendmentText.length > 0);
}

// ─────────────────────────────────────────────────────────────────────
// THE LICENSING FIREWALL, IN ITS ONLY EXECUTABLE FORM
// ─────────────────────────────────────────────────────────────────────
//
// The ONLY text an amendment row may hold is a government edict: a state's own
// regulation, which carries no copyright (Georgia v. Public.Resource.Org, 590
// U.S. 255 (2020)) and no terms of use. Model-code text is the single largest
// legal exposure available in this project and is not a judgement call a
// commit gets to make.
//
// THIS USED TO BE A HOSTNAME-SUFFIX REGEX and a suffix test is not a firewall:
//   /^https:\/\/(?:[a-z0-9-]+\.)*(?:gov|us)(?:\/|$)/i
// It admitted ANY *.us domain, including private ones anybody can register,
// and it REJECTED legitimate state registers that publish on other hosts —
// which does not keep the next contributor out, it teaches them to widen the
// regex or route around it. An allowlist says the true thing instead: these
// are the registers a human opened and checked, on the date they checked them.
//
// TO ADD A REGISTER: open it, confirm it is the promulgating authority's own
// publication of its own regulation, record what you saw and the date. Not a
// pattern — a row.
//
// app.leg.wa.gov was on this list for the generated Washington rows. Those
// rows are withdrawn and nothing is sourced from that host any more, so the
// entry is gone too: an allowlist carrying a register no row uses is an
// invitation to put rows back through it without re-reading anything.
const AMENDMENT_REGISTERS: readonly { host: string; what: string; checkedOn: string }[] = [
  {
    host: 'dos.ny.gov',
    what:
      'New York State Department of State (Division of Building Standards ' +
      'and Codes) publishing 19 NYCRR, the regulation it promulgates. ' +
      'Re-fetched 2026-09-13 (curl -L, Safari UA): ' +
      'https://dos.ny.gov/19-nycrr-part-1220 → HTTP 200, application/pdf, ' +
      '145,706 bytes, redirecting to dos.ny.gov/system/files/documents/…',
    checkedOn: '2026-09-13',
  },
];

const registerHosts = new Set(AMENDMENT_REGISTERS.map((r) => r.host.toLowerCase()));
for (const r of AMENDMENT_REGISTERS) {
  ok(`register ${r.host}: says who checked it and when`,
    /^\d{4}-\d{2}-\d{2}$/.test(r.checkedOn) &&
    Date.parse(`${r.checkedOn}T00:00:00Z`) <= todayMs &&
    r.what.length > 60);
}
for (const a of ALL_AMENDMENTS) {
  const host = (() => {
    try { return new URL(a.sourceUrl).hostname.toLowerCase(); } catch { return ''; }
  })();
  ok(`${a.state} ${a.section}: sourced from a register on the allowlist, never a publisher`,
    a.sourceUrl.startsWith('https://') && registerHosts.has(host));
}
// A second, independent net. The allowlist is the rule; this is the named
// adversary, kept because it fails with a sentence a reader understands.
ok('no amendment row is sourced from ICC or a code-publisher platform',
  ALL_AMENDMENTS.every((a) => !/iccsafe\.org|up\.codes|ecode360|municode|amlegal/i.test(a.sourceUrl)));

// ─────────────────────────────────────────────────────────────────────
// THE CONTENT GUARD — NOW ON THE ROWS, NOT ON A FILE
// ─────────────────────────────────────────────────────────────────────
//
// The ONLY text an amendment row may hold is a government edict: a state's own
// regulation, which carries no copyright (Georgia v. Public.Resource.Org, 590
// U.S. 255 (2020)) and no terms of use. Model-code text is the single largest
// legal exposure available in this project and is not a judgement call a
// commit gets to make.
//
// This used to scan utils/codeAmendments.data.ts as a FILE, with a heuristic
// that stripped the leading comment run so the header could name what it
// forbids without tripping it. That file is gone, and scanning
// utils/codeAmendments.ts instead would be worse than useless: its header
// discusses ICC, iccsafe.org and up.codes at length, on purpose, and every
// marker below would fire on the prose explaining why the marker exists.
//
// So the scan now runs over the ROW STRINGS THEMSELVES. That is not a
// consolation prize for losing the file scan — it is the check the file scan
// was approximating, with no header-exemption heuristic left to get wrong, and
// it keeps working wherever the rows are declared.
//
// WHAT THIS CAN AND CANNOT DO, PLAINLY. It cannot read a paragraph and decide
// who wrote it. It CAN catch the ways publisher text actually arrives — text
// lifted off a publisher's page brings the publisher's markers with it — and
// it CAN bound the volume of reproduction in code rather than leaving it to
// whoever adds the next row. A state page that itself reprints model-code text
// wholesale would still get through, which is why the register allowlist above
// is a list of registers somebody opened, and why adding one is a deliberate
// act and not a regex edit.
{
  // Every string a row carries, concatenated. Not the file — the data.
  const rowText = ALL_AMENDMENTS.map((a) =>
    [a.state, a.family, a.edition, a.codeName ?? '', (a.codeAliases ?? []).join(' '),
      a.section, a.caption, a.cite, a.authorityName, a.sourceUrl, a.amendmentText, a.readBy].join('\n'),
  ).join('\n');

  // 1. PUBLISHER MARKERS. Anything lifted off an ICC or codification-platform
  //    page brings these with it. A state register carries none of them.
  const PUBLISHER_MARKERS: readonly [string, RegExp][] = [
    ['ICC by name', /International Code Council/i],
    ['an ICC viewer URL', /codes\.iccsafe\.org|iccsafe\.org\/content/i],
    ['a competitor corpus', /\bup\.codes\b|ecode360|municode|amlegal/i],
    ['a copyright notice', /copyright\s|©|\(c\)\s*\d{4}|all rights reserved/i],
    ['a permission-to-reproduce notice', /reproduced with permission|used with permission/i],
    ['an ICC product banner', /ICC Digital Codes|International Code Council, Inc\./i],
  ];
  for (const [what, re] of PUBLISHER_MARKERS) {
    ok(`no amendment row carries ${what}`, !re.test(rowText));
  }
  // THE CONTROL. Six regexes over a string can all pass because the string is
  // empty, or because it never reached them. Prove the scan has something to
  // read and that a planted marker is actually seen.
  ok('the marker scan has real row text to read',
    rowText.length > 400 && /Relocated Manufactured Homes/.test(rowText));
  ok('a planted publisher marker would be caught (the control)',
    PUBLISHER_MARKERS.some(([, re]) => re.test(`${rowText}\nCopyright 2021 International Code Council`)));

  // 2. A HARD REPRODUCTION CEILING, IN CODE. Reproduction volume is not a
  //    judgement call made row by row.
  //
  //    The table ceiling used to be 400,000 characters, sized for a generator
  //    emitting 141 rows. Over a hand-curated table that is not a bound, it is
  //    a number that can never be reached — and a limit that cannot fail is
  //    one of this repo's five species of green-while-broken. It is now
  //    40,000: roughly twenty maximum-size rows, which is a real ceiling on
  //    hand-added rows and still leaves the table room to grow by an order of
  //    magnitude before anyone has to think about it again.
  const PER_ROW_CEILING = 2_000;
  const TABLE_CEILING = 40_000;
  for (const a of ALL_AMENDMENTS) {
    ok(`${a.state} ${a.section}: reproduced text is under the per-row ceiling`,
      a.amendmentText.length <= PER_ROW_CEILING);
  }
  const totalText = ALL_AMENDMENTS.reduce((n, a) => n + a.amendmentText.length, 0);
  ok(`the whole table reproduces under ${TABLE_CEILING} characters (currently ${totalText})`,
    totalText <= TABLE_CEILING);
}

// ─────────────────────────────────────────────────────────────────────
// WHICH BOOK IS THIS ROW ABOUT? — the one fact the green badge asserts
// ─────────────────────────────────────────────────────────────────────
//
// The block that stood here proved that each GENERATED row's `family` was the
// code its own register block heading declared, and that the row claimed the
// block it actually fell in. It existed because that fact had been wrong: WAC
// chapter 51-50 adopts two codes and the generator stamped the family from the
// chapter, so 19 IEBC sections shipped wearing family "IBC" — a Spokane
// contractor citing IBC § 506 was quoted the IEBC's change-of-occupancy rule
// under a green STATE AMENDMENT badge, with a link to the wrong book beside
// it. The assertions written to catch it were written after the fact, and the
// pipeline was withdrawn rather than kept on those assertions' word.
//
// Its subject is gone with it. Nothing generated remains, `familyCite` and
// `familyEvidence` no longer exist on the shape, and rewriting the block to
// iterate an empty array would leave a green tick standing for a check that
// examines nothing. The surviving rows make the family claim a different way,
// and it is checked where that way is checked: they carry `codeName`, which
// must match an AdoptedCode name exactly in utils/codeJurisdiction.ts or the
// row can never fire at all. See the rung-1 block below.

// ─────────────────────────────────────────────────────────────────────
console.log('\nthe ICC viewer link — volume level, or nothing:');
// ─────────────────────────────────────────────────────────────────────

// The guard that matters. /content/<id>/<anything> returns HTTP 200 whether
// the chapter exists or not, so a section-level link built from a recalled
// number opens cleanly and points at nothing. iccViewerUrl must refuse
// everything that is not a bare volume id.
ok('iccViewerUrl accepts a real volume id', iccViewerUrl('IBC2021P1') === 'https://codes.iccsafe.org/content/IBC2021P1');
ok('iccViewerUrl accepts a state volume id', iccViewerUrl('NYSRC2025P1') === 'https://codes.iccsafe.org/content/NYSRC2025P1');
for (const bad of [
  'IBC2021P1/chapter-10-means-of-egress',
  'IBC2021P1/chapter-99-not-a-real-chapter',
  'IBC2021P1_Ch10_Sec1011.5.2',
  '1011.5.2',
  'ibc2021p1',
  'IBC 2021',
  '../admin',
  '',
  'AB',
]) {
  ok(`iccViewerUrl refuses ${JSON.stringify(bad)}`, iccViewerUrl(bad) === null);
}
ok('iccViewerUrl refuses null and undefined', iccViewerUrl(null) === null && iccViewerUrl(undefined) === null);

// AND THE GATE ON THE OTHER SIDE. iccViewerUrl guards id → URL; it has no view
// of URL → URL + path, which is what an opener does. viewerUrlToOpen re-parses
// whatever reached the tap handler and REBUILDS the URL from the id it
// captured, so nothing can ride along.
ok('viewerUrlToOpen passes a bare volume URL through unchanged',
  viewerUrlToOpen('https://codes.iccsafe.org/content/IBC2021P1') === 'https://codes.iccsafe.org/content/IBC2021P1');
ok('viewerUrlToOpen normalises surrounding whitespace rather than refusing it',
  viewerUrlToOpen('  https://codes.iccsafe.org/content/NYSRC2025P1 ') === 'https://codes.iccsafe.org/content/NYSRC2025P1');
for (const bad of [
  // The reviewer's mutation, exactly: a fabricated section link.
  'https://codes.iccsafe.org/content/IBC2021P1/chapter-10-means-of-egress',
  'https://codes.iccsafe.org/content/IBC2021P1/chapter-99-not-a-real-chapter',
  'https://codes.iccsafe.org/content/IBC2021P1/R310.1',
  'https://codes.iccsafe.org/content/IBC2021P1?section=1011.5.2',
  'https://codes.iccsafe.org/content/IBC2021P1#1011.5.2',
  'https://codes.iccsafe.org/lookup/IBC2021P1_Ch10_Sec1011.5.2',
  'http://codes.iccsafe.org/content/IBC2021P1',
  'https://codes.iccsafe.org.example.com/content/IBC2021P1',
  'https://up.codes/content/IBC2021P1',
  'https://codes.iccsafe.org/content/ibc2021p1',
  'https://codes.iccsafe.org/content/',
  '',
]) {
  ok(`viewerUrlToOpen refuses ${JSON.stringify(bad)}`, viewerUrlToOpen(bad) === null);
}
ok('viewerUrlToOpen refuses null and undefined',
  viewerUrlToOpen(null) === null && viewerUrlToOpen(undefined) === null);
ok('every link the app offers survives its own opener (the control)',
  ALL.every((e) => {
    const city = 'matchCity' in e ? e.matchCity?.[0] : undefined;
    return viewerLinksFor(resolveCodeJurisdiction({ city, state: e.state }))
      .every((l) => viewerUrlToOpen(l.url) === l.url);
  }));

// Rule 3 of the iccVolumeId contract: a code with its own local NAME may only
// carry a volume when ICC publishes that very volume, and the recorded title
// must be ICC's, sharing the edition year. Linking Ohio's "2024 Ohio Building
// Code" to the 2021 IBC would be the edition error this table exists to stop,
// wearing a URL.
for (const e of ALL) {
  for (const c of e.codes) {
    if (!c.iccVolumeId) continue;
    const who = `${labelOf(e)} ${c.family} ${c.edition}`;
    ok(`${who}: volume id passes the viewer guard`, iccViewerUrl(c.iccVolumeId) !== null);
    ok(`${who}: records the title ICC actually returned`,
      typeof c.iccVolumeTitle === 'string' && c.iccVolumeTitle.trim().length > 10);
    const year = c.edition.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
    ok(`${who}: the recorded ICC title carries this row's edition year`,
      !!year && (c.iccVolumeTitle ?? '').includes(year));
    ok(`${who}: the generic "Digital Codes" fallback title is never recorded as a volume`,
      (c.iccVolumeTitle ?? '').trim() !== 'Digital Codes');

    // THE YEAR CHECK ABOVE IS NOT ENOUGH ON ITS OWN, and this is the hole it
    // leaves: Ohio's row claims { family: 'IBC', edition: '2021' } under the
    // name "2024 Ohio Building Code". Attach IBC2021P1 to it and the recorded
    // title "2021 International Building Code (IBC)" carries the year 2021
    // perfectly — while the link sends an Ohio contractor to the model code
    // instead of the Ohio one. That is the edition error this whole table
    // exists to prevent, wearing a URL, and it would pass every check above.
    //
    // So the two cases are separated. A code with its own local NAME may only
    // carry a volume that is NOT a bare model-code volume; a code with no name
    // is claiming the model code itself, and its volume must be exactly that.
    const MODEL_VOLUME_TITLE = /^(?:19|20)\d{2} International .+ Code \([A-Z]+\)$/;
    const recordedTitle = (c.iccVolumeTitle ?? '').trim();
    if (c.name) {
      ok(`${who}: a locally-titled code is never linked to the bare model volume`,
        !MODEL_VOLUME_TITLE.test(recordedTitle));
      // AND THE ROW'S NAME MUST BE THE BOOK'S NAME. This is the umbrella
      // check, and it is the one Florida failed. "Florida Building Code, 8th
      // Edition (2023)" is a family of at least five separately published ICC
      // volumes — measured 2026-09-13: FLBC2023P1 "…, Building, …",
      // FLRC2023P1 "…, Residential, …", FLEC2023P1 "…, Energy Conservation,
      // …", FLEBC2023P1 "…, Existing Building, …", FLBC2023P2 — and the row
      // carried the COMMERCIAL one, so an R310 residential citation opened the
      // wrong book under a green badge. When ICC's own title does not contain
      // the row's own name, no single volume is what the row claims, and the
      // honest link is none. New York's RCNYS passes: ICC titles it "2025
      // Residential Code of New York State (2025 RCNYS)".
      ok(`${who}: ICC's title for this volume actually names this row's code`,
        recordedTitle.toUpperCase().includes(c.name.toUpperCase()));
    } else {
      ok(`${who}: a code claiming the model family links to that model volume`,
        MODEL_VOLUME_TITLE.test(recordedTitle) && recordedTitle.includes(`(${c.family})`));
    }
  }
}
ok('no adopted code records a title without an id, or an id without a title',
  ALL.every((e) => e.codes.every((c) => !!c.iccVolumeId === !!c.iccVolumeTitle)));
ok('groundingFactsFor emits viewer links for a jurisdiction that has volumes',
  groundingFactsFor(resolveCodeJurisdiction({ city: 'Philadelphia', state: 'PA' })).viewerLinks.length >= 3);
// Both halves matter, and the second is the one that bites: an unresolved
// address must not borrow SOME OTHER jurisdiction's volumes. The first draft
// of the mutation for this guard swapped in California's row and the guard
// stayed green — because California adopts Title 24, which ICC does not
// publish as a volume, so the substitution produced zero links either way. A
// jurisdiction WITH volumes is the only honest control.
ok('a jurisdiction with volumes really does produce them (the control)',
  viewerLinksFor(resolveCodeJurisdiction({ city: 'Philadelphia', state: 'PA' })).length >= 3);
ok('an unresolved jurisdiction emits NO viewer links',
  groundingFactsFor(resolveCodeJurisdiction({ state: 'ZZ' })).viewerLinks.length === 0 &&
  viewerLinksFor(resolveCodeJurisdiction({ state: 'ZZ' })).length === 0);
ok('the prompt is never handed a viewer URL — a model given URLs cites URLs',
  !groundingFactsFor(resolveCodeJurisdiction({ city: 'Philadelphia', state: 'PA' })).promptBlock.includes('iccsafe.org'));

// THE ENERGY CODE IS THE ONE A GEORGIA CONTRACTOR GETS WRONG, AND IT IS THE
// ONE THAT USED TO HAVE NO LINK. Georgia builds to the 2024 I-Codes and the
// 2015 IECC — nine years apart on the same job. Recall spells that volume
// IECC2015P1 like every other row in this table; that id returns HTTP 404
// (measured 2026-09-13) and the real one is the bare IECC2015. So this guard
// asserts the URL, not merely that A link exists: a link to the 2024 energy
// code here would be the exact mistake the row's own note warns about.
{
  const ga = resolveCodeJurisdiction({ city: 'Atlanta', state: 'GA' });
  const gaLinks = viewerLinksFor(ga);
  const energy = gaLinks.find((l) => l.code.family === 'IECC');
  ok('Georgia\'s nine-years-behind energy code is openable',
    energy?.url === 'https://codes.iccsafe.org/content/IECC2015');
  ok('and it opens the 2015 volume, never the year the rest of the row is on',
    !!energy && energy.label.includes('2015') && !gaLinks.some((l) => l.url.includes('IECC2024')));
  ok('the NEC is never linked — ICC does not publish NFPA 70 (NEC2023P1 and NFPA70P1 both 404)',
    ALL.every((e) => e.codes.every((c) => c.family !== 'NEC' || !c.iccVolumeId)));
}

// ─────────────────────────────────────────────────────────────────────
console.log('\niccVolumeVerdict — a dead link is WRONG, not "unreachable":');
// WHY THIS FUNCTION IS PURE AND LIVES IN codeJurisdiction.ts. The rule used to
// be inline in scripts/verify-code-sources.ts, which needs the network, is not
// in ship-check, and therefore had no test at all. The distinction it draws is
// load-bearing: `unreachable` is the ONE verdict the committed receipt is
// allowed to carry forward, so classifying a 404 as unreachable would let a
// dead volume link ride behind a receipt written when the id still resolved.
{
  const GOOD = { volumeId: 'IECC2015', recordedTitle: '2015 International Energy Conservation Code (IECC)', edition: '2015' };
  const body = '2015 International Energy Conservation Code (IECC) CHAPTER 1 SCOPE AND ADMINISTRATION';
  // EVERY CASE BELOW ASSERTS *WHICH RULE FIRED*, NOT MERELY THAT ONE DID, AND
  // THAT IS NOT PEDANTRY — IT IS THE MUTATION RESULT. The first draft asserted
  // `.verdict === 'wrong'` and deleting the generic-shell check left it green,
  // because the generic body then fell through to the year check and came back
  // 'wrong' for a different reason. Same for the year check, which fell
  // through to the title check. Four rules that all answer 'wrong' cannot be
  // told apart by an oracle that only reads 'wrong'.
  const why = (over: Parameters<typeof iccVolumeVerdict>[0]) => {
    const v = iccVolumeVerdict(over);
    return v.verdict === 'ok' ? 'ok' : `${v.verdict}: ${v.why}`;
  };
  ok('a live volume whose title still matches is ok (the control — without it every case below passes by always failing)',
    why({ ...GOOD, status: 200, text: body }) === 'ok');
  ok('HTTP 404 is WRONG, never unreachable — the receipt must not forgive a dead id',
    why({ ...GOOD, status: 404, text: '', why: 'HTTP 404' }) === 'wrong: HTTP 404 — this volume id does not resolve; the link is dead');
  ok('HTTP 403 is WRONG too — any 4xx means this id did not resolve',
    why({ ...GOOD, status: 403, text: '', why: 'HTTP 403' }).startsWith('wrong: HTTP 403'));
  ok('HTTP 503 IS unreachable — the host being down is not the row being wrong',
    why({ ...GOOD, status: 503, text: '', why: 'HTTP 503' }) === 'unreachable: HTTP 503');
  ok('a transport failure with no response at all is unreachable',
    why({ ...GOOD, status: null, text: '', why: 'timed out' }) === 'unreachable: timed out');
  ok('the generic "Digital Codes" shell at HTTP 200 is WRONG — the id resolved to no volume',
    why({ ...GOOD, status: 200, text: 'Digital Codes Sign In Browse' }) === 'wrong: generic fallback title — this id does not resolve to a volume');
  ok('a REAL volume of the wrong edition is WRONG — the case no status code can catch',
    why({ ...GOOD, status: 200, text: '2021 International Energy Conservation Code (IECC) CHAPTER 1' }) === 'wrong: title does not carry the edition year 2015');
  ok('a title that drifted from the one recorded is WRONG even when the year still matches',
    why({ ...GOOD, status: 200, text: '2015 International Energy Conservation Code, Georgia Edition' }) === 'wrong: the recorded iccVolumeTitle no longer matches what ICC returns');
  ok('a section path is WRONG before anything is fetched — iccViewerUrl refuses it',
    why({ ...GOOD, volumeId: 'IECC2015/chapter-99-not-a-real-chapter', status: 200, text: body }) === 'wrong: refused by iccViewerUrl — not a bare volume id');
  ok('an empty recorded title cannot be confirmed by a 200',
    why({ ...GOOD, recordedTitle: '', status: 200, text: body }) === 'wrong: the recorded iccVolumeTitle no longer matches what ICC returns');
  ok('every id in the table is one iccVolumeVerdict would accept from a good fetch',
    ALL.every((e) => e.codes.every((c) => !c.iccVolumeId || iccVolumeVerdict({
      volumeId: c.iccVolumeId,
      recordedTitle: c.iccVolumeTitle,
      edition: c.edition,
      status: 200,
      text: `${c.iccVolumeTitle} CHAPTER 1 SCOPE AND ADMINISTRATION`,
    }).verdict === 'ok')));
}

const nowhere0 = resolveCodeJurisdiction({ state: '' });

// THE PER-CITATION LINK MUST OPEN THE BOOK THE CITATION IS ABOUT.
//
// This started as `viewerLinks[0]` and running the ladder over real citations
// showed what that does: an IRC R310 citation in Washington offered the
// BUILDING code and a 2025 RCNYS citation in New York offered the ENERGY code,
// because those are first on their rows. A confident green link to the wrong
// book is the same class of harm as a wrong edition.
{
  const wash = resolveCodeJurisdiction({ city: 'Spokane', state: 'WA' });
  const ithaca = resolveCodeJurisdiction({ city: 'Ithaca', state: 'NY' });
  ok('an IRC citation opens the IRC, not whatever volume is listed first',
    viewerLinkForCitation(wash, 'IRC 2021')?.url === 'https://codes.iccsafe.org/content/IRC2021P1');
  ok('an IBC citation opens the IBC',
    viewerLinkForCitation(wash, 'IBC 2021')?.url === 'https://codes.iccsafe.org/content/IBC2021P1');
  ok('a New York RCNYS citation opens the RCNYS, not the energy code',
    viewerLinkForCitation(ithaca, '2025 RCNYS')?.url === 'https://codes.iccsafe.org/content/NYSRC2025P1');
  ok('an ECCCNYS citation opens the energy code',
    viewerLinkForCitation(ithaca, '2025 ECCCNYS')?.url === 'https://codes.iccsafe.org/content/NYSECC2025P1');
  ok('a citation naming a code the address does not adopt opens NOTHING',
    viewerLinkForCitation(wash, 'IPC 2021') === null);
  ok('a citation naming a DIFFERENT edition opens nothing',
    viewerLinkForCitation(wash, 'IRC 2018') === null);
  ok('a citation MAGE cannot parse opens nothing rather than guessing',
    viewerLinkForCitation(wash, 'NYC BC 2022') === null &&
    viewerLinkForCitation(wash, '') === null);
  ok('an unresolved address opens nothing', viewerLinkForCitation(nowhere0, 'IRC 2021') === null);

  // AMBIGUITY IS NOT A TIE TO BE BROKEN BY ARRAY ORDER.
  //
  // "Code of New York State" is the tail of EVERY New York volume's title, so
  // the word fallback qualified both of them and the function returned the
  // first — the ENERGY code, for a residential job, under a green badge
  // (executed 2026-09-13). It was the table's row order deciding which book a
  // contractor opened. Two qualifying volumes now means MAGE does not know,
  // and the honest output of not knowing is no link.
  ok('a citation whose words fit EVERY volume on the row opens nothing',
    viewerLinkForCitation(ithaca, 'Code of New York State') === null);
  ok('and the same for the shorter form of it',
    viewerLinkForCitation(ithaca, 'New York State Code') === null);
  // The control, in both directions: the SAME address still opens the right
  // book when the citation actually names one. Without this pair, "return
  // null always" would satisfy the two assertions above.
  ok('the discriminating half still resolves — RCNYS opens the RCNYS',
    viewerLinkForCitation(ithaca, '2025 RCNYS')?.url === 'https://codes.iccsafe.org/content/NYSRC2025P1');
  ok('and ECCCNYS still opens the energy code',
    viewerLinkForCitation(ithaca, '2025 ECCCNYS')?.url === 'https://codes.iccsafe.org/content/NYSECC2025P1');

  // FLORIDA: the umbrella row carries no volume at all now, so an FBC citation
  // gets no link rather than the COMMERCIAL building volume. R310 is a
  // residential egress section; it was opening FBC-Building.
  {
    const miami = resolveCodeJurisdiction({ city: 'Miami', state: 'FL' });
    ok('a Florida citation opens no volume, because the row names a family of books',
      viewerLinkForCitation(miami, 'Florida Building Code') === null &&
      viewerLinkForCitation(miami, 'FBC 2023') === null);
    ok('and neither does the residential citation that used to open the commercial volume',
      citationEvidenceFor(miami, 'Florida Building Code', 'R310.1').viewerUrl === null);
    ok('the Florida rows carry no ICC volume id at all',
      ALL.filter((e) => e.state === 'FL')
        .every((e) => e.codes.every((c) => !c.iccVolumeId && !c.iccVolumeTitle)));
  }

  // AND THE SAME THING THROUGH THE FUNCTION THE SCREEN ACTUALLY CALLS.
  // The block above tests the helper. It was all that existed at first, and a
  // mutation that reverted citationEvidenceFor to `viewerLinks[0]` left every
  // assertion above green while the UI went back to offering the wrong book.
  // A guard on a helper is not a guard on the caller.
  ok('citationEvidenceFor hands an IRC citation the IRC volume, not the first on the row',
    citationEvidenceFor(wash, 'IRC 2021', 'R310.1').viewerUrl === 'https://codes.iccsafe.org/content/IRC2021P1');
  ok('citationEvidenceFor hands an RCNYS citation the RCNYS volume, not the energy code',
    citationEvidenceFor(ithaca, '2025 RCNYS', 'R310.1').viewerUrl === 'https://codes.iccsafe.org/content/NYSRC2025P1');
  ok('citationEvidenceFor offers NO volume for a code the address does not adopt',
    citationEvidenceFor(wash, 'IPC 2021', '701.1').viewerUrl === null);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\nthe rungs — a citation never stands higher than its evidence:');
// ─────────────────────────────────────────────────────────────────────

const wa = resolveCodeJurisdiction({ city: 'Spokane', state: 'WA' });
const ny = resolveCodeJurisdiction({ city: 'Ithaca', state: 'NY' });
const nowhere = resolveCodeJurisdiction({ state: '' });

// THE EXEMPLAR IS PINNED TO A CITE A HUMAN OPENED, not chosen by find().
//
// It used to be `.find(a => a.state === 'WA' && a.family === 'IBC' && …)`,
// which sounds safer than naming one — it cannot outlive the row it tests.
// What it actually did was resolve to WAC 51-50-480101, an IEBC section
// mislabelled IBC, and prove the whole rung-1 block against it. A mislabelled
// row behaves exactly like a correct one under every check below, so the
// suite's flagship proof was green on the defect. Choosing the subject from
// the data means the data chooses what gets proven. That is why the cite is
// written out here, and why it stays written out.
//
// It was then re-pinned to WAC 51-50-0303, a hand-checked IBC row in the
// generated table. That table is withdrawn, so rung 1 is now proven against a
// row a human read end to end: 19 NYCRR § 1220.2(e)(3), New York's amendment
// to Appendix BA § BA113.3 of the 2025 RCNYS, fetched 2026-09-13 via curl -L
// + pdftotext -layout. This is a NAMED-VOLUME row (codeName '2025 Residential
// Code of New York State'), so it exercises the codeName path through
// jurisdictionAdopts and citationNames rather than the bare family+edition
// path the WA row exercised — see the note at the foot of this block.
const NY_EXEMPLAR_CITE = '19 NYCRR § 1220.2(e)(3)';
const nyAmended = HAND_VERIFIED_AMENDMENTS.find((a) => a.cite === NY_EXEMPLAR_CITE);
ok(`the table still holds the hand-read exemplar ${NY_EXEMPLAR_CITE}`, !!nyAmended);
ok('and it is what the human who read it recorded: a NY RCNYS 2025 section with text',
  !!nyAmended && nyAmended.state === 'NY' && nyAmended.edition === '2025' &&
  nyAmended.codeName === '2025 Residential Code of New York State' &&
  nyAmended.section === 'BA113.3' && nyAmended.amendmentText.length > 0 &&
  nyAmended.textComplete === true);

if (nyAmended) {
  const ev = citationEvidenceFor(ny, '2025 RCNYS', nyAmended.section);
  ok('RUNG 1: an exactly-amended section reads as a state amendment',
    ev.rung === 'amended' && ev.rungIndex === 1 && ev.badge === 'STATE AMENDMENT');
  ok('RUNG 1: it quotes the STATE text and cites the register',
    ev.quote === nyAmended.amendmentText && ev.sourceLabel === nyAmended.cite);
  ok('RUNG 1: it links the register, never a code publisher',
    ev.sourceUrl === nyAmended.sourceUrl && !/iccsafe/i.test(ev.sourceUrl ?? ''));
  ok('RUNG 1: it is not a parent match', ev.parentMatch === false);
  // A GREEN BADGE MUST NOT READ AS VOUCHING FOR THE PROSE ABOVE IT. The badge
  // sits directly under the model's own requirement summary; what MAGE
  // actually verified is a register entry, and the exact-match sentence used
  // to say nothing at all about the difference.
  ok('RUNG 1: it says the requirement summarised above it is still recall',
    ev.detail.includes('still the model’s recall'));

  // The parent case. It must NOT claim the cited subsection.
  const child = `${nyAmended.section}.99.99`;
  const pev = citationEvidenceFor(ny, '2025 RCNYS', child);
  ok('PARENT: a subsection of an amended section matches the PARENT, and says so',
    pev.rung === 'amended' && pev.parentMatch === true && pev.badge === 'PARENT SECTION AMENDED');
  ok('PARENT: it explicitly refuses to vouch for the cited subsection',
    pev.detail.includes('did NOT verify') && pev.detail.includes(child));

  // A DIFFERENT EDITION IS A DIFFERENT LAW. The model naming 2022 must not
  // collect New York's 2025 amendments.
  ok('an edition the model states and the register contradicts does not match',
    citationEvidenceFor(ny, '2022 RCNYS', nyAmended.section).rung === 'edition');
  // A different VOLUME must not match either. The BCNYS is a real New York
  // volume and a different book; this row is the RCNYS's.
  ok('a different volume does not collect this volume\'s amendments',
    citationEvidenceFor(ny, '2025 BCNYS', nyAmended.section).rung === 'edition');
  // A different STATE must not.
  ok('New York amendments never answer for a Pennsylvania address',
    citationEvidenceFor(resolveCodeJurisdiction({ state: 'PA' }), '2025 RCNYS', nyAmended.section).rung === 'edition');
  // And a Washington address must not collect them either — the state the
  // withdrawn generated rows used to serve now has no amendment rows at all,
  // and must read as recall rather than borrowing New York's.
  ok('a Washington citation reads as recall, not as somebody else\'s amendment',
    citationEvidenceFor(wa, 'IBC 2021', '506').rung === 'edition' &&
    citationEvidenceFor(wa, '2025 RCNYS', nyAmended.section).rung === 'edition');
}

// RUNG 2 — named in law, no text held. New York's is the live example.
const nyNamed = HAND_VERIFIED_AMENDMENTS.find((a) => a.state === 'NY' && a.amendmentText === '');
ok('a hand-read NY row names a section without reproducing it', !!nyNamed);
if (nyNamed) {
  const ev = citationEvidenceFor(ny, '2025 RCNYS', nyNamed.section);
  ok('RUNG 2: a named-but-unreproduced section reads as named in law',
    ev.rung === 'named' && ev.rungIndex === 2 && ev.badge === 'SECTION NAMED IN LAW');
  ok('RUNG 2: it holds NO text and says the requirement is not reproduced',
    ev.quote === null && ev.detail.includes('does not reproduce'));
  ok('RUNG 2: it still hands over the government citation and link',
    ev.sourceUrl === nyNamed.sourceUrl && ev.sourceLabel === nyNamed.cite);
}

// RUNG 3 — edition known, section unknown. Philadelphia, because MAGE has a
// verified IRC 2021 adoption there AND an ICC volume for it, so this case can
// also prove the viewer link survives to the recall rung.
const r3 = citationEvidenceFor(resolveCodeJurisdiction({ city: 'Philadelphia', state: 'PA' }), 'IRC 2021', 'R310.1');
ok('RUNG 3: a section MAGE has no record of reads as model recall, edition known',
  r3.rung === 'edition' && r3.rungIndex === 3 && r3.badge === 'MODEL RECALL \u00b7 EDITION KNOWN');
ok('RUNG 3: it still names the verified edition and the date it was checked',
  r3.detail.includes('2021') && r3.detail.includes('checked'));
// And the honest converse: a jurisdiction whose code ICC does not publish as
// a volume gets NO link rather than a link to somebody else's book.
{
  const nycRecall = citationEvidenceFor(resolveCodeJurisdiction({ city: 'Brooklyn', state: 'NY' }), 'NYC BC 2022', '1030.1');
  ok('RUNG 3 with no matching volume offers no link at all',
    nycRecall.rung === 'edition' && nycRecall.viewerUrl === null);
}
ok('RUNG 3: it hands over the governing volume in ICC\'s free viewer',
  r3.viewerUrl !== null && r3.viewerUrl.startsWith('https://codes.iccsafe.org/content/'));
ok('RUNG 3: that link is VOLUME level — it can never carry a section',
  !!r3.viewerUrl && !r3.viewerUrl.includes('R310') && r3.viewerUrl.split('/content/')[1].indexOf('/') === -1);

// RUNG 4 — no jurisdiction at all.
const r4 = citationEvidenceFor(nowhere, 'IRC 2021', 'R310.1');
ok('RUNG 4: an unresolved address reads as recall with no jurisdiction',
  r4.rung === 'unresolved' && r4.rungIndex === 4 && r4.badge === 'MODEL RECALL \u00b7 NO JURISDICTION');
ok('RUNG 4: it offers no citation and no viewer link, because it has none',
  r4.sourceUrl === null && r4.viewerUrl === null && r4.quote === null);

// THE FOUR BADGES ARE DISTINGUISHABLE AT A GLANCE. If two rungs printed the
// same words the ladder would be decoration.
const badges = [
  nyAmended ? citationEvidenceFor(ny, '2025 RCNYS', nyAmended.section).badge : 'x',
  nyNamed ? citationEvidenceFor(ny, '2025 RCNYS', nyNamed.section).badge : 'y',
  r3.badge, r4.badge,
];
ok('all four rungs print a DIFFERENT badge', new Set(badges).size === 4);
ok('rung order is strictly strongest-first', RUNG_INDEX.amended < RUNG_INDEX.named &&
  RUNG_INDEX.named < RUNG_INDEX.edition && RUNG_INDEX.edition < RUNG_INDEX.unresolved);

// An EMPTY section can never climb the ladder: there is nothing to match.
// Asked of New York, which HOLDS amendment rows for the cited volume — asked
// of a state with no rows it would pass on the absence of rows rather than on
// the empty section, which is not the thing being proven.
ok('a citation with no section number stays on the recall rung',
  citationEvidenceFor(ny, '2025 RCNYS', '').rung === 'edition' &&
  bestAmendmentFor(ny, '2025 RCNYS', '') === null);

// Parsing the model's own words. Giving up is safe; guessing is not.
ok('familyFromCitedCode reads the abbreviations', familyFromCitedCode('IBC 2021') === 'IBC' &&
  familyFromCitedCode('IRC 2021') === 'IRC' && familyFromCitedCode('NFPA 70') === 'NEC');
ok('familyFromCitedCode reads the long names',
  familyFromCitedCode('2021 International Residential Code') === 'IRC');
ok('IFGC is not read as the fire code', familyFromCitedCode('IFGC 2024') === 'IFGC');
ok('an AMBIGUOUS string names no family rather than picking one',
  familyFromCitedCode('IBC and IRC 2021') === null);
ok('a string naming no family gives up', familyFromCitedCode('NYC BC 2022') === null &&
  familyFromCitedCode('') === null);

// The summary line counts, and counts honestly.
const mixed = [
  nyAmended ? citationEvidenceFor(ny, '2025 RCNYS', nyAmended.section) : r3,
  r3, r3,
];
ok('rungTally counts each rung', rungTally([r3, r4]).edition === 1 && rungTally([r3, r4]).unresolved === 1);
ok('weakestRung reports the WEAKEST citation, not the strongest',
  weakestRung([r3, r4]) === 'unresolved' && weakestRung([r3]) === 'edition');
ok('the summary line never overstates how much is backed',
  rungSummaryLine([r3, r3]).startsWith('None of these 2') &&
  (!nyAmended || rungSummaryLine(mixed).startsWith('1 of 3')));
ok('the summary line on an empty list says nothing at all', rungSummaryLine([]) === '');

// A PARENT MATCH IS NOT BACKING, AND THE SUMMARY LINE USED TO SAY IT WAS.
// `backed` was amended+named by RUNG, and both rungs include the parent-only
// variant whose own detail sentence reads "MAGE did NOT verify § … itself".
// Three Spokane citations, two parent-only, printed "2 of 3 are backed by a
// government document MAGE has read" (executed 2026-09-13). This is the one
// line a contractor reads before scanning. Re-driven off the New York row now
// that the Spokane rows are withdrawn; the wording under test is the summary
// line's, not the row's.
if (nyAmended) {
  const parentEv = citationEvidenceFor(ny, '2025 RCNYS', `${nyAmended.section}.99.99`);
  ok('the parent case really is a parent match (the control for what follows)',
    parentEv.parentMatch === true && parentEv.rung === 'amended');
  const line = rungSummaryLine([parentEv, parentEv, r3]);
  ok('a parent-only citation is never counted as backed', !/\bbacked\b/.test(line));
  ok('it is reported in its own words instead',
    line.includes('amended PARENT section') && line.includes('the cited number itself is unverified'));
  ok('and the recall citation beside it is still counted as recall', line.includes('1 is model recall'));
  // The control: an EXACT match still says backed, so the fix is not "never
  // say backed".
  ok('an exactly-matched citation is still reported as backed',
    rungSummaryLine([citationEvidenceFor(ny, '2025 RCNYS', nyAmended.section), r3]).startsWith('1 of 2 is backed'));
}

// AN AMENDMENT TO ONE VOLUME IS NOT THE LAW OF A DIFFERENT, LOCALLY-TITLED
// ONE. `jurisdictionAdopts` used to match on family+edition alone, so
// Washington's bare-IBC WAC 51-50-1011 fired for a Seattle address under a
// green STATE AMENDMENT badge while the chip above it named the 2021 Seattle
// Building Code and Seattle's own amendment was neither held nor mentioned.
// The module was linking conservatively (viewerUrl is correctly null for
// Seattle, by the iccVolumeId name rule) and quoting permissively.
//
// The Seattle case was proven against a generated bare-IBC Washington row, and
// with the generated table withdrawn MAGE holds no bare-model-code rows at all
// — every surviving row carries a `codeName`. The rule is unchanged and still
// worth guarding, so it is guarded on the half that still has a live subject:
// New York State's own RCNYS amendment, against New York City, which adopts
// the NYC Construction Codes and not the RCNYS.
{
  const nyc = resolveCodeJurisdiction({ city: 'Brooklyn', state: 'NY' });
  ok('New York City really does adopt its own construction codes (the control)',
    nyc.kind === 'city' && nyc.entry.codes.some((c) => c.name === 'NYC Construction Codes'));
  ok('a state RCNYS amendment does not answer for a New York City address',
    nyAmended ? citationEvidenceFor(nyc, '2025 RCNYS', nyAmended.section).rung === 'edition' : false);
  ok('and it still answers upstate, where the RCNYS is the adopted volume',
    nyAmended ? citationEvidenceFor(ny, '2025 RCNYS', nyAmended.section).rung === 'amended' : false);
  // The Seattle side of the same rule, kept because Seattle is still in the
  // jurisdiction table and a row named for the Seattle Building Code must
  // never be answerable from a volume MAGE holds under another name.
  const seattle = resolveCodeJurisdiction({ city: 'Seattle', state: 'WA' });
  ok('Seattle really does adopt a locally-titled volume (the control)',
    seattle.kind !== 'unknown' && seattle.entry.codes.some((c) => c.name === '2021 Seattle Building Code'));
  ok('nothing MAGE holds answers for the Seattle Building Code',
    citationEvidenceFor(seattle, 'IBC 2021', '1011').rung === 'edition' &&
    citationEvidenceFor(seattle, '2021 Seattle Building Code', '1011').rung === 'edition');
}

// THE PROVENANCE SEAL AND ITS MUTATION TESTS ARE GONE WITH THEIR SUBJECT.
// `amendmentsFingerprint` hashed the GENERATED table and was compared against
// the constant the generator wrote, to stop a hand-edit passing as generated
// evidence. With no generator there is no such thing as a hand-edit here — the
// only way a row arrives is by hand, and what makes it evidence is `readBy`,
// `sourceUrl` and `checkedOn`, which are asserted at the top of this section.
// Keeping the seal would mean hashing hand-written rows and comparing them to
// a constant a human also wrote: a check that can only ever restate its input.
// The function was deleted from utils/codeAmendments.ts rather than left
// exported with nothing to seal.

// ─────────────────────────────────────────────────────────────────────
console.log('\nthe screen — the ladder is rendered, and the recall chip is not:');
// ─────────────────────────────────────────────────────────────────────
{
  const code = src('app/(tabs)/construction-ai/index.tsx');
  ok('screen: every citation gets a rung badge, including the recall ones',
    /<RungBadge ev=\{ev\}/.test(code) && /testID=\{`code-check-rung-\$\{i\}`\}/.test(code));
  ok('screen: the rung comes from citationEvidenceFor, not from local wording',
    /citationEvidenceFor\(jurisdiction, c\.code, c\.section/.test(code));
  ok('screen: the ladder uses the jurisdiction SENT with the result, not the live form',
    /setResultJurisdiction\(jurisdiction\)/.test(code) && /jurisdiction=\{resultJurisdiction\}/.test(code));
  // Pinned on the FULL quoted testID, not a substring of it. The first draft
  // of this guard compared indexOf('code-check-rung-summary') against
  // indexOf('code-check-recall-chip'), and renaming the summary's testID to
  // 'code-check-rung-summary-moved' still matched — the guard stayed green
  // while its subject had been renamed out from under it. Substring matching
  // is how a name-grep guard lies.
  {
    const iChip = code.indexOf('testID="code-check-recall-chip"');
    const iSummary = code.indexOf('testID="code-check-rung-summary"');
    ok('screen: the recall chip is still rendered, under its own testID', iChip >= 0);
    ok('screen: the rung summary sits BELOW the recall chip and does not replace it',
      iSummary > iChip && iChip >= 0);
  }
  ok('screen: the model-recall chip is still exactly where and what it was',
    /From model recall — verify with your AHJ before relying on a section number/.test(code));
  ok('screen: the prompt still tells the model it has no code lookup',
    /You have no code lookup here: a section number is your own recall/.test(code));
  ok('screen: the loading copy still says Recalling, never Searching',
    /Recalling the codes that apply/.test(code) && !/Searching the codes/.test(code));
  // THE OLD VERSION OF THE NEXT TWO GUARDS WAS FAKE, IN THE NAME-GREP SPECIES,
  // AND A REVIEWER PROVED IT ON 2026-09-13.
  //
  //   'the governing volume is openable from both chips' was
  //   /testID="code-check-viewer-links"/.test(code). Deleting BOTH
  //   <ViewerLinks …/> elements and leaving the testID strings inside comments
  //   left it green: 1798 passed, 0 failed with the entire Phase 1 UI removed.
  //   A substring search cannot tell "rendered" from "mentioned".
  //
  //   'no URL is ever assembled from a citation section number' was two
  //   regexes requiring a literal ('iccsafe.org' or 'ICC_VIEWER_BASE}')
  //   immediately before an interpolation. Rewriting the opener as
  //   Linking.openURL(`${l.url}/chapter-${citedSectionNumber}`) — a live,
  //   tappable, fabricated section link — was invisible to both: 1798 passed,
  //   0 failed. That guard was described in the build notes as "the only thing
  //   standing between this feature and a section-link fabrication machine".
  //
  // Both are now written against structure and behaviour.
  {
    // Rendered, not mentioned: the testID must sit inside a <ViewerLinks> tag.
    const viewerTags = [...code.matchAll(/<ViewerLinks\b[^>]*\/?>/g)].map((m) => m[0]);
    const renders = (id: string) =>
      viewerTags.some((t) => t.includes(`testID="${id}"`) && /links=\{[^}]*viewerLinks\}/.test(t));
    ok('screen: the governing volume is RENDERED from the code-check chip',
      renders('code-check-viewer-links'));
    ok('screen: and from the result chip',
      renders('code-check-viewer-links-result'));
    // THE THIRD SURFACE. It existed and nothing named it — grep for
    // plan-review-viewer-links in this file used to return zero hits.
    ok('screen: and from the plan-review chip, which was previously unguarded',
      renders('plan-review-viewer-links'));
    ok('screen: ViewerLinks is a real component in this file, not a stale name',
      /function ViewerLinks\(\{ links, testID \}/.test(code));
  }
  {
    // The opener. Every viewer tap goes through viewerUrlToOpen, which rebuilds
    // the URL from the volume id it re-parses, so a path appended anywhere
    // upstream is dropped rather than opened.
    ok('screen: the viewer opener re-checks the URL through viewerUrlToOpen',
      /const href = viewerUrlToOpen\(l\.url\);/.test(code) && /Linking\.openURL\(href\)/.test(code));
    ok('screen: nothing hands Linking.openURL the raw link URL any more',
      !/Linking\.openURL\(l\.url\)/.test(code));
    // And no opener anywhere in this screen may be handed an ASSEMBLED string.
    // This is the shape the reviewer's mutation took.
    ok('screen: no URL passed to Linking.openURL is assembled from anything',
      ![...code.matchAll(/Linking\.openURL\(([^)]*)\)/g)]
        .some((m) => /[`+]/.test(m[1]) || /\$\{/.test(m[1])));
  }
  ok('screen: a truncated amendment is labelled as an excerpt, never as the whole',
    /not all of it/.test(code) && /quoteComplete/.test(code));
}

// ── building-department blocks (added 2026-09-26, lane L1) ──────────────
// A department block is contact and process facts, read off nyc.gov. It is
// held to the same citation rules as the adoption rows: an https source on the
// authority's own site, and a checkedOn no older than a year.
{
  const withDept = LOCAL_ADOPTIONS.filter((e) => !!e.department);
  ok('department: the NYC row carries a department block', withDept.some((e) => e.name === 'New York City'));
  for (const e of withDept) {
    const d = e.department!;
    const who = `${e.name} department`;
    ok(`${who}: sourceUrl is https on the authority's site`, e.name !== 'New York City' || /^https:\/\/www\.nyc\.gov\//.test(d.sourceUrl));
    ok(`${who}: checkedOn is an ISO date`, /^\d{4}-\d{2}-\d{2}$/.test(d.checkedOn) && Number.isFinite(Date.parse(d.checkedOn)));
    ok(`${who}: checkedOn is not in the future and not older than one year`, (() => {
      const t = Date.parse(`${d.checkedOn}T00:00:00Z`);
      const now = Date.now();
      return t - now <= 24 * 60 * 60 * 1000 && now - t <= 365 * 24 * 60 * 60 * 1000;
    })());
    const urls = [d.portalUrl, d.statusLookupUrl, d.sourceUrl, ...d.questionChannels.map((c) => c.url), ...(d.feeScheduleUrls ?? []).map((f) => f.url)]
      .filter((u): u is string => !!u);
    ok(`${who}: every URL is https`, urls.every((u) => u.startsWith('https://')));
    ok(`${who}: every question channel says something`, d.questionChannels.length > 0 && d.questionChannels.every((c) => c.label.trim() && c.note.trim()));
  }
  ok('department: departmentFor answers the NYC row and nothing else',
    !!departmentFor(resolveCodeJurisdiction({ city: 'Brooklyn', state: 'NY' }))
    && departmentFor(resolveCodeJurisdiction({ city: 'Portland', state: 'OR' })) === null
    && departmentFor(resolveCodeJurisdiction({ city: 'Houston', state: 'TX' })) === null
    && departmentFor(resolveCodeJurisdiction({})) === null
    && departmentFor(resolveCodeJurisdiction({ state: 'NY' })) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
