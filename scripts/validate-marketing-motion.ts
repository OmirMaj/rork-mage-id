// scripts/validate-marketing-motion.ts — the marketing site's motion, pinned.
//
// WHY (2026-10-02). The site ran its own motion: a smooth-scroll library that
// took over the mouse wheel, a cursor-blob loop that ran 60 times a second on
// every page, magnetic buttons, card tilt, a first-visit curtain, blurred
// fade-ins, and a homepage whose sections were invisible until a script ran.
// All of it was retired. Motion now comes only from the shared motion kit
// (marketing/assets/motion-kit.{css,js}, data-mk attributes) on the
// illustrations that explain the product. This file keeps the founder's rules:
//   the page is readable with JavaScript off; Reduce Motion is respected;
//   only transform and opacity move; nothing blurs; nothing shifts the layout;
//   no group animates more than 8 rows; nothing in the first screen moves on
//   load except the hero.
//
// Checks (each prints PASS / FAIL):
//   V1  head contract: a page with data-mk links the kit CSS in <head> and the
//       kit JS with defer, exactly once each; a page without data-mk links neither.
//       Short-window net: every page with a group carries (inline, or through
//       /styles.css) a @media (max-height: 360px) rule that sets opacity:1
//       !important on every selector of the kit's armed rule. Kit gap G7 is
//       closed in the kit itself (lane MKITG7): a group now starts once its top
//       edge is 20% of the viewport above the bottom, whatever its height
//       (threshold 0, pinned by K5.9 in validate-motion-kit.ts). The net stays
//       as defense for a reader on a failed load or an old cached kit, which
//       can still leave an armed group at opacity 0.
//   V2  retired motion stays retired (motion.js, styles.css, landing.css, pages)
//   V3  no blur/filter animation anywhere
//   V4  reduced motion: animations sit in a no-preference block (or have a
//       reduce override), smooth scroll has a reduce override, rAF reads reduce
//   V5  transform/opacity only; page animations key on a kit lifecycle class;
//       no forwards/both fill
//   V6  no overshoot curve (cubic-bezier y outside [0, 1])
//   V7  caps: ≤ 8 item/cell/row/label/chip, ≤ 6 card, ≤ 3 doc per group;
//       the homepage compare render() marks rows only under i < 8
//   V8  no group inside a group; ≤ 12 groups per page
//   V9  first screen: no group in the hero or in the page's first <section>
//   V10 accumulate honesty: the cents add up to the total, every step has the
//       final text's length, the count element holds text only
//   V11 example labels on chat/accumulate groups; the thinking row's words
//   V12 one ?v= for the kit CSS and JS across every page
//   V13 homepage specifics (retired names, .play( only behind a guard)
//   V14 self-test: negative fixtures must each be caught
//   V15 the compare tables keep a plain <tr> (another guard reads that literal)
//
// V4/V5 apply to styles.css and to every page that carries data-mk. The three
// functional app pages (architect/, builders/, sub-portal/) keep their own
// loading spinners and are checked by V2/V3/V6/V8/V9 only.
//
// Run: bun run scripts/validate-marketing-motion.ts
// Other lanes import pageMotionProblems / cssMotionProblems (pure).
// MUTATION PROOF: set MARKETING_MOTION_MUT_DIR to a directory that mirrors
// repo paths; any file found there is read INSTEAD of the repo copy.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicPages } from './validate-marketing-seo';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUT = process.env.MARKETING_MOTION_MUT_DIR;

function read(rel: string): string {
  if (MUT && existsSync(join(MUT, rel))) return readFileSync(join(MUT, rel), 'utf8');
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
}
const exists = (rel: string): boolean => Boolean((MUT && existsSync(join(MUT, rel))) || existsSync(join(ROOT, rel)));

/** Pages that must carry data-mk (the homepage + every SHOULD page this lane shipped). */
export const REQUIRED_ADOPTED = [
  'marketing/index.html',
  'marketing/compare/index.html',
  'marketing/pricing.html',
  'marketing/features/financials.html',
  'marketing/features/field.html',
  'marketing/features/scheduling.html',
  'marketing/brain/index.html',
  'marketing/demo.html',
  'marketing/features/index.html',
];
// switch.html is deliberately NOT adopted: its "What comes across" list is the page's
// prose, and motion does not decorate prose. (The old stall reason, a ~1,400px group
// never starting on short windows, is gone: the kit starts groups of any height.)
const MAX_GROUPS = 12;
const ROW_CAP = 8;
const CARD_CAP = 6;
const DOC_CAP = 3;
const ANIM_PROPS = new Set(['opacity', 'transform', 'translate', 'scale', 'rotate']);
const LIFECYCLE = /\.mk-(in|done|armed)\b/;
const STYLES_ALLOW = ['.marquee-track', '.marquee-rev .marquee-track'];

// ── text helpers ────────────────────────────────────────────────────────────

