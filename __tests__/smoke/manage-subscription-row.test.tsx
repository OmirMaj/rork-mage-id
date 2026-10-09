/**
 * WEBCANCEL (2026-10-09) — the Manage Subscription row, in each state.
 *
 * A web subscriber had one way to cancel: an email. The row now opens the
 * billing page RevenueCat reports (CustomerInfo.managementURL) and falls back
 * to the email only when RevenueCat reports none. This file renders the real
 * row with the real words and proves, per account:
 *   - iPhone subscriber: Apple's sheet, then the plan is read again; when the
 *     sheet cannot be shown, the App Store link;
 *   - web subscriber with a URL: that URL is opened, and the plan is read
 *     again when the tab is in front again;
 *   - web subscriber without one: the email, said plainly;
 *   - bought on the other store: where it is managed, with the store's link
 *     (on the web) or no link at all (on an iPhone);
 *   - Free and master accounts: a plain line, nothing to press;
 *   - the date is only the one RevenueCat reports, as "Renews on" / "Ends on";
 *   - nothing on the row says a plan was cancelled.
 */

import React from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ManageSubscriptionRow } from '@/components/ManageSubscriptionRow';

type Sub = {
  tier: 'free' | 'pro' | 'business' | 'enterprise';
  planStore: string | null;
  managementURL: string | null;
  planRenewal: { willRenew: boolean; expirationDate: string | null } | null;
  refreshCustomerInfo: jest.Mock;
  showStoreManageSheet: jest.Mock;
};
let mockSub: Sub;
let mockEmail: string | null = 'gc@example.com';

jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => mockSub }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockEmail ? { id: 'u1', email: mockEmail } : null }) }));

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

const mockAlerts: [string, string | undefined][] = [];
jest.mock('@/utils/alert', () => ({ showAlert: (title: string, body?: string) => { mockAlerts.push([title, body]); } }));

const PORTAL = 'https://billing.revenuecat.com/manage/abc123';
const realOS = Platform.OS;
const setOS = (os: string) => { Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os }); };

let openURL: jest.SpyInstance;
let appStateHandlers: ((s: string) => void)[] = [];

function sub(over: Partial<Sub> = {}): Sub {
  return {
    tier: 'pro', planStore: null, managementURL: null, planRenewal: null,
    refreshCustomerInfo: jest.fn(() => Promise.resolve()),
    showStoreManageSheet: jest.fn(() => Promise.resolve(false)),
    ...over,
  };
}

/** Every string on screen, joined. */
function words(): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === 'object' && 'children' in (n as object)) walk((n as { children: unknown }).children);
  };
  walk(screen.toJSON());
  return out.join(' ');
}

beforeEach(() => {
  mockAlerts.length = 0;
  mockEmail = 'gc@example.com';
  appStateHandlers = [];
  openURL = jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (s: string) => void) => {
    appStateHandlers.push(handler);
    return { remove: () => { appStateHandlers = appStateHandlers.filter((h) => h !== handler); } };
  }) as never);
});

afterEach(() => {
  setOS(realOS);
  jest.restoreAllMocks();
});

const NEVER = /has been cancel|was cancel|is now cancel|we cancel|successfully|within (one|1) business day|refund/i;

