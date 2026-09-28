// scripts/i18n-codemod.ts — per-file literal → t()/tn() migration (docs/I18N.md §10.2).
//
//   bun run scripts/i18n-codemod.ts --file <path> --prefix <area.surface>
//        [--range <from>-<to> …] [--write] [--report <path>]
//
// Dry run by default: prints a unified diff of what --write would do, the new
// keys (key → English) you must give Spanish, and the report of everything it
// SKIPPED and why. One file per run. Nothing is committed; review the diff.
//
// HOW IT EDITS — by SOURCE RANGES. @babel/parser + @babel/traverse find the
// strings; the edit splices new text into the ORIGINAL source at exact
// offsets. There is no @babel/generator pass, so every other byte of the file
// (formatting, comments, every string an existing validator greps) is left
// exactly as it was.
//
// WHAT IT EXTRACTS
//   • JSXText inside Text-like elements (<Text>, <Animated.Text>, any *Text),
//     normalised with Babel's own JSX whitespace rule (cleanJSXText below), so
//     the inline English equals what React rendered. Mixed children
//     (`{a} of {b} done`) become ONE key with {placeholders}.
//   • String-literal props: title label placeholder subtitle description
//     emptyText hint accessibilityLabel accessibilityHint confirmText
//     cancelText (+ --props a,b to add more).
//   • options={{ title }} (and headerTitle / tabBarLabel) on *.Screen.
//   • showAlert(...) / Alert.alert(...) title, message and button `text`;
//     nailIt(...) / oops(...) toasts.
//   • Template literals whose holes are identifiers or member expressions →
//     one key with {placeholders} (names from the expression; v1, v2 when none).
//   • `n === 1 ? 'x' : 'y'` / `n !== 1 ? …` inside such a sentence → tn()
//     (ONLY the ===1 / !==1 forms: `> 1` would change the English at 0).
//   • A conditional / logical expression whose branches are whole strings:
//     each branch becomes its own key.
//
// WIRING
//   • Inside a component (PascalCase function containing JSX) or a hook
//     (use*): `const { t } = useT();` (or `{ t, tn }`) is inserted as the
//     FIRST statement (hook rules) and useT is imported from
//     '@/contexts/LanguageContext'.
//   • In any other function: `t` / `tn` imported from '@/i18n/core' (read at
//     call time, never at module scope).
//   • Module scope: never rewritten — reported with a suggested function form.
//
// WHAT IT SKIPS AND REPORTS: non-===1 plurals, fragments it cannot join into
// one sentence, holes that are not identifiers / member expressions, anything
// in §8's never-translate column (URLs, emails, routes, acronyms, brand
// names, units), lines under `// i18n-keep-english: <reason>`, and every other
// sentence-like literal it did not touch (hand-check list). A file where `t`
// or `tn` already means something else in scope is ABORTED (exit 2).
//
// KEYS: `<prefix>.<slug>`; slug = camelCase of the English, ≤ 4 words, deduped
// in the file; the same English in one file maps to one key; a key with a
// `.legal.` segment is never generated (a legal key is renamed by a person).
//
// After --write: hand-finish the report items, write the Spanish, then
//   bun run scripts/i18n-extract.ts --surface <id>
//   bun run scripts/validate-i18n.ts --assume-migrated <file>
//
// The detector (analyzeSource) is also the raw-literal rule of
// scripts/validate-i18n.ts, so "what the codemod would extract" and "what the
// gate calls a raw literal" can never drift apart.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from '@babel/parser';
import traverseImport, { type NodePath } from '@babel/traverse';
import * as bt from '@babel/types';

const traverse = ((traverseImport as unknown as { default?: typeof traverseImport }).default ?? traverseImport) as typeof traverseImport;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Public vocabulary ────────────────────────────────────────────────────

export const EXTRACT_PROPS = new Set([
  'title', 'label', 'placeholder', 'subtitle', 'description', 'emptyText', 'hint',
  'accessibilityLabel', 'accessibilityHint', 'confirmText', 'cancelText',
]);
const SCREEN_OPTION_KEYS = new Set(['title', 'headerTitle', 'tabBarLabel', 'headerBackTitle']);
/** callee → user-facing string argument indexes (button arrays are read from index 2). */
const CALL_ARGS: Record<string, number[]> = {
  showAlert: [0, 1],
  'Alert.alert': [0, 1],
  nailIt: [0],
  oops: [0],
};

export const KEEP_ENGLISH_RE = /(?:\/\/|\/\*|\{\/\*)\s*i18n-keep-english:([^\n]*)/;

/** Babel's own JSX whitespace rule (cleanJSXElementLiteralChild), verbatim in behaviour. */
export function cleanJSXText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.exec(lines[i])) lastNonEmptyLine = i;
  let str = '';
  for (let i = 0; i < lines.length; i++) {
    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;
    const isLastNonEmptyLine = i === lastNonEmptyLine;
    let trimmedLine = lines[i].replace(/\t/g, ' ');
    if (!isFirstLine) trimmedLine = trimmedLine.replace(/^[ ]+/, '');
    if (!isLastLine) trimmedLine = trimmedLine.replace(/[ ]+$/, '');
    if (trimmedLine) {
      if (!isLastNonEmptyLine) trimmedLine += ' ';
      str += trimmedLine;
    }
  }
  return str;
}

