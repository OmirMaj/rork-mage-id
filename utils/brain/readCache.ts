// utils/brain/readCache.ts
//
// Tiny TTL + in-flight-dedupe cache for read-only Supabase queries.
//
// WHY: utils/brain/predictionLedger.ts issued raw `supabase.from(...)` selects
// with no caching and no dedupe, and five unrelated call sites hit them
// independently on the same page load. Production measured
// `brain_predictions?select=*&limit=200` firing 6x per load, 3 of them
// byte-identical — concurrent, so a plain TTL cache alone would not have
// collapsed them (all six start before any of them resolves). The in-flight
// map is the half that fixes the concurrent case; the TTL fixes the
// staggered/remount case.
//
// clear() (write / auth change) drops BOTH the fresh cache AND the in-flight
// map and bumps a generation counter. Dropping the in-flight map is a tenant-
// isolation requirement, not a nicety: brain_predictions is select('*') and
// RLS-scoped, so a reader arriving after an auth/tenant change must NOT be
// allowed to join a still-pending pre-change load and be handed the previous
// tenant's rows. See createAsyncCache for the identity+generation settle guard.
//
// No React, no Supabase, no RN — scripts/validate-brain-read-cache.ts runs it
// under bun and pins both halves.

export interface AsyncCacheOptions {
  /** How long a resolved value stays servable, in ms. */
  ttlMs: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export interface AsyncCache<T> {
  /**
   * Return the cached value for `key` if it is still fresh, join the in-flight
   * load if one is already running, or start `loader` and cache its result.
   */
  get(key: string, loader: () => Promise<T>): Promise<T>;
  /** Drop everything. Call after a write, or when the signed-in user changes. */
  clear(): void;
  /** Test/telemetry hook: how many times a loader has actually been invoked. */
  readonly loadCount: number;
}

export function createAsyncCache<T>(options: AsyncCacheOptions): AsyncCache<T> {
  const { ttlMs } = options;
  const now = options.now ?? (() => Date.now());

  const fresh = new Map<string, { value: T; at: number }>();
  // Each in-flight entry records the generation its load STARTED in, so a load
  // that began before a clear() can neither cache its stale result nor evict a
  // newer load that now owns the same key. The stored promise is used for an
  // identity check on settle (see below).
  const inFlight = new Map<string, { promise: Promise<T>; startedAt: number }>();
  let loadCount = 0;
  /** Bumped by clear(). A load that started in an older generation must not
   *  write its (now stale) result back into `fresh`, and clear() drops the
   *  whole in-flight map so a reader arriving AFTER clear() cannot join a
   *  still-pending PRE-clear load and be handed pre-clear (e.g. cross-tenant)
   *  rows — it starts a fresh load instead. */
  let generation = 0;

  return {
    get loadCount() { return loadCount; },

    clear() {
      fresh.clear();
      // Drop the in-flight map too. A pre-clear load's callers still hold their
      // own promise and it still settles for them, but it is no longer JOINABLE:
      // a get() after clear() finds no entry and starts a fresh load. This is
      // what closes the cross-tenant window — a post-auth-change reader can
      // never be served rows that a pre-auth-change load is about to resolve.
      // The generation bump below makes any such orphaned load a no-op on settle.
      inFlight.clear();
      generation++;
    },

    get(key: string, loader: () => Promise<T>): Promise<T> {
      const hit = fresh.get(key);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);

      const running = inFlight.get(key);
      if (running) return running.promise;

      const startedAt = generation;
      loadCount++;
      // Only evict/write for our OWN entry and only if no clear() intervened:
      // identity check (is the map's entry still the one WE put there?) guards
      // against a stale load evicting a newer in-flight entry for the same key;
      // the generation check guards against caching stale rows.
      const settle = () => {
        const current = inFlight.get(key);
        if (current === entry) inFlight.delete(key);
      };
      const p = loader().then(
        value => {
          settle();
          if (generation === startedAt) fresh.set(key, { value, at: now() });
          return value;
        },
        err => {
          // Never cache a failure — the next caller retries.
          settle();
          throw err;
        },
      );
      const entry = { promise: p, startedAt };
      inFlight.set(key, entry);
      return p;
    },
  };
}
