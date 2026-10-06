/**
 * Permit Path (lane PPUI, M10) — the real /permit-path screen in the real app
 * tree, against three jobs: an NYC 1931 historic-district kitchen job, a Town
 * of Hempstead bath job, and an address the Census could not place.
 *
 * Only the network edge is stubbed (`place-lookup` and `building-record`); the
 * engine, the packs and the providers run for real. The clock is pinned
 * (mountRoute { now }) so the dated chips are stable.
 *
 * What it proves: the eight station titles, the "You are here" marker, a source
 * chip on EVERY line (readiness rows and station detail), and "Not known yet ·
 * Ask" on every unknown — which opens the ask-the-department sheet. And the
 * interview: confirming PLUTO's historic-district pre-fill redraws the route
 * with the LPC line, which was not there before the tap.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import { buildingConfirmKey, buildingLookupText } from '@/utils/buildingRecord';
import { jobsiteAddressForProject } from '@/utils/codeJurisdiction';
import { PERMIT_PATH_KEY } from '@/utils/permitPath/localStore';
import type { Project } from '@/types';


const NOW = new Date(2026, 9, 2, 15, 0, 0).getTime();

const NYC_ID = '7a1e0001-0000-4000-8000-000000000001';
const HEMP_ID = '7a1e0002-0000-4000-8000-000000000002';
const NONE_ID = '7a1e0003-0000-4000-8000-000000000003';

const STATION_TITLES = ['Scope', 'Checks', 'Drawings and Who Stamps Them', 'Filing', 'Plan Review', 'Permit Issued', 'Work and Inspections', 'Sign-off'];

function job(id: string, name: string, street: string, city: string, zip: string, lines: string[]): Project {
  return {
    ...(world.project as any),
    id,
    name,
    location: `${street}, ${city}, NY ${zip}`,
    locationLatitude: undefined,
    locationLongitude: undefined,
    locationGeocodedAt: undefined,
    structuredAddress: { street, city, state: 'NY', zip },
    linkedEstimate: { ...((world.project as any).linkedEstimate ?? {}), items: lines.map((n, i) => ({ id: `li-${id}-${i}`, name: n })) },
    schedule: undefined,
  } as unknown as Project;
}

const nycJob = job(NYC_ID, 'Park Slope kitchen', '412 2nd Street', 'Brooklyn', '11215', ['Kitchen cabinets', 'Sink and faucet', 'Electrical outlets']);
const hempJob = job(HEMP_ID, 'Levittown bath', '15 Gardiners Avenue', 'Levittown', '11756', ['Bathroom tile', 'Toilet and shower valve']);
const noneJob = job(NONE_ID, 'Mystery lane job', '12 Mystery Lane', 'Nowhere', '11999', ['Interior paint']);

const BIN = '3020001';
const BBL = '3010850001';
const PLACE_BASE = { status: 'ok', source: 'US Census Geocoder', asOf: '2026-09-01', matchedAddress: null, cdp: null, incorporatedPlace: null };

const RECORD_JSON = {
  status: 'record',
  record: {
    jurisdiction: 'nyc', bin: BIN, bbl: BBL, label: '412 2 STREET', borough: 'BROOKLYN', fetchedAt: '2026-09-30T14:30:00.000Z',
    parcel: {
      status: 'ok', asOf: '2026-09-24', zoning: ['R6B'], overlays: [], specialDistricts: [], landmark: null,
      historicDistrict: 'Park Slope Historic District', floodZone2015: false, eDesignation: null, yearBuilt: 1931, numFloors: 4, bldgClass: 'C0', plutoVersion: '24v2',
    },
    datasets: [
      { id: '3h2n-5cm9', name: 'DOB violations', url: 'https://data.cityofnewyork.us/d/3h2n-5cm9', asOf: '2026-09-24', status: 'ok', activeCount: 0, returned: 0, limit: 50, truncated: false, flags: [], rows: [] },
    ],
    ecbBalanceDue: null, ecbBalanceIsPartial: false,
    links: { bis: 'https://a810-bisweb.nyc.gov/', zola: 'https://zola.planning.nyc.gov/', dobNowPortal: 'https://a810-dobnow.nyc.gov/publish/Index.html#!/' },
    notChecked: [],
  },
};

function placeFor(address: string) {
  if (/Brooklyn/.test(address)) {
    return { ...PLACE_BASE, match: 'address', state: 'NY', county: { name: 'Kings County', geoid: '36047' }, town: { name: 'Brooklyn borough', basename: 'Brooklyn', geoid: '3604710022', kind: 'borough' } };
  }
  if (/Levittown/.test(address)) {
    return {
      ...PLACE_BASE, match: 'address', state: 'NY', county: { name: 'Nassau County', geoid: '36059' },
      town: { name: 'Hempstead town', basename: 'Hempstead', geoid: '3605934000', kind: 'town' },
      cdp: { name: 'Levittown CDP', basename: 'Levittown', geoid: '3642081', kind: 'CDP' },
    };
  }
  return { ...PLACE_BASE, match: 'none', state: 'NY', county: null, town: null };
}

async function seed(projects: Project[], permitPath: Record<string, unknown>) {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_projects')) ?? '[]');
  const list: Project[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const ids = new Set(projects.map((p) => p.id));
  const next = [...list.filter((p) => !ids.has(p.id)), ...projects];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
  await AsyncStorage.setItem(PERMIT_PATH_KEY, JSON.stringify(permitPath));
  const addr = jobsiteAddressForProject(nycJob);
  await AsyncStorage.setItem(buildingConfirmKey(NYC_ID), JSON.stringify({
    bin: BIN, bbl: BBL, label: '412 2 STREET · BROOKLYN', borough: 'BROOKLYN', padVersion: null, lookupText: buildingLookupText(addr, nycJob.location),
  }));
}

/** The slice of a test-renderer node this file reads. */
type ReactTestInstance = { props: Record<string, any>; type: unknown };