/** Blank a span, keeping newlines (so line numbers survive). */
function blank(s: string): string { return s.replace(/[^\n]/g, ' '); }
export function stripCssComments(css: string): string { return css.replace(/\/\*[\s\S]*?\*\//g, blank); }
export function stripHtmlComments(html: string): string { return html.replace(/<!--[\s\S]*?-->/g, blank); }
/** JS: block comments and whole-line // comments (a // inside a string or URL is left alone). */
function stripJsComments(js: string): string {
  return stripCssComments(js).replace(/^([ \t]*)\/\/.*$/gm, (_m, ind: string) => ind);
}
function lineAt(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── a small CSS parser (tracks @media / @keyframes context) ─────────────────

type Decl = { prop: string; value: string };
type Rule = { sel: string; decls: Decl[]; ctx: string[]; line: number };
type Keyframes = { name: string; rules: Rule[]; ctx: string[]; line: number };

function parseDecls(body: string): Decl[] {
  const out: Decl[] = [];
  let depth = 0, cur = '';
  const push = () => {
    const c = cur.indexOf(':');
    if (c > 0) out.push({ prop: cur.slice(0, c).trim().toLowerCase(), value: cur.slice(c + 1).trim() });
    cur = '';
  };
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { push(); continue; }
    cur += ch;
  }
  push();
  return out;
}

export function parseCss(src: string, baseLine = 0): { rules: Rule[]; keyframes: Keyframes[] } {
  const css = stripCssComments(src);
  const rules: Rule[] = [], keyframes: Keyframes[] = [];
  function close(from: number): number {
    let d = 1, j = from;
    while (j < css.length && d > 0) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
    return j;
  }
  function walk(start: number, end: number, ctx: string[], into: Rule[]) {
    let i = start;
    while (i < end) {
      const open = css.indexOf('{', i);
      if (open < 0 || open >= end) break;
      const j = close(open + 1);
      let prelude = css.slice(i, open);
      const semi = Math.max(prelude.lastIndexOf(';'), prelude.lastIndexOf('}'));
      if (semi >= 0) prelude = prelude.slice(semi + 1);
      prelude = prelude.trim().replace(/\s+/g, ' ');
      const line = baseLine + lineAt(css, open);
      if (/^@(-webkit-)?keyframes\b/i.test(prelude)) {
        const kf: Keyframes = { name: prelude.split(' ')[1] || '', rules: [], ctx, line };
        walk(open + 1, j - 1, ctx, kf.rules);
        keyframes.push(kf);
      } else if (prelude.startsWith('@')) {
        walk(open + 1, j - 1, [...ctx, prelude.toLowerCase()], into);
      } else {
        into.push({ sel: prelude, decls: parseDecls(css.slice(open + 1, j - 1)), ctx, line });
      }
      i = j;
    }
  }
  walk(0, css.length, [], rules);
  return { rules, keyframes };
}

const inNoPref = (ctx: string[]) => ctx.some(c => /prefers-reduced-motion\s*:\s*no-preference/.test(c));
const inReduce = (ctx: string[]) => ctx.some(c => /prefers-reduced-motion\s*:\s*reduce/.test(c));
const selList = (sel: string) => sel.split(',').map(s => s.trim().replace(/\s+/g, ' '));
const isAnimDecl = (d: Decl) => (d.prop === 'animation' || d.prop === 'animation-name') && !/^(none|initial|unset|inherit)\b/i.test(d.value);
const FILTER = /(^|[\s,])(-webkit-)?(backdrop-)?filter\b/i;

/** Properties a transition value names (shorthand or transition-property). */
function transitionProps(d: Decl): string[] {
  return d.value.split(',').map(item => {
    const toks = item.trim().split(/\s+/);
    const p = toks.find(t => !/^[\d.]+m?s$/.test(t) && !/^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/.test(t) && !/^(cubic-bezier|steps)\(/.test(t));
    return (p || 'all').toLowerCase();
  });
}

/**
 * CSS motion rules. `strict` adds V4/V5 (page and shared CSS); `page` adds the
 * lifecycle-class and fill-mode rules (not for the kit's own sheet).
 */
export function cssMotionProblems(css: string, where: string, opts: { strict?: boolean; page?: boolean; allow?: string[]; baseLine?: number } = {}): string[] {
  const out: string[] = [];
  const { rules, keyframes } = parseCss(css, opts.baseLine || 0);
  const allow = opts.allow || [];
  // V3 — filters never animate
  for (const kf of keyframes) {
    for (const r of kf.rules) for (const d of r.decls) {
      if (/^(-webkit-)?(backdrop-)?filter$/.test(d.prop)) out.push(`V3 ${where}:${kf.line} @keyframes ${kf.name} animates ${d.prop}`);
    }
  }
  for (const r of rules) {
    const trans = r.decls.filter(d => d.prop === 'transition' || d.prop === 'transition-property');
    for (const d of trans) if (FILTER.test(d.value)) out.push(`V3 ${where}:${r.line} ${r.sel} transitions a filter (${d.value})`);
    const hasFilter = r.decls.some(d => /^(-webkit-)?(backdrop-)?filter$/.test(d.prop) && !/^none$/i.test(d.value));
    if (hasFilter && trans.some(d => transitionProps(d).includes('all'))) out.push(`V3 ${where}:${r.line} ${r.sel} has a filter and a transition on all properties`);
  }
  // V6 — no overshoot
  const bez = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g;
  const clean = stripCssComments(css);
  for (const m of clean.matchAll(bez)) {
    const y1 = parseFloat(m[2]), y2 = parseFloat(m[4]);
    if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) out.push(`V6 ${where}:${(opts.baseLine || 0) + lineAt(clean, m.index || 0)} overshoot curve ${m[0]}`);
  }
  if (!opts.strict) return out;
  // V4 — reduced motion
  const reduceSels = new Map<string, Decl[]>();
  for (const r of rules) if (inReduce(r.ctx)) for (const s of selList(r.sel)) reduceSels.set(s, [...(reduceSels.get(s) || []), ...r.decls]);
  const reduceOff = (sel: string) => (reduceSels.get(sel) || []).some(d => (d.prop === 'animation' || d.prop === 'animation-name') && /^none\b/i.test(d.value));
  const reduceAuto = (sel: string) => (reduceSels.get(sel) || []).some(d => d.prop === 'scroll-behavior' && /^auto\b/i.test(d.value));
  for (const r of rules) {
    for (const d of r.decls) {
      if (isAnimDecl(d) && !inNoPref(r.ctx) && !inReduce(r.ctx)) {
        if (!selList(r.sel).every(reduceOff)) out.push(`V4 ${where}:${r.line} ${r.sel} animates outside a no-preference block with no reduce override`);
      }
      if (d.prop === 'scroll-behavior' && /smooth/i.test(d.value) && !selList(r.sel).every(reduceAuto)) {
        out.push(`V4 ${where}:${r.line} ${r.sel} has scroll-behavior:smooth with no reduce override to auto`);
      }
    }
  }
  // V5 — transform/opacity only
  for (const kf of keyframes) {
    for (const r of kf.rules) for (const d of r.decls) {
      if (!ANIM_PROPS.has(d.prop) && d.prop !== 'animation-timing-function') out.push(`V5 ${where}:${kf.line} @keyframes ${kf.name} animates ${d.prop}`);
    }
  }
  for (const r of rules) {
    if (inNoPref(r.ctx)) {
      for (const d of r.decls.filter(x => x.prop === 'transition' || x.prop === 'transition-property')) {
        const bad = transitionProps(d).filter(p => !ANIM_PROPS.has(p));
        if (bad.length) out.push(`V5 ${where}:${r.line} ${r.sel} transitions ${bad.join(', ')}`);
      }
    }
    if (!opts.page) continue;
    for (const d of r.decls) {
      if (isAnimDecl(d)) {
        const sels = selList(r.sel);
        if (!sels.every(s => LIFECYCLE.test(s) || allow.includes(s))) out.push(`V5 ${where}:${r.line} ${r.sel} animates without a kit lifecycle class (.mk-in / .mk-done / .mk-armed)`);
      }
      if ((d.prop === 'animation' && /\b(forwards|both)\b/.test(d.value)) || (d.prop === 'animation-fill-mode' && /\b(forwards|both)\b/.test(d.value))) {
        out.push(`V5 ${where}:${r.line} ${r.sel} uses fill mode forwards/both`);
      }
    }
  }
  return out;
}

// ── a small HTML walker (groups, nesting, first section) ────────────────────

type Group = { type: string; line: number; start: number; end: number; counts: Record<string, number>; parent: Group | null };
type Flagged = { attr: string; start: number; end: number; inner: string };
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const COUNTED = ['item', 'cell', 'row', 'label', 'chip', 'card', 'doc'];

/** HTML with comments, <script> and <style> bodies blanked (offsets kept). */
function markupOnly(html: string): string {
  return stripHtmlComments(html).replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_m, a: string, _t: string, body: string, b: string) => a + blank(body) + b);
}

