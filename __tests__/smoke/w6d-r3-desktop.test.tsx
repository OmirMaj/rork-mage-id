/**
 * Wave 6d, lane R3 — the Pipeline, Deliveries and Documents as desktop-web
 * REGISTERS, in the real app (the provider stack, the populated fixture world
 * plus five leads, four deliveries, two subs and two COIs) at 1512 × 945 with
 * useIsDesktopWeb() forced on.
 *
 * Behaviour, not pixels: the register mounts instead of the phone screen; the
 * Pipeline board's five columns are sized by leadsBoardLayout (235 at a 1224
 * container, 188 at 992, a sideways scroll only below 948); the KPI win rate is
 * the phone formula, and Board / List persists; the list's rows link to
 * /lead-detail?leadId=; Add by hand PUSHES /lead-detail?mode=new; Deliveries
 * shows Late above the horizon, a row Confirm and a bulk Confirm write EVERY
 * selected load to the device, Mark received in bulk is off with its reason;
 * Documents rows link where each record lives (a COI keeps its sub), and every
 * CSV names its file by the local day.
 */

import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, world } from '@/__tests__/fixtures/world';

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
const leads = [
  { id: 'lead-r3-new', name: 'Rosa Whitfield', phone: '(555) 401-0001', projectType: 'Kitchen remodel', budgetMin: 60000, budgetMax: 80000, source: 'houzz', stage: 'new', score: 8, receivedAt: '2026-09-25T11:00:00.000Z', touches: [], createdAt: '2026-09-25T11:00:00.000Z', updatedAt: '2026-09-25T11:00:00.000Z' },
  { id: 'lead-r3-qual', name: 'Omar Beck', email: 'omar@beck.test', projectType: 'Bathroom', source: 'referral', stage: 'qualified', score: 5, receivedAt: '2026-08-10T12:00:00.000Z', firstRespondedAt: '2026-08-10T14:00:00.000Z', touches: [], createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z' },
  { id: 'lead-r3-prop', name: 'Priya Nair', projectType: 'Two-story addition', source: 'website', stage: 'proposal', receivedAt: '2026-08-01T12:00:00.000Z', firstRespondedAt: '2026-08-01T13:00:00.000Z', touches: [], createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-05T12:00:00.000Z' },
  { id: 'lead-r3-won', name: 'Hal Moreno', source: 'repeat', stage: 'won', receivedAt: '2026-07-20T12:00:00.000Z', firstRespondedAt: '2026-07-20T16:00:00.000Z', touches: [], createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-28T12:00:00.000Z' },
  { id: 'lead-r3-lost', name: 'Dana Kerr', source: 'angi', stage: 'lost', receivedAt: '2026-07-10T12:00:00.000Z', touches: [], createdAt: '2026-07-10T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z' },
];
// The screens read the fake-timer clock renderRouter starts from GOLDEN_CLOCK
// (2026-09-25T16:00Z): the dates below are relative to that day.
const D_LATE = 'dlv-r3-late';
const D_SOON = 'dlv-r3-soon';
const D_SOON2 = 'dlv-r3-soon2';
const deliveries = [
  { id: D_LATE, projectId: PROJECT_ID, description: '14 windows', supplier: 'Pella Supply', poNumber: 'PO-1182', expectedDate: '2026-09-22', status: 'scheduled', createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z' },
  { id: D_SOON, projectId: PROJECT_ID, description: 'Roof trusses', supplier: 'Truss Co', window: '07:00-11:00', expectedDate: '2026-09-28', status: 'scheduled', createdAt: '2026-08-02T12:00:00.000Z', updatedAt: '2026-08-02T12:00:00.000Z' },
  { id: D_SOON2, projectId: PROJECT_ID, description: 'Tile, 40 boxes', supplier: 'Tile Depot', expectedDate: '2026-09-27', status: 'scheduled', createdAt: '2026-08-02T12:00:00.000Z', updatedAt: '2026-08-02T12:00:00.000Z' },
  { id: 'dlv-r3-conf', projectId: PROJECT_ID, description: 'Drywall, 120 sheets', supplier: 'Gypsum Depot', expectedDate: '2026-09-29', status: 'confirmed', confirmedAt: '2026-08-10T12:00:00.000Z', createdAt: '2026-08-03T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z' },
];
const subs = [
  { id: 'sub-r3-1', companyName: 'Harbor Electric', contactName: 'Lou Park', phone: '', email: '', address: '', trade: 'Electrical', licenseNumber: 'E-100', w9OnFile: true, coiExpiry: '2027-01-31', createdAt: '2026-07-01T12:00:00.000Z', updatedAt: '2026-07-01T12:00:00.000Z' },
  { id: 'sub-r3-2', companyName: 'Stone Ridge Plumbing', contactName: 'Mae Stone', phone: '', email: '', address: '', trade: 'Plumbing', licenseNumber: 'P-200', w9OnFile: false, createdAt: '2026-07-02T12:00:00.000Z', updatedAt: '2026-07-02T12:00:00.000Z' },
];
const cois = [
  { id: 'coi-r3-1', subcontractorId: 'sub-r3-1', projectId: PROJECT_ID, fileUri: 'sub-documents:sub-r3-1/coi-coi-r3-1.pdf', uploadedAt: '2026-08-05T12:00:00.000Z',
    validation: { validatedAt: '2026-08-05T12:05:00.000Z', overallStatus: 'fail', issues: [{ code: 'additional_insured_missing', severity: 'critical', message: 'Additional insured is missing.' }] },
    coverages: [{ type: 'general_liability', carrierName: 'Acme Mutual', expiresAt: '2027-06-30' }] },
  { id: 'coi-r3-2', subcontractorId: 'sub-r3-2', fileUri: 'sub-documents:sub-r3-2/coi-coi-r3-2.pdf', uploadedAt: '2026-08-08T12:00:00.000Z', coverages: [] },
];

async function seed() {
  await AsyncStorage.multiSet([
    ['mageid_leads', JSON.stringify(leads)],
    ['mageid_deliveries', JSON.stringify(deliveries)],
    ['mageid_subcontractors', JSON.stringify(subs)],
    ['mageid_cois', JSON.stringify(cois)],
  ]);
}

async function desk(url: string) {
  env('ios', 1512, 945);
  await primeWorld('populated');
  await seed();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

function alertSpy() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const alertMod = require('@/utils/alert') as typeof import('@/utils/alert');
  return jest.spyOn(alertMod, 'showAlert').mockImplementation(() => undefined);
}
function csvSpy() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pf = require('@/utils/platformFile') as typeof import('@/utils/platformFile');
  return jest.spyOn(pf, 'deliverTextFile').mockResolvedValue(undefined as never);
}
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The href a DataTable row carries (the composite above the host row). */
type TreeNode = { props: Record<string, unknown>; parent: TreeNode | null };
function rowHref(testID: string): unknown {
  let n: TreeNode | null = screen.getByTestId(testID) as unknown as TreeNode;
  while (n && n.props.href === undefined) n = n.parent;
  return n?.props.href;
}
async function layout(testID: string, width: number) {
  await act(async () => {
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { width, height: 600, x: 0, y: 0 } } });
  });
  await pump(1);
}

