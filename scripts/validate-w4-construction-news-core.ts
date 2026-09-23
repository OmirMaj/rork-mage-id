// scripts/validate-w4-construction-news-core.ts
// Run: bun run scripts/validate-w4-construction-news-core.ts
//
// Wave 4 · lane construction-news (founder request F3: "a construction news
// place on the app that has all the latest up to date construction news").
// Pins the SERVER half: supabase/functions/construction-news/core.ts (parser,
// dates, dedupe, 30-day cut, truncation, topic rules, merge) against RSS 2.0,
// RSS 1.0 and Atom fixtures shaped like the real feeds it reads (CDATA,
// entity-escaped HTML, WordPress footers, date-only summaries, tracking
// params, missing/odd dates) — and the network shell index.ts by source
// (parallel fetch, per-feed timeout, 15-minute cache, signed-in only, never
// fetches an article page).
//
// core.ts is Deno-free by design so this file can import it under bun.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFeed, parseFeedDate, toPlainText, decodeEntities, truncate, cleanSummary,
  cleanLink, linkKey, safeHttpUrl, nearDuplicateTitle, classifyTopic, mergeFeeds,
  stableId, FEED_SOURCES, NEWS_TOPICS, SUMMARY_MAX, MAX_ITEMS, MAX_PER_SOURCE,
  type FeedResult, type FeedSource, type RawFeedItem,
} from '../supabase/functions/construction-news/core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}\n      want ${w}`);
}

console.log('\nconstruction-news core:');

// ── Text ───────────────────────────────────────────────────────────────────
eq('named + numeric entities decode', decodeEntities('A&amp;B &rsquo;s &#8217; &#x2019; &hellip; &nbsp;x'), 'A&B ’s ’ ’ …  x');
eq('an unknown named entity is left as written', decodeEntities('&bogus; &amp;'), '&bogus; &');
eq('CDATA is unwrapped and its HTML dropped', toPlainText('<![CDATA[<p>Hello <b>world</b></p>]]>'), 'Hello world');
eq('entity-escaped HTML is decoded then dropped', toPlainText('&lt;figure&gt;&lt;img src="x"/&gt;&lt;/figure&gt;&lt;p&gt;Zach&amp;rsquo;s job&lt;/p&gt;'), 'Zach’s job');
eq('"a < b" in a sentence survives tag stripping', toPlainText('Costs rose where a < b and c > d'), 'Costs rose where a < b and c > d');
eq('whitespace collapses', toPlainText('  one\n\n  two\t three '), 'one two three');

{
  const long = 'word '.repeat(80).trim();
  const t = truncate(long);
  ok(`truncate caps at ${SUMMARY_MAX} characters`, t.length <= SUMMARY_MAX, `length ${t.length}`);
  ok('truncate ends with an ellipsis', t.endsWith('…'));
  ok('truncate cuts on a word boundary', !/wor…$/.test(t) && /word…$/.test(t), t.slice(-12));
  eq('a short summary is untouched', truncate('Short.'), 'Short.');
  const exact = 'x'.repeat(SUMMARY_MAX);
  eq('a summary of exactly the cap is untouched', truncate(exact), exact);
}

eq('WordPress "appeared first on" footer is stripped',
  cleanSummary('<p>Big news here.</p><p>The post <a href="#">Big</a> appeared first on <a>Site</a>.</p>', 'Big'), 'Big news here.');
eq('…and the "first appeared on" variant (Construction Executive)',
  cleanSummary('<![CDATA[<p>Leaders explain why.</p>\n<p>The post <a href="x">Mental Health</a> first appeared on <a href="y">Construction Executive</a>.</p>]]>', 'Mental Health'), 'Leaders explain why.');
eq('a date-only summary (OSHA) becomes empty', cleanSummary('September 15, 2026', 'US DOL finds hazards'), '');
eq('a summary that repeats the headline becomes empty', cleanSummary('Housing Starts Rise!', 'Housing starts rise'), '');
eq('a bracketed ellipsis becomes one', cleanSummary('Something happened [&#8230;]', 'T'), 'Something happened…');

