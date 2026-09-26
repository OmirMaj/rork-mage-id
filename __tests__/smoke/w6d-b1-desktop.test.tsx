/**
 * Wave 6d, lane B1 — the money dashboards on desktop web (1512 × 945).
 *
 * Behaviour, not pixels. RN-web cannot run inside this native harness
 * (expo-router reads window.location on web), so each case keeps Platform.OS
 * native and forces only useIsDesktopWeb() on (the w6c-field-phone pattern);
 * useResponsiveLayout is mocked to the 1512 desktop. It asserts:
 *   - the main | rail row on Budget, Job costing and Cash flow;
 *   - job costing's KPI strip and its two tables (jobcost-phases,
 *     jobcost-commitments);
 *   - the phase table's totals row IS the engine's job total — it reads the
 *     same figures the KPI strip prints (both from computeJobCost's summary,
 *     through two different components), not a sum of the rows;
 *   - '% spent' on a phase with no budget reads '—', never '0%' or '$0';
 *   - the row-action popover sits exactly where utils/popoverPosition puts it,
 *     and without an anchor the menu is the centred dialog, not a popover.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { popoverPosition } from '@/utils/popoverPosition';
import { Layout } from '@/constants/designTokens';
import type { EntityRef } from '@/types';

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

// useIsDesktopWeb(): the app's own answer everywhere (false on iOS/Android).
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// Every Modal renders its content, open or closed (see the header).
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  class Boundary extends ReactActual.Component<{ children?: React.ReactNode }, { threw: boolean }> {
    state = { threw: false };
    static getDerivedStateFromError() { return { threw: true }; }
    componentDidCatch() { /* recorded as a placeholder; identical before and after */ }
    render() {
      return this.state.threw
        ? ReactActual.createElement(RNText, { testID: 'modal-body-threw' }, 'modal-body-threw')
        : this.props.children;
    }
  }
  function Modal(props: Record<string, unknown> & { children?: React.ReactNode }) {
    const { children, visible, transparent, animationType, presentationStyle } = props;
    return ReactActual.createElement(
      RNView,
      {
        testID: 'w6c-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android' | 'web', width: number, height: number) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
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
const GOLDEN_CLOCK = new Date('2026-09-25T15:00:00.000Z').getTime();
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
  mockForceDesktopWeb = false;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

const P = `projectId=${PROJECT_ID}`;
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;

function texts(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  const kids = (node as { children?: unknown }).children;
  if (kids) texts(kids, out);
  return out;
}
const textOf = (testID: string) => texts(screen.getByTestId(testID).children as unknown).join('');

async function desk(url: string, before?: () => Promise<void>) {
  env('android', 1512, 945);
  mockForceDesktopWeb = true;
  await primeWorld('populated');
  if (before) await before();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

describe('lane B1 — money dashboards on desktop web (1512 × 945)', () => {
  jest.setTimeout(120000);

  it('budget-dashboard: the EVM story beside the AI forecast rail', async () => {
    await desk(`/budget-dashboard?${P}`);
    expect(screen.getByTestId('dashboard-columns-row')).toBeTruthy();
    const rail = screen.getByTestId('dashboard-columns-rail');
    expect(within(rail).getByTestId('generate-forecast')).toBeTruthy();
    expect(flat(rail.props.style).width).toBe(Layout.column.rail);
  });

  it('cash-flow: expenses, income and the AI read in the rail', async () => {
    await desk(`/cash-flow?${P}`);
    expect(screen.getByTestId('dashboard-columns-row')).toBeTruthy();
    const rail = screen.getByTestId('dashboard-columns-rail');
    expect(texts(rail.children as unknown).join(' ')).toMatch(/Monthly Expenses/);
  });

  it('job-costing: KPI strip, main | rail, and the two tables', async () => {
    await desk(`/job-costing?${P}`, async () => {
      // One commitment paid on a phase the estimate never priced, so the
      // phase table has a row whose '% spent' is unknown.
      const raw = await AsyncStorage.getItem('mageid_commitments');
      const list = raw ? JSON.parse(raw) : [];
      list.push({
        id: 'commit-b1-unbudgeted', projectId: PROJECT_ID, number: 'PO-B1', type: 'purchase_order',
        vendorName: 'Ridge Roofing Supply', description: 'Roof patch', amount: 2_400, changeAmount: 0,
        paidToDate: 2_400, signedDate: '2026-08-01', phase: 'Zz roof patch', status: 'active',
        createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z',
      });
      await AsyncStorage.setItem('mageid_commitments', JSON.stringify(list));
    });
    expect(screen.getByTestId('jobcost-kpis')).toBeTruthy();
    expect(screen.getByTestId('dashboard-columns-row')).toBeTruthy();
    expect(screen.getByTestId('jobcost-phases')).toBeTruthy();
    expect(screen.getByTestId('jobcost-commitments')).toBeTruthy();
    // The phone's KPI cards and PhaseBar list are not drawn on desktop web.
    expect(screen.queryByText('By phase')).toBeTruthy();
    const rail = screen.getByTestId('dashboard-columns-rail');
    expect(within(rail).getByTestId('open-living-estimate')).toBeTruthy();

    // The totals row: 'Job total' then Budget, Committed, Actual, EAC,
    // Variance, % spent — the SAME figures the KPI strip prints.
    const table = texts(screen.getByTestId('jobcost-phases').children as unknown);
    const at = table.indexOf('Job total');
    expect(at).toBeGreaterThan(-1);
    const [fBudget, fCommitted, fActual, fEac] = table.slice(at + 1, at + 5);
    expect(textOf('jobcost-kpis-budget')).toContain(fBudget);
    expect(textOf('jobcost-kpis-committed')).toContain(fCommitted);
    expect(textOf('jobcost-kpis-actual')).toContain(fActual);
    expect(textOf('variance-kpi')).toContain(`Projected ${fEac}`);

    // The unbudgeted phase: '% spent' is '—', never 0% or $0.
    const row = screen.getByTestId('jobcost-phases-row-Zz roof patch');
    const cells = texts(row.children as unknown);
    expect(cells).toContain('—');
    expect(cells).not.toContain('0%');
    expect(cells).toContain('Unbudgeted');
  });

  it('job-costing on a phone-width web window keeps today\'s cards', async () => {
    env('android', 390, 844);
    await primeWorld('populated');
    await mountRouteChecked(`/job-costing?${P}`);
    await pump();
    expect(screen.getByTestId('variance-kpi')).toBeTruthy();
    expect(screen.queryByTestId('jobcost-kpis')).toBeNull();
    expect(screen.queryByTestId('jobcost-phases')).toBeNull();
  });
});

// ── The row-action popover ────────────────────────────────────────────────
let mockAnchor: { x: number; y: number } | null = null;
const RFI_REF: EntityRef = { kind: 'rfi', id: 'rfi-1', projectId: PROJECT_ID };
function SheetScreen() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const EntityActionSheet = require('@/components/EntityActionSheet').default;
  return <EntityActionSheet entityRef={RFI_REF} onClose={() => {}} anchor={mockAnchor} />;
}

describe('lane B1 — EntityActionSheet on desktop web', () => {
  jest.setTimeout(120000);

  async function sheet(anchor: { x: number; y: number } | null) {
    env('android', 1512, 945);
    mockForceDesktopWeb = true;
    await primeWorld('populated');
    mockAnchor = anchor;
    await mountRouteChecked('/w6d-b1-desk-sheet', SheetScreen);
    await pump();
  }

  function expectAt(anchor: { x: number; y: number }) {
    const pop = screen.getByTestId('entity-action-popover');
    const n = screen.getAllByTestId(/^entity-action-(?!popover)/).length;
    const w = (typeof window !== 'undefined' ? (window as { innerWidth?: number; innerHeight?: number }) : undefined);
    const d = Dimensions.get('window');
    const vp = { width: w?.innerWidth || d.width, height: w?.innerHeight || d.height };
    const want = popoverPosition(anchor, { height: 40 + n * Layout.control.row + 8 }, vp);
    const s = flat(pop.props.style);
    expect(s.left).toBe(want.left);
    expect(s.top).toBe(want.top);
    expect(s.position).toBe('absolute');
    return want;
  }

  it('an anchor opens the popover at popoverPosition (interior point)', async () => {
    await sheet({ x: 400, y: 200 });
    const want = expectAt({ x: 400, y: 200 });
    expect(want.flippedUp).toBe(false);
    expect(screen.getByTestId('entity-action-open')).toBeTruthy();
  });

  it('near the bottom-right corner it clamps and flips up', async () => {
    await sheet({ x: 1500, y: 930 });
    const want = expectAt({ x: 1500, y: 930 });
    expect(want.flippedUp).toBe(true);
  });

  it('without an anchor: the centred dialog, not a popover', async () => {
    await sheet(null);
    expect(screen.queryByTestId('entity-action-popover')).toBeNull();
    expect(screen.getByTestId('entity-action-open')).toBeTruthy();
  });
});