describe('lane R3 — the Pipeline register, desktop web 1512', () => {
  jest.setTimeout(120000);

  it('mounts the register, not the phone board; the board fits a 1224 container at 235 a column', async () => {
    await desk('/leads');
    expect(screen.getByTestId('leads-register')).toBeTruthy();
    expect(screen.queryByTestId('leads-import')).toBeNull();
    expect(screen.getByTestId('leads-board')).toBeTruthy();
    await layout('leads-board', 1224);
    expect(flat(screen.getByTestId('leads-board-lost').props.style).width).toBe(235);
    expect(screen.getAllByText('Dana Kerr').length).toBeGreaterThan(0);
    await layout('leads-board', 992);
    expect(flat(screen.getByTestId('leads-board-new').props.style).width).toBe(188);
  });

  it('the KPI strip: the phone numbers, 50% win rate from 1 won / 1 lost', async () => {
    await desk('/leads');
    expect(screen.getByTestId('leads-register-kpis')).toBeTruthy();
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Win rate').length).toBeGreaterThan(0);
  });

  it('List: rows link to /lead-detail?leadId=, and the choice is remembered', async () => {
    await desk('/leads');
    await act(async () => { fireEvent.press(screen.getByTestId('leads-register-view-list')); });
    await pump(2);
    expect(screen.getByTestId('leads-register-table')).toBeTruthy();
    expect(flat(screen.getByTestId('leads-register-table-row-lead-r3-qual').props.style).minHeight).toBe(36);
    expect(rowHref('leads-register-table-row-lead-r3-qual')).toEqual({ pathname: '/lead-detail', params: { leadId: 'lead-r3-qual' } });
    expect(await AsyncStorage.getItem('mageid_leads_view')).toBe('list');
    expect(screen.getAllByText('waiting 5h').length).toBeGreaterThan(0);
  });

  it('Add by hand PUSHES /lead-detail?mode=new', async () => {
    const tree = await desk('/leads');
    await act(async () => { fireEvent.press(screen.getByTestId('leads-register-add')); });
    await pump(3);
    expect(tree.getPathname()).toBe('/lead-detail');
    expect(tree.getSearchParams()).toMatchObject({ mode: 'new' });
  });

  it('Export CSV names the file leads-YYYY-MM-DD.csv', async () => {
    const spy = csvSpy();
    try {
      await desk('/leads');
      await act(async () => { fireEvent.press(screen.getByTestId('leads-register-csv')); });
      expect(spy.mock.calls[0][0]).toBe(`leads-${localDay(new Date())}.csv`);
      expect(String(spy.mock.calls[0][1]).split('\r\n')).toHaveLength(1 + leads.length);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('lane R3 — the Deliveries register, desktop web 1512', () => {
  jest.setTimeout(120000);
  const URL = `/deliveries?projectId=${PROJECT_ID}`;

  it('mounts the register: Late above the horizon, no phone rows', async () => {
    await desk(URL);
    expect(screen.getByTestId('deliveries-register')).toBeTruthy();
    expect(screen.queryByTestId('deliveries-horizon-7')).toBeNull();
    expect(screen.getByTestId(`deliveries-register-late-row-${D_LATE}`)).toBeTruthy();
    expect(screen.getByTestId(`deliveries-register-table-row-${D_SOON}`)).toBeTruthy();
    expect(flat(screen.getByTestId(`deliveries-register-table-row-${D_SOON}`).props.style).minHeight).toBe(36);
    expect(screen.getAllByText(world.project.name).length).toBeGreaterThan(0);
    // Late is unbounded, so it scrolls WITH the look-ahead: the Late table, the
    // horizon and the Upcoming table share the register's one list ScrollView.
    type HostNode = { type: unknown; parent: HostNode | null };
    let n: HostNode | null = screen.getByTestId('deliveries-register-late') as unknown as HostNode;
    while (n && n.type !== 'RCTScrollView') n = n.parent;
    expect(n).not.toBeNull();
    const scroller = within(n as unknown as Parameters<typeof within>[0]);
    expect(scroller.getByTestId('deliveries-register-horizon')).toBeTruthy();
    expect(scroller.getByTestId('deliveries-register-table')).toBeTruthy();
  });

  it("a row's Confirm writes the status to the device", async () => {
    await desk(URL);
    await act(async () => { fireEvent.press(screen.getByTestId(`confirm-${D_SOON}`)); });
    await pump(3);
    const saved = JSON.parse((await AsyncStorage.getItem('mageid_deliveries')) ?? '[]') as { id: string; status: string }[];
    expect(saved.find((d) => d.id === D_SOON)?.status).toBe('confirmed');
  });

  it('bulk Confirm writes EVERY selected load (one per render)', async () => {
    await desk(URL);
    await act(async () => { fireEvent.press(screen.getByTestId(`deliveries-register-table-row-${D_SOON}-check`)); });
    await act(async () => { fireEvent.press(screen.getByTestId(`deliveries-register-table-row-${D_SOON2}-check`)); });
    await pump(2);
    await act(async () => { fireEvent.press(within(screen.getByTestId('deliveries-register-table-bulkbar')).getByText('Confirm')); });
    await pump(4);
    const saved = JSON.parse((await AsyncStorage.getItem('mageid_deliveries')) ?? '[]') as { id: string; status: string }[];
    const status = Object.fromEntries(saved.map((d) => [d.id, d.status]));
    expect(status[D_SOON]).toBe('confirmed');
    expect(status[D_SOON2]).toBe('confirmed');
    expect(status[D_LATE]).toBe('scheduled');
  });

  it('bulk Mark received is disabled and says why; Received opens the receive sheet', async () => {
    const spy = alertSpy();
    try {
      await desk(URL);
      await act(async () => { fireEvent.press(screen.getByTestId(`deliveries-register-table-row-${D_SOON}-check`)); });
      await pump(2);
      await act(async () => { fireEvent.press(within(screen.getByTestId('deliveries-register-table-bulkbar')).getByText('Mark received')); });
      expect(spy).toHaveBeenCalledWith('Mark received', 'Receive each load on its own — the damage question is asked for every delivery.');
      await act(async () => { fireEvent.press(screen.getByTestId(`receive-${D_LATE}`)); });
      await pump(2);
      expect(screen.getByTestId('receive-save')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('Export CSV carries the job slug and the local day', async () => {
    const spy = csvSpy();
    try {
      await desk(URL);
      await act(async () => { fireEvent.press(screen.getByTestId('deliveries-register-csv')); });
      const slug = world.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
      expect(spy.mock.calls[0][0]).toBe(`deliveries-${slug}-${localDay(new Date())}.csv`);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('lane R3 — the Documents register, desktop web 1512', () => {
  jest.setTimeout(120000);

  it('mounts the register (no phone hero); a COI row links to its sub beside the vault', async () => {
    await desk('/documents');
    expect(screen.getByTestId('documents-register')).toBeTruthy();
    expect(screen.queryByTestId('documents-coi-risk')).toBeNull();
    expect(screen.getByTestId('documents-register-kpis')).toBeTruthy();
    expect(screen.getByTestId('documents-register-coi-risk')).toBeTruthy();
    expect(rowHref('documents-register-table-row-coi-coi-r3-1')).toEqual({ pathname: '/coi-vault', params: { subId: 'sub-r3-1' } });
    expect(rowHref('documents-register-table-row-permit-permit-1')).toEqual({ pathname: '/permits' });
    expect(flat(screen.getByTestId('documents-register-table-row-permit-permit-1').props.style).minHeight).toBe(36);
    expect(screen.getByTestId('documents-register-files')).toBeTruthy();
  });

  it('Export CSV names the file documents-YYYY-MM-DD.csv', async () => {
    const spy = csvSpy();
    try {
      await desk('/documents');
      await act(async () => { fireEvent.press(screen.getByTestId('documents-register-csv')); });
      expect(spy.mock.calls[0][0]).toBe(`documents-${localDay(new Date())}.csv`);
    } finally {
      spy.mockRestore();
    }
  });
});
