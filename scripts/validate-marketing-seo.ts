// scripts/validate-marketing-seo.ts — the marketing site's head, sitemap,
// images, accessibility, house voice and three stale claims, pinned.
//
// WHY (audit 2026-10-01). Every existing marketing validator was green while
// mageid.app shipped 10 titles over 60 characters, 22 meta descriptions over
// 160 (the homepage's was 316), a noindex page in the sitemap, sitemap dates
// frozen at 2026-05-20, a robots.txt that hid every product screenshot from
// image search, a demo page promising "video walkthroughs" that did not exist,
// a changelog three weeks behind main, a pricing FAQ with an unsourced ROI
// line, "Coming soon" bullets for features nobody is building, Title Case
// headings against docs/VOICE.md, footer links 18 px tall on a phone, no skip
// link anywhere, and ~60 images with no width or height (layout shift).
// Those were all fixed in one pass; this file keeps them fixed.
//
// Sections (each prints its own ✓ / ✗ lines):
//   1. Head contract on every INDEXABLE public page (noindex pages skipped)
//   2. sitemap.xml ↔ indexable pages, one to one; lastmod dates sane
//   3. robots.txt: the Sitemap line, and product screenshots crawlable
//   4. Images: alt + width + height + decoding; real aspect ratio for
//      screenshots (PNG IHDR); one fetchpriority=high, the rest lazy
//   5. Accessibility: skip link + #main, focus ring, 24 px footer targets
//   6. VOICE (docs/VOICE.md) over the prose of indexable pages, legal exempt
//   7. Claims: demo has no video promise; pricing caps equal app/paywall.tsx
//      AI_LIMITS and the four retired phrases stay gone; changelog is current
//   0. NEGATIVE FIXTURES: each breaks one rule and must be caught. A fixture
//      that passes clean means a check went blind, and the run exits 1.
//
// Run: bun run scripts/validate-marketing-seo.ts
// Other lanes import the pure helpers (publicPages, isIndexable, headProblems,
// imgProblems, voiceProblems, proseOf); the checks run only as the entry point.
import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKETING = join(ROOT, 'marketing');

// ── Shared parsing helpers ──────────────────────────────────────────────────

