// Deep-link router for the `rork-app://` scheme.
//
// Expo Router calls this for every incoming system path (universal links,
// notification deeplinks, scheme URLs). Returning the path unchanged lets
// the router's normal file-based routing handle it; returning '/' forces
// the home tab regardless of what the user tapped.
//
// The earlier implementation always redirected to '/', which broke the
// prequal-form magic-link flow — a sub tapping `rork-app://prequal-form
// ?token=XYZ` ended up on the GC home screen.
//
// Policy:
//   • Whitelisted public paths (prequal-form, reset-password) are passed
//     through with their query params intact. These screens have no auth
//     gate, so routing to them pre-login is safe.
//   • Everything else returns '/'. Authenticated deep-links are the job
//     of the main layout, which will redirect to login if needed.

const PUBLIC_PATHS = new Set<string>([
  'prequal-form',
  'reset-password',
]);

export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  void initial;
  try {
    // Strip scheme + leading slash; keep query string.
    // Examples handled:
    //   rork-app://prequal-form?token=abc → prequal-form?token=abc
    //   /prequal-form?token=abc           → prequal-form?token=abc
    //   rork-app://                       → ''
    const cleaned = path
      .replace(/^rork-app:\/\//, '')
      .replace(/^\//, '');
    const [route] = cleaned.split('?');
    if (route && PUBLIC_PATHS.has(route)) {
      // Preserve query string
      return '/' + cleaned;
    }
  } catch {
    // fall through to home
  }
  return '/';
}
