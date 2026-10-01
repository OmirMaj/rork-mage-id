// validate-link-aschild-style.ts: no style ARRAY on the child of <Link asChild>.
//
// On web, expo-router's Link asChild renders a Radix Slot. The Slot merges the
// child's `style` with an object spread, so an array style becomes
// {0: {...}, 1: {...}} and react-native-web hands key "0" to the DOM, which
// throws "Failed to set an indexed property [0] on 'CSSStyleDeclaration'"
// and takes down the whole screen (Sentry REACT-NATIVE-R on /summary,
// REACT-NATIVE-S on /, 18 events from 2026-09-29). The fix is to pass
// StyleSheet.flatten([...]) (a plain object) instead.
//
// Checks:
//   A. Every <Link ... asChild ...> in app/ and components/: the first JSX
//      element inside it has no `style={[`.
//   B. DataTable's linked row is built as `const main = (<Pressable ...>)` and
//      rendered as {main} inside the Link, out of reach of A: pinned flattened.
//   C. Self-test: A must flag a planted array child and pass a flattened one.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/** The JSX opening tag starting at `start` (the '<'), up to its closing '>' at brace depth 0. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i += 1) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Every array-styled child of a <Link asChild> in `src`, as 1-based line numbers. */
export function arrayStyledAsChild(src: string): number[] {
  const hits: number[] = [];
  const re = /<Link\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tag = openingTag(src, m.index);
    if (!/\basChild\b/.test(tag) || tag.endsWith('/>')) continue;
    const after = m.index + tag.length;
    const next = src.indexOf('<', after);
    if (next < 0) continue;
    // A {expression} child (e.g. {main}) is out of reach here; see check B.
    const between = src.slice(after, next);
    if (/\{\s*\w+\s*\}/.test(between)) continue;
    const child = openingTag(src, next);
    if (child.startsWith('</')) continue;
    if (/\bstyle=\{\s*\[/.test(child)) hits.push(src.slice(0, next).split('\n').length);
  }
  return hits;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
}

// A. Every Link asChild child in the app.
const files: string[] = [];
walk(join(ROOT, 'app'), files);
walk(join(ROOT, 'components'), files);
let asChildFiles = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (!/<Link\b[^]*?\basChild\b/.test(src)) continue;
  asChildFiles += 1;
  const hits = arrayStyledAsChild(src);
  check(`A ${relative(ROOT, f)}`, hits.length === 0,
    `style array on a <Link asChild> child at line ${hits.join(', ')}; wrap it in StyleSheet.flatten([...])`);
}
check('A found the known asChild sites', asChildFiles >= 4, `only ${asChildFiles} files with <Link asChild>`);
const kpi = readFileSync(join(ROOT, 'components/desktop/KpiStrip.tsx'), 'utf8');
check('A KpiStrip link cell is flattened', /asChild[^]{0,600}style=\{StyleSheet\.flatten\(\[styles\.cell, cellStyle\]\)\}/.test(kpi));

// B. DataTable's {main} row.
const dt = readFileSync(join(ROOT, 'components/desktop/DataTable.tsx'), 'utf8');
const mainAt = dt.indexOf('const main = (');
check('B DataTable builds the row as `const main`', mainAt >= 0);
const mainTag = mainAt >= 0 ? openingTag(dt, dt.indexOf('<', mainAt)) : '';
check('B DataTable row style is flattened', /style=\{StyleSheet\.flatten\(\[/.test(mainTag), mainTag.slice(0, 160));
check('B DataTable row has no style array', !/\bstyle=\{\s*\[/.test(mainTag));
check('B DataTable still renders {main} inside <Link asChild>', /<Link[^]{0,80}asChild[^]{0,600}\{main\}\s*<\/Link>/.test(dt));

// C. Self-test: the checker must catch the bug it guards against.
const bad = `<Link href="/x" asChild>\n  <Pressable style={[styles.a, b]} accessibilityRole="link">x</Pressable>\n</Link>`;
const good = `<Link href="/x" asChild>\n  <Pressable style={StyleSheet.flatten([styles.a, b])}>x</Pressable>\n</Link>`;
const multi = `<Link\n  href={h}\n  asChild\n  {...(x ? { onPress: (e) => { if (a > b) f(); } } : {})}\n>\n  <Pressable\n    onPress={o}\n    style={[s.row, { minHeight: h }]}\n  >x</Pressable>\n</Link>`;
const plain = `<Link href="/x"><Text style={[a, b]}>x</Text></Link>`;
check('C flags a planted array child', arrayStyledAsChild(bad).length === 1);
check('C passes a flattened child', arrayStyledAsChild(good).length === 0);
check('C flags a multi-line Link with arrow functions in its props', arrayStyledAsChild(multi).length === 1);
check('C ignores a Link without asChild', arrayStyledAsChild(plain).length === 0);
const commented = `<Link href="/x" asChild>\n  <Pressable\n    // a comment with <Link asChild> inside it\n    style={[a, b]}\n  >x</Pressable>\n</Link>`;
check('C reads past a comment containing > inside the child tag', arrayStyledAsChild(commented).length === 1);

console.log(`validate-link-aschild-style: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
