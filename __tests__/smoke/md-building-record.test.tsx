/**
 * Baltimore building record card (lane RECORD) — BEHAVIOUR ONLY, no snapshot.
 *
 * MdBuildingRecordCard rendered on its own from a mocked useMdBuildingRecord
 * state. The records are built by the SAME pure half the edge function runs
 * (supabase/functions/building-record/md.ts) and summarized by the one client
 * renderer, over bodies shaped like the live 2026-09-28 reads:
 *
 *  (a) ready City record with an open exterior notice: the notice number,
 *      date and raw DHCD status code, and no "No open notices".
 *  (b) the notices part failed: "not checked", never "No open notices".
 *  (c) an address outside both governments: the plain outside line, not an error.
 *  (d) a County record shows the County's permit STATUS verbatim and says
 *      code enforcement was not checked.
 *  (e) BuildingRecordCard sends a Maryland job to the MD card; a Portland job
 *      renders nothing.
 */

import React from 'react';
import { render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Project } from '@/types';
import { world } from '@/__tests__/fixtures/world';
import { assembleMdRecord, type MdFetched, type MdJobId } from '@/supabase/functions/building-record/md';
import { summarizeMdBuildingRecord, type MdBuildingRecord } from '@/utils/buildingRecord';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

let mockMd: Record<string, unknown> = {};
jest.mock('@/hooks/useMdBuildingRecord', () => ({
  useMdBuildingRecord: () => mockMd,
  MD_NO_MATCH_TEXT: 'No Baltimore parcel found at this address — nothing was checked.',
}));
// BuildingRecordCard's NYC hook: inert (no NYC job here).
jest.mock('@/hooks/useBuildingRecord', () => ({
  useBuildingRecord: () => ({ supported: false, phase: 'unsupported', summary: { kind: 'none', headline: '', lines: [], promptBlock: '', chipLabel: '', cacheKey: 'br:none' } }),
}));

// eslint-disable-next-line import/first
import { MdBuildingRecordCard } from '@/components/buildingRecord/MdBuildingRecordCard';
// eslint-disable-next-line import/first
import { BuildingRecordCard } from '@/components/buildingRecord/BuildingRecordCard';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const render = (ui: React.ReactElement) => rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

const FETCHED = new Date('2026-09-28T15:00:00Z');
const feats = (...rows: Record<string, unknown>[]) => ({ features: rows.map((attributes) => ({ attributes })) });
const empty = feats();
const layerJson = (edited?: number) => ({ ...(edited ? { editingInfo: { dataLastEditDate: edited } } : {}), fields: [{ name: 'OBJECTID' }] });
const stat = (ms: number) => feats({ mx: ms });

