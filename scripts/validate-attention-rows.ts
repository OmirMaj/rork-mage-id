// validate-attention-rows.ts — wave 6c, lane F: the rail and /attention's pure rules.
//
// utils/portfolio/attentionRows.ts, executed:
//   • buildDailyLogGaps equals DailyLogCard's old inline rows memo on a
//     fixture — same filter, same ORDER (the reference below is that memo,
//     copied verbatim from bdd5daee), and DailyLogCard now calls it;
//   • railSection (first N + hidden count) and parseAttentionView (?view=);
//   • the gap row's line and target (a today row opens a NEW report — on
//     desktop web a bare projectId opens the log, lane H);
// and from source:
//   • Home decides the rail with lane S's actionRailVisible, and carries no
//     private `width >= 1280` literal (one rule, not two);
//   • the rail links 'See all' to /attention, and its sections use railSection.
// The rail truth table itself is lane S's (scripts/validate-shell-6c.ts).
//
// Run: bun run scripts/validate-attention-rows.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DailyFieldReport, Project } from '../types';
import {
  computeDailyLogCompletion,
  calendarOfSchedule,
  type DailyLogCompletion,
} from '../utils/dailyLogCompletion';
import {
  buildDailyLogGaps, railSection, parseAttentionView, dailyLogGapLine, dailyLogGapTarget,
  ATTENTION_VIEWS, type DailyLogGapRow,
} from '../utils/portfolio/attentionRows';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ── The reference: DailyLogCard's inline memo body before wave 6c ───────────
interface Row { projectId: string; projectName: string; c: DailyLogCompletion }
function referenceRows(projects: Project[] | undefined, dailyReports: DailyFieldReport[] | undefined, todayISO: string): Row[] {
  const out: Row[] = [];
  for (const p of projects ?? []) {
    if (p.status !== 'in_progress') continue;
    const reports = (dailyReports ?? []).filter(r => r.projectId === p.id);
    const c = computeDailyLogCompletion({
      reports,
      calendar: calendarOfSchedule(p.schedule),
      startDateISO: p.schedule?.startDate ?? null,
      todayISO,
    });
    if (!c.hasRecord) continue;
    const needsToday = c.todayExpected && !c.todayFiled;
    if (!needsToday && c.missedDays === 0) continue;
    out.push({ projectId: p.id, projectName: p.name, c });
  }
  return out.sort((a, b) => {
    const aToday = a.c.todayExpected && !a.c.todayFiled ? 1 : 0;
    const bToday = b.c.todayExpected && !b.c.todayFiled ? 1 : 0;
    if (aToday !== bToday) return bToday - aToday;
    return b.c.missedDays - a.c.missedDays;
  });
}

