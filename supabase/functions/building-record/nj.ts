// building-record/nj.ts — the PURE New Jersey half of the building-record
// function (modes nj_resolve / nj_record). No Deno globals, no imports: bun
// imports it directly (scripts/validate-building-record.ts,
// scripts/probe-building-record.ts), so every rule that decides what a
// contractor is told about a New Jersey lot is tested offline.
//
// HONESTY RULES this file exists to hold:
//   - A lookup that failed or timed out is kept as 'failed'/'timeout' with
//     rowCount null — it reads "not checked", never 0 and never "none".
//   - A full page (returned === limit) is `truncated`; the client prints
//     "at least N".
//   - Nothing here ever calls a lot clean, clear or compliant: the state data
//     lists permits and certificates only, and New Jersey publishes no
//     violations statewide.
//   - The tax lot is never picked for the contractor: nj_resolve returns
//     candidates only, even when exactly one matches the street address.
//   - The owner's name and mailing address are NEVER selected. The parcel layer
//     carries OWNER_NAME, ST_ADDRESS, CITY_STATE, ZIP_CODE (the MOD-IV owner
//     mailing fields); outFields lists eight lot columns by name, never '*'.
//     The permit dataset has no name column; its $select is still explicit.
//
// Sources, each fetched live on 2026-09-26 (see scripts/probe-building-record.ts):
//   - Parcel layer fields: GET https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/
//     arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0?f=json
//     (checkedOn 2026-09-26: layer "Cad_parcel_mod4", maxRecordCount 2000;
//     fields include PAMS_PIN, PCL_MUN, PCLBLOCK, PCLLOT, PCLQCODE, COUNTY,
//     MUN_NAME, PROP_LOC — and OWNER_NAME, ST_ADDRESS, CITY_STATE, ZIP_CODE,
//     which are never requested).
//   - Census geocoder: GET https://geocoding.geo.census.gov/geocoder/locations/
//     onelineaddress?address=94 Washington St, Hoboken, NJ 07030&benchmark=
//     Public_AR_Current&format=json (checkedOn 2026-09-26): matchedAddress
//     "94 WASHINGTON ST, HOBOKEN, NJ, 07030" at (-74.031127, 40.736931), a
//     point on the street centreline — a plain intersects query there returns
//     no lot; with distance=30 m it returns 7 lots, 0905_199_1
//     ('94 WASHINGTON ST') among them. The attribute query PCL_MUN IN ('0905')
//     AND PROP_LOC LIKE '94 WASHINGTON%' returns exactly that lot.
//   - Permits: GET https://data.nj.gov/api/views/w9se-dmra.json (checkedOn
//     2026-09-26): "NJ Construction Permit Data"; "Data is collected from
//     most, but not all municipalities"; purged "after 60 months"; raw and
//     unaudited; no violations and no name column. comu is 4-digit text,
//     block/lot are text whose formats drift ('199', '0199', '00910',
//     '0001001'); constcost is a number (a JSON string on the wire); 20 rows
//     statewide carry a permitdate after 2026-09-26 (e.g. 2033-06-15).
//     Hoboken (0905) block 199 lot 1 → 14 rows, x-soda2-truth-last-modified
//     "Thu, 13 Aug 2026 18:00:26 GMT", max(processdate) 2026-08-07.

// ─────────────────────────────────────────────────────────────────────
// Wire types — mirrored byte-compatibly in utils/buildingRecord.ts.
// validate-building-record.ts proves the round trip.
// ─────────────────────────────────────────────────────────────────────

export type DatasetStatus = 'ok' | 'failed' | 'timeout';
export interface NjParcelCandidate { muniCode: string; muniName: string | null; county: string | null; block: string; lot: string; qualifier: string | null; pin: string | null; propLoc: string | null; match: 'address' | 'nearby' | 'approximate'; }
export interface NjPermitRow { primary: string; date: string | null; status: string | null; detail: string | null; amountCents: number | null; }
export interface NjPermitDataset { id: 'w9se-dmra'; name: 'NJ Construction Permit Data (DCA)'; url: string; asOf: string | null; status: DatasetStatus; rowCount: number | null; returned: number | null; limit: number; truncated: boolean; rows: NjPermitRow[]; }
export interface NjBuildingRecord { jurisdiction: 'nj'; muniCode: string; muniName: string | null; block: string; lot: string; label: string; fetchedAt: string; permits: NjPermitDataset; muniLastReport: { status: DatasetStatus; date: string | null }; notChecked: string[]; caveat: string; links: { dataset: string }; }
export type NjBuildingRecordRequest = { mode: 'nj_resolve'; text: string; lat: number | null; lon: number | null } | { mode: 'nj_record'; muniCode: string; block: string; lot: string };
export type NjBuildingRecordResponse = { status: 'nj_candidates'; candidates: NjParcelCandidate[] } | { status: 'nj_record'; record: NjBuildingRecord } | { status: 'error'; code: string; error: string };

