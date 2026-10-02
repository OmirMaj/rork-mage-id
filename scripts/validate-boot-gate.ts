// scripts/validate-boot-gate.ts — the launch curtain stops waiting for the
// project list on a Home landing, and nothing routes on half-loaded routing
// facts (lane INSTANTOPEN, M1-M3).
//
//   1. bootGate truth table (utils/bootGate.ts): every combination of
//      authLoading × routingLoading × projectsLoading × hasSeenOnboarding
//      {null,true,false} × landingPath {'/', '/project-detail', null}.
//      routingReady is never true while auth or the routing reads load or the
//      onboarding flag is unknown; bootstrapping is never false while routing
//      is not ready; the project list is ignored ONLY on a Home landing.
//   2. Boot phase marks: first call wins, a phase that did not happen is
//      absent (never "0"), the summary is in a fixed order and names its basis.
//   3. Source rules: app/_layout.tsx computes `bootstrapping` from bootGate(…)
//      with the `?? projectLoading` fallbacks, the routing effect returns on
//      !gate.routingReady, every phase is marked; ProjectContext's isLoading is
//      byte-identical to before and bootGateLoading covers settings, onboarding,
//      persona and the one-commit lag of their state copies; startupTiming adds
//      `phases` to the ONE existing event and never says "cold start".
//
// VALIDATE_ROOT=<dir> points it at a scratch copy of the tree (planted-mutation
// proof: HOME_LANDING_PATHS = [] or the `!gate.routingReady` check removed
// must fail here).
// Run: bun run scripts/validate-boot-gate.ts

