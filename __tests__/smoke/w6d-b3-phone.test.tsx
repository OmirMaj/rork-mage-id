/**
 * Wave 6d (d6r), lane B3 — Buyout and the bid package on desktop. PHONE PROOF.
 *
 * The lane turns Buyout's package cards into a linked, sortable table, puts
 * the package page's hero and bids beside a 360 rail (scope, invites), and
 * turns the six opaque full-window pageSheets into centred cards. Every one of
 * those edits is `isDesktop && …`, a sheet frame whose phone branch is null,
 * or a `useIsDesktopWeb()` switch whose phone arm is today's JSX — so on the
 * iPhone NOTHING may change. This file is the proof.
 *
 * GOLDEN — recorded FIRST, on a pristine archive of the untouched base
 * (24e74ecf), before a line of this lane was written, and never regenerated.
 * Each case mounts the real route inside the real app (the 16-provider stack,
 * the populated fixture world) at 390 × 844 iOS with useResponsiveLayout
 * mocked to phone, and records the whole rendered tree.
 *
 * The buyout collections are seeded straight into the provider's own cache
 * keys (mageid_bid_packages / mageid_bid_package_bids — the supabase mock
 * answers every list with [], so ProjectContext falls back to loadLocal, which
 * reads a plain JSON array). Five packages cover every branch of the card's
 * four-way result (budget at sell, savings, overrun, lowest bid, no bids) and
 * the OVERDUE / undated chase line — so the packageRowView extraction (a pure
 * refactor of the per-card derivation) is proven by these renders.
 *
 * EVERY <Modal> RENDERS ITS CONTENT, open or not (the w6c-field-phone mock),
 * and records `visible`, `transparent`, `animationType` and
 * `presentationStyle` — so each package screen's snapshot holds all five
 * sheets (add bid, amount, invite, scope, link) and Buyout's holds the new
 * package sheet, each in its phone styles and its original pageSheet props.
 *
 * What a snapshot records: every style FLATTENED (a `false` left by
 * `isDesktop && …` renders nothing), handler props dropped, undefined props
 * dropped; the dump's line count and sha256. Both clocks are pinned.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
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

// useIsDesktopWeb(): the app's own answer (false on iOS). Kept overridable so
// the harness matches w6c-field-phone; no case here forces it on.
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
const GOLDEN_CLOCK = new Date('2026-09-26T15:00:00.000Z').getTime();
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

// ── What a snapshot records (the w6c-field-phone fingerprint) ──────────────
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

// ── The buyout world ───────────────────────────────────────────────────────
// Dates are relative to the fixture's pinned today (2026-08-15).
const T = '2026-08-01T12:00:00.000Z';
/** An estimate line priced WITH its markup baked into lineTotal (cost
 *  5 × 1,000 = 5,000; sell 5,750): a package budgeted at its sell sum is the
 *  "Budget includes markup — review" branch. The fixture's own lines carry
 *  lineTotal = cost, so none of them can reach it. */
