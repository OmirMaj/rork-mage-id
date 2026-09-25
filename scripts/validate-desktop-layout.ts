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
// RE-BASELINED ONCE at the 6b merge onto main (after wave 6a, 29fd92b1), as the
// 6b handoff required: 6a's schedule surfaces added 4 page-width literals
// (ScheduleBuilderInterview 720, copilot-hub, discover/schedule, the tab) that
// 6c converts to Layout tokens. unframedTransparentModalFiles dropped to 58.
// RE-MEASURED ONCE MORE at the wave-6c base (77c00f3d = 6a + 6b + tutorials +
// phase0 + DA + fixq), lane S, as the 6c spec required (X0.5b):
//   pageWidthLiterals 53 (unchanged — the 6b L1 handoff's 50 assumed three
//   literals the 6c lanes have not converted yet), stretchedSegments 45 → 30
//   (label / text / left / title / body parts are no longer counted),
//   unframedTransparentModalFiles 57 → 55, the rest unchanged. From here the
//   lanes only lower them; the orchestrator edits this block at integration.
// Wave-6c phase A integration (orchestrator): pageWidthLiterals 53 → 50,
//   stretchedSegments 30 → 5, unframedTransparentModalFiles 55 → 47,
//   growingDesktopTiles 14 → 13, hiddenScrollbarRails 116 → 111 — each the
//   count measured on the phase-A tree.
// Wave-6c phase B integration (orchestrator): pageWidthLiterals 50 → 45,
//   stretchedSegments 5 → 4, unframedTransparentModalFiles 47 → 32,
//   hiddenScrollbarRails 111 → 109 — measured on the phase-B tree.
// Wave-6d P0 (orchestrator): unframedTransparentModalFiles 32 → 28 — the
//   counter now skips SHEET_EXEMPT, and the phone-only schedule sheets and
//   SidePanel's phone branch joined it. The rest re-measured unchanged.
// Wave-6d phase 1 integration (orchestrator): stretchedButtons 5 → 0 (a flex:1
//   Button inside an <ActionBar> no longer counts), unframedTransparentModalFiles
//   28 → 24, pageSheetModals 27 → 23; 12 files reached sheet parity.
const CEILING = {
  /** Numeric `maxWidth` literals ≥ 700 in app/ + components/ — page and
   *  column caps that should each be a Layout token. */
  pageWidthLiterals: 45,
  /** seg/segment/tab/toggle/mode style entries that stretch (flex:1 /
   *  flexGrow:1) with no `segmentedDesktop` companion at their use site.
   *  Excludes components/schedule/mobile and `…Phone` styles. */
  stretchedSegments: 4,
  /** Files with a transparent <Modal> and no desktop frame (no Sheet /
   *  useSheetFrame, no maxWidth anywhere in the file). SHEET_EXEMPT files are
   *  skipped (wave 6d): they never render a desktop sheet. */
  unframedTransparentModalFiles: 24,
  /** Non-transparent pageSheet <Modal>s (full-window on web). */
  pageSheetModals: 23,
  /** Percent-width tile literals (width / flexBasis / minWidth of 22–25%,
   *  30–33% or 45–49%) — tiles sized from the row, not from a minimum. */
  percentTileLiterals: 26,
  /** Desktop tile styles that combine flexGrow:1 with a numeric flexBasis
   *  (the last row's orphan stretches across the page). */
  growingDesktopTiles: 13,
  /** `showsHorizontalScrollIndicator={false}` — a desktop mouse has no swipe,
   *  so a hidden-scrollbar rail hides its own overflow. */
  hiddenScrollbarRails: 109,
  /** `<Button style={{ flex: 1 }}>` — a stretched button; containerStyle is
   *  the replacement. */
  stretchedButtons: 0,
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

export function stripComments(src: string): string {
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

/** `<ActionBar …>…</ActionBar>` index spans (nesting-aware; a self-closing
 *  `<ActionBar … />` has no children and no span). ActionBar's desktop branch
 *  clones every child with flexGrow/flexShrink/flexBasis longhands, so a
 *  `style={{ flex: 1 }}` Button inside one is the phone's half-width split and
 *  a hugging 40 px button on desktop — not a stretched button. Wave 6d. */
function actionBarSpans(src: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const stack: number[] = [];
  const tok = /<ActionBar\b|<\/ActionBar>/g;
  for (let m = tok.exec(src); m; m = tok.exec(src)) {
    if (m[0] === '</ActionBar>') {
      const start = stack.pop();
      if (start !== undefined) spans.push([start, m.index + m[0].length]);
      continue;
    }
    if (!/\/>$/.test(openingTag(src, m.index))) stack.push(m.index);
  }
  return spans;
}
/** `<Button … style={{ flex: 1 }}>` tags that are NOT inside an ActionBar. */
function stretchedButtonTags(src: string): string[] {
  const spans = actionBarSpans(src);
  return [...src.matchAll(/<Button\b/g)]
    .filter((m) => !spans.some(([a, b]) => m.index! > a && m.index! < b))
    .map((m) => openingTag(src, m.index!))
    .filter((t) => /\sstyle=\{\{\s*flex:\s*1\s*\}\}/.test(t));
}

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
/** A style whose LAST camel word is one of these is the text or a side slot
 *  inside a segment (`tabLabel`, `modeText`, `segLeft`), not the segment box —
 *  its flex:1 fills the box it sits in. Wave 6c: removed 14 false positives. */
const SEGMENT_PART_WORDS = new Set(['label', 'labels', 'text', 'left', 'title', 'body']);
/** Is this style name a segment BOX (counted when it stretches)? */
export function isSegmentBoxName(name: string): boolean {
  if (/Phone$/.test(name)) return false;
  const words = camelWords(name);
  return words.some((w) => SEGMENT_WORDS.has(w)) && !SEGMENT_PART_WORDS.has(words[words.length - 1]);
}

/** B2 sheet adoption — permanent: a Modal here is not a desktop sheet, and
 *  never becomes one. Declared here (not in B2) because the A. measure loop
 *  below skips these files in unframedTransparentModalFiles too (wave 6d). */
const SHEET_EXEMPT: ReadonlyMap<string, string> = new Map([
  ['components/punch/PlanPinStep.tsx', 'the tutorial layer host: a full-screen plan canvas the tutorial draws over, not a sheet'],
  ['components/PersonaSwitchOverlay.tsx', 'a full-window persona transition animation, not a dialog'],
  ['app/dev-ar-measure.tsx', 'the owner-only AR measurement dev harness'],
  // Wave 6d: phone-only. The B2 pins below keep the reason true.
  ['components/schedule/mobile/MobileScheduleScreen.tsx', 'phone-only: rendered only under layout.isPhone (app/(tabs)/schedule/index.tsx), so a desktop frame can never reach it'],
  ['components/schedule/mobile/TaskDetailSheet.tsx', 'phone-only: rendered only under layout.isPhone (app/(tabs)/schedule/index.tsx), so a desktop frame can never reach it'],
  ['components/schedule/mobile/MonthCalendarSheet.tsx', 'phone-only: rendered only under layout.isPhone (app/(tabs)/schedule/index.tsx), so a desktop frame can never reach it'],
  ['components/desktop/SidePanel.tsx', 'its Modal is the phone branch (!isDesktop), where the hotkey registry never runs; the desktop panel is not a Modal'],
]);

for (const [file, src] of code) {
  for (const m of src.matchAll(/\bmaxWidth:\s*(\d+)\b/g)) if (Number(m[1]) >= 700) counts.pageWidthLiterals++;

  if (!file.startsWith('components/schedule/mobile/')) {
    for (const { name, body } of styleEntries(src)) {
      if (!isSegmentBoxName(name)) continue;
      // Only the style's OWN keys (a nested object would be another entry).
      const own = body.slice(1, -1).replace(/\{[^{}]*\}/g, '');
      if (!/\bflex(?:Grow)?:\s*1\b/.test(own)) continue;
      const companion = new RegExp(`\\.${name}\\b[^\\]]{0,240}segmentedDesktop`).test(src);
      if (!companion) counts.stretchedSegments++;
    }
  }

  const modals = tagsOf(src, 'Modal');
  if (!SHEET_EXEMPT.has(file)
    && modals.some((t) => /\btransparent\b/.test(t)) && !/\buseSheetFrame\b|<Sheet\b/.test(src) && !/\bmaxWidth\b/.test(src)) {
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
  counts.stretchedButtons += stretchedButtonTags(src).length;
}

// Self-test: the segment-name filter (wave 6c X0.5a).
{
  const cases: Array<[string, boolean]> = [
    ['segment', true], ['tabButton', true], ['modeToggle', true], ['segmentActive', true],
    ['tabLabel', false], ['segText', false], ['modeLeft', false], ['tabTitle', false], ['toggleBody', false],
    ['segmentLabels', false], ['tabPhone', false], ['headerRow', false],
  ];
  for (const [name, want] of cases) ok(`segment-name self-test — ${name}: ${want ? 'a box' : 'not counted'}`, isSegmentBoxName(name) === want);
}

// Self-test: the stretched-button scanner skips ActionBar children (wave 6d).
{
  const inside = '<ActionBar style={s.row} width="form"><Button label="Save" onPress={() => save()} style={{ flex: 1 }} /></ActionBar>';
  const outside = '<View style={s.row}><Button label="Send" style={{ flex: 1 }} /></View>';
  ok('stretched-button self-test — a flex:1 Button inside an <ActionBar> is not counted', stretchedButtonTags(inside).length === 0);
  ok('stretched-button self-test — a flex:1 Button outside one is counted', stretchedButtonTags(outside).length === 1);
  ok('stretched-button self-test — one inside and one after the bar: only the one after counts', stretchedButtonTags(inside + outside).length === 1);
  ok('stretched-button self-test — a self-closing <ActionBar /> opens no span', stretchedButtonTags('<ActionBar />' + outside).length === 1);
  ok('stretched-button self-test — <ActionBarReadout> is not a bar', stretchedButtonTags('<ActionBarReadout><Button style={{ flex: 1 }} /></ActionBarReadout>').length === 1);
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
// Wave 6c (X0.4): `isWeb…` and `Platform.OS === 'web'` are NOT desktop gates —
// a 390 px phone browser is web too, so `isWeb && styles.xDesktop` reaches a
// phone. Only the breakpoint gates count.
const GATE = /(?:\bisDesktop\w*|\bisWide\w*|\bshowSidebar|\bdesktop\b|\bwide\b)\s*\)?\s*(&&|\?(?![.?]))/g;

/**
 * Is a reference that starts `prefix.length` chars into a style piece applied
 * ONLY when the gate is true? A gate token followed by `&&` or `?` somewhere
 * before it is not enough — both of these read "gated" to a plain search and
 * put the desktop style on the PHONE:
 *   `!isDesktop && styles.xDesktop`            (the gate is negated)
 *   `isDesktop ? undefined : styles.xDesktop`   (the ref is the ALTERNATE)
 * So a gate counts only when
 *   - it is not preceded by `!` (also `!(`, and `!layout.` / `!a?.b.` — the
 *     negation of a member chain, wave 6c M1);
 *   - for `&&`: no depth-0 `||` / `??` sits between it and the reference
 *     (`isDesktop && a || styles.xDesktop` applies it when the gate is false);
 *     and when a depth-0 ternary `?` follows (`isDesktop && c ? A : B` parses
 *     `(isDesktop && c) ? A : B` — `&&` binds tighter than `?:`), the
 *     reference must sit in THAT ternary's consequent: `A` runs only when the
 *     gate holds, `B` exactly when it may not (wave 6c M2 — the 6b reader
 *     read `isDesktop && ready ? null : styles.x` as gated);
 *   - for `?`: the reference is in the CONSEQUENT — no depth-0 `:` between the
 *     `?` and it that closes THIS ternary (nested `a ? b : c` inside the
 *     consequent pair their own `:`; `?.` and `??` are not ternaries).
 * Exported for the self-test mutants below (A1, A2 …).
 */
export function refIsGated(prefix: string): boolean {
  for (const m of prefix.matchAll(GATE)) {
    const start = m.index!;
    if (/!\s*\(?\s*(?:[\w$]+\??\.)*$/.test(prefix.slice(0, start))) continue; // negated gate
    const between = prefix.slice(start + m[0].length);
    if (m[1] === '&&' ? andGated(between) : !hasDepth0(between, 'alternate')) return true;
  }
  return false;
}

/** `gate && <between> REF`: no depth-0 `||` / `??`; and if a depth-0 ternary
 *  `?` follows the gate, REF is in its consequent (no unpaired `:` after it). */
function andGated(between: string): boolean {
  if (hasDepth0(between, 'or')) return false;
  const q = depth0TernaryAt(between);
  return q < 0 || !hasDepth0(between.slice(q + 1), 'alternate');
}

/** Offset of the first depth-0 ternary `?` (not `?.`, not `??`), or -1. */
function depth0TernaryAt(text: string): number {
  let depth = 0; let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('{[('.includes(c)) { depth++; continue; }
    if ('}])'.includes(c)) { depth--; continue; }
    if (depth !== 0) continue;
    const two = text.slice(i, i + 2);
    if (two === '?.' || two === '??') { i++; continue; }
    if (c === '?') return i;
  }
  return -1;
}

/** Scan `text` at bracket depth 0 (strings skipped) for a depth-0 `||` / `??`
 *  ('or'), a `:` that is not paired with a nested `?` ('alternate'), or a
 *  ternary `?` — not `?.`, not `??` ('ternary'). */
function hasDepth0(text: string, what: 'or' | 'alternate' | 'ternary'): boolean {
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
    if (what === 'ternary') { if (c === '?') return true; continue; }
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
    // Wave 6c: a phone browser is web too — not a desktop gate.
    ["Platform.OS === 'web' && gate is NOT a desktop gate", `Platform.OS === 'web' && ${REF}`, false],
    ['isWeb && gate is NOT a desktop gate', `isWeb && ${REF}`, false],
    ['A1: negated && gate', `!isDesktop && ${REF}`, false],
    ['A1b: negated parenthesised gate', `!(isDesktop) && ${REF}`, false],
    ['A2: ref in the ALTERNATE', `isDesktop ? undefined : ${REF}`, false],
    ['A2b: alternate after an optional chain', `isDesktop ? a?.b : ${REF}`, false],
    ['A3: && then || applies it when false', `isDesktop && a || ${REF}`, false],
    ['A4: ungated', `${REF}`, false],
    // Wave 6c (X0.4), the negation holes the 6b review found:
    ['M1: negated member-chain gate', `!layout.isDesktop && ${REF}`, false],
    ['M1b: negated optional member chain', `!layout?.isDesktop && ${REF}`, false],
    ['M2: && then a ternary puts the ref in the alternate', `isDesktop && ready ? null : ${REF}`, false],
    ['M2b: (gate && c) ? REF : … — the consequent runs only when the gate holds', `isDesktop && ready ? ${REF} : null`, true],
    ['M2c: an alternate after a nested consequent ternary', `isDesktop && ready ? x : d ? ${REF} : null`, false],
    ['M2d: || before the ternary', `isDesktop && a || b ? ${REF} : null`, false],
    ['M2 rewrite: isDesktop && c && X', `isDesktop && ready && ${REF}`, true],
    ['?? after && is not a ternary but is an or', `isDesktop && a ?? ${REF}`, false],
    ['an optional chain after && stays gated', `isDesktop && a?.b && ${REF}`, true],
  ];
  for (const [name, expr, want] of cases) {
    ok(`gate reader self-test — ${name}: ${want ? 'gated' : 'NOT gated'}`, gated(expr) === want, expr);
  }
}
const NON_STYLE_DESKTOP = /^(is|show|use|on|was|has|can|should|set)[A-Z]/;
const GATE_TOKEN = /\b(?:isDesktop\w*|isWide\w*|showSidebar|desktop|wide)\b/;
/** One `&&` conjunct that IS the gate: a bare (member-chained, optionally
 *  parenthesised) gate name — no `!`, no `===` / `!==` (wave 6c X0.4). */
const GATE_CONJUNCT = /^\(?\s*(?:[\w$]+\??\.)*(?:isDesktop\w*|isWide\w*|showSidebar|desktop|wide)\s*\)?$/;
/** `!G` for the early-return form, member chains allowed. */
const NEGATED_GATE = /^!\s*\(?\s*(?:[\w$]+\??\.)*(?:isDesktop\w*|desktop|isWide\w*|showSidebar)\b\s*\)?$/;

/** Split a condition on its depth-0 `&&`; null when it has a depth-0 `||`,
 *  `??` or ternary `?` (then no conjunct decides it). */
function conjuncts(cond: string): string[] | null {
  if (hasDepth0(cond, 'or') || hasDepth0(cond, 'ternary')) return null;
  const parts: string[] = [];
  let depth = 0; let start = 0; let quote: string | null = null;
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i];
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('{[('.includes(c)) { depth++; continue; }
    if ('}])'.includes(c)) { depth--; continue; }
    if (depth === 0 && cond.slice(i, i + 2) === '&&') { parts.push(cond.slice(start, i)); start = i + 2; i++; }
  }
  parts.push(cond.slice(start));
  return parts.map((p) => p.trim());
}