import { readFileSync } from 'node:fs';
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
// Whole-line // comments first (a comment line may contain "/*"), then JSX and
// block comments — the same stripper as validate-w4-auth-invite-fixes.
function code(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const G = (await import(join(ROOT, 'utils/bootGate.ts'))) as typeof import('../utils/bootGate');

// ── 1. The truth table ───────────────────────────────────────────────────────
console.log('\n1. bootGate truth table');
ok('HOME_LANDING_PATHS is exactly [\'/\'] (Home\'s pathname on a phone and on desktop web)',
  JSON.stringify(G.HOME_LANDING_PATHS) === JSON.stringify(['/']), JSON.stringify(G.HOME_LANDING_PATHS));

const BOOLS = [false, true];
const ONBOARDING: (boolean | null)[] = [null, true, false];
const LANDINGS: (string | null)[] = ['/', '/project-detail', null];
let rows = 0;
const bad: string[] = [];
for (const authLoading of BOOLS) for (const routingLoading of BOOLS) for (const projectsLoading of BOOLS)
for (const hasSeenOnboarding of ONBOARDING) for (const landingPath of LANDINGS) {
  rows++;
  const g = G.bootGate({ authLoading, routingLoading, projectsLoading, hasSeenOnboarding, landingPath });
  const label = JSON.stringify({ authLoading, routingLoading, projectsLoading, hasSeenOnboarding, landingPath });
  const expectReady = !authLoading && !routingLoading && hasSeenOnboarding !== null;
  const home = landingPath === '/';
  const expectBoot = !expectReady || (projectsLoading && !home);
  if (g.routingReady !== expectReady) bad.push(`routingReady ${g.routingReady} ≠ ${expectReady} for ${label}`);
  if (g.bootstrapping !== expectBoot) bad.push(`bootstrapping ${g.bootstrapping} ≠ ${expectBoot} for ${label}`);
  if ((authLoading || routingLoading || hasSeenOnboarding === null) && g.routingReady) bad.push(`routes while loading: ${label}`);
  if (!g.routingReady && !g.bootstrapping) bad.push(`curtain lifts before routing is ready: ${label}`);
  if (g.routingReady && projectsLoading && !home && !g.bootstrapping) bad.push(`projects ignored off Home: ${label}`);
}
ok(`all ${rows} rows (2×2×2×3×3) match the rule`, rows === 72 && bad.length === 0, bad.slice(0, 6).join('\n      '));
const homeEarly = G.bootGate({ authLoading: false, routingLoading: false, projectsLoading: true, hasSeenOnboarding: true, landingPath: '/' });
ok('a Home landing with the list still loading lifts the curtain (routing ready)', homeEarly.routingReady && !homeEarly.bootstrapping);
const deepWait = G.bootGate({ authLoading: false, routingLoading: false, projectsLoading: true, hasSeenOnboarding: true, landingPath: '/project-detail' });
ok('a deep link to /project-detail keeps the curtain until the list loads', deepWait.routingReady && deepWait.bootstrapping);
const switching = G.bootGate({ authLoading: false, routingLoading: true, projectsLoading: false, hasSeenOnboarding: true, landingPath: '/' });
ok('an account switch with the new persona still loading: not routing-ready, curtain stays (even on Home)',
  !switching.routingReady && switching.bootstrapping);

// ── 2. Boot phase marks ──────────────────────────────────────────────────────
console.log('\n2. boot phase marks');
const CONTRACT = ['auth_resolved', 'routing_resolved', 'projects_resolved', 'settings_resolved', 'fonts_ready',
  'native_splash_hidden', 'boot_ready', 'splash_done', 'first_useful'];
ok('BOOT_PHASES is exactly the contract\'s nine phases',
  JSON.stringify([...G.BOOT_PHASES].sort()) === JSON.stringify([...CONTRACT].sort()), G.BOOT_PHASES.join(', '));
{
  const marks: Record<string, number> = {};
  ok('recordBootPhase records the first call', G.recordBootPhase(marks, 'auth_resolved', 120.4) && marks.auth_resolved === 120);
  ok('…and a second call for the same phase keeps the first ms',
    !G.recordBootPhase(marks, 'auth_resolved', 999) && marks.auth_resolved === 120);
  ok('a non-finite or negative number is refused (absent, never made up)',
    !G.recordBootPhase(marks, 'boot_ready', Number.NaN) && !G.recordBootPhase(marks, 'boot_ready', -1)
    && !G.recordBootPhase(marks, 'boot_ready', Number.POSITIVE_INFINITY) && marks.boot_ready === undefined);
  ok('an unknown phase name is refused', !G.recordBootPhase(marks, 'cold_start' as never, 5) && !('cold_start' in marks));
}
const table: { marks: Record<string, number>; basis: 'bundle_start' | 'js_module' | 'navigation_start'; want: string }[] = [
  {
    marks: { first_useful: 1700, projects_resolved: 1630, boot_ready: 420, auth_resolved: 120, routing_resolved: 340, settings_resolved: 410 },
    basis: 'bundle_start',
    want: 'auth 120 · routing 340 · settings 410 · projects 1630 · boot_ready 420 · first_useful 1700 (basis bundle_start)',
  },
  {
    marks: { auth_resolved: 0, fonts_ready: 80, native_splash_hidden: 95 },
    basis: 'navigation_start',
    want: 'auth 0 · fonts 80 · native_splash_hidden 95 (basis navigation_start)',
  },
  { marks: {}, basis: 'js_module', want: 'no phases recorded (basis js_module)' },
  {
    marks: { splash_done: 900, first_useful: 1200 },
    basis: 'bundle_start',
    want: 'splash_done 900 · first_useful 1200 (basis bundle_start)',
  },
];
for (const row of table) {
  const got = G.summarizeBootPhases(row.marks, row.basis);
  ok(`summary: ${row.want}`, got === row.want, `got: ${got}`);
}
ok('an absent phase is omitted from the summary, never printed as 0',
  !/\bprojects 0\b/.test(G.summarizeBootPhases({ auth_resolved: 5 }, 'bundle_start'))
  && !/projects/.test(G.summarizeBootPhases({ auth_resolved: 5 }, 'bundle_start')));
{
  const snap = G.bootPhasesSnapshot({ boot_ready: 400, auth_resolved: 100 });
  ok('bootPhasesSnapshot carries only the phases that happened',
    JSON.stringify(snap) === JSON.stringify({ auth_resolved: 100, boot_ready: 400 }), JSON.stringify(snap));
}
{
  const props = G.bootPhaseProps({ routing_resolved: 340, auth_resolved: 120 });
  ok('bootPhaseProps flattens to phase_<phase>: ms, only the phases that happened (analytics props are scalars)',
    JSON.stringify(props) === JSON.stringify({ phase_auth_resolved: 120, phase_routing_resolved: 340 })
    && Object.values(props).every((v) => typeof v === 'number'), JSON.stringify(props));
  ok('bootPhaseProps of nothing is empty (no zeros)', Object.keys(G.bootPhaseProps({})).length === 0);
}
ok('summarizeBootPhases never says "cold start"', !/cold[_ ]?start/i.test(code(read('utils/bootGate.ts'))));
{
  const gateImports = [...code(read('utils/bootGate.ts')).matchAll(/^import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
  ok('utils/bootGate.ts imports nothing (pure, bun-safe)', gateImports.length === 0, gateImports.join(', '));
}

// ── 3. Source rules ──────────────────────────────────────────────────────────
console.log('\n3. source rules');
const LAYOUT = code(read('app/_layout.tsx'));
const navStart = LAYOUT.indexOf('function RootLayoutNav()');
const navEnd = LAYOUT.indexOf("if (navMode === 'loader')", navStart);
const NAV = navStart >= 0 && navEnd > navStart ? LAYOUT.slice(navStart, navEnd) : '';
ok('RootLayoutNav found (up to the loader early return)', NAV.length > 0);
ok('_layout imports bootGate from @/utils/bootGate', /import \{[^}]*\bbootGate\b[^}]*\} from '@\/utils\/bootGate';/.test(LAYOUT));
ok('reads bootGateLoading / projectsLoading / projectsLoaded / settingsLoaded from useProjects() next to isLoading',
  /const \{[^}]*\bisLoading: projectLoading\b[^}]*\} = useProjects\(\);/.test(NAV)
  && /\bbootGateLoading\b/.test(NAV.match(/const \{[^}]*\} = useProjects\(\);/)?.[0] ?? '')
  && /\bprojectsLoading\b/.test(NAV.match(/const \{[^}]*\} = useProjects\(\);/)?.[0] ?? '')
  && /\bprojectsLoaded\b/.test(NAV.match(/const \{[^}]*\} = useProjects\(\);/)?.[0] ?? '')
  && /\bsettingsLoaded\b/.test(NAV.match(/const \{[^}]*\} = useProjects\(\);/)?.[0] ?? ''));
