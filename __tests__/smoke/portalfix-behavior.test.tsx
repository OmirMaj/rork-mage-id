/**
 * Lane PORTALFIX — BEHAVIOR on the phone (390 x 844 iOS), real app, populated
 * fixture world. No snapshots: each case drives the screen and reads what it
 * did. The golden in portalfix-phone.test.tsx proves nothing else moved.
 *
 *   (a) Reset link confirms first, in the spec's words, and only then calls
 *       portal_rotate_access_token for this project; the fresh key replaces the
 *       old one on screen and the new link is offered for sending.
 *   (b) Offline, Reset link refuses before the confirm and calls nothing.
 *   (c) RESET LINK NEVER GUESSES. When the rotate call does not come back clean
 *       the screen reads the server's key and says only what that proves:
 *       (c1) the server still holds the same key -> "Link Not Reset", the old
 *            link still works, nothing on screen changes;
 *       (c2) the answer was lost but the server holds a NEW key -> the reset
 *            happened: the new link is on screen and "Send New Link" is offered;
 *       (c3) the answer was lost and the read-back fails too -> "Reset not
 *            confirmed": no claim that the old link works, the held key leaves
 *            the screen, Copy and Reset lock, and Retry shows the server's link.
 *   (d) A Sample project: the screen says why at the top, and Save, Copy,
 *       Share, Reset and invites all stop at the same reason.
 *   (e) The passcode field states and enforces the real rule (4 to 20).
 *   (f) Save stores the passcode trimmed AND the screen holds the same trimmed
 *       code, so nothing is left "unsaved".
 */

import React from 'react';
import { Dimensions, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, PORTAL_TOKEN } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';

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