function walkHtml(html: string) {
  const src = markupOnly(html);
  const groups: Group[] = [];
  const flagged: Flagged[] = [];
  type Open = { name: string; group: Group | null; flags: string[]; openStart: number; innerStart: number; cls: string };
  const stack: Open[] = [];
  let firstSection: { start: number; end: number } | null = null;
  const heroSections: { start: number; end: number }[] = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  const nearest = (): Group | null => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].group) return stack[k].group; return null; };
  while ((m = re.exec(src))) {
    const closing = m[1] === '/', name = m[2].toLowerCase(), attrs = m[3] || '';
    if (closing) {
      let k = stack.length - 1;
      while (k >= 0 && stack[k].name !== name) k--;
      if (k < 0) continue;
      while (stack.length > k) {
        const o = stack.pop() as Open;
        if (o.group) o.group.end = m.index;
        for (const f of o.flags) flagged.push({ attr: f, start: o.openStart, end: m.index, inner: html.slice(o.innerStart, m.index) });
        if (o.name === 'section') {
          const range = { start: o.openStart, end: m.index };
          if (!firstSection || range.start < firstSection.start) firstSection = range;
          if (/(^|\s)hero(\s|$)/.test(o.cls)) heroSections.push(range);
        }
      }
      continue;
    }
    const type = (attrs.match(/\sdata-mk="([^"]*)"/) || [])[1];
    const owner = nearest();
    let group: Group | null = null;
    if (type !== undefined) {
      group = { type, line: lineAt(src, m.index), start: m.index, end: src.length, counts: {}, parent: owner };
      groups.push(group);
    } else if (owner) {
      for (const c of COUNTED) if (new RegExp('\\sdata-mk-' + c + '(?=[\\s=/]|$)').test(attrs)) owner.counts[c] = (owner.counts[c] || 0) + 1;
    }
    const flags = ['data-mk-count', 'data-mk-think'].filter(f => new RegExp('\\s' + f + '(?=[\\s=/]|$)').test(attrs));
    const cls = (attrs.match(/\sclass="([^"]*)"/) || [])[1] || '';
    const selfClose = /\/\s*$/.test(attrs) || VOID.has(name);
    if (!selfClose) stack.push({ name, group, flags, openStart: m.index, innerStart: m.index + m[0].length, cls });
  }
  return { groups, flagged, firstSection: firstSection as { start: number; end: number } | null, heroSections, src };
}

