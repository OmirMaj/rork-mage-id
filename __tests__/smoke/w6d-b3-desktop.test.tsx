/**
 * Wave 6d (d6r), lane B3 — Buyout and the bid package on desktop web
 * (1512 × 945). Behaviour, not pixels.
 *
 * RN-web cannot run inside this native harness (expo-router reads
 * window.location on web), so each desktop case keeps Platform.OS native and
 * forces only useIsDesktopWeb() on (the w6c-field-phone pattern), with
 * useResponsiveLayout mocked to the 1512 desktop. It asserts:
 *   - /buyout renders the 'buyout-packages' DataTable; a row opens
 *     /buyout-package?packageId=… (the href getRowHref hands the <a> on web);
 *   - each Result cell is the phone card's words for its branch — budget at
 *     sell, savings, overrun, lowest bid, no bids — and the money in it is
 *     the engine's own figure (packageBuyoutSavings, the lowest bid amount);
 *   - the package page is main | rail (dashboard-columns-row): hero and bids
 *     in main, scope, invitations and delete in the 360 rail;
 *   - all six sheets (new package; add bid, amount, invite, scope, link) are
 *     centred cards: a transparent 'fade' Modal with no pageSheet, the frame's
 *     card (maxWidth = Layout.sheet[size], Radius.xl corners) and a scrim;
 *   - the invite sheet's Cmd+S does nothing while Cmd+Enter sends (its
 *     primary emails subs), and the add-bid sheet's Cmd+S does save;
 *   - a native tablet (android 1100: isDesktop, NOT desktop web) keeps the
 *     phone's card list and one-column page — both switches read
 *     useIsDesktopWeb().
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, world } from '@/__tests__/fixtures/world';
import { Layout, Radius } from '@/constants/designTokens';
import { Colors } from '@/constants/colors';
import { formatMoney } from '@/utils/formatters';
import { packageBuyoutSavings } from '@/utils/projectFinancials';
import { BID_PACKAGE_STATUS_LABELS, type BidPackage, type BidPackageBid } from '@/types';

/** A rendered node (react-test-renderer's instance, as RNTL's queries return it). */
type ReactTestInstance = ReturnType<typeof screen.getByTestId>;

jest.mock('@/utils/alert', () => ({ ...jest.requireActual('@/utils/alert'), showAlert: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const alertMock = require('@/utils/alert') as { showAlert: jest.Mock };

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
// unless a desktop-web case forces it.
let mockForceDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => (mockForceDesktopWeb ? actual.useIsDesktop() : actual.useIsDesktopWeb()) };
});

// Every Modal renders its content, open or closed, and records its props.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  class Boundary extends ReactActual.Component<{ children?: React.ReactNode }, { threw: boolean }> {
    state = { threw: false };
    static getDerivedStateFromError() { return { threw: true }; }
    componentDidCatch() { /* recorded as a placeholder */ }
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

// A fake DOM for the hotkey registry (hooks/useHotkeys attaches its keydown
// listeners to `window` only when `document` exists). Installed AFTER the
// route mounts, so nothing else in the app sees a half-browser while it
// renders; a sheet opened afterwards registers its keys against it.
type KeyHandler = (ev: Record<string, unknown>) => void;
const g = globalThis as unknown as Record<string, unknown>;
const keyHandlers: KeyHandler[] = [];
function installDom() {
  g.document = {};
  g.addEventListener = jest.fn((type: string, fn: KeyHandler) => { if (type === 'keydown') keyHandlers.push(fn); });
  g.removeEventListener = jest.fn((type: string, fn: KeyHandler) => {
    const i = keyHandlers.indexOf(fn);
    if (type === 'keydown' && i >= 0) keyHandlers.splice(i, 1);
  });
}
function removeDom() {
  delete g.document;
  delete g.addEventListener;
  delete g.removeEventListener;
  keyHandlers.length = 0;
}
function press(key: string, mods: Record<string, unknown> = {}) {
  act(() => {
    for (const h of [...keyHandlers]) h({ key, preventDefault: () => {}, stopPropagation: () => {}, ...mods });
  });
}

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
  alertMock.showAlert.mockClear();
  allowConsoleErrors();
});
afterEach(() => {
  mockForceDesktopWeb = false;
  removeDom();
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

const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
function texts(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, out)); return out; }
  const kids = (node as { children?: unknown }).children;
  if (kids) texts(kids, out);
  return out;
}
const textIn = (inst: ReactTestInstance) => texts(inst.children as unknown).join('');

