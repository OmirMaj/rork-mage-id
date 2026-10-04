// utils/codeCard/store.ts — the tiny persisted store behind pins.ts and
// saved.ts: a pure reducer, a JSON parser, and a thin storage adapter.
//
// Device-local in v1 (no migration, no cloud row). The keys live under the
// `mageid_` prefix so the tenant wipe in contexts/AuthContext.tsx sweeps them
// on a sign-out (utils/localCacheKeys.ts; bun run test:storage-hygiene).
//
// AsyncStorage is required LAZILY, inside `defaultStorage()`, so bun can
// import pins.ts / saved.ts and scripts/validate-code-cards.ts can drive the
// whole store against an in-memory double.

export interface KVStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function defaultStorage(): KVStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage') as { default?: KVStorage } & KVStorage;
    return (mod.default ?? mod) as KVStorage;
  } catch {
    return null;
  }
}

export interface PersistedStore<S, A> {
  getState(): S;
  subscribe(cb: () => void): () => void;
  dispatch(action: A): void;
  /** Reads storage once. Safe to call many times; resolves when loaded. */
  load(): Promise<void>;
  /** True once storage has answered (or failed). */
  isLoaded(): boolean;
}

/**
 * A store whose writes made BEFORE storage answered are kept: on load the
 * saved state is read and every pending action is replayed on top of it, so
 * a pin tapped during app start is never lost to the load.
 */
export function createPersistedStore<S, A>(opts: {
  key: string;
  initial: S;
  reducer: (state: S, action: A) => S;
  parse: (raw: string | null) => S;
  storage?: KVStorage | null;
}): PersistedStore<S, A> {
  let state = opts.initial;
  let loaded = false;
  let loading: Promise<void> | null = null;
  const pending: A[] = [];
  const listeners = new Set<() => void>();
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;

  const emit = () => { for (const fn of listeners) fn(); };
  const persist = () => {
    if (!storage) return;
    storage.setItem(opts.key, JSON.stringify(state)).catch(() => { /* next write retries */ });
  };

  const load = (): Promise<void> => {
    if (loading) return loading;
    if (!storage) {
      loaded = true;
      loading = Promise.resolve();
      return loading;
    }
    loading = storage
      .getItem(opts.key)
      .then((raw) => opts.parse(raw))
      .catch(() => opts.initial)
      .then((saved) => {
        const replay = pending.splice(0);
        state = replay.reduce(opts.reducer, saved);
        loaded = true;
        if (replay.length) persist();
        emit();
      });
    return loading;
  };

  return {
    getState: () => state,
    subscribe(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    dispatch(action) {
      const next = opts.reducer(state, action);
      if (!loaded) pending.push(action);
      if (next === state) return;
      state = next;
      if (loaded) persist();
      emit();
    },
    load,
    isLoaded: () => loaded,
  };
}

/** JSON.parse that never throws. */
export function safeJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
