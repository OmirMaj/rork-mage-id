/**
 * App Store wave, lane APPPAY — the three purchase screens on an iPhone, WITH
 * store packages loaded. PHONE PROOF.
 *
 * The goldens in w6d-forms-phone / w6d-z2-phone run in the harness's keyless
 * world (no RevenueCat key → no offerings), so after this lane they record the
 * honest "Plans couldn't load from the App Store" state. This file supplies
 * packages through useSubscription (the real provider stays mounted; only the
 * fields a purchase screen reads are overridden) and proves what App Review
 * will see with the six products attached:
 *   - the billed amount is the big figure (annual: the yearly total + "/year");
 *   - Privacy, Restore, Terms and the auto-renew sentence on every screen;
 *   - a plan with no package has no card, and no package at all is one honest
 *     state with a Retry — never an email, never "Not in the App Store yet";
 *   - a purchase failure never shows the store's own message;
 *   - nothing names Android, a beta, "Early access" or "Cancel anytime".
 */

import React from 'react';
import { Dimensions, Platform } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import Paywall from '@/components/Paywall';

// ── Store packages, injected through useSubscription ─────────────────────────
type Over = Record<string, unknown>;
let mockSub: Over | null = null;
jest.mock('@/contexts/SubscriptionContext', () => {
  const actual = jest.requireActual('@/contexts/SubscriptionContext');
  return {
    ...actual,
    useSubscription: () => {
      const real = actual.useSubscription();
      return mockSub ? { ...real, ...mockSub } : real;
    },
  };
});

// Every alert the screens raise, recorded (title, body).
const mockAlerts: [string, string | undefined][] = [];
jest.mock('@/utils/alert', () => {
  const actual = jest.requireActual('@/utils/alert');
  return { ...actual, showAlert: (title: string, body?: string) => { mockAlerts.push([title, body]); } };
});

// Phone layout.
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'phone', isPhone: true, isTablet: false, isDesktop: false, width: 390, height: 844,
    contentMaxWidth: 390, sidebarWidth: 0, showSidebar: false, ganttRowHeight: 32,
  }),
}));

// Every Modal renders its content (the purchase modal is a pageSheet Modal).
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView } = jest.requireActual('react-native');
  function Modal(props: { children?: React.ReactNode }) {
    return ReactActual.createElement(RNView, { testID: 'apppay-modal' }, props.children);
  }
  return { __esModule: true, default: Modal };
});

const pkg = (identifier: string, productId: string, price: number, priceString: string) => ({
  identifier,
  packageType: 'CUSTOM',
  offeringIdentifier: 'default',
  product: { identifier: productId, price, priceString, title: identifier, description: '', currencyCode: 'USD' },
});
const PRO_M = pkg('pro_monthly', 'com.mageid.pro.monthly', 29.99, '$29.99');
const PRO_A = pkg('pro_annual', 'com.mageid.pro.annual', 289.99, '$289.99');
const BIZ_M = pkg('business_monthly', 'com.mageid.business.monthly', 79.99, '$79.99');
const BIZ_A = pkg('business_annual', 'com.mageid.business.annual', 769.99, '$769.99');

const mockPurchasePro = jest.fn(async (_period?: string) => {});
const mockPurchaseEnterprise = jest.fn(async (_period?: string) => {});
const mockRestore = jest.fn(async () => 'pro');

function store(packages: { pro?: boolean; proAnnual?: boolean; business?: boolean; businessAnnual?: boolean }): Over {
  return {
    tier: 'free',
    isLoading: false,
    isPurchasing: false,
    proPackage: packages.pro ? PRO_M : null,
    proAnnualPackage: packages.proAnnual ? PRO_A : null,
    businessPackage: packages.business ? BIZ_M : null,
    businessAnnualPackage: packages.businessAnnual ? BIZ_A : null,
    enterprisePackage: null,
    enterpriseAnnualPackage: null,
    purchasePro: mockPurchasePro,
    purchaseEnterprise: mockPurchaseEnterprise,
    restorePurchases: mockRestore,
  };
}
const ALL = { pro: true, proAnnual: true, business: true, businessAnnual: true };

const AUTO_RENEW_IOS = 'Subscriptions auto-renew until canceled. Manage or cancel in your App Store account settings at least 24 hours before the renewal date. Payment is charged to your Apple ID on confirmation of purchase.';
const PLAN_UNAVAILABLE = 'This plan isn’t available right now. Try again later.';
const LOAD_FAILED_IOS = 'Plans couldn’t load from the App Store. Check your connection and try again.';

