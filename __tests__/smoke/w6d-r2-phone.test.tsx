/**
 * Wave 6d, lane R2 — Subs and the COI Vault become registers on desktop web (a
 * DataTable with the record opened beside the list). PHONE PROOF.
 *
 * Every edit in lane R2 sits behind `isDesktopWeb ? <XRegister/> : (<>today's
 * JSX</>)` (useIsDesktopWeb() is false on iOS, Android and a narrow browser),
 * an `isDesktop && …` style append, or a wave-6b primitive whose phone branch
 * is today's tree (useSheetFrame returns null parts and the caller's own
 * animation off desktop; ChipRail's phone branch is the same ScrollView). So
 * on the iPhone NOTHING may change. This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 *     (124dc7c4), before a single line of this lane was written, and never
 *     regenerated. Each case mounts a real route inside the real app (the
 *     provider stack, the populated fixture world plus three subcontractors
 *     and two certificates) and records the whole rendered tree. Every <Modal>
 *     renders its content, open or not, so each snapshot holds every sheet the
 *     screen owns (the subs add/edit and detail sheets, the COI date picker)
 *     in its phone styles.
 *
 *  2. BEHAVIOUR on the phone: /subs on iOS 390 renders the phone search
 *     (subs-search), never the register; /coi-vault renders the phone rows.
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
        testID: 'r2-modal',
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
  const dir = process.env.R2_DUMP_DIR;
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
// NOW is 2026-08-15. S1 is compliant (both dates well out), S2's COI lapses in
// 10 days, S3 has no dates at all. S1 carries a certificate whose check FAILED;
// S2 one that was never checked (typed coverage only). S3 has none.
const S1 = 'sub-r2-1';
const S2 = 'sub-r2-2';
const S3 = 'sub-r2-3';
const subs = [
  { id: S1, companyName: 'Brightline Electric', contactName: 'Tomas Reyes', phone: '(555) 401-0001', email: 'tomas@brightline.test', address: '9 Volt Way', trade: 'Electrical', licenseNumber: 'EC-4410', licenseExpiry: '2027-06-30', coiExpiry: '2027-03-31', w9OnFile: true, bidHistory: [], assignedProjects: [], notes: 'Pulls permits himself.', createdAt: '2026-07-01T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z' },
  { id: S2, companyName: 'Cold Front HVAC', contactName: 'Priya Shah', phone: '', email: 'priya@coldfront.test', address: '', trade: 'HVAC', licenseNumber: '', licenseExpiry: '2027-01-15', coiExpiry: '2026-08-25', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-07-02T12:00:00.000Z', updatedAt: '2026-08-09T12:00:00.000Z' },
  { id: S3, companyName: 'Stonecut Masonry', contactName: '', phone: '(555) 401-0003', email: '', address: '', trade: 'Concrete', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-07-03T12:00:00.000Z', updatedAt: '2026-08-08T12:00:00.000Z' },
];
const cois = [
  {
    id: 'coi-r2-1', subcontractorId: S1, fileUri: '', uploadedAt: '2026-08-01T12:00:00.000Z',
    validation: {
      validatedAt: '2026-08-01T12:05:00.000Z', overallStatus: 'fail', confidence: 82,
      issues: [
        { code: 'additional_insured_missing', severity: 'critical', message: 'Additional insured endorsement is missing.' },
        { code: 'waiver_subrogation_missing', severity: 'warning', message: 'No waiver of subrogation.' },
      ],
    },
    coverages: [
      { type: 'general_liability', carrierName: 'Harbor Mutual', policyNumber: 'GL-77', effectiveDate: '2026-04-01', expiresAt: '2027-03-31', source: 'manual' },
      { type: 'workers_comp', carrierName: 'Harbor Mutual', policyNumber: 'WC-12', expiresAt: '2027-04-30', source: 'manual' },
    ],
  },
  {
    id: 'coi-r2-2', subcontractorId: S2, fileUri: '', uploadedAt: '2026-07-20T12:00:00.000Z',
    coverages: [{ type: 'general_liability', carrierName: 'Tri-County Ins.', policyNumber: 'P-9', expiresAt: '2026-08-25', source: 'manual' }],
  },
];

async function seed() {
  await AsyncStorage.setItem('mageid_subcontractors', JSON.stringify(subs));
  await AsyncStorage.setItem('mageid_cois', JSON.stringify(cois));
}

async function mountAt(os: 'ios' | 'android' | 'web', width: number, height: number, url: string) {
  env(os, width, height);
  await primeWorld('populated');
  await seed();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

// ── 1. GOLDEN ──────────────────────────────────────────────────────────────
describe('lane R2 — the phone is unchanged (golden)', () => {
  jest.setTimeout(120000);

  const AT_REST: [string, 'ios' | 'web', number, number, string][] = [
    ['subs at rest, iOS 390', 'ios', 390, 844, '/subs'],
    ['coi-vault at rest, iOS 390', 'ios', 390, 844, '/coi-vault'],
    ['subs at rest, web 390', 'web', 390, 844, '/subs'],
    ['coi-vault at rest, web 390', 'web', 390, 844, '/coi-vault'],
    ['subs at rest, web 768', 'web', 768, 1024, '/subs'],
    ['coi-vault at rest, web 768', 'web', 768, 1024, '/coi-vault'],
  ];

  it.each(AT_REST)('%s', async (name, os, w, h, url) => {
    const tree = await mountAt(os, w, h, url);
    // The seeds really reached the screen (a golden of an empty list proves little).
    if (url === '/subs') expect(screen.getByTestId(`sub-${S1}`)).toBeTruthy();
    else expect(screen.getByTestId(`coi-sub-${S1}`)).toBeTruthy();
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('subs detail open (sub-S1), iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, '/subs');
    await act(async () => { fireEvent.press(screen.getByTestId(`sub-${S1}`)); });
    await pump(3);
    expect(screen.getByTestId('sub-detail-scorecard')).toBeTruthy();
    expect(fingerprint('subs detail open', tree.toJSON())).toMatchSnapshot();
  });

  it('coi-vault?subId=S1 (the detail early return), iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, `/coi-vault?subId=${S1}`);
    expect(screen.getByTestId('coi-upload')).toBeTruthy();
    expect(screen.getAllByTestId('coi-coverages').length).toBe(1);
    expect(fingerprint('coi-vault subId detail', tree.toJSON())).toMatchSnapshot();
  });

  it('subs add sheet (add-sub), iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, '/subs');
    await act(async () => { fireEvent.press(screen.getByTestId('add-sub')); });
    await pump(3);
    expect(screen.getAllByText('Add Subcontractor').length).toBeGreaterThan(0);
    expect(fingerprint('subs add open', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. Behaviour on the phone ──────────────────────────────────────────────
describe('lane R2 — phone behaviour', () => {
  jest.setTimeout(120000);
  it('iOS 390: /subs renders the phone search, never the register', async () => {
    await mountAt('ios', 390, 844, '/subs');
    expect(screen.getByTestId('subs-search')).toBeTruthy();
    expect(screen.queryByTestId('subs-register')).toBeNull();
  });
  it('iOS 390: /coi-vault renders the phone rows, never the register', async () => {
    await mountAt('ios', 390, 844, '/coi-vault');
    expect(screen.getByTestId(`coi-sub-${S1}`)).toBeTruthy();
    expect(screen.queryByTestId('coi-vault-register')).toBeNull();
  });
});

// ── 3. Native tablet: desktop styles may apply, the desktop-WEB register may not ──
describe('lane R2 — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);
  it('/subs renders the phone list', async () => {
    await mountAt('android', 1100, 800, '/subs');
    expect(screen.getByTestId('subs-search')).toBeTruthy();
    expect(screen.getByTestId(`sub-${S1}`)).toBeTruthy();
    expect(screen.queryByTestId('subs-register')).toBeNull();
  });
  it('/coi-vault renders the phone rows', async () => {
    await mountAt('android', 1100, 800, '/coi-vault');
    expect(screen.getByTestId(`coi-sub-${S1}`)).toBeTruthy();
    expect(screen.queryByTestId('coi-vault-register')).toBeNull();
  });
  it('/coi-vault?subId=S1 keeps the phone detail (the early return)', async () => {
    await mountAt('android', 1100, 800, `/coi-vault?subId=${S1}`);
    expect(screen.getByTestId('coi-upload')).toBeTruthy();
    expect(screen.queryByTestId('coi-vault-register')).toBeNull();
  });
});
