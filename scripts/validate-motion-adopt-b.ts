// validate-motion-adopt-b.ts — wave 4 motion adoption, part B (lane MOTIONADOPT-B).
//
//   bun run scripts/validate-motion-adopt-b.ts      (package.json: test:motion-adopt-b)
//
// The kit (components/motion/kit) is adopted on seven screens. These checks
// hold the adopters to the kit's contract: they import the part and pass real
// data / real events, they add no motion code of their own, money lands on the
// exact cent, and Reduce Motion is read from the one hook.
//
//   VB1 each shipped row's file imports and uses its kit part(s);
//   VB2 no `useNativeDriver: true|false` literal and no looped sequence in an
//       owned file (no allowlist); AIHomeBriefing has no shimmerAnim;
//   VB3 money, EXECUTED: breakdownSteps on 300 seeded fixtures + edges (every
//       cents an integer, the total the sum of the rows, the counter's last
//       step the total); STATIC: the wizard's AccumulateCards takes its items
//       from breakdownSteps and formats cents with the rows' own 2 decimals,
//       and the "Line items" row carries no accessibilityLabel of its own;
//   VB4 real data, real events: the schedule-health priority is gated on the
//       worst check really failing; the checklist ticks from useFocusEffect +
//       a seen set, and only DoneGlyph calls useCheckBeat('done', …);
//   VB5 Reduce Motion only via useReducedMotion from '@/components/ui/motion';
//       every beatSchedule(n, reduced) gets that hook's value;
//   VB6 the sidebar: every rowStyle( call yields its fill to the flying marker
//       (`!navFlying`), the FocusMarker sits inside the nav ScrollView, and
//       RowLink passes onLayout in BOTH branches;
//   VB7 every kit `cap` ≤ 8, and no kit part inside a FlatList renderItem;
//   VB8 `armed` comes from a live event (a bare literal only in VerdictCard,
//       which mounts only for a fresh run).
//
// Imports ONLY utils/estimateBreakdownSteps.ts and utils/motion/kit/accumulate.ts
// (both pure); every other file is read as TEXT, comment-stripped.
//
// MUTATION PROOF: set MOTIONADOPT_B_MUT_DIR to a directory that mirrors repo
// paths; a file found there is read (or imported) INSTEAD of the repo copy.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MUT = process.env.MOTIONADOPT_B_MUT_DIR;

/** The rows that landed. B1-B4 are MUSTs; B5-B7 shipped too. */
const SHIPPED = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'] as const;
type Row = (typeof SHIPPED)[number];

const FILES = {
  checklist: 'components/OnboardingChecklist.tsx',
  wizard: 'app/estimate-wizard.tsx',
  steps: 'utils/estimateBreakdownSteps.ts',
  health: 'components/schedule/ScheduleHealthScore.tsx',
  sidebar: 'components/DesktopSidebar.tsx',
  rowLink: 'components/desktop/RowLink.tsx',
  briefing: 'components/AIHomeBriefing.tsx',
  verdict: 'components/judges/VerdictCard.tsx',
  xray: 'app/cost-xray.tsx',
} as const;

const OWNED: string[] = Object.values(FILES);

let failures = 0;
const failed: string[] = [];
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log('  PASS  ' + name); return; }
  failures += 1;
  failed.push(name);
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail.split('\n').join('\n        ') : ''));
}

function pathOf(rel: string): string {
  if (MUT && existsSync(join(MUT, rel))) return join(MUT, rel);
  return join(ROOT, rel);
}
function read(rel: string): string {
  try { return readFileSync(pathOf(rel), 'utf8'); } catch { return ''; }
}

/** Blank out // and /* *\/ comments (strings kept, newlines kept). A copy of validate-motion-kit's. */
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
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; i++; continue; }
      blank(i); i++; continue;
    }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    else if ((mode === 'sq' || mode === 'dq') && src[i] === '\n') mode = 'code';
    i++;
  }
  return out.join('');
}

/** The balanced (…) / {…} / […] group that opens at `open`. A copy of validate-motion-kit's. */
function group(src: string, open: number): string {
  const o = src[open];
  const c = o === '(' ? ')' : o === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}
