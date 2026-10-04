/**
 * Lane AICONSENT — what the contractor SEES about the account's AI answer, on
 * the phone (390 x 844 iOS), real app, real provider stack. No snapshots: each
 * case mounts a route and reads what is on screen.
 *
 * The server obeys the answer stored on the account (public.profiles.ai_consent)
 * for the weekly client recap and Ask Your Home. The smoke mock answers the
 * profiles read with { data: null } ("no profile row"), so by default the
 * screens say nothing about the account and no golden moves. Here the read
 * `select('ai_consent') … maybeSingle()` is scripted to give the account a
 * value; every other read still goes to the smoke mock.
 *
 *   T1  default harness: /client-portal-setup shows no note and the usual
 *       "AI strips the contractor jargon" subtitle.
 *   T2  the account was never told (NULL): the note, the plain subtitle, and
 *       the "Allow AI features" button. Nothing is sent (the harness seeds the
 *       phone's yes with no record of who gave it, and a yes with no record is
 *       never sent).
 *   T3  the account says yes: no note (a phone).
 *   T4  the account says yes and this phone has no answer: /settings shows
 *       "Your account allows AI on our server…" and "Turn off for my account".
 *   T5  "Allow AI features" ALWAYS asks first; "Allow AI features" on the
 *       question sends the yes to the account (set_my_ai_consent, age 0,
 *       question version 2) and the note goes away.
 *   T6  …and "Not now" on that question sends a no; the note stays.
 *   T7  "Turn off for my account" sends a no given now; the line goes away.
 *
 * KEEP TRYING UNTIL THE ACCOUNT HAS HEARD (the lane's central rule), in the
 * mounted app:
 *   T8  AI switched Off with NO SIGNAL (the request fails the way it does on a
 *       phone: "Network request failed"): Settings says the account has not
 *       been told and offers "Turn off for my account". With the app left open
 *       and nothing touched (no tap, no foreground, and no "back online"
 *       event: a phone has none) the app's own clock tries again after 30 s,
 *       then waits LONGER (60 s) before the next try, and the first try after
 *       the signal returns delivers the no.
 *   T9  AI switched Off and the server ANSWERS with a refusal: the record stays
 *       undelivered and the clock STOPS (five and a half minutes left open
 *       send nothing); coming back to the FOREGROUND sends it again.
 *   T11 A YES that could not be delivered does not look saved: the Client
 *       portal note stays, says the account has not been told and that the
 *       recap stays plain, and goes away only when the account has heard it.
 *   T12 The stored answer is WIPED with no sign-in run (what a same-user
 *       magic-link or password-reset sign-in does): Settings still says what
 *       the account says, with "Turn off for my account".
 * THE WEB WRITE PATH (the only way the web app changes the account), with the
 * web host injected:
 *   T10 "Not now" sends a no (never a yes) and only after the question; "Allow"
 *       sends a yes; a failed write is "failed" and changes nothing on screen;
 *       the phone's own answer is never touched.
 */

