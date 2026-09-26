/**
 * Wave 6d, lane P1 — Plans becomes a thumbnail grid with discipline chips on
 * desktop web, and the plan viewer gains a sheet rail, a tool column and
 * arrow-key sheet flips. PHONE PROOF.
 *
 * Every edit in lane P1 sits behind `isDesktopWeb ? <new/> : <today's JSX>`
 * (useIsDesktopWeb() is false on iOS, Android and a narrow browser), a
 * positive `isDesktopWeb && styles.xDesktop` append, a sheet frame whose
 * phone parts are null (useSheetFrame), or a primitive whose phone branch is
 * today's tree (ChipRail is the same horizontal ScrollView). So on the iPhone
 * NOTHING may change. This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 *     (124dc7c4), before a single line of this lane was written, and never
 *     regenerated. The fixture world has no plan sheets, so four are seeded
 *     into the device cache: A-101 Rev 2 (current), A-101 Rev 1 (superseded,
 *     chained from Rev 2's previousSheetId), S-201 with no image ('missing'),
 *     and an unnumbered "Cover". Every <Modal> renders its content, open or
 *     not, so each snapshot holds the Ask, New sheet and Title-block sheets
 *     (plans) and the sheet-number, calibration and pin sheets (viewer).
 *
 *  2. NATIVE TABLET (android, 1100 wide): isDesktop is TRUE on native at
 *     >= 1024, so desktop STYLES may apply there (the accepted 6c rule), but
 *     no useIsDesktopWeb() switch may: no grid, no chips, no rail, and the
 *     viewer's toolbar stays a horizontal row.
 *
 *  3. DESKTOP WEB behaviour (useIsDesktopWeb forced on at 1512 × 945):
 *     the grid, the chips, the rail order, a rail press, the rail toggle.
 *
 * What a snapshot records: every style prop FLATTENED (a `false` left by
 * `isDesktopWeb && …` renders nothing), handler props dropped, undefined props
 * dropped. Both clocks are pinned (see GOLDEN_CLOCK).
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { PROJECT_ID, ESTIMATE_ID, SMOKE_USER } from '@/__tests__/fixtures/world';

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

// useIsDesktopWeb(): the app's own answer everywhere (false on iOS/Android),
// unless a desktop-web case below forces it. RN-web itself cannot run inside
// this native harness (expo-router reads window.location on web), so the
// desktop-web cases keep Platform.OS native and force only this switch.
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
        testID: 'p1-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
// 'web' here is the browser's LAYOUT gate (mockWeb: web >= 900 is desktop),
// with Platform.OS left native: a full route cannot mount on RN-web inside this
// harness (app/_layout.tsx reads window.location). useIsDesktopWeb() is false
// either way below 900, which is exactly what a 390 browser sees.
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
  mockForceDesktopWeb = false;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records (one line per host node; line count + sha256) ──
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const KNOWN_IDS = new Set([PROJECT_ID, ESTIMATE_ID]);
const volatile = (s: string) => s
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (m) => (KNOWN_IDS.has(m) ? m : '<uuid>'))
  .replace(/\b\d{13}[a-z0-9]{0,12}\b/g, '<ts-id>');
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? volatile(j) : null;
  } catch { return null; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${volatile(String(node))}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children' || k === 'screenId') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(volatile(v))}`); continue; }
    if (typeof v !== 'object' || v === null) { parts.push(`${k}=${String(v)}`); continue; }
    parts.push(`${k}=${small(v) ?? '<obj>'}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  json = stripSanctioned(json);
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.P1_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: out.length, sha256 };
}

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

// ── The four sheets the populated world leaves out ─────────────────────────
const A101_R2 = 'sheet-p1-a101-r2';
const A101_R1 = 'sheet-p1-a101-r1';
const S201 = 'sheet-p1-s201';
const COVER = 'sheet-p1-cover';
const PIN_ID = 'pin-p1-1';
const sheet = (over: Record<string, unknown>) => ({
  projectId: PROJECT_ID,
  userId: SMOKE_USER.id,
  width: 2400,
  height: 1800,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  ...over,
});
const planSheets = [
  sheet({ id: A101_R2, name: 'Floor Plan — Level 1', sheetNumber: 'A-101', revision: 2, previousSheetId: A101_R1, imageUri: 'https://plans.example.test/a101-r2.png', updatedAt: '2026-08-10T12:00:00.000Z' }),
  sheet({ id: A101_R1, name: 'Floor Plan — Level 1', sheetNumber: 'A-101', revision: 1, superseded: true, imageUri: 'https://plans.example.test/a101-r1.png', updatedAt: '2026-08-05T12:00:00.000Z' }),
  sheet({ id: S201, name: 'Foundation Plan', sheetNumber: 'S-201', imageUri: '', updatedAt: '2026-08-04T12:00:00.000Z' }),
  sheet({ id: COVER, name: 'Cover', imageUri: 'https://plans.example.test/cover.png', updatedAt: '2026-08-03T12:00:00.000Z' }),
];
// One pin on A-101 Rev 2, linked to the world's punch-1 — so arriving with
// &punchId=punch-1 auto-selects it and the pin sheet (PinDetailModal) renders.
const drawingPins = [
  { id: PIN_ID, projectId: PROJECT_ID, planSheetId: A101_R2, x: 0.4, y: 0.5, kind: 'punch', label: 'Cracked tile', linkedPunchItemId: 'punch-1', createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z' },
];

async function seed() {
  await AsyncStorage.setItem('mageid_plan_sheets', JSON.stringify(planSheets));
  await AsyncStorage.setItem('mageid_drawing_pins', JSON.stringify(drawingPins));
}

async function mountAt(os: 'ios' | 'android' | 'web', width: number, height: number, url: string) {
  env(os, width, height);
  await primeWorld('populated');
  await seed();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

// ── 1. GOLDEN ──────────────────────────────────────────────────────────────
describe('lane P1 — the phone is unchanged (golden)', () => {
  jest.setTimeout(120000);

  const CASES: [string, 'ios' | 'web', string, (() => void) | null][] = [
    ['plans list, iOS 390', 'ios', `/plans?${P}`, () => { expect(screen.getByText('S-201')).toBeTruthy(); }],
    ['plans project picker, iOS 390', 'ios', '/plans', () => { expect(screen.getByText('Pick a project')).toBeTruthy(); }],
    ['plans with the Ask sheet open, iOS 390', 'ios', `/plans?${P}&ask=1`, () => { expect(screen.getByTestId('plans-ask-modal')).toBeTruthy(); }],
    ['viewer A-101 Rev 2, iOS 390', 'ios', `/plan-viewer?sheetId=${A101_R2}`, () => { expect(screen.getByTestId('plan-viewer-revision-row')).toBeTruthy(); }],
    ['viewer A-101 Rev 1 (superseded banner), iOS 390', 'ios', `/plan-viewer?sheetId=${A101_R1}`, () => { expect(screen.getByTestId('plan-viewer-superseded-banner')).toBeTruthy(); }],
    ['viewer with the pin sheet open, iOS 390', 'ios', `/plan-viewer?sheetId=${A101_R2}&punchId=punch-1`, () => { expect(screen.getByTestId('pin-raise-rfi')).toBeTruthy(); }],
    ['plans list, web 390', 'web', `/plans?${P}`, () => { expect(screen.getByText('S-201')).toBeTruthy(); }],
    ['plans project picker, web 390', 'web', '/plans', () => { expect(screen.getByText('Pick a project')).toBeTruthy(); }],
    ['plans with the Ask sheet open, web 390', 'web', `/plans?${P}&ask=1`, () => { expect(screen.getByTestId('plans-ask-modal')).toBeTruthy(); }],
    ['viewer A-101 Rev 2, web 390', 'web', `/plan-viewer?sheetId=${A101_R2}`, () => { expect(screen.getByTestId('plan-viewer-revision-row')).toBeTruthy(); }],
    ['viewer A-101 Rev 1 (superseded banner), web 390', 'web', `/plan-viewer?sheetId=${A101_R1}`, () => { expect(screen.getByTestId('plan-viewer-superseded-banner')).toBeTruthy(); }],
  ];

  it.each(CASES)('%s', async (name, os, url, check) => {
    const tree = await mountAt(os, 390, 844, url);
    // The seeds really reached the screen (a golden of an empty list proves little).
    check?.();
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('plans with superseded shown, iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, `/plans?${P}`);
    await act(async () => { fireEvent.press(screen.getByText(/^Show 1 superseded revision/)); });
    await pump(3);
    expect(screen.getByTestId(`sheet-row-superseded-${A101_R1}`)).toBeTruthy();
    expect(fingerprint('plans with superseded shown', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. Native tablet: desktop styles may apply, desktop-WEB switches may not ─
/** The first HOST ancestor of a node (the TouchableOpacity's parent View). */
function hostParent(node: { parent: unknown } | null): { type: unknown; props: Record<string, unknown>; parent: unknown } | null {
  let n = (node?.parent ?? null) as { type: unknown; props: Record<string, unknown>; parent: unknown } | null;
  while (n && typeof n.type !== 'string') n = n.parent as typeof n;
  return n;
}

