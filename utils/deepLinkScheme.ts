// Deep-link scheme — single source of truth for the app's custom URL scheme.
//
// The app uses ONE scheme: mageid://. (The project was originally scaffolded
// with a rork-app:// scheme; it was retired in the pre-launch clean-up. No
// magic links / OAuth deep links using the old scheme were ever sent to a
// real user, so there is no legacy scheme to keep supporting.)
//
// Every outbound deep link is built from PRIMARY_SCHEME; every inbound link is
// normalized through stripAppScheme. Keeping the scheme in one place means a
// future rename touches this file only.
//
// Dependency-free on purpose, so it can be unit-validated in isolation
// (scripts/validate-scheme-routing.ts).

/** The app's custom URL scheme prefix — use this to build every deep link. */
export const PRIMARY_SCHEME = 'mageid://';

/** Bare scheme name(s) (no `://`) as registered in app.json `scheme`. */
export const APP_SCHEMES = ['mageid'] as const;

// Matches the app scheme at the very start of a path.
const SCHEME_PREFIX_RE = /^mageid:\/\//;

/**
 * Strip the app scheme prefix AND a single leading slash, leaving the route +
 * query string. A bare in-app path (`/route?x=1`) normalizes the same way.
 *
 *   mageid://prequal-form?token=abc → prequal-form?token=abc
 *   /prequal-form?token=abc         → prequal-form?token=abc
 *   mageid://                       → ''
 */
export function stripAppScheme(path: string): string {
  return path.replace(SCHEME_PREFIX_RE, '').replace(/^\//, '');
}

// Public (no-auth-gate) routes that a deep link may open pre-login. Everything
// else routes to home; the main layout redirects to login when needed.
export const PUBLIC_PATHS = new Set<string>([
  'prequal-form',
  'reset-password',
]);

/**
 * Resolve an incoming system path to an in-app route. Whitelisted public paths
 * pass through with their query string intact; anything else goes to '/'.
 */
export function resolveDeepLinkPath(path: string): string {
  try {
    const cleaned = stripAppScheme(path);
    const [route] = cleaned.split('?');
    if (route && PUBLIC_PATHS.has(route)) {
      return '/' + cleaned;
    }
  } catch {
    // fall through to home
  }
  return '/';
}
