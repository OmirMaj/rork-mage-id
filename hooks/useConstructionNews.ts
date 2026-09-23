// hooks/useConstructionNews.ts — the Construction News feed, with an offline
// copy.
//
// Network: react-query over the `construction-news` edge function. The server
// already caches for 15 minutes, so a 5-minute staleTime here only saves the
// round trip on a quick back-and-forth.
//
// Offline: the last good payload is kept in AsyncStorage (NEWS_CACHE_KEY, a
// mageid_ key) and read on mount, so the screen opens with the last news on a
// jobsite with no signal. When the live fetch fails and a saved copy exists,
// the screen shows the saved copy WITH a banner that says why and how old it
// is — never silently, as if it were live.
//
// Storage reads/writes are wrapped: on web in a private window, or with site
// data blocked, AsyncStorage throws, and the screen must still work online.

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isTransportError } from '@/utils/networkErrors';
import {
  NEWS_CACHE_KEY, coerceNewsPayload,
  type NewsPayload, type NewsStaleReason,
} from '@/utils/constructionNews';

export const CONSTRUCTION_NEWS_QUERY_KEY = ['construction-news'] as const;

/** A fetch failure with the reason already worded for the screen. */
export class NewsFetchError extends Error {
  readonly offline: boolean;
  constructor(message: string, offline: boolean) {
    super(message);
    this.name = 'NewsFetchError';
    this.offline = offline;
  }
}

/**
 * supabase-js wraps a dropped connection as FunctionsFetchError ("Failed to
 * send a request to the Edge Function"), which TRANSPORT_ERROR_RE does not
 * match — so check the wrapper's name and its `context` (the underlying
 * TypeError) as well as the error itself.
 */
export function isOfflineFailure(err: unknown): boolean {
  if (err instanceof NewsFetchError) return err.offline;
  const e = err as { name?: unknown; context?: unknown } | null;
  if (e && e.name === 'FunctionsFetchError') return true;
  return isTransportError(err) || (!!e && isTransportError(e.context));
}

async function readServerMessage(err: unknown): Promise<string | null> {
  // FunctionsHttpError carries the Response in `context`.
  const ctx = (err as { context?: unknown } | null)?.context as { json?: () => Promise<unknown> } | undefined;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try {
    const body = (await ctx.json()) as { message?: unknown } | null;
    return body && typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}

export async function fetchConstructionNews(): Promise<NewsPayload> {
  if (!isSupabaseConfigured) {
    throw new NewsFetchError("News isn't available in this build — the app has no server connection configured.", false);
  }
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new NewsFetchError('Sign in to read the news.', false);

  const { data, error } = await supabase.functions.invoke<unknown>('construction-news', { method: 'POST' });
  if (error) {
    if (isOfflineFailure(error)) {
      throw new NewsFetchError("You're offline, so the news couldn't load.", true);
    }
    const msg = await readServerMessage(error);
    throw new NewsFetchError(msg ?? "The news service didn't answer. Try again in a few minutes.", false);
  }
  const payload = coerceNewsPayload(data);
  if (!payload) throw new NewsFetchError('The news service sent something the app could not read.', false);
  return payload;
}

async function readSavedCopy(): Promise<NewsPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(NEWS_CACHE_KEY);
    return raw ? coerceNewsPayload(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function writeSavedCopy(payload: NewsPayload): Promise<void> {
  try {
    await AsyncStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Private window / blocked storage: the live copy still renders.
  }
}

export interface ConstructionNewsState {
  /** The payload to render: live when we have it, else the saved copy. */
  payload: NewsPayload | null;
  /** Set when the last live fetch failed and `payload` is an older copy (saved
   *  on this device, or the previous fetch this session). */
  staleReason: NewsStaleReason | null;
  /** The live fetch's failure, worded for the screen (null when fine). */
  errorMessage: string | null;
  /** True only while nothing at all is on screen yet. */
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

export function useConstructionNews(): ConstructionNewsState {
  const [saved, setSaved] = useState<NewsPayload | null>(null);
  const [savedChecked, setSavedChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    void readSavedCopy().then(p => {
      if (!alive) return;
      setSaved(p);
      setSavedChecked(true);
    });
    return () => { alive = false; };
  }, []);

  const query = useQuery({
    queryKey: CONSTRUCTION_NEWS_QUERY_KEY,
    queryFn: fetchConstructionNews,
    staleTime: 5 * 60_000,
    // Every failure fetchConstructionNews words itself (NewsFetchError) is
    // final: offline won't fix itself in a second, sign-in won't either, and
    // the server has already tried every publisher. One retry is kept only
    // for an unexpected throw (e.g. getSession failing mid-refresh).
    retry: (count, err) => count < 1 && !(err instanceof NewsFetchError) && !isOfflineFailure(err),
  });

  const live = query.data ?? null;

  useEffect(() => {
    if (!live) return;
    setSaved(live);
    void writeSavedCopy(live);
  }, [live]);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const failed = query.isError && !query.isFetching;
  // Prefer the live copy; fall back to the saved one only when this session
  // has no live copy. After a failed refresh react-query keeps the previous
  // live `data`, which is still the newest thing we have — and it gets the
  // same banner, because it is no longer current either.
  const payload = live ?? saved;
  const staleReason: NewsStaleReason | null = failed && payload
    ? (isOfflineFailure(query.error) ? 'offline' : 'refresh_failed')
    : null;

  return {
    payload,
    staleReason,
    errorMessage: failed ? (query.error instanceof Error ? query.error.message : 'The news could not load.') : null,
    isLoading: !payload && (query.isLoading || !savedChecked),
    isRefreshing: query.isRefetching,
    refresh,
  };
}
