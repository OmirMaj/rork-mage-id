// scripts/validate-w4-construction-news-client.ts
// Run: bun run scripts/validate-w4-construction-news-client.ts
//
// Wave 4 · lane construction-news (founder request F3). Pins the CLIENT half:
//   * utils/constructionNews.ts — relative time, the header and failed-source
//     lines, the offline / refresh-failed banner wording, topic chips, the
//     payload guard, the mageid_ cache key (run here under bun);
//   * hooks/useConstructionNews.ts + app/construction-news.tsx — by source,
//     because they import react-native: the saved copy is read and written
//     inside try/catch, offline is detected through supabase-js's wrapper,
//     cards open in the in-app browser / a new tab, pull to refresh, two
//     columns on a wide web screen, empty/error states offer Retry;
//   * the doors — Stack registration, browser-tab title, the Tools tile and
//     the desktop sidebar row (both navs, kept in sync).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NEWS_TOPICS, NEWS_CACHE_KEY, coerceNewsPayload, relativeTime, newsHeaderLine,
  failedSourcesLine, staleBannerText, topicChips, filterByTopic, newsMetaLine,
  type NewsPayload, type NewsItem,
} from '../utils/constructionNews';
import { NEWS_TOPICS as SERVER_TOPICS, mergeFeeds, type FeedResult } from '../supabase/functions/construction-news/core';
import { isAppStorageKey, DEVICE_SCOPED_KEYS } from '../utils/localCacheKeys';
import { pathToDocumentTitle } from '../utils/routeTitle';

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

console.log('\nconstruction-news client:');

// ── Contract with the server ───────────────────────────────────────────────
eq('client topic list equals the server’s (chip order)', [...NEWS_TOPICS], [...SERVER_TOPICS]);

const NOW = new Date(2026, 8, 22, 15, 0, 0).getTime(); // local 22 Sep 2026 15:00
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HR = 60 * MIN;

{
  const serverOut = mergeFeeds([
    { source: { id: 'enr', name: 'ENR', url: 'https://enr.example' }, items: [
      { title: 'Lumber prices climb', link: 'https://enr.example/a', publishedAt: agoMs(HR), summary: 'Up 4%.', categories: [] },
    ] },
    { source: { id: 'osha', name: 'OSHA', url: 'https://osha.example' }, items: null, error: 'HTTP 403' },
  ] as FeedResult[], NOW);
  const back = coerceNewsPayload(JSON.parse(JSON.stringify(serverOut)));
  eq('the server’s own payload passes the client guard unchanged', back, serverOut);
}

// ── Payload guard ──────────────────────────────────────────────────────────
{
  const good = { id: 'a', title: 'T', link: 'https://x.example/a', source: 'ENR', publishedAt: agoMs(HR), summary: 's', topic: 'Economy' };
  const payload = coerceNewsPayload({
    fetchedAt: agoMs(0),
    sources: [{ name: 'ENR', ok: true, count: 1 }, { name: 42 }],
    items: [
      good,
      { ...good, id: 'b', link: 'javascript:alert(1)' },
      { ...good, id: 'c', title: '   ' },
      { ...good, id: 'd', publishedAt: 'not a date' },
      { ...good, id: 'e', topic: 'Gossip', summary: 7 },
      null,
    ],
  });
  eq('guard: bad items dropped one by one; unknown topic → General; non-string summary → ""',
    payload?.items.map(i => [i.id, i.topic, i.summary]), [['a', 'Economy', 's'], ['e', 'General', '']]);
  eq('guard: a malformed source row is dropped', payload?.sources.length, 1);
  eq('guard: a wrong envelope is refused whole', coerceNewsPayload({ items: 'nope', sources: [], fetchedAt: agoMs(0) }), null);
  eq('guard: no fetchedAt is refused', coerceNewsPayload({ items: [], sources: [] }), null);
  eq('guard: null is refused', coerceNewsPayload(null), null);
}