import React from 'react';
import { AppState, Dimensions, Platform, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { supabase } from '@/lib/supabase';
import { loadAiConsent } from '@/utils/aiConsent';
import { AI_ACCOUNT_COPY, AI_CONSENT_COPY, AI_CONSENT_META_KEY, AI_CONSENT_STORAGE_KEY } from '@/utils/aiConsentCore';
import { AI_CONSENT_RETRY_MS, askAiConsentForAccount, getAccountAiSnapshot, resetAccountAi, setAccountAiHost } from '@/utils/aiConsentAccount';

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
    componentDidCatch() { /* recorded as a placeholder */ }
    render() {
      return this.state.threw
        ? ReactActual.createElement(RNText, { testID: 'modal-body-threw' }, 'modal-body-threw')
        : this.props.children;
    }
  }
  function Modal(props: Record<string, unknown> & { children?: React.ReactNode }) {
    return ReactActual.createElement(RNView, { testID: 'g-modal' }, ReactActual.createElement(Boundary, null, props.children));
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
function phone() {
  mockWidth = 390;
  mockHeight = 844;
  mockWeb = false;
  Dimensions.set({
    window: { width: 390, height: 844, scale: 2, fontScale: 1 },
    screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
  });
}

const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T16:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;

// ── The account's stored answer (the one scripted read) ────────────────────
type AccountRow = { ai_consent: 'granted' | 'declined' | null };
/** undefined = the default harness (the smoke mock answers: no profile row). */
let accountRow: AccountRow | undefined;
const origFrom = supabase.from;
function installAccountRead(): void {
  (supabase as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    const real = (origFrom as unknown as (t: string) => Record<string, unknown>)(table);
    if (table !== 'profiles' || accountRow === undefined) return real;
    return new Proxy(real, {
      get(target, prop: string | symbol) {
        if (prop === 'select') {
          return (...args: unknown[]) => {
            if (args[0] !== 'ai_consent') return (target.select as (...a: unknown[]) => unknown)(...args);
            const answer = () => Promise.resolve({ data: accountRow ?? null, error: null, status: 200, statusText: 'OK', count: null });
            const chain: Record<string, unknown> = { eq: () => chain, maybeSingle: answer };
            return chain;
          };
        }
        const v = target[prop as string];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  };
}

// ── The one write: set_my_ai_consent ───────────────────────────────────────
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
/** What happened, in order: 'question' (the injected web question) and 'rpc'. */
const events: string[] = [];
/** While true the server ANSWERS set_my_ai_consent with a refusal (403, permission denied): the
 *  account does not hear the answer. Not a 502/503/504: the app treats those as "no answer". */
let rpcRefuses = false;
/** While true there is no signal: the request fails in transit, as fetch does on a phone. */
let noSignal = false;
/** Answers set_my_ai_consent like the server: the answer lands, and a later read says so. */
function stubSetConsent(): void {
  const realRpc = supabase.rpc.bind(supabase);
  jest.spyOn(supabase, 'rpc').mockImplementation(((fn: string, args?: Record<string, unknown>) => {
    if (fn !== 'set_my_ai_consent') return realRpc(fn as never, args as never);
    rpcCalls.push({ fn, args: args ?? {} });
    events.push('rpc');
    if (noSignal) return Promise.reject(new TypeError('Network request failed'));
    if (rpcRefuses) {
      return Promise.resolve({ data: null, error: { message: 'permission denied for function set_my_ai_consent', code: '42501' }, status: 403, statusText: 'Forbidden', count: null });
    }
    const answer = args?.p_answer === 'granted' ? 'granted' : 'declined';
    accountRow = { ai_consent: answer };
    return Promise.resolve({ data: { ok: true, applied: true, ai_consent: answer, ai_consent_at: new Date(NOW).toISOString() }, error: null, status: 200, statusText: 'OK', count: null });
  }) as never);
}

// ── The foreground: RN's AppState has no public emit, so every 'change' listener
// the app registers is teed and called by hand (the foreground-permission recipe).
type AppStateHandler = (state: AppStateStatus) => void;
let appStateHandlers: AppStateHandler[] = [];
let realAddEventListener: typeof AppState.addEventListener | null = null;
function installAppStateTee(): void {
  appStateHandlers = [];
  const real = AppState.addEventListener.bind(AppState);
  realAddEventListener = AppState.addEventListener;
  (AppState as unknown as { addEventListener: unknown }).addEventListener = (type: string, handler: AppStateHandler) => {
    if (type === 'change') appStateHandlers.push(handler);
    const sub = real(type as 'change', handler as never);
    return {
      remove: () => {
        appStateHandlers = appStateHandlers.filter((h) => h !== handler);
        sub.remove();
      },
    };
  };
}
async function comeToForeground(): Promise<void> {
  await act(async () => {
    for (const handler of [...appStateHandlers]) handler('active');
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  mockAlerts.length = 0;
  rpcCalls.length = 0;
  events.length = 0;
  rpcRefuses = false;
  noSignal = false;
  accountRow = undefined;
  installAccountRead();
  allowConsoleErrors();
});
afterEach(() => {
  if (realAddEventListener) {
    (AppState as unknown as { addEventListener: unknown }).addEventListener = realAddEventListener;
    realAddEventListener = null;
  }
  appStateHandlers = [];
  (supabase as unknown as { from: unknown }).from = origFrom;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  // No retry timer armed by one case fires in the next.
  resetAccountAi(null);
  jest.restoreAllMocks();
});

async function pump(n = 8) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 30; k++) await Promise.resolve();
    });
  }
}

