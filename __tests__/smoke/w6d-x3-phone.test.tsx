/**
 * Wave 6d restore (d6r), lane X3 — PHONE PROOF for the last sheet batches.
 *
 * Lane X3 reframes, on DESKTOP only:
 *   • batch G + H — twelve opaque full-window tools (AI estimator, compare
 *     estimates, material AI estimate, productivity + square-foot calculators,
 *     the takeoff page inspector, the company AI profile, the project report,
 *     the weekly summary, cash-flow setup, the client paywall, Email→RFI) into
 *     the 880 px right-docked panel (useSheetFrame('panel') + SheetOverlay +
 *     SheetScrim + the frame's card);
 *   • batch F — the managed-property, work-order, OAC-meeting, shared-schedule
 *     and client-view sheets into centred cards (useSheetFrame('form')), and
 *     the client-view photo lightbox into the dialog scope only.
 * On the iPhone none of that may change a pixel: every frame part is null on
 * a phone, SheetOverlay is a Fragment there and SheetScrim is null, showHandle
 * is true, animationType is the caller's own literal, `transparent={fP.
 * transparent}` is undefined exactly as the absent prop was (`?? false` gives
 * the old false), and the dialog-scope hooks register nothing off desktop web.
 * This file is the proof. A last, snapshot-free block mounts each tool at 1512
 * wide (isDesktop) and checks the other side: transparent, fading, and capped
 * at the 880 px Layout.sheet.panel.
 *
 * GOLDEN — recorded FIRST, on a pristine archive of the base (6a77feee),
 * before a line of this lane was written, and never regenerated (run --ci).
 *
 * Each tool is mounted ALONE (never through its host route: /takeoff is a
 * list-round-3 file) as an injected screen inside the real app, so every
 * provider it reads is the real one over the populated fixture world; only
 * the probe's own subtree (testID 'x3-probe') is recorded, so a sibling lane's
 * edit to the app shell cannot move these goldens. The batch-F screens are
 * mounted as routes with the every-route param bag and recorded whole.
 *
 * What a snapshot records (the w6c-field-phone harness): every style
 * FLATTENED, handler props dropped, undefined props dropped, and every <Modal>
 * rendered — open or closed — with its visible / transparent / animationType /
 * presentationStyle recorded on a host View. Clocks are pinned.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID, PORTAL_ID, PORTAL_TOKEN, world } from '@/__tests__/fixtures/world';
import { setColorTheme } from '@/constants/colors';
import { Layout } from '@/constants/designTokens';
import type { TakeoffResult } from '@/types';
import type { RenderedPlanPage } from '@/utils/pdfRenderClient';
import AIQuickEstimate from '@/components/AIQuickEstimate';
import EstimateComparison from '@/components/EstimateComparison';
import MaterialAIEstimateModal from '@/components/MaterialAIEstimateModal';
import ProductivityCalculator from '@/components/ProductivityCalculator';
import SquareFootEstimator from '@/components/SquareFootEstimator';
import { TakeoffPageInspector } from '@/components/TakeoffPageInspector';
import { AIProfileSetup } from '@/components/AIBidScorer';
import AIProjectReport from '@/components/AIProjectReport';
import AIWeeklySummary from '@/components/AIWeeklySummary';
import CashFlowSetup from '@/components/CashFlowSetup';
import ClientPaywall from '@/components/ClientPaywall';
import RFITriageModal from '@/components/RFITriageModal';

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

// Every Modal renders its content, open or closed, and records its props.
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
        testID: 'x3-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(width: number, height: number) {
  restoreOS?.();
  restoreOS = jest.replaceProperty(Platform, 'OS', 'ios').restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = false;
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Two clocks, both pinned (see w6c-field-phone for why the outer realm's
// Date.now — the one renderRouter's fake timers start from — is pinned too).
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-26T16:00:00.000Z').getTime();
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
  setColorTheme('light');
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
function modalCount(text: string): number {
  return (text.match(/testID="x3-modal"/g) ?? []).length;
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string; modals: number } {
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.X3_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: out.length, sha256, modals: modalCount(text) };
}

/** The probe's own subtree (the injected screen's wrapper), or null. */
function probeSubtree(node: unknown): unknown {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = probeSubtree(n); if (hit) return hit; }
    return null;
  }
  const el = node as { props?: Record<string, unknown>; children?: unknown };
  if (el.props?.testID === 'x3-probe') return el;
  return probeSubtree(el.children);
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

type Scheme = 'light' | 'dark';

