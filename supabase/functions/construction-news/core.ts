// supabase/functions/construction-news/core.ts — the pure half of the
// construction-news edge function: the feed list, the RSS/Atom parser, the
// dedupe, the 30-day cut and the topic rules.
//
// Deno-free on purpose (no Deno globals, no URL imports, no imports at all) so
// scripts/validate-w4-construction-news-core.ts can import it under bun and pin
// the parser against real-shaped fixtures. index.ts is the thin network shell.
//
// WHAT WE TAKE FROM A PUBLISHER, AND WHAT WE DON'T. Only what the publisher's
// own feed hands out for syndication: the headline, the feed's own summary
// (plain text, at most 240 characters) and the link. We never fetch or scrape
// the article pages, and we never fall back to a feed's full-text
// <content:encoded> / Atom <content> — several feeds put the whole article
// there, and the summary is the part they publish to be quoted.

export type NewsTopic =
  | 'Residential'
  | 'Commercial'
  | 'Materials & prices'
  | 'Labor & safety'
  | 'Codes & policy'
  | 'Equipment & tech'
  | 'Economy'
  | 'General';

/** Chip order on the client. utils/constructionNews.ts NEWS_TOPICS must match
 *  (the validator compares the two). */
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

export interface FeedSource {
  /** Stable id — used in logs only. */
  id: string;
  /** Publisher name as shown on every card. */
  name: string;
  url: string;
  /** Used only when neither the headline nor the summary matches a rule. */
  defaultTopic?: NewsTopic;
}

// Every URL below was fetched on 2026-09-22 and returned a live RSS 2.0 feed
// with items dated that week. Dropped after checking, so nobody re-adds them
// blind: ENR's /rss (an HTML page — /rss/articles is the feed), For
// Construction Pros, Equipment World, Construction Equipment Guide (Cloudflare
// challenge, 403), Builder, JLC, Remodeling (403 to any non-browser client),
// Pro Remodeler, BD+C, Pro Builder (404), AGC (/rss.xml answers, but its
// newest item is from December 2024) and HousingWire (mortgage-market news,
// not construction). Construction Dive's news and safety feeds overlap; the
// dedupe drops the repeats.
export const FEED_SOURCES: readonly FeedSource[] = [
  { id: 'construction-dive', name: 'Construction Dive', url: 'https://www.constructiondive.com/feeds/news/' },
  { id: 'construction-dive-safety', name: 'Construction Dive', url: 'https://www.constructiondive.com/feeds/topic/safety/', defaultTopic: 'Labor & safety' },
  { id: 'enr', name: 'ENR', url: 'https://www.enr.com/rss/articles', defaultTopic: 'Commercial' },
  { id: 'eye-on-housing', name: 'NAHB Eye on Housing', url: 'https://eyeonhousing.org/feed/', defaultTopic: 'Economy' },
  { id: 'osha', name: 'OSHA', url: 'https://www.osha.gov/news/newsreleases.xml', defaultTopic: 'Labor & safety' },
  { id: 'construction-business-owner', name: 'Construction Business Owner', url: 'https://www.constructionbusinessowner.com/rss.xml' },
  { id: 'constructconnect', name: 'ConstructConnect', url: 'https://www.constructconnect.com/blog/rss.xml', defaultTopic: 'Commercial' },
  { id: 'fine-homebuilding', name: 'Fine Homebuilding', url: 'https://www.finehomebuilding.com/feed', defaultTopic: 'Residential' },
  { id: 'construction-executive', name: 'Construction Executive', url: 'https://www.constructionexec.com/rss' },
];

/** One item as parsed out of a feed, before dedupe and classification. */
export interface RawFeedItem {
  title: string;
  link: string;
  /** ISO 8601, or null when the feed gave no date we can read. */
  publishedAt: string | null;
  summary: string;
  categories: string[];
}

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

export const SUMMARY_MAX = 240;
export const MAX_ITEMS = 80;
/** One prolific publisher (ENR posts ~30 stories in five days) must not fill
 *  the list on its own; past this many, its older stories give way to the
 *  other publishers' newer-than-30-day ones. */
export const MAX_PER_SOURCE = 20;
export const MAX_AGE_DAYS = 30;
/** A pubDate further ahead than this is a publisher's clock or a scheduled
 *  post leaking early — not "news from the future". Dropped. */
export const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

