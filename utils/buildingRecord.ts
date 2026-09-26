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