/** Offset ranges of `src` that only run on desktop by CONTROL FLOW: the body
 *  of `if (isDesktop…) …`, and whatever follows `if (!isDesktop…) { return … }`
 *  up to the end of the enclosing block. (A primitive's desktop branch is
 *  usually an early return, not a style expression.)
 *  Wave 6c (X0.4): `if (C)` counts only when one `&&` conjunct of C is exactly
 *  the gate and C has no depth-0 `||` / `??` / `?` — so
 *  `if (authLoading && !isDesktop) return …` (m3) and
 *  `if (isDesktop === false) return …` (m4) are NOT desktop ranges.
 *  Exported for the self-tests. */
export function desktopRanges(src: string): Array<[number, number]> {
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
    const negated = NEGATED_GATE.test(condText);
    const parts = negated ? null : conjuncts(condText);
    if (parts && parts.some((p) => GATE_CONJUNCT.test(p))) { out.push([k, thenEnd]); continue; }
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

/** Every desktop style reference in `src` (comment-stripped) that no gate
 *  covers — neither its own style expression nor a desktop control-flow range.
 *  Exported so a mutant of a real site can be run through the same scan. */
export function ungatedRefs(src: string): string[] {
  const found: string[] = [];
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
        found.push(ref);
      }
    }
  }
  return found;
}

