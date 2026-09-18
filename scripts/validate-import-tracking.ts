// validate-import-tracking.ts — the committed tree must build on its own.
//
// WHY THIS EXISTS. `git commit -am "..."` stages every MODIFIED TRACKED file and
// no UNTRACKED ones. So when a tracked file is edited to import a brand-new
// module that was never `git add`ed, that commit ships the importer without its
// target. The working tree builds perfectly. The pushed tree does not exist as
// a buildable thing anywhere until CI tries it.
//
// This was not hypothetical. On 2026-08-27 this repo had FOURTEEN such edges —
// utils/systemOfAction.ts importing utils/crewPresence.ts, app/job-costing.tsx
// importing utils/roleBlinding.ts, app/client-view.tsx importing three untracked
// modules, and so on. Reconstructing the tree a `commit -am` would produce and
// running `expo export --platform web` against it exited 1 on the first
// unresolved specifier.
//
// The blast radius is both platforms, and it is worse on web:
//   • WEB — netlify.toml runs `bunx expo export --platform web` on every push to
//     main. Metro halts on the first unresolved import, the build fails, and
//     Netlify keeps serving the LAST GOOD bundle. app.mageid.app silently
//     freezes: every later push also fails, and nothing in the app says so.
//   • iOS — EAS Build uploads the git state, not the working directory, so the
//     same missing files break the build there too.
//
// Local `tsc`, lint and every other guard pass, because they all read the
// working tree — which has the files. Only git disagrees.
//
// THE RULE: a TRACKED file may not hard-import an UNTRACKED module.
// `import type` is exempt: Babel elides type-only imports before Metro resolves
// them, so they never enter the module graph.
//
// Untracked→untracked is NOT flagged: `git add -A` picks up both together, and
// flagging it would make the guard fire constantly during normal work.
//
// Run via: bun run test:import-tracking

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(cmd: string): string[] {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

const isFile = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };

/** Resolve an import specifier to a repo-relative file path, mirroring Metro
 *  AND Deno: the literal path first (Deno edge functions import `./x.ts` with
 *  the extension — adding `.ts` again looked for `x.ts.ts`, found nothing, and
 *  the edge was silently skipped), then each extension, then /index.<ext>. */
export function resolveSpec(spec: string, fromFile: string, root: string = ROOT): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(root, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(join(root, fromFile)), spec);
  else return null; // bare package — package.json's problem, not this guard's

  if (isFile(base)) return relative(root, base);
  for (const ext of EXTS) if (isFile(base + ext)) return relative(root, base + ext);
  for (const ext of EXTS) {
    const idx = join(base, 'index' + ext);
    if (isFile(idx)) return relative(root, idx);
  }
  return null;
}

/** Blank out comments, keeping every newline so line numbers survive. A `//`
 *  inside a string ('https://…') is left alone: only a `//` that starts the
 *  line (after whitespace) or follows code with a space is a comment here —
 *  good enough for import scanning, which only needs `import` statements. */
function blankComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\n)([ \t]*)\/\/[^\n]*/g, (_m, nl: string, ws: string) => nl + ws);
}

/**
 * Every module specifier `src` hard-depends on, with its 1-based line. Matched
 * over the WHOLE text, not line by line: a multi-line
 *     import {
 *       a,
 *     } from '@/utils/x';
 * has no line that starts with `import` AND holds `from`, so the old per-line
 * scan never saw it (utils/propertyMirror.ts was imported exactly like that by
 * two tracked files and went unreported). Type-only imports/exports are erased
 * before Metro resolves the graph and are skipped; side-effect imports,
 * dynamic `import('…')` (Metro bundles those too) and require() count.
 */
export function findImportSpecs(src: string): { spec: string; line: number }[] {
  const text = blankComments(src);
  const out: { spec: string; line: number }[] = [];
  const lineAt = (idx: number) => text.slice(0, idx).split('\n').length;
  const push = (spec: string, idx: number) => out.push({ spec, line: lineAt(idx) });
  const stmt = /(^|[;\n}])[ \t]*(import|export)\s+(type\s+)?([^;'"`]*?)\bfrom\s*['"]([^'"\n]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = stmt.exec(text))) {
    if (m[3]) continue; // `import type … from` / `export type … from`
    push(m[5], m.index + m[1].length);
  }
  const bare = /(^|[;\n}])[ \t]*import\s*['"]([^'"\n]+)['"]/g;
  while ((m = bare.exec(text))) push(m[2], m.index + m[1].length);
  const call = /\b(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  while ((m = call.exec(text))) push(m[1], m.index);
  return out;
}

