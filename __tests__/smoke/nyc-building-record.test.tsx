/**
 * NYC building record (lane L2) — BEHAVIOUR ONLY, no snapshot.
 *
 * The golden fixture job is in Portland, OR, and every existing phone golden
 * must stay byte-identical: the building-record surfaces render nothing
 * outside New York City. This file adds ONE NYC job (120 Broadway) to the
 * populated world and drives the real screens against a stubbed
 * `building-record` edge function:
 *
 *  1. /project-detail: the lookup is a tap, reaches "Is this the building?",
 *     and only after the contractor confirms does the record load — its
 *     headline, its "as of" lines and its "Not checked:" line, a failed
 *     dataset reading "not checked" and a full page reading "at least".
 *  2. /permits?projectId=<nyc> shows the NYC DOB department (212-393-2550).
 *  3. The permit form, with a number typed, shows "Check with DOB".
 *  4. The DOB status suggestion changes the FORM's status only — the permit
 *     is not written until he taps Save.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import {
  parseBuildingRecordResponse,
  summarizeBuildingRecord,
  suggestPermitStatusFromDob,
} from '@/utils/buildingRecord';
import { PERMIT_STATUS_INFO } from '@/mocks/permits';
import type { Project } from '@/types';

const NYC_ID = '55555555-5555-4555-8555-555555555555';
const BIN = '1001026';
const BBL = '1000477501';
const AS_OF = '2026-09-24T00:00:00.000Z';

const nycProject = {
  ...(world.project as any),
  id: NYC_ID,
  name: '120 Broadway lobby',
  location: '120 Broadway, New York, NY 10271',
  locationLatitude: undefined,
  locationLongitude: undefined,
  locationGeocodedAt: undefined,
  structuredAddress: { street: '120 Broadway', city: 'New York', state: 'NY', zip: '10271' },
} as unknown as Project;

async function seedNycProject() {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_projects')) ?? '[]');
  const list: Project[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const next = [...list.filter((p) => p.id !== NYC_ID), nycProject];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

const row = (primary: string, status: string | null, date: string | null) => ({
  primary, date, status, detail: null, amount: null,
});

const RECORD_JSON = {
  status: 'record',
  record: {
    jurisdiction: 'nyc',
    bin: BIN,
    bbl: BBL,
    label: '120 BROADWAY',
    borough: 'MANHATTAN',
    fetchedAt: '2026-09-25T14:30:00.000Z',
    parcel: {
      status: 'ok', asOf: AS_OF, zoning: ['C5-5'], overlays: [], specialDistricts: ['LM'], landmark: 'Equitable Building',
      historicDistrict: null, floodZone2015: false, eDesignation: null, yearBuilt: 1915, numFloors: 40, bldgClass: 'O4', plutoVersion: '25v2',
    },
    datasets: [
      {
        id: '3h2n-5cm9', name: 'DOB violations', url: 'https://data.cityofnewyork.us/d/3h2n-5cm9', asOf: AS_OF, status: 'ok',
        activeCount: 2, returned: 2, limit: 50, truncated: false, flags: [],
        rows: [row('V 120115-ELEV-01', 'ACTIVE', '2026-01-15'), row('V 031924-LL11-02', 'ACTIVE', '2024-03-19')],
      },
      {
        id: '6bgk-3dad', name: 'ECB violations', url: 'https://data.cityofnewyork.us/d/6bgk-3dad', asOf: null, status: 'failed',
        activeCount: null, returned: null, limit: 50, truncated: false, flags: [], rows: [],
      },
      {
        id: 'eabe-havv', name: 'DOB complaints', url: 'https://data.cityofnewyork.us/d/eabe-havv', asOf: AS_OF, status: 'ok',
        activeCount: 50, returned: 50, limit: 50, truncated: true, flags: [],
        rows: Array.from({ length: 3 }, (_, i) => row(`C ${1000 + i}`, 'ACTIVE', '2026-06-01')),
      },
    ],
    ecbBalanceDue: null,
    ecbBalanceIsPartial: false,
    links: {
      bis: `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${BIN}`,
      zola: `https://zola.planning.nyc.gov/l/lot/1/47/7501`,
      dobNowPortal: 'https://a810-dobnow.nyc.gov/publish/Index.html#!/',
    },
    notChecked: ['HPD (housing maintenance)', 'FDNY'],
  },
};

const CANDIDATES_JSON = {
  status: 'candidates',
  candidates: [{ bin: BIN, bbl: BBL, label: '120 BROADWAY', borough: 'MANHATTAN', padVersion: '25b' }],
  droppedPlaceholders: 0,
};

/** A DOB status text the L1 mapper turns into a suggestion that differs from
 *  a new permit's default status ('applied'). */
const SUGGEST_TEXT = ['Permit Issued', 'PERMIT ISSUED', 'Approved', 'APPROVED', 'Permit Entire', 'Issued', 'Signed Off']
  .find((t) => {
    const s = suggestPermitStatusFromDob(t).suggested;
    return !!s && s !== 'applied';
  }) ?? 'Permit Issued';

function permitJson(num: string) {
  return {
    status: 'permit',
    lookup: {
      permitNumber: num,
      matches: [{ datasetId: 'rbx6-tga4', datasetName: 'DOB NOW permits', asOf: AS_OF, number: num, statusText: SUGGEST_TEXT, date: '2026-08-02' }],
      failed: ['DOB job filings (BIS)'],
    },
  };
}

let invokeCalls: { name: string; body: any }[] = [];

