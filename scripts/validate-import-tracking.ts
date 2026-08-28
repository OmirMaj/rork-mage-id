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
import { readFileSync, existsSync } from 'node:fs';
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

const tracked = new Set(git('git ls-files'));
if (tracked.size === 0) {
  // Not a git repo, or git unavailable — skip rather than fail the build.
  console.log('✓ validate-import-tracking: not a git working tree, skipped');
  process.exit(0);
}

const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

/** Resolve an import specifier to a repo-relative file path, mirroring Metro:
 *  try the literal path with each extension, then /index.<ext>. */
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(join(ROOT, fromFile)), spec);
  else return null; // bare package — package.json's problem, not this guard's

  for (const ext of EXTS) if (existsSync(base + ext)) return relative(ROOT, base + ext);
  for (const ext of EXTS) {
    const idx = join(base, 'index' + ext);
    if (existsSync(idx)) return relative(ROOT, idx);
  }
  return null;
}

interface Violation { importer: string; line: number; target: string; spec: string }
const violations: Violation[] = [];
let scanned = 0;

// Only TRACKED files can produce the dangerous edge — an untracked importer is
// added by the same `git add` that picks up its target.
for (const file of tracked) {
  if (!EXTS.some(e => file.endsWith(e))) continue;
  if (file.startsWith('scripts/') || file.startsWith('__tests__/')) continue;
  scanned++;

  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    // `import type ... from` and `import { type X }` are erased before Metro
    // resolves the graph, so they cannot break a build.
    if (/^\s*import\s+type\s/.test(line)) return;
    const m = line.match(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/)
           ?? line.match(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/);
    if (!m) return;

    const target = resolveSpec(m[1], file);
    // Unresolvable is fine here: a bare package, or a genuinely missing file
    // that tsc already fails on. This guard is only about git tracking.
    if (!target) return;
    if (!tracked.has(target)) {
      violations.push({ importer: file, line: i + 1, target, spec: m[1] });
    }
  });
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