// Self-test: the control-flow ranges (wave 6c X0.4, m3 / m4 and the two
// forms that must stay ranges).
{
  const REF = 'styles.xDesktop';
  const inRange = (src: string) => {
    const at = src.indexOf(REF);
    return desktopRanges(src).some(([a, b]) => at >= a && at < b);
  };
  const cases: Array<[string, string, boolean]> = [
    ['m3: `if (authLoading && !isDesktop) return` is not a desktop range',
      `function A() {\n  if (authLoading && !isDesktop) return <V style={${REF}} />;\n  return null;\n}`, false],
    ['m4: `if (isDesktop === false) return` is not a desktop range',
      `function A() {\n  if (isDesktop === false) return <V style={${REF}} />;\n  return null;\n}`, false],
    ['`if (isDesktop || x)` is not a desktop range',
      `function A() {\n  if (isDesktop || x) { return <V style={${REF}} />; }\n  return null;\n}`, false],
    ['`if (isWeb)` is not a desktop range',
      `function A() {\n  if (isWeb) { return <V style={${REF}} />; }\n  return null;\n}`, false],
    ['positive control: `if (layout.isDesktop && x) { REF }`',
      `function A() {\n  if (layout.isDesktop && x) { return <V style={${REF}} />; }\n  return null;\n}`, true],
    ['positive control: `if (!layout.isDesktop) return null; REF`',
      `function A() {\n  if (!layout.isDesktop) return null;\n  return <V style={${REF}} />;\n}`, true],
  ];
  for (const [name, src, want] of cases) {
    ok(`range reader self-test — ${name}: ${want ? 'in range' : 'outside every range'}`, inRange(src) === want, src);
  }
}