// ── Relative time ──────────────────────────────────────────────────────────
eq('under a minute → just now', relativeTime(agoMs(30_000), NOW), 'just now');
eq('a publisher clock a few minutes ahead → just now, never "in 3 min"', relativeTime(agoMs(-3 * MIN), NOW), 'just now');
eq('minutes', relativeTime(agoMs(12 * MIN), NOW), '12 min ago');
eq('hours, same day', relativeTime(agoMs(3 * HR), NOW), '3 hr ago');
eq('past midnight but under 24 h → hours', relativeTime(new Date(2026, 8, 21, 23, 0).toISOString(), new Date(2026, 8, 22, 1, 0).getTime()), '2 hr ago');
eq('the calendar day before, over 24 h → yesterday', relativeTime(new Date(2026, 8, 21, 9, 0).toISOString(), new Date(2026, 8, 22, 10, 0).getTime()), 'yesterday');
eq('days', relativeTime(new Date(2026, 8, 18, 9, 0).toISOString(), NOW), '4 days ago');
eq('over a week → the date', relativeTime(new Date(2026, 8, 3, 9, 0).toISOString(), NOW), 'Sep 3');
eq('another year → the date with the year', relativeTime(new Date(2025, 11, 30, 9, 0).toISOString(), NOW), 'Dec 30, 2025');
eq('garbage → empty', relativeTime('nope', NOW), '');

// ── Header, failed sources, banner ─────────────────────────────────────────
const P = (sources: NewsPayload['sources'], fetchedMsAgo = 12 * MIN): NewsPayload =>
  ({ items: [], sources, fetchedAt: agoMs(fetchedMsAgo) });
eq('header: "Updated 12 min ago · 2 sources" counts only publishers that answered',
  newsHeaderLine(P([{ name: 'A', ok: true, count: 3 }, { name: 'B', ok: true, count: 0 }, { name: 'C', ok: false, count: 0, error: 'x' }]), NOW),
  'Updated 12 min ago · 2 sources');
eq('header: singular source', newsHeaderLine(P([{ name: 'A', ok: true, count: 1 }], 20_000), NOW), 'Updated just now · 1 source');
eq('header: an old copy reads "on <date>"', newsHeaderLine(P([{ name: 'A', ok: true, count: 1 }], 20 * 24 * HR), NOW), 'Updated on Sep 2 · 1 source');
eq('failed sources are named', failedSourcesLine(P([{ name: 'ENR', ok: true, count: 1 }, { name: 'OSHA', ok: false, count: 0 }, { name: 'JLC', ok: false, count: 0 }])), "Didn't load: OSHA, JLC");
eq('no failed line when every source answered', failedSourcesLine(P([{ name: 'ENR', ok: true, count: 1 }])), null);

eq('offline banner — the founder-spec wording', staleBannerText('offline', agoMs(2 * HR), NOW), 'Offline — showing news from 2 hr ago');
eq('offline banner — seconds old reads "a moment ago"', staleBannerText('offline', agoMs(10_000), NOW), 'Offline — showing news from a moment ago');
eq('offline banner — yesterday', staleBannerText('offline', new Date(2026, 8, 21, 9, 0).toISOString(), NOW), 'Offline — showing news from yesterday');
eq('offline banner — an old copy', staleBannerText('offline', new Date(2026, 8, 3, 9, 0).toISOString(), NOW), 'Offline — showing news from Sep 3');
eq('online but the refresh failed does NOT claim offline', staleBannerText('refresh_failed', agoMs(40 * MIN), NOW), "Couldn't refresh — showing news from 40 min ago");

