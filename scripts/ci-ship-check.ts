// scripts/ci-ship-check.ts — run the WHOLE ship gate and report EVERY failure.
//
// WHY THIS EXISTS, AND WHY CI CANNOT JUST CALL `bun run ship-check`.
//
// `ship-check` is 250 links joined with `&&`. That operator is correct for a
// human at a terminal — you fix the first thing and re-run — and wrong for CI,
// for two independent reasons.
//
//   1. IT WOULD NEVER RUN ANYTHING. The FIRST link is `bun run
//      test:release-keys`, and that guard is RED BY DESIGN: eas.json carries
//      `rcb_sb_…` (a RevenueCat *sandbox* Web Billing key) in both release
//      profiles, and it stays red until the founder pastes the production key.
//      `&&` short-circuits, so a workflow that shells out to ship-check would
//      die in about two seconds having executed exactly one guard, forever.
//      The check would be permanently red. A permanently-red check is
//      indistinguishable from no check inside a week — you train yourself to
//      scroll past the X — which is strictly worse than the nothing this repo
//      had before, because it looks like coverage.
//
//   2. IT REPORTS ONE FAILURE PER PUSH. `&&` stops at the first non-zero exit.
//      With 250 links, a branch with four unrelated breakages costs four
//      pushes and four full CI runs to enumerate. The developer bisects his own
//      repo by commit. He needs the whole list, once.
//
// So this runner executes each link as its OWN child process, collects all of
// them, and exits non-zero at the end if anything that is not a declared
// known-red failed.
//
// ── THE PARITY RULE: THIS MUST NEVER RUN A SUBSET ───────────────────────────
//
// `validate-guard-coverage.ts` asserts that every scripts/validate-*.ts is
// transitively reachable from the `ship-check` chain, and today it reports
// "245 validators, all enforced". The obvious way to wreck that is to give CI
// its own hand-written list of things to run: guard-coverage would keep
// reporting "all enforced" about a chain nobody executes, while CI quietly ran
// 180 of them. That is this repo's signature bug — 83 guards were green while
// the code they protected was deleted — dressed up as a build script.
//
// The defence is structural, not disciplinary: this file has NO list. It
// parses `scripts["ship-check"]` out of package.json and runs exactly what is
// there, in order. There is no way to add a check to the gate without CI
// picking it up, and no way to drop one from CI without dropping it from the
// gate that guard-coverage reads. On top of that, and belt-and-braces:
//
//   • a link that is not a plain `bun run <script>` is a HARD FAILURE, never a
//     skip — an unparseable chain must not silently shrink the run;
//   • the runner re-walks the chain to disk itself and fails if any
//     scripts/validate-*.ts would go unexecuted, so a bug in the parser is
//     caught here rather than being reported as a green build;
//   • the number of results is reconciled against the number of parsed links
//     before the exit code is decided;
//   • REQUIRED_LINKS names the four links the coverage walk is structurally
//     BLIND to (typecheck, lint, test:smoke, test:cpm — none is backed by a
//     scripts/validate-*.ts) and the run dies at startup if any is missing.
//     Without it, all three of the deletable ones were PROVEN removable with a
//     green exit 0 over a repo that neither compiled nor linted. See the
//     comment on REQUIRED_LINKS.
//
// ── KNOWN-RED IS A RATCHET, NOT A MUTE BUTTON ───────────────────────────────
//
// See KNOWN_RED below. The short version: an entry does not silence a guard,
// it PINS ITS EXACT FAILURE. The guard still runs, still prints, and the run
// still fails if it fails in any way other than the one recorded — or if it
// starts passing, which means the entry is stale and must be deleted — or if
// its `reviewBy` date has passed, because an exemption nothing ever re-reads
// is a mute button with extra steps.
//
// Usage:
//   bun run ci                    # everything, parallel, as CI runs it
//   CI_JOBS=1 bun run ci          # serial, for when parallelism is suspect
//
// Run via: bun run ci   (scripts/ci-ship-check.ts)

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'ship-check';

// ───────────────────────────────────────────────────────────────────────────
// Per-check wall-clock ceilings. A hung child must fail, not hang the job.
//
// TWO numbers, because one number was wrong. `test:smoke` was measured across
// four runs ON THIS MACHINE at 32.9s / 95.9s / 125.3s / 146.5s — a 4.4x spread
// on identical hardware, because jest's own worker pool competes with whatever
// the OS is doing. A 4-vCPU runner multiplies that again. A 600s ceiling is not
// "generous" against a 146s observation; it is roughly 4x, which is inside the
// noise this check has already demonstrated. Blowing it produces verdict
// 'fail' — a FALSE RED on main, which is the disease this whole runner exists
// to avoid, and the tempting cure (a retry) is how a false red becomes an
// ignored red.
//
// So: a normal ceiling for the pure validators, which run in seconds, and a
// much larger one for the EXCLUSIVE checks that manage their own concurrency.
// ───────────────────────────────────────────────────────────────────────────
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const EXCLUSIVE_TIMEOUT_MS = 25 * 60 * 1000;

/** Tail of a failing check's output reproduced in the summary block. */
const FAIL_TAIL_LINES = 40;

