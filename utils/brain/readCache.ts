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
  const inFlight = new Map<string, Promise<T>>();
  let loadCount = 0;
  /** Bumped by clear(); a load that started in an older generation must not
   *  write its (now stale) result back into `fresh`. */
  let generation = 0;

  return {
    get loadCount() { return loadCount; },

    clear() {
      fresh.clear();
      // Deliberately NOT clearing inFlight: an in-flight request has callers
      // awaiting it and must still settle. Its result is simply not written
      // back into `fresh` (see the generation check below), so a clear() that
      // races a load cannot resurrect pre-clear data.
      generation++;
    },

    get(key: string, loader: () => Promise<T>): Promise<T> {
      const hit = fresh.get(key);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);

      const running = inFlight.get(key);
      if (running) return running;

      const startedAt = generation;
      loadCount++;
      const p = loader().then(
        value => {
          inFlight.delete(key);
          // Only cache if no clear() happened while we were in flight.
          if (generation === startedAt) fresh.set(key, { value, at: now() });
          return value;
        },
        err => {
          // Never cache a failure — the next caller retries.
          inFlight.delete(key);
          throw err;
        },
      );
      inFlight.set(key, p);
      return p;
    },
  };
}
