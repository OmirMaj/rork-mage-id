// building-record/normalize.ts — the PURE half of the NYC building-record
// function. No Deno globals, no https imports, no '@/' imports: bun imports it
// directly (scripts/validate-building-record.ts, scripts/probe-building-record.ts)
// so every rule that decides what a contractor is told is tested offline.
//
// HONESTY RULES this file exists to hold:
//   - The four violation/complaint sets are filtered to ACTIVE on the SERVER
//     ($where), so a count is complete whenever the page is not full.
//   - A full page (returned === limit) is `truncated`; the client prints
//     "at least N" and can never say "No active …" for it.
//   - A dataset that failed or timed out is kept, with activeCount null. It is
//     never dropped and never zero.
//   - Only fixed ERRORS texts ever leave the function.
//   - Owner, respondent, permittee, phone and filing-representative columns are
//     never selected, so they cannot leak into a response.
//
// Column names and values verified live against NYC Open Data on 2026-09-26
// (GET /api/views/<id>.json and $select=…, count(*) … $group=…). See
// scripts/probe-building-record.ts to re-run the probe.

// ─────────────────────────────────────────────────────────────────────
// Wire types — a private, byte-compatible copy of utils/buildingRecord.ts.
// validate-building-record.ts proves the round trip.
// ─────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────
// Fixed texts
// ─────────────────────────────────────────────────────────────────────

/** The ONLY error strings the function ever returns. */
export const ERRORS = {
  bad_request: 'The building lookup request was not valid.',
  rate_limited: 'Too many building lookups this hour. Try again later.',
  upstream: "NYC Open Data didn't answer — nothing was checked.",
  internal: 'The building lookup failed — nothing was checked.',
} as const;

/** Agencies and record sets MAGE does not read. Equal to the client's list. */
export const NOT_CHECKED: readonly string[] = ['HPD (housing maintenance)', 'FDNY', 'DEP', 'LPC calendar', 'DOT', 'BIS-only paper records'];

export const BENCHMARK_NOTE = 'Only filings that reached approval are counted, so slow or abandoned filings are missing (survivor bias).';
export const BENCHMARK_LIMIT = 50000;
export const BENCHMARK_WINDOW_DAYS = 365;

// The two upstream hosts. Nothing else is ever fetched, and no user-supplied
// URL is ever fetched.
const SODA_RESOURCE = 'https://data.cityofnewyork.us/resource/';
const GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2/search';
// Links only (never fetched).
const DATASET_PAGE = 'https://data.cityofnewyork.us/d/';
/** nyc.gov's own "Login to DOB NOW" link (using-dob-now.page, 2026-09-26). */
export const DOB_NOW_PORTAL = 'https://a810-dobnow.nyc.gov/publish/#/';

// ─────────────────────────────────────────────────────────────────────
// Datasets
// ─────────────────────────────────────────────────────────────────────

export type DatasetId =
  | '3h2n-5cm9' | '6bgk-3dad' | '855j-jady' | 'eabe-havv'
  | 'w9ak-ipjd' | 'rbx6-tga4' | 'ipu4-2q9a' | '64uk-42ks';

export interface DatasetDef { id: DatasetId; name: string; url: string; limit: number; }

const def = (id: DatasetId, name: string, limit: number): DatasetDef => ({ id, name, url: `${DATASET_PAGE}${id}`, limit });

export const DATASETS: Readonly<Record<DatasetId, DatasetDef>> = {
  '3h2n-5cm9': def('3h2n-5cm9', 'DOB Violations', 500),
  '6bgk-3dad': def('6bgk-3dad', 'DOB ECB Violations', 500),
  '855j-jady': def('855j-jady', 'DOB Safety Violations', 500),
  'eabe-havv': def('eabe-havv', 'DOB Complaints Received', 500),
  'w9ak-ipjd': def('w9ak-ipjd', 'DOB NOW: Build – Job Application Filings', 25),
  'rbx6-tga4': def('rbx6-tga4', 'DOB NOW: Build – Approved Permits', 100),
  'ipu4-2q9a': def('ipu4-2q9a', 'DOB Permit Issuance (BIS)', 25),
  '64uk-42ks': def('64uk-42ks', 'PLUTO', 1),
};

