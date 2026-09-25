// validate-portfolio-row.ts — wave 6c, lane F: the desktop Home portfolio row.
//
// utils/portfolio/portfolioRow.ts builds one row per job for the desktop Home
// table. Executed here over fixtures (it is pure), each block naming the rule
// it pins:
//   • an undated schedule is 'undated' with no finish (never a date from today);
//   • no baseline → slip null, and the status comes from overdue + health;
//   • an overdue task → 'late';
//   • unread money / a missing burn entry → contract, billed and A/R all null;
//   • A/R over 30 days; open counts; the composite schedule sort value;
//   • rows come back in name order, so the table's stable sort breaks ties by
//     name; stage labels are utils/projectStage's;
//   • the longest Stage / Schedule words fit their columns, and Job keeps its
//     160 px minimum at EVERY table width (a sweep over every width, and over
//     every desktop window 900–2560 with either sidebar, with and without the
//     action rail and a 15 px scrollbar), through DataTable's real
//     visibleColumnKeys and the table's own column → width / hideBelow map.
//
// Run: bun run scripts/validate-portfolio-row.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ChangeOrder, Invoice, Project, PunchItem, RFI, ScheduleTask } from '../types';
import {
  buildPortfolioRows, formatOpenItems, billedPercent, scheduleCellLabel, scheduleCellDescription, relativeDaysLabel,
  SCHEDULE_RISK_RANK, PORTFOLIO_COLUMN_WIDTHS, PORTFOLIO_CELL_PAD, PORTFOLIO_STAGE_DOT,
  PORTFOLIO_HIDE_BELOW, PORTFOLIO_ROW_CHROME,
  type BurnEntry, type PortfolioRow,
} from '../utils/portfolio/portfolioRow';
import { STATUS_LABELS } from '../utils/projectStage';
import { SIDEBAR_FULL, SIDEBAR_RAIL, ACTION_RAIL_MIN_WIDTH } from '../utils/sidebarRail';
import { visibleColumnKeys } from '../utils/dataTable';
import { billedPct } from '../utils/projectWorkspaceLayout';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const NOW = new Date(2026, 8, 25, 10, 0, 0); // Fri 25 Sep 2026, local

const task = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'General', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
} as ScheduleTask);

const proj = (id: string, over: Omit<Partial<Project>, 'schedule'> & { schedule?: unknown } = {}): Project => ({
  id, name: id, type: 'renovation', location: '', squareFootage: 0, quality: 'standard', description: '',
  status: 'in_progress', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
  estimate: null, schedule: null, ...over,
} as unknown as Project);

const sched = (over: Record<string, unknown>) => ({
  id: 's', name: 's', projectId: null, workingDaysPerWeek: 7, tasks: [], ...over,
});

const burn = (entries: Array<[string, BurnEntry]>) => new Map<string, BurnEntry>(entries);

const build = (projects: Project[], extra: Partial<Parameters<typeof buildPortfolioRows>[0]> = {}) => buildPortfolioRows({
  projects, invoices: [], changeOrders: [], rfis: [], punchItems: [], dailyReports: [],
  burnByProject: new Map(), now: NOW, ...extra,
});
const row = (rows: PortfolioRow[], id: string) => rows.find((r) => r.id === id)!;

// ── Undated ─────────────────────────────────────────────────────────────────
console.log('\nundated schedule:');
{
  const r = row(build([proj('u', { schedule: sched({ tasks: [task('a'), task('b', { startDay: 6 })] }) })]), 'u');
  ok("a schedule with no start date is 'undated'", r.schedule === 'undated', JSON.stringify(r.schedule));
  ok('…and has no finish date (never one made up from today)', r.finishISO === null, String(r.finishISO));
  ok('…and still has a % complete (the tasks are real)', r.pct === 0);
  ok("…and sorts in the last risk rank", Math.floor(r.scheduleSortValue / 100000) === SCHEDULE_RISK_RANK.none);
  ok("the cell says 'No start date'", scheduleCellLabel(r.schedule) === 'No start date');
  const none = row(build([proj('n')]), 'n');
  ok('no schedule → schedule null, pct null, finish null, no milestone',
    none.schedule === null && none.pct === null && none.finishISO === null && none.nextMilestone === null);
  ok("the no-schedule cell is '—'", scheduleCellLabel(none.schedule) === '—');
  const empty = row(build([proj('e', { schedule: sched({ startDate: '2026-09-01', tasks: [] }) })]), 'e');
  ok('a schedule with no tasks → null (nothing to verdict)', empty.schedule === null && empty.finishISO === null && empty.pct === null);
}