const CITY_BODIES: Partial<Record<MdJobId, unknown>> = {
  parcel: feats({ PIN: '4074C009', BLOCKLOT: '4074C009', BLOCK: '4074C', LOT: '009 ', FULLADDR: '620 E 31ST ST', ZIP_CODE: '21218', YEAR_BUILD: 1920, STRUCTAREA: 1372, ZONECODE: 'R-6  ', USEGROUP: 'R ', DWELUNIT: 1, VACIND: 'N', NEIGHBOR: 'BETTER WAVERLY', LDATE: '09272026' }),
  permits_count: { count: 1 },
  permits_rows: feats({ CaseNumber: 'BRCM-26-009216', Description: 'INSTALL 12 PLUMBING FIXTURES', IssuedDate: 1777953600000, ExpirationDate: 1793419200000, BLOCKLOT: '4074C009', Cost: 1000 }),
  vbn: empty,
  notice_1: empty,
  notice_2: empty,
  notice_3: empty,
  notice_4: feats({ NoticeNum: '2607703A', DateNotice: 1769006760000, NoticeType: 'Exterior', Status: 'NOTICE MAILED', BlockLot: '4074C009' }),
  // The live C8 URL at 620 E 31st St (fetched 2026-09-28).
  zoning: feats({ Zoning: 'R-6', overlay: ' ', Label: 'R-6', URL: 'https://s3.amazonaws.com/baltimorecity.gov.if-us-east-1/s3fs-public/2026-02/r5-10.pdf' }),
  historic: feats({ AREA_NAME: 'Better Waverly', CHAPcode: 'A29' }),
  landmarks: empty,
  national_register: empty,
  flood: empty,
  'asof:C4': stat(1790294400000),
  'asof:C6': stat(1790523180000),
  'asof:C7_1': stat(1790520000000),
  'asof:C7_2': stat(1790350000000),
  'asof:C7_3': stat(1790523180000),
  'asof:C7_4': stat(1790521800000),
  'asof:C8': layerJson(),
  'asof:C9': layerJson(1685990322999),
  'asof:C10': layerJson(),
  'asof:C11': layerJson(),
  'asof:C12': layerJson(1749503220000),
};
const COUNTY_BODIES: Partial<Record<MdJobId, unknown>> = {
  parcel: feats({ TAXPIN: '2200002965', DISTRICT: '03', PREMISE_ADDRESS: '9616 REISTERSTOWN RD', ZIP_CODE: '21117', YEAR_BUILT: '0000', STRCT_SQFT: 0, LU_CODE: 'COMMERCIAL', MAP: '0067', GRID: '0011', PARCEL: '0129', LOT: '   1A' }),
  permits_count: { count: 2 },
  permits_rows: feats(
    { PERMITNO: 'C26-00815', ISSDATE: 1790467200000, TYPEDESCRIPTION: 'Commercial Alteration', DESC_WORK: 'Change of occupancy with interior alterations', STATUS: 'ISSUE', EST_COST: '1000000.00' },
    { PERMITNO: 'COO25-0328', ISSDATE: 1757376000000, TYPEDESCRIPTION: 'Commercial COO', DESC_WORK: 'Seasonal retail', STATUS: 'CLOSED', EST_COST: '1500.00' },
  ),
  zoning: feats({ ZONE_CLASS: 'BR', ZONE_DIST: 'BR IM', DIST_CODE: 'IM', URL: null }),
  historic: empty,
  flood: feats({ FLD_ZONE: 'X', ZONE_SUBTY: 'AREA OF MINIMAL FLOOD HAZARD', SFHA_TF: 'F', STATIC_BFE: -9999, DFIRM_ID: '240010' }),
  'asof:K3': layerJson(),
  'asof:K4': feats({ MX: 1790467200000 }),
  'asof:K5': layerJson(),
  'asof:K6': layerJson(),
  'asof:K7': layerJson(),
};

function jobs(bodies: Partial<Record<MdJobId, unknown>>, over: Partial<Record<MdJobId, MdFetched>> = {}): Partial<Record<MdJobId, MdFetched>> {
  const out: Partial<Record<MdJobId, MdFetched>> = {};
  for (const [k, v] of Object.entries(bodies)) out[k as MdJobId] = { status: 'ok', body: v };
  return { ...out, ...over };
}
const cityRecord = (over: Partial<Record<MdJobId, MdFetched>> = {}) =>
  assembleMdRecord({ side: 'baltimore_city', key: '4074C009', fetchedAt: FETCHED, jobs: jobs(CITY_BODIES, over) }) as unknown as MdBuildingRecord;
const countyRecord = () =>
  assembleMdRecord({ side: 'baltimore_county', key: '2200002965', fetchedAt: FETCHED, jobs: jobs(COUNTY_BODIES) }) as unknown as MdBuildingRecord;

function readyState(rec: MdBuildingRecord) {
  return {
    supported: true,
    phase: 'ready',
    candidates: [],
    confirmed: { side: rec.side, key: rec.key, label: rec.label, lat: 39.326, lon: -76.608, lookupText: 'x' },
    record: rec,
    summary: summarizeMdBuildingRecord(rec),
    side: rec.side,
    error: null,
    outside: null,
    lookup: jest.fn(),
    confirm: jest.fn(),
    changeBuilding: jest.fn(),
    refresh: jest.fn(),
  };
}

function project(location: string, state: string): Project {
  return {
    ...(world.project as object),
    id: `md-${state}`,
    location,
    locationLatitude: undefined,
    locationLongitude: undefined,
    structuredAddress: undefined,
  } as unknown as Project;
}
const MD_JOB = project('620 E 31st St, Baltimore, MD 21218', 'MD');

const allText = () => screen.toJSON() ? JSON.stringify(screen.toJSON()) : '';