// ── Chips ──────────────────────────────────────────────────────────────────
{
  const mk = (id: string, topic: NewsItem['topic']): NewsItem =>
    ({ id, title: id, link: `https://x.example/${id}`, source: 'ENR', publishedAt: agoMs(HR), summary: '', topic });
  const items = [mk('1', 'Economy'), mk('2', 'Residential'), mk('3', 'Economy'), mk('4', 'General')];
  eq('chips: All + only topics that have items, in topic order', topicChips(items), ['All', 'Residential', 'Economy', 'General']);
  eq('chips: no items → just All', topicChips([]), ['All']);
  eq('filter: a topic', filterByTopic(items, 'Economy').map(i => i.id), ['1', '3']);
  eq('filter: All keeps everything', filterByTopic(items, 'All').length, 4);
  eq('card meta names the publisher and the time', newsMetaLine(mk('9', 'General'), NOW), 'ENR · 1 hr ago');
}

// ── Storage key ────────────────────────────────────────────────────────────
ok('cache key is under an APP_STORAGE_PREFIXES prefix (swept by the tenant wipe)', isAppStorageKey(NEWS_CACHE_KEY));
ok('cache key uses the mageid_ namespace', NEWS_CACHE_KEY.startsWith('mageid_'));
ok('cache key is not exempted as device-scoped', !DEVICE_SCOPED_KEYS.includes(NEWS_CACHE_KEY));