ok('captures the landing path ONCE (a ref seeded from the first render\'s usePathname())',
  /const landingPathRef = useRef<string \| null>\(pathname\);/.test(NAV) && !/landingPathRef\.current = /.test(NAV));
ok('computes the gate from bootGate({ … }) with the `?? projectLoading` fallbacks (mocks without the new fields keep today\'s behaviour)',
  /const gate = bootGate\(\{\s*authLoading,\s*routingLoading: bootGateLoading \?\? projectLoading,\s*projectsLoading: projectsLoading \?\? projectLoading,\s*hasSeenOnboarding,\s*landingPath: landingPathRef\.current,\s*\}\);/.test(NAV));
ok('`bootstrapping` comes from the gate (and feeds setBootReady / rootNavPresentation unchanged)',
  /const bootstrapping = gate\.bootstrapping;/.test(NAV)
  && /setBootReady\(!bootstrapping\)/.test(NAV)
  && /rootNavPresentation\(navStateRef\.current, \{\s*bootstrapping,/.test(NAV));
ok('the old three-way bootstrapping expression is gone',
  !/authLoading \|\| projectLoading \|\| hasSeenOnboarding === null/.test(NAV));
const routingEffect = NAV.match(/useEffect\(\(\) => \{\s*if \(([^)]*(?:\)[^)]*)*?)\) return;\s*const sessionJustEnded/);
ok('the routing effect returns on !gate.routingReady (and while the curtain stands, so it never routes with no Stack mounted)',
  /useEffect\(\(\) => \{\s*if \(!gate\.routingReady \|\| bootstrapping\) return;\s*const sessionJustEnded/.test(NAV),
  routingEffect ? routingEffect[1] : 'routing effect early return not found');
const routingDeps = NAV.match(/router\.replace\('\/\(tabs\)\/\(home\)' as any\);\s*return;\s*\}\s*\}, \[([^\]]*)\]\);/);
ok('…and its deps follow the gate, not the project list',
  !!routingDeps && /\bgate\.routingReady\b/.test(routingDeps[1]) && /\bbootstrapping\b/.test(routingDeps[1])
  && !/\bprojectLoading\b/.test(routingDeps[1]) && !/\bauthLoading\b/.test(routingDeps[1]),
  routingDeps ? routingDeps[1] : 'deps not found');