const ungated: string[] = [];
for (const [file, src] of code) {
  for (const ref of ungatedRefs(src)) ungated.push(`${file}::${ref}`);
}
const ungatedSet = [...new Set(ungated)].sort();
const newUngated = ungatedSet.filter((k) => !UNGATED_BASELINE.has(k));
ok(`every desktop style in a style prop is gated on isDesktop (${UNGATED_BASELINE.size} baselined exceptions)`, newUngated.length === 0,
  'Append it as `isDesktop && styles.xDesktop` (or `isDesktop ? … : …`) so a phone flattens it away:\n        '
  + newUngated.join('\n        '));
const fixedBaseline = [...UNGATED_BASELINE].filter((k) => !ungatedSet.includes(k));
if (fixedBaseline.length) note(`gated now — delete from UNGATED_BASELINE: ${fixedBaseline.join(', ')}`);

// ═══ B2. sheet adoption (wave 6c, X0.5c) ═══════════════════════════════════
// Every hand-rolled sheet adopts components/ui/Sheet's useSheetFrame the SAME
// way (the Sheet.tsx header): the audit's "no new uncapped flex-end overlay"
// lint. Hard rules, per file, no ceiling:
//   SA1  every useSheetFrame( call passes `visible` and `animationType`;
//   SA2  in a file that uses a frame, every <Modal> has onRequestClose (RN-web
//        closes on Esc through it);
//   SA3  `transparent={…X.transparent…}` outside Sheet.tsx only when X is a
//        `useSheetFrame('panel'` frame AND the expression is exactly
//        `X.transparent` on a <Modal> that carries presentationStyle= (a phone
//        keeps its native page sheet), or exactly `X.transparent ?? false`.
//        Anything else turns a transparent phone sheet opaque (wave 6d);
//   SA4  X.overlay / card / backdrop / scrollContent / footer / footerButton
//        only as a NON-first element of a style array (`[styles.a, X.card]`),
//        never bare — the phone style must come first so a phone is unchanged;
//   SA5  X.showHandle only as a render condition (`X.showHandle && …` / `? :`);
//   SA6  consumed-frame parity (wave 6d): a <Modal> carrying
//        `animationType={F.animationType}` for a `const F = useSheetFrame(` is
//        framed; the rest must fit the budget useSheetDialogScope( + `<Sheet `
//        + the useSheetFrame( calls no tag consumes — unless the file is in
//        SHEET_PENDING (not converted yet) or SHEET_EXEMPT (never). Never
//        stricter than the 6c count rule, because framed ≥ consumed frames;
//   SA7  a frame consumed by 2+ <Modal>s: every one's `visible={E}` equals the
//        frame's `visible: E` (whitespace-normalised) — the frame's visible is
//        what claims the dialog scope and measures the inset.

