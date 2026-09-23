// validate-w5-home-screen.ts — audit wave 5, Home (#150, #151, #153, #154,
// #157, #158, and the #142 carry). Each block names the defect it pins.
//
// The pure parts run (voiceUnappliedNote; InlineVoiceFill's voiceFillLines,
// transpiled out of the component because a .tsx screen cannot be imported
// under bun). The screen wiring is read from source, comments stripped, so an
// explanation that QUOTES an old bug cannot satisfy or trip a check.
//
// Run: bun run scripts/validate-w5-home-screen.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  voiceUnappliedNote, formatHeardMoney, buildBurnByProject,
  homeStatusFilterReducer, HOME_STATUS_FILTER_INITIAL,
  type HomeStatusFilterState, type HomeStatusFilterAction,
} from '../utils/projectClone';
import type { ChangeOrder, Invoice, Project } from '../types';

// tsc type-checks scripts against the app's react-native lib set, which has no
// Bun global; the one API used here is declared (same as validate-ai-failure-copy).
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};
// react-test-renderer ships no types here; this is the part used (same as
// validate-time-clock-store).
interface TestRendererInstance { update: (el: unknown) => void; unmount: () => void }
interface TestRendererModule {
  create: (el: unknown) => TestRendererInstance;
  act: (cb: () => Promise<void> | void) => Promise<void>;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Drop whole-line comments and JSX comment blocks. */
const strip = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const HOME = 'app/(tabs)/(home)/index.tsx';
const home = strip(read(HOME));
const ctx = read('contexts/ProjectContext.tsx');

// ── #150 pull-to-refresh re-reads the lists the cards are drawn from ────────
console.log('\n#150 pull-to-refresh:');
{
  // w5-join-screens (CONTRACT 24): the pull is the context's refreshAll — its
  // foreground refetch, which re-reads projects, money, pro docs (daily
  // reports, COs, RFIs, submittals, punch items, permits) and portal lists,
  // bumps the portal epoch and skips the projects re-read while a write is
  // queued. No raw invalidation of ['projects'] / ['invoices'] here.
  const hr = home.slice(home.indexOf('const handleRefresh = useCallback('), home.indexOf('}, [refreshAll', home.indexOf('const handleRefresh = useCallback(')));
  ok('handleRefresh exists and is keyed on refreshAll', hr.length > 0 && /\}, \[refreshAll, user\?\.id, refetchStripe\]\);/.test(home));
  ok('handleRefresh awaits refreshAll() (CONTRACT 24)', /await Promise\.all\(\[refreshAll\(\),/.test(hr));
  ok("handleRefresh does no raw ['projects'] / ['invoices'] invalidation",
    !/invalidateQueries\(\{ queryKey: \['projects'\] \}\)/.test(hr) && !/invalidateQueries/.test(hr) && !/HOME_REFRESH_QUERY_KEYS/.test(home));
  ok('refreshAll is the foreground refetch in ProjectContext', /const refreshAll = refetchAllOnForeground;/.test(ctx));
  for (const need of ['dailyReports', 'changeOrders', 'rfis', 'submittals', 'punchItems', 'permits', 'invoices']) {
    ok(`the foreground refetch re-reads ['${need}']`, new RegExp(`queryKey: \\['${need}', userId\\]`).test(ctx));
  }
  ok("the dead ['daily-reports'] key is gone", !/'daily-reports'/.test(home));
  ok('…and re-asks Stripe (the failed-check row tells him to pull down)',
    /user\?\.id \? refetchStripe\(\) : Promise\.resolve\(\),\s*\]\);/.test(home)
    && /const refetchStripe = stripeStatusQ\.refetch;/.test(home));
  ok('the TODO is gone (the switch landed)', !/TODO\(w5-join-screens\)/.test(read(HOME)));
}