// ── Links ──────────────────────────────────────────────────────────────────
eq('javascript: links are refused', safeHttpUrl('javascript:alert(1)'), null);
eq('data: links are refused', safeHttpUrl('data:text/html,hi'), null);
eq('a link with whitespace inside is refused', safeHttpUrl('https://a.com/x y'), null);
eq('an http(s) link passes (entities decoded)', safeHttpUrl(' https://a.com/x?a=1&amp;b=2 '), 'https://a.com/x?a=1&b=2');
eq('utm params are dropped, others kept', cleanLink('https://a.com/p/?utm_source=rss&id=7&utm_medium=rss#top'), 'https://a.com/p/?id=7');
eq('a link with only tracking params loses its ?', cleanLink('https://a.com/p?utm_source=rss&utm_campaign=x'), 'https://a.com/p');
eq('linkKey ignores scheme, www., trailing slash and utm',
  linkKey('https://www.A.com/news/story/?utm_source=rss'), linkKey('http://a.com/news/story'));

// ── Dates ──────────────────────────────────────────────────────────────────
eq('RFC 822 with numeric offset', parseFeedDate('Tue, 22 Sep 2026 11:51:00 -0400'), '2026-09-22T15:51:00.000Z');
eq('RFC 822 with GMT', parseFeedDate('Tue, 22 Sep 2026 17:56:54 GMT'), '2026-09-22T17:56:54.000Z');
eq('RFC 822 with a zone name (EDT)', parseFeedDate('Tue, 22 Sep 2026 09:05 EDT'), '2026-09-22T13:05:00.000Z');
eq('RFC 822 with a two-digit year and no weekday', parseFeedDate('22 Sep 26 09:05:00 +0000'), '2026-09-22T09:05:00.000Z');
eq('RFC 822 with a full month name', parseFeedDate('Tuesday, 22 September 2026 10:00:00 +0000'), '2026-09-22T10:00:00.000Z');
eq('RFC 822 date with no time is midnight UTC', parseFeedDate('22 Sep 2026'), '2026-09-22T00:00:00.000Z');
eq('ISO 8601 with Z', parseFeedDate('2026-09-22T13:30:00Z'), '2026-09-22T13:30:00.000Z');
eq('ISO 8601 with millis and offset', parseFeedDate('2026-09-22T13:30:00.123+02:00'), '2026-09-22T11:30:00.000Z');
eq('CDATA-wrapped date', parseFeedDate('<![CDATA[Mon, 21 Sep 2026 18:17:47 +0000]]>'), '2026-09-21T18:17:47.000Z');
eq('an unknown zone name is not guessed', parseFeedDate('Tue, 22 Sep 2026 09:05 XYZT'), null);
eq('31 Feb is refused, not rolled into March', parseFeedDate('31 Feb 2026 10:00 +0000'), null);
eq('free text is not a date', parseFeedDate('yesterday'), null);
eq('empty is null', parseFeedDate(''), null);
eq('undefined is null', parseFeedDate(undefined), null);

// ── Parsing ────────────────────────────────────────────────────────────────
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Feed title must not become an item</title>
  <atom:link href="https://feed.example/rss" rel="self"/>
  <item>
    <title><![CDATA[Lumber &amp; steel prices climb]]></title>
    <media:title>media title must not win</media:title>
    <link>https://news.example/lumber?utm_source=rss&amp;utm_medium=rss</link>
    <description>&lt;figure&gt;&lt;img src="https://x/y.webp"/&gt;&lt;/figure&gt;&lt;p&gt;Framing lumber rose 4% as mills&amp;rsquo; output fell.&lt;/p&gt;</description>
    <content:encoded><![CDATA[<p>FULL ARTICLE TEXT that must never be used as the summary.</p>]]></content:encoded>
    <category><![CDATA[Materials]]></category>
    <pubDate>Tue, 22 Sep 2026 11:51:00 -0400</pubDate>
  </item>
  <item>
    <title>No date on this one</title>
    <link>https://news.example/undated</link>
    <description>Still parsed; dropped at merge.</description>
  </item>
  <item>
    <title>Guid is the permalink</title>
    <guid isPermaLink="true">https://news.example/guid-link</guid>
    <dc:date>2026-09-21T08:00:00Z</dc:date>
  </item>
  <item>
    <title>Guid that is not a permalink</title>
    <guid isPermaLink="false">https://news.example/?p=123</guid>
    <pubDate>Mon, 21 Sep 2026 08:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Evil link</title>
    <link>javascript:alert(document.cookie)</link>
    <pubDate>Mon, 21 Sep 2026 08:00:00 +0000</pubDate>
  </item>
  <item>
    <title></title>
    <link>https://news.example/untitled</link>
    <pubDate>Mon, 21 Sep 2026 08:00:00 +0000</pubDate>
  </item>
  <item>
    <title>US Department of Labor finds contractor exposed workers to fall hazards</title>
    <link>https://www.osha.gov/news/newsreleases/region5/20260915</link>
    <description>September 15, 2026</description>
    <pubDate>Tue, 15 Sep 2026 12:00:00 +0000</pubDate>
  </item>