// ── The buyout world (the same seed as w6d-b3-phone) ───────────────────────
const T = '2026-08-01T12:00:00.000Z';
const SELL_ITEM = {
  materialId: 'mat-b3-tile', name: 'Porcelain tile — primary bath floor + walls', category: 'tile',
  unit: 'LS', quantity: 5, unitPrice: 1000, bulkPrice: 1000, markup: 15, usesBulk: false,
  lineTotal: 5750, supplier: 'Rose City Tile', csiDivision: '09',
};
const base = { projectId: PROJECT_ID, createdAt: T, updatedAt: T };
const B3_PACKAGES = [
  { ...base, id: 'pkg-b3-plumb', name: 'Plumbing rough-in', phase: 'Rough-in', csiDivision: '22',
    scopeDescription: '• Plumbing rough + trim — 1 LS', linkedEstimateItemIds: [], estimateBudget: 16000,
    status: 'open', dueDate: '2026-08-10T12:00:00.000Z' },
  { ...base, id: 'pkg-b3-elec', name: 'Electrical', phase: 'Rough-in', csiDivision: '26',
    scopeDescription: '• Electrical rough + trim — 1 LS', linkedEstimateItemIds: [], estimateBudget: 20000,
    status: 'awarded', awardedBidId: 'bid-b3-elec-1', awardedCommitmentId: 'commit-b3-elec' },
  { ...base, id: 'pkg-b3-drywall', name: 'Drywall', phase: 'Finishes', linkedEstimateItemIds: [],
    estimateBudget: 8000, status: 'awarded', awardedBidId: 'bid-b3-drywall-1' },
  { ...base, id: 'pkg-b3-tile', name: 'Tile', phase: 'Finishes', csiDivision: '09',
    linkedEstimateItemIds: ['mat-b3-tile'], estimateBudget: 5750, status: 'leveling',
    dueDate: '2026-08-29T12:00:00.000Z' },
  { ...base, id: 'pkg-b3-finish', name: 'Finish carpentry', linkedEstimateItemIds: [], estimateBudget: 5000,
    status: 'open' },
] as unknown as BidPackage[];
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
] as unknown as BidPackageBid[];
async function seedBuyout() {
  const raw = await AsyncStorage.getItem('mageid_projects');
  const projects = raw ? JSON.parse(raw) as Array<{ id: string; linkedEstimate?: { items: unknown[] } }> : [];
  const p = projects.find((x) => x.id === PROJECT_ID);
  if (p?.linkedEstimate?.items) p.linkedEstimate.items.push(SELL_ITEM);
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(projects));
  await AsyncStorage.setItem('mageid_bid_packages', JSON.stringify(B3_PACKAGES));
  await AsyncStorage.setItem('mageid_bid_package_bids', JSON.stringify(B3_BIDS));
}

/** The engine's own leveled savings for a seeded package (the card and the
 *  KPI read exactly this call). */
function engineSavings(id: string): number {
  const pkg = B3_PACKAGES.find((p) => p.id === id)!;
  const v = packageBuyoutSavings(pkg, B3_BIDS.filter((b) => b.packageId === id), world.commitments);
  if (v == null) throw new Error(`no engine savings for ${id}`);
  return v;
}
const signedMoney = (n: number) => `${n >= 0 ? '+' : ''}${formatMoney(n)}`;

async function mountAt(os: 'ios' | 'android', width: number, height: number, desktopWeb: boolean, url: string) {
  env(os, width, height);
  mockForceDesktopWeb = desktopWeb;
  await primeWorld('populated');
  await seedBuyout();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}
const P = `projectId=${PROJECT_ID}`;

/** The w6c-modal a node sits in. */
function modalOf(node: ReactTestInstance): ReactTestInstance {
  let n: ReactTestInstance | null = node;
  while (n && n.props?.testID !== 'w6c-modal') n = n.parent;
  if (!n) throw new Error('not inside a Modal');
  return n;
}
/** The Modal is a centred desktop card: transparent, 'fade', no pageSheet;
 *  the frame's card style (maxWidth = Layout.sheet[size], Radius.xl) on one
 *  host node; and the frame's scrim (absolute, Colors.overlay, "Close"). */
function expectCentredCard(modal: ReactTestInstance, size: 'dialog' | 'form' | 'wide') {
  const hint = JSON.parse(String(modal.props.accessibilityHint));
  expect(hint).toMatchObject({ transparent: true, animationType: 'fade', presentationStyle: null });
  const cards = modal.findAll((n: ReactTestInstance) => typeof n.type === 'string' && (() => {
    const s = flat(n.props.style);
    return s.maxWidth === Layout.sheet[size] && s.borderRadius === Radius.xl && s.maxHeight === '85%';
  })());
  expect(cards.length).toBeGreaterThan(0);
  // …and sized to its content, up to that 85%: the phone's flex: 1 is
  // overridden, or a one-field dialog grows into a window-tall box.
  for (const c of cards) {
    const s = flat(c.props.style);
    expect(s.flexGrow).toBe(0);
    expect(s.flexBasis).toBe('auto');
  }
  const scrims = modal.findAll((n: ReactTestInstance) => typeof n.type === 'string' && n.props.accessibilityLabel === 'Close'
    && flat(n.props.style).position === 'absolute' && flat(n.props.style).backgroundColor === Colors.overlay);
  expect(scrims.length).toBeGreaterThan(0);
}

