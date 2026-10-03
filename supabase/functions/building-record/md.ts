// building-record/md.ts — the PURE Baltimore (Maryland) half of the
// building-record function (modes md_resolve / md_record). No Deno globals, no
// imports: bun imports it directly (scripts/validate-building-record.ts,
// scripts/probe-building-record.ts), so every rule that decides what a
// contractor is told about a Baltimore parcel is tested offline. index.ts only
// runs the fetches this file plans.
//
// HONESTY RULES this file exists to hold:
//   - Baltimore City and Baltimore County are separate governments. The side is
//     decided ONLY by which parcel layer contains the geocoded point, never by
//     the geocoder's city text or the postal city ("Baltimore, MD" is also a
//     County mailing name: 20,870 County address points carry
//     CITY_POSTAL='BALTIMORE', measured 2026-09-28).
//   - A read that failed or timed out is kept as 'failed'/'timeout' — it reads
//     "not checked", never 0 and never "none".
//   - Only OPEN notices are published by the City; closed history is not. The
//     County publishes no code-enforcement dataset at all.
//   - The parcel is never picked for the contractor: md_resolve returns
//     candidates only.
//   - md_outside means BOTH parcel layers were read and neither contains the
//     point, OR (neither Baltimore geocoder placed the address) the Census
//     match names a county other than 24510/24005 or lies outside the box that
//     holds both, so no parcel layer could contain it (mdCensusFallback).
//     A resolve where nothing answered is an error, never "outside".
//   - PRIVACY: every ArcGIS query passes an explicit outFields list equal to
//     the layer's SAFE list below (validated as a set). Owner names, mailing
//     addresses, sale and deed fields, staff contacts and scanned documents
//     are never requested. The County tax account number (TAX_ASSMT_NUMBER on
//     the permits layer) is used only inside a WHERE clause.
//
// ─────────────────────────────────────────────────────────────────────
// LIVE EVIDENCE — every endpoint below was fetched on 2026-09-28 (checkedOn).
// (as-of = what MAGE shows; "none published" = the layer JSON carries no
// editingInfo, so the card says the as-of date is not published)
//
// Baltimore City (Open Baltimore = ArcGIS Hub, no Last-Modified header):
//   C1 geocoder  https://baltegis.baltimorecity.gov/mapping/rest/services/Locator/EGISCompositeLocator/GeocodeServer
//      score 0-100; "620 E 31st St, MD 21218" -> PointAddress 98.8 (-76.608072, 39.325941),
//      StreetAddress 100 (street centreline, in no parcel), Parcel 99.8 ("4074C009, 620 E 31ST ST").
//      "400 Washington Ave" (no ZIP) -> "400 S WASHINGTON ST" PointAddress 90.3 and
//      "400 WASHINGTON BLVD" StreetAddressExt 94.8: why candidates are ZIP-, number- and type-filtered
//      and always confirmed. Subregion is 'Baltimore City' on StreetAddress hits only (not used).
//   C3 Real Property  item 64110b108565433d8da40dd0e422064e  CityView/RealProperty_OB/FeatureServer/0
//      238,134 rows, maxRecordCount 2000, "Data is updated on a weekly basis" (item text), CC BY 3.0;
//      no editingInfo; LDATE (MMDDYYYY) = '09272026' on every row -> as-of 2026-09-27.
//      620 E 31st St -> BLOCKLOT '4074C009', YEAR_BUILD 1920, ZONECODE 'R-6  ' (padded);
//      3005 Woodland Ave -> YEAR_BUILD 0, STRUCTAREA 0 (unknown, never "year 0").
//   C4 Permits 2019-present  item 189e6d1c65df4e13b38c0027cee574f6  Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3
//      293,368 rows; IssuedDate 2019-01-01 .. 2026-09-25 (max via outStatistics); no published cadence;
//      item text: from 2025-02-03 (E-Permits) amendments/extensions are no longer captured. NO status field.
//      BLOCK-LOT TRAP: 620 E 31st St is stored as BOTH '4074C009' and '4074C 009' (9 rows via an IN list
//      of both spellings); plain blocks: '3950 022' -> 2 rows, '1820 022' -> 1 row.
//   C6 Vacant Building Notices (open)  item 691d65a5f85640e6aaa46930bd9dc102  .../FeatureServer/1
//      11,444 rows, "Data is updated on a daily basis"; DateNotice 2004-11-05 .. 2026-09-27;
//      DateCancel / DateAbate null on every row; NT = 'Vacant' only.
//   (C7 Housing/NoticesInspections MapServer — NOT READ since 2026-10-03, see CONTENT RIGHTS below.)
//   C8 Zoning  item dc7bf04cec4e41ef85cc6b391652e1e7  CityView/Zoning_New/FeatureServer/0  2,469 rows; none published.
//      620 E 31st St -> R-6; 1600 Thames St -> C-1-E (URL = the district regulation PDF).
//   C9 CHAP districts  item 2aa812e5042e4fc8950ffff2a6ce9291  services1 .../CHAP_Historic_Districts/FeatureServer/0
//      40 polygons; editingInfo dataLastEditDate 2023-06-05. 620 E 31st -> Better Waverly (A29); 1600 Thames -> Fells Point (A31).
//   (C10 Planning/CHAPLandmarks_poly and C11 Planning/Boundaries/MapServer/11 — NOT READ since
//      2026-10-03, see CONTENT RIGHTS below.)
//   C12 Floodplain  item 517933b8965b47949f85a879cbdc954c  services1 .../FloodPlain_n/FeatureServer/0
//      554 polygons (A, AE, AO, VE, X2 only; no zone X polygons); editingInfo dataLastEditDate 2025-06-09;
//      1600 Thames St -> X2 '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', STATIC_BFE -9999, DFIRM_ID 240087.
//   Link: E-Permits https://aca-prod.accela.com/BALTIMORE/Default.aspx (200). The older search
//      https://cels.baltimorehousing.org/Search_TM_MAP.aspx now only redirects to E-Permits, so it is not linked.
//
// Baltimore County:
//   K1 geocoder  https://bcgisdata.baltimorecountymd.gov/arcgis/rest/services/Geocoders/CompositeGeocoder/GeocodeServer
//      "9616 Reisterstown Rd, MD" -> PointAddress 100 (-76.76314, 39.404161); with ", Baltimore, MD" the
//      same address scores 77.2 (postal-city mismatch), which is why the city is dropped from the query.
//   K3 Tax parcels  Property/Property/MapServer/1  374,912 rows, 24,230 of them TAXPIN 'NOT LOCATED'
//      (right-of-way polygons: a street-centreline point lands in one); none published.
//      9616 Reisterstown Rd -> TAXPIN 2200002965 (10 digits), YEAR_BUILT '0000'.
//   K4 Permits  item cfd6eb593b524875a80e3c45e4575fa9  DevelopmentManagement/ActiveDevelopment/MapServer/4
//      165,409 rows; newest ISSDATE 2026-09-27 (outStatistics returns the alias upper-cased: MX);
//      item modified daily; STATUS values ISSUE, OPEN, CLOSED, EXPIRED, BL-EXPIRED, CANCELLED (shown verbatim).
//      WHERE TAX_ASSMT_NUMBER='2200002965' -> 7 rows.
//   K5 Current Zoning  DevelopmentManagement/Zoning/MapServer/1  4,903 rows; 9616 Reisterstown -> 'BR IM'.
//   K6 Flood Hazard Zones  DevelopmentManagement/Floodplain/MapServer/13 (under the "DFIRM" group; FEMA
//      schema with DFIRM_ID 240010 and ZONE_SUBTY). Layer 20 of the same name sits under "DFIRM - Baltimore
//      County Regulatory" and lacks DFIRM_ID/ZONE_SUBTY; it is not read. Both return X at the test points.
//   K7 County historic districts  Historic/Historic/MapServer/5  17 polygons; none published.
//   County code-enforcement cases: Citizen Access only (no dataset):
//      https://citizenaccess.baltimorecountymd.gov/CitizenAccess/Cap/Caphome.aspx?&Module=Enforcement (200)
//      PLL portal https://cityworkspro.baltimorecountymd.gov/PLLPortal/ (200)
//
// Census (only when neither Baltimore geocoder places the address, to name the county for md_outside):
//   https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?...&layers=Counties
//   "1 Church Cir, Annapolis, MD 21401" -> Anne Arundel County (24003); "620 E 31st St, Baltimore, MD 21218"
//   -> "Baltimore city" (24510); "100 N Market St, Frederick, MD 21701" -> Frederick County (24021),
//   point (-77.4108, 39.4154), outside the Baltimore box, so md_outside comes from the Census alone
//   (mdCensusFallback). This host is the one addition to the three hosts the lane spec lists: the spec
//   allows naming the county from the Census, and isAllowedMdUrl still refuses every other host.
// ─────────────────────────────────────────────────────────────────────
//
// CONTENT RIGHTS (contentfix 2026-10-03; contentfix-specs/RIGHTS-VERDICT.md row
// "Baltimore City / County building records"). Baltimore City Code Art. 1
// §9-8(b) frees only datasets PUBLISHED on the Open Baltimore portal, and three
// layers MAGE used to read are not on it and carry no licence: the internal
// inspections-app housing notices feed (Housing/NoticesInspections, layers 1-4),
// CHAP landmarks (Planning/CHAPLandmarks_poly) and National Register districts
// (Planning/Boundaries/MapServer/11). None of them is fetched any more. The
// licensed portal layers (C3, C4, C6, C8, C9, C12) and the County layers stay.
//
// WIRE COMPATIBILITY. Every installed app parses a City record strictly
// (utils/buildingRecord.ts pMdRecord): exactly four housingNotices parts and
// non-null landmarks / nationalRegister parts, or the WHOLE record is refused.
// This function deploys before any app update reaches phones, so a City record
// still carries those parts, built by unreadPart() with status 'failed', no
// rows and a source that says MAGE no longer checks it. Every client renders a
// failed part as "Couldn't read <source> — not checked": never "none", never a
// count. The record's links add Baltimore Housing's CoDeMap
// (cels.baltimorehousing.org; a link only, nothing is fetched from it), so the
// contractor can still look notices up, and the notices source says so. Once every client accepts a City
// record without these parts, they can be dropped from the wire.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// Wire types — mirrored in utils/buildingRecord.ts; the validator proves the round trip.
// ─────────────────────────────────────────────────────────────────────

