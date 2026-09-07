/**
 * The location-permission grant, and the AppState cycle it drags behind it.
 *
 * WHY THIS FILE EXISTS.
 * A Release build on the founder's account hit the app's ErrorBoundary with
 * "Maximum update depth exceeded" the instant "Allow While Using App" was
 * tapped on the Construction AI screen (runtime audit 2026-09-06). The
 * every-route suites were green at the time and stayed green afterwards,
 * because they never reach either half of what that tap does:
 *
 *  1. THE PERMISSION IS ALWAYS DENIED UNDER TEST. __tests__/setup/edge-mocks.js
 *     answers requestForegroundPermissionsAsync with `denied`, so `location`
 *     is null on every screen in every route test — the five screens that call
 *     useUserLocation (discover/hire, discover/bids, discover/companies,
 *     mage-id-bids, nearby-rfps) only ever render their no-location branch.
 *
 *  2. useUserLocation CANNOT SUCCEED UNDER TEST AT ALL, even with the mock
 *     flipped. utils/location.ts reaches the module through
 *     `await import('expo-location')`, and jest's CJS runtime rejects that
 *     ("A dynamic import callback was invoked without --experimental-vm-modules").
 *     The hook silently lands in its catch and sets `error`. So the mock below
 *     re-implements the hook over a static require — line for line, same
 *     states, same order — which is the only way the granted branch runs here.
 *
 *  3. NOTHING EVER FIRES AN AppState TRANSITION. The iOS permission alert
 *     resigns the app ('inactive') and dismissing it resumes it ('active'),
 *     which is what drives OfflineSyncManager's queue drain, the reachability
 *     probe's foreground gate, the queue-depth re-read and the materials
 *     re-price. None of that was exercised by any test.
 *
 * So this file mounts the real app at the route the crash happened on (and at
 * every screen that consumes the permission), leaves the permission PENDING the
 * way the alert did for three minutes, then resolves it at the same moment the
 * app foregrounds. A render loop trips the root ErrorBoundary, which is what we
 * assert against — the same detector mountRouteChecked uses.
 *
 * It also pins the non-string `AppState.currentState` case: the root
 * OfflineSyncManager used to call `appState.current.match(...)`, which throws
 * when the native constant is not a string (null on Android before the first
 * event; a non-string under this harness). That throw comes out of RN's event
 * emitter and takes the foreground queue drain with it.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { act } from 'expo-router/testing-library';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as Sentry from '@sentry/react-native';
import { primeWorld, mountRoute, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';

// See (2) in the header: the real hook's dynamic import cannot resolve under
// jest, so the granted path is unreachable without this. Everything else about
// utils/location (getDistanceMiles, the UserLocation shape) stays real.
jest.mock('@/utils/location', () => {
  const React = require('react');
  const actual = jest.requireActual('@/utils/location');
  const Loc = require('expo-location');
  return {
    ...actual,
    useUserLocation() {
      const [location, setLocation] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState(null);
      const requestLocation = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const { status } = await Loc.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            setError('Location permission denied');
            setLoading(false);
            return;
          }
          const loc = await Loc.getCurrentPositionAsync({ accuracy: Loc.Accuracy.Balanced });
          setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        } catch (err: any) {
          setError(err?.message ?? 'Failed to get location');
        } finally {
          setLoading(false);
        }
      }, []);
      React.useEffect(() => { void requestLocation(); }, [requestLocation]);
      return { location, loading, error, refresh: requestLocation };
    },
  };
});

/** Every screen that asks for the permission, plus the one the crash landed on. */
const LOCATION_SCREENS = [
  '/discover/hire',
  '/discover/bids',
  '/discover/companies',
  '/mage-id-bids',
  '/nearby-rfps',
  // Not a location consumer, but the screen that was on top when the alert was
  // answered — and the one the error boundary replaced.
  '/construction-ai',
];

type Handler = (state: AppStateStatus) => void;

let handlers: Handler[] = [];
let realAddEventListener: typeof AppState.addEventListener;

/**
 * RN's AppState has no public emit, so we tee every listener the app registers
 * and call them ourselves. The real subscription is still made (and removed),
 * so mount/unmount bookkeeping stays honest.
 */
function installAppStateTee(): void {
  handlers = [];
  realAddEventListener = AppState.addEventListener.bind(AppState);
  AppState.addEventListener = (type: string, handler: Handler) => {
    if (type === 'change') handlers.push(handler);
    const sub = realAddEventListener(type as 'change', handler as never);
    return {
      remove: () => {
        handlers = handlers.filter((h) => h !== handler);
        sub.remove();
      },
    };
  };
}

