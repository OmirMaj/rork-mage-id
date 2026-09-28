// utils/buildingRecord.ts — the NYC building record, client side. PURE: no
// React, no React Native, no storage, no network. It holds the wire types of
// the `building-record` edge function, a defensive parser for its responses,
// and summarizeBuildingRecord — THE one renderer. The card, the Roadmap prompt
// and the Add-to-Permits confirmation all print what it returns, so they
// cannot drift apart.
//
// HONESTY RULES (validated by scripts/validate-building-record.ts):
//   - A dataset that failed or timed out reads "not checked", never 0.
//   - A full page (truncated) reads "at least N" and can never produce
//     "No active …" or the 'no_active_in_checked' kind.
//   - "No active X in <dataset> as of <day>" is the only negative statement,
//     scoped to one dataset and one day. Nothing ever calls a building clean,
//     all clear or compliant, and the last line always names what was NOT
//     checked.

import type { PermitStatus } from '@/types';
import { normalizeState, resolveCodeJurisdiction, type JobsiteAddress } from '@/utils/codeJurisdiction';

export const BUILDING_RECORD_FUNCTION = 'building-record'; // documentation only: callers MUST pass the string literal to functions.invoke (see L2)
export type DatasetStatus = 'ok' | 'failed' | 'timeout';
export interface BuildingRecordRow { primary: string; date: string | null; status: string | null; detail: string | null; amount: number | null; jobFilingNumber?: string | null; applicantName?: string | null; applicantLicense?: string | null; applicantTitle?: string | null; }
export interface BuildingRecordDataset { id: string; name: string; url: string; asOf: string | null; status: DatasetStatus; activeCount: number | null; returned: number | null; limit: number; truncated: boolean; flags: string[]; rows: BuildingRecordRow[]; }
export interface BuildingParcel { status: DatasetStatus; asOf: string | null; zoning: string[]; overlays: string[]; specialDistricts: string[]; landmark: string | null; historicDistrict: string | null; floodZone2015: boolean | null; eDesignation: string | null; yearBuilt: number | null; numFloors: number | null; bldgClass: string | null; plutoVersion: string | null; /** PLUTO answered with no row for this BBL (status is then 'failed'). */ notFound?: boolean; }
export interface BuildingCandidate { bin: string; bbl: string; label: string; borough: string; padVersion: string | null; }
export interface BuildingRecord { jurisdiction: 'nyc'; bin: string; bbl: string; label: string; borough: string; fetchedAt: string; parcel: BuildingParcel; datasets: BuildingRecordDataset[]; ecbBalanceDue: number | null; ecbBalanceIsPartial: boolean; links: { bis: string; zola: string; dobNowPortal: string }; notChecked: string[]; }
export interface DobPermitMatch { datasetId: string; datasetName: string; asOf: string | null; number: string; statusText: string; date: string | null; }
export interface DobPermitLookup { permitNumber: string; matches: DobPermitMatch[]; failed: string[]; }
export interface ReviewBenchmarkGroup { reviewType: string; n: number; medianDays: number | null; p75Days: number | null; p90Days: number | null; }
export interface ReviewBenchmark { borough: string; jobType: string; windowDays: number; windowStart: string; windowEnd: string; asOf: string | null; datasetId: 'w9ak-ipjd'; groups: ReviewBenchmarkGroup[]; truncated: boolean; note: string; }
export type BuildingRecordRequest = { mode: 'resolve'; text: string } | { mode: 'record'; bin: string; bbl: string } | { mode: 'permit'; permitNumber: string } | { mode: 'benchmark'; borough: string };
export type BuildingRecordResponse = { status: 'unsupported'; reason: string } | { status: 'candidates'; candidates: BuildingCandidate[]; droppedPlaceholders: number } | { status: 'record'; record: BuildingRecord } | { status: 'permit'; lookup: DobPermitLookup } | { status: 'benchmark'; benchmark: ReviewBenchmark } | { status: 'error'; code: string; error: string };
export const BUILDING_RECORD_NOT_CHECKED: readonly string[] = ['HPD (housing maintenance)', 'FDNY', 'DEP', 'LPC calendar', 'DOT', 'BIS-only paper records'];
export interface BuildingRecordSummary { kind: 'none' | 'attention' | 'no_active_in_checked' | 'incomplete'; headline: string; lines: string[]; promptBlock: string; chipLabel: string; cacheKey: string; }
export interface DobStatusSuggestion { verbatim: string; suggested: PermitStatus | null; flag: 'objections' | null; }

// ─────────────────────────────────────────────────────────────────────
// Parsing — defensive. Anything malformed is one fixed error.
// ─────────────────────────────────────────────────────────────────────

const BAD_RESPONSE: BuildingRecordResponse = { status: 'error', code: 'bad_response', error: 'The building lookup returned something MAGE could not read.' };

class Bad extends Error {}
type O = Record<string, unknown>;
const isObj = (v: unknown): v is O => !!v && typeof v === 'object' && !Array.isArray(v);
function obj(v: unknown): O { if (!isObj(v)) throw new Bad(); return v; }
function s(v: unknown): string { if (typeof v !== 'string') throw new Bad(); return v; }
function sN(v: unknown): string | null { if (v === null) return null; return s(v); }
function n(v: unknown): number { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Bad(); return v; }
function nN(v: unknown): number | null { if (v === null) return null; return n(v); }
function b(v: unknown): boolean { if (typeof v !== 'boolean') throw new Bad(); return v; }
function bN(v: unknown): boolean | null { if (v === null) return null; return b(v); }
function arr<T>(v: unknown, f: (x: unknown) => T): T[] { if (!Array.isArray(v)) throw new Bad(); return v.map(f); }
function dsStatus(v: unknown): DatasetStatus { if (v === 'ok' || v === 'failed' || v === 'timeout') return v; throw new Bad(); }

function pRow(v: unknown): BuildingRecordRow {
  const o = obj(v);
  const row: BuildingRecordRow = { primary: s(o.primary), date: sN(o.date), status: sN(o.status), detail: sN(o.detail), amount: nN(o.amount) };
  for (const k of ['jobFilingNumber', 'applicantName', 'applicantLicense', 'applicantTitle'] as const) {
    if (k in o && o[k] !== undefined) row[k] = sN(o[k]);
  }
  return row;
}
function pDataset(v: unknown): BuildingRecordDataset {
  const o = obj(v);
  return {
    id: s(o.id), name: s(o.name), url: s(o.url), asOf: sN(o.asOf), status: dsStatus(o.status),
    activeCount: nN(o.activeCount), returned: nN(o.returned), limit: n(o.limit), truncated: b(o.truncated),
    flags: arr(o.flags, s), rows: arr(o.rows, pRow),
  };
}
function pParcel(v: unknown): BuildingParcel {
  const o = obj(v);
  return {
    status: dsStatus(o.status), asOf: sN(o.asOf), zoning: arr(o.zoning, s), overlays: arr(o.overlays, s),
    specialDistricts: arr(o.specialDistricts, s), landmark: sN(o.landmark), historicDistrict: sN(o.historicDistrict),
    floodZone2015: bN(o.floodZone2015), eDesignation: sN(o.eDesignation), yearBuilt: nN(o.yearBuilt),
    numFloors: nN(o.numFloors), bldgClass: sN(o.bldgClass), plutoVersion: sN(o.plutoVersion),
    ...(o.notFound === true ? { notFound: true } : {}),
  };
}
function pRecord(v: unknown): BuildingRecord {
  const o = obj(v);
  if (o.jurisdiction !== 'nyc') throw new Bad();
  const l = obj(o.links);
  return {
    jurisdiction: 'nyc', bin: s(o.bin), bbl: s(o.bbl), label: s(o.label), borough: s(o.borough), fetchedAt: s(o.fetchedAt),
    parcel: pParcel(o.parcel), datasets: arr(o.datasets, pDataset), ecbBalanceDue: nN(o.ecbBalanceDue),
    ecbBalanceIsPartial: b(o.ecbBalanceIsPartial), links: { bis: s(l.bis), zola: s(l.zola), dobNowPortal: s(l.dobNowPortal) },
    notChecked: arr(o.notChecked, s),
  };
}
function pCandidate(v: unknown): BuildingCandidate {
  const o = obj(v);
  return { bin: s(o.bin), bbl: s(o.bbl), label: s(o.label), borough: s(o.borough), padVersion: sN(o.padVersion) };
}
function pMatch(v: unknown): DobPermitMatch {
  const o = obj(v);
  return { datasetId: s(o.datasetId), datasetName: s(o.datasetName), asOf: sN(o.asOf), number: s(o.number), statusText: s(o.statusText), date: sN(o.date) };
}
function pGroup(v: unknown): ReviewBenchmarkGroup {
  const o = obj(v);
  return { reviewType: s(o.reviewType), n: n(o.n), medianDays: nN(o.medianDays), p75Days: nN(o.p75Days), p90Days: nN(o.p90Days) };
}
function pBenchmark(v: unknown): ReviewBenchmark {
  const o = obj(v);
  if (o.datasetId !== 'w9ak-ipjd') throw new Bad();
  return {
    borough: s(o.borough), jobType: s(o.jobType), windowDays: n(o.windowDays), windowStart: s(o.windowStart),
    windowEnd: s(o.windowEnd), asOf: sN(o.asOf), datasetId: 'w9ak-ipjd', groups: arr(o.groups, pGroup),
    truncated: b(o.truncated), note: s(o.note),
  };
}