// ───────────────────────────────────────────────────────────────────────────
// EXCLUSIVE — checks that run with nothing else in flight.
//
// NOT a performance knob. `test:smoke` is jest, which spawns its OWN worker
// pool (cpus-1) and whose 655 tests mount real React Native screens behind
// `waitFor` deadlines. Nesting that pool inside this one oversubscribes the
// box, the renders miss their deadlines, and the suite fails on a PARTIAL
// render — measured 2026-09-12: `polish-copy-honesty › badges gated rows`
// failed inside a 4-job run and passed, twice, on its own.
//
// That is a FALSE RED, and a false red is the same disease as a permanent red:
// it teaches you that the X does not mean anything and that the fix is to hit
// re-run. The check itself is not weakened here — it runs in full, with every
// assertion — it just does not have to fight three other processes for a CPU.
//
// Anything that manages its own concurrency belongs in this set. Being merely
// SLOW does not: slow checks are exactly what the pool is for.
// ───────────────────────────────────────────────────────────────────────────
const EXCLUSIVE = new Set<string>(['test:smoke']);

// ───────────────────────────────────────────────────────────────────────────
// REQUIRED — links that must be IN the chain, because nothing else notices
// when they leave.
//
// THIS CLOSES A HOLE THAT WAS PROVEN, NOT IMAGINED. The dark-validator walk
// below scans script bodies for `scripts/validate-*.ts`, so it can only ever
// notice a MISSING VALIDATOR. Exactly four links in the chain are not backed
// by a validate-*.ts — `typecheck` (tsc), `lint` (expo lint), `test:smoke`
// (jest) and `test:cpm` (scripts/test-cpm.ts) — and every one of them could be
// deleted from `scripts["ship-check"]` without a single guard objecting.
//
// Measured 2026-09-13, on this tree: with `bun run typecheck && `,
// `bun run lint && ` and `bun run test:cpm && ` cut out of the chain, this
// runner started up and announced
//
//     246 checks · 4 at a time · 245 validators on disk, all reachable
//
// with no complaint — over a repo that would neither compile nor lint —
// and `test:guard-coverage` stayed green inside the same run, still reporting
// "all enforced" about a chain that no longer type-checked anything.
//
// That is precisely this repo's signature failure — a guard that is green
// while the thing it protects is gone — reimplemented in the build script that
// was supposed to end it. Hence a hard, named list, checked at startup in the
// same style as the stray/dupe/missing-script deaths below.
//
// This list is short ON PURPOSE. It is not "the important checks"; the whole
// chain is the important checks. It is the specific set that the structural
// coverage walk is BLIND to. Anything backed by a scripts/validate-*.ts is
// already covered by that walk and must NOT be added here.
// ───────────────────────────────────────────────────────────────────────────
const REQUIRED_LINKS = ['typecheck', 'lint', 'test:smoke', 'test:cpm', 'test:check-config'] as const;

// ───────────────────────────────────────────────────────────────────────────
// GENERATED, GITIGNORED type files that `typecheck` silently needs.
//
// Both are produced by scripts/ci-generate-expo-types.sh (a workflow step) and
// neither is in git. Without `.expo/types/router.d.ts`, tsc stops checking
// route strings and SAYS NOTHING about it — measured: a bogus
// `router.push('/definitely-not-a-real-route')` is 1 error with the file and 0
// errors without it. Without `expo-env.d.ts`, tsc fails with two errors that
// exist on nobody's machine.
//
// So the absence of either is a green-over-unchecked-code condition, and this
// runner refuses to produce a verdict without them rather than reporting a
// weaker typecheck as a pass.
// ───────────────────────────────────────────────────────────────────────────
const REQUIRED_GENERATED = ['expo-env.d.ts', '.expo/types/router.d.ts'] as const;

// ───────────────────────────────────────────────────────────────────────────
// THE CHILD ENVIRONMENT — a local run must reproduce CI, not the laptop.
//
// `bun run` auto-loads the repo-root `.env`, which is gitignored and holds the
// developer's real EXPO_PUBLIC_* credentials. Forwarding that to the children
// makes `bun run ci` on a laptop and `bun run ci` on a runner two different
// test suites.
//
// This is not hypothetical. Measured 2026-09-12: with `.env` present,
// __tests__/smoke/polish-copy-honesty.tsx fails — the real
// EXPO_PUBLIC_REVENUECAT_IOS_API_KEY makes SubscriptionContext actually
// configure ("[RC] RevenueCat configured successfully") and the free-tier
// screen it renders no longer carries the BUSINESS badge the test asserts. On
// a GitHub runner there is no `.env`, the key is absent, and the same suite is
// green. So the laptop would have shown a red that CI never shows — which is
// the same lie as a green that hides a break, just pointed the other way.
//
// HOW IT IS DONE, AND HOW IT WAS DONE WRONG. The first version of this deleted
// the `.env`-named variables from the INHERITED environment handed to each
// child, and printed "N variable(s) named in .env removed from the child env".
// That claim was FALSE, and provably so: every child is `bun run <script>`, and
// `bun` RE-READS `.env` from the cwd on startup. Deleting a name from the
// inherited env only guaranteed that bun would put it straight back. Measured
// 2026-09-13 with a byte-equivalent replica of that code — the child printed
// `RC_IOS=PRESENT OW=PRESENT`. The runner was announcing CI parity it was not
// enforcing, which is the same class of lie as a green build over a break.
//
// IT TAKES TWO MECHANISMS, BECAUSE THERE ARE TWO LOADERS. This was measured
// the hard way — the first correct-looking fix was still half inert.
//
//   1. `bun --env-file=/dev/null` suppresses BUN's automatic dotfile load.
//      Measured on bun 1.3.14: `RC_IOS=absent OW=absent`, while an explicitly
//      exported `MYVAR=hello` still arrives — so the inherited environment is
//      preserved and only the auto-loaded dotfiles are gone. This covers the
//      246 plain `bun run scripts/validate-*.ts` children.
//
//   2. `EXPO_NO_DOTENV=1` suppresses @expo/env's SEPARATE load. `typecheck`,
//      `lint` and `test:smoke` run through the Expo toolchain, and
//      node_modules/@expo/env reads `.env.local` and `.env` off disk ITSELF —
//      bun's flag is invisible to it. Proven: under `--env-file=/dev/null`,
//      `require('@expo/env').load(cwd)` printed
//      `env: load .env.local .env` and the key came back PRESENT. So the
//      three most important checks in the chain were still running on the
//      developer's credentials. @expo/env honours EXPO_NO_DOTENV (its
//      build/index.js:71); with it set, the same probe reports absent.
//
// THIS FIXED A REAL RED, NOT A THEORETICAL ONE. With only mechanism 1, a full
// clean run was `250 checks · 248 passed · 1 failed`, and the failure was
// `polish-copy-honesty › badges gated rows`: the developer's real
// EXPO_PUBLIC_REVENUECAT_IOS_API_KEY reached jest through @expo/env,
// SubscriptionContext logged "[RC] RevenueCat configured successfully", and the
// free-tier Discover screen rendered its rows without the BUSINESS/PRO badges
// the test asserts. With mechanism 2 added the suite logs "[RC] No ios API key
// configured — RevenueCat disabled" and passes — which is what a runner, with
// no .env at all, was always going to do.
//
// (This weakens no guard. No validator in the chain reads an EXPO_PUBLIC_*
// variable — grepped, zero hits; `validate-env-parity.ts` reads eas.json and
// the source tree, never `.env`.)
// ───────────────────────────────────────────────────────────────────────────