// ── Dated, no baseline ──────────────────────────────────────────────────────
console.log('\nno baseline:');
{
  const r = row(build([proj('d', {
    schedule: sched({ startDate: '2026-09-01', tasks: [task('a', { durationDays: 10, progress: 50 }), task('m', { startDay: 11, durationDays: 0, isMilestone: true, title: 'Rough-in inspection' })] }),
  })]), 'd');
  const s = r.schedule as Exclude<PortfolioRow['schedule'], 'undated' | null>;
  ok('dated → a verdict object', typeof s === 'object' && s !== null, JSON.stringify(r.schedule));
  ok('no baseline → slip null (never 0)', s.slipDays === null);
  ok('no overdue, health unset (100) → on track', s.status === 'on_track' && s.overdueCount === 0);
  ok('finish is the CPM finish as a calendar day (7-day week: the day-11 milestone = Sep 11)', r.finishISO === '2026-09-11', String(r.finishISO));
  ok('the milestone is next, dated off the anchor', r.nextMilestone?.title === 'Rough-in inspection' && r.nextMilestone?.dateISO === '2026-09-11',
    JSON.stringify(r.nextMilestone));
  ok('% complete is the duration-weighted rollup (milestones excluded)', r.pct === 50, String(r.pct));
  const unhealthy = row(build([proj('h', { schedule: sched({ startDate: '2026-09-01', healthScore: 60, tasks: [task('a')] }) })]), 'h');
  const hs = unhealthy.schedule as Exclude<PortfolioRow['schedule'], 'undated' | null>;
  ok('no baseline, health 60 → at risk (from health alone)', hs.status === 'at_risk' && hs.slipDays === null);
  ok("the at-risk cell says 'At risk'", scheduleCellLabel(unhealthy.schedule) === 'At risk');
  const done = row(build([proj('dm', { schedule: sched({ startDate: '2026-09-01', tasks: [task('a'), task('m', { isMilestone: true, status: 'done', progress: 100 })] }) })]), 'dm');
  ok('a finished milestone is not "next"', done.nextMilestone === null);
  // status 'done' alone (progress not yet 100) and progress 100 alone (status
  // not 'done') each finish a milestone — two fixtures, one reason each.
  const doneOnly = row(build([proj('do', { schedule: sched({ startDate: '2026-09-01', tasks: [task('a'), task('m', { isMilestone: true, status: 'done', progress: 40 })] }) })]), 'do');
  ok("a milestone marked 'done' at 40% is not \"next\"", doneOnly.nextMilestone === null, JSON.stringify(doneOnly.nextMilestone));
  const fullOnly = row(build([proj('fo', { schedule: sched({ startDate: '2026-09-01', tasks: [task('a'), task('m', { isMilestone: true, status: 'in_progress', progress: 100 })] }) })]), 'fo');
  ok('a milestone at 100% not yet marked done is not "next"', fullOnly.nextMilestone === null, JSON.stringify(fullOnly.nextMilestone));
  // Two unfinished milestones on the same early-start day: the first in task
  // order wins (a strict '<', so a later tie never replaces it).
  const tie = row(build([proj('tie', { schedule: sched({ startDate: '2026-09-01', tasks: [
    task('a', { durationDays: 5 }),
    task('m1', { startDay: 6, durationDays: 0, isMilestone: true, title: 'First' }),
    task('m2', { startDay: 6, durationDays: 0, isMilestone: true, title: 'Second' }),
  ] }) })]), 'tie');
  ok('two milestones on the same day: the first in task order is "next"', tie.nextMilestone?.title === 'First', JSON.stringify(tie.nextMilestone));
}

