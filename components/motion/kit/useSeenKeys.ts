// useSeenKeys — the keys a host has already shown, so a row or a turn that
// appeared once never animates again (a filter flipped back and forth, a
// recalled thread, a remount of the dock).
//
// The Set lives in a ref. Pass the HOST's own ref (`store`) when the part can
// remount while the host stays (the Ask dock): the part then re-reads the
// host's Set. Never module state — two screens must not share what they saw.

import { useRef, type MutableRefObject } from 'react';

export type SeenKeys = {
  has(key: string): boolean;
  /** Record keys as seen (call after the commit that showed them). */
  mark(keys: Iterable<string>): void;
  readonly size: number;
};

export function useSeenKeys(store?: MutableRefObject<Set<string> | null>): SeenKeys {
  const own = useRef<Set<string> | null>(null);
  const ref = store ?? own;
  if (!ref.current) ref.current = new Set<string>();
  const set = ref.current;
  const api = useRef<SeenKeys | null>(null);
  if (!api.current || (api.current as unknown as { set: Set<string> }).set !== set) {
    const a = {
      set,
      has: (key: string) => set.has(key),
      mark: (keys: Iterable<string>) => { for (const k of keys) set.add(k); },
      get size() { return set.size; },
    };
    api.current = a;
  }
  return api.current;
}
