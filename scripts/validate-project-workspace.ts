// validate-project-workspace.ts — the desktop job page is one screen, honest,
// and never reaches the iPhone.
//
// WHY (wave 6c, lane E). On the founder's 1512 x 945 MacBook the job page was
// 3.1 screens tall: 675 px quick-action tiles with a 1,360 px orphan, a
// 1,314 px "Total Estimate" box, TWO different "% complete" numbers, and
// sections in a full-window sheet that dropped him back on the tile grid when
// he opened a record. Lane E made desktop a workspace — header, 8-cell KPI
// strip, one row of quick actions, three overview cards, a section index, and
// sections in a right-docked side panel with ?tile= in the URL — and left the
// phone tree as it was.
//
// Pins:
//   1. RULES — utils/projectWorkspaceLayout, RUN: the KPI cells (money LEFT
//      OUT, not zeroed, for a role without money or an unverified one; "Owed"
//      unknown — never "$0" — with no invoice sent; margin held while the
//      cost streams load), billed %, A/R, the lookahead (no start date says
//      so; done tasks skipped; critical flagged), where each section opens,
//      and the one-screen budget (<= 945; it is 896).
//   2. ONE PROGRESS — computeProjectProgress is the only "% complete" across
//      the job page, ProjectHero, NextStepHero, components/project/* and the
//      pulse; nobody counts done tasks over task count.
//   3. THE SCREEN — the stage table comes from utils/projectStage; no
//      1400 px literal; ?tile= written with router.setParams and followed only
//      on desktop web; the section sheet closes only on a phone; the side
//      panel mounts only on desktop and the sheet only on a phone; the job is
//      made active in an effect; the tutorial's hub.tile./hub.group. targets
//      exist on BOTH trees; the tutorial blocker still lists every visible=;
//      the index's links match the phone's push chain.
//
// Run via: bun run test:project-workspace  (bun scripts/validate-project-workspace.ts)

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ScheduleTask } from '../types';
import {
  INERT_PULSE,
  KPI_LOADING_COSTS,
  KPI_NO_BUDGET,
  KPI_NO_ESTIMATE,
  KPI_NO_INVOICES,
  KPI_NO_SCHEDULE,
  LEGACY_TILE_ROUTES,
  LIST_SECTION_ROUTES,
  NOTHING_STARTS_REASON,
  NO_SCHEDULE_REASON,
  NO_START_DATE_REASON,
  PANEL_SECTION_KEYS,
  SECTION_TITLES,
  WORKSPACE_BUDGET,
  arRowText,
  billedPct,
  buildKpiCells,
  committedRowText,
  desktopTileTarget,
  inPlaceTileForStep,
  isListSection,
  isPanelSection,
  lastReportRowText,
  lookaheadRows,
  noticeToneForStep,
  overdueAR,
  pendingCORowText,
  sectionIndexHref,
  sectionTitle,
  workspaceHeight,
  type ProjectPulse,
} from '../utils/projectWorkspaceLayout';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log('  ✓ ' + name); return; }
  failed++;
  console.error('  ✗ ' + name + (detail ? `\n      ${detail}` : ''));
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const living = (marginPct: number, health: 'healthy' | 'watch' | 'critical') => ({
  hasMarginBasis: true,
  original: { cost: 100_000 },
  projected: { marginPct },
  marginErosionPoints: 0,
  health,
}) as unknown as NonNullable<ProjectPulse['living']>;
const risk = (score: number, band: 'low' | 'moderate' | 'elevated' | 'high', hasBasis = true) =>
  ({ score, band, hasBasis, factors: [], topFactors: [] }) as unknown as NonNullable<ProjectPulse['risk']>;

