// utils/queryPersist.ts — the pure core of "Instant Open" (IDEAS-1 · SPEED S1).
//
// What it is: the rules for keeping a copy of SOME of the React Query cache on
// the device, so the next launch can show it at once and refresh it in the
// background. components/QueryCachePersist.tsx does the I/O; everything that
// decides anything lives here so scripts/validate-query-persist.ts can prove it
// without React.
//
// The tenant rules, in one place:
//   • one blob, under PERSIST_KEY (a `mageid_*` key, so the sign-out sweep in
//     contexts/AuthContext.tsx wipeLocalUserCache removes it with everything
//     else — utils/localCacheKeys.ts APP_STORAGE_PREFIXES);
//   • the blob carries the userId it was written for, and is restored ONLY for
//     that userId (decideRestore); a blob for anyone else is dropped and deleted;
//   • a query is written only when its key's user segment (queryKey[1]) IS the
//     signed-in user — a key with no user segment can't be proven to belong to
//     one account, so it is never written, whatever the allow-list says.
//
// No React, no React Native, no Expo import: bun runs this file directly.

/** Under the `mageid_` prefix on purpose: the sign-out sweep removes it. */
export const PERSIST_KEY = 'mageid_query_cache_v1';
/** Bump when the blob's own shape changes. Part of the buster. */
export const PERSIST_SCHEMA = 1;
/** A copy older than this is not shown — a week-old job list is not "the last screen". */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Over the cap, NOTHING is written for that write and the old blob is removed —
 * never a partial blob. Web: AsyncStorage IS window.localStorage, ~5 MB per
 * origin shared with Supabase's own session token, so the web cap is small.
 */
export const SIZE_CAP_BYTES = { web: 750_000, native: 3_000_000 } as const;
/** At most one write per this many ms (plus one on background / pagehide). */
export const WRITE_THROTTLE_MS = 1000;

/**
 * The query-key roots that may be written. Each one passed the S1.4 analysis:
 * (a) what the owner does with the data, (b) nothing treats a restored copy as
 * a server read, (c) nothing can write a restored copy back to the server,
 * (d) no signed URLs, tokens or large blobs.
 *
 *  stripeConnectStatus — Home's Stripe checklist row + banner
 *    (app/(tabs)/(home)/index.tsx `queryKey: ['stripeConnectStatus', user?.id]`).
 *    (a) read into `stripeConnected` for a label and a banner only; (b) no gate
 *    reads it — invoice send asks connect-status itself (utils/stripeConnect
 *    #36); (c) no effect writes it anywhere; (d) `{ status }` only. A restored
 *    copy is marked invalid on restore, so it refetches the moment Home mounts.
 */
export const PERSIST_ALLOW: readonly string[] = ['stripeConnectStatus'];

/**
 * Roots deliberately NOT written, with the reason. The validator checks that no
 * root is in both lists. Anything in neither list is also not written (the
 * allow-list is the only door); this list exists so the reasons are on record.
 */