/** The app is left open and untouched for `ms`: only its own timers run (the mount put jest's
 *  fake clock in place, so this is the app's real 30 s delay, not a shortened one). */
async function leaveTheAppOpen(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let k = 0; k < 30; k++) await Promise.resolve();
  });
  await pump(2);
}

async function openPortalScreen() {
  phone();
  await primeWorld('populated');
  await mountRouteChecked(`/client-portal-setup?id=${PROJECT_ID}`);
  await pump();
}

async function openSettingsWithNoPhoneAnswer() {
  phone();
  await primeWorld('empty');
  await AsyncStorage.removeItem(AI_CONSENT_STORAGE_KEY);
  await mountRouteChecked('/settings');
  await pump();
}

/** Settings with the harness's own phone answer (yes, with no record of who gave it). */
async function openSettings() {
  phone();
  await primeWorld('empty');
  await mountRouteChecked('/settings');
  await pump();
}
const storedMeta = async () => JSON.parse((await AsyncStorage.getItem(AI_CONSENT_META_KEY)) ?? 'null') as
  { uid: string | null; answer: string; at: number; delivered: boolean } | null;
const switchAiOff = () => fireEvent(screen.getByTestId('ai-features-switch'), 'valueChange', false);

const JARGON = /AI strips the contractor jargon/;
/** An answer given on the question: sent with its AGE (how long ago it was given, measured on
 *  this phone; the mounted app runs on the harness's own clock, so "a moment" and not exactly 0)
 *  and the question version. */
function expectAnswerSent(args: Record<string, unknown>, answer: 'granted' | 'declined', age: { atLeast: number; under: number } = { atLeast: 0, under: 60_000 }) {
  expect(Object.keys(args).sort()).toEqual(['p_age_ms', 'p_answer', 'p_version']);
  expect(args.p_answer).toBe(answer);
  expect(args.p_version).toBe(2);
  expect(typeof args.p_age_ms).toBe('number');
  expect(args.p_age_ms as number).toBeGreaterThanOrEqual(age.atLeast);
  expect(args.p_age_ms as number).toBeLessThan(age.under);
}
const question = () => mockAlerts.find((a) => a.title === AI_CONSENT_COPY.title);
const press = (alert: { buttons?: AlertButton[] } | undefined, text: string) => alert?.buttons?.find((b) => b.text === text)?.onPress?.();