// ── Overdue ─────────────────────────────────────────────────────────────────
console.log('\noverdue:');
{
  const r = row(build([proj('o', {
    schedule: sched({ startDate: '2026-09-01', tasks: [task('a', { deadline: '2026-09-24' }), task('b', { deadline: '2026-09-25' }), task('c', { deadline: '2026-09-01', status: 'done' })] }),
  })]), 'o');
  const s = r.schedule as Exclude<PortfolioRow['schedule'], 'undated' | null>;
  ok("a task whose deadline day has passed → 'late'", s.status === 'late');
  ok('due today is not overdue; a done task is not overdue', s.overdueCount === 1, String(s.overdueCount));
  ok("no baseline: the late cell names the overdue count, never '+Nd'", scheduleCellLabel(r.schedule) === '1 overdue', scheduleCellLabel(r.schedule));
  ok('…and its description says Late with the count', scheduleCellDescription(r.schedule) === 'Late, 1 overdue task', scheduleCellDescription(r.schedule));
  // A baseline with no slip (0) but an overdue task: the count, never 'Late +0d'.
  const zero = { status: 'late' as const, slipDays: 0, overdueCount: 1 };
  ok("slip 0 + 1 overdue → '1 overdue' (never 'Late +0d')", scheduleCellLabel(zero) === '1 overdue', scheduleCellLabel(zero));
  ok('…and its description names only the overdue task', scheduleCellDescription(zero) === 'Late, 1 overdue task', scheduleCellDescription(zero));
}

// ── Baseline slip ───────────────────────────────────────────────────────────
console.log('\nbaseline slip:');
{
  const r = row(build([proj('b', {
    schedule: sched({
      startDate: '2026-09-01',
      tasks: [task('a', { durationDays: 20 })],
      baselines: [{ id: 'bl', name: 'v1', savedAt: '2026-09-01', tasks: [{ id: 'a', startDay: 1, endDay: 10 }] }],
    }),
  })]), 'b');
  const s = r.schedule as Exclude<PortfolioRow['schedule'], 'undated' | null>;
  ok('slip = working days between the baseline finish and the CPM finish', s.slipDays === 10, String(s.slipDays));
  ok('a 10-day slip → late', s.status === 'late');
  ok("the cell says 'Late +10d'", scheduleCellLabel(r.schedule) === 'Late +10d');
  ok('…and its description names the slip', scheduleCellDescription(r.schedule).startsWith('Late, 10 working days behind baseline'), scheduleCellDescription(r.schedule));
}