const FULL: ProjectPulse = {
  ...INERT_PULSE,
  hasProject: true,
  role: 'owner',
  canSeeMoney: true,
  costSourcesReady: true,
  living: living(0.183, 'healthy'),
  risk: risk(22, 'low'),
  progress: { pct: 40, taskCount: 10, doneCount: 4, hasSchedule: true },
  forecastFinish: '2026-11-20',
  contract: { value: 200_000, source: 'signed_contract', approvedCO: 10_000, total: 210_000 },
  invoiced: 84_000,
  owed: 12_000,
  nonDraftInvoiceCount: 3,
  ar: { current: 0, '0-30': 5_000, '31-60': 4_000, '61-90': 2_000, '90+': 1_000, totalOutstanding: 12_000, retainageHeld: 0 },
  openRfis: 3,
  overdueRfis: 1,
  punch: { open: 7, inProgress: 3, readyForReview: 2 },
  pendingCOs: [{ id: 'co1', number: 4, description: 'Add outlet', changeAmount: 1240 }] as ProjectPulse['pendingCOs'],
  pendingCOValue: 1240,
};
const CTX = { projectId: 'p1', onOpenSchedule: () => {} };
const keys = (cells: { key: string }[]) => cells.map(c => c.key);
const cell = (cells: ReturnType<typeof buildKpiCells>, key: string) => cells.find(c => c.key === key);

