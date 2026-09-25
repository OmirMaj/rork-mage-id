// validate-dfr-log.ts — the daily-report LOG (wave 6c, lane H).
//
// WHY. On the founder's 1512 px MacBook /daily-report opened a new report for
// today every time — 2.4 screens of 1,022 px inputs and no list of what had
// been filed. Desktop web now opens a log (every report on the job, the open
// one read beside it) for a bare ?projectId=, and the editor for anything that
// names a report or a day. Three pure rules decide that, and this EXECUTES
// them (utils/dailyReportLog.ts, pure):
//
//   1. dfrScreenMode — the truth table. 'log' only on desktop web, for a real
//      project, with no reportId / date / fieldIssue / new=1. The phone and a
//      native tablet (isDesktop true at >= 1024, desktopWeb false) always get
//      the editor; so does every tutorial and Home link that carries a date.
//   2. defaultDfrSelection — today's report (latest updatedAt), else the
//      latest day then updatedAt; null on an empty job.
//   3. dfrLogRow — crew = headcount sum, hours = the editor's man-hour rule
//      (headcount × hours), weather 'temp · conditions' or null (never
//      'Clear'), issue Incident > Issue > null, photo count, status.
//
// And one source check: the editor's man-hour total and the log read the SAME
// helper, so the two numbers cannot drift apart.
//
// Run via: bun run test:dfr-log

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultDfrSelection, dfrLogRow, dfrManHours, dfrScreenMode } from '../utils/dailyReportLog';

const ROOT = join(__dirname, '..');
let failures = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}

// ── 1. dfrScreenMode: the full truth table ──────────────────────────────────
console.log('\ndfrScreenMode — the log only for a bare ?projectId= on desktop web:');
const base = { desktopWeb: true, projectId: 'p1', projectExists: true, reportId: null, date: null, fieldIssue: null, isNew: false };
let rows = 0;
let logs = 0;
for (const desktopWeb of [true, false]) {
  for (const projectId of ['p1', '', null]) {
    for (const projectExists of [true, false]) {
      for (const reportId of [null, 'r1']) {
        for (const date of [null, '2026-08-14']) {
          for (const fieldIssue of [null, 'Extra blocking at stair']) {
            for (const isNew of [false, true]) {
              const want = desktopWeb && !!projectId && projectExists && !reportId && !date && !fieldIssue && !isNew ? 'log' : 'editor';
              const got = dfrScreenMode({ desktopWeb, projectId, projectExists, reportId, date, fieldIssue, isNew });
              rows++;
              if (got === 'log') logs++;
              if (got !== want) ok(`dfrScreenMode ${JSON.stringify({ desktopWeb, projectId, projectExists, reportId, date, fieldIssue, isNew })}`, false, `got ${got}, want ${want}`);
            }
          }
        }
      }
    }
  }
}
ok(`all ${rows} combinations match the rule (exactly one is 'log')`, rows === 192 && logs === 1, `rows ${rows}, logs ${logs}`);
ok('desktop web + a real project + nothing else → log', dfrScreenMode(base) === 'log');
ok('the phone (desktopWeb false) → editor', dfrScreenMode({ ...base, desktopWeb: false }) === 'editor');
ok('reportId → editor', dfrScreenMode({ ...base, reportId: 'r1' }) === 'editor');
ok('date (Home, the tutorial) → editor', dfrScreenMode({ ...base, date: '2026-08-14' }) === 'editor');
ok('fieldIssue (the CO handoff) → editor', dfrScreenMode({ ...base, fieldIssue: 'x' }) === 'editor');
ok('new=1 (the log\'s own New report) → editor', dfrScreenMode({ ...base, isNew: true }) === 'editor');
ok('a project that is gone → editor (its "that project is gone" picker)', dfrScreenMode({ ...base, projectExists: false }) === 'editor');
ok('no projectId → editor (the job picker)', dfrScreenMode({ ...base, projectId: undefined }) === 'editor');