/** Every group that follows `needle` (needle ends right before the opening bracket). */
function groupsAfter(src: string, needle: string): string[] {
  const out: string[] = [];
  let i = src.indexOf(needle);
  while (i >= 0) {
    const at = i + needle.length;
    if (src[at] === '(' || src[at] === '{') out.push(group(src, at));
    i = src.indexOf(needle, i + 1);
  }
  return out;
}
/** The JSX element that opens at `<Tag` (up to its matching `/>` or `</Tag>`), naive but enough here. */
function jsxElement(src: string, tag: string, from = 0): string {
  const at = src.indexOf('<' + tag, from);
  if (at < 0) return '';
  const close = src.indexOf('</' + tag + '>', at);
  // A self-closing element: walk braces so `=>` and `>` inside props don't end it.
  let depth = 0;
  for (let i = at + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '(') depth++;
    else if (ch === '}' || ch === ')') depth--;
    else if (depth === 0 && ch === '/' && src[i + 1] === '>') return src.slice(at, i + 2);
    else if (depth === 0 && ch === '>' ) return close > 0 ? src.slice(at, close + tag.length + 3) : src.slice(at, i + 1);
  }
  return src.slice(at);
}

const code = (rel: string) => stripComments(read(rel));
const S = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, code(rel)])) as Record<keyof typeof FILES, string>;
const shipped = (r: Row) => (SHIPPED as readonly string[]).includes(r);