/** The seven record sets, in the fixed order the summary prints them. PLUTO is
 *  the parcel, not a dataset row. */
export const RECORD_DATASET_IDS: readonly DatasetId[] = [
  '3h2n-5cm9', '6bgk-3dad', '855j-jady', 'eabe-havv', 'w9ak-ipjd', 'rbx6-tga4', 'ipu4-2q9a',
];

/** The server-side ACTIVE filter for each violation/complaint set. Values were
 *  confirmed with $select=distinct on 2026-09-26: 855j stores 'Active' (mixed
 *  case, hence upper()); eabe stores 'ACTIVE' / 'CLOSED'; 6bgk stores 'ACTIVE' /
 *  'RESOLVE'; every 3h2n active category contains 'ACTIVE' and no '*'. */
export const ACTIVE_FILTERS = {
  '3h2n-5cm9': "violation_category like '%ACTIVE%'",
  '6bgk-3dad': "ecb_violation_status='ACTIVE'",
  '855j-jady': "upper(violation_status)='ACTIVE'",
  'eabe-havv': "status='ACTIVE'",
} as const;

/** DOB NOW filing statuses that are FINISHED (the job left plan review: it was
 *  permitted, signed off, withdrawn, revoked or denied). Everything else — plan
 *  examiner review, objections, on hold, approved but not yet permitted — is
 *  in flight. From $select=filing_status, count(*) … $group on 2026-09-26. */
export const FILING_DONE_STATUSES: readonly string[] = [
  'loc issued', 'co issued', 'full demolition signed-off', 'signed-off', 'filing withdrawn',
  'permit entire', 'permit issued', 'pa certificate of operation issued',
  'ta certificate of operation issued', 'revoked', 'll 158-2017-denied', 'inspection complete',
];

export function isFilingInFlight(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return false;
  return !FILING_DONE_STATUSES.includes(s);
}

// ─────────────────────────────────────────────────────────────────────
// Sanitizers — every value that reaches a URL goes through one of these.
// ─────────────────────────────────────────────────────────────────────

export function sanitizeBin(v: unknown): string | null {
  return typeof v === 'string' && /^\d{7}$/.test(v.trim()) ? v.trim() : null;
}
export function sanitizeBbl(v: unknown): string | null {
  return typeof v === 'string' && /^\d{10}$/.test(v.trim()) ? v.trim() : null;
}
export function sanitizePermitNumber(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return /^[A-Z0-9-]{5,32}$/.test(s) ? s : null;
}
export const BOROUGHS = ['MANHATTAN', 'BRONX', 'BROOKLYN', 'QUEENS', 'STATEN ISLAND'] as const;
export type Borough = typeof BOROUGHS[number];
export function sanitizeBorough(v: unknown): Borough | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().toUpperCase().replace(/\s+/g, ' ');
  if (s === 'NEW YORK') s = 'MANHATTAN';
  if (s === 'THE BRONX') s = 'BRONX';
  return (BOROUGHS as readonly string[]).includes(s) ? (s as Borough) : null;
}
export function sanitizeText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 200) return null;
  return s;
}