export interface PluralEn { one: string; other: string }

export type SkipReason =
  | 'keep-english'      // exempt: marked `// i18n-keep-english: <reason>`
  | 'never-translate'   // exempt: URL, route, acronym, brand, unit, identifier…
  | 'fragment'          // user-facing, but pieces that cannot join into one sentence
  | 'complex-hole'      // a hole that is not an identifier / member expression
  | 'plural-form'       // a plural test other than === 1 / !== 1
  | 'module-scope'      // a string at module scope (label maps become functions)
  | 'bad-marker'        // an i18n-keep-english marker with no reason
  | 'hand-check';       // a sentence-like literal outside the extracted positions

/** Reasons that mean "raw user-facing English is still here" (the raw-literal rule). */
export const RAW_REASONS: ReadonlySet<SkipReason> = new Set(['fragment', 'complex-hole', 'plural-form', 'module-scope']);

export interface Skip { line: number; text: string; reason: SkipReason; detail?: string }

interface Part { text?: string; expr?: bt.Expression; plural?: { countSrc: string; one: string; other: string } }

export interface Candidate {
  line: number;
  start: number;
  end: number;
  /** Replacement goes inside `{…}` (JSX child / attribute string) or bare. */
  braces: boolean;
  kind: 'jsx' | 'prop' | 'call' | 'screen' | 'expr';
  en: string | PluralEn;
  vars: { name: string; src: string }[];
  countSrc?: string;
  /** The function the call lands in (null = module scope, never rewritten). */
  fn: NodePath<bt.Function> | null;
  hookFn: NodePath<bt.Function> | null;
}

export interface Analysis {
  candidates: Candidate[];
  skips: Skip[];
  /** Set when the file must not be rewritten (t / tn already mean something else). */
  abort?: string;
  src: string;
  ast: bt.File;
}

export interface AnalyzeOptions {
  ranges?: Array<[number, number]>;
  extraProps?: string[];
}

// ── Never translate (docs/I18N.md §8) ────────────────────────────────────

const BRANDS = ['MAGE ID', 'MAGE AI', 'MAGE', 'QuickBooks', 'Stripe', 'Procore', 'OpenWeather', 'RevenueCat', 'Apple', 'Google'];
const UNITS = /^(?:sq ?ft|sf|lf|cy|psi|%|\$|ft|in|hrs?|min|mph|°f|°c|lbs?|kg|mm|cm|m)$/i;

