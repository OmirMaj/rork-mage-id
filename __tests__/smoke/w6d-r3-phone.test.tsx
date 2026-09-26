/**
 * Wave 6d, lane R3 — Leads, Deliveries and Documents become registers on
 * desktop web. PHONE PROOF.
 *
 * Every edit in lane R3 sits behind `isDesktopWeb ? <XRegister/> : (<>today's
 * JSX</>)` (useIsDesktopWeb() is false on iOS, Android and a narrow browser),
 * an `isDesktop && …` / `isDesktopWeb && …` style append, or a wave-6b
 * primitive whose phone branch is today's tree (useSheetFrame returns null
 * parts and the caller's own animation off desktop). So on the iPhone NOTHING
 * may change. This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 *     (124dc7c4), before a single line of this lane was written, and never
 *     regenerated. Each case mounts a real route inside the real app (the
 *     provider stack, the populated fixture world plus five leads, three
 *     deliveries, two subs and two COIs) and records the whole rendered tree.
 *     Every <Modal> renders its content, open or not, so each snapshot holds
 *     every sheet the screen owns in its phone styles.
 *
 *  2. BEHAVIOUR on the phone: each route on iOS 390 renders its phone list,
 *     never the register.
 *
 *  3. NATIVE TABLET (android, 1100 wide): isDesktop is TRUE on native at
 *     >= 1024, so desktop STYLES may apply there (the accepted 6c rule), but
 *     the useIsDesktopWeb() switch stays off: no register ever mounts.
 *
 * What a snapshot records: every style prop FLATTENED (a `false` left by
 * `isDesktop && …` renders nothing), handler props dropped, undefined props
 * dropped. Both clocks are pinned (see GOLDEN_CLOCK).
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';

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

// useIsDesktopWeb(): the app's own answer (false on iOS/Android and below the
// desktop gate). Nothing in this file forces it on.
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => actual.useIsDesktopWeb() };
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
        testID: 'r3-modal',
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
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.R3_DUMP_DIR;
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
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

// ── Records the populated world leaves empty ────────────────────────────────
// NOW (the app's clock) is 2026-08-15T15:00Z.
const L_WAIT = 'lead-r3-new';
const leads = [
  // New, waiting 5 h for a first reply, with a stated budget.
  { id: L_WAIT, name: 'Rosa Whitfield', phone: '(555) 401-0001', projectType: 'Kitchen remodel', budgetMin: 60000, budgetMax: 80000, source: 'houzz', stage: 'new', score: 8, receivedAt: '2026-08-15T10:00:00.000Z', touches: [], createdAt: '2026-08-15T10:00:00.000Z', updatedAt: '2026-08-15T10:00:00.000Z' },
  { id: 'lead-r3-qual', name: 'Omar Beck', email: 'omar@beck.test', projectType: 'Bathroom', source: 'referral', stage: 'qualified', score: 5, receivedAt: '2026-08-10T12:00:00.000Z', firstRespondedAt: '2026-08-10T14:00:00.000Z', touches: [], createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z' },
  { id: 'lead-r3-prop', name: 'Priya Nair', projectType: 'Two-story addition', source: 'website', stage: 'proposal', receivedAt: '2026-08-01T12:00:00.000Z', firstRespondedAt: '2026-08-01T13:00:00.000Z', touches: [], createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-05T12:00:00.000Z' },
  { id: 'lead-r3-won', name: 'Hal Moreno', source: 'repeat', stage: 'won', receivedAt: '2026-07-20T12:00:00.000Z', firstRespondedAt: '2026-07-20T16:00:00.000Z', touches: [], createdAt: '2026-07-20T12:00:00.000Z', updatedAt: '2026-07-28T12:00:00.000Z' },
  { id: 'lead-r3-lost', name: 'Dana Kerr', source: 'angi', stage: 'lost', receivedAt: '2026-07-10T12:00:00.000Z', touches: [], createdAt: '2026-07-10T12:00:00.000Z', updatedAt: '2026-07-18T12:00:00.000Z' },
];

const D_LATE = 'dlv-r3-late';
const D_SOON = 'dlv-r3-soon';
const deliveries = [
  { id: D_LATE, projectId: PROJECT_ID, description: '14 windows', supplier: 'Pella Supply', poNumber: 'PO-1182', expectedDate: '2026-08-12', status: 'scheduled', createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z' },
  { id: D_SOON, projectId: PROJECT_ID, description: 'Roof trusses', supplier: 'Truss Co', window: '07:00-11:00', expectedDate: '2026-08-18', status: 'scheduled', createdAt: '2026-08-02T12:00:00.000Z', updatedAt: '2026-08-02T12:00:00.000Z' },
  { id: 'dlv-r3-conf', projectId: PROJECT_ID, description: 'Drywall, 120 sheets', supplier: 'Gypsum Depot', expectedDate: '2026-08-19', status: 'confirmed', confirmedAt: '2026-08-10T12:00:00.000Z', createdAt: '2026-08-03T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z' },
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

async function mountAt(os: 'ios' | 'android' | 'web', width: number, height: number, url: string) {
  env(os, width, height);
  await primeWorld('populated');
  await seed();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const DELIVERIES_URL = `/deliveries?projectId=${PROJECT_ID}`;

/** The seeds really reached the screen (a golden of an empty list proves little). */
function expectSeeded(url: string) {
  if (url === '/leads') expect(screen.getAllByText('Rosa Whitfield').length).toBeGreaterThan(0);
  else if (url === DELIVERIES_URL) expect(screen.getByText('14 windows')).toBeTruthy();
  else expect(screen.getByText('COI · Harbor Electric')).toBeTruthy();
}