//   3. AND THE NAMES STILL HAVE TO BE DELETED FROM THE INHERITED ENV. This is
//      the part that is easy to talk yourself out of once 1 and 2 are in place,
//      and it is the reason a run with 1 and 2 alone STILL failed. THIS RUNNER
//      IS ITSELF STARTED BY `bun run ci`, so bun loaded `.env` into ITS OWN
//      process before a line of this file executed. `{...process.env}` then
//      hands every one of those variables to the child as an ordinary inherited
//      variable, and no amount of telling bun and Expo not to READ a dotfile
//      removes a variable that is already there. Proven directly:
//      `bun -e 'process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'` → PRESENT.
//
// So the original author's instinct — delete the names — was right, and the
// reviewer's finding that it did nothing was also right. Each is half of it.
// Deleting alone is undone by the two loaders; suppressing the two loaders
// alone is undone by inheritance. All three, or nothing.
// ───────────────────────────────────────────────────────────────────────────

/** Suppresses BUN's automatic dotfile load in every child. */
const NO_DOTENV = '--env-file=/dev/null';

/** Every dotfile either loader would read, in the order they read them. */
const DOTENV_FILES = ['.env', '.env.local', '.env.development', '.env.production']
  .filter(f => existsSync(join(ROOT, f)));

/** Every variable NAME any of those files defines. */
const DOTENV_NAMES: string[] = (() => {
  const names = new Set<string>();
  for (const f of DOTENV_FILES) {
    try {
      for (const line of readFileSync(join(ROOT, f), 'utf8').split('\n')) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (m) names.add(m[1]);
      }
    } catch { /* unreadable is the same as absent for this purpose */ }
  }
  return [...names].sort();
})();

const CHILD_ENV: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1',
    FORCE_COLOR: '0',
    EXPO_NO_TELEMETRY: '1',
    // Mechanism 2 — the Expo toolchain's own loader.
    EXPO_NO_DOTENV: '1',
  };
  // Mechanism 3 — what bun already put in THIS process before we ran.
  for (const n of DOTENV_NAMES) delete env[n];
  return env;
})();

// ───────────────────────────────────────────────────────────────────────────
// KNOWN RED — the honest answer to a guard that cannot be green yet.
//
// RULES, enforced by code below, not by good intentions:
//
//   1. The guard STILL RUNS and its output is STILL PRINTED. Nothing is
//      skipped. The failure this repo is protecting against (a sandbox key
//      that fails invisibly) stays visible in the log on every single run.
//   2. `expectedFailures` pins the EXACT assertion labels that may fail. The
//      validators print `  ✗ <label>` per failed assertion; this runner
//      extracts those and compares them as a set. If validate-release-keys
//      starts failing for a SECOND reason — someone drops a `sk_test_` into
//      the production profile — the set no longer matches and CI GOES RED.
//      A coarse "this script is allowed to fail" allowlist would have eaten
//      that regression whole. This is the difference between a known defect
//      and a blind spot.
//   3. If the guard PASSES, the run FAILS. That is the ratchet. The day the
//      founder pastes the production key, the next CI run demands that this
//      entry be deleted, and the check can never silently slide back to
//      "allowed to fail" afterwards.
//   4. An entry naming a script that is not in the chain FAILS the run, so a
//      renamed guard cannot leave a dead exemption behind.
//
// WHY NOT JUST FIX IT: the fix is a production RevenueCat Web Billing key,
// which only the founder can mint. Deleting the guard, or weakening it to
// accept `rcb_sb_`, would restore precisely the blindness that let a till that
// cannot ring produce the "0 conversions in 180 days" this business was
// reasoning about. Neither is on the table.
// ───────────────────────────────────────────────────────────────────────────
type KnownRed = {
  /** package.json script name, exactly as it appears in the ship-check chain. */
  script: string;
  /** The `✗ …` assertion labels that are permitted to fail. Set equality. */
  expectedFailures: string[];
  /** Why it is red. */
  why: string;
  /** What makes it green, and who can do it. */
  unblockedBy: string;
  /** When it was accepted as known-red, so age is visible. */
  since: string;
  /**
   * The date this exemption STOPS APPLYING, `YYYY-MM-DD`. Required — there is
   * no default, because a default is how "temporary" becomes permanent.
   *
   * WHY THIS FIELD EXISTS. The ratchet as first written only tightened in two
   * directions: a known-red that starts passing fails the run, and one that
   * fails differently fails the run. It had NO pressure in the third
   * direction — an entry that keeps failing in exactly the recorded way is
   * accepted forever, silently, at zero cost. `since` was printed but never
   * compared to a clock. Nothing capped the count, nothing warned at N days.
   * The only shrink pressure was a human reading the tail of a 250-line log,
   * which is not a mechanism, it is a hope.
   *
   * On expiry the exemption simply STOPS. The guard's failure is then counted
   * as an ordinary failure and CI goes red — deliberately not a startup
   * `die()`, because a run that reports one stale exemption and nothing else
   * is the zero-checks-executed outcome this file exists to prevent. The whole
   * suite still runs, the whole list still prints, and one extra line says the
   * exemption lapsed.
   *
   * Renewing is a one-character edit, and that is the point: it costs a human
   * re-reading a defect that is being tolerated, on a schedule, forever.
   */
  reviewBy: string;
};