function removeAppStateTee(): void {
  AppState.addEventListener = realAddEventListener;
}

async function fireAppState(state: AppStateStatus): Promise<void> {
  await act(async () => {
    // The app reads this on mount; keep it consistent with what we dispatch.
    AppState.currentState = state;
    for (const handler of [...handlers]) handler(state);
    await Promise.resolve();
  });
}

/**
 * The same two detectors mountRouteChecked uses. A render loop does not throw
 * out of `render()` — React hands it to the app's ErrorBoundary, which is
 * exactly what the founder saw ("Something went wrong" + Try Again).
 */
function boundaryTrip(tree: ReturnType<typeof mountRoute>): string {
  const captured = (Sentry.captureException as jest.Mock).mock?.calls ?? [];
  const messages = captured.map(([err]) => String((err as Error)?.message ?? err));
  if (tree.queryByTestId('error-boundary-retry')) messages.push('ErrorBoundary rendered its fallback');
  return messages.join(' | ');
}

describe('granting the location permission', () => {
  beforeEach(() => {
    installAppStateTee();
    AppState.currentState = 'active';
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 40.6782, longitude: -73.9442, accuracy: 5 },
    });
  });

  afterEach(removeAppStateTee);

  it.each(LOCATION_SCREENS)(
    'does not send %s into a render loop when the permission is answered',
    async (href) => {
      // The alert sat up for three minutes in the live run while the app was
      // 'inactive'. Keep the promise pending so the screens mount in exactly
      // that state, then answer it at the moment the app comes back.
      let grant: (value: unknown) => void = () => undefined;
      const pending = new Promise((resolve) => { grant = resolve; });
      (Location.requestForegroundPermissionsAsync as jest.Mock).mockImplementation(() => pending);

      await primeWorld('populated');
      const tree = mountRoute(`${href}?projectId=${PROJECT_ID}&id=${PROJECT_ID}`);
      await settle();

      (Sentry.captureException as jest.Mock).mockClear();

      await fireAppState('inactive');       // the alert is presented
      grant({ status: 'granted', granted: true }); // "Allow While Using App"
      await fireAppState('active');         // the alert is dismissed
      await settle();
      await settle();

      expect(boundaryTrip(tree)).toBe('');
    },
  );

  it('survives the foreground cycle with every location screen mounted at once', async () => {
    // On device the tabs stay mounted after a visit, so one tap resolves the
    // permission for all five hooks simultaneously. The Estimator's 2026-07-09
    // loop (commit 8f33e6fd) is the precedent for why that matters: a looping
    // tab "bled onto every screen visited afterward", because the boundary is
    // at the root.
    let grant: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => { grant = resolve; });
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockImplementation(() => pending);

    await primeWorld('populated');
    const tree = mountRoute('/');
    await settle();

    for (const href of [...LOCATION_SCREENS, '/materials', '/schedule', '/summary']) {
      await act(async () => { router.navigate(href as never); await Promise.resolve(); });
      await settle();
    }
    // Every one of the five hooks is waiting on the same unanswered alert.
    expect((Location.requestForegroundPermissionsAsync as jest.Mock).mock.calls.length).toBe(5);

    (Sentry.captureException as jest.Mock).mockClear();

    await fireAppState('inactive');
    grant({ status: 'granted', granted: true });
    await fireAppState('active');
    await settle();
    await settle();

    expect(boundaryTrip(tree)).toBe('');
    expect(tree.getPathname()).toBe('/summary');
  });

  it('foregrounds cleanly when AppState.currentState is not a string', async () => {
    // The root OfflineSyncManager seeds a ref with AppState.currentState and
    // used to call `.match()` on it. Android reports null before the first
    // event; this harness reports a non-string. The throw escaped into RN's
    // event emitter and took the foreground queue drain with it.
    (Location.requestForegroundPermissionsAsync as jest.Mock)
      .mockResolvedValue({ status: 'granted', granted: true });

    await primeWorld('populated');
    // @ts-expect-error deliberately not a string — the case that threw
    AppState.currentState = { unknown: true };
    const tree = mountRoute('/construction-ai');
    await settle();

    (Sentry.captureException as jest.Mock).mockClear();

    await expect(fireAppState('inactive')).resolves.toBeUndefined();
    await expect(fireAppState('active')).resolves.toBeUndefined();
    await settle();

    expect(boundaryTrip(tree)).toBe('');
  });
});
