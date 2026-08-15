/**
 * __tests__/setup/edge-mocks.js — the native edge, stubbed. `setupFiles`.
 *
 * Spec: "Mock the network and native edge only ... Do NOT mock the 31 [16]
 * providers. They run for real and hydrate from the fixture."
 *
 * So the rule for this file is narrow: a module belongs here only if it needs a
 * device or a network to load. Nothing in `contexts/`, `hooks/` or `utils/`
 * belongs here — if a provider misbehaves under test that IS the finding.
 *
 * `lib/supabase` is handled by moduleNameMapper instead (see jest.config.js),
 * because a path-aliased app module is cleaner to redirect than to jest.mock().
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// ---------------------------------------------------------------------------
// AsyncStorage — the community in-memory mock, per spec.
// This is load-bearing for the populated state: the app is offline-first, so
// nearly every provider hydrates from AsyncStorage before it ever reaches
// Supabase. The fixture seeds THIS.
// ---------------------------------------------------------------------------
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// ---------------------------------------------------------------------------
// RevenueCat. Needs a native SDK + a network round trip for offerings.
// `getCustomerInfo` returns a free-tier customer: no entitlements. Screens that
// gate on tier therefore render their locked/upsell branch, which is the
// branch a brand-new tester sees.
// ---------------------------------------------------------------------------
jest.mock('react-native-purchases', () => {
  const customerInfo = {
    entitlements: { active: {}, all: {} },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
    latestExpirationDate: null,
    originalAppUserId: 'smoke-test-user',
    managementURL: null,
    requestDate: new Date().toISOString(),
  };
  const Purchases = {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    logIn: jest.fn(async () => ({ customerInfo, created: false })),
    logOut: jest.fn(async () => customerInfo),
    getCustomerInfo: jest.fn(async () => customerInfo),
    getOfferings: jest.fn(async () => ({ current: null, all: {} })),
    purchasePackage: jest.fn(async () => ({ customerInfo })),
    purchaseStoreProduct: jest.fn(async () => ({ customerInfo })),
    restorePurchases: jest.fn(async () => customerInfo),
    addCustomerInfoUpdateListener: jest.fn(() => jest.fn()),
    removeCustomerInfoUpdateListener: jest.fn(),
    setAttributes: jest.fn(),
    isConfigured: jest.fn(async () => true),
    syncPurchases: jest.fn(async () => customerInfo),
  };
  return {
    __esModule: true,
    default: Purchases,
    LOG_LEVEL: { VERBOSE: 'VERBOSE', DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
    PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' },
  };
});

// ---------------------------------------------------------------------------
// expo-haptics — pure native side effect, no return value anyone branches on.
// ---------------------------------------------------------------------------
jest.mock('expo-haptics', () => ({
  __esModule: true,
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// ---------------------------------------------------------------------------
// expo-secure-store — Keychain / Keystore.
// Backed by a real in-memory Map rather than jest.fn() returning undefined, so
// a set-then-get round trip inside a provider behaves.
// ---------------------------------------------------------------------------
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k) => { store.delete(k); }),
    isAvailableAsync: jest.fn(async () => true),
    WHEN_UNLOCKED: 'WHEN_UNLOCKED',
    AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  };
});

// ---------------------------------------------------------------------------
// expo-image-picker — camera roll / camera.
// Always "cancelled": a mount-only suite never picks an image, and returning a
// fake asset would push screens into a post-selection state nobody asked for.
// ---------------------------------------------------------------------------
jest.mock('expo-image-picker', () => ({
  __esModule: true,
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getCameraPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  useMediaLibraryPermissions: jest.fn(() => [{ status: 'granted', granted: true }, jest.fn()]),
  MediaTypeOptions: { All: 'All', Images: 'Images', Videos: 'Videos' },
  MediaType: { image: 'image', video: 'video' },
  UIImagePickerControllerQualityType: { High: 0, Medium: 1, Low: 2 },
  ImagePickerErrorResult: {},
}));

// ---------------------------------------------------------------------------
// expo-file-system — no filesystem under jest. Covers both the legacy default
// export surface and the SDK 52+ `File`/`Directory`/`Paths` API, because the
// app imports both shapes in different modules.
// ---------------------------------------------------------------------------
jest.mock('expo-file-system', () => require('../mocks/expo-file-system')());
jest.mock('expo-file-system/legacy', () => require('../mocks/expo-file-system')());

// ---------------------------------------------------------------------------
// Below this line: NOT in the spec's list, but each is a native/network edge
// that cannot load at all under jest. Each one is here because it threw, and
// the comment says what it threw.
// ---------------------------------------------------------------------------

// Sentry wraps the root layout (`Sentry.wrap(...)`) and its native module is
// absent. Left unmocked it warns on every import and its native init throws.
jest.mock('@sentry/react-native', () => {
  const passthrough = (c) => c;
  return {
    __esModule: true,
    init: jest.fn(),
    wrap: passthrough,
    withProfiler: passthrough,
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    addBreadcrumb: jest.fn(),
    setUser: jest.fn(),
    setTag: jest.fn(),
    setContext: jest.fn(),
    setExtra: jest.fn(),
    nativeCrash: jest.fn(),
    reactNavigationIntegration: jest.fn(() => ({ name: 'ReactNavigation' })),
    mobileReplayIntegration: jest.fn(() => ({ name: 'MobileReplay' })),
    ErrorBoundary: ({ children }) => children,
    ReactNativeTracing: jest.fn(),
    Severity: { Error: 'error', Warning: 'warning', Info: 'info' },
  };
});

// expo-notifications registers native listeners and asks the push service for
// a token on import in some paths.
jest.mock('expo-notifications', () => ({
  __esModule: true,
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[smoke-test]' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'smoke-test' })),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  removeNotificationSubscription: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'smoke-test-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  setBadgeCountAsync: jest.fn(async () => true),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  setNotificationChannelAsync: jest.fn(async () => null),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
}));

// expo-updates reads native build constants that do not exist in a jest run.
jest.mock('expo-updates', () => ({
  __esModule: true,
  isEnabled: false,
  channel: 'smoke-test',
  updateId: null,
  runtimeVersion: '1.0.0',
  checkForUpdateAsync: jest.fn(async () => ({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(async () => ({ isNew: false })),
  reloadAsync: jest.fn(async () => {}),
  useUpdates: jest.fn(() => ({ isUpdateAvailable: false, isUpdatePending: false })),
}));

// Native quick-action (3D-touch) registration + a router side effect on mount.
jest.mock('expo-quick-actions', () => ({
  __esModule: true,
  default: { setItems: jest.fn(async () => {}), isSupported: jest.fn(async () => false) },
  setItems: jest.fn(async () => {}),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-quick-actions/router', () => ({
  __esModule: true,
  useQuickActionRouting: jest.fn(),
  RouterAction: {},
}));

// Google sign-in ships a native module and throws on import off-device.
jest.mock('@react-native-google-signin/google-signin', () => ({
  __esModule: true,
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(async () => ({ type: 'cancelled' })),
    signOut: jest.fn(async () => {}),
    getTokens: jest.fn(async () => ({ idToken: null, accessToken: null })),
  },
  GoogleSigninButton: () => null,
  statusCodes: { SIGN_IN_CANCELLED: '-5', IN_PROGRESS: '-3', PLAY_SERVICES_NOT_AVAILABLE: '-2' },
  isSuccessResponse: () => false,
}));

// Local auth (FaceID/TouchID) — native only.
jest.mock('expo-local-authentication', () => ({
  __esModule: true,
  hasHardwareAsync: jest.fn(async () => false),
  isEnrolledAsync: jest.fn(async () => false),
  supportedAuthenticationTypesAsync: jest.fn(async () => []),
  authenticateAsync: jest.fn(async () => ({ success: false })),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
}));

// Geolocation — would prompt / hang.
jest.mock('expo-location', () => ({
  __esModule: true,
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 0, longitude: 0, accuracy: 1 } })),
  reverseGeocodeAsync: jest.fn(async () => []),
  geocodeAsync: jest.fn(async () => []),
  Accuracy: { Balanced: 3, High: 4, Highest: 6 },
}));

// ---------------------------------------------------------------------------
// The network itself. Any `fetch` that escapes the mocks above (weather,
// PostHog, edge functions called by URL rather than through the client)
// must not reach the internet from a test run: it would be slow, flaky,
// and would write real analytics rows.
// ---------------------------------------------------------------------------
global.fetch = jest.fn(async () =>
  Object.assign(
    {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
      blob: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
      clone() { return this; },
    },
    {}
  )
);

// Silence the RN "not implemented" animation frame noise deterministically.
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