</channel>
</rss>`;

const rssItems = parseFeed(RSS);
eq('RSS: titled items with http links are parsed (untitled, evil and non-permalink guid skipped)',
  rssItems.map(i => i.title),
  ['Lumber & steel prices climb', 'No date on this one', 'Guid is the permalink', 'US Department of Labor finds contractor exposed workers to fall hazards']);
{
  const a = rssItems[0];
  eq('RSS: tracking params stripped from the link', a?.link, 'https://news.example/lumber');
  eq('RSS: the summary is the <description>, never <content:encoded>', a?.summary, 'Framing lumber rose 4% as mills’ output fell.');
  ok('RSS: full article text never leaks into any field', !JSON.stringify(rssItems).includes('FULL ARTICLE TEXT'));
  ok('RSS: <media:title> does not replace <title>', !JSON.stringify(rssItems).includes('media title'));
  eq('RSS: pubDate parsed', a?.publishedAt, '2026-09-22T15:51:00.000Z');
  eq('RSS: categories read (CDATA unwrapped)', a?.categories, ['Materials']);
  eq('RSS: a missing date parses as null (kept for merge to drop)', rssItems[1]?.publishedAt, null);
  eq('RSS: permalink guid used when there is no <link>', rssItems[2]?.link, 'https://news.example/guid-link');
  eq('RSS: dc:date read when there is no pubDate', rssItems[2]?.publishedAt, '2026-09-21T08:00:00.000Z');
  eq('RSS: OSHA date-only summary is empty', rssItems[3]?.summary, '');
  ok('RSS: the channel title is not an item', !rssItems.some(i => i.title.startsWith('Feed title')));
}

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom feed</title>
  <link rel="self" href="https://atom.example/feed"/>
  <entry>
    <title type="html">OSHA &amp;amp; heat: new rule for roofers</title>
    <link rel="self" href="https://atom.example/entries/1.atom"/>
    <link rel="alternate" type="text/html" href="https://atom.example/heat-rule"/>
    <id>tag:atom.example,2026:1</id>
    <published>2026-09-20T10:00:00-05:00</published>
    <updated>2026-09-21T10:00:00Z</updated>
    <summary type="html">&lt;p&gt;Roofing crews get mandatory water breaks.&lt;/p&gt;</summary>
    <content type="html">&lt;p&gt;FULL ATOM CONTENT&lt;/p&gt;</content>
    <category term="safety" label="Safety"/>
    <category term="policy"/>
  </entry>
  <entry>
    <title>Only an updated date</title>
    <link href="https://atom.example/updated-only"/>
    <updated>2026-09-19T00:00:00Z</updated>
  </entry>
</feed>`;