/** No more than this many exemptions may exist at once. */
const MAX_KNOWN_RED = 3;

/** `YYYY-MM-DD` → epoch ms at UTC midnight. NaN if malformed. */
function parseISODate(d: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN;
}
const TODAY_MS = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

const KNOWN_RED: KnownRed[] = [
  {
    script: 'test:release-keys',
    // The EXACT failure block, generated from the guard's own output. Every
    // line is pinned: a NEW offending credential adds a line here and CI
    // goes red even though the assertion label is unchanged.
    expectedFailures: [
      'no release profile carries a sandbox or placeholder credential',
      'production.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY = "rcb_sb_nJl…" — RevenueCat sandbox (production is the same prefix without "sb")',
      'preview.env.EXPO_PUBLIC_REVENUECAT_WEB_API_KEY = "rcb_sb_nJl…" — RevenueCat sandbox (production is the same prefix without "sb")',
      'A build made from this profile reaches someone who is not you, and a sandbox credential there fails INVISIBLY — the SDK configures, the screen renders, and only the charge never happens.',
    ],
    why:
      'eas.json carries EXPO_PUBLIC_REVENUECAT_WEB_API_KEY = "rcb_sb_…" in the ' +
      'production and preview profiles. rcb_sb_ is RevenueCat SANDBOX Web Billing. ' +
      'The SDK configures, offerings load, the paywall renders — only the charge ' +
      'never happens, with no error anywhere.',
    unblockedBy:
      'FOUNDER ONLY: mint the production Web Billing key in the RevenueCat ' +
      'dashboard and replace both values in eas.json. Then this guard goes green ' +
      'and CI will fail until this entry is deleted from KNOWN_RED.',
    since: '2026-09-12',
    // 90 days. Long enough that this is not busywork on a founder-blocked item,
    // short enough that it cannot quietly become part of the furniture.
    reviewBy: '2026-12-11',
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Chain parsing. Anything surprising is fatal.
// ───────────────────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scripts = pkg.scripts ?? {};

function die(msg: string): never {
  console.error(`\n✗ ci-ship-check: ${msg}\n`);
  process.exit(1);
}

const chainSrc = scripts[GATE];
if (typeof chainSrc !== 'string') {
  die(`package.json has no "${GATE}" script. The gate was renamed or removed; point GATE at the new one.`);
}

const links = chainSrc.split('&&').map(s => s.trim()).filter(Boolean);
if (links.length === 0) die(`"${GATE}" is empty.`);

const LINK_RE = /^bun run ([A-Za-z0-9:._-]+)$/;
const unparseable = links.filter(l => !LINK_RE.test(l));
if (unparseable.length > 0) {
  die(
    `${unparseable.length} link(s) in "${GATE}" are not a plain \`bun run <script>\` and this ` +
    `runner refuses to guess at them — guessing is how a check silently stops running:\n` +
    unparseable.map(l => `      • ${l}`).join('\n') +
    `\n\n      Either simplify the link in package.json, or teach LINK_RE about it here.`,
  );
}

const names = links.map(l => (LINK_RE.exec(l) as RegExpExecArray)[1]);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
if (dupes.length > 0) die(`"${GATE}" runs these twice: ${[...new Set(dupes)].join(', ')}`);

const missingScripts = names.filter(n => typeof scripts[n] !== 'string');
if (missingScripts.length > 0) {
  die(`"${GATE}" references package.json scripts that do not exist: ${missingScripts.join(', ')}`);
}

// ── belt-and-braces coverage walk ──────────────────────────────────────────
// validate-guard-coverage.ts does this against the chain TEXT. We do it against
// the list this process is actually about to execute, so a parser bug here
// cannot produce a green run over a shrunken suite.
const reachedValidators = new Set<string>();
const seen = new Set<string>();
function walkChain(name: string): void {
  if (seen.has(name)) return;
  seen.add(name);
  const body = scripts[name];
  if (!body) return;
  for (const m of body.matchAll(/scripts\/(validate-[A-Za-z0-9._-]+)\.ts/g)) reachedValidators.add(m[1]);
  for (const m of body.matchAll(/\b(?:bun|npm|yarn|pnpm)\s+run\s+([A-Za-z0-9:._-]+)/g)) walkChain(m[1]);
}
// Walk from the LINKS THIS PROCESS WILL EXECUTE, not from the gate name, so a
// parser bug that dropped links shows up here as missing coverage.
for (const n of names) walkChain(n);

const onDisk = readdirSync(join(ROOT, 'scripts'))
  .filter(f => f.startsWith('validate-') && f.endsWith('.ts'))
  .map(f => f.slice(0, -3))
  .sort();
const dark = onDisk.filter(v => !reachedValidators.has(v));
if (dark.length > 0) {
  die(
    `${dark.length} validator(s) exist on disk but this run would not execute them:\n` +
    dark.map(v => `      • scripts/${v}.ts`).join('\n') +
    `\n\n      CI must not be a way to run a subset while guard-coverage reports "all enforced".`,
  );
}

// ── the four links no coverage walk can see ────────────────────────────────
// See REQUIRED_LINKS above for the measurement that made this necessary.
const missingRequired = REQUIRED_LINKS.filter(r => !names.includes(r));
if (missingRequired.length > 0) {
  die(
    `"${GATE}" no longer runs: ${missingRequired.join(', ')}.\n\n` +
    `      These are the links that NOTHING ELSE notices the loss of. The coverage\n` +
    `      walk above scans for scripts/validate-*.ts, and none of these is one, so\n` +
    `      dropping them from the chain produces a green run over a repo that may\n` +
    `      not compile, lint, or pass a single rendered-screen test — with\n` +
    `      test:guard-coverage still reporting "all enforced".\n\n` +
    `      Put them back in package.json's "${GATE}", or, if a link was genuinely\n` +
    `      renamed, update REQUIRED_LINKS in scripts/ci-ship-check.ts in the same\n` +
    `      commit. Do not just delete the entry.`,
  );
}

// ── the generated type files typecheck silently needs ──────────────────────
// See REQUIRED_GENERATED above. Missing router.d.ts does not fail typecheck —
// it makes typecheck stop checking route strings and say nothing.
const missingGenerated = REQUIRED_GENERATED.filter(f => !existsSync(join(ROOT, f)));
if (missingGenerated.length > 0) {
  die(
    `these generated files are absent, so "typecheck" would run over a SMALLER surface than it does locally:\n` +
    missingGenerated.map(f => `      • ${f}`).join('\n') +
    `\n\n      Both are gitignored and both are produced by:\n` +
    `          sh scripts/ci-generate-expo-types.sh\n\n` +
    `      In CI that is a workflow step before this one. Missing .expo/types/router.d.ts\n` +
    `      does not make typecheck fail — it makes it stop checking every route string\n` +
    `      in 30+ screens and report success. This runner will not call that a pass.`,
  );
}

// ── known-red entries must correspond to real links ────────────────────────
if (KNOWN_RED.length > MAX_KNOWN_RED) {
  die(
    `${KNOWN_RED.length} KNOWN_RED entries, and the cap is ${MAX_KNOWN_RED}. An allowlist that ` +
    `grows one paste at a time stops being a ratchet and becomes a mute button.`,
  );
}
const badDates = KNOWN_RED.filter(k => Number.isNaN(parseISODate(k.since)) || Number.isNaN(parseISODate(k.reviewBy)));
if (badDates.length > 0) {
  die(
    `KNOWN_RED entries with an unparseable since/reviewBy (want YYYY-MM-DD): ` +
    `${badDates.map(k => k.script).join(', ')}. An expiry that cannot be compared to a clock never expires.`,
  );
}
const staleEntries = KNOWN_RED.filter(k => !names.includes(k.script));
if (staleEntries.length > 0) {
  die(
    `KNOWN_RED names ${staleEntries.map(k => k.script).join(', ')}, which "${GATE}" does not run. ` +
    `A renamed or deleted guard must not leave an exemption behind — delete the entry.`,
  );
}
const knownRedBy = new Map(KNOWN_RED.map(k => [k.script, k]));

// ───────────────────────────────────────────────────────────────────────────
// Execution
// ───────────────────────────────────────────────────────────────────────────
type Result = {
  index: number;
  name: string;
  code: number | null;
  timedOut: boolean;
  ms: number;
  output: string;
  /** pass | fail | known-red-as-expected | known-red-drifted | known-red-now-green | exemption-lapsed */
  verdict: 'pass' | 'fail' | 'known-red' | 'known-red-drifted' | 'known-red-fixed' | 'known-red-expired';
  note?: string;
  /**
   * For 'known-red-drifted': the failure lines that are NOT in the pinned
   * fingerprint. This is the one fact the ratchet exists to surface, and it has
   * to travel with the Result — the GitHub annotation and the step-summary
   * table used to be built from firstErrorLine(), which returns the FIRST `✗`
   * line, which for a drifted known-red is always the OLD pinned label. So the
   * most-read surface in the whole run reprinted the known defect at the exact
   * moment a human was being asked to look at a new one.
   */
  added?: string[];
};

/**
 * The failure FINGERPRINT of a validator run.
 *
 * Every validator in this repo prints `  ✗ <label>` per failed assertion, then
 * indents the detail beneath it. The fingerprint is the label line PLUS those
 * detail lines, trimmed.
 *
 * WHY THE DETAIL LINES AND NOT JUST THE LABEL. validate-release-keys reports
 * every offending credential under ONE assertion. Pinning the label alone would
 * mean a second bad key — say `sk_test_…` pasted into the production profile —
 * lands inside an already-known-red assertion and changes nothing this runner
 * can see. The known-red entry would have quietly become a blind spot over a
 * whole class of credential, which is the exact shape of bug this repo keeps
 * shipping. Pinning the block makes the new line visible and turns CI red.
 *
 * The cost is that rewording a failure message makes the entry drift and CI
 * demands the entry be updated. That is the correct direction to be brittle in:
 * it asks a human to re-read a defect that is being tolerated.
 */
function failureFingerprint(output: string): string[] {
  const lines = output.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)✗\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    // The trailing "✗ validate-foo: N failure(s)" epilogue is a summary, not an
    // assertion — it starts with the script's own name and is not pinned.
    if (/^validate-[A-Za-z0-9._-]+:/.test(m[2])) continue;
    out.push(m[2]);
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') break;
      const lead = l.length - l.trimStart().length;
      if (lead <= indent) break;                       // back out to sibling level
      if (/^\s*[✓✗]\s/.test(l)) break;                 // next assertion
      out.push(l.trim());
      i = j;
    }
  }
  return out;
}