// ── Environment ──────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
beforeEach(() => {
  allowConsoleErrors();
  // Widened: comparing the discriminant would narrow Platform to the non-iOS variants.
  const platform = Platform as { OS: string };
  restoreOS = platform.OS === 'ios' ? null : jest.replaceProperty(platform, 'OS', 'ios').restore;
  Dimensions.set({
    window: { width: 390, height: 844, scale: 2, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
  });
  mockAlerts.length = 0;
  mockPurchasePro.mockReset().mockImplementation(async () => {});
  mockPurchaseEnterprise.mockReset().mockImplementation(async () => {});
  mockRestore.mockReset().mockImplementation(async () => 'pro');
});
afterEach(() => {
  mockSub = null;
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
function allText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const n of node) allText(n, out); return out; }
  const el = node as { children?: unknown };
  if (el.children) allText(el.children, out);
  return out;
}
/**
 * The text of ONE purchase screen: the subtree two levels above its close
 * button (close → header → the screen's root view). The rest of the mounted
 * app (the help sheet's support address, the tab bar) is not the purchase
 * path and is left out.
 */
function screenText(json: unknown, closeTestID: string): string {
  type N = { props?: Record<string, unknown>; children?: unknown };
  const path: N[] = [];
  const walk = (node: unknown): boolean => {
    if (node == null || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(walk);
    const el = node as N;
    path.push(el);
    if (el.props?.testID === closeTestID) return true;
    if (Array.isArray(el.children) && el.children.some(walk)) return true;
    path.pop();
    return false;
  };
  if (!walk(json)) throw new Error(`no ${closeTestID} in the tree`);
  const root = path[path.length - 3];
  return allText(root).join('\n');
}
async function route(url: string, sub: Over, closeTestID: string) {
  mockSub = sub;
  await primeWorld('populated');
  const tree = await mountRouteChecked(url);
  await pump();
  return screenText(tree.toJSON(), closeTestID);
}
async function modal(sub: Over, requiredTier: 'pro' | 'enterprise') {
  mockSub = sub;
  await primeWorld('populated');
  const Probe = () => <Paywall visible onClose={() => {}} feature="Invoicing" requiredTier={requiredTier} />;
  const tree = await mountRouteChecked('/apppay-paywall-sheet', Probe);
  await pump();
  return screenText(tree.toJSON(), 'paywall-modal-close');
}
function expectNoForbidden(text: string) {
  for (const bad of ['Android', 'Google Play', 'beta', 'Beta', 'Early access', 'Priority queue', 'Contact us', 'support@', 'by email', 'App Store yet', 'Cancel anytime']) {
    expect(text).not.toContain(bad);
  }
}

describe('APPPAY — the purchase modal (components/Paywall) on iOS', () => {
  jest.setTimeout(180000);

  it('annual: the yearly total is the big figure, the per-month equivalent the small line', async () => {
    const text = await modal(store(ALL), 'pro');
    expect(screen.getByText('$289.99/year')).toBeTruthy();
    expect(screen.getByText('That’s $24.16/mo, billed once a year')).toBeTruthy();
    expect(screen.queryByText('$24.16/mo')).toBeNull();
    expect(screen.getByTestId('paywall-upgrade-btn')).toBeTruthy();
    expect(text).toContain(AUTO_RENEW_IOS);
    expect(screen.getByTestId('paywall-modal-privacy')).toBeTruthy();
    expect(screen.getByTestId('paywall-modal-restore')).toBeTruthy();
    expect(screen.getByTestId('paywall-modal-terms')).toBeTruthy();
    expectNoForbidden(text);
  });

  it('monthly: the monthly price, billed monthly', async () => {
    await modal(store(ALL), 'pro');
    fireEvent.press(screen.getByTestId('paywall-period-monthly'));
    await pump(2);
    expect(screen.getByText('$29.99/month')).toBeTruthy();
    expect(screen.getByText('Billed monthly')).toBeTruthy();
  });

  it('Restore runs restorePurchases and says what the store found', async () => {
    await modal(store(ALL), 'pro');
    await act(async () => { fireEvent.press(screen.getByTestId('paywall-modal-restore')); });
    await pump(2);
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockAlerts.at(-1)?.[0]).toBe("Restored. You're on Pro.");
  });

  it('a purchase failure never shows the store message', async () => {
    mockPurchasePro.mockImplementation(async () => { throw new Error('SKErrorDomain 0 RAW_STORE_TEXT'); });
    await modal(store(ALL), 'pro');
    await act(async () => { fireEvent.press(screen.getByTestId('paywall-upgrade-btn')); });
    await pump(2);
    expect(mockPurchasePro).toHaveBeenCalledWith('annual');
    expect(mockAlerts.at(-1)).toEqual(["Couldn't Complete Purchase", "The purchase didn't go through. Try again."]);
    expect(JSON.stringify(mockAlerts)).not.toContain('RAW_STORE_TEXT');
  });

  it('a "not available" failure answers with our own sentence', async () => {
    mockPurchasePro.mockImplementation(async () => { throw new Error('The product is not available for purchase. RAW'); });
    await modal(store(ALL), 'pro');
    await act(async () => { fireEvent.press(screen.getByTestId('paywall-upgrade-btn')); });
    await pump(2);
    expect(mockAlerts.at(-1)).toEqual(['Pro isn’t available', PLAN_UNAVAILABLE]);
  });

  it('only the annual package: no toggle, and Upgrade buys annual', async () => {
    await modal(store({ proAnnual: true }), 'pro');
    expect(screen.queryByTestId('paywall-period-monthly')).toBeNull();
    expect(screen.getByText('$289.99/year')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('paywall-upgrade-btn')); });
    await pump(2);
    expect(mockPurchasePro).toHaveBeenCalledWith('annual');
  });

  it('only the monthly package: Upgrade buys monthly even though annual is the default', async () => {
    await modal(store({ pro: true }), 'pro');
    expect(screen.getByText('$29.99/month')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('paywall-upgrade-btn')); });
    await pump(2);
    expect(mockPurchasePro).toHaveBeenCalledWith('monthly');
  });

  it('a plan the store cannot sell: our sentence and a Retry, no price, no buy button, no email', async () => {
    const text = await modal(store(ALL), 'enterprise');
    expect(screen.getByTestId('paywall-plans-unavailable')).toBeTruthy();
    expect(text).toContain(PLAN_UNAVAILABLE);
    expect(screen.getByTestId('paywall-plans-unavailable-retry')).toBeTruthy();
    expect(screen.queryByTestId('paywall-upgrade-btn')).toBeNull();
    expect(text).toContain(AUTO_RENEW_IOS);
    expectNoForbidden(text);
  });

  it('no package at all: "Plans couldn’t load from the App Store" and a Retry', async () => {
    const text = await modal(store({}), 'pro');
    expect(text).toContain(LOAD_FAILED_IOS);
    expect(screen.getByTestId('paywall-plans-unavailable-retry')).toBeTruthy();
    expect(screen.queryByTestId('paywall-upgrade-btn')).toBeNull();
  });
});