describe('lane P1 — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);
  it('/plans renders the phone list: no grid, no discipline chips', async () => {
    await mountAt('android', 1100, 800, `/plans?${P}`);
    expect(screen.getByText('S-201')).toBeTruthy();
    expect(screen.queryByTestId('plans-sheet-grid')).toBeNull();
    expect(screen.queryByTestId('plans-discipline-chips')).toBeNull();
  });
  it('/plan-viewer: no rail, no rail toggle, and the toolbar is still a row', async () => {
    await mountAt('android', 1100, 800, `/plan-viewer?sheetId=${A101_R2}`);
    expect(screen.getByTestId('plan-viewer-revision-row')).toBeTruthy();
    expect(screen.queryByTestId('plan-viewer-rail-toggle')).toBeNull();
    expect(screen.queryAllByTestId(/^plan-rail-/)).toHaveLength(0);
    const toolbar = hostParent(screen.getByTestId('plan-viewer-tool-draw') as unknown as { parent: unknown });
    expect(toolbar).not.toBeNull();
    expect(flat(toolbar!.props.style).flexDirection).toBe('row');
  });
});

// ── 3. Desktop web: the grid, the chips, the rail (behaviour, not pixels) ────
// useIsDesktopWeb() is forced on at 1512 × 945 (see the mock above). The
// arrow-key flips cannot run here (no DOM, so useHotkeys registers nothing);
// adjacentSheetId is proved in bun (scripts/validate-w6d-plans.ts) and the
// keys in the live check.
describe('lane P1 — desktop web 1512', () => {
  jest.setTimeout(120000);
  async function desktop(url: string) {
    env('ios', 1512, 945);
    mockForceDesktopWeb = true;
    return mountAt('ios', 1512, 945, url);
  }
  const deleteIds = () => screen.queryAllByTestId(/^plans-delete-/).map((n) => String(n.props.testID));

  it('/plans: a grid of the 3 live sheets (superseded hidden), and discipline chips with counts', async () => {
    await desktop(`/plans?${P}`);
    expect(screen.getByTestId('plans-sheet-grid')).toBeTruthy();
    expect(deleteIds().sort()).toEqual([`plans-delete-${A101_R2}`, `plans-delete-${COVER}`, `plans-delete-${S201}`]);
    const chipIds = screen.queryAllByTestId(/^plans-discipline-chips-/).map((n) => String(n.props.testID));
    expect(chipIds).toEqual([
      'plans-discipline-chips-all', 'plans-discipline-chips-S', 'plans-discipline-chips-A', 'plans-discipline-chips-unnumbered',
    ]);
    const chipText = (id: string) => {
      const out: string[] = [];
      const walk = (n: unknown) => {
        if (typeof n === 'string') { out.push(n); return; }
        const kids = (n as { children?: unknown[] })?.children ?? [];
        for (const k of kids) walk(k);
      };
      walk(screen.getByTestId(`plans-discipline-chips-${id}`));
      return out.join(' ');
    };
    expect(chipText('all')).toBe('All 3');
    expect(chipText('A')).toBe('Architectural 1');
    expect(chipText('S')).toBe('Structural 1');
    expect(chipText('unnumbered')).toBe('Unnumbered 1');
  });

  it('/plans: pressing Structural leaves only S-201', async () => {
    await desktop(`/plans?${P}`);
    await act(async () => { fireEvent.press(screen.getByTestId('plans-discipline-chips-S')); });
    await pump(2);
    expect(deleteIds()).toEqual([`plans-delete-${S201}`]);
    await act(async () => { fireEvent.press(screen.getByTestId('plans-discipline-chips-all')); });
    await pump(2);
    expect(deleteIds()).toHaveLength(3);
  });

  it('/plan-viewer: the rail lists A-101, S-201, Cover in that order, the open sheet selected', async () => {
    await desktop(`/plan-viewer?sheetId=${A101_R2}`);
    const rows = screen.queryAllByTestId(/^plan-rail-sheet-/);
    expect(rows.map((n) => String(n.props.testID))).toEqual([`plan-rail-${A101_R2}`, `plan-rail-${S201}`, `plan-rail-${COVER}`]);
    expect(rows[0].props.accessibilityState).toMatchObject({ selected: true });
    expect(rows[1].props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByTestId('plan-viewer-rail-toggle')).toBeTruthy();
  });

  it('/plan-viewer: a superseded sheet open shows on the rail, in number order', async () => {
    await desktop(`/plan-viewer?sheetId=${A101_R1}`);
    const rows = screen.queryAllByTestId(/^plan-rail-sheet-/).map((n) => String(n.props.testID));
    expect(rows).toEqual([`plan-rail-${A101_R2}`, `plan-rail-${A101_R1}`, `plan-rail-${S201}`, `plan-rail-${COVER}`]);
  });

  it('/plan-viewer: pressing a rail row replaces the route with that sheet', async () => {
    const tree = await desktop(`/plan-viewer?sheetId=${A101_R2}`);
    await act(async () => { fireEvent.press(screen.getByTestId(`plan-rail-${S201}`)); });
    await pump(3);
    expect(tree.getPathname()).toBe('/plan-viewer');
    expect(tree.getSearchParams()).toMatchObject({ sheetId: S201 });
    expect(screen.getByTestId(`plan-rail-${S201}`).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('/plan-viewer: the toggle hides the rail and remembers it', async () => {
    await desktop(`/plan-viewer?sheetId=${A101_R2}`);
    expect(screen.queryAllByTestId(/^plan-rail-sheet-/)).toHaveLength(3);
    await act(async () => { fireEvent.press(screen.getByTestId('plan-viewer-rail-toggle')); });
    await pump(2);
    expect(screen.queryAllByTestId(/^plan-rail-sheet-/)).toHaveLength(0);
    expect(await AsyncStorage.getItem('mageid_plan_rail_open')).toBe('false');
    expect(screen.getByLabelText('Show sheet list')).toBeTruthy();
  });

  it('/plan-viewer: a stored closed rail stays closed', async () => {
    env('ios', 1512, 945);
    mockForceDesktopWeb = true;
    await primeWorld('populated');
    await seed();
    await AsyncStorage.setItem('mageid_plan_rail_open', 'false');
    await mountRouteChecked(`/plan-viewer?sheetId=${A101_R2}`);
    await pump();
    expect(screen.queryAllByTestId(/^plan-rail-sheet-/)).toHaveLength(0);
    expect(screen.getByLabelText('Show sheet list')).toBeTruthy();
  });

  it('/plan-viewer: the toolbar becomes a column beside the canvas', async () => {
    await desktop(`/plan-viewer?sheetId=${A101_R2}`);
    const toolbar = hostParent(screen.getByTestId('plan-viewer-tool-draw') as unknown as { parent: unknown });
    expect(flat(toolbar!.props.style).flexDirection).toBe('column');
  });
});
