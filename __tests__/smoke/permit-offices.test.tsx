/**
 * NY / NJ / CT permit office (lane B) — BEHAVIOUR ONLY, no snapshot.
 *
 * The golden fixture job is in Portland, OR, so every existing phone golden
 * stays byte-identical: DepartmentCard returns null for it before any hook,
 * and the place-lookup function is never called. This file adds tristate jobs
 * to the populated world and drives /permits against a stubbed `place-lookup`
 * edge function answering with Census geographies recorded on 2026-09-26:
 *
 *  1. Hoboken, NJ → the NJ DCA roster card (201-420-2066), sourced and dated.
 *  2. Garden City, NY → the Village of Garden City NAME-ONLY card, labelled
 *     "Contact details not verified by MAGE", with the village caution.
 *  3. A pin-only answer says "(from the map pin). Confirm."
 *  4. Census found nothing for a NY job → no office picked.
 *  5. The function failing → an honest "didn't look up" line, and the error is
 *     not cached: the next visit asks again.
 *  6. Portland → nothing rendered, nothing called.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { world } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import type { Project } from '@/types';

const NJ_ID = '66666666-6666-4666-8666-666666666601';
const NY_ID = '66666666-6666-4666-8666-666666666602';
// utils/placeLookup.ts remembers answers per address for the whole session,
// so each case that needs a fresh lookup gets its own address.
const NY_PIN_ID = '66666666-6666-4666-8666-666666666603';
const NY_NONE_ID = '66666666-6666-4666-8666-666666666604';
const NJ_FAIL_ID = '66666666-6666-4666-8666-666666666605';

function job(id: string, name: string, sa: { street: string; city: string; state: string; zip: string }): Project {
  return {
    ...(world.project as any),
    id,
    name,
    location: `${sa.street}, ${sa.city}, ${sa.state} ${sa.zip}`,
    locationLatitude: undefined,
    locationLongitude: undefined,
    locationGeocodedAt: undefined,
    structuredAddress: sa,
  } as unknown as Project;
}

async function seed(projects: Project[]) {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_projects')) ?? '[]');
  const list: Project[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
  const ids = new Set(projects.map((p) => p.id));
  const next = [...list.filter((p) => !ids.has(p.id)), ...projects];
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

const base = { status: 'ok', incorporatedPlace: null, cdp: null, matchedAddress: null, source: 'US Census Geocoder (Public_AR_Current, Current_Current)', asOf: '2026-09-26T00:00:00.000Z' };
const HOBOKEN = {
  ...base, state: 'NJ', match: 'address',
  county: { name: 'Hudson County', geoid: '34017' },
  town: { name: 'Hoboken city', basename: 'Hoboken', geoid: '3401732250', kind: 'city' },
  incorporatedPlace: { name: 'Hoboken city', basename: 'Hoboken', geoid: '3432250', kind: 'city' },
};
const GARDEN_CITY = {
  ...base, state: 'NY', match: 'address',
  county: { name: 'Nassau County', geoid: '36059' },
  town: { name: 'Hempstead town', basename: 'Hempstead', geoid: '3605934000', kind: 'town' },
  incorporatedPlace: { name: 'Garden City village', basename: 'Garden City', geoid: '3628178', kind: 'village' },
};

let calls: { name: string; body: any }[] = [];
let answer: (body: any) => { data: any; error: any } = () => ({ data: null, error: null });

beforeEach(async () => {
  calls = [];
  jest.spyOn(supabase.functions, 'invoke').mockImplementation((async (name: string, opts?: { body?: any }) => {
    calls.push({ name, body: opts?.body });
    if (name !== 'place-lookup') return { data: null, error: null };
    return answer(opts?.body);
  }) as any);
  await primeWorld('populated');
  await seed([
    job(NJ_ID, 'Hoboken brownstone', { street: '94 Washington St', city: 'Hoboken', state: 'NJ', zip: '07030' }),
    job(NY_ID, 'Garden City kitchen', { street: '11 Seventh St', city: 'Garden City', state: 'NY', zip: '11530' }),
    job(NY_PIN_ID, 'Levittown addition', { street: '3 Pin Ln', city: 'Levittown', state: 'NY', zip: '11756' }),
    job(NY_NONE_ID, 'Massapequa deck', { street: '9 Nowhere Rd', city: 'Massapequa', state: 'NY', zip: '11758' }),
    job(NJ_FAIL_ID, 'Jersey City fit-out', { street: '1 Failing Pl', city: 'Jersey City', state: 'NJ', zip: '07302' }),
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const lookups = () => calls.filter((c) => c.name === 'place-lookup');

describe('permit office outside NYC', () => {
  it('Hoboken shows the NJ DCA roster office, with its source and date', async () => {
    answer = () => ({ data: HOBOKEN, error: null });
    await mountRouteChecked(`/permits?projectId=${NJ_ID}`);
    expect(await screen.findByText('Hoboken City construction office')).toBeTruthy();
    expect(screen.getAllByText('201-420-2066').length).toBeGreaterThan(0);
    expect(screen.getByText(/Source: NJ DCA roster, as of 2026-09-02/)).toBeTruthy();
    expect(lookups()[0].body).toEqual({ address: '94 Washington St, Hoboken, NJ 07030', lat: null, lon: null });
  });

  it('Garden City shows a name-only village card that says it is unverified', async () => {
    answer = () => ({ data: GARDEN_CITY, error: null });
    await mountRouteChecked(`/permits?projectId=${NY_ID}`);
    expect(await screen.findByText('Village of Garden City')).toBeTruthy();
    expect(screen.getByText('Contact details not verified by MAGE')).toBeTruthy();
    expect(screen.getByText(/Villages usually run their own building department/)).toBeTruthy();
    expect(screen.queryByTestId('permits-department-phone')).toBeNull();
  });

  it('a pin-only answer says so and asks to confirm', async () => {
    answer = () => ({ data: { ...GARDEN_CITY, match: 'approximate', incorporatedPlace: null }, error: null });
    await mountRouteChecked(`/permits?projectId=${NY_PIN_ID}`);
    expect(await screen.findByText('Looks like Town of Hempstead (from the map pin). Confirm.')).toBeTruthy();
    expect(screen.getByText('Town of Hempstead Department of Buildings')).toBeTruthy();
  });

  it('Census found nothing for a NY job: no office is picked', async () => {
    answer = () => ({ data: { ...base, state: null, county: null, town: null, match: 'none' }, error: null });
    await mountRouteChecked(`/permits?projectId=${NY_NONE_ID}`);
    expect(await screen.findByText(/could be in a town or in one of its villages/)).toBeTruthy();
    expect(screen.queryByText('Village of Garden City')).toBeNull();
    expect(screen.queryByText(/Town of Hempstead/)).toBeNull();
  });

  it('a failed lookup says nothing was looked up, and is not cached', async () => {
    answer = () => ({ data: null, error: new Error('FunctionsHttpError') });
    const placeKeys = async () => (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('mageid_place_')).length;
    const before = await placeKeys();
    await mountRouteChecked(`/permits?projectId=${NJ_FAIL_ID}`);
    expect(await screen.findByText(/didn't look up the permit office/)).toBeTruthy();
    expect(await placeKeys()).toBe(before);
  });

  it('the Portland job renders no department and never calls place-lookup', async () => {
    answer = () => ({ data: HOBOKEN, error: null });
    await mountRouteChecked(`/permits?projectId=${world.project.id}`);
    expect(screen.queryByTestId('permits-department')).toBeNull();
    expect(screen.queryByTestId('permits-department-loading')).toBeNull();
    expect(lookups()).toHaveLength(0);
  });
});