// The claim-crew replay keeps its full wait (validate-w5-join-screens-wiring
// pins it): it reads a stash only once EVERYTHING has settled, so it can never
// run while the loader stands in for the Stack.
ok('the claim-crew replay still waits for every boot read (unchanged)',
  /if \(authLoading \|\| projectLoading \|\| !isAuthenticated \|\| userRole !== null \|\| claimReplayRef\.current\) return;/.test(NAV));
ok('the raw project-loading flag gates nothing else in RootLayoutNav',
  (NAV.match(/\bprojectLoading\b/g) ?? []).length === 5, `${(NAV.match(/\bprojectLoading\b/g) ?? []).length} uses`);
const phaseEffect = NAV.match(/React\.useLayoutEffect\(\(\) => \{([^}]*markBootPhase\('auth_resolved'\)[^}]*)\}, \[([^\]]*)\]\);/);
ok('ONE layout effect in RootLayoutNav marks auth / routing / projects / settings (before Home\'s passive markFirstUseful in the same commit)',
  !!phaseEffect
  && /if \(!authLoading\) markBootPhase\('auth_resolved'\);/.test(phaseEffect[1])
  && /if \(gate\.routingReady\) markBootPhase\('routing_resolved'\);/.test(phaseEffect[1])
  && /if \(!authLoading && \(projectsLoading \?\? !projectsLoaded\) === false\) markBootPhase\('projects_resolved'\);/.test(phaseEffect[1])
  && /if \(!authLoading && settingsLoaded\) markBootPhase\('settings_resolved'\);/.test(phaseEffect[1])
  && (LAYOUT.match(/markBootPhase\('(auth|routing|projects|settings)_resolved'\)/g) ?? []).length === 4);
// Review fix round 1: before auth resolves, ProjectContext runs a signed-out
// pass (['projects', null], settings owner 'signed-out') that settles from
// the device in milliseconds. First-wins would lock that in as this account's
// number, below auth_resolved. Every projects/settings mark must sit behind
// !authLoading, and projects must read the per-key query flag first (the
// sticky projectsLoaded copy survives a key switch).
{
  const marks = phaseEffect ? phaseEffect[1].split('\n').filter((l) => /markBootPhase\('(projects|settings)_resolved'\)/.test(l)) : [];
  ok('projects_resolved / settings_resolved are never marked while auth is loading (no signed-out-pass number)',
    marks.length === 2 && marks.every((l) => /if \(!authLoading && /.test(l)), marks.join(' | '));
  ok('projects_resolved reads the per-key query flag, not the sticky projectsLoaded copy alone',
    marks.some((l) => /\(projectsLoading \?\? !projectsLoaded\) === false/.test(l)) && !marks.some((l) => /\|\| projectsLoaded\)/.test(l)));
}
ok('boot_ready is marked where setBootReady(true) fires',
  /useEffect\(\(\) => \{\s*setBootReady\(!bootstrapping\);\s*if \(!bootstrapping\) markBootPhase\('boot_ready'\);\s*\}, \[bootstrapping\]\);/.test(NAV));
const ROOT_LAYOUT = LAYOUT.slice(Math.max(0, LAYOUT.indexOf('function RootLayout()')));
ok('fonts_ready is marked when the fonts are in',
  /useEffect\(\(\) => \{\s*if \(fontsLoaded\) markBootPhase\('fonts_ready'\);\s*\}, \[fontsLoaded\]\);/.test(ROOT_LAYOUT));
ok('native_splash_hidden is marked inside hideNativeSplash',
  /const hideNativeSplash = useCallback\(\(\) => \{[\s\S]{0,400}?markBootPhase\('native_splash_hidden'\);[\s\S]{0,200}?\}, \[\]\);/.test(ROOT_LAYOUT));
ok('splash_done is marked in handleBrandSplashDone',
  /const handleBrandSplashDone = useCallback\(\(\) => \{\s*markBootPhase\('splash_done'\);\s*setBrandSplashDone\(true\);\s*\}, \[\]\);/.test(ROOT_LAYOUT));
