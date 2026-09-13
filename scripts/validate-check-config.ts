// validate-check-config.ts — the three checks that are not guards can be made
// VACUOUS from their config files, and nothing noticed.
//
// WHY THIS EXISTS. 245 validators in this repo assert on source text and pure
// functions, and `test:guard-coverage` asserts that every one of them runs. Not
// one of them asserts anything about the configuration of the three checks that
// are not validators:
//
//   • `typecheck`  → tsc --noEmit, configured by tsconfig.json
//   • `lint`       → expo lint,    configured by eslint.config.js
//   • `test:smoke` → jest,         configured by jest.config.js
//
// Grepped 2026-09-13: exactly two validators mention "tsconfig" at all
// (validate-edge-typecheck, validate-plan-sheet-privacy) and neither asserts on
// include / exclude / strict. ZERO mention jest.config, testMatch,
// testPathIgnorePatterns or eslint.config.
//
// So every one of these produced a fully green ship gate over unchecked code:
//
//   • add "app/**/*" to tsconfig.json's `exclude`   → EXECUTED. With
//     app/zz-ci-proof.ts containing `export const ZZ_PROOF: number = "not a
//     number";` on disk, `bun run typecheck` — the literal command the gate
//     runs — EXITED 0. Every screen and every typed route string in app/ goes
//     unchecked, silently.
//   • set "strict": false                            → same shape, wider blast radius.
//   • narrow jest's `testMatch` to ONE suite        → EXECUTED. 26 suites
//     become 1, 655 tests become 27, and `bun run test:smoke` EXITS 0. (Going
//     all the way to zero suites does exit 1 — so the dangerous edit is the
//     partial one, which is also the one that looks reasonable in a diff.)
//   • set an eslint rule to "off"                    → the rule stops existing.
//
// This is the repo's signature bug one level up: not a guard that is green
// while its subject is deleted, but a CHECK that is green while its subject is
// excluded. The CI workflow is what makes it urgent — before CI, a vacuous
// typecheck was a lie told to one developer; after CI it is a green tick on a
// pull request.
//
// ── HOW IT CHECKS: RESOLVED BEHAVIOUR, NOT CONFIG TEXT ─────────────────────
//
// Asserting on the text of tsconfig.json would be worth very little. `exclude`
// is not the only way to shrink the file set — `include`, `files`, `extends`,
// and a stray `tsconfig.json` in a subdirectory all do it, and a text
// assertion catches exactly the one spelling it was written against.
//
// So each tool is asked what it RESOLVED, and the answer is asserted against a
// floor:
//
//   • `tsc --showConfig`   emits the fully expanded `files` array (1.2s).
//   • `jest --listTests`   emits the suite paths testMatch actually matched (1.7s).
//   • `eslint --print-config <file>` emits the merged rule set for a real
//     source file (1.4s).
//
// FLOORS, NOT EQUALITY. The counts below are deliberately set under today's
// numbers: normal churn — adding screens, deleting a stale util — must not turn
// this red, because a guard that cries wolf on ordinary work gets its numbers
// bumped without being read, which is how a ratchet dies. What the floors do
// catch is the only interesting case: a whole directory or a whole rule
// vanishing from what the tool looks at.
//
// Run via: bun run test:check-config

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

/** Run a tool and hand back stdout, or null with the reason recorded. */
function capture(label: string, cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !r.stdout) {
    check(label, false,
      `\`${cmd} ${args.join(' ')}\` exited ${r.status ?? 'null'}. This guard cannot verify what it ` +
      `cannot run, and a guard that skips itself when a tool misbehaves is a dark guard.\n      ` +
      (r.stderr || String(r.error ?? '')).split('\n').slice(0, 6).join('\n      '));
    return null;
  }
  return r.stdout;
}

console.log('\ncheck config (typecheck / lint / test:smoke cannot be made vacuous):');

// ───────────────────────────────────────────────────────────────────────────
// 1. TYPECHECK — what does tsc actually look at?
// ───────────────────────────────────────────────────────────────────────────
// Directory floors. Today's resolved counts (2026-09-13) in the comment; the
// floor is roughly two thirds of each, which no ordinary refactor crosses and
// no exclusion survives.
const TS_DIR_FLOOR: Record<string, number> = {
  app: 130,          // 203 today — every screen and route
  components: 150,   // 228
  utils: 280,        // 420
  hooks: 30,         // 45
  contexts: 10,      // 15
  constants: 12,     // 19
  scripts: 165,      // 251 — the validators type-check themselves
};
const TS_TOTAL_FLOOR = 800;   // 1227 today
const TS_BELLWETHERS = ['./app/_layout.tsx', './types/index.ts', './lib/supabase.ts'];

