// validate-desktop-layout.ts — the desktop web app may only get LESS stretched,
// and a desktop rule may never reach a phone.
//
// WHY (wave 6b). The founder, on a 1512×945 MacBook: "the website app… really
// isn't utilizing the space a computer screen gives you" and "when doing the
// schedules or picking a subtab the boxes are so stretched out and it looks
// terrible". Two audits measured it live: pages 1816 px wide, 1000–1470 px
// inputs, 1360 px buttons, 328–881 px sub-tabs, modals at full window width.
// Wave 6b built the primitives (Layout tokens, DesktopPageFrame, Sheet,
// SegmentedControl, ActionBar, TileGrid, ChipRail); wave 6c adopts them screen
// by screen. This guard is what makes that one-way.
//
// Three kinds of check:
//
//  A. CEILINGS — counts of the hand-rolled patterns that stretch on desktop,
//     measured on the wave-6b worktree. Each may only go DOWN. When one drops,
//     lower its constant in the same commit (the run prints the new number).
//
//  B. HARD RULES (no ceiling)
//     - a style prop that uses a desktop style (`…Desktop`, segmentedDesktop,
//       the components/ui/desktop helpers, Layout.*) must gate it on isDesktop
//       (or another non-phone gate) in the same expression — the static proof
//       that a desktop rule cannot reach a phone. The exceptions that existed
//       when this landed are baselined by name; a new one fails.
//     - Button's wrapper carries the desktop sizing and the containerStyle prop.
//     - DESKTOP_SHELL_EXEMPT names only real route files
//       (validate-desktop-page-map covers the rest of utils/desktopPage.ts).
//
//  C. PINS — the offenders the audit measured live. Each is recorded as fixed
//     or not; a fixed one that comes back fails, and an unfixed one that gets
//     fixed prints the one-word edit that locks it.
//
// Pure node:fs + comment stripping, like validate-ui-adoption.ts. The one
// import is utils/desktopPage.ts, which is pure (react-native crashes bun).
//
// Run via: bun run test:desktop-layout

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { DESKTOP_SHELL_EXEMPT } from '../utils/desktopPage';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ═══ A. Ceilings — measured 2026-09-23 on the wave-6b worktree ═════════════
// (claude/wave6b-desktop, 6065b326 + 480c8710 + the four 6b lanes' files —
// the new primitives' own phone rails included). NEVER RAISE ONE. Lower it
// when the count drops; wave 6c migrates screens and lowers each as it goes.
const CEILING = {
  /** Numeric `maxWidth` literals ≥ 700 in app/ + components/ — page and
   *  column caps that should each be a Layout token. */
  pageWidthLiterals: 49,
  /** seg/segment/tab/toggle/mode style entries that stretch (flex:1 /
   *  flexGrow:1) with no `segmentedDesktop` companion at their use site.
   *  Excludes components/schedule/mobile and `…Phone` styles. */
  stretchedSegments: 46,
  /** Files with a transparent <Modal> and no desktop frame (no Sheet /
   *  useSheetFrame, no maxWidth anywhere in the file). */
  unframedTransparentModalFiles: 59,
  /** Non-transparent pageSheet <Modal>s (full-window on web). */
  pageSheetModals: 27,
  /** Percent-width tile literals (width / flexBasis / minWidth of 22–25%,
   *  30–33% or 45–49%) — tiles sized from the row, not from a minimum. */
  percentTileLiterals: 26,
  /** Desktop tile styles that combine flexGrow:1 with a numeric flexBasis
   *  (the last row's orphan stretches across the page). */
  growingDesktopTiles: 14,
  /** `showsHorizontalScrollIndicator={false}` — a desktop mouse has no swipe,
   *  so a hidden-scrollbar rail hides its own overflow. */
  hiddenScrollbarRails: 116,
  /** `<Button style={{ flex: 1 }}>` — a stretched button; containerStyle is
   *  the replacement. */
  stretchedButtons: 5,
};

// ═══ B. Baselined gate exceptions — `file::ref`, as found when this landed.
// Each is a desktop style used without an isDesktop gate in its own style
// expression. Delete an entry when its site is fixed; NEVER add one.
// Empty when this landed: every desktop style was gated either in its style
// expression or by control flow (a primitive's `if (isDesktop) return …`).
const UNGATED_BASELINE: ReadonlySet<string> = new Set<string>([]);

// ─── plumbing ───────────────────────────────────────────────────────────────

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.error('  FAIL  ' + name);
  if (detail) console.error('        ' + detail);
}
function note(msg: string) { console.log('  NOTE  ' + msg); }

