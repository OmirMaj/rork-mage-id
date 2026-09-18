// scripts/validate-portal-calendar-days.ts — the static token pages must show
// the same days the GC's app shows.
//
// WHAT WENT WRONG (audit round 2, #29 and #30, both live on mageid.app).
//   • marketing/sub-portal/index.html dated a sub's tasks as CALENDAR days from
//     `new Date(projectStartDate)` (UTC midnight = the previous evening in the
//     US) with no `- 1` for the 1-based `startDay` ordinal and no weekend or
//     closure skip. Start Mon Oct 5, 5-day weeks, startDay 11 × 5 days: the app
//     and the homeowner portal say Oct 19 → Oct 23; the sub was told
//     Oct 15 → Oct 19. Punch due dates went through `new Date('YYYY-MM-DD')`
//     too and read a day early.
//   • marketing/architect/index.html formatted the RFI's calendar-day due date
//     (`toCalendarDayString`, a bare YYYY-MM-DD) as an instant, so the
//     architect saw "Tue, September 29" for an RFI due Wednesday the 30th; and
//     every non-2xx (a mangled token → 400) was reported as "Could not reach the
//     server", so a reviewer with a dead link retried forever.
//
// This runs the pages' OWN functions (lifted out of the HTML) in a US time
// zone against utils/scheduleEngine and each other.
//
// Run via: bun run scripts/validate-portal-calendar-days.ts
process.env.TZ = 'America/Chicago';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addWorkingDays as engineAddWorkingDays } from '../utils/scheduleEngine';
import { buildSubPortalSnapshot } from '../utils/subPortalSnapshot';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}
function eq<T>(name: string, got: T, want: T) {
  check(name, got === want, `(got ${String(got)}, want ${String(want)})`);
}

/** Lift `function NAME(...) {...}` out of a page by brace matching. */
function lift(html: string, name: string): string {
  const at = html.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`function ${name} not found`);
  let i = html.indexOf('{', at), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(at, i + 1);
  }
  throw new Error(`function ${name} unbalanced`);
}
function load<T>(html: string, names: string[], expose: string): T {
  const src = names.map(n => lift(html, n)).join('\n');
  return new Function(`${src}\nreturn ${expose};`)() as T;
}

const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

console.log('time zone is west of UTC (the case that broke):');
check('TZ=America/Chicago took effect', new Date(2026, 9, 5).getTimezoneOffset() > 0);

// ── #29 sub portal ─────────────────────────────────────────────────────────
const subHtml = read('marketing', 'sub-portal', 'index.html');
const portalHtml = read('marketing', 'portal', 'index.html');
type Range = { start: Date; end: Date } | null;
const sub = load<{
  parseCalendarDate: (v: string) => Date;
  subTaskDateRange: (a: Date | null, s: number, d: number, dpw: number, nw: string[] | null) => Range;
  addWorkingDays: (s: Date, n: number, dpw: number, nw: string[] | null) => Date;
  fmtCalendarDay: (v: string) => string;
}>(subHtml, ['fmtDate', 'parseCalendarDate', 'fmtCalendarDay', 'addWorkingDays', 'subTaskDateRange'],
  '{ parseCalendarDate, subTaskDateRange, addWorkingDays, fmtCalendarDay }');
const home = load<{
  parseCalendarDate: (v: string) => Date;
  addWorkingDays: (s: Date, n: number, dpw: number, nw: string[] | null) => Date;
}>(portalHtml, ['parseCalendarDate', 'addWorkingDays'], '{ parseCalendarDate, addWorkingDays }');