// ── Hook, by source ────────────────────────────────────────────────────────
const hook = read('hooks/useConstructionNews.ts');
ok('hook: calls the construction-news edge function through supabase-js',
  /supabase\.functions\.invoke<unknown>\('construction-news'/.test(hook));
ok('hook: react-query owns the fetch', /useQuery\(\{[\s\S]*queryKey: CONSTRUCTION_NEWS_QUERY_KEY[\s\S]*queryFn: fetchConstructionNews/.test(hook));
{
  const readFn = hook.slice(hook.indexOf('async function readSavedCopy'), hook.indexOf('async function writeSavedCopy'));
  const writeFn = hook.slice(hook.indexOf('async function writeSavedCopy'), hook.indexOf('export interface ConstructionNewsState'));
  ok('hook: the saved copy is read inside try/catch, through the payload guard',
    /try \{[\s\S]*AsyncStorage\.getItem\(NEWS_CACHE_KEY\)[\s\S]*coerceNewsPayload[\s\S]*\} catch/.test(readFn));
  ok('hook: the saved copy is written inside try/catch', /try \{[\s\S]*AsyncStorage\.setItem\(NEWS_CACHE_KEY/.test(writeFn) && /\} catch/.test(writeFn));
}
ok('hook: only a LIVE payload is saved', /if \(!live\) return;\s*setSaved\(live\);\s*void writeSavedCopy\(live\);/.test(hook));
ok('hook: offline recognised through supabase-js’s FunctionsFetchError wrapper and its context',
  /e\.name === 'FunctionsFetchError'/.test(hook) && /isTransportError\(e\.context\)/.test(hook));
ok('hook: a stale reason is set only when the live fetch failed and something is on screen',
  /const staleReason: NewsStaleReason \| null = failed && payload\s*\?\s*\(isOfflineFailure\(query\.error\) \? 'offline' : 'refresh_failed'\)\s*:\s*null;/.test(hook));
ok('hook: the live copy wins over the saved one', /const payload = live \?\? saved;/.test(hook));

// ── Screen, by source ──────────────────────────────────────────────────────
const screen = read('app/construction-news.tsx');
ok('screen: phone opens the story in the in-app browser', /WebBrowser\.openBrowserAsync\(link\)/.test(screen));
ok('screen: web opens a new tab with noopener', /window\.open\(link, '_blank', 'noopener,noreferrer'\)/.test(screen));
ok('screen: only http(s) links are opened', /if \(!\/\^https\?:\\\/\\\/\/i\.test\(link\)\) return;/.test(screen));
ok('screen: pull to refresh', /refreshControl=\{<RefreshControl refreshing=\{isRefreshing\} onRefresh=\{onRefresh\}/.test(screen));
ok('screen: two columns on a wide screen, one on the phone',
  /const columns = isDesktop \|\| \(Platform\.OS === 'web' && isTablet\) \? 2 : 1;/.test(screen) && /numColumns=\{columns\}/.test(screen) && /key=\{`news-cols-\$\{columns\}`\}/.test(screen));
ok('screen: headline up to 3 lines, summary 2', /styles\.title\} numberOfLines=\{3\}/.test(screen) && /styles\.summary\} numberOfLines=\{2\}/.test(screen));
ok('screen: every card names its publisher (meta line)', /newsMetaLine\(item, now\)/.test(screen));
ok('screen: header shows "Updated … · N sources" and the sources that did not load',
  /newsHeaderLine\(payload, now\)/.test(screen) && /failedSourcesLine\(payload\)/.test(screen));
ok('screen: the stale banner is rendered from staleBannerText when there is a reason',
  /\{staleReason \? \([\s\S]*staleBannerText\(staleReason, payload\.fetchedAt, now\)/.test(screen));
ok('screen: topic chips from topicChips, hidden when only All', /topicChips\(items\)/.test(screen) && /chips\.length > 1 \?/.test(screen));
ok('screen: error state says why and offers Retry',
  /title="The news didn't load"[\s\S]{0,120}message=\{errorMessage/.test(screen) && /actionLabel="Retry"/.test(screen));
ok('screen: empty state says why and offers Retry', /title="No stories right now"[\s\S]{0,300}actionLabel="Retry"/.test(screen));
ok('screen: the spinner shows only while nothing is on screen', /if \(isLoading\) \{/.test(screen));
ok('screen: lucide Newspaper icon + @/components/ui primitives',
  /from 'lucide-react-native'/.test(screen) && /\bNewspaper\b/.test(screen) && /import \{ Card, Button \} from '@\/components\/ui'/.test(screen));
ok('screen: says where the words come from', /Headlines and summaries come from each publisher's own feed/.test(screen));

// ── Doors ──────────────────────────────────────────────────────────────────
ok('route file exists', existsSync(join(ROOT, 'app', 'construction-news.tsx')));
const layout = read('app/_layout.tsx');
ok("Stack registers /construction-news titled 'Construction News'",
  /<Stack\.Screen\s+name="construction-news"\s+options=\{\{\s*title: "Construction News"/.test(layout));
eq('browser-tab title', pathToDocumentTitle('/construction-news'), 'Construction News');
const tools = read('app/(tabs)/discover/tools.tsx');
ok('Discover ▸ Tools has a Construction News tile (phone door)',
  /\{ route: '\/construction-news', Icon: Newspaper, title: 'Construction News'[^}]*section: 'INDUSTRY' \}/.test(tools)
  && /'AI HUB', 'INDUSTRY', 'DECISIONS'/.test(tools));
ok('the Tools tile opens its own route when it has no registry row',
  /row\.feature \? featureFor\(row\.feature\)\.route : row\.route/.test(tools) && /if \(!row\.feature\) return undefined;/.test(tools));
const sidebar = read('components/DesktopSidebar.tsx');
// Wave 6c moved the row from WORKSPACE into SETUP & TOOLS (WORKSPACE back to
// six rows above the fold on the founder's 858 px viewport); either is a door.
ok('DesktopSidebar has a Construction News row (desktop door, same label)',
  /\{ key: 'construction-news', label: 'Construction News', icon: Newspaper,\s+route: '\/construction-news',\s+section: '(?:WORKSPACE|SETUP & TOOLS)'(, feature: 'construction-news')? \}/.test(sidebar));
// Integration round 1: the ⌘K registry row landed (validate-feature-search
// requires every sidebar route to be searchable), so the row names it.
ok('the registry has a construction-news row on the same route, ungated',
  /\{ id: 'construction-news', title: 'Construction News', synonyms: \[[^\]]*'news'[^\]]*\], route: '\/construction-news', icon: 'Newspaper', group: 'workspace' \}/.test(read('utils/featureRegistry.ts')));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