// ── Text ───────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', bull: '•',
  middot: '·', copy: '©', reg: '®', trade: '™',
  deg: '°', frac12: '½', frac14: '¼', frac34: '¾',
  eacute: 'é', egrave: 'è', aacute: 'á', ntilde: 'ñ',
  ouml: 'ö', uuml: 'ü', times: '×', laquo: '«', raquo: '»',
  prime: '′', Prime: '″', shy: '',
};

/** Decode HTML/XML character references. Unknown named entities are left as
 *  written rather than guessed at. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : whole;
  });
}

/** Unwrap every <![CDATA[ … ]]> section in place. */
export function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Feed text → plain text. Feeds carry HTML three ways: raw inside CDATA
 * (WordPress), entity-escaped (`&lt;p&gt;` — Construction Dive,
 * ConstructConnect) and plain. So: unwrap CDATA, decode once (escaped markup
 * becomes markup, `&amp;rsquo;` becomes `&rsquo;`), drop tags, decode again,
 * collapse whitespace. Only real tags are dropped (`<` followed by a letter,
 * `/` or `!`), so "a < b" in a sentence survives.
 */
export function toPlainText(raw: string): string {
  let s = unwrapCdata(raw);
  s = decodeEntities(s);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|figure|figcaption)[\s>][\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim();
}

/** Cut to at most `max` characters on a word boundary, ending in '…'. */
export function truncate(s: string, max = SUMMARY_MAX): string {
  if (s.length <= max) return s;
  const room = s.slice(0, max - 1);
  const lastSpace = room.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? room.slice(0, lastSpace) : room;
  return cut.replace(/[\s,;:.\-–—]+$/, '') + '…';
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH_WORD = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;

/** North-American zone abbreviations RFC 822 allows, plus the ones feeds use
 *  anyway. Minutes east of UTC. */
const ZONES: Record<string, number> = {
  UT: 0, UTC: 0, GMT: 0, Z: 0,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  AKST: -540, AKDT: -480, HST: -600,
};

/**
 * Read a feed date into ISO 8601, or null. Handles RFC 822 / 2822 (RSS
 * pubDate, including two-digit years, missing seconds, zone names and a
 * missing weekday) and ISO 8601 (Atom, dc:date). Parsed by hand rather than
 * with Date.parse because engines disagree on the RFC 822 edge cases — Deno
 * (V8) and bun (JavaScriptCore) must read the same string the same way, or the
 * validator proves nothing about production.
 */
export function parseFeedDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = toPlainText(input).replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // ISO 8601: 2026-09-22, 2026-09-22T13:30:00Z, 2026-09-22T13:30:00.000+02:00
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', se = '0', tz] = iso;
    let offsetMin = 0;
    if (tz && tz.toUpperCase() !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      const digits = tz.slice(1).replace(':', '');
      offsetMin = sign * (parseInt(digits.slice(0, 2), 10) * 60 + parseInt(digits.slice(2, 4), 10));
    }
    return finish(+y, +mo - 1, +d, +h, +mi, +se, offsetMin);
  }

  // RFC 822: [Tue,] 22 Sep 2026 11:51[:00] [-0400|EDT]
  const rfc = /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9}\.?)\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+([+-]\d{4}|[A-Za-z]{1,5}))?$/.exec(s);
  if (rfc) {
    const [, d, monWord, yRaw, h = '0', mi = '0', se = '0', tz] = rfc;
    if (!MONTH_WORD.test(monWord)) return null;
    const mon = MONTHS[monWord.slice(0, 3).toLowerCase()];
    let y = parseInt(yRaw, 10);
    if (yRaw.length === 2) y += y < 70 ? 2000 : 1900;
    else if (yRaw.length === 3) return null;
    let offsetMin = 0;
    if (tz) {
      if (/^[+-]\d{4}$/.test(tz)) {
        const sign = tz[0] === '-' ? -1 : 1;
        offsetMin = sign * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10));
      } else {
        const z = ZONES[tz.toUpperCase()];
        // An unknown zone name is not something to guess an offset for.
        if (z === undefined) return null;
        offsetMin = z;
      }
    }
    return finish(y, mon, +d, +h, +mi, +se, offsetMin);
  }
  return null;
}