ok('_layout imports markBootPhase from @/utils/startupTiming, still the FIRST import (stamps JS start)',
  /^import \{ markBootPhase \} from '@\/utils\/startupTiming';/m.test(LAYOUT)
  && LAYOUT.indexOf("import { markBootPhase } from '@/utils/startupTiming';") === LAYOUT.search(/^import /m));

const PC = code(read('contexts/ProjectContext.tsx'));
ok('ProjectContext isLoading is byte-identical to before (every other consumer keeps its meaning)',
  /\n    isLoading: projectsQuery\.isLoading \|\| settingsBootLoading \|\| onboardingQuery\.isLoading \|\| userRoleQuery\.isLoading,\n/.test(PC));
ok('the core value type declares bootGateLoading and projectsLoading',
  /type CoreDataValue = \{[\s\S]*?\n  bootGateLoading: boolean;[\s\S]*?\n  projectsLoading: boolean;[\s\S]*?\n\};/.test(PC));
ok('bootGateLoading = settings first read ∪ onboarding ∪ persona ∪ the lag of their state copies',
  /bootGateLoading: settingsBootLoading \|\| onboardingQuery\.isLoading \|\| userRoleQuery\.isLoading \|\| routingFactsLag,/.test(PC)
  && /const routingFactsLag =\s*\(onboardingQuery\.data !== undefined && onboardingQuery\.data !== hasSeenOnboarding\)\s*\|\| \(userRoleQuery\.data !== undefined && userRoleQuery\.data !== userRole\);/.test(PC));
ok('projectsLoading is projectsQuery.isLoading', /\n    projectsLoading: projectsQuery\.isLoading,\n/.test(PC));
const memoDeps = PC.match(/const coreData = useMemo<CoreDataValue>\(\(\) => \(\{[\s\S]*?\}\), \[([^\]]*)\]\);/);
ok('the core memo re-computes on routingFactsLag', !!memoDeps && /\broutingFactsLag\b/.test(memoDeps[1]));

const TIMING = code(read('utils/startupTiming.ts'));
ok('startupTiming exports markBootPhase(phase: BootPhase): void', /export function markBootPhase\(phase: BootPhase\): void \{/.test(TIMING));
ok('startupTiming re-exports BootPhase and summarizeBootPhases from the pure module',
  /export \{[^}]*\bsummarizeBootPhases\b[^}]*\} from '@\/utils\/bootGate';/.test(TIMING)
  && /export type \{[^}]*\bBootPhase\b[^}]*\} from '@\/utils\/bootGate';/.test(TIMING));
ok('markBootPhase keeps the first ms per launch (recordBootPhase) and reads the same clock as markFirstUseful',
  /if \(bootMarks\[phase\] !== undefined\) return;/.test(TIMING)
  && /recordBootPhase\(bootMarks, phase, Math\.max\(0, Math\.round\(clock\.now - clock\.start\)\)\)/.test(TIMING));
ok('on web it also drops a performance.mark(`mage:boot:${phase}`), guarded',
  /if \(Platform\.OS !== 'web'\) return;\s*try \{[\s\S]{0,200}?perf\.mark\(`mage:boot:\$\{phase\}`\)/.test(TIMING) && /typeof [\w.]*mark === 'function'/.test(TIMING));
ok('markFirstUseful records first_useful on the event\'s own ms and adds `phases` to the ONE event',
  /if \(recordBootPhase\(bootMarks, 'first_useful', ms\)\) webPerformanceMark\('first_useful'\);/.test(TIMING)
  && /deferred_count: DEFERRED_CONTEXTS\.length,\s*\.\.\.bootPhaseProps\(bootMarks\),\s*\};/.test(TIMING)
  && (TIMING.match(/track\(/g) ?? []).length === 1);
ok('markFirstUseful logs ONE [boot] line (numbers and phase names only)',
  /console\.info\(`\[boot\] \$\{summarizeBootPhases\(bootMarks, clock\.basis\)\}`\);/.test(TIMING));
ok('the test reset clears the marks', /function __resetStartupTimingForTests\(\): void \{[\s\S]*?for \(const k of Object\.keys\(bootMarks\)\) delete bootMarks\[k as BootPhase\];/.test(TIMING));
ok('never labels the number "cold start"', !/cold[_ ]?start/i.test(TIMING));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
