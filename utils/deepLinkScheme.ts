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

// A well-formed in-app route: one or more '/'-separated segments of
// [a-z0-9-], optionally followed by a query string. This lets EVERY real
// route through to the router/auth-gate instead of the old behaviour of
// silently rewriting ~99 routes to Home. Unknown routes fall to +not-found.
const IN_APP_ROUTE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/i;

export function isInAppRoute(route: string): boolean {
  return IN_APP_ROUTE.test(route);
}

/**
 * Resolve an incoming system path to an in-app route. Public paths and
 * well-formed in-app routes pass through with their query string intact;
 * genuinely malformed paths go to '/'.
 */
export function resolveDeepLinkPath(path: string): string {
  try {
    const cleaned = stripAppScheme(path);
    if (!cleaned) return '/';
    const [route] = cleaned.split('?');
    if (!route) return '/';
    if (PUBLIC_PATHS.has(route)) return '/' + cleaned;       // pre-login public
    if (isInAppRoute(route)) return '/' + cleaned;           // authenticated in-app
  } catch {
    // fall through
  }
  return '/';                                                // genuinely malformed
}