function runOne(index: number, name: string): Promise<Result> {
  const started = Date.now();
  const limit = EXCLUSIVE.has(name) ? EXCLUSIVE_TIMEOUT_MS : CHECK_TIMEOUT_MS;
  return new Promise<Result>(resolve => {
    // `detached: true` puts the child in its OWN PROCESS GROUP, which matters
    // only on the timeout path — and matters a lot there. `test:smoke` is jest,
    // which spawns a worker pool; those workers INHERIT this pipe. SIGKILLing
    // the jest parent alone leaves the workers alive holding stdout open, and
    // 'close' — which is what settles this promise — waits for the pipes to
    // close. The promise would never settle and the whole job would sit there
    // until GitHub's 30-minute timeout, with no output explaining why. Killing
    // the negated pid takes the group.
    const child = spawn('bun', [NO_DOTENV, 'run', name], {
      cwd: ROOT,
      env: CHILD_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let buf = '';
    let timedOut = false;
    let settled = false;
    const cap = (chunk: Buffer) => { buf += chunk.toString(); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);

    const done = (code: number | null, output: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(finish(index, name, code, timedOut, Date.now() - started, output));
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
      catch { child.kill('SIGKILL'); }
      // Belt and braces: if 'close' still does not arrive within 10s — an
      // orphaned grandchild we could not reach is holding the pipe — settle
      // anyway. A hung runner reports nothing at all; a reported timeout at
      // least names the check.
      const reaper: unknown = setTimeout(
        () => done(null, buf + '\n[ci-ship-check] killed on timeout; stdio never closed'), 10_000);
      // Node hands back a Timeout with .unref(); the DOM lib types this as a
      // number. Do not let the reaper itself hold the process open.
      (reaper as { unref?: () => void }).unref?.();
    }, limit);

    child.on('error', err => done(1, `failed to spawn: ${String(err)}`));
    child.on('close', code => done(code, buf));
  });
}

function finish(
  index: number, name: string, code: number | null, timedOut: boolean, ms: number, output: string,
): Result {
  const known = knownRedBy.get(name);
  const passed = code === 0 && !timedOut;
  const limitS = (EXCLUSIVE.has(name) ? EXCLUSIVE_TIMEOUT_MS : CHECK_TIMEOUT_MS) / 1000;

  if (!known) {
    return {
      index, name, code, timedOut, ms, output,
      verdict: passed ? 'pass' : 'fail',
      note: timedOut ? `timed out after ${limitS}s` : undefined,
    };
  }

  // The exemption has a shelf life. Past it, the entry simply stops applying:
  // a still-failing guard is an ordinary failure again. Note that a guard that
  // has started PASSING is handled below and reported as stale regardless of
  // date — that is the more useful message of the two.
  if (!passed && parseISODate(known.reviewBy) < TODAY_MS) {
    const overdue = Math.round((TODAY_MS - parseISODate(known.reviewBy)) / 86_400_000);
    return {
      index, name, code, timedOut, ms, output,
      verdict: 'known-red-expired',
      note:
        `its KNOWN_RED exemption lapsed on ${known.reviewBy} (${overdue} day(s) ago) and no longer applies.\n` +
        `        Still blocked by: ${known.unblockedBy}\n` +
        `        Either land the fix, or re-read the defect and push reviewBy out in ` +
        `scripts/ci-ship-check.ts — deliberately a human decision, on a schedule.`,
    };
  }

  if (passed) {
    return {
      index, name, code, timedOut, ms, output,
      verdict: 'known-red-fixed',
      note: 'it PASSES now — delete its KNOWN_RED entry in scripts/ci-ship-check.ts',
    };
  }

  const actual = failureFingerprint(output).sort();
  const expected = [...known.expectedFailures].sort();
  const same = actual.length === expected.length && actual.every((a, i) => a === expected[i]);
  if (same) {
    return { index, name, code, timedOut, ms, output, verdict: 'known-red', note: known.why };
  }
  const added = actual.filter(a => !expected.includes(a));
  const gone = expected.filter(e => !actual.includes(e));
  return {
    index, name, code, timedOut, ms, output,
    verdict: 'known-red-drifted',
    added,
    note:
      'it is failing differently than KNOWN_RED records, so this is NOT the known defect:\n' +
      (added.length ? added.map(a => `        NEW failure:  ✗ ${a}`).join('\n') + '\n' : '') +
      (gone.length ? gone.map(g => `        no longer failing: ✗ ${g}`).join('\n') + '\n' : '') +
      (timedOut ? '        (the check timed out)\n' : ''),
  };
}

/**
 * One line that says what went wrong, for the GitHub annotation and the summary
 * table. Three shapes have to be covered, because getting this wrong means the
 * annotation at the top of the run page says "see the job log", which is the
 * same as having no annotation:
 *   • validators   →  `  ✗ <assertion>`
 *   • tsc          →  `app/foo.tsx(636,23): error TS2339: …`
 *   • eslint / bun →  `error: script "lint" exited with code 1`
 * Falls back to the last non-empty line rather than to a shrug.
 */
function firstErrorLine(output: string): string {
  const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
  const hit = lines.find(l => /^✗/.test(l) || /\berror\b\s*(TS\d+)?\s*:/.test(l) || /\): error /.test(l));
  return (hit ?? lines[lines.length - 1] ?? 'no output').slice(0, 400);
}