// ── 1. GOLDEN ──────────────────────────────────────────────────────────────
describe('lane R3 — the phone is unchanged (golden)', () => {
  jest.setTimeout(120000);

  const AT_REST: [string, 'ios' | 'web', number, number, string][] = [];
  for (const [label, url] of [['leads', '/leads'], ['deliveries', DELIVERIES_URL], ['documents', '/documents']] as const) {
    AT_REST.push([`${label} at rest, iOS 390`, 'ios', 390, 844, url]);
    AT_REST.push([`${label} at rest, web 390`, 'web', 390, 844, url]);
    AT_REST.push([`${label} at rest, web 768`, 'web', 768, 1024, url]);
  }

  it.each(AT_REST)('%s', async (name, os, w, h, url) => {
    const tree = await mountAt(os, w, h, url);
    expectSeeded(url);
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('deliveries add sheet (header Add), iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, DELIVERIES_URL);
    await act(async () => { fireEvent.press(screen.getByLabelText('Add delivery')); });
    await pump(3);
    expect(screen.getByTestId('delivery-save')).toBeTruthy();
    expect(fingerprint('deliveries add open', tree.toJSON())).toMatchSnapshot();
  });

  it('deliveries receive sheet (receive-<id>), iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, DELIVERIES_URL);
    await act(async () => { fireEvent.press(screen.getByTestId(`receive-${D_LATE}`)); });
    await pump(3);
    expect(screen.getByTestId('receive-save')).toBeTruthy();
    expect(fingerprint('deliveries receive open', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. Behaviour on the phone ──────────────────────────────────────────────
describe('lane R3 — phone behaviour', () => {
  jest.setTimeout(120000);
  it('iOS 390: /leads renders the phone board, never the register', async () => {
    await mountAt('ios', 390, 844, '/leads');
    expect(screen.getAllByText('Rosa Whitfield').length).toBeGreaterThan(0);
    expect(screen.getByText('New lead by voice')).toBeTruthy();
    expect(screen.queryByTestId('leads-register')).toBeNull();
  });
  it('iOS 390: /deliveries renders the phone rows, never the register', async () => {
    await mountAt('ios', 390, 844, DELIVERIES_URL);
    expect(screen.getByTestId('deliveries-horizon-7')).toBeTruthy();
    expect(screen.getByTestId(`confirm-${D_SOON}`)).toBeTruthy();
    expect(screen.queryByTestId('deliveries-register')).toBeNull();
  });
  it('iOS 390: /documents renders the phone feed, never the register', async () => {
    await mountAt('ios', 390, 844, '/documents');
    expect(screen.getByTestId('documents-coi-risk')).toBeTruthy();
    expect(screen.queryByTestId('documents-register')).toBeNull();
  });
});

// ── 3. Native tablet: desktop styles may apply, the desktop-WEB register may not ──
describe('lane R3 — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);
  it('/leads renders the phone board', async () => {
    await mountAt('android', 1100, 800, '/leads');
    expect(screen.getAllByText('Rosa Whitfield').length).toBeGreaterThan(0);
    expect(screen.getByText('New lead by voice')).toBeTruthy();
    expect(screen.queryByTestId('leads-register')).toBeNull();
  });
  it('/deliveries renders the phone rows', async () => {
    await mountAt('android', 1100, 800, DELIVERIES_URL);
    expect(screen.getByTestId('deliveries-horizon-7')).toBeTruthy();
    expect(screen.queryByTestId('deliveries-register')).toBeNull();
  });
  it('/documents renders the phone feed', async () => {
    await mountAt('android', 1100, 800, '/documents');
    expect(screen.getByTestId('documents-coi-risk')).toBeTruthy();
    expect(screen.queryByTestId('documents-register')).toBeNull();
  });
});
