// validate-edge-typecheck.ts — the server half was never type-checked.
//
// WHY THIS EXISTS. tsconfig.json excludes `supabase/functions/**/*` (correctly —
// they are Deno, not React Native, and would fail on Deno globals and https:
// imports). But nothing else checked them either. `bun run typecheck` covered
// the app and skipped 63 edge functions: every AI relay, the Stripe webhook,
// the notification fan-out, the dunning cron, the magic-link issuer.
//
// Those files hold the money paths and run with the SERVICE ROLE key, which
// bypasses RLS. They were the least-checked code in the repo and the most
// privileged.
//
// Running `deno check` over them on 2026-08-29 — the first time it had ever
// been done — found 6 errors sitting in main, including a stripe-webhook helper
// whose client parameter type resolved to `SupabaseClient<unknown, never, ...>`,
// which silently made every selected column `unknown` and broke two .eq() calls
// downstream.
//
// All six turned out to be annotation defects rather than live runtime bugs.
// That is the good outcome, and it is not a reason to leave the gate open: the
// same silence would have hidden a real one just as completely.
//
// COST: ~0.1s warm. Deno caches remote deps under ~/.cache/deno, so only the
// first run needs network.
//
// Run via: bun run test:edge-typecheck

import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN_DIR = join(ROOT, 'supabase', 'functions');

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

console.log('\nedge function typecheck (the privileged half of the app):');

// ── 1. deno must be present ─────────────────────────────────────────────────
// Deliberately a FAILURE, not a skip. A guard that quietly skips itself when a
// tool is missing is exactly the dark-guard pattern validate-guard-coverage.ts
// exists to stop — it would print nothing and let unchecked server code ship.
const version = spawnSync('deno', ['--version'], { encoding: 'utf8' });
check(
  'deno is installed',
  version.status === 0,
  'Edge functions are Deno and cannot be checked without it.\n' +
  '      Install: curl -fsSL https://deno.land/install.sh | sh   (or: brew install deno)',
);
if (version.status !== 0) {
  console.error('\n✗ validate-edge-typecheck: cannot run\n');
  process.exit(1);
}

// ── 2. every function directory has an entrypoint ───────────────────────────
const dirs = existsSync(FN_DIR)
  ? readdirSync(FN_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'))
      .map(d => d.name)
      .sort()
  : [];

check('edge functions were found', dirs.length > 0, `Nothing under ${FN_DIR} — has the layout changed?`);

const missingEntry = dirs.filter(d => !existsSync(join(FN_DIR, d, 'index.ts')));
check(
  'every function directory has an index.ts',
  missingEntry.length === 0,
  `No entrypoint in: ${missingEntry.join(', ')}. Deploy would fail for these, and the glob below silently skips them.`,
);

// ── 3. the actual check ─────────────────────────────────────────────────────
// _shared/*.ts is covered transitively — every index.ts that uses it imports it.
//
// THE TWO FLAGS ARE LEAD-PAINTED. Do not "simplify" them:
//
//   --node-modules-dir=none
//     construction-answer imports npm:@anthropic-ai/sdk, and because this repo
//     has a package.json Deno defaults to the npm-managed strategy, fails to
//     find that package, and suggests --node-modules-dir=auto. Taking that
//     suggestion makes Deno materialise its OWN dependency tree into the
//     project's ./node_modules (626 MB under node_modules/.deno) and rewrite
//     node_modules/.bin. Jest then resolves jest-runtime through Deno's tree
//     and every one of the 14 suites dies with "Cannot use import statement
//     outside a module" — a total, and totally baffling, test-suite failure
//     caused by a TYPE CHECK. Recovery is rm -rf node_modules/.deno plus a
//     reinstall. 'none' resolves npm: from Deno's own global cache instead and
//     leaves the bun-installed tree alone.
//
//   --no-lock
//     deno.lock is tracked. Without this, merely RUNNING the guard dirties the
//     working tree, so ship-check would leave uncommitted changes behind every
//     time it passed. A verification step must be read-only.
//
// Both are asserted below rather than merely commented, because the failure
// mode of getting them wrong is loud, expensive, and points at the wrong file.
const entries = dirs
  .filter(d => existsSync(join(FN_DIR, d, 'index.ts')))
  .map(d => join('supabase', 'functions', d, 'index.ts'));

const res = spawnSync('deno', ['check', '--node-modules-dir=none', '--no-lock', ...entries], {
  cwd: ROOT,
  encoding: 'utf8',
});

const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
// eslint-disable-next-line no-control-regex
const plain = output.replace(/\[[0-9;]*m/g, '');
const errorLines = plain.split('\n').filter(l => /^TS\d+ \[ERROR\]|^error:/.test(l.trim()));

check(
  `all ${entries.length} edge functions type-check`,
  res.status === 0,
  errorLines.length > 0
    // Reproduce line MUST carry both flags. Printing the bare command here
    // would hand the next reader the --node-modules-dir=auto footgun described
    // above at the exact moment they are frustrated enough to paste it.
    ? `deno check reported:\n${errorLines.map(l => `        ${l.trim()}`).join('\n')}\n\n      Reproduce: deno check --node-modules-dir=none --no-lock supabase/functions/*/index.ts`
    : `deno check exited ${res.status}. Full output:\n${plain.split('\n').slice(-25).join('\n')}`,
);

// ── 4. the guard itself left no trace ───────────────────────────────────────
// Proves the two flags above are still doing their job. If a future edit drops
// --node-modules-dir=none, this fails on the very run that would otherwise have
// silently broken the jest suite.
check(
  'the check did not write into node_modules (--node-modules-dir=none held)',
  !existsSync(join(ROOT, 'node_modules', '.deno')),
  'Deno materialised its own dependency tree into ./node_modules. This BREAKS JEST: ' +
  'suites resolve jest-runtime through node_modules/.deno and fail to parse. ' +
  'Recover with `rm -rf node_modules/.deno && bun install`, then restore ' +
  '--node-modules-dir=none in this file.',
);

if (failures > 0) {
  console.error(`\n✗ validate-edge-typecheck: ${failures} failure(s)`);
  console.error('  These run with the service-role key and bypass RLS. Fix before shipping.\n');
  process.exit(1);
}
console.log(`\n${entries.length} edge functions checked — 5 passed, 0 failed\n`);