export function parseBuildingRecordResponse(json: unknown): BuildingRecordResponse {
  try {
    const o = obj(json);
    switch (o.status) {
      case 'unsupported': return { status: 'unsupported', reason: s(o.reason) };
      case 'candidates': return { status: 'candidates', candidates: arr(o.candidates, pCandidate), droppedPlaceholders: n(o.droppedPlaceholders) };
      case 'record': return { status: 'record', record: pRecord(o.record) };
      case 'permit': {
        const l = obj(o.lookup);
        return { status: 'permit', lookup: { permitNumber: s(l.permitNumber), matches: arr(l.matches, pMatch), failed: arr(l.failed, s) } };
      }
      case 'benchmark': return { status: 'benchmark', benchmark: pBenchmark(o.benchmark) };
      case 'error': return { status: 'error', code: s(o.code), error: s(o.error) };
      default: return { ...BAD_RESPONSE };
    }
  } catch {
    return { ...BAD_RESPONSE };
  }
}

// ─────────────────────────────────────────────────────────────────────
// The one renderer
// ─────────────────────────────────────────────────────────────────────

/** The four violation/complaint sets and the nouns their lines use. */
const VIOLATION_NOUNS: Record<string, [singular: string, plural: string]> = {
  '3h2n-5cm9': ['DOB violation', 'DOB violations'],
  '6bgk-3dad': ['ECB violation', 'ECB violations'],
  '855j-jady': ['DOB safety violation', 'DOB safety violations'],
  'eabe-havv': ['DOB complaint', 'DOB complaints'],
};

const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : 'an unpublished date');
const countText = (d: BuildingRecordDataset): string => (d.truncated ? `at least ${d.activeCount}` : `${d.activeCount}`);
const noun = (d: BuildingRecordDataset, count: number | null): string => {
  const pair = VIOLATION_NOUNS[d.id];
  return pair ? (count === 1 && !d.truncated ? pair[0] : pair[1]) : 'items';
};
const failedText = (d: { status: DatasetStatus }): string => (d.status === 'timeout' ? 'timed out' : 'failed');