describe('Baltimore building record card', () => {
  it('(a) ready City record with an open notice: number, date, raw DHCD status code; never "No open notices"', () => {
    mockMd = readyState(cityRecord());
    render(<MdBuildingRecordCard project={MD_JOB} />);
    expect(screen.getByTestId('mdrecord-card')).toBeTruthy();
    expect(screen.getByTestId('mdrecord-side').props.children).toBe('Baltimore City');
    expect(screen.getByTestId('mdrecord-headline').props.children).toBe(
      'Baltimore City records list open notices for this parcel: 1 exterior notice (as of 2026-09-27).',
    );
    expect(screen.getByText(/^Open exterior notice 2607703A, dated 2026-01-21, DHCD status code: NOTICE MAILED/)).toBeTruthy();
    expect(screen.getByText(/^BRCM-26-009216 · issued 2026-05-05 · expires 2026-10-31/)).toBeTruthy();
    expect(screen.getByText(/^Exterior work here needs CHAP approval/)).toBeTruthy();
    expect(screen.getByText(/^Not checked: Permits issued before 2019/)).toBeTruthy();
    expect(screen.getByText('E-Permits search')).toBeTruthy();
    // The zoning district PDF the City's zoning layer links (spec GOAL).
    expect(screen.getByTestId('mdrecord-link-0')).toBeTruthy();
    expect(screen.getByText('R-6 zoning district (PDF)')).toBeTruthy();
    expect(screen.getByText('Change building')).toBeTruthy();
    expect(allText()).not.toMatch(/No open notices listed/);
    expect(allText()).not.toMatch(/\bclean\b|no violations|not vacant|not historic|no flood risk/i);
  });

  it('(b) the notices part failed: "not checked", never "No open notices"', () => {
    mockMd = readyState(cityRecord({ notice_4: { status: 'timeout' }, notice_2: { status: 'failed' } }));
    render(<MdBuildingRecordCard project={MD_JOB} />);
    expect(screen.getByTestId('mdrecord-headline').props.children).toBe('Some Baltimore City datasets could not be fully checked for this parcel; see below.');
    expect(screen.getByText("Couldn't read the exterior notices in the City inspections map feed (not a published dataset) — not checked")).toBeTruthy();
    expect(screen.getByText("Couldn't read the interior/exterior notices in the City inspections map feed (not a published dataset) — not checked")).toBeTruthy();
    expect(allText()).not.toMatch(/No open notices listed/);
    expect(allText()).not.toMatch(/No open (interior\/exterior|exterior) notices/);
  });

  it('(c) an address outside both governments: the plain outside line, not an error', () => {
    mockMd = { ...readyState(cityRecord()), phase: 'idle', record: null, confirmed: null, side: null, summary: summarizeMdBuildingRecord(null), outside: { county: 'Anne Arundel County' } };
    render(<MdBuildingRecordCard project={MD_JOB} />);
    expect(screen.getByTestId('mdrecord-outside').props.children).toBe(
      'MAGE reads live building records for Baltimore City and Baltimore County only. This address is in Anne Arundel County.',
    );
    expect(screen.queryByTestId('mdrecord-error')).toBeNull();
    expect(screen.queryByTestId('mdrecord-headline')).toBeNull();
  });

  it('(d) a County record shows the County permit STATUS verbatim and says code enforcement was not checked', () => {
    mockMd = readyState(countyRecord());
    render(<MdBuildingRecordCard project={MD_JOB} />);
    expect(screen.getByTestId('mdrecord-side').props.children).toBe('Baltimore County');
    expect(screen.getByTestId('mdrecord-headline').props.children).toBe(
      'Baltimore County parcel, permits, zoning, flood map and historic districts read (as of 2026-09-27). Code enforcement not checked.',
    );
    expect(screen.getByText(/^C26-00815 · issued 2026-09-27 · County status ISSUE/)).toBeTruthy();
    expect(screen.getByText(/^COO25-0328 · issued 2025-09-09 · County status CLOSED/)).toBeTruthy();
    expect(screen.getByText('Year built not recorded, so MAGE can\'t say whether pre-1978 lead rules apply.')).toBeTruthy();
    expect(screen.getByText('Citizen Access (code enforcement)')).toBeTruthy();
    expect(screen.getByText(/^Flood zone X on FEMA's map, outside its mapped 1% and 0\.2% annual-chance flood areas/)).toBeTruthy();
    expect(allText()).not.toMatch(/minimal|reduced flood risk/i);
    expect(allText()).not.toMatch(/2200002965/);
  });

  it('(e) BuildingRecordCard sends a Maryland job to the MD card; a Portland job renders nothing', () => {
    mockMd = readyState(cityRecord());
    const md = render(<BuildingRecordCard project={MD_JOB} />);
    expect(screen.getByTestId('mdrecord-card')).toBeTruthy();
    md.unmount();
    mockMd = { ...readyState(cityRecord()), supported: false, phase: 'unsupported' };
    render(<BuildingRecordCard project={project('1234 SE Main St, Portland, OR 97214', 'OR')} />);
    expect(screen.queryByTestId('mdrecord-card')).toBeNull();
    expect(screen.queryByTestId('building-record')).toBeNull();
  });
});
