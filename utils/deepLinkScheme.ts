// Deep-link scheme — single source of truth for the app's custom URL scheme.
//
// The app registers TWO schemes during (and after) the mageid:// migration:
//   • mageid://   — the PRIMARY, MAGE-branded scheme. Every NEW outbound
//                   deep link (magic links, password reset, share links,
//                   OAuth hand-off) is built with this.
//   • rork-app:// — the LEGACY scheme from the original scaffold. Kept
//                   REGISTERED (see app.json `scheme` array) so links that
//                   were already emailed/generated with the old scheme still
//                   resolve on updated installs. Incoming routing accepts it;
//                   we just never mint new links with it.
//
// IMPORTANT: the redirect scheme MUST match a scheme the native binary
// registers. A past regression set redirects to mageid:// while the binary
// only registered rork-app://, which opened nothing and locked users out of
// password reset (see contexts/AuthContext.tsx history). Registering BOTH in
// app.json is what makes flipping the primary to mageid:// safe.
//
// This module is intentionally dependency-free so it can be unit-validated in
// isolation (scripts/validate-scheme-routing.ts).

/** Primary scheme prefix — use this to build every NEW outbound deep link. */
export const PRIMARY_SCHEME = 'mageid://';

/** Legacy scheme prefix, still accepted on inbound links. Do not mint new. */
export const LEGACY_SCHEME = 'rork-app://';

/** Bare scheme names (no `://`) as registered in app.json — primary first. */
export const APP_SCHEMES = ['mageid', 'rork-app'] as const;

// Matches either registered scheme at the very start of a path.
const SCHEME_PREFIX_RE = /^(?:mageid|rork-app):\/\//;

/**
 * Strip any registered app scheme prefix AND a single leading slash, leaving
 * the route + query string. Scheme-agnostic so mageid:// and rork-app:// (and
 * a bare `/path`) all normalize identically.
 *
 *   mageid://prequal-form?token=abc   → prequal-form?token=abc
 *   rork-app://prequal-form?token=abc → prequal-form?token=abc
 *   /prequal-form?token=abc           → prequal-form?token=abc
 *   mageid://                         → ''
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