async function main() {
  console.log('validate-motion-adopt-b: rows shipped ' + SHIPPED.join(' '));

  // ── VB1 kit sites ─────────────────────────────────────────────────────────
  const KIT_IMPORT = /import\s*\{([^}]*)\}\s*from\s*'@\/(components|utils)\/motion\/kit'/g;
  const imported = (src: string) => {
    const names = new Set<string>();
    for (const m of src.matchAll(KIT_IMPORT)) for (const n of m[1].split(',')) names.add(n.trim().replace(/^type\s+/, ''));
    return names;
  };
  const uses = (src: string, name: string) => (src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length >= 2;
  const sites: [Row, keyof typeof FILES, string[]][] = [
    ['B1', 'checklist', ['useCheckBeat', 'beatSchedule']],
    ['B2', 'wizard', ['AccumulateCards']],
    ['B3', 'health', ['PriorityGrid']],
    ['B4', 'sidebar', ['FocusMarker']],
    ['B5', 'briefing', ['useStagger']],
    ['B6', 'verdict', ['RangeSettle', 'useStagger']],
    ['B7', 'xray', ['useAccumulate']],
  ];
  for (const [row, f, names] of sites) {
    if (!shipped(row)) continue;
    const src = S[f];
    const have = imported(src);
    const missing = names.filter((n) => !have.has(n) || !uses(src, n));
    ok(`VB1 ${row} ${FILES[f]} imports and uses ${names.join(' + ')}`, missing.length === 0, missing.length ? 'missing: ' + missing.join(', ') : undefined);
  }
  if (shipped('B2')) {
    ok('VB1 B2 estimate-wizard imports breakdownSteps from utils/estimateBreakdownSteps and calls it',
      /import\s*\{[^}]*\bbreakdownSteps\b[^}]*\}\s*from\s*'@\/utils\/estimateBreakdownSteps'/.test(S.wizard) && /breakdownSteps\(sortedCategories\)/.test(S.wizard));
  }
  if (shipped('B5')) {
    ok("VB1 B5 AIHomeBriefing imports Skeleton (the Level's shared clock) and renders it",
      /import\s*\{[^}]*\bSkeleton\b[^}]*\}\s*from\s*'@\/components\/Skeleton'/.test(S.briefing) && /<Skeleton\b/.test(S.briefing));
  }

  // ── VB2 no home-made motion ──────────────────────────────────────────────
  for (const rel of OWNED) {
    const src = code(rel);
    const literals = (src.match(/useNativeDriver\s*:\s*(true|false)\b/g) ?? []).length;
    let looped = 0;
    for (const g of groupsAfter(src, 'Animated.loop')) {
      const inner = g.slice(1, -1).trim();
      const single = /^Animated\.timing\(/.test(inner) && (inner.match(/Animated\.\w+\(/g) ?? []).length === 1;
      if (!single) looped += 1;
    }
    ok(`VB2 ${rel}: 0 useNativeDriver literals (${literals}), 0 looped sequences (${looped})`, literals === 0 && looped === 0);
  }
  if (shipped('B5')) ok('VB2 AIHomeBriefing has no shimmerAnim (the skeleton joined the shared clock)', !/\bshimmerAnim\b/.test(S.briefing));

  // ── VB3 money ────────────────────────────────────────────────────────────
  const stepsMod = await import(pathToFileURL(pathOf(FILES.steps)).href) as typeof import('../utils/estimateBreakdownSteps');
  const acc = await import(pathToFileURL(join(ROOT, 'utils/motion/kit/accumulate.ts')).href) as typeof import('../utils/motion/kit/accumulate');
  const { breakdownSteps } = stepsMod;
  const { partialSums, shownSteps } = acc;
  let seed = 0x5eed1234;
  const rand = () => { // mulberry32
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const problems: string[] = [];
  const checkCase = (label: string, rows: { cat: string; subtotal: number }[], expectCents?: number[]) => {
    const r = breakdownSteps(rows);
    const cents = r.items.map((i) => i.cents);
    if (r.items.length !== rows.length) problems.push(`${label}: ${r.items.length} items for ${rows.length} rows`);
    if (!cents.every((c) => Number.isInteger(c))) problems.push(`${label}: a non-integer cents ${cents.join(',')}`);
    if (!Number.isInteger(r.totalCents)) problems.push(`${label}: totalCents ${r.totalCents} not an integer`);
    const sum = cents.reduce((a, b) => a + b, 0);
    if (r.totalCents !== sum) problems.push(`${label}: totalCents ${r.totalCents} ≠ Σ cents ${sum}`);
    if (expectCents && cents.some((c, i) => c !== expectCents[i])) problems.push(`${label}: cents ${cents.join(',')} ≠ expected ${expectCents.join(',')}`);
    if (rows.length > 0) {
      const sums = partialSums(cents);
      const shown = shownSteps(sums);
      if (sums[sums.length - 1] !== r.totalCents) problems.push(`${label}: partialSums ends ${sums[sums.length - 1]} ≠ ${r.totalCents}`);
      if (shown[shown.length - 1] !== r.totalCents) problems.push(`${label}: shownSteps ends ${shown[shown.length - 1]} ≠ ${r.totalCents}`);
      if (shown.length > 6) problems.push(`${label}: ${shown.length} counter steps (> 6)`);
    } else if (r.totalCents !== 0) problems.push(`${label}: empty breakdown totals ${r.totalCents}`);
    if (r.items.some((it, i) => it.key !== rows[i].cat)) problems.push(`${label}: keys are not the categories`);
  };
  for (let f = 0; f < 300; f++) {
    const n = 1 + Math.floor(rand() * 12);
    const rows: { cat: string; subtotal: number }[] = [];
    const expect: number[] = [];
    for (let i = 0; i < n; i++) {
      // A category subtotal is a float sum of cent-exact line totals (k/100).
      const lines = 1 + Math.floor(rand() * 6);
      let subtotal = 0; let k = 0;
      for (let j = 0; j < lines; j++) { const c = Math.floor(rand() * 5_000_000); k += c; subtotal += c / 100; }
      rows.push({ cat: `cat-${i}`, subtotal });
      expect.push(k);
    }
    checkCase(`fixture ${f}`, rows, expect);
  }
  checkCase('edge []', []);
  checkCase('edge one row', [{ cat: 'Framing', subtotal: 1234.56 }], [123456]);
  checkCase('edge 9 rows (counter caps at 6 steps, last = total)', Array.from({ length: 9 }, (_, i) => ({ cat: `c${i}`, subtotal: (i + 1) * 100.01 })), Array.from({ length: 9 }, (_, i) => (i + 1) * 10001));
  checkCase('edge 0.1 + 0.2', [{ cat: 'Paint', subtotal: 0.1 + 0.2 }], [30]);
  checkCase('edge 1234.565', [{ cat: 'Tile', subtotal: 1234.565 }], [Math.round(1234.565 * 100)]);
  ok(`VB3 breakdownSteps on 300 seeded fixtures + 5 edges: integer cents, total = Σ rows, the counter ends on the total`, problems.length === 0, problems.slice(0, 6).join('\n'));

  if (shipped('B2')) {
    const ac = jsxElement(S.wizard, 'AccumulateCards');
    ok('VB3 the wizard\'s AccumulateCards takes its items from breakdownSteps (breakdown.items.map)', /items=\{breakdown\.items\.map\(/.test(ac) && /const breakdown = breakdownSteps\(sortedCategories\)/.test(S.wizard));
    ok("VB3 the counter formats cents with the rows' own 2 decimals: format={(c) => formatMoney(c / 100, 2)}", /format=\{\(c\) => formatMoney\(c \/ 100, 2\)\}/.test(ac));
    ok('VB3 each row figure is the same cents, same format (formatMoney(cents / 100, 2))', /formatMoney\(cents \/ 100, 2\)/.test(ac));
    // The kit plans an entrance for every card (no cap); the host caps it so a
    // 15-trade renovation still moves at most 8 rows (MOTIONKIT E).
    ok('VB3 at most 8 breakdown rows animate: the row takes `i < 8 ? enter : null`, never a bare `enter`',
      /style=\{\[styles\.breakdownRow, i < 8 \? enter : null\]\}/.test(ac) && !/styles\.breakdownRow, enter\]/.test(ac));
    const totalAt = ac.indexOf('testID="estimate-breakdown-total"');
    const totalRow = totalAt >= 0 ? ac.slice(ac.lastIndexOf('<View', totalAt), ac.indexOf('</View>', totalAt)) : '';
    ok('VB3 the "Line items" row has no accessibilityLabel (CountRoll speaks the final figure)', totalRow.length > 0 && !/accessibilityLabel/.test(totalRow) && /Line items/.test(totalRow));
  }

  // ── VB4 real data, real events ───────────────────────────────────────────
  if (shipped('B3')) {
    const pg = jsxElement(S.health, 'PriorityGrid');
    const pk = /priorityKey=\{([^\n]*)\}\s*\n/.exec(pg)?.[1] ?? '';
    ok(`VB4 schedule health's priorityKey is gated on the worst check failing (${pk.trim() || 'missing'})`,
      /sorted\[0\]/.test(pk) && /severity !== 'good'/.test(pk) && /:\s*null$/.test(pk.trim()));
    ok('VB4 schedule health is one column with no gap (columns={1} gap={0})', /columns=\{1\}/.test(pg) && /gap=\{0\}/.test(pg));
  }
  if (shipped('B1')) {
    const glyphAt = S.checklist.indexOf('function DoneGlyph(');
    const glyph = glyphAt >= 0 ? group(S.checklist, S.checklist.indexOf('{', S.checklist.indexOf(')', glyphAt))) : '';
    const beatCalls = (S.checklist.match(/useCheckBeat\('done'/g) ?? []).length;
    ok("VB4 useCheckBeat('done', …) appears once, inside DoneGlyph", beatCalls === 1 && /useCheckBeat\('done'/.test(glyph));
    ok('VB4 the checklist ticks from useFocusEffect and keeps a seen set', /useFocusEffect\(useCallback\(/.test(S.checklist) && /seenDone = useRef<Set<string> \| null>/.test(S.checklist) && /seen\.add\(/.test(S.checklist));
    ok("VB4 DoneGlyph's live comes from the ticks state", /<DoneGlyph[\s\S]{0,200}live=\{ticks\.keys\.includes\(item\.key\)\}/.test(S.checklist));
    ok('VB4 a step only ticks if it was once seen known-and-not-done (no tick for data landing)', /if \(item\.known\) seenOpen\.current\.add\(item\.key\)/.test(S.checklist) && /if \(seenOpen\.current\.has\(item\.key\)\) fresh\.push\(item\.key\)/.test(S.checklist));
  }

  // ── VB5 Reduce Motion ────────────────────────────────────────────────────
  for (const rel of OWNED) {
    const src = code(rel);
    const bad = /isReduceMotionEnabled|prefers-reduced-motion/.test(src);
    const hook = /\buseReducedMotion\b/.test(src);
    const fromMotion = /import\s*\{[^}]*\buseReducedMotion\b[^}]*\}\s*from\s*'@\/components\/ui\/motion'/.test(src);
    ok(`VB5 ${rel} reads Reduce Motion only via useReducedMotion from '@/components/ui/motion'`, !bad && (!hook || fromMotion));
    const bound = /const (\w+) = useReducedMotion\(\)/.exec(src)?.[1] ?? null;
    for (const g of groupsAfter(src, 'beatSchedule')) {
      if (/^\(\s*n\s*:/.test(g)) continue; // a declaration, not a call
      const second = g.slice(1, -1).split(',')[1]?.trim() ?? '';
      ok(`VB5 ${rel}: beatSchedule${g} gets the useReducedMotion() value (${bound ?? 'none bound'})`, bound !== null && second === bound);
    }
  }

  // ── VB6 the sidebar ──────────────────────────────────────────────────────
  if (shipped('B4')) {
    const calls = groupsAfter(S.sidebar, 'rowStyle').filter((g) => !/^\(active: boolean\)/.test(g));
    const bare = calls.filter((g) => !g.includes('!navFlying'));
    ok(`VB6 every rowStyle( call (${calls.length}) yields its fill to the flying marker (!navFlying)`, calls.length >= 3 && bare.length === 0, bare.join('\n'));
    const scrollAt = S.sidebar.indexOf('<ScrollView style={styles.navScroll}');
    const scrollEnd = S.sidebar.indexOf('</ScrollView>', scrollAt);
    const markerAt = S.sidebar.indexOf('<FocusMarker');
    ok('VB6 <FocusMarker sits inside the nav ScrollView', scrollAt > 0 && markerAt > scrollAt && markerAt < scrollEnd);
    const marker = jsxElement(S.sidebar, 'FocusMarker');
    ok('VB6 the marker is axis y, reads navRects, reports onFlight to setNavFlying', /axis="y"/.test(marker) && /rects=\{navRects\}/.test(marker) && /onFlight=\{setNavFlying\}/.test(marker) && /activeKey=\{navActiveKey\}/.test(marker));
    const nativeAt = S.rowLink.indexOf("if (Platform.OS !== 'web') {");
    const native = nativeAt >= 0 ? group(S.rowLink, S.rowLink.indexOf('{', nativeAt)) : '';
    const surface = jsxElement(S.rowLink, 'LinkSurface', S.rowLink.indexOf('<Link '));
    ok('VB6 RowLink passes onLayout in BOTH branches (native Pressable and LinkSurface)', /onLayout=\{onLayout\}/.test(native) && /onLayout=\{onLayout\}/.test(surface));
  }

  // ── VB7 caps and scroll ──────────────────────────────────────────────────
  const KIT_NAMES = /\b(useStagger|useCheckBeat|AccumulateCards|PriorityGrid|FocusMarker|RangeSettle|StaggerList|CheckSync|CountRoll|useAccumulate|useFileInto|useFocusPush)\b|\bstagger\(|tellStagger\(/;
  for (const rel of OWNED) {
    const src = code(rel);
    const caps = [...src.matchAll(/\bcap\s*[:=]\s*\{?\s*(\d+)/g)].map((m) => Number(m[1]));
    const items = groupsAfter(src, 'renderItem=');
    ok(`VB7 ${rel}: every kit cap ≤ 8 (${caps.join(',') || 'default 8'}), no kit part in a FlatList renderItem (${items.length})`,
      caps.every((c) => c <= 8) && items.every((g) => !KIT_NAMES.test(g)));
  }

  // ── VB8 armed from live events ───────────────────────────────────────────
  const expectArmed: [keyof typeof FILES, RegExp][] = [
    ['wizard', /armed=\{summaryLiveRef\.current\}/],
    ['health', /armed=\{visible\}/],
    ['briefing', /armed: freshRun\b/],
    ['xray', /armed: reviewsLive\b/],
  ];
  for (const [f, re] of expectArmed) ok(`VB8 ${FILES[f]} arms from a live event (${re.source.replace(/\\b/g, '').replace(/\\/g, '')})`, re.test(S[f]));
  const ALLOW_LITERAL: string[] = [FILES.verdict];
  for (const rel of OWNED) {
    if (ALLOW_LITERAL.includes(rel)) continue;
    const src = code(rel);
    const literal = /\barmed(\s*=\s*\{\s*(true|false)\s*\}|\s*:\s*(true|false)\b|\s*(?=[\s/>])(?![\s\S]{0,3}[=:]))/.exec(src);
    ok(`VB8 ${rel}: no bare-literal armed`, !literal, literal ? literal[0] : undefined);
  }

  if (failures > 0) {
    console.log(`\n✗ validate-motion-adopt-b: ${failures} failing check(s)`);
    console.log('FAILED: ' + failed.map((f) => f.split(' ')[0]).join(' '));
    process.exit(1);
  }
  console.log('\n✓ validate-motion-adopt-b: the adopters use the kit with real data, real events, exact cents and one Reduce Motion hook');
}

void main();
