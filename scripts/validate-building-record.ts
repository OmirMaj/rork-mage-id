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
  ok('15. every `error:` in a response body is an ERRORS.<key> reference', errorValues.length >= 6 && errorValues.every((v) => /^(NJ_)?ERRORS\.[a-z_]+$/.test(v)), errorValues.join(' | '));
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
  const njSection = idx.slice(idx.indexOf('async function njResolve'), idx.indexOf('// ── handler'));
  ok('30. the NJ handlers answer the NJ upstream text, never the NYC one', njSection.includes('error: NJ_ERRORS.upstream') && !/(?<!NJ_)ERRORS\.upstream/.test(njSection));
  ok('30. index.ts routes nj_* before the NYC parseRequest', idx.indexOf('parseNjRequest(body)') > 0 && idx.indexOf('parseNjRequest(body)') < idx.indexOf('const parsed = parseRequest(body);'));
  ok('30. nj_resolve never auto-picks (only nj_candidates leaves njResolve)', !/status: 'nj_record'/.test(idx.slice(idx.indexOf('async function njResolve'), idx.indexOf('async function njRecord'))));
  ok('30. the NJ record cache holds only fully answered records under nj:muni:block:lot', /const cacheKey = `nj:\$\{muniCode\}:\$\{block\}:\$\{lot\}`;/.test(idx) && /if \(rec\.permits\.status === 'ok' && rec\.muniLastReport\.status === 'ok'\)/.test(idx));
  ok("30. njParcelConfirmKey is under mageid_", njParcelConfirmKey('p1') === 'mageid_building_parcel_p1');
  ok('30. isNjJobsite: NJ yes (code or name); NY / Portland / empty no', isNjJobsite({ state: 'NJ' }) && isNjJobsite({ state: 'New Jersey' }) && !isNjJobsite({ state: 'NY' }) && !isNjJobsite({ state: 'OR' }) && !isNjJobsite({}));
  const client = read('utils/buildingRecordClient.ts');
  ok("30. fetchNjBuildingRecord uses the LITERAL invoke('building-record') and parseNjBuildingRecordResponse(data)", /export async function fetchNjBuildingRecord\(req: NjBuildingRecordRequest\)/.test(client) && (client.match(/functions\.invoke\(\s*'building-record'/g) ?? []).length === 2 && /parseNjBuildingRecordResponse\(data\)/.test(client));
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.error('\n✗ validate-building-record'); process.exit(1); }
console.log('\n✓ validate-building-record');
