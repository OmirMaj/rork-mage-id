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
} from '../utils/buildingRecord';
import {
  departmentFor, resolveCodeJurisdiction,
} from '../utils/codeJurisdiction';

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
  ok('15. every `error:` in a response body is an ERRORS.<key> reference', errorValues.length >= 6 && errorValues.every((v) => /^ERRORS\.[a-z_]+$/.test(v)), errorValues.join(' | '));
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.error('\n✗ validate-building-record'); process.exit(1); }
console.log('\n✓ validate-building-record');
