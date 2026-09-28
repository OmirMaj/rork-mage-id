// components/QueryCachePersist.tsx — keeps the allow-listed part of the React
// Query cache on the device and puts it back at the next launch (IDEAS-1 ·
// SPEED S1). Mounted by app/_layout.tsx directly inside <AuthProvider> (handoff
// patch SPEED-1); until that patch lands this component is not in the tree and
// nothing is persisted.
//
// The rules live in utils/queryPersist.ts; this file only does the I/O and the
// timing. The timing is the whole point, so here it is in order:
//
//  1. The storage read starts at MOUNT, not when the user is known. Reading
//     early leaks nothing: the blob carries its userId and decideRestore only
//     ever runs against a resolved user.
//  2. NO hold (integration round 2): children render at once, on the first
//     render, every render. A first-mount hold (≤ 150 ms) used to wait for the
//     read; it held the whole provider subtree back for a render and bought
//     nothing while PERSIST_ALLOW holds only a key no first-screen provider
//     reads ('stripeConnectStatus'). The component never returns null, so a
//     sign-in, sign-out or account switch can never remount the navigator.
//     Bring a hold back only with an allow-listed key a first-screen provider
//     reads — and re-run the goldens that mount the real _layout.
//  3. Restore at most ONCE per launch, in the FIRST render where
//     useAuth().isLoading is false. Signed out then → no restore this launch.
//     Signed in as A and A's blob already read → hydrate SYNCHRONOUSLY in this
//     render (the way react-query's own HydrationBoundary hydrates brand-new
//     queries), before the children render with user A — so a provider's first
//     render with A finds its query already in the cache. Only queries NOT in
//     the cache are hydrated, and each is marked invalid so it refetches as
//     soon as something reads it. Read not settled by then → no restore (the
//     read starts at mount, before AuthProvider's own session read — a
//     parent's effects run after its children's — so it normally has).
//  4. Persisting: every cache event schedules ONE write (throttled to one per
//     WRITE_THROTTLE_MS), plus an immediate write on background / pagehide.
//     Every write captures the user and a generation; a user change or unmount
//     bumps the generation and cancels the timer, a stale write is dropped, no
//     write happens with no user, and a write that finishes after the
//     generation moved deletes what it wrote. When the user leaves (null or a
//     different account) the blob is deleted.
import React, { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { dehydrate, hydrate, type QueryClient, type DehydratedState } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  PERSIST_KEY, WRITE_THROTTLE_MS,
  shouldPersist, buildBlob, serializeBlob, decideRestore, parseBlob, restorableQueries, makeBuster, persistSignature,
  type DehydratedLike,
} from '@/utils/queryPersist';
import { noteRestoredFromDevice } from '@/utils/startupTiming';

function appVersion(): string | null {
  try {
    return Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? null;
  } catch {
    return null;
  }
}

const PLATFORM: 'web' | 'native' = Platform.OS === 'web' ? 'web' : 'native';

async function removeBlob(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PERSIST_KEY);
  } catch (err) {
    console.log('[QueryCachePersist] removing the saved cache failed:', err);
  }
}

