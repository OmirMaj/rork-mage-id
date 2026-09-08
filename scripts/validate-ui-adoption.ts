// validate-ui-adoption.ts — the primitive layer has to be reachable, honest,
// and gaining ground.
//
// WHY THIS EXISTS (2026-09-07 app-experience audit, "worth doing" 29).
// components/ui/ shipped five primitives with importer counts of 1, 6, 3, 3 and
// 5, against ~700 hand-rolled `backgroundColor: t.surface` + `borderRadius`
// recipes in app/ and components/. StatusPill had ZERO, and its name collided
// with a different component (components/schedule/StatusPill.tsx).
//
// The mechanical cause was not taste. Two things were broken:
//
//   1. There was no components/ui/index.ts, so `import { Card } from
//      '@/components/ui'` — the import every design system is written to be
//      used with — did not RESOLVE. It failed with a module-not-found, which
//      reads as "these don't exist" rather than "the barrel is missing".
//   2. <Card> could draw exactly ONE of the shapes the app uses (radius.lg 14 /
//      padding 16 / hairline), which matches 33 of those ~700. Every other
//      cluster differs in radius, in padding, or in having no border, so
//      adopting it meant accepting a visible change to that screen. Nobody did.
//
// Both are fixed; this guard stops them regressing and ratchets the rest.
//
// Three checks:
//   A. the barrel resolves AND does not lie — every name it re-exports really
//      exists in the module it names, and every primitive in the folder is
//      re-exported (a primitive nobody can import is how this started).
//   B. the hand-rolled count only ever falls.
//   C. the barrel keeps at least as many importers as it has today.
//
// Pure node:fs — no bundler, no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.
//
// Run via: bun run test:ui-adoption

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const UI = join(ROOT, 'components', 'ui');

/**
 * Hand-rolled surface-card recipes, as measured on 2026-09-07 AFTER converting
 * the ones inside the files that wave owned (697 → 686).
 *
 * NEVER RAISE THIS. A rise means a new screen hand-rolled the recipe instead of
 * spreading `cardSurface(t, …)`. Lower it as recipes convert — the top clusters
 * are radius.card with no padding (73), radius.lg with padding 14 (50) and
 * radius.md with no padding (44).
 */
const HANDROLLED_CEILING = 684;

/**
 * Files importing the barrel. NEVER LOWER THIS. It was 0 before the barrel
 * existed, which is the number that made the audit call the whole layer
 * unreachable.
 */
const BARREL_IMPORTER_FLOOR = 6;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Blank out comments, preserving offsets and line count.
 *
 * Not optional here, and not hypothetical: the first run of this file reported
 * THREE importers of `@/components/ui` and named `components/ui/index.ts` as
 * one of them — it does not import itself, its DOC COMMENT quotes the specifier.
 * A comment-blind count would let a file that only mentions the barrel hold the
 * floor up while nothing actually imports it. (Same routine as
 * scripts/validate-contrast.ts, for the same reason.)
 */
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
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) {
      mode = 'code';
    }
    i++;
  }
  return out.join('');
}

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.error('  FAIL  ' + name);
  if (detail) console.error('        ' + detail);
}

console.log('\nui primitive adoption:');

// ── A. the barrel resolves, and every name in it is real ────────────────────

const barrelPath = join(UI, 'index.ts');
let barrel = '';
try { barrel = readFileSync(barrelPath, 'utf8'); } catch { /* reported below */ }

ok(
  "components/ui/index.ts exists, so `@/components/ui` resolves",
  barrel.length > 0,
  'Without it the barrel import fails with a module-not-found, which reads as "these primitives do not exist".',
);