// ── Self-test: the scanner must see what it exists to see ───────────────────
// Integration round 1 found the per-line scan naming 11 untracked modules when
// 16 were hard-imported — multi-line imports and `./x.ts` Deno specifiers
// slipped through. These fixtures fail the guard itself if either returns.
{
  const specsOf = (s: string) => findImportSpecs(s).map(x => x.spec);
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  const fixtures: [string, string, string[]][] = [
    ['multi-line named import', "import {\n  a,\n  b,\n} from '@/utils/propertyMirror';\n", ['@/utils/propertyMirror']],
    ['multi-line re-export', "export {\n  x,\n} from './y';\n", ['./y']],
    ['single-line default import', "import X from '@/components/X';", ['@/components/X']],
    ['Deno .ts specifier', "import { gate } from './digestGate.ts';", ['./digestGate.ts']],
    ['import type is skipped', "import type { T } from '@/types';\nimport type {\n  U,\n} from '@/utils/u';", []],
    ['export type is skipped', "export type { T } from './t';", []],
    ['dynamic import counts', "void import('@/utils/qboSync').then(m => m);", ['@/utils/qboSync']],
    ['require counts', "const { oops } = require('@/components/animations/NailItToast');", ['@/components/animations/NailItToast']],
    ['side-effect import counts', "import './polyfill';", ['./polyfill']],
    ['commented-out import is ignored', "// import X from './gone';\n/* import Y from './gone2'; */", []],
  ];
  let selfFail = 0;
  for (const [name, src, want] of fixtures) {
    const got = specsOf(src);
    if (!same(got, want)) { selfFail++; console.error(`✗ self-test "${name}": got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  }
  const lines = findImportSpecs("const a = 1;\nimport {\n  z,\n} from './z';\n");
  if (lines[0]?.line !== 2) { selfFail++; console.error(`✗ self-test "line number of a multi-line import": got ${lines[0]?.line}, want 2`); }
  // The literal path first: this very file, spelled with its extension.
  if (resolveSpec('./validate-import-tracking.ts', 'scripts/x.ts') !== join('scripts', 'validate-import-tracking.ts')) {
    selfFail++; console.error('✗ self-test "resolveSpec tries the literal path before adding extensions"');
  }
  if (selfFail > 0) {
    console.error(`\n✗ validate-import-tracking: ${selfFail} self-test(s) failed — the scanner is blind to real imports.`);
    process.exit(1);
  }
}

const tracked = new Set(git('git ls-files'));
if (tracked.size === 0) {
  // Not a git repo, or git unavailable — skip rather than fail the build.
  console.log('✓ validate-import-tracking: self-tests pass; not a git working tree, scan skipped');
  process.exit(0);
}

interface Violation { importer: string; line: number; target: string; spec: string }
const violations: Violation[] = [];
let scanned = 0;

// Only TRACKED files can produce the dangerous edge — an untracked importer is
// added by the same `git add` that picks up its target.
for (const file of tracked) {
  if (!EXTS.some(e => file.endsWith(e))) continue;
  if (file.startsWith('scripts/') || file.startsWith('__tests__/')) continue;
  // A file git still TRACKS but that is gone from disk — a deletion staged in
  // the working tree, e.g. utils/scheduleRebase.ts on 2026-09-11. It has no
  // imports to check, and readFileSync would throw ENOENT and take the whole
  // guard down with it, which is the one failure mode a guard must never have:
  // it stops reporting on the other 400 files for a reason unrelated to them.
  if (!existsSync(join(ROOT, file))) continue;
  scanned++;

  for (const { spec, line } of findImportSpecs(readFileSync(join(ROOT, file), 'utf8'))) {
    const target = resolveSpec(spec, file);
    // Unresolvable is fine here: a bare package, or a genuinely missing file
    // that tsc already fails on. This guard is only about git tracking.
    if (!target) continue;
    if (!tracked.has(target)) {
      violations.push({ importer: file, line, target, spec });
    }
  }
}

if (scanned === 0) {
  console.error('✗ validate-import-tracking: scanned ZERO tracked source files.');
  console.error('  The guard stopped matching — fix it, do not delete it.');
  process.exit(1);
}

if (violations.length > 0) {
  const byTarget = new Map<string, Violation[]>();
  for (const v of violations) {
    if (!byTarget.has(v.target)) byTarget.set(v.target, []);
    byTarget.get(v.target)!.push(v);
  }

  console.error('\n✗ validate-import-tracking: tracked files import UNTRACKED modules\n');
  for (const [target, vs] of [...byTarget].sort()) {
    console.error(`  ${target}  — NOT tracked by git`);
    for (const v of vs) console.error(`      imported by  ${v.importer}:${v.line}`);
  }
  console.error(`\n  ${byTarget.size} untracked module(s) across ${violations.length} import(s).`);
  console.error('\n  A `git commit -am` stages the importers and NOT these files, so the');
  console.error('  pushed tree cannot build. Metro halts on the first unresolved specifier:');
  console.error('  the Netlify web build fails outright and app.mageid.app silently keeps');
  console.error('  serving the last good bundle, while EAS Build fails for the same reason.');
  console.error('\n  Fix:  git add -A     (then commit)\n');
  process.exit(1);
}

console.log(`✓ validate-import-tracking: ${scanned} tracked files, every import resolves to a tracked module`);