/** Mount one tool alone, inside the real app, on iOS (390 wide unless given) in `scheme`. */
async function probe(name: string, render: () => React.ReactElement, scheme: Scheme, width = 390, height = 844) {
  env(width, height);
  await primeWorld('populated');
  await AsyncStorage.setItem('mageid_theme', scheme);
  setColorTheme(scheme);
  const Probe = () => <View testID="x3-probe">{render()}</View>;
  const tree = await mountRouteChecked(`/w6d-x3-${name}`, Probe);
  await pump();
  const sub = probeSubtree(tree.toJSON());
  if (!sub) throw new Error(`the ${name} probe did not render`);
  return sub;
}

const noop = () => {};

const PAGES: RenderedPlanPage[] = [
  { pageNumber: 1, storagePath: 'plan-sheets/smoke/plan-page-1.png', viewUrl: 'https://example.test/plan-page-1.png', width: 1700, height: 1100 },
  { pageNumber: 2, storagePath: 'plan-sheets/smoke/plan-page-2.png', viewUrl: 'https://example.test/plan-page-2.png', width: 1700, height: 1100 },
];
const TAKEOFF = {
  summary: 'Two-storey single-family renovation, first floor plan and elevations.',
  scale: { num: 0.25, unit: 'in', perValue: 1, perUnit: 'ft' },
  drawingsSeen: [
    { page: 1, type: 'Floor plan', scope: 'First floor', readability: 'clear' },
    { page: 2, type: 'Elevations', scope: 'North + south', readability: 'partial' },
  ],
  estimatedSquareFootage: 1850,
  walls: [{ id: 'w1', description: 'Interior 2x4 stud, 5/8 GWB both sides', lengthFt: 142, heightFt: 9, confidence: 'high', sourcePages: [1] }],
  floorAreas: [{ id: 'f1', roomName: 'Kitchen', areaSqFt: 210, confidence: 'medium', sourcePages: [1] }],
  doors: [{ id: 'd1', mark: 'D1', description: '3068 solid core', count: 6, confidence: 'high', sourcePages: [1] }],
  windows: [{ id: 'n1', mark: 'W2', description: 'Double hung 3040', count: 4, confidence: 'low', sourcePages: [2] }],
  finishes: [],
  fixtures: [],
  bulkMaterials: [],
  concerns: [],
  doubleCheck: [],
  missingScopes: [],
  confidenceOverall: 'medium',
  confidenceExplanation: 'The floor plan is clear; the elevations are partly cut off.',
} as unknown as TakeoffResult;

// Batch F: each screen as a route, with the every-route param bag. It runs
// FIRST: a whole-app route mount after the injected probe screens below fails
// to mount in this harness ("Can't access .root on unmounted test renderer").
const PARAMS = new URLSearchParams({ projectId: PROJECT_ID, id: PROJECT_ID, estimateId: ESTIMATE_ID, t: PORTAL_TOKEN }).toString();
// The GC's own preview of the portal (portalId, as q4-financing-portal mounts
// it) resolves against the populated world, so the approval sheet and the
// photo lightbox render with the screen instead of its loading branch.
const ROUTES = [
  `/managed-property?${PARAMS}`,
  `/work-order?${PARAMS}`,
  `/oac-meeting?${PARAMS}`,
  `/shared-schedule?${PARAMS}`,
  `/client-view?${PARAMS}`,
  `/client-view?portalId=${encodeURIComponent(PORTAL_ID)}`,
];
// Snapshot names stay the bare route for the param-bag cases.
const routeName = (url: string) => (url.endsWith(PARAMS) ? url.slice(0, url.indexOf('?')) : url);

describe('lane X3 — batch F: the screens are unchanged on the iPhone (golden, iOS 390)', () => {
  jest.setTimeout(180000);

  it.each(ROUTES.map((u) => [routeName(u), u]))('%s', async (name, url) => {
    env(390, 844);
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_theme', 'light');
    setColorTheme('light');
    const tree = await mountRouteChecked(url);
    await pump();
    expect(fingerprint(`route-${name}`, tree.toJSON())).toMatchSnapshot();
  });
});

