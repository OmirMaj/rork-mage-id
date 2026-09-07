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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EMPTY_JOBSITE_ADDRESS,
  LOCAL_ADOPTIONS,
  STATE_ADOPTIONS,
  codeClaimIds,
  codeLine,
  codeReceiptKey,
  codesSummary,
  groundingFactsFor,
  issuingAuthorityForAddress,
  jobsiteAddressForProject,
  normalizePlace,
  normalizeState,
  resolveCodeJurisdiction,
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
  for (const field of ['matchCity', 'matchCounty'] as const) {
    const owner = new Map<string, string>();
    for (const e of LOCAL_ADOPTIONS) {
      for (const m of e[field] ?? []) {
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