const tscOut = capture('tsc reports its resolved configuration', 'npx', ['tsc', '-p', 'tsconfig.json', '--showConfig']);
if (tscOut) {
  type Resolved = { compilerOptions?: Record<string, unknown>; files?: string[] };
  let cfg: Resolved | null = null;
  try { cfg = JSON.parse(tscOut) as Resolved; } catch { /* handled below */ }

  if (!cfg) {
    check('tsc --showConfig emits parseable JSON', false, 'Could not parse the output as JSON.');
  } else {
    const files = cfg.files ?? [];
    const opts = cfg.compilerOptions ?? {};

    check('tsconfig has "strict": true',
      opts.strict === true,
      `strict resolved to ${JSON.stringify(opts.strict)}. Without it, tsc stops reporting the null and ` +
      `undefined bugs that are most of what it is for, and every file it reads still "passes".`);

    for (const flag of ['noImplicitAny', 'strictNullChecks']) {
      check(`tsconfig resolves ${flag} on`,
        opts[flag] !== false,
        `${flag} is explicitly false, which switches off part of strict from underneath it.`);
    }

    check(`tsc type-checks at least ${TS_TOTAL_FLOOR} files`,
      files.length >= TS_TOTAL_FLOOR,
      `it resolved ${files.length}. A drop this large means an include/exclude/extends change removed a ` +
      `whole region of the repo from the typecheck, which reports success over every file it no longer reads.`);

    const byDir: Record<string, number> = {};
    for (const f of files) {
      const seg = f.split('/')[1];
      if (seg) byDir[seg] = (byDir[seg] ?? 0) + 1;
    }
    for (const [dir, floor] of Object.entries(TS_DIR_FLOOR)) {
      const n = byDir[dir] ?? 0;
      check(`tsc reads at least ${floor} files under ${dir}/`,
        n >= floor,
        `it resolved ${n}. Excluding ${dir}/ is invisible to every other guard in this repo: ` +
        `\`bun run typecheck\` exits 0 and the ship gate goes green over unchecked code.`);
    }

    const fileSet = new Set(files);
    for (const b of TS_BELLWETHERS) {
      check(`tsc reads ${b}`, fileSet.has(b),
        `not in the resolved file list. Something excluded it, and tsc will not mention that it is not looking.`);
    }

    // The generated, gitignored files that make the typecheck mean what it
    // means locally. Without .expo/types/router.d.ts, typed routes silently
    // stop being checked — measured: a bogus router.push() is 1 error with the
    // file and 0 errors without it.
    check('tsc reads the generated typed-route declarations (.expo/types/**)',
      files.some(f => f.startsWith('./.expo/types/')),
      `.expo/types/router.d.ts is absent from the resolved list. It is generated and gitignored — run\n` +
      `      sh scripts/ci-generate-expo-types.sh. Without it every route string in 30+ screens is unchecked ` +
      `and tsc says nothing about it.`);
    check('tsc reads expo-env.d.ts',
      fileSet.has('./expo-env.d.ts'),
      'Generated and gitignored; without it typecheck fails on two `hovered` errors that exist on nobody\'s machine.');
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 2. TEST:SMOKE — does jest still match any suites?
// ───────────────────────────────────────────────────────────────────────────
const JEST_SUITE_FLOOR = 20;   // 26 today
const JEST_BELLWETHERS = ['every-route.populated', 'polish-copy-honesty'];

const jestOut = capture('jest reports the suites it would run', 'npx',
  ['jest', '--config', 'jest.config.js', '--listTests']);
if (jestOut) {
  const suites = jestOut.split('\n').map(l => l.trim()).filter(Boolean);
  check(`jest matches at least ${JEST_SUITE_FLOOR} suites`,
    suites.length >= JEST_SUITE_FLOOR,
    `it matched ${suites.length}. Measured: narrowing testMatch to a single suite takes 655 tests down to ` +
    `27 and \`bun run test:smoke\` still EXITS 0. A partial collapse is silent; only a total one is an error.`);
  for (const b of JEST_BELLWETHERS) {
    check(`jest still collects ${b}`,
      suites.some(s => s.includes(b)),
      `no suite path contains "${b}". Either it was renamed, or a config change stopped collecting it.`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. LINT — are the error-level rules still error-level?
// ───────────────────────────────────────────────────────────────────────────
// A rule turned "off" is not a lint failure; it is a lint that no longer looks.
// These are the ones whose absence is a correctness hole rather than a style
// preference — rules-of-hooks in particular is the one that catches the
// conditional useState that jest and tsc both let through.
const REQUIRED_ERROR_RULES = [
  'react-hooks/rules-of-hooks',
  'react/jsx-no-undef',
  'react/jsx-key',
  'no-dupe-keys',
  'no-dupe-args',
  'no-duplicate-case',
  'use-isnan',
  'valid-typeof',
  'import/no-unresolved',
  'expo/no-dynamic-env-var',
];
const ESLINT_ERROR_FLOOR = 25;   // 30 today

const eslintOut = capture('eslint reports its resolved rules for an app file', 'npx',
  ['eslint', '--print-config', 'app/_layout.tsx']);
if (eslintOut) {
  type Cfg = { rules?: Record<string, unknown> };
  let cfg: Cfg | null = null;
  try { cfg = JSON.parse(eslintOut) as Cfg; } catch { /* handled below */ }

  if (!cfg) {
    check('eslint --print-config emits parseable JSON', false, 'Could not parse the output as JSON.');
  } else {
    const rules = cfg.rules ?? {};
    const level = (v: unknown): string => {
      const raw = Array.isArray(v) ? v[0] : v;
      return raw === 2 || raw === 'error' ? 'error' : raw === 1 || raw === 'warn' ? 'warn' : 'off';
    };
    const errorRules = Object.keys(rules).filter(k => level(rules[k]) === 'error');

    check(`eslint keeps at least ${ESLINT_ERROR_FLOOR} rules at error level`,
      errorRules.length >= ESLINT_ERROR_FLOOR,
      `only ${errorRules.length} are errors. \`expo lint\` exits 0 on warnings, so demoting rules to "warn" ` +
      `is indistinguishable from deleting them as far as the ship gate is concerned.`);

    for (const r of REQUIRED_ERROR_RULES) {
      check(`eslint rule ${r} is an error`,
        level(rules[r]) === 'error',
        `it resolved to "${level(rules[r])}". This rule catches a real defect class, not a style preference.`);
    }
  }
}

// eslint's flat-config `ignores` is the other way to make lint vacuous, and it
// does not show up in --print-config. Text assertion is the honest tool here:
// the set is tiny and every addition deserves to be read.
const ESLINT_ALLOWED_IGNORES = ['dist/*'];
try {
  const src = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8');
  const m = /ignores\s*:\s*\[([^\]]*)\]/.exec(src);
  const found = m ? [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map(x => x[1]) : [];
  const unexpected = found.filter(f => !ESLINT_ALLOWED_IGNORES.includes(f));
  check('eslint.config.js ignores nothing beyond the built bundle',
    unexpected.length === 0,
    `it also ignores: ${unexpected.join(', ')}. An entry here removes files from lint entirely and ` +
    `\`expo lint\` still exits 0. If the addition is deliberate, add it to ESLINT_ALLOWED_IGNORES here ` +
    `in the same commit, so it is a decision someone made rather than one that happened.`);
} catch (e) {
  check('eslint.config.js is readable', false, String(e));
}

// ───────────────────────────────────────────────────────────────────────────
// 4. THE WORKFLOW ITSELF — the softeners, and the number in the check name.
// ───────────────────────────────────────────────────────────────────────────
// `continue-on-error: true` or a trailing `|| true` on the gate step turns the
// whole thing into decoration while every tick on the pull request stays
// green. It is one line, it looks like a kindness when a run is flaky, and
// nothing else in this repo would ever notice it.
//
// The job NAME matters for a duller reason: it is the string a reviewer reads
// on the pull request, and it shipped saying "247 validators" when there were
// 245. A static YAML string cannot be derived from package.json, so it is
// asserted against it instead.
const WORKFLOW = '.github/workflows/ship-gate.yml';
try {
  const yml = readFileSync(join(ROOT, WORKFLOW), 'utf8');
  const uncommented = yml.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

  check('the workflow never softens a step',
    !/continue-on-error/.test(uncommented) && !/\|\|\s*true/.test(uncommented),
    `${WORKFLOW} contains continue-on-error or "|| true" outside a comment. Either one makes the ship ` +
    `gate advisory while the pull-request tick stays green — the exact "looks like coverage" state this ` +
    `workflow was written to end.`);

  check('the workflow runs the whole-chain runner, not `bun run ship-check`',
    /run:\s*bun run ci\b/.test(uncommented),
    'The gate step must be `bun run ci`. `bun run ship-check` is the && chain, whose first link is a ' +
    'known-red guard, so it would exit in two seconds having run one check.');

  const chain = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {})['ship-check'] ?? '';
  const linkCount = chain.split('&&').map((x: string) => x.trim()).filter(Boolean).length;
  const nameLine = /^\s*name:\s*(ship-check.*)$/m.exec(uncommented);
  check(`the job name states the real check count (${linkCount})`,
    !!nameLine && nameLine[1].includes(String(linkCount)),
    `the job is named "${nameLine ? nameLine[1] : '(not found)'}" but the chain has ${linkCount} links. ` +
    `That name is the first thing a reviewer reads on a pull request; a stale number there is a small ` +
    `lie told very often.`);
} catch (e) {
  check(`${WORKFLOW} is readable`, false, String(e));
}

console.log('');
if (failures > 0) {
  console.error(`✗ validate-check-config: ${failures} failure(s) — a gate check can be made to look at nothing.\n`);
  process.exit(1);
}
console.log('✓ validate-check-config: typecheck, lint and test:smoke all still look at the code.\n');
