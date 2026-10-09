/**
 * Smoke — the re-acceptance sheet (components/LegalGateHost.tsx, lane
 * PROTECT-SERVER). The flag is false in the app; it is turned on HERE ONLY,
 * through the mock of constants/featureFlags, and LG7 mounts with the real
 * (false) value.
 *
 *   LG1 Flag on, the account's rows were read and one is missing: the sheet is
 *       up with its title, the what-changed line, both links, I Agree and
 *       Sign Out.
 *   LG2 I Agree records the acceptance and the sheet goes away.
 *   LG3 Sign Out signs the person out and records nothing.
 *   LG4 The rows could not be read (offline, or the table is not there yet):
 *       nothing is shown. Nobody is locked out by a failed read.
 *   LG5 The account already accepted: nothing is shown.
 *   LG6 Signed out: nothing is shown and no row is read.
 *   LG7 Flag off (the app's real value): nothing is shown, no row is read, and
 *       what the account owes is still sent.
 *   LG8 A recorder that fails does not keep the sheet up: the tap is the
 *       agreement, and the record is owed.
 *
 * The pure rules have their own direct tests with planted mutations in
 * scripts/validate-legal-acceptance.ts.
 */

import React from 'react';
import { act, cleanupAsync, fireEvent, render } from '@testing-library/react-native';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

let mockFlag = true;
jest.mock('@/constants/featureFlags', () => {
  // defineProperty, not `{ ...actual, get X() {} }`: the object-spread helper
  // would read the getter once, at factory time, and freeze its value.
  const mod = { ...jest.requireActual('@/constants/featureFlags') };
  Object.defineProperty(mod, 'TERMS_REACCEPT_ENABLED', { enumerable: true, get: () => mockFlag });
  return mod;
});

let mockUser: { id: string } | null = { id: '00000000-0000-4000-8000-0000000000a1' };
const mockLogout = jest.fn(async () => {});
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, logout: mockLogout }) }));

let mockState: 'accepted' | 'needed' | 'unknown' = 'needed';
const mockRead = jest.fn(async () => mockState);
const mockReaccept = jest.fn(async () => {});
const mockFlush = jest.fn(async () => {});
const mockBuild = jest.fn();
jest.mock('@/utils/legalAcceptance', () => ({
  TERMS_URL: 'https://mageid.app/terms',
  PRIVACY_URL: 'https://mageid.app/privacy',
  readReacceptState: (...a: unknown[]) => mockRead(...(a as [])),
  recordReacceptance: (...a: unknown[]) => mockReaccept(...(a as [])),
  flushLegalAcceptances: (...a: unknown[]) => mockFlush(...(a as [])),
  setLegalBuildInfo: (...a: unknown[]) => mockBuild(...a),
}));

// Every Modal renders its content.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const { View } = jest.requireActual('react-native');
  const Modal = ({ children, visible, testID }: { children?: React.ReactNode; visible?: boolean; testID?: string }) => (visible === false ? null : <View testID={testID}>{children}</View>);
  return { __esModule: true, default: Modal };
});

import LegalGateHost from '@/components/LegalGateHost';

async function mount() {
  const utils = render(<LegalGateHost />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return utils;
}

describe('the re-acceptance sheet', () => {
  beforeEach(() => {
    mockFlag = true;
    mockUser = { id: '00000000-0000-4000-8000-0000000000a1' };
    mockState = 'needed';
    mockRead.mockClear(); mockReaccept.mockClear(); mockFlush.mockClear(); mockLogout.mockClear(); mockBuild.mockClear();
    mockReaccept.mockImplementation(async () => {});
  });
  afterEach(async () => { await cleanupAsync(); });

  it('LG1 shows the sheet when a row for the current version is known to be missing', async () => {
    const { getByTestId, getByText } = await mount();
    expect(getByTestId('legal-reaccept')).toBeTruthy();
    expect(getByText('Please read and agree to continue')).toBeTruthy();
    expect(getByText('What Changed')).toBeTruthy();
    expect(getByText(/first time MAGE ID asks you to agree inside the app/)).toBeTruthy();
    expect(getByTestId('legal-reaccept-terms')).toBeTruthy();
    expect(getByTestId('legal-reaccept-privacy')).toBeTruthy();
    expect(getByText('I Agree')).toBeTruthy();
    expect(getByText('Sign Out')).toBeTruthy();
    expect(mockRead).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000a1');
  });

  it('LG2 I Agree records the acceptance and closes the sheet', async () => {
    const { getByTestId, queryByTestId } = await mount();
    await act(async () => { fireEvent.press(getByTestId('legal-reaccept-agree')); await Promise.resolve(); await Promise.resolve(); });
    expect(mockReaccept).toHaveBeenCalledTimes(1);
    expect(mockReaccept).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000a1');
    expect(queryByTestId('legal-reaccept')).toBeNull();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('LG3 Sign Out signs out and records nothing', async () => {
    const { getByTestId } = await mount();
    await act(async () => { fireEvent.press(getByTestId('legal-reaccept-signout')); await Promise.resolve(); await Promise.resolve(); });
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockReaccept).not.toHaveBeenCalled();
  });

  it('LG4 shows nothing when the rows could not be read', async () => {
    mockState = 'unknown';
    const { queryByTestId } = await mount();
    expect(mockRead).toHaveBeenCalled();
    expect(queryByTestId('legal-reaccept')).toBeNull();
  });

  it('LG5 shows nothing when the account already accepted', async () => {
    mockState = 'accepted';
    const { queryByTestId } = await mount();
    expect(queryByTestId('legal-reaccept')).toBeNull();
  });

  it('LG6 shows nothing and reads nothing when signed out', async () => {
    mockUser = null;
    const { queryByTestId } = await mount();
    expect(queryByTestId('legal-reaccept')).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('LG7 with the flag off nothing is shown, no row is read, and owed records are still sent', async () => {
    mockFlag = false;
    const { queryByTestId } = await mount();
    expect(queryByTestId('legal-reaccept')).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockFlush).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000a1');
    expect(mockBuild).toHaveBeenCalledTimes(1);
  });

  it('LG7b the flag in the app is false', () => {
    const actual = jest.requireActual('@/constants/featureFlags');
    expect(actual.TERMS_REACCEPT_ENABLED).toBe(false);
  });

  it('LG8 a recorder that resolves without landing does not keep the sheet up', async () => {
    // recordReacceptance never rejects (utils/legalAcceptance); "could not send" resolves the same way.
    mockReaccept.mockImplementation(async () => { /* offline: noted on the phone, owed to the server */ });
    const { getByTestId, queryByTestId } = await mount();
    await act(async () => { fireEvent.press(getByTestId('legal-reaccept-agree')); await Promise.resolve(); await Promise.resolve(); });
    expect(queryByTestId('legal-reaccept')).toBeNull();
  });
});
