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
  // The record of writes that will NEVER be sent (utils/syncLedger.ts) — the
  // only trace left of work the queue has already discarded, and the sole
  // reason the sync pill is allowed to say "2 didn't sync" instead of going
  // quiet. It belongs in THIS list, not merely under the prefix sweep, for one
  // reason: the sweep runs on every sign-in, and a same-user re-auth (the magic
  // link the exemption below was written for) would otherwise destroy the
  // notice about the exact work the queues beside it are being preserved for —
  // silently, with nothing telling the user the warning is gone.
  //
  // Keeping it is safe across tenants because every entry is tagged with its
  // owning user and read back through syncLedger.ownFailures, which — unlike
  // the write queues — has NO last-user-marker fallback: an entry that is not
  // this session's, tag included, is invisible. A deliberate sign-out still
  // drops it with the queues (dropOfflineQueue defaults to true).
  'mageid_sync_failures',
  // A dictation that has not transcribed yet exists NOWHERE else — the words
  // were never typed and the audio lives only in this queue. It is the same
  // class as an un-uploaded photo, and it is the exact data loss
  // utils/audioTranscribeQueue.ts was built to stop: a super dictates 90
  // seconds in a basement, the magic link he taps to get back in counts as a
  // re-auth, and the prefix sweep takes the recording with it.
  'mageid_audio_transcribe_queue',
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
 * `mageid_scope_sheets`, `mageid_takeoff::*`. They
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
 *
 * `mageid_last_planner` (constraints, weekly commitments with kept/missed and
 * variance reasons — the whole PPC history — and crew-dispatch receipts) was in
 * this class too and was not named here, which is why nobody noticed a logout
 * erased a contractor's reliability record. It now has the mirror the paragraph
 * above calls for: hooks/useLastPlanner.ts upserts every change to the
 * last_planner_* tables and rehydrates the store from them for every reader
 * (the Last Planner screen, the Friday Close card, Ask), so the sweep removes a
 * cache, not the record. The tables are live in production (applied
 * 2026-09-16).
 *
 * The Property Manager portfolio (`mageid_managed_properties::<userId>`,
 * `mageid_work_orders::<userId>`; v1 used the bare keys) was in this class too
 * and was named above until audit round 2 (#20): a PM's buildings and every
 * open repair vanished on his first sign-out. contexts/PropertyContext.tsx now
 * upserts every change to public.managed_properties / public.work_orders
 * through the offline queue and merges the server copy back on every sign-in
 * (utils/propertyMirror.mergeMirror), so the sweep removes a cache. Only once
 * supabase/migrations/20260918180000_property_manager_mirror.sql is applied.
 *
 * `mageid_schedule_audit::<projectId>` (the schedule change history — who
 * moved which date, when, and under which change order) was in this class as
 * well, and it matters more than most: delay_events.evidence stores POINTERS
 * into it, and a delay claim is argued months later from exactly that record.
 * utils/scheduleAudit.appendAuditToAsyncStorage now upserts every entry to
 * public.schedule_audit_log, and loadScheduleAudit merges the server copy back
 * in (entries still waiting in the offline queue are kept), so the sweep here
 * removes a cache. Same caveat: only once
 * supabase/migrations/20260917100000_schedule_audit_log.sql is applied. The
 * server copy is owner-only — a collaborator's entries live under the
 * collaborator's account.
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