export const PERSIST_EXCLUDED: Readonly<Record<string, string>> = {
  projects:
    'ProjectContext: (a) the hydration effect runs planProjectsLoad over `data` and, before the first hydrate, ' +
    'withDeviceCopies keeps the IN-MEMORY row for every pending id; a restored copy is a throttled mirror that ' +
    'can lag the device copy (mageid_projects) by one write, so a queued edit could be replaced in memory by the ' +
    'older row and saved back (c). The device-copy branch of the queryFn also runs seedServerProjectIds and ' +
    'notePortalRead(false), which a restore skips. Deferred: use the device copy as placeholder data inside ProjectContext.',
  settings:
    'ProjectContext: settingsDataSeqRef keys commits by the object the queryFn returned; a restored object has no ' +
    'tag and is never committed, and settingsBootLoading gates boot on a first server read (a/b).',
  onboarding:
    'ProjectContext: drives the root redirect (hasSeenOnboarding); a restored `false` sends a finished user to onboarding (b).',
  user_role:
    'ProjectContext: drives the persona redirect; a stale role routes to the wrong home (b).',
  changeOrders: 'ProjectContext child list: notePortalRead + queued-write pins, same lag hazard as projects (b/c).',
  invoices: 'ProjectContext child list: money; notePortalRead + queued-write pins (b/c).',
  dailyReports: 'ProjectContext child list: notePortalRead + queued-write pins (b/c).',
  punchItems: 'ProjectContext child list: notePortalRead + queued-write pins (b/c).',
  projectPhotos: 'ProjectContext child list: photo rows carry storage URLs (d) and notePortalRead (b).',
  rfis: 'ProjectContext child list: notePortalRead + queued-write pins (b/c).',
  permits: 'ProjectContext child list: notePortalRead (b).',
  aiaPayApps: 'ProjectContext child list: money; notePortalRead (b).',
  subPortalLinks: 'ProjectContext: portal links carry access tokens (d).',
  public_bids: 'BidsContext: no user segment in the key (shared feed) and its own mageid_public_bids device copy — nothing to gain.',
  companies: 'CompaniesContext: no user segment in the key and its own mageid_companies device copy — nothing to gain.',
  jobs: 'HireContext: gated off (HIRE_ENABLED false) and no user segment.',
  workers: 'HireContext: gated off and no user segment.',
  conversations: 'HireContext: gated off and no user segment.',
  messages: 'HireContext: gated off and no user segment.',
  'smart-proposals': 'Already backed by its own AsyncStorage copy — nothing to gain.',
  backcharges: 'New in the HEALTH lane; money rows with the same queued-write pins as the ProjectContext lists (b/c). Not analysed as safe.',
  notificationFeed:
    'The payload column is server-authored JSON from many producers; it cannot be proven free of links or tokens (d).',
  'subscription-supabase': 'Tier gating: a restored tier would be read as the server\'s answer (b). SubscriptionContext has its own caches.',
  'rc-customer-info': 'RevenueCat entitlements: tier gating (b); no user segment.',
  accountSeats: 'Seat counts gate invites and billing (b).',
  'pending-invites': 'Invite rows lead to accept actions; a revoked invite would look live (b/c).',
  weekClosePaymentForecast: 'A money forecast derived from invoices; a stale figure shown as current breaks the money-honesty rule (b).',
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** The part of a react-query Query that shouldPersist reads. */
export interface PersistableQueryLike {
  queryKey: readonly unknown[];
  state: { status: string };
  meta?: Record<string, unknown> | undefined;
}

/** A dehydrated react-query state, as far as this module needs to know. */
export interface DehydratedLike {
  mutations?: unknown[];
  queries: { queryKey: readonly unknown[]; queryHash: string; state: unknown; [k: string]: unknown }[];
}

export interface PersistBlob {
  v: number;
  buster: string;
  userId: string;
  savedAt: number;
  state: DehydratedLike;
}

export type RestoreDecision =
  | 'restore'
  | 'drop:empty'
  | 'drop:unparseable'
  | 'drop:wrong-user'
  | 'drop:expired'
  | 'drop:buster';

export type PersistPlatform = 'web' | 'native';

// ── Rules ─────────────────────────────────────────────────────────────────────

/** "1.0.0" → "1.0.0|s1". The app version comes from the caller (expo-constants). */
export function makeBuster(appVersion: string | null | undefined): string {
  return `${appVersion ?? 'unknown'}|s${PERSIST_SCHEMA}`;
}

/**
 * May this query be written to the device for `userId`?
 * Only a successful query, whose key root is allow-listed, whose user segment
 * (queryKey[1]) is exactly the signed-in user, and that has not opted out.
 */
export function shouldPersist(query: PersistableQueryLike, userId: string | null): boolean {
  if (!userId) return false;
  if (query.state.status !== 'success') return false;
  const key = query.queryKey;
  if (!Array.isArray(key) || key.length < 2) return false;
  const root = key[0];
  if (typeof root !== 'string' || !PERSIST_ALLOW.includes(root)) return false;
  if (key[1] !== userId) return false;
  if (query.meta?.noPersist) return false;
  return true;
}

export function buildBlob(userId: string, state: DehydratedLike, now: number, buster: string): PersistBlob {
  // Mutations are never written: a pending write lives in utils/offlineQueue,
  // which owns replay. Only the queries that passed shouldPersist are here.
  return { v: PERSIST_SCHEMA, buster, userId, savedAt: now, state: { mutations: [], queries: state.queries } };
}

/** UTF-8 byte length without TextEncoder (not guaranteed on every Hermes build). */
export function utf8Bytes(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

export type SerializeResult =
  | { ok: true; json: string; bytes: number }
  | { ok: false; reason: 'over-cap' | 'empty'; bytes: number };

/**
 * The write decision. Empty (no persistable query) and over the cap both mean
 * "write nothing and remove the old blob" — the caller never writes a partial one.
 */
export function serializeBlob(blob: PersistBlob, platform: PersistPlatform): SerializeResult {
  if (blob.state.queries.length === 0) return { ok: false, reason: 'empty', bytes: 0 };
  const json = JSON.stringify(blob);
  const bytes = utf8Bytes(json);
  if (bytes > SIZE_CAP_BYTES[platform]) return { ok: false, reason: 'over-cap', bytes };
  return { ok: true, json, bytes };
}

/** Parse without throwing; anything that is not a well-formed blob is null. */
export function parseBlob(raw: string | null | undefined): PersistBlob | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const b = parsed as Partial<PersistBlob>;
  if (typeof b.v !== 'number' || typeof b.buster !== 'string' || typeof b.userId !== 'string'
    || typeof b.savedAt !== 'number' || !b.state || typeof b.state !== 'object'
    || !Array.isArray((b.state as DehydratedLike).queries)) return null;
  return b as PersistBlob;
}

/**
 * Restore or drop. Every drop except 'drop:empty' means the caller deletes the
 * key: a blob for another account, an expired one, one from another build, or
 * garbage is never read again.
 */
export function decideRestore(raw: string | null | undefined, userId: string | null, now: number, buster: string): RestoreDecision {
  if (raw === null || raw === undefined || raw === '') return 'drop:empty';
  const blob = parseBlob(raw);
  if (!blob || blob.v !== PERSIST_SCHEMA) return 'drop:unparseable';
  if (!userId || blob.userId !== userId) return 'drop:wrong-user';
  if (blob.buster !== buster) return 'drop:buster';
  if (!(now - blob.savedAt >= 0 && now - blob.savedAt <= MAX_AGE_MS)) return 'drop:expired';
  return 'restore';
}

/**
 * The queries of a restorable blob that may be hydrated now: re-checked against
 * the allow-list and the user (a blob from an older build of the rules must not
 * smuggle a key the current rules exclude), and only those NOT already in the
 * cache — a restore never overwrites a live query.
 */
export function restorableQueries(
  blob: PersistBlob,
  userId: string,
  isInCache: (queryHash: string) => boolean,
): DehydratedLike['queries'] {
  return blob.state.queries.filter((q) => {
    const st = q.state as { status?: unknown } | null;
    const status = st && typeof st.status === 'string' ? st.status : '';
    return shouldPersist({ queryKey: q.queryKey, state: { status } }, userId)
      && typeof q.queryHash === 'string'
      && !isInCache(q.queryHash);
  });
}

/**
 * A cheap fingerprint of what would be written: each query's hash and the time
 * its data last changed. Equal fingerprints mean the device already holds this.
 * '' when nothing is persistable.
 */
export function persistSignature(state: DehydratedLike): string {
  return state.queries
    .map((q) => {
      const st = q.state as { dataUpdatedAt?: unknown } | null;
      return `${q.queryHash}@${st && typeof st.dataUpdatedAt === 'number' ? st.dataUpdatedAt : 0}`;
    })
    .join('|');
}