describe('lane B3 — /buyout on desktop web (1512 × 945)', () => {
  jest.setTimeout(120000);

  it('the packages are the buyout-packages table; a row opens /buyout-package?packageId', async () => {
    const tree = await mountAt('android', 1512, 945, true, `/buyout?${P}`);
    expect(screen.getByTestId('buyout-packages')).toBeTruthy();
    for (const p of B3_PACKAGES) expect(screen.getByTestId(`buyout-packages-row-${p.id}`)).toBeTruthy();
    // The phone card's own call to action is not drawn on desktop web.
    expect(screen.queryByText('Send RFP')).toBeNull();

    // OVERDUE rides on the package cell of a live package past its date.
    expect(textIn(screen.getByTestId('buyout-packages-row-pkg-b3-plumb'))).toContain('Overdue');
    // The budget of a package stored at sell says so under the number.
    expect(textIn(screen.getByTestId('buyout-packages-row-pkg-b3-tile'))).toContain(`${formatMoney(5750)}incl. markup`);

    fireEvent.press(screen.getByTestId('buyout-packages-row-pkg-b3-elec'));
    await pump(3);
    expect(tree.getPathname()).toBe('/buyout-package');
    expect(tree.getSearchParams()).toMatchObject({ packageId: 'pkg-b3-elec' });
  });

  it('the phone card\'s four-way result, in the engine\'s figures', async () => {
    // The phone card first: the words each branch prints there.
    await mountAt('ios', 390, 844, false, `/buyout?${P}`);
    const phone = texts(screen.toJSON() as unknown).join('');
    const savings = engineSavings('pkg-b3-elec');
    const overrun = engineSavings('pkg-b3-drywall');
    expect(savings).toBe(1100);
    expect(overrun).toBe(-1100);
    expect(phone).toContain('Budget Includes Markup: Review');
    expect(phone).toContain(`Buyout Savings${signedMoney(savings)}`);
    expect(phone).toContain(`Buyout Overrun${signedMoney(overrun)}`);
    expect(phone).toContain(`Lowest Bid · 2 in${formatMoney(14800)}`);
    expect(phone).toContain('No Bids YetSend RFP');
  });

  it('…and the desktop Result cell prints the same branch, in the same figures', async () => {
    // Desktop web: the same branch, the same money, one cell per row.
    const savings = engineSavings('pkg-b3-elec');
    const overrun = engineSavings('pkg-b3-drywall');
    await mountAt('android', 1512, 945, true, `/buyout?${P}`);
    const row = (id: string) => textIn(screen.getByTestId(`buyout-packages-row-${id}`));
    expect(row('pkg-b3-tile')).toContain('Budget Includes Markup: Review');
    expect(row('pkg-b3-elec')).toContain(signedMoney(savings));
    expect(row('pkg-b3-drywall')).toContain(signedMoney(overrun));
    expect(row('pkg-b3-plumb')).toContain(`Lowest ${formatMoney(14800)} · 2 in`);
    expect(row('pkg-b3-finish')).toContain('No Bids Yet');
    // No row claims a savings figure the card withholds.
    expect(row('pkg-b3-tile')).not.toContain('+');
    // Status reads whole: its one-line cell is wide enough for the longest
    // label ('Leveling · Comparing bids', ~25 characters at 13 px ≈ 170 px).
    const levelingLabel = within(screen.getByTestId('buyout-packages-row-pkg-b3-tile')).getByText(BID_PACKAGE_STATUS_LABELS.leveling);
    let cell: ReactTestInstance | null = levelingLabel;
    while (cell && typeof flat(cell.props.style).width !== 'number') cell = cell.parent;
    expect(cell).toBeTruthy();
    expect(flat(cell!.props.style).width as number).toBeGreaterThanOrEqual(170);
    // Invites: the read came back with none for these packages — words, never a bare 0/0.
    for (const p of B3_PACKAGES) expect(row(p.id)).not.toContain('0/0');
    expect(row('pkg-b3-finish')).toContain('None Sent');
  });

  it('the new-package sheet is a centred 560 card with a scrim; the FAB sits right, capped', async () => {
    await mountAt('android', 1512, 945, true, `/buyout?${P}`);
    const createBtn = screen.getByText('Create Package');
    expectCentredCard(modalOf(createBtn), 'form');

    const fabText = screen.getAllByText('New Scope Package').find((n) => {
      try { modalOf(n); return false; } catch { return true; }
    })!;
    let row: ReactTestInstance | null = fabText;
    while (row && flat(row.props.style).position !== 'absolute') row = row.parent;
    expect(row).toBeTruthy();
    const s = flat(row!.props.style);
    expect(s.right).toBe(Layout.gutter);
    expect(s.width).toBe(Layout.button.fullWidthMax);
    expect(s.left).toBe('auto');
  });
});