describe('APPPAY — /onboarding-paywall on iOS', () => {
  jest.setTimeout(180000);

  it('annual: each card leads with the yearly total; footnote leads with it too', async () => {
    const text = await route('/onboarding-paywall', store(ALL), 'onboarding-paywall-close');
    expect(text).toContain('$289.99');
    expect(text).toContain('$769.99');
    expect(text).toContain('/year');
    expect(text).toContain('That’s $24.16/mo');
    expect(text).toContain('$289.99/year · billed annually ($24.16/mo)');
    expect(text).toContain('Teams · 5 office team members');
    expect(text).toContain(AUTO_RENEW_IOS);
    expect(screen.getByTestId('onboarding-paywall-restore')).toBeTruthy();
    expectNoForbidden(text);
  });

  it('a plan with no package has no card', async () => {
    await route('/onboarding-paywall', store({ pro: true, proAnnual: true }), 'onboarding-paywall-close');
    expect(screen.getByTestId('plan-pro')).toBeTruthy();
    expect(screen.queryByTestId('plan-business')).toBeNull();
  });

  it('no package at all: the honest state replaces the cards and the buy button', async () => {
    const text = await route('/onboarding-paywall', store({}), 'onboarding-paywall-close');
    expect(screen.getByTestId('onboarding-paywall-plans-unavailable')).toBeTruthy();
    expect(text).toContain(LOAD_FAILED_IOS);
    expect(screen.queryByTestId('onboarding-paywall-cta')).toBeNull();
    expect(screen.queryByTestId('plan-pro')).toBeNull();
    expect(screen.getByTestId('onboarding-paywall-decline')).toBeTruthy();
  });
});

describe('APPPAY — /paywall on iOS', () => {
  jest.setTimeout(180000);

  it('only plans with a package get a card; no email path, no Android, no early access', async () => {
    const text = await route('/paywall', store({ pro: true, business: true }), 'paywall-close');
    expect(screen.getByTestId('buy-pro')).toBeTruthy();
    expect(screen.getByTestId('buy-business')).toBeTruthy();
    expect(screen.queryByTestId('buy-enterprise')).toBeNull();
    expect(screen.queryByTestId('buy-enterprise-contact')).toBeNull();
    expect(text).toContain('Voice-to-Report');
    expect(text).toContain(AUTO_RENEW_IOS);
    expect(screen.getByTestId('restore-purchases')).toBeTruthy();
    expectNoForbidden(text);
  });

  it('no package at all: the honest state with a Retry, no paid card', async () => {
    const text = await route('/paywall', store({}), 'paywall-close');
    expect(screen.getByTestId('paywall-plans-unavailable')).toBeTruthy();
    expect(text).toContain(LOAD_FAILED_IOS);
    expect(screen.queryByTestId('buy-pro')).toBeNull();
  });
});
