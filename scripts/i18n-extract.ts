// scripts/i18n-extract.ts — rebuild the GENERATED English shards from the
// t()/tn() call sites (docs/I18N.md §10.3).
//
//   bun run scripts/i18n-extract.ts --surface <id>   rewrite ONE surface's shard (what a lane runs)
//   bun run scripts/i18n-extract.ts --check          exit 1 if any shard is out of date, or
//                                                    en/unassigned.generated.ts would hold a key
//   bun run scripts/i18n-extract.ts                  rewrite every generated shard (orchestrator)
//
// It scans every file under app/ components/ contexts/ hooks/ utils/
// constants/ lib/ that imports the i18n layer, reads each t(key, 'English',
// vars?) / tn(key, count, { one, other }, vars?) call with the TypeScript
// parser, and writes each key to its OWNER's shard — by KEY, not by file
// (i18n/surfaces.ts ownerOfKey: exact `keys` first, then the longest prefix).
// Keys owned by a seed surface are never written: they live in the hand-kept
// en/seed.ts, and validate-i18n checks the call site's English against it.
// Shards are sorted by key, so a rerun with no change is byte-identical.
//
// `--surface` exists so parallel lanes never touch each other's shards: a
// lane only ever rewrites the shard of the surface it migrates.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import type { CatalogValue, PluralForms } from '../i18n/types';
import { SURFACES, ownerOfKey, shardFileOf, isSeedSurface, UNASSIGNED_SHARD, type Surface } from '../i18n/surfaces';

const ROOT_DEFAULT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SCAN_DIRS = ['app', 'components', 'contexts', 'hooks', 'utils', 'constants', 'lib'];
export const IMPORTS_I18N = /from ['"](@\/i18n(\/[a-z]+)?|\.{1,2}\/(\.\.\/)*i18n(\/[a-z]+)?|@\/contexts\/LanguageContext|\.{1,2}\/(\.\.\/)*contexts\/LanguageContext|\.\/core)['"]/;
const KEY_RE = /^([a-z]+)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/;

export interface CallSite {
  file: string;
  line: number;
  fn: 't' | 'tn';
  key: string;
  en: CatalogValue;
  /** Names passed in an object-literal vars argument; null = not a literal (unknown). */
  vars: string[] | null;
}

export interface Scan {
  sites: CallSite[];
  /** Call sites the extractor cannot read (dynamic key, non-literal English …): each fails validate-i18n. */
  problems: string[];
  files: number;
}

export function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function strLit(n: ts.Node | undefined): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

function propName(p: ts.ObjectLiteralElementLike): string | null {
  if (ts.isShorthandPropertyAssignment(p)) return p.name.text;
  if (ts.isPropertyAssignment(p)) {
    if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text;
  }
  return null;
}

function varsOf(n: ts.Node | undefined): string[] | null {
  if (!n) return [];
  if (!ts.isObjectLiteralExpression(n)) return null;
  const out: string[] = [];
  for (const p of n.properties) {
    const name = propName(p);
    if (name === null) return null; // spread / computed: unknown
    out.push(name);
  }
  return out;
}

function pluralOf(n: ts.Node | undefined): PluralForms | null {
  if (!n || !ts.isObjectLiteralExpression(n)) return null;
  const forms: Record<string, string> = {};
  for (const p of n.properties) {
    const name = propName(p);
    if (!name || !ts.isPropertyAssignment(p)) return null;
    const v = strLit(p.initializer);
    if (v === null) return null;
    forms[name] = v;
  }
  if (typeof forms.one !== 'string' || typeof forms.other !== 'string') return null;
  if (Object.keys(forms).some((k) => !['zero', 'one', 'many', 'other'].includes(k))) return null;
  return forms as unknown as PluralForms;
}

/** A string literal with letters, i.e. a word fragment (a bare separator such as ' · ' is fine). */
function wordy(n: ts.Node): boolean {
  const s = strLit(n);
  return s !== null && /[A-Za-z]{2,}/.test(s);
}
function isI18nCallNode(n: ts.Node): n is ts.CallExpression {
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === 't' || n.expression.text === 'tn');
}

function unparen(n: ts.Node): ts.Node {
  let x = n;
  while (x && ts.isParenthesizedExpression(x)) x = x.parent;
  return x;
}
function isPlusChain(n: ts.Node | undefined): n is ts.BinaryExpression {
  return !!n && ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;
}
/** Every operand of a `+` chain, through parentheses: a + (b + c) + d -> [a, b, c, d]. */
function plusOperands(n: ts.Expression): ts.Expression[] {
  let x: ts.Expression = n;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  if (isPlusChain(x)) return [...plusOperands(x.left), ...plusOperands(x.right)];
  return [x];
}

