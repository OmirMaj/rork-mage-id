/**
 * Wave 6d restore (d6r), lane K1 — GOLDEN PHONE SNAPSHOTS for the Ask page and
 * the Brain FAB.
 *
 * Recorded FIRST, on a pristine copy of the untouched base (24e74ecf), before
 * a single lane-K1 edit. The lane then moves the whole Ask conversation out of
 * app/ask.tsx into components/brain/AskConversation.tsx (the page variant must
 * render today's tree), teaches the Brain FAB to open the desktop Ask dock,
 * and adds the keyboard shell — all of it desktop-web only by construction.
 * This file is the proof that a phone does not see any of it: every snapshot
 * below must stay byte-identical under --ci (never -u). The lane has NO
 * sanctioned phone delta.
 *
 *   (a) app/ask.tsx at '/ask' inside the REAL app (the 16-provider stack):
 *       ios 390 with no params (an empty world: the onboarding starters),
 *       ios 390 anchored to the fixture's job with screen=project-detail
 *       (the populated world: 'Answering for …', the job's starters, the
 *       RFI-triage row), and web 390. Only the Ask screen's own subtree is
 *       recorded (the smallest node holding its close button AND its composer),
 *       so a later edit to the root layout's chrome cannot move this golden.
 *   (b) BrainFab on '/(tabs)/(home)' at ios 390, web 390 and web 820 (820 is
 *       below the 900 px desktop gate, so it must equal today's tree too).
 *
 * Harness copied from w6c-shell-phone.test.tsx: phoneView (styles flattened,
 * the random screenId dropped, every other prop copied — undefined included),
 * as() (Platform.OS + the window per test), the switchable theme mock.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Slot } from 'expo-router';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { BrainFab } from '@/components/brain/BrainFab';
import AskMageScreen from '@/app/ask';

// ── Switchable theme mock (null = the real provider, which the real-app mounts use)

let mockFakeTheme = false;
jest.mock('@/contexts/ThemeContext', () => {
  const R = jest.requireActual('react');
  const actual = jest.requireActual('@/contexts/ThemeContext');
  const palette = jest.requireActual('@/constants/colors');
  const colors = { ...palette.Theme.light, ...palette.deriveAccentPalette(palette.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ...actual,
    ThemeProvider: ({ children }: { children: React.ReactNode }) =>
      mockFakeTheme ? R.createElement(R.Fragment, null, children) : R.createElement(actual.ThemeProvider, null, children),
    useTheme: () => (mockFakeTheme ? value : actual.useTheme()),
  };
});

// ── Platform + window ──────────────────────────────────────────────────────

let restoreOS: (() => void) | null = null;
function as(os: typeof Platform.OS, width: number, height = 844) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  Dimensions.set({
    window: { width, height, scale: 3, fontScale: 1 },
    screen: { width, height, scale: 3, fontScale: 1 },
  });
}

beforeEach(() => { jest.useFakeTimers(); });

afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  mockFakeTheme = false;
  Dimensions.set({
    window: { width: 390, height: 844, scale: 3, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 3, fontScale: 1 },
  });
});

// ── Tree normalisation (copied from w6c-shell-phone.test.tsx) ─────────────

const flat = (style: unknown): ViewStyle => StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {};

function phoneView(node: unknown): unknown {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(phoneView);
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.props ?? {})) {
    if (k === 'screenId') continue;
    props[k] = /style$/i.test(k) && v != null && typeof v === 'object' ? flat(v) : v;
  }
  return { type: el.type, props, children: phoneView(el.children) };
}

const CLOCK_TEXT = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, |\b\d{1,2}:\d{2} ?(?:AM|PM)\b/g;
const AI_RESET_SENTENCE = /Daily AI resets .*? · Takeoff pages reset .*/g;
function clockFree(node: unknown): unknown {
  if (typeof node === 'string') {
    return node
      .replace(AI_RESET_SENTENCE, 'Daily AI resets <reset> · Takeoff pages reset <reset>')
      .replace(CLOCK_TEXT, '<clock>');
  }
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(clockFree);
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  return { ...el, children: clockFree(el.children) };
}

type JsonNode = { type: string; props: Record<string, unknown>; children: unknown };

function holds(node: unknown, testID: string): boolean {
  if (node == null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => holds(n, testID));
  const el = node as JsonNode;
  if (el.props?.testID === testID) return true;
  return holds(el.children, testID);
}

