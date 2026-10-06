// scripts/validate-building-record.ts — the NYC building record, offline.
//
// Pure: no network. It drives the SAME normalizer the edge function runs
// (supabase/functions/building-record/normalize.ts) over the fixtures the
// probe saved (scripts/fixtures/building-record/*.json, personal fields
// stripped), and the ONE client renderer (utils/buildingRecord.ts), and holds
// them to the honesty rules:
//   - a failed dataset reads 'not checked', never 0;
//   - a full page reads 'at least' and can never say 'No active …';
//   - nothing ever calls a building clean, all clear or compliant;
//   - only fixed error texts leave the function; personal columns never do.
//
// Sections 31-40 (2026-09-28): the Baltimore City / Baltimore County record
// (supabase/functions/building-record/md.ts + the MD client renderer): SAFE
// outFields as sets, the bounded resolve planner, City vs County by parcel
// containment, "not checked" never zero, the 2,400-char promptBlock.
//
// Run: bun run scripts/validate-building-record.ts   (test:building-record)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIVE_FILTERS, DATASETS, ERRORS, FILING_DONE_STATUSES, NOT_CHECKED, RECORD_DATASET_IDS,
  assembleRecord, benchmarkFrom, benchmarkUrl, candidatesFromGeosearch, datasetUrl, failedDataset,
  failedParcel, geosearchUrl, normalizeDataset, normalizeParcel, parseRequest, permitMatches, permitUrls,
  reviewStats, sanitizeBbl, sanitizeBin, sanitizeBorough, sanitizePermitNumber, sanitizeText,
  type BuildingRecordDataset, type DatasetId,
} from '../supabase/functions/building-record/normalize';
import {
  BUILDING_RECORD_NOT_CHECKED, buildingConfirmKey, buildingLookupText, buildingRecordCacheKey,
  filingForPermit, isNycJobsite, parseBuildingRecordResponse, suggestPermitStatusFromDob,
  summarizeBuildingRecord, type BuildingRecord, type BuildingRecordSummary,
  NJ_NOT_CHECKED, NJ_PERMIT_CAVEAT, isNjJobsite, njDollars, njParcelConfirmKey, parseNjBuildingRecordResponse, summarizeNjBuildingRecord,
  MD_NOT_CHECKED_CITY, MD_NOT_CHECKED_COUNTY, MD_PROMPT_CAP, MD_SOURCES, isMdJobsite, mdBuildingRecordCacheKey, mdParcelConfirmKey,
  mdPermitForNumber, mdRecordLinks, parseMdBuildingRecordResponse, summarizeMdBuildingRecord, type MdBuildingRecord as ClientMdRecord,
} from '../utils/buildingRecord';
import {
  departmentFor, resolveCodeJurisdiction,
} from '../utils/codeJurisdiction';
import {
  NJ_CANDIDATE_CAP, NJ_ERRORS, NJ_NOT_CHECKED as NJ_NOT_CHECKED_SRV, NJ_PERMIT_CAVEAT as NJ_PERMIT_CAVEAT_SRV, NJ_PERMIT_SELECT,
  addressKey, assembleNjRecord, censusFirstMatch, censusLocationsUrl, dollarsToCents, failedNjPermits, mergeNjCandidates,
  njMuniFreshnessUrl, njParcelAddressUrl, njParcelBufferUrl, njPermitsUrl, normalizeBlockLot, normalizeNjFreshness,
  normalizeNjPermits, parseNjRequest, propLocMatches, rankNjCandidates, sanitizeBlockLot, sanitizeLat, sanitizeLon, sanitizeMuniCode,
} from '../supabase/functions/building-record/nj';
import {
  MD_ERRORS, MD_LAYERS, MD_SAFE_FIELDS, MD_NOT_CHECKED_CITY as MD_NOT_CHECKED_CITY_SRV, MD_NOT_CHECKED_COUNTY as MD_NOT_CHECKED_COUNTY_SRV,
  asOfFrom, assembleMdRecord, bfeOrNull, censusCounty, censusCountyUrl, cityBlockLotVariants, cityGeocodeUrl, countQueryUrl, countyGeocodeUrl, geocodePoints,
  isAllowedMdUrl, ldateDay, mdAddressInput, mdCensusFallback, mdCensusOutside, mdDay, mdDollarsToCents, mdRecordComplete, mdRecordPlan, mdResolveOutcome, mdWhere,
  normalizeCityBlockLot, parcelHitFrom, parcelPointUrl, parseMdRequest, planMdResolve, pointQueryUrl, probeIsRedundant, runBounded, yearOrNull,
  type MdBuildingRecord as MdRecordSrv, type MdFetched, type MdGeoPoint, type MdJobId, type MdProbe,
} from '../supabase/functions/building-record/md';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
/** Structural deep equality: same keys (order-free), same values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).sort(), kb = Object.keys(b as object).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const FIX = join('scripts', 'fixtures', 'building-record');
const TODAY = new Date('2026-09-26T12:00:00Z');
const BIN = '1001026';
const BBL = '1000477501';
const SLOP = /\bclean\b|all clear|no violations\b|compliant/i;

type Fixture = { id: DatasetId; asOfHeader: string | null; rows: Record<string, unknown>[] };
const fixture = (name: string): Fixture => JSON.parse(read(join(FIX, name)) || '{"rows":[]}');

function allStrings(s: BuildingRecordSummary): string[] {
  return [s.headline, s.chipLabel, s.promptBlock, ...s.lines];
}
function recordFrom(datasets: BuildingRecordDataset[], opts: { ecbRaw?: unknown; parcel?: ReturnType<typeof normalizeParcel>; bbl?: string } = {}): BuildingRecord {
  return assembleRecord({
    bin: BIN, bbl: opts.bbl ?? BBL, label: '120 BROADWAY', fetchedAt: TODAY, datasets,
    parcel: opts.parcel ?? normalizeParcel([{ zonedist1: 'C5-5', version: '26v2' }], 'Mon, 24 Aug 2026 20:20:51 GMT'),
    ecbRaw: opts.ecbRaw ?? [],
  });
}
const AS_OF = 'Fri, 25 Sep 2026 17:00:00 GMT';
/** Every record set, ok, zero rows, untruncated. */
const zeroDatasets = (): BuildingRecordDataset[] => RECORD_DATASET_IDS.map((id) => normalizeDataset(id, [], AS_OF, TODAY));

// ── the real fixtures (120 Broadway, probed 2026-09-26) ─────────────────────
const fixtureRecord = (() => {
  const datasets: BuildingRecordDataset[] = [];
  let ecbRaw: unknown = [];
  for (const id of RECORD_DATASET_IDS) {
    const f = fixture(`${id}.json`);
    if (id === '6bgk-3dad') ecbRaw = f.rows;
    datasets.push(normalizeDataset(id, f.rows, f.asOfHeader, TODAY));
  }
  const p = fixture('64uk-42ks.json');
  return recordFrom(datasets, { ecbRaw, parcel: normalizeParcel(p.rows, p.asOfHeader) });
})();

console.log('\nbuilding record (NYC DOB public datasets):');

// ── 1. sanitizers + URL hosts ───────────────────────────────────────────────
ok('1. sanitizeBin rejects an injection', sanitizeBin("1001026' OR '1'='1") === null && sanitizeBin('1001026') === '1001026');
ok('1. sanitizeBbl rejects a 9-digit bbl', sanitizeBbl('100047750') === null && sanitizeBbl(BBL) === BBL);
ok("1. sanitizePermitNumber rejects 'B00;DROP'", sanitizePermitNumber('B00;DROP') === null && sanitizePermitNumber('m01448433-i1') === 'M01448433-I1');
ok('1. sanitizeBorough rejects a borough not in the list, maps New York / The Bronx',
  sanitizeBorough('Hoboken') === null && sanitizeBorough('new york') === 'MANHATTAN' && sanitizeBorough('the bronx') === 'BRONX' && sanitizeBorough('Staten  Island') === 'STATEN ISLAND');
ok('1. sanitizeText rejects control chars only by stripping, and >200 chars', sanitizeText('a\u0000b') === 'a b' && sanitizeText('x'.repeat(201)) === null);
ok('1. parseRequest refuses a bad body', parseRequest({ mode: 'record', bin: "1' OR '1'='1", bbl: BBL }) === null && parseRequest(null) === null && parseRequest({ mode: 'nope' }) === null);
const builtUrls = [
  ...[...RECORD_DATASET_IDS, '64uk-42ks' as DatasetId].map((id) => datasetUrl(id, BIN, BBL, TODAY)),
  geosearchUrl('120 Broadway, New York, NY'), benchmarkUrl('BROOKLYN', TODAY), ...permitUrls('M01448433-I1').map((p) => p.url), ...permitUrls('140994271').map((p) => p.url),
];
ok('1. every built URL starts with one of the two upstream hosts',
  builtUrls.length > 10 && builtUrls.every((u) => !!u && (u.startsWith('https://data.cityofnewyork.us/resource/') || u.startsWith('https://geosearch.planninglabs.nyc/v2/search'))),
  builtUrls.filter((u) => !u || !(u.startsWith('https://data.cityofnewyork.us/resource/') || u.startsWith('https://geosearch.planninglabs.nyc/v2/search'))).join(', '));
ok('1. an unsanitized bin builds no URL', datasetUrl('3h2n-5cm9', "1' OR 1=1", BBL, TODAY) === null && benchmarkUrl('Hoboken', TODAY) === null && permitUrls('B00;DROP').length === 0);

// ── 2. server-side active filters ───────────────────────────────────────────
const whereOf = (u: string | null) => decodeURIComponent((/\$where=([^&]*)/.exec(u ?? '') ?? [])[1] ?? '');
for (const [id, filter] of Object.entries(ACTIVE_FILTERS) as [DatasetId, string][]) {
  const w = whereOf(datasetUrl(id, BIN, BBL, TODAY));
  ok(`2. ${id} $where holds its ACTIVE filter and the bin`, w.includes(filter) && w.includes(`bin='${BIN}'`), w);
}
ok("2. the four filters are the spec's", ACTIVE_FILTERS['3h2n-5cm9'] === "violation_category like '%ACTIVE%'" && ACTIVE_FILTERS['6bgk-3dad'] === "ecb_violation_status='ACTIVE'"
  && ACTIVE_FILTERS['855j-jady'] === "upper(violation_status)='ACTIVE'" && ACTIVE_FILTERS['eabe-havv'] === "status='ACTIVE'");
ok("2. rbx6 is filtered to 'Permit Issued' and unexpired on the server", /permit_status='Permit Issued'/.test(whereOf(datasetUrl('rbx6-tga4', BIN, BBL, TODAY))) && /expired_date >= '2026-09-26T00:00:00'/.test(whereOf(datasetUrl('rbx6-tga4', BIN, BBL, TODAY))));
ok('2. per-dataset limits are the spec\'s', DATASETS['3h2n-5cm9'].limit === 500 && DATASETS['6bgk-3dad'].limit === 500 && DATASETS['855j-jady'].limit === 500 && DATASETS['eabe-havv'].limit === 500
  && DATASETS['w9ak-ipjd'].limit === 25 && DATASETS['rbx6-tga4'].limit === 100 && DATASETS['ipu4-2q9a'].limit === 25);
ok('2. owner/respondent/permittee/phone columns are never selected', builtUrls.every((u) => !/owner|respondent|permittee|phone|filing_representative/i.test(decodeURIComponent(u ?? ''))));

// ── 3. failed dataset ───────────────────────────────────────────────────────
{
  const ds = zeroDatasets();
  ds[0] = failedDataset('3h2n-5cm9', 'failed');
  ds[1] = failedDataset('6bgk-3dad', 'timeout');
  const rec = recordFrom(ds);
  const s = summarizeBuildingRecord(rec);
  ok('3. a failed dataset is status failed with activeCount null', rec.datasets[0].status === 'failed' && rec.datasets[0].activeCount === null && rec.datasets[0].returned === null);
  ok('3. summarize prints "… not checked (the request failed)" / "(the request timed out)"',
    s.lines.includes('DOB Violations: not checked (the request failed)') && s.lines.includes('DOB ECB Violations: not checked (the request timed out)'), s.lines.join(' | '));
  ok("3. and never '0 active'", allStrings(s).every((x) => !/\b0 active/.test(x)));
  ok('3. a failed ECB set has no balance (null, not 0)', rec.ecbBalanceDue === null);
  ok('3. a record with a failed set is incomplete', s.kind === 'incomplete');
  ok('3. a non-array upstream body normalizes to failed', normalizeDataset('855j-jady', { error: 'x' }, AS_OF, TODAY).status === 'failed');
  ok('3. a missing dataset is filled in as failed, never dropped', recordFrom(ds.slice(2)).datasets.length === RECORD_DATASET_IDS.length && recordFrom(ds.slice(2)).datasets[0].status === 'failed');
}

// ── 4. truncation ───────────────────────────────────────────────────────────
{
  const synth = fixture('synthetic-6bgk-3dad-full-page.json');
  ok('4. the synthetic fixture is a full page', synth.rows.length === DATASETS['6bgk-3dad'].limit);
  const ecb = normalizeDataset('6bgk-3dad', synth.rows, synth.asOfHeader, TODAY);
  ok('4. returned === limit ⇒ truncated', ecb.truncated && ecb.returned === ecb.limit);
  const ds = zeroDatasets();
  ds[1] = ecb;
  const rec = recordFrom(ds, { ecbRaw: synth.rows });
  const s = summarizeBuildingRecord(rec);
  const line = s.lines.find((l) => l.includes('DOB ECB Violations')) ?? '';
  ok("4. the truncated line says 'at least'", line.startsWith('at least 500 active ECB violations'), line);
  ok("4. a truncated ECB set prints 'at least $'", line.includes('at least $5,000.00 balance due as published (more rows than MAGE read)') && rec.ecbBalanceIsPartial, line);
  ok("4. the headline carries 'at least'", s.headline.includes('at least 500 active ECB violations') && s.headline.includes('at least $5,000.00'), s.headline);
  ok("4. no line for it starts 'No active'", !s.lines.some((l) => l.startsWith('No active') && l.includes('ECB')));

  // A truncated set with ZERO counted actives (the client refined the server
  // filter away): must never read 'No active' and must yield 'incomplete'.
  const starred = Array.from({ length: 500 }, (_, i) => ({ bin: BIN, violation_number: `X${i}`, violation_category: 'V*-DOB VIOLATION - ACTIVE*', issue_date: '20240101' }));
  const refined = normalizeDataset('3h2n-5cm9', starred, AS_OF, TODAY);
  const ds2 = zeroDatasets();
  ds2[0] = refined;
  const s2 = summarizeBuildingRecord(recordFrom(ds2));
  const l2 = s2.lines[0];
  ok('4. a truncated zero-active set reads "at least N matching rows; MAGE read only the first …"', refined.activeCount === 0 && refined.truncated
    && l2 === 'DOB Violations: at least 500 matching rows; MAGE read only the first 500, so it cannot say none are active (as of 2026-09-25)', l2);
  ok("4. an otherwise all-zero record with one truncated set is 'incomplete', never 'no_active_in_checked'", s2.kind === 'incomplete', s2.kind);
  // Every truncated dataset position, one at a time: never no_active_in_checked.
  const everyPos = RECORD_DATASET_IDS.every((_, i) => {
    const d = zeroDatasets();
    d[i] = { ...d[i], truncated: true, returned: d[i].limit };
    return summarizeBuildingRecord(recordFrom(d)).kind !== 'no_active_in_checked';
  });
  ok('4. a truncated dataset in ANY position can never yield no_active_in_checked', everyPos);
}

// ── 5. filings wording ──────────────────────────────────────────────────────
{
  const s = summarizeBuildingRecord(fixtureRecord);
  const line = s.lines.find((l) => l.includes('DOB NOW filings')) ?? '';
  ok("5. the filings line starts 'Latest ' and never says 'on record'", line.startsWith('Latest 25 DOB NOW filings (newest first, as of 2026-09-25); newest M01392399-P2') && !/on record/i.test(line), line);
  ok("5. the BIS line starts 'Latest ' too", s.lines.some((l) => l.startsWith('Latest 25 BIS permits')));
  ok('5. no summary string says "on record"', allStrings(s).every((x) => !/on record/i.test(x)));
}

// ── 6. no slop anywhere ─────────────────────────────────────────────────────
{
  const zero = summarizeBuildingRecord(recordFrom(zeroDatasets()));
  const all = [summarizeBuildingRecord(fixtureRecord), zero, summarizeBuildingRecord(null)];
  ok('6. no summary string matches clean / all clear / no violations / compliant', all.every((s) => allStrings(s).every((x) => !SLOP.test(x))),
    all.flatMap(allStrings).filter((x) => SLOP.test(x)).join(' | '));
}

// ── 7. the all-zero record ──────────────────────────────────────────────────
{
  const s = summarizeBuildingRecord(recordFrom(zeroDatasets()));
  ok("7. all-zero untruncated → 'no_active_in_checked'", s.kind === 'no_active_in_checked', s.kind);
  ok("7. its headline says 'Other agencies were not checked'", s.headline === `No active violations or complaints in the 4 DOB violation and complaint datasets MAGE checked for BIN ${BIN} (as of 2026-09-25). Other agencies were not checked.`, s.headline);
  ok("7. its last line starts 'Not checked:'", s.lines[s.lines.length - 1] === `Not checked: ${BUILDING_RECORD_NOT_CHECKED.join(', ')}.`);
  ok("7. the scoped 'No active X in <dataset> as of <day>' wording", s.lines[0] === 'No active DOB violations in DOB Violations as of 2026-09-25', s.lines[0]);
  ok('7. the promptBlock carries the headline, every line and the rules', s.promptBlock.startsWith('BUILDING RECORD (public NYC DOB datasets via NYC Open Data; each line names its dataset and date):\n')
    && s.lines.every((l) => s.promptBlock.includes(`- ${l}`)) && s.promptBlock.includes('not a finding by MAGE') && s.promptBlock.includes('applicant of record or expeditor'));
  ok('7. chipLabel = headline', s.chipLabel === s.headline);
  const none = summarizeBuildingRecord(undefined);
  ok("7. null → kind 'none', every string empty, cacheKey 'br:none'", none.kind === 'none' && none.headline === '' && none.promptBlock === '' && none.chipLabel === '' && none.lines.length === 0 && none.cacheKey === 'br:none');
  const failedPluto = summarizeBuildingRecord(recordFrom(zeroDatasets(), { parcel: failedParcel('timeout') }));
  ok('7. a failed PLUTO read is "not checked" and blocks no_active_in_checked', failedPluto.kind === 'incomplete' && failedPluto.lines.includes('PLUTO: not checked (the request timed out)'));
  // An empty PLUTO answer is a lot PLUTO does not have: never 'ok', never a checked lot.
  const emptyParcel = normalizeParcel([], AS_OF);
  ok("7. an empty PLUTO answer is not 'ok' and is marked notFound", emptyParcel.status !== 'ok' && emptyParcel.notFound === true, JSON.stringify(emptyParcel));
  const emptyPluto = summarizeBuildingRecord(recordFrom(zeroDatasets(), { parcel: emptyParcel }));
  ok("7. an empty PLUTO answer reads 'no lot found for BBL' and blocks no_active_in_checked", emptyPluto.kind === 'incomplete' && emptyPluto.lines.includes(`PLUTO: no lot found for BBL ${BBL}`), emptyPluto.lines.join(' | '));
  const reparsed = parseBuildingRecordResponse(JSON.parse(JSON.stringify({ status: 'record', record: recordFrom(zeroDatasets(), { parcel: emptyParcel }) })));
  ok('7. notFound survives the client parser', reparsed.status === 'record' && reparsed.record.parcel.notFound === true);

  // A current job (in-flight filing, issued unexpired permit) must never be
  // swallowed by a 'No active items' headline across all 7 datasets.
  const job = zeroDatasets();
  const wi = job.findIndex((d) => d.id === 'w9ak-ipjd');
  const pi = job.findIndex((d) => d.id === 'rbx6-tga4');
  job[wi] = normalizeDataset('w9ak-ipjd', [{ bin: BIN, job_filing_number: 'M9-I1', filing_status: 'Plan Examiner Review', filing_date: '2026-09-01T00:00:00.000' }], AS_OF, TODAY);
  job[pi] = normalizeDataset('rbx6-tga4', [{ bin: BIN, work_permit: 'M9-I1-GC', job_filing_number: 'M9-I1', permit_status: 'Permit Issued', work_type: 'General Construction', issued_date: '2026-05-01T00:00:00.000', expired_date: '2027-05-01T00:00:00.000' }], AS_OF, TODAY);
  const js = summarizeBuildingRecord(recordFrom(job, { parcel: normalizeParcel([{ zonedist1: 'R6', version: '26v2' }], AS_OF) }));
  ok('7. the job record really has an unexpired permit', (job[pi].activeCount ?? 0) > 0, String(job[pi].activeCount));
  ok("7. a record with an unexpired permit / in-flight filing never has a 'No active items' headline", !js.headline.startsWith('No active items') && !js.chipLabel.startsWith('No active items') && !js.promptBlock.includes('No active items'), js.headline);
  ok('7. its headline is scoped to the violation and complaint datasets', js.headline.startsWith('No active violations or complaints in the 4 DOB violation and complaint datasets'), js.headline);
  ok("7. a single unexpired permit is singular", js.lines.includes('1 issued, unexpired DOB NOW permit — DOB NOW: Build – Approved Permits, as of 2026-09-25'), js.lines.join(' | '));
  ok("7. a single filing is singular", js.lines.some((l) => l.startsWith('Latest DOB NOW filing (newest first')), js.lines.join(' | '));
  // Every record kind, over the fixture and synthetic cases: no headline ever says 'No active items'.
  const every = [summarizeBuildingRecord(fixtureRecord), s, js, emptyPluto, failedPluto];
  ok("7. no headline anywhere starts 'No active items'", every.every((x) => !x.headline.startsWith('No active items')));
}