// ─────────────────────────────────────────────────────────────────────
// Fixed texts (the client copies are asserted equal by the validator)
// ─────────────────────────────────────────────────────────────────────

/** The NJ-only error text. bad_request / rate_limited / internal reuse the
 *  generic ERRORS in normalize.ts (they never name a source). */
export const NJ_ERRORS = {
  upstream: "The New Jersey lookup didn't answer — nothing was checked.",
} as const;

export const NJ_NOT_CHECKED: readonly string[] = ['Violations (New Jersey publishes none statewide)', 'Local zoning', 'Fire inspections', 'Permits the town has not reported to the state'];
export const NJ_PERMIT_CAVEAT = "This is the state's raw, unaudited permit data. It keeps about the last 60 months, and some towns don't report to it. It lists permits and certificates only.";

export const NJ_PERMITS_ID = 'w9se-dmra' as const;
export const NJ_PERMITS_NAME = 'NJ Construction Permit Data (DCA)' as const;
export const NJ_PERMIT_LIMIT = 1000;
/** Newest rows kept on the record (the count covers every matched row). */
export const NJ_ROWS_KEPT = 5;
export const NJ_CANDIDATE_CAP = 6;
export const NJ_BUFFER_METERS = 30;

// The three upstream hosts. Nothing else is ever fetched, and no user-supplied
// URL is ever fetched.
const CENSUS_LOCATIONS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const NJ_PARCELS = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query';
const NJ_SODA = 'https://data.nj.gov/resource/';
/** A link only (never fetched). */
export const NJ_DATASET_PAGE = 'https://data.nj.gov/d/w9se-dmra';

/** The ONLY parcel columns ever requested. Never '*'; never an owner column. */
export const NJ_PARCEL_OUT_FIELDS = 'PAMS_PIN,PCL_MUN,PCLBLOCK,PCLLOT,PCLQCODE,MUN_NAME,COUNTY,PROP_LOC';
/** The permit columns requested (the dataset has no name column). */
export const NJ_PERMIT_SELECT = 'comu,muniname,county,block,lot,permitno,status,permitstatusdesc,permitdate,certdate,permittype,permittypedesc,certtype,certtypedesc,constcost,squarefeet,usegroup,usegroupdesc,processdate,recordid,pk';

// ─────────────────────────────────────────────────────────────────────
// Sanitizers — every value that reaches a URL goes through one of these.
// ─────────────────────────────────────────────────────────────────────

export function sanitizeMuniCode(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? v.trim() : null;
}
/** Block / lot: SoQL + ArcGIS injection guard (no quote, space, %, _ or ;). */
export function sanitizeBlockLot(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9A-Za-z.\-]{1,16}$/.test(v.trim()) ? v.trim() : null;
}
/** A coordinate inside a loose New Jersey box, else null. */
export function sanitizeLat(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 38.8 && v <= 41.4 ? v : null;
}
export function sanitizeLon(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= -75.6 && v <= -73.8 ? v : null;
}
function sanitizeText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 200) return null;
  return s;
}

/** Parse an NJ request body. null → not an NJ request (or not a valid one). */
export function parseNjRequest(body: unknown): NjBuildingRecordRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.mode === 'nj_resolve') {
    const text = sanitizeText(b.text);
    if (!text) return null;
    const lat = sanitizeLat(b.lat);
    const lon = sanitizeLon(b.lon);
    return { mode: 'nj_resolve', text, lat: lat !== null && lon !== null ? lat : null, lon: lat !== null && lon !== null ? lon : null };
  }
  if (b.mode === 'nj_record') {
    const muniCode = sanitizeMuniCode(b.muniCode);
    const block = sanitizeBlockLot(b.block);
    const lot = sanitizeBlockLot(b.lot);
    return muniCode && block && lot ? { mode: 'nj_record', muniCode, block, lot } : null;
  }
  return null;
}