/** The smallest subtree that holds every one of `ids` — the Ask screen's own
 *  root View, without the app chrome around it. */
function smallestHolding(node: unknown, ids: readonly string[]): unknown {
  const all = (n: unknown) => ids.every((id) => holds(n, id));
  if (!all(node)) return null;
  let cur: unknown = node;
  for (;;) {
    const kids = Array.isArray(cur) ? cur : ((cur as JsonNode).children as unknown);
    const list = Array.isArray(kids) ? kids : [];
    const next = list.find((k) => all(k));
    if (next == null) return cur;
    cur = next;
  }
}

// ═══ (a) app/ask.tsx at '/ask' in the real app ═════════════════════════════

// Platform-branching on web: the real app cannot mount with Platform.OS 'web'
// under jest (no window.location), so — as in w6d-forms-phone — the app mounts
// on iOS with the Ask screen injected at a synthetic route (an override at
// './ask.tsx' would collide with the real file) inside a FlipToWeb, which
// re-keys (remounts) ONLY that subtree after Platform.OS flips to 'web'.
let mockFlip: (() => void) | null = null;
function FlipToWeb({ children }: { children: () => React.ReactElement }) {
  const [gen, setGen] = React.useState(0);
  mockFlip = () => setGen((g) => g + 1);
  return <React.Fragment key={gen}>{children()}</React.Fragment>;
}
const AskWebProbe = () => <FlipToWeb>{() => <AskMageScreen />}</FlipToWeb>;

function askSubtree(json: unknown): unknown {
  const screenTree = smallestHolding(json, ['ask-close', 'ask-input']);
  expect(screenTree).not.toBeNull();
  return clockFree(phoneView(screenTree));
}

async function askPage(url: string): Promise<unknown> {
  const tree = await mountRouteChecked(url);
  // expo-router's test pathname folds the `screen` query param (a reserved
  // react-navigation param) into the path; the route is still /ask.
  expect(tree.getPathname()).toMatch(/^\/ask/);
  return askSubtree(tree.toJSON());
}

async function askPageWeb(): Promise<unknown> {
  const tree = await mountRouteChecked('/k1-ask-web-probe', AskWebProbe);
  const back = jest.replaceProperty(Platform, 'OS', 'web').restore;
  try {
    await act(async () => {
      mockFlip?.();
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
    await act(async () => { jest.advanceTimersByTime(1000); await Promise.resolve(); });
    return askSubtree(tree.toJSON());
  } finally {
    back();
  }
}

describe('Ask MAGE page on a phone (real app)', () => {
  it('390 ios, no params (empty world)', async () => {
    as('ios', 390);
    await primeWorld('empty');
    expect(await askPage('/ask')).toMatchSnapshot();
  });

  it('390 ios, anchored to the job from project-detail (populated world)', async () => {
    as('ios', 390);
    await primeWorld('populated');
    expect(await askPage(`/ask?projectId=${PROJECT_ID}&screen=project-detail`)).toMatchSnapshot();
  });

  it('web 390, no params (empty world)', async () => {
    as('ios', 390);
    await primeWorld('empty');
    expect(await askPageWeb()).toMatchSnapshot();
  });
});

// ═══ (b) BrainFab on '/(tabs)/(home)' ═══════════════════════════════════════

const Pass = () => <Slot />;
const FabProbe = () => <BrainFab />;
const FAB_TREE: Record<string, React.ComponentType> = {
  '(tabs)/_layout': Pass,
  '(tabs)/(home)/_layout': Pass,
  '(tabs)/(home)/index': FabProbe,
};

async function fabTree(): Promise<unknown> {
  mockFakeTheme = true;
  const tree = renderRouter(FAB_TREE, { initialUrl: '/' });
  await act(async () => {
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
  });
  expect(tree.queryByTestId('brain-fab')).not.toBeNull();
  return phoneView(tree.toJSON());
}

describe('BrainFab on a phone', () => {
  it('390 ios', async () => { as('ios', 390); expect(await fabTree()).toMatchSnapshot(); });
  it('web 390', async () => { as('web', 390); expect(await fabTree()).toMatchSnapshot(); });
  it('web 820 (below the 900 desktop gate)', async () => { as('web', 820, 1180); expect(await fabTree()).toMatchSnapshot(); });
});