describe('lane B3 — /buyout-package on desktop web (1512 × 945)', () => {
  jest.setTimeout(120000);

  it('main | rail: hero and bids in main; scope, invitations and delete in the 360 rail', async () => {
    await mountAt('android', 1512, 945, true, '/buyout-package?packageId=pkg-b3-plumb');
    expect(screen.getByTestId('dashboard-columns-row')).toBeTruthy();
    const main = screen.getByTestId('dashboard-columns-main');
    const rail = screen.getByTestId('dashboard-columns-rail');
    expect(flat(rail.props.style).width).toBe(Layout.column.rail);
    const mainText = textIn(main);
    const railText = textIn(rail);
    expect(mainText).toContain('Plumbing rough-in');
    expect(mainText).toContain("Joe's Plumbing");
    expect(mainText).not.toContain('Scope of Work');
    expect(railText).toContain('Scope of Work');
    expect(railText).toContain('Invited to Bid');
    expect(railText).toContain('Delete This Package');
    expect(railText).not.toContain("Joe's Plumbing");
    // The leveling CTA travels with the scope (2 bids in, not awarded).
    expect(railText).toContain('Level the Bids');
    expect(within(rail).getByTestId('invite-subs-to-bid')).toBeTruthy();
  });

  it('all five sheets are centred cards at their sizes, each over a scrim', async () => {
    await mountAt('android', 1512, 945, true, '/buyout-package?packageId=pkg-b3-plumb');
    expectCentredCard(modalOf(screen.getByTestId('add-bid-amount')), 'form');
    expectCentredCard(modalOf(screen.getByTestId('bid-amount-save')), 'dialog');
    expectCentredCard(modalOf(screen.getByTestId('invite-send')), 'form');
    expectCentredCard(modalOf(screen.getByTestId('scope-save')), 'wide');
    expectCentredCard(modalOf(screen.getByText('Who sent this bid?')), 'form');
  });

  it('the invite sheet: Cmd+S does nothing, Cmd+Enter sends; the add-bid sheet saves on Cmd+S', async () => {
    await mountAt('android', 1512, 945, true, '/buyout-package?packageId=pkg-b3-plumb');
    installDom();
    fireEvent.press(screen.getByTestId('invite-subs-to-bid'));
    await pump(2);
    expect(JSON.parse(String(modalOf(screen.getByTestId('invite-send')).props.accessibilityHint)).visible).toBe(true);

    press('s', { metaKey: true });
    press('s', { ctrlKey: true });
    await pump(2);
    // Nothing ran: no send, not even the "no addresses" refusal.
    expect(alertMock.showAlert).not.toHaveBeenCalled();

    press('Enter', { metaKey: true });
    await pump(2);
    // The send ran — with no addresses typed it stops at its own refusal.
    expect(alertMock.showAlert).toHaveBeenCalledWith('No Email Addresses', expect.any(String));

    // Close it; the add-bid sheet's primary is a save, so Cmd+S runs it.
    alertMock.showAlert.mockClear();
    const closeInvite = within(modalOf(screen.getByTestId('invite-send'))).getAllByLabelText('Close');
    fireEvent.press(closeInvite[0]);
    await pump(2);
    fireEvent.press(screen.getByText('Add by Hand'));
    await pump(2);
    press('s', { metaKey: true });
    await pump(2);
    expect(alertMock.showAlert).toHaveBeenCalledWith('Add the Vendor', expect.any(String));
  });
});

describe('lane B3 — native tablet (android 1100: isDesktop, not desktop web)', () => {
  jest.setTimeout(120000);

  it('/buyout keeps the card list (the table sits behind useIsDesktopWeb)', async () => {
    await mountAt('android', 1100, 800, false, `/buyout?${P}`);
    expect(screen.queryByTestId('buyout-packages')).toBeNull();
    expect(screen.getByText('Send RFP')).toBeTruthy();
  });

  it('/buyout-package keeps the one-column page', async () => {
    await mountAt('android', 1100, 800, false, '/buyout-package?packageId=pkg-b3-plumb');
    expect(screen.queryByTestId('dashboard-columns-row')).toBeNull();
    expect(screen.queryByTestId('dashboard-columns-main')).toBeNull();
    expect(screen.getByTestId('invite-subs-to-bid')).toBeTruthy();
  });
});