/**
 * One spelling for a block or lot: trimmed, uppercase, leading zeros of the
 * integer part dropped, trailing zeros of a decimal part dropped, a bare
 * trailing '.' dropped. '0199.0' → '199', '211.010' → '211.01', '000' → '0'.
 * Used on BOTH sides of every comparison.
 */
export function normalizeBlockLot(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  let s = String(v).trim().toUpperCase();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (m) {
    const int = m[1].replace(/^0+(?=\d)/, '');
    const dec = (m[2] ?? '').replace(/0+$/, '');
    s = dec ? `${int}.${dec}` : int;
  }
  return s;
}

/** The integer part used as a SoQL prefix ('211.01' → '211', 'A12' → 'A12'). */
function prefixPart(v: string): string {
  const n = normalizeBlockLot(v);
  const m = /^(\d+)/.exec(n);
  return m ? m[1] : n;
}

// ─────────────────────────────────────────────────────────────────────
// Address key (from the Census matchedAddress)
// ─────────────────────────────────────────────────────────────────────

export interface NjAddressKey { num: string; street: string[]; }

const STREET_TYPES = new Set([
  'ST', 'STREET', 'AVE', 'AV', 'AVENUE', 'RD', 'ROAD', 'BLVD', 'BOULEVARD', 'DR', 'DRIVE', 'LN', 'LANE',
  'PL', 'PLACE', 'CT', 'COURT', 'TER', 'TERR', 'TERRACE', 'PKWY', 'PARKWAY', 'HWY', 'HIGHWAY', 'WAY',
  'CIR', 'CIRCLE', 'SQ', 'SQUARE', 'PLZ', 'PLAZA', 'TPKE', 'TURNPIKE', 'ALY', 'ALLEY', 'ROW',
]);
/** Words that never reach a LIKE literal, even quoted. */
const SQL_WORDS = new Set([
  'AND', 'OR', 'NOT', 'NULL', 'LIKE', 'SELECT', 'UNION', 'DROP', 'DELETE', 'INSERT', 'UPDATE',
  'WHERE', 'FROM', 'EXEC', 'EXECUTE',
]);
const TOKEN = /^[0-9A-Z]{1,20}$/;
const okToken = (t: string) => TOKEN.test(t) && !SQL_WORDS.has(t);

/**
 * "94 WASHINGTON ST, HOBOKEN, NJ, 07030" → { num: '94', street: ['WASHINGTON'] }.
 * Only the part before the first comma is read; street-type words are
 * dropped; any token that is not /^[0-9A-Z]{1,20}$/ (or is an SQL word) is
 * dropped. null when there is no house number or no street token left.
 */
export function addressKey(matchedAddress: unknown): NjAddressKey | null {
  if (typeof matchedAddress !== 'string') return null;
  const first = matchedAddress.split(',')[0]?.trim().toUpperCase() ?? '';
  const parts = first.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const num = parts[0];
  if (!/^\d[0-9A-Z]{0,19}$/.test(num)) return null;
  const street = parts.slice(1).filter((t) => okToken(t) && !STREET_TYPES.has(t));
  return street.length ? { num, street } : null;
}

// ─────────────────────────────────────────────────────────────────────
// Query builders. Values are sanitized first; the whole where-clause goes
// through encodeURIComponent. Every URL starts with one of the three hosts.
// ─────────────────────────────────────────────────────────────────────

export function censusLocationsUrl(textIn: string): string | null {
  const text = sanitizeText(textIn);
  if (!text) return null;
  return `${CENSUS_LOCATIONS}?address=${encodeURIComponent(text)}&benchmark=Public_AR_Current&format=json`;
}

/** Lots within NJ_BUFFER_METERS of a point (the Census point sits on the
 *  street centreline, so a plain intersects query finds nothing). */
export function njParcelBufferUrl(lat: number, lon: number): string | null {
  const la = sanitizeLat(lat);
  const lo = sanitizeLon(lon);
  if (la === null || lo === null) return null;
  return `${NJ_PARCELS}?geometry=${lo},${la}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects`
    + `&distance=${NJ_BUFFER_METERS}&units=esriSRUnit_Meter&outFields=${NJ_PARCEL_OUT_FIELDS}&returnGeometry=false&resultRecordCount=20&f=json`;
}