export type MdSide = 'baltimore_city' | 'baltimore_county';
export type MdPartStatus = 'ok' | 'failed' | 'timeout';
/** How asOf was obtained: newest date in the data, the layer's edit date,
 *  not published by the layer, or published but not read this time. */
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

// ─────────────────────────────────────────────────────────────────────
// Fixed texts (the client copies are asserted equal by the validator)
// ─────────────────────────────────────────────────────────────────────

export const MD_ERRORS = {
  upstream: "Couldn't finish the Baltimore lookup — nothing was checked.",
} as const;

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

export const MD_EPERMITS_URL = 'https://aca-prod.accela.com/BALTIMORE/Default.aspx';
export const MD_COUNTY_CITIZEN_ACCESS_URL = 'https://citizenaccess.baltimorecountymd.gov/CitizenAccess/Cap/Caphome.aspx?&Module=Enforcement';
export const MD_COUNTY_PLL_URL = 'https://cityworkspro.baltimorecountymd.gov/PLLPortal/';
/** Baltimore Housing's CoDeMap (cels.baltimorehousing.org). A link only: MAGE never fetches it. */
export const MD_CODEMAP_URL = 'https://cels.baltimorehousing.org/codemapv2ext/';
export const MD_LINKS_CITY: readonly MdLink[] = [
  { label: 'E-Permits search', url: MD_EPERMITS_URL },
  { label: 'Open notices map (CoDeMap)', url: MD_CODEMAP_URL },
];
export const MD_LINKS_COUNTY: readonly MdLink[] = [
  { label: 'Citizen Access (code enforcement)', url: MD_COUNTY_CITIZEN_ACCESS_URL },
  { label: 'County permit portal', url: MD_COUNTY_PLL_URL },
];

export const MD_CANDIDATE_CAP = 6;
export const MD_POINTS_PER_GEOCODER = 3;
export const MD_MIN_SCORE = 80;
export const MD_RESOLVE_CONCURRENCY = 3;
export const MD_RECORD_CONCURRENCY = 4;
export const MD_DEADLINE_MS = 12_000;
export const MD_PERMIT_ROWS = 50;
export const MD_NOTICE_ROWS = 50;
export const MD_OVERLAY_ROWS = 20;
/** Newest permit rows kept on the record (the total covers every matched row). */
export const MD_PERMITS_KEPT = 5;
export const MD_ASOF_TTL_MS = 6 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────
// Hosts and layers. Nothing else is ever fetched; no user-supplied URL is.
// ─────────────────────────────────────────────────────────────────────

export const MD_ALLOWED_PREFIXES: readonly string[] = [
  'https://baltegis.baltimorecity.gov/mapping/rest/services/',
  'https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/',
  'https://bcgisdata.baltimorecountymd.gov/arcgis/rest/services/',
  'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress',
];
const EGIS = 'https://baltegis.baltimorecity.gov/mapping/rest/services/';
const AGOL = 'https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/';
const BCGIS = 'https://bcgisdata.baltimorecountymd.gov/arcgis/rest/services/';
const CENSUS_GEOGRAPHIES = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress';

/** encodeURIComponent plus the characters it leaves alone ('()*!), so a
 *  built URL never carries a raw quote. */
