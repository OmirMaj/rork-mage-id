// Deep-link router for the app's custom scheme (mageid://, see app.json).
//
// Expo Router calls this for every incoming system path (universal links,
// notification deeplinks, scheme URLs). Whitelisted public paths pass through
// with their query params intact; everything else returns '/' so the main
// layout can gate it behind login. The scheme-stripping + whitelist live in
// utils/deepLinkScheme so they can be unit-validated in isolation.

import { resolveDeepLinkPath } from '@/utils/deepLinkScheme';

export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  void initial;
  return resolveDeepLinkPath(path);
}