/** Lots whose PROP_LOC starts with '<num> <STREET>' in the given towns. Built
 *  ONLY from sanitized tokens: any token or code that fails → null. */
export function njParcelAddressUrl(muniCodes: readonly string[], key: NjAddressKey | null): string | null {
  if (!key || !Array.isArray(muniCodes) || !muniCodes.length) return null;
  const codes = [...new Set(muniCodes)];
  if (codes.length > 10 || !codes.every((c) => sanitizeMuniCode(c) === c)) return null;
  if (!/^\d[0-9A-Z]{0,19}$/.test(key.num) || !okToken(key.num)) return null;
  if (!key.street.length || !key.street.every(okToken)) return null;
  const where = `PCL_MUN IN (${codes.map((c) => `'${c}'`).join(',')}) AND PROP_LOC LIKE '${key.num} ${key.street.join(' ')}%'`;
  return `${NJ_PARCELS}?where=${encodeURIComponent(where)}&outFields=${NJ_PARCEL_OUT_FIELDS}&returnGeometry=false&resultRecordCount=20&f=json`;
}

function soqlUrl(params: { select: string; where: string; order?: string; limit: number }): string {
  const parts = [`$select=${encodeURIComponent(params.select)}`, `$where=${encodeURIComponent(params.where)}`];
  if (params.order) parts.push(`$order=${encodeURIComponent(params.order)}`);
  parts.push(`$limit=${params.limit}`);
  return `${NJ_SODA}${NJ_PERMITS_ID}.json?${parts.join('&')}`;
}

/** YYYY-MM-DD for `today` (UTC). */
export function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * The permit rows for one lot. block/lot are matched on their integer-part
 * PREFIX on the server (with or without zero padding: '199%' OR '0%199%'),
 * then exactly — after normalizeBlockLot on both sides — in
 * normalizeNjPermits. Future-dated junk rows are excluded here and again on
 * the client.
 */
export function njPermitsUrl(muniIn: string, blockIn: string, lotIn: string, today: Date): string | null {
  const muni = sanitizeMuniCode(muniIn);
  const block = sanitizeBlockLot(blockIn);
  const lot = sanitizeBlockLot(lotIn);
  if (!muni || !block || !lot) return null;
  const b = prefixPart(block);
  const l = prefixPart(lot);
  if (!sanitizeBlockLot(b) || !sanitizeBlockLot(l)) return null;
  const day = isoDay(today);
  return soqlUrl({
    select: NJ_PERMIT_SELECT,
    where: `comu='${muni}' AND (block like '${b}%' OR block like '0%${b}%') AND (lot like '${l}%' OR lot like '0%${l}%') AND (permitdate <= '${day}' OR permitdate IS NULL)`,
    order: 'permitdate DESC',
    limit: NJ_PERMIT_LIMIT,
  });
}