const SELL_ITEM = {
  materialId: 'mat-b3-tile', name: 'Porcelain tile — primary bath floor + walls', category: 'tile',
  unit: 'LS', quantity: 5, unitPrice: 1000, bulkPrice: 1000, markup: 15, usesBulk: false,
  lineTotal: 5750, supplier: 'Rose City Tile', csiDivision: '09',
};
const base = { projectId: PROJECT_ID, createdAt: T, updatedAt: T };
const B3_PACKAGES = [
  // Open, two bids, a scope, a bid date already past → OVERDUE; "Lowest".
  { ...base, id: 'pkg-b3-plumb', name: 'Plumbing rough-in', phase: 'Rough-in', csiDivision: '22',
    scopeDescription: '• Plumbing rough + trim — 1 LS', linkedEstimateItemIds: [], estimateBudget: 16000,
    status: 'open', dueDate: '2026-08-10T12:00:00.000Z' },
  // Awarded under budget → savings.
  { ...base, id: 'pkg-b3-elec', name: 'Electrical', phase: 'Rough-in', csiDivision: '26',
    scopeDescription: '• Electrical rough + trim — 1 LS', linkedEstimateItemIds: [], estimateBudget: 20000,
    status: 'awarded', awardedBidId: 'bid-b3-elec-1', awardedCommitmentId: 'commit-b3-elec' },
  // Awarded over budget → overrun.
  { ...base, id: 'pkg-b3-drywall', name: 'Drywall', phase: 'Finishes', linkedEstimateItemIds: [],
    estimateBudget: 8000, status: 'awarded', awardedBidId: 'bid-b3-drywall-1' },
  // Budgeted at the linked line's SELL → flagged, never counted.
  { ...base, id: 'pkg-b3-tile', name: 'Tile', phase: 'Finishes', csiDivision: '09',
    linkedEstimateItemIds: ['mat-b3-tile'], estimateBudget: 5750, status: 'leveling',
    dueDate: '2026-08-29T12:00:00.000Z' },
  // No bids, no scope, no date.
  { ...base, id: 'pkg-b3-finish', name: 'Finish carpentry', linkedEstimateItemIds: [], estimateBudget: 5000,
    status: 'open' },
];
const bidBase = { createdAt: T, updatedAt: T, submittedAt: T, source: 'manual' };
const B3_BIDS = [
  { ...bidBase, id: 'bid-b3-plumb-1', packageId: 'pkg-b3-plumb', vendorName: "Joe's Plumbing", amount: 14800,
    includes: 'All rough + trim plumbing', excludes: 'Fixtures', terms: 'Net 30', status: 'received' },
  { ...bidBase, id: 'bid-b3-plumb-2', packageId: 'pkg-b3-plumb', vendorName: 'Ace Mechanical', amount: 17250,
    status: 'received' },
  { ...bidBase, id: 'bid-b3-elec-1', packageId: 'pkg-b3-elec', vendorName: 'Northline Electric', amount: 18900,
    status: 'awarded' },
  { ...bidBase, id: 'bid-b3-drywall-1', packageId: 'pkg-b3-drywall', vendorName: "Mike's Drywall", amount: 9100,
    status: 'awarded' },
  { ...bidBase, id: 'bid-b3-tile-1', packageId: 'pkg-b3-tile', vendorName: 'Rose City Tile', amount: 5200,
    status: 'received' },
];
async function seedBuyout() {
  const raw = await AsyncStorage.getItem('mageid_projects');
  const projects = raw ? JSON.parse(raw) as Array<{ id: string; linkedEstimate?: { items: unknown[] } }> : [];
  const p = projects.find((x) => x.id === PROJECT_ID);
  if (p?.linkedEstimate?.items) p.linkedEstimate.items.push(SELL_ITEM);
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(projects));
  await AsyncStorage.setItem('mageid_bid_packages', JSON.stringify(B3_PACKAGES));
  await AsyncStorage.setItem('mageid_bid_package_bids', JSON.stringify(B3_BIDS));
}

async function phoneRoute(url: string, before?: () => Promise<void>) {
  env('ios', 390, 844);
  await primeWorld('populated');
  if (before) await before();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

describe('lane B3 — the phone is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  const ROUTES: Array<[string, string, (() => Promise<void>) | undefined]> = [
    ['buyout (populated, no packages — the empty branch + the new-package sheet)', `/buyout?${P}`, undefined],
    ['buyout (five packages: sell basis, savings, overrun, lowest, no bids)', `/buyout?${P}`, seedBuyout],
    ['buyout-package: open, two bids, scope, overdue (all five sheets)', '/buyout-package?packageId=pkg-b3-plumb', seedBuyout],
    ['buyout-package: awarded (commitment link + A401)', '/buyout-package?packageId=pkg-b3-elec', seedBuyout],
    ['buyout-package: awarded over budget', '/buyout-package?packageId=pkg-b3-drywall', seedBuyout],
    ['buyout-package: budget at sell (the review warning)', '/buyout-package?packageId=pkg-b3-tile', seedBuyout],
    ['buyout-package: no bids, no scope (invite blocked)', '/buyout-package?packageId=pkg-b3-finish', seedBuyout],
    ['buyout-package: not found', '/buyout-package?packageId=pkg-b3-missing', seedBuyout],
  ];

  it.each(ROUTES)('%s', async (name, url, before) => {
    const tree = await phoneRoute(url, before);
    expect(fingerprint(name, tree.toJSON())).toMatchSnapshot();
  });
});
