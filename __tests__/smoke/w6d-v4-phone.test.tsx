/**
 * Wave 6d, lane V4 — the job page's Schedule button keeps Back (F8) and the
 * job-page, delay-event and Copilot sheets are framed (sheet batch I).
 * PHONE PROOF.
 *
 * Every edit in lane V4 is a sheet frame whose phone branch is inert
 * (useSheetFrame returns null styles, the caller's own animation and
 * `transparent: undefined`; `fP.transparent ?? false` is the old literal;
 * SheetOverlay is a Fragment and SheetScrim returns null on a phone), a
 * dialog scope that registers nothing off desktop web, or a desktop-web
 * branch put IN FRONT of the job page's unchanged phone openSchedule line. So
 * on the iPhone NOTHING may change. This file is the proof.
 *
 * GOLDEN — recorded FIRST, on the untouched base (c1086c0c), before a single
 * line of this lane was written, and never regenerated. Each case mounts a
 * real route inside the real app (the 16-provider stack, the populated
 * fixture world) at 390 × 844 iOS with useResponsiveLayout mocked to phone,
 * with the every-route param bag, and records the whole rendered tree.
 *
 * EVERY <Modal> RENDERS ITS CONTENT, open or not (the w6c-field-phone
 * harness): a screen's snapshot holds every sheet it owns, in its phone
 * styles — delay-events' log, event, evidence, notice-period and notice-form
 * sheets; Copilot's job picker; the job page's cost-breakdown and revision
 * sheets. The Modal's own `visible`, `transparent`, `animationType` and
 * `presentationStyle` are recorded too, so `transparent={fP.transparent ??
 * false}` must still read `false` on the phone.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { PROJECT_ID, ESTIMATE_ID, PORTAL_TOKEN } from '@/__tests__/fixtures/world';

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
// unless the F8 desktop-web cases below force it. RN-web cannot run inside
// this native harness, so those cases keep Platform.OS native and force only
// this switch (w6c-field-phone does the same).
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

// ── What a snapshot records ────────────────────────────────────────────────
// One line per host node — type, every style FLATTENED, every primitive or
// small-object prop, handlers dropped — stored as the dump's line count and
// sha256. Set $W6C_DUMP_DIR to write the dumps for a line-by-line diff.
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
  const dir = process.env.W6C_DUMP_DIR;
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

/** The every-route populated param bag (every-route.populated.test.tsx). */
const BAG = new URLSearchParams({ projectId: PROJECT_ID, id: PROJECT_ID, estimateId: ESTIMATE_ID, t: PORTAL_TOKEN }).toString();

async function phoneRoute(url: string) {
  env('ios', 390, 844);
  await primeWorld('populated');
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

describe('lane V4 — the phone is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  const ROUTES: Array<[string, string]> = [
    ['delay-events (log, event, evidence, notice-period, notice-form sheets)', `/delay-events?${BAG}`],
    ['copilot (default capability: the gate)', `/copilot?${BAG}`],
    ['copilot rfi (the shell + the job-picker sheet)', `/copilot?${BAG}&capabilityId=rfi`],
    ['copilot new_project (project-free: the shell)', `/copilot?${BAG}&capabilityId=new_project`],
    ['project-detail (the hub with the cost and revision sheets)', `/project-detail?${BAG}`],
  ];

  it.each(ROUTES)('%s', async (name, url) => {
    const tree = await phoneRoute(url);
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });

  // The notice-form sheet host (NoticeFormModal) with an event open: log a
  // delay through the real form, answer the notice-window ask, open the event
  // and press "Record a notice" — the event sheet's body and the notice form
  // are then both drawn with their state live.
  it('delay-events: a logged delay, its event sheet and the notice form', async () => {
    const tree = await phoneRoute(`/delay-events?${BAG}`);
    const desc = screen.queryAllByTestId('delay-description');
    expect(desc.length).toBeGreaterThan(0);
    fireEvent.changeText(desc[0], 'Owner stopped framing to re-decide the stair.');
    await pump(2);
    fireEvent.press(screen.getAllByTestId('delay-save')[0]);
    await pump(3);
    const seven = screen.queryAllByTestId('notice-period-7');
    if (seven.length > 0) {
      fireEvent.press(seven[0]);
      await pump(3);
    }
    const rows = screen.queryAllByText(/^DE-0*1\b/);
    if (rows.length > 0) {
      fireEvent.press(rows[rows.length - 1]);
      await pump(3);
    }
    const rec = screen.queryAllByTestId('delay-record-notice');
    if (rec.length > 0) {
      fireEvent.press(rec[0]);
      await pump(3);
    }
    expect(fingerprint('delay-events-notice-form', tree.toJSON())).toMatchSnapshot();
  });
});

// ── F8: the job page's Schedule button keeps Back (desktop web, 1512) ──────
// Behaviour, not pixels. On desktop web the link is scheduleDestination's:
// Schedule Pro is PUSHED (Back returns to the job page); a viewer Pro would
// not open for keeps the classic tab, replaced, exactly as before.
describe('lane V4 — F8: the job page opens the schedule (desktop web 1512)', () => {
  jest.setTimeout(120000);

  async function deskJobPage(before?: () => Promise<void>) {
    env('ios', 1512, 945);
    mockForceDesktopWeb = true;
    await primeWorld('populated');
    if (before) await before();
    const tree = await mountRouteChecked(`/project-detail?${BAG}`);
    await pump();
    return tree;
  }

  it('a Pro tier: Schedule Pro is pushed, and Back lands on the job page', async () => {
    const push = jest.spyOn(router, 'push');
    const replace = jest.spyOn(router, 'replace');
    const tree = await deskJobPage();
    expect(tree.getPathname()).toBe('/project-detail');
    fireEvent.press(screen.getByTestId('project-kpi-strip-progress'));
    await pump();
    expect(push).toHaveBeenCalledWith({ pathname: '/schedule-pro', params: { projectId: PROJECT_ID } });
    expect(replace).not.toHaveBeenCalled();
    expect(tree.getPathname()).toBe('/schedule-pro');
    await act(async () => { router.back(); });
    await pump();
    expect(tree.getPathname()).toBe('/project-detail');
    push.mockRestore();
    replace.mockRestore();
  });

  it('a free tier: the classic tab, replaced with a focus nonce (Pro would not open)', async () => {
    const push = jest.spyOn(router, 'push');
    const replace = jest.spyOn(router, 'replace');
    await deskJobPage(async () => { await AsyncStorage.setItem('mageid_subscription_tier', 'free'); });
    fireEvent.press(screen.getByTestId('project-kpi-strip-progress'));
    await pump();
    expect(push).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/schedule-pro' }));
    expect(replace).toHaveBeenCalledWith({ pathname: '/(tabs)/schedule', params: { projectId: PROJECT_ID, focus: expect.stringMatching(/^\d{13}$/) } });
    push.mockRestore();
    replace.mockRestore();
  });
});