const atomItems = parseFeed(ATOM);
eq('Atom: both entries parsed', atomItems.map(i => i.title), ['OSHA & heat: new rule for roofers', 'Only an updated date']);
eq('Atom: rel="alternate" wins over rel="self"', atomItems[0]?.link, 'https://atom.example/heat-rule');
eq('Atom: <published> wins over <updated>, offset applied', atomItems[0]?.publishedAt, '2026-09-20T15:00:00.000Z');
eq('Atom: <summary> read, <content> never', atomItems[0]?.summary, 'Roofing crews get mandatory water breaks.');
ok('Atom: full content never leaks', !JSON.stringify(atomItems).includes('FULL ATOM CONTENT'));
eq('Atom: categories use label, then term', atomItems[0]?.categories, ['Safety', 'policy']);
eq('Atom: a link with no rel counts as alternate', atomItems[1]?.link, 'https://atom.example/updated-only');
eq('Atom: <updated> used when there is no <published>', atomItems[1]?.publishedAt, '2026-09-19T00:00:00.000Z');

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item rdf:about="https://rdf.example/a"><title>RDF story</title><link>https://rdf.example/a</link><dc:date>2026-09-18T12:00:00Z</dc:date></item>
</rdf:RDF>`;
eq('RSS 1.0 (RDF) items parse', parseFeed(RDF).map(i => [i.title, i.publishedAt]), [['RDF story', '2026-09-18T12:00:00.000Z']]);
eq('garbage in, no items out', parseFeed('<html><body>Just a moment...</body></html>'), []);

// ── Dedupe helpers ─────────────────────────────────────────────────────────
ok('near-duplicate: same words, different punctuation/case',
  nearDuplicateTitle('Construction Starts Fall 24.8% in August', 'construction starts fall 24 8 in august!'));
ok('near-duplicate: one extra word on a long headline',
  nearDuplicateTitle('Tennessee approves record interstate express lanes P3 deal', 'Tennessee approves record interstate express lanes P3 deal today'));
ok('not a duplicate: different stories sharing words',
  !nearDuplicateTitle('Multifamily starts plummeted nearly 16% in August', 'Single-family starts rebound in August'));
ok('not a duplicate: short headlines only match exactly',
  !nearDuplicateTitle('Housing starts rise', 'Housing starts fall'));
eq('stableId is deterministic 8-hex', [stableId('a.com/x'), stableId('a.com/x').length], [stableId('a.com/x'), 8]);

// ── Topics ─────────────────────────────────────────────────────────────────
eq('OSHA fine at a homebuilder → Labor & safety (safety beats residential)',
  classifyTopic('OSHA fines homebuilder $265K for fall hazards', '', []), 'Labor & safety');
eq('ballot / court → Codes & policy', classifyTopic('Ohio Supreme Court Blocks Ballot Measure Targeting $4B AWS Data Center', '', []), 'Codes & policy');
eq('lumber → Materials & prices', classifyTopic('Lumber prices jump on new tariffs', '', []), 'Materials & prices');
eq('excavator → Equipment & tech', classifyTopic('New excavator simulator teaches utility work', '', []), 'Equipment & tech');
eq('starts → Economy (numbers beat housing)', classifyTopic('Single-family starts rebound in August', '', []), 'Economy');
eq('mortgage rates → Economy', classifyTopic('Mortgage rates dip for third week', '', []), 'Economy');
eq('bedrooms in homes → Residential', classifyTopic('Bedrooms in new single-family homes in 2025', '', []), 'Residential');
eq('bridge rehab → Commercial', classifyTopic('Skanska to lead rehab of landmark Potomac River bridge', '', []), 'Commercial');
eq('the headline decides before the summary',
  classifyTopic('Data center campus breaks ground in Ohio', 'About 2,000 workers will be on site at peak.', []), 'Commercial');
eq('summary/categories decide when the headline says nothing',
  classifyTopic('AECOM picks a new leader', 'The firm also reported record backlog.', []), 'Economy');
eq("a feed's default topic is the last resort", classifyTopic('AECOM picks a new leader', '', [], 'Residential'), 'Residential');
eq('else General', classifyTopic('AECOM picks a new leader', '', []), 'General');
eq('"Bill Gates" is not legislation', classifyTopic('Bechtel splits with Bill Gates-backed project', '', []), 'General');
eq('"barcode" is not a building code', classifyTopic('Barcode scanning comes to tile', '', []), 'General');

// ── Merge ──────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-09-22T18:00:00Z');
const H = 3600_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const src = (name: string, extra: Partial<FeedSource> = {}): FeedSource => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, url: `https://${name.replace(/\W+/g, '')}.example/rss`, ...extra });
const item = (title: string, link: string, msAgo: number | null, summary = ''): RawFeedItem =>
  ({ title, link, publishedAt: msAgo === null ? null : iso(msAgo), summary, categories: [] });

