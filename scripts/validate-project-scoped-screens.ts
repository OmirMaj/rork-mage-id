// validate-project-scoped-screens.ts — stops the project-scoped screens from
// dead-ending again when they are opened with no projectId.
//
// WHY: UX-AUDIT-2026-08-03 #3. Seven core screens — invoice, job-costing,
// daily-report, punch-list, rfi, client-portal-setup, closeout-binder — plus
// schedule-pro are all listed in utils/featureRegistry.ts, which means the
// desktop sidebar, universal search (Cmd-K) and deep links can all push them
// with NO params. Every one of them answered that with an instructional card
// ("No project to cost yet") and a button back to the Projects tab. For a user
// with three in-progress projects that copy is simply false, and the screen has
// no next action — the definition of a dead end in a workflow tool.
// schedule-pro was worse: "No project selected" with a single "Go back".
//
// Meanwhile field-ticket / ai-punch / compare-drawings / extract-submittals had
// already solved it with <ToolProjectPicker> — so the app shipped two answers
// to one question and the worse one sat on the money screens.
//
// This validator pins the fix at SOURCE level, which is the only thing that
// stops the regression: a screen can be edited back to a dead end without any
// test failing unless the guard itself is asserted. Three things are checked
// per screen:
//
//   1. it renders <ToolProjectPicker> (the shared component — not a third
//      hand-rolled picker),
//   2. its picker branch returns EARLY, before any primary content, so the
//      screen can never render its real UI with no project resolved, and
//   3. it distinguishes a STALE id (deleted project / old link) from no id at
//      all, and lets a fresh pick outrank a dead param.
//
// Run: bun run scripts/validate-project-scoped-screens.ts
import { readFileSync } from 'node:fs';
import { FEATURE_REGISTRY } from '../utils/featureRegistry';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

/** The eight screens finding #3 names, plus the two that already did it right.
 *  `param` is the search param each screen reads the project id from —
 *  client-portal-setup uses `id`, everything else uses `projectId`. */
const SCREENS: { file: string; param: string; note: string }[] = [
  { file: 'app/invoice.tsx',             param: 'projectId', note: 'said "No invoice open yet" to a user with unpaid invoices' },
  { file: 'app/job-costing.tsx',         param: 'projectId', note: 'said "No project to cost yet" to a user with three projects' },
  { file: 'app/daily-report.tsx',        param: 'projectId', note: 'said "No daily report open yet"' },
  { file: 'app/punch-list.tsx',          param: 'projectId', note: 'said "No punch list open yet"' },
  { file: 'app/rfi.tsx',                 param: 'projectId', note: 'said "No RFI open yet"' },
  { file: 'app/client-portal-setup.tsx', param: 'id',        note: 'said "No client portal set up yet"' },
  { file: 'app/closeout-binder.tsx',     param: 'projectId', note: 'said "No closeout to deliver yet"' },
  { file: 'app/schedule-pro.tsx',        param: 'projectId', note: 'true dead end — "No project selected" + a lone "Go back"' },
];

/** The reference implementations. If these lose the picker, the pattern the
 *  seven were copied from is gone and the whole rule is unanchored.
 *  budget-dashboard is in here because it used to be the SECOND, hand-rolled
 *  picker — the "two competing patterns" half of the finding. */
const REFERENCE = ['app/field-ticket.tsx', 'app/ai-punch.tsx', 'app/budget-dashboard.tsx'];

const read = (p: string) => readFileSync(p, 'utf8');

// ── Every screen renders the SHARED picker ──────────────────────────────────
console.log(`\nproject-scoped screens (${SCREENS.length} screens):`);
for (const { file, note } of SCREENS) {
  const src = read(file);
  ok(`${file}: renders <ToolProjectPicker>`,
    /<ToolProjectPicker\b/.test(src) && /from '@\/components\/ToolScreenChrome'/.test(src),
    `before the fix it ${note}. Use the shared picker from ` +
      'components/ToolScreenChrome.tsx — do not hand-roll a second one.');
}