console.log('\nsub portal task dates (#29):');
{
  const r = sub.subTaskDateRange(sub.parseCalendarDate('2026-10-05'), 11, 5, 5, null);
  eq('the audit repro: startDay 11 × 5 days from Mon Oct 5 starts Mon Oct 19', r && local(r.start), '2026-10-19');
  eq('...and ends Fri Oct 23', r && local(r.end), '2026-10-23');
}
{
  // Agreement with the engine AND the homeowner portal across calendars.
  const starts = ['2026-10-05', '2026-11-20', '2026-12-28', '2027-03-06'];
  const closures: (string[] | null)[] = [null, ['2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01']];
  let mismatches = 0, cases = 0;
  const first: string[] = [];
  for (const s of starts) for (const dpw of [4, 5, 6, 7]) for (const nw of closures)
    for (const startDay of [1, 2, 6, 11, 40, 120]) for (const dur of [1, 3, 10]) {
      cases++;
      const engStart = engineAddWorkingDays(new Date(`${s}T00:00:00`), startDay - 1, dpw, nw ?? undefined);
      const engEnd = engineAddWorkingDays(engStart, dur - 1, dpw, nw ?? undefined);
      const r = sub.subTaskDateRange(sub.parseCalendarDate(s), startDay, dur, dpw, nw)!;
      const hs = home.addWorkingDays(home.parseCalendarDate(s), startDay - 1, dpw, nw);
      const he = home.addWorkingDays(hs, dur - 1, dpw, nw);
      const ok = local(r.start) === local(engStart) && local(r.end) === local(engEnd)
        && local(hs) === local(engStart) && local(he) === local(engEnd);
      if (!ok) { mismatches++; if (first.length < 3) first.push(`${s} dpw${dpw} sd${startDay} d${dur} nw=${!!nw}: sub ${local(r.start)}→${local(r.end)} home ${local(hs)}→${local(he)} engine ${local(engStart)}→${local(engEnd)}`); }
    }
  check(`sub portal, homeowner portal and scheduleEngine agree on all ${cases} task windows`, mismatches === 0, first.join(' | '));
}
check('a link shared before the calendar rode along falls back to a 5-day week, not calendar days',
  /var dpw = slice\.workingDaysPerWeek \|\| 5;/.test(subHtml));
check('renderSchedule walks working days (no calendar-day `* 86400000` offset)',
  !/offsetDays \* 86400000/.test(subHtml) && /subTaskDateRange\(anchor, t\.startDay, t\.durationDays, dpw, nonWorking\)/.test(subHtml));

console.log('\nsub portal punch due dates (#29):');
eq('a punch item due Oct 20 reads Oct 20 west of UTC', sub.fmtCalendarDay('2026-10-20'), 'Oct 20, 2026');
check('the punch due line uses the calendar-day formatter', /Due ' \+ esc\(fmtCalendarDay\(p\.dueDate\)\)/.test(subHtml));

console.log('\nthe snapshot carries the calendar (#29):');
{
  const snap = buildSubPortalSnapshot({
    link: { id: 'l1' } as never,
    project: { id: 'p1', name: 'Job' } as never,
    sub: { id: 's1', companyName: 'ABC Electric', trade: 'Electrical' } as never,
    commitments: [],
    schedule: {
      startDate: '2026-10-05', workingDaysPerWeek: 6, nonWorkingDates: ['2026-11-26'],
      tasks: [{ id: 't1', title: 'Rough-in', assignedSubId: 's1', startDay: 11, durationDays: 5, progress: 0, status: 'not_started' }],
    } as never,
  } as never) as { scheduleSlice?: { workingDaysPerWeek?: number; nonWorkingDates?: string[] } };
  eq('scheduleSlice.workingDaysPerWeek', snap.scheduleSlice?.workingDaysPerWeek, 6);
  eq('scheduleSlice.nonWorkingDates', snap.scheduleSlice?.nonWorkingDates?.join(','), '2026-11-26');
}

// ── #30 architect reply page ──────────────────────────────────────────────
console.log('\narchitect reply page (#30):');
const archHtml = read('marketing', 'architect', 'index.html');
const arch = load<{ fmtDate: (v: string) => string; loadFailureMessage: (e: unknown) => string }>(
  archHtml, ['fmtDate', 'loadFailureMessage'], '{ fmtDate, loadFailureMessage }');
check('an RFI due 2026-09-30 (bare calendar day) reads Wednesday the 30th',
  /Wed.*September 30, 2026/.test(arch.fmtDate('2026-09-30')), arch.fmtDate('2026-09-30'));
check('a picked date (noon-UTC instant) still reads its own day',
  /September 30, 2026/.test(arch.fmtDate('2026-09-30T12:00:00.000Z')), arch.fmtDate('2026-09-30T12:00:00.000Z'));
check('a 400 (mangled token) is a dead link, not a connection problem',
  /invalid or expired/.test(arch.loadFailureMessage({ status: 400 })));
check('a fetch rejection (no status) is still the connection message',
  /Check your connection/.test(arch.loadFailureMessage(new TypeError('Failed to fetch'))));
check('rpc() keeps the HTTP status on the error', /e\.status = r\.status;/.test(archHtml));
check('boot routes load failures through loadFailureMessage', /renderError\(loadFailureMessage\(err\)\)/.test(archHtml));

console.log(fail ? `\n✗ validate-portal-calendar-days: ${fail} failure(s)` : `\nall portal calendar-day checks passed (${pass})`);
if (fail) process.exit(1);
