/**
 * #73 (wave 5, crew lane): a claim link GoTrue refused (expired / already
 * used) must not spin on "Confirming your profile…" forever. With no session
 * and '#error_code=otp_expired' on the URL, the screen shows the expired copy
 * and a Sign in button that stashes the claim path and goes to /login.
 * Landed by w5-join-screens (crew lane handoff).
 */
import React from 'react';
import { Linking } from 'react-native';
import { renderRouter, screen, fireEvent, waitFor, act } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';

const mockAuth = { user: null as null | { id: string }, isAuthenticated: false, isLoading: false };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('@/contexts/CrewContext', () => ({ useCrew: () => ({ crewMembers: [], updateCrewMember: jest.fn() }) }));

// eslint-disable-next-line import/first
import ClaimCrewScreen from '@/app/claim-crew';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}><SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{children}</ThemeProvider></SafeAreaProvider></QueryClientProvider>;
}
const Login = () => null;
const TOKEN = 'crew_11111111-2222-4333-8444-555555555555';

describe('claim-crew with an expired magic link', () => {
  it('shows the expired copy and a Sign in that goes to /login with the claim stashed', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(
      `https://app.mageid.app/claim-crew?token=${TOKEN}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
    );
    const r = renderRouter(
      { 'claim-crew': ClaimCrewScreen as () => React.ReactElement, login: Login },
      { initialUrl: `/claim-crew?token=${TOKEN}`, wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByText(/This sign-in link has expired or was already used\. Your invite is still good\./)).toBeTruthy());
    expect(screen.queryByText('Confirming your profile…')).toBeNull();
    expect(screen.getByText('Go to app')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('claim-sign-in')); });
    await waitFor(() => expect(r.getPathname()).toBe('/login'));
    const stash = await AsyncStorage.getItem('mageid_pending_deeplink');
    expect(JSON.parse(stash ?? '{}').path).toBe(`/claim-crew?token=${TOKEN}`);
  });

  it('with no URL error, stops waiting 8 s after auth finished loading', async () => {
    jest.useFakeTimers();
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
    renderRouter(
      { 'claim-crew': ClaimCrewScreen as () => React.ReactElement, login: Login },
      { initialUrl: `/claim-crew?token=${TOKEN}`, wrapper: Wrapper },
    );
    expect(screen.getByText('Confirming your profile…')).toBeTruthy();
    expect(screen.getByText('Go to app')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(8100); });
    expect(screen.getByText(/This sign-in link has expired or was already used/)).toBeTruthy();
    jest.useRealTimers();
  });
});