// ── #151 Burn from real invoices, '—' before they load ──────────────────────
console.log('\n#151 burn:');
{
  const row = strip(read('components/ProjectRow.tsx'));
  const card = strip(read('components/ProjectCard.tsx'));
  for (const [name, src] of [['ProjectRow', row], ['ProjectCard', card]] as const) {
    ok(`${name}: no read of the never-written project.invoicedTotal`, !/invoicedTotal/.test(src));
    ok(`${name}: takes invoicedToDate + revisedContract props`,
      /invoicedToDate\?: number;/.test(src) && /revisedContract\?: number;/.test(src));
    ok(`${name}: burn is unknown unless both are known and the contract is > 0`,
      /invoicedToDate != null && revisedContract != null && revisedContract > 0/.test(src));
  }
  ok('ProjectRow prints — when the burn is unknown (never a sourceless 0%)',
    /\{burnRatio != null \? `\$\{burnPct\}%` : '—'\}/.test(row));
  const cloneSrc = strip(read('utils/projectClone.ts'));
  ok('billed-to-date is the shared getInvoicedToDate', /invoicedToDate: getInvoicedToDate\(/.test(cloneSrc));
  ok('divided by the revised contract (getContractValue: estimate + approved COs)',
    /revisedContract: getContractValue\(p, /.test(cloneSrc));
  // w5-join-screens: the context's per-account invoicesLoaded stamp (set with
  // the data) replaces the raw query-cache probe.
  ok('the invoices-read test is the context\'s invoicesLoaded stamp', /const invoicesRead = invoicesLoaded;/.test(home) && /invoicesLoaded: boolean;/.test(ctx));
  ok('home builds the map with the pure buildBurnByProject, with the signed-in user',
    /const burnByProject = useMemo\(\(\) => buildBurnByProject\(\{\s*projects, invoices, changeOrders, userId, invoicesRead, changeOrdersLoaded,\s*\}\), \[[^\]]*\buserId\b[^\]]*\]\);/.test(home));

  // buildBurnByProject, executed.
  const ME = 'u-gc', GC = 'u-other';
  const proj = (id: string, over: Partial<Project> = {}): Project => ({
    id, name: id, type: 'renovation', location: '', squareFootage: 0, quality: 'standard', description: '',
    status: 'in_progress', createdAt: '2026-01-01', updatedAt: '2026-01-01', estimate: null, schedule: null,
    linkedEstimate: { id: 'le', items: [], globalMarkup: 0, baseTotal: 100000, markupTotal: 0, grandTotal: 100000, createdAt: '2026-01-01' },
    ...over,
  } as unknown as Project);
  const inv = (projectId: string, totalDue: number, status: Invoice['status'] = 'sent'): Invoice =>
    ({ id: `i-${projectId}-${totalDue}`, projectId, totalDue, status } as unknown as Invoice);
  const co = (projectId: string, changeAmount: number, status: ChangeOrder['status'] = 'approved'): ChangeOrder =>
    ({ id: `c-${projectId}`, projectId, changeAmount, status } as unknown as ChangeOrder);
  const projects = [
    proj('mine', { ownerUserId: ME }),
    proj('unstamped'),
    proj('shared-editor', { ownerUserId: GC, myRole: 'editor', financialsLoaded: true }),
    proj('shared-viewer', { ownerUserId: GC, myRole: 'viewer', financialsLoaded: true }),
    proj('field', { ownerUserId: ME, myRole: 'field' }),
    proj('unloaded', { ownerUserId: ME, financialsLoaded: false }),
  ];
  const invoices = [inv('mine', 30000), inv('mine', 5000, 'draft'), inv('unstamped', 12500.25)];
  const cos = [co('mine', 20000), co('mine', 999, 'submitted')];
  const full = { projects, invoices, changeOrders: cos, userId: ME, invoicesRead: true, changeOrdersLoaded: true };
  const m = buildBurnByProject(full);
  const mine = m.get('mine');
  ok('his job: non-draft invoices over estimate + APPROVED COs',
    mine?.invoicedToDate === 30000 && mine?.revisedContract === 120000, JSON.stringify(mine));
  ok('an unstamped job (created here) is his and gets a burn, to the cent',
    m.get('unstamped')?.invoicedToDate === 12500.25, JSON.stringify(m.get('unstamped')));
  ok("a job someone else owns (editor / viewer seat) gets NO burn — its invoices and COs aren't on this device",
    !m.has('shared-editor') && !m.has('shared-viewer'));
  ok('a field role and an unloaded job get no burn', !m.has('field') && !m.has('unloaded'));
  ok('nothing before invoices are read', buildBurnByProject({ ...full, invoicesRead: false }).size === 0);
  ok('nothing before change orders are read', buildBurnByProject({ ...full, changeOrdersLoaded: false }).size === 0);
  ok('nothing without a signed-in user', buildBurnByProject({ ...full, userId: null }).size === 0);
  ok('both lists pass the numbers (so memoized rows re-render)',
    (home.match(/invoicedToDate=\{burnByProject\.get\(/g) ?? []).length === 2
    && (home.match(/revisedContract=\{burnByProject\.get\(/g) ?? []).length === 2);
  ok('renderProject re-memoizes on the burn map', /\), \[handleProjectPress, burnByProject\]\);/.test(home));
}

// ── #153 a failed Stripe check is not "not connected" ───────────────────────
console.log('\n#153 Stripe status:');
{
  const q = /const stripeStatusQ = useQuery\(\{([\s\S]*?)\n {2}\}\);/.exec(home)?.[1] ?? '';
  ok('the queryFn is found', q.length > 0);
  ok('!r.success THROWS (react-query retries; no cached false answer)',
    /if \(!r\.success\) throw new Error\(/.test(q));
  ok("no failure is mapped to 'none'", !/r\.success && r\.status\) \? r\.status : 'none'/.test(q) && !/return \{ status: 'none'/.test(q));
  ok('stripeConnected is undefined until an answer exists',
    /const stripeConnected: boolean \| undefined = stripeStatusQ\.data\s*\?\s*stripeStatusQ\.data\.status === 'connected'\s*:\s*undefined;/.test(home));
  ok("the banner still needs an ANSWERED 'none'", /stripeStatusQ\.data\?\.status === 'none'/.test(home));
  const cl = strip(read('components/OnboardingChecklist.tsx'));
  ok('checklist prop accepts unknown', /stripeConnected: boolean \| undefined;/.test(cl));
  ok('the Stripe row is done only on a real true', /done: stripeConnected === true,/.test(cl));
  ok('unknown shows a neutral "Checking…" row while the check runs',
    /pendingLabel: stripeConnected === undefined\s*\? \(stripeCheckFailed \? STRIPE_CHECK_FAILED_LABEL : 'Checking…'\)\s*: undefined,/.test(cl));
  ok('home passes the gave-up state: no answer, errored, nothing fetching',
    /const stripeCheckFailed = stripeStatusQ\.data === undefined && stripeStatusQ\.isError && !stripeStatusQ\.isFetching;/.test(home)
    && /stripeCheckFailed=\{stripeCheckFailed\}/.test(home));
  ok('a check that gave up says so (not "Checking…", never "not connected")',
    /\? \(stripeCheckFailed \? STRIPE_CHECK_FAILED_LABEL : 'Checking…'\)/.test(cl)
    && /export const STRIPE_CHECK_FAILED_LABEL = "Couldn't check Stripe — pull down to refresh";/.test(cl));
  ok('only a running check is announced busy', /busy: !!item\.pendingBusy/.test(cl)
    && /pendingBusy: stripeConnected === undefined && !stripeCheckFailed,/.test(cl));
  ok('a pending row is not tappable and shows no CTA',
    /if \(item\.heldReason \|\| item\.pendingLabel\) return;/.test(cl) && /item\.pendingLabel \? \(/.test(cl));
}

// ── #154 an empty status bucket is not the day-one card ─────────────────────
console.log('\n#154 empty bucket:');
{
  const empty = /ListEmptyComponent=\{([\s\S]*?)\n {8}\}\n/.exec(home)?.[1] ?? '';
  ok('ListEmptyComponent found', empty.length > 0);
  const iErr = empty.indexOf('<ErrorState');
  const iBucket = empty.indexOf(') : projects.length > 0 ? (');
  const iDayOne = empty.indexOf('title="Build something"');
  ok('order: failed read → empty bucket → day-one card', iErr >= 0 && iErr < iBucket && iBucket < iDayOne,
    `${iErr} ${iBucket} ${iDayOne}`);
  const bucket = empty.slice(iBucket, iDayOne);
  ok('the bucket state names the bucket from the shared label map',
    /title=\{`No \$\{STATUS_FILTER_LABEL\[statusFilter\]\.toLowerCase\(\)\} jobs`\}/.test(bucket));
  ok('…says the stage is empty', /message="Nothing in this stage right now\."/.test(bucket));
  ok('…offers "Show all jobs" → All', /actionLabel="Show all jobs"/.test(bucket) && /onAction=\{\(\) => pickStatusFilter\('all'\)\}/.test(bucket));
  ok('…and no create / sample CTAs', !/Create your first project|secondaryLabel|handleSeedDemo|handleCreatePress/.test(bucket));
  ok('the dense header reads the same label map', /\{STATUS_FILTER_LABEL\[statusFilter\]\}/.test(home));
  ok('home drives the filter through the one reducer (no ref, no second effect)',
    /useReducer\(homeStatusFilterReducer, HOME_STATUS_FILTER_INITIAL\)/.test(home)
    && /dispatchStatusFilter\(\{ type: 'data', projectCount: projects\.length, activeCount: statusBuckets\.active\.length \}\);\s*\}, \[projects\.length, statusBuckets\.active\.length\]\);/.test(home)
    && !/autoPickedActiveRef|setStatusFilter\(/.test(home));
  ok('a chip / "Show all jobs" is his pick', /dispatchStatusFilter\(\{ type: 'pick', filter: next \}\);/.test(home));

  // The reducer, executed: the sequence the review replayed.
  const run = (acts: HomeStatusFilterAction[]) => acts.reduce(homeStatusFilterReducer, HOME_STATUS_FILTER_INITIAL);
  const data = (projectCount: number, activeCount: number): HomeStatusFilterAction => ({ type: 'data', projectCount, activeCount });
  ok('no projects yet → stays All and waits', run([data(0, 0)]).filter === 'all' && !run([data(0, 0)]).didAuto);
  ok('6 projects, 1 active → the app picks Active', run([data(0, 0), data(6, 1)]).filter === 'active');
  ok('…and when the last active job closes → back to All', run([data(0, 0), data(6, 1), data(6, 0)]).filter === 'all');
  ok('fewer than 5 projects (no chips) → never auto-picked', run([data(4, 2)]).filter === 'all');
  ok('a bucket HE tapped stays put when it empties',
    run([data(6, 1), { type: 'pick', filter: 'active' }, data(6, 0)]).filter === 'active'
    && run([data(6, 1), { type: 'pick', filter: 'closed' }, data(6, 1)]).filter === 'closed');
  ok('the first-load pick happens once', run([data(6, 0), data(7, 1)]).filter === 'all');
  const steady = run([data(6, 1)]);
  ok('an unchanged state is the same object (React bails out)', homeStatusFilterReducer(steady, data(6, 1)) === steady);

  // And under React's real effect ordering — the ref version passed every
  // source regex yet lost its flag in the commit that set it. Mount the exact
  // wiring home uses (pinned above) and drive 0 → 6 (1 active) → 6 (0 active).
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
    origError(...args);
  };
  const React = await import('react');
  const RTR_SPECIFIER: string = 'react-test-renderer';
  const TestRenderer = (await import(RTR_SPECIFIER)).default as TestRendererModule;
  let seen: HomeStatusFilterState | null = null;
  function Harness({ n, active }: { n: number; active: number }) {
    const [state, dispatch] = React.useReducer(homeStatusFilterReducer, HOME_STATUS_FILTER_INITIAL);
    React.useEffect(() => {
      dispatch({ type: 'data', projectCount: n, activeCount: active });
    }, [n, active]);
    seen = state;
    return null;
  }
  let r!: TestRendererInstance;
  await TestRenderer.act(async () => { r = TestRenderer.create(React.createElement(Harness, { n: 0, active: 0 })); });
  await TestRenderer.act(async () => { r.update(React.createElement(Harness, { n: 6, active: 1 })); });
  const afterLoad = (seen as HomeStatusFilterState | null)?.filter;
  await TestRenderer.act(async () => { r.update(React.createElement(Harness, { n: 6, active: 0 })); });
  const afterClose = (seen as HomeStatusFilterState | null)?.filter;
  await TestRenderer.act(async () => { r.unmount(); });
  console.error = origError;
  ok('mounted: load picks Active', afterLoad === 'active', String(afterLoad));
  ok('mounted: the last active job closing resets to All', afterClose === 'all', String(afterClose));
  ok('tapping a chip clears the auto-pick', /pickStatusFilter\(chip\.key\);/.test(home));
  ok('zero-count chips are dimmed but stay tappable', /chip\.count === 0 && !isActive && styles\.filterChipEmpty/.test(home));
}

// ── #157 voice: examples only name fields the form keeps; unapplied is said ─
console.log('\n#157 voice fill:');
{
  const sug = /suggestions=\{\[([\s\S]*?)\]\}/.exec(home)?.[1] ?? '';
  ok('suggestions found', sug.length > 0);
  ok('no example asks for a budget or a start date', !/budget|thousand|start date|hundred|one fifty/i.test(sug), sug);
  ok('the handler never writes targetBudget', !/setProject\w*\(\s*partial\.targetBudget/.test(home) && !/targetBudget:\s*partial/.test(home));
  ok('the handler reports what it heard but did not keep',
    /const note = voiceUnappliedNote\(partial\.targetBudget, partial\.startDate\);/.test(home));
  ok('a parse that found nothing returns filled:false (no false "Filled from your voice")',
    /if \(!heardSomething\) \{\s*return \{\s*filled: false,/.test(home));
  ok('the nothing-heard note never says "try again" (a cap refusal lands here too — CONTRACT 26)',
    /type them below\.",/.test(home) && !/or try again/.test(home));
  ok("a failed parse does not overwrite the type he picked",
    /if \(partial\.type && heardSomething\) setProjectType\(/.test(home));

  const both = voiceUnappliedNote(150000, '2027-06-01') ?? '';
  ok('budget + start: one line, both named, both destinations',
    both === 'Heard budget $150,000 and start June 1, 2027 — not saved here; set the budget on the estimate and the start date on the schedule.', both);
  ok('money to the cent when there are cents', formatHeardMoney(80000.5) === '$80,000.50' && formatHeardMoney(80000) === '$80,000');
  ok('budget only', voiceUnappliedNote(25000, '') === 'Heard budget $25,000 — not saved here; set it on the estimate.', voiceUnappliedNote(25000, '') ?? '');
  ok('start only', voiceUnappliedNote(0, '2027-01-31') === 'Heard start January 31, 2027 — not saved here; set it on the schedule.', voiceUnappliedNote(0, '2027-01-31') ?? '');
  ok('nothing unapplied → null', voiceUnappliedNote(0, '') === null && voiceUnappliedNote(undefined, undefined) === null);
  ok('a non-calendar start is quoted, not guessed', (voiceUnappliedNote(0, 'next spring') ?? '').includes('start next spring'));
  // A calendar day, never new Date('YYYY-MM-DD') (the previous evening west of UTC).
  const prevTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  ok('the date is the calendar day in a western zone too', (voiceUnappliedNote(0, '2027-06-01') ?? '').includes('June 1, 2027'),
    voiceUnappliedNote(0, '2027-06-01') ?? '');
  process.env.TZ = prevTZ;

  // InlineVoiceFill's outcome rule, executed. The component is .tsx (RN), so
  // the one pure function is transpiled out of it and run.
  const ivf = read('components/InlineVoiceFill.tsx');
  const fnStart = ivf.indexOf('export function voiceFillLines(');
  const constLine = /export const FILLED_LINE = ('[^']*');/.exec(ivf);
  ok('voiceFillLines + FILLED_LINE are found', fnStart >= 0 && !!constLine);
  if (fnStart >= 0 && constLine) {
    const fnEnd = ivf.indexOf('\n}\n', fnStart) + 3;
    const src = `const FILLED_LINE = ${constLine[1]};\n${ivf.slice(fnStart, fnEnd).replace('export function', 'function')}\nexport { voiceFillLines };`;
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(src).replace(/export \{ voiceFillLines \};?/, 'return voiceFillLines;');
    const voiceFillLines = new Function(js)() as (r: unknown) => { filled: string | null; note: string | null };
    const legacy = voiceFillLines(undefined);
    ok('an undefined return keeps today\'s line exactly',
      legacy.filled === 'Filled from your voice — review and edit before saving.' && legacy.note === null, JSON.stringify(legacy));
    ok('a void-ish non-object return is treated as undefined', voiceFillLines(null).filled !== null && voiceFillLines(null).note === null);
    const noted = voiceFillLines({ note: 'Heard budget $1' });
    ok('{ note } keeps the success line and adds the note', noted.filled !== null && noted.note === 'Heard budget $1');
    const none = voiceFillLines({ filled: false, note: 'Nothing heard' });
    ok('only an explicit filled:false drops the success line', none.filled === null && none.note === 'Nothing heard');
    ok('filled:true behaves like undefined', voiceFillLines({ filled: true }).filled !== null);
  }
  const ivfCode = strip(ivf);
  ok('the prop is WIDENED, never narrowed',
    /onTranscript: \(transcript: string\) => void \| VoiceFillOutcome \| Promise<void \| VoiceFillOutcome>;/.test(ivfCode));
  ok('the handler uses the rule and renders the note',
    /const lines = voiceFillLines\(result\);/.test(ivfCode) && /testID="inline-voice-fill-note"/.test(ivfCode));
}

// ── #158 Today on site keeps the whole list and says what is past the cut ───
console.log('\n#158 today on site:');
{
  const memo = /const todayOnSite = useMemo\(\(\) => \{([\s\S]*?)\n {2}\}, \[projects\]\);/.exec(home)?.[1] ?? '';
  ok('todayOnSite memo found', memo.length > 0);
  ok('the memo returns the whole list (no silent slice)', /return out;\s*$/.test(memo) && !/out\.slice\(0, 4\)/.test(memo));
  ok('the list is sorted: most tasks today, then latest update, then name',
    /b\.activeTaskCount - a\.activeTaskCount/.test(memo) && /Date\.parse\(b\.project\.updatedAt\)/.test(memo) && /localeCompare/.test(memo));
  ok('each row carries the full task count', /activeTaskCount: liveTasks\.length,/.test(memo));
  ok('4 rows shown, the rest counted',
    /const todayOnSiteShown = todayOnSite\.slice\(0, TODAY_ON_SITE_ROWS\);/.test(home)
    && /const todayOnSiteHidden = todayOnSite\.length - todayOnSiteShown\.length;/.test(home)
    && /const TODAY_ON_SITE_ROWS = 4;/.test(home));
  ok('a "+N more on site today" row, tappable, with a real label',
    /\+\{todayOnSiteHidden\} more on site today/.test(home) && /testID="today-on-site-more"/.test(home)
    && /accessibilityLabel=\{`\$\{todayOnSiteHidden\} more/.test(home));
  ok('it opens Summary (which lists every job, uncapped)', /router\.push\('\/\(tabs\)\/summary' as never\)/.test(home));
  ok('the last shown row keeps its divider when the more-row follows',
    /\(idx < todayOnSiteShown\.length - 1 \|\| todayOnSiteHidden > 0\) && styles\.todayRowDivider/.test(home));
  ok('a row with more than 3 live tasks says " · +k more"', /moreTasks > 0 \? ` · \+\$\{moreTasks\} more` : ''/.test(home));
}

// ── #142 carry: the warranty walk uses the GC's warranty length ─────────────
console.log('\n#142 warranty walk carry:');
ok('home passes resolveWarrantyMonths(settings) to getUpcomingWarrantyWalks',
  /const warrantyMonths = resolveWarrantyMonths\(settings\);/.test(home)
  && /getUpcomingWarrantyWalks\(projects, warrantyMonths\)/.test(home)
  && /\[projects, warrantyMonths\]/.test(home));
ok('resolveWarrantyMonths is imported, not re-derived', /import \{ resolveWarrantyMonths \} from '@\/utils\/paymentTerms';/.test(home));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