const results: FeedResult[] = [
  { source: src('Construction Dive'), items: [
    item('Construction starts fall 24.8% in August', 'https://cd.example/starts', 2 * H),
    item('Worker killed at Indiana data center site', 'https://cd.example/fatal', 5 * H),
  ] },
  // Second feed of the same publisher: repeats one story by link (with utm).
  { source: src('Construction Dive', { id: 'cd-safety' }), items: [
    item('Worker killed at Indiana data center site', 'https://www.cd.example/fatal/?utm_source=rss', 5 * H),
  ] },
  { source: src('ENR'), items: [
    item('Construction Starts Fall 24.8% in August!', 'https://enr.example/starts-aug', 1 * H), // near-dup title, NEWER → wins
    item('Old story from last month', 'https://enr.example/old', 31 * 24 * H),
    item('Scheduled post from the future', 'https://enr.example/future', -3 * 24 * H),
    item('A few minutes ahead of our clock', 'https://enr.example/skew', -5 * 60_000),
    item('No date given', 'https://enr.example/undated', null),
  ] },
  { source: src('OSHA'), items: null, error: 'HTTP 403' },
  { source: src('Fine Homebuilding', { defaultTopic: 'Residential' }), items: [
    item('Podcast episode 755: a talk with Tedd Benson', 'https://fhb.example/755', 4 * 24 * H),
  ] },
];

const merged = mergeFeeds(results, NOW);
eq('merge: newest first, dups/stale/future/undated dropped', merged.items.map(i => i.title), [
  'A few minutes ahead of our clock',
  'Construction Starts Fall 24.8% in August!',
  'Worker killed at Indiana data center site',
  'Podcast episode 755: a talk with Tedd Benson',
]);
eq('merge: the NEWER copy of a near-duplicate wins (ENR, 1 hr) and the older (CD, 2 hr) goes',
  merged.items.find(i => /starts/i.test(i.title))?.source, 'ENR');
eq('merge: sources reported once per publisher, counts after dedupe', merged.sources, [
  { name: 'Construction Dive', ok: true, count: 1 },
  { name: 'ENR', ok: true, count: 2 },
  { name: 'OSHA', ok: false, count: 0, error: 'HTTP 403' },
  { name: 'Fine Homebuilding', ok: true, count: 1 },
]);
eq('merge: fetchedAt is now', merged.fetchedAt, new Date(NOW).toISOString());
eq('merge: topics assigned (feed default used when nothing matches)', merged.items.map(i => i.topic),
  ['General', 'Economy', 'Labor & safety', 'Residential']);
ok('merge: every item has a stable id from its link key',
  merged.items.every(i => i.id === stableId(linkKey(i.link))));
ok('merge: ids are unique', new Set(merged.items.map(i => i.id)).size === merged.items.length);

{
  const oneFeedDown: FeedResult[] = [
    { source: src('Construction Dive'), items: null, error: 'timed out' },
    { source: src('Construction Dive', { id: 'cd-2' }), items: [item('Story', 'https://cd.example/s', H)] },
  ];
  eq('merge: a publisher with one feed up and one down is ok', mergeFeeds(oneFeedDown, NOW).sources, [{ name: 'Construction Dive', ok: true, count: 1 }]);
  const allDown: FeedResult[] = [{ source: src('ENR'), items: null, error: 'unreachable' }];
  eq('merge: all down → no items, the failure named', mergeFeeds(allDown, NOW), { items: [], sources: [{ name: 'ENR', ok: false, count: 0, error: 'unreachable' }], fetchedAt: new Date(NOW).toISOString() });
}
{
  const many: RawFeedItem[] = Array.from({ length: 120 }, (_, i) => item(`Unique story number ${i} about topic ${i * 7}`, `https://m.example/${i}`, i * 60_000));
  const out = mergeFeeds([{ source: src('Many'), items: many }], NOW, { perSource: 1000 });
  eq(`merge: capped at ${MAX_ITEMS}`, out.items.length, MAX_ITEMS);
  eq('merge: the cap keeps the NEWEST', out.items[MAX_ITEMS - 1]?.link, `https://m.example/${MAX_ITEMS - 1}`);
  {
    const flood = mergeFeeds([
      { source: src('Flood'), items: Array.from({ length: 40 }, (_, i) => item(`Flood story number ${i} unique words ${i * 13}`, `https://f.example/${i}`, i * 60_000)) },
      { source: src('Quiet'), items: [item('Quiet publisher story that is older', 'https://q.example/1', 10 * 24 * H)] },
    ], NOW);
    eq(`merge: at most ${MAX_PER_SOURCE} per publisher (a prolific feed cannot crowd out the rest)`,
      [flood.items.filter(i => i.source === 'Flood').length, flood.items.some(i => i.source === 'Quiet')], [MAX_PER_SOURCE, true]);
    eq('merge: the per-publisher cap keeps that publisher’s NEWEST', flood.items[0]?.link, 'https://f.example/0');
    const dupFirst = mergeFeeds([
      { source: src('A'), items: [item('Same story same headline words here', 'https://a.example/1', H)] },
      { source: src('A', { id: 'a2' }), items: [item('Same story same headline words here', 'https://a.example/1?utm_source=x', H), item('Second distinct story from A', 'https://a.example/2', 2 * H)] },
    ], NOW, { perSource: 2 });
    eq('merge: a repeat never uses up a per-publisher slot', dupFirst.items.map(i => i.link), ['https://a.example/1', 'https://a.example/2']);
  }
  const edge = mergeFeeds([{ source: src('Edge'), items: [
    item('Twenty-nine days old story here', 'https://e.example/29', 29 * 24 * H),
    item('Thirty-one days old story here', 'https://e.example/31', 31 * 24 * H),
  ] }], NOW);
  eq('merge: 30-day cut keeps 29 days, drops 31', edge.items.map(i => i.link), ['https://e.example/29']);
}

