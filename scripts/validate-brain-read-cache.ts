// scripts/validate-brain-read-cache.ts
// Run: bun scripts/validate-brain-read-cache.ts
//
// Pins utils/brain/readCache.ts — the dedupe+TTL layer that
// utils/brain/predictionLedger.ts wraps its two brain_predictions selects in.
//
// The bug: fetchOpenPredictions / fetchResolvedPredictions were raw
// `supabase.from('brain_predictions').select('*')` with no cache and no
// dedupe, called independently from useAutonomy, useBrainGrading,
// useMorningBrief, oneMind/factBlocks and profit-leak-history. Production
// measured 6 requests per page load, 3 byte-identical.
//
// The concurrent case is the one that matters and the one a naive TTL cache
// does NOT fix: all six calls start before any of them resolves, so every one
// of them misses a value-only cache. Test 1 is that case.

import { createAsyncCache } from '@/utils/brain/readCache';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
  else { console.log(`PASS: ${msg}`); }
}

/** Controllable clock so TTL expiry is deterministic, not wall-clock flaky. */
function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** A loader that never resolves until released — models an in-flight query. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function main() {
  // ── 1. Concurrent burst collapses to ONE load (the reported storm) ──────
  {
    const clock = makeClock();
    const cache = createAsyncCache<number[]>({ ttlMs: 30_000, now: clock.now });
    const d = deferred<number[]>();
    let calls = 0;
    const loader = () => { calls++; return d.promise; };

    // Six consumers, all starting before anything resolves — exactly the
    // production shape.
    const all = Promise.all(Array.from({ length: 6 }, () => cache.get('open|*|*', loader)));
    assert(calls === 1, `6 concurrent readers → 1 underlying query (saw ${calls})`);
    d.resolve([1, 2, 3]);
    const results = await all;
    assert(results.length === 6, 'all 6 readers resolve');
    assert(results.every(r => r[0] === 1 && r.length === 3), 'all 6 readers get the same rows');
  }

  // ── 2. A later reader inside the TTL does not re-query ──────────────────
  {
    const clock = makeClock();
    const cache = createAsyncCache<number[]>({ ttlMs: 30_000, now: clock.now });
    let calls = 0;
    const loader = async () => { calls++; return [7]; };

    await cache.get('k', loader);
    clock.advance(29_999);
    await cache.get('k', loader);
    assert(calls === 1, `read at t+29999ms inside a 30s TTL is served from cache (saw ${calls} loads)`);
  }

  // ── 3. Past the TTL it DOES re-query — this is a cache, not a freeze ────
  {
    const clock = makeClock();
    const cache = createAsyncCache<number[]>({ ttlMs: 30_000, now: clock.now });
    let calls = 0;
    const loader = async () => { calls++; return [calls]; };

    await cache.get('k', loader);
    clock.advance(30_001);
    const second = await cache.get('k', loader);
    assert(calls === 2, `read past the TTL re-queries (saw ${calls} loads)`);
    assert(second[0] === 2, 'the post-TTL read returns the FRESH value, not the stale one');
  }

  // ── 4. Different keys are not conflated ────────────────────────────────
  {
    const clock = makeClock();
    const cache = createAsyncCache<string[]>({ ttlMs: 30_000, now: clock.now });
    let calls = 0;
    const loader = (tag: string) => async () => { calls++; return [tag]; };

    const open = await cache.get('open|*|*', loader('open'));
    const resolved = await cache.get('resolved|*|*', loader('resolved'));
    assert(calls === 2, 'open and resolved queries do not share a cache slot');
    assert(open[0] === 'open' && resolved[0] === 'resolved', 'each key gets its own value');

    // …and the kind/project dimensions of the key matter too.
    await cache.get('resolved|leak_flag|*', loader('leak'));
    assert(calls === 3, 'a kind-filtered query is a distinct key');
    await cache.get('resolved|leak_flag|proj-1', loader('leak-proj'));
    assert(calls === 4, 'a project-scoped query is a distinct key');
  }

  // ── 5. clear() (write / auth change) forces the next read to be real ────
  {
    const clock = makeClock();
    const cache = createAsyncCache<number[]>({ ttlMs: 30_000, now: clock.now });
    let calls = 0;
    const loader = async () => { calls++; return [calls]; };

    await cache.get('k', loader);
    cache.clear();
    const after = await cache.get('k', loader);
    assert(calls === 2, 'clear() invalidates a still-within-TTL entry');
    assert(after[0] === 2, 'the post-clear read returns fresh rows');
  }

  // ── 6. A clear() racing an in-flight load must not resurrect stale data ─
  // recordPrediction/resolvePrediction (and an auth/tenant change) clear
  // synchronously. The DANGEROUS ordering — the one that leaks the previous
  // tenant's RLS-scoped rows — is: a load is in flight, clear() happens, and a
  // SECOND get is issued WHILE THE PRE-CLEAR LOAD IS STILL PENDING. If clear()
  // left the in-flight entry joinable, that second get would join the pre-clear
  // load and be handed pre-clear rows.
  //
  // The earlier version of this test resolved the deferred and AWAITED it before
  // the second get, so the pre-clear load had already settled and been evicted —
  // a guaranteed miss that never exercised the join window. This version issues
  // the second get with the pre-clear load STILL in flight, then resolves the
  // pre-clear load LAST, and asserts the second reader never saw its rows.
  {
    const clock = makeClock();
    const cache = createAsyncCache<string[]>({ ttlMs: 30_000, now: clock.now });
    const preClear = deferred<string[]>();
    let calls = 0;
    const slow = () => { calls++; return preClear.promise; };
    const fast = async () => { calls++; return ['post-clear']; };

    const inflight = cache.get('k', slow); // pre-clear load starts
    cache.clear();                         // write / auth change lands mid-flight
    const next = cache.get('k', fast);     // ← issued while pre-clear load STILL pending
    preClear.resolve(['pre-clear']);       // pre-clear load settles LAST

    assert((await inflight)[0] === 'pre-clear', 'the in-flight caller still gets its own result');
    assert((await next)[0] === 'post-clear', 'a get issued after clear() is NOT joined to the still-pending pre-clear load');
    assert(calls === 2, 'the post-clear get started a fresh load rather than joining the pre-clear one');
  }

  // ── 6b. A stale (pre-clear) load settling late must not evict the NEWER
  // in-flight entry that now owns the key ────────────────────────────────
  // With a naive inFlight.clear()+delete-on-settle, the stale load's .then would
  // delete the fresh entry, un-deduping every subsequent joiner. The settle path
  // must only evict its OWN entry (identity check).
  {
    const clock = makeClock();
    const cache = createAsyncCache<string[]>({ ttlMs: 30_000, now: clock.now });
    const staleD = deferred<string[]>();
    const freshD = deferred<string[]>();
    let calls = 0;
    const stale = () => { calls++; return staleD.promise; };
    const fresh = () => { calls++; return freshD.promise; };

    const a = cache.get('k', stale); // gen 0 load
    cache.clear();                   // gen -> 1, in-flight dropped
    const b = cache.get('k', fresh); // gen 1 load now owns 'k'
    staleD.resolve(['stale']);       // stale load settles — must NOT evict b's entry
    await a;
    // A joiner issued while b is still pending must JOIN b, not start a 3rd load.
    const c = cache.get('k', () => { calls++; throw new Error('must join b, not start a new load'); });
    freshD.resolve(['newest']);
    assert((await b)[0] === 'newest', 'the newer in-flight load resolves to its own value');
    assert((await c)[0] === 'newest', 'a joiner after the stale settle still joined the NEWER entry');
    assert(calls === 2, `stale settle did not evict the newer entry (saw ${calls} loads, expected 2)`);
  }

  // ── 7. Failures are never cached ───────────────────────────────────────
  {
    const clock = makeClock();
    const cache = createAsyncCache<number[]>({ ttlMs: 30_000, now: clock.now });
    let calls = 0;
    const loader = async () => {
      calls++;
      if (calls === 1) throw new Error('network down');
      return [42];
    };

    let threw = false;
    try { await cache.get('k', loader); } catch { threw = true; }
    assert(threw, 'a rejected load propagates to the caller');
    let retry: number[] | null = null;
    try { retry = await cache.get('k', loader); } catch { /* reported below */ }
    assert(calls === 2, `the next reader retries rather than being handed a cached failure (saw ${calls} loads)`);
    assert(retry?.[0] === 42, 'the retry returns real rows');
  }

  // ── 8. A rejected in-flight load does not wedge the key ────────────────
  {
    const clock = makeClock();
    const cache = createAsyncCache<number[]>({ ttlMs: 30_000, now: clock.now });
    const d = deferred<number[]>();
    let calls = 0;
    const failing = () => { calls++; return d.promise; };

    const a = cache.get('k', failing);
    const b = cache.get('k', failing);
    assert(calls === 1, 'concurrent readers share even a doomed load');
    d.reject(new Error('boom'));
    let aThrew = false, bThrew = false;
    try { await a; } catch { aThrew = true; }
    try { await b; } catch { bThrew = true; }
    assert(aThrew && bThrew, 'both joined readers see the rejection');
    let ok: number[] | null = null;
    try { ok = await cache.get('k', async () => { calls++; return [9]; }); } catch { /* reported below */ }
    assert(ok?.[0] === 9 && calls === 2, `the key is usable again after a rejection (saw ${calls} loads)`);
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nAll brain read-cache tests passed');
}

void main();