function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') { if (src[i] === '\n') mode = 'code'; else blank(i); i++; continue; }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    i++;
  }
  return out.join('');
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/');
const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))].sort();
const code = new Map<string, string>(files.map((f) => [rel(f), stripComments(readFileSync(f, 'utf8'))]));

/** The balanced `{…}` / `[…]` / `(…)` starting at `open` (inclusive). */
function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const stack: string[] = [];
  let i = open;
  let quote: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (stack.length === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

/** The opening tag `<Name …>` starting at `at`, skipping `{…}` attribute
 *  expressions — an `onPress={() => …}` must not end the tag at its `>`. */
function openingTag(src: string, at: number): string {
  let i = at + 1;
  while (i < src.length) {
    if (src[i] === '{') { i += balanced(src, i).length; continue; }
    if (src[i] === '>') return src.slice(at, i + 1);
    i++;
  }
  return src.slice(at);
}
const tagsOf = (src: string, name: string) =>
  [...src.matchAll(new RegExp(`<${name}\\b`, 'g'))].map((m) => openingTag(src, m.index!));

/** Split an expression on its top-level commas. */
function topLevelParts(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0; let start = 0; let quote: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(expr.slice(start, i)); start = i + 1; }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The style entries of every object literal: `name: { body }`. */
function styleEntries(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  for (const m of src.matchAll(/(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*:\s*\{/g)) {
    const open = m.index! + m[0].length - 1;
    const body = balanced(src, open);
    if (body.length < 4000) out.push({ name: m[1], body });
  }
  return out;
}

const camelWords = (name: string) => name.split(/(?=[A-Z])/).map((w) => w.toLowerCase());

// ═══ A. measure ════════════════════════════════════════════════════════════

const counts = {
  pageWidthLiterals: 0,
  stretchedSegments: 0,
  unframedTransparentModalFiles: 0,
  pageSheetModals: 0,
  percentTileLiterals: 0,
  growingDesktopTiles: 0,
  hiddenScrollbarRails: 0,
  stretchedButtons: 0,
};
const SEGMENT_WORDS = new Set(['seg', 'segs', 'segment', 'segments', 'tab', 'tabs', 'toggle', 'toggles', 'mode', 'modes']);

for (const [file, src] of code) {
  for (const m of src.matchAll(/\bmaxWidth:\s*(\d+)\b/g)) if (Number(m[1]) >= 700) counts.pageWidthLiterals++;

  if (!file.startsWith('components/schedule/mobile/')) {
    for (const { name, body } of styleEntries(src)) {
      if (/Phone$/.test(name)) continue;
      if (!camelWords(name).some((w) => SEGMENT_WORDS.has(w))) continue;
      // Only the style's OWN keys (a nested object would be another entry).
      const own = body.slice(1, -1).replace(/\{[^{}]*\}/g, '');
      if (!/\bflex(?:Grow)?:\s*1\b/.test(own)) continue;
      const companion = new RegExp(`\\.${name}\\b[^\\]]{0,240}segmentedDesktop`).test(src);
      if (!companion) counts.stretchedSegments++;
    }
  }

  const modals = tagsOf(src, 'Modal');
  if (modals.some((t) => /\btransparent\b/.test(t)) && !/\buseSheetFrame\b|<Sheet\b/.test(src) && !/\bmaxWidth\b/.test(src)) {
    counts.unframedTransparentModalFiles++;
  }
  for (const tag of modals) if (/pageSheet/.test(tag) && !/\btransparent\b/.test(tag)) counts.pageSheetModals++;

  for (const m of src.matchAll(/\b(?:width|flexBasis|minWidth):\s*['"](\d+(?:\.\d+)?)%['"]/g)) {
    const v = Number(m[1]);
    if ((v >= 22 && v <= 25.99) || (v >= 30 && v <= 33.99) || (v >= 45 && v <= 49.99)) counts.percentTileLiterals++;
  }
  for (const { name, body } of styleEntries(src)) {
    if (!/Desktop$|^desktop/i.test(name)) continue;
    const own = body.slice(1, -1).replace(/\{[^{}]*\}/g, '');
    if (/\bflexGrow:\s*1\b/.test(own) && /\bflexBasis:\s*\d+/.test(own)) counts.growingDesktopTiles++;
  }

  counts.hiddenScrollbarRails += (src.match(/showsHorizontalScrollIndicator=\{false\}/g) ?? []).length;
  counts.stretchedButtons += tagsOf(src, 'Button').filter((t) => /\sstyle=\{\{\s*flex:\s*1\s*\}\}/.test(t)).length;
}

console.log('\ndesktop layout — ceilings (may only go down):');
for (const key of Object.keys(CEILING) as Array<keyof typeof CEILING>) {
  const n = counts[key];
  const cap = CEILING[key];
  ok(`${key}: ${n} ≤ ${cap}`, n <= cap,
    `A new stretched pattern landed. Use the wave-6b primitive instead (Layout tokens, <Sheet>, <SegmentedControl>, <TileGrid>, <ChipRail>, Button containerStyle).`);
  if (n < cap) note(`${key} dropped to ${n} — lower CEILING.${key} to ${n} in this commit.`);
}
// A scanner that stopped scanning passes every ceiling: prove it still sees.
ok('the scan still sees the tree (rails and page-width literals are non-zero)',
  counts.hiddenScrollbarRails > 50 && counts.pageWidthLiterals > 10 && code.size > 300);

// ═══ B. hard rules ═════════════════════════════════════════════════════════

console.log('\ndesktop layout — a desktop style never reaches a phone:');
const GATE = /(?:\bisDesktop\w*|\bisWide\w*|\bshowSidebar|\bisWeb\w*|\bdesktop\b|\bwide\b|Platform\.OS\s*===\s*['"]web['"])\s*\)?\s*(&&|\?(?![.?]))/g;

/**
 * Is a reference that starts `prefix.length` chars into a style piece applied
 * ONLY when the gate is true? A gate token followed by `&&` or `?` somewhere
 * before it is not enough — both of these read "gated" to a plain search and
 * put the desktop style on the PHONE:
 *   `!isDesktop && styles.xDesktop`            (the gate is negated)
 *   `isDesktop ? undefined : styles.xDesktop`   (the ref is the ALTERNATE)
 * So a gate counts only when
 *   - it is not preceded by `!` (also `!(`);
 *   - for `&&`: no depth-0 `||` / `??` sits between it and the reference
 *     (`isDesktop && a || styles.xDesktop` applies it when the gate is false);
 *   - for `?`: the reference is in the CONSEQUENT — no depth-0 `:` between the
 *     `?` and it that closes THIS ternary (nested `a ? b : c` inside the
 *     consequent pair their own `:`; `?.` and `??` are not ternaries).
 * Exported for the self-test mutants below (A1, A2 …).
 */
export function refIsGated(prefix: string): boolean {
  for (const m of prefix.matchAll(GATE)) {
    const start = m.index!;
    if (/!\s*\(?\s*$/.test(prefix.slice(0, start))) continue; // negated gate
    const between = prefix.slice(start + m[0].length);
    if (m[1] === '&&' ? !hasDepth0(between, 'or') : !hasDepth0(between, 'alternate')) return true;
  }
  return false;
}

/** Scan `text` at bracket depth 0 (strings skipped) for a depth-0 `||` / `??`
 *  ('or') or a `:` that is not paired with a nested `?` ('alternate'). */
function hasDepth0(text: string, what: 'or' | 'alternate'): boolean {
  let depth = 0; let ternaries = 0; let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('{[('.includes(c)) { depth++; continue; }
    if ('}])'.includes(c)) { depth--; continue; }
    if (depth !== 0) continue;
    const two = text.slice(i, i + 2);
    if (what === 'or') {
      if (two === '||' || two === '??') return true;
      continue;
    }
    if (two === '?.' || two === '??') { i++; continue; }
    if (c === '?') { ternaries++; continue; }
    if (c === ':') { if (ternaries > 0) { ternaries--; continue; } return true; }
  }
  return false;
}

// Self-test: the gate reader itself, including the two inverted gates that
// used to pass (mutants A1 and A2 from the wave-6b integration review). A
// reader that regresses to "a gate token appears somewhere before" fails here
// before it can pass a phone-reaching style anywhere in the tree.
{
  const REF = 'styles.xDesktop';
  const gated = (expr: string) => refIsGated(expr.slice(0, expr.indexOf(REF)));
  const cases: Array<[string, string, boolean]> = [
    ['plain && gate', `isDesktop && ${REF}`, true],
    ['layout.isDesktop && gate', `layout.isDesktop && ${REF}`, true],
    ['consequent of a ternary', `isDesktop ? ${REF} : null`, true],
    ['nested ternary inside the consequent', `isDesktop ? (a ? b : ${REF}) : null`, true],
    ['unparenthesised nested ternary in the consequent', `isDesktop ? a ? b : ${REF} : null`, true],
    ["Platform.OS === 'web' && gate", `Platform.OS === 'web' && ${REF}`, true],
    ['A1: negated && gate', `!isDesktop && ${REF}`, false],
    ['A1b: negated parenthesised gate', `!(isDesktop) && ${REF}`, false],
    ['A2: ref in the ALTERNATE', `isDesktop ? undefined : ${REF}`, false],
    ['A2b: alternate after an optional chain', `isDesktop ? a?.b : ${REF}`, false],
    ['A3: && then || applies it when false', `isDesktop && a || ${REF}`, false],
    ['A4: ungated', `${REF}`, false],
  ];
  for (const [name, expr, want] of cases) {
    ok(`gate reader self-test — ${name}: ${want ? 'gated' : 'NOT gated'}`, gated(expr) === want, expr);
  }
}
const NON_STYLE_DESKTOP = /^(is|show|use|on|was|has|can|should|set)[A-Z]/;
const GATE_TOKEN = /\b(?:isDesktop\w*|isWide\w*|showSidebar|isWeb\w*|desktop|wide)\b|Platform\.OS\s*===\s*['"]web['"]/;

/** Offset ranges of `src` that only run on desktop by CONTROL FLOW: the body
 *  of `if (isDesktop…) …`, and whatever follows `if (!isDesktop…) { return … }`
 *  up to the end of the enclosing block. (A primitive's desktop branch is
 *  usually an early return, not a style expression.) */
function desktopRanges(src: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of src.matchAll(/\bif\s*\(/g)) {
    const condOpen = m.index! + m[0].length - 1;
    const cond = balanced(src, condOpen);
    const condText = cond.slice(1, -1).trim();
    if (!GATE_TOKEN.test(condText)) continue;
    let k = condOpen + cond.length;
    while (/\s/.test(src[k] ?? '')) k++;
    const thenEnd = src[k] === '{' ? k + balanced(src, k).length : src.indexOf(';', k) + 1;
    if (thenEnd <= k) continue;
    const negated = /^!\s*\(?\s*(?:isDesktop\w*|desktop|isWide\w*|showSidebar|isWeb\w*)\b\s*\)?$/.test(condText);
    if (!negated && !condText.startsWith('!')) { out.push([k, thenEnd]); continue; }
    if (negated && /\breturn\b/.test(src.slice(k, thenEnd))) {
      // The enclosing block: walk back to the unmatched '{'.
      let depth = 0; let j = m.index! - 1;
      for (; j >= 0; j--) { if (src[j] === '}') depth++; else if (src[j] === '{') { if (depth === 0) break; depth--; } }
      if (j < 0) continue;
      out.push([thenEnd, j + balanced(src, j).length]);
    }
  }
  return out;
}

const ungated: string[] = [];
for (const [file, src] of code) {
  const flowGated = desktopRanges(src);
  // Names imported from the desktop helper module count as desktop styles.
  const helperNames = new Set<string>();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/components\/ui\/desktop['"]/g)) {
    for (const n of m[1].split(',')) { const id = n.trim().split(/\s+as\s+/).pop(); if (id) helperNames.add(id); }
  }
  for (const m of src.matchAll(/\b\w*[sS]tyle=\{/g)) {
    if (flowGated.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    const expr = balanced(src, m.index! + m[0].length - 1).slice(1, -1).trim();
    const pieces = expr.startsWith('[') && balanced(expr, 0).length === expr.length ? topLevelParts(expr.slice(1, -1)) : [expr];
    for (const piece of pieces) {
      const refs: Array<{ ref: string; at: number }> = [];
      for (const r of piece.matchAll(/\b([A-Za-z_$][\w$]*Desktop)\b/g)) {
        if (NON_STYLE_DESKTOP.test(r[1]) || r[1] === 'isDesktop') continue;
        refs.push({ ref: r[1], at: r.index! });
      }
      for (const r of piece.matchAll(/\bLayout\.[\w.]+/g)) refs.push({ ref: r[0], at: r.index! });
      for (const n of helperNames) {
        const at = piece.search(new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`));
        if (at >= 0) refs.push({ ref: n, at });
      }
      for (const { ref, at } of refs) {
        if (refIsGated(piece.slice(0, at))) continue;
        ungated.push(`${file}::${ref}`);
      }
    }
  }
}
const ungatedSet = [...new Set(ungated)].sort();
const newUngated = ungatedSet.filter((k) => !UNGATED_BASELINE.has(k));
ok(`every desktop style in a style prop is gated on isDesktop (${UNGATED_BASELINE.size} baselined exceptions)`, newUngated.length === 0,
  'Append it as `isDesktop && styles.xDesktop` (or `isDesktop ? … : …`) so a phone flattens it away:\n        '
  + newUngated.join('\n        '));
const fixedBaseline = [...UNGATED_BASELINE].filter((k) => !ungatedSet.includes(k));
if (fixedBaseline.length) note(`gated now — delete from UNGATED_BASELINE: ${fixedBaseline.join(', ')}`);

console.log('\ndesktop layout — Button and the shell list:');
const button = code.get('components/ui/Button.tsx') ?? '';
ok('Button exposes a containerStyle prop for layout keys', /\bcontainerStyle\?\s*:/.test(button) && /\bcontainerStyle\b[\s\S]*Animated\.View\s+style=\{wrapperStyle\}/.test(button));
ok("Button's wrapper carries the desktop sizing behind the desktop gate",
  /const\s+wrapperStyle[\s\S]{0,120}=\s*desktop\s*\?/.test(button) && /Layout\.button\.fullWidthMax/.test(button));
const appRoutes = new Set(files.filter((f) => rel(f).startsWith('app/')).map((f) => rel(f).replace(/^app\//, '').replace(/\.(tsx|ts)$/, '')));
const ghostExempt = [...DESKTOP_SHELL_EXEMPT].filter((r) => !appRoutes.has(r));
ok('DESKTOP_SHELL_EXEMPT names only real route files', ghostExempt.length === 0, ghostExempt.join(', '));

// ═══ C. pins for the live-measured offenders ═══════════════════════════════

console.log('\ndesktop layout — pins (the offenders the audit measured live):');
type Pin = { name: string; file: string; fixed: boolean; isFixed: (src: string) => boolean };

/** Direct JSX children of the first `<View style={…styles.NAME…}>` element. */
function directChildren(src: string, styleName: string): number {
  const m = new RegExp(`<View\\b[^>]*style=\\{[^}]*\\bstyles\\.${styleName}\\b[^>]*>`).exec(src);
  if (!m) return -1;
  let i = m.index + m[0].length; let depth = 0; let count = 0;
  while (i < src.length) {
    if (src[i] === '{') { const b = balanced(src, i); if (depth === 0 && /<[A-Z]/.test(b)) count++; i += b.length; continue; }
    if (src.startsWith('</', i)) { if (depth === 0) return count; depth--; i = src.indexOf('>', i) + 1; continue; }
    if (src[i] === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) {
      const end = src.indexOf('>', i);
      const selfClosing = src[end - 1] === '/';
      if (depth === 0) count++;
      if (!selfClosing) depth++;
      i = end + 1; continue;
    }
    i++;
  }
  return count;
}

const PINS: Pin[] = [
  {
    name: "the schedule tab's desktopHeaderLeft has no fixed width: 260",
    file: 'app/(tabs)/schedule/index.tsx', fixed: false,
    isFixed: (s) => !/desktopHeaderLeft:\s*\{[^}]*\bwidth:\s*260\b/.test(s),
  },
  {
    name: 'project-detail applies quickActionBtnFull only under !isDesktop',
    file: 'app/project-detail.tsx', fixed: false,
    isFixed: (s) => {
      const uses = [...s.matchAll(/styles\.quickActionBtnFull\b/g)];
      return uses.length > 0 && uses.every((u) => /!\s*isDesktop\s*&&\s*$/.test(s.slice(Math.max(0, u.index! - 40), u.index!)));
    },
  },
  {
    name: "SchedulerMenuBar's dropdown has no fixed top: 96",
    file: 'components/schedule/SchedulerMenuBar.tsx', fixed: false,
    isFixed: (s) => !/\bdropdown:\s*\{[^}]*\btop:\s*96\b/.test(s),
  },
  {
    name: "schedule-pro's tabShellBody row holds only the shell and the inspector",
    file: 'app/schedule-pro.tsx', fixed: false,
    isFixed: (s) => { const n = directChildren(s, 'tabShellBody'); return n > 0 && n <= 2; },
  },
  {
    name: "TodayView's emptyActive has a desktop variant",
    file: 'components/schedule/TodayView.tsx', fixed: false,
    isFixed: (s) => /\bemptyActiveDesktop\b/.test(s),
  },
];
for (const pin of PINS) {
  const src = code.get(pin.file);
  if (src === undefined) { ok(`${pin.name} (file exists)`, existsSync(join(ROOT, pin.file)), `${pin.file} is gone — move the pin with the code.`); continue; }
  const now = pin.isFixed(src);
  if (pin.fixed) ok(pin.name, now, `${pin.file}: this was fixed and has come back.`);
  else if (now) note(`${pin.name} — FIXED now: set fixed: true in PINS to lock it.`);
  else console.log(`  OPEN  ${pin.name} (wave 6c)`);
}

console.log('\nmeasured: ' + JSON.stringify(counts));
if (failures > 0) {
  console.error(`\n✗ validate-desktop-layout: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n✓ validate-desktop-layout: no new stretch, no ungated desktop style');