// ── Money ───────────────────────────────────────────────────────────────────
console.log('\nmoney:');
{
  const inv = (id: string, projectId: string, totalDue: number, status: Invoice['status'], dueDate: string, amountPaid = 0): Invoice =>
    ({ id, projectId, totalDue, amountPaid, status, dueDate, issueDate: '2026-08-01', payments: [] } as unknown as Invoice);
  const invoices = [
    inv('i1', 'm', 10000, 'sent', '2020-01-01'),       // long overdue
    inv('i2', 'm', 5000, 'partially_paid', '2099-01-01', 2000),
    inv('i3', 'm', 9999, 'draft', '2020-01-01'),        // drafts never count
    inv('i4', 'm', 7000, 'paid', '2020-01-01', 7000),   // settled → owes 0
    inv('i6', 'm', 1000, 'paid', '2099-01-01', 400),    // a stored 'paid' that is not settled still owes 600
    inv('i5', 'n', 4000, 'sent', '2099-01-01'),
  ];
  const rows = build([proj('m'), proj('n'), proj('x')], {
    invoices,
    burnByProject: burn([['m', { invoicedToDate: 30000, revisedContract: 120000 }], ['n', { invoicedToDate: 4000, revisedContract: 0 }]]),
  });
  const m = row(rows, 'm');
  ok('contract is the burn entry\'s revised contract', m.contract === 120000);
  ok('billed % = invoiced ÷ revised contract, rounded', m.billedPct === 25);
  ok('A/R sums outstanding on non-draft invoices (a stored "paid" is judged by the money, not the flag)', m.ar === 13600, String(m.ar));
  ok('an invoice > 30 days past due flags A/R', m.arOver30 === true);
  const n = row(rows, 'n');
  ok('a zero contract → billed % null (no division by nothing)', n.billedPct === null && n.contract === 0);
  ok('…A/R still known for that job, not overdue', n.ar === 4000 && n.arOver30 === false);
  const x = row(rows, 'x');
  ok('no burn entry (unread / not his) → contract, billed and A/R all null', x.contract === null && x.billedPct === null && x.ar === null && x.arOver30 === false);
  // The 30-day line, both sides of it (getDaysPastDue reads the real clock).
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const edge = build([proj('p'), proj('q')], {
    invoices: [inv('ip', 'p', 1000, 'sent', daysAgo(45)), inv('iq', 'q', 1000, 'sent', daysAgo(20))],
    burnByProject: burn([['p', { invoicedToDate: 1000, revisedContract: 10000 }], ['q', { invoicedToDate: 1000, revisedContract: 10000 }]]),
  });
  ok('45 days past due is over 30', row(edge, 'p').arOver30 === true);
  ok('20 days past due is overdue but not over 30', row(edge, 'q').arOver30 === false && row(edge, 'q').ar === 1000);
  // Exactly on the line: getDaysPastDue floors whole days, so due 30 days and
  // an hour ago is 30 (not over 30) and 31 days and an hour ago is 31.
  const agoMs = (d: number) => new Date(Date.now() - d * 86400000 - 3600000).toISOString();
  const line = build([proj('p30'), proj('p31')], {
    invoices: [inv('i30', 'p30', 1000, 'sent', agoMs(30)), inv('i31', 'p31', 1000, 'sent', agoMs(31))],
    burnByProject: burn([['p30', { invoicedToDate: 1000, revisedContract: 10000 }], ['p31', { invoicedToDate: 1000, revisedContract: 10000 }]]),
  });
  ok('exactly 30 days past due is NOT over 30 (the rule is > 30)', row(line, 'p30').arOver30 === false && row(line, 'p30').ar === 1000);
  ok('31 days past due is over 30', row(line, 'p31').arOver30 === true);
  const unread = row(build([proj('m')], { invoices, burnByProject: new Map() }), 'm');
  ok('invoices on the device but no burn entry → still null, never a 0', unread.ar === null && unread.billedPct === null && unread.contract === null);
  // Billed % parity with the job page (lane E's KPI, utils/projectWorkspaceLayout
  // billedPct). Integration round 1: Home clamped at 100 and the job page did
  // not, so an overbilled job read 100% here and 114% one click away.
  ok('billedPercent does NOT cap at 100 — an overbilled job reads over 100%, as on the job page',
    billedPercent(125000, 110000) === 114 && billedPercent(150, 100) === 150, String(billedPercent(125000, 110000)));
  ok('billedPercent floors a negative invoiced total at 0 and rounds', billedPercent(-5, 100) === 0 && billedPercent(1, 3) === 33);
  {
    const grid: [number, number][] = [[65000, 110000], [125000, 110000], [0, 110000], [1, 3], [2, 3], [-5, 100], [110000, 110000], [99999, 100000], [10, 0], [10, -1]];
    const off = grid.filter(([i, c]) => billedPercent(i, c) !== billedPct(i, c));
    ok('billedPercent prints the job page\'s billedPct for every fixture (one rule, two screens)', off.length === 0, JSON.stringify(off));
  }
  {
    const rowSrc = readFileSync(join(__dirname, '..', 'utils', 'portfolio', 'portfolioRow.ts'), 'utf8');
    const projRowSrc = readFileSync(join(__dirname, '..', 'components', 'ProjectRow.tsx'), 'utf8');
    ok('tablet ProjectRow prints the same uncapped Billed % (only the bar stops at 100)',
      /\? Math\.max\(0, invoicedToDate \/ revisedContract\)\n/.test(projRowSrc) && !/Math\.min\(1,/.test(projRowSrc)
        && /width: `\$\{Math\.min\(100, burnPct\)\}%`/.test(projRowSrc));
    ok('portfolioRow imports billedPct from the job page\'s layout module (no second formula)',
      /import \{ billedPct \} from '@\/utils\/projectWorkspaceLayout';/.test(rowSrc) && !/Math\.min\(100/.test(rowSrc));
  }
  ok('billedPercent is null when either side is unknown or the contract ≤ 0',
    billedPercent(null, 100) === null && billedPercent(10, null) === null && billedPercent(10, 0) === null && billedPercent(10, -1) === null);
  const allPaid = row(build([proj('p')], { invoices: [inv('pp', 'p', 100, 'paid', '2020-01-01', 100)], burnByProject: burn([['p', { invoicedToDate: 100, revisedContract: 100 }]]) }), 'p');
  ok('a known job with nothing owed → A/R 0 (a known zero, not unknown)', allPaid.ar === 0 && allPaid.billedPct === 100);
}

// ── Open items ──────────────────────────────────────────────────────────────
console.log('\nopen items:');
{
  const rfis = [
    { id: 'r1', projectId: 'j', status: 'open', dateSubmitted: '2026-09-20' },
    { id: 'r2', projectId: 'j', status: 'answered', dateSubmitted: '2026-09-21' },
    { id: 'r3', projectId: 'k', status: 'open', dateSubmitted: '2026-09-01' },
  ] as unknown as RFI[];
  const changeOrders = [
    { id: 'c1', projectId: 'j', status: 'submitted' },
    { id: 'c2', projectId: 'j', status: 'under_review' },
    { id: 'c3', projectId: 'j', status: 'approved' },
    { id: 'c4', projectId: 'j', status: 'draft' },
  ] as unknown as ChangeOrder[];
  const punchItems = [
    { id: 'p1', projectId: 'j', status: 'open' },
    { id: 'p2', projectId: 'j', status: 'ready_for_review' },
    { id: 'p3', projectId: 'j', status: 'closed' },
  ] as unknown as PunchItem[];
  const j = row(build([proj('j'), proj('k')], { rfis, changeOrders, punchItems }), 'j');
  ok('RFIs: status open only', j.open.rfi === 1);
  ok('COs: submitted + under review', j.open.co === 2);
  ok('punch: everything not closed', j.open.punch === 2);
  ok("formatOpenItems '1 RFI · 2 CO · 2 punch'", formatOpenItems(j.open) === '1 RFI · 2 CO · 2 punch', formatOpenItems(j.open));
  ok('formatOpenItems skips zeros', formatOpenItems({ rfi: 0, co: 1, punch: 12 }) === '1 CO · 12 punch');
  ok("formatOpenItems '—' when nothing is open", formatOpenItems({ rfi: 0, co: 0, punch: 0 }) === '—');
  ok('last activity = the newest of RFI / invoice / daily report / project update',
    j.lastActivityISO !== null && j.lastActivityISO.startsWith('2026-09-2'), String(j.lastActivityISO));
  const withDfr = row(build([proj('j')], { dailyReports: [{ id: 'd', projectId: 'j', date: '2026-09-24' }] as never }), 'j');
  ok('a daily report counts as activity', withDfr.lastActivityISO === new Date(2026, 8, 24).toISOString(), String(withDfr.lastActivityISO));
  ok("relativeDaysLabel: same day 'Today', else 'Nd ago', unknown '—'",
    relativeDaysLabel(new Date(2026, 8, 25, 1).toISOString(), NOW) === 'Today'
    && relativeDaysLabel(new Date(2026, 8, 22, 12).toISOString(), NOW) === '3d ago'
    && relativeDaysLabel(null, NOW) === '—');
}

// ── Sort value and order ────────────────────────────────────────────────────
console.log('\nsort:');
{
  const rows = build([
    proj('Zulu undated', { schedule: sched({ tasks: [task('a')] }) }),
    proj('Yankee on track late finish', { schedule: sched({ startDate: '2026-12-01', tasks: [task('a')] }) }),
    proj('Xray on track early finish', { schedule: sched({ startDate: '2026-10-01', tasks: [task('a')] }) }),
    // At risk finishes LATER than Xray on track, so only the risk rank (not
    // the finish date or the name) can put it first.
    proj('Whiskey at risk', { schedule: sched({ startDate: '2026-11-01', healthScore: 50, tasks: [task('a')] }) }),
    proj('Victor late', { schedule: sched({ startDate: '2026-09-01', tasks: [task('a', { deadline: '2026-09-02' })] }) }),
    proj('Alpha no schedule'),
  ]);
  const bySort = [...rows].sort((a, b) => a.scheduleSortValue - b.scheduleSortValue).map((r) => r.id);
  ok('late < at_risk < on_track (earlier finish first) < undated / none',
    bySort.slice(0, 4).join('|') === 'Victor late|Whiskey at risk|Xray on track early finish|Yankee on track late finish', bySort.join(' | '));
  ok('undated and no-schedule share the last rank', bySort.slice(4).every((id) => id === 'Zulu undated' || id === 'Alpha no schedule'));
  ok('rows come back in name order', rows.map((r) => r.id).join('|') === [...rows.map((r) => r.id)].sort((a, b) => a.localeCompare(b)).join('|'));
  // Ties: two undated jobs share a sort value; a stable sort over the
  // name-ordered rows keeps them in name order.
  const tied = build([proj('Bravo', { schedule: sched({ tasks: [task('a')] }) }), proj('Alpha', { schedule: sched({ tasks: [task('a')] }) })]);
  ok('equal sort values stay in name order under a stable sort',
    tied[0].scheduleSortValue === tied[1].scheduleSortValue
    && [...tied].sort((a, b) => a.scheduleSortValue - b.scheduleSortValue).map((r) => r.id).join('|') === 'Alpha|Bravo');
}

// ── Stage labels ────────────────────────────────────────────────────────────
console.log('\nstage labels:');
{
  const rows = build([
    proj('a', { status: 'draft' }), proj('b', { status: 'estimated' }), proj('c', { status: 'in_progress' }),
    proj('d', { status: 'completed' }), proj('e', { status: 'closed' }),
  ]);
  const lab = (id: string) => row(rows, id).stageLabel;
  ok("completed → 'Post-Con'", lab('d') === 'Post-Con');
  ok("closed → 'Closeout'", lab('e') === 'Closeout');
  ok("in_progress → 'Construction'", lab('c') === 'Construction');
  ok("draft / estimated keep their finer words", lab('a') === 'Draft' && lab('b') === 'Estimated');
  ok('stages follow projectStage', row(rows, 'a').stage === 'precon' && row(rows, 'd').stage === 'postcon' && row(rows, 'e').stage === 'closeout');
  ok('city is the typed location, or null', row(build([proj('l', { location: 'Portland, OR' })]), 'l').city === 'Portland, OR'
    && row(build([proj('l', { location: 'null' })]), 'l').city === null);
}

// ── Column fit (desktop table) ───────────────────────────────────────────────
// Type.footnote is 13 px; an average sans glyph is ≈ 0.5 em (6.5 px), so 7 px a
// character is a conservative bound (an estimate, not a browser measurement).
// The review that found the Stage <Badge> spilling out of a 96 px column did
// the same arithmetic on the badge's 10 px mono caps (≈ 7.8 px a char + 22).
console.log('\ncolumn fit:');
{
  const PX = 7;
  const W = PORTFOLIO_COLUMN_WIDTHS;
  const inner = (w: number) => w - 2 * PORTFOLIO_CELL_PAD;
  // The dot allowance is the component's own dot + gap, read from its styles.
  const tableSrc = readFileSync(join(__dirname, '..', 'components', 'portfolio', 'PortfolioTable.tsx'), 'utf8');
  const gap = /stageCell: \{[^}]*gap: (\d+)/.exec(tableSrc);
  const dot = /stageDot: \{ width: (\d+)/.exec(tableSrc);
  ok('PORTFOLIO_STAGE_DOT = the Stage cell\'s dot width + gap',
    !!gap && !!dot && Number(gap[1]) + Number(dot[1]) === PORTFOLIO_STAGE_DOT, `${gap?.[1]} + ${dot?.[1]} vs ${PORTFOLIO_STAGE_DOT}`);
  ok('the table draws its columns from PORTFOLIO_COLUMN_WIDTHS (no literal widths)',
    /PORTFOLIO_COLUMN_WIDTHS as W/.test(tableSrc) && (tableSrc.match(/width: W\./g) ?? []).length === 11);
  const longestStage = Object.values(STATUS_LABELS).reduce((a, b) => (b.length > a.length ? b : a), '');
  ok(`the longest stage word ('${longestStage}') + its dot fits the Stage column`,
    longestStage.length * PX + PORTFOLIO_STAGE_DOT <= inner(W.stage), `${longestStage.length * PX + PORTFOLIO_STAGE_DOT} > ${inner(W.stage)}`);
  const labels = [
    scheduleCellLabel('undated'), scheduleCellLabel(null),
    scheduleCellLabel({ status: 'on_track', slipDays: null, overdueCount: 0 }),
    scheduleCellLabel({ status: 'at_risk', slipDays: null, overdueCount: 0 }),
    scheduleCellLabel({ status: 'late', slipDays: 999, overdueCount: 0 }),
    scheduleCellLabel({ status: 'late', slipDays: null, overdueCount: 999 }),
  ];
  const longestSchedule = labels.reduce((a, b) => (b.length > a.length ? b : a), '');
  ok(`the longest Schedule label ('${longestSchedule}') fits the Schedule column`,
    longestSchedule.length * PX <= inner(W.schedule), `${longestSchedule.length * PX} > ${inner(W.schedule)}`);
  // The spec's widths for the columns this lane did not have to change.
  ok('Job minimum is the spec\'s 160', W.jobMin === 160, String(W.jobMin));
  ok('spec widths kept: % 64, Billed 64, A/R 84, Next milestone 160, Last activity 112, ⋯ 40',
    W.pct === 64 && W.billed === 64 && W.ar === 84 && W.milestone === 160 && W.activity === 112 && W.actions === 40);
  ok("Finish fits its longest text ('Sep 30')", 'Sep 30'.length * PX <= inner(W.finish), `${'Sep 30'.length * PX} > ${inner(W.finish)}`);
  ok('row chrome = the card border 2 × 1 + the highlighted row\'s 3 px left border', PORTFOLIO_ROW_CHROME === 5);
  const dtSrc = readFileSync(join(__dirname, '..', 'components', 'desktop', 'DataTable.tsx'), 'utf8');
  ok('DataTable\'s highlighted and focused rows are the 3 px the chrome allows',
    /rowActive: \{[^}]*borderLeftWidth: 3\b/.test(dtSrc) && /rowFocused: \{[^}]*borderLeftWidth: 3\b/.test(dtSrc));

  // The table's own column list, read from its source: key → width / hideBelow.
  type Col = { key: string; width: number | null; hideBelow?: number };
  const cols: Col[] = [];
  for (const chunk of tableSrc.split(/\n\s*key: '/).slice(1)) {
    const key = chunk.slice(0, chunk.indexOf("'"));
    const body = chunk.slice(0, chunk.indexOf('render:'));
    const w = /width: W\.(\w+)/.exec(body);
    const h = /hideBelow: (\S+?),/.exec(body);
    const hideKey = h && /^HIDE\.(\w+)$/.exec(h[1]);
    cols.push({
      key,
      width: w ? (W as Record<string, number>)[w[1]] : null,
      hideBelow: hideKey ? (PORTFOLIO_HIDE_BELOW as Record<string, number>)[hideKey[1]] : h ? Number.NaN : undefined,
    });
  }
  ok('the table has the 12 spec columns, Job first',
    cols.map((c) => c.key).join(',') === 'job,stage,pct,schedule,finish,contract,billed,ar,open,milestone,activity,actions', cols.map((c) => c.key).join(','));
  ok('every hideBelow in the table is a PORTFOLIO_HIDE_BELOW entry (no literals)',
    cols.every((c) => c.hideBelow === undefined || Number.isFinite(c.hideBelow)) && (tableSrc.match(/hideBelow: HIDE\./g) ?? []).length === 6);
  ok('the table is not selectable (no checkbox column to budget for)', !/\bselectable\b/.test(tableSrc));
  // The accepted deviation (integration round 1): Home's Contract/Billed are
  // estimate + approved COs, the job page prefers a signed contract — so the
  // table says which basis it prints whenever it prints a contract figure.
  ok('the desktop table names its contract basis under the table whenever any contract is known (never on the phone)',
    /export const CONTRACT_BASIS_NOTE = 'Contract and Billed use the estimate plus approved change orders\./.test(tableSrc)
      && /const anyContract = rows\.some\(\(r\) => r\.contract != null\);/.test(tableSrc)
      && /\{isDesktop && anyContract \? \(\s*<Text[^>]*>\{CONTRACT_BASIS_NOTE\}<\/Text>/.test(tableSrc)
      && /const \{ isDesktop \} = useResponsiveLayout\(\);/.test(tableSrc));
  const jobFor = (outer: number) => {
    const shown = new Set(visibleColumnKeys(cols, outer, []));
    const fixedShown = cols.filter((c) => c.key !== 'job' && shown.has(c.key)).reduce((a, c) => a + (c.width ?? 0), 0);
    return { shown, job: outer - PORTFOLIO_ROW_CHROME - fixedShown };
  };
  const neverHide = W.jobMin + PORTFOLIO_ROW_CHROME
    + cols.filter((c) => c.key !== 'job' && c.hideBelow === undefined).reduce((a, c) => a + (c.width ?? 0), 0);

  // (1) Every table width from the never-hiding minimum up: Job ≥ its minimum,
  // on the highlighted row too. Independent of the window, sidebar, rail or
  // scrollbar — hideBelow reads the table's measured width.
  const badTable: string[] = [];
  for (let outer = neverHide; outer <= 2600; outer++) {
    const { job } = jobFor(outer);
    if (job < W.jobMin) badTable.push(`${outer}→${job}`);
  }
  ok(`every table width ${neverHide}–2600 leaves Job ≥ ${W.jobMin} (highlighted row included)`, badTable.length === 0, badTable.slice(0, 8).join(', '));

  // (2) Every desktop window. isDesktop is web ≥ 900. The Home column is capped
  // at Layout.page.table; the rail beside it only at ≥ ACTION_RAIL_MIN_WIDTH.
  // RAIL_WIDTH is read from the rail's source (importing it would pull React
  // Native into bun), so a wider rail turns this red instead of drifting.
  const railMatch = /export const RAIL_WIDTH = (\d+);/.exec(readFileSync(join(__dirname, '..', 'components', 'DesktopActionRail.tsx'), 'utf8'));
  ok('DesktopActionRail exports a numeric RAIL_WIDTH', railMatch !== null);
  const railWidth = railMatch ? Number(railMatch[1]) : Number.POSITIVE_INFINITY;
  const tokensSrc = readFileSync(join(__dirname, '..', 'constants', 'designTokens.ts'), 'utf8');
  const capMatch = /page:\s*\{[^}]*\btable: (\d+)/.exec(tokensSrc);
  const gutterMatch = /\bgutter: (\d+)/.exec(tokensSrc);
  ok('Layout.page.table and Layout.gutter read from designTokens', !!capMatch && !!gutterMatch);
  const cap = capMatch ? Number(capMatch[1]) : 0;
  const gutter = gutterMatch ? Number(gutterMatch[1]) : 0;
  const tableAt = (win: number, sidebar: number, rail: number, scrollbar: number) =>
    Math.min(win - scrollbar - sidebar - rail, cap) - 2 * gutter;
  const badWin: string[] = [];
  let narrowest = Infinity;
  for (let win = 900; win <= 2560; win++) {
    for (const sidebar of [SIDEBAR_FULL, SIDEBAR_RAIL]) {
      for (const rail of win >= ACTION_RAIL_MIN_WIDTH ? [0, railWidth] : [0]) {
        for (const scrollbar of [0, 15]) {
          const outer = tableAt(win, sidebar, rail, scrollbar);
          narrowest = Math.min(narrowest, outer);
          const { job } = jobFor(outer);
          if (job < W.jobMin) badWin.push(`${win}/sb${sidebar}/rail${rail}/scroll${scrollbar}: table ${outer}, Job ${job}`);
        }
      }
    }
  }
  ok(`the narrowest desktop table (${narrowest}) still fits the never-hiding columns (${neverHide})`, narrowest >= neverHide);
  ok(`every desktop window 900–2560 (either sidebar, ± rail, ± scrollbar) leaves Job ≥ ${W.jobMin}`, badWin.length === 0,
    `${badWin.length} bad, e.g. ${badWin.slice(0, 4).join(' | ')}`);

  // (3) The spec's acceptance points, full sidebar.
  const at = (win: number) => jobFor(tableAt(win, SIDEBAR_FULL, win >= ACTION_RAIL_MIN_WIDTH ? railWidth : 0, 0));
  const hidden = (win: number) => cols.map((c) => c.key).filter((k) => !at(win).shown.has(k)).join(',');
  ok('1512 with the rail: every column but Next milestone and Last activity', hidden(1512) === 'milestone,activity', `${hidden(1512)} (Job ${at(1512).job})`);
  ok('1366: % and Contract hidden, Open shown', hidden(1366) === 'pct,contract,milestone,activity', hidden(1366));
  ok('1280: Open hidden too, Billed shown', hidden(1280) === 'pct,contract,open,milestone,activity', hidden(1280));
  ok('2560: every column', hidden(2560) === '', hidden(2560));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
