// utils/placeLookup.ts — the one door to the `place-lookup` edge function, and
// its cache. The pure half (the query a project implies, the response parser,
// the cache key and freshness rule, the permit-office resolver) lives in
// utils/permitOffices.ts, which bun validators drive directly.
//
// Rules this file holds:
//   1. The function name is passed to functions.invoke as the STRING LITERAL
//      'place-lookup' — scripts/validate-edge-cors-headers.ts finds the
//      functions the app calls only by that literal.
//   2. Answers are cached on disk under mageid_place_<hash> (the key is a hash
//      of the address, not the address), so the tenant wipe's 'mageid_' prefix
//      sweep removes them on sign-out. A found place is kept 30 days, "no
//      match" one day, and an ERROR is never cached: "Census didn't answer"
//      must not stick as "Census found nothing".
//   3. Identical lookups in flight share one request.
//   4. A failure never surfaces raw error text; the caller just gets 'error'.

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import {
  cachedPlaceIsFresh,
  parseCachedPlace,
  parsePlaceLookupResponse,
  placeCacheKey,
  type CachedPlace,
  type PlaceLookupResult,
  type PlaceQuery,
} from '@/utils/permitOffices';

export type PlaceLookupOutcome = { ok: true; place: PlaceLookupResult } | { ok: false };

const memory = new Map<string, CachedPlace>();
const inFlight = new Map<string, Promise<PlaceLookupOutcome>>();

async function readDisk(key: string): Promise<CachedPlace | null> {
  try {
    return parseCachedPlace(await AsyncStorage.getItem(key));
  } catch {
    return null;
  }
}

async function writeDisk(key: string, entry: CachedPlace): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* a cache miss next time is the only cost */
  }
}

async function fetchPlace(q: PlaceQuery): Promise<PlaceLookupOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('place-lookup', {
      body: { address: q.address, lat: q.lat, lon: q.lon },
    });
    if (error || data == null) return { ok: false };
    const place = parsePlaceLookupResponse(data);
    return place ? { ok: true, place } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** The Census place for a jobsite: memory, then disk, then the edge function. */
export function placeLookup(q: PlaceQuery): Promise<PlaceLookupOutcome> {
  const key = placeCacheKey(q);
  const now = Date.now();
  const hot = memory.get(key);
  if (hot && cachedPlaceIsFresh(hot, now)) return Promise.resolve({ ok: true, place: hot.place });
  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = (async (): Promise<PlaceLookupOutcome> => {
    const disk = await readDisk(key);
    if (disk && cachedPlaceIsFresh(disk, Date.now())) {
      memory.set(key, disk);
      return { ok: true, place: disk.place };
    }
    const res = await fetchPlace(q);
    if (res.ok) {
      const entry: CachedPlace = { savedAt: Date.now(), place: res.place };
      memory.set(key, entry);
      await writeDisk(key, entry);
    }
    return res;
  })();
  inFlight.set(key, run);
  run.finally(() => inFlight.delete(key)).catch(() => { /* already an outcome */ });
  return run;
}

export interface PlaceLookupState {
  status: 'idle' | 'loading' | 'done' | 'error';
  place: PlaceLookupResult | null;
}

/**
 * The place for `q`, looked up once per distinct address. `q === null` (not a
 * NY/NJ/CT jobsite, or no address) stays 'idle' and never touches storage or
 * the network.
 */
export function usePlaceLookup(q: PlaceQuery | null): PlaceLookupState {
  const key = q ? placeCacheKey(q) : null;
  const [state, setState] = useState<PlaceLookupState & { key: string | null }>({ status: 'idle', place: null, key: null });

  useEffect(() => {
    if (!q || !key) return;
    let live = true;
    setState({ status: 'loading', place: null, key });
    placeLookup(q).then((res) => {
      if (!live) return;
      setState(res.ok ? { status: 'done', place: res.place, key } : { status: 'error', place: null, key });
    });
    return () => { live = false; };
    // The key is the identity of the query; q's object identity is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!q || state.key !== key) return { status: q ? 'loading' : 'idle', place: null };
  return { status: state.status, place: state.place };
}
