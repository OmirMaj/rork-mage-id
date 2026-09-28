// scripts/probe-building-record.ts — NETWORK probe of the NYC public sources
// behind the building-record edge function. NOT in ship-check.
//
//   bun run scripts/probe-building-record.ts            print only
//   bun run scripts/probe-building-record.ts --write    also refresh fixtures
//   bun run scripts/probe-building-record.ts --nj-only --write
//                                                        only the New Jersey probe
//                                                        (nj-*.json fixtures)
//   bun run scripts/probe-building-record.ts --md-only   only the Baltimore probe:
//                                                        every City / County layer
//                                                        (fields vs SAFE, count, as-of,
//                                                        cadence) + a resolve and a
//                                                        record per test address run
//                                                        through md.ts's own builders
//   bun run scripts/probe-building-record.ts --md-fixtures
//                                                        print the trimmed live bodies
//                                                        validate-building-record keeps
//                                                        inline (MD_FIXTURES_JSON)
//
// It uses the SAME builders and normalizers the function uses
// (supabase/functions/building-record/normalize.ts), so what it prints is what
// a contractor would be shown. With --write it saves trimmed fixtures to
// scripts/fixtures/building-record/, stripping every owner, respondent,
// permittee, phone and personal-name field first (the applicant becomes
// 'Test Applicant'); the offline validator reads them.
//
// Read-only: it only GETs NYC Open Data and NYC Planning GeoSearch — and, for
// the NJ probe, the Census geocoder, the NJGIN parcel layer and data.nj.gov;
// for the MD probe, the Baltimore City and Baltimore County ArcGIS services
// (and the Census geocoder, for the outside-both case).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATASETS, RECORD_DATASET_IDS, assembleRecord, benchmarkFrom, benchmarkUrl,
  candidatesFromGeosearch, datasetUrl, failedDataset, failedParcel, geosearchUrl,
  normalizeDataset, normalizeParcel, type DatasetId, type BuildingRecordDataset,
} from '../supabase/functions/building-record/normalize';
import {
  addressKey, assembleNjRecord, censusFirstMatch, censusLocationsUrl, mergeNjCandidates, njMuniFreshnessUrl,
  njParcelAddressUrl, njParcelBufferUrl, njPermitsUrl, normalizeNjFreshness, normalizeNjPermits, rankNjCandidates,
} from '../supabase/functions/building-record/nj';
import {
  MD_LAYERS, asOfFrom, asOfUrl, assembleMdRecord, attributeQueryUrl, censusCounty, censusCountyUrl, cityGeocodeUrl,
  countyGeocodeUrl, geocodePoints, isAllowedMdUrl, mdAddressInput, mdCensusFallback, mdRecordComplete, mdRecordPlan, mdResolveOutcome,
  parcelHitFrom, parcelPointUrl, planMdResolve, pointQueryUrl, probeIsRedundant, runBounded,
  type MdFetched, type MdJobId, type MdLayerId, type MdProbe, type MdProbeResult, type MdSide,
} from '../supabase/functions/building-record/md';
import { summarizeBuildingRecord, summarizeMdBuildingRecord, summarizeNjBuildingRecord, type MdBuildingRecord } from '../utils/buildingRecord';

const WRITE = process.argv.includes('--write');
const NJ_ONLY = process.argv.includes('--nj-only');
const MD_ONLY = process.argv.includes('--md-only');
const MD_FIXTURES = process.argv.includes('--md-fixtures');
const FIX_DIR = join('scripts', 'fixtures', 'building-record');
const BIN = '1001026';
const BBL = '1000477501';

async function get(url: string): Promise<{ ok: boolean; status: number; rows: unknown; lm: string | null }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
    const rows = res.ok ? await res.json() : null;
    return { ok: res.ok, status: res.status, rows, lm: res.headers.get('X-SODA2-Truth-Last-Modified') };
  } finally {
    clearTimeout(timer);
  }
}

/** Column names that can carry a person or a phone number. */
const PERSONAL = /owner|respondent|permittee|phone|filing_representative|first_name|last_name|middle|business_name|business_address|applicant_license/i;