// ── Fixture: six jobs, a spread of logs ─────────────────────────────────────
const TODAY = new Date(2026, 8, 24, 15, 0, 0).toISOString(); // Thu 24 Sep 2026
const dayKey = (offset: number) => {
  const d = new Date(2026, 8, 24 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const proj = (id: string, status: Project['status'], startDate: string, workingDaysPerWeek = 5): Project => ({
  id, name: `Job ${id}`, status, type: 'renovation', location: '', squareFootage: 0, quality: 'standard', description: '',
  createdAt: '2026-01-01', updatedAt: '2026-01-01', estimate: null,
  schedule: { id: `s-${id}`, name: 's', projectId: id, startDate, workingDaysPerWeek, tasks: [] },
} as unknown as Project);
const report = (projectId: string, offset: number): DailyFieldReport => ({
  id: `r-${projectId}-${offset}`, projectId, date: dayKey(offset), manpower: [{ trade: 'GC', headcount: 2 }],
  workPerformed: 'x', materialsDelivered: [], issuesAndDelays: '', photos: [], weather: {},
} as unknown as DailyFieldReport);

const projects = [
  proj('a', 'in_progress', dayKey(-20)),   // filed every day incl. today → nothing owed
  proj('b', 'in_progress', dayKey(-20)),   // today unfiled, no gaps before
  proj('c', 'in_progress', dayKey(-20)),   // a few gaps, today filed
  proj('d', 'in_progress', dayKey(-20)),   // many gaps, today unfiled
  proj('e', 'completed', dayKey(-20)),     // not active → never listed
  proj('f', 'in_progress', dayKey(-20)),   // no report ever → no record → never listed
  proj('g', 'in_progress', dayKey(-20), 7),// 7-day week, bigger gaps, today filed
];
const reports: DailyFieldReport[] = [];
for (let o = -20; o <= 0; o++) reports.push(report('a', o));
for (let o = -20; o <= -1; o++) reports.push(report('b', o));
for (let o = -20; o <= 0; o++) if (o % 5 !== 0 || o === 0) reports.push(report('c', o));
for (let o = -20; o <= -1; o += 4) reports.push(report('d', o));
reports.push(report('e', -3));
for (let o = -20; o <= 0; o += 3) reports.push(report('g', o));

console.log('\nbuildDailyLogGaps — lifted verbatim from DailyLogCard:');
{
  const got = buildDailyLogGaps(projects, reports, TODAY);
  const want = referenceRows(projects, reports, TODAY);
  const sig = (rows: DailyLogGapRow[] | Row[]) => rows.map((r) => `${r.projectId}:${r.c.todayExpected && !r.c.todayFiled ? 'T' : '-'}${r.c.missedDays}`).join(' ');
  ok('the fixture exercises both branches (a today row and a gap-only row)',
    want.some((r) => r.c.todayExpected && !r.c.todayFiled) && want.some((r) => !(r.c.todayExpected && !r.c.todayFiled) && r.c.missedDays > 0), sig(want));
  ok('the fixture has ≥ 4 rows to order', want.length >= 4, sig(want));
  ok('same rows in the same order as the old inline memo', sig(got) === sig(want), `${sig(got)}  vs  ${sig(want)}`);
  ok('deep-equal completions', JSON.stringify(got) === JSON.stringify(want));
  ok('today-owed rows come first', (() => {
    const flags = got.map((r) => (r.c.todayExpected && !r.c.todayFiled ? 1 : 0));
    return flags.every((f, i) => i === 0 || f <= flags[i - 1]);
  })());
  ok('inactive and never-logged jobs are left out', !got.some((r) => r.projectId === 'e' || r.projectId === 'f' || r.projectId === 'a'));
  ok('null inputs → no rows', buildDailyLogGaps(null, null, TODAY).length === 0 && buildDailyLogGaps(undefined, reports, TODAY).length === 0);

  const today = got.find((r) => r.c.todayExpected && !r.c.todayFiled)!;
  const gap = got.find((r) => !(r.c.todayExpected && !r.c.todayFiled))!;
  ok("a today row reads \"{job}: today's log not filed\"", dailyLogGapLine(today) === `${today.projectName}: today's log not filed`, dailyLogGapLine(today));
  ok("a gap row reads '{job}: N days missing in last 30'", dailyLogGapLine(gap) === `${gap.projectName}: ${gap.c.missedDays} ${gap.c.missedDays === 1 ? 'day' : 'days'} missing in last 30`, dailyLogGapLine(gap));
  const tt = dailyLogGapTarget(today);
  ok("a today row opens a NEW report (new: '1'), never the bare-projectId log", tt.projectId === today.projectId && tt.new === '1' && !tt.date);
  const gt = dailyLogGapTarget(gap);
  ok('a gap row opens its most recent missing day', gt.projectId === gap.projectId && gt.date === gap.c.missedDates[0] && !gt.new);
}

console.log('\nrailSection:');
{
  const s = railSection([1, 2, 3, 4, 5]);
  ok('default max 3: first three shown, two hidden', s.shown.join(',') === '1,2,3' && s.hidden === 2);
  ok('fewer than max: all shown, none hidden', railSection(['a']).shown.length === 1 && railSection(['a']).hidden === 0);
  ok('empty: nothing shown, nothing hidden', railSection([]).shown.length === 0 && railSection([]).hidden === 0);
  ok('max honoured', railSection([1, 2, 3, 4], 1).shown.join(',') === '1' && railSection([1, 2, 3, 4], 1).hidden === 3);
  ok('a bad max never shows negative rows', railSection([1, 2], -2).shown.length === 0 && railSection([1, 2], -2).hidden === 2);
}

console.log('\nparseAttentionView:');
{
  ok('the four views parse', ATTENTION_VIEWS.every((v) => parseAttentionView(v) === v) && ATTENTION_VIEWS.join(',') === 'needs,bill,logs,warranty');
  ok("unknown → 'needs'", parseAttentionView('nope') === 'needs' && parseAttentionView('') === 'needs' && parseAttentionView('NEEDS') === 'needs');
  ok("missing → 'needs'", parseAttentionView(undefined) === 'needs' && parseAttentionView(null) === 'needs' && parseAttentionView(3) === 'needs');
  ok('a repeated param reads its first value', parseAttentionView(['bill', 'logs']) === 'bill' && parseAttentionView([]) === 'needs');
}

console.log('\nsource pins:');
{
  const home = strip(read('app/(tabs)/(home)/index.tsx'));
  ok('Home decides the rail with lane S\'s actionRailVisible', /actionRailVisible\(\{/.test(home) && /from '@\/utils\/sidebarRail'/.test(home));
  ok('…passing the dock and the Home segments', /dockOpen: dock\.content != null/.test(home) && /segments: \['\(tabs\)', '\(home\)'\]/.test(home));
  ok('Home has no private `width >= 1280` literal', !/width\s*>=\s*1280/.test(home));
  ok('the old isWideDesktop gate is gone', !/isWideDesktop/.test(home));
  const card = strip(read('components/home/DailyLogCard.tsx'));
  ok('DailyLogCard reads buildDailyLogGaps (one rule for the card, the rail and /attention)',
    /buildDailyLogGaps\(projects, dailyReports, new Date\(\)\.toISOString\(\)\)/.test(card) && !/computeDailyLogCompletion\(/.test(card));
  const rail = strip(read('components/DesktopActionRail.tsx'));
  ok("the rail's overflow is a link to /attention", /routeHref\('\/attention'\)/.test(rail) && /See all \$\{items\.length\} items that need attention/.test(rail));
  ok('the rail keeps the first 8 canonical rows', /const top = useMemo\(\(\) => items\.slice\(0, 8\), \[items\]\);/.test(rail));
  ok('each rail section is capped by railSection', (rail.match(/railSection\(/g) ?? []).length >= 3);
  ok('each section links its own /attention view', /view="bill"/.test(rail) && /view="logs"/.test(rail) && /view="warranty"/.test(rail)
    && /href=\{routeHref\('\/attention', \{ view \}\)\}/.test(rail));
  ok('no hex severity colours left in the rail', !/#[0-9A-Fa-f]{6}\b/.test(rail.replace(/'#FFFFFF'/g, '')));
  const page = strip(read('app/(tabs)/(home)/attention.tsx'));
  ok('/attention parses ?view= with parseAttentionView and writes it with setParams',
    /parseAttentionView\(/.test(page) && /router\.setParams\(\{ view/.test(page));
  ok('/attention keeps the rail\'s three empty states', /All caught up/.test(page)
    && /Nothing overdue on schedules, invoices, permits or certs\./.test(page)
    && /\/waiting-on/.test(page) && /Couldn't reach MAGE/.test(page));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