beforeEach(async () => {
  invokeCalls = [];
  jest.spyOn(supabase.functions, 'invoke').mockImplementation((async (name: string, opts?: { body?: any }) => {
    const body = opts?.body ?? {};
    invokeCalls.push({ name, body });
    if (name !== 'building-record') return { data: null, error: null };
    if (body.mode === 'resolve') return { data: CANDIDATES_JSON, error: null };
    if (body.mode === 'record') return { data: RECORD_JSON, error: null };
    if (body.mode === 'permit') return { data: permitJson(body.permitNumber), error: null };
    if (body.mode === 'benchmark') return { data: { status: 'error', code: 'unavailable', error: 'x' }, error: null };
    return { data: null, error: null };
  }) as any);
  await primeWorld('populated');
  await seedNycProject();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function press(node: any) {
  await act(async () => { fireEvent.press(node); });
  await settle();
}

describe('NYC building record', () => {
  it('fixture sanity: the stubbed record parses and summarizes', () => {
    const parsed = parseBuildingRecordResponse(RECORD_JSON);
    expect(parsed.status).toBe('record');
  });

  it('tap to look up → confirm the building → the record, honestly labelled', async () => {
    await mountRouteChecked(`/project-detail?id=${NYC_ID}`);

    // Nothing is fetched until he taps.
    expect(invokeCalls.filter((c) => c.name === 'building-record')).toHaveLength(0);
    await press(screen.getByTestId('project-building-record-lookup'));
    expect(invokeCalls[0]?.body?.mode).toBe('resolve');

    expect(screen.getByText('Is this the building?')).toBeTruthy();
    expect(screen.getByText(`120 BROADWAY · MANHATTAN · BIN ${BIN}`)).toBeTruthy();
    // No record before he confirms.
    expect(invokeCalls.some((c) => c.body?.mode === 'record')).toBe(false);

    await press(screen.getByTestId(`project-building-record-candidate-${BIN}`));
    expect(invokeCalls.some((c) => c.body?.mode === 'record' && c.body.bin === BIN && c.body.bbl === BBL)).toBe(true);

    const parsed = parseBuildingRecordResponse(RECORD_JSON);
    const summary = summarizeBuildingRecord(parsed.status === 'record' ? parsed.record : null);
    expect(screen.getByTestId('project-building-record-headline').props.children).toBe(summary.headline);
    // Every summary line is on screen, verbatim.
    for (const line of summary.lines) expect(screen.getAllByText(line).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/as of/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Not checked:/).length).toBeGreaterThan(0);
    // The failed ECB dataset reads "not checked", never zero.
    expect(summary.lines.some((l) => /ECB/.test(l) && /not checked/.test(l))).toBe(true);
    // The full page of complaints reads "at least".
    expect(summary.lines.some((l) => /complaint/i.test(l) && /at least/.test(l))).toBe(true);
    expect(within(screen.getByTestId('project-building-record')).queryAllByText(/\bclean\b/i)).toHaveLength(0);
    expect(screen.getByText(/^Checked /)).toBeTruthy();

    // The confirmation persisted under mageid_building_bin_<projectId>.
    const stored = JSON.parse((await AsyncStorage.getItem(`mageid_building_bin_${NYC_ID}`)) ?? 'null');
    expect(stored).toMatchObject({ bin: BIN, bbl: BBL, lookupText: expect.any(String) });
  });

  it('the Portland job renders no building record and calls nothing', async () => {
    await mountRouteChecked(`/project-detail?id=${world.project.id}`);
    expect(screen.queryByTestId('project-building-record')).toBeNull();
    expect(invokeCalls.filter((c) => c.name === 'building-record')).toHaveLength(0);
  });

  it('/permits scoped to the NYC job shows the NYC DOB department', async () => {
    await mountRouteChecked(`/permits?projectId=${NYC_ID}`);
    expect(screen.getAllByText(/212-393-2550/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('permits-building-record')).toBeTruthy();
  });

  it('the permit form: Check with DOB, and the suggestion changes the form status only', async () => {
    await mountRouteChecked(`/permits?projectId=${NYC_ID}`);
    await press(screen.getByTestId('new-permit-btn'));
    expect(screen.queryByTestId('permit-check-dob')).toBeNull();

    const permitsBefore = await AsyncStorage.getItem('mageid_permits');
    const queueBefore = await AsyncStorage.getItem('mageid_offline_queue');

    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('e.g. BP-2026-04521'), 'B00123456-I1');
    });
    await settle();
    await press(screen.getByTestId('permit-check-dob'));
    expect(invokeCalls.some((c) => c.body?.mode === 'permit' && c.body.permitNumber === 'B00123456-I1')).toBe(true);

    expect(screen.getByText(`DOB NOW permits (as of 2026-09-24): '${SUGGEST_TEXT}' · 2026-08-02`)).toBeTruthy();
    expect(screen.getByText('DOB job filings (BIS): not checked')).toBeTruthy();

    const suggested = suggestPermitStatusFromDob(SUGGEST_TEXT).suggested!;
    const label = PERMIT_STATUS_INFO[suggested]?.label ?? suggested;
    expect(screen.getByText(`Set status to ${label}`)).toBeTruthy();
    const before = screen.queryAllByText(label).length;
    await press(screen.getByTestId('permit-dob-suggest'));
    // The status picker now reads the suggested status...
    expect(screen.queryAllByText(label).length).toBe(before + 1);
    expect(screen.queryByTestId('permit-dob-suggest')).toBeNull();
    // ...and nothing was written: no permit, no queued write.
    expect(await AsyncStorage.getItem('mageid_permits')).toBe(permitsBefore);
    expect(await AsyncStorage.getItem('mageid_offline_queue')).toBe(queueBefore);
  });
});