// Batch G and H: each tool alone, visible, light and dark.
const TOOLS: Array<[string, () => React.ReactElement]> = [
  ['ai-quick-estimate', () => (
    <AIQuickEstimate
      visible
      onClose={noop}
      onApplyEstimate={noop}
      existingMaterials={[]}
      globalMarkup={15}
      location="Brooklyn, NY"
      calculateAssemblyCost={() => ({ materialsCost: 0, laborCost: 0, totalCost: 0 })}
    />
  )],
  ['estimate-comparison', () => (
    <EstimateComparison
      visible
      onClose={noop}
      currentCart={[]}
      currentLaborCart={[]}
      currentAssemblyCart={[]}
      currentMaterialsTotal={12400}
      currentLaborTotal={8600}
      currentAssemblyTotal={0}
      currentGrandTotal={21000}
    />
  )],
  ['material-ai-estimate', () => <MaterialAIEstimateModal visible onClose={noop} />],
  ['productivity-calculator', () => <ProductivityCalculator visible onClose={noop} onAddToEstimate={noop} />],
  ['square-foot-estimator', () => <SquareFootEstimator visible onClose={noop} locationFactor={1.18} />],
  ['takeoff-page-inspector', () => (
    <TakeoffPageInspector visible onClose={noop} initialPage={1} pages={PAGES} takeoff={TAKEOFF} />
  )],
  ['ai-profile-setup', () => <AIProfileSetup visible onClose={noop} onSave={noop} initialProfile={null} />],
  ['ai-project-report', () => (
    <AIProjectReport project={world.project} invoices={[]} changeOrders={[]} subscriptionTier="enterprise" />
  )],
  ['ai-weekly-summary', () => <AIWeeklySummary projects={[world.project]} visible onClose={noop} />],
  ['cash-flow-setup', () => <CashFlowSetup visible onComplete={noop} onClose={noop} />],
  ['client-paywall-subscription', () => (
    <ClientPaywall visible mode="subscription" feature="Milestone payments" onClose={noop} onUnlocked={noop} />
  )],
  ['client-paywall-rfp-post', () => (
    <ClientPaywall visible mode="rfp-post" onClose={noop} onUnlocked={noop} />
  )],
  ['rfi-triage', () => <RFITriageModal visible onClose={noop} />],
];

const CASES: Array<[string, Scheme, () => React.ReactElement]> = TOOLS.flatMap(
  ([name, render]) => (['light', 'dark'] as Scheme[]).map((s): [string, Scheme, () => React.ReactElement] => [name, s, render]),
);

describe('lane X3 — batches G + H: each tool alone is unchanged on the iPhone (golden, iOS 390)', () => {
  jest.setTimeout(180000);

  // Each case's sha, so the dark check below reads the cases already mounted.
  // (It used to mount twice in one test; two live routers in one test leave a
  // navigation behind that kills the NEXT test's mount.)
  const shas = new Map<string, string>();
  it.each(CASES)('%s — %s', async (name, scheme, render) => {
    const sub = await probe(name, render, scheme);
    const fp = fingerprint(`${name}-${scheme}`, sub);
    shas.set(`${name}-${scheme}`, fp.sha256);
    expect(fp.modals).toBeGreaterThan(0);
    expect(fp).toMatchSnapshot();
  });

  it('dark really is dark (the dark goldens are not the light ones)', () => {
    for (const [name] of TOOLS) {
      expect(shas.get(`${name}-dark`)).toBeDefined();
      expect(shas.get(`${name}-dark`)).not.toBe(shas.get(`${name}-light`));
    }
  });
});

// ── Desktop (1512 wide): behaviour, not pixels (no snapshot) ───────────────
// isDesktop is true at >= 1024 even with Platform.OS native (the accepted 6c
// tablet rule), so the same injected mount proves the desktop wiring: every
// tool's sheet turns transparent and fades in, and its card is the 880 px
// Layout.sheet.panel — not the opaque full-window page it was.
type Json = { type?: string; props?: Record<string, unknown>; children?: unknown };
function walk(node: unknown, visit: (n: Json) => void): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  visit(node as Json);
  walk((node as Json).children, visit);
}
function modalHints(json: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  walk(json, (n) => { if (n.props?.testID === 'x3-modal') out.push(JSON.parse(String(n.props.accessibilityHint))); });
  return out;
}
function hasMaxWidth(json: unknown, w: number): boolean {
  let hit = false;
  walk(json, (n) => { if (!hit && n.props?.style != null && flat(n.props.style).maxWidth === w) hit = true; });
  return hit;
}

describe('lane X3 — desktop 1512: each tool is the 880 px right-docked panel', () => {
  jest.setTimeout(180000);

  it.each(TOOLS)('%s', async (name, render) => {
    const sub = await probe(name, render, 'light', 1512, 945);
    // The tool's own sheet (the first Modal in its tree) is transparent and fades.
    const [own] = modalHints(sub);
    expect(own).toMatchObject({ transparent: true, animationType: 'fade' });
    expect(hasMaxWidth(sub, Layout.sheet.panel)).toBe(true);
  });

  it('the same tools at 390 carry no panel (the phone is untouched)', async () => {
    const sub = await probe('cash-flow-setup', () => <CashFlowSetup visible onComplete={noop} onClose={noop} />, 'light');
    const [own] = modalHints(sub);
    expect(own).toMatchObject({ transparent: null, animationType: 'slide' });
    expect(hasMaxWidth(sub, Layout.sheet.panel)).toBe(false);
  });
});