// ════════════════════════════════════════════════════════════════════════════
console.log('\n1. The KPI strip: eight cells, honest about what it does not know');
{
  const cells = buildKpiCells(FULL, CTX);
  eq('the eight cells, in order', keys(cells), ['contract', 'margin', 'risk', 'billed', 'owed', 'overdue', 'progress', 'open']);
  ok('the six money cells are flagged financial, the last two are not',
    cells.slice(0, 6).every(c => c.financial === true) && cells.slice(6).every(c => !c.financial));
  eq('Contract = the signed contract + approved COs', [cell(cells, 'contract')?.value, cell(cells, 'contract')?.sub], ['$210,000', 'Signed contract']);
  eq('Margin reads the pulse to 1 decimal, toned by health', [cell(cells, 'margin')?.value, cell(cells, 'margin')?.tone], ['18.3%', 'good']);
  eq('Risk band + score', [cell(cells, 'risk')?.value, cell(cells, 'risk')?.sub, cell(cells, 'risk')?.tone], ['Low risk', '22/100', 'good']);
  eq('Billed % of the contract', cell(cells, 'billed')?.value, '40%');
  eq('Owed is money owed, toned warn', [cell(cells, 'owed')?.value, cell(cells, 'owed')?.tone], ['$12,000', 'warn']);
  eq('Overdue A/R sums every past-due bucket; bad when 31+ days', [cell(cells, 'overdue')?.value, cell(cells, 'overdue')?.tone, cell(cells, 'overdue')?.sub], ['$12,000', 'bad', '60+ $3,000']);
  eq('% complete is the pulse progress with the forecast finish', [cell(cells, 'progress')?.value, cell(cells, 'progress')?.sub], ['40%', 'Finish Nov 20']);
  eq('Open: RFIs · punch, the pending CO with its $ for a money role', [cell(cells, 'open')?.value, cell(cells, 'open')?.sub], ['3 RFI · 12 punch', '1 CO pending · $1,240']);
  ok('% complete opens the schedule by the existing push (onPress, no href)', !!cell(cells, 'progress')?.onPress && !cell(cells, 'progress')?.href);
  ok('the money cells link to their screens', ['contract', 'margin', 'risk', 'billed', 'owed', 'overdue'].every(k => !!cell(cells, k)?.href));

  // Left out, not zeroed.
  const field = buildKpiCells({ ...FULL, canSeeMoney: false, role: 'field' }, CTX);
  eq('a role without money gets NO money cells (left out, not zeroed)', keys(field), ['progress', 'open']);
  eq('…and the pending CO without its dollars', cell(field, 'open')?.sub, '1 CO pending');
  const unverified = buildKpiCells({ ...FULL, roleError: true }, CTX);
  eq('an access read that FAILED leaves the money out too', keys(unverified), ['progress', 'open']);
  eq('the inert pulse (no project) shows no money and no guessed progress',
    [keys(buildKpiCells(INERT_PULSE, CTX)), cell(buildKpiCells(INERT_PULSE, CTX), 'progress')?.value, cell(buildKpiCells(INERT_PULSE, CTX), 'progress')?.blockedReason],
    [['progress', 'open'], null, KPI_NO_SCHEDULE]);

  // Unknown is '—' with a reason, never 0.
  const noInv = buildKpiCells({ ...FULL, nonDraftInvoiceCount: 0, owed: 0, invoiced: 0, ar: null }, CTX);
  eq('Owed with no invoice sent is unknown with the reason — never "$0"', [cell(noInv, 'owed')?.value, cell(noInv, 'owed')?.blockedReason], [null, KPI_NO_INVOICES]);
  eq('…and so is Overdue A/R', [cell(noInv, 'overdue')?.value, cell(noInv, 'overdue')?.blockedReason], [null, KPI_NO_INVOICES]);
  ok('no money cell ever prints "$0" for a fact it does not have', noInv.every(c => c.value !== '$0'));
  const loading = buildKpiCells({ ...FULL, costSourcesReady: false }, CTX);
  eq('Margin and Risk are held while crew hours and receipts load', [cell(loading, 'margin')?.value, cell(loading, 'margin')?.blockedReason, cell(loading, 'risk')?.value], [null, KPI_LOADING_COSTS, null]);
  const noBasis = buildKpiCells({ ...FULL, risk: risk(0, 'low', false) }, CTX);
  eq('no budget → no margin, said', [cell(noBasis, 'margin')?.value, cell(noBasis, 'margin')?.blockedReason], [null, KPI_NO_BUDGET]);
  const noContract = buildKpiCells({ ...FULL, contract: { value: 0, source: 'estimate', approvedCO: 0, total: 0 } }, CTX);
  eq('no contract value → Contract unknown ("No estimate yet") and Billed unknown', [cell(noContract, 'contract')?.value, cell(noContract, 'contract')?.blockedReason, cell(noContract, 'billed')?.value], [null, KPI_NO_ESTIMATE, null]);
  const noStart = buildKpiCells({ ...FULL, forecastFinish: null }, CTX);
  eq('a schedule with no finish says so', cell(noStart, 'progress')?.sub, 'No start date set');
  const tones = (b: 'healthy' | 'watch' | 'critical') => cell(buildKpiCells({ ...FULL, living: living(0.1, b) }, CTX), 'margin')?.tone;
  eq('margin tones: healthy→good, watch→warn, critical→bad', [tones('healthy'), tones('watch'), tones('critical')], ['good', 'warn', 'bad']);
  const rt = (b: 'low' | 'moderate' | 'elevated' | 'high') => cell(buildKpiCells({ ...FULL, risk: risk(50, b) }, CTX), 'risk')?.tone;
  eq('risk tones: low→good, moderate/elevated→warn, high→bad', [rt('low'), rt('moderate'), rt('elevated'), rt('high')], ['good', 'warn', 'warn', 'bad']);
  const young = buildKpiCells({ ...FULL, ar: { current: 900, '0-30': 300, '31-60': 0, '61-90': 0, '90+': 0, totalOutstanding: 1200, retainageHeld: 0 } }, CTX);
  eq('only 0-30 days past due → warn, no 60+ line', [cell(young, 'overdue')?.tone, cell(young, 'overdue')?.sub], ['warn', null]);

  // Native tablet: a log is not a screen there — the cell opens the section in place.
  const opened: string[] = [];
  const inPlace = buildKpiCells(FULL, { ...CTX, listLinks: false, onOpenSection: k => opened.push(k) });
  ok('off desktop web the log cells carry no href and open the section in place',
    !cell(inPlace, 'billed')?.href && !cell(inPlace, 'open')?.href && !!cell(inPlace, 'contract')?.href);
  cell(inPlace, 'open')?.onPress?.();
  cell(inPlace, 'owed')?.onPress?.();
  eq('…to the right sections', opened, ['rfis', 'invoices']);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. Money arithmetic and row text');
{
  eq('billedPct: null with no contract (never 0 % of nothing)', [billedPct(500, 0), billedPct(500, -3), billedPct(500, NaN)], [null, null, null]);
  eq('billedPct rounds to a whole percent', [billedPct(0, 1000), billedPct(333, 1000), billedPct(1500, 1000)], [0, 33, 150]);
  eq('overdueAR = 0-30 + 31-60 + 61-90 + 90+ (current is not due)', overdueAR({ '0-30': 1, '31-60': 2, '61-90': 4, '90+': 8 }), 15);
  eq('the A/R row folds 61-90 and 90+ into 60+', arRowText({ '0-30': 5000, '31-60': 4000, '61-90': 2000, '90+': 1000 }), '0-30 $5,000 · 31-60 $4,000 · 60+ $3,000');
  eq('a pending CO row', pendingCORowText({ number: 4, description: 'Add outlet', changeAmount: 1240 }), '#4 Add outlet · $1,240');
  eq('committed: hidden without a budget basis', [committedRowText(null), committedRowText({ committed: 5, budget: 0 })], [null, null]);
  eq('committed vs budget', committedRowText({ committed: 80_000, budget: 120_000 }), 'Committed $80,000 of $120,000 budget');
  eq('no daily report is said', lastReportRowText(null), 'No daily report yet');
  eq('the last report, weather left out when it has none', [
    lastReportRowText({ date: '2026-10-14', conditions: 'Sunny', temperature: '72°', crew: 6 }),
    lastReportRowText({ date: '2026-10-14', conditions: '', temperature: '', crew: 0 }),
  ], ['Last report Oct 14 · Sunny 72° · crew 6', 'Last report Oct 14 · crew 0']);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. The lookahead');
{
  const t = (id: string, startDay: number, durationDays: number, extra: Partial<ScheduleTask> = {}) => ({
    id, title: id.toUpperCase(), phase: '', durationDays, startDay, progress: 0, crew: '', dependencies: [], notes: '',
    status: 'not_started', ...extra,
  }) as unknown as ScheduleTask;
  const NOW = new Date(2026, 9, 5); // Mon 5 Oct 2026, local
  const tasks = [
    t('a', 1, 3),                                   // Oct 1–3: finished in time → out
    t('b', 4, 5, { isCriticalPath: true }),         // Oct 4–8: underway, critical
    t('c', 6, 2, { status: 'done' as ScheduleTask['status'] }), // done → skipped
    t('d', 10, 2),
    t('e', 40, 2),                                  // past the 21-day horizon
    t('f', 11, 1), t('g', 12, 1), t('h', 13, 1), t('i', 14, 1),
  ];
  const la = lookaheadRows(tasks, '2026-10-01', undefined, NOW);
  eq('open tasks in the next 21 days, earliest first, at most 5', la.rows.map(r => r.id), ['b', 'd', 'f', 'g', 'h']);
  ok('done tasks and tasks past the horizon are skipped', !la.rows.some(r => r.id === 'c' || r.id === 'e'));
  ok('the critical path is flagged, and a started task reads underway', la.rows[0].isCriticalPath && la.rows[0].underway && !la.rows[1].isCriticalPath);
  eq('the start label is "Wkd D Mon"', la.rows[0].startLabel, 'Sun 4 Oct');
  eq('no start date: no rows, and the reason', lookaheadRows(tasks, null, undefined, NOW), { rows: [], reason: NO_START_DATE_REASON });
  eq('no tasks: "No schedule yet"', lookaheadRows([], '2026-10-01', undefined, NOW).reason, NO_SCHEDULE_REASON);
  eq('nothing in the window says so', lookaheadRows([t('z', 60, 2)], '2026-10-01', undefined, NOW), { rows: [], reason: NOTHING_STARTS_REASON });
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. Where a section opens, and the one-screen budget');
{
  eq('the list sections are the G/H logs + the punch list', LIST_SECTION_ROUTES,
    { rfis: '/rfi', submittals: '/submittal', changeOrders: '/change-order', invoices: '/invoice', dailyReports: '/daily-report', punchList: '/punch-list' });
  ok('no key is both a log and a side-panel section', Object.keys(LIST_SECTION_ROUTES).every(k => !isPanelSection(k)));
  eq('desktopTileTarget: a log', desktopTileTarget('rfis', 'p1'), { kind: 'route', pathname: '/rfi', params: { projectId: 'p1' } });
  eq('desktopTileTarget: the panel / the legacy push', [desktopTileTarget('photos', 'p1'), desktopTileTarget('plans', 'p1')], [{ kind: 'panel' }, { kind: 'legacy' }]);
  eq('an index row links a log only on desktop web', [sectionIndexHref('rfis', 'p1', true), sectionIndexHref('rfis', 'p1', false)], [{ pathname: '/rfi', params: { projectId: 'p1' } }, null]);
  eq('a screen of its own is always a link, with the param it reads', [sectionIndexHref('plans', 'p1', false), sectionIndexHref('scope', 'p1', true)],
    [{ pathname: '/plans', params: { projectId: 'p1' } }, { pathname: '/project-scope', params: { id: 'p1' } }]);
  eq('a side-panel section and Calendar Feed are buttons', [sectionIndexHref('photos', 'p1', true), sectionIndexHref('calendar', 'p1', true)], [null, null]);
  ok('isListSection / isPanelSection refuse junk', !isListSection('toString') && !isPanelSection('') && !isListSection(undefined));
  eq('sectionTitle: the phone header\'s words, "" for unknown', [sectionTitle('budget'), sectionTitle('aiReport'), sectionTitle('nope'), sectionTitle(null)], ['Financial Health', 'AI Project Report', '', '']);
  ok('every side-panel section has a title', PANEL_SECTION_KEYS.every(k => !!SECTION_TITLES[k]));
  eq('the next step opens in place only for THIS job\'s own page', [
    inPlaceTileForStep({ pathname: '/project-detail', params: { id: 'p1', tile: 'rfis' } }, 'p1'),
    inPlaceTileForStep({ pathname: '/project-detail', params: { id: 'p2', tile: 'rfis' } }, 'p1'),
    inPlaceTileForStep({ pathname: '/invoice', params: { projectId: 'p1' } }, 'p1'),
    inPlaceTileForStep('/rfi', 'p1'),
  ], ['rfis', null, null, null]);
  eq('next-step tones → notice tones', (['danger', 'warn', 'info', 'accent', 'success'] as const).map(noticeToneForStep), ['bad', 'warn', 'info', 'info', 'good']);
  eq('the one-screen budget computes 896', workspaceHeight(), 896);
  ok('…and fits a 945 px MacBook window', workspaceHeight() <= 945);
  ok('the tallest index column (9 rows + header at 28) fits its 280', 28 * 10 <= WORKSPACE_BUDGET.index);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. ONE "% complete"');
{
  const files = [
    'app/project-detail.tsx', 'components/ProjectHero.tsx', 'components/NextStepHero.tsx', 'hooks/useProjectPulse.ts',
    ...readdirSync(join(ROOT, 'components/project')).filter(f => /\.tsx?$/.test(f)).map(f => `components/project/${f}`),
  ];
  const ratio = /status === 'done'\)\.length|\bdoneTasks\b|\/\s*tasks\.length\)/;
  const offenders = files.filter(f => ratio.test(stripComments(read(f))));
  ok('nobody counts done tasks over task count', offenders.length === 0, offenders.join(', '));
  const pulse = stripComments(read('hooks/useProjectPulse.ts'));
  ok('the pulse\'s progress is computeProjectProgress', /progress: computeProjectProgress\(project\)/.test(pulse));
  const pd = stripComments(read('app/project-detail.tsx'));
  ok('the job page reads progress from the pulse, not a second call', /const heroProgress = pulse\.progress;/.test(pd) && !/computeProjectProgress\(/.test(pd));
  const hero = stripComments(read('components/ProjectHero.tsx'));
  ok('ProjectHero\'s Schedule stat is the pulse progress', /pulse\.progress\.hasSchedule \? pulse\.progress\.pct : null/.test(hero) && !/computeProjectProgress\(/.test(hero));
  ok('project-detail hands the pulse to ProjectHero', /<ProjectHero project=\{project\} pulse=\{pulse\} \/>/.test(pd));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6. The screen');
{
  const raw = read('app/project-detail.tsx');
  const pd = stripComments(raw);
  ok('the stage table is utils/projectStage (no re-declared stage labels)',
    /from '@\/utils\/projectStage'/.test(pd) && !/'Pre-Con'|'Post-Con'|label: 'Closeout'|key: 'closeout'/.test(pd)
    && /const LIFECYCLE_STAGES = PROJECT_STAGES\.map\(/.test(pd) && /const statusToStage = stageForStatus;/.test(pd));
  ok('no maxWidth: 1400 (the page is Layout.page.dashboard)', !/maxWidth:\s*1400\b/.test(pd) && /maxWidth: Layout\.page\.dashboard/.test(pd));
  ok('?tile= is written with router.setParams (open and close)', /router\.setParams\(\{ tile: key \}\)/.test(pd) && /router\.setParams\(\{ tile: undefined \}\)/.test(pd));
  const follow = pd.slice(pd.indexOf('const followedList'), pd.indexOf('const followedList') + 1400);
  ok('the ?tile= follow effect runs on desktop web only', /useEffect\(\(\) => \{\s*if \(!deskWeb \|\| !followPid\) return;/.test(follow));
  ok('…and waits for the role before closing a hidden section', /if \(roleState\.isLoading && hubRole == null\) return;/.test(follow) && /hubTileVisible\(key, hubPerms\)/.test(follow));
  ok('the phone\'s consume-once deep link stays off desktop web', /if \(tileParam && !deskWeb\) \{/.test(pd));
  const nav = pd.slice(pd.indexOf('const navigateFromTile'), pd.indexOf('const navigateFromTile') + 500);
  ok('navigateFromTile closes the section only on a phone (the panel stays)', /if \(!isDesktop\) setActiveTile\(null\);/.test(nav) && /const delay = isDesktop \? 0 : \(Platform\.OS === 'ios' \? 350 : 0\);/.test(nav));
  const paywall = pd.slice(pd.indexOf('const openPortalPaywall'), pd.indexOf('const openPortalPaywall') + 300);
  ok('openPortalPaywall closes the section only on a phone', /if \(!isDesktop\) setActiveTile\(null\);/.test(paywall));
  // Every close of the section is the phone's, or the two desktop-aware helpers'.
  const closes = [...pd.matchAll(/setActiveTile\(null\)/g)].map(m => pd.slice(Math.max(0, m.index! - 60), m.index!));
  const ungated = closes.filter(pre => !/if \(!isDesktop\) $/.test(pre) && !/else $/.test(pre) && !/\bsetActiveTile\(prev => \(prev === null \? prev : null\)\)/.test(pre));
  ok('no ungated setActiveTile(null) is left (the desktop panel is closed by closeSection only)', ungated.length === 0, ungated.join(' | '));
  ok('the side panel mounts only on desktop', /\{isDesktop && \(\s*<SidePanel\b/.test(pd) && (pd.match(/<SidePanel\b/g) ?? []).length === 1);
  ok('…and the full-window section sheet only on a phone', /\{!isDesktop && \(\s*<Modal\s+visible=\{activeTile !== null\}/.test(pd));
  ok('the side panel hosts the same section body as the sheet', (pd.match(/\{sectionBody\}/g) ?? []).length === 2 && /const sectionBody = \(/.test(pd));
  ok('the side panel takes no Cmd+J (no onToggle)', !/<SidePanel[^>]*onToggle/.test(pd));
  ok('the job is made active in an effect, desktop only',
    /const \{ setActiveProject \} = useActiveProject\(\);/.test(pd)
    && /useEffect\(\(\) => \{\s*if \(isDesktop && project\?\.id\) setActiveProject\(project\.id\);\s*\}, \[isDesktop, project\?\.id, setActiveProject\]\);/.test(pd));
  const tileT = (pd.match(/id=\{`hub\.tile\.\$\{tile\.key\}`\}/g) ?? []).length;
  const groupT = (pd.match(/id=\{`hub\.group\.\$\{group\.key\}`\}/g) ?? []).length;
  ok('the tutorial targets exist on both trees (hub.tile. ×2, hub.group. ×2)', tileT >= 2 && groupT >= 2, `tile ${tileT}, group ${groupT}`);
  // The tutorial blocker must name every visible= in the file.
  const sentinelAt = raw.indexOf('<TutorialTarget id="hub.modalUp" />');
  const condStart = raw.lastIndexOf('{(', sentinelAt);
  const cond = raw.slice(condStart, sentinelAt);
  const visibles = [...new Set([...pd.matchAll(/\bvisible=\{([^}]+)\}/g)].map(m => m[1].trim()))].filter(v => v !== 'visible');
  const missing = visibles.filter(v => !cond.includes(v));
  ok('the hub.modalUp blocker still lists every visible={…}', sentinelAt > 0 && missing.length === 0, missing.join(', '));
  // The index's links are the phone chain's targets.
  const chain = pd.slice(pd.indexOf('const pressTile = useCallback'), pd.indexOf('openSection(tile.key);\n  }, [deskWeb, router, id'));
  const pushes = new Map<string, string>();
  for (const m of chain.matchAll(/if \(tile\.key === '(\w+)'\) \{ router\.push\(\{ pathname: '([^']+)'/g)) pushes.set(m[1], m[2]);
  const drift = Object.entries(LEGACY_TILE_ROUTES).filter(([k, r]) => pushes.get(k) !== r.pathname).map(([k]) => k);
  ok('every linked index row goes where the phone tile pushes', pushes.size === Object.keys(LEGACY_TILE_ROUTES).length && drift.length === 0,
    `drift ${drift.join(', ')}; chain has ${[...pushes.keys()].join(', ')}`);
  ok('the phone tiles and the index share one press (pressTile)', (pd.match(/onPress=\{\(\) => pressTile\(tile\)\}/g) ?? []).length === 2 && chain.length > 0);
  ok('a log section opens its log first on desktop web', /if \(deskWeb && isListSection\(tile\.key\)\) \{ router\.push\(routeHref\(LIST_SECTION_ROUTES\[tile\.key\]/.test(chain));
  for (const [route, extra] of [['/change-order', ''], ['/invoice', "type: 'quick', "], ['/daily-report', ''], ['/rfi', ''], ['/submittal', '']] as const) {
    ok(`the create button for ${route} carries new: '1' (the log's editor on desktop web)`,
      pd.includes(`navigateFromTile({ pathname: '${route}' as any, params: { projectId: id, ${extra}new: '1' } })`));
  }
  ok('no stack header on desktop', /\.\.\.\(isDesktop \? \{ headerShown: false \} : \{\}\)/.test(pd));
  ok('the phone keeps its Closeout tile full-width only off desktop', /!isDesktop && styles\.quickActionBtnFull/.test(pd));
  const nsh = stripComments(read('components/NextStepHero.tsx'));
  ok('NextStepHero exports chooseNextStep / NextStep for the header', /export function chooseNextStep\(/.test(nsh) && /export interface NextStep\b/.test(nsh));
  ok("…and its 'Create invoice' step opens the editor (new: '1')", /pathname: '\/invoice', params: \{ projectId: projectNoInvoice\.id, new: '1' \}/.test(nsh));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
