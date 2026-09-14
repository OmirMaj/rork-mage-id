// Web-app origin — single source of truth for the host that serves the Expo
// Router routes, and the one place that knows it is NOT the marketing host.
//
// MAGE ID publishes to TWO Netlify sites, and they are not interchangeable:
//
//   https://app.mageid.app   the Expo web build (`bunx expo export --platform
//                            web`, SPA rewrite `/* → /index.html 200`). Every
//                            route under `app/` lives here — including the
//                            public `shared-*` routes a GC sends to a client.
//
//   https://mageid.app       the static marketing site (`marketing/`, rsync,
//                            no build). Its catch-all is `/* → /404.html 404`.
//                            It legitimately serves /portal and /sub-portal,
//                            which are hand-written static pages — but it has
//                            no Expo routes and never will.
//
// THE BUG THIS FILE EXISTS TO CLOSE: three share-link builders composed
// `https://mageid.app` + `/shared-estimate|photos|plan`. On web they happened
// to be right (they preferred `window.location.origin`); on a phone they fell
// through to the marketing host and produced a link that 404s. Verified live
// on 2026-09-13: `https://mageid.app/shared-estimate?t=abc` → 404, while
// `https://app.mageid.app/shared-estimate?t=abc` → 200. Because the GC only
// sees "Proposal link copied", the failure was invisible to the one person who
// could have reported it — every proposal, photo timeline and floor plan
// shared from an iPhone went out dead.
//
// Dependency-free on purpose (no react-native import), so the host rule can be
// unit-validated in isolation by scripts/validate-share-link-host.ts. Callers
// on web pass `window.location.origin` so a dev server or a Netlify deploy
// preview links to itself; everyone else passes nothing and gets production.

/** The host that serves the Expo Router routes. Share links MUST use this. */
export const WEB_APP_ORIGIN = 'https://app.mageid.app';

/** The static marketing host. Serves /portal and /sub-portal — no Expo routes. */
export const MARKETING_ORIGIN = 'https://mageid.app';

/** Public share routes that exist only in the Expo app, hence only on WEB_APP_ORIGIN. */
export const SHARE_ROUTES = [
  'shared-estimate',
  'shared-photos',
  'shared-plan',
  'shared-schedule',
] as const;

export type ShareRoute = (typeof SHARE_ROUTES)[number];

/** Origins that can never serve an Expo route, whatever the runtime claims. */
const NON_APP_HOSTS = new Set(['mageid.app', 'www.mageid.app']);

/**
 * Resolve the origin a share link should be built on.
 *
 * `runtimeOrigin` is `window.location.origin` on web and null/undefined
 * everywhere else. It is honoured so that a link copied out of a dev server or
 * a deploy preview points back at that same deployment — but only when it can
 * actually serve the route. A runtime origin on the marketing host (or any
 * malformed value) falls back to production rather than minting a dead link.
 */
export function shareLinkBase(runtimeOrigin?: string | null): string {
  if (typeof runtimeOrigin !== 'string') return WEB_APP_ORIGIN;
  const trimmed = runtimeOrigin.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(trimmed)) return WEB_APP_ORIGIN;
  const host = trimmed.replace(/^https?:\/\//, '').toLowerCase();
  if (NON_APP_HOSTS.has(host)) return WEB_APP_ORIGIN;
  return trimmed;
}

/**
 * Build a public share URL. The ONLY sanctioned way to compose one — a guard
 * (scripts/validate-share-link-host.ts) fails the build on a hand-rolled
 * `${base}/shared-…` template anywhere in the source tree.
 */
export function buildShareUrl(
  route: ShareRoute,
  token: string,
  runtimeOrigin?: string | null,
): string {
  return `${shareLinkBase(runtimeOrigin)}/${route}?t=${encodeURIComponent(token)}`;
}

/**
 * Build a share URL for the SERVER-SNAPSHOT variant, which keys on a row id
 * (`?s=`) instead of an inline payload (`?t=`).
 *
 * A schedule too large to fit in a token is written to
 * `shared_schedule_snapshots` and shared by row id. It is a second composer
 * rather than a parameter on `buildShareUrl` so that neither caller has to
 * think about which query key it wants — and so the guard can keep an absolute
 * rule (no `/shared-…?` literal outside this file) with no exemptions.
 */
export function buildSnapshotShareUrl(
  route: ShareRoute,
  snapshotId: string,
  runtimeOrigin?: string | null,
): string {
  return `${shareLinkBase(runtimeOrigin)}/${route}?s=${encodeURIComponent(snapshotId)}`;
}