/** Files that were short of parity on the wave-6c base (77c00f3d, measured
 *  mechanically: every app/ + components/ file whose `<Modal` count exceeded
 *  its useSheetFrame( + useSheetDialogScope( + `<Sheet ` count — 142 files;
 *  AlertHost and UniversalSearch reached parity in lane S itself, so the
 *  seed is the other 140). The 6c lanes
 *  convert them; one that reaches parity prints "delete from SHEET_PENDING".
 *  NEVER ADD A FILE — a new Modal adopts the frame when it lands. Lanes do not
 *  edit this block; the orchestrator trims it at integration.
 *  Wave 6d P0: 91 → 86 — estimate/full reached parity under consumed-frame
 *  SA6; the three phone-only schedule sheets and SidePanel moved to
 *  SHEET_EXEMPT. */
const SHEET_PENDING: ReadonlySet<string> = new Set<string>([
  'app/(tabs)/discover/bids.tsx',
  'app/(tabs)/materials/[category].tsx',
  'app/(tabs)/schedule/index.tsx',
  'app/(tabs)/settings/index.tsx',
  'app/(tabs)/subs/index.tsx',
  'app/aia-pay-app.tsx',
  'app/building-access.tsx',
  'app/buyout-package.tsx',
  'app/buyout.tsx',
  'app/cash-flow.tsx',
  'app/client-view.tsx',
  'app/company-profile.tsx',
  'app/contacts.tsx',
  'app/crew.tsx',
  'app/deliveries.tsx',
  'app/equipment-detail.tsx',
  'app/estimate-wizard.tsx',
  'app/get-verified.tsx',
  'app/job-costing.tsx',
  'app/lead-detail.tsx',
  'app/lien-waivers.tsx',
  'app/managed-property.tsx',
  'app/oac-meeting.tsx',
  'app/plan-intelligence.tsx',
  'app/plan-viewer.tsx',
  'app/plans.tsx',
  'app/qbo-review.tsx',
  'app/shared-schedule.tsx',
  'app/wip-report.tsx',
  'app/work-order.tsx',
  'components/AIBidScorer.tsx',
  'components/AIProjectReport.tsx',
  'components/AIQuickEstimate.tsx',
  'components/AIWeeklySummary.tsx',
  'components/AssemblyEditorModal.tsx',
  'components/CSIDivisionPicker.tsx',
  'components/CashFlowSetup.tsx',
  'components/ClientDocumentAskSheet.tsx',
  'components/ClientPaywall.tsx',
  'components/ConfirmEmailModal.tsx',
  'components/CreateMenu.tsx',
  'components/DemoSeedPickerModal.tsx',
  'components/EntityActionSheet.tsx',
  'components/EstimateComparison.tsx',
  'components/EstimateLoadingOverlay.tsx',
  'components/FeatureExplainerSheet.tsx',
  'components/HelpFab.tsx',
  'components/InfoBubble.tsx',
  'components/InstantBidProposalModal.tsx',
  'components/MaterialAIEstimateModal.tsx',
  'components/OfflineSyncPill.tsx',
  'components/Paywall.tsx',
  'components/ProductivityCalculator.tsx',
  'components/PropertyManagerHome.tsx',
  'components/QuickFieldUpdate.tsx',
  'components/QuickUpdateClarifier.tsx',
  'components/RFITriageModal.tsx',
  'components/RateOverrideModal.tsx',
  'components/RecordPaymentModal.tsx',
  'components/ReferralPrompt.tsx',
  'components/SquareFootEstimator.tsx',
  'components/SubDailyUpdateModal.tsx',
  'components/TakeoffFieldVerifyButton.tsx',
  'components/TakeoffPageInspector.tsx',
  'components/UniversalMicButton.tsx',
  'components/UpgradeSheet.tsx',
  'components/VoiceCommandModal.tsx',
  'components/copilot/ScheduleEditPanel.tsx',
  'components/desktop/JobSwitcher.tsx',
  'components/desktop/ToolbarActions.tsx',
  'components/estimate/RateProvenanceChip.tsx',
  'components/punch/PunchExportSheet.tsx',
  'components/punch/PunchPhotoViewer.tsx',
  'components/summary/ToolsSheet.tsx',
]);

const FRAME_PARTS = /^(?:overlay|card|backdrop|scrollContent|footer|footerButton)$/;
const countOf = (src: string, re: RegExp) => (src.match(re) ?? []).length;
const noWs = (s: string) => s.replace(/\s+/g, '');

/** Every `const F = useSheetFrame(…)`: where it is, its argument list and its
 *  `visible` expression (whitespace-stripped; shorthand `visible` is `visible`).
 *  A file may declare the same name in several components (schedule-wizard has
 *  three `f`s), so a frame is a DECLARATION, not a name. */