// ── 2. defaultDfrSelection ──────────────────────────────────────────────────
console.log('\ndefaultDfrSelection — today, else the latest:');
const TODAY = '2026-08-15';
ok('empty → null', defaultDfrSelection([], TODAY) === null);
ok('one report → it', defaultDfrSelection([{ id: 'a', date: '2026-08-01', updatedAt: '2026-08-01T10:00:00Z' }], TODAY) === 'a');
ok("today's report wins over a later-edited older one",
  defaultDfrSelection([
    { id: 'old', date: '2026-08-14', updatedAt: '2026-08-16T09:00:00Z' },
    { id: 'today', date: TODAY, updatedAt: '2026-08-15T08:00:00Z' },
  ], TODAY) === 'today');
ok("today's report wins even over a later-dated one (a mis-dated or synced-ahead row)",
  defaultDfrSelection([
    { id: 'ahead', date: '2026-08-20', updatedAt: '2026-08-15T10:00:00Z' },
    { id: 'today', date: TODAY, updatedAt: '2026-08-15T08:00:00Z' },
  ], TODAY) === 'today');
ok('two reports today → the latest updatedAt',
  defaultDfrSelection([
    { id: 't1', date: TODAY, updatedAt: '2026-08-15T18:00:00Z' },
    { id: 't2', date: TODAY, updatedAt: '2026-08-15T09:00:00Z' },
  ], TODAY) === 't1');
ok('two reports today, later one listed second → still the latest',
  defaultDfrSelection([
    { id: 't2', date: TODAY, updatedAt: '2026-08-15T09:00:00Z' },
    { id: 't1', date: TODAY, updatedAt: '2026-08-15T18:00:00Z' },
  ], TODAY) === 't1');
ok('none today → the latest day, not the latest edit',
  defaultDfrSelection([
    { id: 'd12', date: '2026-08-12', updatedAt: '2026-08-15T11:00:00Z' },
    { id: 'd14', date: '2026-08-14', updatedAt: '2026-08-14T17:00:00Z' },
    { id: 'd13', date: '2026-08-13', updatedAt: '2026-08-13T17:00:00Z' },
  ], TODAY) === 'd14');
ok('same latest day twice → the later updatedAt',
  defaultDfrSelection([
    { id: 'x', date: '2026-08-14', updatedAt: '2026-08-14T08:00:00Z' },
    { id: 'y', date: '2026-08-14', updatedAt: '2026-08-14T20:00:00Z' },
  ], TODAY) === 'y');
ok('an ISO instant date counts as its local day (today)',
  defaultDfrSelection([
    { id: 'old', date: '2026-08-14', updatedAt: '2026-08-14T20:00:00Z' },
    { id: 'inst', date: new Date(2026, 7, 15, 12, 0, 0).toISOString(), updatedAt: '2026-08-15T12:00:00Z' },
  ], TODAY) === 'inst');

// ── 3. dfrLogRow ────────────────────────────────────────────────────────────
console.log('\ndfrLogRow — nothing invented:');
const mp = [
  { id: 'm1', trade: 'Framing', company: 'A', headcount: 4, hoursWorked: 8 },
  { id: 'm2', trade: 'Electrical', company: 'B', headcount: 2, hoursWorked: 6.5 },
];
const full = dfrLogRow({
  manpower: mp,
  weather: { temperature: '72°F', conditions: 'Sunny', wind: '5 mph', isManual: false },
  incident: { hasIncident: true },
  issuesAndDelays: 'Late delivery',
  photos: [{ id: 'p1', uri: 'a' }, { id: 'p2', uri: 'b' }, { id: 'p3', uri: 'c' }] as never,
  status: 'sent',
});
ok('crew = headcount sum (6)', full.crew === 6, String(full.crew));
ok('hours = headcount × hours (4×8 + 2×6.5 = 45)', full.hours === 45, String(full.hours));
ok('hours = the editor\'s rule, dfrManHours', full.hours === dfrManHours(mp));
ok("weather = 'temp · conditions'", full.weather === '72°F · Sunny', String(full.weather));
ok('an incident outranks an issue', full.issue === 'Incident', String(full.issue));
ok('photos = count', full.photos === 3);
ok('status passes through', full.status === 'sent');
ok('a report with crew → crewRecorded', full.crewRecorded === true);
const bareIn: Parameters<typeof dfrLogRow>[0] = {
  manpower: [], weather: { temperature: '', conditions: '  ', wind: '', isManual: false },
  issuesAndDelays: '  ', photos: [], status: 'draft',
};
const bare = dfrLogRow(bareIn);
ok('no weather recorded → null (the table shows —), never "Clear"', bare.weather === null, String(bare.weather));
ok('no crew → 0 crew, 0 hours (sort keys only)', bare.crew === 0 && bare.hours === 0);
ok('no crew → crewRecorded false (the table shows —, never 0)', bare.crewRecorded === false);
ok('whitespace-only issues and no incident → null', bare.issue === null, String(bare.issue));
ok('only the temperature → just the temperature',
  dfrLogRow({ ...bareIn, weather: { temperature: '55°F', conditions: '', wind: '', isManual: true } }).weather === '55°F');