// ── 8. ECB balance + VW ─────────────────────────────────────────────────────
{
  const raw = [
    { bin: BIN, ecb_violation_number: 'A1', ecb_violation_status: 'ACTIVE', balance_due: '1200.50', issue_date: '20250101' },
    { bin: BIN, ecb_violation_number: 'A2', ecb_violation_status: 'ACTIVE', balance_due: '99.5', issue_date: '20250102' },
    { bin: BIN, ecb_violation_number: 'R1', ecb_violation_status: 'RESOLVE', balance_due: '5000', issue_date: '20250103' },
  ];
  const ds = zeroDatasets();
  ds[1] = normalizeDataset('6bgk-3dad', raw, AS_OF, TODAY);
  ds[0] = normalizeDataset('3h2n-5cm9', [{ bin: BIN, violation_number: 'V1', violation_category: 'VW-VIOLATION WORK WITHOUT PERMIT - ACTIVE', issue_date: '20240312' }], AS_OF, TODAY);
  const rec = recordFrom(ds, { ecbRaw: raw });
  const s = summarizeBuildingRecord(rec);
  ok('8. ECB balance sums ACTIVE rows only', rec.ecbBalanceDue === 1300 && !rec.ecbBalanceIsPartial, String(rec.ecbBalanceDue));
  ok('8. the ECB line prints the balance as published', s.lines[1] === '2 active ECB violations — DOB ECB Violations, as of 2026-09-25, $1,300.00 balance due as published', s.lines[1]);
  ok('8. a VW category sets work_without_permit', ds[0].flags.includes('work_without_permit'));
  ok("8. the line says 'work-without-permit (VW)'", s.lines[0] === '1 active DOB violation — DOB Violations, as of 2026-09-25; includes work-without-permit (VW)', s.lines[0]);
  ok('8. issue_date YYYYMMDD normalizes to YYYY-MM-DD', ds[0].rows[0].date === '2024-03-12');
  ok("8. attention headline: short parts + 'ask your expeditor'", s.kind === 'attention' && s.headline === `DOB's public records for BIN ${BIN} show 1 active DOB violation, 2 active ECB violations, $1,300.00 ECB balance due — ask your expeditor before you price.`, s.headline);
  const obj = zeroDatasets();
  obj[4] = normalizeDataset('w9ak-ipjd', [{ bin: BIN, job_filing_number: 'M1-I1', filing_status: 'Objections', filing_date: '2026-09-01T00:00:00.000' }], AS_OF, TODAY);
  ok("8. a filing in objections is 'attention'", summarizeBuildingRecord(recordFrom(obj)).kind === 'attention');
  const lm = summarizeBuildingRecord(recordFrom(zeroDatasets(), { parcel: normalizeParcel([{ zonedist1: 'R6', landmark: 'INDIVIDUAL LANDMARK', histdist: 'Tribeca East', edesignum: 'E-123', pfirm15_flag: '1', version: '26v2' }], AS_OF) }));
  ok("8. landmark / historic district / E-designation are 'attention', stated as PLUTO facts", lm.kind === 'attention'
    && lm.lines.includes('PLUTO lists this lot as INDIVIDUAL LANDMARK') && lm.lines.includes('Historic district: Tribeca East') && lm.lines.includes('E-designation E-123')
    && lm.lines.includes('In the 2015 preliminary flood map (PFIRM)') && lm.lines.includes('Zoning R6 as published in PLUTO 26v2'), lm.lines.join(' | '));
}

