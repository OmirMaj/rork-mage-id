// scripts/validate-startup-deferral.ts — the less important providers load
// after the first screen (IDEAS-1 · SPEED S2), and the timing event is honest
// (S3).
//
//   1. The signal (hooks/useAfterFirstScreen.ts) has the 1500 ms cap and can
//      never stay false forever: past the cap it answers true with no timer,
//      a subscriber armed after the cap is released at once, and once true it
//      stays true.
//   2. Every context that imports useAfterFirstScreen is in DEFERRED_CONTEXTS
//      (utils/startupTiming.ts) and vice versa, and each ANDs it into the
//      `enabled` of every useQuery it runs (its first load), keeping isLoading
//      true while the load waits.
//   3. The core contexts are never deferred: AuthContext, SubscriptionContext
//      (tier gating must be ready on the first screen), ProjectContext,
//      ThemeContext — and the ones the first screen reads: SafetyContext
//      (BrainWatchCard), NotificationContext (MorningBriefCard),
//      PropertyContext (PropertyManagerHome).
//   4. The hook module imports React only (BidsContext is loaded under bun by
//      scripts/validate-w5-rfp-marketplace-feed.ts, which cannot parse
//      react-native).
//   5. utils/startupTiming.ts: the after-interactions path is registered at
//      module load, markFirstUseful releases the signal, sends ONE event per
//      launch with labelled fields (now with phase_<phase> numbers, lane INSTANTOPEN), and
//      never calls the number "cold start".
//
// VALIDATE_ROOT=<dir> points it at a scratch copy of the tree.
// Run: bun run scripts/validate-startup-deferral.ts

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.VALIDATE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}

// ── 1. The signal ────────────────────────────────────────────────────────────
console.log('\n1. the first-screen signal');
const hookSrc = read('hooks/useAfterFirstScreen.ts');
const sig = (await import(join(ROOT, 'hooks/useAfterFirstScreen.ts'))) as typeof import('../hooks/useAfterFirstScreen');
ok('FIRST_SCREEN_CAP_MS is 1500', sig.FIRST_SCREEN_CAP_MS === 1500);

