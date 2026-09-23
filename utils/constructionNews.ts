// utils/constructionNews.ts — the pure half of the Construction News screen:
// the wire types, the payload guard, relative time, the header and offline
// wording, and topic chips.
//
// No React, no React Native, no AsyncStorage — scripts/validate-w4-
// construction-news-client.ts runs every function here under bun.
//
// The wire contract is supabase/functions/construction-news/core.ts
// (NewsPayload). The types are restated rather than imported because the app
// bundle must not reach into supabase/functions (tsc excludes it, Metro would
// have to walk it); the validator imports both and checks the topic list and
// the payload guard against the server's own output.

export type NewsTopic =
  | 'Residential'
  | 'Commercial'
  | 'Materials & prices'
  | 'Labor & safety'
  | 'Codes & policy'
  | 'Equipment & tech'
  | 'Economy'
  | 'General';

/** Chip order. Must equal core.ts NEWS_TOPICS (validator-checked). */
export const NEWS_TOPICS: readonly NewsTopic[] = [
  'Residential',
  'Commercial',
  'Materials & prices',
  'Labor & safety',
  'Codes & policy',
  'Equipment & tech',
  'Economy',
  'General',
];

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  summary: string;
  topic: NewsTopic;
}

export interface NewsSourceStatus {
  name: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface NewsPayload {
  items: NewsItem[];
  sources: NewsSourceStatus[];
  fetchedAt: string;
}

/** AsyncStorage key for the last good copy. `mageid_` is an
 *  APP_STORAGE_PREFIXES prefix (utils/localCacheKeys.ts), so the tenant wipe
 *  sweeps it with everything else — it holds no tenant data, but nothing the
 *  app writes should be invisible to that sweep. `_v1` so a future shape
 *  change can move to a new key instead of misreading an old one. */
export const NEWS_CACHE_KEY = 'mageid_construction_news_v1';

export type NewsChip = 'All' | NewsTopic;

const TOPIC_SET = new Set<string>(NEWS_TOPICS);

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/[^\s/?#]+/i.test(v) && !/[\s<>"]/.test(v);
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v));
}

/**
 * Accept a payload from the network or from disk only if it has the shape the
 * screen renders. Items that fail are dropped one by one (a single bad item
 * must not blank the screen); a payload whose envelope is wrong is refused
 * whole. Links must be http(s) — the card opens them.
 */
export function coerceNewsPayload(raw: unknown): NewsPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.items) || !Array.isArray(r.sources) || !isIsoDate(r.fetchedAt)) return null;
  const items: NewsItem[] = [];
  for (const it of r.items) {
    if (!it || typeof it !== 'object') continue;
    const x = it as Record<string, unknown>;
    if (typeof x.id !== 'string' || typeof x.title !== 'string' || !x.title.trim()) continue;
    if (!isHttpUrl(x.link) || typeof x.source !== 'string' || !x.source.trim()) continue;
    if (!isIsoDate(x.publishedAt)) continue;
    items.push({
      id: x.id,
      title: x.title,
      link: x.link,
      source: x.source,
      publishedAt: x.publishedAt,
      summary: typeof x.summary === 'string' ? x.summary : '',
      topic: typeof x.topic === 'string' && TOPIC_SET.has(x.topic) ? (x.topic as NewsTopic) : 'General',
    });
  }
  const sources: NewsSourceStatus[] = [];
  for (const s of r.sources) {
    if (!s || typeof s !== 'object') continue;
    const x = s as Record<string, unknown>;
    if (typeof x.name !== 'string' || typeof x.ok !== 'boolean') continue;
    sources.push({
      name: x.name,
      ok: x.ok,
      count: typeof x.count === 'number' && Number.isFinite(x.count) ? x.count : 0,
      ...(typeof x.error === 'string' ? { error: x.error } : {}),
    });
  }
  return { items, sources, fetchedAt: r.fetchedAt };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "just now" · "5 min ago" · "3 hr ago" · "yesterday" · "4 days ago" ·
 * "Sep 3" (older than a week) · "Sep 3, 2025" (another year).
 *
 * Calendar words ("yesterday", the date) are read in the DEVICE's local zone
 * — the one the reader lives in — while the hour counts are pure elapsed
 * time. A future timestamp (a publisher's clock a few minutes ahead) reads
 * "just now", never "in 3 min".
 */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = nowMs - t;
  if (diff < 60_000) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  const then = new Date(t);
  const now = new Date(nowMs);
  const dayIndex = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const days = dayIndex(now) - dayIndex(then);
  if (hr < 24 && days === 0) return `${hr} hr ago`;
  if (days <= 1) return hr < 24 ? `${hr} hr ago` : 'yesterday';
  if (days < 7) return `${days} days ago`;
  const label = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? label : `${label}, ${then.getFullYear()}`;
}

/** relativeTime shaped to follow "news from": "from 2 hr ago", "from
 *  yesterday" and "from Sep 3" read fine; "from just now" does not. */
function sincePhrase(iso: string, nowMs: number): string {
  const rel = relativeTime(iso, nowMs);
  return rel === 'just now' ? 'a moment ago' : rel;
}

/** "Updated 12 min ago · 8 sources". Counts publishers that answered, not
 *  feeds (Construction Dive has two feeds and is one source). */
export function newsHeaderLine(payload: NewsPayload, nowMs: number): string {
  const okCount = payload.sources.filter(s => s.ok).length;
  const rel = relativeTime(payload.fetchedAt, nowMs);
  // "Updated Sep 3" reads as a heading; "Updated on Sep 3" reads as a sentence.
  const when = /^[A-Z][a-z]{2} \d/.test(rel) ? `on ${rel}` : rel;
  return `Updated ${when} · ${okCount} ${okCount === 1 ? 'source' : 'sources'}`;
}

/** "Didn't load: OSHA, ENR" — or null when every publisher answered. Named,
 *  so a missing publisher is never mistaken for a quiet news day. */
export function failedSourcesLine(payload: NewsPayload): string | null {
  const failed = payload.sources.filter(s => !s.ok).map(s => s.name);
  if (failed.length === 0) return null;
  return `Didn't load: ${failed.join(', ')}`;
}

export type NewsStaleReason = 'offline' | 'refresh_failed';

/**
 * The banner over a saved copy. The spec wording is "Offline — showing news
 * from <relative time>"; when the device is online but the refresh failed,
 * saying "Offline" would be a false reason, so that case says so instead.
 * The time is the SERVER's fetchedAt for that copy — when the news was
 * gathered — not when this device saved it.
 */
export function staleBannerText(reason: NewsStaleReason, fetchedAt: string, nowMs: number): string {
  const since = sincePhrase(fetchedAt, nowMs);
  return reason === 'offline'
    ? `Offline — showing news from ${since}`
    : `Couldn't refresh — showing news from ${since}`;
}

/** "All" plus every topic that has at least one item, in NEWS_TOPICS order. */
export function topicChips(items: readonly NewsItem[]): NewsChip[] {
  const present = new Set(items.map(i => i.topic));
  return ['All', ...NEWS_TOPICS.filter(t => present.has(t))];
}

export function filterByTopic(items: readonly NewsItem[], chip: NewsChip): NewsItem[] {
  return chip === 'All' ? [...items] : items.filter(i => i.topic === chip);
}

/** Card eyebrow: "ENR · 3 hr ago". The publisher is always named. */
export function newsMetaLine(item: NewsItem, nowMs: number): string {
  const rel = relativeTime(item.publishedAt, nowMs);
  return rel ? `${item.source} · ${rel}` : item.source;
}