if (barrel) {
  const barrelProblems: string[] = [];
  /** Every module the barrel re-exports from, and the names it claims. */
  const reexported = new Map<string, string[]>();
  for (const m of barrel.matchAll(/export\s*\{([^}]*)\}\s*from\s*'(\.\/[\w./-]+)'/g)) {
    const names = m[1]
      .split(',')
      .map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    reexported.set(m[2], [...(reexported.get(m[2]) ?? []), ...names]);
  }

  for (const [mod, names] of reexported) {
    const base = join(UI, mod.replace(/^\.\//, ''));
    let src = '';
    for (const ext of ['.ts', '.tsx']) {
      try { src = readFileSync(base + ext, 'utf8'); break; } catch { /* try next */ }
    }
    if (!src) { barrelProblems.push(`${mod} — re-exported by the barrel but the file does not exist`); continue; }
    for (const n of names) {
      const declared = new RegExp(
        `export\\s+(?:const|function|type|interface|class)\\s+${n}\\b|export\\s*\\{[^}]*\\b${n}\\b`,
      ).test(src);
      if (!declared) barrelProblems.push(`${mod} does not export \`${n}\`, but the barrel says it does`);
    }
  }

  // Every primitive in the folder must be reachable through the barrel. A
  // primitive nobody can import from '@/components/ui' is the state this
  // whole guard exists because of.
  for (const f of readdirSync(UI)) {
    if (f === 'index.ts' || (!f.endsWith('.ts') && !f.endsWith('.tsx'))) continue;
    const stem = './' + f.replace(/\.tsx?$/, '');
    if (!reexported.has(stem)) barrelProblems.push(`components/ui/${f} is not re-exported by index.ts — nobody can reach it from '@/components/ui'`);
  }

  ok(
    'the barrel re-exports every primitive, and every name it claims is real',
    barrelProblems.length === 0,
    barrelProblems.join('\n        '),
  );
}

// StatusPill's name collision was the audit's own hypothesis for why it had
// zero importers. It now lives in the barrel; the loose copy must stay gone.
let strayStatusPill = false;
try { statSync(join(ROOT, 'components', 'StatusPill.tsx')); strayStatusPill = true; } catch { /* good */ }
ok(
  'the general StatusPill lives in components/ui, not beside the schedule-specific one',
  !strayStatusPill,
  'components/StatusPill.tsx is back. Its name collides with components/schedule/StatusPill.tsx, which is a different component with a different job — that collision is why it shipped with zero importers.',
);

// ── B. the ratchet ──────────────────────────────────────────────────────────
//
// A "hand-rolled surface-card recipe" is a StyleSheet entry that paints the
// theme's `surface` AND rounds a corner — the shape `cardSurface(t, …)` exists
// to express. An entry that spreads cardSurface no longer names `surface`
// itself, so it drops out of this count automatically.

const ENTRY = /^\s{2,}([A-Za-z_$][\w$]*)\s*:\s*\{/;
const handRolled: string[] = [];
const clusters = new Map<string, number>();

for (const file of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]) {
  if (!file.endsWith('.tsx')) continue;
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = ENTRY.exec(lines[i]);
    if (!m) continue;
    let depth = 0;
    let body = '';
    let j = i;
    for (; j < lines.length && j < i + 20; j++) {
      for (const ch of lines[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      body += lines[j] + '\n';
      if (depth <= 0) break;
    }
    if (!/backgroundColor:\s*(?:t|themeColors|colors)\.surface\b/.test(body)) continue;
    const radius = /borderRadius:\s*([^,\n]+)/.exec(body);
    if (!radius) continue;
    const pad = /(?:^|[\s,{])padding:\s*([^,\n]+)/.exec(body);
    const key = `${radius[1].trim()} / pad ${pad ? pad[1].trim() : 'none'}`;
    clusters.set(key, (clusters.get(key) ?? 0) + 1);
    handRolled.push(`${relative(ROOT, file)}:${i + 1}  ${m[1]}  ${key}`);
    i = j;
  }
}

console.log(`  hand-rolled surface-card recipes: ${handRolled.length} (ceiling ${HANDROLLED_CEILING})`);
if (handRolled.length > HANDROLLED_CEILING) {
  failures += 1;
  console.error(`  FAIL  ${handRolled.length - HANDROLLED_CEILING} over the ceiling.`);
  console.error('        Spread `cardSurface(t, { radius, pad, bordered })` from @/components/ui instead');
  console.error('        of writing backgroundColor/borderRadius/borderWidth/borderColor by hand.\n');
  for (const h of handRolled.slice(-12)) console.error(`        ${h}`);
} else if (handRolled.length < HANDROLLED_CEILING) {
  console.log(`  NOTE  below the ceiling — lower HANDROLLED_CEILING to ${handRolled.length} to lock the gain in.`);
} else {
  // Not "PASS". Sitting ON a 686 ceiling is a held line, not a clean bill —
  // wording this as a pass is how the other guards came to certify drift.
  console.log('  HELD  at the ceiling. Biggest clusters left:');
  for (const [k, v] of [...clusters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    console.log(`        ${String(v).padStart(4)}  ${k}`);
  }
}

// ── C. the barrel keeps its importers ───────────────────────────────────────

const barrelImporters = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]
  // The primitives use relative imports among themselves; a barrel counting its
  // own folder would count itself.
  .filter((f) => !f.startsWith(UI + '/'))
  .filter((f) => /from\s+'@\/components\/ui'/.test(stripComments(readFileSync(f, 'utf8'))))
  .map((f) => relative(ROOT, f));

console.log(`  files importing '@/components/ui': ${barrelImporters.length} (floor ${BARREL_IMPORTER_FLOOR})`);
if (barrelImporters.length < BARREL_IMPORTER_FLOOR) {
  failures += 1;
  console.error(`  FAIL  ${BARREL_IMPORTER_FLOOR - barrelImporters.length} fewer than the floor — the barrel is losing ground.`);
  console.error('        Raise BARREL_IMPORTER_FLOOR as screens adopt it; never lower it.');
} else {
  console.log(`  PASS  ${barrelImporters.length} file(s): ${barrelImporters.join(', ')}`);
}

console.log('');
process.exit(failures === 0 ? 0 : 1);