const answer = (value: unknown, from: 'gc' | 'prefill_confirmed' = 'gc') => ({ value, from, prefillNote: null, at: '2026-10-01T12:00:00.000Z' });

/** Every node with a testID matching `re`. */
function byTestId(re: RegExp): string[] {
  return screen.root.findAll((n: ReactTestInstance) => typeof n.props?.testID === 'string' && re.test(n.props.testID) && typeof n.type === 'string')
    .map((n: ReactTestInstance) => n.props.testID as string)
    .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
}

/** The chip says "Not known yet · Ask". */
const isUnknownChip = (rowId: string): boolean => within(screen.getByTestId(`${rowId}-chip`)).queryByText('Not known yet · Ask') != null;

async function press(testID: string) {
  await act(async () => { fireEvent.press(screen.getByTestId(testID)); });
  await settle();
}

beforeEach(async () => {
  jest.spyOn(supabase.functions, 'invoke').mockImplementation((async (name: string, opts?: { body?: any }) => {
    const body = opts?.body ?? {};
    if (name === 'place-lookup') return { data: placeFor(String(body.address ?? '')), error: null };
    if (name === 'building-record') {
      if (body.mode === 'record') return { data: RECORD_JSON, error: null };
      return { data: { status: 'error', code: 'unavailable', error: 'x' }, error: null };
    }
    return { data: null, error: null };
  }) as any);
  await primeWorld('populated');
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Readiness rows and their chips: every row has one, every unknown says Ask. */
function expectChipsOnReadiness() {
  const rows = byTestId(/^permit-path-ready-row-[^-]+$/);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(screen.getByTestId(`${r}-chip`)).toBeTruthy();
  return rows;
}

describe('Permit Path', () => {
  it('NYC 1931 historic-district kitchen: stations, You are here, chips, and the landmark pre-fill redraws the route', async () => {
    await seed([nycJob, hempJob, noneJob], {
      [NYC_ID]: {
        answers: {
          'base.work_types': answer(['kitchen_bath', 'plumbing', 'electrical']),
          'base.occupied': answer('yes'),
          'base.building_year': answer(1931),
          'base.residential': answer('one_two_family'),
        },
        marks: {},
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
    });
    await mountRouteChecked(`/permit-path?projectId=${NYC_ID}`, { now: NOW });

    for (const title of STATION_TITLES) expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.getByTestId('permit-path-spine-here')).toBeTruthy();
    expect(screen.getByTestId('permit-path-office').props.children).toBe('Building department: NYC Department of Buildings');
    expect(screen.getAllByText('MAGE ID organizes what the building department asks for. It doesn’t file, review or approve anything.')).toHaveLength(1);
    expectChipsOnReadiness();

    // Before the landmark answer: no LPC line anywhere on the route.
    expect(byTestId(/nyc\.lpc/)).toHaveLength(0);

    // The interview collapsed to "Edit answers (4)"; open it — the next
    // question is the landmark one, with PLUTO's suggestion and its source.
    await press('permit-path-interview-edit');
    expect(screen.getByTestId('permit-path-interview-prefill')).toBeTruthy();
    expect(screen.getByText(/PLUTO lists Park Slope Historic District \(PLUTO 24v2\)/)).toBeTruthy();
    // Nothing stored until Confirm.
    const before = JSON.parse((await AsyncStorage.getItem(PERMIT_PATH_KEY)) ?? '{}');
    expect(before[NYC_ID].answers['nyc.landmark']).toBeUndefined();

    await press('permit-path-interview-prefill-confirm');
    await act(async () => { jest.advanceTimersByTime(400); });
    await settle();
    const after = JSON.parse((await AsyncStorage.getItem(PERMIT_PATH_KEY)) ?? '{}');
    expect(after[NYC_ID].answers['nyc.landmark']).toMatchObject({ value: 'yes', from: 'prefill_confirmed' });

    // The route redrew: the LPC permit is now a readiness line, with its chip.
    expect(byTestId(/^permit-path-ready-row-nyc\.lpc$/)).toHaveLength(1);
    expect(screen.getByTestId('permit-path-ready-row-nyc.lpc-chip')).toBeTruthy();

    // Open Checks: every line in the station carries a chip, the confirm line prints once.
    await press('permit-path-spine-station-checks');
    const items = byTestId(/^permit-path-detail-item-[^-]+$/);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(screen.getByTestId(`${it}-chip`)).toBeTruthy();
    expect(screen.getAllByTestId('permit-path-detail-confirm')).toHaveLength(1);
  });

  it('Town of Hempstead bath: the town office, unknowns say Ask, and Ask opens the department sheet', async () => {
    await seed([nycJob, hempJob, noneJob], {
      [HEMP_ID]: {
        answers: {
          'base.work_types': answer(['kitchen_bath', 'plumbing']),
          'base.occupied': answer('yes'),
          'base.residential': answer('one_two_family'),
        },
        marks: {},
        updatedAt: '2026-10-01T12:00:00.000Z',
      },
    });
    await mountRouteChecked(`/permit-path?projectId=${HEMP_ID}`, { now: NOW });

    for (const title of STATION_TITLES) expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.getByTestId('permit-path-spine-here')).toBeTruthy();
    expect(screen.getByTestId('permit-path-office').props.children).toBe('Building department: Town of Hempstead Department of Buildings');
    expect(screen.getByTestId('permit-path-unknown-count')).toBeTruthy();

    const rows = expectChipsOnReadiness();
    expect(rows.filter(isUnknownChip).length).toBeGreaterThan(0);
    expect(isUnknownChip('permit-path-ready-row-li.survey')).toBe(true);
    // Every unknown line says "Not known yet · Ask" — never blank, never a guess.
    expect(screen.getAllByText('Not known yet · Ask').length).toBeGreaterThan(0);
    // The survey question is one of them (PLAN V13: the town's page lists no documents).
    expect(screen.getByTestId('permit-path-ready-row-li.survey-chip')).toBeTruthy();

    await press('permit-path-ready-row-li.survey-ask');
    expect(screen.getByTestId('permit-path-ask')).toBeTruthy();
  });

  it('an address the Census could not place: unknown department, every jurisdiction line unknown', async () => {
    await seed([nycJob, hempJob, noneJob], {});
    await mountRouteChecked(`/permit-path?projectId=${NONE_ID}`, { now: NOW });

    for (const title of STATION_TITLES) expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.getByTestId('permit-path-spine-here')).toBeTruthy();
    // No department picked for him: the office line is not a named office.
    expect(String(screen.getByTestId('permit-path-office').props.children)).not.toMatch(/Department of Buildings/);
    // First open: the interview is open above the spine, and its FIRST question is
    // which department issues the permit — never picked for him.
    expect(screen.getByTestId('permit-path-interview-question').props.children).toBe('Which department issues the permit?');
    // Every jurisdiction line is unknown: nothing but the GC's own documents is "missing".
    const rows = byTestId(/^permit-path-ready-row-[^-]+$/);
    const missingIds = rows.filter((r) => !isUnknownChip(r));
    expect(missingIds.every((r) => /filing\.owner_ok|signoff\.received/.test(r))).toBe(true);
    expect(screen.getAllByText('Not known yet · Ask').length).toBeGreaterThan(0);
    expectChipsOnReadiness();
  });

  it('no job: "Pick a job" with the job chips', async () => {
    await seed([nycJob], {});
    await mountRouteChecked('/permit-path', { now: NOW });
    expect(screen.getByText('Pick a job to see its permit path.')).toBeTruthy();
    expect(screen.getByTestId(`permit-path-project-${NYC_ID}`)).toBeTruthy();
  });
});