ok('only the conditions → just the conditions',
  dfrLogRow({ ...bareIn, weather: { temperature: '', conditions: 'Rain', wind: '', isManual: true } }).weather === 'Rain');
ok('issues text, no incident → Issue', dfrLogRow({ ...bareIn, issuesAndDelays: 'Inspector no-show' }).issue === 'Issue');
ok('incident flag false + issues → Issue', dfrLogRow({ ...bareIn, incident: { hasIncident: false }, issuesAndDelays: 'x' }).issue === 'Issue');
ok('missing arrays (an old row) do not throw',
  (() => { try { const r = dfrLogRow({ status: 'draft' } as never); return r.crew === 0 && r.photos === 0 && r.weather === null && r.crewRecorded === false; } catch { return false; } })());

// ── 4. One man-hour rule ────────────────────────────────────────────────────
console.log('\nthe editor and the log share the man-hour rule:');
const dfr = readFileSync(join(ROOT, 'app/daily-report.tsx'), 'utf8');
ok('app/daily-report.tsx computes totalManHours with dfrManHours',
  /const totalManHours = useMemo\(\(\) => dfrManHours\(manpower\)/.test(dfr));
ok("app/daily-report.tsx routes the log through dfrScreenMode and useIsDesktopWeb",
  /dfrScreenMode\(\{/.test(dfr) && /useIsDesktopWeb\(\)/.test(dfr) && /<DailyReportLog\b/.test(dfr));

// ── 5. The log table honours crewRecorded ──────────────────────────────────
console.log('\nthe log shows — for an unrecorded crew:');
const logSrc = readFileSync(join(ROOT, 'components/logs/DailyReportLog.tsx'), 'utf8');
ok("the Crew column returns null (—) when crewRecorded is false",
  /key: 'crew'[^\n]*value: \(r\) => \(r\.row\.crewRecorded \? r\.row\.crew : null\)/.test(logSrc));
ok("the Hours column returns null (—) when crewRecorded is false",
  /key: 'hours'[^\n]*value: \(r\) => \(r\.row\.crewRecorded \? fmtHours\(r\.row\.hours\) : null\)/.test(logSrc));

// ── 6. One title on the page ───────────────────────────────────────────────
console.log('\nthe log hides the route header (it draws its own title):');
ok('DailyReportLog renders <Stack.Screen options={{ headerShown: false }} />',
  /<Stack\.Screen options=\{\{ headerShown: false \}\} \/>/.test(logSrc));
// A file that hides the header is a screen shell to test:type-identity, so its
// in-page title must be the serif headline (and no fontWeight: fake-bold ceiling 0).
ok('the in-page title is Type.serifHeadline with no fontWeight',
  /\n  title: \{ \.\.\.Type\.serifHeadline, color: t\.text \},\n/.test(logSrc));

if (failures > 0) {
  console.error(`\n✗ validate-dfr-log: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\n✓ validate-dfr-log: the log opens only where it should, and says only what the report holds');
