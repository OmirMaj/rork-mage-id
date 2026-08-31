// validate-paywall-tiers.ts — the wall must ask for the tier the gate checks.
//
// WHY THIS EXISTS. A gated screen names its feature twice:
//
//     if (!canAccess('portfolio_margin')) {
//       return <Paywall requiredTier="pro" ... />
//     }
//
// The first is looked up in utils/featureTiers.ts. The second was a hand-typed
// literal. When they disagree the product charges for nothing: portfolio_margin
// is 'business', so a contractor was shown "Upgrade to Pro", bought Pro at
// $29/mo, and hit the identical wall. Existing Pro subscribers were told to
// upgrade to the tier they already held.
//
// Four screens had it wrong — portfolio-margin, win-optimizer,
// estimate-calibration (all gating portfolio_margin) and auto-bids (gating
// bid_scoring). All four advertised 'pro'; both features are 'business'.
//
// Nothing could catch it: the literal is a valid RequiredTier, so tsc is happy,
// and no test rendered a paywall for a user of the wrong tier. It is only
// visible by reading two files at once and knowing they must agree.
//
// THE RULE ENFORCED HERE: a paywall must not advertise a tier that DISAGREES
// with the featureTiers.ts entry for the key its own gate checks.
//
// Note what that is not: a ban on literals. 73 of them exist in app/ and ~69
// are correct. Requiring every one to be migrated would make this guard a
// 73-file refactor, and a guard that expensive gets deleted rather than
// satisfied. Deriving with requiredTierFor() is still the better pattern and
// the fix this prints on failure — it just is not the invariant.
//
// Screens whose literal cannot be paired 1:1 with a gate key are printed as
// unverifiable rather than guessed at. A wrong accusation would train the
// reader to ignore this guard; a stated blind spot will not.
//
// Run via: bun run test:paywall-tiers

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\npaywall tiers (derived, never hand-typed):');

// Walk app/ for any file that renders a Paywall.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(join(ROOT, 'app')).filter(f => {
  const src = readFileSync(f, 'utf8');
  return /<Paywall\b/.test(src);
});

ok('screens rendering a Paywall were found', files.length > 0,
  'the walker found none — has the component been renamed?');

// Parse the single source of truth: REQUIRED_TIER in utils/featureTiers.ts.
const tiersSrc = readFileSync(join(ROOT, 'utils', 'featureTiers.ts'), 'utf8');
const REQUIRED: Record<string, string> = {};
const block = tiersSrc.slice(tiersSrc.indexOf('REQUIRED_TIER'));
for (const m of block.matchAll(/^\s*([a-z0-9_]+)\s*:\s*'(free|pro|business|enterprise)'/gm)) {
  REQUIRED[m[1]] = m[2];
}
ok('REQUIRED_TIER was parsed from featureTiers.ts', Object.keys(REQUIRED).length > 10,
  `only parsed ${Object.keys(REQUIRED).length} entries — has the table's shape changed?`);

// A literal is not itself the bug — 73 of them exist and most are right. The
// bug is a literal that DISAGREES with the table. Banning literals outright
// would demand a 73-file refactor, and a guard that expensive gets disabled;
// this one fails only on an actual contradiction.
const mismatches: string[] = [];
const unverifiable: string[] = [];
for (const f of files) {
  const code = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const literals = [...code.matchAll(/requiredTier\s*=\s*["']([a-z]+)["']/g)].map(m => m[1]);
  if (literals.length === 0) continue;              // already derived
  const keys = [...code.matchAll(/canAccess\(\s*['"]([a-z0-9_]+)['"]/g)].map(m => m[1]);
  const rel = f.replace(`${ROOT}/`, '');
  // Only a 1:1 pairing is unambiguous. Anything else is reported separately
  // rather than guessed at — a wrong accusation is worse than a gap.
  if (keys.length !== 1 || literals.length !== 1) { unverifiable.push(`${rel} (${keys.length} keys, ${literals.length} literals)`); continue; }
  const want = REQUIRED[keys[0]];
  if (want && want !== literals[0]) {
    mismatches.push(`${rel}: gates '${keys[0]}' (${want}) but advertises "${literals[0]}"`);
  }
}

ok(
  'no paywall advertises a different tier than its gate requires',
  mismatches.length === 0,
  mismatches.length === 0 ? undefined :
    `${mismatches.length} contradiction(s) — the user pays for a tier that does not unlock the screen:\n` +
    mismatches.map(o => `        • ${o}`).join('\n') +
    `\n\n      Fix with requiredTier={requiredTierFor('<key>')}.`,
);

// Informational: pairings this guard cannot check. Not a failure, but printed
// so the blind spot is visible rather than silently assumed covered.
if (unverifiable.length > 0) {
  console.log(`  · ${unverifiable.length} screen(s) not auto-verifiable (multiple gates or paywalls):`);
  for (const u of unverifiable.slice(0, 5)) console.log(`      ${u}`);
  if (unverifiable.length > 5) console.log(`      …and ${unverifiable.length - 5} more`);
}

// The helper has to keep existing, or the rule above is unenforceable.
const hook = readFileSync(join(ROOT, 'hooks', 'useTierAccess.ts'), 'utf8');
ok('useTierAccess still exports requiredTierFor', /requiredTierFor/.test(hook),
  'the derivation helper is gone — this guard cannot be satisfied');

// Paywall must tolerate the full union the helper returns, including 'free',
// or callers are pushed back toward casting or hardcoding.
const paywall = readFileSync(join(ROOT, 'components', 'Paywall.tsx'), 'utf8');
ok("Paywall accepts 'free' and renders nothing for it",
  /'free'\s*\|\s*'pro'/.test(paywall) && /requiredTier === 'free'\) return null/.test(paywall),
  'requiredTierFor can return free; if Paywall rejects it, call sites will cast ' +
  'or hardcode again, which is the defect this guard exists to stop');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
