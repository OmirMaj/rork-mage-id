// validate-content-rights-server.ts — lane CRSERVER, contentfix 2026-10-03.
//
// MAGE ID's first App Store submission asks "do you have all necessary rights
// to third-party content?" (guideline 5.2.1 / 5.2.2). The rights check
// (contentfix-specs/RIGHTS-VERDICT.md) found server-side gaps; the founder
// chose to switch the unlicensed sources off. This guard pins every server fix:
//
//   [1] fetch-external-data: no Google Places step, no Adzuna step (no host, no
//       key, no write to cached_companies / cached_jobs); both report a
//       'retired' verdict that keeps the cron run green; the city_coords
//       preload reads OpenStreetMap rows only
//   [2] geocode-bids: Nominatim only (identifying User-Agent, 1.1 s pause after
//       EVERY call, OSM-only cache read, every cached row stamped 'nominatim')
//   [3] construction-news: FEED_SOURCES is OSHA only; the retired publishers
//       are never fetched
//   [4] og-image: answers { success: true, imageUrl: null } before reading the
//       body; no Pexels; no spoofed browser User-Agent in ANY edge function
//   [5] building-record md.ts: the three unlicensed Baltimore layers (housing
//       notices feed, CHAP landmarks, National Register districts) are never
//       fetched, and a City record still parses in every installed client
//   [6] morning-digest: the OpenWeather credit, linked, under live weather only
//   [7] the migration closes every client read of cached_companies / cached_jobs
//       and deletes nothing; the one-off cleanup SQL previews before each write
//       and judges Google rows by city_coords.source
//
// Run: bun scripts/validate-content-rights-server.ts

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { sourceVerdict, cycleOutcome, RETIRED_REASON } from '../supabase/functions/fetch-external-data/sourceStatus';
import { FEED_SOURCES } from '../supabase/functions/construction-news/core';
import {
  mdRecordPlan, assembleMdRecord, mdRecordComplete, MD_LAYERS, MD_SAFE_FIELDS, MD_LINKS_CITY, MD_CODEMAP_URL,
  type MdFetched, type MdJobId,
} from '../supabase/functions/building-record/md';
import { parseMdBuildingRecordResponse, summarizeMdBuildingRecord } from '../utils/buildingRecord';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Code only: block comments and // comments gone (a "://" in a URL is kept). */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
/** SQL code only: -- comments gone. */
const stripSql = (src: string) => src.replace(/--.*$/gm, '');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// ── [1] fetch-external-data ──────────────────────────────────────────────
console.log('\n[1] fetch-external-data: no Google Places, no Adzuna');
{
  const fx = strip(read('supabase/functions/fetch-external-data/index.ts'));
  ok('no Google Maps / Places host or key', !/googleapis\.com|maps\.google|place\/textsearch|GOOGLE_PLACES_API_KEY/i.test(fx));
  ok('no Adzuna host or key', !/adzuna\.com|ADZUNA_APP_(ID|KEY)/i.test(fx));
  ok('nothing writes cached_companies or cached_jobs (only the age-out deletes remain)',
    !/from\('cached_companies'\)\s*\.(upsert|insert|update)/.test(fx) && !/from\('cached_jobs'\)\s*\.(upsert|insert|update)/.test(fx));
  ok('the unused Google geocodeCity helper is gone', !/function geocodeCity\(/.test(fx));
  ok("both retired providers still push a 'retired' verdict (the response names them)",
    /sourceVerdict\(\{ name: 'adzuna', keyPresent: false, retired: true, rows: 0 \}\)/.test(fx)
    && /sourceVerdict\(\{ name: 'google_places', keyPresent: false, retired: true, rows: 0 \}\)/.test(fx));
  ok("the city_coords preload reads OpenStreetMap rows only (.eq('source', 'nominatim'))",
    /from\('city_coords'\)\s*\.select\('city,state,latitude,longitude'\)\s*\.eq\('source', 'nominatim'\)/.test(fx));
  ok('every fetch left in the function is SAM.gov or the heartbeat',
    (fx.match(/\bfetch\(/g) ?? []).length === 2 && /await fetch\(url\)/.test(fx) && /await fetch\(heartbeatUrl\)/.test(fx) && /api\.sam\.gov/.test(fx));
  const retired = sourceVerdict({ name: 'adzuna', keyPresent: true, retired: true, rows: 0, failedStatuses: [401], error: 'x' });
  ok('a retired provider is skipped and ok, whatever else it carries (never fails the run)',
    retired.ok && retired.skipped && retired.rows === 0 && retired.error === RETIRED_REASON);
  const cycle = cycleOutcome([
    sourceVerdict({ name: 'sam', keyPresent: true, rows: 200 }),
    sourceVerdict({ name: 'adzuna', keyPresent: false, retired: true, rows: 0 }),
    sourceVerdict({ name: 'google_places', keyPresent: false, retired: true, rows: 0 }),
  ], 't');
  ok('SAM ok + two retired providers → 200, heartbeat allowed', cycle.allOk && cycle.status === 200 && cycle.body.success === true);
  ok('a provider that is not retired still fails on 401 (SUPA-H1 unchanged)',
    sourceVerdict({ name: 'sam', keyPresent: true, rows: 0, failedStatuses: [401] }).ok === false);
}

// ── [2] geocode-bids ─────────────────────────────────────────────────────
console.log('\n[2] geocode-bids: OpenStreetMap Nominatim only');
{
  const gb = strip(read('supabase/functions/geocode-bids/index.ts'));
  ok('no Google host, key or Places helper', !/googleapis\.com|place\/textsearch|GOOGLE_PLACES_API_KEY|geocodeViaPlaces/i.test(gb));
  ok('Nominatim is called with an identifying User-Agent',
    /https:\/\/nominatim\.openstreetmap\.org\/search\?/.test(gb) && /headers: \{ 'User-Agent': 'mage-id\/1\.0 \([^)]*\)' \}/.test(gb));
  const loop = gb.slice(gb.indexOf('for (const p of toFetch) {'), gb.indexOf('if (newCacheRows.length > 0)'));
  ok('the fetch loop calls Nominatim and ALWAYS pauses 1.1 s right after (1 request/second policy)',
    /const coords = await geocodeViaNominatim\(p\.city, p\.state\)\n\s*if \(coords\) nominatimUsed\+\+\n(\s*\/\/.*\n)*\s*await new Promise\(\(r\) => setTimeout\(r, 1100\)\)/.test(read('supabase/functions/geocode-bids/index.ts'))
    && !/if \([^)]*\)\s*await new Promise\(\(r\) => setTimeout\(r, 1100\)\)/.test(loop));
  ok("the cache read takes OpenStreetMap rows only (.eq('source', 'nominatim'))",
    /from\('city_coords'\)\.select\('city,state,latitude,longitude'\)\.eq\('source', 'nominatim'\)/.test(gb));
  const sources = [...gb.matchAll(/\bsource:\s*'([^']+)'/g)].map((m) => m[1]);
  ok("every city_coords row written is stamped source 'nominatim' and nothing else", sources.length === 1 && sources[0] === 'nominatim', sources.join(','));
  ok('exactly two fetches: Nominatim and the heartbeat', (gb.match(/\bfetch\(/g) ?? []).length === 2);
}

// ── [3] construction-news ────────────────────────────────────────────────
console.log('\n[3] construction-news: OSHA only');
{
  ok('FEED_SOURCES is exactly one feed: OSHA news releases',
    FEED_SOURCES.length === 1 && FEED_SOURCES[0].id === 'osha' && FEED_SOURCES[0].name === 'OSHA'
    && FEED_SOURCES[0].url === 'https://www.osha.gov/news/newsreleases.xml', JSON.stringify(FEED_SOURCES));
  ok('every fetched feed is on osha.gov (US government, public domain)', FEED_SOURCES.every((s) => new URL(s.url).hostname.endsWith('osha.gov')));
  const core = strip(read('supabase/functions/construction-news/core.ts'));
  const fsBlock = core.slice(core.indexOf('export const FEED_SOURCES'), core.indexOf('];', core.indexOf('export const FEED_SOURCES')));
  ok('no publisher without permission is in the FEED_SOURCES literal',
    !/constructiondive|enr\.com|eyeonhousing|constructionbusinessowner|constructconnect|finehomebuilding|constructionexec/i.test(fsBlock));
  const idx = strip(read('supabase/functions/construction-news/index.ts'));
  ok('index.ts fetches FEED_SOURCES only and never touches RETIRED_FEEDS', /Promise\.all\(FEED_SOURCES\.map\(fetchFeed\)\)/.test(idx) && !/RETIRED_FEEDS/.test(idx));
}

// ── [4] og-image + every function's User-Agent ───────────────────────────
console.log('\n[4] og-image: no automatic photo, no spoofed browser');
{
  const ogRaw = read('supabase/functions/og-image/index.ts');
  const og = strip(ogRaw);
  ok('AUTO_PRODUCT_PHOTOS_ENABLED is false', /const AUTO_PRODUCT_PHOTOS_ENABLED = false;/.test(og));
  const early = og.indexOf('if (!AUTO_PRODUCT_PHOTOS_ENABLED) return jsonResponse({ success: true, imageUrl: null });');
  ok('the handler answers { success: true, imageUrl: null } BEFORE reading the body or fetching',
    early > 0 && early > og.indexOf('requireTier(') && early < og.indexOf('await req.json()') && early < og.indexOf('await fetchOgImage('));
  ok('the response shape the client reads is kept (success + imageUrl)', /resolveSelectionImage/.test(read('utils/ogImage.ts')) && /data\.imageUrl \?\? null/.test(read('utils/ogImage.ts')));
  ok('no Pexels anywhere in the function (search and key gone)', !/pexels/i.test(og));
  ok('the fetcher names itself: no Chrome / Safari / AppleWebKit / Macintosh UA', !/Chrome\/|Safari\/|AppleWebKit|Macintosh/.test(og) && /const UA = "MAGE-ID-LinkPreview\/1\.0 \(\+https:\/\/mageid\.app\)";/.test(og));
  const spoofed: string[] = [];
  const fnDir = join(ROOT, 'supabase/functions');
  for (const fn of readdirSync(fnDir, { withFileTypes: true })) {
    if (!fn.isDirectory()) continue;
    for (const f of readdirSync(join(fnDir, fn.name))) {
      if (!/\.(ts|js)$/.test(f)) continue;
      const src = strip(readFileSync(join(fnDir, fn.name, f), 'utf8'));
      if (/Chrome\/\d|AppleWebKit\/|Intel Mac OS X|Windows NT \d/.test(src)) spoofed.push(`${fn.name}/${f}`);
    }
  }
  ok('no edge function sends a spoofed browser User-Agent', spoofed.length === 0, spoofed.join(', '));
}

// ── [5] building-record md.ts ────────────────────────────────────────────
console.log('\n[5] Baltimore: the three unlicensed layers are never read');
{
  const md = strip(read('supabase/functions/building-record/md.ts'));
  ok('the housing-notices feed, CHAP landmarks and National Register services are absent from md.ts code',
    !/NoticesInspections|CHAPLandmarks_poly|Planning\/Boundaries\/MapServer\/11/.test(md));
  ok("the layer ids C7_1..C7_4, C10 and C11 are gone (type, SAFE lists, layers)",
    !/'C7_[1-4]'|\bC7_[1-4]\b|'C10'|'C11'|\bC10:|\bC11:/.test(md)
    && Object.keys(MD_LAYERS).every((id) => !/^C7_|^C10$|^C11$/.test(id)) && Object.keys(MD_SAFE_FIELDS).every((id) => !/^C7_|^C10$|^C11$/.test(id)));
  ok('the licensed Open Baltimore layers stay (C3, C4, C6, C8, C9, C12) and the County layers (K3-K7)',
    ['C3', 'C4', 'C6', 'C8', 'C9', 'C12', 'K3', 'K4', 'K5', 'K6', 'K7'].every((id) => id in MD_LAYERS) && Object.keys(MD_LAYERS).length === 11);
  const cityPlan = mdRecordPlan('baltimore_city', '4074C009', 39.326002256022, -76.60807094633) ?? [];
  ok('the City record plan fetches nothing from the dropped services (12 jobs)',
    cityPlan.length === 12 && cityPlan.every((j) => !/NoticesInspections|CHAPLandmarks|Boundaries\/MapServer\/11/.test(j.url)), String(cityPlan.length));
  const okBody = (body: unknown): MdFetched => ({ status: 'ok', body });
  const jobs: Partial<Record<MdJobId, MdFetched>> = {
    parcel: okBody({ features: [{ attributes: { BLOCKLOT: '4074C009', FULLADDR: '620 E 31ST ST', YEAR_BUILD: 1920, ZONECODE: 'R-6', LDATE: '09272026' } }] }),
    permits_count: okBody({ count: 0 }), permits_rows: okBody({ features: [] }), vbn: okBody({ features: [] }),
    zoning: okBody({ features: [{ attributes: { Zoning: 'R-6' } }] }), historic: okBody({ features: [] }), flood: okBody({ features: [] }),
    'asof:C4': okBody({ features: [{ attributes: { mx: 1790294400000 } }] }), 'asof:C6': okBody({ features: [{ attributes: { mx: 1790294400000 } }] }),
    'asof:C8': okBody({ fields: [] }), 'asof:C9': okBody({ fields: [] }), 'asof:C12': okBody({ fields: [] }),
  };
  const rec = assembleMdRecord({ side: 'baltimore_city', key: '4074C009', fetchedAt: new Date('2026-10-03T12:00:00Z'), jobs });
  const parsed = parseMdBuildingRecordResponse(JSON.parse(JSON.stringify({ status: 'md_record', record: rec })));
  ok('WIRE: a City record still parses in the installed client (4 housing parts, non-null landmark / NR parts)',
    parsed.status === 'md_record' && rec.housingNotices.length === 4 && rec.landmarks !== null && rec.nationalRegister !== null, parsed.status);
  const unread = [...rec.housingNotices, rec.landmarks!, rec.nationalRegister!];
  ok("the never-read parts are 'failed' with no rows and no as-of (every client says \"not checked\", never \"none\")",
    unread.every((p) => p.status === 'failed' && p.rows.length === 0 && p.asOf === null && p.asOfKind === 'unread' && /MAGE no longer checks it/.test(p.source)));
  const sum = parsed.status === 'md_record' ? summarizeMdBuildingRecord(parsed.record) : null;
  ok('the card never claims no open housing notices, no landmark or no National Register listing',
    !!sum && sum.lines.every((l) => !/No open (interior|exterior|vacant notices in the unpublished)|Not found in the City's unpublished|No open housing-code/i.test(l))
    && sum.kind !== 'no_active_in_checked', sum ? `${sum.kind} | ${sum.lines.join(' | ')}` : 'unparsed');
  ok('the never-read parts read "Couldn\'t read … — not checked" on the card',
    !!sum && sum.lines.filter((l) => /^Couldn't read .*MAGE no longer checks it[^)]*\) — not checked$/.test(l)).length === 6, sum?.lines.join(' | '));
  ok('each never-read notice line sends the contractor to the CoDeMap link (a retry would not help)',
    !!sum && sum.lines.filter((l) => /notices in the .*MAGE no longer checks it; see the CoDeMap link\) — not checked$/.test(l)).length === 4, sum?.lines.join(' | '));
  ok('a record whose READ parts all answered is still cacheable (mdRecordComplete ignores the never-read parts)', mdRecordComplete(rec));
  ok("the City record links Baltimore Housing's CoDeMap, so notices can still be looked up",
    MD_CODEMAP_URL === 'https://cels.baltimorehousing.org/codemapv2ext/' && MD_LINKS_CITY.some((l) => l.url === MD_CODEMAP_URL) && rec.links.some((l) => l.url === MD_CODEMAP_URL));
}

// ── [6] morning-digest ───────────────────────────────────────────────────
console.log('\n[6] morning digest: OpenWeather credit');
{
  const dg = strip(read('supabase/functions/morning-digest/index.ts'));
  const credit = /const OPENWEATHER_CREDIT_HTML = `([^`]*)`;/.exec(dg)?.[1] ?? '';
  ok('the credit reads "Weather data provided by OpenWeather", linked to https://openweathermap.org/',
    /<a href="https:\/\/openweathermap\.org\/"[^>]*>Weather data provided by OpenWeather<\/a>/.test(credit), credit);
  ok('the same line credits OpenStreetMap (the coordinates came from Nominatim), linked to its copyright page',
    /<a href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>Location © OpenStreetMap contributors<\/a>/.test(credit), credit);
  const live = dg.slice(dg.indexOf('const weatherLine = b.weather'), dg.indexOf(": b.weatherMissing === 'unavailable'"));
  const missing = dg.slice(dg.indexOf(": b.weatherMissing === 'unavailable'"), dg.indexOf('const quietLine'));
  ok('the credit sits under the LIVE weather line', live.length > 0 && live.includes('${OPENWEATHER_CREDIT_HTML}'));
  ok('the "unavailable" and "no address" lines carry no credit (no OpenWeather data shown)', missing.length > 0 && !missing.includes('OPENWEATHER_CREDIT_HTML'));
}

// ── [7] the migration + the one-off cleanup ──────────────────────────────
console.log('\n[7] migration and cleanup SQL');
{
  const migRel = 'supabase/migrations/20261003090000_content_rights.sql';
  const migRaw = read(migRel);
  const mig = stripSql(migRaw);
  ok('the migration has a VERIFY block in its header', /^-- VERIFY AFTER/m.test(migRaw) && /has_table_privilege\('anon', 'public\.cached_companies', 'SELECT'\)/.test(migRaw));
  ok('it drops both public read policies (IF EXISTS)',
    /drop policy if exists anon_read_companies on public\.cached_companies;/.test(mig) && /drop policy if exists anon_read_jobs on public\.cached_jobs;/.test(mig));
  ok('it drops any other client SELECT / ALL policy on either table (catalog loop)',
    /from pg_policies[\s\S]*tablename in \('cached_companies', 'cached_jobs'\)[\s\S]*cmd in \('SELECT', 'ALL'\)[\s\S]*roles && array\['anon', 'authenticated', 'public'\]::name\[\][\s\S]*drop policy if exists %I on %I\.%I/.test(mig));
  ok('it revokes SELECT (via ALL) from anon and authenticated on cached_companies AND cached_jobs',
    /revoke all on table public\.cached_companies from anon, authenticated, public;/.test(mig) && /revoke all on table public\.cached_jobs from anon, authenticated, public;/.test(mig));
  ok('service_role keeps access', /grant all on table public\.cached_companies to service_role;/.test(mig) && /grant all on table public\.cached_jobs to service_role;/.test(mig));
  ok('the migration deletes no data and changes no other table',
    !/\b(delete|truncate|update)\b/i.test(mig.replace(/drop policy if exists %I/g, '')) && !/city_coords|cached_bids/.test(mig));
  ok('the self-check refuses a half-closed state', /raise exception '\[content-rights\] verify: % can still SELECT %'/.test(mig));

  const cleanRel = 'docs/ops/2026-10-03-content-rights-cleanup.sql';
  ok('the cleanup is a docs/ops file, not a migration', existsSync(join(ROOT, cleanRel)) && !readdirSync(join(ROOT, 'supabase/migrations')).some((f) => /content_rights_cleanup|content-rights-cleanup/.test(f)));
  const clean = stripSql(read(cleanRel));
  const writes = [...clean.matchAll(/^(delete from public\.\w+[^;]*;|update public\.cached_bids[\s\S]*?;)/gm)].map((m) => ({ sql: m[1], at: m.index ?? 0 }));
  ok('exactly four writes: cached_companies, cached_bids, city_coords, cached_jobs',
    writes.length === 4 && /cached_companies/.test(writes[0].sql) && /cached_bids/.test(writes[1].sql) && /city_coords/.test(writes[2].sql) && /cached_jobs/.test(writes[3].sql), writes.map((w) => w.sql.slice(0, 40)).join(' | '));
  ok('every write is preceded by its own SELECT count(*) preview',
    writes.every((w, i) => {
      const before = clean.slice(i === 0 ? 0 : writes[i - 1].at + writes[i - 1].sql.length, w.at);
      const table = /public\.(\w+)/.exec(w.sql)?.[1] ?? '';
      return new RegExp(`select count\\(\\*\\)[\\s\\S]*from public\\.${table}`, 'i').test(before);
    }));
  ok('cached_companies and cached_jobs are emptied completely', /^delete from public\.cached_companies;$/m.test(clean) && /^delete from public\.cached_jobs;$/m.test(clean));
  ok("city_coords keeps ONLY source = 'nominatim' (NULL and the 'google_geocoding' default count as Google)",
    /^delete from public\.city_coords where source is distinct from 'nominatim';$/m.test(clean));
  ok('bid coordinates survive only with an exactly matching nominatim row; everything else is nulled',
    /update public\.cached_bids b\s+set latitude = null, longitude = null\s+where \(b\.latitude is not null or b\.longitude is not null\)\s+and not exists \(\s+select 1 from public\.city_coords c\s+where c\.city = b\.city and c\.state = b\.state\s+and c\.source = 'nominatim'\s+and c\.latitude = b\.latitude and c\.longitude = b\.longitude\s+\);/.test(clean));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
