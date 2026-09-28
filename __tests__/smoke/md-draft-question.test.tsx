/**
 * Baltimore "Draft a question" and Department card (lane AIDRAFT) —
 * BEHAVIOUR ONLY, no snapshot.
 *
 * Rendered on their own with the building-record hook, the place lookup and
 * the AI relay stubbed (no network). The department rows are the REAL
 * verified Baltimore City / Baltimore County rows in utils/codeJurisdiction.ts.
 *
 *  (a) City job, matched permit: the drafted prompt carries the permit number
 *      and "Baltimore City", and no "DOB".
 *  (b) County job: routes to a PAI channel.
 *  (c) MD job with no county, place lookup 24510: the Department card shows
 *      "E-Permits portal".
 *  (d) Record failed: the prompt says "not checked".
 *  (e) NYC REGRESSION: a NY job whose typed address misses the NYC row, place
 *      lookup answering Kings County (36047), renders the NYC card WITH its
 *      pin headline (the Maryland-only re-resolve did not run).
 *  (f) "620 E 31st St, Baltimore, MD 21218" (location only) renders the DHCD
 *      card on path 1, with no place lookup at all.
 *  (g) A plain "Baltimore, MD" job: Draft a question renders (not null) and,
 *      with place lookup 24005, routes to PAI.
 */

import React from 'react';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Project } from '@/types';
import { world } from '@/__tests__/fixtures/world';
import { departmentFor, resolveCodeJurisdiction } from '@/utils/codeJurisdiction';
import { mdOfficeChannels } from '@/utils/departmentQuestion';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});
jest.mock('expo-mail-composer', () => ({ isAvailableAsync: async () => false, composeAsync: async () => ({}) }));

const mockPrompts: string[] = [];
jest.mock('@/utils/mageAI', () => ({
  mageAISmart: async (prompt: string) => {
    mockPrompts.push(prompt);
    return { success: true, data: { subject: 'Question on the job', body: 'Body text.' } };
  },
}));

type Lookup = { status: 'idle' | 'loading' | 'done' | 'error'; place: unknown };
const mockLookupCalls: unknown[] = [];
let mockLookup: Lookup = { status: 'idle', place: null };
jest.mock('@/utils/placeLookup', () => ({
  usePlaceLookup: (q: unknown) => {
    if (q) mockLookupCalls.push(q);
    return q ? mockLookup : { status: 'idle', place: null };
  },
}));

let mockJob: Record<string, unknown> = {};
jest.mock('@/hooks/useJobBuildingRecord', () => ({ useJobBuildingRecord: () => mockJob }));
// The NYC inner component's hook: inert here (no NYC job drafts in this file).
jest.mock('@/hooks/useBuildingRecord', () => ({
  useBuildingRecord: () => ({ record: null, summary: { kind: 'none', headline: '', lines: [], promptBlock: '', chipLabel: '', cacheKey: 'br:none' } }),
}));

// eslint-disable-next-line import/first
import { DraftQuestionButton } from '@/components/buildingRecord/DraftQuestionButton';
// eslint-disable-next-line import/first
import { DepartmentCard } from '@/components/buildingRecord/DepartmentCard';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const render = (ui: React.ReactElement) => rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

const NONE_SUMMARY = { kind: 'none', headline: '', lines: [], promptBlock: '', chipLabel: '', cacheKey: 'br:none' };

function project(id: string, location: string, structuredAddress?: Record<string, string>): Project {
  return {
    ...(world.project as object),
    id,
    name: 'Baltimore job',
    location,
    locationLatitude: undefined,
    locationLongitude: undefined,
    locationGeocodedAt: undefined,
    structuredAddress,
  } as unknown as Project;
}