function scrub(rows: unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      if (!PERSONAL.test(k)) o[k] = v;
    }
    if ('applicant_first_name' in (r as object) || 'applicant_last_name' in (r as object)) {
      o.applicant_first_name = 'Test';
      o.applicant_last_name = 'Applicant';
    }
    if ('applicant_license' in (r as object)) o.applicant_license = '000000';
    return o;
  });
}

function save(name: string, data: unknown) {
  if (!WRITE) return;
  mkdirSync(FIX_DIR, { recursive: true });
  writeFileSync(join(FIX_DIR, name), `${JSON.stringify(data, null, 1)}\n`, 'utf8');
}

async function distinct(id: DatasetId, col: string) {
  const url = `https://data.cityofnewyork.us/resource/${id}.json?$select=${encodeURIComponent(`${col}, count(*) as n`)}&$group=${col}`;
  const r = await get(url);
  const vals = Array.isArray(r.rows) ? (r.rows as Record<string, string>[]).map((x) => `${x[col] ?? '(null)'}=${x.n}`) : [`HTTP ${r.status}`];
  console.log(`  distinct ${id}.${col}: ${vals.join(' | ')}`);
}

/** Keys the NJ fixtures must never hold: the parcel layer's owner name and
 *  owner MAILING address (MOD-IV OWNER_NAME, ST_ADDRESS, CITY_STATE, ZIP_CODE). */
const NJ_FORBIDDEN_KEY = /OWN|ST_ADDRESS|CITY_STATE|ZIP_CODE/i;

function forbiddenKeys(data: unknown): string[] {
  const bad: string[] = [];
  JSON.stringify(data, (k, v) => { if (k && NJ_FORBIDDEN_KEY.test(k)) bad.push(k); return v; });
  return bad;
}

/** The New Jersey probe: 94 Washington St, Hoboken → Census → the 30 m parcel
 *  buffer → Hoboken (0905) block 199 lot 1 → its permits and the town's
 *  newest report. Writes nj-*.json with --write; FAILS on an owner key. */
async function probeNj(today: Date) {
  const TEXT = '94 Washington St, Hoboken, NJ 07030';
  console.log(`\n== NJ: Census locations "${TEXT}"`);
  const census = await get(censusLocationsUrl(TEXT)!);
  const first = censusFirstMatch(census.rows);
  if (!first) throw new Error(`NJ probe: Census returned no match (HTTP ${census.status})`);
  console.log(`  ${first.matchedAddress} → (${first.lon}, ${first.lat})`);
  const key = addressKey(first.matchedAddress);
  console.log(`  address key ${JSON.stringify(key)}`);
  const censusFixture = { result: { addressMatches: [{ matchedAddress: first.matchedAddress, coordinates: { x: first.lon, y: first.lat } }] } };

  console.log('\n== NJ: parcels within 30 m');
  const parcel = await get(njParcelBufferUrl(first.lat, first.lon)!);
  let candidates = rankNjCandidates(parcel.rows, key, 'nearby');
  const munis = [...new Set(candidates.map((c) => c.muniCode))];
  const addrUrl = njParcelAddressUrl(munis, key);
  const addr = addrUrl ? await get(addrUrl) : null;
  if (addr && !candidates.some((c) => c.match === 'address')) candidates = mergeNjCandidates(rankNjCandidates(addr.rows, key, 'nearby'), candidates);
  for (const c of candidates) console.log(`  ${c.pin} block ${c.block} lot ${c.lot} ${c.propLoc ?? '(no PROP_LOC)'} — ${c.match}`);
  const pick = candidates.find((c) => c.pin === '0905_199_1');
  if (!pick) throw new Error('NJ probe: 0905_199_1 is not among the candidates');

  console.log(`\n== NJ: permits ${pick.muniCode} block ${pick.block} lot ${pick.lot}`);
  const permits = await get(njPermitsUrl(pick.muniCode, pick.block, pick.lot, today)!);
  const fresh = await get(njMuniFreshnessUrl(pick.muniCode)!);
  const p = permits.ok ? normalizeNjPermits(permits.rows, pick.block, pick.lot, permits.lm, today) : null;
  const f = fresh.ok ? normalizeNjFreshness(fresh.rows) : { status: 'failed' as const, date: null, muniName: null };
  console.log(`  permits: HTTP ${permits.status} asOf ${permits.lm} rows ${Array.isArray(permits.rows) ? permits.rows.length : 'n/a'} matched ${p?.dataset.rowCount}`);
  console.log(`  freshness: HTTP ${fresh.status} ${JSON.stringify(fresh.rows)}`);
  if (p) {
    const rec = assembleNjRecord({ muniCode: pick.muniCode, block: pick.block, lot: pick.lot, fetchedAt: today, muniName: p.muniName ?? f.muniName, permits: p.dataset, muniLastReport: { status: f.status, date: f.date } });
    const sum = summarizeNjBuildingRecord(rec);
    console.log(`\n  summary kind: ${sum.kind}\n  headline: ${sum.headline}`);
    for (const l of sum.lines) console.log(`   - ${l}`);
  }

  const fixtures: [string, unknown][] = [
    ['nj-census.json', censusFixture],
    ['nj-parcel.json', parcel.rows],
    ['nj-parcel-address.json', addr?.rows ?? { features: [] }],
    ['nj-permits.json', { asOfHeader: permits.lm, rows: permits.rows }],
    ['nj-freshness.json', { asOfHeader: fresh.lm, rows: fresh.rows }],
  ];
  const bad = fixtures.flatMap(([name, data]) => forbiddenKeys(data).map((k) => `${name}:${k}`));
  if (bad.length) throw new Error(`NJ probe: an owner field reached a fixture: ${bad.join(', ')}`);
  for (const [name, data] of fixtures) save(name, data);
}