export function neverTranslate(s: string): string | null {
  const bare = s.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '').trim();
  if (!/[A-Za-z]/.test(bare)) return 'no letters';
  if (/^(?:https?:\/\/|www\.|mailto:|tel:)/i.test(bare) || /^\S+@\S+\.\S+$/.test(bare)) return 'URL or email';
  if (/^\/[\w\-/[\]().?=&]*$/.test(bare)) return 'route string';
  if (/^[A-Z0-9&/+.#-]+(?: [A-Z0-9&/+.#-]+)*$/.test(bare) && bare.replace(/[^A-Z]/g, '').length <= 12 && !/ [A-Z]{2,} [A-Z]{2,} [A-Z]{2,}/.test(bare)) return 'acronym';
  if (BRANDS.includes(bare)) return 'brand name';
  if (UNITS.test(bare)) return 'unit';
  if (/^[a-z][A-Za-z0-9]*[A-Z_-][A-Za-z0-9_-]*$/.test(bare) || /^[a-z0-9]+(?:[-_.][a-z0-9]+)+$/.test(bare)) return 'identifier';
  if (/^[a-z]+$/.test(bare) && bare.length > 0 && !/\s/.test(s)) return 'lowercase token';
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function lineOf(src: string, pos: number): number {
  let n = 1;
  for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

function jsxName(n: bt.JSXOpeningElement['name']): string {
  if (bt.isJSXIdentifier(n)) return n.name;
  if (bt.isJSXMemberExpression(n)) return `${jsxName(n.object as bt.JSXOpeningElement['name'])}.${n.property.name}`;
  return '';
}

export function isTextLike(name: string): boolean {
  const last = name.split('.').pop() ?? '';
  return /Text$/.test(last) && !/^(?:TextInput|InputText)$/.test(last);
}

function calleeName(c: bt.Expression | bt.V8IntrinsicIdentifier): string {
  if (bt.isIdentifier(c)) return c.name;
  if (bt.isMemberExpression(c) && bt.isIdentifier(c.object) && bt.isIdentifier(c.property) && !c.computed) return `${c.object.name}.${c.property.name}`;
  return '';
}

function isI18nCall(n: bt.Node): boolean {
  return bt.isCallExpression(n) && bt.isIdentifier(n.callee) && (n.callee.name === 't' || n.callee.name === 'tn');
}

/** A hole we can name: identifier or (non-computed) member chain. */
function simpleHoleName(e: bt.Node): string | null {
  if (bt.isIdentifier(e)) return e.name;
  if (bt.isMemberExpression(e) || bt.isOptionalMemberExpression(e)) {
    if (!isSimpleChain(e)) return null;
    const p = e.property;
    if (!e.computed && bt.isIdentifier(p)) return p.name;
    return '';
  }
  return null;
}
function isSimpleChain(e: bt.Node): boolean {
  if (bt.isIdentifier(e) || bt.isThisExpression(e)) return true;
  if (bt.isMemberExpression(e) || bt.isOptionalMemberExpression(e)) {
    if (e.computed && !bt.isNumericLiteral(e.property) && !bt.isStringLiteral(e.property)) return false;
    return isSimpleChain(e.object);
  }
  return false;
}

function pluralTest(e: bt.Node, src: string): { countSrc: string; negated: boolean } | 'other' | null {
  if (!bt.isConditionalExpression(e)) return null;
  const tst = e.test;
  if (!bt.isBinaryExpression(tst)) return null;
  const isOne = (n: bt.Node) => bt.isNumericLiteral(n) && n.value === 1;
  const lit = (n: bt.Node) => bt.isStringLiteral(n) || (bt.isTemplateLiteral(n) && n.expressions.length === 0);
  if (!lit(e.consequent) || !lit(e.alternate)) return null;
  if ((tst.operator === '===' || tst.operator === '!==' || tst.operator === '==' || tst.operator === '!=') && (isOne(tst.right) || isOne(tst.left))) {
    if (tst.operator === '==' || tst.operator === '!=') return 'other';
    const countNode = isOne(tst.right) ? tst.left : tst.right;
    return { countSrc: src.slice(countNode.start!, countNode.end!), negated: tst.operator === '!==' };
  }
  if (['>', '>=', '<', '<='].includes(tst.operator) && (bt.isNumericLiteral(tst.right) || bt.isNumericLiteral(tst.left))) return 'other';
  return null;
}

function litText(n: bt.Node): string {
  if (bt.isStringLiteral(n)) return n.value;
  if (bt.isTemplateLiteral(n)) return n.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
  if (bt.isNumericLiteral(n)) return String(n.value);
  return '';
}

/** Flatten an expression into message parts, or the reason it cannot be one sentence. */
function exprParts(e: bt.Node, src: string): Part[] | { fail: SkipReason; detail: string } {
  if (bt.isStringLiteral(e) || bt.isNumericLiteral(e)) return [{ text: litText(e) }];
  if (bt.isTemplateLiteral(e)) {
    const out: Part[] = [];
    for (let i = 0; i < e.quasis.length; i++) {
      const q = e.quasis[i];
      out.push({ text: q.value.cooked ?? q.value.raw });
      if (i < e.expressions.length) {
        const sub = holePart(e.expressions[i], src);
        if ('fail' in sub) return sub;
        out.push(...sub);
      }
    }
    return out;
  }
  return holePart(e, src);
}

function holePart(e: bt.Node, src: string): Part[] | { fail: SkipReason; detail: string } {
  if (bt.isStringLiteral(e) || bt.isNumericLiteral(e)) return [{ text: litText(e) }];
  if (bt.isTemplateLiteral(e)) return exprParts(e, src);
  if (bt.isTSAsExpression(e) || bt.isTSNonNullExpression(e)) return holePart(e.expression, src);
  const pt = pluralTest(e, src);
  if (pt === 'other') return { fail: 'plural-form', detail: src.slice(e.start!, e.end!) };
  if (pt) {
    const c = e as bt.ConditionalExpression;
    const a = litText(c.consequent);
    const b = litText(c.alternate);
    return [{ plural: { countSrc: pt.countSrc, one: pt.negated ? b : a, other: pt.negated ? a : b } }];
  }
  if (simpleHoleName(e) !== null) return [{ expr: e as bt.Expression }];
  return { fail: 'complex-hole', detail: src.slice(e.start!, e.end!).slice(0, 80) };
}

function camelName(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9_]/g, '');
  if (!s || !/^[A-Za-z_]/.test(s)) return '';
  return s;
}

/** Parts → English (+ plural forms) and vars. */
function buildMessage(parts: Part[], src: string): { en: string | PluralEn; vars: { name: string; src: string }[]; countSrc?: string } | { fail: SkipReason; detail: string } {
  const counts = [...new Set(parts.filter((p) => p.plural).map((p) => p.plural!.countSrc))];
  if (counts.length > 1) return { fail: 'fragment', detail: `two plural counts in one sentence: ${counts.join(', ')}` };
  const countSrc = counts[0];
  const vars: { name: string; src: string }[] = [];
  let anon = 0;
  const nameFor = (e: bt.Expression): string => {
    const s = src.slice(e.start!, e.end!);
    if (countSrc && s === countSrc) return 'count';
    const existing = vars.find((v) => v.src === s);
    if (existing) return existing.name;
    let n = camelName(simpleHoleName(e) ?? '');
    if (!n || n === 'count' && countSrc) n = `v${++anon}`;
    let final = n;
    let i = 2;
    while (vars.some((v) => v.name === final) || (countSrc && final === 'count')) final = `${n}${i++}`;
    vars.push({ name: final, src: s });
    return final;
  };
  const esc = (t: string) => t.replace(/\{/g, '{{').replace(/\}/g, '}}');
  let one = '';
  let other = '';
  for (const p of parts) {
    if (p.text !== undefined) { one += esc(p.text); other += esc(p.text); }
    else if (p.expr) { const n = `{${nameFor(p.expr)}}`; one += n; other += n; }
    else if (p.plural) { one += esc(p.plural.one); other += esc(p.plural.other); }
  }
  if (countSrc) return { en: { one, other }, vars, countSrc };
  return { en: one, vars };
}

function enText(en: string | PluralEn): string {
  return typeof en === 'string' ? en : en.other;
}

// ── The detector ─────────────────────────────────────────────────────────

export function parseSource(src: string): bt.File {
  return parse(src, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
    errorRecovery: false,
  });
}