// ── The feed list ──────────────────────────────────────────────────────────
ok(`6–10 feeds configured (${FEED_SOURCES.length})`, FEED_SOURCES.length >= 6 && FEED_SOURCES.length <= 10);
ok('every feed URL is https', FEED_SOURCES.every(s => s.url.startsWith('https://')));
ok('feed ids are unique', new Set(FEED_SOURCES.map(s => s.id)).size === FEED_SOURCES.length);
ok('the mix covers commercial, residential, safety and housing economics',
  ['Commercial', 'Residential', 'Labor & safety', 'Economy'].every(t => FEED_SOURCES.some(s => s.defaultTopic === t)));
ok('every default topic is a real topic', FEED_SOURCES.every(s => !s.defaultTopic || NEWS_TOPICS.includes(s.defaultTopic)));

// ── core.ts stays Deno-free; index.ts keeps its promises ───────────────────
const core = read('supabase/functions/construction-news/core.ts');
ok('core.ts has no imports and no Deno globals (bun must be able to load it)',
  !/^\s*import\s/m.test(core) && !/\bDeno\./.test(core));

const idx = read('supabase/functions/construction-news/index.ts');
ok('index.ts: signed-in callers only (verifyUser, 401 otherwise)',
  /await verifyUser\(req\)/.test(idx) && /if \(!user\) return json\([^)]*401\)/.test(idx));
ok('index.ts: every feed fetched in parallel', /Promise\.all\(FEED_SOURCES\.map\(fetchFeed\)\)/.test(idx));
ok('index.ts: per-feed timeout of 6 s via AbortController',
  /FEED_TIMEOUT_MS = 6_000/.test(idx) && /new AbortController\(\)/.test(idx) && /setTimeout\(\(\) => ctrl\.abort\(\), FEED_TIMEOUT_MS\)/.test(idx) && /signal: ctrl\.signal/.test(idx));
ok('index.ts: 15-minute in-memory cache served before any fetch',
  /CACHE_TTL_MS = 15 \* 60 \* 1000/.test(idx)
  && idx.indexOf('Date.now() - cache.at < CACHE_TTL_MS') > 0
  && idx.indexOf('Date.now() - cache.at < CACHE_TTL_MS') < idx.indexOf('refresh()', idx.indexOf('serve(')));
ok('index.ts: sends Cache-Control (private — the answer is behind a JWT)', /'Cache-Control': `private, max-age=\$\{remaining\}`/.test(idx));
ok('index.ts: all feeds failing is a clear 502, not an empty list',
  /results\.every\(r => r\.items === null\)\) return null/.test(idx) && /error: 'all_feeds_failed'/.test(idx) && /}, 502\)/.test(idx));
{
  const fetches = idx.match(/\bfetch\(/g) ?? [];
  ok('index.ts: the ONLY fetch is of a feed URL (never an article page)',
    fetches.length === 1 && /await fetch\(source\.url,/.test(idx) && !/\.link\b/.test(idx));
}
ok('index.ts: a failed feed is reported, not thrown', /return \{ source, items: null, error:/.test(idx));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