function money(x: number): string {
  const fixed = (Math.round(x * 100) / 100).toFixed(2);
  const [int, cents] = fixed.split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

function datasetLine(rec: BuildingRecord, d: BuildingRecordDataset): string {
  if (d.status !== 'ok') return `${d.name}: not checked (the request ${failedText(d)})`;
  const asOf = day(d.asOf);
  const count = d.activeCount ?? 0;

  if (VIOLATION_NOUNS[d.id]) {
    if (count > 0) {
      let line = `${countText(d)} active ${noun(d, count)} — ${d.name}, as of ${asOf}`;
      if (d.id === '6bgk-3dad' && rec.ecbBalanceDue !== null && rec.ecbBalanceDue > 0) {
        line += rec.ecbBalanceIsPartial
          ? `, at least $${money(rec.ecbBalanceDue)} balance due as published (more rows than MAGE read)`
          : `, $${money(rec.ecbBalanceDue)} balance due as published`;
      }
      if (d.id === '3h2n-5cm9' && d.flags.includes('work_without_permit')) line += '; includes work-without-permit (VW)';
      return line;
    }
    if (d.truncated) {
      return `${d.name}: at least ${d.returned} matching rows; MAGE read only the first ${d.limit}, so it cannot say none are active (as of ${asOf})`;
    }
    return `No active ${noun(d, 0)} in ${d.name} as of ${asOf}`;
  }

  if (d.id === 'w9ak-ipjd') {
    const newest = d.rows[0];
    if (!d.returned || !newest) return `${d.name}: none listed for this BIN (as of ${asOf})`;
    return `${d.returned === 1 && !d.truncated ? 'Latest DOB NOW filing' : `Latest ${d.returned} DOB NOW filings`} (newest first, as of ${asOf}); newest ${newest.jobFilingNumber ?? newest.primary} '${newest.status ?? 'status not published'}' (${newest.date ?? 'date not published'})`;
  }
  if (d.id === 'rbx6-tga4') {
    if (count > 0) return `${countText(d)} issued, unexpired DOB NOW ${count === 1 && !d.truncated ? 'permit' : 'permits'} — ${d.name}, as of ${asOf}`;
    if (d.truncated) return `${d.name}: at least ${d.returned} matching rows; MAGE read only the first ${d.limit}, so it cannot say none are unexpired (as of ${asOf})`;
    return `No issued, unexpired permits in ${d.name} as of ${asOf}`;
  }
  if (d.id === 'ipu4-2q9a') {
    const newest = d.rows[0];
    if (!d.returned || !newest) return `${d.name}: none listed for this BIN (as of ${asOf})`;
    return `${d.returned === 1 && !d.truncated ? 'Latest BIS permit' : `Latest ${d.returned} BIS permits`} (newest job first, as of ${asOf}); newest ${newest.primary} '${newest.status ?? 'status not published'}'`;
  }
  // An unknown dataset id: state only what was read.
  return `${d.name}: ${d.returned ?? 0} rows read (as of ${asOf})`;
}

function parcelLines(p: BuildingParcel, bbl: string): string[] {
  if (p.notFound) return [`PLUTO: no lot found for BBL ${bbl}`];
  if (p.status !== 'ok') return [`PLUTO: not checked (the request ${failedText(p)})`];
  const out: string[] = [];
  const version = p.plutoVersion ?? '(version not published)';
  if (p.zoning.length) {
    let z = `Zoning ${p.zoning.join(' / ')}`;
    if (p.overlays.length) z += `, overlay ${p.overlays.join(' / ')}`;
    if (p.specialDistricts.length) z += `, special district ${p.specialDistricts.join(' / ')}`;
    out.push(`${z} as published in PLUTO ${version}`);
  }
  if (p.landmark) out.push(`PLUTO lists this lot as ${p.landmark}`);
  if (p.historicDistrict) out.push(`Historic district: ${p.historicDistrict}`);
  if (p.eDesignation) out.push(`E-designation ${p.eDesignation}`);
  if (p.floodZone2015) out.push('In the 2015 preliminary flood map (PFIRM)');
  return out;
}

const NONE_SUMMARY: BuildingRecordSummary = { kind: 'none', headline: '', lines: [], promptBlock: '', chipLabel: '', cacheKey: 'br:none' };

export function summarizeBuildingRecord(rec: BuildingRecord | null | undefined): BuildingRecordSummary {
  if (!rec) return { ...NONE_SUMMARY, lines: [] };

  const lines = rec.datasets.map((d) => datasetLine(rec, d));
  lines.push(...parcelLines(rec.parcel, rec.bbl));
  lines.push(`Not checked: ${rec.notChecked.join(', ')}.`);

  // ── kind ──
  const parts: string[] = [];
  for (const d of rec.datasets) {
    if (d.status === 'ok' && VIOLATION_NOUNS[d.id] && (d.activeCount ?? 0) > 0) {
      parts.push(`${countText(d)} active ${noun(d, d.activeCount)}`);
    }
  }
  if (rec.ecbBalanceDue !== null && rec.ecbBalanceDue > 0) {
    parts.push(`${rec.ecbBalanceIsPartial ? 'at least ' : ''}$${money(rec.ecbBalanceDue)} ECB balance due`);
  }
  if (rec.parcel.status === 'ok') {
    if (rec.parcel.landmark) parts.push('a landmark listing');
    if (rec.parcel.historicDistrict) parts.push('a historic district');
    if (rec.parcel.eDesignation) parts.push('an E-designation');
  }
  const filings = rec.datasets.find((d) => d.id === 'w9ak-ipjd');
  if (filings && filings.status === 'ok' && (filings.flags.includes('objections') || filings.rows.some((r) => /objection/i.test(r.status ?? '')))) {
    parts.push('a DOB NOW filing in objections');
  }

  const incomplete = rec.datasets.some((d) => d.status !== 'ok' || d.truncated) || rec.parcel.status !== 'ok';
  const violationSets = rec.datasets.filter((d) => !!VIOLATION_NOUNS[d.id]);
  let kind: BuildingRecordSummary['kind'];
  let headline: string;
  if (parts.length) {
    kind = 'attention';
    headline = `DOB's public records for BIN ${rec.bin} show ${parts.join(', ')} — ask your expeditor before you price.`;
  } else if (incomplete || !violationSets.length) {
    kind = 'incomplete';
    headline = `Some DOB datasets could not be fully checked for BIN ${rec.bin}; see below.`;
  } else {
    // The claim is scoped to what decides this kind: ONLY the violation and
    // complaint sets. Filings and permits (a current job, the GC's own permit)
    // are listed below and are never summarized as "no active items".
    kind = 'no_active_in_checked';
    const k = violationSets.length;
    const newest = violationSets.map((d) => d.asOf).filter((x): x is string => !!x).sort().pop() ?? null;
    headline = `No active violations or complaints in the ${k} DOB violation and complaint ${k === 1 ? 'dataset' : 'datasets'} MAGE checked for BIN ${rec.bin} (as of ${day(newest)}). Other agencies were not checked.`;
  }

  const promptBlock = 'BUILDING RECORD (public NYC DOB datasets via NYC Open Data; each line names its dataset and date):\n'
    + `${headline}\n- ${lines.join('\n- ')}\n`
    + "RULES: These are public records as published, not a finding by MAGE. Counts marked 'at least' are partial. "
    + 'Do not infer legal consequences (whether anything blocks a permit, a certificate of occupancy or the work). '
    + 'Never tell the contractor the building is free of problems or meets code. '
    + 'Tell the contractor to confirm with the applicant of record or expeditor.';

  const cacheKey = `br:${rec.bin}:${rec.bbl}:${rec.datasets.map((d) => d.id + '@' + (d.asOf ?? d.status) + (d.truncated ? '+' : '')).join(',')}:${rec.parcel.plutoVersion ?? 'nopluto'}`;

  return { kind, headline, lines, promptBlock, chipLabel: headline, cacheKey };
}

// ─────────────────────────────────────────────────────────────────────
// DOB status → MAGE permit status (a SUGGESTION; the verbatim text is shown)
// ─────────────────────────────────────────────────────────────────────

const APPROVED = ['approved', 'paa approved', 'permit entire', 'permit issued', 'issued', 're-issued'];
const PASSED = ['loc issued', 'co issued', 'signed-off', 'signed off'];

export function suggestPermitStatusFromDob(statusText: string): DobStatusSuggestion {
  const verbatim = statusText;
  const t = (statusText ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    t === 'pending plan examiner assignment'
    || t.startsWith('plan examiner')
    || t.startsWith('chief plan examiner')
    || t.startsWith('pending chief plan examiner')
  ) return { verbatim, suggested: 'under_review', flag: null };
  if (t.includes('objection')) return { verbatim, suggested: 'under_review', flag: 'objections' };
  if (APPROVED.includes(t)) return { verbatim, suggested: 'approved', flag: null };
  if (PASSED.includes(t)) return { verbatim, suggested: 'inspection_passed', flag: null };
  return { verbatim, suggested: null, flag: null };
}

// ─────────────────────────────────────────────────────────────────────
// Jobsite helpers and keys
// ─────────────────────────────────────────────────────────────────────

export function isNycJobsite(addr: { city?: string; county?: string; state?: string }): boolean {
  const r = resolveCodeJurisdiction(addr);
  return r.kind === 'city' && r.entry.name === 'New York City';
}

export function buildingLookupText(addr: JobsiteAddress, locationText?: string | null): string | null {
  if (addr.street.trim()) return `${addr.street.trim()}, ${addr.city.trim()}, ${addr.state.trim()} ${addr.zip.trim()}`.trim();
  return (locationText ?? '').trim() || null;
}

export function buildingRecordCacheKey(bin: string, bbl: string): string {
  return `mageid_building_record_${bin}_${bbl}`;
}

export function buildingConfirmKey(projectId: string): string {
  return `mageid_building_bin_${projectId}`;
}

// Filing statuses that mean the job left plan review (mirrors
// supabase/functions/building-record/normalize.ts FILING_DONE_STATUSES; the
// validator asserts the two lists are equal).
const FILING_DONE = [
  'loc issued', 'co issued', 'full demolition signed-off', 'signed-off', 'filing withdrawn',
  'permit entire', 'permit issued', 'pa certificate of operation issued',
  'ta certificate of operation issued', 'revoked', 'll 158-2017-denied', 'inspection complete',
];
const norm = (x: string | null | undefined) => (x ?? '').trim().toUpperCase();

/**
 * The w9ak filing a permit number belongs to. DOB NOW work permits are the job
 * filing number plus work-type suffixes ('M01448433-I1' → 'M01448433-I1-EW-SP',
 * 'M01225881-I1-SH'), so a filing matches when the numbers are equal, when the
 * permit is the filing plus '-…' suffixes, or when a bare job number was typed
 * ('M01448433' → its '-I1' filing). Otherwise the newest in-flight filing,
 * otherwise null.
 */
export function filingForPermit(rec: BuildingRecord, permitNumber?: string | null): BuildingRecordRow | null {
  const filings = rec.datasets.find((d) => d.id === 'w9ak-ipjd');
  if (!filings || filings.status !== 'ok') return null;
  const p = norm(permitNumber);
  if (p) {
    const hit = filings.rows.find((r) => {
      const f = norm(r.jobFilingNumber ?? r.primary);
      return !!f && (f === p || p.startsWith(`${f}-`) || f.startsWith(`${p}-`));
    });
    if (hit) return hit;
  }
  return filings.rows.find((r) => {
    const st = (r.status ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    return !!st && !FILING_DONE.includes(st);
  }) ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// NEW JERSEY (lane N, 2026-09-26) — ADDITIVE. Everything above is the NYC
// record and is unchanged. NJ gets its own types, parser and renderer, so the
// NYC BuildingRecordSummary['kind'] union (read by Code Check grounding) never
// widens. The NJ record renders in NjBuildingRecordCard only.
//
// Source: the state's "NJ Construction Permit Data" (data.nj.gov w9se-dmra,
// GET https://data.nj.gov/api/views/w9se-dmra.json, checkedOn 2026-09-26):
// raw and unaudited, purged after 60 months, "most, but not all
// municipalities" report, permits and certificates only (no violations).
// ─────────────────────────────────────────────────────────────────────

export interface NjParcelCandidate { muniCode: string; muniName: string | null; county: string | null; block: string; lot: string; qualifier: string | null; pin: string | null; propLoc: string | null; match: 'address' | 'nearby' | 'approximate'; }
export interface NjPermitRow { primary: string; date: string | null; status: string | null; detail: string | null; amountCents: number | null; }
export interface NjPermitDataset { id: 'w9se-dmra'; name: 'NJ Construction Permit Data (DCA)'; url: string; asOf: string | null; status: DatasetStatus; rowCount: number | null; returned: number | null; limit: number; truncated: boolean; rows: NjPermitRow[]; }
export interface NjBuildingRecord { jurisdiction: 'nj'; muniCode: string; muniName: string | null; block: string; lot: string; label: string; fetchedAt: string; permits: NjPermitDataset; muniLastReport: { status: DatasetStatus; date: string | null }; notChecked: string[]; caveat: string; links: { dataset: string }; }
export type NjBuildingRecordRequest = { mode: 'nj_resolve'; text: string; lat: number | null; lon: number | null } | { mode: 'nj_record'; muniCode: string; block: string; lot: string };
export type NjBuildingRecordResponse = { status: 'nj_candidates'; candidates: NjParcelCandidate[] } | { status: 'nj_record'; record: NjBuildingRecord } | { status: 'error'; code: string; error: string };
export interface NjBuildingRecordSummary { kind: 'none' | 'listed' | 'incomplete'; headline: string; lines: string[]; promptBlock: string; chipLabel: string; cacheKey: string; }

export const NJ_NOT_CHECKED = ['Violations (New Jersey publishes none statewide)', 'Local zoning', 'Fire inspections', 'Permits the town has not reported to the state'];
export const NJ_PERMIT_CAVEAT = "This is the state's raw, unaudited permit data. It keeps about the last 60 months, and some towns don't report to it. It lists permits and certificates only.";

const NJ_BAD_RESPONSE: NjBuildingRecordResponse = { status: 'error', code: 'bad_response', error: 'The building lookup returned something MAGE could not read.' };

function pNjMatch(v: unknown): NjParcelCandidate['match'] { if (v === 'address' || v === 'nearby' || v === 'approximate') return v; throw new Bad(); }
function pNjCandidate(v: unknown): NjParcelCandidate {
  const o = obj(v);
  return {
    muniCode: s(o.muniCode), muniName: sN(o.muniName), county: sN(o.county), block: s(o.block), lot: s(o.lot),
    qualifier: sN(o.qualifier), pin: sN(o.pin), propLoc: sN(o.propLoc), match: pNjMatch(o.match),
  };
}
function pNjRow(v: unknown): NjPermitRow {
  const o = obj(v);
  const cents = nN(o.amountCents);
  if (cents !== null && !Number.isInteger(cents)) throw new Bad();
  return { primary: s(o.primary), date: sN(o.date), status: sN(o.status), detail: sN(o.detail), amountCents: cents };
}
function pNjPermits(v: unknown): NjPermitDataset {
  const o = obj(v);
  if (o.id !== 'w9se-dmra' || o.name !== 'NJ Construction Permit Data (DCA)') throw new Bad();
  return {
    id: 'w9se-dmra', name: 'NJ Construction Permit Data (DCA)', url: s(o.url), asOf: sN(o.asOf), status: dsStatus(o.status),
    rowCount: nN(o.rowCount), returned: nN(o.returned), limit: n(o.limit), truncated: b(o.truncated), rows: arr(o.rows, pNjRow),
  };
}
function pNjRecord(v: unknown): NjBuildingRecord {
  const o = obj(v);
  if (o.jurisdiction !== 'nj') throw new Bad();
  const m = obj(o.muniLastReport);
  const l = obj(o.links);
  return {
    jurisdiction: 'nj', muniCode: s(o.muniCode), muniName: sN(o.muniName), block: s(o.block), lot: s(o.lot), label: s(o.label),
    fetchedAt: s(o.fetchedAt), permits: pNjPermits(o.permits), muniLastReport: { status: dsStatus(m.status), date: sN(m.date) },
    notChecked: arr(o.notChecked, s), caveat: s(o.caveat), links: { dataset: s(l.dataset) },
  };
}

export function parseNjBuildingRecordResponse(json: unknown): NjBuildingRecordResponse {
  try {
    const o = obj(json);
    switch (o.status) {
      case 'nj_candidates': return { status: 'nj_candidates', candidates: arr(o.candidates, pNjCandidate) };
      case 'nj_record': return { status: 'nj_record', record: pNjRecord(o.record) };
      case 'error': return { status: 'error', code: s(o.code), error: s(o.error) };
      default: return { ...NJ_BAD_RESPONSE };
    }
  } catch {
    return { ...NJ_BAD_RESPONSE };
  }
}

/** Integer cents → "$1,307,000" (no decimals when whole) or "$12.50". */
export function njDollars(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const rem = Math.abs(cents) % 100;
  const int = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${int}${rem ? `.${String(rem).padStart(2, '0')}` : ''}`;
}

const NJ_NONE_SUMMARY: NjBuildingRecordSummary = { kind: 'none', headline: '', lines: [], promptBlock: '', chipLabel: '', cacheKey: 'brnj:none' };
const NJ_STALE_REPORT_MS = 365 * 24 * 60 * 60 * 1000;

export function summarizeNjBuildingRecord(rec: NjBuildingRecord | null | undefined): NjBuildingRecordSummary {
  if (!rec) return { ...NJ_NONE_SUMMARY, lines: [] };
  const p = rec.permits;
  const muni = rec.muniName ?? `municipality ${rec.muniCode}`;
  const where = `Block ${rec.block} Lot ${rec.lot}`;
  const asOf = day(p.asOf);
  const lines: string[] = [];

  if (p.status !== 'ok') {
    lines.push(`NJ Construction Permit Data: not checked (the request ${failedText(p)})`);
  } else if (!p.rowCount && !p.truncated) {
    lines.push(`No permits or certificates for ${where} in ${muni} in the NJ Construction Permit Data (as of ${asOf})`);
  } else {
    const count = p.truncated ? `at least ${p.rowCount ?? 0}` : `${p.rowCount ?? 0}`;
    const newest = p.rows[0];
    let line = `${count} permits and certificates on file for ${where} (NJ Construction Permit Data, as of ${asOf})`;
    if (newest) {
      line += `; newest ${newest.primary} '${newest.status ?? 'status not published'}' ${newest.date ?? 'date not published'}`;
      if (newest.detail) line += `, ${newest.detail}`;
      if (newest.amountCents !== null && newest.amountCents > 0) line += `, declared cost ${njDollars(newest.amountCents)}`;
    }
    lines.push(line);
  }

  const report = rec.muniLastReport;
  if (report.status !== 'ok') {
    lines.push(`${muni}'s last report date: not checked (the request ${failedText(report)})`);
  } else if (!report.date) {
    lines.push(`${muni} has no reports in the NJ Construction Permit Data — its permits would not appear here`);
  } else {
    lines.push(`${muni}'s latest report to the state is dated ${report.date}`);
    const fetched = Date.parse(rec.fetchedAt);
    const reported = Date.parse(`${report.date}T00:00:00Z`);
    if (Number.isFinite(fetched) && Number.isFinite(reported) && fetched - reported > NJ_STALE_REPORT_MS) {
      lines.push('That report is over a year old — permits after it will not appear here.');
    }
  }
  lines.push(rec.caveat || NJ_PERMIT_CAVEAT);
  lines.push(`Not checked: ${rec.notChecked.join(', ')}.`);

  const incomplete = p.status !== 'ok' || p.truncated || report.status !== 'ok';
  let kind: NjBuildingRecordSummary['kind'];
  let headline: string;
  if (incomplete) {
    kind = 'incomplete';
    headline = `Some New Jersey records could not be fully checked for ${where}; see below.`;
  } else if (!p.rowCount) {
    kind = 'listed';
    headline = `State permit data lists no permits or certificates for ${where}, ${muni} (as of ${asOf}). Some towns don't report; violations are not published statewide.`;
  } else {
    kind = 'listed';
    headline = `State permit data for ${where}, ${muni}: ${p.rowCount} permits and certificates on file (as of ${asOf}). Violations are not published statewide.`;
  }

  const promptBlock = 'NJ BUILDING RECORD (the state\'s NJ Construction Permit Data, data.nj.gov w9se-dmra; each line names its source and date):\n'
    + `${headline}\n- ${lines.join('\n- ')}\n`
    + "RULES: These are the state's raw permit records as published, not a finding by MAGE. Counts marked 'at least' are partial. "
    + 'New Jersey publishes no violations statewide, and some towns do not report. '
    + 'Never tell the contractor the property is free of problems or meets code. '
    + "Tell the contractor to confirm with the town's construction office.";

  const cacheKey = `brnj:${rec.muniCode}:${rec.block}:${rec.lot}:${p.asOf ?? p.status}${p.truncated ? '+' : ''}:${report.date ?? report.status}`;
  return { kind, headline, lines, promptBlock, chipLabel: headline, cacheKey };
}

/** A New Jersey jobsite (state only; NYC is excluded by the caller). */
export function isNjJobsite(addr: { state?: string }): boolean {
  return normalizeState(addr.state) === 'NJ';
}

export function njParcelConfirmKey(projectId: string): string {
  return `mageid_building_parcel_${projectId}`;
}

// ─────────────────────────────────────────────────────────────────────
// MARYLAND: BALTIMORE CITY AND BALTIMORE COUNTY (lane RECORD, 2026-09-28).
// ADDITIVE. Everything above (NYC, NJ) is unchanged. The MD record renders
// through summarizeMdBuildingRecord into the NYC BuildingRecordSummary shape
// with kinds from the NYC union ONLY, so Code Check grounding reads it
// unchanged. Wire types mirror supabase/functions/building-record/md.ts
// (validate-building-record proves the round trip).
//
// Baltimore City and Baltimore County are separate governments. The side of a
// record is decided by which parcel layer contains the confirmed point, never
// by the postal city.
// ─────────────────────────────────────────────────────────────────────

export type MdSide = 'baltimore_city' | 'baltimore_county';
export type MdPartStatus = 'ok' | 'failed' | 'timeout';
export type MdAsOfKind = 'data' | 'edited' | 'none' | 'unread';
export interface MdCandidate { side: MdSide; key: string; label: string; lat: number; lon: number; match: 'address' | 'approximate'; }
export interface MdPartMeta { status: MdPartStatus; asOf: string | null; asOfKind: MdAsOfKind; source: string; url: string; }
export interface MdParcelPart extends MdPartMeta { found: boolean; address: string | null; zip: string | null; yearBuilt: number | null; areaSqft: number | null; zoning: string | null; use: string | null; dwellingUnits: number | null; neighborhood: string | null; parcelRef: string | null; }
export interface MdPermitRow { number: string; issued: string | null; expires: string | null; status: string | null; description: string | null; costCents: number | null; }
export interface MdPermitsPart extends MdPartMeta { total: number | null; truncated: boolean; rows: MdPermitRow[]; }
export interface MdNoticeRow { number: string; date: string | null; type: string | null; statusCode: string | null; }
export interface MdNoticesPart extends MdPartMeta { layer: string; truncated: boolean; rows: MdNoticeRow[]; }
export interface MdZoningRow { code: string; overlay: string | null; pdfUrl: string | null; }
export interface MdAreaRow { name: string; code: string | null; listed: string | null; }
export interface MdFloodRow { zone: string; subtype: string | null; sfha: boolean | null; bfe: number | null; dfirmId: string | null; }
export interface MdListPart<R> extends MdPartMeta { truncated: boolean; rows: R[]; }
export interface MdLink { label: string; url: string; }
export interface MdBuildingRecord {
  jurisdiction: 'md'; side: MdSide; key: string; label: string; fetchedAt: string;
  parcel: MdParcelPart;
  permits: MdPermitsPart;
  vacantNotices: MdNoticesPart | null;
  housingNotices: MdNoticesPart[];
  zoning: MdListPart<MdZoningRow>;
  historic: MdListPart<MdAreaRow>;
  landmarks: MdListPart<MdAreaRow> | null;
  nationalRegister: MdListPart<MdAreaRow> | null;
  flood: MdListPart<MdFloodRow>;
  notChecked: string[];
  links: MdLink[];
}
export type MdBuildingRecordRequest =
  | { mode: 'md_resolve'; text: string; lat: number | null; lon: number | null }
  | { mode: 'md_record'; side: MdSide; key: string; lat: number; lon: number };
export type MdBuildingRecordResponse =
  | { status: 'md_candidates'; candidates: MdCandidate[] }
  | { status: 'md_outside'; county: string | null }
  | { status: 'md_record'; record: MdBuildingRecord }
  | { status: 'error'; code: string; error: string };

/** Equal to md.ts (asserted by the validator). */
export const MD_NOT_CHECKED_CITY: readonly string[] = [
  'Permits issued before 2019 (a separate City dataset)',
  "Permit status (issued, finaled or expired is not in the City's open data)",
  'Closed violations and complaint history (the City publishes open notices only)',
  'Certificates of occupancy (no City dataset)',
  'Zoning, historic and flood maps beyond the address point',
];
export const MD_NOT_CHECKED_COUNTY: readonly string[] = [
  'Code enforcement cases (the County publishes them only in Citizen Access)',
  'Certificates of occupancy (no County dataset read)',
  'Zoning, historic and flood maps beyond the address point',
];

export const MD_SIDE_NAME: Record<MdSide, string> = { baltimore_city: 'Baltimore City', baltimore_county: 'Baltimore County' };

/**
 * The official pages behind the scope-trigger lines. Each was fetched on
 * checkedOn and the line's wording comes from it:
 *  - mdeLead: "Owners of rental homes built before 1978 must register their
 *    properties with the state, renew annually, and provide valid lead
 *    inspection certificates at each tenant turnover, unless the property is
 *    certified lead-free." (no page date)
 *  - epaRrp: paid work that disturbs painted surfaces in homes, child-care
 *    facilities and preschools built before 1978 needs certified firms and
 *    trained workers ("Last updated on June 17, 2026"; the old URL
 *    /lead/renovation-repair-and-painting-program redirects here).
 *  - chapReview: a permit filed first is held until CHAP staff issue an
 *    Authorization to Proceed and sign off in the permit system (page
 *    updated 09/16/2026; chap.baltimorecity.gov/review-procedures redirects here).
 *  - dhcdReferrals: exterior changes in a CHAP district need CHAP approval and
 *    are not issued over the counter; "some minor work that would not
 *    otherwise require a permit will require one in a CHAP district"; a
 *    floodplain property's permit is sent to Planning's floodplain managers
 *    (page updated 07/27/2026). It calls CHAP's approval a "Notice-To-Proceed";
 *    CHAP's own page says "Authorization to Proceed", which is used here.
 *  - cityFloodplain: "In Baltimore City, the regulated floodplain includes the
 *    1% and 0.2% annual-chance flood areas" (page modified 2023-09-15).
 *  - countyInspections: a building permit is required for "Any building
 *    activity within a tidal or riverine 100-year floodplain" (no page date).
 *  - countyCodes: "FLOOD PLAIN REGULATIONS: Baltimore County Bill #6-24,
 *    effective May 6, 2024" (sheet Rev 08/25/26).
 */
export const MD_SOURCES = {
  mdeLead: { name: 'MDE', url: 'https://mde.maryland.gov/programs/Land/LeadPoisoningPrevention/Pages/rentalowners.aspx', checkedOn: '2026-09-28' },
  epaRrp: { name: 'EPA', url: 'https://www.epa.gov/lead/lead-renovation-repair-and-painting-program', checkedOn: '2026-09-28' },
  chapReview: { name: 'CHAP review procedures', url: 'https://www.baltimorecity.gov/chap/our-work/review-procedures', checkedOn: '2026-09-28' },
  dhcdReferrals: { name: 'DHCD special referrals', url: 'https://www.baltimorecity.gov/dhcd/our-work/permits-and-inspections/permits-special-referrals', checkedOn: '2026-09-28' },
  cityFloodplain: { name: 'City floodplain program', url: 'https://www.baltimoresustainability.org/floodplain-management-program/', checkedOn: '2026-09-28' },
  countyInspections: { name: 'PAI Building Inspections', url: 'https://www.baltimorecountymd.gov/departments/pai/building-inspections', checkedOn: '2026-09-28' },
  countyCodes: { name: 'County codes sheet, Rev 08/25/26', url: 'https://www.baltimorecountymd.gov/files/departments/permits-approvals-and-inspections/documents/currentbuildingandfirecodes.pdf', checkedOn: '2026-09-28' },
} as const;
type MdSourceId = keyof typeof MD_SOURCES;

// ── parsing ──

const MD_BAD_RESPONSE: MdBuildingRecordResponse = { status: 'error', code: 'bad_response', error: 'The building lookup returned something MAGE could not read.' };

function pMdSide(v: unknown): MdSide { if (v === 'baltimore_city' || v === 'baltimore_county') return v; throw new Bad(); }
function pMdStatus(v: unknown): MdPartStatus { return dsStatus(v); }
function pMdAsOfKind(v: unknown): MdAsOfKind { if (v === 'data' || v === 'edited' || v === 'none' || v === 'unread') return v; throw new Bad(); }
function pMdMeta(o: O): MdPartMeta { return { status: pMdStatus(o.status), asOf: sN(o.asOf), asOfKind: pMdAsOfKind(o.asOfKind), source: s(o.source), url: s(o.url) }; }
function pMdCandidate(v: unknown): MdCandidate {
  const o = obj(v);
  if (o.match !== 'address' && o.match !== 'approximate') throw new Bad();
  return { side: pMdSide(o.side), key: s(o.key), label: s(o.label), lat: n(o.lat), lon: n(o.lon), match: o.match };
}
function pMdParcel(v: unknown): MdParcelPart {
  const o = obj(v);
  return {
    ...pMdMeta(o), found: b(o.found), address: sN(o.address), zip: sN(o.zip), yearBuilt: nN(o.yearBuilt), areaSqft: nN(o.areaSqft),
    zoning: sN(o.zoning), use: sN(o.use), dwellingUnits: nN(o.dwellingUnits), neighborhood: sN(o.neighborhood), parcelRef: sN(o.parcelRef),
  };
}
function pMdPermitRow(v: unknown): MdPermitRow {
  const o = obj(v);
  const cents = nN(o.costCents);
  if (cents !== null && !Number.isInteger(cents)) throw new Bad();
  return { number: s(o.number), issued: sN(o.issued), expires: sN(o.expires), status: sN(o.status), description: sN(o.description), costCents: cents };
}
function pMdPermits(v: unknown): MdPermitsPart {
  const o = obj(v);
  return { ...pMdMeta(o), total: nN(o.total), truncated: b(o.truncated), rows: arr(o.rows, pMdPermitRow) };
}
function pMdNoticeRow(v: unknown): MdNoticeRow {
  const o = obj(v);
  return { number: s(o.number), date: sN(o.date), type: sN(o.type), statusCode: sN(o.statusCode) };
}
function pMdNotices(v: unknown): MdNoticesPart {
  const o = obj(v);
  return { ...pMdMeta(o), layer: s(o.layer), truncated: b(o.truncated), rows: arr(o.rows, pMdNoticeRow) };
}
function pMdList<R>(v: unknown, row: (x: unknown) => R): MdListPart<R> {
  const o = obj(v);
  return { ...pMdMeta(o), truncated: b(o.truncated), rows: arr(o.rows, row) };
}
const pMdZoningRow = (v: unknown): MdZoningRow => { const o = obj(v); return { code: s(o.code), overlay: sN(o.overlay), pdfUrl: sN(o.pdfUrl) }; };
const pMdAreaRow = (v: unknown): MdAreaRow => { const o = obj(v); return { name: s(o.name), code: sN(o.code), listed: sN(o.listed) }; };
const pMdFloodRow = (v: unknown): MdFloodRow => { const o = obj(v); return { zone: s(o.zone), subtype: sN(o.subtype), sfha: bN(o.sfha), bfe: nN(o.bfe), dfirmId: sN(o.dfirmId) }; };
function pMdRecord(v: unknown): MdBuildingRecord {
  const o = obj(v);
  if (o.jurisdiction !== 'md') throw new Bad();
  const side = pMdSide(o.side);
  const city = side === 'baltimore_city';
  // City-only parts are null on a County record and present on a City one.
  const cityOnly = <T>(x: unknown, p: (y: unknown) => T): T | null => {
    if (!city) { if (x !== null) throw new Bad(); return null; }
    return p(x);
  };
  const rec: MdBuildingRecord = {
    jurisdiction: 'md', side, key: s(o.key), label: s(o.label), fetchedAt: s(o.fetchedAt),
    parcel: pMdParcel(o.parcel), permits: pMdPermits(o.permits),
    vacantNotices: cityOnly(o.vacantNotices, pMdNotices),
    housingNotices: arr(o.housingNotices, pMdNotices),
    zoning: pMdList(o.zoning, pMdZoningRow),
    historic: pMdList(o.historic, pMdAreaRow),
    landmarks: cityOnly(o.landmarks, (x) => pMdList(x, pMdAreaRow)),
    nationalRegister: cityOnly(o.nationalRegister, (x) => pMdList(x, pMdAreaRow)),
    flood: pMdList(o.flood, pMdFloodRow),
    notChecked: arr(o.notChecked, s),
    links: arr(o.links, (x) => { const l = obj(x); return { label: s(l.label), url: s(l.url) }; }),
  };
  if (city && rec.housingNotices.length !== 4) throw new Bad();
  // The four housing-notice layers are City-only too (the County publishes no
  // code-enforcement data), so a County record carrying any is not a record.
  if (!city && rec.housingNotices.length) throw new Bad();
  return rec;
}

/** Tolerant: never throws; an unknown shape is one fixed error. */
export function parseMdBuildingRecordResponse(json: unknown): MdBuildingRecordResponse {
  try {
    const o = obj(json);
    switch (o.status) {
      case 'md_candidates': return { status: 'md_candidates', candidates: arr(o.candidates, pMdCandidate) };
      case 'md_outside': return { status: 'md_outside', county: sN(o.county ?? null) };
      case 'md_record': return { status: 'md_record', record: pMdRecord(o.record) };
      case 'error': return { status: 'error', code: s(o.code), error: s(o.error) };
      default: return { ...MD_BAD_RESPONSE };
    }
  } catch {
    return { ...MD_BAD_RESPONSE };
  }
}

// ── the MD renderer ──

/** The cap on promptBlock. Trimming drops permit rows (oldest first), then
 *  other fact lines; never the header, the headline, the scope-trigger lines,
 *  the "Not checked" line or the RULES paragraph. */
export const MD_PROMPT_CAP = 2400;
const MD_DESC_MAX = 140;

function mdAsOfText(p: MdPartMeta): string {
  switch (p.asOfKind) {
    case 'data': return p.asOf ? `as of ${p.asOf}` : 'as-of date not published';
    case 'edited': return p.asOf ? `last edited ${p.asOf}` : 'as-of date not published';
    case 'none': return 'as-of date not published';
    default: return 'as-of date not read';
  }
}
const mdSrc = (p: MdPartMeta): string => ` · ${p.source}, ${mdAsOfText(p)}`;
const mdCouldNot = (p: MdPartMeta): string => `Couldn't read ${p.source} — not checked`;
function mdTrim(v: string | null, max = MD_DESC_MAX): string | null {
  if (!v) return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** 1% annual-chance (100-year) zones on a FEMA map. */
const ONE_PCT_ZONES = /^(A|AE|AH|AO|AR|A99|V|VE|A\d{1,2})$/i;

function mdPermitLine(r: MdPermitRow, county: boolean, descMax = MD_DESC_MAX): string {
  const bits = [r.number, r.issued ? `issued ${r.issued}` : 'issue date not published'];
  if (r.expires) bits.push(`expires ${r.expires}`);
  if (county && r.status) bits.push(`County status ${r.status}`);
  const d = mdTrim(r.description, descMax);
  if (d) bits.push(d);
  if (r.costCents !== null && r.costCents > 0) bits.push(`declared cost ${njDollars(r.costCents)}`);
  return bits.join(' · ');
}

function mdTrigger(id: MdSourceId[], text: string, withUrls: boolean): string {
  const cite = id.map((k) => {
    const src = MD_SOURCES[k];
    return withUrls ? `${src.name}, checked ${src.checkedOn}: ${src.url}` : `${src.name}, checked ${src.checkedOn}`;
  }).join('; ');
  return `${text} (${cite})`;
}

/** A fact line and how long it survives the promptBlock trim (3 = kept longest). */
interface MdFact { text: string; prio: 1 | 2 | 3; }
interface MdRendered { facts: MdFact[]; permitLines: string[]; promptPermitLines: string[]; triggers: (withUrls: boolean) => string[]; }

function mdRender(rec: MdBuildingRecord): MdRendered {
  const city = rec.side === 'baltimore_city';
  const open: MdFact[] = [];   // open notices: first on the card, last to be trimmed
  const facts: MdFact[] = [];
  const trig: { ids: MdSourceId[]; text: string }[] = [];
  const bare: string[] = [];
  const add = (text: string, prio: MdFact['prio']) => facts.push({ text, prio });

  // Open notices (City only) go first.
  const noticeFacts: MdFact[] = [];
  if (rec.vacantNotices) {
    const v = rec.vacantNotices;
    if (v.status !== 'ok') noticeFacts.push({ text: mdCouldNot(v), prio: 3 });
    else if (!v.rows.length) noticeFacts.push({ text: `No open vacant building notice in ${v.source}${mdSrc(v).replace(` · ${v.source},`, ',')}`, prio: 2 });
    else for (const r of v.rows) {
      open.push({ text: `Open vacant building notice ${r.number}, dated ${r.date ?? 'date not published'}${mdSrc(v)}`, prio: 3 });
      bare.push(`Open vacant building notice ${r.number} dated ${r.date ?? 'date not published'}.`);
    }
  }
  if (city) {
    const hn = rec.housingNotices;
    const allEmpty = hn.length > 0 && hn.every((x) => x.status === 'ok' && !x.rows.length && !x.truncated);
    if (allEmpty) {
      const newest = hn.map((x) => x.asOf).filter((x): x is string => !!x).sort().pop() ?? null;
      noticeFacts.push({ text: `No open housing-code notices (${hn.map((x) => x.layer.toLowerCase()).join(', ')}) in the ${hn[0].source}, ${newest ? `as of ${newest}` : 'as-of date not read'}`, prio: 2 });
    } else {
      const empty: MdNoticesPart[] = [];
      for (const x of hn) {
        if (x.status !== 'ok') { noticeFacts.push({ text: mdCouldNot({ ...x, source: `the ${x.layer.toLowerCase()} notices in the ${x.source}` }), prio: 3 }); continue; }
        for (const r of x.rows) {
          open.push({ text: `Open ${(r.type ?? x.layer).toLowerCase()} notice ${r.number}, dated ${r.date ?? 'date not published'}, DHCD status code: ${r.statusCode ?? 'not published'}${mdSrc(x)}`, prio: 3 });
        }
        if (x.truncated) noticeFacts.push({ text: `${x.layer} notices: MAGE read only the first ${x.rows.length} rows, so there may be more${mdSrc(x)}`, prio: 3 });
        else if (!x.rows.length) empty.push(x);
      }
      if (empty.length) {
        const names = empty.map((x) => x.layer.toLowerCase());
        const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
        const newest = empty.map((x) => x.asOf).filter((x): x is string => !!x).sort().pop() ?? null;
        noticeFacts.push({ text: `No open ${list} notices in the ${empty[0].source}, ${newest ? `as of ${newest}` : 'as-of date not read'}`, prio: 2 });
      }
    }
  }

  // Parcel + year built (+ the pre-1978 lead trigger).
  const p = rec.parcel;
  if (p.status !== 'ok') {
    add(mdCouldNot(p), 3);
  } else if (!p.found) {
    add(`No parcel found for ${city ? `block-lot ${rec.key.slice(0, 5).trim()} ${rec.key.slice(5)}` : 'this tax account'}${mdSrc(p)}`, 3);
  } else {
    const where = [p.address, p.parcelRef, p.neighborhood].filter(Boolean).join(', ');
    add(`Parcel: ${where || 'address not published'}${mdSrc(p)}`, 3);
    add(`${p.yearBuilt !== null ? `Year built ${p.yearBuilt}` : 'Year built not recorded'}${mdSrc(p)}`, 3);
    if (p.areaSqft !== null) add(`Building area ${Math.round(p.areaSqft).toLocaleString('en-US')} sq ft${mdSrc(p)}`, 1);
    if (!city && p.use) add(`Land use ${p.use}${mdSrc(p)}`, 1);
    if (p.yearBuilt !== null && p.yearBuilt < 1978) {
      trig.push({ ids: ['mdeLead', 'epaRrp'], text: `Built ${p.yearBuilt}, before 1978. If it is a rental home, Maryland requires lead registration with MDE and a lead inspection certificate at each tenant turnover unless it is certified lead-free. Paid work that disturbs paint in a pre-1978 home, child-care facility or preschool is covered by EPA's RRP rule` });
    } else if (p.yearBuilt === null) {
      bare.push("Year built not recorded, so MAGE can't say whether pre-1978 lead rules apply.");
    }
  }

  // Zoning.
  const z = rec.zoning;
  if (z.status !== 'ok') add(mdCouldNot(z), 3);
  else if (!z.rows.length) add(`No zoning district at the address point${mdSrc(z)}`, 2);
  else add(`Zoning ${z.rows.map((r) => r.code + (r.overlay ? `, overlay ${r.overlay}` : '')).join(' / ')}${mdSrc(z)}`, 3);

  // Historic: CHAP district / County district, CHAP landmark, National Register.
  const h = rec.historic;
  let chap = false;
  if (h.status !== 'ok') add(mdCouldNot(h), 3);
  else if (h.rows.length) {
    chap = city;
    add(`${city ? 'CHAP historic district' : 'County historic district'}: ${h.rows.map((r) => r.name + (r.listed ? `, listed ${r.listed}` : '')).join(' / ')}${mdSrc(h)}`, 3);
  } else {
    add(`Not found in ${h.source}${mdSrc(h).replace(` · ${h.source},`, ',')}${city ? '. The layer may be out of date.' : ''}`, 2);
  }
  if (rec.landmarks) {
    const l = rec.landmarks;
    if (l.status !== 'ok') add(mdCouldNot(l), 3);
    else if (l.rows.length) { chap = true; add(`CHAP landmark: ${l.rows.map((r) => r.name).join(' / ')}${mdSrc(l)}`, 3); }
    else add(`Not found in ${l.source}${mdSrc(l).replace(` · ${l.source},`, ',')}`, 1);
  }
  if (rec.nationalRegister) {
    const nr = rec.nationalRegister;
    if (nr.status !== 'ok') add(mdCouldNot(nr), 2);
    else if (nr.rows.length) add(`National Register district: ${nr.rows.map((r) => r.name + (r.listed ? `, listed ${r.listed}` : '')).join(' / ')} (informational)${mdSrc(nr)}`, 1);
  }
  if (chap) {
    trig.push({ ids: ['chapReview', 'dhcdReferrals'], text: 'Exterior work here needs CHAP approval (an Authorization to Proceed) before the permit issues. Some work that is otherwise exempt needs a permit in a CHAP district' });
  }

  // Flood.
  const fl = rec.flood;
  if (fl.status !== 'ok') add(mdCouldNot(fl), 3);
  else if (!fl.rows.length) add(`Not in a mapped flood area in ${fl.source}${mdSrc(fl).replace(` · ${fl.source},`, ',')}`, 2);
  else {
    let onePct = false;
    let pointTwo = false;
    for (const r of fl.rows) {
      const zone = r.zone.toUpperCase();
      const bfe = r.bfe !== null ? `, base flood elevation ${r.bfe} ft` : ', no base flood elevation published';
      if (ONE_PCT_ZONES.test(zone)) {
        onePct = true;
        add(`Flood zone ${r.zone}: in the 1% annual-chance (100-year) flood area${bfe}${mdSrc(fl)}`, 3);
      } else if (zone === 'X2' || /0\.2 PCT/i.test(r.subtype ?? '')) {
        pointTwo = true;
        add(city
          ? `Flood zone ${r.zone}: in the 0.2% annual-chance flood area, which Baltimore City's floodplain rules also cover${mdSrc(fl)}`
          : `Flood zone ${r.zone}: in the 0.2% annual-chance flood area on FEMA's map${mdSrc(fl)}`, 3);
      } else if (zone === 'X' && /MINIMAL/i.test(r.subtype ?? '')) {
        // FEMA's own subtype words ("minimal hazard", "reduced risk") are not
        // repeated: only where the point sits on the map.
        add(`Flood zone ${r.zone} on FEMA's map, outside its mapped 1% and 0.2% annual-chance flood areas${mdSrc(fl)}`, 2);
      } else if (/LEVEE/i.test(r.subtype ?? '')) {
        add(`Flood zone ${r.zone} on FEMA's map, in an area FEMA marks as behind a levee${mdSrc(fl)}`, 2);
      } else {
        add(`Flood zone ${r.zone} on FEMA's map${mdSrc(fl)}`, 2);
      }
    }
    if (city && (onePct || pointTwo)) {
      trig.push({ ids: ['dhcdReferrals', 'cityFloodplain'], text: "In Baltimore City's regulated floodplain: the permit is sent to Planning's floodplain managers for review. The City regulates both the 1% and the 0.2% annual-chance flood areas" });
    }
    if (!city && onePct) {
      trig.push({ ids: ['countyInspections', 'countyCodes'], text: 'In the 1% annual-chance flood area: Baltimore County requires a building permit for any building activity in a tidal or riverine 100-year floodplain. County floodplain rules: Bill 6-24' });
    }
  }

  facts.push(...noticeFacts);

  // Permits.
  const permitLines: string[] = [];
  const promptPermitLines: string[] = [];
  const pm = rec.permits;
  if (pm.status !== 'ok') add(mdCouldNot(pm), 3);
  else {
    const what = city ? 'City permits since 2019' : 'County permits';
    const count = pm.total ?? 0;
    if (!count) add(`No permits listed for this parcel in ${pm.source}${mdSrc(pm).replace(` · ${pm.source},`, ',')}`, 2);
    else {
      add(`${count} ${what} for this parcel${mdSrc(pm)}`, 3);
      for (const r of pm.rows) {
        permitLines.push(mdPermitLine(r, !city));
        promptPermitLines.push(mdPermitLine(r, !city, 90));
      }
    }
  }

  return {
    facts: [...open, ...facts],
    permitLines,
    promptPermitLines,
    triggers: (withUrls: boolean) => [...trig.map((t) => mdTrigger(t.ids, t.text, withUrls)), ...bare],
  };
}

function mdNewestAsOf(rec: MdBuildingRecord): string | null {
  const parts: MdPartMeta[] = [rec.parcel, rec.permits, rec.zoning, rec.historic, rec.flood, ...rec.housingNotices];
  if (rec.vacantNotices) parts.push(rec.vacantNotices);
  return parts.filter((p) => p.status === 'ok' && p.asOfKind === 'data' && p.asOf).map((p) => p.asOf as string).sort().pop() ?? null;
}

/** The newest dataset as-of day of an MD record (null when none was read). */
export function mdRecordAsOf(rec: MdBuildingRecord | null | undefined): string | null {
  return rec ? mdNewestAsOf(rec) : null;
}

const MD_NONE_SUMMARY: BuildingRecordSummary = { kind: 'none', headline: '', lines: [], promptBlock: '', chipLabel: '', cacheKey: 'brmd:none' };

/**
 * The one MD renderer. Kinds stay inside the NYC union:
 *   'attention'            an open vacant building notice or open housing notice
 *                          is listed (from parts that read ok);
 *   'no_active_in_checked' ONLY for a City record whose vacant-notice part and
 *                          all four notice layers read ok, none truncated,
 *                          nothing listed;
 *   'incomplete'           any part failed, timed out or was truncated, AND
 *                          ALWAYS for a County record: the County publishes no
 *                          code-enforcement dataset, so a County record can
 *                          never claim "nothing open".
 */
export function summarizeMdBuildingRecord(rec: MdBuildingRecord | null | undefined): BuildingRecordSummary {
  if (!rec) return { ...MD_NONE_SUMMARY, lines: [] };
  const city = rec.side === 'baltimore_city';
  const r = mdRender(rec);
  const notChecked = `Not checked: ${rec.notChecked.join(', ')}.`;
  const newest = mdNewestAsOf(rec);
  const asOfText = newest ? `as of ${newest}` : 'as-of dates not published';

  const parts: MdPartMeta[] = [rec.parcel, rec.permits, rec.zoning, rec.historic, rec.flood, ...rec.housingNotices];
  if (rec.vacantNotices) parts.push(rec.vacantNotices);
  if (rec.landmarks) parts.push(rec.landmarks);
  if (rec.nationalRegister) parts.push(rec.nationalRegister);
  const incomplete = parts.some((p) => p.status !== 'ok' || ('truncated' in p && (p as { truncated: boolean }).truncated));

  const listed: string[] = [];
  if (rec.vacantNotices && rec.vacantNotices.status === 'ok' && rec.vacantNotices.rows.length) {
    const k = rec.vacantNotices.rows.length;
    listed.push(`${k} vacant building ${k === 1 ? 'notice' : 'notices'}`);
  }
  for (const x of rec.housingNotices) {
    if (x.status === 'ok' && x.rows.length) listed.push(`${x.rows.length} ${x.layer.toLowerCase()} ${x.rows.length === 1 ? 'notice' : 'notices'}`);
  }
  const noticeParts = [...rec.housingNotices, ...(rec.vacantNotices ? [rec.vacantNotices] : [])];
  const noticesComplete = city && rec.vacantNotices !== null && rec.housingNotices.length === 4
    && noticeParts.every((x) => x.status === 'ok' && !x.truncated);

  let kind: BuildingRecordSummary['kind'];
  let headline: string;
  if (listed.length) {
    kind = 'attention';
    // Neutral on purpose: the housing notices come from the City's inspections
    // map feed, which is not a published dataset (each line names its source).
    headline = `${city ? 'Baltimore City' : 'Baltimore County'} records list open notices for this parcel: ${listed.join(', ')} (${asOfText}).`;
  } else if (!city) {
    kind = 'incomplete';
    const names: [MdPartMeta, string][] = [[rec.parcel, 'parcel'], [rec.permits, 'permits'], [rec.zoning, 'zoning'], [rec.flood, 'flood map'], [rec.historic, 'historic districts']];
    const read = names.filter(([p]) => p.status === 'ok').map(([, name]) => name);
    const notRead = names.filter(([p]) => p.status !== 'ok').map(([, name]) => name);
    const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
    headline = `${read.length ? `Baltimore County ${list(read)} read (${asOfText})` : 'Nothing in Baltimore County\'s open data could be read'}${notRead.length && read.length ? `; ${list(notRead)} could not be read` : ''}. Code enforcement not checked.`;
  } else if (incomplete || !noticesComplete) {
    kind = 'incomplete';
    headline = 'Some Baltimore City datasets could not be fully checked for this parcel; see below.';
  } else {
    kind = 'no_active_in_checked';
    const nNewest = noticeParts.map((x) => x.asOf).filter((x): x is string => !!x).sort().pop() ?? null;
    headline = `No open notices listed in the City datasets MAGE checked (${nNewest ? `as of ${nNewest}` : 'as-of date not read'})`;
  }

  const lines = [...r.facts.map((x) => x.text), ...r.permitLines, ...r.triggers(false), notChecked];

  const header = `BUILDING RECORD (${city ? 'Baltimore City' : 'Baltimore County'} open data, fetched by MAGE ${rec.fetchedAt.slice(0, 10)})`;
  const rules = city
    ? "RULES: These are public records as published, not a finding by MAGE. Only open notices are published; closed history is not. The City does not publish permit status, so never say a permit is finaled, active or expired. Do not infer legal consequences. Never tell the contractor the building is free of problems or meets code."
    : "RULES: These are public records as published, not a finding by MAGE. Baltimore County publishes no code-enforcement dataset, so nothing here says whether the property has open code cases. Permit status is the County's own code, shown verbatim. Do not infer legal consequences. Never tell the contractor the building is free of problems or meets code.";
  const triggers = r.triggers(true);
  let facts = [...r.facts];
  let permits = [...r.promptPermitLines];
  const build = () => [header, headline, ...facts.map((x) => `- ${x.text}`), ...permits.map((x) => `- ${x}`), ...triggers.map((x) => `- ${x}`), notChecked, rules].join('\n');
  let promptBlock = build();
  // Oldest permit rows go first, then the least useful facts (lowest prio,
  // from the end). Header, headline, triggers, Not checked and RULES stay.
  while (promptBlock.length > MD_PROMPT_CAP && permits.length) { permits = permits.slice(0, -1); promptBlock = build(); }
  for (const prio of [1, 2, 3] as const) {
    while (promptBlock.length > MD_PROMPT_CAP) {
      let at = -1;
      for (let k = facts.length - 1; k >= 0; k--) if (facts[k].prio === prio) { at = k; break; }
      if (at < 0) break;
      facts = [...facts.slice(0, at), ...facts.slice(at + 1)];
      promptBlock = build();
    }
  }

  const cacheKey = `brmd:${rec.side}:${rec.key}:${parts.map((x) => (x.asOf ?? x.status) + (('truncated' in x && (x as { truncated: boolean }).truncated) ? '+' : '')).join(',')}`;
  const chipLabel = `${city ? 'Baltimore City' : 'Baltimore County'} record, ${asOfText}`;
  return { kind, headline, lines, promptBlock, chipLabel, cacheKey };
}

/**
 * The card's links for an MD record: the zoning district PDF the zoning layer
 * names (only when the zoning part read ok, https only, deduped), then the
 * record's own links (E-Permits / Citizen Access).
 */
export function mdRecordLinks(rec: MdBuildingRecord | null | undefined): MdLink[] {
  if (!rec) return [];
  const out: MdLink[] = [];
  const seen = new Set<string>();
  if (rec.zoning.status === 'ok') {
    for (const z of rec.zoning.rows) {
      if (!z.pdfUrl || !/^https:\/\//i.test(z.pdfUrl) || seen.has(z.pdfUrl)) continue;
      seen.add(z.pdfUrl);
      out.push({ label: `${z.code} zoning district (PDF)`, url: z.pdfUrl });
    }
  }
  for (const l of rec.links) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    out.push(l);
  }
  return out;
}

/** A Maryland jobsite (state only; City vs County is decided by the parcel). */
export function isMdJobsite(addr: { state?: string }): boolean {
  return normalizeState(addr.state) === 'MD';
}

/** The job's permit row by number: exact match after upper-casing and removing
 *  spaces and dashes. null when the permits part did not read ok. */
export function mdPermitForNumber(rec: MdBuildingRecord, permitNumber: string | null | undefined): MdPermitRow | null {
  if (!rec || rec.permits.status !== 'ok') return null;
  const norm = (x: string | null | undefined) => (x ?? '').toUpperCase().replace(/[\s-]+/g, '');
  const p = norm(permitNumber);
  if (!p) return null;
  return rec.permits.rows.find((r) => norm(r.number) === p) ?? null;
}

export function mdParcelConfirmKey(projectId: string): string {
  return `mageid_building_md_${projectId}`;
}

export function mdBuildingRecordCacheKey(side: MdSide, key: string): string {
  return `mageid_building_record_md_${side}_${key.replace(/\s+/g, '-')}`;
}