export function encMd(v: string): string {
  return encodeURIComponent(v).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function isAllowedMdUrl(url: unknown): boolean {
  return typeof url === 'string' && MD_ALLOWED_PREFIXES.some((p) => url.startsWith(p)) && !/[\s"'<>\\]/.test(url);
}

export type MdLayerId = 'C3' | 'C4' | 'C6' | 'C8' | 'C9' | 'C12' | 'K3' | 'K4' | 'K5' | 'K6' | 'K7';
export interface MdLayer {
  id: MdLayerId;
  /** Service layer URL (no trailing /query). */
  layer: string;
  /** What the card calls it. */
  source: string;
  /** A human page for it (dataset page when one exists, else the layer). */
  page: string;
  /** The ONLY columns ever requested (equal to COMMON's SAFE list). */
  outFields: string;
  /** How the as-of is read: max of a date field, the layer's editingInfo, the parcel's LDATE. */
  asOf: { kind: 'stat'; field: string } | { kind: 'layer' } | { kind: 'ldate' };
}

// SAFE lists (allow-list, revision 2026-09-28). Adding ANY field fails
// validate-building-record (set equality), banned or not.
export const MD_SAFE_FIELDS: Record<MdLayerId, readonly string[]> = {
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

const f = (id: MdLayerId) => MD_SAFE_FIELDS[id].join(',');

export const MD_LAYERS: Record<MdLayerId, MdLayer> = {
  C3: { id: 'C3', layer: `${EGIS}CityView/RealProperty_OB/FeatureServer/0`, source: 'City Real Property data', page: 'https://data.baltimorecity.gov/datasets/64110b108565433d8da40dd0e422064e', outFields: f('C3'), asOf: { kind: 'ldate' } },
  C4: { id: 'C4', layer: `${EGIS}Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/3`, source: 'City permits (2019 to present)', page: 'https://data.baltimorecity.gov/datasets/189e6d1c65df4e13b38c0027cee574f6', outFields: f('C4'), asOf: { kind: 'stat', field: 'IssuedDate' } },
  C6: { id: 'C6', layer: `${EGIS}Housing/DHCD_Open_Baltimore_Datasets/FeatureServer/1`, source: 'City vacant building notices', page: 'https://data.baltimorecity.gov/datasets/691d65a5f85640e6aaa46930bd9dc102', outFields: f('C6'), asOf: { kind: 'stat', field: 'DateNotice' } },
  C8: { id: 'C8', layer: `${EGIS}CityView/Zoning_New/FeatureServer/0`, source: 'City zoning map', page: 'https://data.baltimorecity.gov/datasets/dc7bf04cec4e41ef85cc6b391652e1e7', outFields: f('C8'), asOf: { kind: 'layer' } },
  C9: { id: 'C9', layer: `${AGOL}CHAP_Historic_Districts/FeatureServer/0`, source: "CHAP's historic district layer", page: 'https://data.baltimorecity.gov/datasets/2aa812e5042e4fc8950ffff2a6ce9291', outFields: f('C9'), asOf: { kind: 'layer' } },
  C12: { id: 'C12', layer: `${AGOL}FloodPlain_n/FeatureServer/0`, source: "the City's floodplain layer", page: 'https://data.baltimorecity.gov/datasets/517933b8965b47949f85a879cbdc954c', outFields: f('C12'), asOf: { kind: 'layer' } },
  K3: { id: 'K3', layer: `${BCGIS}Property/Property/MapServer/1`, source: 'County tax parcel layer', page: `${BCGIS}Property/Property/MapServer/1`, outFields: f('K3'), asOf: { kind: 'layer' } },
  K4: { id: 'K4', layer: `${BCGIS}DevelopmentManagement/ActiveDevelopment/MapServer/4`, source: 'County permits (Cityworks)', page: 'https://opendata.baltimorecountymd.gov/datasets/cfd6eb593b524875a80e3c45e4575fa9', outFields: f('K4'), asOf: { kind: 'stat', field: 'ISSDATE' } },
  K5: { id: 'K5', layer: `${BCGIS}DevelopmentManagement/Zoning/MapServer/1`, source: 'County current zoning layer', page: `${BCGIS}DevelopmentManagement/Zoning/MapServer/1`, outFields: f('K5'), asOf: { kind: 'layer' } },
  K6: { id: 'K6', layer: `${BCGIS}DevelopmentManagement/Floodplain/MapServer/13`, source: "FEMA's flood map as published by the County", page: `${BCGIS}DevelopmentManagement/Floodplain/MapServer/13`, outFields: f('K6'), asOf: { kind: 'layer' } },
  K7: { id: 'K7', layer: `${BCGIS}Historic/Historic/MapServer/5`, source: 'County historic district layer', page: `${BCGIS}Historic/Historic/MapServer/5`, outFields: f('K7'), asOf: { kind: 'layer' } },
};

const CITY_GEOCODER = `${EGIS}Locator/EGISCompositeLocator/GeocodeServer/findAddressCandidates`;
const COUNTY_GEOCODER = `${BCGIS}Geocoders/CompositeGeocoder/GeocodeServer/findAddressCandidates`;

// ─────────────────────────────────────────────────────────────────────
// Sanitizers — every value that reaches a URL goes through one of these.
// ─────────────────────────────────────────────────────────────────────

export function sanitizeMdText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 200) return null;
  return s;
}
/** A coordinate inside a loose box around Baltimore City + County, else null. */
export function sanitizeMdLat(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 38.9 && v <= 39.9 ? v : null;
}
export function sanitizeMdLon(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= -77.2 && v <= -76.0 ? v : null;
}

/**
 * One key for a City block-lot, whatever the spelling. The same parcel is
 * '4074C009' in Real Property and '4074C 009' in permits; plain blocks are
 * '3172 042'. Key = 4-digit block + (letter or space) + 3-4 char lot:
 * '4074C 009' / '4074C009' -> '4074C009'; '3172 042' / '3172042' -> '3172 042'.
 * null for anything else.
 */
export function normalizeCityBlockLot(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.toUpperCase().replace(/\s+/g, ' ').trim();
  const m = /^(\d{4})([A-Z]?)\s?([0-9A-Z]{3,4})$/.exec(s);
  if (!m) return null;
  return `${m[1]}${m[2] || ' '}${m[3]}`;
}
/** Both spellings the City datasets use for one key. */
export function cityBlockLotVariants(key: string): string[] {
  const k = normalizeCityBlockLot(key);
  if (!k) return [];
  const block = k.slice(0, 5);
  const lot = k.slice(5);
  const trimmed = block.trim();
  return [...new Set([`${trimmed}${lot}`, `${trimmed} ${lot}`, `${block}${lot}`])];
}
/** '4074C009' -> '4074C 009'; '3172 042' stays. For display. */
export function displayBlockLot(key: string): string {
  const k = normalizeCityBlockLot(key);
  return k ? `${k.slice(0, 5).trim()} ${k.slice(5)}` : key;
}
export function sanitizeTaxPin(v: unknown): string | null {
  return typeof v === 'string' && /^\d{10}$/.test(v.trim()) ? v.trim() : null;
}
export function sanitizeMdKey(side: MdSide, key: unknown): string | null {
  return side === 'baltimore_city' ? normalizeCityBlockLot(key) : sanitizeTaxPin(key);
}

/** Parse an MD request body. null → not an MD request (or not a valid one). */
export function parseMdRequest(body: unknown): MdBuildingRecordRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.mode === 'md_resolve') {
    const text = sanitizeMdText(b.text);
    if (!text) return null;
    const lat = sanitizeMdLat(b.lat);
    const lon = sanitizeMdLon(b.lon);
    const both = lat !== null && lon !== null;
    return { mode: 'md_resolve', text, lat: both ? lat : null, lon: both ? lon : null };
  }
  if (b.mode === 'md_record') {
    const side = b.side === 'baltimore_city' || b.side === 'baltimore_county' ? b.side : null;
    if (!side) return null;
    const key = sanitizeMdKey(side, b.key);
    const lat = sanitizeMdLat(b.lat);
    const lon = sanitizeMdLon(b.lon);
    return key && lat !== null && lon !== null ? { mode: 'md_record', side, key, lat, lon } : null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Geocoding
// ─────────────────────────────────────────────────────────────────────

export interface MdAddressInput { houseNumber: string | null; zip: string | null; query: string; }

/**
 * The text sent to both Baltimore geocoders: the street part plus ', MD' and
 * the ZIP. The postal city is DROPPED: "9616 Reisterstown Rd, Baltimore, MD"
 * scores 77.2 on the County geocoder (its postal city is Owings Mills) and
 * 100 without it. Also returns the house number and ZIP used as guards.
 */
export function mdAddressInput(textIn: string): MdAddressInput | null {
  const text = sanitizeMdText(textIn);
  if (!text) return null;
  const zipM = /[,\s]+(\d{5})(?:-\d{4})?$/.exec(text);
  const zip = zipM ? zipM[1] : null;
  const noZip = zipM ? text.slice(0, zipM.index).trim() : text;
  const street = noZip.includes(',') ? noZip.split(',')[0].trim() : noZip;
  const numM = /^(\d+[A-Z]?)\b/i.exec(street);
  const houseNumber = numM ? numM[1].toUpperCase() : null;
  const query = noZip.includes(',') ? `${street}, MD${zip ? ` ${zip}` : ''}` : text;
  return { houseNumber, zip, query: query.slice(0, 200) };
}

function geocodeUrl(base: string, input: MdAddressInput): string | null {
  const url = `${base}?SingleLine=${encMd(input.query)}&outSR=4326&maxLocations=${MD_CANDIDATE_CAP}&outFields=Addr_type,Postal&f=json`;
  return isAllowedMdUrl(url) ? url : null;
}
export function cityGeocodeUrl(input: MdAddressInput): string | null { return geocodeUrl(CITY_GEOCODER, input); }
export function countyGeocodeUrl(input: MdAddressInput): string | null { return geocodeUrl(COUNTY_GEOCODER, input); }
export function censusCountyUrl(textIn: string): string | null {
  const text = sanitizeMdText(textIn);
  if (!text) return null;
  const url = `${CENSUS_GEOGRAPHIES}?address=${encMd(text)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
  return isAllowedMdUrl(url) ? url : null;
}

export type MdGeocoder = 'city' | 'county';
export interface MdGeoPoint { from: MdGeocoder | 'census' | 'pin'; lat: number; lon: number; score: number; address: string; type: string; match: 'address' | 'approximate'; }

/** Address types that name one address (never a bare street, a range extension or a ZIP). */
const POINT_TYPES = new Set(['PointAddress', 'Subaddress', 'StreetAddress', 'Parcel']);
/** A rooftop / parcel point lands inside the parcel; a StreetAddress point sits on the street
 *  centreline (inside no City parcel, inside a County right-of-way polygon). Rooftop first. */
const TYPE_RANK: Record<string, number> = { PointAddress: 0, Parcel: 0, Subaddress: 0, StreetAddress: 1 };
function byRank(a: MdGeoPoint, b: MdGeoPoint): number {
  const r = (TYPE_RANK[a.type] ?? 2) - (TYPE_RANK[b.type] ?? 2);
  return r !== 0 ? r : b.score - a.score;
}

type Raw = Record<string, unknown>;
function str(v: unknown, max = 300): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/[\u0091\u0092]/g, "'").replace(/[\u0093\u0094]/g, '"')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}
function featureAttrs(body: unknown): Raw[] | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Raw;
  if (b.error) return null;
  if (!Array.isArray(b.features)) return null;
  return (b.features as unknown[]).map((x) => (x && typeof x === 'object' && (x as Raw).attributes && typeof (x as Raw).attributes === 'object' ? (x as Raw).attributes as Raw : {}));
}

/** The house number an address label starts with (after a parcel-locator 'BLOCKLOT, ' prefix). */
function leadingNumber(address: string): string | null {
  const parts = address.split(',').map((p) => p.trim());
  for (const p of parts) {
    const m = /^(\d+[A-Z]?)\s+[A-Z]/i.exec(p);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/**
 * findAddressCandidates body → usable points, best first. Kept only when the
 * score is >= MD_MIN_SCORE, the type names one address, the ZIP (when both
 * sides have one) agrees, and the house number (when the input has one)
 * agrees. match 'address' only at score >= 95.
 */
export function geocodePoints(body: unknown, from: MdGeocoder, input: MdAddressInput): MdGeoPoint[] {
  const cands = body && typeof body === 'object' && Array.isArray((body as Raw).candidates) ? (body as Raw).candidates as Raw[] : [];
  const out: MdGeoPoint[] = [];
  for (const c of cands) {
    if (!c || typeof c !== 'object') continue;
    const score = num(c.score);
    const loc = c.location && typeof c.location === 'object' ? c.location as Raw : null;
    const lat = sanitizeMdLat(loc?.y);
    const lon = sanitizeMdLon(loc?.x);
    const address = str(c.address);
    const attrs = c.attributes && typeof c.attributes === 'object' ? c.attributes as Raw : {};
    const type = str(attrs.Addr_type);
    if (score === null || score < MD_MIN_SCORE || lat === null || lon === null || !address || !type || !POINT_TYPES.has(type)) continue;
    const postal = str(attrs.Postal);
    if (input.zip && postal && /^\d{5}$/.test(postal) && postal !== input.zip) continue;
    if (input.houseNumber) {
      const n = leadingNumber(address);
      if (n && n !== input.houseNumber) continue;
    }
    out.push({ from, lat, lon, score, address, type, match: score >= 95 ? 'address' : 'approximate' });
  }
  return out.sort(byRank);
}

/** The Census match: point (null outside the Baltimore box), county, GEOID and
 *  whether its raw point lay inside the box (null when it had no point). */
export interface MdCensusCounty { lat: number | null; lon: number | null; county: string | null; geoid: string | null; inBox: boolean | null; }

/** The Census geographies body → the first match's point and county. */
export function censusCounty(body: unknown): MdCensusCounty | null {
  const result = body && typeof body === 'object' ? (body as Raw).result : null;
  const matches = result && typeof result === 'object' ? (result as Raw).addressMatches : null;
  if (!Array.isArray(matches) || !matches.length) return null;
  const m = matches[0] as Raw;
  const c = m && typeof m.coordinates === 'object' && m.coordinates ? m.coordinates as Raw : null;
  const geos = m && typeof m.geographies === 'object' && m.geographies ? m.geographies as Raw : null;
  const counties = geos && Array.isArray(geos.Counties) ? geos.Counties as Raw[] : [];
  const county = counties[0] ? str(counties[0].NAME) : null;
  const geoid = counties[0] ? str(counties[0].GEOID) : null;
  const x = c?.x;
  const y = c?.y;
  const rawX = typeof x === 'number' && Number.isFinite(x) ? x : null;
  const rawY = typeof y === 'number' && Number.isFinite(y) ? y : null;
  const lat = sanitizeMdLat(rawY);
  const lon = sanitizeMdLon(rawX);
  const inBox = rawX === null || rawY === null ? null : lat !== null && lon !== null;
  return { lat, lon, county, geoid, inBox };
}

/** Census county GEOIDs of Baltimore City (24510) and Baltimore County (24005). */
export const MD_BALTIMORE_GEOIDS: readonly string[] = ['24510', '24005'];

/**
 * True only when the Census match provably cannot sit in either Baltimore
 * parcel layer: it names a county GEOID other than the two Baltimores, or its
 * point lies outside the box that holds both. A Baltimore GEOID never counts
 * as outside (the parcel layers decide those), and no match is never outside.
 */
export function mdCensusOutside(c: MdCensusCounty | null): boolean {
  if (!c) return false;
  if (c.geoid && MD_BALTIMORE_GEOIDS.includes(c.geoid)) return false;
  if (c.geoid && /^\d{5}$/.test(c.geoid)) return true;
  return c.inBox === false;
}

/**
 * Neither Baltimore geocoder placed the address: what to probe, or the answer.
 * The Census point is probed only when it could be in Baltimore; the job's
 * map pin (already boxed) is always probed, so a parcel layer still decides
 * when there is one. Nothing left to probe → md_outside with the Census county
 * when the Census says outside, else an empty candidate list (no match).
 */
export function mdCensusFallback(c: MdCensusCounty | null, pin: { lat: number; lon: number } | null): { outcome: MdBuildingRecordResponse } | { points: MdGeoPoint[] } {
  const outside = mdCensusOutside(c);
  const points: MdGeoPoint[] = [];
  if (c && !outside && c.lat !== null && c.lon !== null) points.push({ from: 'census', lat: c.lat, lon: c.lon, score: 0, address: '', type: 'census', match: 'approximate' });
  if (pin) points.push({ from: 'pin', lat: pin.lat, lon: pin.lon, score: 0, address: '', type: 'pin', match: 'approximate' });
  if (points.length) return { points };
  return { outcome: outside ? { status: 'md_outside', county: c?.county ?? null } : { status: 'md_candidates', candidates: [] } };
}

// ─────────────────────────────────────────────────────────────────────
// The bounded resolve planner
// ─────────────────────────────────────────────────────────────────────

export interface MdProbe { point: MdGeoPoint; order: MdSide[]; }

const OWN: Record<MdGeoPoint['from'], MdSide> = { city: 'baltimore_city', county: 'baltimore_county', census: 'baltimore_city', pin: 'baltimore_city' };
const OTHER = (s: MdSide): MdSide => (s === 'baltimore_city' ? 'baltimore_county' : 'baltimore_city');

/** Normalized address for de-duplication: the first comma part that starts with a number, upper-cased. */
export function pointAddressKey(address: string): string {
  const parts = address.toUpperCase().split(',').map((p) => p.replace(/\s+/g, ' ').trim());
  return parts.find((p) => /^\d/.test(p) && /[A-Z]/.test(p)) ?? parts[0] ?? '';
}

/**
 * Candidate points from both geocoders → the ordered probe list.
 *   1. below-threshold / unusable points are already gone (geocodePoints);
 *   2. points closer than ~1 m (lat/lon rounded to 5 decimals) are merged,
 *      and a point whose normalized address the OTHER geocoder already gave
 *      is dropped (one geocoder's rooftop, street and parcel points for one
 *      address are different points and are kept);
 *   3. at most MD_POINTS_PER_GEOCODER per geocoder, rooftop/parcel first,
 *      then by score;
 *   4. the list interleaves the geocoders (best City, best County, second
 *      City, ...) so the best point of each side starts first;
 *   5. each point probes its OWN geocoder's parcel layer first, the other
 *      layer only if the first misses (index.ts runs that fallback).
 * So at most 6 points and 12 parcel probes.
 */
export function planMdResolve(cityPoints: MdGeoPoint[], countyPoints: MdGeoPoint[]): MdProbe[] {
  const seenXY = new Set<string>();
  const addrBy: Record<string, Set<string>> = {};
  const lanes: MdGeoPoint[][] = [];
  for (const list of [cityPoints, countyPoints]) {
    const lane: MdGeoPoint[] = [];
    for (const p of [...list].filter((x) => Number.isFinite(x.score)).sort(byRank)) {
      if (lane.length >= MD_POINTS_PER_GEOCODER) break;
      const xy = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
      const ak = pointAddressKey(p.address);
      if (seenXY.has(xy)) continue;
      const fromOther = Object.entries(addrBy).some(([from, set]) => from !== p.from && !!ak && set.has(ak));
      if (fromOther) continue;
      seenXY.add(xy);
      (addrBy[p.from] ??= new Set()).add(ak);
      lane.push(p);
    }
    lanes.push(lane);
  }
  const out: MdProbe[] = [];
  for (let i = 0; i < MD_POINTS_PER_GEOCODER; i++) {
    for (const lane of lanes) {
      const point = lane[i];
      if (point) out.push({ point, order: [OWN[point.from], OTHER(OWN[point.from])] });
    }
  }
  return out;
}

/** A parcel layer's answer at one point. */
export type MdParcelHit =
  | { kind: 'parcel'; candidate: MdCandidate }
  | { kind: 'inside_no_parcel' }   // the layer contains the point, but only a right-of-way polygon
  | { kind: 'none' }               // the layer answered: not inside
  | { kind: 'unread' };            // malformed body

function titleCase(v: string): string {
  return v.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
const SIDE_NAME: Record<MdSide, string> = { baltimore_city: 'Baltimore City', baltimore_county: 'Baltimore County' };

/** The parcel-layer point query body → a candidate (or why not). */
export function parcelHitFrom(body: unknown, side: MdSide, point: MdGeoPoint): MdParcelHit {
  const rows = featureAttrs(body);
  if (!rows) return { kind: 'unread' };
  if (!rows.length) return { kind: 'none' };
  for (const r of rows) {
    if (side === 'baltimore_city') {
      const key = normalizeCityBlockLot(str(r.BLOCKLOT) ?? '');
      if (!key) continue;
      const addr = str(r.FULLADDR);
      return { kind: 'parcel', candidate: { side, key, label: `${addr ? titleCase(addr) : 'Address not published'}, ${SIDE_NAME[side]} · block-lot ${displayBlockLot(key)}`, lat: point.lat, lon: point.lon, match: point.match } };
    }
    const key = sanitizeTaxPin(str(r.TAXPIN) ?? '');
    if (!key) continue;
    const addr = str(r.PREMISE_ADDRESS);
    const ref = [str(r.MAP) && `map ${str(r.MAP)}`, str(r.PARCEL) && `parcel ${str(r.PARCEL)}`].filter(Boolean).join(', ');
    return { kind: 'parcel', candidate: { side, key, label: `${addr ? titleCase(addr) : 'Address not published'}, ${SIDE_NAME[side]}${ref ? ` · ${ref}` : ''}`, lat: point.lat, lon: point.lon, match: point.match } };
  }
  return { kind: 'inside_no_parcel' };
}

/** A parcel-layer point-in-polygon URL (the geometry JSON form; "x,y" returned nothing on some layers). */
export function parcelPointUrl(side: MdSide, lat: number, lon: number): string | null {
  return pointQueryUrl(side === 'baltimore_city' ? 'C3' : 'K3', lat, lon, 5);
}

export interface MdProbeResult { probe: MdProbe; hits: { side: MdSide; hit: MdParcelHit | 'failed' | 'timeout' }[] }

/**
 * Should a not-yet-started probe still run? It is skipped once the top-scored
 * point of its OWN side has resolved a parcel and its address is one already
 * resolved (it can only duplicate that parcel).
 */
export function probeIsRedundant(probe: MdProbe, done: MdProbeResult[]): boolean {
  const addr = pointAddressKey(probe.point.address);
  return done.some((d) => d.probe.point.from === probe.point.from
    && d.hits.some((h) => typeof h.hit === 'object' && h.hit.kind === 'parcel')
    && pointAddressKey(d.probe.point.address) === addr);
}

/**
 * All probe results → the reply. Candidates deduped by side+key, capped.
 * md_outside ONLY when every probed point was answered by BOTH layers with
 * 'none'. Nothing answered → the fixed error (never "outside").
 */
export function mdResolveOutcome(results: MdProbeResult[], census: { county: string | null } | null): MdBuildingRecordResponse {
  const seen = new Set<string>();
  const candidates: MdCandidate[] = [];
  let anyAnswered = false;
  let anyInside = false;
  let allOutside = results.length > 0;
  for (const r of results) {
    const sidesNone = new Set<MdSide>();
    for (const h of r.hits) {
      if (h.hit === 'failed' || h.hit === 'timeout' || h.hit.kind === 'unread') continue;
      anyAnswered = true;
      if (h.hit.kind === 'none') sidesNone.add(h.side);
      else anyInside = true;
      if (h.hit.kind === 'parcel') {
        const k = `${h.hit.candidate.side}|${h.hit.candidate.key}`;
        if (!seen.has(k)) { seen.add(k); candidates.push(h.hit.candidate); }
      }
    }
    if (!(sidesNone.has('baltimore_city') && sidesNone.has('baltimore_county'))) allOutside = false;
  }
  if (candidates.length) {
    const ranked = [...candidates.filter((c) => c.match === 'address'), ...candidates.filter((c) => c.match !== 'address')];
    return { status: 'md_candidates', candidates: ranked.slice(0, MD_CANDIDATE_CAP) };
  }
  if (!anyAnswered) return { status: 'error', code: 'upstream', error: MD_ERRORS.upstream };
  if (allOutside && !anyInside) return { status: 'md_outside', county: census?.county ?? null };
  if (anyInside) return { status: 'md_candidates', candidates: [] };
  return { status: 'error', code: 'upstream', error: MD_ERRORS.upstream };
}

// ─────────────────────────────────────────────────────────────────────
// A bounded pool (no fetch inside: it runs the thunks it is given)
// ─────────────────────────────────────────────────────────────────────

export type PoolResult<T> = { status: 'ok'; value: T } | { status: 'failed'; error: unknown } | { status: 'timeout' } | { status: 'skipped' };

/**
 * Run tasks with at most `concurrency` in flight and one overall deadline.
 * A task not started by the deadline is 'timeout' (it never runs); a task
 * still pending at the deadline is 'timeout'. `skip(i, finishedSoFar)` lets a
 * caller drop a task that can only duplicate earlier work.
 */
export async function runBounded<T>(
  tasks: (() => Promise<T>)[],
  opts: { concurrency: number; deadlineMs: number; skip?: (index: number, done: { index: number; result: PoolResult<T> }[]) => boolean; isTimeout?: (e: unknown) => boolean },
): Promise<PoolResult<T>[]> {
  const results: PoolResult<T>[] = tasks.map(() => ({ status: 'timeout' as const }));
  const done: { index: number; result: PoolResult<T> }[] = [];
  const start = Date.now();
  let next = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<'deadline'>((resolve) => { timer = setTimeout(() => resolve('deadline'), Math.max(0, opts.deadlineMs)); });
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      if (Date.now() - start >= opts.deadlineMs) return;
      const i = next++;
      if (opts.skip && opts.skip(i, done)) { results[i] = { status: 'skipped' }; continue; }
      try {
        const value = await tasks[i]();
        results[i] = { status: 'ok', value };
      } catch (e) {
        results[i] = opts.isTimeout && opts.isTimeout(e) ? { status: 'timeout' } : { status: 'failed', error: e };
      }
      done.push({ index: i, result: results[i] });
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency, tasks.length)) }, () => worker());
  // Snapshot at the deadline: anything unfinished stays 'timeout'.
  const snapshot = await Promise.race([Promise.all(workers).then(() => 'all' as const), deadline]);
  if (timer !== null) clearTimeout(timer);
  if (snapshot === 'deadline') {
    next = tasks.length; // start nothing new
    return results.map((r) => ({ ...r }));
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────
// Record: query builders
// ─────────────────────────────────────────────────────────────────────

function queryUrl(id: MdLayerId, params: Record<string, string>): string | null {
  const layer = MD_LAYERS[id];
  const parts = Object.entries({ ...params, outFields: layer.outFields, returnGeometry: 'false', f: 'json' })
    .map(([k, v]) => `${k}=${k === 'outFields' ? v : encMd(v)}`);
  const url = `${layer.layer}/query?${parts.join('&')}`;
  return isAllowedMdUrl(url) ? url : null;
}

/** A point-in-polygon query on one overlay layer. */
export function pointQueryUrl(id: MdLayerId, latIn: number, lonIn: number, limit = MD_OVERLAY_ROWS): string | null {
  const lat = sanitizeMdLat(latIn);
  const lon = sanitizeMdLon(lonIn);
  if (lat === null || lon === null) return null;
  return queryUrl(id, {
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    resultRecordCount: String(limit),
  });
}

function cityInList(key: string, field: string): string | null {
  const v = cityBlockLotVariants(key);
  return v.length ? `${field} IN (${v.map((x) => `'${x}'`).join(',')})` : null;
}

/** The WHERE clause that selects one parcel's rows on an attribute layer. */
export function mdWhere(id: MdLayerId, side: MdSide, keyIn: string): string | null {
  const key = sanitizeMdKey(side, keyIn);
  if (!key) return null;
  if (side === 'baltimore_city') {
    if (id === 'C3' || id === 'C4' || id === 'C6') return cityInList(key, 'BLOCKLOT');
    return null;
  }
  if (id === 'K3') return `TAXPIN='${key}'`;
  // The tax account number is a WHERE key only: never in outFields, never shown.
  if (id === 'K4') return `TAX_ASSMT_NUMBER='${key}'`;
  return null;
}

export function attributeQueryUrl(id: MdLayerId, side: MdSide, key: string, opts: { orderBy?: string; limit: number }): string | null {
  const where = mdWhere(id, side, key);
  if (!where) return null;
  const params: Record<string, string> = { where, resultRecordCount: String(opts.limit) };
  if (opts.orderBy) params.orderByFields = opts.orderBy;
  return queryUrl(id, params);
}
export function countQueryUrl(id: MdLayerId, side: MdSide, key: string): string | null {
  const where = mdWhere(id, side, key);
  if (!where) return null;
  const url = `${MD_LAYERS[id].layer}/query?where=${encMd(where)}&returnCountOnly=true&f=json`;
  return isAllowedMdUrl(url) ? url : null;
}
/** The as-of read for a layer: max(date field) or the layer JSON. null for 'ldate' (read off the parcel). */
export function asOfUrl(id: MdLayerId): string | null {
  const a = MD_LAYERS[id].asOf;
  let url: string | null = null;
  if (a.kind === 'stat') {
    const stats = JSON.stringify([{ statisticType: 'max', onStatisticField: a.field, outStatisticFieldName: 'mx' }]);
    url = `${MD_LAYERS[id].layer}/query?where=${encMd('1=1')}&outStatistics=${encMd(stats)}&f=json`;
  } else if (a.kind === 'layer') {
    url = `${MD_LAYERS[id].layer}?f=json`;
  }
  return url && isAllowedMdUrl(url) ? url : null;
}

export type MdJobId =
  | 'parcel' | 'permits_count' | 'permits_rows' | 'vbn'
  | 'zoning' | 'historic' | 'flood'
  | `asof:${MdLayerId}`;
export interface MdJob { id: MdJobId; url: string; asOf: boolean; }

/** The four housing-notice parts every City record still carries on the wire
 *  (see WIRE COMPATIBILITY at the top). Never fetched: unreadPart() builds them. */
export const MD_UNREAD_NOTICE_NAMES: readonly string[] = ['Interior', 'Interior/exterior', 'Vacant', 'Exterior'];
/** Sources of the parts MAGE no longer reads. The client prints
 *  "Couldn't read the <name> notices in the <notices source> — not checked"
 *  and "Couldn't read <landmarks source> — not checked". */
export const MD_UNREAD_SOURCES = {
  notices: 'unpublished City inspections feed (MAGE no longer checks it; see the CoDeMap link)',
  landmarks: "the City's unpublished CHAP landmark layer (MAGE no longer checks it)",
  nationalRegister: "the City's unpublished National Register district layer (MAGE no longer checks it)",
} as const;
/** Where a contractor can look instead (the part's url; the card does not render it). */
const OPEN_BALTIMORE_URL = 'https://data.baltimorecity.gov/';

/** Every fetch one record needs, in the order the pool should start them. */
export function mdRecordPlan(side: MdSide, keyIn: string, lat: number, lon: number): MdJob[] | null {
  const key = sanitizeMdKey(side, keyIn);
  if (!key || sanitizeMdLat(lat) === null || sanitizeMdLon(lon) === null) return null;
  const jobs: { id: MdJobId; url: string | null; asOf: boolean }[] = [];
  const layers: MdLayerId[] = [];
  if (side === 'baltimore_city') {
    jobs.push(
      { id: 'parcel', url: attributeQueryUrl('C3', side, key, { limit: 5 }), asOf: false },
      { id: 'permits_count', url: countQueryUrl('C4', side, key), asOf: false },
      { id: 'permits_rows', url: attributeQueryUrl('C4', side, key, { orderBy: 'IssuedDate DESC', limit: MD_PERMIT_ROWS }), asOf: false },
      { id: 'vbn', url: attributeQueryUrl('C6', side, key, { orderBy: 'DateNotice DESC', limit: MD_NOTICE_ROWS }), asOf: false },
      { id: 'zoning', url: pointQueryUrl('C8', lat, lon), asOf: false },
      { id: 'historic', url: pointQueryUrl('C9', lat, lon), asOf: false },
      { id: 'flood', url: pointQueryUrl('C12', lat, lon), asOf: false },
    );
    layers.push('C4', 'C6', 'C8', 'C9', 'C12');
  } else {
    jobs.push(
      { id: 'parcel', url: attributeQueryUrl('K3', side, key, { limit: 5 }), asOf: false },
      { id: 'permits_count', url: countQueryUrl('K4', side, key), asOf: false },
      { id: 'permits_rows', url: attributeQueryUrl('K4', side, key, { orderBy: 'ISSDATE DESC', limit: MD_PERMIT_ROWS }), asOf: false },
      { id: 'zoning', url: pointQueryUrl('K5', lat, lon), asOf: false },
      { id: 'historic', url: pointQueryUrl('K7', lat, lon), asOf: false },
      { id: 'flood', url: pointQueryUrl('K6', lat, lon), asOf: false },
    );
    layers.push('K3', 'K4', 'K5', 'K6', 'K7');
  }
  for (const id of layers) jobs.push({ id: `asof:${id}`, url: asOfUrl(id), asOf: true });
  if (jobs.some((j) => !j.url)) return null;
  return jobs as MdJob[];
}

// ─────────────────────────────────────────────────────────────────────
// Record: normalizers (pure)
// ─────────────────────────────────────────────────────────────────────

/** ArcGIS epoch ms → 'YYYY-MM-DD' (UTC); a date string is kept as its day. */
export function mdDay(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = str(v);
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
/** Real Property LDATE 'MMDDYYYY' → 'YYYY-MM-DD'. */
export function ldateDay(v: unknown): string | null {
  const s = str(v);
  const m = s ? /^(\d{2})(\d{2})(\d{4})$/.exec(s) : null;
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}
/** Year built: 0 / '0000' / out of range → null (unknown), never "year 0". */
export function yearOrNull(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 1600 && n <= 2100 ? n : null;
}
/** Square feet / units: 0 or negative → null (not recorded). */
function positiveOrNull(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}
/** Dollars (number or '1000000.00') → integer cents; 0, negative or junk → null. */
export function mdDollarsToCents(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? Math.round(n * 100) : null;
}
/** STATIC_BFE: -9999 (and any non-positive sentinel) → null (no elevation published). */
export function bfeOrNull(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > -9000 ? n : null;
}

/** The as-of read's body → the day and how it was obtained. */
export function asOfFrom(id: MdLayerId, body: unknown): { asOf: string | null; asOfKind: MdAsOfKind } {
  const a = MD_LAYERS[id].asOf;
  if (!body || typeof body !== 'object' || (body as Raw).error) return { asOf: null, asOfKind: 'unread' };
  if (a.kind === 'stat') {
    const rows = featureAttrs(body);
    if (!rows) return { asOf: null, asOfKind: 'unread' };
    const r = rows[0] ?? {};
    // The County server upper-cases the alias (MX).
    const v = r.mx ?? r.MX;
    const d = mdDay(v);
    return d ? { asOf: d, asOfKind: 'data' } : { asOf: null, asOfKind: 'unread' };
  }
  const ei = (body as Raw).editingInfo;
  if (ei && typeof ei === 'object') {
    const e = ei as Raw;
    const d = mdDay(e.dataLastEditDate) ?? mdDay(e.lastEditDate);
    if (d) return { asOf: d, asOfKind: 'edited' };
  }
  if (Array.isArray((body as Raw).fields)) return { asOf: null, asOfKind: 'none' };
  return { asOf: null, asOfKind: 'unread' };
}

export type MdFetched = { status: 'ok'; body: unknown } | { status: 'failed' } | { status: 'timeout' };
type AsOf = { asOf: string | null; asOfKind: MdAsOfKind };

function meta(id: MdLayerId, status: MdPartStatus, asOf: AsOf): MdPartMeta {
  return { status, asOf: status === 'ok' ? asOf.asOf : null, asOfKind: status === 'ok' ? asOf.asOfKind : 'unread', source: MD_LAYERS[id].source, url: MD_LAYERS[id].page };
}
const failStatus = (x: MdFetched | undefined): MdPartStatus => (x && x.status === 'timeout' ? 'timeout' : 'failed');

function parcelPart(side: MdSide, key: string, got: MdFetched | undefined, asOfIn: AsOf): MdParcelPart {
  const id: MdLayerId = side === 'baltimore_city' ? 'C3' : 'K3';
  const empty = { found: false, address: null, zip: null, yearBuilt: null, areaSqft: null, zoning: null, use: null, dwellingUnits: null, neighborhood: null, parcelRef: null };
  if (!got || got.status !== 'ok') return { ...meta(id, failStatus(got), asOfIn), ...empty };
  const rows = featureAttrs(got.body);
  if (!rows) return { ...meta(id, 'failed', asOfIn), ...empty };
  const row = rows.find((r) => (side === 'baltimore_city' ? normalizeCityBlockLot(str(r.BLOCKLOT) ?? '') === key : sanitizeTaxPin(str(r.TAXPIN) ?? '') === key));
  if (!row) return { ...meta(id, 'ok', asOfIn), ...empty };
  if (side === 'baltimore_city') {
    const ld = ldateDay(row.LDATE);
    return {
      ...meta(id, 'ok', ld ? { asOf: ld, asOfKind: 'data' } : { asOf: null, asOfKind: 'none' }),
      found: true, address: str(row.FULLADDR) ? titleCase(str(row.FULLADDR) as string) : null, zip: str(row.ZIP_CODE),
      yearBuilt: yearOrNull(row.YEAR_BUILD), areaSqft: positiveOrNull(row.STRUCTAREA), zoning: str(row.ZONECODE),
      use: str(row.USEGROUP), dwellingUnits: positiveOrNull(row.DWELUNIT), neighborhood: str(row.NEIGHBOR) ? titleCase(str(row.NEIGHBOR) as string) : null,
      parcelRef: `block-lot ${displayBlockLot(key)}`,
    };
  }
  const ref = [str(row.MAP) && `map ${str(row.MAP)}`, str(row.GRID) && `grid ${str(row.GRID)}`, str(row.PARCEL) && `parcel ${str(row.PARCEL)}`, str(row.LOT) && `lot ${str(row.LOT)}`].filter(Boolean).join(', ');
  return {
    ...meta(id, 'ok', asOfIn),
    found: true, address: str(row.PREMISE_ADDRESS) ? titleCase(str(row.PREMISE_ADDRESS) as string) : null, zip: str(row.ZIP_CODE),
    yearBuilt: yearOrNull(row.YEAR_BUILT), areaSqft: positiveOrNull(row.STRCT_SQFT), zoning: null,
    use: str(row.LU_CODE) ? titleCase(str(row.LU_CODE) as string) : null, dwellingUnits: null, neighborhood: null,
    parcelRef: ref || null,
  };
}

function permitsPart(side: MdSide, key: string, count: MdFetched | undefined, rowsGot: MdFetched | undefined, asOfIn: AsOf): MdPermitsPart {
  const id: MdLayerId = side === 'baltimore_city' ? 'C4' : 'K4';
  const failed = (s: MdPartStatus): MdPermitsPart => ({ ...meta(id, s, asOfIn), total: null, truncated: false, rows: [] });
  if (!count || count.status !== 'ok') return failed(failStatus(count));
  if (!rowsGot || rowsGot.status !== 'ok') return failed(failStatus(rowsGot));
  const total = count.body && typeof count.body === 'object' ? num((count.body as Raw).count) : null;
  const rows = featureAttrs(rowsGot.body);
  if (total === null || !rows) return failed('failed');
  const out: MdPermitRow[] = [];
  for (const r of rows) {
    if (side === 'baltimore_city') {
      if (normalizeCityBlockLot(str(r.BLOCKLOT) ?? '') !== key) continue;
      out.push({ number: str(r.CaseNumber) ?? 'Permit number not published', issued: mdDay(r.IssuedDate), expires: mdDay(r.ExpirationDate), status: null, description: str(r.Description), costCents: mdDollarsToCents(r.Cost) });
    } else {
      const type = str(r.TYPEDESCRIPTION);
      const sub = str(r.SUBTYPE_DESCRIPTION);
      const work = str(r.DESC_WORK);
      const head = type ? `${type}${sub ? ` (${sub})` : ''}` : sub;
      const desc = [head, work && work !== '0' ? work : null].filter(Boolean).join(': ') || null;
      out.push({ number: str(r.PERMITNO) ?? 'Permit number not published', issued: mdDay(r.ISSDATE), expires: null, status: str(r.STATUS), description: desc, costCents: mdDollarsToCents(r.EST_COST) });
    }
  }
  return { ...meta(id, 'ok', asOfIn), total, truncated: total > rows.length, rows: out.slice(0, MD_PERMITS_KEPT) };
}

function noticesPart(id: MdLayerId, layerName: string, key: string, got: MdFetched | undefined, asOfIn: AsOf): MdNoticesPart {
  if (!got || got.status !== 'ok') return { ...meta(id, failStatus(got), asOfIn), layer: layerName, truncated: false, rows: [] };
  const rows = featureAttrs(got.body);
  if (!rows) return { ...meta(id, 'failed', asOfIn), layer: layerName, truncated: false, rows: [] };
  const out: MdNoticeRow[] = [];
  for (const r of rows) {
    const bl = normalizeCityBlockLot(str(r.BLOCKLOT) ?? '');
    if (bl !== key) continue;
    out.push({
      number: str(r.NoticeNum) ?? 'Notice number not published',
      date: mdDay(r.DateNotice),
      type: str(r.NT),
      statusCode: null,
    });
  }
  return { ...meta(id, 'ok', asOfIn), layer: layerName, truncated: rows.length >= MD_NOTICE_ROWS, rows: out };
}

/** A part MAGE no longer reads (WIRE COMPATIBILITY): status 'failed', so every
 *  client says "not checked", with no rows, no as-of and its own source. */
function unreadPart(source: string, url: string): MdPartMeta & { truncated: false; rows: [] } {
  return { status: 'failed', asOf: null, asOfKind: 'unread', source, url, truncated: false, rows: [] };
}

function listPart<R>(id: MdLayerId, got: MdFetched | undefined, asOfIn: AsOf, map: (r: Raw) => R | null): MdListPart<R> {
  if (!got || got.status !== 'ok') return { ...meta(id, failStatus(got), asOfIn), truncated: false, rows: [] };
  const rows = featureAttrs(got.body);
  if (!rows) return { ...meta(id, 'failed', asOfIn), truncated: false, rows: [] };
  const out: R[] = [];
  for (const r of rows) { const x = map(r); if (x) out.push(x); }
  return { ...meta(id, 'ok', asOfIn), truncated: rows.length >= MD_OVERLAY_ROWS, rows: out };
}

const zoningCity = (r: Raw): MdZoningRow | null => {
  const code = str(r.Zoning) ?? str(r.Label);
  return code ? { code, overlay: str(r.overlay), pdfUrl: httpsUrl(r.URL) } : null;
};
const zoningCounty = (r: Raw): MdZoningRow | null => {
  const code = str(r.ZONE_DIST) ?? str(r.ZONE_CLASS);
  return code ? { code, overlay: null, pdfUrl: httpsUrl(r.URL) } : null;
};
/** Only an http(s) link to a government host is ever passed on; spaces encoded. */
function httpsUrl(v: unknown): string | null {
  const s = str(v, 500);
  // The host must BE baltimorecity.gov / baltimorecountymd.gov or a subdomain
  // of one (a dot before the domain), never a look-alike such as
  // evilbaltimorecity.gov; the S3 form is the City's path-style bucket.
  if (!s || !/^https?:\/\/(s3\.amazonaws\.com\/baltimorecity\.gov[a-z0-9.-]*|(?:[a-z0-9-]+\.)*baltimorecity\.gov|(?:[a-z0-9-]+\.)*baltimorecountymd\.gov)\//i.test(s)) return null;
  // The County's zoning PDFs are published as http:// and 302 to https://
  // (bcgis.baltimorecountymd.gov/ZoningReports/BR.pdf: https 200 application/pdf, checked 2026-09-28).
  return s.replace(/^http:\/\//i, 'https://').replace(/ /g, '%20');
}
const area = (nameF: string, codeF: string | null, listedF: string | null) => (r: Raw): MdAreaRow | null => {
  const name = str(r[nameF]);
  return name ? { name, code: codeF ? str(r[codeF]) : null, listed: listedF ? (mdDay(r[listedF]) ?? str(r[listedF])) : null } : null;
};
const flood = (r: Raw): MdFloodRow | null => {
  const zone = str(r.FLD_ZONE);
  const sf = str(r.SFHA_TF);
  return zone ? { zone, subtype: str(r.ZONE_SUBTY), sfha: sf === 'T' ? true : sf === 'F' ? false : null, bfe: bfeOrNull(r.STATIC_BFE), dfirmId: str(r.DFIRM_ID) } : null;
};

/** Every job's result → the record. Missing jobs are 'failed'. */
export function assembleMdRecord(args: {
  side: MdSide; key: string; fetchedAt: Date; label?: string | null;
  jobs: Partial<Record<MdJobId, MdFetched>>;
}): MdBuildingRecord {
  const { side, key, jobs } = args;
  const asOf = (id: MdLayerId): AsOf => {
    const got = jobs[`asof:${id}` as MdJobId];
    return got && got.status === 'ok' ? asOfFrom(id, got.body) : { asOf: null, asOfKind: 'unread' };
  };
  const city = side === 'baltimore_city';
  const parcel = parcelPart(side, key, jobs.parcel, city ? { asOf: null, asOfKind: 'none' } : asOf('K3'));
  const permits = permitsPart(side, key, jobs.permits_count, jobs.permits_rows, asOf(city ? 'C4' : 'K4'));
  const label = args.label ?? `${parcel.address ?? (city ? `Block-lot ${displayBlockLot(key)}` : 'Parcel')}, ${SIDE_NAME[side]}`;
  if (city) {
    return {
      jurisdiction: 'md', side, key, label, fetchedAt: args.fetchedAt.toISOString(),
      parcel, permits,
      vacantNotices: noticesPart('C6', 'Vacant building', key, jobs.vbn, asOf('C6')),
      housingNotices: MD_UNREAD_NOTICE_NAMES.map((name) => ({ ...unreadPart(MD_UNREAD_SOURCES.notices, MD_CODEMAP_URL), layer: name })),
      zoning: listPart('C8', jobs.zoning, asOf('C8'), zoningCity),
      historic: listPart('C9', jobs.historic, asOf('C9'), area('AREA_NAME', 'CHAPcode', null)),
      landmarks: unreadPart(MD_UNREAD_SOURCES.landmarks, OPEN_BALTIMORE_URL),
      nationalRegister: unreadPart(MD_UNREAD_SOURCES.nationalRegister, OPEN_BALTIMORE_URL),
      flood: listPart('C12', jobs.flood, asOf('C12'), flood),
      notChecked: [...MD_NOT_CHECKED_CITY],
      links: MD_LINKS_CITY.map((l) => ({ ...l })),
    };
  }
  return {
    jurisdiction: 'md', side, key, label, fetchedAt: args.fetchedAt.toISOString(),
    parcel, permits,
    vacantNotices: null,
    housingNotices: [],
    zoning: listPart('K5', jobs.zoning, asOf('K5'), zoningCounty),
    historic: listPart('K7', jobs.historic, asOf('K7'), area('DISTRICT', null, 'DATE_LISTE')),
    landmarks: null,
    nationalRegister: null,
    flood: listPart('K6', jobs.flood, asOf('K6'), flood),
    notChecked: [...MD_NOT_CHECKED_COUNTY],
    links: MD_LINKS_COUNTY.map((l) => ({ ...l })),
  };
}

/** Every part MAGE READS came back 'ok' AND its as-of read answered (the only
 *  kind index.ts caches): a record whose as-of reads were cut off by the
 *  deadline shows "as-of date not read" and must not be kept for the full TTL.
 *  The never-read wire parts (housingNotices, landmarks, nationalRegister; see
 *  WIRE COMPATIBILITY) are always 'failed' by design and do not count. */
export function mdRecordComplete(rec: MdBuildingRecord): boolean {
  const parts: MdPartMeta[] = [rec.parcel, rec.permits, rec.zoning, rec.historic, rec.flood];
  if (rec.vacantNotices) parts.push(rec.vacantNotices);
  return parts.every((p) => p.status === 'ok' && p.asOfKind !== 'unread');
}
