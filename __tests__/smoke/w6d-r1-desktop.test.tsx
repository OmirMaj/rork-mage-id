/**
 * Wave 6d, lane R1 — Contacts and Crew as desktop-web REGISTERS, in the real
 * app (the provider stack, the populated fixture world plus three contacts and
 * three crew members) at 1512 × 945 with useIsDesktopWeb() forced on.
 *
 * Behaviour, not pixels: the register mounts instead of the phone list, rows
 * are 36 px, a row click writes ?contactId= / ?crewId= and opens the record
 * beside the list, the guarded close asks "Discard changes?" while the crew
 * inline editor is open, bulk Delete (contacts) confirms with the count and
 * removes EVERY selected contact from the device, crew bulk Delete is
 * disabled with its reason, bulk Mark inactive writes every selected member,
 * and Export CSV names its file by the local day.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, SMOKE_USER } from '@/__tests__/fixtures/world';

// ── The layout gate: a width + a web flag, exactly like the app's hook ──────
let mockWidth = 390;
let mockHeight = 844;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
    const isTablet = !isDesktop && mockWidth >= 768;
    return {
      screenSize: isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone',
      isPhone: !isDesktop && !isTablet,
      isTablet,
      isDesktop,
      width: mockWidth,
      height: mockHeight,
      contentMaxWidth: isDesktop ? 1280 : isTablet ? 900 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// useIsDesktopWeb() FORCED on at desktop width. RN-web cannot run a full route
// inside this native harness (app/_layout.tsx reads window.location), so the
// desktop-web cases keep Platform.OS native and force only this switch — the
// g-logs-phone-identical pattern.
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => actual.useIsDesktop() };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
// 'web' here is the browser's LAYOUT gate (mockWeb: web >= 900 is desktop),
// with Platform.OS left native: a full route cannot mount on RN-web inside this
// harness (app/_layout.tsx reads window.location). useIsDesktopWeb() is false
// either way below 900, which is exactly what a 390 / 768 browser sees.
function env(os: 'ios' | 'android' | 'web', width: number, height: number) {
  restoreOS?.();
  const platform = os === 'web' ? 'ios' : os;
  restoreOS = platform === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', platform).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = os === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Two clocks, both pinned (see w6c-field-phone for why the outer realm's
// Date.now — the one renderRouter's fake timers start from — is pinned too).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T16:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
let fromSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  allowConsoleErrors();
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  fromSpy?.mockRestore();
  fromSpy = null;
  restoreOS?.();
  restoreOS = null;
});

const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

// ── Records the populated world leaves empty ────────────────────────────────
const C1 = 'con-r1-1';
const contacts = [
  { id: C1, firstName: 'Ava', lastName: 'Linden', companyName: 'Linden Household', role: 'Client', email: 'ava@linden.test', phone: '(555) 201-0001', address: '14 Birch Ln', notes: 'Prefers texts after 5 pm.', linkedProjectIds: [PROJECT_ID], createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z' },
  { id: 'con-r1-2', firstName: 'Noor', lastName: 'Haddad', companyName: 'Kestrel Architects', role: 'Architect', email: 'noor@kestrel.test', phone: '', address: '', notes: '', linkedProjectIds: [], createdAt: '2026-08-02T12:00:00.000Z', updatedAt: '2026-08-02T12:00:00.000Z' },
  { id: 'con-r1-3', firstName: '', lastName: '', companyName: 'County Building Dept', role: 'Inspector', email: '', phone: '(555) 201-0003', address: '', notes: '', linkedProjectIds: [], createdAt: '2026-08-03T12:00:00.000Z', updatedAt: '2026-08-03T12:00:00.000Z' },
];

// The crew roster comes from the server read (an empty answer is
// authoritative and clears the device cache), so it is served by the stubbed
// `crew_members` SELECT — snake_case rows, as CrewContext.mapRow reads them.
const crewRows = [
  { id: 'crew-r1-1', user_id: SMOKE_USER.id, created_at: '2026-08-01T12:00:00.000Z', updated_at: '2026-08-01T12:00:00.000Z', full_name: 'Maria Gonzalez', trades: ['Electrical', 'Low voltage'], phone: '(555) 301-0001', email: 'maria@crew.test', status: 'active', id_verified: true, id_type: 'drivers_license', id_masked_last4: '4821', id_expiry: '2030-04-30', id_issuer: 'CA DMV', id_scanned_at: '2026-08-01T12:00:00.000Z', is_public: false, project_ids: [PROJECT_ID] },
  { id: 'crew-r1-2', user_id: SMOKE_USER.id, created_at: '2026-08-02T12:00:00.000Z', updated_at: '2026-08-02T12:00:00.000Z', full_name: 'Deon Parks', trades: ['Framing'], phone: null, email: null, status: 'inactive', id_verified: false, is_public: false, project_ids: [] },
  { id: 'crew-r1-3', user_id: SMOKE_USER.id, created_at: '2026-08-03T12:00:00.000Z', updated_at: '2026-08-03T12:00:00.000Z', full_name: 'Lena Brandt', trades: [], phone: '(555) 301-0003', email: null, status: 'active', id_verified: false, claimed_by_user_id: '99999999-9999-4999-8999-999999999999', claimed_at: '2026-08-05T12:00:00.000Z', is_public: false, project_ids: [] },
];

function serveCrew() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sb = require('@/lib/supabase') as { supabase: { from: (t?: string) => unknown } };
  const orig = sb.supabase.from;
  fromSpy = jest.spyOn(sb.supabase, 'from').mockImplementation((table?: string) => {
    if (table !== 'crew_members') return orig(table);
    let isWrite = false;
    let single = false;
    const target: Record<string, unknown> = {
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        const data = isWrite ? null : single ? crewRows[0] : crewRows;
        return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 0, status: 200, statusText: 'OK' }).then(ok, bad);
      },
    };
    const proxy: unknown = new Proxy(target, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'insert' || prop === 'update' || prop === 'upsert' || prop === 'delete') isWrite = true;
        if (prop === 'single' || prop === 'maybeSingle') single = true;
        return () => proxy;
      },
    });
    return proxy;
  });
}

async function seed() {
  await AsyncStorage.setItem('mageid_contacts', JSON.stringify(contacts));
  serveCrew();
}

async function mountAt(os: 'ios' | 'android' | 'web', width: number, height: number, url: string) {
  env(os, width, height);
  await primeWorld('populated');
  await seed();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}


async function desk(url: string) {
  env('ios', 1512, 945);
  await primeWorld('populated');
  await seed();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

type Btn = { text: string; style?: string; onPress?: () => void };
function alertSpy() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const alertMod = require('@/utils/alert') as typeof import('@/utils/alert');
  return jest.spyOn(alertMod, 'showAlert').mockImplementation(() => undefined);
}
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('lane R1 — Contacts register, desktop web 1512', () => {
  jest.setTimeout(120000);

  it('mounts the register (no phone search), rows are 36 px', async () => {
    await desk('/contacts');
    expect(screen.getByTestId('contacts-register')).toBeTruthy();
    expect(screen.getByTestId('contacts-register-table')).toBeTruthy();
    expect(screen.queryByTestId('contacts-search')).toBeNull();
    const row = screen.getByTestId(`contacts-register-table-row-${C1}`);
    expect(flat(row.props.style).minHeight).toBe(36);
  });

  it('a row click writes ?contactId= and opens the record beside the list', async () => {
    const tree = await desk('/contacts');
    await act(async () => { fireEvent.press(screen.getByTestId('contacts-register-table-row-con-r1-2')); });
    await pump(3);
    expect(tree.getSearchParams()).toMatchObject({ contactId: 'con-r1-2' });
    expect(screen.getByTestId('contacts-register-record')).toBeTruthy();
    expect(screen.getAllByText('noor@kestrel.test').length).toBeGreaterThan(0);
  });

  it('?contactId= opens that record on arrival', async () => {
    await desk(`/contacts?contactId=${C1}`);
    expect(screen.getByTestId('contacts-register-record')).toBeTruthy();
    expect(screen.getAllByText('ava@linden.test').length).toBeGreaterThan(0);
  });

  it('bulk Delete confirms with the count, then removes EVERY selected contact', async () => {
    const spy = alertSpy();
    try {
      await desk('/contacts');
      await act(async () => { fireEvent.press(screen.getByTestId(`contacts-register-table-row-${C1}-check`)); });
      await act(async () => { fireEvent.press(screen.getByTestId('contacts-register-table-row-con-r1-3-check')); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByText('Delete')); });
      const call = spy.mock.calls.find((c) => c[0] === 'Delete 2 contacts?');
      expect(call).toBeTruthy();
      const buttons = call![2] as Btn[];
      await act(async () => { buttons.find((b) => b.style === 'destructive')!.onPress?.(); });
      await pump(4);
      expect(screen.queryByTestId(`contacts-register-table-row-${C1}`)).toBeNull();
      expect(screen.queryByTestId('contacts-register-table-row-con-r1-3')).toBeNull();
      expect(screen.getByTestId('contacts-register-table-row-con-r1-2')).toBeTruthy();
      // …and on the device, not only on screen (one delete per render).
      const saved = JSON.parse((await AsyncStorage.getItem('mageid_contacts')) ?? '[]') as { id: string }[];
      expect(saved.map((c) => c.id)).toEqual(['con-r1-2']);
    } finally {
      spy.mockRestore();
    }
  });

  it('Export CSV names the file contacts-YYYY-MM-DD.csv on the local day', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pf = require('@/utils/platformFile') as typeof import('@/utils/platformFile');
    const spy = jest.spyOn(pf, 'deliverTextFile').mockResolvedValue(undefined as never);
    try {
      await desk('/contacts');
      await act(async () => { fireEvent.press(screen.getByTestId('contacts-register-csv')); });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(`contacts-${localDay(new Date())}.csv`);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('lane R1 — Crew register, desktop web 1512', () => {
  jest.setTimeout(120000);

  it('mounts the register (no phone roster), rows are 36 px', async () => {
    await desk('/crew');
    expect(screen.getByTestId('crew-register')).toBeTruthy();
    expect(screen.queryByLabelText('Open Maria Gonzalez')).toBeNull();
    expect(flat(screen.getByTestId('crew-register-table-row-crew-r1-1').props.style).minHeight).toBe(36);
  });

  it('a row click writes ?crewId= and opens the member beside the list', async () => {
    const tree = await desk('/crew');
    await act(async () => { fireEvent.press(screen.getByTestId('crew-register-table-row-crew-r1-1')); });
    await pump(3);
    expect(tree.getSearchParams()).toMatchObject({ crewId: 'crew-r1-1' });
    expect(screen.getByTestId('crew-register-record')).toBeTruthy();
    expect(screen.getByTestId('edit-crew-details')).toBeTruthy();
  });

  it('with the inline editor open, another row and the close both ask "Discard changes?" first', async () => {
    const spy = alertSpy();
    try {
      const tree = await desk('/crew?crewId=crew-r1-1');
      await act(async () => { fireEvent.press(screen.getByTestId('edit-crew-details')); });
      await pump(2);
      expect(screen.getByTestId('crew-edit-name')).toBeTruthy();
      await act(async () => { fireEvent.press(screen.getByTestId('crew-register-table-row-crew-r1-3')); });
      await pump(2);
      expect(spy.mock.calls.filter((c) => c[0] === 'Discard changes?')).toHaveLength(1);
      expect(tree.getSearchParams()).toMatchObject({ crewId: 'crew-r1-1' });
      // The close: narrow the split to its single mode, where "Back to list" is the close.
      await act(async () => {
        fireEvent(screen.getByTestId('crew-register-split'), 'layout', { nativeEvent: { layout: { width: 1000, height: 800, x: 0, y: 0 } } });
      });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByTestId('crew-register-split-back')); });
      await pump(2);
      const asks = spy.mock.calls.filter((c) => c[0] === 'Discard changes?');
      expect(asks).toHaveLength(2);
      expect(tree.getSearchParams()).toMatchObject({ crewId: 'crew-r1-1' });
      // Discard is what closes it.
      await act(async () => { (asks[1][2] as Btn[])[1].onPress?.(); });
      await pump(3);
      expect(tree.getSearchParams().crewId).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('bulk Delete is disabled and says why', async () => {
    const spy = alertSpy();
    try {
      await desk('/crew');
      await act(async () => { fireEvent.press(screen.getByTestId('crew-register-table-row-crew-r1-1-check')); });
      await pump(2);
      await act(async () => { fireEvent.press(screen.getByText('Delete')); });
      expect(spy).toHaveBeenCalledWith('Delete', 'Delete crew one at a time — it offers Mark inactive first and purges a kept ID photo.');
      expect(screen.getByTestId('crew-register-table-row-crew-r1-1')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('bulk Mark inactive writes EVERY selected member', async () => {
    await desk('/crew');
    await act(async () => { fireEvent.press(screen.getByTestId('crew-register-table-row-crew-r1-1-check')); });
    await act(async () => { fireEvent.press(screen.getByTestId('crew-register-table-row-crew-r1-3-check')); });
    await pump(2);
    await act(async () => { fireEvent.press(screen.getByText('Mark inactive')); });
    await pump(4);
    const saved = JSON.parse((await AsyncStorage.getItem(`mageid_crew_members_${SMOKE_USER.id}`)) ?? '[]') as { id: string; status: string }[];
    const status = Object.fromEntries(saved.map((m) => [m.id, m.status]));
    expect(status).toEqual({ 'crew-r1-1': 'inactive', 'crew-r1-2': 'inactive', 'crew-r1-3': 'inactive' });
  });
});