export default function QueryCachePersist({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const userId = user?.id ?? null;
  const buster = useRef(makeBuster(appVersion())).current;

  // ── 1. Read at mount ───────────────────────────────────────────────────────
  // A ref, not state: nothing re-renders when the read lands — the restore
  // reads it in the first render where auth has resolved.
  const blobRef = useRef<{ settled: boolean; raw: string | null }>({ settled: false, raw: null });
  useEffect(() => {
    const settle = (raw: string | null) => { blobRef.current = { settled: true, raw }; };
    (async () => {
      try {
        settle((await AsyncStorage.getItem(PERSIST_KEY)) ?? null);
      } catch (err) {
        console.log('[QueryCachePersist] reading the saved cache failed:', err);
        settle(null);
      }
    })();
  }, []);

  // ── 3. Restore once, on the first resolved auth state ──────────────────────
  const restoreDecidedRef = useRef(false);
  const dropOwedRef = useRef(false);
  if (!isLoading && !restoreDecidedRef.current) {
    restoreDecidedRef.current = true;
    if (userId && blobRef.current.settled && blobRef.current.raw) {
      const decision = decideRestore(blobRef.current.raw, userId, Date.now(), buster);
      if (decision === 'restore') {
        const blob = parseBlob(blobRef.current.raw);
        const cache = client.getQueryCache();
        const queries = blob ? restorableQueries(blob, userId, (hash) => cache.get(hash) !== undefined) : [];
        if (queries.length > 0) {
          const state: DehydratedLike = { mutations: [], queries };
          hydrate(client, state as unknown as DehydratedState);
          for (const q of queries) {
            // Refetch on first read: a restored copy is shown, never trusted as fresh.
            void client.invalidateQueries({ queryKey: [...q.queryKey], exact: true, refetchType: 'none' });
          }
          noteRestoredFromDevice(queries.length);
        }
      } else if (decision !== 'drop:empty') {
        dropOwedRef.current = true;
      }
    }
  }
  useEffect(() => {
    if (!dropOwedRef.current) return;
    dropOwedRef.current = false;
    void removeBlob();
  });

  // ── 4. Persist ─────────────────────────────────────────────────────────────
  const userRef = useRef<string | null>(userId);
  const generationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWriteRef = useRef(0);
  // What the device holds now, as a signature of (query, dataUpdatedAt) pairs:
  // '' = nothing, null = unknown. A cache event that changes nothing
  // persistable costs no storage call.
  const lastSigRef = useRef<string | null>(null);
  const prevUserRef = useRef<string | null>(userId);

  // A user change bumps the generation, cancels the pending write and deletes
  // the previous account's blob. Runs before the subscription effect below.
  useEffect(() => {
    const prev = prevUserRef.current;
    prevUserRef.current = userId;
    userRef.current = userId;
    if (prev !== userId) {
      generationRef.current += 1;
      lastSigRef.current = null;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (prev !== null) void removeBlob();
    }
  }, [userId]);

  useEffect(() => {
    const writeNow = async (gen: number, uid: string | null): Promise<void> => {
      // Generation and user are checked before every storage call.
      if (gen !== generationRef.current || !uid || userRef.current !== uid) return;
      const dehydrated = dehydrate(client, {
        shouldDehydrateQuery: (q) => shouldPersist(q, uid),
      }) as unknown as DehydratedLike;
      const sig = persistSignature(dehydrated);
      if (sig === lastSigRef.current) return;
      const result = serializeBlob(buildBlob(uid, dehydrated, Date.now(), buster), PLATFORM);
      if (gen !== generationRef.current || userRef.current !== uid) return;
      if (!result.ok) {
        // Empty or over the cap: nothing partial is ever written; the old blob goes.
        lastSigRef.current = '';
        await removeBlob();
        return;
      }
      try {
        await AsyncStorage.setItem(PERSIST_KEY, result.json);
      } catch (err) {
        console.log('[QueryCachePersist] saving the cache failed:', err);
        return;
      }
      lastSigRef.current = sig;
      lastWriteRef.current = Date.now();
      // The account changed while the write was on its way: take it back.
      if (gen !== generationRef.current || userRef.current !== uid) await removeBlob();
    };

    const schedule = () => {
      const uid = userRef.current;
      if (!uid || timerRef.current) return;
      const gen = generationRef.current;
      const wait = Math.max(0, WRITE_THROTTLE_MS - (Date.now() - lastWriteRef.current));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void writeNow(gen, uid);
      }, wait);
    };

    const flush = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      void writeNow(generationRef.current, userRef.current);
    };

    const unsubscribe = client.getQueryCache().subscribe(() => schedule());
    const appSub = AppState.addEventListener('change', (s) => { if (s === 'background') flush(); });
    const onPageHide = () => flush();
    const hasWindow = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function';
    if (hasWindow) window.addEventListener('pagehide', onPageHide);

    return () => {
      // Unmount: nothing scheduled may land afterwards.
      generationRef.current += 1;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      unsubscribe();
      appSub.remove();
      if (hasWindow) window.removeEventListener('pagehide', onPageHide);
    };
  }, [client, buster]);

  // ── 2. No hold: the children render at once, always ───────────────────────
  return <>{children}</>;
}