type AlertButton = { text?: string; style?: string; onPress?: () => void };
const mockAlerts: { title: string; message?: string; buttons?: AlertButton[] }[] = [];
jest.mock('@/utils/alert', () => {
  const actual = jest.requireActual('@/utils/alert');
  return {
    ...actual,
    showAlert: (title: string, message?: string, buttons?: AlertButton[]) => {
      mockAlerts.push({ title, message, buttons });
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
  mockAlerts.length = 0;
  allowConsoleErrors();
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

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

type RpcAnswer = { data: unknown; error: unknown } | 'throws';
const rpcCalls: { fn: string; args: unknown }[] = [];
/** Calls of the owner-only key getter (the read-back), in order. */
const getterCalls: unknown[] = [];
/**
 * The two server calls the reset touches. `rotate` answers
 * portal_rotate_access_token; `getter` answers portal_get_owner_token (the
 * read-back) — a function, so a case can change the server's answer between
 * reads. 'throws' is a dropped connection: the promise rejects.
 */
function stubServer(rotate: RpcAnswer, getter?: () => RpcAnswer) {
  rpcCalls.length = 0;
  getterCalls.length = 0;
  const realRpc = supabase.rpc.bind(supabase);
  const answer = (a: RpcAnswer) => (a === 'throws' ? Promise.reject(new TypeError('Network request failed')) : Promise.resolve(a));
  jest.spyOn(supabase, 'rpc').mockImplementation(((fn: string, args?: unknown) => {
    if (fn === 'portal_rotate_access_token') { rpcCalls.push({ fn, args }); return answer(rotate); }
    if (fn === 'portal_get_owner_token' && getter) { getterCalls.push(args); return answer(getter()); }
    return realRpc(fn as never, args as never);
  }) as never);
}
const stubRotate = (rotate: { data: unknown; error: unknown }) => stubServer(rotate);
const NEW_KEY = 'fresh0key0abcdef0123456789fresh0key0abcdef01';
/** The link card masks the key's middle: `?t=` + first 4 + … + last 4. */
const keyHead = (k: string) => `?t=${k.slice(0, 4)}`;
const linkShown = () => String(screen.getByTestId('portal-link-display').props.children);
const hintShown = () => String(screen.getByTestId('portal-link-hint').props.children);
const allAlertText = () => mockAlerts.map(a => `${a.title} ${a.message ?? ''}`).join(' | ');
const lastAlert = () => mockAlerts[mockAlerts.length - 1];
const press = async (testID: string) => { await act(async () => { fireEvent.press(screen.getByTestId(testID)); }); };
let heldButtons: AlertButton[] | undefined;
const tapButton = async (label: string) => {
  const b = (lastAlert()?.buttons ?? heldButtons)?.find(x => x.text === label);
  expect(b).toBeTruthy();
  await act(async () => { b!.onPress?.(); for (let k = 0; k < 20; k++) await Promise.resolve(); });
};

describe('PORTALFIX behavior — the phone', () => {
  jest.setTimeout(120000);

  it('(a) Reset link: confirm first, then the rotate RPC; the new key replaces the old; Send new link is offered', async () => {
    stubRotate({ data: 'fresh0key0abcdef0123456789fresh0key0abcdef01', error: null });
    await phoneSetup();
    const before = String(screen.getByTestId('portal-link-display').props.children);
    await press('portal-reset-link-btn');
    expect(lastAlert().title).toBe('Reset the link?');
    expect(lastAlert().message).toBe('Your client\u2019s old link stops working. Send them the new one.');
    expect(rpcCalls.length).toBe(0);
    await tapButton('Reset Link');
    await pump(2);
    expect(rpcCalls).toEqual([{ fn: 'portal_rotate_access_token', args: { p_project_id: PROJECT_ID } }]);
    expect(lastAlert().title).toBe('Link Reset');
    expect(lastAlert().buttons?.map(b => b.text)).toEqual(['Later', 'Send New Link']);
    const after = String(screen.getByTestId('portal-link-display').props.children);
    expect(after).not.toBe(before);
    expect(after.startsWith('https://mageid.app/portal/')).toBe(true);
    expect(after).not.toContain(keyHead(PORTAL_TOKEN));
    // Send new link runs the existing Share flow with the NEW link: the link is
    // there (no "Finalizing Secure Link" guard), nothing else is asked.
    heldButtons = lastAlert().buttons;
    mockAlerts.length = 0;
    await tapButton('Send New Link');
    expect(mockAlerts.map(a => a.title)).toEqual([]);
    expect(rpcCalls.length).toBe(1);
  });

  it('(b) offline: Reset link refuses before the confirm and calls nothing', async () => {
    stubRotate({ data: 'never', error: null });
    await phoneSetup();
    await act(async () => { onlineManager.setOnline(false); });
    await press('portal-reset-link-btn');
    expect(lastAlert().title).toBe('You\u2019re offline.');
    expect(lastAlert().message).toMatch(/needs a connection/);
    expect(lastAlert().message).toMatch(/never saved to send later/);
    expect(mockAlerts.some(a => a.title === 'Reset the link?')).toBe(false);
    expect(rpcCalls.length).toBe(0);
  });

  it('(c1) the call fails and the server still holds the same key: "Link not reset", the old link still works, nothing changes', async () => {
    stubServer({ data: null, error: { message: 'portal_rotate_denied', code: '42501' } }, () => ({ data: PORTAL_TOKEN, error: null }));
    await phoneSetup();
    const before = linkShown();
    await press('portal-reset-link-btn');
    await tapButton('Reset Link');
    await pump(2);
    expect(rpcCalls.length).toBe(1);
    // Said only after the server was read.
    expect(getterCalls).toEqual([{ p_project_id: PROJECT_ID }]);
    expect(lastAlert().title).toBe('Link Not Reset');
    expect(lastAlert().message).toMatch(/We checked with the server/);
    expect(lastAlert().message).toMatch(/old link still works/);
    expect(linkShown()).toBe(before);
  });

  it('(c2) the answer is lost but the server holds a NEW key: the reset happened, the new link is shown and offered', async () => {
    stubServer('throws', () => ({ data: NEW_KEY, error: null }));
    await phoneSetup();
    const before = linkShown();
    await press('portal-reset-link-btn');
    await tapButton('Reset Link');
    await pump(2);
    expect(rpcCalls.length).toBe(1);
    expect(getterCalls.length).toBe(1);
    expect(allAlertText()).not.toMatch(/still works/);
    expect(lastAlert().title).toBe('Link Reset');
    expect(lastAlert().buttons?.map(b => b.text)).toEqual(['Later', 'Send New Link']);
    const after = linkShown();
    expect(after).not.toBe(before);
    expect(after).not.toContain(keyHead(PORTAL_TOKEN));
    expect(after).toContain(keyHead(NEW_KEY));
    // Send new link opens the existing Share flow on the new link, no guard in the way.
    heldButtons = lastAlert().buttons;
    mockAlerts.length = 0;
    await tapButton('Send New Link');
    expect(mockAlerts.map(a => a.title)).toEqual([]);
  });

  it('(c2b) an empty answer with a NEW key on the server is the same: the reset happened', async () => {
    stubServer({ data: null, error: null }, () => ({ data: NEW_KEY, error: null }));
    await phoneSetup();
    await press('portal-reset-link-btn');
    await tapButton('Reset Link');
    await pump(2);
    expect(lastAlert().title).toBe('Link Reset');
    expect(allAlertText()).not.toMatch(/still works/);
    expect(linkShown()).toContain(keyHead(NEW_KEY));
  });

  it('(c3) the answer is lost and the read-back fails too: says only what is known, drops the held key, locks Copy and Reset; Retry shows the server\u2019s link', async () => {
    let server: RpcAnswer = 'throws';
    stubServer('throws', () => server);
    await phoneSetup();
    const before = linkShown();
    expect(before).toContain(keyHead(PORTAL_TOKEN));
    await press('portal-reset-link-btn');
    await tapButton('Reset Link');
    await pump(3);
    expect(rpcCalls.length).toBe(1);
    const said = mockAlerts.find(a => a.title === 'Reset Not Confirmed');
    expect(said).toBeTruthy();
    // Never the claim the review caught: nothing here says the old link works.
    expect(allAlertText()).not.toMatch(/still works/);
    expect(allAlertText()).not.toMatch(/Link Not Reset/);
    expect(said!.message).toMatch(/couldn\u2019t confirm whether the link was reset/);
    expect(said!.message).toMatch(/may have stopped working/);
    expect(said!.message).toMatch(/Open this screen again/);
    expect(said!.buttons).toBeUndefined();
    // The possibly-dead key is off the screen, and the link says why it is locked.
    expect(linkShown()).not.toContain(keyHead(PORTAL_TOKEN));
    expect(linkShown()).not.toContain('?t=');
    expect(hintShown()).toMatch(/Copy and Share (stay locked|become available)/);
    // Copy hands out nothing; a second reset is not offered on top of the unknown.
    mockAlerts.length = 0;
    await act(async () => { fireEvent.press(screen.getByText('Copy')); });
    expect(mockAlerts.map(a => a.title)).toEqual([expect.stringMatching(/Secure Link/)]);
    mockAlerts.length = 0;
    await press('portal-reset-link-btn');
    expect(mockAlerts.some(a => a.title === 'Reset the link?')).toBe(false);
    expect(rpcCalls.length).toBe(1);
    // Back online: Retry reads the server and shows the link it holds NOW.
    server = { data: NEW_KEY, error: null };
    await press('portal-link-retry-btn');
    await pump(3);
    expect(linkShown()).toContain(keyHead(NEW_KEY));
    expect(linkShown()).not.toContain(keyHead(PORTAL_TOKEN));
    expect(rpcCalls.length).toBe(1);
  });

  it('(d) a Sample project: banner at the top; Save, Copy, Share and Reset stop at the sample reason', async () => {
    stubRotate({ data: 'never', error: null });
    await phoneSetup((p) => ({ ...p, name: 'Sample \u2014 Harlow Residence' }));
    expect(screen.getByTestId('portal-setup-sample')).toBeTruthy();
    for (const action of [
      () => fireEvent.press(screen.getByTestId('portal-setup-save')),
      () => fireEvent.press(screen.getByText('Copy')),
      () => fireEvent.press(screen.getByText('Share')),
      () => fireEvent.press(screen.getByTestId('portal-reset-link-btn')),
      () => fireEvent.press(screen.getByTestId('portal-generate-link-btn')),
    ]) {
      mockAlerts.length = 0;
      await act(async () => { action(); });
      expect(mockAlerts.map(a => a.title)).toEqual(['Sample Job']);
    }
    expect(rpcCalls.length).toBe(0);
  });

  it('(e) the passcode field states and enforces 4 to 20 characters', async () => {
    await phoneSetup(withPortal({ requirePasscode: true, passcode: 'Harlow4821' }));
    const field = screen.getByPlaceholderText('Passcode (4 to 20 characters)');
    expect(field.props.maxLength).toBe(20);
    expect(field.props.autoCapitalize).toBe('none');
  });

  it('(f) Save stores the passcode trimmed and the screen holds the same code: no "Unsaved changes" afterwards', async () => {
    await phoneSetup(withPortal({ requirePasscode: true, passcode: 'Harlow4821' }));
    const field = screen.getByPlaceholderText('Passcode (4 to 20 characters)');
    // iOS adds a trailing space after a keyboard suggestion.
    await act(async () => { fireEvent.changeText(field, 'Harlow9000 '); });
    expect(screen.queryByTestId('portal-setup-unsaved')).toBeTruthy();
    await press('portal-setup-save');
    await pump(2);
    expect(mockAlerts.some(a => a.title === 'Portal Saved')).toBe(true);
    expect(screen.getByPlaceholderText('Passcode (4 to 20 characters)').props.value).toBe('Harlow9000');
    expect(screen.queryByTestId('portal-setup-unsaved')).toBeNull();
  });
});