const MARK: Record<Result['verdict'], string> = {
  'pass': '✓',
  'fail': '✗',
  'known-red': '●',
  'known-red-drifted': '✗',
  'known-red-fixed': '✗',
  'known-red-expired': '✗',
};

/** Every verdict that must turn the run red. */
const FAILING: ReadonlySet<Result['verdict']> =
  new Set<Result['verdict']>(['fail', 'known-red-drifted', 'known-red-fixed', 'known-red-expired']);

/**
 * The one line the GitHub annotation and the summary table carry.
 *
 * For a DRIFTED known-red this must be the NEW line, not firstErrorLine(): the
 * first `✗` in that output is by definition the pinned label, so building the
 * annotation from it reprinted the known defect and hid the drift — the exact
 * fact the block-level fingerprint was built to expose, dropped on the most
 * visible surface in the run.
 */
function headline(f: Result): string {
  if (f.verdict === 'known-red-fixed') {
    return 'this guard PASSES now — delete its KNOWN_RED entry in scripts/ci-ship-check.ts';
  }
  if (f.verdict === 'known-red-expired') {
    return `KNOWN_RED exemption lapsed — re-read the defect or land the fix: ${firstErrorLine(f.output)}`;
  }
  if (f.verdict === 'known-red-drifted') {
    const added = f.added ?? [];
    return added.length > 0
      ? `known-red guard failing for a NEW reason: ✗ ${added.join(' · ✗ ')}`
      : `known-red guard no longer fails as recorded (a pinned failure disappeared): ${firstErrorLine(f.output)}`;
  }
  return firstErrorLine(f.output);
}

