// scripts/probe-building-record.ts — NETWORK probe of the NYC public sources
// behind the building-record edge function. NOT in ship-check.
//
//   bun run scripts/probe-building-record.ts            print only
//   bun run scripts/probe-building-record.ts --write    also refresh fixtures
//
// It uses the SAME builders and normalizers the function uses
// (supabase/functions/building-record/normalize.ts), so what it prints is what
// a contractor would be shown. With --write it saves trimmed fixtures to
// scripts/fixtures/building-record/, stripping every owner, respondent,
// permittee, phone and personal-name field first (the applicant becomes
// 'Test Applicant'); the offline validator reads them.
//
// Read-only: it only GETs NYC Open Data and NYC Planning GeoSearch.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATASETS, RECORD_DATASET_IDS, assembleRecord, benchmarkFrom, benchmarkUrl,
  candidatesFromGeosearch, datasetUrl, failedDataset, failedParcel, geosearchUrl,
  normalizeDataset, normalizeParcel, type DatasetId, type BuildingRecordDataset,
} from '../supabase/functions/building-record/normalize';
import { summarizeBuildingRecord } from '../utils/buildingRecord';

const WRITE = process.argv.includes('--write');
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

async function main() {
  const today = new Date();

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

  console.log(WRITE ? `\nfixtures written to ${FIX_DIR}` : '\n(print only; pass --write to refresh fixtures)');
}

main().catch((e) => { console.error(e); process.exit(1); });