/** Parse a request body. Anything that does not sanitize is null → 400. */
export function parseRequest(body: unknown): BuildingRecordRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  switch (b.mode) {
    case 'resolve': {
      const text = sanitizeText(b.text);
      return text ? { mode: 'resolve', text } : null;
    }
    case 'record': {
      const bin = sanitizeBin(b.bin);
      const bbl = sanitizeBbl(b.bbl);
      return bin && bbl ? { mode: 'record', bin, bbl } : null;
    }
    case 'permit': {
      const permitNumber = sanitizePermitNumber(b.permitNumber);
      return permitNumber ? { mode: 'permit', permitNumber } : null;
    }
    case 'benchmark': {
      const borough = sanitizeBorough(b.borough);
      return borough ? { mode: 'benchmark', borough } : null;
    }
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Query builders. Values are sanitized first; the whole $where goes through
// encodeURIComponent. Every URL starts with one of the two upstream hosts.
// ─────────────────────────────────────────────────────────────────────

function soqlUrl(id: DatasetId, params: { select?: string; where: string; order?: string; limit: number }): string {
  const parts: string[] = [];
  if (params.select) parts.push(`$select=${encodeURIComponent(params.select)}`);
  parts.push(`$where=${encodeURIComponent(params.where)}`);
  if (params.order) parts.push(`$order=${encodeURIComponent(params.order)}`);
  parts.push(`$limit=${params.limit}`);
  return `${SODA_RESOURCE}${id}.json?${parts.join('&')}`;
}

/** Only the columns MAGE shows. Owner / respondent / permittee / phone /
 *  filing-representative columns are never selected. */
export const SELECTS: Readonly<Record<DatasetId, string>> = {
  '3h2n-5cm9': 'bin,issue_date,violation_category,violation_type,violation_number,description',
  '6bgk-3dad': 'bin,ecb_violation_number,ecb_violation_status,severity,issue_date,hearing_date,violation_description,balance_due',
  '855j-jady': 'bin,violation_number,violation_issue_date,violation_type,violation_status',
  'eabe-havv': 'bin,complaint_number,status,date_entered,complaint_category',
  'w9ak-ipjd': 'bin,job_filing_number,filing_status,job_type,filing_review_type,filing_date,approved_date,applicant_first_name,applicant_last_name,applicant_license,applicant_professional_title',
  'rbx6-tga4': 'bin,work_permit,job_filing_number,permit_status,work_type,issued_date,expired_date',
  'ipu4-2q9a': 'bin__,job__,permit_status,filing_status,permit_type,work_type,issuance_date,expiration_date',
  '64uk-42ks': 'zonedist1,zonedist2,zonedist3,zonedist4,overlay1,overlay2,spdist1,spdist2,spdist3,histdist,landmark,pfirm15_flag,edesignum,yearbuilt,numfloors,bldgclass,version',
};

/** YYYY-MM-DD for `today` (UTC). */
export function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * The URL for one dataset for one building. Returns null when the bin/bbl do
 * not sanitize (the caller answers 400 before this is ever reached).
 *
 * Ordering notes (verified 2026-09-26):
 *   - ipu4-2q9a stores issuance_date as TEXT (MM/DD/YYYY), so it cannot be
 *     ordered by date server-side. BIS job numbers are issued in sequence, so
 *     `job__ DESC` gives the newest jobs first (`:id DESC` did not — it returned
 *     1998 rows first for 120 Broadway).
 *   - eabe-havv's date_entered is also text; complaint_number is sequential.
 *   - 64uk-42ks stores bbl as a NUMBER, so the filter is unquoted.
 *   - rbx6-tga4 is filtered to unexpired permits on the server as well as on
 *     the client, so its count is complete whenever the page is not full.
 */
export function datasetUrl(id: DatasetId, binIn: string, bblIn: string, today: Date): string | null {
  const bin = sanitizeBin(binIn);
  const bbl = sanitizeBbl(bblIn);
  if (!bin || !bbl) return null;
  const d = DATASETS[id];
  const sel = SELECTS[id];
  switch (id) {
    case '3h2n-5cm9':
      return soqlUrl(id, { select: sel, where: `bin='${bin}' AND ${ACTIVE_FILTERS[id]}`, order: 'issue_date DESC', limit: d.limit });
    case '6bgk-3dad':
      return soqlUrl(id, { select: sel, where: `bin='${bin}' AND ${ACTIVE_FILTERS[id]}`, order: 'issue_date DESC', limit: d.limit });
    case '855j-jady':
      return soqlUrl(id, { select: sel, where: `bin='${bin}' AND ${ACTIVE_FILTERS[id]}`, order: 'violation_issue_date DESC NULL LAST', limit: d.limit });
    case 'eabe-havv':
      return soqlUrl(id, { select: sel, where: `bin='${bin}' AND ${ACTIVE_FILTERS[id]}`, order: 'complaint_number DESC', limit: d.limit });
    case 'w9ak-ipjd':
      return soqlUrl(id, { select: sel, where: `bin='${bin}'`, order: 'filing_date DESC NULL LAST', limit: d.limit });
    case 'rbx6-tga4':
      return soqlUrl(id, { select: sel, where: `bin='${bin}' AND permit_status='Permit Issued' AND expired_date >= '${isoDay(today)}T00:00:00'`, order: 'issued_date DESC NULL LAST', limit: d.limit });
    case 'ipu4-2q9a':
      return soqlUrl(id, { select: sel, where: `bin__='${bin}'`, order: 'job__ DESC', limit: d.limit });
    case '64uk-42ks':
      return soqlUrl(id, { select: sel, where: `bbl=${bbl}`, limit: d.limit });
  }
}

export function geosearchUrl(textIn: string): string | null {
  const text = sanitizeText(textIn);
  if (!text) return null;
  return `${GEOSEARCH}?text=${encodeURIComponent(text)}&size=5`;
}

/** One URL per dataset that can hold a permit/filing number. BIS job numbers
 *  are digits only, so ipu4 is skipped for anything else. */
export function permitUrls(permitIn: string): { id: DatasetId; url: string }[] {
  const p = sanitizePermitNumber(permitIn);
  if (!p) return [];
  const out: { id: DatasetId; url: string }[] = [
    { id: 'w9ak-ipjd', url: soqlUrl('w9ak-ipjd', { select: 'job_filing_number,filing_status,filing_date', where: `job_filing_number='${p}'`, order: 'filing_date DESC', limit: 5 }) },
    { id: 'rbx6-tga4', url: soqlUrl('rbx6-tga4', { select: 'work_permit,job_filing_number,permit_status,issued_date', where: `work_permit='${p}' OR job_filing_number='${p}'`, order: 'issued_date DESC', limit: 5 }) },
  ];
  if (/^\d{5,12}$/.test(p)) {
    out.push({ id: 'ipu4-2q9a', url: soqlUrl('ipu4-2q9a', { select: 'job__,permit_status,filing_status,issuance_date', where: `job__='${p}'`, order: ':id DESC', limit: 5 }) });
  }
  return out;
}

export function benchmarkUrl(boroughIn: string, today: Date): string | null {
  const b = sanitizeBorough(boroughIn);
  if (!b) return null;
  const start = new Date(today.getTime() - BENCHMARK_WINDOW_DAYS * 86400000);
  // w9ak stores borough mixed-case ('Brooklyn'), hence upper(); job_type
  // 'Alteration' confirmed with $group on 2026-09-26.
  return soqlUrl('w9ak-ipjd', {
    select: 'filing_date,approved_date,filing_review_type',
    where: `upper(borough)='${b}' AND job_type='Alteration' AND approved_date IS NOT NULL AND filing_date >= '${isoDay(start)}T00:00:00'`,
    limit: BENCHMARK_LIMIT,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Value helpers
// ─────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 300) : null;
}

/** Any of the date shapes these datasets use → YYYY-MM-DD, else null. */
export function normDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s); // 3h2n / 6bgk YYYYMMDD
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); // floating timestamp
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); // MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** X-SODA2-Truth-Last-Modified → ISO, else null. */
export function asOfFromHeader(h: string | null | undefined): string | null {
  if (!h) return null;
  const t = Date.parse(h);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function joinDetail(...parts: (string | null)[]): string | null {
  const s = parts.filter((p): p is string => !!p).join('; ');
  return s || null;
}

const ROWS_KEPT = 5;

// ─────────────────────────────────────────────────────────────────────
// Per-dataset normalizers
// ─────────────────────────────────────────────────────────────────────

/** A dataset whose request failed or timed out: kept, never zero. */
export function failedDataset(id: DatasetId, status: 'failed' | 'timeout'): BuildingRecordDataset {
  const d = DATASETS[id];
  return { id, name: d.name, url: d.url, asOf: null, status, activeCount: null, returned: null, limit: d.limit, truncated: false, flags: [], rows: [] };
}

export function normalizeDataset(id: DatasetId, rawRows: unknown, asOfHeader: string | null, today: Date): BuildingRecordDataset {
  if (!Array.isArray(rawRows)) return failedDataset(id, 'failed');
  const d = DATASETS[id];
  const raw = rawRows.filter((r): r is Raw => !!r && typeof r === 'object');
  const returned = rawRows.length;
  const base = { id, name: d.name, url: d.url, asOf: asOfFromHeader(asOfHeader), status: 'ok' as const, returned, limit: d.limit, truncated: returned >= d.limit };
  const todayDay = isoDay(today);

  switch (id) {
    case '3h2n-5cm9': {
      const active = raw.filter((r) => { const c = str(r.violation_category) ?? ''; return c.toUpperCase().includes('ACTIVE') && !c.includes('*'); });
      // VW = work without permit; VWH hazardous; VPW = unserved ECB work without permit.
      const vw = active.some((r) => /^(VW|VPW)/i.test(str(r.violation_category) ?? ''));
      return {
        ...base, activeCount: active.length, flags: vw ? ['work_without_permit'] : [],
        rows: active.slice(0, ROWS_KEPT).map((r) => ({
          primary: str(r.violation_number) ?? '—', date: normDate(r.issue_date), status: str(r.violation_category),
          detail: str(r.description) ?? str(r.violation_type), amount: null,
        })),
      };
    }
    case '6bgk-3dad': {
      const active = raw.filter((r) => (str(r.ecb_violation_status) ?? '').toUpperCase() === 'ACTIVE');
      return {
        ...base, activeCount: active.length, flags: [],
        rows: active.slice(0, ROWS_KEPT).map((r) => ({
          primary: str(r.ecb_violation_number) ?? '—', date: normDate(r.issue_date), status: joinDetail(str(r.ecb_violation_status), str(r.severity)),
          detail: joinDetail(str(r.violation_description), normDate(r.hearing_date) ? `hearing ${normDate(r.hearing_date)}` : null), amount: num(r.balance_due),
        })),
      };
    }
    case '855j-jady': {
      const active = raw.filter((r) => (str(r.violation_status) ?? '').toUpperCase() === 'ACTIVE');
      return {
        ...base, activeCount: active.length, flags: [],
        rows: active.slice(0, ROWS_KEPT).map((r) => ({
          primary: str(r.violation_number) ?? '—', date: normDate(r.violation_issue_date), status: str(r.violation_status),
          detail: str(r.violation_type), amount: null,
        })),
      };
    }
    case 'eabe-havv': {
      const active = raw.filter((r) => (str(r.status) ?? '').toUpperCase() === 'ACTIVE');
      return {
        ...base, activeCount: active.length, flags: [],
        rows: active.slice(0, ROWS_KEPT).map((r) => ({
          primary: str(r.complaint_number) ?? '—', date: normDate(r.date_entered), status: str(r.status),
          detail: str(r.complaint_category) ? `category ${str(r.complaint_category)}` : null, amount: null,
        })),
      };
    }
    case 'w9ak-ipjd': {
      const inFlight = raw.filter((r) => isFilingInFlight(str(r.filing_status)));
      const objections = raw.some((r) => /objection/i.test(str(r.filing_status) ?? ''));
      return {
        ...base, activeCount: inFlight.length, flags: objections ? ['objections'] : [],
        rows: raw.slice(0, ROWS_KEPT).map((r) => {
          const name = [str(r.applicant_first_name), str(r.applicant_last_name)].filter(Boolean).join(' ');
          return {
            primary: str(r.job_filing_number) ?? '—', date: normDate(r.filing_date), status: str(r.filing_status),
            detail: joinDetail(str(r.job_type), str(r.filing_review_type), normDate(r.approved_date) ? `approved ${normDate(r.approved_date)}` : null),
            amount: null,
            jobFilingNumber: str(r.job_filing_number),
            // The applicant of record ONLY — the RA/PE a GC would call. Never
            // the owner or the filing representative.
            applicantName: name || null,
            applicantLicense: str(r.applicant_license),
            applicantTitle: str(r.applicant_professional_title),
          };
        }),
      };
    }
    case 'rbx6-tga4': {
      const live = raw.filter((r) => (str(r.permit_status) ?? '') === 'Permit Issued' && (normDate(r.expired_date) ?? '') >= todayDay);
      return {
        ...base, activeCount: live.length, flags: [],
        rows: live.slice(0, ROWS_KEPT).map((r) => ({
          primary: str(r.work_permit) ?? '—', date: normDate(r.issued_date), status: str(r.permit_status),
          detail: joinDetail(str(r.work_type), normDate(r.expired_date) ? `expires ${normDate(r.expired_date)}` : null), amount: null,
          jobFilingNumber: str(r.job_filing_number),
        })),
      };
    }
    case 'ipu4-2q9a': {
      const unexpired = raw.filter((r) => (normDate(r.expiration_date) ?? '') >= todayDay);
      return {
        ...base, activeCount: unexpired.length, flags: [],
        rows: raw.slice(0, ROWS_KEPT).map((r) => ({
          primary: str(r.job__) ?? '—', date: normDate(r.issuance_date), status: str(r.permit_status),
          detail: joinDetail(str(r.permit_type), str(r.work_type), str(r.filing_status), normDate(r.expiration_date) ? `expires ${normDate(r.expiration_date)}` : null),
          amount: null,
        })),
      };
    }
    case '64uk-42ks':
      // PLUTO is the parcel; see normalizeParcel.
      return failedDataset(id, 'failed');
  }
}

export function failedParcel(status: 'failed' | 'timeout'): BuildingParcel {
  return { status, asOf: null, zoning: [], overlays: [], specialDistricts: [], landmark: null, historicDistrict: null, floodZone2015: null, eDesignation: null, yearBuilt: null, numFloors: null, bldgClass: null, plutoVersion: null };
}

export function normalizeParcel(rawRows: unknown, asOfHeader: string | null): BuildingParcel {
  if (!Array.isArray(rawRows)) return failedParcel('failed');
  const r = (rawRows.find((x) => !!x && typeof x === 'object') ?? null) as Raw | null;
  const asOf = asOfFromHeader(asOfHeader);
  // An empty answer is a lot PLUTO does not have (or a wrong BBL): never 'ok'.
  if (!r) return { ...failedParcel('failed'), asOf, notFound: true };
  const list = (...keys: string[]) => keys.map((k) => str(r[k])).filter((s): s is string => !!s);
  const year = num(r.yearbuilt);
  const floors = num(r.numfloors);
  const flood = num(r.pfirm15_flag);
  return {
    status: 'ok', asOf,
    zoning: list('zonedist1', 'zonedist2', 'zonedist3', 'zonedist4'),
    overlays: list('overlay1', 'overlay2'),
    specialDistricts: list('spdist1', 'spdist2', 'spdist3'),
    landmark: str(r.landmark),
    historicDistrict: str(r.histdist),
    // PLUTO sets pfirm15_flag = 1 for lots in the 2015 preliminary FIRM and
    // leaves it empty otherwise.
    floodZone2015: flood === 1,
    eDesignation: str(r.edesignum),
    yearBuilt: year && year > 0 ? year : null,
    numFloors: floors && floors > 0 ? floors : null,
    bldgClass: str(r.bldgclass),
    plutoVersion: str(r.version),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Record assembly
// ─────────────────────────────────────────────────────────────────────

/** BBL = 1 digit borough + 5 digit block + 4 digit lot. */
export function linksFor(bblIn: string): { bis: string; zola: string; dobNowPortal: string } {
  const bbl = sanitizeBbl(bblIn) ?? '0000000000';
  const b = bbl.slice(0, 1);
  const block = bbl.slice(1, 6);
  const lot = bbl.slice(6, 10);
  return {
    bis: `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${b}&block=${block}&lot=${lot}`,
    zola: `https://zola.planning.nyc.gov/l/lot/${b}/${Number(block)}/${Number(lot)}`,
    dobNowPortal: DOB_NOW_PORTAL,
  };
}

const BORO_BY_DIGIT: Record<string, string> = { '1': 'Manhattan', '2': 'Bronx', '3': 'Brooklyn', '4': 'Queens', '5': 'Staten Island' };

/** ECB balance = sum of balance_due over the ACTIVE rows the function read.
 *  Needs the RAW rows (the normalized dataset keeps only the top 5). */
export function ecbBalanceFromRaw(rawRows: unknown): number | null {
  if (!Array.isArray(rawRows)) return null;
  let sum = 0;
  for (const r of rawRows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Raw;
    if ((str(row.ecb_violation_status) ?? '').toUpperCase() !== 'ACTIVE') continue;
    sum += num(row.balance_due) ?? 0;
  }
  return Math.round(sum * 100) / 100;
}

export function assembleRecord(input: {
  bin: string; bbl: string; label?: string | null; fetchedAt: Date;
  datasets: BuildingRecordDataset[]; parcel: BuildingParcel; ecbRaw: unknown;
}): BuildingRecord {
  const byId = new Map(input.datasets.map((d) => [d.id, d]));
  const datasets = RECORD_DATASET_IDS.map((id) => byId.get(id) ?? failedDataset(id, 'failed'));
  const ecb = byId.get('6bgk-3dad');
  const ecbOk = !!ecb && ecb.status === 'ok';
  return {
    jurisdiction: 'nyc',
    bin: input.bin,
    bbl: input.bbl,
    label: input.label ?? `BIN ${input.bin}`,
    borough: BORO_BY_DIGIT[input.bbl.slice(0, 1)] ?? '',
    fetchedAt: input.fetchedAt.toISOString(),
    parcel: input.parcel,
    datasets,
    ecbBalanceDue: ecbOk ? ecbBalanceFromRaw(input.ecbRaw) : null,
    ecbBalanceIsPartial: ecbOk ? ecb!.truncated : false,
    links: linksFor(input.bbl),
    notChecked: [...NOT_CHECKED],
  };
}

// ─────────────────────────────────────────────────────────────────────
// GeoSearch → candidates
// ─────────────────────────────────────────────────────────────────────

const PLACEHOLDER_BIN = /^[1-5]0{6}$/;

export function candidatesFromGeosearch(json: unknown): { candidates: BuildingCandidate[]; droppedPlaceholders: number } {
  const features = (json && typeof json === 'object' && Array.isArray((json as Raw).features)) ? (json as { features: unknown[] }).features : [];
  const seen = new Set<string>();
  const candidates: BuildingCandidate[] = [];
  let droppedPlaceholders = 0;
  for (const f of features) {
    const p = (f && typeof f === 'object' ? (f as Raw).properties : null) as Raw | null;
    if (!p || typeof p !== 'object') continue;
    const pad = ((p.addendum as Raw | undefined)?.pad ?? null) as Raw | null;
    const bin = sanitizeBin(str(pad?.bin) ?? '');
    const bbl = sanitizeBbl(str(pad?.bbl) ?? '');
    if (!bin || !bbl) continue;
    if (PLACEHOLDER_BIN.test(bin)) { droppedPlaceholders++; continue; }
    if (seen.has(bin)) continue;
    seen.add(bin);
    candidates.push({ bin, bbl, label: str(p.label) ?? `BIN ${bin}`, borough: str(p.borough) ?? '', padVersion: str(pad?.version) });
  }
  return { candidates, droppedPlaceholders };
}

// ─────────────────────────────────────────────────────────────────────
// Permit lookup
// ─────────────────────────────────────────────────────────────────────

export function permitMatches(id: DatasetId, rawRows: unknown, asOfHeader: string | null): DobPermitMatch[] {
  if (!Array.isArray(rawRows)) return [];
  const d = DATASETS[id];
  const asOf = asOfFromHeader(asOfHeader);
  const out: DobPermitMatch[] = [];
  for (const x of rawRows) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Raw;
    if (id === 'w9ak-ipjd') {
      out.push({ datasetId: id, datasetName: d.name, asOf, number: str(r.job_filing_number) ?? '—', statusText: str(r.filing_status) ?? '', date: normDate(r.filing_date) });
    } else if (id === 'rbx6-tga4') {
      out.push({ datasetId: id, datasetName: d.name, asOf, number: str(r.work_permit) ?? str(r.job_filing_number) ?? '—', statusText: str(r.permit_status) ?? '', date: normDate(r.issued_date) });
    } else if (id === 'ipu4-2q9a') {
      out.push({ datasetId: id, datasetName: d.name, asOf, number: str(r.job__) ?? '—', statusText: joinDetail(str(r.permit_status), str(r.filing_status)) ?? '', date: normDate(r.issuance_date) });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Review-time benchmark
// ─────────────────────────────────────────────────────────────────────

/** Nearest-rank percentiles. Negative day counts and anything over 1000 days
 *  are dropped as data errors. */
export function reviewStats(days: number[]): { n: number; median: number | null; p75: number | null; p90: number | null } {
  const xs = days.filter((d) => Number.isFinite(d) && d >= 0 && d <= 1000).sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return { n: 0, median: null, p75: null, p90: null };
  const rank = (p: number) => xs[Math.max(0, Math.ceil((p / 100) * n) - 1)];
  return { n, median: rank(50), p75: rank(75), p90: rank(90) };
}

export function benchmarkFrom(rawRows: unknown, boroughIn: string, today: Date, asOfHeader: string | null): ReviewBenchmark {
  const borough = sanitizeBorough(boroughIn) ?? '';
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const byType = new Map<string, number[]>();
  for (const x of rows) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Raw;
    const f = normDate(r.filing_date);
    const a = normDate(r.approved_date);
    if (!f || !a) continue;
    const days = Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86400000);
    const type = str(r.filing_review_type) ?? 'Unspecified';
    const list = byType.get(type) ?? [];
    list.push(days);
    byType.set(type, list);
  }
  const groups: ReviewBenchmarkGroup[] = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reviewType, days]) => {
      const s = reviewStats(days);
      return { reviewType, n: s.n, medianDays: s.median, p75Days: s.p75, p90Days: s.p90 };
    });
  const start = new Date(today.getTime() - BENCHMARK_WINDOW_DAYS * 86400000);
  return {
    borough, jobType: 'Alteration', windowDays: BENCHMARK_WINDOW_DAYS,
    windowStart: isoDay(start), windowEnd: isoDay(today), asOf: asOfFromHeader(asOfHeader),
    datasetId: 'w9ak-ipjd', groups, truncated: rows.length >= BENCHMARK_LIMIT, note: BENCHMARK_NOTE,
  };
}