const width = String(links.length).length;
const nameWidth = Math.min(42, Math.max(...names.map(n => n.length)));

function progressLine(r: Result): string {
  const idx = `[${String(r.index + 1).padStart(width)}/${links.length}]`;
  const secs = `${(r.ms / 1000).toFixed(1)}s`.padStart(7);
  const tail =
    r.verdict === 'known-red' ? '  known red (expected — see KNOWN_RED)' :
    r.verdict === 'known-red-fixed' ? '  KNOWN-RED ENTRY IS STALE' :
    r.verdict === 'known-red-drifted' ? '  KNOWN RED, BUT FAILING DIFFERENTLY' :
    r.verdict === 'known-red-expired' ? '  KNOWN-RED EXEMPTION HAS LAPSED' :
    r.verdict === 'fail' ? '  FAILED' : '';
  return `  ${MARK[r.verdict]} ${idx} ${r.name.padEnd(nameWidth)} ${secs}${tail}`;
}

async function main(): Promise<void> {
  const jobsEnv = Number(process.env.CI_JOBS);
  const jobs = Number.isFinite(jobsEnv) && jobsEnv > 0
    ? Math.floor(jobsEnv)
    : Math.max(1, Math.min(4, availableParallelism()));

  console.log('');
  console.log(`ci-ship-check — every link of "${GATE}", each in its own process.`);
  console.log(`  ${links.length} checks · ${jobs} at a time · ${onDisk.length} validators on disk, all reachable`);
  console.log(`  run alone (own worker pool): ${[...EXCLUSIVE].join(', ')}`);
  console.log(`  required links present: ${REQUIRED_LINKS.join(', ')}`);
  console.log(
    DOTENV_FILES.length > 0
      ? `  ${DOTENV_NAMES.length} var(s) from ${DOTENV_FILES.join(', ')} deleted from the child env, and both loaders ` +
        `disabled (bun ${NO_DOTENV}, EXPO_NO_DOTENV=1) so neither refills them — this is what CI sees, which is nothing`
      : `  no dotfiles present; children still run with \`bun ${NO_DOTENV}\` and EXPO_NO_DOTENV=1`,
  );
  for (const k of KNOWN_RED) {
    const days = Math.round((parseISODate(k.reviewBy) - TODAY_MS) / 86_400_000);
    console.log(
      `  known-red: ${k.script} (pinned, still executed) — since ${k.since}, ` +
      (days < 0 ? `EXEMPTION LAPSED ${-days} day(s) ago and no longer applies` : `expires ${k.reviewBy} in ${days} day(s)`),
    );
  }
  console.log('');

  const stray = [...EXCLUSIVE].filter(n => !names.includes(n));
  if (stray.length > 0) {
    die(`EXCLUSIVE names ${stray.join(', ')}, which "${GATE}" does not run — delete the entry.`);
  }

  const t0 = Date.now();
  const results: (Result | undefined)[] = new Array(links.length);
  let nextToStart = 0;
  let nextToPrint = 0;

  // Results are printed in CHAIN ORDER even though they finish out of order:
  // a deterministic log is worth holding back at most `jobs - 1` lines, and the
  // hold is bounded by the slowest check in flight.
  const drain = () => {
    while (nextToPrint < links.length && results[nextToPrint]) {
      console.log(progressLine(results[nextToPrint] as Result));
      nextToPrint++;
    }
  };

  // Scheduler. Chain order in, chain order out, with a barrier around the
  // EXCLUSIVE checks: an exclusive check waits for the pool to drain, then runs
  // with nothing else started until it finishes.
  let running = 0;
  let exclusiveInFlight = false;
  await new Promise<void>(resolve => {
    const pump = (): void => {
      while (nextToStart < links.length) {
        if (exclusiveInFlight) break;
        const i = nextToStart;
        const exclusive = EXCLUSIVE.has(names[i]);
        if (exclusive && running > 0) break;   // let the pool drain first
        if (running >= jobs) break;
        nextToStart++;
        running++;
        if (exclusive) exclusiveInFlight = true;
        void runOne(i, names[i]).then(r => {
          results[i] = r;
          drain();
          running--;
          if (exclusive) exclusiveInFlight = false;
          pump();
        });
        if (exclusive) break;                  // nothing starts alongside it
      }
      if (nextToStart >= links.length && running === 0) resolve();
    };
    pump();
  });
  drain();

  const elapsed = (Date.now() - t0) / 1000;

  // Reconcile: nothing may have been dropped between parse and execution.
  const done = results.filter((r): r is Result => !!r);
  if (done.length !== links.length) {
    die(`parsed ${links.length} links but only collected ${done.length} results — refusing to report a verdict.`);
  }

  const failures = done.filter(r => FAILING.has(r.verdict));
  const knownRed = done.filter(r => r.verdict === 'known-red');
  const passed = done.filter(r => r.verdict === 'pass');

  // ── failure detail ───────────────────────────────────────────────────────
  if (failures.length > 0) {
    console.log('');
    console.log('═'.repeat(78));
    console.log(`  ${failures.length} FAILING CHECK(S) — output below, newest detail last`);
    console.log('═'.repeat(78));
    for (const f of failures) {
      console.log('');
      console.log(`── ${f.name} ${'─'.repeat(Math.max(0, 74 - f.name.length))}`);
      if (f.note) console.log(`   ${f.note.trim()}`);
      const lines = f.output.split('\n').filter(l => l.trim() !== '');
      const tail = lines.slice(-FAIL_TAIL_LINES);
      if (lines.length > tail.length) console.log(`   … ${lines.length - tail.length} earlier line(s) omitted`);
      for (const l of tail) console.log(`   ${l}`);
    }
  }

  // ── GitHub annotations: these surface at the TOP of the run page ─────────
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const f of failures) {
      console.log(`::error title=${f.name} failed::${headline(f).replace(/[\r\n]+/g, ' ').slice(0, 400)}`);
    }
    writeStepSummary({ failures, knownRed, passed, total: links.length, elapsed, jobs });
  }

  // ── the last thing on screen: the list of names ──────────────────────────
  console.log('');
  console.log('═'.repeat(78));
  console.log(
    `  ${links.length} checks · ${passed.length} passed · ${failures.length} failed` +
    `${knownRed.length ? ` · ${knownRed.length} known-red` : ''} · ${elapsed.toFixed(0)}s (${jobs} jobs)`,
  );
  if (failures.length > 0) {
    console.log('');
    console.log('  FAILED:');
    for (const f of failures) {
      const suffix =
        f.verdict === 'known-red-fixed' ? '   ← now PASSES; delete its KNOWN_RED entry' :
        f.verdict === 'known-red-drifted' ? '   ← known-red guard failing for a NEW reason' :
        f.verdict === 'known-red-expired' ? '   ← KNOWN_RED exemption lapsed; it no longer applies' : '';
      console.log(`    • ${f.name}${suffix}`);
      console.log(`        bun run ${f.name}`);
    }
  }
  if (knownRed.length > 0) {
    console.log('');
    console.log('  KNOWN RED (ran, failed exactly as recorded, does not gate):');
    for (const k of knownRed) {
      const e = knownRedBy.get(k.name) as KnownRed;
      console.log(`    • ${k.name} — since ${e.since}, exemption expires ${e.reviewBy}`);
      console.log(`        unblocked by: ${e.unblockedBy}`);
    }
  }
  console.log('═'.repeat(78));
  console.log('');

  process.exit(failures.length > 0 ? 1 : 0);
}