const realNow = Date.now;
try {
  sig.__resetFirstScreenSignalForTests();
  ok('a fresh launch starts false', sig.isFirstScreenShown() === false);
  let fired = 0;
  const unsub = sig.subscribeFirstScreen(() => { fired++; });
  ok('a subscriber is not called before the signal flips', fired === 0);
  const t0 = realNow();
  Date.now = () => t0 + sig.FIRST_SCREEN_CAP_MS + 1;
  ok('past the cap it answers true with no timer having fired', sig.isFirstScreenShown() === true);
  ok('…and the waiting subscriber was released exactly once', fired === 1);
  Date.now = realNow;
  ok('once true it stays true', sig.isFirstScreenShown() === true);
  unsub();

  sig.__resetFirstScreenSignalForTests();
  let early = 0;
  sig.subscribeFirstScreen(() => { early++; });
  sig.releaseFirstScreen();
  sig.releaseFirstScreen();
  ok('releaseFirstScreen releases at once and is idempotent', early === 1 && sig.isFirstScreenShown() === true);

  let late = 0;
  sig.subscribeFirstScreen(() => { late++; });
  ok('a subscriber after the flip is called at once', late === 1);

  // The cap timer: armed late (the module "loaded" 2 s ago) it fires at once.
  sig.__resetFirstScreenSignalForTests();
  const t1 = realNow();
  Date.now = () => t1 + 2000;
  let capped = 0;
  const offCap = sig.subscribeFirstScreen(() => { capped++; });
  Date.now = realNow;
  ok('armed after the cap passed, the subscriber is released without waiting', capped === 1);
  offCap();

  sig.__resetFirstScreenSignalForTests();
  let timed = 0;
  sig.subscribeFirstScreen(() => { timed++; });
  await new Promise((r) => setTimeout(r, sig.FIRST_SCREEN_CAP_MS + 150));
  ok('the cap timer releases a waiting subscriber within FIRST_SCREEN_CAP_MS', timed === 1 && sig.isFirstScreenShown() === true);

  sig.__resetFirstScreenSignalForTests();
  let viaInteractions = 0;
  let scheduled: (() => void) | null = null;
  sig.setAfterInteractionsScheduler((fn) => { scheduled = fn; });
  sig.subscribeFirstScreen(() => { viaInteractions++; });
  (scheduled as (() => void) | null)?.();
  ok('the after-interactions path releases the signal when it runs', viaInteractions === 1);
  sig.setAfterInteractionsScheduler(null);
} finally {
  Date.now = realNow;
  sig.__resetFirstScreenSignalForTests();
}
const hookCode = code(hookSrc);
const hookImports = [...hookCode.matchAll(/^import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
ok('the hook module imports React only (bun-safe for the BidsContext validator)',
  hookImports.length === 1 && hookImports[0] === 'react', hookImports.join(', '));
ok('the hook starts from isFirstScreenShown and subscribes while false',
  /useState<boolean>\(isFirstScreenShown\)/.test(hookCode) && /return subscribeFirstScreen\(\(\) => setShown\(true\)\);/.test(hookCode));

// ── 2. The deferred contexts ─────────────────────────────────────────────────
console.log('\n2. the deferred contexts');
const timingSrc = read('utils/startupTiming.ts');
const timingCode = code(timingSrc);
const listMatch = timingCode.match(/export const DEFERRED_CONTEXTS = \[([^\]]*)\] as const;/);
const DEFERRED = listMatch ? [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
ok('DEFERRED_CONTEXTS is declared in utils/startupTiming.ts and is not empty', DEFERRED.length > 0);

const contextFiles = readdirSync(join(ROOT, 'contexts')).filter((f) => /\.tsx?$/.test(f));
const importers = contextFiles
  .filter((f) => /from '@\/hooks\/useAfterFirstScreen'/.test(code(read(`contexts/${f}`))))
  .map((f) => f.replace(/\.tsx?$/, ''));
ok('the contexts that import useAfterFirstScreen are exactly DEFERRED_CONTEXTS',
  JSON.stringify([...importers].sort()) === JSON.stringify([...DEFERRED].sort()),
  `importers: ${importers.join(', ')} · declared: ${DEFERRED.join(', ')}`);

for (const name of DEFERRED) {
  const file = contextFiles.find((f) => f.replace(/\.tsx?$/, '') === name);
  if (!file) { ok(`${name}: file exists`, false); continue; }
  const src = code(read(`contexts/${file}`));
  ok(`${name}: reads the signal once`, (src.match(/const afterFirstScreen = useAfterFirstScreen\(\);/g) ?? []).length === 1);
  const queries = [...src.matchAll(/useQuery\(\{([\s\S]*?)queryFn:/g)].map((m) => m[1]);
  ok(`${name}: every useQuery ANDs the signal into enabled (its first load waits)`,
    queries.length > 0 && queries.every((head) => /enabled:\s*(?:[^,\n]*&&\s*)?afterFirstScreen\b/.test(head)),
    `${queries.length} useQuery; heads: ${queries.map((h) => h.replace(/\s+/g, ' ').trim()).join(' | ')}`);
  ok(`${name}: isLoading stays true while the first load waits (a deferred read is not an empty one)`,
    /const isLoading = \w+\.isLoading \|\| \(!afterFirstScreen && \w+\.data === undefined\);/.test(src));
}

// ── 3. Never deferred ────────────────────────────────────────────────────────
console.log('\n3. never deferred');
const NEVER = ['AuthContext', 'SubscriptionContext', 'ProjectContext', 'ThemeContext', 'SafetyContext', 'NotificationContext', 'PropertyContext'];
for (const name of NEVER) {
  const file = contextFiles.find((f) => f.replace(/\.tsx?$/, '') === name);
  if (!file) { ok(`${name} exists`, false); continue; }
  const src = code(read(`contexts/${file}`));
  ok(`${name} does not import useAfterFirstScreen and is not in DEFERRED_CONTEXTS`,
    !/useAfterFirstScreen/.test(src) && !DEFERRED.includes(name));
}

// ── 5. The measurement ───────────────────────────────────────────────────────
console.log('\n4. utils/startupTiming.ts');
ok('shares the hook module\'s signal (no second copy)',
  /from '@\/hooks\/useAfterFirstScreen'/.test(timingCode) && !/let firstScreenShown/.test(timingCode));
ok('registers InteractionManager.runAfterInteractions as the after-interactions path at module load',
  /^setAfterInteractionsScheduler\(\(fn\) => \{\s*InteractionManager\.runAfterInteractions\(/m.test(timingCode));
ok('markFirstUseful releases the signal first, then records once per launch',
  /export function markFirstUseful\(screen: string, opts\?: \{ restoredFromDevice\?: boolean \}\): void \{\s*releaseFirstScreen\(\);\s*if \(firstUsefulRecorded\) return;\s*firstUsefulRecorded = true;/.test(timingCode));
ok('the event is app_first_screen with ms, basis, platform, screen, restored_from_device, deferred_count',
  /FIRST_SCREEN_EVENT = 'app_first_screen'/.test(timingCode)
  && /ms,\s*basis: clock\.basis,\s*platform: Platform\.OS,\s*screen,\s*restored_from_device: restored,\s*deferred_count: DEFERRED_CONTEXTS\.length,/.test(timingCode)
  && /track\(FIRST_SCREEN_EVENT, props\);/.test(timingCode));
ok('ms is an integer', /const ms = Math\.max\(0, Math\.round\(clock\.now - clock\.start\)\);/.test(timingCode));
ok('the three bases are labelled bundle_start / js_module / navigation_start',
  /'bundle_start' \| 'js_module' \| 'navigation_start'/.test(timingCode));
ok('never labels the number "cold start" in code or event names', !/cold[_ ]?start/i.test(timingCode));

// Lane INSTANTOPEN: the ONE event also carries the boot phases (only the ones
// that happened this launch). No new event; the pure half is table-tested in
// scripts/validate-boot-gate.ts.
ok('the event carries the phases as flat phase_<phase> numbers (bootPhaseProps: only phases that happened), right after deferred_count',
  /deferred_count: DEFERRED_CONTEXTS\.length,\s*\.\.\.bootPhaseProps\(bootMarks\),\s*\};/.test(timingCode));
ok('still exactly ONE analytics call in the module (no new event)', (timingCode.match(/\btrack\(/g) ?? []).length === 1);
ok('markBootPhase(phase: BootPhase) is exported and first-call-wins',
  /export function markBootPhase\(phase: BootPhase\): void \{\s*if \(bootMarks\[phase\] !== undefined\) return;/.test(timingCode));
ok('first_useful is recorded with the event\'s own ms', /recordBootPhase\(bootMarks, 'first_useful', ms\)/.test(timingCode));
{
  const gateSrc = code(read('utils/bootGate.ts'));
  ok('the phase summary in utils/bootGate.ts never says "cold start" either', !/cold[_ ]?start/i.test(gateSrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