describe('AICONSENT: the account’s AI answer on the phone (iOS 390)', () => {
  it('runs as a phone', () => {
    expect(Platform.OS).toBe('ios');
  });

  it('T1 default harness: no note, and the usual recap subtitle', async () => {
    await openPortalScreen();
    expect(screen.queryByTestId('ai-account-note')).toBeNull();
    expect(screen.queryByText(JARGON)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.recapSubtitlePlain)).toBeNull();
    expect(rpcCalls).toHaveLength(0);
  });

  it('T2 the account was never told: the note, the plain subtitle, "Allow AI features"; nothing is sent', async () => {
    accountRow = { ai_consent: null };
    stubSetConsent();
    await openPortalScreen();
    expect(screen.queryByTestId('ai-account-note')).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.recapNote)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.recapSubtitlePlain)).not.toBeNull();
    expect(screen.queryByText(JARGON)).toBeNull();
    expect(screen.queryByTestId('ai-account-allow')).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.allow)).not.toBeNull();
    // The harness seeds the phone's yes with no record: a yes like that is never sent.
    expect(rpcCalls).toHaveLength(0);
    expect(await AsyncStorage.getItem(AI_CONSENT_META_KEY)).toBeNull();
  });

  it('T3 the account says yes: no note on a phone', async () => {
    accountRow = { ai_consent: 'granted' };
    await openPortalScreen();
    expect(screen.queryByTestId('ai-account-note')).toBeNull();
    expect(screen.queryByText(JARGON)).not.toBeNull();
  });

  it('T4 the account says yes, this phone has no answer: Settings says so and offers "Turn off for my account"', async () => {
    accountRow = { ai_consent: 'granted' };
    await openSettingsWithNoPhoneAnswer();
    expect(screen.queryByTestId('ai-account-settings-line')).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsAllowed)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.turnOffForAccount)).not.toBeNull();
  });

  it('T5 "Allow AI features" asks first; a yes on the question reaches the account and the note goes away', async () => {
    accountRow = { ai_consent: null };
    stubSetConsent();
    await openPortalScreen();
    fireEvent.press(screen.getByTestId('ai-account-allow'));
    await pump();
    // The question is shown; nothing has been sent and nothing was granted silently.
    expect(question()).toBeDefined();
    expect(question()?.message).toContain('weekly client recap');
    expect(rpcCalls).toHaveLength(0);
    press(question(), AI_CONSENT_COPY.allow);
    await pump();
    expect(rpcCalls).toHaveLength(1);
    expectAnswerSent(rpcCalls[0].args, 'granted');
    expect(await AsyncStorage.getItem(AI_CONSENT_STORAGE_KEY)).toBe('granted');
    // The record: who answered, when, and that the account has heard it.
    const meta = JSON.parse((await AsyncStorage.getItem(AI_CONSENT_META_KEY)) ?? 'null');
    expect(meta).toMatchObject({ answer: 'granted', delivered: true });
    expect(typeof meta.uid).toBe('string');
    expect(Number.isFinite(meta.at)).toBe(true);
    expect(screen.queryByTestId('ai-account-note')).toBeNull();
    expect(mockAlerts.some((a) => a.title === AI_ACCOUNT_COPY.saveFailedTitle)).toBe(false);
  });

  it('T6 "Not now" on that question sends a no; the note stays', async () => {
    accountRow = { ai_consent: null };
    stubSetConsent();
    await openPortalScreen();
    fireEvent.press(screen.getByTestId('ai-account-allow'));
    await pump();
    press(question(), AI_CONSENT_COPY.notNow);
    await pump();
    expect(rpcCalls).toHaveLength(1);
    expectAnswerSent(rpcCalls[0].args, 'declined');
    expect(await AsyncStorage.getItem(AI_CONSENT_STORAGE_KEY)).toBe('declined');
    expect(screen.queryByTestId('ai-account-note')).not.toBeNull();
    expect(mockAlerts.some((a) => a.title === AI_ACCOUNT_COPY.saveFailedTitle)).toBe(false);
  });

  it('T7 "Turn off for my account" sends a no given now; the phone’s own answer is not touched', async () => {
    accountRow = { ai_consent: 'granted' };
    stubSetConsent();
    await openSettingsWithNoPhoneAnswer();
    fireEvent.press(screen.getByTestId('ai-account-settings-action'));
    await pump();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toEqual({ p_answer: 'declined', p_age_ms: 0, p_version: 2 });
    expect(await AsyncStorage.getItem(AI_CONSENT_STORAGE_KEY)).toBeNull();
    // Unanswered phone + an account that says no: nothing more to say.
    expect(screen.queryByTestId('ai-account-settings-line')).toBeNull();
    expect(mockAlerts.some((a) => a.title === AI_ACCOUNT_COPY.saveFailedTitle)).toBe(false);
  });

  it('T8 AI switched Off with no signal: Settings says the account was not told; left open, the app tries again on its own clock (30 s, then 60 s) and delivers it', async () => {
    accountRow = { ai_consent: 'granted' };
    stubSetConsent();
    await openSettings();
    // The phone says yes and so does the account.
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsAlso)).not.toBeNull();
    expect(AI_CONSENT_RETRY_MS).toBe(30_000);

    noSignal = true;
    switchAiOff();
    await pump();
    // One request was tried and failed in transit. The no is on the phone, with its record, undelivered.
    expect(rpcCalls).toHaveLength(1);
    expectAnswerSent(rpcCalls[0].args, 'declined');
    expect(await AsyncStorage.getItem(AI_CONSENT_STORAGE_KEY)).toBe('declined');
    expect(await storedMeta()).toMatchObject({ answer: 'declined', delivered: false });
    // The account still says yes, and the screen says exactly that, with a way to turn it off.
    expect(accountRow).toEqual({ ai_consent: 'granted' });
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsNotToldYet)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.turnOffForAccount)).not.toBeNull();
    // The sentence promises only what the app does.
    expect(AI_ACCOUNT_COPY.settingsNotToldYet).toContain('tries again each time you open the app. While the app stays open it also tries again when it got no answer, waiting longer each time.');
    expect(AI_ACCOUNT_COPY.settingsNotToldYet).not.toMatch(/online/i);

    // Well inside the 30 s nothing is re-sent: it is a clock, not a loop.
    await leaveTheAppOpen(20_000);
    expect(rpcCalls).toHaveLength(1);

    // Past 30 s, still no signal: the app tried again by itself (no tap, no foreground), and it is still undelivered.
    await leaveTheAppOpen(10_000);
    expect(rpcCalls).toHaveLength(2);
    // Built fresh: it carries how long ago the answer was given, now about 30 s.
    expectAnswerSent(rpcCalls[1].args, 'declined', { atLeast: 30_000, under: 45_000 });
    expect(await storedMeta()).toMatchObject({ answer: 'declined', delivered: false });
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsNotToldYet)).not.toBeNull();

    // The signal returns. Nothing is touched. The second wait is LONGER (60 s, not 30 s): the
    // phone does not hammer the server, so half a minute later nothing more has been sent…
    noSignal = false;
    await leaveTheAppOpen(31_000);
    expect(rpcCalls).toHaveLength(2);
    // …and the next tick of the clock, 60 s after the second try, delivers the no.
    await leaveTheAppOpen(30_000);
    expect(rpcCalls).toHaveLength(3);
    // The one that lands says the answer is about a minute and a half old, so the server orders it correctly.
    expectAnswerSent(rpcCalls[2].args, 'declined', { atLeast: 90_000, under: 110_000 });
    expect(await storedMeta()).toMatchObject({ answer: 'declined', delivered: true });
    expect(accountRow).toEqual({ ai_consent: 'declined' });
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsNotToldYet)).toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsNotAllowed)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.turnOffForAccount)).toBeNull();

    // Heard: the clock has stopped. Six more minutes (past the longest wait) send nothing.
    await leaveTheAppOpen(360_000);
    expect(rpcCalls).toHaveLength(3);
  });

  it('T9 AI switched Off and the server refuses the write: it stays undelivered and the clock stops; the foreground sends it again', async () => {
    accountRow = { ai_consent: 'granted' };
    stubSetConsent();
    installAppStateTee();
    await openSettings();
    expect(appStateHandlers.length).toBeGreaterThan(0);

    rpcRefuses = true;
    switchAiOff();
    await pump();
    // One request went out and was refused: the account did NOT hear it.
    expect(rpcCalls).toHaveLength(1);
    expectAnswerSent(rpcCalls[0].args, 'declined');
    expect(await storedMeta()).toMatchObject({ answer: 'declined', delivered: false });
    expect(accountRow).toEqual({ ai_consent: 'granted' });
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsNotToldYet)).not.toBeNull();

    // The server ANSWERED: asking again in 30 s would get the same answer, so no timer is armed.
    // Left open past every wait (30 s, 60 s, 120 s, 5 minutes), nothing more is sent.
    await leaveTheAppOpen(330_000);
    expect(rpcCalls).toHaveLength(1);
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsNotToldYet)).not.toBeNull();

    // Still refusing: a foreground tries again and it is still undelivered.
    await comeToForeground();
    await pump();
    expect(rpcCalls).toHaveLength(2);
    expect(await storedMeta()).toMatchObject({ answer: 'declined', delivered: false });
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsNotToldYet)).not.toBeNull();

    // The server is back: the next foreground delivers it.
    rpcRefuses = false;
    await comeToForeground();
    await pump();
    expect(rpcCalls).toHaveLength(3);
    // Built fresh: it says the answer is five and a half minutes old.
    expectAnswerSent(rpcCalls[2].args, 'declined', { atLeast: 330_000, under: 400_000 });
    expect(await storedMeta()).toMatchObject({ answer: 'declined', delivered: true });
    expect(accountRow).toEqual({ ai_consent: 'declined' });
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsNotAllowed)).not.toBeNull();

    // Heard: a later foreground sends nothing.
    await comeToForeground();
    await pump();
    expect(rpcCalls).toHaveLength(3);
  });

  it('T11 a YES that could not be delivered does not look saved: the Client portal note stays and says the account has not been told', async () => {
    accountRow = { ai_consent: null };
    stubSetConsent();
    await openPortalScreen();
    expect(screen.queryByText(AI_ACCOUNT_COPY.recapNote)).not.toBeNull();
    fireEvent.press(screen.getByTestId('ai-account-allow'));
    await pump();
    expect(question()).toBeDefined();

    // He says yes, and the request fails in transit.
    noSignal = true;
    press(question(), AI_CONSENT_COPY.allow);
    await pump();
    expect(rpcCalls).toHaveLength(1);
    expectAnswerSent(rpcCalls[0].args, 'granted');
    expect(await AsyncStorage.getItem(AI_CONSENT_STORAGE_KEY)).toBe('granted');
    expect(await storedMeta()).toMatchObject({ answer: 'granted', delivered: false });
    // The account was NOT told, and what is on screen about the account is still the account's own answer.
    expect(accountRow).toEqual({ ai_consent: null });
    expect(getAccountAiSnapshot().account).toBeNull();
    // The note is still there and says so plainly; the recap subtitle stays the plain one.
    expect(screen.queryByTestId('ai-account-note')).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.yesNotTold)).not.toBeNull();
    expect(AI_ACCOUNT_COPY.yesNotTold).toContain('your account has not been told yet');
    expect(AI_ACCOUNT_COPY.yesNotTold).toContain('goes out as a plain summary with no AI');
    expect(screen.queryByText(AI_ACCOUNT_COPY.recapNote)).toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.recapSubtitlePlain)).not.toBeNull();
    expect(screen.queryByText(JARGON)).toBeNull();
    // He already said yes: no second "Allow AI features" button. The phone sends it again by itself.
    expect(screen.queryByTestId('ai-account-allow')).toBeNull();

    // The signal returns; nothing is touched. The 30 s clock delivers the yes.
    noSignal = false;
    await leaveTheAppOpen(31_000);
    expect(rpcCalls).toHaveLength(2);
    expectAnswerSent(rpcCalls[1].args, 'granted', { atLeast: 30_000, under: 45_000 });
    expect(await storedMeta()).toMatchObject({ answer: 'granted', delivered: true });
    expect(accountRow).toEqual({ ai_consent: 'granted' });
    // Only now, from the account's own reply, does the screen read as AI on.
    expect(getAccountAiSnapshot().account).toBe('granted');
    expect(screen.queryByTestId('ai-account-note')).toBeNull();
    expect(screen.queryByText(JARGON)).not.toBeNull();
  });

  it('T12 the stored answer is wiped with no sign-in run: Settings still says what the account says', async () => {
    accountRow = { ai_consent: 'granted' };
    stubSetConsent();
    installAppStateTee();
    await openSettings();
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsAlso)).not.toBeNull();
    const uid = getAccountAiSnapshot().userId;

    // What a same-user magic-link or password-reset sign-in does: the answer and its record are
    // swept off the phone; the signed-in person is the same, so there is no sign-in run.
    await act(async () => {
      await AsyncStorage.multiRemove([AI_CONSENT_STORAGE_KEY, AI_CONSENT_META_KEY]);
    });
    // The app comes back to the foreground (the link was opened from Mail): the gate re-reads
    // its stored answer, finds it gone, and the account is looked at again.
    await comeToForeground();
    await pump();
    expect(getAccountAiSnapshot().userId).toBe(uid);
    expect(getAccountAiSnapshot().seen).toBe('unknown');
    // The account still allows AI on the server: Settings says so and offers the one-tap off.
    expect(screen.queryByTestId('ai-account-settings-line')).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsAllowed)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.turnOffForAccount)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsAlso)).toBeNull();
    // Nothing was sent by that run: the phone holds no answer.
    expect(rpcCalls).toHaveLength(0);

    // The same wipe noticed WITHOUT a foreground: he answers the question again (yes), the answer
    // is swept once more, and the gate's next read (an AI tap, a screen mounting) finds it gone.
    fireEvent(screen.getByTestId('ai-features-switch'), 'valueChange', true);
    await pump();
    press(question(), AI_CONSENT_COPY.allow);
    await pump();
    expect(rpcCalls).toHaveLength(1);
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsAlso)).not.toBeNull();
    await act(async () => {
      await AsyncStorage.multiRemove([AI_CONSENT_STORAGE_KEY, AI_CONSENT_META_KEY]);
      await loadAiConsent();
    });
    await pump();
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsAllowed)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.turnOffForAccount)).not.toBeNull();
    expect(screen.queryByText(AI_ACCOUNT_COPY.settingsAlso)).toBeNull();
    expect(rpcCalls).toHaveLength(1);
  });

  it('T10 the web write path: "Not now" sends a no after the question, "Allow" a yes, a failed write changes nothing', async () => {
    accountRow = { ai_consent: null };
    stubSetConsent();
    await openPortalScreen();
    const uid = getAccountAiSnapshot().userId;
    expect(typeof uid).toBe('string');
    const phoneAnswer = await AsyncStorage.getItem(AI_CONSENT_STORAGE_KEY);
    const phoneRecord = await AsyncStorage.getItem(AI_CONSENT_META_KEY);

    // The web host, injected (the route itself runs as a phone here).
    let webAnswer = false;
    let asked = 0;
    setAccountAiHost({ isWeb: true, askAccount: async () => { asked += 1; events.push('question'); return webAnswer; } });
    const ask = async () => {
      let result: 'allowed' | 'not_allowed' | 'failed' | undefined;
      await act(async () => { result = await askAiConsentForAccount(uid); });
      await pump(2);
      return result;
    };

    // "Not now" (or a dismissed question): a NO goes to the account, never a yes.
    expect(await ask()).toBe('not_allowed');
    expect(asked).toBe(1);
    expect(events).toEqual(['question', 'rpc']);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toEqual({ p_answer: 'declined', p_age_ms: 0, p_version: 2 });
    expect(getAccountAiSnapshot().account).toBe('declined');

    // "Allow": the question first, then the yes.
    webAnswer = true;
    events.length = 0;
    expect(await ask()).toBe('allowed');
    expect(asked).toBe(2);
    expect(events).toEqual(['question', 'rpc']);
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[1].args).toEqual({ p_answer: 'granted', p_age_ms: 0, p_version: 2 });
    expect(getAccountAiSnapshot().account).toBe('granted');

    // The write is refused: 'failed', and what the screen shows about the account is unchanged.
    rpcRefuses = true;
    webAnswer = false;
    expect(await ask()).toBe('failed');
    expect(rpcCalls).toHaveLength(3);
    expect(rpcCalls[2].args).toEqual({ p_answer: 'declined', p_age_ms: 0, p_version: 2 });
    expect(getAccountAiSnapshot().account).toBe('granted');
    expect(accountRow).toEqual({ ai_consent: 'granted' });

    // The web path never touches the phone's own answer or its record.
    expect(await AsyncStorage.getItem(AI_CONSENT_STORAGE_KEY)).toBe(phoneAnswer);
    expect(await AsyncStorage.getItem(AI_CONSENT_META_KEY)).toBe(phoneRecord);
  });
});