// ─────────────────────────────────────────────────────────────────────
// Baltimore (Maryland)
// ─────────────────────────────────────────────────────────────────────

/** Published cadence, as the dataset's own item text says it (read 2026-09-28). */
const MD_CADENCE: Partial<Record<MdLayerId, string>> = {
  C3: 'weekly ("Data is updated on a weekly basis", item 64110b108565433d8da40dd0e422064e)',
  C6: 'daily ("Data is updated on a daily basis", item 691d65a5f85640e6aaa46930bd9dc102)',
};
const MD_DATASET_IDS: Partial<Record<MdLayerId, string>> = {
  C3: '64110b108565433d8da40dd0e422064e', C4: '189e6d1c65df4e13b38c0027cee574f6', C6: '691d65a5f85640e6aaa46930bd9dc102',
  C8: 'dc7bf04cec4e41ef85cc6b391652e1e7', C9: '2aa812e5042e4fc8950ffff2a6ce9291', C12: '517933b8965b47949f85a879cbdc954c',
  K4: 'cfd6eb593b524875a80e3c45e4575fa9',
};

async function getMd(url: string | null): Promise<unknown> {
  if (!url || !isAllowedMdUrl(url)) throw new Error(`refused ${url}`);
  const r = await get(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.rows;
}

async function mdResolveLive(text: string): Promise<ReturnType<typeof mdResolveOutcome>> {
  const input = mdAddressInput(text);
  if (!input) throw new Error('bad text');
  const [cg, kg] = await Promise.allSettled([getMd(cityGeocodeUrl(input)), getMd(countyGeocodeUrl(input))]);
  let probes = planMdResolve(
    cg.status === 'fulfilled' ? geocodePoints(cg.value, 'city', input) : [],
    kg.status === 'fulfilled' ? geocodePoints(kg.value, 'county', input) : [],
  );
  let census: ReturnType<typeof censusCounty> = null;
  if (!probes.length) {
    census = censusCounty(await getMd(censusCountyUrl(text)).catch(() => null));
    const fb = mdCensusFallback(census, null);
    if ('outcome' in fb) return fb.outcome;
    probes = fb.points.map((point) => ({ point, order: ['baltimore_city', 'baltimore_county'] as MdSide[] }));
  }
  const probeOne = async (p: MdProbe): Promise<MdProbeResult> => {
    const hits: MdProbeResult['hits'] = [];
    for (const side of p.order) {
      let hit: MdProbeResult['hits'][number]['hit'];
      try { hit = parcelHitFrom(await getMd(parcelPointUrl(side, p.point.lat, p.point.lon)), side, p.point); } catch { hit = 'failed'; }
      hits.push({ side, hit });
      if (typeof hit === 'object' && (hit.kind === 'parcel' || hit.kind === 'inside_no_parcel')) break;
    }
    return { probe: p, hits };
  };
  const pool = await runBounded(probes.map((p) => () => probeOne(p)), {
    concurrency: 3, deadlineMs: 12_000,
    skip: (i, done) => probeIsRedundant(probes[i], done.flatMap((d) => (d.result.status === 'ok' ? [d.result.value] : []))),
  });
  const results = pool.flatMap((r, i): MdProbeResult[] => (r.status === 'ok' ? [r.value] : r.status === 'skipped' ? [] : [{ probe: probes[i], hits: [{ side: probes[i].order[0], hit: r.status === 'timeout' ? 'timeout' : 'failed' }] }]));
  const out = mdResolveOutcome(results, census);
  if (out.status === 'md_outside' && !census) return { status: 'md_outside', county: censusCounty(await getMd(censusCountyUrl(text)).catch(() => null))?.county ?? null };
  return out;
}

async function mdRecordJobs(side: MdSide, key: string, lat: number, lon: number): Promise<Partial<Record<MdJobId, MdFetched>>> {
  const plan = mdRecordPlan(side, key, lat, lon);
  if (!plan) throw new Error('no plan');
  const pool = await runBounded(plan.map((j) => () => getMd(j.url)), { concurrency: 4, deadlineMs: 20_000 });
  const jobs: Partial<Record<MdJobId, MdFetched>> = {};
  plan.forEach((j, i) => { const r = pool[i]; jobs[j.id] = r.status === 'ok' ? { status: 'ok', body: r.value } : { status: r.status === 'failed' ? 'failed' : 'timeout' }; });
  return jobs;
}

async function probeMd() {
  console.log('\n== Baltimore layers (fields vs SAFE, rows, as-of, cadence)');
  for (const id of Object.keys(MD_LAYERS) as MdLayerId[]) {
    const L = MD_LAYERS[id];
    try {
      const meta = await getMd(`${L.layer}?f=json`) as { name?: string; maxRecordCount?: number; fields?: { name: string }[] };
      const names = new Set((meta.fields ?? []).map((f) => f.name));
      const missing = L.outFields.split(',').filter((f) => !names.has(f));
      const count = await getMd(`${L.layer}/query?where=1%3D1&returnCountOnly=true&f=json`) as { count?: number };
      const au = asOfUrl(id);
      const asOf = au ? asOfFrom(id, await getMd(au).catch(() => null)) : { asOf: 'from each parcel (LDATE)', asOfKind: 'data' };
      console.log(`  ${id} "${meta.name}"${MD_DATASET_IDS[id] ? ` item ${MD_DATASET_IDS[id]}` : ''}: rows ${count.count ?? '?'}, maxRecordCount ${meta.maxRecordCount}, SAFE fields ${missing.length ? `MISSING ${missing.join(',')}` : 'all present'}, as-of ${asOf.asOf ?? 'n/a'} (${asOf.asOfKind}), cadence ${MD_CADENCE[id] ?? 'none published'}`);
    } catch (e) {
      console.log(`  ${id}: ${String(e)}`);
    }
  }
  const postal = await getMd('https://bcgisdata.baltimorecountymd.gov/arcgis/rest/services/Facilities/Address/MapServer/0/query?where=CITY_POSTAL%3D%27BALTIMORE%27&returnCountOnly=true&f=json').catch(() => null) as { count?: number } | null;
  console.log(`  postal-city trap: County address points with CITY_POSTAL='BALTIMORE': ${postal?.count ?? 'not read'}`);

  for (const text of ['620 E 31st St, Baltimore, MD 21218', '9616 Reisterstown Rd, Baltimore, MD', '400 Washington Ave, Towson, MD 21204', '1 Church Cir, Annapolis, MD 21401', '100 N Market St, Frederick, MD 21701']) {
    const out = await mdResolveLive(text);
    console.log(`\n== Resolve "${text}" → ${out.status}${out.status === 'md_outside' ? ` (${out.county ?? 'county not named'})` : ''}`);
    if (out.status !== 'md_candidates') continue;
    for (const c of out.candidates) console.log(`    ${c.side} ${c.label} (${c.match})`);
    const c = out.candidates[0];
    if (!c) continue;
    const jobs = await mdRecordJobs(c.side, c.key, c.lat, c.lon);
    const rec = assembleMdRecord({ side: c.side, key: c.key, fetchedAt: new Date(), jobs });
    const sum = summarizeMdBuildingRecord(rec as unknown as MdBuildingRecord);
    console.log(`  record complete: ${mdRecordComplete(rec)}; kind ${sum.kind}; promptBlock ${sum.promptBlock.length} chars\n  headline: ${sum.headline}`);
    for (const l of sum.lines) console.log(`   - ${l}`);
  }
}

/** The trimmed live bodies validate-building-record keeps inline (SAFE columns only). */
async function printMdFixtures() {
  const trimLayer = (b: unknown) => { const o = (b ?? {}) as { editingInfo?: unknown; fields?: { name: string }[] }; return { ...(o.editingInfo ? { editingInfo: o.editingInfo } : {}), fields: (o.fields ?? []).slice(0, 2).map((f) => ({ name: f.name })) }; };
  const trimFeat = (b: unknown, n = 5) => ({ features: (((b ?? {}) as { features?: { attributes: unknown }[] }).features ?? []).slice(0, n).map((f) => ({ attributes: f.attributes })) });
  const rec = async (side: MdSide, key: string, lat: number, lon: number) => {
    const plan = mdRecordPlan(side, key, lat, lon)!;
    const out: Record<string, unknown> = {};
    for (const j of plan) {
      const b = await getMd(j.url) as { features?: unknown; count?: number };
      out[j.id] = j.id.startsWith('asof:') ? (b.features ? trimFeat(b, 1) : trimLayer(b)) : j.id === 'permits_count' ? { count: b.count } : trimFeat(b, j.id === 'permits_rows' ? 50 : 5);
    }
    return out;
  };
  const input = mdAddressInput('620 E 31st St, Baltimore, MD 21218')!;
  const cityGeo = await getMd(cityGeocodeUrl(input)) as { candidates?: { address: string; location: { x: number; y: number }; score: number; attributes: Record<string, unknown> }[] };
  const countyGeo = await getMd(countyGeocodeUrl(input)) as { candidates?: unknown[] };
  const fx = {
    cityGeo: { candidates: (cityGeo.candidates ?? []).map((c) => ({ address: c.address, location: { x: c.location.x, y: c.location.y }, score: c.score, attributes: { Addr_type: c.attributes.Addr_type, Postal: c.attributes.Postal } })) },
    countyGeo: { candidates: countyGeo.candidates ?? [] },
    city: await rec('baltimore_city', '4074C009', 39.326002256022, -76.60807094633),
    county: await rec('baltimore_county', '2200002965', 39.404161179553775, -76.76314010859662),
    thamesFlood: trimFeat(await getMd(pointQueryUrl('C12', 39.281164545142, -76.59487262271))),
    woodlandParcel: trimFeat(await getMd(attributeQueryUrl('C3', 'baltimore_city', '4623 046', { limit: 5 }))),
    towsonK3: trimFeat(await getMd(parcelPointUrl('baltimore_county', 39.399733, -76.60545))),
  };
  console.log(JSON.stringify(fx));
}

async function main() {
  const today = new Date();
  if (MD_FIXTURES) { await printMdFixtures(); return; }
  if (MD_ONLY) {
    await probeMd();
    return;
  }
  if (NJ_ONLY) {
    await probeNj(today);
    console.log(WRITE ? `\nNJ fixtures written to ${FIX_DIR}` : '\n(print only; pass --write to refresh fixtures)');
    return;
  }

  console.log('\n== GeoSearch');
  for (const text of ['120 Broadway, New York, NY', '345 Adams St, Brooklyn, NY']) {
    const r = await get(geosearchUrl(text)!);
    const c = candidatesFromGeosearch(r.rows);
    console.log(`  "${text}" → ${c.candidates.length} candidate(s), ${c.droppedPlaceholders} placeholder(s) dropped`);
    for (const k of c.candidates) console.log(`    BIN ${k.bin}  BBL ${k.bbl}  ${k.label} (${k.borough}, PAD ${k.padVersion})`);
    if (text.startsWith('120')) save('geosearch-120-broadway.json', r.rows);
  }

  console.log(`\n== Record BIN ${BIN} / BBL ${BBL}`);
  const datasets: BuildingRecordDataset[] = [];
  let ecbRaw: unknown = null;
  let parcel = failedParcel('failed');
  for (const id of [...RECORD_DATASET_IDS, '64uk-42ks'] as DatasetId[]) {
    const url = datasetUrl(id, BIN, BBL, today)!;
    const r = await get(url);
    if (!r.ok) {
      console.log(`  ${id} ${DATASETS[id].name}: HTTP ${r.status}`);
      if (id === '64uk-42ks') parcel = failedParcel('failed'); else datasets.push(failedDataset(id, 'failed'));
      continue;
    }
    const rows = scrub(r.rows);
    save(`${id}.json`, { id, asOfHeader: r.lm, rows });
    if (id === '64uk-42ks') {
      parcel = normalizeParcel(rows, r.lm);
      console.log(`  ${id} PLUTO: status ${parcel.status} asOf ${parcel.asOf} version ${parcel.plutoVersion} zoning ${parcel.zoning.join('/')} landmark ${parcel.landmark}`);
      continue;
    }
    if (id === '6bgk-3dad') ecbRaw = rows;
    const d = normalizeDataset(id, rows, r.lm, today);
    datasets.push(d);
    console.log(`  ${id} ${d.name}: status ${d.status} asOf ${d.asOf} returned ${d.returned} limit ${d.limit} truncated ${d.truncated} activeCount ${d.activeCount}${d.flags.length ? ` flags ${d.flags.join(',')}` : ''}`);
  }
  const rec = assembleRecord({ bin: BIN, bbl: BBL, label: '120 BROADWAY, New York, NY, USA', fetchedAt: today, datasets, parcel, ecbRaw });
  const sum = summarizeBuildingRecord(rec);
  console.log(`\n  summary kind: ${sum.kind}\n  headline: ${sum.headline}`);
  for (const l of sum.lines) console.log(`   - ${l}`);

  console.log('\n== Distinct values');
  await distinct('855j-jady', 'violation_status');
  await distinct('eabe-havv', 'status');
  await distinct('rbx6-tga4', 'permit_status');
  await distinct('w9ak-ipjd', 'filing_status');

  console.log('\n== Benchmark BROOKLYN (DOB NOW Alteration, last 365 days)');
  const br = await get(benchmarkUrl('BROOKLYN', today)!);
  const bm = benchmarkFrom(br.rows, 'BROOKLYN', today, br.lm);
  console.log(`  window ${bm.windowStart}..${bm.windowEnd} asOf ${bm.asOf} truncated ${bm.truncated} rows ${Array.isArray(br.rows) ? br.rows.length : 'n/a'}`);
  for (const g of bm.groups) console.log(`    ${g.reviewType}: n ${g.n}, median ${g.medianDays} d, p75 ${g.p75Days} d, p90 ${g.p90Days} d`);

  // One synthetic full page: 500 ACTIVE ECB rows (returned === limit), so the
  // validator can prove 'at least' wording without the network.
  const synth = Array.from({ length: DATASETS['6bgk-3dad'].limit }, (_, i) => ({
    bin: '9999999', ecb_violation_number: `SYN${String(i).padStart(6, '0')}`, ecb_violation_status: 'ACTIVE',
    severity: 'CLASS - 2', issue_date: '20250101', violation_description: 'SYNTHETIC ROW', balance_due: '10',
  }));
  save('synthetic-6bgk-3dad-full-page.json', { id: '6bgk-3dad', asOfHeader: 'Fri, 25 Sep 2026 17:02:33 GMT', rows: synth });

  await probeNj(today);
  await probeMd();

  console.log(WRITE ? `\nfixtures written to ${FIX_DIR}` : '\n(print only; pass --write to refresh fixtures)');
}

main().catch((e) => { console.error(e); process.exit(1); });
