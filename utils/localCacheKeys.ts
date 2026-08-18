// utils/localCacheKeys.ts — the single source of truth for which local-storage
// keys belong to this app, and which of them survive a tenant switch.
//
// Pure module: no imports, no react-native, no AsyncStorage. It only decides
// WHICH keys to remove; contexts/AuthContext.tsx does the removing, and
// scripts/validate-storage-hygiene.ts asserts the decision against what the
// source actually writes.
//
// ── Which platform the risk lands on ─────────────────────────────────────────
// iOS/Android: AsyncStorage is a per-app sandbox. Residue is invisible to every
//   other app; the worst case is this app's NEXT user on the SAME device.
// Web: AsyncStorage IS window.localStorage — every method in
//   @react-native-async-storage/async-storage/src/AsyncStorage.ts is a direct
//   window.localStorage passthrough with NO namespace of its own. localStorage
//   is scoped per ORIGIN, persists across sign-out, has no expiry, and is
//   readable by any script on the page. That is where the leak actually lands:
//   app.mageid.app on a site-office iPad or a family computer, where the next
//   contractor to sign in inherits the previous one's change orders and
//   contacts. The fix must cover both platforms; the severity is web's.
//
// ── Why the sweep is prefix-scoped and never AsyncStorage.clear() ────────────
// Because web AsyncStorage is the raw origin store, getAllKeys() enumerates
// EVERYTHING on app.mageid.app — including Supabase's own session
// (`sb-<projectRef>-auth-token`, written by lib/supabase.ts's `storage:
// AsyncStorage`), Stripe, RevenueCat and Sentry state. A blanket clear() would
// sign the user out from under the sign-out handler and corrupt third-party
// SDKs. So we only ever remove keys that match a prefix this app is known to
// own, and the prefixes below are the complete, asserted list of those.

/**
 * Prefixes the app writes today. `mageid_` and `mage_` are disjoint —
 * 'mageid_projects'.startsWith('mage_') is false, since the 5th character is
 * 'i', not '_'.
 */
export const CURRENT_STORAGE_PREFIXES = ['mageid_', 'mage_'] as const;

/**
 * Prefixes the app USED to write. Both were renamed to `mageid_*` by the
 * pre-launch de-brand (commit 0dfbce0, 2026-07-16): `buildwise_*` (10 keys, the
 * old "BuildWise" app name) and `tertiary_*` (64 keys, the scaffold prefix).
 *
 * That commit renamed the CODE. It did not touch data already on disk, and it
 * did not add the old names to the wipe path — so on any device that had run a
 * pre-de-brand build, the old keys kept their contents (change orders, COIs,
 * contacts, subcontractors) and survived every logout since. The 2026-08-17 web
 * audit found them still populated on a live account, with `buildwise_projects`
 * already diverged from `mageid_projects`.
 *
 * Nothing in the app reads or writes them any more — validate-storage-hygiene
 * asserts that — so they are unreachable residue. Purging them removes nothing
 * the app can still use; it only removes what the next tenant could read.
 */
export const LEGACY_STORAGE_PREFIXES = ['buildwise_', 'tertiary_'] as const;

/**
 * App-owned keys that carry no app prefix at all. Swept by exact prefix match
 * so the sweep can never widen to a generic namespace another script on the
 * origin might use.
 *   bids_*            — app/(tabs)/discover/bids.tsx filter state (home state,
 *                       location mode, construction-only). Per-user.
 *   post-rfp:draft:*  — app/post-rfp.tsx autosaved RFP draft, suffixed with the
 *                       author's user id. Scope + budget of an unposted job.
 */
export const UNNAMESPACED_APP_KEY_PREFIXES = [
  'bids_home_state',
  'bids_location_mode',
  'bids_construction_only',
  'post-rfp:draft:',
] as const;

/** Every prefix this app owns. Anything else on the origin is not ours. */
export const APP_STORAGE_PREFIXES: readonly string[] = [
  ...CURRENT_STORAGE_PREFIXES,
  ...LEGACY_STORAGE_PREFIXES,
  ...UNNAMESPACED_APP_KEY_PREFIXES,
];

/**
 * App-owned keys that are DEVICE-scoped, not tenant-scoped, and therefore
 * deliberately survive a tenant switch. Every addition here is a decision to
 * leave something behind for the next user, so each one carries its reason.
 */
export const DEVICE_SCOPED_KEYS: readonly string[] = [
  // Light/dark preference (contexts/ThemeContext.tsx). A display setting for the
  // device; holds no tenant data. Wiping it would just re-flash the wrong theme
  // at the next person.
  'mageid_theme',
  // Anonymous analytics id (utils/posthog.ts). Owned by resetAnalyticsUser(),
  // which ROTATES it to a fresh UUID on sign-out (app/_layout.tsx:357).
  // Rotation is what unlinks the two identities; deleting the key here would
  // race that rotation for no extra privacy.
  'mage_analytics_distinct_id',
];

/**
 * Pending WRITES that cannot be re-fetched from anywhere — the one class of
 * local data that is not a cache. Dropped on a deliberate sign-out / fresh
 * sign-in, kept on a same-user re-auth (magic link, password reset) so
 * un-synced field work and un-uploaded jobsite photos survive.
 */
export const OFFLINE_WRITE_QUEUE_KEYS: readonly string[] = [
  'mageid_offline_queue',
  'mageid_photo_upload_queue',
];

/** True if `key` is one this app wrote (under any current or legacy prefix). */
export function isAppStorageKey(key: string): boolean {
  return APP_STORAGE_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Given every key present in local storage, return the subset to remove on a
 * tenant switch: every app-owned key that is not explicitly device-scoped.
 *
 * Prefix-driven on purpose. The recurring failure this replaces was a
 * hand-maintained list — a new `mageid_*` key would ship, nobody would add it,
 * and it would survive logout. Under this function a new key is covered the
 * moment it is written; the only way to exempt one is to add it to
 * DEVICE_SCOPED_KEYS above, in the open, with a reason.
 *
 * KNOWN COST, accepted deliberately. A handful of the keys this now removes are
 * local-ONLY work products with no Supabase mirror — `mageid_material_cart`,
 * `mageid_scope_sheets`, `mageid_takeoff::*`, `mageid_managed_properties`. They
 * used to survive sign-out because nobody had listed them; they no longer do.
 * That is the right call at this call site and not a judgement we can defer:
 * AuthContext's own comment on onNewSessionEstablished spells out that it
 * CANNOT tell a same-user re-auth from a different user signing in on a shared
 * device. Keeping un-mirrored work would therefore mean keeping user-A's
 * material cart and takeoffs through a possible user-B sign-in — the exact leak
 * this file exists to close. If those collections should instead survive a
 * confirmed same-user re-auth, the fix is to give them a Supabase mirror (so
 * they rehydrate) or to widen the OFFLINE_WRITE_QUEUE_KEYS exemption — both are
 * product decisions, not something to smuggle in as a keep-list.
 */
export function selectTenantKeysToWipe(
  allKeys: readonly string[],
  opts?: { dropOfflineQueue?: boolean },
): string[] {
  const dropOfflineQueue = opts?.dropOfflineQueue ?? true;
  const keep = new Set<string>(DEVICE_SCOPED_KEYS);
  if (!dropOfflineQueue) for (const k of OFFLINE_WRITE_QUEUE_KEYS) keep.add(k);
  return allKeys.filter((k) => isAppStorageKey(k) && !keep.has(k));
}
