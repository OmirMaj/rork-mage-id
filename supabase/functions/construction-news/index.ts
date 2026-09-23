// construction-news — the latest construction headlines from a curated set of
// publisher RSS/Atom feeds, merged into one list for app/construction-news.tsx.
//
// Founder request (2026-09-22): "a construction news place on the app that
// has all the latest up to date construction news happening."
//
// Shape of the answer:
//   { items: [{ id, title, link, source, publishedAt, summary, topic }],
//     sources: [{ name, ok, count, error? }],
//     fetchedAt }
//
// What it does, in order:
//   1. Requires a signed-in user. Deployed verify_jwt = true, so the gateway
//      checks the JWT signature — but the public anon key is itself a valid
//      JWT, so verifyUser() (GoTrue /auth/v1/user) is what keeps this from
//      being an open feed-fetching proxy for anyone holding the anon key.
//   2. Serves the merged result from this isolate's memory for 15 minutes.
//      Every user sees the same news, so there is no reason for each app open
//      to hit nine publishers.
//   3. Otherwise fetches every feed in core.ts FEED_SOURCES IN PARALLEL, each
//      with its own 6 s timeout, and merges them (core.ts mergeFeeds). One slow
//      or dead publisher costs its own slot and is named in sources[]; the rest
//      still return.
//   4. When EVERY feed fails, answers 502 with a plain reason — unless an
//      older merged copy is still in memory, which is returned as-is with its
//      own fetchedAt (the client then says "Updated 40 min ago" truthfully).
//
// Never fetches article pages — only the feeds publishers offer for syndication.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { verifyUser } from '../_shared/verifyUser.ts';
import { FEED_SOURCES, mergeFeeds, parseFeed, type FeedResult, type FeedSource, type NewsPayload } from './core.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const FEED_TIMEOUT_MS = 6_000;
/** A feed larger than this is not a news feed (or is an error page gone
 *  wrong). Construction Dive's biggest topic feed is ~480 KB. */
const MAX_FEED_BYTES = 3 * 1024 * 1024;
// The Mozilla/5.0 (compatible; …) form is the standard crawler shape: OSHA's
// edge answers 403 to a UA without it (checked 2026-09-22), and it still
// names us and links who we are.
const USER_AGENT = 'Mozilla/5.0 (compatible; MAGE-ID-News/1.0; +https://mageid.app)';

let cache: { payload: NewsPayload; at: number } | null = null;
/** One refresh at a time per isolate: concurrent cold requests share it. */
let inflight: Promise<NewsPayload | null> | null = null;

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

function cacheHeaders(at: number): Record<string, string> {
  const remaining = Math.max(0, Math.floor((at + CACHE_TTL_MS - Date.now()) / 1000));
  // private: the answer is behind a user JWT, so no shared cache may keep it.
  return { 'Cache-Control': `private, max-age=${remaining}` };
}

async function fetchFeed(source: FeedSource): Promise<FeedResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
      },
    });
    if (!res.ok) {
      await res.body?.cancel();
      return { source, items: null, error: `HTTP ${res.status}` };
    }
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_FEED_BYTES) {
      await res.body?.cancel();
      return { source, items: null, error: 'feed too large' };
    }
    const text = await res.text();
    if (text.length > MAX_FEED_BYTES) return { source, items: null, error: 'feed too large' };
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 4000))) {
      // A Cloudflare challenge or a moved-page HTML answer, not a feed.
      return { source, items: null, error: 'not a feed' };
    }
    return { source, items: parseFeed(text) };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return { source, items: null, error: aborted ? 'timed out' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(): Promise<NewsPayload | null> {
  const results = await Promise.all(FEED_SOURCES.map(fetchFeed));
  for (const r of results) {
    if (!r.items) console.warn(`[construction-news] ${r.source.id}: ${r.error}`);
  }
  if (results.every(r => r.items === null)) return null;
  return mergeFeeds(results, Date.now());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const user = await verifyUser(req);
    if (!user) return json({ error: 'unauthorized', message: 'Sign in to read the news.' }, 401);

    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return json(cache.payload, 200, cacheHeaders(cache.at));
    }

    if (!inflight) {
      inflight = refresh().finally(() => { inflight = null; });
    }
    const fresh = await inflight;
    if (fresh) {
      cache = { payload: fresh, at: Date.now() };
      return json(fresh, 200, cacheHeaders(cache.at));
    }

    if (cache) {
      // Every publisher failed this time; the older copy is still the truth
      // about what was published, and its fetchedAt says how old it is.
      return json(cache.payload, 200, { 'Cache-Control': 'private, max-age=60' });
    }
    return json({
      error: 'all_feeds_failed',
      message: "None of the news publishers answered just now. Try again in a few minutes.",
      sources: FEED_SOURCES.map(s => s.name).filter((n, i, a) => a.indexOf(n) === i),
    }, 502);
  } catch (err) {
    console.error('[construction-news] error:', err);
    return json({ error: 'internal', message: 'The news service hit an error. Try again in a few minutes.' }, 500);
  }
});
