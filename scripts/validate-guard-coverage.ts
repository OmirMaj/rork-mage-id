// validate-guard-coverage.ts — a guard that never runs is not a guard.
//
// WHY THIS EXISTS. `ship-check` is a hand-maintained `&&` chain of `test:*`
// scripts in package.json. Adding a validator takes three steps — write
// scripts/validate-foo.ts, add "test:foo", append `&& bun run test:foo` to
// ship-check — and the third step is the one that gets forgotten, because the
// first two are enough to make it pass when you run it by hand.
//
// An audit on 2026-08-29 found 177 validators on disk, 158 reachable from
// ship-check. NINETEEN guards had a package.json entry and were never executed
// by the ship gate. Among them:
//
//   • validate-role-blinding          — field-role users must not see costs
//   • validate-project-financials-split — the column-leak fix that backs it
//   • validate-collaborator-access    — invited users must not be paywalled out
//   • validate-seat-model             — who gets billed a seat
//
// Those four are the security-relevant ones. All nineteen happened to be green
// when finally run, which is luck rather than process: each was written to
// protect an invariant, passed once by hand, and then spent weeks unable to
// fail the build no matter what anyone did to the code it guarded.
//
// That is a worse failure than a missing guard, because the guard's EXISTENCE
// is what stops the next person from re-checking the invariant themselves.
// A dark guard is an active false assurance.
//
// THE RULE: every scripts/validate-*.ts must be transitively reachable from the
// ship-check chain. Transitively, because the chain runs `bun run test:foo` and
// `test:foo` may itself be another chain.
//
// Run via: bun run test:guard-coverage

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts: Record<string, string> =
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};

const GATE = 'ship-check';

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

console.log('\nguard coverage (every validator is actually enforced):');

check(`the "${GATE}" script exists`, typeof scripts[GATE] === 'string',
  'The ship gate was renamed or removed — update GATE in this guard.');
if (!scripts[GATE]) { console.error('\n✗ validate-guard-coverage: cannot continue\n'); process.exit(1); }

// ── walk the chain transitively ─────────────────────────────────────────────
// `bun run x` / `npm run x` / `bun x` hop to another script; a direct
// `scripts/validate-y.ts` reference is a leaf.
const reachedScripts = new Set<string>();
const reachedValidators = new Set<string>();

function walk(name: string): void {
  if (reachedScripts.has(name)) return;      // also terminates self-reference
  reachedScripts.add(name);
  const body = scripts[name];
  if (!body) return;
  for (const m of body.matchAll(/scripts\/(validate-[A-Za-z0-9._-]+)\.ts/g)) {
    reachedValidators.add(m[1]);
  }
  for (const m of body.matchAll(/\b(?:bun|npm|yarn|pnpm)\s+run\s+([A-Za-z0-9:._-]+)/g)) {
    walk(m[1]);
  }
}
walk(GATE);

// ── compare against disk ────────────────────────────────────────────────────
const onDisk = readdirSync(join(ROOT, 'scripts'))
  .filter(f => f.startsWith('validate-') && f.endsWith('.ts'))
  .map(f => f.slice(0, -3))
  .sort();

check('validators were found on disk', onDisk.length > 0,
  'No scripts/validate-*.ts at all — has the directory moved?');

const dark = onDisk.filter(v => !reachedValidators.has(v));

check(
  `all ${onDisk.length} validators are reachable from ${GATE}`,
  dark.length === 0,
  dark.length === 0 ? undefined :
    `${dark.length} validator(s) exist but ${GATE} never runs them, so they cannot fail the build:\n` +
    dark.map(v => `        • ${v}`).join('\n') +
    `\n\n      Add each to the ship-check chain in package.json:\n` +
    dark.map(v => `        && bun run ${v.replace(/^validate-/, 'test:')}`).join('\n'),
);

// A validator referenced by the chain but absent from disk means the chain will
// die with a file-not-found partway through, skipping everything after it.
const missing = [...reachedValidators].filter(v => !onDisk.includes(v)).sort();
check(
  'every validator the chain references still exists on disk',
  missing.length === 0,
  `${GATE} references ${missing.join(', ')}, which is not in scripts/. The chain will abort there and silently skip every guard after it.`,
);

if (failures > 0) {
  console.error(`\n✗ validate-guard-coverage: ${failures} failure(s)`);
  console.error('  A guard that never runs is worse than no guard: its existence stops');
  console.error('  the next person from checking the invariant themselves.\n');
  process.exit(1);
}
console.log(`\n${onDisk.length} validators, all enforced — 3 passed, 0 failed\n`);