/** Keep-English markers: line → reason ('' = a marker with no reason, which fails). */
export function keepEnglishMarkers(src: string): Map<number, string> {
  const out = new Map<number, string>();
  src.split('\n').forEach((l, i) => {
    const m = KEEP_ENGLISH_RE.exec(l);
    if (m) out.set(i + 1, m[1].replace(/\*\/\s*\}?\s*$/, '').trim());
  });
  return out;
}

function functionName(fn: NodePath<bt.Function>): string {
  const n = fn.node;
  if ((bt.isFunctionDeclaration(n) || bt.isFunctionExpression(n)) && n.id) return n.id.name;
  let p: NodePath | null = fn.parentPath;
  // memo(function X() {}) / forwardRef((…) => …) wrapped in a declarator.
  while (p && bt.isCallExpression(p.node)) p = p.parentPath;
  if (p && bt.isVariableDeclarator(p.node) && bt.isIdentifier(p.node.id)) return p.node.id.name;
  if (p && bt.isExportDefaultDeclaration(p.node)) return 'Default';
  return '';
}

function containsJSX(fn: NodePath<bt.Function>): boolean {
  let found = false;
  fn.traverse({
    JSXElement(p) { found = true; p.stop(); },
    JSXFragment(p) { found = true; p.stop(); },
  });
  return found;
}

function isHookOrComponent(fn: NodePath<bt.Function>): boolean {
  const name = functionName(fn);
  if (/^use[A-Z0-9]/.test(name)) return true;
  if (/^[A-Z]/.test(name)) return containsJSX(fn);
  return false;
}