// ── 9. no personal data ─────────────────────────────────────────────────────
{
  const dirty = {
    bin: BIN, ecb_violation_number: 'P1', ecb_violation_status: 'ACTIVE', balance_due: '1',
    respondent_name: 'JANE RESPONDENTPERSON', respondent_street: '1 MAIN ST', owner_name: 'OWNERCO LLC', permittee_s_phone__: '2125550100',
  };
  const w9 = { bin: BIN, job_filing_number: 'M9-I1', filing_status: 'Objections', owner_first_name: 'OWNERFIRST', owner_last_name: 'OWNERLAST', filing_representative_first_name: 'REPFIRST', applicant_first_name: 'Test', applicant_last_name: 'Applicant' };
  const ds = zeroDatasets();
  ds[1] = normalizeDataset('6bgk-3dad', [dirty], AS_OF, TODAY);
  ds[4] = normalizeDataset('w9ak-ipjd', [w9], AS_OF, TODAY);
  const j = JSON.stringify([recordFrom(ds, { ecbRaw: [dirty] }), fixtureRecord]);
  ok('9. no owner / respondent / representative name reaches a normalized record', !/RESPONDENTPERSON|OWNERCO|OWNERFIRST|OWNERLAST|REPFIRST|2125550100/.test(j));
  const keys = new Set<string>();
  JSON.parse(j, (k, v) => { if (k) keys.add(k); return v; });
  ok('9. no key matches /owner|phone|respondent|permittee/i', [...keys].every((k) => !/owner|phone|respondent|permittee/i.test(k)), [...keys].filter((k) => /owner|phone|respondent|permittee/i.test(k)).join(','));
  ok('9. only the applicant of record is kept', ds[4].rows[0].applicantName === 'Test Applicant');
  const fx = readdirSync(FIX).map((f) => read(join(FIX, f))).join('\n');
  ok('9. the committed fixtures hold no owner / respondent / permittee / phone key and no real applicant name',
    !/"[a-z_]*(owner|respondent|permittee|phone|filing_representative)[a-z_]*"\s*:/i.test(fx) && !/"applicant_(first|last)_name":\s*"(?!Test"|Applicant")/.test(fx));
}

// ── 10. GeoSearch ───────────────────────────────────────────────────────────
{
  const gs = { features: [
    { properties: { label: 'PLACEHOLDER', borough: 'Manhattan', addendum: { pad: { bin: '1000000', bbl: '1000010001', version: '26c' } } } },
    { properties: { label: '120 BROADWAY', borough: 'Manhattan', addendum: { pad: { bin: '1001026', bbl: BBL, version: '26c' } } } },
    { properties: { label: "120 B'WAY", borough: 'Manhattan', addendum: { pad: { bin: '1001026', bbl: BBL, version: '26c' } } } },
    { properties: { label: 'no pad', borough: 'Manhattan' } },
  ] };
  const c = candidatesFromGeosearch(gs);
  ok('10. placeholder BIN 1000000 is dropped and counted', c.droppedPlaceholders === 1 && !c.candidates.some((x) => x.bin === '1000000'));
  ok('10. candidates are deduped by BIN', c.candidates.length === 1 && c.candidates[0].bin === '1001026');
  const real = candidatesFromGeosearch(JSON.parse(read(join(FIX, 'geosearch-120-broadway.json')) || '{}'));
  ok('10. the real 120 Broadway GeoSearch yields BIN 1001026 first', real.candidates[0]?.bin === '1001026' && real.candidates[0]?.bbl === BBL, JSON.stringify(real.candidates[0]));
}

// ── 11. wire round trip ─────────────────────────────────────────────────────
{
  const bench = benchmarkFrom([{ filing_date: '2026-01-01T00:00:00.000', approved_date: '2026-01-21T00:00:00.000', filing_review_type: 'Standard Plan Examination' }], 'BROOKLYN', TODAY, AS_OF);
  const outputs: unknown[] = [
    { status: 'record', record: fixtureRecord },
    { status: 'record', record: recordFrom(zeroDatasets(), { parcel: failedParcel('failed') }) },
    { status: 'candidates', ...candidatesFromGeosearch(JSON.parse(read(join(FIX, 'geosearch-120-broadway.json')) || '{}')) },
    { status: 'permit', lookup: { permitNumber: 'M01448433-I1', matches: permitMatches('rbx6-tga4', fixture('rbx6-tga4.json').rows, AS_OF), failed: ['DOB Permit Issuance (BIS)'] } },
    { status: 'benchmark', benchmark: bench },
    { status: 'error', code: 'bad_request', error: ERRORS.bad_request },
    { status: 'unsupported', reason: 'Not an NYC jobsite.' },
  ];
  for (const o of outputs) {
    const back = parseBuildingRecordResponse(JSON.parse(JSON.stringify(o)));
    ok(`11. round trip deep-equals (${(o as { status: string }).status})`, deepEqual(back, o) && deepEqual(back, JSON.parse(JSON.stringify(o))));
  }
  const garbage: unknown[] = [null, 42, 'x', [], {}, { status: 'record' }, { status: 'record', record: { ...fixtureRecord, datasets: 'no' } }, { status: 'candidates', candidates: [{ bin: 1 }], droppedPlaceholders: 0 }, { status: 'benchmark', benchmark: { ...bench, datasetId: 'other' } }];
  ok('11. garbage → status error (bad_response)', garbage.every((g) => { const r = parseBuildingRecordResponse(g); return r.status === 'error' && r.code === 'bad_response'; }));
}

// ── 12. DOB status → suggestion ─────────────────────────────────────────────
{
  const table: [string, string | null, string | null][] = [
    ['Pending Plan Examiner Assignment', 'under_review', null],
    ['Plan Examiner Review', 'under_review', null],
    ['Chief Plan Examiner/ Assistant Chief Plan Examiner Review', 'under_review', null],
    ['Pending Chief Plan Examiner Review', 'under_review', null],
    ['Objections', 'under_review', 'objections'],
    ['Permit Entire - BC/DBC Review Objections', 'under_review', 'objections'],
    ['Approved', 'approved', null],
    ['PAA Approved', 'approved', null],
    ['Permit Entire', 'approved', null],
    ['Permit Issued', 'approved', null],
    ['ISSUED', 'approved', null],
    ['RE-ISSUED', 'approved', null],
    ['LOC Issued', 'inspection_passed', null],
    ['CO Issued', 'inspection_passed', null],
    ['Signed-off', 'inspection_passed', null],
    ['  signed off  ', 'inspection_passed', null],
    ['Filing Withdrawn', null, null],
    ['Withdrawn', null, null],
    ['On Hold - Admin Review', null, null],
  ];
  for (const [text, sug, flag] of table) {
    const r = suggestPermitStatusFromDob(text);
    ok(`12. '${text.trim()}' → ${sug ?? 'null'}${flag ? ` (${flag})` : ''}`, r.suggested === sug && r.flag === flag && r.verbatim === text);
  }
}

// ── 13. reviewStats ─────────────────────────────────────────────────────────
{
  const r = reviewStats([1, 2, 3, 4, 100, -5]);
  ok('13. reviewStats([1,2,3,4,100,-5]) → n 5, median 3, p75 4, p90 100 (nearest rank)', r.n === 5 && r.median === 3 && r.p75 === 4 && r.p90 === 100, JSON.stringify(r));
  const even = reviewStats([40, 10, 30, 20]);
  ok('13. nearest rank on an even count: [10,20,30,40] → median 20, p75 30, p90 40', even.n === 4 && even.median === 20 && even.p75 === 30 && even.p90 === 40, JSON.stringify(even));
  ok('13. over 1000 days is dropped; empty is nulls', reviewStats([5, 1001]).n === 1 && reviewStats([]).median === null);
  const b = benchmarkFrom([
    { filing_date: '2026-01-01T00:00:00.000', approved_date: '2026-01-11T00:00:00.000', filing_review_type: 'Standard Plan Examination' },
    { filing_date: '2026-01-01T00:00:00.000', approved_date: '2026-01-02T00:00:00.000', filing_review_type: 'Professional Certification' },
  ], 'Brooklyn', TODAY, AS_OF);
  ok('13. benchmark groups by review type with the survivor-bias note', b.groups.length === 2 && b.groups.find((g) => g.reviewType === 'Standard Plan Examination')?.medianDays === 10 && /survivor bias/.test(b.note) && b.borough === 'BROOKLYN' && !b.truncated);
  ok("13. benchmark $where is borough + Alteration + approved + last 365 days", /upper\(borough\)='BROOKLYN' AND job_type='Alteration' AND approved_date IS NOT NULL AND filing_date >= '2025-09-26T00:00:00'/.test(whereOf(benchmarkUrl('Brooklyn', TODAY))) && /\$limit=50000/.test(benchmarkUrl('Brooklyn', TODAY) ?? ''));
}

// ── 14. cacheKey ────────────────────────────────────────────────────────────
{
  const base = recordFrom(zeroDatasets());
  const k0 = summarizeBuildingRecord(base).cacheKey;
  const asOfChanged = { ...base, datasets: base.datasets.map((d, i) => (i === 3 ? { ...d, asOf: '2026-09-26T01:00:00.000Z' } : d)) };
  const truncFlip = { ...base, datasets: base.datasets.map((d, i) => (i === 2 ? { ...d, truncated: true } : d)) };
  const otherBbl = recordFrom(zeroDatasets(), { bbl: '1000477502' });
  ok('14. cacheKey changes when a dataset asOf changes', summarizeBuildingRecord(asOfChanged).cacheKey !== k0);
  ok('14. cacheKey changes when truncated flips', summarizeBuildingRecord(truncFlip).cacheKey !== k0);
  ok('14. cacheKey changes when bbl changes', summarizeBuildingRecord(otherBbl).cacheKey !== k0 && k0.startsWith(`br:${BIN}:${BBL}:`));
}

// ── 15. source scans of the edge function ───────────────────────────────────
{
  const src = read('supabase/functions/building-record/index.ts');
  const cfg = read('supabase/config.toml');
  ok('15. config.toml pins building-record with verify_jwt = true', /\[functions\.building-record\]\s*\nverify_jwt = true/.test(cfg));
  ok('15. requireTier(req, … free … ) gates it (free for every tier)', /requireTier\(req, \['free', 'pro', 'business', 'enterprise'\], 'building_record'\)/.test(src));
  ok('15. rateLimitCount(`building_record:${auth.userId}`) meters it, over 120/h → 429', src.includes('rateLimitCount(`building_record:${auth.userId}`)') && /const HOURLY_LIMIT = 120;/.test(src) && /rl > HOURLY_LIMIT\) return json\(\{ status: 'error', code: 'rate_limited', error: ERRORS\.rate_limited \}, 429\)/.test(src));
  const tokenReads = src.match(/NYC_SODA_APP_TOKEN/g) ?? [];
  ok("15. X-App-Token is read only from Deno.env.get('NYC_SODA_APP_TOKEN')", tokenReads.length === 1 && src.includes("Deno.env.get('NYC_SODA_APP_TOKEN')") && /headers\['X-App-Token'\] = token\.trim\(\)/.test(src) && /if \(token\.trim\(\)\)/.test(src));
  const allow = /'Access-Control-Allow-Headers':\s*'([^']*)'/.exec(src)?.[1] ?? '';
  ok('15. allow-headers include apikey and x-client-info', allow.split(',').map((x) => x.trim()).includes('apikey') && allow.split(',').map((x) => x.trim()).includes('x-client-info'));
  ok('15. the record cache key holds both bin and bbl', /const cacheKey = `\$\{bin\}:\$\{bbl\}`;/.test(src));
  const errorValues = [...src.matchAll(/[{,]\s*error:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
  ok('15. every `error:` in a response body is an ERRORS.<key> reference', errorValues.length >= 6 && errorValues.every((v) => /^(NJ_|MD_)?ERRORS\.[a-z_]+$/.test(v)), errorValues.join(' | '));
  ok('15. no leaked exception text (e.message / String(e) / res.text())', !/error:\s*e\.message|String\(e\)|String\(err\)|await res\.text\(\)|error:\s*`/.test(src));
  ok('15. the handler is wrapped in try/catch → 500 internal', /catch \(e\) \{\s*console\.error\('\[building-record\] error:', e\);\s*return json\(\{ status: 'error', code: 'internal', error: ERRORS\.internal \}, 500\);/.test(src));
  ok('15. every upstream fetch has an 8 s AbortController', /const UPSTREAM_TIMEOUT_MS = 8000;/.test(src) && /new AbortController\(\)/.test(src) && /signal: ac\.signal/.test(src) && (src.match(/await fetch\(/g) ?? []).length === 1);
  ok('15. index.ts holds no upstream host literal (only the builders do) and fetches no user URL', !/https:\/\/(?!deno\.land)/.test(src.replace(/^\s*\/\/.*$/gm, '')));
  const norm = read('supabase/functions/building-record/normalize.ts');
  ok('15. normalize.ts is pure (no Deno, no https import, no @/ import)', !/\bDeno\./.test(norm) && !/from ['"]https:/.test(norm) && !/from ['"]@\//.test(norm));
  ok('15. only the fixed ERRORS texts exist', JSON.stringify(ERRORS) === JSON.stringify({ bad_request: 'The building lookup request was not valid.', rate_limited: 'Too many building lookups this hour. Try again later.', upstream: "NYC Open Data didn't answer — nothing was checked.", internal: 'The building lookup failed — nothing was checked.' }));
}

// ── 16. storage keys ────────────────────────────────────────────────────────
ok("16. buildingRecordCacheKey / buildingConfirmKey start with 'mageid_'", buildingRecordCacheKey(BIN, BBL) === `mageid_building_record_${BIN}_${BBL}` && buildingConfirmKey('p1') === 'mageid_building_bin_p1');

// ── 17. NOT_CHECKED parity ──────────────────────────────────────────────────
ok('17. NOT_CHECKED in normalize.ts equals BUILDING_RECORD_NOT_CHECKED', JSON.stringify(NOT_CHECKED) === JSON.stringify(BUILDING_RECORD_NOT_CHECKED) && JSON.stringify(fixtureRecord.notChecked) === JSON.stringify(BUILDING_RECORD_NOT_CHECKED));
ok('17. the client in-flight list mirrors FILING_DONE_STATUSES', FILING_DONE_STATUSES.every((st) => read('utils/buildingRecord.ts').includes(`'${st}'`)));

// ── client helpers ──────────────────────────────────────────────────────────
ok('helpers: isNycJobsite (Brooklyn yes; Portland OR / Houston no)', isNycJobsite({ city: 'Brooklyn', state: 'NY' }) && isNycJobsite({ county: 'Kings', state: 'NY' }) && !isNycJobsite({ city: 'Portland', state: 'OR' }) && !isNycJobsite({ city: 'Houston', state: 'TX' }) && !isNycJobsite({}));
ok('helpers: buildingLookupText', buildingLookupText({ street: '120 Broadway', city: 'New York', state: 'NY', zip: '10271', county: '' }) === '120 Broadway, New York, NY 10271'
  && buildingLookupText({ street: '', city: 'Brooklyn', state: 'NY', zip: '', county: '' }, '  345 Adams St, Brooklyn  ') === '345 Adams St, Brooklyn'
  && buildingLookupText({ street: '', city: '', state: '', zip: '', county: '' }, '   ') === null);
{
  const byPermit = filingForPermit(fixtureRecord, 'M01448433-I1-EW-SP');
  ok('helpers: filingForPermit matches a work permit to its filing (suffixes ignored)', byPermit?.jobFilingNumber === 'M01448433-I1', JSON.stringify(byPermit));
  ok('helpers: filingForPermit falls back to the newest in-flight filing', filingForPermit(fixtureRecord, 'NOPE-XX')?.status === 'Approved' && filingForPermit(fixtureRecord)?.jobFilingNumber === 'M01392399-P2');
  ok('helpers: filingForPermit on a failed filings set is null', filingForPermit(recordFrom(zeroDatasets().map((d) => (d.id === 'w9ak-ipjd' ? failedDataset('w9ak-ipjd', 'failed') : d)))) === null);
}

// ── 18. the NYC building-department block ───────────────────────────────────
{
  const nyc = departmentFor(resolveCodeJurisdiction({ city: 'Brooklyn', state: 'NY' }));
  const todayMs = Date.now();
  ok('18. departmentFor(NYC Brooklyn) is non-null', !!nyc);
  if (nyc) {
    const urls = [nyc.portalUrl, nyc.statusLookupUrl, nyc.sourceUrl, ...nyc.questionChannels.map((c) => c.url), ...(nyc.feeScheduleUrls ?? []).map((f) => f.url)].filter((u): u is string => !!u);
    ok('18. every department URL is https', urls.length >= 8 && urls.every((u) => u.startsWith('https://')), urls.filter((u) => !u.startsWith('https://')).join(', '));
    ok('18. sourceUrl is on nyc.gov', /^https:\/\/www\.nyc\.gov\//.test(nyc.sourceUrl));
    const checked = Date.parse(`${nyc.checkedOn}T00:00:00Z`);
    ok('18. checkedOn is ISO and within 365 days', /^\d{4}-\d{2}-\d{2}$/.test(nyc.checkedOn) && todayMs - checked <= 365 * 86400000 && checked <= todayMs + 86400000, nyc.checkedOn);
    const stages = new Set(nyc.questionChannels.map((c) => c.stage));
    ok('18. a channel for each of the 5 stages', ['pre_filing', 'in_review', 'objection', 'inspection', 'general'].every((st) => stages.has(st as never)));
    const blob = JSON.stringify(nyc);
    ok("18. '212-393-2550' and 'nycdevelopmenthub@buildings.nyc.gov' are present", blob.includes('212-393-2550') && blob.includes('nycdevelopmenthub@buildings.nyc.gov'));
    ok('18. fees are links only (no dollar amounts in the block)', !/\$\s?\d/.test(blob));
  }
  ok('18. departmentFor(Portland OR / Houston / unknown / a state row) is null',
    departmentFor(resolveCodeJurisdiction({ city: 'Portland', state: 'OR' })) === null
    && departmentFor(resolveCodeJurisdiction({ city: 'Houston', state: 'TX' })) === null
    && departmentFor(resolveCodeJurisdiction({})) === null
    && departmentFor(resolveCodeJurisdiction({ city: 'Albany', state: 'NY' })) === null
    && resolveCodeJurisdiction({ city: 'Albany', state: 'NY' }).kind !== 'city');
  const card = read('components/buildingRecord/DepartmentCard.tsx');
  const fnBody = card.slice(card.indexOf('export function DepartmentCard('), card.indexOf('export default DepartmentCard'));
  ok('18. DepartmentCard.tsx returns null early, before any hook', /if \(!department \|\| resolved\.kind !== 'city'\) return null;/.test(fnBody) && !/\buse[A-Z]\w*\(/.test(fnBody));
  ok('18. DepartmentCard reads no storage and runs no effect', !/AsyncStorage|useEffect|useQuery/.test(card));
}

// ═══════════════════════════════════════════════════════════════════════════
// 19–30. NEW JERSEY (lane N). The pure half (supabase/functions/building-record/nj.ts)
// over the live fixtures the probe saved on 2026-09-26 (94 Washington St,
// Hoboken → 0905 block 199 lot 1), and the NJ renderer (summarizeNjBuildingRecord).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nNew Jersey building record (state permit data):');
{
  const njFix = (name: string): any => JSON.parse(read(join(FIX, name)) || 'null');
  const census = njFix('nj-census.json');
  const parcel = njFix('nj-parcel.json');
  const parcelAddr = njFix('nj-parcel-address.json');
  const permitsFx = njFix('nj-permits.json');
  const freshFx = njFix('nj-freshness.json');
  ok('19. the five NJ fixtures exist', !!census && !!parcel && !!parcelAddr && !!permitsFx && !!freshFx);

  // ── 19. fixtures hold no owner field ──
  const njBlob = ['nj-census.json', 'nj-parcel.json', 'nj-parcel-address.json', 'nj-permits.json', 'nj-freshness.json'].map((f) => read(join(FIX, f))).join('\n');
  const njKeys = new Set<string>();
  JSON.parse(`[${[census, parcel, parcelAddr, permitsFx, freshFx].map((x) => JSON.stringify(x)).join(',')}]`, (k, v) => { if (k) njKeys.add(k); return v; });
  ok('19. no NJ fixture key matches /OWN|ST_ADDRESS|CITY_STATE|ZIP_CODE/i', [...njKeys].every((k) => !/OWN|ST_ADDRESS|CITY_STATE|ZIP_CODE/i.test(k)), [...njKeys].filter((k) => /OWN|ST_ADDRESS|CITY_STATE|ZIP_CODE/i.test(k)).join(','));
  ok('19. no NJ fixture names an owner column anywhere', !/OWNER_NAME|ST_ADDRESS|CITY_STATE|ZIP_CODE/.test(njBlob));

  // ── 20. candidate ranking ──
  const first = censusFirstMatch(census);
  ok('20. the Census fixture matches 94 WASHINGTON ST, HOBOKEN on the street centreline', !!first && first.matchedAddress === '94 WASHINGTON ST, HOBOKEN, NJ, 07030' && Math.abs(first.lat - 40.736931) < 1e-4 && Math.abs(first.lon - -74.031127) < 1e-4, JSON.stringify(first));
  const key = addressKey(first?.matchedAddress);
  ok("20. addressKey('94 WASHINGTON ST, HOBOKEN, NJ, 07030') → { num: '94', street: ['WASHINGTON'] }", deepEqual(key, { num: '94', street: ['WASHINGTON'] }), JSON.stringify(key));
  const cands = rankNjCandidates(parcel, key, 'nearby');
  ok("20. 0905_199_1 is candidates[0] with match 'address'", cands[0]?.pin === '0905_199_1' && cands[0]?.match === 'address' && cands[0]?.block === '199' && cands[0]?.lot === '1' && cands[0]?.muniCode === '0905', JSON.stringify(cands[0]));
  ok('20. at most 6 candidates, and more than one (nothing is narrowed to a pick)', cands.length > 1 && cands.length <= NJ_CANDIDATE_CAP && NJ_CANDIDATE_CAP === 6, String(cands.length));
  ok("20. every other buffered lot is 'nearby'", cands.slice(1).every((c) => c.match === 'nearby'));
  const approx = rankNjCandidates(parcel, null, 'approximate');
  ok("20. from the map pin (no address key) every lot is 'approximate'", approx.length > 0 && approx.every((c) => c.match === 'approximate'));
  ok('20. a malformed body → []', rankNjCandidates(null, key, 'nearby').length === 0 && rankNjCandidates({ features: 'x' }, key, 'nearby').length === 0 && rankNjCandidates([{ attributes: { PCL_MUN: "09'05", PCLBLOCK: '1', PCLLOT: '1' } }], key, 'nearby').length === 0);
  const dupes = rankNjCandidates({ features: [...parcel.features, ...parcel.features] }, key, 'nearby');
  ok('20. candidates are deduped by PAMS_PIN', new Set(dupes.map((c) => c.pin)).size === dupes.length);
  const addrHits = rankNjCandidates(parcelAddr, key, 'nearby');
  ok('20. the attribute query fixture returns exactly 0905_199_1', addrHits.length === 1 && addrHits[0].pin === '0905_199_1');
  const noAddr = cands.filter((c) => c.pin !== '0905_199_1').map((c) => ({ ...c, match: 'nearby' as const }));
  const merged = mergeNjCandidates(addrHits, noAddr);
  ok("20. merge: the address-query hit goes first as 'address', the rest follow, capped", merged[0]?.pin === '0905_199_1' && merged[0]?.match === 'address' && merged.length <= 6 && merged.slice(1).every((c) => c.match !== 'address'));
  ok("20. propLocMatches: '94' never matches '945 WASHINGTON ST'; a range '89-91' holds 90", !propLocMatches('945 WASHINGTON ST', key) && propLocMatches('89-91 WASHINGTON ST', { num: '90', street: ['WASHINGTON'] }) && !propLocMatches('94 HUDSON ST', key));

  // ── 21. sanitizers and URL builders ──
  ok('21. sanitizeMuniCode: 4 digits only', sanitizeMuniCode('0905') === '0905' && sanitizeMuniCode("0905'") === null && sanitizeMuniCode('905') === null && sanitizeMuniCode('0905 OR 1=1') === null && sanitizeMuniCode(905) === null);
  ok('21. sanitizeBlockLot rejects quotes, spaces, %, ; and SoQL', sanitizeBlockLot('211.01') === '211.01' && sanitizeBlockLot('C0001') === 'C0001' && sanitizeBlockLot("199'") === null && sanitizeBlockLot('199 OR 1=1') === null && sanitizeBlockLot('19%') === null && sanitizeBlockLot('1;DROP') === null && sanitizeBlockLot('x'.repeat(17)) === null);
  ok('21. lat/lon outside the loose NJ box → null', sanitizeLat(40.7) === 40.7 && sanitizeLat(45) === null && sanitizeLon(-74.03) === -74.03 && sanitizeLon(-80) === null && sanitizeLat(NaN) === null && sanitizeLat('40.7') === null);
  ok('21. parseNjRequest: a bad nj_record body is null; lat without lon drops both', parseNjRequest({ mode: 'nj_record', muniCode: '0905', block: "1' OR '1'='1", lot: '1' }) === null
    && deepEqual(parseNjRequest({ mode: 'nj_resolve', text: '94 Washington St', lat: 40.7, lon: null }), { mode: 'nj_resolve', text: '94 Washington St', lat: null, lon: null })
    && deepEqual(parseNjRequest({ mode: 'nj_record', muniCode: '0905', block: '199', lot: '1' }), { mode: 'nj_record', muniCode: '0905', block: '199', lot: '1' })
    && parseNjRequest({ mode: 'resolve', text: 'x' }) === null && parseRequest({ mode: 'nj_resolve', text: 'x' }) === null);
  const bufUrl = njParcelBufferUrl(40.736931, -74.031127) ?? '';
  const addrUrl = njParcelAddressUrl(['0905'], key) ?? '';
  const outFields = (u: string) => decodeURIComponent(/[?&]outFields=([^&]*)/.exec(u)?.[1] ?? '');
  ok('21. the buffer URL is a 30 m intersects query with the exact eight outFields', bufUrl.includes('distance=30&units=esriSRUnit_Meter') && bufUrl.includes('spatialRel=esriSpatialRelIntersects') && outFields(bufUrl) === 'PAMS_PIN,PCL_MUN,PCLBLOCK,PCLLOT,PCLQCODE,MUN_NAME,COUNTY,PROP_LOC', bufUrl);
  ok("21. parcel URLs' outFields never name an owner field and are never '*'", [bufUrl, addrUrl].every((u) => !!u && !/OWN|ST_ADDRESS|CITY_STATE|ZIP_CODE/i.test(outFields(u)) && outFields(u) !== '*' && !outFields(u).includes('*')));
  ok("21. njParcelAddressUrl builds PCL_MUN IN ('0905') AND PROP_LOC LIKE '94 WASHINGTON%'", decodeURIComponent(/where=([^&]*)/.exec(addrUrl)?.[1] ?? '') === "PCL_MUN IN ('0905') AND PROP_LOC LIKE '94 WASHINGTON%'", addrUrl);
  ok('21. a street token with a quote, %, space or SQL word is never built', njParcelAddressUrl(['0905'], { num: '94', street: ["WASH'"] }) === null && njParcelAddressUrl(['0905'], { num: '94', street: ['WA%'] }) === null
    && njParcelAddressUrl(['0905'], { num: '94', street: ['WASHINGTON ST'] }) === null && njParcelAddressUrl(['0905'], { num: '94', street: ['UNION'] }) === null && njParcelAddressUrl(['0905'], { num: '94', street: ['DROP'] }) === null
    && njParcelAddressUrl(['0905'], { num: "94'", street: ['WASHINGTON'] }) === null && njParcelAddressUrl(['0905'], { num: '94', street: [] }) === null);
  ok("21. addressKey drops a bad token (quote / % / SQL word / street type)", deepEqual(addressKey("94 O'BRIEN ST, X"), null) && deepEqual(addressKey('94 WASHINGTON% ST, X'), null) && deepEqual(addressKey('12 SELECT MAIN AVE, X'), { num: '12', street: ['MAIN'] }) && addressKey('WASHINGTON ST') === null);
  ok('21. muni codes that fail /^\\d{4}$/ never reach the URL', njParcelAddressUrl(["0905') OR ('1'='1"], key) === null && njParcelAddressUrl(['905'], key) === null && njParcelAddressUrl(['0905', '09O5'], key) === null && njParcelAddressUrl([], key) === null);
  const pUrl = njPermitsUrl('0905', '199', '1', TODAY) ?? '';
  const pq = (name: string) => decodeURIComponent(new RegExp(`[?&]\\$${name}=([^&]*)`).exec(pUrl)?.[1] ?? '');
  ok('21. the permits URL has an explicit $select with no name column', pq('select') === NJ_PERMIT_SELECT && !/\*|name(?!$)|owner|applicant/i.test(pq('select').replace('muniname', '')), pq('select'));
  ok("21. the permits $where scopes the town, a block prefix and a LOT prefix, and today", pq('where') === "comu='0905' AND (block like '199%' OR block like '0%199%') AND (lot like '1%' OR lot like '0%1%') AND (permitdate <= '2026-09-26' OR permitdate IS NULL)" && pq('order') === 'permitdate DESC' && /\$limit=1000\b/.test(pUrl), pq('where'));
  ok('21. njPermitsUrl uses the integer part as the prefix (211.01 → 211%)', decodeURIComponent(njPermitsUrl('0905', '211', '1.01', TODAY) ?? '').includes("lot like '1%'"));
  ok('21. njPermitsUrl / njMuniFreshnessUrl refuse unsanitary input', njPermitsUrl("0905'", '199', '1', TODAY) === null && njPermitsUrl('0905', "199' OR '1'='1", '1', TODAY) === null && njMuniFreshnessUrl('09 05') === null);
  ok("21. the freshness URL is max(processdate) for one town", decodeURIComponent(njMuniFreshnessUrl('0905') ?? '').includes("$select=max(processdate) as last, max(muniname) as muni&$where=comu='0905'"));
  const njUrls = [censusLocationsUrl('94 Washington St, Hoboken, NJ 07030'), bufUrl, addrUrl, pUrl, njMuniFreshnessUrl('0905')];
  ok('21. every NJ URL starts with one of the three upstream hosts', njUrls.every((u) => !!u && (u.startsWith('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?') || u.startsWith('https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query?') || u.startsWith('https://data.nj.gov/resource/w9se-dmra.json?'))));

  // ── 22. block / lot normalisation ──
  const eqBL = (a: string, b2: string) => normalizeBlockLot(a) === normalizeBlockLot(b2);
  ok("22. '199' = '199.0' = '0199' = '199.00' = ' 199 '", eqBL('199', '199.0') && eqBL('199', '0199') && eqBL('199', '199.00') && eqBL('199', ' 199 ') && normalizeBlockLot('199.') === '199');
  ok("22. '211.01' = '211.010' = '0211.01'; '211' ≠ '211.01'", eqBL('211.01', '211.010') && eqBL('211.01', '0211.01') && !eqBL('211', '211.01') && normalizeBlockLot('000') === '0' && normalizeBlockLot('c0001') === 'C0001');

  // ── 23. permits normalisation ──
  const live = normalizeNjPermits(permitsFx.rows, '199', '1', permitsFx.asOfHeader, TODAY);
  ok('23. the live Hoboken 199/1 page: 14 matched rows, asOf from the header, newest first, 5 kept', live.dataset.status === 'ok' && live.dataset.rowCount === 14 && live.dataset.returned === 14 && !live.dataset.truncated
    && live.dataset.asOf === '2026-08-13T18:00:26.000Z' && live.dataset.rows.length === 5 && live.dataset.rows[0].primary === '20250836' && live.dataset.rows[0].date === '2025-08-14' && live.muniName === 'HOBOKEN', JSON.stringify({ ...live.dataset, rows: live.dataset.rows.slice(0, 1) }));
  ok("23. row wording: status 'Permit', detail 'Alteration, use group R-5', cents 1767000", live.dataset.rows[0].status === 'Permit' && live.dataset.rows[0].detail === 'Alteration, use group R-5' && live.dataset.rows[0].amountCents === 1767000, JSON.stringify(live.dataset.rows[0]));
  const synthRow = (o: Record<string, unknown>) => ({ block: '199', lot: '1', permitno: 'P1', permitstatusdesc: 'Permit', permitdate: '2025-01-02T00:00:00.000', permittypedesc: 'Alteration', ...o });
  const junk = normalizeNjPermits([synthRow({ permitno: 'FUT', permitdate: '2925-01-01T00:00:00.000' }), synthRow({ permitno: 'FUTC', permitdate: null, certdate: '2096-05-05T00:00:00.000' }), synthRow({})], '199', '1', AS_OF, TODAY);
  ok('23. a future-dated permitdate or certdate row is dropped', junk.dataset.rowCount === 1 && junk.dataset.rows[0].primary === 'P1');
  ok('23. constcost "5100" → 510000 cents; non-numeric / negative → null', dollarsToCents('5100') === 510000 && dollarsToCents('12.345') === 1235 && dollarsToCents('abc') === null && dollarsToCents('') === null && dollarsToCents('-5') === null && dollarsToCents(null) === null);
  const drift = normalizeNjPermits([synthRow({ block: '0199.0', lot: '001' }), synthRow({ block: '1990', lot: '1' }), synthRow({ block: '199', lot: '1.01' })], '199', '1', AS_OF, TODAY);
  ok("23. format drift: '0199.0'/'001' matches 199/1; '1990' and lot '1.01' do not", drift.dataset.rowCount === 1);
  ok('23. a certificate row reads status "Certificate — <type>"', normalizeNjPermits([synthRow({ permitstatusdesc: 'Certificate', certtypedesc: 'Certificate of Occupancy', permitdate: null, certdate: '2024-03-03T00:00:00.000' })], '199', '1', AS_OF, TODAY).dataset.rows[0]?.status === 'Certificate — Certificate of Occupancy');
  ok('23. a non-array body is failed with rowCount null', normalizeNjPermits({ error: 'x' }, '199', '1', AS_OF, TODAY).dataset.status === 'failed' && normalizeNjPermits({ error: 'x' }, '199', '1', AS_OF, TODAY).dataset.rowCount === null);
  const fresh = normalizeNjFreshness(freshFx.rows);
  ok("23. the live freshness fixture: Hoboken's newest processdate 2026-08-07", fresh.status === 'ok' && fresh.date === '2026-08-07' && fresh.muniName === 'HOBOKEN', JSON.stringify(fresh));

  // ── records + summaries ──
  const FETCHED = new Date('2026-09-26T12:00:00Z');
  const liveRec = assembleNjRecord({ muniCode: '0905', block: '199', lot: '1', fetchedAt: FETCHED, muniName: live.muniName, permits: live.dataset, muniLastReport: { status: fresh.status, date: fresh.date } });
  const recWith = (over: { permits?: ReturnType<typeof failedNjPermits>; report?: { status: 'ok' | 'failed' | 'timeout'; date: string | null }; muniName?: string | null }) =>
    assembleNjRecord({ muniCode: '0905', block: '199', lot: '1', fetchedAt: FETCHED, muniName: over.muniName === undefined ? 'HOBOKEN' : over.muniName, permits: over.permits ?? live.dataset, muniLastReport: over.report ?? { status: 'ok', date: '2026-08-07' } });
  const sLive = summarizeNjBuildingRecord(liveRec);
  ok("24. the live record: label 'Block 199 Lot 1, Hoboken', links the dataset page, carries the caveat", liveRec.label === 'Block 199 Lot 1, Hoboken' && liveRec.links.dataset === 'https://data.nj.gov/d/w9se-dmra' && liveRec.caveat === NJ_PERMIT_CAVEAT && deepEqual(liveRec.notChecked, NJ_NOT_CHECKED));
  ok("24. the live summary is 'listed' with the newest permit, its cost and the town's report date", sLive.kind === 'listed'
    && sLive.headline === 'State permit data for Block 199 Lot 1, Hoboken: 14 permits and certificates on file (as of 2026-08-13). Violations are not published statewide.'
    && sLive.lines[0] === "14 permits and certificates on file for Block 199 Lot 1 (NJ Construction Permit Data, as of 2026-08-13); newest 20250836 'Permit' 2025-08-14, Alteration, use group R-5, declared cost $17,670"
    && sLive.lines[1] === "Hoboken's latest report to the state is dated 2026-08-07", sLive.lines.join(' | '));

  // ── 25. failed permits ──
  const sFail = summarizeNjBuildingRecord(recWith({ permits: failedNjPermits('timeout') }));
  const failRec = recWith({ permits: failedNjPermits('failed') });
  const sFail2 = summarizeNjBuildingRecord(failRec);
  ok('25. failed permits → "not checked (the request failed|timed out)", rowCount null, kind incomplete', sFail.lines[0] === 'NJ Construction Permit Data: not checked (the request timed out)' && sFail2.lines[0] === 'NJ Construction Permit Data: not checked (the request failed)' && failRec.permits.rowCount === null && sFail.kind === 'incomplete' && sFail2.kind === 'incomplete');
  ok('25. and NO line or headline says " 0 permits" or "No permits"', [sFail, sFail2].every((x) => [x.headline, ...x.lines].every((l) => !/ 0 permits|^0 permits|No permits/.test(l))));
  ok('25. failed permits headline: "Some New Jersey records could not be fully checked…"', sFail.headline === 'Some New Jersey records could not be fully checked for Block 199 Lot 1; see below.');
  const sFreshFail = summarizeNjBuildingRecord(recWith({ report: { status: 'failed', date: null } }));
  ok("25. failed freshness → \"Hoboken's last report date: not checked (the request failed)\", incomplete", sFreshFail.lines[1] === "Hoboken's last report date: not checked (the request failed)" && sFreshFail.kind === 'incomplete');

  // ── 26. truncated ──
  const truncated = { ...live.dataset, rowCount: 900, returned: 1000, truncated: true };
  const sTrunc = summarizeNjBuildingRecord(recWith({ permits: truncated }));
  ok("26. a full page reads 'at least', kind 'incomplete'", sTrunc.lines[0].startsWith('at least 900 permits and certificates on file') && sTrunc.kind === 'incomplete', sTrunc.lines[0]);
  ok('26. normalizeNjPermits: returned === limit ⇒ truncated', normalizeNjPermits(Array.from({ length: 1000 }, () => ({ block: '5', lot: '5' })), '199', '1', AS_OF, TODAY).dataset.truncated);

  // ── 27. zero rows ──
  const zero = normalizeNjPermits([], '199', '1', AS_OF, TODAY).dataset;
  const sZero = summarizeNjBuildingRecord(recWith({ permits: zero }));
  ok('27. zero rows → the scoped "No permits or certificates for Block … in … (as of …)" line', sZero.lines[0] === 'No permits or certificates for Block 199 Lot 1 in Hoboken in the NJ Construction Permit Data (as of 2026-09-25)', sZero.lines[0]);
  ok('27. zero rows headline names non-reporting towns and unpublished violations', sZero.kind === 'listed' && sZero.headline === "State permit data lists no permits or certificates for Block 199 Lot 1, Hoboken (as of 2026-09-25). Some towns don't report; violations are not published statewide.", sZero.headline);
  const sStale = summarizeNjBuildingRecord(recWith({ report: { status: 'ok', date: '2025-06-01' } }));
  ok('27. a town report over a year old adds the "over a year old" line', sStale.lines.includes('That report is over a year old — permits after it will not appear here.') && !sLive.lines.some((l) => l.includes('over a year old')));
  const sNoTown = summarizeNjBuildingRecord(recWith({ permits: zero, report: { status: 'ok', date: null }, muniName: null }));
  ok('27. a town with no reports at all says its permits would not appear; the label falls back to the code', sNoTown.lines[1] === 'municipality 0905 has no reports in the NJ Construction Permit Data — its permits would not appear here' && sNoTown.headline.includes('municipality 0905'));

  // ── 28. no slop, caveat, Not checked last ──
  const NJ_SLOP = /\b(clean|clear|all clear|compliant|no violations|no issues|safe)\b/i;
  const every = [sLive, sFail, sFail2, sFreshFail, sTrunc, sZero, sStale, sNoTown];
  ok('28. no NJ summary says clean / clear / compliant / no violations / no issues / safe', every.every((x) => [x.headline, x.chipLabel, ...x.lines].every((l) => !NJ_SLOP.test(l))), every.flatMap((x) => [x.headline, ...x.lines]).filter((l) => NJ_SLOP.test(l)).join(' | '));
  ok('28. the last line of every NJ summary starts "Not checked:" and the caveat is present', every.every((x) => x.lines[x.lines.length - 1].startsWith('Not checked:') && x.lines.includes(NJ_PERMIT_CAVEAT)));
  const none = summarizeNjBuildingRecord(null);
  ok("28. no record → kind 'none', nothing to print", none.kind === 'none' && none.lines.length === 0 && none.headline === '' && summarizeNjBuildingRecord(undefined).kind === 'none');
  ok('28. the promptBlock carries the headline, every line and the never-meets-code rule', sLive.promptBlock.includes(sLive.headline) && sLive.lines.every((l) => sLive.promptBlock.includes(l)) && /Never tell the contractor the property is free of problems or meets code/.test(sLive.promptBlock));
  ok('28. cacheKey = brnj:muni:block:lot:asOf[+]:report', sLive.cacheKey === 'brnj:0905:199:1:2026-08-13T18:00:26.000Z:2026-08-07' && sTrunc.cacheKey.includes('+:') && sFail.cacheKey === 'brnj:0905:199:1:timeout:2026-08-07' && sFreshFail.cacheKey.endsWith(':failed'));
  ok('28. njDollars: whole dollars without decimals, cents with two', njDollars(1767000) === '$17,670' && njDollars(130700000) === '$1,307,000' && njDollars(1250) === '$12.50' && njDollars(5) === '$0.05');

  // ── 29. wire round trip ──
  const trip = (x: unknown) => JSON.parse(JSON.stringify(x));
  const candResp = { status: 'nj_candidates' as const, candidates: cands };
  const recResp = { status: 'nj_record' as const, record: liveRec };
  const failResp = { status: 'nj_record' as const, record: failRec };
  ok('29. candidates round-trip through parseNjBuildingRecordResponse', deepEqual(parseNjBuildingRecordResponse(trip(candResp)), candResp));
  ok('29. the live record round-trips', deepEqual(parseNjBuildingRecordResponse(trip(recResp)), recResp) && deepEqual(parseNjBuildingRecordResponse(trip(failResp)), failResp));
  ok('29. an error round-trips; malformed → bad_response', deepEqual(parseNjBuildingRecordResponse({ status: 'error', code: 'upstream', error: NJ_ERRORS.upstream }), { status: 'error', code: 'upstream', error: NJ_ERRORS.upstream })
    && parseNjBuildingRecordResponse({ status: 'nj_record', record: { ...liveRec, jurisdiction: 'nyc' } }).status === 'error'
    && parseNjBuildingRecordResponse({ status: 'nj_candidates', candidates: [{ ...cands[0], match: 'picked' }] }).status === 'error'
    && parseNjBuildingRecordResponse({ status: 'nj_record', record: { ...liveRec, permits: { ...liveRec.permits, rows: [{ ...liveRec.permits.rows[0], amountCents: 1.5 }] } } }).status === 'error'
    && parseNjBuildingRecordResponse(null).status === 'error' && parseNjBuildingRecordResponse({ status: 'record' }).status === 'error');
  ok('29. nothing is auto-picked: the candidates response has no "selected" / "picked" field', !/"(selected|picked|chosen)"/.test(JSON.stringify(candResp)) && Object.keys(candResp).join(',') === 'status,candidates');

  // ── 30. parity, source scans, keys, NYC byte-identity ──
  ok('30. NJ_NOT_CHECKED and NJ_PERMIT_CAVEAT are equal in nj.ts and the client', JSON.stringify(NJ_NOT_CHECKED) === JSON.stringify(NJ_NOT_CHECKED_SRV) && NJ_PERMIT_CAVEAT === NJ_PERMIT_CAVEAT_SRV);
  ok("30. NJ_ERRORS.upstream is the fixed NJ text (never the NYC Open Data one)", NJ_ERRORS.upstream === "The New Jersey lookup didn't answer — nothing was checked." && !NJ_ERRORS.upstream.includes('NYC'));
  const njSrc = read('supabase/functions/building-record/nj.ts');
  ok('30. nj.ts is pure (no Deno, no import at all)', !/\bDeno\./.test(njSrc) && !/^\s*import\s/m.test(njSrc));
  const idx = read('supabase/functions/building-record/index.ts');
  // The NJ handlers end where the Maryland section starts (lane RECORD added it
  // between them and the handler; it answers MD_ERRORS, checked in section 31).
  const njSection = idx.slice(idx.indexOf('async function njResolve'), idx.indexOf('// ── Maryland'));
  ok('30. the NJ handlers answer the NJ upstream text, never the NYC one', njSection.includes('error: NJ_ERRORS.upstream') && !/(?<!NJ_)ERRORS\.upstream/.test(njSection));
  ok('30. index.ts routes nj_* before the NYC parseRequest', idx.indexOf('parseNjRequest(body)') > 0 && idx.indexOf('parseNjRequest(body)') < idx.indexOf('const parsed = parseRequest(body);'));
  ok('30. nj_resolve never auto-picks (only nj_candidates leaves njResolve)', !/status: 'nj_record'/.test(idx.slice(idx.indexOf('async function njResolve'), idx.indexOf('async function njRecord'))));
  ok('30. the NJ record cache holds only fully answered records under nj:muni:block:lot', /const cacheKey = `nj:\$\{muniCode\}:\$\{block\}:\$\{lot\}`;/.test(idx) && /if \(rec\.permits\.status === 'ok' && rec\.muniLastReport\.status === 'ok'\)/.test(idx));
  ok("30. njParcelConfirmKey is under mageid_", njParcelConfirmKey('p1') === 'mageid_building_parcel_p1');
  ok('30. isNjJobsite: NJ yes (code or name); NY / Portland / empty no', isNjJobsite({ state: 'NJ' }) && isNjJobsite({ state: 'New Jersey' }) && !isNjJobsite({ state: 'NY' }) && !isNjJobsite({ state: 'OR' }) && !isNjJobsite({}));
  const client = read('utils/buildingRecordClient.ts');
  // Exactly THREE literal invokes (2026-09-28, lane RECORD): invokeBuildingRecord (NYC),
  // fetchNjBuildingRecord (NJ) and invokeMd (both Baltimore modes share one helper).
  ok("30. fetchNjBuildingRecord uses the LITERAL invoke('building-record') and parseNjBuildingRecordResponse(data)", /export async function fetchNjBuildingRecord\(req: NjBuildingRecordRequest\)/.test(client) && (client.match(/functions\.invoke\(\s*'building-record'/g) ?? []).length === 3 && /parseNjBuildingRecordResponse\(data\)/.test(client));
  const brSrc = read('utils/buildingRecord.ts');
  ok("30. BuildingRecordSummary['kind'] is textually unchanged", brSrc.includes("export interface BuildingRecordSummary { kind: 'none' | 'attention' | 'no_active_in_checked' | 'incomplete'; headline: string; lines: string[]; promptBlock: string; chipLabel: string; cacheKey: string; }"));
  const card = read('components/buildingRecord/BuildingRecordCard.tsx');
  ok('30. BuildingRecordCard dispatches NJ on the line directly above the unchanged NYC early return', card.includes("  if (!br.supported && njJob) return <NjBuildingRecordCard project={project} variant={variant} />;\n  if (!br.supported || br.phase === 'unsupported') return null;\n"));
  const njCard = read('components/buildingRecord/NjBuildingRecordCard.tsx');
  const tids = [...njCard.matchAll(/testID=\{?[`"']([^`"'}]*)/g)].map((m) => m[1]);
  ok("30. every NJ card testID starts 'njrecord-' and the root is 'njrecord-card'", tids.length >= 8 && tids.every((t) => t.startsWith('njrecord-')) && /testID="njrecord-card"/.test(njCard), tids.join(','));
  ok("30. the NJ card never renders the record success-green", !/tone="success"|\.success\b|successBg/.test(njCard));

  // NYC byte-identity: the six NYC summaries recorded on the untouched base
  // (4a5f6eb7, before this lane touched utils/buildingRecord.ts).
  const baseline = njFix('nj-nyc-summary-baseline.json') as Record<string, BuildingRecordSummary> | null;
  const NYC_AS_OF = 'Fri, 25 Sep 2026 17:00:00 GMT';
  const nycRec = (datasets: BuildingRecordDataset[], ecbRaw: unknown = [], parcelIn = normalizeParcel([{ zonedist1: 'C5-5', version: '26v2' }], 'Mon, 24 Aug 2026 20:20:51 GMT')) =>
    assembleRecord({ bin: BIN, bbl: BBL, label: '120 BROADWAY', fetchedAt: TODAY, datasets, parcel: parcelIn, ecbRaw });
  const nycZero = () => RECORD_DATASET_IDS.map((id) => normalizeDataset(id, [], NYC_AS_OF, TODAY));
  const now: Record<string, BuildingRecordSummary> = {};
  now.fixture = summarizeBuildingRecord(fixtureRecord);
  now.zero = summarizeBuildingRecord(nycRec(nycZero()));
  { const ds = nycZero(); ds[0] = failedDataset('3h2n-5cm9', 'failed'); ds[1] = failedDataset('6bgk-3dad', 'timeout'); now.failed = summarizeBuildingRecord(nycRec(ds)); }
  { const sy = fixture('synthetic-6bgk-3dad-full-page.json'); const ds = nycZero(); ds[1] = normalizeDataset('6bgk-3dad', sy.rows, sy.asOfHeader, TODAY); now.truncated = summarizeBuildingRecord(nycRec(ds, sy.rows)); }
  now.failedPluto = summarizeBuildingRecord(nycRec(nycZero(), [], failedParcel('timeout')));
  now.none = summarizeBuildingRecord(null);
  ok('30. NYC byte-identity: summarizeBuildingRecord for all 6 NYC cases equals the base output', !!baseline && Object.keys(baseline).length === 6 && Object.keys(baseline).every((k) => JSON.stringify(baseline[k]) === JSON.stringify(now[k])),
    baseline ? Object.keys(baseline).filter((k) => JSON.stringify(baseline[k]) !== JSON.stringify(now[k])).join(',') : 'no baseline');
}

// Live bodies read 2026-09-28 by scripts/probe-building-record.ts --md (SAFE columns only).
const MD_FIXTURES_JSON = String.raw`{"cityGeo":{"candidates":[{"address":"620 E 31ST ST, Baltimore, 21218","location":{"x":-76.608072000001,"y":39.325941000003},"score":98.82,"attributes":{"Addr_type":"PointAddress","Postal":"21218"}},{"address":"620 E 31ST ST, MD, 21218","location":{"x":-76.608711260338,"y":39.325928272335},"score":100,"attributes":{"Addr_type":"StreetAddress","Postal":"21218"}},{"address":"4074C009, 620 E 31ST ST, 21218","location":{"x":-76.60807094633,"y":39.326002256022},"score":99.8,"attributes":{"Addr_type":"Parcel","Postal":"21218"}}]},"countyGeo":{"candidates":[]},"city":{"parcel":{"features":[{"attributes":{"PIN":"4074C009","BLOCKLOT":"4074C009","BLOCK":"4074C","LOT":"009 ","FULLADDR":"620 E 31ST ST","ZIP_CODE":"21218","YEAR_BUILD":1920,"STRUCTAREA":1372,"ZONECODE":"R-6  ","USEGROUP":"R ","DWELUNIT":1,"VACIND":"N","NEIGHBOR":"BETTER WAVERLY                           ","LDATE":"09272026"}}]},"permits_count":{"count":9},"permits_rows":{"features":[{"attributes":{"CaseNumber":"BUSE-26-005160","Description":"TO USE AS A SINGLE FAMILY DWELLING","IssuedDate":1790308800000,"ExpirationDate":1789352178000,"Address":"620 E 31ST ST","BLOCKLOT":"4074C 009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":"Dwelling: Semi-Detached","ProposedUse":"Dwelling: Semi-Detached","Cost":null,"IsPermitModification":0}},{"attributes":{"CaseNumber":"BRCM-26-009216","Description":"INSTALL 12 PLUMBING FIXTURES, SANITARY CONNECTION, WATER SERVICE PIPE, GAS FURNACE 80000 BTU, GAS TEST, GAS WATER HEATER 60000 BTU","IssuedDate":1777953600000,"ExpirationDate":1793419200000,"Address":"620 E 31ST ST","BLOCKLOT":"4074C009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":"Dwelling: Rowhouse","ProposedUse":"Dwelling: Rowhouse","Cost":1000,"IsPermitModification":0}},{"attributes":{"CaseNumber":"COM2024-95886","Description":" Extend Original Permit.(original permit:COM2023-75740:INTERIOR ALTERATION TO INCLUDE NEW JOISTS, FRAMING \r\nFOR PERIMETER AND PARTITION FRAMING, NEW CABINETS, COUNTERTOPS, TILE, NEW INTERIOR DOORS, TRIM, PAINTING. NEW SUBFLOORING, NEW FLOORING, THE STAIRWAY SAME, NO WORK IN THE BASEMENT THE BEDROOMS ARE EXISTING, AND EACH BEDROOM INCLUDES AT LEAST ONE COMPLIANT RESCUE WINDOW PER CODE, & ONE CLOSET ROOF DRAINGE SYSTEME GUTTERS & DOWNSPOUT AS PER PLANS AS PER CODE. ********* AS PER CHAP ATP: INSTALL AND MATCH 2 PANELS BELOW 2ND FLOOR BAYFRONT WINDOW TO MATCH ADJOING NEIGHBORS\r\nPANELS IN SIZE AND DESIGN. (USE WOOD OR AZEK TO REPLICATE)\r\nPAINT TO MATCH EXISTING TRIM COLOR INSTALL NEW GUTTERS AND DOWNSPOUTS AS PER CODE\r\nNON-VISIBLE BASEMENT WINDOWS MADE RESCUE COMPLAINT AS PER CODE)","IssuedDate":1739768400000,"ExpirationDate":1778990400000,"Address":"620 E 31ST ST Baltimore Maryland 21218-3530","BLOCKLOT":"4074C009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":null,"ProposedUse":null,"Cost":null,"IsPermitModification":0}},{"attributes":{"CaseNumber":"BRCM-25-000328","Description":"install 200 amp service and add 25 circuits","IssuedDate":1738990800000,"ExpirationDate":1780027200000,"Address":"620 E 31ST ST","BLOCKLOT":"4074C009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":"Dwelling: Rowhouse","ProposedUse":"Dwelling: Rowhouse","Cost":null,"IsPermitModification":0}},{"attributes":{"CaseNumber":"COM2024-91439","Description":"INSTALL (12)  # PLUMBING FIXTURES, (1)  # SANITARY CONNECTION (1-2 FAM. RES.), (1)  # WATER SERVICE PIPE ( 1-2 FAM. RES.), (1) 80000 BTU FUEL-BURNING EQUIP, (1)  # GAS TEST, (1) 60000 BTU FUEL-BURNING EQUIP, (1) 30000 BTU FUEL-BURNING EQUIP AS PER CODE.","IssuedDate":1733461200000,"ExpirationDate":1749217800000,"Address":"620 E 31ST ST Baltimore Maryland 21218-3530","BLOCKLOT":"4074C009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":"1-08","ProposedUse":"1-08","Cost":1000,"IsPermitModification":0}},{"attributes":{"CaseNumber":"COM2024-90131","Description":"INSTALL (1)  # NEW DISTRIBUTION SYSTEM (1-2 FAMILY), (5) 3500 CFM EXHAUST SYSTEMS  , (1) 60000 BTU AIR-CON SYSTEM, HEAT PUMP, (1) 80000 BTU FUEL-BURNING EQUIP(FURNACE) AS PER CODE.","IssuedDate":1732251600000,"ExpirationDate":1781755200000,"Address":"620 E 31ST ST Baltimore Maryland 21218-3530","BLOCKLOT":"4074C009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":"1-08","ProposedUse":"1-08","Cost":1000,"IsPermitModification":0}},{"attributes":{"CaseNumber":"COM2024-71309","Description":" Extend Original Permit.(original permit:COM2023-75740:INTERIOR ALTERATION TO INCLUDE NEW JOISTS, FRAMING   FOR PERIMETER AND PARTITION FRAMING, NEW CABINETS, COUNTERTOPS, TILE, NEW INTERIOR DOORS, TRIM, PAINTING. NEW SUBFLOORING, NEW FLOORING, THE STAIRWAY SAME, NO WORK IN THE BASEMENT THE BEDROOMS ARE EXISTING, AND EACH BEDROOM INCLUDES AT LEAST ONE COMPLIANT RESCUE WINDOW PER CODE, & ONE CLOSET ROOF DRAINGE SYSTEME GUTTERS & DOWNSPOUT AS PER PLANS AS PER CODE. ********* AS PER CHAP ATP: INSTALL AND MATCH 2 PANELS BELOW 2ND FLOOR BAYFRONT WINDOW TO MATCH ADJOING NEIGHBORS  PANELS IN SIZE AND DESIGN. (USE WOOD OR AZEK TO REPLICATE)  PAINT TO MATCH EXISTING TRIM COLOR INSTALL NEW GUTTERS AND DOWNSPOUTS AS PER CODE  NON-VISIBLE BASEMENT WINDOWS MADE RESCUE COMPLAINT AS PER CODE) Original Permit Description:(COM2023-75740) INTERIOR ALTERATION TO INCLUDE NEW JOISTS, FRAMING   FOR PERIMETER AND PARTITION FRAMING, NEW CABINETS, COUNTERTOPS, TILE, NEW INTERIOR DOORS, TRIM, PAINTING. NEW SUBFLOORING, NEW FLOORING, THE STAIRWAY SAME, NO WORK IN THE BASEMENT THE BEDROOMS ARE EXISTING, AND EACH BEDROOM INCLUDES AT LEAST ONE COMPLIANT RESCUE WINDOW PER CODE, & ONE CLOSET ROOF DRAINGE SYSTEME GUTTERS & DOWNSPOUT AS PER PLANS AS PER CODE. ********* AS PER CHAP ATP: INSTALL AND MATCH 2 PANELS BELOW 2ND FLOOR BAYFRONT WINDOW TO MATCH ADJOING NEIGHBORS  PANELS IN SIZE AND DESIGN. (USE WOOD OR AZEK TO REPLICATE)  PAINT TO MATCH EXISTING TRIM COLOR INSTALL NEW GUTTERS AND DOWNSPOUTS AS PER CODE  NON-VISIBLE BASEMENT WINDOWS MADE RESCUE COMPLAINT AS PER CODE","IssuedDate":1721361600000,"ExpirationDate":1737298200000,"Address":"620 E 31ST ST","BLOCKLOT":"4074C009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":"1-09","ProposedUse":"1-09","Cost":null,"IsPermitModification":1}},{"attributes":{"CaseNumber":"COM2023-75740","Description":"INTERIOR ALTERATION TO INCLUDE NEW JOISTS, FRAMING   FOR PERIMETER AND PARTITION FRAMING, NEW CABINETS, COUNTERTOPS, TILE, NEW INTERIOR DOORS, TRIM, PAINTING. NEW SUBFLOORING, NEW FLOORING, THE STAIRWAY SAME, NO WORK IN THE BASEMENT THE BEDROOMS ARE EXISTING, AND EACH BEDROOM INCLUDES AT LEAST ONE COMPLIANT RESCUE WINDOW PER CODE, & ONE CLOSET ROOF DRAINGE SYSTEME GUTTERS & DOWNSPOUT AS PER PLANS AS PER CODE. ********* AS PER CHAP ATP: INSTALL AND MATCH 2 PANELS BELOW 2ND FLOOR BAYFRONT WINDOW TO MATCH ADJOING NEIGHBORS  PANELS IN SIZE AND DESIGN. (USE WOOD OR AZEK TO REPLICATE)  PAINT TO MATCH EXISTING TRIM COLOR INSTALL NEW GUTTERS AND DOWNSPOUTS AS PER CODE  NON-VISIBLE BASEMENT WINDOWS MADE RESCUE COMPLAINT AS PER CODE","IssuedDate":1703221200000,"ExpirationDate":1719048600000,"Address":"620 E 31ST ST","BLOCKLOT":"4074C009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":"1-09","ProposedUse":"1-09","Cost":58790,"IsPermitModification":0}},{"attributes":{"CaseNumber":"COM2021-84807","Description":"INTERIOR ALTERATIONS (800SQ.FT) TO INCLUDE: INTERIOR DEMOLITION (CATEGORY I): REMOVAL OF THE PLASTER, TRIM, NON-STRUCTURAL WALLS, FLOORING AND REMOVAL OF ALL ASSOCIATED DEBRIS, ALL WORK WILL BE DONE ACCORDING TO BALTIMORE CITY CODE. *THIS PERMIT IS FOR INTERIOR DEMOLITION ONLY, SEPARATE PERMIT WILL BE PULLED FOR ANY INTERIOR RENOVATIONS/TENANT FITOUT.","IssuedDate":1643864400000,"ExpirationDate":1659541260000,"Address":"620 E 31ST ST","BLOCKLOT":"4074C009","prc_block_no":"4074C","prc_lot":"009 ","ExistingUse":"1-09","ProposedUse":"1-09","Cost":800,"IsPermitModification":0}}]},"vbn":{"features":[]},"notice_1":{"features":[]},"notice_2":{"features":[]},"notice_3":{"features":[]},"notice_4":{"features":[{"attributes":{"NoticeNum":"2607703A","DateNotice":1769006760000,"NoticeType":"Exterior","Status":"NOTICE MAILED","Address":"620 E 31ST ST","Block":"4074C","Lot":"009","BlockLot":"4074C009"}}]},"zoning":{"features":[{"attributes":{"Zoning":"R-6","overlay":" ","Label":"R-6","URL":"https://s3.amazonaws.com/baltimorecity.gov.if-us-east-1/s3fs-public/2026-02/r5-10.pdf"}}]},"historic":{"features":[{"attributes":{"AREA_NAME":"Better Waverly","CHAPcode":"A29"}}]},"landmarks":{"features":[]},"national_register":{"features":[]},"flood":{"features":[]},"asof:C4":{"features":[{"attributes":{"mx":1790294400000}}]},"asof:C6":{"features":[{"attributes":{"mx":1790523180000}}]},"asof:C7_1":{"features":[{"attributes":{"mx":1790521080000}}]},"asof:C7_2":{"features":[{"attributes":{"mx":1790346480000}}]},"asof:C7_3":{"features":[{"attributes":{"mx":1790523180000}}]},"asof:C7_4":{"features":[{"attributes":{"mx":1790521800000}}]},"asof:C8":{"fields":[{"name":"Shape__Area"},{"name":"Shape__Length"}]},"asof:C9":{"editingInfo":{"lastEditDate":1685990390840,"schemaLastEditDate":1685990390840,"dataLastEditDate":1685990322999},"fields":[{"name":"FID"},{"name":"OBJECTID"}]},"asof:C10":{"fields":[{"name":"OBJECTID"},{"name":"BLOCKNUM"}]},"asof:C11":{"fields":[{"name":"OBJECTID"},{"name":"Class"}]},"asof:C12":{"editingInfo":{"lastEditDate":1753196980621,"schemaLastEditDate":1753196978817,"dataLastEditDate":1749503229392},"fields":[{"name":"OBJECTID"},{"name":"DFIRM_ID"}]}},"county":{"parcel":{"features":[{"attributes":{"TAXPIN":"2200002965","DISTRICT":"03","PREMISE_ADDRESS":"9616 REISTERSTOWN RD","ZIP_CODE":"21117","YEAR_BUILT":"0000","STRCT_SQFT":0,"LU_CODE":"COMMERCIAL","MAP":"0067","GRID":"0011","PARCEL":"0129","LOT":"   1A"}}]},"permits_count":{"count":7},"permits_rows":{"features":[{"attributes":{"PERMITNO":"C26-00815","APPL_DATE":1779062400000,"ISSDATE":1790467200000,"OCCDATE":null,"P_ADDRESS":"9616  REISTERSTOWNRD","TYPEDESCRIPTION":"Commercial Alteration","SUBTYPE_DESCRIPTION":null,"DESC_WORK":"Change of Occupancy from retail space to adventure park with interior alterations to demo/construct metal stud and drywall partitions, doors, ceilings, millwork, cabinetry, ductwork, equipment, fixtures, and finishes including indoor activity areas, seating areas, party rooms, break room, kitchen/cafe, office and ADA restrooms. Construct platforms, per plans. 32,697sf. Any additional work requires separate permit.","STATUS":"ISSUE","ZONING":"NO","EST_COST":"1000000.00"}},{"attributes":{"PERMITNO":"CS26-00286","APPL_DATE":1788220800000,"ISSDATE":1788220800000,"OCCDATE":null,"P_ADDRESS":"9616  REISTERSTOWNRD","TYPEDESCRIPTION":"Commercial Sign","SUBTYPE_DESCRIPTION":null,"DESC_WORK":"Install (2) building-mounted signs for DTLR (2.5' x 10.01') & re-face tenant panel (2.62' x 9.8') in existing shopping center pylon sign.","STATUS":"ISSUE","ZONING":"NO","EST_COST":"5000.00"}},{"attributes":{"PERMITNO":"CEN26-000102","APPL_DATE":1780272000000,"ISSDATE":1787616000000,"OCCDATE":null,"P_ADDRESS":"9616  REISTERSTOWNRD","TYPEDESCRIPTION":"Commercial Environmental","SUBTYPE_DESCRIPTION":"Grading","DESC_WORK":"Grade 1,344sf for BGE gas main replacement within the existing ROW throughout various streets. Permit expires two years from date of issue.\r\nNo construction to begin until pre-construction meeting. Failure to comply will result in penalties. Schedule your pre-construction meeting in your portal.","STATUS":"ISSUE","ZONING":"NO","EST_COST":"100000.00"}},{"attributes":{"PERMITNO":"COO25-0328","APPL_DATE":1756080000000,"ISSDATE":1757376000000,"OCCDATE":null,"P_ADDRESS":"9616  REISTERSTOWNRD","TYPEDESCRIPTION":"Commercial COO","SUBTYPE_DESCRIPTION":null,"DESC_WORK":"Selling Halloween costumes and decor'","STATUS":"CLOSED","ZONING":"NO","EST_COST":"1500.00"}},{"attributes":{"PERMITNO":"COO24-0365","APPL_DATE":1720310400000,"ISSDATE":1750204800000,"OCCDATE":1750204800000,"P_ADDRESS":"9616  REISTERSTOWNRD","TYPEDESCRIPTION":"Commercial COO","SUBTYPE_DESCRIPTION":null,"DESC_WORK":"Change of occupancy from retail store to retail store to be seasonal holiday store.  No alterations work to be done.","STATUS":"ISSUE","ZONING":"NO","EST_COST":"6500.00"}},{"attributes":{"PERMITNO":"CT25-0074","APPL_DATE":1747008000000,"ISSDATE":1749686400000,"OCCDATE":null,"P_ADDRESS":"9616  REISTERSTOWNRD","TYPEDESCRIPTION":"Commercial Temporary","SUBTYPE_DESCRIPTION":"Tent","DESC_WORK":"Erect tent from 6/23 - 7/9/25 for the retail sale of MD legal sparklers and ground based fountains.  Toilet facilities will be portable. Certificate of Flame Retardation is attached. 20' X 40' = 800sf. Tent(s) must be removed within 24 hours of the expiration date of this permit.  Failure to remove the tent(s) is a violation of the Baltimore County Code and can result in fines of up to $1,000 per day. Separate permit required for any electrical or plumbing work.","STATUS":"ISSUE","ZONING":"NO","EST_COST":null}},{"attributes":{"PERMITNO":"CS24-00281","APPL_DATE":1720310400000,"ISSDATE":1721606400000,"OCCDATE":null,"P_ADDRESS":"9616  REISTERSTOWNRD","TYPEDESCRIPTION":"Commercial Sign","SUBTYPE_DESCRIPTION":null,"DESC_WORK":"Installing Non-Electrical Store Front Sign (30' x 4')","STATUS":"ISSUE","ZONING":"NO","EST_COST":"1200.00"}}]},"zoning":{"features":[{"attributes":{"ZONE_CLASS":"BR","ZONE_DIST":"BR IM","DIST_CODE":"IM","URL":"http://bcgis.baltimorecountymd.gov/ZoningReports/BR.pdf"}}]},"historic":{"features":[]},"flood":{"features":[{"attributes":{"FLD_ZONE":"X","ZONE_SUBTY":"AREA OF MINIMAL FLOOD HAZARD","SFHA_TF":"F","STATIC_BFE":-9999,"DFIRM_ID":"240010"}}]},"asof:K3":{"fields":[{"name":"OBJECTID"},{"name":"SHAPE"}]},"asof:K4":{"features":[{"attributes":{"MX":1790467200000}}]},"asof:K5":{"fields":[{"name":"OBJECTID"},{"name":"PERIMETER"}]},"asof:K6":{"fields":[{"name":"OBJECTID"},{"name":"SHAPE"}]},"asof:K7":{"fields":[{"name":"OBJECTID"},{"name":"DISTRICT"}]}},"thamesFlood":{"features":[{"attributes":{"FLD_ZONE":"X2","ZONE_SUBTY":"0.2 PCT ANNUAL CHANCE FLOOD HAZARD","SFHA_TF":"F","STATIC_BFE":-9999,"DFIRM_ID":"240087"}}]},"woodlandParcel":{"features":[{"attributes":{"PIN":"4623046","BLOCKLOT":"4623 046","BLOCK":"4623 ","LOT":"046 ","FULLADDR":"3005 WOODLAND AVE","ZIP_CODE":"21215","YEAR_BUILD":0,"STRUCTAREA":0,"ZONECODE":"R-4  ","USEGROUP":"E ","DWELUNIT":0,"VACIND":"N","NEIGHBOR":"CENTRAL PARK HEIGHTS                     ","LDATE":"09272026"}}]},"towsonK3":{"features":[{"attributes":{"TAXPIN":"NOT LOCATED","DISTRICT":"09","PREMISE_ADDRESS":null,"ZIP_CODE":null,"YEAR_BUILT":null,"STRCT_SQFT":null,"LU_CODE":null,"MAP":null,"GRID":null,"PARCEL":null,"LOT":null}}]}}`;

// ════════════════════════════════════════════════════════════════════════════
// 31-40. BALTIMORE (Maryland) — lane RECORD, 2026-09-28. md.ts + the MD client
// renderer. Fixtures are the live bodies read 2026-09-28 for 620 E 31st St
// (City, block-lot 4074C009) and 9616 Reisterstown Rd (County, TAXPIN
// 2200002965), trimmed to the requested (SAFE) columns; no person in them.
// ════════════════════════════════════════════════════════════════════════════
{
  console.log('\nbuilding record (Baltimore City / Baltimore County):');
  // deno-lint-ignore no-explicit-any
  const FX: any = JSON.parse(MD_FIXTURES_JSON);
  const FETCHED = new Date('2026-09-28T15:00:00Z');
  const okJobs = (o: Record<string, unknown>): Partial<Record<MdJobId, MdFetched>> =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { status: 'ok' as const, body: v }])) as Partial<Record<MdJobId, MdFetched>>;
  const cityRec = assembleMdRecord({ side: 'baltimore_city', key: '4074C009', fetchedAt: FETCHED, jobs: okJobs(FX.city) });
  const countyRec = assembleMdRecord({ side: 'baltimore_county', key: '2200002965', fetchedAt: FETCHED, jobs: okJobs(FX.county) });
  const sCity = summarizeMdBuildingRecord(cityRec as unknown as ClientMdRecord);
  const sCounty = summarizeMdBuildingRecord(countyRec as unknown as ClientMdRecord);
  const withJobs = (base: Record<string, unknown>, over: Partial<Record<MdJobId, MdFetched>>, side: 'baltimore_city' | 'baltimore_county' = 'baltimore_city', key = '4074C009') =>
    assembleMdRecord({ side, key, fetchedAt: FETCHED, jobs: { ...okJobs(base), ...over } });
  const sumOf = (r: MdRecordSrv) => summarizeMdBuildingRecord(r as unknown as ClientMdRecord);
  const MD_SLOP = /\bclean\b|all clear|no violations\b|compliant|not vacant|not historic|no flood risk/i;

  // ── 31. requests, keys, hosts ──
  ok('31. parseMdRequest accepts md_resolve (pin kept only when both coordinates are in the Baltimore box)',
    deepEqual(parseMdRequest({ mode: 'md_resolve', text: ' 620 E 31st St, Baltimore, MD 21218 ', lat: 39.33, lon: -76.61 }), { mode: 'md_resolve', text: '620 E 31st St, Baltimore, MD 21218', lat: 39.33, lon: -76.61 })
    && deepEqual(parseMdRequest({ mode: 'md_resolve', text: 'x', lat: 40.7, lon: -76.61 }), { mode: 'md_resolve', text: 'x', lat: null, lon: null }));
  ok('31. parseMdRequest accepts md_record for a City block-lot and a County TAXPIN, normalizing the key',
    deepEqual(parseMdRequest({ mode: 'md_record', side: 'baltimore_city', key: '4074C 009', lat: 39.326, lon: -76.608 }), { mode: 'md_record', side: 'baltimore_city', key: '4074C009', lat: 39.326, lon: -76.608 })
    && deepEqual(parseMdRequest({ mode: 'md_record', side: 'baltimore_county', key: '2200002965', lat: 39.40, lon: -76.76 }), { mode: 'md_record', side: 'baltimore_county', key: '2200002965', lat: 39.40, lon: -76.76 }));
  ok('31. parseMdRequest refuses bad sides, injected keys, a County key on the City side, missing coordinates and other modes (so NYC falls through)',
    parseMdRequest({ mode: 'md_record', side: 'annapolis', key: '4074C009', lat: 39.3, lon: -76.6 }) === null
    && parseMdRequest({ mode: 'md_record', side: 'baltimore_city', key: "4074C009' OR '1'='1", lat: 39.3, lon: -76.6 }) === null
    && parseMdRequest({ mode: 'md_record', side: 'baltimore_city', key: '2200002965', lat: 39.3, lon: -76.6 }) === null
    && parseMdRequest({ mode: 'md_record', side: 'baltimore_county', key: 'NOT LOCATED', lat: 39.3, lon: -76.6 }) === null
    && parseMdRequest({ mode: 'md_record', side: 'baltimore_county', key: '2200002965', lat: null, lon: -76.6 }) === null
    && parseMdRequest({ mode: 'md_resolve', text: '' }) === null && parseMdRequest({ mode: 'resolve', text: '120 Broadway' }) === null
    && parseMdRequest({ mode: 'nj_resolve', text: '94 Washington St' }) === null && parseMdRequest(null) === null);
  ok("31. block-lot normalizer: '4074C 009' and '4074C009' are one key, '3172 042' is kept, junk is null",
    normalizeCityBlockLot('4074C 009') === '4074C009' && normalizeCityBlockLot('4074C009') === '4074C009' && normalizeCityBlockLot('3172 042') === '3172 042'
    && normalizeCityBlockLot('3172042') === '3172 042' && normalizeCityBlockLot('5213 047A') === '5213 047A' && normalizeCityBlockLot('NOT LOCATED') === null && normalizeCityBlockLot("1' OR 1") === null);
  ok('31. the permits/notices IN list carries BOTH spellings (the block-lot trap)',
    deepEqual(cityBlockLotVariants('4074C009').sort(), ['4074C 009', '4074C009']) && deepEqual(cityBlockLotVariants('3950 022').sort(), ['3950 022', '3950022'])
    && mdWhere('C4', 'baltimore_city', '4074C009') === "BLOCKLOT IN ('4074C009','4074C 009')" && mdWhere('C6', 'baltimore_city', '4074C009') === "BLOCKLOT IN ('4074C009','4074C 009')");
  ok('31. isAllowedMdUrl refuses a foreign host, a look-alike prefix and a raw quote',
    !isAllowedMdUrl('https://evil.example/arcgis/rest/services/x') && !isAllowedMdUrl('https://baltegis.baltimorecity.gov.evil.example/mapping/rest/services/x')
    && !isAllowedMdUrl("https://baltegis.baltimorecity.gov/mapping/rest/services/x?where='1'") && !isAllowedMdUrl(null) && isAllowedMdUrl('https://bcgisdata.baltimorecountymd.gov/arcgis/rest/services/x'));
  const mdInput = mdAddressInput('620 E 31st St, Baltimore, MD 21218');
  const cityPlan = mdRecordPlan('baltimore_city', '4074C009', 39.326002256022, -76.60807094633) ?? [];
  const countyPlan = mdRecordPlan('baltimore_county', '2200002965', 39.404161179553775, -76.76314010859662) ?? [];
  const mdBuilt = [
    mdInput && cityGeocodeUrl(mdInput), mdInput && countyGeocodeUrl(mdInput), censusCountyUrl('1 Church Cir, Annapolis, MD 21401'),
    parcelPointUrl('baltimore_city', 39.3, -76.6), parcelPointUrl('baltimore_county', 39.4, -76.7),
    ...cityPlan.map((j) => j.url), ...countyPlan.map((j) => j.url),
  ];
  // Content rights (2026-10-03): the City plan no longer reads the unpublished
  // housing-notices feed (4 layers), CHAP landmarks or National Register
  // districts, nor their as-of probes: 24 → 12 City jobs.
  ok('31. every MD builder URL is on the allow-list (and the record plans are complete: 12 City jobs, 11 County jobs)',
    cityPlan.length === 12 && countyPlan.length === 11 && mdBuilt.every((u) => !!u && isAllowedMdUrl(u)), mdBuilt.filter((u) => !u || !isAllowedMdUrl(u)).join(', '));
  ok('31. no MD plan or layer reads the three unlicensed City layers (housing notices feed, CHAP landmarks, National Register)',
    mdBuilt.every((u) => !/NoticesInspections|CHAPLandmarks|Planning\/Boundaries\/MapServer\/11/.test(u ?? ''))
    && Object.values(MD_LAYERS).every((l) => !/NoticesInspections|CHAPLandmarks|Planning\/Boundaries\/MapServer\/11/.test(l.layer + l.page)),
    mdBuilt.filter((u) => /NoticesInspections|CHAPLandmarks|Boundaries/.test(u ?? '')).join(', '));
  ok('31. the postal city is dropped from the geocoder text; ZIP and house number are kept as guards',
    !!mdInput && mdInput.query === '620 E 31st St, MD 21218' && mdInput.zip === '21218' && mdInput.houseNumber === '620'
    && mdAddressInput('9616 Reisterstown Rd, Baltimore, MD')?.query === '9616 Reisterstown Rd, MD');
  ok('31. an unsanitized key or a point outside the box builds no URL / no plan',
    mdRecordPlan('baltimore_city', "4074C009'--", 39.3, -76.6) === null && mdRecordPlan('baltimore_city', '4074C009', 40.7, -74.0) === null
    && pointQueryUrl('C12', 40.7, -74.0) === null && countQueryUrl('C4', 'baltimore_city', 'DROP TABLE') === null);

  // ── 32. PRIVACY: allow-list outFields ──
  // COMMON's SAFE lists (RECORD spec, revision 2026-09-28), copied here on purpose:
  // md.ts must EQUAL them as sets, so adding ANY field (banned or not) fails.
  const SAFE: Record<string, string[]> = {
    C3: ['PIN', 'BLOCKLOT', 'BLOCK', 'LOT', 'FULLADDR', 'ZIP_CODE', 'YEAR_BUILD', 'STRUCTAREA', 'ZONECODE', 'USEGROUP', 'DWELUNIT', 'VACIND', 'NEIGHBOR', 'LDATE'],
    C4: ['CaseNumber', 'Description', 'IssuedDate', 'ExpirationDate', 'Address', 'BLOCKLOT', 'prc_block_no', 'prc_lot', 'ExistingUse', 'ProposedUse', 'Cost', 'IsPermitModification'],
    C6: ['NoticeNum', 'DateNotice', 'DateCancel', 'DateAbate', 'NT', 'BLOCKLOT', 'Address', 'Neighborhood'],
    C8: ['Zoning', 'overlay', 'Label', 'URL'],
    C9: ['AREA_NAME', 'CHAPcode'],
    C12: ['FLD_ZONE', 'ZONE_SUBTY', 'SFHA_TF', 'STATIC_BFE', 'DFIRM_ID'],
    K3: ['TAXPIN', 'DISTRICT', 'PREMISE_ADDRESS', 'ZIP_CODE', 'YEAR_BUILT', 'STRCT_SQFT', 'LU_CODE', 'MAP', 'GRID', 'PARCEL', 'LOT'],
    K4: ['PERMITNO', 'APPL_DATE', 'ISSDATE', 'OCCDATE', 'P_ADDRESS', 'TYPEDESCRIPTION', 'SUBTYPE_DESCRIPTION', 'DESC_WORK', 'STATUS', 'ZONING', 'EST_COST'],
    K5: ['ZONE_CLASS', 'ZONE_DIST', 'DIST_CODE', 'URL'],
    K6: ['FLD_ZONE', 'ZONE_SUBTY', 'SFHA_TF', 'STATIC_BFE', 'DFIRM_ID'],
    K7: ['DISTRICT', 'DATE_LISTE'],
  };
  const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));
  const layerIds = Object.keys(MD_LAYERS) as (keyof typeof MD_LAYERS)[];
  ok('32. every MD layer outFields constant EQUALS its SAFE list as a set (11 layers; C7_1-4, C10, C11 retired for content rights)',
    layerIds.length === 11 && layerIds.every((id) => sameSet(MD_LAYERS[id].outFields.split(','), SAFE[id] ?? []) && sameSet([...MD_SAFE_FIELDS[id]], SAFE[id] ?? [])),
    layerIds.filter((id) => !sameSet(MD_LAYERS[id].outFields.split(','), SAFE[id] ?? [])).join(','));
  const BACKSTOP = /OWN|MAIL|DEED|SALE|TENANT|CONTRACT|ENGINEER|ARCHITECT|_USER|INITIATED|CNTCT|SCAN|PERMHOME|PROPDESC|NAME_FIRST|NAME_LAST|PermitName|projname/i;
  const outFieldsOf = (u: string | null | undefined) => { const m = /[?&]outFields=([^&]*)/.exec(u ?? ''); return m ? decodeURIComponent(m[1]) : null; };
  const builtOut = mdBuilt.map(outFieldsOf).filter((x): x is string => x !== null);
  ok('32. the backstop regex matches no MD outFields constant and no outFields= value of any built URL',
    layerIds.every((id) => !BACKSTOP.test(MD_LAYERS[id].outFields)) && builtOut.length >= 15 && builtOut.every((v) => !BACKSTOP.test(v) && v !== '*'),
    builtOut.filter((v) => BACKSTOP.test(v)).join(' | '));
  const mdSrcText = read('supabase/functions/building-record/md.ts');
  const idxText = read('supabase/functions/building-record/index.ts');
  ok("32. the literal 'outFields=*' appears nowhere in md.ts or index.ts", !mdSrcText.includes('outFields=*') && !idxText.includes('outFields=*'));
  const taxUses = mdSrcText.split('\n').filter((l) => l.includes('TAX_ASSMT_NUMBER') && !/^\s*(\/\/|\*)/.test(l));
  const k4Urls = countyPlan.filter((j) => j.url.includes('/ActiveDevelopment/MapServer/4/query') && j.url.includes('TAX_ASSMT'));
  ok('32. TAX_ASSMT_NUMBER appears only in the K4 WHERE clause (never in outFields, never in a record)',
    taxUses.length === 1 && /return `TAX_ASSMT_NUMBER='\$\{key\}'`;/.test(taxUses[0]) && countyPlan.filter((j) => j.url.includes('TAX_ASSMT')).length === 2
    && k4Urls.length === 2 && k4Urls.every((j) => /where=TAX_ASSMT_NUMBER/.test(j.url) && !(outFieldsOf(j.url) ?? '').includes('TAX_ASSMT'))
    && !JSON.stringify(countyRec).includes('TAX_ASSMT'), taxUses.join(' | '));
  ok('32. no owner, sale, deed or mailing field reaches a record (the fixtures only carry SAFE columns)',
    !BACKSTOP.test(Object.keys(JSON.parse(JSON.stringify(cityRec))).join(',')) && !/OWNER|MAILTOADD|SALEPRIC|DEEDBOOK|CNTCT/.test(JSON.stringify(FX)));

  // ── 33. the bounded resolve planner ──
  const pt = (from: 'city' | 'county', i: number, score = 99, type = 'PointAddress', addr?: string): MdGeoPoint =>
    ({ from, lat: 39.3 + i * 0.001 + (from === 'county' ? 0.05 : 0), lon: -76.6 - i * 0.001, score, address: addr ?? `${100 + i} ${from.toUpperCase()} ST`, type, match: 'address' });
  const six = (from: 'city' | 'county') => Array.from({ length: 6 }, (_, i) => pt(from, i));
  const plan66 = planMdResolve(six('city'), six('county'));
  ok('33. 6 + 6 candidates → at most 6 unique points and at most 12 parcel probes', plan66.length <= 6 && plan66.reduce((n, p) => n + p.order.length, 0) <= 12, String(plan66.length));
  ok("33. each point probes its OWN geocoder's parcel layer first (a County point → K3 first)",
    plan66.every((p) => p.order[0] === (p.point.from === 'county' ? 'baltimore_county' : 'baltimore_city') && p.order.length === 2 && p.order[0] !== p.order[1]));
  ok('33. the list interleaves the geocoders (best City, best County, …)', plan66[0].point.from === 'city' && plan66[1].point.from === 'county');
  const liveCity = mdInput ? geocodePoints(FX.cityGeo, 'city', mdInput) : [];
  ok('33. the live City geocode for 620 E 31st St keeps 3 points, rooftop and parcel before the street centreline',
    liveCity.length === 3 && liveCity[2].type === 'StreetAddress' && liveCity.slice(0, 2).every((p) => p.type !== 'StreetAddress'), liveCity.map((p) => p.type).join(','));
  const low = { candidates: [
    { address: '620 E 31ST ST, MD, 21218', location: { x: -76.6087, y: 39.3259 }, score: 79.9, attributes: { Addr_type: 'PointAddress', Postal: '21218' } },
    { address: 'E 31ST ST, MD, 21218', location: { x: -76.6134, y: 39.3259 }, score: 85.2, attributes: { Addr_type: 'StreetName', Postal: '21218' } },
    { address: '400 WASHINGTON BLVD, MD, 21230', location: { x: -76.63, y: 39.28 }, score: 94.8, attributes: { Addr_type: 'StreetAddressExt', Postal: '21230' } },
    { address: '620 E 31ST ST, Baltimore, 21213', location: { x: -76.60, y: 39.32 }, score: 99, attributes: { Addr_type: 'PointAddress', Postal: '21213' } },
    { address: '622 E 31ST ST, Baltimore, 21218', location: { x: -76.60, y: 39.32 }, score: 97, attributes: { Addr_type: 'PointAddress', Postal: '21218' } },
  ] };
  ok('33. a below-threshold, a bare-street, an extension, a wrong-ZIP and a wrong-house-number candidate are all dropped',
    !!mdInput && geocodePoints(low, 'city', mdInput).length === 0);
  const dupCity = [pt('city', 0, 99, 'PointAddress', '9616 REISTERSTOWN RD, OWINGS MILLS, 21117')];
  const dupCounty = [{ ...pt('county', 0, 100, 'PointAddress', '9616 REISTERSTOWN RD, OWINGS MILLS, MD, 21117') }, pt('county', 1, 90, 'StreetAddress', '9616 REISTERSTOWN RD, OWINGS MILLS, 21117')];
  const dupPlan = planMdResolve(dupCity, dupCounty);
  ok('33. the same address from BOTH geocoders is probed once; one geocoder\'s rooftop and street points both stay',
    dupPlan.length === 1 && planMdResolve([], dupCounty).length === 2, `${dupPlan.length}`);
  ok('33. points closer than ~1 m are merged', planMdResolve([pt('city', 0), { ...pt('city', 0), address: '1 OTHER ST', score: 98 }], []).length === 1);

  // ── 34. resolve outcomes ──
  const P = (from: 'city' | 'county'): MdProbe => ({ point: pt(from, 0), order: from === 'city' ? ['baltimore_city', 'baltimore_county'] : ['baltimore_county', 'baltimore_city'] });
  const cityCand = parcelHitFrom(FX.city.parcel, 'baltimore_city', pt('city', 0));
  const countyCand = parcelHitFrom(FX.county.parcel, 'baltimore_county', pt('county', 0));
  const notLocated = parcelHitFrom(FX.towsonK3, 'baltimore_county', pt('county', 0));
  ok("34. a parcel body → a candidate labelled with the SIDE; a County 'NOT LOCATED' polygon → inside, no parcel; [] → none; an error body → unread",
    cityCand.kind === 'parcel' && cityCand.candidate.side === 'baltimore_city' && cityCand.candidate.key === '4074C009' && cityCand.candidate.label === '620 E 31st St, Baltimore City · block-lot 4074C 009'
    && countyCand.kind === 'parcel' && countyCand.candidate.key === '2200002965' && countyCand.candidate.label.includes('Baltimore County') && !countyCand.candidate.label.includes('2200002965')
    && notLocated.kind === 'inside_no_parcel' && parcelHitFrom({ features: [] }, 'baltimore_city', pt('city', 0)).kind === 'none'
    && parcelHitFrom({ error: { code: 400 } }, 'baltimore_city', pt('city', 0)).kind === 'unread');
  const allTimedOut = mdResolveOutcome([{ probe: P('city'), hits: [{ side: 'baltimore_city', hit: 'timeout' }] }, { probe: P('county'), hits: [{ side: 'baltimore_county', hit: 'failed' }] }], { county: 'Anne Arundel County' });
  ok('34. a resolve where every probe timed out or failed returns the MD_ERRORS text, never md_outside',
    allTimedOut.status === 'error' && allTimedOut.error === MD_ERRORS.upstream && MD_ERRORS.upstream === "Couldn't finish the Baltimore lookup. Nothing was checked.");
  const none = { kind: 'none' as const };
  const outside = mdResolveOutcome([{ probe: P('city'), hits: [{ side: 'baltimore_city', hit: none }, { side: 'baltimore_county', hit: none }] }], { county: 'Anne Arundel County' });
  ok('34. both layers read, neither contains the point → md_outside with the Census county', outside.status === 'md_outside' && outside.county === 'Anne Arundel County');
  const halfRead = mdResolveOutcome([{ probe: P('city'), hits: [{ side: 'baltimore_city', hit: none }, { side: 'baltimore_county', hit: 'timeout' }] }], null);
  ok('34. one layer read "not inside" and the other timed out → NOT outside (never claims what was not read)', halfRead.status !== 'md_outside', halfRead.status);
  const countyOnly = mdResolveOutcome([{ probe: P('city'), hits: [{ side: 'baltimore_city', hit: none }, { side: 'baltimore_county', hit: countyCand }] }], null);
  ok('34. a County address never produces a City record: only the County parcel contains the point → County candidates only',
    countyOnly.status === 'md_candidates' && countyOnly.candidates.length === 1 && countyOnly.candidates.every((c) => c.side === 'baltimore_county'));
  const insideOnly = mdResolveOutcome([{ probe: P('county'), hits: [{ side: 'baltimore_county', hit: notLocated }] }], null);
  ok('34. inside a County right-of-way only → no candidates (the card says nothing was checked), not outside', insideOnly.status === 'md_candidates' && insideOnly.candidates.length === 0);
  const dup = mdResolveOutcome([{ probe: P('city'), hits: [{ side: 'baltimore_city', hit: cityCand }] }, { probe: P('city'), hits: [{ side: 'baltimore_city', hit: cityCand }] }], null);
  ok('34. candidates are deduped by side + key', dup.status === 'md_candidates' && dup.candidates.length === 1);
  const redundant = probeIsRedundant({ point: { ...pt('city', 5), address: '100 CITY ST, MD' }, order: ['baltimore_city', 'baltimore_county'] }, [{ probe: { point: pt('city', 0), order: ['baltimore_city', 'baltimore_county'] }, hits: [{ side: 'baltimore_city', hit: cityCand }] }]);
  ok('34. a later point with an already-resolved address from the same geocoder is skipped (early stop)', redundant);

  // ── 35. the bounded pool ──
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let inFlight = 0, peak = 0;
  const poolRes = await runBounded(Array.from({ length: 8 }, (_, i) => async () => { inFlight++; peak = Math.max(peak, inFlight); await sleep(5); inFlight--; if (i === 3) throw new Error('x'); return i; }), { concurrency: 3, deadlineMs: 2000 });
  ok('35. runBounded never runs more than `concurrency` tasks at once and keeps each result in its slot',
    peak === 3 && poolRes.length === 8 && poolRes[3].status === 'failed' && poolRes.filter((r) => r.status === 'ok').length === 7 && (poolRes[7] as { value: number }).value === 7);
  const slow = await runBounded([async () => { await sleep(300); return 1; }, async () => 2, async () => 3], { concurrency: 1, deadlineMs: 60 });
  ok('35. at the deadline, the pending task and the never-started ones are timeout', slow[0].status === 'timeout' && slow[1].status === 'timeout' && slow[2].status === 'timeout');
  const skipped = await runBounded([async () => 1, async () => 2], { concurrency: 1, deadlineMs: 1000, skip: (i) => i === 1 });
  ok('35. a skipped task never runs', skipped[1].status === 'skipped' && skipped[0].status === 'ok');

  // ── 36. the record ──
  ok('36. the live City record (620 E 31st St): 1920, R-6, Better Waverly CHAP district, 9 permits (5 kept), no flood polygon',
    cityRec.parcel.yearBuilt === 1920 && cityRec.parcel.zoning === 'R-6' && cityRec.parcel.asOf === '2026-09-27' && cityRec.zoning.rows[0]?.code === 'R-6'
    && cityRec.historic.rows[0]?.name === 'Better Waverly' && cityRec.historic.asOf === '2023-06-05' && cityRec.historic.asOfKind === 'edited'
    && cityRec.permits.total === 9 && cityRec.permits.rows.length === 5 && !cityRec.permits.truncated && cityRec.permits.asOf === '2026-09-25'
    && cityRec.permits.rows.every((r) => r.status === null)
    && cityRec.flood.rows.length === 0 && cityRec.flood.asOf === '2025-06-09' && mdRecordComplete(cityRec), JSON.stringify({ p: cityRec.parcel, n: cityRec.housingNotices.map((x) => x.rows.length) }));
  // WIRE COMPATIBILITY (md.ts): installed apps refuse a City record without four
  // housingNotices parts and non-null landmarks / nationalRegister parts, so the
  // unread layers still ride the wire as 'failed' parts with no rows, which
  // every client renders as "Couldn't read <source> — not checked".
  ok('36. the unlicensed City layers ride the wire as unread parts: failed, no rows, no as-of, a source that says MAGE no longer checks it; the CoDeMap link is offered',
    cityRec.housingNotices.length === 4
    && cityRec.housingNotices.every((p) => p.status === 'failed' && p.rows.length === 0 && p.asOf === null && p.asOfKind === 'unread' && /no longer checks it/.test(p.source))
    && deepEqual(cityRec.housingNotices.map((p) => p.layer), ['Interior', 'Interior/exterior', 'Vacant', 'Exterior'])
    && [cityRec.landmarks, cityRec.nationalRegister].every((p) => !!p && p.status === 'failed' && p.rows.length === 0 && /no longer checks it/.test(p.source))
    && cityRec.links.some((l) => l.url.startsWith('https://cels.baltimorehousing.org/') && /CoDeMap/.test(l.label)),
    JSON.stringify({ n: cityRec.housingNotices.map((p) => [p.status, p.rows.length]), l: cityRec.landmarks?.status, nr: cityRec.nationalRegister?.status }));
  ok("36. the block-lot trap: permits stored as '4074C 009' and '4074C009' are all matched to the parcel",
    cityRec.permits.rows.some((r) => r.number === 'BUSE-26-005160') && cityRec.permits.rows.some((r) => r.number === 'BRCM-26-009216'));
  ok('36. the live County record (9616 Reisterstown Rd): YEAR_BUILT 0000 → null, BR IM, flood X, 7 permits with STATUS verbatim, as of 2026-09-27',
    countyRec.parcel.yearBuilt === null && countyRec.zoning.rows[0]?.code === 'BR IM' && countyRec.flood.rows[0]?.zone === 'X' && countyRec.permits.total === 7
    && countyRec.permits.rows[0]?.status === 'ISSUE' && countyRec.permits.rows.some((r) => r.status === 'CLOSED') && countyRec.permits.asOf === '2026-09-27'
    && countyRec.vacantNotices === null && countyRec.housingNotices.length === 0 && countyRec.landmarks === null, JSON.stringify(countyRec.parcel));
  ok('36. unknowns are unknown: YEAR_BUILD 0 → null, STRUCTAREA 0 → null, STATIC_BFE -9999 → null, cost 0 → null',
    yearOrNull(0) === null && yearOrNull('0000') === null && yearOrNull(1924) === 1924 && bfeOrNull(-9999) === null && bfeOrNull(9.4) === 9.4
    && mdDollarsToCents(0) === null && mdDollarsToCents('0.00') === null && mdDollarsToCents('1000000.00') === 100000000 && mdDollarsToCents(1000) === 100000);
  const woodland = withJobs(FX.city, { parcel: { status: 'ok', body: FX.woodlandParcel } }, 'baltimore_city', '4623 046');
  ok('36. 3005 Woodland Ave: YEAR_BUILD 0 reads "Year built not recorded" and the lead line says MAGE can\'t tell',
    woodland.parcel.yearBuilt === null && woodland.parcel.areaSqft === null
    && sumOf(woodland).lines.includes("Year built not recorded, so MAGE can't say whether pre-1978 lead rules apply.")
    && sumOf(woodland).lines.every((l) => !/built in 0|year 0|\b0 sq ft/i.test(l)));
  ok('36. dates: epoch ms → UTC day; LDATE MMDDYYYY → ISO; the County MX alias is read', mdDay(1790308800000) === '2026-09-25' && ldateDay('09272026') === '2026-09-27'
    && asOfFrom('K4', FX.county['asof:K4']).asOf === '2026-09-27' && asOfFrom('C8', { fields: [{ name: 'Zoning' }] }).asOfKind === 'none' && asOfFrom('C8', { error: {} }).asOfKind === 'unread');
  const X2 = withJobs(FX.city, { flood: { status: 'ok', body: FX.thamesFlood } });
  const x2Lines = sumOf(X2).lines;
  ok("36. an X2 flood line names the City's 0.2% rule; the floodplain trigger cites the City program; never 'no flood risk'",
    x2Lines.some((l) => l.startsWith("Flood zone X2: in the 0.2% annual-chance flood area, which Baltimore City's floodplain rules also cover"))
    && x2Lines.some((l) => l.startsWith("In Baltimore City's regulated floodplain") && l.includes('City floodplain program, checked 2026-09-28'))
    && [...x2Lines, sumOf(X2).promptBlock].every((l) => !/no flood risk/i.test(l)), x2Lines.join(' | '));
  const countyX2 = withJobs(FX.county, { flood: { status: 'ok', body: { features: [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999, DFIRM_ID: '240010' } }] } } }, 'baltimore_county', '2200002965');
  ok("36. the City's 0.2% rule is never extended to the County", sumOf(countyX2).lines.some((l) => l.startsWith("Flood zone X: in the 0.2% annual-chance flood area on FEMA's map")) && sumOf(countyX2).lines.every((l) => !/Baltimore City's floodplain/.test(l)));
  const countyAE = withJobs(FX.county, { flood: { status: 'ok', body: { features: [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', STATIC_BFE: 12, DFIRM_ID: '240010' } }] } } }, 'baltimore_county', '2200002965');
  ok('36. a County 1% zone cites PAI and the County codes sheet (Bill 6-24), with its base flood elevation', sumOf(countyAE).lines.some((l) => l.includes('base flood elevation 12 ft')) && sumOf(countyAE).lines.some((l) => l.includes('Bill 6-24') && l.includes('PAI Building Inspections, checked 2026-09-28')));

  // ── 37. summary kinds + honesty ──
  const NYC_KINDS = ['none', 'attention', 'no_active_in_checked', 'incomplete'];
  // A record SAVED before the content-rights change (a phone's cached copy) can
  // still carry read housing notices, landmarks and National Register parts.
  // The client renders whatever it is given, so its notice rules are proven on
  // such records, built from this record's own read parts.
  const LEGACY_FEED = 'City inspections map feed (not a published dataset)';
  const legacyCity = (notice: (i: number, base: Record<string, unknown>) => Record<string, unknown> = (_i, b) => b): ClientMdRecord => {
    const r = JSON.parse(JSON.stringify(cityRec));
    const okNotice = (layer: string) => ({ ...r.vacantNotices, layer, source: LEGACY_FEED, truncated: false, rows: [] });
    const okArea = (source: string) => ({ ...r.historic, source, rows: [] });
    return {
      ...r,
      housingNotices: ['Interior', 'Interior/exterior', 'Vacant', 'Exterior'].map((layer, i) => notice(i, okNotice(layer))),
      landmarks: okArea("the City's CHAP landmark layer"),
      nationalRegister: okArea("the City's National Register district layer"),
    } as unknown as ClientMdRecord;
  };
  const sNo = summarizeMdBuildingRecord(legacyCity());
  const sLegacyExt = summarizeMdBuildingRecord(legacyCity((i, b) => (i === 3 ? { ...b, rows: [{ number: '2607703A', date: '2026-01-21', type: 'Exterior', statusCode: 'NOTICE MAILED' }] } : b)));
  const sFailedNotice = summarizeMdBuildingRecord(legacyCity((i, b) => (i === 1 ? { ...b, status: 'timeout', asOf: null, asOfKind: 'unread' } : b)));
  const sTruncNotice = summarizeMdBuildingRecord(legacyCity((i, b) => (i === 3 ? { ...b, truncated: true } : b)));
  ok("37. a City record read today is 'incomplete' (the housing notices are not checked), never 'no_active_in_checked'; an open vacant building notice still makes it 'attention'",
    sCity.kind === 'incomplete' && sCity.headline === 'Some Baltimore City datasets could not be fully checked for this parcel; see below.'
    && sCity.lines.includes("Couldn't read the exterior notices in the unpublished City inspections feed (MAGE no longer checks it; see the CoDeMap link) — not checked")
    && sCity.lines.every((l) => !/^No open (interior|exterior|vacant notices)/i.test(l) || l.startsWith('No open vacant building notice in City vacant building notices')),
    `${sCity.kind} ${sCity.headline}`);
  ok("37. a saved pre-change record is still rendered by the rules: open exterior notice → 'attention'; a notice-free one → 'no_active_in_checked' with the spec headline",
    sLegacyExt.kind === 'attention' && sLegacyExt.headline === "Baltimore City records list open notices for this parcel: 1 exterior notice (as of 2026-09-27)."
    && sLegacyExt.lines.some((l) => l.startsWith('Open exterior notice 2607703A, dated 2026-01-21, DHCD status code: NOTICE MAILED'))
    && sNo.kind === 'no_active_in_checked' && sNo.headline === 'No open notices listed in the City datasets MAGE checked (as of 2026-09-27)', `${sLegacyExt.kind} ${sLegacyExt.headline} | ${sNo.kind} ${sNo.headline}`);
  const failedVbn = withJobs(FX.city, { vbn: { status: 'failed' } });
  const failedOverlay = withJobs(FX.city, { flood: { status: 'failed' } });
  ok("37. 'no_active_in_checked' is impossible when any notice part failed, timed out or was truncated, or any other part failed",
    [sFailedNotice, sTruncNotice, sumOf(failedVbn), sumOf(failedOverlay), sCity].every((x) => x.kind === 'incomplete'), [sFailedNotice, sTruncNotice, sumOf(failedVbn), sumOf(failedOverlay)].map((x) => x.kind).join(','));
  ok('37. a failed part reads "Couldn\'t read <source> — not checked", never 0 / none / "No open"',
    sFailedNotice.lines.includes(`Couldn't read the interior/exterior notices in the ${LEGACY_FEED} — not checked`)
    && sumOf(failedVbn).lines.includes("Couldn't read City vacant building notices — not checked")
    && sumOf(failedVbn).lines.every((l) => !/^No open vacant building notice/.test(l)) && sFailedNotice.lines.every((l) => !/No open interior\/exterior/.test(l) && !/^0 /.test(l)));
  const failedPermits = withJobs(FX.city, { permits_rows: { status: 'timeout' } });
  ok('37. failed permits: total null, "Couldn\'t read City permits (2019 to present) — not checked", no "0 permits"',
    failedPermits.permits.total === null && sumOf(failedPermits).lines.includes("Couldn't read City permits (2019 to present) — not checked") && sumOf(failedPermits).lines.every((l) => !/\b0 City permits|No City permits/.test(l)));
  ok("37. a County record is ALWAYS 'incomplete' and says code enforcement was not checked",
    sCounty.kind === 'incomplete' && sCounty.headline === 'Baltimore County parcel, permits, zoning, flood map and historic districts read (as of 2026-09-27). Code enforcement not checked.'
    && sumOf(withJobs(FX.county, { flood: { status: 'failed' } }, 'baltimore_county', '2200002965')).headline === 'Baltimore County parcel, permits, zoning and historic districts read (as of 2026-09-27); flood map could not be read. Code enforcement not checked.', sCounty.headline);
  const everyMd = [sCity, sCounty, sNo, sLegacyExt, sFailedNotice, sTruncNotice, sumOf(failedVbn), sumOf(failedPermits), sumOf(X2), sumOf(woodland), sumOf(countyAE)];
  ok('37. every MD summary kind stays inside the NYC union', everyMd.every((x) => NYC_KINDS.includes(x.kind)) && summarizeMdBuildingRecord(null).kind === 'none' && summarizeMdBuildingRecord(undefined).lines.length === 0);
  ok('37. no MD summary says clean / all clear / no violations / compliant / not vacant / not historic / no flood risk',
    everyMd.every((x) => [x.headline, x.chipLabel, x.promptBlock, ...x.lines].every((l) => !MD_SLOP.test(l))), everyMd.flatMap((x) => [x.headline, ...x.lines]).filter((l) => MD_SLOP.test(l)).join(' | '));
  ok('37. the last card line is always "Not checked: …" and every fact line names its source', everyMd.every((x) => x.lines[x.lines.length - 1].startsWith('Not checked:')));
  ok('37. City permits never carry a status; County permits carry STATUS verbatim',
    sCity.lines.filter((l) => /^(BUSE|BRCM|COM)\d*-/.test(l)).length === 5 && sCity.lines.filter((l) => /^(BUSE|BRCM|COM)\d*-/.test(l)).every((l) => !/status/i.test(l)) && sCounty.lines.some((l) => l.includes('County status ISSUE')) && sCounty.lines.some((l) => l.includes('County status CLOSED')));
  ok('37. the pre-1978 trigger (City, 1920) cites MDE and EPA, states the rental condition and never asserts one',
    sCity.lines.some((l) => l.startsWith('Built 1920, before 1978. If it is a rental home') && l.includes('MDE, checked 2026-09-28') && l.includes('EPA, checked 2026-09-28'))
    && sCity.promptBlock.includes(MD_SOURCES.mdeLead.url) && sCity.promptBlock.includes(MD_SOURCES.epaRrp.url)
    && everyMd.every((x) => [...x.lines, ...x.promptBlock.split('\n')].every((l) => !/rental/.test(l) || l.includes('If it is a rental home'))));
  ok('37. the CHAP trigger (Better Waverly) cites CHAP and DHCD special referrals', sCity.lines.some((l) => l.startsWith('Exterior work here needs CHAP approval (an Authorization to Proceed)') && l.includes('DHCD special referrals')));
  const vbnRec = withJobs(FX.city, { vbn: { status: 'ok', body: { features: [{ attributes: { NoticeNum: '2655955A', DateNotice: 1780000000000, NT: 'Vacant', BLOCKLOT: '4074C009' } }] } } });
  ok('37. an open vacant building notice is attention, listed first, and gets its trigger line', sumOf(vbnRec).kind === 'attention' && sumOf(vbnRec).lines[0].startsWith('Open vacant building notice 2655955A') && sumOf(vbnRec).lines.includes('Open vacant building notice 2655955A dated 2026-05-28.'));

  // ── 38. promptBlock ──
  const bigPermits = { features: Array.from({ length: 50 }, (_, i) => ({ attributes: { CaseNumber: `BRCM-26-${String(i).padStart(6, '0')}`, Description: 'INSTALL NEW KITCHEN CABINETS, COUNTERTOPS, PLUMBING FIXTURES AND ELECTRICAL CIRCUITS AS PER CODE AND AS PER PLANS '.repeat(2), IssuedDate: 1780000000000 - i * 86400000, ExpirationDate: null, BLOCKLOT: '4074C009', Cost: 1000 } })) };
  const big = withJobs(FX.city, { permits_count: { status: 'ok', body: { count: 60 } }, permits_rows: { status: 'ok', body: bigPermits }, flood: { status: 'ok', body: FX.thamesFlood }, vbn: { status: 'ok', body: { features: [{ attributes: { NoticeNum: '2655955A', DateNotice: 1780000000000, NT: 'Vacant', BLOCKLOT: '4074C009' } }] } } });
  const sBig = sumOf(big);
  const RULES_CITY_END = 'Never tell the contractor the building is free of problems or meets code.';
  ok('38. a 60-permit record forces trimming: promptBlock <= 2,400, starts with the header, ends with the RULES paragraph',
    big.permits.total === 60 && big.permits.truncated && sBig.promptBlock.length <= MD_PROMPT_CAP && sBig.promptBlock.startsWith('BUILDING RECORD (Baltimore City open data, fetched by MAGE 2026-09-28)')
    && sBig.promptBlock.split('\n').pop()!.startsWith('RULES: These are public records as published, not a finding by MAGE.') && sBig.promptBlock.endsWith(RULES_CITY_END), String(sBig.promptBlock.length));
  ok('38. the scope-trigger lines, the open-notice line and the Not checked line survive the trim',
    sBig.promptBlock.includes('Built 1920, before 1978') && sBig.promptBlock.includes('Exterior work here needs CHAP approval') && sBig.promptBlock.includes("In Baltimore City's regulated floodplain")
    && sBig.promptBlock.includes('Open vacant building notice 2655955A') && sBig.promptBlock.includes('Not checked: Permits issued before 2019'));
  ok('38. every MD promptBlock is <= 2,400 and carries no "verify with" / "confirm with" line and no "clean"',
    [...everyMd, sBig].every((x) => x.promptBlock.length <= MD_PROMPT_CAP && !/verify with|confirm with/i.test(x.promptBlock) && !/\bclean\b/i.test(x.promptBlock)));
  ok('38. the City RULES forbid permit-status claims; the County RULES say no code-enforcement dataset exists',
    sCity.promptBlock.includes('The City does not publish permit status, so never say a permit is finaled, active or expired.')
    && sCounty.promptBlock.startsWith('BUILDING RECORD (Baltimore County open data, fetched by MAGE 2026-09-28)') && sCounty.promptBlock.includes('Baltimore County publishes no code-enforcement dataset'));
  ok("38. chipLabel and cacheKey", sCity.chipLabel === 'Baltimore City record, as of 2026-09-27' && sCounty.chipLabel === 'Baltimore County record, as of 2026-09-27'
    && sCity.cacheKey.startsWith('brmd:baltimore_city:4074C009:') && sumOf(failedPermits).cacheKey !== sCity.cacheKey && sTruncNotice.cacheKey !== sNo.cacheKey);

  // ── 39. wire round trip, client parity, keys ──
  const trip = (x: unknown) => JSON.parse(JSON.stringify(x));
  const candResp = { status: 'md_candidates' as const, candidates: [cityCand.kind === 'parcel' ? cityCand.candidate : null].filter(Boolean) };
  ok('39. candidates, both records, md_outside and error round-trip through parseMdBuildingRecordResponse',
    deepEqual(parseMdBuildingRecordResponse(trip(candResp)), candResp)
    && deepEqual(parseMdBuildingRecordResponse(trip({ status: 'md_record', record: cityRec })), { status: 'md_record', record: cityRec })
    && deepEqual(parseMdBuildingRecordResponse(trip({ status: 'md_record', record: countyRec })), { status: 'md_record', record: countyRec })
    && deepEqual(parseMdBuildingRecordResponse(trip({ status: 'md_record', record: failedPermits })), { status: 'md_record', record: failedPermits })
    && deepEqual(parseMdBuildingRecordResponse({ status: 'md_outside', county: 'Anne Arundel County' }), { status: 'md_outside', county: 'Anne Arundel County' })
    && deepEqual(parseMdBuildingRecordResponse({ status: 'error', code: 'upstream', error: MD_ERRORS.upstream }), { status: 'error', code: 'upstream', error: MD_ERRORS.upstream }));
  ok('39. malformed MD responses → one fixed error, never a throw',
    parseMdBuildingRecordResponse({ status: 'md_record', record: { ...trip(cityRec), jurisdiction: 'nj' } }).status === 'error'
    && parseMdBuildingRecordResponse({ status: 'md_record', record: { ...trip(countyRec), landmarks: trip(cityRec).landmarks } }).status === 'error'
    && parseMdBuildingRecordResponse({ status: 'md_record', record: { ...trip(cityRec), housingNotices: [] } }).status === 'error'
    && parseMdBuildingRecordResponse({ status: 'md_candidates', candidates: [{ side: 'annapolis', key: 'x', label: 'x', lat: 1, lon: 1, match: 'address' }] }).status === 'error'
    && parseMdBuildingRecordResponse(null).status === 'error' && parseMdBuildingRecordResponse({ status: 'record' }).status === 'error');
  ok('39. MD_NOT_CHECKED lists are equal in md.ts and the client', JSON.stringify(MD_NOT_CHECKED_CITY_SRV) === JSON.stringify(MD_NOT_CHECKED_CITY) && JSON.stringify(MD_NOT_CHECKED_COUNTY_SRV) === JSON.stringify(MD_NOT_CHECKED_COUNTY));
  ok('39. mdPermitForNumber: exact after upper-casing and dropping spaces/dashes; null when permits did not read',
    mdPermitForNumber(cityRec as unknown as ClientMdRecord, 'brcm 26 009216')?.number === 'BRCM-26-009216' && mdPermitForNumber(cityRec as unknown as ClientMdRecord, 'BRCM-26-00921') === null
    && mdPermitForNumber(failedPermits as unknown as ClientMdRecord, 'BRCM-26-009216') === null && mdPermitForNumber(cityRec as unknown as ClientMdRecord, '') === null);
  ok('39. isMdJobsite: MD (code or name) yes; NJ / NY / Portland / empty no',
    isMdJobsite({ state: 'MD' }) && isMdJobsite({ state: 'Maryland' }) && !isMdJobsite({ state: 'NJ' }) && !isMdJobsite({ state: 'NY' }) && !isMdJobsite({ state: 'OR' }) && !isMdJobsite({}));
  ok('39. MD storage keys live under mageid_', mdParcelConfirmKey('p1') === 'mageid_building_md_p1' && mdBuildingRecordCacheKey('baltimore_city', '1820 022') === 'mageid_building_record_md_baltimore_city_1820-022');
  const hookSrc = read('hooks/useMdBuildingRecord.ts');
  const hookLits = [...hookSrc.matchAll(/AsyncStorage\.\w+\(\s*['"`]([^'"`]*)/g)].map((m) => m[1]);
  const hookEnables = [...hookSrc.matchAll(/^\s+enabled:\s*([^\n,]+),$/gm)].map((m) => m[1]);
  ok('39. useMdBuildingRecord: no raw storage key literal, every query gated on supported', hookLits.every((l) => l.startsWith('mageid_')) && hookEnables.length === 2 && hookEnables.every((e) => /^supported &&/.test(e.trim())), hookEnables.join(' | '));
  const clientSrc = read('utils/buildingRecordClient.ts');
  ok('39. the MD client: one helper with the LITERAL invoke, parseMdBuildingRecordResponse(data), one fixed network sentence',
    /async function invokeMd\(req: MdBuildingRecordRequest\)/.test(clientSrc) && /parseMdBuildingRecordResponse\(data\)/.test(clientSrc)
    && clientSrc.includes('export const MD_BUILDING_RECORD_NETWORK_ERROR = "Couldn\'t reach the Baltimore lookup. Nothing was checked.";'));

  // ── 40. the function + the card + the NYC strings ──
  ok('40. md.ts is pure (no Deno, no import at all)', !/\bDeno\./.test(mdSrcText) && !/^\s*import\s/m.test(mdSrcText));
  ok('40. index.ts routes md_* before nj_* and before the NYC parseRequest', idxText.indexOf('parseMdRequest(body)') > 0 && idxText.indexOf('parseMdRequest(body)') < idxText.indexOf('parseNjRequest(body)') && idxText.indexOf('parseNjRequest(body)') < idxText.indexOf('const parsed = parseRequest(body);'));
  ok('40. index.ts keeps exactly ONE literal `await fetch(` and fetches MD URLs only through getMd → getJson', (idxText.match(/await fetch\(/g) ?? []).length === 1 && /async function getMd\(url: string \| null\): Promise<unknown> \{\s*if \(!url \|\| !isAllowedMdUrl\(url\)\) throw new Error\('md url refused'\);\s*return \(await getJson\(url, false\)\)\.rows;/.test(idxText));
  const mdSection = idxText.slice(idxText.indexOf('// ── Maryland'), idxText.indexOf('// ── handler'));
  ok('40. the MD handlers answer only MD_ERRORS / ERRORS.bad_request, never the NYC or NJ upstream text', mdSection.includes('MD_ERRORS.upstream') && !/(?<!MD_)ERRORS\.upstream/.test(mdSection));
  ok('40. md_resolve never auto-picks (no md_record leaves mdResolve); the MD record cache holds only complete records',
    !/status: 'md_record'/.test(idxText.slice(idxText.indexOf('async function mdResolve'), idxText.indexOf('async function mdRecord'))) && /if \(mdRecordComplete\(rec\)\) mdRecordCache\.set\(cacheKey/.test(idxText));
  const cardSrc = read('components/buildingRecord/BuildingRecordCard.tsx');
  ok('40. BuildingRecordCard dispatches MD on its own line ABOVE the unchanged NJ + NYC two-line pin',
    cardSrc.includes("  if (!br.supported && mdJob) return <MdBuildingRecordCard project={project} variant={variant} />;\n  if (!br.supported && njJob) return <NjBuildingRecordCard project={project} variant={variant} />;\n  if (!br.supported || br.phase === 'unsupported') return null;\n"));
  const mdCard = read('components/buildingRecord/MdBuildingRecordCard.tsx');
  const mdTids = [...mdCard.matchAll(/testID=\{?[`"']([^`"'}]*)/g)].map((m) => m[1]);
  ok("40. every MD card testID starts 'mdrecord-', the root is 'mdrecord-card', no success-green, no hex colour",
    mdTids.length >= 10 && mdTids.every((t) => t.startsWith('mdrecord-')) && /testID="mdrecord-card"/.test(mdCard) && !/tone="success"|\.success\b|successBg/.test(mdCard) && !/#[0-9a-fA-F]{3,8}\b/.test(mdCard), mdTids.join(','));
  // NYC strings in useJobBuildingRecord. Baseline = app/(tabs)/construction-ai/index.tsx at 64d397af
  // (the alert tail at ~1286 and the not-checked headline at ~1383). Patch BALT-1 moves the alert tail
  // into useJobBuildingRecord, so the file is compared only while it still carries the literal.
  const jobSrc = read('hooks/useJobBuildingRecord.ts');
  const constOf = (name: string) => { const m = new RegExp(`export const ${name} = (['"])(.*?)\\1;`).exec(jobSrc); return m ? m[2] : null; };
  const ai = read('app/(tabs)/construction-ai/index.tsx');
  const NYC_ATTN = "These are DOB's public records as published. Ask your expeditor or applicant of record before you price.";
  const NYC_NOT = 'DOB record not checked (building not confirmed or not loaded)';
  ok("40. useJobBuildingRecord's NYC attentionNote / sourceLabel / notCheckedHeadline are byte-identical to index.tsx's literals",
    constOf('NYC_ATTENTION_NOTE') === NYC_ATTN && constOf('NYC_NOT_CHECKED_HEADLINE') === NYC_NOT && constOf('NYC_SOURCE_LABEL') === "DOB's public records"
    && NYC_ATTN.startsWith(`These are ${constOf('NYC_SOURCE_LABEL')} as published.`) && ai.includes(NYC_NOT)
    && (ai.includes(NYC_ATTN) || ai.includes('${roadmapBuilding.attentionNote}')), `${constOf('NYC_ATTENTION_NOTE')} | ${constOf('NYC_NOT_CHECKED_HEADLINE')}`);
  ok("40. useJobBuildingRecord's Baltimore strings (X3) and confirmedCounty spellings",
    constOf('MD_CITY_ATTENTION_NOTE') === "These are Baltimore City's open data as published (open notices only). Check the notice with DHCD before you price."
    && constOf('MD_COUNTY_ATTENTION_NOTE') === "These are Baltimore County's open data as published. Check with PAI before you price."
    && constOf('MD_CITY_SOURCE_LABEL') === "Baltimore City's open data (Open Baltimore)" && constOf('MD_COUNTY_SOURCE_LABEL') === "Baltimore County's open data"
    && constOf('MD_NOT_CHECKED_HEADLINE') === 'Baltimore record not checked (address not confirmed or not loaded)'
    && jobSrc.includes("side === 'baltimore_city' ? 'Baltimore city' : side === 'baltimore_county' ? 'Baltimore County' : null"));

  // ── 41. fix round 1: outside-Baltimore Maryland, zoning PDF link, flood X wording, zero permits, as-of caching ──
  // Live Census geographies body for "100 N Market St, Frederick, MD 21701", fetched 2026-09-28
  // (https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?...&layers=Counties), trimmed to what censusCounty reads.
  const FREDERICK = { result: { addressMatches: [{ coordinates: { x: -77.410766160022, y: 39.415415632702 }, geographies: { Counties: [{ GEOID: '24021', NAME: 'Frederick County' }] }, matchedAddress: '100 N MARKET ST, FREDERICK, MD, 21701' }] } };
  const fred = censusCounty(FREDERICK);
  ok('41. the Frederick Census body: county named, point outside the Baltimore box (lat/lon null, inBox false)',
    !!fred && fred.county === 'Frederick County' && fred.geoid === '24021' && fred.lon === null && fred.inBox === false, JSON.stringify(fred));
  const fredFb = mdCensusFallback(fred, null);
  ok("41. a Frederick-style Census match + zero geocoder points → md_outside 'Frederick County', never an empty candidate list",
    'outcome' in fredFb && fredFb.outcome.status === 'md_outside' && fredFb.outcome.county === 'Frederick County', JSON.stringify(fredFb));
  const annapolis = { lat: 38.9784, lon: -76.4922, county: 'Anne Arundel County', geoid: '24003', inBox: true };
  const aaFb = mdCensusFallback(annapolis, null);
  ok('41. a non-Baltimore GEOID inside the box is outside too (the Census point is not probed)',
    mdCensusOutside(annapolis) && 'outcome' in aaFb && aaFb.outcome.status === 'md_outside' && aaFb.outcome.county === 'Anne Arundel County');
  const towson = { lat: 39.4015, lon: -76.6019, county: 'Baltimore County', geoid: '24005', inBox: true };
  const twFb = mdCensusFallback(towson, null);
  ok('41. a Baltimore GEOID is never outside by the Census alone: its point goes to the parcel layers',
    !mdCensusOutside(towson) && !mdCensusOutside({ ...towson, geoid: '24510', county: 'Baltimore city' }) && 'points' in twFb && twFb.points.length === 1 && twFb.points[0].from === 'census');
  const pinFb = mdCensusFallback(fred, { lat: 39.29, lon: -76.61 });
  ok('41. a Census "outside" with an in-box map pin still probes the pin (a parcel layer decides), and only the pin',
    'points' in pinFb && pinFb.points.length === 1 && pinFb.points[0].from === 'pin');
  const noMatch = mdCensusFallback(null, null);
  ok('41. no Census match and no pin → an empty candidate list (no match), never md_outside',
    'outcome' in noMatch && noMatch.outcome.status === 'md_candidates' && !mdCensusOutside(null));
  ok('41. no GEOID + a point outside the box → outside (county may be unnamed); no GEOID + no point → not outside',
    mdCensusOutside({ lat: null, lon: null, county: null, geoid: null, inBox: false }) && !mdCensusOutside({ lat: null, lon: null, county: null, geoid: null, inBox: null }));
  const resolveSrc = idxText.slice(idxText.indexOf('async function mdResolve'), idxText.indexOf('async function mdRecord'));
  ok('41. index.ts mdResolve uses mdCensusFallback and returns its outcome (no bare empty candidate list)',
    /const fb = mdCensusFallback\(c, /.test(resolveSrc) && /if \('outcome' in fb\) return mdJson\(fb\.outcome\);/.test(resolveSrc) && !/candidates: \[\] \}\)/.test(resolveSrc));

  // Zoning PDF link (spec GOAL: "zoning district (+ link to the district PDF)").
  const cityLinks = mdRecordLinks(cityRec as unknown as ClientMdRecord);
  ok("41. the City record's links start with the R-6 district PDF from the zoning layer, then the record's own links",
    cityLinks[0]?.label === 'R-6 zoning district (PDF)' && cityLinks[0]?.url === 'https://s3.amazonaws.com/baltimorecity.gov.if-us-east-1/s3fs-public/2026-02/r5-10.pdf'
    && cityLinks.length === cityRec.links.length + 1, JSON.stringify(cityLinks));
  const countyLinks = mdRecordLinks(countyRec as unknown as ClientMdRecord);
  ok("41. the County zoning PDF (published http://, 302 → https) is linked as https",
    countyLinks[0]?.label === 'BR IM zoning district (PDF)' && countyLinks[0]?.url === 'https://bcgis.baltimorecountymd.gov/ZoningReports/BR.pdf', JSON.stringify(countyLinks));
  const failedZoning = withJobs(FX.city, { zoning: { status: 'failed' } });
  ok('41. a zoning part that did not read → no PDF link; null record → no links',
    mdRecordLinks(failedZoning as unknown as ClientMdRecord).every((l) => !l.label.includes('zoning')) && mdRecordLinks(null).length === 0
    && ['failed', 'timeout'].every((st) => mdRecordLinks({ ...cityRec, zoning: { ...cityRec.zoning, status: st } } as unknown as ClientMdRecord).every((l) => !l.label.includes('zoning'))));
  // The PDF host is anchored: a look-alike domain never becomes a link.
  const zoningUrl = (side: 'baltimore_city' | 'baltimore_county', url: string) => {
    const base = side === 'baltimore_city' ? FX.city : FX.county;
    const attrs = side === 'baltimore_city'
      ? { Zoning: 'R-6', overlay: ' ', Label: 'R-6', URL: url }
      : { ZONE_CLASS: 'BR', ZONE_DIST: 'BR IM', DIST_CODE: 'IM', URL: url };
    const r = withJobs(base, { zoning: { status: 'ok', body: { features: [{ attributes: attrs }] } } }, side, side === 'baltimore_city' ? '4074C009' : '2200002965');
    return r.zoning.rows[0]?.pdfUrl ?? null;
  };
  ok('42. zoning PDF host: look-alike domains (evilbaltimorecity.gov, baltimorecity.gov.evil.com, evilbaltimorecountymd.gov) → no URL',
    zoningUrl('baltimore_city', 'https://evilbaltimorecity.gov/r6.pdf') === null
    && zoningUrl('baltimore_city', 'https://baltimorecity.gov.evil.com/r6.pdf') === null
    && zoningUrl('baltimore_county', 'https://evilbaltimorecountymd.gov/BR.pdf') === null
    && zoningUrl('baltimore_county', 'http://bcgis.evilbaltimorecountymd.gov/BR.pdf') === null);
  ok('42. zoning PDF host: the real hosts and their subdomains still pass (http upgraded to https)',
    zoningUrl('baltimore_city', 'https://baltimorecity.gov/r6.pdf') === 'https://baltimorecity.gov/r6.pdf'
    && zoningUrl('baltimore_city', 'https://planning.baltimorecity.gov/r6.pdf') === 'https://planning.baltimorecity.gov/r6.pdf'
    && zoningUrl('baltimore_county', 'http://bcgis.baltimorecountymd.gov/ZoningReports/BR.pdf') === 'https://bcgis.baltimorecountymd.gov/ZoningReports/BR.pdf');
  const httpZoning = { ...cityRec, zoning: { ...cityRec.zoning, rows: [{ code: 'R-6', overlay: null, pdfUrl: 'http://baltimorecity.gov/r6.pdf' }, { code: 'R-7', overlay: null, pdfUrl: 'javascript:alert(1)' }] } };
  ok('42. mdRecordLinks links https PDFs only (an http:// or javascript: pdfUrl that reached the client is never linked)',
    mdRecordLinks(httpZoning as unknown as ClientMdRecord).every((l) => !l.label.includes('zoning')));
  const cardText = read('components/buildingRecord/MdBuildingRecordCard.tsx');
  ok('41. the MD card renders mdRecordLinks(rec), not rec.links', /const links = mdRecordLinks\(rec\);/.test(cardText) && !/rec\.links\.map/.test(cardText));

  // Flood zone X: FEMA's "minimal hazard" / "reduced risk" subtype words never reach a line or the prompt.
  const sX = sumOf(countyRec);
  const leveeRec = withJobs(FX.county, { flood: { status: 'ok', body: { features: [{ attributes: { FLD_ZONE: 'X', ZONE_SUBTY: 'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE', SFHA_TF: 'F', STATIC_BFE: -9999, DFIRM_ID: '240010' } }] } } }, 'baltimore_county', '2200002965');
  const sLevee = sumOf(leveeRec);
  ok("41. zone X (minimal) reads 'on FEMA's map, outside its mapped 1% and 0.2% annual-chance flood areas'; the levee subtype says 'behind a levee'",
    sX.lines.some((l) => l.startsWith("Flood zone X on FEMA's map, outside its mapped 1% and 0.2% annual-chance flood areas"))
    && sLevee.lines.some((l) => l.startsWith("Flood zone X on FEMA's map, in an area FEMA marks as behind a levee")), sX.lines.join(' | '));
  ok('41. no MD line or promptBlock says minimal / reduced flood risk / flood hazard subtype',
    [sX, sLevee].every((x) => [...x.lines, x.promptBlock].every((l) => !/minimal|reduced (flood )?risk|FEMA subtype/i.test(l))));

  // Zero permits: "none listed in <source>, as of <date>", never a flat statement about the building.
  const zeroPermits = withJobs(FX.city, { permits_count: { status: 'ok', body: { count: 0 } }, permits_rows: { status: 'ok', body: { features: [] } } });
  const zeroCounty = withJobs(FX.county, { permits_count: { status: 'ok', body: { count: 0 } }, permits_rows: { status: 'ok', body: { features: [] } } }, 'baltimore_county', '2200002965');
  ok('41. a zero-count permits read says "No permits listed for this parcel in <source>, as of <date>"',
    sumOf(zeroPermits).lines.includes('No permits listed for this parcel in City permits (2019 to present), as of 2026-09-25')
    && sumOf(zeroCounty).lines.some((l) => /^No permits listed for this parcel in .+, as of 2026-09-27$/.test(l))
    && [sumOf(zeroPermits), sumOf(zeroCounty)].every((x) => x.lines.every((l) => !/^No (City|County) permits/.test(l))), sumOf(zeroCounty).lines.join(' | '));

  // The attention headline is neutral (the housing notices come from a feed that is not a published dataset).
  ok("41. the attention headline never says the notices are in the City's open data", !/open data lists/.test(sLegacyExt.headline) && sLegacyExt.headline.startsWith('Baltimore City records list open notices'));

  // Housing notices are City-only: a County record carrying them is refused,
  // and the attention headline names the record's OWN government.
  ok('42. a County record carrying the City housing-notice layers → one fixed error (never parsed as a record)',
    parseMdBuildingRecordResponse({ status: 'md_record', record: { ...trip(countyRec), housingNotices: trip(cityRec).housingNotices } }).status === 'error'
    && parseMdBuildingRecordResponse({ status: 'md_record', record: { ...trip(countyRec), housingNotices: [trip(cityRec).housingNotices[0]] } }).status === 'error'
    && parseMdBuildingRecordResponse(trip({ status: 'md_record', record: countyRec })).status === 'md_record');
  const countyWithNotices = { ...trip(countyRec), housingNotices: trip(legacyCity((i, b) => (i === 3 ? { ...b, rows: [{ number: '2607703A', date: '2026-01-21', type: 'Exterior', statusCode: 'NOTICE MAILED' }] } : b))).housingNotices } as unknown as ClientMdRecord;
  const sCountyNotices = summarizeMdBuildingRecord(countyWithNotices);
  ok("42. the 'attention' headline uses the record's own government: City → 'Baltimore City records…', County → 'Baltimore County records…'",
    sLegacyExt.headline.startsWith('Baltimore City records list open notices for this parcel: ')
    && sCountyNotices.kind === 'attention' && sCountyNotices.headline.startsWith('Baltimore County records list open notices for this parcel: ')
    && !sCountyNotices.headline.includes('Baltimore City'), sCountyNotices.headline);

  // A record whose as-of reads were cut off by the deadline is not cached.
  const noAsOfJobs: Partial<Record<MdJobId, MdFetched>> = {};
  for (const [k, v] of Object.entries(FX.city)) if (!k.startsWith('asof:')) noAsOfJobs[k as MdJobId] = { status: 'ok', body: v };
  const noAsOf = assembleMdRecord({ side: 'baltimore_city', key: '4074C009', fetchedAt: new Date('2026-09-28T12:00:00Z'), jobs: noAsOfJobs });
  ok('41. every data part ok but the as-of reads timed out → NOT complete (never cached for the full TTL); the full record still is',
    noAsOf.permits.status === 'ok' && noAsOf.permits.asOfKind === 'unread' && !mdRecordComplete(noAsOf) && mdRecordComplete(cityRec) && mdRecordComplete(countyRec));

  // useJobBuildingRecord: a Maryland job the resolver placed outside both Baltimores.
  const jobText = read('hooks/useJobBuildingRecord.ts');
  ok('41. useJobBuildingRecord: md.outside → "Building record not available for <county> (MAGE reads Baltimore City and Baltimore County only)"',
    jobText.includes('return `Building record not available for ${county ?? \'this address\'} (MAGE reads Baltimore City and Baltimore County only)`;')
    && jobText.includes('notCheckedHeadline: md.outside ? mdOutsideHeadline(md.outside.county) : MD_NOT_CHECKED_HEADLINE,'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.error('\n✗ validate-building-record'); process.exit(1); }
console.log('\n✓ validate-building-record');
