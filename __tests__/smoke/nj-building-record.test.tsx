/**
 * NJ building record (lane N) — BEHAVIOUR ONLY, no snapshot.
 *
 * Adds ONE New Jersey job (94 Washington St, Hoboken) to the populated world
 * and drives the real /project-detail screen against a stubbed
 * `building-record` edge function whose answers are built by the SAME pure
 * half the function runs (supabase/functions/building-record/nj.ts) over the
 * live fixtures the probe recorded on 2026-09-26:
 *
 *  1. idle → tap → candidates (0905_199_1 first, as 'address', NOT picked) →
 *     his tap confirms → the record's headline and every summary line.
 *  2. A failed permits fetch reads "not checked", never zero.
 *  3. The NYC job and the Portland job get no NJ node and no NJ call.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import { summarizeNjBuildingRecord, type NjBuildingRecord } from '@/utils/buildingRecord';
import {
  addressKey,
  assembleNjRecord,
  censusFirstMatch,
  failedNjPermits,
  normalizeNjFreshness,
  normalizeNjPermits,
  rankNjCandidates,
} from '@/supabase/functions/building-record/nj';
import type { Project } from '@/types';

const census = require('@/scripts/fixtures/building-record/nj-census.json');
const parcel = require('@/scripts/fixtures/building-record/nj-parcel.json');
const permitsFx = require('@/scripts/fixtures/building-record/nj-permits.json');
const freshFx = require('@/scripts/fixtures/building-record/nj-freshness.json');

const NJ_ID = '66666666-6666-4666-8666-666666666666';
const NYC_ID = '55555555-5555-4555-8555-555555555555';
const FETCHED = new Date('2026-09-26T12:00:00Z');
const LOOKUP_TEXT = '94 Washington St, Hoboken, NJ 07030';

const base = {
  ...(world.project as any),
  locationLatitude: undefined,
  locationLongitude: undefined,
  locationGeocodedAt: undefined,
};
const njProject = {
  ...base,
  id: NJ_ID,
  name: 'Hoboken brownstone',
  location: LOOKUP_TEXT,
  structuredAddress: { street: '94 Washington St', city: 'Hoboken', state: 'NJ', zip: '07030' },
} as unknown as Project;
const nycProject = {
  ...base,
  id: NYC_ID,
  name: '120 Broadway lobby',
  location: '120 Broadway, New York, NY 10271',
  structuredAddress: { street: '120 Broadway', city: 'New York', state: 'NY', zip: '10271' },
} as unknown as Project;

async function seedProjects() {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_projects')) ?? '[]');
  const list: Project[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const next = [...list.filter((p) => p.id !== NJ_ID && p.id !== NYC_ID), njProject, nycProject];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

const key = addressKey(censusFirstMatch(census)?.matchedAddress);
const CANDIDATES = rankNjCandidates(parcel, key, 'nearby');
const permits = normalizeNjPermits(permitsFx.rows, '199', '1', permitsFx.asOfHeader, FETCHED);
const fresh = normalizeNjFreshness(freshFx.rows);
const RECORD: NjBuildingRecord = assembleNjRecord({
  muniCode: '0905', block: '199', lot: '1', fetchedAt: FETCHED, muniName: permits.muniName ?? fresh.muniName,
  permits: permits.dataset, muniLastReport: { status: fresh.status, date: fresh.date },
});
const FAILED_RECORD: NjBuildingRecord = { ...RECORD, permits: failedNjPermits('failed') };

let invokeCalls: { name: string; body: any }[] = [];
let recordReply: NjBuildingRecord = RECORD;

beforeEach(async () => {
  invokeCalls = [];
  recordReply = RECORD;
  jest.spyOn(supabase.functions, 'invoke').mockImplementation((async (name: string, opts?: { body?: any }) => {
    const body = JSON.parse(JSON.stringify(opts?.body ?? {}));
    invokeCalls.push({ name, body });
    if (name !== 'building-record') return { data: null, error: null };
    if (body.mode === 'nj_resolve') return { data: { status: 'nj_candidates', candidates: CANDIDATES }, error: null };
    if (body.mode === 'nj_record') return { data: { status: 'nj_record', record: recordReply }, error: null };
    if (body.mode === 'benchmark') return { data: { status: 'error', code: 'unavailable', error: 'x' }, error: null };
    return { data: { status: 'candidates', candidates: [], droppedPlaceholders: 0 }, error: null };
  }) as any);
  await primeWorld('populated');
  await seedProjects();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function press(node: any) {
  await act(async () => { fireEvent.press(node); });
  await settle();
}

const njCalls = () => invokeCalls.filter((c) => c.name === 'building-record' && String(c.body?.mode ?? '').startsWith('nj_'));

describe('NJ building record', () => {
  it('fixture sanity: 0905_199_1 leads as an address match among several lots', () => {
    expect(CANDIDATES[0]).toMatchObject({ pin: '0905_199_1', match: 'address', block: '199', lot: '1' });
    expect(CANDIDATES.length).toBeGreaterThan(1);
    expect(summarizeNjBuildingRecord(RECORD).kind).toBe('listed');
  });

  it('tap to look up → candidates (not picked) → confirm → the record lines', async () => {
    await mountRouteChecked(`/project-detail?id=${NJ_ID}`);
    const card = screen.getByTestId('njrecord-card');
    expect(card).toBeTruthy();
    // Nothing is fetched until he taps.
    expect(njCalls()).toHaveLength(0);

    await press(screen.getByTestId('njrecord-lookup'));
    expect(njCalls()[0]?.body).toEqual({ mode: 'nj_resolve', text: LOOKUP_TEXT, lat: null, lon: null });

    expect(screen.getByText('Which tax lot is the job?')).toBeTruthy();
    expect(screen.getByText('Block 199 Lot 1 · 94 WASHINGTON ST · Hoboken City')).toBeTruthy();
    expect(within(screen.getByTestId('njrecord-candidate-1')).getByText(/\(near the address — confirm it's your lot\)$/)).toBeTruthy();
    // Even the one address match waits for his tap.
    expect(njCalls().some((c) => c.body.mode === 'nj_record')).toBe(false);
    expect(screen.queryByTestId('njrecord-headline')).toBeNull();

    await press(screen.getByTestId('njrecord-candidate-0'));
    expect(njCalls().some((c) => c.body.mode === 'nj_record' && c.body.muniCode === '0905' && c.body.block === '199' && c.body.lot === '1')).toBe(true);

    const summary = summarizeNjBuildingRecord(RECORD);
    expect(screen.getByTestId('njrecord-headline').props.children).toBe(summary.headline);
    summary.lines.forEach((line, i) => {
      expect(screen.getByTestId(`njrecord-line-${i}`).props.children).toBe(line);
    });
    expect(screen.getAllByText(/^Not checked:/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('njrecord-dataset')).toBeTruthy();
    expect(within(screen.getByTestId('njrecord-card')).queryAllByText(/\b(clean|all clear|compliant|no issues)\b/i)).toHaveLength(0);
    // The NYC card body never renders for an NJ job.
    expect(screen.queryByTestId('project-building-record')).toBeNull();

    const stored = JSON.parse((await AsyncStorage.getItem(`mageid_building_parcel_${NJ_ID}`)) ?? 'null');
    expect(stored).toMatchObject({ muniCode: '0905', block: '199', lot: '1', lookupText: LOOKUP_TEXT });
  });

  it('a failed permits fetch reads "not checked", never zero', async () => {
    recordReply = FAILED_RECORD;
    await AsyncStorage.setItem(`mageid_building_parcel_${NJ_ID}`, JSON.stringify({
      muniCode: '0905', muniName: 'HOBOKEN CITY', block: '199', lot: '1', qualifier: null, propLoc: '94 WASHINGTON ST', lookupText: LOOKUP_TEXT,
    }));
    await mountRouteChecked(`/project-detail?id=${NJ_ID}`);
    // The confirmed lot loads on its own; no resolve.
    expect(njCalls().some((c) => c.body.mode === 'nj_resolve')).toBe(false);
    expect(screen.getByTestId('njrecord-line-0').props.children).toBe('NJ Construction Permit Data: not checked (the request failed)');
    expect(screen.getByTestId('njrecord-headline').props.children).toMatch(/could not be fully checked/);
    expect(within(screen.getByTestId('njrecord-card')).queryAllByText(/\b0 permits|No permits/)).toHaveLength(0);
  });

  it('the NYC job keeps its NYC card and makes no NJ call', async () => {
    await mountRouteChecked(`/project-detail?id=${NYC_ID}`);
    expect(screen.queryByTestId('njrecord-card')).toBeNull();
    expect(screen.getByTestId('project-building-record')).toBeTruthy();
    expect(njCalls()).toHaveLength(0);
  });

  it('the Portland job renders no building record and calls nothing', async () => {
    await mountRouteChecked(`/project-detail?id=${world.project.id}`);
    expect(screen.queryByTestId('njrecord-card')).toBeNull();
    expect(screen.queryByTestId('project-building-record')).toBeNull();
    expect(invokeCalls.filter((c) => c.name === 'building-record')).toHaveLength(0);
  });
});
