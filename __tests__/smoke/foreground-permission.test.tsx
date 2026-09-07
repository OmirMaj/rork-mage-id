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
 * WHAT CHANGED ON 2026-09-06, AND WHY THIS FILE HAD TO CHANGE WITH IT.
 * The fix for AI-2/NAV-04/VIS-11 removed the mount effect: utils/location.ts no
 * longer touches the OS at all until `request()` is called from a press. This
 * file used to pin the OLD behaviour as correct — its mock re-implemented the
 * hook WITH `useEffect(() => { void requestLocation(); }, [requestLocation])`,
 * returned the retired `{ location, loading, error, refresh }` shape, and
 * asserted `requestForegroundPermissionsAsync` had been called five times with
 * the comment "Every one of the five hooks is waiting on the same unanswered
 * alert." It would have passed just as happily after a complete revert of the
 * fix — a test that documents the bug as the spec.
 *
 * It now asserts the opposite, which is the actual contract: visiting all six
 * screens raises ZERO prompts, and the alert only goes up when the user presses
 * the control. The crash coverage is unchanged — the permission is still left
 * pending across an inactive → active cycle, it is just raised the way the app
 * raises it now.
 *
 * It also pins the non-string `AppState.currentState` case: the root
 * OfflineSyncManager used to call `appState.current.match(...)`, which throws
 * when the native constant is not a string (null on Android before the first
 * event; a non-string under this harness). That throw comes out of RN's event
 * emitter and takes the foreground queue drain with it.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
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
      const [status, setStatus] = React.useState('idle');
      const [error, setError] = React.useState(null);
      const inFlight = React.useRef(false);
      const request = React.useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setStatus('requesting');
        setError(null);
        try {
          const { status: perm } = await Loc.requestForegroundPermissionsAsync();
          if (perm !== 'granted') {
            setStatus('denied');
            setError('Location permission denied');
            return;
          }
          const loc = await Loc.getCurrentPositionAsync({ accuracy: Loc.Accuracy.Balanced });
          setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          setStatus('granted');
        } catch (err: any) {
          setStatus('unavailable');
          setError(err?.message ?? 'Failed to get location');
        } finally {
          inFlight.current = false;
        }
      }, []);
      // DELIBERATELY NO EFFECT. Its absence is the thing under test — see the
      // note in the header. scripts/validate-location-consent.ts pins the same
      // property statically; this file pins what it does at runtime.
      return { location, status, loading: status === 'requesting', error, request };
    },
  };
});

/**
 * Every screen that consumes the hook, plus the one the crash landed on, with
 * the testID of the control that is the ONLY way each can reach the OS.
 *
 * Four of the five render no control in this build, and that is correct, not an
 * oversight: discover/hire is behind HIRE_ENABLED, mage-id-bids' Browse mode
 * and nearby-rfps' whole distance strip are behind RFP_BROWSE_ENABLED, and
 * discover/bids only shows its control once you pick "Near me" or "Nearest".
 * A feature that cannot run does not get to ask for a permission.
 */
const LOCATION_SCREENS: { href: string; control: string | null }[] = [
  { href: '/discover/hire', control: null },
  { href: '/discover/bids', control: null },
  { href: '/discover/companies', control: 'companies-use-location' },
  { href: '/mage-id-bids', control: null },
  { href: '/nearby-rfps', control: null },
  // Not a location consumer, but the screen that was on top when the alert was
  // answered — and the one the error boundary replaced.
  { href: '/construction-ai', control: null },
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

  it.each(LOCATION_SCREENS.map((s) => [s.href, s.control] as const))(
    'does not send %s into a render loop when the permission is answered',
    async (href, control) => {
      // The alert sat up for three minutes in the live run while the app was
      // 'inactive'. Keep the promise pending so the screen sits in exactly that
      // state, then answer it at the moment the app comes back.
      let grant: (value: unknown) => void = () => undefined;
      const pending = new Promise((resolve) => { grant = resolve; });
      (Location.requestForegroundPermissionsAsync as jest.Mock).mockImplementation(() => pending);

      await primeWorld('populated');
      const tree = mountRoute(`${href}?projectId=${PROJECT_ID}&id=${PROJECT_ID}`);
      await settle();

      // Opening a screen is not consent. This is the regression the runtime
      // audit found: the alert went up on a job list at 9:20 and stood, modal
      // over the whole app, for the next eleven routes.
      expect((Location.requestForegroundPermissionsAsync as jest.Mock).mock.calls.length).toBe(0);

      if (control) {
        // The press IS the request — the only thing in the app that raises it.
        await act(async () => { fireEvent.press(tree.getByTestId(control)); await Promise.resolve(); });
        expect((Location.requestForegroundPermissionsAsync as jest.Mock).mock.calls.length).toBe(1);
      }

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
    // On device the tabs stay mounted after a visit, so the answer lands on a
    // screen the user has long since left. The Estimator's 2026-07-09
    // loop (commit 8f33e6fd) is the precedent for why that matters: a looping
    // tab "bled onto every screen visited afterward", because the boundary is
    // at the root.
    let grant: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => { grant = resolve; });
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockImplementation(() => pending);

    await primeWorld('populated');
    const tree = mountRoute('/');
    await settle();

    for (const { href, control } of LOCATION_SCREENS) {
      await act(async () => { router.navigate(href as never); await Promise.resolve(); });
      await settle();
      if (control) {
        // Raise the alert the way a person does, then walk away from the screen
        // with it still up — which is what the founder did.
        await act(async () => { fireEvent.press(tree.getByTestId(control)); await Promise.resolve(); });
      }
    }
    for (const href of ['/materials', '/schedule', '/summary']) {
      await act(async () => { router.navigate(href as never); await Promise.resolve(); });
      await settle();
    }
    // ONE prompt, from the one press. It used to be five, one per screen
    // visited, none of them asked for — see the header.
    expect((Location.requestForegroundPermissionsAsync as jest.Mock).mock.calls.length).toBe(1);

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