/** Public pages: same skip set as validate-marketing-claims publicPages(). */
export function publicPages(root: string = MARKETING, out: string[] = []): string[] {
  for (const e of readdirSync(root).sort()) {
    if (e === 'dist' || e === 'screenshots' || e === 'app-store-screenshots' || e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(root, e);
    if (statSync(p).isDirectory()) publicPages(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', hellip: '…', times: '×',
  rarr: '→', larr: '←', darr: '↓', uarr: '↑', check: '✓', copy: '©', reg: '®', trade: '™',
  bull: '•', deg: '°', frac12: '½', plusmn: '±', le: '≤', ge: '≥', minus: '−', thinsp: ' ', ensp: ' ', emsp: ' ',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML with comments, <script>, <style>, <template> and <noscript> removed. */
export function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
}

/** The visible words of a page: no scripts, styles, comments or tags. */
export function proseOf(html: string): string {
  return decodeEntities(stripNonContent(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[1] ?? m[2]) : undefined;
}
function hasAttr(tag: string, name: string): boolean {
  return new RegExp(`\\s${name}(\\s*=|\\s|/?>)`, 'i').test(tag);
}
function metaContent(html: string, key: string): string | undefined {
  for (const t of stripNonContent(html).match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(t, 'name') === key || attr(t, 'property') === key) return attr(t, 'content');
  }
  return undefined;
}
function titleOf(html: string): string[] {
  return [...stripNonContent(html).matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map(m => decodeEntities(m[1]).replace(/\s+/g, ' ').trim());
}
function headOf(html: string): string {
  return /<head\b[\s\S]*?<\/head>/i.exec(html)?.[0] ?? '';
}

/** false when <meta name="robots"> contains noindex. */
export function isIndexable(html: string): boolean {
  const robots = metaContent(html, 'robots');
  return !(robots && /noindex/i.test(robots));
}

const SITE = 'https://mageid.app';
const LEGAL = new Set(['privacy.html', 'terms.html', 'do-not-sell.html']);
const PRIMARY_NAV = /class="[^"]*\b(nav-inner|navlinks|nav-r)\b/;

// ── 1. Head contract ─────────────────────────────────────────────────────────
export function headProblems(html: string, rel: string): string[] {
  const p: string[] = [];
  const say = (s: string) => p.push(`${rel}: ${s}`);
  if (!/<html\b[^>]*\slang="en"/i.test(html)) say('<html lang="en"> is missing');
  if (!metaContent(html, 'viewport')) say('no viewport meta');
  const titles = titleOf(html);
  if (titles.length !== 1) say(`expected one <title>, found ${titles.length}`);
  const title = titles[0] ?? '';
  if (!title) say('empty <title>');
  else if ([...title].length > 60) say(`<title> is ${[...title].length} characters (max 60): "${title}"`);
  const desc = decodeEntities(metaContent(html, 'description') ?? '');
  const dl = [...desc].length;
  if (!desc) say('no meta description');
  else if (dl < 70 || dl > 160) say(`meta description is ${dl} characters (70-160): "${desc.slice(0, 80)}…"`);
  const canon = /<link\b[^>]*rel="canonical"[^>]*>/i.exec(stripNonContent(html))?.[0];
  const href = canon ? attr(canon, 'href') : undefined;
  if (!href || !href.startsWith(`${SITE}/`)) say(`canonical must be an absolute ${SITE}/… URL (got ${href ?? 'none'})`);
  const ogUrl = metaContent(html, 'og:url');
  if (ogUrl !== href) say(`og:url (${ogUrl ?? 'none'}) must equal the canonical (${href ?? 'none'})`);
  const ogTitle = decodeEntities(metaContent(html, 'og:title') ?? '');
  const shortTitle = title.replace(/\s+[—|-]\s+MAGE ID$/, '');
  if (!ogTitle) say('no og:title');
  else if (ogTitle !== title && ogTitle !== shortTitle) say(`og:title "${ogTitle}" is neither the <title> nor the <title> without " — MAGE ID"`);
  const ogDesc = decodeEntities(metaContent(html, 'og:description') ?? '');
  if (!ogDesc) say('no og:description');
  else if ([...ogDesc].length > 160) say(`og:description is ${[...ogDesc].length} characters (max 160)`);
  const twTitle = metaContent(html, 'twitter:title');
  if (twTitle !== undefined && decodeEntities(twTitle) !== ogTitle) say(`twitter:title "${twTitle}" drifted from og:title`);
  const twDesc = metaContent(html, 'twitter:description');
  if (twDesc !== undefined && decodeEntities(twDesc) !== ogDesc) say('twitter:description drifted from og:description');
  const ogImage = metaContent(html, 'og:image') ?? '';
  if (!/^https:\/\/mageid\.app\/assets\/og-image\.png\?v=[^"\s]+$/.test(ogImage)) say(`og:image must be ${SITE}/assets/og-image.png?v=<shared> (got ${ogImage || 'none'})`);
  if (metaContent(html, 'twitter:card') !== 'summary_large_image') say('twitter:card must be summary_large_image');
  const body = stripNonContent(html);
  const h1 = (body.match(/<h1\b/gi) ?? []).length;
  if (h1 !== 1) say(`expected exactly one <h1>, found ${h1}`);
  p.push(...skipLinkProblems(html, rel));
  return p;
}

export function skipLinkProblems(html: string, rel: string): string[] {
  const p: string[] = [];
  const body = stripNonContent(html);
  const afterBody = /<body\b[^>]*>\s*(<a\b[^>]*>)/i.exec(body)?.[1] ?? '';
  if (!(attr(afterBody, 'class') ?? '').split(/\s+/).includes('skip-link') || attr(afterBody, 'href') !== '#main') {
    p.push(`${rel}: the first child of <body> must be <a class="skip-link" href="#main">`);
  }
  const ids = (body.match(/\sid="main"/g) ?? []).length;
  if (ids !== 1) p.push(`${rel}: expected exactly one element with id="main", found ${ids}`);
  return p;
}

// ── 4. Images ───────────────────────────────────────────────────────────────
const sizeCache = new Map<string, { w: number; h: number } | null>();
export function pngSize(file: string): { w: number; h: number } | null {
  if (sizeCache.has(file)) return sizeCache.get(file)!;
  let out: { w: number; h: number } | null = null;
  try {
    const fd = openSync(file, 'r');
    const b = Buffer.alloc(24);
    readSync(fd, b, 0, 24, 0);
    closeSync(fd);
    // PNG signature, then the IHDR chunk: width at 16-19, height at 20-23, big-endian.
    if (b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') out = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch { out = null; }
  sizeCache.set(file, out);
  return out;
}

export function imgProblems(html: string, rel: string, root: string = MARKETING): string[] {
  const p: string[] = [];
  const imgs = stripNonContent(html).match(/<img\b[^>]*>/gi) ?? [];
  let high = 0;
  imgs.forEach((tag, i) => {
    const src = attr(tag, 'src') ?? '';
    const who = `${rel}: <img src="${src}">`;
    if (!hasAttr(tag, 'alt')) p.push(`${who} has no alt`);
    const w = Number(attr(tag, 'width')), h = Number(attr(tag, 'height'));
    if (!(w > 0) || !(h > 0)) p.push(`${who} needs numeric width and height (layout shift)`);
    if (attr(tag, 'decoding') !== 'async') p.push(`${who} needs decoding="async"`);
    const isHigh = attr(tag, 'fetchpriority') === 'high';
    if (isHigh) {
      high++;
      if (i !== 0) p.push(`${who} carries fetchpriority="high" but is not the page's first image`);
      if (attr(tag, 'loading') === 'lazy') p.push(`${who} is fetchpriority="high" and lazy at once`);
    } else if (attr(tag, 'loading') !== 'lazy') {
      p.push(`${who} needs loading="lazy" (only the first image may load eagerly, with fetchpriority="high")`);
    }
    if (src.startsWith('/screenshots/screens/') && w > 0 && h > 0) {
      const file = join(root, src.split(/[?#]/)[0].slice(1));
      const real = /\.png$/i.test(file) && existsSync(file) ? pngSize(file) : null;
      if (!real) p.push(`${who}: cannot read the PNG size of ${relative(ROOT, file)}`);
      else {
        const drift = Math.abs(w / h - real.w / real.h) / (real.w / real.h);
        if (drift > 0.02) p.push(`${who}: width/height ${w}x${h} is ${(drift * 100).toFixed(1)}% off the file's ${real.w}x${real.h}`);
      }
    }
  });
  if (high > 1) p.push(`${rel}: ${high} images carry fetchpriority="high" (max 1)`);
  return p;
}

// ── 6. VOICE ────────────────────────────────────────────────────────────────
type VoiceRule = { id: string; re: RegExp; why: string };
const VOICE_RULES: VoiceRule[] = [
  { id: 'bang', re: /[A-Za-z0-9)]!(?![=\w])/g, why: 'no exclamation marks in prose (VOICE)' },
  { id: 'coming-soon', re: /coming soon|\bcoming\s*·/gi, why: 'say what exists today; drop the promise (a dated "Coming · FY26" badge too)' },
  { id: 'honest', re: /\bhonest(ly)?\b/gi, why: 'meta-honesty (VOICE §11): state the fact instead' },
  { id: 'real-data', re: /\breal data\b/gi, why: 'meta-honesty (VOICE §11)' },
  { id: 'magic', re: /\bmagic\b/gi, why: 'banned word (VOICE)' },
  { id: 'simply', re: /\bsimply\b/gi, why: 'banned word (VOICE)' },
  { id: 'just-start', re: /(?:^|[.?!:]\s+)Just\s/g, why: '"Just" at the start of a sentence (VOICE)' },
  { id: 'all-in-one', re: /\ball-in-one\b/gi, why: 'banned unless about another vendor (ALLOW list)' },
  { id: 'dfr', re: /\bDFRs?\b/g, why: 'the VOICE glossary word is "daily report"' },
  { id: 'daily-log', re: /\bdaily logs?\b/gi, why: 'the VOICE glossary word is "daily report" (a competitor\'s own feature name goes on the ALLOW list)' },
  { id: 'pronoun', re: /\b(he|his|him|she|her)\b/gi, why: 'no gendered pronoun for a user, client, sub or crew member' },
  { id: 'bid-confidence', re: /\bBid Confidence\b/g, why: 'the app says "bid confidence" (components/BidConfidenceBadge.tsx)' },
];

/** Hits that stay, each with its reason. `contains` must appear in the hit's context. */
export const VOICE_ALLOW: { rel: string; rule: string; contains: string; reason: string }[] = [
  { rel: 'who-built-this.html', rule: 'pronoun', contains: 'he disappears', reason: 'quotes a buyer\'s fear about the named founder, not a user' },
  { rel: 'switch.html', rule: 'daily-log', contains: 'Schedule, Daily Logs and Documents', reason: 'names Buildertrend\'s own export modules, which is how a leaving customer finds them in Buildertrend' },
  { rel: 'changelog.html', rule: 'honest', contains: 'run twelve honestly', reason: 'the DCMA item in "Building now" is pinned by validate-marketing-claims and is out of this lane (WEBFIX spec: leave it as it is)' },
];

export function voiceProblems(text: string, rel: string): string[] {
  const p: string[] = [];
  for (const rule of VOICE_RULES) {
    for (const m of text.matchAll(rule.re)) {
      const at = m.index ?? 0;
      const ctx = text.slice(Math.max(0, at - 60), at + m[0].length + 60);
      if (VOICE_ALLOW.some(a => a.rel === rel && a.rule === rule.id && ctx.includes(a.contains))) continue;
      p.push(`${rel}: [${rule.id}] "…${ctx.trim()}…" — ${rule.why}`);
    }
  }
  return p;
}

// Proper nouns and product names that keep their capitals in a sentence-case
// heading. Spec list (M6) first, then names of real products, places and
// languages the site already uses.
const PROPER_PHRASES = [
  'MAGE ID', 'Houzz Pro', 'Cost X-Ray', 'Home Passport', 'Ask MAGE', 'Last Planner', 'SAM.gov', 'QuickBooks Online',
  'Microsoft Project', 'MS Project', 'App Store', 'New York', 'New Jersey', 'Baltimore City', 'Baltimore County',
  'Price Index', 'Sherwin Williams',
];
const PROPER_WORDS = new Set([
  'Pro', 'Business', 'Enterprise', 'Free', 'Procore', 'Buildertrend', 'JobTread', 'Houzz', 'QuickBooks', 'Knowify',
  'CoConstruct', 'TestFlight', 'Stripe', 'Gantt', 'Excel', 'Apple', 'Google', 'Android', 'Netlify', 'English', 'Spanish',
  'Connecticut', 'Baltimore', 'MAGE', 'I', 'Copilot',
]);
const isAcronym = (w: string) => { const b = w.replace(/s$/, ''); return b.length >= 2 && b === b.toUpperCase() && /[A-Z]/.test(b); };
const isProper = (w: string) => {
  const base = w.replace(/[’']s$/, '');
  const head = base.split('-')[0];
  return PROPER_WORDS.has(base) || PROPER_WORDS.has(head) || isAcronym(base) || isAcronym(head);
};

/** Title Case words in one heading: capitalised words after each segment's first that are not proper nouns. */
export function titleCaseWords(text: string): string[] {
  // A proper phrase becomes a lowercase placeholder, so the word after it is
  // still counted ("Houzz Pro Alternative" → "propername Alternative").
  let t = ` ${text} `.replace(/\b(vs|e\.g|i\.e|etc)\./g, '$1');
  for (const ph of PROPER_PHRASES) t = t.split(ph).join('propername');
  const out: string[] = [];
  for (const seg of t.split(/[.?!:;]\s+|\s[—–|·→]\s|^\s*\d+\.\s/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    words.slice(1).forEach((raw) => {
      const w = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (!/^[A-Z]/.test(w)) return;
      if (isProper(w)) return;
      out.push(w);
    });
  }
  return out;
}

export function titleCaseProblems(html: string, rel: string): string[] {
  const p: string[] = [];
  const body = stripNonContent(html);
  const heads = [...titleOf(html).map(t => ({ tag: 'title', t })),
    ...[...body.matchAll(/<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m => ({ tag: m[1].toLowerCase(), t: decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() }))];
  for (const { tag, t } of heads) {
    const caps = titleCaseWords(t);
    if (caps.length >= 2) p.push(`${rel}: <${tag}> "${t}" is Title Case (${caps.join(', ')}) — sentence case per VOICE`);
  }
  return p;
}

// ── 2/3. Sitemap and robots ─────────────────────────────────────────────────
export function urlToFile(loc: string, root: string = MARKETING): string | null {
  if (!loc.startsWith(`${SITE}/`)) return null;
  const path = loc.slice(SITE.length + 1);
  return join(root, path === '' || path.endsWith('/') ? `${path}index.html` : path);
}
export function fileToUrl(file: string, root: string = MARKETING): string {
  const rel = relative(root, file).split('\\').join('/');
  return `${SITE}/${rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel}`;
}

export function sitemapProblems(xml: string, root: string = MARKETING, today: string = localDate(new Date())): string[] {
  const p: string[] = [];
  // "--" inside an XML comment makes the whole file unparseable, and a
  // crawler that cannot parse the sitemap reads none of it.
  for (const c of xml.match(/<!--[\s\S]*?-->/g) ?? []) {
    if (/--/.test(c.slice(4, -3))) p.push(`sitemap: an XML comment contains "--" and breaks the file: "${c.slice(4, 60).trim()}…"`);
  }
  const entries = [...stripNonContent(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => ({
    loc: /<loc>([^<]*)<\/loc>/.exec(m[1])?.[1]?.trim() ?? '',
    lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(m[1])?.[1]?.trim() ?? '',
  }));
  const listed = new Set<string>();
  for (const { loc, lastmod } of entries) {
    const file = urlToFile(loc, root);
    if (!file || !existsSync(file)) { p.push(`sitemap: ${loc} maps to no file`); continue; }
    if (listed.has(loc)) p.push(`sitemap: ${loc} is listed twice`);
    listed.add(loc);
    if (!isIndexable(readFileSync(file, 'utf8'))) p.push(`sitemap: ${loc} is a noindex page and must not be listed`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod) || Number.isNaN(Date.parse(lastmod))) p.push(`sitemap: ${loc} has lastmod "${lastmod}" (want YYYY-MM-DD)`);
    else if (lastmod > today) p.push(`sitemap: ${loc} lastmod ${lastmod} is in the future (today ${today})`);
  }
  for (const f of publicPages(root)) {
    if (!isIndexable(readFileSync(f, 'utf8'))) continue;
    const url = fileToUrl(f, root);
    if (!listed.has(url)) p.push(`sitemap: indexable page ${relative(root, f)} is missing (${url})`);
  }
  return p;
}

export function robotsProblems(txt: string): string[] {
  const p: string[] = [];
  if (!/^Sitemap: https:\/\/mageid\.app\/sitemap\.xml\s*$/m.test(txt)) p.push('robots.txt: no "Sitemap: https://mageid.app/sitemap.xml" line');
  if (!/^Allow: \/screenshots\/screens\/\s*$/m.test(txt)) p.push('robots.txt: "Allow: /screenshots/screens/" is missing — 19 public pages embed those product images');
  return p;
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 5. Accessibility rules in the shared CSS ────────────────────────────────
export function a11yCssProblems(css: string, where: string, needFnav = false): string[] {
  const p: string[] = [];
  if (!/\.skip-link\s*\{[^}]*left:\s*-9999px/.test(css)) p.push(`${where}: no .skip-link rule that parks it off-screen`);
  if (!/\.skip-link:focus\s*\{[^}]*left:/.test(css)) p.push(`${where}: no .skip-link:focus rule that brings it back`);
  if (!/:focus-visible\s*\{[^}]*outline:\s*2px solid/.test(css)) p.push(`${where}: no :focus-visible outline rule`);
  const target = /([^{}]*)\{[^}]*min-height:\s*24px[^}]*\}/.exec(css);
  if (!target || !/footer a|\.footer-cols a|\.fnav a|\.footnav a/.test(target[1]) || !/\.trust-strip a/.test(target[1])) p.push(`${where}: no rule giving footer and trust-strip links min-height:24px`);
  if (needFnav && !(target && /\.fnav a/.test(target[1]))) p.push(`${where}: the 24px rule must also cover footer .fnav a`);
  return p;
}

// ── 7. Claims ───────────────────────────────────────────────────────────────
export function demoProblems(html: string): string[] {
  const p: string[] = [];
  const head = headOf(html).match(/<(title|meta)\b[^>]*>(?:[^<]*<\/title>)?/gi)?.join(' ') ?? '';
  for (const [where, text] of [['head', decodeEntities(head)], ['prose', proseOf(html)]] as const) {
    const m = /video|90-second|15-minute/i.exec(text);
    if (m) p.push(`demo.html ${where}: "${text.slice(Math.max(0, m.index - 40), m.index + 40)}" promises a recording that does not exist`);
  }
  return p;
}

type CapRow = { business: number; enterprise: number };
export function aiLimitsFrom(paywallSrc: string): Record<string, CapRow> {
  const out: Record<string, CapRow> = {};
  const block = /const AI_LIMITS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(paywallSrc)?.[1] ?? '';
  for (const m of block.matchAll(/label:\s*'([^']+)'[^}]*?business:\s*'([^']+)'[^}]*?enterprise:\s*'([^']+)'/g)) {
    const key = /^Daily AI/.test(m[1]) ? 'daily' : /^Advanced/.test(m[1]) ? 'advanced' : /^Drawing/.test(m[1]) ? 'drawing'
      : /^Photo analyses/.test(m[1]) ? 'photo' : /^PDF takeoff/.test(m[1]) ? 'pdf' : m[1];
    out[key] = { business: Number(m[2]), enterprise: Number(m[3]) };
  }
  return out;
}

export function pricingProblems(html: string, paywallSrc: string): string[] {
  const p: string[] = [];
  const prose = proseOf(html);
  const banned = /steepest|pay for itself|magic link|multi-office|on Biz\b/i.exec(prose);
  if (banned) p.push(`pricing.html: "${banned[0]}" is back ("${prose.slice(Math.max(0, banned.index - 40), banned.index + 40)}")`);
  const caps = aiLimitsFrom(paywallSrc);
  const need = ['daily', 'advanced', 'drawing', 'photo', 'pdf'];
  const missingRows = need.filter(k => !caps[k] || !Number.isFinite(caps[k].business) || !Number.isFinite(caps[k].enterprise));
  if (missingRows.length) { p.push(`app/paywall.tsx AI_LIMITS: could not read ${missingRows.join(', ')} — the parser is blind`); return p; }
  const card: [string, RegExp][] = [
    ['daily', /<strong>(\d+)<\/strong> daily AI requests\s*<span[^>]*>\(vs (\d+) on Business\)/],
    ['advanced', /<strong>(\d+)<\/strong> advanced AI calls \/ day\s*<span[^>]*>\(vs (\d+)\)/],
    ['drawing', /<strong>(\d+)<\/strong> drawing analyses \/ mo\s*<span[^>]*>\(vs (\d+)\)/],
    ['photo', /<strong>(\d+)<\/strong> photo analyses \/ mo\s*<span[^>]*>\(vs (\d+)\)/],
    ['pdf', /<strong>(\d+)<\/strong> PDF takeoff pages \/ mo\s*<span[^>]*>\(vs (\d+)\)/],
  ];
  for (const [k, re] of card) {
    const m = re.exec(html);
    if (!m) { p.push(`pricing.html Enterprise card: the ${k} line is missing or reworded`); continue; }
    if (Number(m[1]) !== caps[k].enterprise) p.push(`pricing.html Enterprise card: ${k} says ${m[1]}, AI_LIMITS says ${caps[k].enterprise}`);
    if (Number(m[2]) !== caps[k].business) p.push(`pricing.html Enterprise card: ${k} "(vs ${m[2]})", AI_LIMITS Business says ${caps[k].business}`);
  }
  const faq = /Enterprise raises the caps to (\d+) AI requests a day, (\d+) drawing analyses and (\d+) photo analyses a month/.exec(prose);
  if (!faq) p.push('pricing.html FAQ: the Business vs Enterprise caps sentence is missing or reworded');
  else {
    const [d, dr, ph] = [Number(faq[1]), Number(faq[2]), Number(faq[3])];
    if (d !== caps.daily.enterprise || dr !== caps.drawing.enterprise || ph !== caps.photo.enterprise) {
      p.push(`pricing.html FAQ: ${d}/${dr}/${ph} vs AI_LIMITS Enterprise ${caps.daily.enterprise}/${caps.drawing.enterprise}/${caps.photo.enterprise}`);
    }
  }
  return p;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function parseDay(s: string): number | null {
  const m = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2]);
  return mo < 0 ? null : Date.UTC(Number(m[3]), mo, Number(m[1]));
}
const DAY = 86_400_000;

export function changelogProblems(html: string, lastCommit?: string, today: string = localDate(new Date())): string[] {
  const p: string[] = [];
  const upd = /Last updated (\d{1,2} [A-Z][a-z]+ \d{4})/.exec(html);
  const updated = upd ? parseDay(upd[1]) : null;
  if (updated === null) { p.push('changelog.html: no parseable "Last updated <d> <Month> <yyyy>"'); return p; }
  const dates = [...html.matchAll(/<span class="log-date">([^<]+)<\/span>/g)].map(m => parseDay(m[1]));
  if (dates.length === 0 || dates.some(d => d === null)) { p.push('changelog.html: Shipped entry dates missing or unparseable'); return p; }
  const newest = Math.max(...(dates as number[]));
  if (updated < newest) p.push(`changelog.html: "Last updated" is older than its own newest entry`);
  if (newest - updated > 30 * DAY) p.push('changelog.html: "Last updated" is more than 30 days older than the newest Shipped entry');
  const t = Date.parse(`${today}T00:00:00Z`);
  if (updated > t + DAY) p.push(`changelog.html: "Last updated ${upd![1]}" is in the future`);
  if (lastCommit) {
    const c = Date.parse(`${lastCommit}T00:00:00Z`);
    if (c - updated > 30 * DAY) p.push(`changelog.html: "Last updated ${upd![1]}" is more than 30 days older than the file's last commit (${lastCommit})`);
  }
  for (let i = 1; i < dates.length; i++) if ((dates[i] as number) > (dates[i - 1] as number)) { p.push('changelog.html: Shipped entries are not newest first'); break; }
  return p;
}

// ── 0. Negative fixtures ────────────────────────────────────────────────────
const OK_HEAD = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width" />
<title>Scheduling and Gantt with critical path — MAGE ID</title>
<link rel="canonical" href="https://mageid.app/features/scheduling.html" />
<meta name="description" content="Gantt scheduling with critical path, float, milestones and a schedule health check, built for general contractors." />
<meta property="og:title" content="Scheduling and Gantt with critical path" />
<meta property="og:description" content="Gantt scheduling with critical path and float." />
<meta property="og:url" content="https://mageid.app/features/scheduling.html" />
<meta property="og:image" content="https://mageid.app/assets/og-image.png?v=x" />
<meta name="twitter:card" content="summary_large_image" /></head>
<body><a class="skip-link" href="#main">Skip to content</a><main id="main"><h1>Scheduling</h1></main></body></html>`;
const OK_IMG = '<body><img src="/assets/logo-mark-light.png" alt="" width="32" height="32" decoding="async" fetchpriority="high" /><img src="/screenshots/screens/17-takeoff.png" alt="x" width="1290" height="2796" decoding="async" loading="lazy" /></body>';
const OK_PAYWALL = `const AI_LIMITS: AILimitRow[] = [
  { label: 'Daily AI requests', free: '5', pro: '30', business: '80', enterprise: '150' },
  { label: 'Advanced AI / day', free: '—', pro: '6', business: '18', enterprise: '40' },
  { label: 'Drawing analyses /mo', free: '—', pro: '15', business: '50', enterprise: '100' },
  { label: 'Photo analyses /mo', free: '—', pro: '50', business: '150', enterprise: '200' },
  { label: 'PDF takeoff pages /mo', free: '—', pro: '30', business: '100', enterprise: '300' },
];`;
const OK_PRICING = `<li><strong>150</strong> daily AI requests <span>(vs 80 on Business)</span></li>
<li><strong>40</strong> advanced AI calls / day <span>(vs 18)</span></li>
<li><strong>100</strong> drawing analyses / mo <span>(vs 50)</span></li>
<li><strong>200</strong> photo analyses / mo <span>(vs 150)</span></li>
<li><strong>300</strong> PDF takeoff pages / mo <span>(vs 100)</span></li>
<p>Enterprise raises the caps to 150 AI requests a day, 100 drawing analyses and 200 photo analyses a month.</p>`;
const OK_CHANGELOG = '<p class="updated">Last updated 1 October 2026</p><span class="log-date">30 September 2026</span><span class="log-date">7 September 2026</span>';

// Each fixture breaks ONE rule of a clean input, and `expect` names the
// problem that rule must report — so a fixture cannot pass on the back of a
// different check (the first draft's title fixture did exactly that: with the
// 60-character limit mutated away it still "failed", on og:title drift).
export const FIXTURES: { name: string; expect: RegExp; run: () => string[] }[] = [
  { name: 'title over 60 characters', expect: /<title> is \d+ characters/, run: () => headProblems(OK_HEAD.replace(/<title>[^<]*/, '<title>Scheduling and Gantt with critical path, float and health checks — MAGE ID').replace(/(og:title" content=")[^"]*/, '$1Scheduling and Gantt with critical path, float and health checks'), 'fx') },
  { name: 'missing meta description', expect: /no meta description/, run: () => headProblems(OK_HEAD.replace(/<meta name="description"[^>]*>/, ''), 'fx') },
  { name: 'description under 70 characters', expect: /meta description is \d+ characters/, run: () => headProblems(OK_HEAD.replace(/(name="description" content=")[^"]*/, '$1Gantt scheduling.'), 'fx') },
  { name: 'description over 160 characters', expect: /meta description is \d+ characters/, run: () => headProblems(OK_HEAD.replace(/(name="description" content=")[^"]*/, `$1${'Gantt scheduling with critical path. '.repeat(5)}`), 'fx') },
  { name: 'og:url differs from canonical', expect: /og:url .* must equal the canonical/, run: () => headProblems(OK_HEAD.replace('og:url" content="https://mageid.app/features/scheduling.html', 'og:url" content="https://mageid.app/'), 'fx') },
  { name: 'og:title drifts from <title>', expect: /og:title .* is neither/, run: () => headProblems(OK_HEAD.replace(/(og:title" content=")[^"]*/, '$1A brain for your business'), 'fx') },
  { name: 'og:image off the shared asset', expect: /og:image must be/, run: () => headProblems(OK_HEAD.replace('assets/og-image.png?v=x', 'assets/hero.png'), 'fx') },
  { name: 'no twitter:card', expect: /twitter:card must be/, run: () => headProblems(OK_HEAD.replace(/<meta name="twitter:card"[^>]*>/, ''), 'fx') },
  { name: 'two <h1>', expect: /exactly one <h1>/, run: () => headProblems(OK_HEAD.replace('</main>', '<h1>Again</h1></main>'), 'fx') },
  { name: 'no skip link', expect: /first child of <body> must be/, run: () => headProblems(OK_HEAD.replace(/<a class="skip-link"[^>]*>[^<]*<\/a>/, ''), 'fx') },
  { name: 'skip link with no #main', expect: /id="main", found 0/, run: () => headProblems(OK_HEAD.replace(' id="main"', ''), 'fx') },
  { name: 'noindex page in a sitemap fixture', expect: /noindex page and must not be listed/, run: () => sitemapProblems('<urlset><url><loc>https://mageid.app/do-not-sell.html</loc><lastmod>2026-10-01</lastmod></url></urlset>') },
  { name: 'indexable page missing from a sitemap fixture', expect: /indexable page pricing\.html is missing/, run: () => sitemapProblems('<urlset><url><loc>https://mageid.app/</loc><lastmod>2026-10-01</lastmod></url></urlset>') },
  { name: 'sitemap comment with a double hyphen', expect: /XML comment contains "--"/, run: () => sitemapProblems('<!-- run git log --format=%cs --><urlset></urlset>') },
  { name: 'sitemap lastmod in the future', expect: /is in the future/, run: () => sitemapProblems('<urlset><url><loc>https://mageid.app/pricing.html</loc><lastmod>2999-01-01</lastmod></url></urlset>') },
  { name: 'robots.txt without the screens Allow', expect: /Allow: \/screenshots\/screens\/" is missing/, run: () => robotsProblems('Disallow: /screenshots/\nSitemap: https://mageid.app/sitemap.xml\n') },
  { name: 'img without width', expect: /needs numeric width and height/, run: () => imgProblems(OK_IMG.replace('width="1290" ', ''), 'fx') },
  { name: 'img without alt', expect: /has no alt/, run: () => imgProblems(OK_IMG.replace('alt="x" ', ''), 'fx') },
  { name: 'img without decoding="async"', expect: /needs decoding="async"/, run: () => imgProblems(OK_IMG.replace(' decoding="async" loading', ' loading'), 'fx') },
  { name: 'screenshot with the wrong aspect ratio', expect: /% off the file's/, run: () => imgProblems(OK_IMG.replace('height="2796"', 'height="1290"'), 'fx') },
  { name: 'second image eager', expect: /needs loading="lazy"/, run: () => imgProblems(OK_IMG.replace('loading="lazy"', ''), 'fx') },
  { name: 'two fetchpriority="high"', expect: /is not the page's first image/, run: () => imgProblems(OK_IMG.replace('loading="lazy"', 'fetchpriority="high"'), 'fx') },
  { name: '"Coming soon!" in prose', expect: /\[coming-soon\]/, run: () => voiceProblems(proseOf('<p>Lien waivers in the portal. Coming soon!</p>'), 'fx') },
  { name: 'exclamation mark in prose', expect: /\[bang\]/, run: () => voiceProblems('Pull over (safely!), tap the mic.', 'fx') },
  { name: 'a dated "Coming · FY26" badge', expect: /\[coming-soon\]/, run: () => voiceProblems('AI schedule risk forecast Coming · FY26', 'fx') },
  { name: '"honestly" in prose', expect: /\[honest\]/, run: () => voiceProblems('We price it honestly.', 'fx') },
  { name: '"real data" in prose', expect: /\[real-data\]/, run: () => voiceProblems('It pulls from your real data.', 'fx') },
  { name: '"magic link" in prose', expect: /\[magic\]/, run: () => voiceProblems('Your client gets a magic link.', 'fx') },
  { name: '"simply" in prose', expect: /\[simply\]/, run: () => voiceProblems('A basic app simply does not ship it.', 'fx') },
  { name: '"Just" at sentence start', expect: /\[just-start\]/, run: () => voiceProblems("Don't open a form. Just dictate it.", 'fx') },
  { name: '"all-in-one" in prose', expect: /\[all-in-one\]/, run: () => voiceProblems('The all-in-one app for builders.', 'fx') },
  { name: '"DFR" in prose', expect: /\[dfr\]/, run: () => voiceProblems('Hands-free DFR.', 'fx') },
  { name: '"daily log" in prose', expect: /\[daily-log\]/, run: () => voiceProblems('Write the daily log from your phone.', 'fx') },
  { name: '"he" for a sub', expect: /\[pronoun\]/, run: () => voiceProblems('The sub signs when he gets the link.', 'fx') },
  { name: '"Bid Confidence" in running text', expect: /\[bid-confidence\]/, run: () => voiceProblems('Every bid gets a Bid Confidence score.', 'fx') },
  { name: '"Daily Field Report" heading', expect: /is Title Case \(Field, Report\)/, run: () => titleCaseProblems('<h3>Daily Field Report</h3>', 'fx') },
  { name: 'Title Case after a proper noun', expect: /is Title Case \(Alternative, Contractors\)/, run: () => titleCaseProblems('<title>Houzz Pro Alternative for Contractors (2026) — MAGE ID</title>', 'fx') },
  { name: 'Bid Confidence in a numbered heading', expect: /is Title Case \(Bid, Confidence\)/, run: () => titleCaseProblems('<h3>2. Your next estimate gets a Bid Confidence score</h3>', 'fx') },
  { name: 'pricing text "(vs 80 on Biz)"', expect: /"on Biz" is back/, run: () => pricingProblems(OK_PRICING.replace('on Business', 'on Biz'), OK_PAYWALL) },
  { name: 'pricing Enterprise cap drifts from AI_LIMITS', expect: /photo says 250, AI_LIMITS says 200/, run: () => pricingProblems(OK_PRICING.replace('<strong>200</strong>', '<strong>250</strong>'), OK_PAYWALL) },
  { name: 'pricing Business cap drifts from AI_LIMITS', expect: /AI_LIMITS Business says 18/, run: () => pricingProblems(OK_PRICING.replace('(vs 18)', '(vs 20)'), OK_PAYWALL) },
  { name: 'pricing FAQ caps drift from AI_LIMITS', expect: /pricing\.html FAQ: 150\/90\/200/, run: () => pricingProblems(OK_PRICING.replace('100 drawing analyses and', '90 drawing analyses and'), OK_PAYWALL) },
  { name: 'pricing "pay for itself"', expect: /"pay for itself" is back/, run: () => pricingProblems(`${OK_PRICING}<p>Enterprise will pay for itself in time saved.</p>`, OK_PAYWALL) },
  { name: 'pricing "steepest"', expect: /"steepest" is back/, run: () => pricingProblems(`${OK_PRICING}<p>Enterprise's discount is the steepest.</p>`, OK_PAYWALL) },
  { name: 'pricing "multi-office"', expect: /"multi-office" is back/, run: () => pricingProblems(`${OK_PRICING}<p>Sized for a typical multi-office GC.</p>`, OK_PAYWALL) },
  { name: 'paywall source the parser cannot read', expect: /the parser is blind/, run: () => pricingProblems(OK_PRICING, 'const AI_LIMITS = [\n];') },
  { name: 'demo head "video walkthroughs"', expect: /demo\.html head/, run: () => demoProblems('<head><title>See how it works · video walkthroughs</title></head><body></body>') },
  { name: 'demo prose "90-second tour"', expect: /demo\.html prose/, run: () => demoProblems('<head><title>See how it works</title></head><body><p>Watch the 90-second tour.</p></body>') },
  { name: 'demo description "15-minute walkthrough"', expect: /demo\.html head/, run: () => demoProblems('<head><meta name="description" content="A full 15-minute walkthrough." /></head><body></body>') },
  { name: 'changelog Last updated 40 days behind its newest entry', expect: /more than 30 days older than the newest/, run: () => changelogProblems(OK_CHANGELOG.replace('1 October 2026', '20 August 2026'), undefined, '2026-10-01') },
  { name: 'changelog Last updated 40 days behind its last commit', expect: /older than the file's last commit/, run: () => changelogProblems(OK_CHANGELOG, '2026-11-15', '2026-11-15') },
  { name: 'changelog Last updated in the future', expect: /is in the future/, run: () => changelogProblems(OK_CHANGELOG.replace('1 October 2026', '1 October 2027'), undefined, '2026-10-01') },
  { name: 'stylesheet without the skip link rule', expect: /no \.skip-link rule/, run: () => a11yCssProblems(':where(a):focus-visible{outline:2px solid red} footer a,.trust-strip a{min-height:24px}', 'fx') },
  { name: 'stylesheet without a focus ring', expect: /no :focus-visible outline rule/, run: () => a11yCssProblems('.skip-link{left:-9999px}.skip-link:focus{left:16px} footer a,.trust-strip a{min-height:24px}', 'fx') },
  { name: 'stylesheet without 24px footer targets', expect: /min-height:24px/, run: () => a11yCssProblems('.skip-link{left:-9999px}.skip-link:focus{left:16px}:where(a):focus-visible{outline:2px solid red}', 'fx') },
  { name: 'index style without the .fnav target', expect: /must also cover footer \.fnav a/, run: () => a11yCssProblems('.skip-link{left:-9999px}.skip-link:focus{left:16px}:where(a):focus-visible{outline:2px solid red} footer a,.trust-strip a{min-height:24px}', 'fx', true) },
];
// The fixtures must be able to pass too, or "every fixture fails" proves nothing.
export const CLEAN_FIXTURES: { name: string; run: () => string[] }[] = [
  { name: 'clean head', run: () => headProblems(OK_HEAD, 'fx') },
  { name: 'clean images', run: () => imgProblems(OK_IMG, 'fx') },
  { name: 'clean pricing', run: () => pricingProblems(OK_PRICING, OK_PAYWALL) },
  { name: 'clean changelog', run: () => changelogProblems(OK_CHANGELOG, undefined, '2026-10-01') },
  { name: 'clean voice and heading', run: () => [...voiceProblems('Write the daily report from your phone.', 'fx'), ...titleCaseProblems('<h3>Daily report with AIA-style G702/G703 and Cost X-Ray</h3>', 'fx')] },
];

// ── Entry point ─────────────────────────────────────────────────────────────
function gitDate(file: string): string | undefined {
  try {
    const out = execSync(`git log -1 --format=%cs -- "${relative(ROOT, file)}"`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : undefined;
  } catch { return undefined; }
}

function main(): number {
  let pass = 0, fail = 0;
  const ok = (name: string, problems: string[]) => {
    if (problems.length === 0) { pass++; console.log('  ✓', name); }
    else { fail++; console.log('  ✗', name); for (const s of problems.slice(0, 40)) console.log('      ', s); if (problems.length > 40) console.log(`       …and ${problems.length - 40} more`); }
  };
  const rel = (f: string) => relative(MARKETING, f).split('\\').join('/');

  console.log('\n0. negative fixtures (each must be caught)');
  for (const fx of FIXTURES) {
    let got: string[];
    try { got = fx.run(); } catch (e) { got = []; console.log('       fixture threw:', (e as Error).message); }
    ok(`caught: ${fx.name}`, got.some(g => fx.expect.test(g)) ? []
      : [`expected a problem matching ${fx.expect} — the check that should catch it is blind`, ...got.map(g => `(got) ${g}`)]);
  }
  for (const fx of CLEAN_FIXTURES) ok(`clean fixture stays clean: ${fx.name}`, fx.run());

  const pages = publicPages();
  const html = new Map(pages.map(f => [f, readFileSync(f, 'utf8')]));
  const indexable = pages.filter(f => isIndexable(html.get(f)!));
  console.log(`\nmarketing SEO (${pages.length} public pages, ${indexable.length} indexable)`);
  if (indexable.length < 25) { fail++; console.log(`  ✗ only ${indexable.length} indexable pages found — the walk is broken`); }

  console.log('\n1. head contract');
  for (const f of indexable) ok(`head: ${rel(f)}`, headProblems(html.get(f)!, rel(f)));

  console.log('\n2. sitemap');
  const xml = readFileSync(join(MARKETING, 'sitemap.xml'), 'utf8');
  ok('sitemap.xml lists exactly the indexable pages, with sane lastmod dates', sitemapProblems(xml));
  for (const m of xml.matchAll(/<url>[\s\S]*?<loc>([^<]*)<\/loc>[\s\S]*?<lastmod>([^<]*)<\/lastmod>[\s\S]*?<\/url>/g)) {
    const f = urlToFile(m[1]);
    const g = f && existsSync(f) ? gitDate(f) : undefined;
    if (g && m[2] < g) console.log(`  WARNING  ${m[1]} lastmod ${m[2]} is older than the file's last commit ${g}`);
  }

  console.log('\n3. robots.txt');
  ok('robots.txt has the Sitemap line and allows /screenshots/screens/', robotsProblems(readFileSync(join(MARKETING, 'robots.txt'), 'utf8')));

  console.log('\n4. images');
  for (const f of indexable) {
    const n = (stripNonContent(html.get(f)!).match(/<img\b/gi) ?? []).length;
    if (n) ok(`images (${n}): ${rel(f)}`, imgProblems(html.get(f)!, rel(f)));
  }

  console.log('\n5. accessibility');
  ok('styles.css: skip link, focus ring, 24px footer targets', a11yCssProblems(readFileSync(join(MARKETING, 'styles.css'), 'utf8'), 'styles.css'));
  const homeCss = (html.get(join(MARKETING, 'index.html'))!.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []).join('\n');
  ok('index.html inline style: the same rules, plus footer .fnav a', a11yCssProblems(homeCss, 'index.html', true));
  // Every indexable page with a primary nav, and every page at all that
  // carries a skip link. Noindex pages without one (the token, portal and
  // payment-return surfaces) are out of scope, as in sections 1, 4 and 6.
  for (const f of pages) {
    const h = html.get(f)!;
    const hasNav = PRIMARY_NAV.test(stripNonContent(h)) && isIndexable(h);
    const hasSkip = /class="skip-link"/.test(stripNonContent(h));
    if (!hasNav && !hasSkip) continue;
    const probs = skipLinkProblems(h, rel(f));
    if (hasSkip && !/\/styles\.css\?v=/.test(h)) {
      // A page on its own inline stylesheet must style the skip link itself,
      // or "Skip to content" prints as a bare link above the nav.
      const css = (h.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []).join('\n');
      probs.push(...a11yCssProblems(css, `${rel(f)} inline style`));
    }
    ok(`skip link + #main: ${rel(f)}`, probs);
  }

  console.log('\n6. voice (docs/VOICE.md)');
  const used = new Set<string>();
  for (const f of indexable) {
    const r = rel(f);
    if (LEGAL.has(r)) continue;
    const text = proseOf(html.get(f)!);
    for (const a of VOICE_ALLOW) if (a.rel === r && text.includes(a.contains)) used.add(`${a.rel}|${a.contains}`);
    ok(`voice: ${r}`, [...voiceProblems(text, r), ...titleCaseProblems(html.get(f)!, r)]);
  }
  ok('every ALLOW entry still matches a hit (no stale exemptions)',
    VOICE_ALLOW.filter(a => !used.has(`${a.rel}|${a.contains}`)).map(a => `${a.rel}: "${a.contains}" no longer appears — remove the entry`));

  console.log('\n7. claims');
  ok('demo.html promises no video, 90-second tour or 15-minute walkthrough', demoProblems(html.get(join(MARKETING, 'demo.html'))!));
  ok('pricing.html: caps equal app/paywall.tsx AI_LIMITS; retired phrases gone',
    pricingProblems(html.get(join(MARKETING, 'pricing.html'))!, readFileSync(join(ROOT, 'app/paywall.tsx'), 'utf8')));
  const cl = join(MARKETING, 'changelog.html');
  ok('changelog.html "Last updated" is current', changelogProblems(html.get(cl)!, gitDate(cl)));

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(main());