export function analyzeSource(src: string, opts: AnalyzeOptions = {}): Analysis {
  const ast = parseSource(src);
  const props = new Set([...EXTRACT_PROPS, ...(opts.extraProps ?? [])]);
  const markers = keepEnglishMarkers(src);
  const candidates: Candidate[] = [];
  const skips: Skip[] = [];
  const claimed: Array<[number, number]> = [];
  const inRange = (line: number) => !opts.ranges?.length || opts.ranges.some(([a, b]) => line >= a && line <= b);
  const isClaimed = (s: number, e: number) => claimed.some(([a, b]) => s >= a && e <= b);
  let abort: string | undefined;

  for (const [line, reason] of markers) if (!reason) skips.push({ line, text: src.split('\n')[line - 1].trim(), reason: 'bad-marker', detail: 'i18n-keep-english needs a reason' });

  const marked = (line: number) => {
    const r = markers.get(line - 1);
    return typeof r === 'string' && r.length > 0;
  };

  const place = (path: NodePath): { fn: NodePath<bt.Function> | null; hookFn: NodePath<bt.Function> | null } => {
    const fn = path.getFunctionParent() as NodePath<bt.Function> | null;
    let hookFn: NodePath<bt.Function> | null = null;
    for (let f = fn; f; f = f.parentPath?.getFunctionParent() as NodePath<bt.Function> | null) {
      if (isHookOrComponent(f)) { hookFn = f; break; }
    }
    return { fn, hookFn };
  };

  const checkBinding = (path: NodePath, needTn: boolean) => {
    for (const name of needTn ? ['t', 'tn'] : ['t']) {
      const b = path.scope.getBinding(name);
      if (!b) continue;
      const decl = b.path;
      const fromI18nImport = decl.isImportSpecifier() && bt.isImportDeclaration(decl.parent) && /(?:@\/i18n(?:\/core)?|\/i18n\/core)$/.test((decl.parent as bt.ImportDeclaration).source.value);
      const fromUseT = decl.isVariableDeclarator() && bt.isCallExpression(decl.node.init) && bt.isIdentifier(decl.node.init.callee) && decl.node.init.callee.name === 'useT';
      if (!fromI18nImport && !fromUseT) abort = `\`${name}\` is already bound to something else (line ${lineOf(src, decl.node.start ?? 0)}) in scope of line ${lineOf(src, path.node.start ?? 0)}`;
    }
  };

  /** Try to extract `node` (an expression in a user-facing position). */
  const offer = (path: NodePath, node: bt.Node, kind: Candidate['kind'], braces: boolean) => {
    if (node.start == null || node.end == null) return;
    const line = lineOf(src, node.start);
    if (!inRange(line)) return;
    if (isI18nCall(node)) return;
    if (bt.isConditionalExpression(node) && !pluralTest(node, src)) {
      const c = node as bt.ConditionalExpression;
      offer(path, c.consequent, kind, false);
      offer(path, c.alternate, kind, false);
      return;
    }
    if (bt.isLogicalExpression(node)) {
      offer(path, node.right, kind, false);
      if (node.operator !== '&&') offer(path, node.left, kind, false);
      return;
    }
    if (bt.isTSAsExpression(node)) { offer(path, node.expression, kind, braces); return; }
    if (!bt.isStringLiteral(node) && !bt.isTemplateLiteral(node)) {
      if (pluralTest(node, src)) skips.push({ line, text: src.slice(node.start, node.end), reason: 'fragment', detail: 'a bare plural word: join it with its count into one sentence' });
      return;
    }
    const text = litText(node);
    if (marked(line)) { skips.push({ line, text, reason: 'keep-english' }); claimed.push([node.start, node.end]); return; }
    const parts = exprParts(node, src);
    if ('fail' in parts) { skips.push({ line, text: src.slice(node.start, node.end).slice(0, 120), reason: parts.fail, detail: parts.detail }); claimed.push([node.start, node.end]); return; }
    const msg = buildMessage(parts, src);
    if ('fail' in msg) { skips.push({ line, text: src.slice(node.start, node.end).slice(0, 120), reason: msg.fail, detail: msg.detail }); claimed.push([node.start, node.end]); return; }
    const nt = neverTranslate(enText(msg.en));
    if (nt) { skips.push({ line, text, reason: 'never-translate', detail: nt }); claimed.push([node.start, node.end]); return; }
    const { fn, hookFn } = place(path);
    if (!fn) { skips.push({ line, text, reason: 'module-scope', detail: 'module scope: move it into a function (labelFor(x)) so the language is read at call time' }); claimed.push([node.start, node.end]); return; }
    checkBinding(path, typeof msg.en !== 'string');
    candidates.push({ line, start: node.start, end: node.end, braces, kind, en: msg.en, vars: msg.vars, countSrc: msg.countSrc, fn, hookFn });
    claimed.push([node.start, node.end]);
  };

  traverse(ast, {
    JSXElement(path) {
      const name = jsxName(path.node.openingElement.name);
      if (!isTextLike(name)) return;
      const kids = path.node.children;
      const meaningful = kids.filter((k) => !(bt.isJSXText(k) && cleanJSXText(k.value) === '') && !(bt.isJSXExpressionContainer(k) && bt.isJSXEmptyExpression(k.expression)));
      if (!meaningful.length) return;
      const hasText = meaningful.some((k) => bt.isJSXText(k) && /[A-Za-z]/.test(cleanJSXText(k.value)));
      if (!hasText) {
        // Only expressions: a sole literal / template / conditional is offered as an expression.
        if (meaningful.length === 1 && bt.isJSXExpressionContainer(meaningful[0])) {
          const ex = meaningful[0].expression as bt.Expression;
          offer(path, ex, 'jsx', false);
        }
        return;
      }
      const first = meaningful[0];
      const last = meaningful[meaningful.length - 1];
      const line = lineOf(src, first.start! + (bt.isJSXText(first) ? (first.value.length - first.value.trimStart().length) : 0));
      if (!inRange(line)) return;
      const txt = kids.map((k) => (bt.isJSXText(k) ? k.value : '')).join(' ').replace(/\s+/g, ' ').trim();
      if (marked(line)) { skips.push({ line, text: txt, reason: 'keep-english' }); claimed.push([first.start!, last.end!]); return; }
      const parts: Part[] = [];
      for (const k of meaningful) {
        if (bt.isJSXText(k)) { parts.push({ text: cleanJSXText(k.value) }); continue; }
        if (bt.isJSXExpressionContainer(k)) {
          const sub = holePart(k.expression, src);
          if ('fail' in sub) {
            skips.push({ line, text: txt.slice(0, 120), reason: 'fragment', detail: `text mixed with ${src.slice(k.expression.start!, k.expression.end!).slice(0, 70)} — join it into one sentence by hand` });
            claimed.push([first.start!, last.end!]);
            return;
          }
          parts.push(...sub);
          continue;
        }
        skips.push({ line, text: txt.slice(0, 120), reason: 'fragment', detail: 'text around a nested element — make it one sentence by hand' });
        claimed.push([first.start!, last.end!]);
        return;
      }
      const msg = buildMessage(parts, src);
      if ('fail' in msg) { skips.push({ line, text: txt, reason: msg.fail, detail: msg.detail }); claimed.push([first.start!, last.end!]); return; }
      const nt = neverTranslate(enText(msg.en));
      if (nt) { skips.push({ line, text: txt, reason: 'never-translate', detail: nt }); claimed.push([first.start!, last.end!]); return; }
      const { fn, hookFn } = place(path);
      if (!fn) { skips.push({ line, text: txt, reason: 'module-scope', detail: 'JSX at module scope' }); return; }
      // Trim leading / trailing whitespace that holds a newline (Babel drops it anyway).
      let start = first.start!;
      let end = last.end!;
      if (bt.isJSXText(first)) {
        const lead = first.value.length - first.value.trimStart().length;
        if (first.value.slice(0, lead).includes('\n')) start += lead;
      }
      if (bt.isJSXText(last)) {
        const trail = last.value.length - last.value.trimEnd().length;
        if (last.value.slice(last.value.length - trail).includes('\n')) end -= trail;
      }
      checkBinding(path, typeof msg.en !== 'string');
      candidates.push({ line, start, end, braces: true, kind: 'jsx', en: msg.en, vars: msg.vars, countSrc: msg.countSrc, fn, hookFn });
      claimed.push([first.start!, last.end!]);
    },
    JSXAttribute(path) {
      const n = path.node;
      if (!bt.isJSXIdentifier(n.name)) return;
      const prop = n.name.name;
      const el = path.parentPath?.node as bt.JSXOpeningElement | undefined;
      if (prop === 'options' && el && /Screen$/.test(jsxName(el.name)) && bt.isJSXExpressionContainer(n.value) && bt.isObjectExpression(n.value.expression)) {
        for (const p of n.value.expression.properties) {
          if (bt.isObjectProperty(p) && bt.isIdentifier(p.key) && SCREEN_OPTION_KEYS.has(p.key.name)) offer(path, p.value, 'screen', false);
        }
        return;
      }
      if (!props.has(prop) || !n.value) return;
      if (bt.isStringLiteral(n.value)) { offer(path, n.value, 'prop', true); return; }
      if (bt.isJSXExpressionContainer(n.value) && !bt.isJSXEmptyExpression(n.value.expression)) offer(path, n.value.expression, 'prop', false);
    },
    CallExpression(path) {
      const name = calleeName(path.node.callee);
      const idx = CALL_ARGS[name];
      if (!idx) return;
      const args = path.node.arguments;
      for (const i of idx) if (args[i] && bt.isExpression(args[i])) offer(path, args[i], 'call', false);
      const buttons = args[2];
      if ((name === 'showAlert' || name === 'Alert.alert') && bt.isArrayExpression(buttons)) {
        for (const b of buttons.elements) {
          if (!bt.isObjectExpression(b)) continue;
          for (const p of b.properties) if (bt.isObjectProperty(p) && bt.isIdentifier(p.key) && p.key.name === 'text') offer(path, p.value, 'call', false);
        }
      }
    },
  });

  // Hand-check sweep: sentence-like literals nowhere near an extracted position.
  const i18nArgRanges: Array<[number, number]> = [];
  traverse(ast, {
    CallExpression(p) { if (isI18nCall(p.node)) i18nArgRanges.push([p.node.start!, p.node.end!]); },
  });
  const sweep = (p: NodePath<bt.StringLiteral> | NodePath<bt.TemplateLiteral>) => {
      const n = p.node;
      if (n.start == null || n.end == null) return;
      if (isClaimed(n.start, n.end) || i18nArgRanges.some(([a, b]) => n.start! >= a && n.end! <= b)) return;
      if (bt.isImportDeclaration(p.parent) || bt.isExportAllDeclaration(p.parent) || bt.isExportNamedDeclaration(p.parent)) return;
      if (bt.isObjectProperty(p.parent) && p.parent.key === n) return;
      if (bt.isJSXAttribute(p.parent)) return;
      if (bt.isTSLiteralType(p.parent) || p.findParent((x) => x.isTSType())) return;
      if (bt.isTemplateLiteral(p.parent)) return;
      const text = litText(n);
      if (!/[A-Za-z]{2,}/.test(text) || !/\s/.test(text.trim()) || !/^[A-Z"'(]|[.?]$/.test(text.trim())) return;
      if (neverTranslate(text)) return;
      const line = lineOf(src, n.start);
      if (!inRange(line) || marked(line)) return;
      if (/\b(?:console|require|jest)\b/.test(src.slice(Math.max(0, n.start - 16), n.start))) return;
      skips.push({ line, text: text.slice(0, 120), reason: 'hand-check', detail: p.getFunctionParent() ? 'inside a function' : 'module scope' });
  };
  traverse(ast, {
    StringLiteral(p) { sweep(p); },
    TemplateLiteral(p) { sweep(p); },
  });

  return { candidates: candidates.sort((a, b) => a.start - b.start), skips: skips.sort((a, b) => a.line - b.line), abort, src, ast };
}

// ── Keys ─────────────────────────────────────────────────────────────────

export function slugOf(en: string): string {
  const words = en.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, ' ').replace(/['’]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 4).map((w) => w.toLowerCase());
  if (!words.length) return 'text';
  let s = words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (/^[0-9]/.test(s)) s = `n${s}`;
  return s;
}

function quote(s: string): string {
  const body = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  if (body.includes("'") && !body.includes('"')) return `"${body}"`;
  return `'${body.replace(/'/g, "\\'")}'`;
}

function varsObject(vars: { name: string; src: string }[]): string {
  if (!vars.length) return '';
  return `{ ${vars.map((v) => (v.name === v.src ? v.name : `${v.name}: ${v.src}`)).join(', ')} }`;
}

export interface RewriteResult {
  out: string;
  keys: Array<{ key: string; en: string | PluralEn; line: number }>;
  report: Skip[];
  abort?: string;
}

/**
 * Apply the migration to `src`. `existing` is the current English catalog
 * (so a slug that already means different English in the catalog is suffixed).
 */
export function rewrite(src: string, prefix: string, opts: AnalyzeOptions = {}, existing: Record<string, unknown> = {}): RewriteResult {
  if (/(?:^|\.)legal(?:\.|$)/.test(prefix)) throw new Error(`refusing prefix "${prefix}": a .legal. key is never generated — rename it by hand`);
  if (!/^[a-z]+(?:\.[A-Za-z0-9]+)+$/.test(prefix)) throw new Error(`bad --prefix "${prefix}" (want <area>.<surface>, e.g. field.chrome)`);
  const a = analyzeSource(src, opts);
  if (a.abort) return { out: src, keys: [], report: a.skips, abort: a.abort };
  const byEnglish = new Map<string, string>();
  const used = new Set<string>();
  const keys: RewriteResult['keys'] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const hookNeeds = new Map<NodePath<bt.Function>, Set<string>>();
  const coreNeeds = new Set<string>();

  for (const c of a.candidates) {
    const sig = JSON.stringify(c.en);
    let key = byEnglish.get(sig);
    if (!key) {
      const base = slugOf(enText(c.en));
      let slug = base;
      let i = 2;
      const clash = (k: string) => used.has(k) || (k in existing && JSON.stringify(existing[k]) !== sig);
      while (clash(`${prefix}.${slug}`)) slug = `${base}${i++}`;
      key = `${prefix}.${slug}`;
      used.add(key);
      byEnglish.set(sig, key);
      keys.push({ key, en: c.en, line: c.line });
    }
    const vo = varsObject(c.vars);
    const call = typeof c.en === 'string'
      ? `t(${quote(key)}, ${quote(c.en)}${vo ? `, ${vo}` : ''})`
      : `tn(${quote(key)}, ${c.countSrc}, { one: ${quote(c.en.one)}, other: ${quote(c.en.other)} }${vo ? `, ${vo}` : ''})`;
    const fnName = typeof c.en === 'string' ? 't' : 'tn';
    if (c.hookFn) {
      const s = hookNeeds.get(c.hookFn) ?? new Set<string>();
      s.add(fnName);
      hookNeeds.set(c.hookFn, s);
    } else coreNeeds.add(fnName);
    edits.push({ start: c.start, end: c.end, text: c.braces ? `{${call}}` : call });
  }

  // Wiring: one useT() per component / hook, as its FIRST statement.
  const program = a.ast.program;
  const hasUseTImport = program.body.some((s) => bt.isImportDeclaration(s) && s.source.value === '@/contexts/LanguageContext' && s.specifiers.some((sp) => bt.isImportSpecifier(sp) && bt.isIdentifier(sp.imported) && sp.imported.name === 'useT'));
  for (const [fn, needs] of hookNeeds) {
    const body = fn.node.body;
    if (bt.isBlockStatement(body)) {
      const existingUseT = body.body.find((s): s is bt.VariableDeclaration => bt.isVariableDeclaration(s) && s.declarations.some((d) => bt.isCallExpression(d.init) && bt.isIdentifier(d.init.callee) && d.init.callee.name === 'useT'));
      if (existingUseT) {
        const d = existingUseT.declarations.find((x) => bt.isCallExpression(x.init))!;
        if (bt.isObjectPattern(d.id)) {
          const have = new Set(d.id.properties.map((p) => (bt.isObjectProperty(p) && bt.isIdentifier(p.key) ? p.key.name : '')));
          const add = [...needs].filter((n) => !have.has(n));
          if (add.length) {
            const last = d.id.properties[d.id.properties.length - 1];
            edits.push({ start: last.end!, end: last.end!, text: `, ${add.join(', ')}` });
          }
        }
        continue;
      }
      const firstStmt = body.body[0];
      const indent = firstStmt ? /[ \t]*$/.exec(src.slice(0, firstStmt.start!))![0] : '  ';
      const decl = `const { ${['t', 'tn'].filter((n) => needs.has(n)).join(', ')} } = useT();`;
      if (firstStmt) edits.push({ start: firstStmt.start!, end: firstStmt.start!, text: `${decl}\n${indent}` });
      else edits.push({ start: body.start! + 1, end: body.start! + 1, text: `\n  ${decl}\n` });
    } else {
      // Arrow with an expression body: wrap it in a block that returns it.
      const ext = (body as bt.Node & { extra?: { parenthesized?: boolean; parenStart?: number } }).extra;
      let s = body.start!;
      let e = body.end!;
      if (ext?.parenthesized && typeof ext.parenStart === 'number') {
        s = ext.parenStart;
        const close = src.indexOf(')', e);
        e = close + 1;
      }
      const decl = `const { ${['t', 'tn'].filter((n) => needs.has(n)).join(', ')} } = useT();`;
      edits.push({ start: s, end: s, text: `{\n  ${decl}\n  return ` });
      edits.push({ start: e, end: e, text: ';\n}' });
    }
  }

  // Imports.
  const imports = program.body.filter((s): s is bt.ImportDeclaration => bt.isImportDeclaration(s));
  const lastImport = imports[imports.length - 1];
  const addImport = (spec: string[], from: string) => {
    const already = imports.find((s) => s.source.value === from && s.importKind !== 'type');
    if (already) {
      const named = already.specifiers.filter((sp): sp is bt.ImportSpecifier => bt.isImportSpecifier(sp));
      const have = new Set(named.map((sp) => (bt.isIdentifier(sp.imported) ? sp.imported.name : '')));
      const add = spec.filter((x) => !have.has(x));
      if (add.length && named.length) edits.push({ start: named[named.length - 1].end!, end: named[named.length - 1].end!, text: `, ${add.join(', ')}` });
      return;
    }
    const line = `import { ${spec.join(', ')} } from '${from}';`;
    if (lastImport) edits.push({ start: lastImport.end!, end: lastImport.end!, text: `\n${line}` });
    else edits.push({ start: 0, end: 0, text: `${line}\n` });
  };
  if (hookNeeds.size && !hasUseTImport) addImport(['useT'], '@/contexts/LanguageContext');
  if (coreNeeds.size) addImport(['t', 'tn'].filter((n) => coreNeeds.has(n)), '@/i18n/core');

  // Splice, right to left (insertions at the same offset keep their order).
  const ordered = edits.map((e, i) => ({ ...e, i })).sort((x, y) => (y.start - x.start) || (y.end - x.end) || (y.i - x.i));
  let out = src;
  for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { out, keys, report: a.skips };
}

// ── Report ───────────────────────────────────────────────────────────────

export function renderReport(file: string, prefix: string, r: RewriteResult): string {
  const lines: string[] = [];
  lines.push(`# i18n codemod report — ${file}`, '', `prefix \`${prefix}\` · ${r.keys.length} new key(s) · ${r.report.length} skipped item(s)`, '');
  if (r.abort) lines.push(`**ABORTED:** ${r.abort}. Rename the other binding (or finish this file by hand).`, '');
  if (r.keys.length) {
    lines.push('## New keys (give each one Spanish in your es shard)', '');
    for (const k of r.keys) lines.push(`- line ${k.line} \`${k.key}\` — ${JSON.stringify(k.en)}`);
    lines.push('');
  }
  const groups: Record<string, Skip[]> = {};
  for (const s of r.report) (groups[s.reason] ??= []).push(s);
  const WHY: Record<SkipReason, string> = {
    'fragment': 'Fragments: make each one ONE sentence with {placeholders} by hand (docs/I18N.md §3.5)',
    'complex-hole': 'Holes that are not identifiers or member expressions: bind them to a const first, then t() with a placeholder',
    'plural-form': 'Plural tests other than === 1 / !== 1: left alone (converting would change the English at 0)',
    'module-scope': 'Module scope: turn the map / constant into a function (labelFor(x)) that calls t() at call time',
    'bad-marker': 'i18n-keep-english markers with no reason (validate-i18n fails on these)',
    'keep-english': 'Kept English on purpose (marked)',
    'never-translate': 'Never translated (docs/I18N.md §8)',
    'hand-check': 'Other sentence-like literals it did not touch (hand-check: user-facing or not?)',
  };
  for (const reason of Object.keys(WHY) as SkipReason[]) {
    const g = groups[reason];
    if (!g?.length) continue;
    lines.push(`## ${WHY[reason]} (${g.length})`, '');
    for (const s of g) lines.push(`- line ${s.line}: ${JSON.stringify(s.text)}${s.detail ? ` — ${s.detail}` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────

function usage(msg?: string): never {
  if (msg) console.error(`✗ ${msg}`);
  console.error('usage: bun run scripts/i18n-codemod.ts --file <path> --prefix <area.surface> [--range <from>-<to> …] [--props a,b] [--write] [--report <path>]');
  process.exit(64);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let file = '';
  let prefix = '';
  let write = false;
  let reportPath = '';
  const ranges: Array<[number, number]> = [];
  const extraProps: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') file = argv[++i] ?? '';
    else if (a === '--prefix') prefix = argv[++i] ?? '';
    else if (a === '--write') write = true;
    else if (a === '--report') reportPath = argv[++i] ?? '';
    else if (a === '--props') extraProps.push(...(argv[++i] ?? '').split(',').filter(Boolean));
    else if (a === '--range') {
      const m = /^(\d+)-(\d+)$/.exec(argv[++i] ?? '');
      if (!m) usage('--range wants <from>-<to> (line numbers)');
      ranges.push([Number(m[1]), Number(m[2])]);
    } else usage(`unknown argument ${a}`);
  }
  if (!file || !prefix) usage();
  const abs = file.startsWith('/') ? file : join(ROOT, file);
  if (!existsSync(abs)) usage(`no such file ${file}`);
  const rel = relative(ROOT, abs);
  const src = readFileSync(abs, 'utf8');
  const { EN_CATALOG } = await import('../i18n/catalog/en');
  let r: RewriteResult;
  try {
    r = rewrite(src, prefix, { ranges, extraProps }, EN_CATALOG as Record<string, unknown>);
  } catch (e) {
    usage((e as Error).message);
  }
  const report = renderReport(rel, prefix, r);
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, report);
  }
  if (r.abort) {
    console.error(report);
    console.error(`✗ ${rel}: aborted — ${r.abort}`);
    process.exit(2);
  }
  // Refuse to write a file that no longer parses (belt and braces).
  try { parseSource(r.out); } catch (e) {
    console.error(`✗ the rewritten ${rel} does not parse: ${(e as Error).message}. Nothing written.`);
    process.exit(1);
  }
  if (write) {
    if (r.out !== src) writeFileSync(abs, r.out);
    console.log(`✓ ${rel}: ${r.keys.length} key(s) written. Next: hand-finish the report, write the Spanish, then bun run scripts/i18n-extract.ts --surface <id>`);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-codemod-'));
    try {
      const after = join(dir, 'after');
      writeFileSync(after, r.out);
      const d = spawnSync('diff', ['-u', '--label', `a/${rel}`, '--label', `b/${rel}`, abs, after], { encoding: 'utf8' });
      process.stdout.write(d.stdout || '(no change)\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    console.log('\n(dry run — pass --write to apply)');
  }
  if (!reportPath) console.log(`\n${report}`);
  else console.log(`report: ${reportPath}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
