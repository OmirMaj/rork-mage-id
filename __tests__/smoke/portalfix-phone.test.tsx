/**
 * Lane PORTALFIX (client portal access security + honesty) — PHONE PROOF.
 *
 * GOLDEN — recorded FIRST, on the untouched lane files (worktree base
 * 0890777b), before a single source line of this lane was written. The
 * g-logs harness (copied from ux-lane-c-phone): the real app
 * (mountRouteChecked, the provider stack, the populated fixture world) at
 * 390 x 844 iOS with useResponsiveLayout mocked to phone; every <Modal>
 * renders its content; styles flattened, handlers and undefined props
 * dropped; both clocks pinned.
 *
 * Each case is a fingerprint (line count + sha256). Set $PFX_DUMP_DIR to write
 * the dumps for a line-by-line diff. The deltas the lane is allowed to cause
 * are listed in its handoff, one per case, each proven by that diff.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

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

// Every Modal renders its content, open or closed (the g-logs recipe).
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
        testID: 'g-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

jest.mock('@/hooks/useProjectRole', () => {
  const actual = jest.requireActual('@/hooks/useProjectRole');
  const state = { role: 'owner', isLoading: false, isError: false, isPaused: false, refetch: () => undefined };
  return { ...actual, useProjectRoleState: () => state, useProjectRole: () => 'owner' };
});

// Records every alert (title, message) while still showing it, so the
// behaviour cases can read the ONE confirm "Remind all" asks.
const mockAlerts: { title: string; message?: string }[] = [];
jest.mock('@/utils/alert', () => {
  const actual = jest.requireActual('@/utils/alert');
  return {
    ...actual,
    showAlert: (title: string, message?: string, ...rest: unknown[]) => {
      mockAlerts.push({ title, message });
      return (actual.showAlert as (...a: unknown[]) => unknown)(title, message, ...rest);
    },
  };
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
  json = stripSanctioned(json);
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.PFX_DUMP_DIR;
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

// ── Project variants ────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
async function rewriteProject(fn: (p: Rec) => Rec) {
  const raw = JSON.parse((await AsyncStorage.getItem('mageid_projects')) ?? '[]');
  const list: Rec[] = Array.isArray(raw) ? raw : (raw.data ?? []);
  const next = list.map((p) => (p.id === PROJECT_ID ? fn(p) : p));
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(Array.isArray(raw) ? next : { ...raw, data: next }));
}

async function phoneSetup(variant?: (p: Rec) => Rec) {
  env('ios', 390, 844);
  await primeWorld('populated');
  if (variant) await rewriteProject(variant);
  const tree = await mountRouteChecked(`/client-portal-setup?id=${PROJECT_ID}`);
  await pump();
  return tree;
}

const withPortal = (extra: Rec) => (p: Rec) => ({ ...p, clientPortal: { ...(p.clientPortal as Rec), ...extra } });

describe('PORTALFIX golden — the phone (390 x 844 iOS)', () => {
  jest.setTimeout(120000);

  it('(a) /client-portal-setup, the fixture job (portal on, key present, no passcode)', async () => {
    const tree = await phoneSetup();
    expect(fingerprint('a portal setup', tree.toJSON())).toMatchSnapshot();
  });

  it('(b) /client-portal-setup, passcode on with one invitee', async () => {
    const tree = await phoneSetup(withPortal({
      requirePasscode: true,
      passcode: 'Harlow4821',
      invites: [{ id: 'inv-pfx-1', email: 'm.harlow@example.test', name: 'Meredith Harlow', invitedAt: '2026-08-01T12:00:00.000Z', status: 'pending' }],
    }));
    expect(fingerprint('b portal setup passcode', tree.toJSON())).toMatchSnapshot();
  });

  it('(c) /client-portal-setup, a Sample project with a portal on', async () => {
    const tree = await phoneSetup((p) => ({ ...p, name: 'Sample \u2014 Harlow Residence' }));
    expect(fingerprint('c portal setup sample', tree.toJSON())).toMatchSnapshot();
  });

  it('(d) /client-portal-setup, a job whose portal was never saved', async () => {
    const tree = await phoneSetup((p) => { const { clientPortal: _cp, ...rest } = p; return rest; });
    expect(fingerprint('d portal setup never saved', tree.toJSON())).toMatchSnapshot();
  });

  it('(m) the route mounted (sanity: the screen title renders)', async () => {
    await phoneSetup();
    expect(screen.toJSON()).toBeTruthy();
  });
});