/** The town's newest processdate (how fresh its reports are) and its name. */
export function njMuniFreshnessUrl(muniIn: string): string | null {
  const muni = sanitizeMuniCode(muniIn);
  if (!muni) return null;
  return `${NJ_SODA}${NJ_PERMITS_ID}.json?$select=${encodeURIComponent('max(processdate) as last, max(muniname) as muni')}&$where=${encodeURIComponent(`comu='${muni}'`)}`;
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
function dayOf(v: unknown): string | null {
  const s = str(v);
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** X-SODA2-Truth-Last-Modified → ISO, else null. */
export function asOfFromHeader(h: string | null | undefined): string | null {
  if (!h) return null;
  const t = Date.parse(h);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/** 'HOBOKEN CITY' → 'Hoboken City'. */
export function titleCase(v: string | null): string | null {
  if (!v) return null;
  return v.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
/** constcost (dollars, a string on the wire) → integer cents, else null. */
export function dollarsToCents(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

// ─────────────────────────────────────────────────────────────────────
// Candidates
// ─────────────────────────────────────────────────────────────────────

function featureList(body: unknown): Raw[] {
  if (Array.isArray(body)) return body as Raw[];
  if (body && typeof body === 'object' && Array.isArray((body as Raw).features)) return (body as Raw).features as Raw[];
  return [];
}

/** Does PROP_LOC name this house number on every street token? */
export function propLocMatches(propLoc: string | null, key: NjAddressKey | null): boolean {
  if (!propLoc || !key) return false;
  const toks = propLoc.toUpperCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  const head = toks[0];
  let numOk = head === key.num;
  const range = /^(\d+)-(\d+)$/.exec(head);
  if (!numOk && range && /^\d+$/.test(key.num)) {
    const n = Number(key.num), lo = Number(range[1]), hi = Number(range[2]);
    numOk = n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
  }
  return numOk && key.street.every((t) => toks.includes(t));
}

/**
 * ArcGIS features → candidates, deduped by PAMS_PIN (else muni/block/lot/qual).
 * A lot whose PROP_LOC carries the house number and every street token is
 * 'address' and ranks first; every other lot is `match` ('nearby' from the
 * address point, 'approximate' from the project's map pin). Capped at
 * NJ_CANDIDATE_CAP. Malformed → []. Nothing is ever picked.
 */
export function rankNjCandidates(body: unknown, key: NjAddressKey | null, match: 'nearby' | 'approximate'): NjParcelCandidate[] {
  const seen = new Set<string>();
  const out: NjParcelCandidate[] = [];
  for (const f of featureList(body)) {
    const a = f && typeof f === 'object' ? (f as Raw).attributes : null;
    if (!a || typeof a !== 'object') continue;
    const r = a as Raw;
    const muniCode = sanitizeMuniCode(str(r.PCL_MUN));
    const block = sanitizeBlockLot(str(r.PCLBLOCK));
    const lot = sanitizeBlockLot(str(r.PCLLOT));
    if (!muniCode || !block || !lot) continue;
    const qualifier = str(r.PCLQCODE);
    const pin = str(r.PAMS_PIN);
    const k = pin ?? `${muniCode}_${block}_${lot}_${qualifier ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const propLoc = str(r.PROP_LOC);
    out.push({
      muniCode, muniName: str(r.MUN_NAME), county: str(r.COUNTY), block, lot, qualifier, pin, propLoc,
      match: propLocMatches(propLoc, key) ? 'address' : match,
    });
  }
  const ranked = [...out.filter((c) => c.match === 'address'), ...out.filter((c) => c.match !== 'address')];
  return ranked.slice(0, NJ_CANDIDATE_CAP);
}

/** The attribute-query hits first (as 'address'), then the rest; deduped, capped. */
export function mergeNjCandidates(addressHits: NjParcelCandidate[], rest: NjParcelCandidate[]): NjParcelCandidate[] {
  const seen = new Set<string>();
  const out: NjParcelCandidate[] = [];
  const key = (c: NjParcelCandidate) => c.pin ?? `${c.muniCode}_${c.block}_${c.lot}_${c.qualifier ?? ''}`;
  for (const c of [...addressHits.map((h) => ({ ...h, match: 'address' as const })), ...rest]) {
    if (seen.has(key(c))) continue;
    seen.add(key(c));
    out.push(c);
  }
  return [...out.filter((c) => c.match === 'address'), ...out.filter((c) => c.match !== 'address')].slice(0, NJ_CANDIDATE_CAP);
}

/** The Census locations body → the first match's { matchedAddress, lat, lon }. */
export function censusFirstMatch(body: unknown): { matchedAddress: string; lat: number; lon: number } | null {
  const result = body && typeof body === 'object' ? (body as Raw).result : null;
  const matches = result && typeof result === 'object' ? (result as Raw).addressMatches : null;
  if (!Array.isArray(matches) || !matches.length) return null;
  const m = matches[0] as Raw;
  const c = m && typeof m.coordinates === 'object' && m.coordinates ? m.coordinates as Raw : null;
  const lat = sanitizeLat(c?.y);
  const lon = sanitizeLon(c?.x);
  const matchedAddress = str(m?.matchedAddress);
  if (lat === null || lon === null || !matchedAddress) return null;
  return { matchedAddress, lat, lon };
}

// ─────────────────────────────────────────────────────────────────────
// Permits
// ─────────────────────────────────────────────────────────────────────

export function failedNjPermits(kind: 'failed' | 'timeout'): NjPermitDataset {
  return { id: NJ_PERMITS_ID, name: NJ_PERMITS_NAME, url: NJ_DATASET_PAGE, asOf: null, status: kind, rowCount: null, returned: null, limit: NJ_PERMIT_LIMIT, truncated: false, rows: [] };
}

/**
 * The page of permit rows → the dataset for one lot. Rows are kept only when
 * normalizeBlockLot(block) and normalizeBlockLot(lot) equal the target's, and
 * dropped when their permitdate or certdate is after today (junk dates such as
 * 2033 and 2925 exist). A non-array body is 'failed'.
 */
export function normalizeNjPermits(rows: unknown, block: string, lot: string, asOfHeader: string | null, today: Date): { dataset: NjPermitDataset; muniName: string | null } {
  if (!Array.isArray(rows)) return { dataset: failedNjPermits('failed'), muniName: null };
  const tb = normalizeBlockLot(block);
  const tl = normalizeBlockLot(lot);
  const day = isoDay(today);
  let muniName: string | null = null;
  const matched: { row: NjPermitRow; sort: string }[] = [];
  for (const x of rows) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Raw;
    if (normalizeBlockLot(str(r.block) ?? '') !== tb || normalizeBlockLot(str(r.lot) ?? '') !== tl) continue;
    const pd = dayOf(r.permitdate);
    const cd = dayOf(r.certdate);
    if ((pd && pd > day) || (cd && cd > day)) continue;
    muniName = muniName ?? str(r.muniname);
    const statusDesc = str(r.permitstatusdesc);
    const cert = str(r.certtypedesc);
    const status = statusDesc ? statusDesc + (cert ? ` — ${cert}` : '') : cert;
    const type = str(r.permittypedesc);
    const use = str(r.usegroup);
    const detail = type ? type + (use ? `, use group ${use}` : '') : use ? `use group ${use}` : null;
    const date = pd ?? cd;
    matched.push({
      row: { primary: str(r.permitno) ?? 'permit number not published', date, status, detail, amountCents: dollarsToCents(r.constcost) },
      sort: date ?? '',
    });
  }
  matched.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
  const dataset: NjPermitDataset = {
    id: NJ_PERMITS_ID,
    name: NJ_PERMITS_NAME,
    url: NJ_DATASET_PAGE,
    asOf: asOfFromHeader(asOfHeader),
    status: 'ok',
    rowCount: matched.length,
    returned: rows.length,
    limit: NJ_PERMIT_LIMIT,
    truncated: rows.length >= NJ_PERMIT_LIMIT,
    rows: matched.slice(0, NJ_ROWS_KEPT).map((m) => m.row),
  };
  return { dataset, muniName };
}

/** The freshness body → the town's newest processdate and its name. */
export function normalizeNjFreshness(rows: unknown): { status: DatasetStatus; date: string | null; muniName: string | null } {
  if (!Array.isArray(rows)) return { status: 'failed', date: null, muniName: null };
  const r = (rows[0] ?? {}) as Raw;
  return { status: 'ok', date: dayOf(r.last), muniName: str(r.muni) };
}

export function assembleNjRecord(args: {
  muniCode: string; block: string; lot: string; fetchedAt: Date; muniName: string | null;
  permits: NjPermitDataset; muniLastReport: { status: DatasetStatus; date: string | null };
}): NjBuildingRecord {
  const muniName = titleCase(args.muniName);
  const p = args.permits;
  const permits: NjPermitDataset = {
    id: p.id, name: p.name, url: p.url, asOf: p.asOf, status: p.status, rowCount: p.rowCount,
    returned: p.returned, limit: p.limit, truncated: p.truncated, rows: p.rows,
  };
  return {
    jurisdiction: 'nj',
    muniCode: args.muniCode,
    muniName,
    block: args.block,
    lot: args.lot,
    label: `Block ${args.block} Lot ${args.lot}, ${muniName ?? `municipality ${args.muniCode}`}`,
    fetchedAt: args.fetchedAt.toISOString(),
    permits,
    muniLastReport: { status: args.muniLastReport.status, date: args.muniLastReport.date },
    notChecked: [...NJ_NOT_CHECKED],
    caveat: NJ_PERMIT_CAVEAT,
    links: { dataset: NJ_DATASET_PAGE },
  };
}