function finish(y: number, mon: number, d: number, h: number, mi: number, se: number, offsetMin: number): string | null {
  if (mon < 0 || mon > 11 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return null;
  const ms = Date.UTC(y, mon, d, h, mi, Math.min(se, 59)) - offsetMin * 60_000;
  const check = new Date(Date.UTC(y, mon, d));
  // 31 Feb rolls over in Date.UTC; refuse it rather than publish a wrong day.
  if (check.getUTCMonth() !== mon) return null;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// ── XML ────────────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Inner text of the first <tag> in `block` (exact qualified name, so
 *  `title` never matches `media:title`), or ''. */
function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${escapeRe(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(tag)}\\s*>`, 'i');
  const m = re.exec(block);
  return m ? m[1] : '';
}

function allTagTexts(block: string, tag: string): string[] {
  const re = new RegExp(`<${escapeRe(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(tag)}\\s*>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

function attr(tagSrc: string, name: string): string | null {
  const m = new RegExp(`\\s${escapeRe(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tagSrc);
  return m ? (m[2] ?? m[3] ?? '') : null;
}

/** Atom <link>: rel="alternate" (or no rel) wins; text/html preferred. */
function atomLink(block: string): string {
  const links = block.match(/<link\b[^>]*\/?>/gi) ?? [];
  let fallback = '';
  for (const l of links) {
    const href = attr(l, 'href');
    if (!href) continue;
    const rel = (attr(l, 'rel') ?? 'alternate').toLowerCase();
    if (rel === 'alternate') return href;
    if (!fallback && rel !== 'self' && rel !== 'enclosure' && rel !== 'replies') fallback = href;
  }
  return fallback;
}

/** Only http(s) links reach a card. A `javascript:` or `data:` link in a feed
 *  would otherwise be one tap from running. */
export function safeHttpUrl(raw: string): string | null {
  const s = decodeEntities(unwrapCdata(raw)).trim();
  if (!/^https?:\/\/[^\s/?#]+/i.test(s)) return null;
  if (/[\s<>"]/.test(s)) return null;
  return s;
}

/** Drop tracking parameters from a link we show and open. */
export function cleanLink(url: string): string {
  const [beforeHash] = url.split('#');
  const q = beforeHash.indexOf('?');
  if (q < 0) return beforeHash;
  const base = beforeHash.slice(0, q);
  const kept = beforeHash
    .slice(q + 1)
    .split('&')
    .filter(p => p && !/^(utm_[a-z_]+|mc_cid|mc_eid|fbclid|gclid)=/i.test(p));
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

/** Dedupe key for a link: scheme-less, lower-case host, no www., no trailing
 *  slash, no tracking params. */
export function linkKey(url: string): string {
  const c = cleanLink(url);
  const m = /^https?:\/\/([^/?#]+)(.*)$/i.exec(c);
  if (!m) return c.toLowerCase();
  const host = m[1].toLowerCase().replace(/^www\./, '');
  const rest = m[2].replace(/\/+$/, '').replace(/\/+(\?)/, '$1');
  return host + rest;
}

const DATE_ONLY_SUMMARY = /^(?:[A-Za-z]+,?\s+)?(?:[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2})\.?$/;

/** The feed's summary, cleaned for a card — or '' when there is nothing
 *  worth showing (OSHA's summary is the release date; some repeat the title). */
export function cleanSummary(raw: string, title: string): string {
  let s = toPlainText(raw);
  // WordPress appends "The post <title> appeared first on <site>." (some
  // themes word it "first appeared on").
  s = s.replace(/\s*The post .{1,300}? (?:appeared first|first appeared) on .{1,120}?\.?$/i, '');
  // "Continue reading", "Read more" footers and bracketed ellipses.
  s = s.replace(/\s*(?:Continue reading|Read more|Read the full story)\b.*$/i, '');
  s = s.replace(/\s*\[(?:…|\.\.\.)\]\s*$/, '…').trim();
  if (!s) return '';
  if (DATE_ONLY_SUMMARY.test(s)) return '';
  if (normTitle(s) === normTitle(title)) return '';
  return truncate(s);
}

/**
 * Parse an RSS 2.0, RSS 1.0 (RDF) or Atom 1.0 document into raw items.
 * Regex-based rather than a DOM parser: the edge runtime has no DOMParser for
 * XML, and the handful of tags we read are flat. Items with no title or no
 * http(s) link are skipped; items with no readable date are KEPT here with
 * publishedAt null and dropped by mergeFeeds (which reports the count).
 */
export function parseFeed(xml: string): RawFeedItem[] {
  const out: RawFeedItem[] = [];
  const isAtom = /<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(xml)
    || (!/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml));
  const blocks = isAtom
    ? xml.match(/<entry[\s>][\s\S]*?<\/entry\s*>/gi) ?? []
    : xml.match(/<item[\s>][\s\S]*?<\/item\s*>/gi) ?? [];

  for (const block of blocks) {
    const title = toPlainText(tagText(block, 'title'));
    if (!title) continue;

    let linkRaw = '';
    if (isAtom) {
      linkRaw = atomLink(block);
    } else {
      linkRaw = tagText(block, 'link');
      if (!safeHttpUrl(linkRaw)) {
        // RSS guid is a permalink unless isPermaLink="false".
        const guidTag = /<guid\b([^>]*)>([\s\S]*?)<\/guid\s*>/i.exec(block);
        if (guidTag && !/isPermaLink\s*=\s*["']false["']/i.test(guidTag[1])) linkRaw = guidTag[2];
      }
    }
    const safe = safeHttpUrl(linkRaw);
    if (!safe) continue;

    const dateRaw = isAtom
      ? tagText(block, 'published') || tagText(block, 'updated')
      : tagText(block, 'pubDate') || tagText(block, 'dc:date') || tagText(block, 'published') || tagText(block, 'updated');

    const summaryRaw = isAtom ? tagText(block, 'summary') : tagText(block, 'description');

    const categories = isAtom
      ? (block.match(/<category\b[^>]*>/gi) ?? [])
          .map(c => attr(c, 'label') ?? attr(c, 'term') ?? '')
          .map(c => toPlainText(c))
          .filter(Boolean)
      : allTagTexts(block, 'category').map(c => toPlainText(c)).filter(Boolean);

    out.push({
      title,
      link: cleanLink(safe),
      publishedAt: parseFeedDate(dateRaw),
      summary: cleanSummary(summaryRaw, title),
      categories,
    });
  }
  return out;
}

// ── Dedupe ─────────────────────────────────────────────────────────────────

export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Same story under two headlines that differ by punctuation, a trailing
 *  "| Publisher", or a word. Word-set Jaccard ≥ 0.85, only on headlines of 5+
 *  words — short headlines ("Housing starts rise") collide by accident. */
export function nearDuplicateTitle(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = new Set(na.split(' '));
  const wb = new Set(nb.split(' '));
  if (wa.size < 5 || wb.size < 5) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / (wa.size + wb.size - inter) >= 0.85;
}

/** FNV-1a 32-bit, hex. Stable item ids from the link key. */
export function stableId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ── Topics ─────────────────────────────────────────────────────────────────

/** First matching rule wins, in this order. Safety and policy come first
 *  because they cut across markets: an OSHA fine at a homebuilder is a safety
 *  story, not a residential one. Economy sits above Residential so "housing
 *  starts" and "mortgage rates" land with the numbers. */
export const TOPIC_RULES: readonly { topic: NewsTopic; re: RegExp }[] = [
  { topic: 'Labor & safety', re: /\b(osha|safety|injur\w*|fatal\w*|deaths?|died|killed|fall protection|heat illness|silica|trench\w*|hazards?|workforce|workers?|labor|labour|apprentice\w*|unions?|wages?|hiring|staffing|immigration|mental health|suicide|penalt\w*|citations?)\b/i },
  { topic: 'Codes & policy', re: /\b(codes?|permits?|permitting|zoning|regulat\w*|rules?|legislat\w*|congress|senate|lawmakers?|court|lawsuit|sued|ballot|epa|federal|government|policy|policies|executive order|compliance|mandates?|ordinance|iija|buy america)\b/i },
  { topic: 'Materials & prices', re: /\b(lumber|steel|concrete|cement|materials?|prices?|pricing|tariffs?|copper|aluminum|asphalt|drywall|gypsum|shingles?|insulation|supply chain|ppi|producer price)\b/i },
  { topic: 'Equipment & tech', re: /\b(equipment|excavators?|machines?|machinery|telematics|software|ai|artificial intelligence|drones?|robot\w*|bim|technology|tech|digital|autonomous|3d print\w*|apps?|cranes?|loaders?|tools?)\b/i },
  { topic: 'Economy', re: /\b(starts|spending|backlog|index|economy|economic|economists?|interest rates?|mortgage rates?|inflation|forecasts?|outlook|recession|gdp|jobs report|employment|unemployment|survey|sentiment|confidence|momentum|abi|billings|sales)\b/i },
  { topic: 'Residential', re: /\b(homes?|houses?|housing|single[- ]family|multifamily|remodel\w*|renovat\w*|kitchens?|baths?|bathrooms?|bedrooms?|homebuild\w*|home builders?|apartments?|residential|decks?|adu|townhomes?|condos?)\b/i },
  { topic: 'Commercial', re: /\b(data cent\w*|offices?|hospitals?|schools?|warehouses?|industrial|infrastructure|highways?|bridges?|airports?|contracts?|awarded|megaprojects?|commercial|retail|stadiums?|arenas?|plants?|factor(?:y|ies)|transit|rail|semiconductor|nonresidential|contractors?)\b/i },
];

export function classifyTopic(title: string, summary: string, categories: readonly string[], fallback?: NewsTopic): NewsTopic {
  // The headline decides first — a summary that mentions "workers" in passing
  // must not pull a data-center story into Labor & safety.
  for (const r of TOPIC_RULES) if (r.re.test(title)) return r.topic;
  const rest = `${categories.join(' ')} ${summary}`;
  for (const r of TOPIC_RULES) if (r.re.test(rest)) return r.topic;
  return fallback ?? 'General';
}

// ── Merge ──────────────────────────────────────────────────────────────────

export interface FeedResult {
  source: FeedSource;
  /** null when the fetch or the parse failed. */
  items: RawFeedItem[] | null;
  error?: string;
}

/**
 * Merge per-feed results into the payload: drop undated, future and >30-day
 * items, classify, sort newest first, dedupe by link then by near-identical
 * headline (the newest copy wins), keep at most MAX_PER_SOURCE per publisher,
 * cap at MAX_ITEMS. Per-source counts are
 * what the source contributed AFTER all of that, so "8 sources" never counts
 * a feed whose every item was a repeat or stale.
 *
 * Sources are reported once per publisher name (Construction Dive has two
 * feeds): ok if either answered, error only when every feed of that name
 * failed.
 */
export function mergeFeeds(results: readonly FeedResult[], nowMs: number, opts: { maxAgeDays?: number; cap?: number; perSource?: number } = {}): NewsPayload {
  const maxAgeMs = (opts.maxAgeDays ?? MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  const cap = opts.cap ?? MAX_ITEMS;
  const perSource = opts.perSource ?? MAX_PER_SOURCE;

  const candidates: NewsItem[] = [];
  for (const r of results) {
    if (!r.items) continue;
    for (const it of r.items) {
      if (!it.publishedAt) continue;
      const t = Date.parse(it.publishedAt);
      if (!Number.isFinite(t)) continue;
      if (t > nowMs + FUTURE_SLACK_MS) continue;
      if (nowMs - t > maxAgeMs) continue;
      candidates.push({
        id: stableId(linkKey(it.link)),
        title: it.title,
        link: it.link,
        source: r.source.name,
        publishedAt: it.publishedAt,
        summary: it.summary,
        topic: classifyTopic(it.title, it.summary, it.categories, r.source.defaultTopic),
      });
    }
  }

  // Newest first; ties broken by title so the order is deterministic.
  candidates.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.title.localeCompare(b.title));

  const seenLinks = new Set<string>();
  const kept: NewsItem[] = [];
  const perSourceCount = new Map<string, number>();
  for (const c of candidates) {
    const k = linkKey(c.link);
    if (seenLinks.has(k)) continue;
    if (kept.some(x => nearDuplicateTitle(x.title, c.title))) continue;
    // Dedupe before the per-source cap, so a repeat never uses up a slot.
    const n = perSourceCount.get(c.source) ?? 0;
    if (n >= perSource) continue;
    perSourceCount.set(c.source, n + 1);
    seenLinks.add(k);
    kept.push(c);
    if (kept.length >= cap) break;
  }

  const byName = new Map<string, NewsSourceStatus>();
  for (const r of results) {
    const prev = byName.get(r.source.name);
    const ok = r.items !== null;
    if (!prev) {
      byName.set(r.source.name, { name: r.source.name, ok, count: 0, ...(ok ? {} : { error: r.error ?? 'failed' }) });
    } else if (ok && !prev.ok) {
      byName.set(r.source.name, { name: r.source.name, ok: true, count: 0 });
    }
  }
  for (const it of kept) {
    const s = byName.get(it.source);
    if (s) s.count += 1;
  }

  return { items: kept, sources: [...byName.values()], fetchedAt: new Date(nowMs).toISOString() };
}