type Side = 'baltimore_city' | 'baltimore_county';
function jobState(opts: { side?: Side | null; permits?: 'ok' | 'failed' | null; rows?: unknown[] } = {}) {
  const side = opts.side ?? null;
  const ready = !!side && opts.permits !== null && opts.permits !== undefined;
  const record = ready ? {
    jurisdiction: 'md', side, label: 'x', fetchedAt: '2026-09-28',
    permits: { status: opts.permits, asOf: '2026-09-25', total: (opts.rows ?? []).length, truncated: false, rows: opts.rows ?? [] },
    notChecked: [],
  } : null;
  const summary = ready
    ? { ...NONE_SUMMARY, promptBlock: 'BUILDING RECORD (Baltimore open data fixture):\nHeadline\nRULES: Never tell the contractor the building is free of problems.' }
    : NONE_SUMMARY;
  mockJob = {
    supported: true,
    jurisdiction: side,
    phase: ready ? 'ready' : 'idle',
    summary,
    asOf: ready ? '2026-09-25' : null,
    sourceLabel: side === 'baltimore_county' ? "Baltimore County's open data" : "Baltimore City's open data",
    notCheckedHeadline: '',
    attentionNote: '',
    confirmedCounty: null,
    nyc: {},
    md: { supported: true, phase: ready ? 'ready' : 'idle', side, record, summary },
  };
}

const CENSUS = { status: 'ok', town: null, incorporatedPlace: null, cdp: null, matchedAddress: null, match: 'address', source: 'US Census Geocoder', asOf: '2026-09-28T00:00:00.000Z' };
const CITY_PLACE = { ...CENSUS, state: 'MD', county: { name: 'Baltimore city', geoid: '24510' } };
const COUNTY_PLACE = { ...CENSUS, state: 'MD', county: { name: 'Baltimore County', geoid: '24005' } };

const CITY_DEPT = departmentFor(resolveCodeJurisdiction({ state: 'MD', city: 'Baltimore', county: 'Baltimore city' }));
const COUNTY_DEPT = departmentFor(resolveCodeJurisdiction({ state: 'MD', city: 'Towson', county: 'Baltimore County' }));

async function draft(testID: string) {
  fireEvent.press(screen.getByTestId(testID));
  fireEvent.changeText(screen.getByTestId(`${testID}-question`), 'Can we start framing before the final plan comments?');
  await act(async () => { fireEvent.press(screen.getByTestId(`${testID}-draft`)); });
  return mockPrompts[mockPrompts.length - 1] ?? '';
}

beforeEach(() => {
  mockPrompts.length = 0;
  mockLookupCalls.length = 0;
  mockLookup = { status: 'idle', place: null };
  jobState();
});