describe('Manage Subscription row', () => {
  it('iPhone subscriber: Apple’s sheet, then the plan is read again', async () => {
    setOS('ios');
    mockSub = sub({ planStore: 'APP_STORE', showStoreManageSheet: jest.fn(() => Promise.resolve(true)), planRenewal: { willRenew: true, expirationDate: '2026-11-09T12:00:00Z' } });
    render(<ManageSubscriptionRow />);
    expect(screen.getByTestId('manage-subscription-label').props.children).toBe('Manage Subscription');
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('Opens your App Store subscriptions, where you can change or cancel your plan.');
    expect(String(screen.getByTestId('manage-subscription-renewal').props.children)).toMatch(/^Renews on .*2026/);
    await act(async () => { fireEvent.press(screen.getByTestId('manage-subscription-link')); });
    expect(mockSub.showStoreManageSheet).toHaveBeenCalledTimes(1);
    expect(openURL).not.toHaveBeenCalled();
    expect(mockSub.refreshCustomerInfo).toHaveBeenCalledTimes(1);
    expect(words()).not.toMatch(NEVER);
    expect(words()).not.toMatch(/Android|Google Play|help@mageid/);
  });

  it('iPhone subscriber, sheet unavailable: the App Store link, and a refresh on return', async () => {
    setOS('ios');
    mockSub = sub({ planStore: 'APP_STORE' });
    render(<ManageSubscriptionRow />);
    await act(async () => { fireEvent.press(screen.getByTestId('manage-subscription-link')); });
    expect(openURL).toHaveBeenCalledWith('itms-apps://apps.apple.com/account/subscriptions');
    expect(mockSub.refreshCustomerInfo).not.toHaveBeenCalled();
    await act(async () => { appStateHandlers.forEach((h) => h('active')); });
    expect(mockSub.refreshCustomerInfo).toHaveBeenCalledTimes(1);
    // Coming to the front again with nothing pending reads nothing.
    await act(async () => { appStateHandlers.forEach((h) => h('active')); });
    expect(mockSub.refreshCustomerInfo).toHaveBeenCalledTimes(1);
  });

  it('web subscriber with a management URL: opens exactly that URL, then reads the plan again', async () => {
    setOS('web');
    mockSub = sub({ planStore: 'RC_BILLING', managementURL: PORTAL, planRenewal: { willRenew: false, expirationDate: '2026-11-09T12:00:00Z' } });
    render(<ManageSubscriptionRow />);
    expect(screen.getByTestId('manage-subscription-label').props.children).toBe('Manage Subscription');
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('Opens your billing page in a new tab, where you can change or cancel your plan.');
    // He turned renewal off on the billing page: RevenueCat reports an end date, and that is all the row says.
    expect(String(screen.getByTestId('manage-subscription-renewal').props.children)).toMatch(/^Ends on .*2026/);
    await act(async () => { fireEvent.press(screen.getByTestId('manage-subscription-link')); });
    expect(mockSub.showStoreManageSheet).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(PORTAL);
    await act(async () => { appStateHandlers.forEach((h) => h('background')); });
    expect(mockSub.refreshCustomerInfo).not.toHaveBeenCalled();
    await act(async () => { appStateHandlers.forEach((h) => h('active')); });
    expect(mockSub.refreshCustomerInfo).toHaveBeenCalledTimes(1);
    expect(words()).not.toMatch(NEVER);
    expect(mockAlerts).toEqual([]);
  });

  it('web subscriber, the billing page fails to open: the fallback words, with the email', async () => {
    setOS('web');
    mockSub = sub({ planStore: 'RC_BILLING', managementURL: PORTAL });
    openURL.mockImplementation(() => Promise.reject(new Error('blocked')));
    render(<ManageSubscriptionRow />);
    await act(async () => { fireEvent.press(screen.getByTestId('manage-subscription-link')); });
    expect(mockAlerts).toEqual([['Manage Subscription', 'The billing page did not open. To change or cancel your plan, email help@mageid.app.']]);
    await act(async () => { appStateHandlers.forEach((h) => h('active')); });
    expect(mockSub.refreshCustomerInfo).not.toHaveBeenCalled();
  });

  it('web subscriber with NO management URL: the email, said plainly', async () => {
    setOS('web');
    mockSub = sub({ planStore: 'RC_BILLING', managementURL: null });
    render(<ManageSubscriptionRow />);
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('To change or cancel your plan, email help@mageid.app.');
    expect(screen.queryByTestId('manage-subscription-renewal')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('manage-subscription-link')); });
    expect(openURL).toHaveBeenCalledWith('mailto:help@mageid.app?subject=Change%20my%20MAGE%20ID%20plan');
    expect(words()).not.toMatch(NEVER);
  });

  it('web, a URL that is not https is treated as none', () => {
    setOS('web');
    mockSub = sub({ planStore: 'RC_BILLING', managementURL: 'javascript:alert(1)' });
    render(<ManageSubscriptionRow />);
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('To change or cancel your plan, email help@mageid.app.');
  });

  it('web, a plan MAGE ID turned on: the email route, as before', async () => {
    setOS('web');
    mockSub = sub({ tier: 'business' });
    render(<ManageSubscriptionRow />);
    expect(screen.getByTestId('manage-subscription-label').props.children).toBe('Your Plan Was Turned On by MAGE ID');
    await act(async () => { fireEvent.press(screen.getByTestId('manage-subscription-link')); });
    expect(openURL).toHaveBeenCalledWith('mailto:help@mageid.app?subject=Change%20my%20MAGE%20ID%20plan');
  });

  it('bought on iPhone, seen on the web: says so and links to Apple', async () => {
    setOS('web');
    mockSub = sub({ planStore: 'APP_STORE', managementURL: 'https://apps.apple.com/account/subscriptions' });
    render(<ManageSubscriptionRow />);
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('You subscribed on iPhone. Manage it in your Apple account settings.');
    await act(async () => { fireEvent.press(screen.getByTestId('manage-subscription-link')); });
    expect(openURL).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
    expect(words()).not.toMatch(/help@mageid/);
  });

  it('bought on Android, seen on the web: says so and links to Google Play', async () => {
    setOS('web');
    mockSub = sub({ planStore: 'PLAY_STORE' });
    render(<ManageSubscriptionRow />);
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('You subscribed on Android. Manage it in your Google Play subscriptions.');
    await act(async () => { fireEvent.press(screen.getByTestId('manage-subscription-link')); });
    expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');
  });

  it('bought on the web, seen on an iPhone: a plain line, no link, no other platform named', () => {
    setOS('ios');
    mockSub = sub({ planStore: 'RC_BILLING', managementURL: PORTAL });
    render(<ManageSubscriptionRow />);
    expect(screen.queryByTestId('manage-subscription-link')).toBeNull();
    expect(screen.getByTestId('manage-subscription-line')).toBeTruthy();
    expect(screen.getByTestId('manage-subscription-label').props.children).toBe('Pro plan');
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('You subscribed in the web app. Manage it there, in Settings, Manage Subscription.');
    expect(words()).not.toMatch(/Android|Google Play|help@mageid|email/i);
  });

  it('iPhone, a paid plan with no purchase behind it: the plan’s name and nothing else', () => {
    setOS('ios');
    mockSub = sub({ tier: 'business' });
    render(<ManageSubscriptionRow />);
    expect(screen.queryByTestId('manage-subscription-link')).toBeNull();
    expect(screen.getByTestId('manage-subscription-label').props.children).toBe('Business plan');
    expect(screen.queryByTestId('manage-subscription-where')).toBeNull();
  });

  it.each(['ios', 'web', 'android'])('Free account (%s): no paid subscription, nothing to press', (os) => {
    setOS(os);
    mockSub = sub({ tier: 'free' });
    render(<ManageSubscriptionRow />);
    expect(screen.queryByTestId('manage-subscription-link')).toBeNull();
    expect(screen.getByTestId('manage-subscription-label').props.children).toBe('No Paid Subscription');
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('There is no paid subscription on this account.');
    expect(screen.queryByTestId('manage-subscription-renewal')).toBeNull();
  });

  it.each(['ios', 'web'])('master account (%s): no paid subscription, no dead link', (os) => {
    setOS(os);
    mockEmail = 'omirmajeed2000@gmail.com';
    mockSub = sub({ tier: 'business' });
    render(<ManageSubscriptionRow />);
    expect(screen.queryByTestId('manage-subscription-link')).toBeNull();
    expect(screen.getByTestId('manage-subscription-where').props.children).toBe('There is no paid subscription on this account.');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('the paywall variant draws nothing for a Free account', () => {
    setOS('web');
    mockSub = sub({ tier: 'free' });
    render(<ManageSubscriptionRow variant="paywall" testID="paywall-manage-subscription" />);
    expect(screen.toJSON()).toBeNull();
  });

  it('the paywall variant draws the row for a subscriber', () => {
    setOS('web');
    mockSub = sub({ planStore: 'RC_BILLING', managementURL: PORTAL });
    render(<ManageSubscriptionRow variant="paywall" testID="paywall-manage-subscription" />);
    expect(screen.getByTestId('paywall-manage-subscription-link')).toBeTruthy();
  });

  it('a date RevenueCat did not report is not printed', () => {
    setOS('web');
    mockSub = sub({ planStore: 'RC_BILLING', managementURL: PORTAL, planRenewal: { willRenew: true, expirationDate: null } });
    render(<ManageSubscriptionRow />);
    expect(screen.queryByTestId('manage-subscription-renewal')).toBeNull();
  });
});