function inlineStyles(html: string): { css: string; line: number }[] {
  const out: { css: string; line: number }[] = [];
  const clean = stripHtmlComments(html);
  for (const m of clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out.push({ css: m[1], line: lineAt(clean, (m.index || 0) + m[0].indexOf('>')) - 1 });
  return out;
}
function inlineScripts(html: string): string[] {
  const clean = stripHtmlComments(html);
  const out: string[] = [];
  for (const m of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=/.test(m[1]) || /application\/ld\+json/.test(m[1])) continue;
    out.push(stripJsComments(m[2]));
  }
  return out;
}

/** Format a cents value the way the kit's accumulate() does. */
export function stepText(orig: string, cents: number): string {
  const m = orig.match(/\d[\d,]*(\.\d+)?/);
  if (!m || m.index === undefined) return orig;
  const dec = m[1] ? m[1].length - 1 : 0;
  return orig.slice(0, m.index) + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + orig.slice(m.index + m[0].length);
}

type PageReport = { problems: string[]; groups: number; kitCssV: string[]; kitJsV: string[] };

export function analyzePage(html: string, rel: string): PageReport {
  const out: string[] = [];
  const { groups, flagged, firstSection, heroSections } = walkHtml(html);
  const clean = stripHtmlComments(html);
  const head = (clean.match(/<head\b[\s\S]*?<\/head>/i) || [''])[0];
  const kitCss = [...clean.matchAll(/<link\b[^>]*href="\/assets\/motion-kit\.css(?:\?v=([^"]*))?"[^>]*>/g)];
  const kitJs = [...clean.matchAll(/<script\b([^>]*)src="\/assets\/motion-kit\.js(?:\?v=([^"]*))?"([^>]*)>/g)];
  const adopted = groups.length > 0;
  // V1
  if (adopted) {
    if (kitCss.length !== 1) out.push(`V1 ${rel} links motion-kit.css ${kitCss.length} times (want exactly 1)`);
    else {
      if (!kitCss[0][1]) out.push(`V1 ${rel} motion-kit.css has no ?v=`);
      if (!head.includes(kitCss[0][0])) out.push(`V1 ${rel} motion-kit.css is not in <head>`);
      const styleEnd = head.lastIndexOf('</style>'), sheet = head.indexOf('/styles.css');
      const at = head.indexOf(kitCss[0][0]);
      if (at >= 0 && (at < styleEnd || (sheet >= 0 && at < sheet))) out.push(`V1 ${rel} motion-kit.css must come after the page's own styles`);
    }
    if (kitJs.length !== 1) out.push(`V1 ${rel} loads motion-kit.js ${kitJs.length} times (want exactly 1)`);
    else {
      const attrs = kitJs[0][1] + ' ' + kitJs[0][3];
      if (!/\bdefer\b/.test(attrs)) out.push(`V1 ${rel} motion-kit.js has no defer`);
      if (/\basync\b/.test(attrs)) out.push(`V1 ${rel} motion-kit.js is async (want defer)`);
      if (!kitJs[0][2]) out.push(`V1 ${rel} motion-kit.js has no ?v=`);
    }
  } else if (kitCss.length || kitJs.length) {
    out.push(`V1 ${rel} links the motion kit but carries no data-mk group`);
  }
  // V2 (page level)
  const markup = markupOnly(html);
  const scriptsAndMarkup = markup + '\n' + inlineScripts(html).join('\n') + '\n' + inlineStyles(html).map(s => stripCssComments(s.css)).join('\n');
  for (const word of ['cursor-blob', 'data-tilt', 'data-inkbleed', 'data-scramble', 'hero-spotlight', 'lenis', 'gsap', 'ScrollTrigger']) {
    if (new RegExp('(^|[^\\w-])' + word + '(?![\\w-])', 'i').test(scriptsAndMarkup)) out.push(`V2 ${rel} still contains "${word}"`);
  }
  for (const m of markup.matchAll(/\sclass="([^"]*)"/g)) if (m[1].split(/\s+/).includes('reveal')) out.push(`V2 ${rel}:${lineAt(markup, m.index || 0)} class token "reveal"`);
  if (/href="[^"]*landing\.css/.test(markup)) out.push(`V2 ${rel} links landing.css`);
  // V3 / V4 / V5 / V6 in the page's own CSS
  for (const s of inlineStyles(html)) out.push(...cssMotionProblems(s.css, rel, { strict: adopted, page: true, baseLine: s.line }));
  for (const m of markup.matchAll(/\sstyle="([^"]*)"/g)) {
    out.push(...cssMotionProblems('x{' + m[1] + '}', rel + ':' + lineAt(markup, m.index || 0) + ' style=""', {}).filter(p => p.startsWith('V6')));
    if (/\b(animation|transition)\s*:/.test(m[1]) && FILTER.test(m[1])) out.push(`V3 ${rel}:${lineAt(markup, m.index || 0)} inline style animates a filter`);
  }
  for (const js of inlineScripts(html)) {
    if (/\.style\.(filter|backdropFilter|webkitBackdropFilter)\b/.test(js)) out.push(`V3 ${rel} a script writes style.filter`);
    if (/requestAnimationFrame/.test(js) && !/matchMedia\(\s*['"]\(prefers-reduced-motion:\s*reduce\)['"]\s*\)/.test(js)) out.push(`V4 ${rel} a script uses requestAnimationFrame without reading prefers-reduced-motion`);
  }
  // V7 / V8
  if (groups.length > MAX_GROUPS) out.push(`V8 ${rel} has ${groups.length} groups (max ${MAX_GROUPS})`);
  for (const g of groups) {
    if (g.parent) out.push(`V8 ${rel}:${g.line} data-mk="${g.type}" sits inside data-mk="${g.parent.type}" (line ${g.parent.line})`);
    for (const c of ['item', 'cell', 'row', 'label', 'chip']) if ((g.counts[c] || 0) > ROW_CAP) out.push(`V7 ${rel}:${g.line} data-mk="${g.type}" marks ${g.counts[c]} data-mk-${c} (max ${ROW_CAP})`);
    if ((g.counts.card || 0) > CARD_CAP) out.push(`V7 ${rel}:${g.line} ${g.counts.card} data-mk-card (max ${CARD_CAP})`);
    if ((g.counts.doc || 0) > DOC_CAP) out.push(`V7 ${rel}:${g.line} ${g.counts.doc} data-mk-doc (max ${DOC_CAP})`);
  }
  // V9
  for (const g of groups) {
    if (firstSection && g.start >= firstSection.start && g.start < firstSection.end) out.push(`V9 ${rel}:${g.line} data-mk="${g.type}" is in the page's first <section> (first screen)`);
    else if (heroSections.some(h => g.start >= h.start && g.start < h.end)) out.push(`V9 ${rel}:${g.line} data-mk="${g.type}" is in a hero section`);
  }
  if (firstSection && /\sclass="[^"]*\bmarquee\b/.test(markup.slice(firstSection.start, firstSection.end))) out.push(`V9 ${rel} the marquee is in the first <section>`);
  // V10 / V11
  for (const g of groups) {
    const body = html.slice(g.start, g.end);
    if (g.type === 'accumulate') {
      const cents = [...body.matchAll(/\sdata-mk-cents="([^"]*)"/g)].map(x => Math.round(parseFloat(x[1]) || 0));
      const cnt = flagged.find(f => f.attr === 'data-mk-count' && f.start > g.start && f.start < g.end);
      if (!cnt) out.push(`V10 ${rel}:${g.line} accumulate has no [data-mk-count]`);
      else {
        if (/<[a-zA-Z]/.test(cnt.inner)) out.push(`V10 ${rel}:${g.line} [data-mk-count] has element children (the kit overwrites them)`);
        const orig = cnt.inner;
        const total = Math.round(parseFloat((orig.match(/\d[\d,]*(\.\d+)?/) || ['0'])[0].replace(/,/g, '')) * 100);
        const sum = cents.reduce((a, b) => a + b, 0);
        if (sum !== total) out.push(`V10 ${rel}:${g.line} data-mk-cents add up to ${sum}, the total says ${total}`);
        let run = 0;
        for (const c of cents) { run += c; const t = stepText(orig, run); if (t.length !== orig.length) out.push(`V10 ${rel}:${g.line} step "${t}" is not as long as "${orig}" (it would reflow)`); }
      }
    }
    if ((g.type === 'chat' || g.type === 'accumulate') && !/\bExample\b/.test(textOf(body))) out.push(`V11 ${rel}:${g.line} data-mk="${g.type}" does not say "Example"`);
  }
  for (const f of flagged.filter(x => x.attr === 'data-mk-think')) {
    if (textOf(f.inner) !== 'Reading your records') out.push(`V11 ${rel} [data-mk-think] says "${textOf(f.inner)}" (want "Reading your records")`);
  }
  return { problems: out, groups: groups.length, kitCssV: kitCss.map(x => x[1] || ''), kitJsV: kitJs.map(x => x[2] || '') };
}

export function pageMotionProblems(html: string, rel: string): string[] { return analyzePage(html, rel).problems; }

/** V13 — homepage specifics (text). */
export function homepageProblems(html: string): string[] {
  const out: string[] = [];
  const clean = stripHtmlComments(html);
  const markup = markupOnly(html);
  for (const m of markup.matchAll(/\sclass="([^"]*)"/g)) if (m[1].split(/\s+/).includes('rv')) out.push(`V13 index.html:${lineAt(markup, m.index || 0)} class token "rv"`);
  const css = inlineStyles(html).map(s => stripCssComments(s.css)).join('\n');
  const js = inlineScripts(html).join('\n');
  if (/(^|[\s,}])\.rv\b/.test(css)) out.push('V13 index.html still has a .rv rule');
  for (const n of ['lvSettle', 'mfixPulse', 'briefBlink', 'askBlink', 'chipPop', 'wlIn', 'wlEsc', 'wlDraw', 'wlOpenRow', 'wlOpenNote', 'sc-anim', 'brief-anim', 'ask-anim', 'pass-anim', 'lv-anim']) {
    if (new RegExp('(^|[^\\w-])' + n + '(?![\\w-])').test(css + '\n' + js + '\n' + markup)) out.push(`V13 index.html still names ${n}`);
  }
  for (const kf of parseCss(css).keyframes) for (const r of kf.rules) if (r.decls.some(d => d.prop === 'max-height')) out.push(`V13 index.html @keyframes ${kf.name} animates max-height`);
  for (const line of js.split('\n')) {
    if (/\.play\(/.test(line) && !/window\.MageMotion\s*(\)|&&)/.test(line.slice(0, line.indexOf('.play(')))) out.push(`V13 index.html .play( without a window.MageMotion guard: ${line.trim().slice(0, 90)}`);
  }
  // V7 text check: render() marks compare rows only under an i < 8 guard
  const r0 = js.indexOf('function render(');
  const body = r0 >= 0 ? js.slice(r0, js.indexOf('panel.innerHTML', r0)) : '';
  if (!body) out.push('V7 index.html: compare render() not found');
  else {
    if (!/var\s+mk\s*=\s*i\s*<\s*8\b/.test(body)) out.push('V7 index.html: render() has no `var mk = i < 8` guard');
    for (const m of body.matchAll(/data-mk-(row|label|evidence)/g)) {
      if (!/mk\?'\s*$/.test(body.slice(Math.max(0, (m.index || 0) - 8), m.index))) out.push(`V7 index.html: render() writes data-mk-${m[1]} outside the i < 8 guard`);
    }
  }
  if (/<section class="hero"[\s\S]*?<\/section>/.test(clean) && /data-mk/.test((markup.match(/<section class="hero"[\s\S]*?<\/section>/) || [''])[0])) out.push('V13 index.html: the hero holds a data-mk attribute');
  return out;
}

/** V2 — the retired files. */
export function retiredProblems(motionJs: string, stylesCss: string, landingExists: boolean): string[] {
  const out: string[] = [];
  const m = stripJsComments(motionJs);
  for (const w of ['lenis', 'unpkg', 'cursor-blob', 'blobLoop', 'magnet', 'tilt', 'perspective(', 'gsap', 'ScrollTrigger', 'intro', 'sessionStorage', 'skewX', 'velLoop', 'inkbleed', 'scramble', 'spotlight', 'reveal', 'stat-val', 'requestAnimationFrame', 'mousemove']) {
    if (motionJs.toLowerCase().includes(w.toLowerCase())) out.push(`V2 motion.js still contains "${w}"`);
  }
  if (!/getElementById\(\s*['"]year['"]\s*\)/.test(m)) out.push('V2 motion.js no longer sets #year');
  if (!/scroll-progress/.test(m)) out.push('V2 motion.js no longer injects .scroll-progress');
  const bytes = Buffer.byteLength(motionJs, 'utf8');
  if (bytes > 2000) out.push(`V2 motion.js is ${bytes} B (max 2,000)`);
  const { rules, keyframes } = parseCss(stylesCss);
  for (const r of rules) {
    for (const s of selList(r.sel)) {
      if (/\.(reveal|intro|intro-[\w-]+|tilt|lenis)\b/.test(s) || /\bintro-on\b/.test(s)) out.push(`V2 styles.css:${r.line} retired rule ${s}`);
      if (s === '.marquee' && r.decls.some(d => d.prop === 'will-change' || d.prop === 'transition')) out.push(`V2 styles.css:${r.line} .marquee keeps will-change/transition from the retired lean`);
    }
  }
  for (const kf of keyframes) if (/^intro/i.test(kf.name)) out.push(`V2 styles.css @keyframes ${kf.name}`);
  if (landingExists) out.push('V2 marketing/landing.css exists again');
  return out;
}

// ── V1 short-window net (kit gap G7) ────────────────────────────────────────

/** Split a selector list on top-level commas only (`:is(a,b)` stays whole), whitespace-normalised. */
export function splitSelectors(sel: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export const NET_MEDIA = /^@media\s*\(\s*max-height\s*:\s*360px\s*\)$/;

/** The kit's armed selectors: the no-preference rule(s) that set opacity 0 on .mk-armed. */
export function kitArmedSelectors(kitCss: string): string[] {
  const out: string[] = [];
  for (const r of parseCss(kitCss).rules) {
    if (!inNoPref(r.ctx) || !r.decls.some(d => d.prop === 'opacity' && /^0$/.test(d.value))) continue;
    for (const s of splitSelectors(r.sel)) if (s.includes('.mk-armed')) out.push(s);
  }
  return out;
}

/** Armed selectors the CSS does not show on a short window (empty = the net is complete). */
export function shortNetMissing(css: string, armed: string[]): string[] {
  const shown = new Set<string>();
  for (const r of parseCss(css).rules) {
    if (r.ctx.length !== 1 || !NET_MEDIA.test(r.ctx[0])) continue;
    if (!r.decls.some(d => d.prop === 'opacity' && /^1\s*!important$/.test(d.value))) continue;
    for (const s of splitSelectors(r.sel)) shown.add(s);
  }
  return armed.filter(s => !shown.has(s));
}

// ── V14 self-test ───────────────────────────────────────────────────────────

const KIT = '<link rel="stylesheet" href="/assets/motion-kit.css?v=t" />';
const KJS = '<script src="/assets/motion-kit.js?v=t" defer></script>';
function fx(body: string, opts: { css?: string; js?: string } = {}): string {
  return '<!doctype html><html><head><style>' + (opts.css || '') + '</style>' + KIT + '</head><body><section class="hero"><h1>Hi</h1></section>' + body + (opts.js || KJS) + '</body></html>';
}
const LIST = (n: number) => '<section><ul data-mk="list">' + Array.from({ length: n }, (_, i) => '<li data-mk-item>' + i + '</li>').join('') + '</ul></section>';
const PAY = (c: number) => '<section><div data-mk="accumulate"><p>Example</p><div data-mk-card data-mk-cents="' + c + '">a</div><div data-mk-card data-mk-cents="82000">b</div><span data-mk-count>$2,220</span></div></section>';
export const FIXTURES: { name: string; html: string; want: string }[] = [
  { name: 'a 9-item list', html: fx(LIST(9)), want: 'V7' },
  { name: 'a nested group', html: fx('<section><div data-mk="accumulate"><p>Example</p><ul data-mk="list"><li data-mk-item>x</li></ul><span data-mk-count>$1</span><div data-mk-card data-mk-cents="100">a</div></div></section>'), want: 'V8' },
  { name: 'a blur keyframe', html: fx(LIST(2), { css: '@media (prefers-reduced-motion: no-preference){.x.mk-in{animation:b 1s}@keyframes b{from{filter:blur(4px)}}}' }), want: 'V3' },
  { name: 'an overshoot curve', html: fx(LIST(2), { css: '.x{transition:transform .3s cubic-bezier(.34,1.55,.64,1)}' }), want: 'V6' },
  { name: 'a hero with data-mk', html: fx(LIST(2)).replace('<h1>Hi</h1>', '<h1 data-mk="rise">Hi</h1>'), want: 'V9' },
  { name: 'cents that do not add up', html: fx(PAY(139000)), want: 'V10' },
  { name: 'a missing defer', html: fx(LIST(2), { js: '<script src="/assets/motion-kit.js?v=t"></script>' }), want: 'V1' },
];
export function selfTest(): string[] {
  const out: string[] = [];
  for (const f of FIXTURES) {
    const p = pageMotionProblems(f.html, 'fixture');
    if (!p.some(x => x.startsWith(f.want))) out.push(`V14 fixture "${f.name}" was not caught by ${f.want} (got: ${p.join(' | ') || 'nothing'})`);
  }
  const good = pageMotionProblems(fx(LIST(8) + PAY(140000)), 'fixture');
  if (good.length) out.push('V14 the clean fixture raised: ' + good.join(' | '));
  // the short-window net
  const armed = ['.mk-armed:is([data-mk="rise"],[data-mk="range"])', '.mk-armed :is([data-mk-item],[data-mk-card])'];
  const kitFx = '@media (prefers-reduced-motion:no-preference){' + armed.join(',') + ',.mk-filed [data-mk-doc]{opacity:0}.mk-in [data-mk-a]{opacity:0}}';
  if (kitArmedSelectors(kitFx).join('|') !== armed.join('|')) out.push('V14 kitArmedSelectors did not read the armed list: ' + kitArmedSelectors(kitFx).join(' | '));
  const net = (media: string, sel: string, val = '1 !important') => media + '{' + sel + '{opacity:' + val + '}}';
  const nets: [string, string, boolean][] = [
    ['no net', '', false],
    ['a net in a no-preference block', '@media (prefers-reduced-motion:no-preference){' + net('@media (max-height: 360px)', armed.join(',')) + '}', false],
    ['a net at another height', net('@media (max-height: 300px)', armed.join(',')), false],
    ['a net without !important', net('@media (max-height: 360px)', armed.join(','), '1'), false],
    ['a net missing one selector', net('@media (max-height: 360px)', armed[0]), false],
    ['the full net', net('@media (max-height: 360px)', armed.join(',\n  ')), true],
  ];
  for (const [name, css, ok] of nets) {
    const miss = shortNetMissing(css, armed);
    if (ok !== (miss.length === 0)) out.push(`V14 short-window net fixture "${name}" ${ok ? 'was rejected: ' + miss.join(' | ') : 'was accepted'}`);
  }
  return out;
}

// ── entry point ─────────────────────────────────────────────────────────────

function main(): number {
  let failures = 0;
  const check = (name: string, problems: string[]) => {
    if (!problems.length) { console.log('  PASS  ' + name); return; }
    failures++;
    console.log('  FAIL  ' + name);
    for (const p of problems) console.log('        ' + p);
  };
  console.log('validate-marketing-motion');
  check('V14 self-test: every negative fixture is caught, the clean one passes', selfTest());

  const pages = publicPages().map(p => relative(ROOT, p).split(sep).join('/')).filter(r => !r.startsWith('marketing/portal/'));
  const reports = new Map<string, PageReport>();
  for (const rel of pages) reports.set(rel, analyzePage(read(rel), rel));
  const by = (prefix: string) => [...reports.values()].flatMap(r => r.problems.filter(p => p.startsWith(prefix + ' ')));

  // V1 adoption + floor
  const missing = REQUIRED_ADOPTED.filter(r => !(reports.get(r)?.groups));
  const floor = [...reports.values()].some(r => r.groups >= 8);
  check('V1 head contract (kit CSS in <head>, kit JS deferred, once each; none without data-mk)', by('V1'));
  check('V1 adopted pages carry data-mk: ' + REQUIRED_ADOPTED.map(r => r.replace('marketing/', '')).join(', '), missing.map(r => r + ' has no data-mk group'));
  check('V1 floor: one page (the homepage) with ≥ 8 groups', floor ? [] : ['no page has 8 or more groups']);
  const armed = kitArmedSelectors(read('marketing/assets/motion-kit.css'));
  const netProblems: string[] = armed.length ? [] : ['V1 motion-kit.css: no armed rule found (the net has nothing to cover)'];
  const sharedCss = read('marketing/styles.css');
  for (const [rel, r] of reports) {
    if (!r.groups) continue;
    const html = read(rel);
    const head = (stripHtmlComments(html).match(/<head\b[\s\S]*?<\/head>/i) || [''])[0];
    const css = inlineStyles(html).map(s => s.css).join('\n') + (/href="\/styles\.css(\?[^"]*)?"/.test(head) ? '\n' + sharedCss : '');
    for (const s of shortNetMissing(css, armed)) netProblems.push(`V1 ${rel} has no short-window net for ${s}`);
  }
  check('V1 short-window net: every page with a group shows unstarted groups below 360px of height (kit gap G7)', netProblems);

  // V2 retired
  const motionJs = read('marketing/motion.js'), stylesCss = read('marketing/styles.css');
  check('V2 retired motion stays retired (motion.js, styles.css, landing.css, every page)', [...retiredProblems(motionJs, stylesCss, exists('marketing/landing.css')), ...by('V2')]);

  // V3-V6 on the shared sheets
  const sheets = [
    ...cssMotionProblems(stylesCss, 'styles.css', { strict: true, page: true, allow: STYLES_ALLOW }),
    ...cssMotionProblems(read('marketing/assets/motion-kit.css'), 'motion-kit.css', {}),
  ];
  const mjs = stripJsComments(motionJs);
  if (/\.style\.(filter|backdropFilter)/.test(mjs)) sheets.push('V3 motion.js writes style.filter');
  const kitJs = read('marketing/assets/motion-kit.js');
  if (/\.style\.(filter|backdropFilter)/.test(kitJs)) sheets.push('V3 motion-kit.js writes style.filter');
  for (const p of ['V3', 'V4', 'V5', 'V6']) {
    const label = { V3: 'V3 no blur/filter animation', V4: 'V4 reduced motion respected', V5: 'V5 transform/opacity only, lifecycle-keyed, no forwards fill', V6: 'V6 no overshoot curve' }[p] as string;
    check(label, [...sheets.filter(x => x.startsWith(p + ' ')), ...by(p)]);
  }
  check('V7 caps: ≤ 8 rows per group, ≤ 6 cards, ≤ 3 docs; render() rows under i < 8', [...by('V7'), ...homepageProblems(read('marketing/index.html')).filter(x => x.startsWith('V7'))]);
  check('V8 no nested group; ≤ 12 groups per page', by('V8'));
  check('V9 nothing in the hero or the first <section> moves', by('V9'));
  check('V10 accumulate counts real partial sums and ends on the page text', by('V10'));
  check('V11 example labels and the thinking row', by('V11'));

  // V12 one kit version
  const base = reports.get('marketing/index.html');
  const want = base?.kitCssV[0] || '';
  const v12: string[] = [];
  if (!want) v12.push('index.html links no versioned motion-kit.css');
  for (const [rel, r] of reports) for (const v of [...r.kitCssV, ...r.kitJsV]) if (v !== want) v12.push(`${rel} links the kit at ?v=${v || '(none)'} (index.html: ?v=${want})`);
  check('V12 one ?v= for motion-kit.css and motion-kit.js on every page' + (want ? ' (' + want + ')' : ''), v12);

  check('V13 homepage: no rv, no retired names, no max-height keyframe, guarded .play(', homepageProblems(read('marketing/index.html')).filter(x => x.startsWith('V13')));
  // validate-marketing-claims finds the compare tables' rows by the literal `<tr>`; a data-mk-row on a
  // <tr> there would make its billing-term checks match nothing and pass blind. Rows stay plain.
  const cmp = stripHtmlComments(read('marketing/compare/index.html'));
  check('V15 compare/index.html table rows stay a plain <tr> (validate-marketing-claims reads them by that literal)',
    [...cmp.matchAll(/<tr\s[^>]*>/g)].map(m => `V15 compare/index.html:${lineAt(cmp, m.index || 0)} ${m[0]}`));

  const groups = [...reports.entries()].filter(([, r]) => r.groups).map(([k, r]) => k.replace('marketing/', '') + ' ' + r.groups);
  console.log('\n  adopted pages (groups): ' + groups.join(', '));
  console.log(failures ? `\n✗ validate-marketing-motion: ${failures} check(s) failed` : '\n✓ validate-marketing-motion: the site moves only through the kit, only on illustrations, and reads the same with JavaScript off');
  return failures ? 1 : 0;
}

if (import.meta.main) process.exit(main());