for (const file of REFERENCE) {
  ok(`${file}: still the reference picker call site`, /<ToolProjectPicker\b/.test(read(file)),
    'the seven screens copy this file; if it changes shape, update them together');
}

// ── Exactly ONE picker in the app ───────────────────────────────────────────
// Half of finding #3 was that the app shipped two answers to the same question
// and put the worse one on the money screens. A second hand-rolled picker is
// how that comes back, so ban the shape: a screen that says "Pick a project"
// must be delegating to ToolScreenChrome, not painting its own rows.
{
  const hosts = [...SCREENS.map(s => s.file), ...REFERENCE];
  const rogue = hosts.filter(f => {
    const src = read(f);
    return /Pick a project/.test(src) && !/<ToolProjectPicker\b/.test(src);
  });
  ok('no screen hand-rolls a second project picker', rogue.length === 0,
    rogue.length ? `these paint their own picker: ${rogue.join(', ')}` : undefined);
  ok('the picker copy lives in ToolScreenChrome only',
    /Pick a project/.test(read('components/ToolScreenChrome.tsx')),
    'one component owns this string');
}

// ── The picker branch must be an EARLY RETURN, before primary content ───────
// The failure this catches is subtle and real: a screen that renders the picker
// somewhere in the middle of its normal tree still mounts the rest of the tree
// against an undefined project. The guard must short-circuit.
console.log('\nno primary content rendered without a project:');
for (const { file } of SCREENS) {
  const src = read(file);
  const pickerAt = src.indexOf('<ToolProjectPicker');

  // The picker must sit inside a `if (!project…) { return (` block.
  const guardAt = (() => {
    const re = /if\s*\(![A-Za-z]*[Pp]roject\b[^)]*\)\s*\{\s*\n\s*return\s*\(/g;
    let m: RegExpExecArray | null, best = -1;
    while ((m = re.exec(src))) if (m.index < pickerAt && m.index > best) best = m.index;
    return best;
  })();
  ok(`${file}: picker sits inside an early \`if (!project) return\``,
    guardAt !== -1 && pickerAt - guardAt < 1600,
    'the no-project branch must return before anything else renders');

  // …and the screen's real body must come AFTER it. Every one of these screens
  // ends in a single main `return (` for the loaded state; assert at least one
  // exists past the guard so the guard is provably not the last return.
  const bodyAfter = src.slice(pickerAt).search(/\n {2}return \(/);
  ok(`${file}: primary content returns only after the guard`, bodyAfter !== -1,
    'expected the screen body to follow the no-project early return');
}

// ── Stale id is handled, and a pick outranks a dead param ───────────────────
// A deleted project or an old shared link arrives WITH an id that resolves to
// nothing. That is not the same as arriving with no id, and it used to render
// blank. It also breaks the picker unless the local pick wins: `param ?? picked`
// would keep preferring the dead id forever, so the rows would do nothing.
console.log('\nstale / invalid projectId:');
for (const { file, param } of SCREENS) {
  const src = read(file);
  ok(`${file}: passes staleProjectId to the picker`,
    /staleProjectId=\{staleProjectId\}/.test(src) &&
    /const staleProjectId = !project && param(ProjectId|Id) \? param(ProjectId|Id) : undefined;/.test(src),
    'derive it from "the URL carried an id but nothing matched" and pass it through');

  ok(`${file}: a fresh pick outranks a stale param`,
    new RegExp(`const ${param} = pickedProjectId \\?\\? param(ProjectId|Id) \\?\\? '';`).test(src),
    `must be \`pickedProjectId ?? param… ?? ''\` — the other order leaves the ` +
      'picker inert on a dead link, because the bad id keeps winning');

  ok(`${file}: reads the raw param under a distinct name`,
    new RegExp(`${param}: param(ProjectId|Id)`).test(src),
    'shadowing the param lets the rest of the screen keep using the resolved id');
}

// ── The shared picker still behaves ─────────────────────────────────────────
console.log('\nToolProjectPicker contract:');
const chrome = read('components/ToolScreenChrome.tsx');
ok('zero projects offers "Create a project", not an empty picker',
  /projects\.length === 0/.test(chrome) && /actionLabel="Create a project"/.test(chrome),
  'a user with no projects cannot pick one — the honest next action is to make one');
ok('the create action opens the create sheet directly',
  /openCreate: '1'/.test(chrome),
  'app/(tabs)/(home)/index.tsx consumes ?openCreate=1 — dropping the user on an ' +
    'empty Projects list to find the "+" is the same dead end one screen over');
ok('stale ids get their own notice', /staleProjectId \?/.test(chrome) && /testID="tool-picker-stale-notice"/.test(chrome),
  'say the project is gone; do not silently show a picker');
ok('the picker lists real projects', /projects\.map\(p =>/.test(chrome));
ok('picking a project calls back into the host screen', /onPick\(p\.id\)/.test(chrome));

// EmptyState's decorative grid was deleted because the founder does not want
// rules behind an empty state. ToolProjectPicker renders EmptyState, so it must
// not reintroduce one. (validate-visual-regressions.ts pins the primitive; this
// pins the wrapper that every one of these screens now goes through.)
ok('ToolProjectPicker draws no grid/rule backdrop',
  !/grid(Line|Lines|Backdrop|Rule)V?|blueprintGrid|ruledBackdrop/.test(chrome),
  'no grid lines behind any empty state');

// ── schedule-pro's deliberate difference ────────────────────────────────────
// It is the one screen where the picker is NOT the first gate: below
// GRID_BREAKPOINT the grid is unusable, so a phone user is handed the classic
// schedule immediately rather than being made to pick a project and only then
// told to leave. Pin the order, or a later edit "tidying" the early returns
// silently costs the phone user a wasted step.
console.log('\nschedule-pro width gate precedes the picker:');
{
  const src = read('app/schedule-pro.tsx');
  const widthAt = src.indexOf('if (width < GRID_BREAKPOINT)');
  const pickerAt = src.indexOf('<ToolProjectPicker');
  ok('narrow-screen gate runs before the project gate', widthAt !== -1 && widthAt < pickerAt,
    'Schedule Pro is unusable on a phone — redirect to the classic schedule ' +
      'first instead of asking which project to open a screen they cannot use');
  ok('the narrow-screen branch still offers the classic schedule',
    /router\.replace\('\/\(tabs\)\/schedule' as any\)/.test(src));
  ok('the old "Go back"-only dead end is gone',
    !/No project selected/.test(src),
    'that string was the finding — a screen with one button that goes backwards');
}

// ── Registry reconciliation ─────────────────────────────────────────────────
// featureRegistry.ts claims it excludes screens that dead-end without a
// projectId, then listed all eight. That contradiction is only resolved while
// each listed route actually handles the empty case, so assert the link.
console.log('\nfeatureRegistry inclusion rule holds:');
const routeToFile = new Map(SCREENS.map(s => [
  '/' + s.file.replace(/^app\//, '').replace(/\.tsx$/, ''), s.file,
]));
for (const f of FEATURE_REGISTRY) {
  const file = routeToFile.get(f.route);
  if (!file) continue;
  ok(`registry lists ${f.route} (${f.title}) and the screen stands alone`,
    /<ToolProjectPicker\b/.test(read(file)),
    'the registry\'s stated rule is "a destination must stand on its own when ' +
      'pushed with no params" — either give it the picker or delist it');
}
ok('every audited screen is still reachable from the registry',
  SCREENS.every(s => [...routeToFile.keys()].some(r =>
    routeToFile.get(r) === s.file && FEATURE_REGISTRY.some(f => f.route === r))),
  'these are the routes search and the sidebar push with no params');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
