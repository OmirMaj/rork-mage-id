/**
 * Bet 1 — "The Building Prices Itself", first slice. BEHAVIOUR ONLY, no
 * snapshot (the goldens strip every 'scopegaps-' node, so THIS file is what
 * proves the building lines show up).
 *
 *  1. An NYC job whose building the contractor already confirmed: the record
 *     loads through the real hooks/useBuildingRecord (stubbed edge function,
 *     PLUTO yearBuilt 1931), and the Scope Code Gaps card shows the lead-safe
 *     line with "PLUTO lists built 1931" and "Needs price". Mounting the card
 *     never resolves or confirms a building.
 *  2. A Nassau County job with no year: the year row asks for one.
 *  3. Entering 1955 there: "You entered 1955", and the lead-safe line fires.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import { ScopeGapsCard } from '@/components/scopeGaps/ScopeGapsCard';
import { BUILDING_HEADER_NOTE, NEEDS_PRICE, YEAR_MISSING_ELSEWHERE } from '@/utils/buildingScopeCopy';
import type { Project } from '@/types';

const NYC_ID = '66666666-6666-4666-8666-666666666666';
const NASSAU_ID = '77777777-7777-4777-8777-777777777777';
const BIN = '4012345';
const BBL = '4001230045';

const base = world.project as unknown as Record<string, unknown>;
const nycProject = {
  ...base,
  id: NYC_ID,
  name: 'Astoria rowhouse',
  location: '25-10 30th Ave, New York, NY 11102',
  locationLatitude: undefined,
  locationLongitude: undefined,
  locationGeocodedAt: undefined,
  structuredAddress: { street: '25-10 30th Ave', city: 'New York', state: 'NY', zip: '11102' },
  description: 'Interior painting and trim, second floor.',
} as unknown as Project;
const nassauProject = {
  ...base,
  id: NASSAU_ID,
  name: 'Hempstead colonial',
  location: '12 Main St, Hempstead, NY 11550',
  locationLatitude: undefined,
  locationLongitude: undefined,
  locationGeocodedAt: undefined,
  structuredAddress: { street: '12 Main St', city: 'Hempstead', county: 'Nassau', state: 'NY', zip: '11550' },
  description: 'Interior painting, living and dining rooms.',
} as unknown as Project;

async function seedProjects() {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_projects')) ?? '[]');
  const list: Project[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const next = [...list.filter((p) => p.id !== NYC_ID && p.id !== NASSAU_ID), nycProject, nassauProject];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
  // The contractor confirmed this building earlier (the Building record card's tap).
  await AsyncStorage.setItem(`mageid_building_bin_${NYC_ID}`, JSON.stringify({
    bin: BIN, bbl: BBL, label: '25-10 30 AVENUE', borough: 'QUEENS', padVersion: '25b',
    lookupText: '25-10 30th Ave, New York, NY 11102',
  }));
}

const RECORD_JSON = {
  status: 'record',
  record: {
    jurisdiction: 'nyc', bin: BIN, bbl: BBL, label: '25-10 30 AVENUE', borough: 'QUEENS',
    fetchedAt: '2026-09-25T14:30:00.000Z',
    parcel: {
      status: 'ok', asOf: '2026-09-24T00:00:00.000Z', zoning: ['R6B'], overlays: [], specialDistricts: [], landmark: null,
      historicDistrict: null, floodZone2015: false, eDesignation: null, yearBuilt: 1931, numFloors: 3, bldgClass: 'C0', plutoVersion: '25v2',
    },
    datasets: [],
    ecbBalanceDue: null,
    ecbBalanceIsPartial: false,
    links: { bis: 'https://a810-bisweb.nyc.gov/', zola: 'https://zola.planning.nyc.gov/', dobNowPortal: 'https://a810-dobnow.nyc.gov/' },
    notChecked: ['HPD (housing maintenance)'],
  },
};

let invokeModes: string[] = [];

beforeEach(async () => {
  invokeModes = [];
  jest.spyOn(supabase.functions, 'invoke').mockImplementation((async (name: string, opts?: { body?: { mode?: string } }) => {
    if (name !== 'building-record') return { data: null, error: null };
    invokeModes.push(opts?.body?.mode ?? '');
    if (opts?.body?.mode === 'record') return { data: RECORD_JSON, error: null };
    return { data: { status: 'error', code: 'unexpected', error: 'not in this test' }, error: null };
  }) as never);
  await primeWorld('populated');
  await seedProjects();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function textOf(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, out)); return out; }
  const c = (node as { children?: unknown }).children;
  if (c) textOf(c, out);
  return out;
}

async function press(testID: string) {
  await act(async () => { fireEvent.press(screen.getByTestId(testID)); });
  await settle();
}

describe('Scope Code Gaps — building-age lines', () => {
  it('NYC, a loaded record (PLUTO 1931), painting scope: the lead-safe line with its PLUTO chip and Needs price', async () => {
    const tree = await mountRouteChecked('/smoke-bldg-nyc', () => <ScopeGapsCard mode="project" projectId={NYC_ID} />);
    await settle();
    expect(screen.getByTestId('scopegaps-bldg-rrp')).toBeTruthy();
    const text = textOf(tree.toJSON()).join('\n');
    expect(text).toContain('Lead-safe setup (EPA RRP)');
    expect(text).toContain('PLUTO lists built 1931');
    expect(text).toContain(NEEDS_PRICE);
    expect(text).toContain(BUILDING_HEADER_NOTE);
    // NYC and 1931: the asbestos survey reminder too, with the DOB-permit condition.
    expect(screen.getByTestId('scopegaps-bldg-acp5')).toBeTruthy();
    expect(text).toContain('If this project needs a DOB permit, NYC requires an asbestos investigation (ACP-5) first.');
    expect(text).not.toMatch(/has lead|contains asbestos|may contain lead/i);
    // Mounting the card loaded the confirmed building's record only — it never
    // resolved or confirmed a building.
    expect(invokeModes.every((m) => m === 'record')).toBe(true);
  });

  it('Nassau, no year: the year row asks; entering 1955 shows "You entered 1955" and the lead-safe line', async () => {
    const tree = await mountRouteChecked('/smoke-bldg-nassau', () => <ScopeGapsCard mode="project" projectId={NASSAU_ID} />);
    await settle();
    expect(screen.getByTestId('scopegaps-year-row')).toBeTruthy();
    expect(textOf(tree.toJSON()).join('\n')).toContain(YEAR_MISSING_ELSEWHERE);
    expect(screen.queryByTestId('scopegaps-bldg-rrp')).toBeNull();
    expect(invokeModes).toHaveLength(0);

    await press('scopegaps-year-enter');
    await act(async () => { fireEvent.changeText(screen.getByTestId('scopegaps-year-input'), '1955'); });
    await settle();
    expect(textOf(tree.toJSON()).join('\n')).toContain('Saved on this device.');
    await press('scopegaps-year-save');

    const text = textOf(tree.toJSON()).join('\n');
    expect(text).toContain('You entered 1955');
    expect(screen.getByTestId('scopegaps-bldg-rrp')).toBeTruthy();
    // Nassau is not NYC: no asbestos-survey line.
    expect(screen.queryByTestId('scopegaps-bldg-acp5')).toBeNull();
    const stored = JSON.parse((await AsyncStorage.getItem('mageid_building_year')) ?? '{}');
    expect(stored[NASSAU_ID]?.year).toBe(1955);
  });
});
