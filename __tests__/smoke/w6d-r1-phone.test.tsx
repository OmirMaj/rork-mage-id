/**
 * Wave 6d, lane R1 — Contacts and Crew become registers on desktop web (a
 * DataTable with the record opened beside the list). PHONE PROOF.
 *
 * Every edit in lane R1 sits behind `isDesktopWeb ? <XRegister/> : (<>today's
 * JSX</>)` (useIsDesktopWeb() is false on iOS, Android and a narrow browser),
 * an `isDesktop && …` style append, or a wave-6b primitive whose phone branch
 * is today's tree (useSheetFrame returns null parts and the caller's own
 * animation off desktop; ChipRail's phone branch is the same ScrollView). So
 * on the iPhone NOTHING may change. This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 *     (439e119a), before a single line of this lane was written, and never
 *     regenerated. Each case mounts a real route inside the real app (the
 *     provider stack, the populated fixture world plus three contacts and
 *     three crew members) and records the whole rendered tree. Every <Modal>
 *     renders its content, open or not, so each snapshot holds every sheet the
 *     screen owns (add/edit, detail, ID scan) in its phone styles.
 *
 *  2. BEHAVIOUR on the phone: /contacts on iOS 390 renders the phone search
 *     (contacts-search), never the register.
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
        testID: 'r1-modal',
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
  const dir = process.env.R1_DUMP_DIR;
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

// ── 1. GOLDEN ──────────────────────────────────────────────────────────────
describe('lane R1 — the phone is unchanged (golden)', () => {
  jest.setTimeout(120000);

  const AT_REST: [string, 'ios' | 'web', number, number, string][] = [
    ['contacts at rest, iOS 390', 'ios', 390, 844, '/contacts'],
    ['crew at rest, iOS 390', 'ios', 390, 844, '/crew'],
    ['contacts at rest, web 390', 'web', 390, 844, '/contacts'],
    ['crew at rest, web 390', 'web', 390, 844, '/crew'],
    ['contacts at rest, web 768', 'web', 768, 1024, '/contacts'],
    ['crew at rest, web 768', 'web', 768, 1024, '/crew'],
  ];

  it.each(AT_REST)('%s', async (name, os, w, h, url) => {
    const tree = await mountAt(os, w, h, url);
    // The seeds really reached the screen (a golden of an empty list proves little).
    if (url === '/contacts') expect(screen.getByTestId(`contact-${C1}`)).toBeTruthy();
    else expect(screen.getByText('Maria Gonzalez')).toBeTruthy();
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  it('contacts detail open, iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, '/contacts');
    await act(async () => { fireEvent.press(screen.getByTestId(`contact-${C1}`)); });
    await pump(3);
    expect(screen.getAllByText('ava@linden.test').length).toBeGreaterThan(0);
    expect(fingerprint('contacts detail open', tree.toJSON())).toMatchSnapshot();
  });

  it('crew detail open, iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, '/crew');
    await act(async () => { fireEvent.press(screen.getByText('Maria Gonzalez')); });
    await pump(3);
    expect(screen.getByTestId('delete-crew-member')).toBeTruthy();
    expect(fingerprint('crew detail open', tree.toJSON())).toMatchSnapshot();
  });

  it('contacts add sheet (header Plus), iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, '/contacts');
    const adds = screen.getAllByLabelText('Add');
    await act(async () => { fireEvent.press(adds[adds.length - 1]); });
    await pump(3);
    expect(screen.getAllByText('Add Contact').length).toBeGreaterThan(0);
    expect(fingerprint('contacts add open', tree.toJSON())).toMatchSnapshot();
  });

  it('crew add sheet (add-crew-member), iOS 390', async () => {
    const tree = await mountAt('ios', 390, 844, '/crew');
    await act(async () => { fireEvent.press(screen.getByTestId('add-crew-member')); });
    await pump(3);
    expect(screen.getByTestId('save-crew-member')).toBeTruthy();
    expect(fingerprint('crew add open', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. Behaviour on the phone ──────────────────────────────────────────────
describe('lane R1 — phone behaviour', () => {
  jest.setTimeout(120000);
  it('iOS 390: /contacts renders the phone search, never the register', async () => {
    await mountAt('ios', 390, 844, '/contacts');
    expect(screen.getByTestId('contacts-search')).toBeTruthy();
    expect(screen.queryByTestId('contacts-register')).toBeNull();
  });
  it('iOS 390: /crew renders the phone roster, never the register', async () => {
    await mountAt('ios', 390, 844, '/crew');
    expect(screen.getByLabelText('Open Maria Gonzalez')).toBeTruthy();
    expect(screen.queryByTestId('crew-register')).toBeNull();
  });
});

// ── 3. Native tablet: desktop styles may apply, the desktop-WEB register may not ──
describe('lane R1 — android 1100 (isDesktop true, desktopWeb false)', () => {
  jest.setTimeout(120000);
  it('/contacts renders the phone list', async () => {
    await mountAt('android', 1100, 800, '/contacts');
    expect(screen.getByTestId('contacts-search')).toBeTruthy();
    expect(screen.getByTestId(`contact-${C1}`)).toBeTruthy();
    expect(screen.queryByTestId('contacts-register')).toBeNull();
  });
  it('/crew renders the phone roster', async () => {
    await mountAt('android', 1100, 800, '/crew');
    expect(screen.getByLabelText('Open Maria Gonzalez')).toBeTruthy();
    expect(screen.queryByTestId('crew-register')).toBeNull();
  });
});