type FrameDecl = { name: string; at: number; args: string; visible: string | null };
function sheetFrameDecls(src: string): FrameDecl[] {
  const out: FrameDecl[] = [];
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useSheetFrame\(/g)) {
    const args = balanced(src, m.index! + m[0].length - 1);
    const opts = topLevelParts(args.slice(1, -1))[1] ?? '';
    let visible: string | null = null;
    if (opts.startsWith('{')) {
      for (const part of topLevelParts(opts.slice(1, -1))) {
        const v = /^visible\s*(?::([\s\S]+))?$/.exec(part);
        if (v) { visible = noWs(v[1] ?? 'visible'); break; }
      }
    }
    out.push({ name: m[1], at: m.index!, args, visible });
  }
  return out;
}
/** The declaration of `name` in scope at `at`: the nearest one before it (the
 *  hook sits above the JSX it frames), else the first one. */
function declAt(decls: FrameDecl[], name: string, at: number): FrameDecl | null {
  const same = decls.filter((d) => d.name === name);
  return [...same].reverse().find((d) => d.at < at) ?? same[0] ?? null;
}
/** Every <Modal> opening tag with its offset. */
const modalTagsAt = (src: string) =>
  [...src.matchAll(/<Modal\b/g)].map((m) => ({ at: m.index!, tag: openingTag(src, m.index!) }));