describe('Baltimore: Draft a question and the Department card', () => {
  it('the verified Baltimore rows carry department blocks', () => {
    expect(CITY_DEPT).toBeTruthy();
    expect(COUNTY_DEPT).toBeTruthy();
  });

  it('(a) City job with a matched permit: the prompt has the number and "Baltimore City", never DOB', async () => {
    jobState({ side: 'baltimore_city', permits: 'ok', rows: [{ number: 'BRCM-2025-01234', issued: '2025-06-02', expires: null, status: null, description: 'Rear deck' }] });
    const p = project('md-a', '620 E 31st St, Baltimore, MD 21218', { street: '620 E 31st St', city: 'Baltimore', state: 'MD', zip: '21218', county: 'Baltimore city' });
    render(<DraftQuestionButton project={p} permitNumbers={['BRCM-2025-01234']} testID="dq" />);
    const prompt = await draft('dq');
    expect(prompt).toContain('BRCM-2025-01234');
    expect(prompt).toContain('Baltimore City');
    expect(prompt).not.toMatch(/\bDOB\b/);
    expect(screen.getByTestId('dq-to').props.children).toMatch(/^No applicant is published in Baltimore City's permits open data/);
  });

  it('(b) County job: routes to a PAI channel', async () => {
    jobState({ side: 'baltimore_county', permits: 'ok', rows: [] });
    const p = project('md-b', '400 Washington Ave, Towson, MD 21204', { street: '400 Washington Ave', city: 'Towson', state: 'MD', zip: '21204', county: 'Baltimore County' });
    render(<DraftQuestionButton project={p} testID="dq" />);
    const prompt = await draft('dq');
    const first = mdOfficeChannels(COUNTY_DEPT!)[0];
    expect(screen.getByTestId('dq-to').props.children).toContain(`Baltimore County ${first.label}`);
    expect(prompt).toContain('Baltimore County');
    expect(prompt).toContain('This job has no permit number in MAGE');
    expect(prompt).not.toMatch(/\bDOB\b/);
  });

  it('(c) no county, place lookup 24510: the Department card shows "E-Permits portal"', () => {
    mockLookup = { status: 'done', place: CITY_PLACE };
    render(<DepartmentCard project={project('md-c', 'Baltimore, MD')} testID="dc" />);
    expect(screen.getByText('E-Permits portal')).toBeTruthy();
    expect(screen.queryByText('DOB NOW portal')).toBeNull();
    expect(mockLookupCalls.length).toBeGreaterThan(0);
  });

  it('(d) record failed: the prompt says "not checked"', async () => {
    jobState({ side: 'baltimore_city', permits: 'failed', rows: [] });
    const p = project('md-d', '620 E 31st St, Baltimore, MD 21218', { street: '620 E 31st St', city: 'Baltimore', state: 'MD', zip: '21218', county: 'Baltimore city' });
    render(<DraftQuestionButton project={p} permitNumbers={['BRCM-2025-01234']} testID="dq" />);
    const prompt = await draft('dq');
    expect(prompt).toContain('- Filing: not checked.');
    expect(prompt).not.toContain('BRCM-2025-01234 issued');
  });

  it('(e) NYC regression: a Kings County answer still renders the NYC card with its headline', () => {
    // A map-pin answer, so the 'nyc' branch's pin headline is visible.
    mockLookup = { status: 'done', place: { ...CENSUS, match: 'approximate', state: 'NY', county: { name: 'Kings County', geoid: '36047' } } };
    const p = project('ny-e', '12 Nowhere Row, Hamletville, NY 11299', { street: '12 Nowhere Row', city: 'Hamletville', state: 'NY', zip: '11299' });
    render(<DepartmentCard project={p} testID="dc" />);
    expect(screen.getByTestId('dc-headline').props.children).toMatch(/New York City \(from the map pin\)/);
    expect(screen.getByText('DOB NOW portal')).toBeTruthy();
    expect(screen.getByText(/on nyc\.gov$/)).toBeTruthy();
  });

  it('(f) a location-only City ZIP job renders the DHCD card on path 1, no place lookup', () => {
    render(<DepartmentCard project={project('md-f', '620 E 31st St, Baltimore, MD 21218')} testID="dc" />);
    expect(screen.getByText('E-Permits portal')).toBeTruthy();
    expect(screen.queryByTestId('dc-headline')).toBeNull();
    expect(mockLookupCalls).toHaveLength(0);
  });

  it('(g) a plain "Baltimore, MD" job drafts (not null) and, with lookup 24005, routes to PAI', async () => {
    mockLookup = { status: 'done', place: COUNTY_PLACE };
    render(<DraftQuestionButton project={project('md-g', 'Baltimore, MD')} testID="dq" />);
    expect(screen.getByTestId('dq')).toBeTruthy();
    const prompt = await draft('dq');
    expect(screen.getByTestId('dq-to').props.children).toContain('Baltimore County');
    expect(prompt).toContain('Baltimore County');
    expect(prompt).toContain('- Filing: not checked.');
    expect(prompt).not.toMatch(/\bDOB\b/);
  });

  it('(g2) the same job with no county answer yet renders nothing (never an unverified office)', () => {
    mockLookup = { status: 'loading', place: null };
    render(<DraftQuestionButton project={project('md-g2', 'Baltimore, MD')} testID="dq" />);
    expect(screen.queryByTestId('dq')).toBeNull();
  });
});