export function scanSource(rel: string, src: string): { sites: CallSite[]; problems: string[] } {
  const sites: CallSite[] = [];
  const problems: string[] = [];
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const visit = (node: ts.Node) => {
    if (isI18nCallNode(node)) {
      const fn = (node.expression as ts.Identifier).text as 't' | 'tn';
      const at = `${rel}:${lineOf(node)}`;
      const key = strLit(node.arguments[0]);
      if (key === null) problems.push(`${at}: ${fn}() key is not a string literal (the extractor and the translator need a fixed key)`);
      else if (!KEY_RE.test(key)) problems.push(`${at}: key "${key}" is not <area>.<surface>.<slug>`);
      else if (fn === 't') {
        const en = strLit(node.arguments[1]);
        if (en === null) problems.push(`${at}: t('${key}', …) English is not a string literal`);
        else sites.push({ file: rel, line: lineOf(node), fn, key, en, vars: varsOf(node.arguments[2]) });
      } else {
        const en = pluralOf(node.arguments[2]);
        if (en === null) problems.push(`${at}: tn('${key}', …) forms are not a literal { one, other } object of strings`);
        else sites.push({ file: rel, line: lineOf(node), fn, key, en, vars: varsOf(node.arguments[3]) });
      }
    }
    // A sentence built from translated fragments (docs/I18N.md §3.5). A `+`
    // chain parses left-associatively — t(a) + ' ' + t(b) is (t(a) + ' ') +
    // t(b), so no single node holds a t() on both sides — so the chain is
    // flattened at its root and judged as a whole: a t()/tn() beside words or
    // beside another t()/tn() anywhere in it is a built sentence.
    if (isPlusChain(node) && !isPlusChain(unparen(node.parent))) {
      const ops = plusOperands(node);
      const calls = ops.filter(isI18nCallNode).length;
      if (calls > 0 && (calls > 1 || ops.some(wordy))) {
        problems.push(`${rel}:${lineOf(node)}: a sentence built from a translated fragment + words — make it ONE key with {placeholders}`);
      }
    }
    if (ts.isTemplateExpression(node) && node.templateSpans.some((sp) => isI18nCallNode(sp.expression))) {
      const texts = [node.head.text, ...node.templateSpans.map((sp) => sp.literal.text)].join('');
      if (/[A-Za-z]{2,}/.test(texts)) problems.push(`${rel}:${lineOf(node)}: a template literal joins a translated fragment with words — make it ONE key with {placeholders}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { sites, problems };
}

export function scanCallSites(root: string = ROOT_DEFAULT): Scan {
  const sites: CallSite[] = [];
  const problems: string[] = [];
  let files = 0;
  for (const d of SCAN_DIRS) {
    for (const f of walk(join(root, d))) {
      const src = readFileSync(f, 'utf8');
      if (!IMPORTS_I18N.test(src)) continue;
      files++;
      const r = scanSource(relative(root, f), src);
      sites.push(...r.sites);
      problems.push(...r.problems);
    }
  }
  return { sites, problems, files };
}

/** key → English, first call site wins; plus every key whose call sites disagree. */
export function collectKeys(sites: CallSite[]): { byKey: Map<string, CallSite>; conflicts: string[] } {
  const byKey = new Map<string, CallSite>();
  const conflicts: string[] = [];
  for (const s of sites) {
    const prev = byKey.get(s.key);
    if (!prev) { byKey.set(s.key, s); continue; }
    if (JSON.stringify(prev.en) !== JSON.stringify(s.en) || prev.fn !== s.fn) {
      conflicts.push(`${s.key}: ${prev.file}:${prev.line} says ${JSON.stringify(prev.en)} but ${s.file}:${s.line} says ${JSON.stringify(s.en)}`);
    }
  }
  return { byKey, conflicts };
}

/** The shard each key lands in: surface id, '(seed)' or '(unassigned)'. */
export function planShards(byKey: Map<string, CallSite>, surfaces: readonly Surface[] = SURFACES): { shards: Map<string, Map<string, CatalogValue>>; seedKeys: string[]; conflicts: string[] } {
  const shards = new Map<string, Map<string, CatalogValue>>();
  for (const s of surfaces) if (!isSeedSurface(s)) shards.set(s.id, new Map());
  shards.set('(unassigned)', new Map());
  const seedKeys: string[] = [];
  const conflicts: string[] = [];
  for (const [key, site] of byKey) {
    const o = ownerOfKey(key, surfaces);
    if (o.kind === 'conflict') { conflicts.push(`${key}: owned by ${o.surfaces.join(' AND ')} (${o.by})`); continue; }
    if (o.kind === 'none') { shards.get('(unassigned)')!.set(key, site.en); continue; }
    const surf = surfaces.find((x) => x.id === o.surface)!;
    if (isSeedSurface(surf)) { seedKeys.push(key); continue; }
    shards.get(o.surface)!.set(key, site.en);
  }
  return { shards, seedKeys, conflicts };
}

function lit(v: string): string {
  return JSON.stringify(v);
}
function renderValue(v: CatalogValue): string {
  if (typeof v === 'string') return lit(v);
  const parts = (['zero', 'one', 'many', 'other'] as const).filter((k) => typeof v[k] === 'string').map((k) => `${k}: ${lit(v[k] as string)}`);
  return `{ ${parts.join(', ')} }`;
}

export function renderShard(id: string, entries: Map<string, CatalogValue>): string {
  const unassigned = id === '(unassigned)';
  const name = unassigned ? 'unassigned' : id;
  const who = unassigned ? 'keys NO surface owns (must stay empty: i18n-extract --check fails otherwise)' : `surface ${id}`;
  const cmd = unassigned ? 'bun run scripts/i18n-extract.ts --check' : `bun run scripts/i18n-extract.ts --surface ${id}`;
  const keys = [...entries.keys()].sort();
  const body = keys.length ? `{\n${keys.map((k) => `  ${lit(k)}: ${renderValue(entries.get(k)!)},`).join('\n')}\n}` : '{}';
  return `// i18n/catalog/en/${name}.generated.ts — GENERATED by scripts/i18n-extract.ts (${who}).
// Do not edit by hand: change the inline English at the t()/tn() call site, then run
//   ${cmd}

import type { EnCatalog } from '../../types';

export const EN: EnCatalog = ${body};
`;
}

function shardPath(root: string, id: string): string {
  return join(root, id === '(unassigned)' ? UNASSIGNED_SHARD : shardFileOf(id));
}

function main(): void {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const si = argv.indexOf('--surface');
  const only = si >= 0 ? argv[si + 1] : null;
  const root = ROOT_DEFAULT;
  if (si >= 0 && (!only || only.startsWith('--'))) { console.error('✗ --surface needs a surface id'); process.exit(64); }
  if (only) {
    const s = SURFACES.find((x) => x.id === only);
    if (!s) { console.error(`✗ no surface "${only}" in i18n/surfaces.ts`); process.exit(64); }
    if (isSeedSurface(s)) { console.error(`✗ ${only} is a seed surface: its keys live in the hand-kept i18n/catalog/en/seed.ts`); process.exit(64); }
  }

  const scan = scanCallSites(root);
  const { byKey, conflicts } = collectKeys(scan.sites);
  const plan = planShards(byKey);
  let bad = 0;
  for (const p of [...scan.problems, ...conflicts, ...plan.conflicts]) { console.error(`  ✗ ${p}`); bad++; }

  const ids = only ? [only] : [...plan.shards.keys()];
  const stale: string[] = [];
  for (const id of ids) {
    const text = renderShard(id, plan.shards.get(id)!);
    const path = shardPath(root, id);
    const cur = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (cur === text) continue;
    if (check) stale.push(relative(root, path));
    else writeFileSync(path, text);
  }
  const unassigned = plan.shards.get('(unassigned)')!;
  console.log(`i18n-extract: ${scan.files} importing files, ${scan.sites.length} call sites, ${byKey.size} keys (${plan.seedKeys.length} seed)`);
  if (unassigned.size) {
    console.error(`  ✗ ${unassigned.size} key(s) no surface owns (they would land in ${UNASSIGNED_SHARD}): ${[...unassigned.keys()].join(', ')}`);
    console.error('    → give the key a prefix a surface owns, or add the surface (orchestrator item: i18n/surfaces.ts)');
    bad++;
  }
  if (check) {
    for (const s of stale) console.error(`  ✗ out of date: ${s} (run bun run scripts/i18n-extract.ts --surface <id>)`);
    if (stale.length || bad) { console.error(`✗ i18n-extract --check: ${stale.length} stale shard(s), ${bad} problem(s)`); process.exit(1); }
    console.log('✓ i18n-extract --check: every shard is current and nothing is unassigned');
    return;
  }
  if (only) {
    // A lane's run never fails on another lane's problem: the problems above
    // are printed for everyone, and --check / validate-i18n are the gates.
    const n = plan.shards.get(only)!.size;
    console.log(`✓ wrote ${shardFileOf(only)} (${n} key${n === 1 ? '' : 's'})${bad ? ` — ${bad} problem(s) listed above (fix yours; --check gates)` : ''}`);
    return;
  }
  console.log(`${bad ? '!' : '✓'} wrote ${ids.length} shard(s)`);
  process.exit(bad ? 1 : 0);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
