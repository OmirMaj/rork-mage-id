import AsyncStorage from '@react-native-async-storage/async-storage';
import { isInAppRoute } from '@/utils/deepLinkScheme';

export const PENDING_DEEPLINK_KEY = 'mageid_pending_deeplink';
const TTL_MS = 10 * 60 * 1000; // a link older than 10 min is stale, don't replay

/** Stash an intended in-app path to replay after the user authenticates. */
export async function setPendingDeepLink(path: string): Promise<void> {
  const route = path.replace(/^\//, '').split('?')[0];
  if (!route || !isInAppRoute(route)) return; // never stash junk/external
  await AsyncStorage.setItem(PENDING_DEEPLINK_KEY, JSON.stringify({ path, ts: Date.now() }));
}

/** Return the pending path once (clearing it), or null if none/expired/invalid. */
export async function takePendingDeepLink(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(PENDING_DEEPLINK_KEY);
  await AsyncStorage.removeItem(PENDING_DEEPLINK_KEY);
  if (!raw) return null;
  try {
    const { path, ts } = JSON.parse(raw) as { path: string; ts: number };
    if (typeof path !== 'string' || Date.now() - ts > TTL_MS) return null;
    const route = path.replace(/^\//, '').split('?')[0];
    return isInAppRoute(route) ? path : null;
  } catch {
    return null;
  }
}