function writeStepSummary(s: {
  failures: Result[]; knownRed: Result[]; passed: Result[];
  total: number; elapsed: number; jobs: number;
}): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const L: string[] = [];
  L.push(s.failures.length === 0 ? '## ✅ ship gate green' : `## ❌ ship gate: ${s.failures.length} failing`);
  L.push('');
  L.push(`\`${s.total}\` checks · **${s.passed.length}** passed · **${s.failures.length}** failed` +
    `${s.knownRed.length ? ` · ${s.knownRed.length} known-red` : ''} · ${s.elapsed.toFixed(0)}s at ${s.jobs} jobs`);
  L.push('');
  if (s.failures.length > 0) {
    L.push('### Failing');
    L.push('');
    L.push('| check | reproduce locally | first error |');
    L.push('|---|---|---|');
    for (const f of s.failures) {
      const first = headline(f).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').slice(0, 160);
      L.push(`| \`${f.name}\` | \`bun run ${f.name}\` | ${first} |`);
    }
    L.push('');
    for (const f of s.failures) {
      L.push(`<details><summary><code>${f.name}</code> output</summary>`);
      L.push('');
      L.push('```');
      L.push(f.output.split('\n').filter(l => l.trim()).slice(-FAIL_TAIL_LINES).join('\n'));
      L.push('```');
      L.push('');
      L.push('</details>');
      L.push('');
    }
  }
  if (s.knownRed.length > 0) {
    L.push('### Known red — ran, failed exactly as recorded, does not gate');
    L.push('');
    for (const k of s.knownRed) {
      const e = knownRedBy.get(k.name) as KnownRed;
      L.push(`- **\`${k.name}\`** (since ${e.since}, exemption expires ${e.reviewBy}) — ${e.why}`);
      L.push(`  - _Unblocked by:_ ${e.unblockedBy}`);
      L.push(`  - _If it goes green, CI fails until the entry is deleted from \`scripts/ci-ship-check.ts\`._`);
    }
    L.push('');
  }
  try { appendFileSync(path, L.join('\n') + '\n'); } catch { /* summary is a nicety, never a gate */ }
}

void main();
