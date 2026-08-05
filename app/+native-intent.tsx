// Deep-link router for the app's custom scheme (mageid://, see app.json).
//
// Expo Router calls this for every incoming system path (universal links,
// notification deeplinks, scheme URLs). Public paths and well-formed in-app
// routes pass through with their query params intact (in-app routes are then
// handled by the router + auth-gate in the main layout); only genuinely
// empty or malformed paths fall back to '/'. The scheme-stripping + route
// resolution live in utils/deepLinkScheme so they can be unit-validated in
// isolation.

import { resolveDeepLinkPath } from '@/utils/deepLinkScheme';

export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  void initial;
  return resolveDeepLinkPath(path);
}