/** The frame a <Modal> opening tag consumes (`animationType={F.animationType}`). */
function consumedFrame(tag: string, at: number, decls: FrameDecl[]): FrameDecl | null {
  const name = /\banimationType=\{\s*([A-Za-z_$][\w$]*)\.animationType\s*\}/.exec(tag)?.[1];
  return name ? declAt(decls, name, at) : null;
}
/** A tag's `visible={E}` (whitespace-stripped), `true` for a bare `visible`. */
function tagVisible(tag: string): string | null {
  const m = /\svisible=\{/.exec(tag);
  if (m) return noWs(balanced(tag, m.index + m[0].length - 1).slice(1, -1));
  return /\svisible(?=[\s/>])/.test(tag) ? 'true' : null;
}

/** The SA1–SA5 violations in one (comment-stripped) file. Exported for the
 *  self-test below. */
export function sheetAdoptionErrors(file: string, src: string): string[] {
  const errs: string[] = [];
  const frames = new Set<string>();
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*useSheetFrame\(/g)) frames.add(m[1]);
  // SA1
  for (const m of src.matchAll(/\buseSheetFrame\(/g)) {
    if (/function\s+useSheetFrame\($/.test(src.slice(Math.max(0, m.index! - 20), m.index! + m[0].length))) continue;
    const args = balanced(src, m.index! + m[0].length - 1);
    if (!/\bvisible\b/.test(args) || !/\banimationType\b/.test(args)) {
      errs.push(`SA1 ${file}: useSheetFrame${args.replace(/\s+/g, ' ').slice(0, 80)} must pass { visible, animationType }`);
    }
  }
  // SA2
  if (frames.size > 0) {
    for (const tag of tagsOf(src, 'Modal')) {
      if (!/\bonRequestClose\b/.test(tag)) errs.push(`SA2 ${file}: a <Modal> in a framed file has no onRequestClose`);
    }
  }
  // SA3
  // Sheet.tsx is the primitive itself (its own footer <Button>s have no phone
  // style to come first; its pageSheet branch is what SA3 reserves for it).
  // Elsewhere only a 'panel' frame may drive transparent, in one of two exact
  // forms (wave 6d): `X.transparent` beside presentationStyle= (a phone keeps
  // its native page sheet), or `X.transparent ?? false`.
  const isPrimitive = file === 'components/ui/Sheet.tsx';
  const decls = sheetFrameDecls(src);
  if (!isPrimitive) {
    const modals = modalTagsAt(src);
    for (const m of src.matchAll(/(?<![\w$])transparent=\{/g)) {
      const expr = balanced(src, m.index! + m[0].length - 1).slice(1, -1).trim().replace(/\s+/g, ' ');
      const x = /([A-Za-z_$][\w$]*)\s*\??\.\s*transparent\b/.exec(expr)?.[1];
      if (!x) continue;
      const decl = declAt(decls, x, m.index!);
      const tag = modals.find((t) => m.index! > t.at && m.index! < t.at + t.tag.length)?.tag ?? '';
      const legal = decl !== null && /^\(\s*['"]panel['"]/.test(decl.args)
        && ((expr === `${x}.transparent` && /\spresentationStyle=/.test(tag)) || expr === `${x}.transparent ?? false`);
      if (!legal) {
        errs.push(`SA3 ${file}: transparent={${expr}} — only a useSheetFrame('panel') frame, as X.transparent beside presentationStyle= or X.transparent ?? false (a phone would turn opaque)`);
      }
    }
  }
  for (const f of isPrimitive ? [] : frames) {
    // SA4 — every style prop that names a frame part
    for (const m of src.matchAll(/\b\w*[sS]tyle=\{/g)) {
      const expr = balanced(src, m.index! + m[0].length - 1).slice(1, -1).trim();
      const partRe = new RegExp(`\\b${f.replace(/\$/g, '\\$')}\\.(\\w+)\\b`, 'g');
      const named = [...expr.matchAll(partRe)].filter((r) => FRAME_PARTS.test(r[1]));
      if (named.length === 0) continue;
      const isArray = expr.startsWith('[') && balanced(expr, 0).length === expr.length;
      const pieces = isArray ? topLevelParts(expr.slice(1, -1)) : [expr];
      if (!isArray || new RegExp(`\\b${f.replace(/\$/g, '\\$')}\\.`).test(pieces[0] ?? '')) {
        errs.push(`SA4 ${file}: ${f}.${named[0][1]} must follow the phone style in an array ([styles.x, ${f}.${named[0][1]}]), never bare or first`);
      }
    }
    // SA5
    for (const m of src.matchAll(new RegExp(`\\b${f.replace(/\$/g, '\\$')}\\.showHandle\\b`, 'g'))) {
      const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 8);
      if (!/^\s*(?:&&|\?(?![.?]))/.test(after)) errs.push(`SA5 ${file}: ${f}.showHandle is a render condition only`);
    }
  }
  // SA7 — a frame shared by 2+ Modals: each one opens on the frame's visible.
  const consumers = new Map<FrameDecl, string[]>();
  for (const { at, tag } of modalTagsAt(src)) {
    const d = consumedFrame(tag, at, decls);
    if (d) consumers.set(d, [...(consumers.get(d) ?? []), tag]);
  }
  for (const [d, tags] of consumers) {
    if (tags.length < 2) continue;
    const want = d.visible;
    for (const tag of tags) {
      const got = tagVisible(tag);
      if (want === null || got !== want) {
        errs.push(`SA7 ${file}: ${d.name} frames ${tags.length} <Modal>s, so each one's visible={…} must be the frame's visible (${want ?? 'none'}), not ${got ?? 'none'}`);
      }
    }
  }
  return errs;
}

/** SA6: is this file short of consumed-frame parity? `modals` is the <Modal>
 *  count, `adopted` the framed tags plus the budget. */
export function sheetParityShort(src: string): { modals: number; adopted: number } | null {
  const tags = modalTagsAt(src);
  const decls = sheetFrameDecls(src);
  const consumed = new Set<FrameDecl>();
  let framed = 0;
  for (const { at, tag } of tags) {
    const d = consumedFrame(tag, at, decls);
    if (d) { framed++; consumed.add(d); }
  }
  const unconsumed = countOf(src, /\buseSheetFrame\(/g) - consumed.size;
  const budget = countOf(src, /\buseSheetDialogScope\(/g) + countOf(src, /<Sheet[\s>/]/g) + unconsumed;
  return tags.length - framed > budget ? { modals: tags.length, adopted: framed + budget } : null;
}

// Self-test: each rule goes red on its mutant and stays green on the canonical
// adoption.
{
  const GOOD = `function S({ open }) {
  const fX = useSheetFrame('form', { visible: open, animationType: 'slide' });
  return (<Modal visible={open} transparent animationType={fX.animationType} onRequestClose={close}>
    <View style={[styles.overlay, fX.overlay]}><View style={[styles.card, fX.card]}>{fX.showHandle && <View />}</View></View>
  </Modal>);
}`;
  const PANEL = GOOD.replace("useSheetFrame('form'", "useSheetFrame('panel'");
  const TWO = (visible2: string) => `function S({ open, other }) {
  const fX = useSheetFrame('form', { visible: open, animationType: 'slide' });
  return (<>
    <Modal visible={open} transparent animationType={fX.animationType} onRequestClose={close}><View /></Modal>
    <Modal visible={${visible2}} transparent animationType={fX.animationType} onRequestClose={close}><View /></Modal>
  </>);
}`;
  const RAW = `<Modal visible={other} transparent onRequestClose={close}><View /></Modal>`;
  const cases: Array<[string, string, string | null]> = [
    ['the canonical adoption passes', GOOD, null],
    ['SA1: no animationType', GOOD.replace(", animationType: 'slide'", ''), 'SA1'],
    ['SA1: no visible', GOOD.replace('visible: open, ', ''), 'SA1'],
    ['SA2: no onRequestClose', GOOD.replace(' onRequestClose={close}', ''), 'SA2'],
    ['SA3: transparent={fX.transparent}', GOOD.replace('transparent animationType', 'transparent={fX.transparent} animationType'), 'SA3'],
    ['SA4: a bare frame style', GOOD.replace('style={[styles.card, fX.card]}', 'style={fX.card}'), 'SA4'],
    ['SA4: the frame style first', GOOD.replace('[styles.overlay, fX.overlay]', '[fX.overlay, styles.overlay]'), 'SA4'],
    ['SA5: showHandle used as a value', GOOD.replace('{fX.showHandle && <View />}', '<View hidden={fX.showHandle} />'), 'SA5'],
    // Wave 6d SA3: only a 'panel' frame, in one of two exact forms.
    ['SA3: panel + pageSheet passes', PANEL.replace('transparent animationType', 'transparent={fX.transparent} presentationStyle="pageSheet" animationType'), null],
    ['SA3: panel + ?? false passes', PANEL.replace('transparent animationType', 'transparent={fX.transparent ?? false} animationType'), null],
    ['SA3: form frame + pageSheet', GOOD.replace('transparent animationType', 'transparent={fX.transparent} presentationStyle="pageSheet" animationType'), 'SA3'],
    ['SA3: panel + a bare tag without presentationStyle', PANEL.replace('transparent animationType', 'transparent={fX.transparent} animationType'), 'SA3'],
    ['SA3: panel + ?? true', PANEL.replace('transparent animationType', 'transparent={fX.transparent ?? true} animationType'), 'SA3'],
    // Wave 6d SA7: a frame shared by two Modals opens both on its own visible.
    ['SA7: two tags sharing one frame with the same visible pass', TWO('open'), null],
    ['SA7: the same visible, spaced differently, passes', TWO(' open '), null],
    ['SA7: two tags sharing one frame with different visible', TWO('other'), 'SA7'],
  ];
  for (const [name, src, want] of cases) {
    const errs = sheetAdoptionErrors('self-test.tsx', src);
    ok(`sheet adoption self-test — ${name}`, want === null ? errs.length === 0 : errs.some((e) => e.startsWith(want)), errs.join(' | '));
  }
  ok('sheet adoption self-test — SA6: two Modals and one frame is short',
    sheetParityShort('<Modal a /><Modal b />' + 'useSheetFrame(x)') !== null
    && sheetParityShort('<Modal a /><Modal b />useSheetFrame(x)useSheetDialogScope(y)') === null
    && sheetParityShort('<Modal a /><SheetOverlay frame={f}>') !== null
    && sheetParityShort('<Modal a /><Sheet visible>') === null);
  // Wave 6d SA6: consumed-frame parity.
  ok('sheet adoption self-test — SA6: two tags sharing one frame with the same visible is not short',
    sheetParityShort(TWO('open')) === null);
  ok('sheet adoption self-test — SA6: one frame consumed plus one raw tag is short',
    sheetParityShort(GOOD + RAW) !== null);
  ok('sheet adoption self-test — SA7: one name declared in two components is two frames (schedule-wizard)',
    sheetAdoptionErrors('self-test.tsx', GOOD + GOOD.replace('function S(', 'function T(').replace(/\bopen\b/g, 'shown')).length === 0);
  ok('sheet adoption self-test — SA6: one declared frame no tag consumes plus one raw tag is not short',
    sheetParityShort(`const fX = useSheetFrame('form', { visible: open, animationType: 'slide' });` + RAW) === null);
}

console.log('\ndesktop layout — sheet adoption (B2):');
const adoptionErrors: string[] = [];
const short: string[] = [];
for (const [file, src] of code) {
  adoptionErrors.push(...sheetAdoptionErrors(file, src));
  if (SHEET_EXEMPT.has(file)) continue;
  const gap = sheetParityShort(src);
  if (gap && !SHEET_PENDING.has(file)) short.push(`${file} (${gap.modals} <Modal, ${gap.adopted} adopted)`);
  if (!gap && SHEET_PENDING.has(file)) note(`${file} reached sheet parity — delete from SHEET_PENDING.`);
}
ok('SA1–SA5, SA7: every useSheetFrame adoption follows the Sheet.tsx pattern', adoptionErrors.length === 0,
  adoptionErrors.join('\n        '));
ok(`SA6: every <Modal> is a framed or dialog-scoped sheet (${SHEET_PENDING.size} pending, ${SHEET_EXEMPT.size} exempt)`, short.length === 0,
  'Adopt useSheetFrame (a hand-rolled sheet), useSheetDialogScope (an opaque pageSheet / viewer) or <Sheet>:\n        '
  + short.join('\n        '));
// The phone-only SHEET_EXEMPT entries (wave 6d) stay phone-only.
{
  const tab = code.get('app/(tabs)/schedule/index.tsx') ?? '';
  ok('SHEET_EXEMPT pin — the schedule tab renders MobileScheduleScreen only under layout.isPhone',
    /layout\.isPhone\s*\?\s*<MobileScheduleScreen/.test(tab));
  for (const sheet of ['TaskDetailSheet', 'MonthCalendarSheet']) {
    const importRe = new RegExp(`(?:\\bfrom|\\bimport\\(|\\brequire\\()\\s*['"][^'"]*\\b${sheet}['"]`);
    const importers = [...code].filter(([f, s]) => !f.endsWith(`/${sheet}.tsx`) && importRe.test(s)).map(([f]) => f);
    ok(`SHEET_EXEMPT pin — ${sheet} is imported only by MobileScheduleScreen`,
      importers.length === 1 && importers[0] === 'components/schedule/mobile/MobileScheduleScreen.tsx', importers.join(', ') || 'no importer');
  }
}
const ghostSheet = [...SHEET_PENDING, ...SHEET_EXEMPT.keys()].filter((f) => !code.has(f));
if (ghostSheet.length) note(`no longer in the tree — delete from SHEET_PENDING / SHEET_EXEMPT: ${ghostSheet.join(', ')}`);

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
    file: 'app/(tabs)/schedule/index.tsx', fixed: true,
    isFixed: (s) => !/desktopHeaderLeft:\s*\{[^}]*\bwidth:\s*260\b/.test(s),
  },
  {
    name: 'project-detail applies quickActionBtnFull only under !isDesktop',
    file: 'app/project-detail.tsx', fixed: true,
    isFixed: (s) => {
      const uses = [...s.matchAll(/styles\.quickActionBtnFull\b/g)];
      return uses.length > 0 && uses.every((u) => /!\s*isDesktop\s*&&\s*$/.test(s.slice(Math.max(0, u.index! - 40), u.index!)));
    },
  },
  {
    name: "SchedulerMenuBar's dropdown has no fixed top: 96",
    file: 'components/schedule/SchedulerMenuBar.tsx', fixed: true,
    isFixed: (s) => !/\bdropdown:\s*\{[^}]*\btop:\s*96\b/.test(s),
  },
  {
    name: "schedule-pro's tabShellBody row holds only the shell and the inspector",
    file: 'app/schedule-pro.tsx', fixed: true,
    isFixed: (s) => { const n = directChildren(s, 'tabShellBody'); return n > 0 && n <= 2; },
  },
  {
    name: "TodayView's emptyActive has a desktop variant",
    file: 'components/schedule/TodayView.tsx', fixed: true,
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
