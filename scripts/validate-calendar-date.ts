// validate-calendar-date.ts — calendar days must not move with the reader's
// timezone, and the guard ENUMERATES the parse sites instead of naming files.
//
// WHY THIS EXISTS. Due dates, applied dates, schedule start dates, waiver
// "through" dates, sub daily-update dates and forecast days are DAYS ON A
// CALENDAR, not instants. The spec parses a bare 'YYYY-MM-DD' as UTC midnight,
// so `new Date('2026-08-30').toLocaleDateString()` prints "Aug 29" anywhere
// west of Greenwich, and `new Date().toISOString().slice(0, 10)` names
// tomorrow from about 5–7 pm. utils/calendarDate.ts exists for exactly this.
//
// The first version of this guard pinned three call sites (punch list,
// safety hazards, StatusPipeline) — and the 2026-09-03 final-push audit found
// eleven more instances of the same bug (UX-F1–F4, F9–F11) in files the guard
// never looked at. A listing guard goes blind the moment the list is stale, so
// this one walks app/ and components/ and fails on every `new Date(<arg>)` /
// `Date.parse(<arg>)` whose ARGUMENT TEXT names a date-ish value — it contains
// date / Date / deadline / dueBy or ends in Iso / ISO (see DATE_ISH) — unless
// the call is (a) suffixed with 'T00:00:00', (b) on a line that already
// resolves via parseCalendarDay, or (c) in the dated ALLOWED list below with a
// reason. Every ALLOWED entry must still match a real site — a stale entry
// fails the run rather than silently widening it.
//
// What it does NOT see (B4 review A2 — the header used to claim "ANY"): an
// argument that is a string but not named like one. `new Date(doc.expiresAt)`,
// `new Date(value)` inside a helper, `new Date(row.when)` are all invisible
// here; the enumerator is textual and has no types. Those sites are covered
// only when a reviewer reads them — app/documents.tsx's expiresAt is one that
// was, and is now normalised at its source.
//
// Runtime checks run under THREE timezones (Denver, UTC, Tokyo) by re-spawning
// this script with TZ set, so a helper that only works east or west of
// Greenwich cannot pass on the developer's machine and fail on the user's.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import {
  formatCalendarDay, parseCalendarDay, toCalendarDayString, todayCalendarDay, daysUntilCalendarDay,
  addCalendarMonths, addCalendarDays, calendarDayOf, calendarDayStart,
} from '../utils/calendarDate';
import { addWorkingDays } from '../utils/scheduleEngine';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const TZ_CHILD_FLAG = 'CALENDAR_DATE_TZ_CHILD';
const TIMEZONES = ['America/Denver', 'UTC', 'Asia/Tokyo'];

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  }
}

function eq(label: string, got: unknown, want: unknown) {
  ok(label, got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Runtime checks — executed once per timezone in a child process.
// ═══════════════════════════════════════════════════════════════════════════

function runtimeChecks() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  console.log(`\n[TZ=${tz}] calendar days are timezone-stable:`);
  {
    eq('bare YYYY-MM-DD formats to the same day', formatCalendarDay('2026-08-30'), 'Aug 30, 2026');
    eq('New Year\'s Day does not roll back a year', formatCalendarDay('2026-01-01'), 'Jan 1, 2026');
    eq('leap day survives', formatCalendarDay('2028-02-29'), 'Feb 29, 2028');
    eq('options shape the label without moving the day',
      formatCalendarDay('2026-09-10', { weekday: 'long', month: 'long', day: 'numeric' }), 'Thursday, September 10');

    // The guard that actually matters: parse must land on local midnight of
    // the requested day, so getDate() round-trips no matter what TZ the
    // process runs in. Under `new Date(iso)` this is off by one west of
    // Greenwich.
    const d = parseCalendarDay('2026-08-30');
    ok('parse lands on the requested calendar day, not UTC midnight',
      d !== null && d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 30,
      `got ${d?.toString()}`);
    eq('parse lands at local midnight', d?.getHours(), 0);
  }

  console.log(`[TZ=${tz}] the string ↔ Date round-trip is lossless:`);
  {
    eq('toCalendarDayString(parseCalendarDay(x)) === x', toCalendarDayString(parseCalendarDay('2026-08-30')!), '2026-08-30');
    eq('… on New Year\'s Eve', toCalendarDayString(parseCalendarDay('2026-12-31')!), '2026-12-31');
    eq('… on a leap day', toCalendarDayString(parseCalendarDay('2028-02-29')!), '2028-02-29');
    const late = new Date(2026, 7, 31, 23, 30); // 11:30 pm local, Aug 31
    eq('todayCalendarDay names the LOCAL day at 11:30 pm', todayCalendarDay(late), '2026-08-31');
    const early = new Date(2026, 8, 1, 0, 30); // 12:30 am local, Sep 1
    eq('todayCalendarDay names the LOCAL day at 12:30 am', todayCalendarDay(early), '2026-09-01');
    ok('toISOString().slice(0, 10) is NOT what todayCalendarDay returns in at least one direction',
      // Denver: 11:30 pm Aug 31 is Sep 1 UTC; Tokyo: 12:30 am Sep 1 is Aug 31 UTC; UTC: both agree.
      tz === 'UTC' || late.toISOString().slice(0, 10) !== '2026-08-31' || early.toISOString().slice(0, 10) !== '2026-09-01');
  }

  console.log(`[TZ=${tz}] whole-day countdowns ignore DST and the clock:`);
  {
    const evening = new Date(2026, 8, 3, 19, 30); // Sep 3, 7:30 pm local
    eq('a day named today is 0 days away even in the evening', daysUntilCalendarDay('2026-09-03', evening), 0);
    eq('tomorrow is 1', daysUntilCalendarDay('2026-09-04', evening), 1);
    eq('yesterday is -1', daysUntilCalendarDay('2026-09-02', evening), -1);
    // US DST ends 2026-11-01; a 25-hour day must still count as one.
    eq('crossing the DST fall-back still counts whole days', daysUntilCalendarDay('2026-11-02', new Date(2026, 9, 31, 12)), 2);
    eq('crossing the DST spring-forward still counts whole days', daysUntilCalendarDay('2026-03-09', new Date(2026, 2, 7, 12)), 2);
    eq('unparseable input is null, not NaN', daysUntilCalendarDay('soon', evening), null);
  }

  console.log(`[TZ=${tz}] a mixed-shape field resolves to the day the record was made (B4 review A4):`);
  {
    eq('a bare day is kept', calendarDayOf('2026-09-04'), '2026-09-04');
    eq('a rolled-over bare day is rejected', calendarDayOf('2026-02-30'), null);
    // 9 pm local on Sep 4, whatever the zone — its toISOString() may start with Sep 5.
    const evening = new Date(2026, 8, 4, 21, 0).toISOString();
    eq('an evening instant names its LOCAL day, not its UTC date', calendarDayOf(evening), '2026-09-04');
    eq('a noon-UTC DatePickerModal instant names its day', calendarDayOf('2026-09-04T12:00:00.000Z'), '2026-09-04');
    eq('garbage is null', calendarDayOf('later'), null);
    eq('empty is null', calendarDayOf(''), null);
  }

  console.log(`[TZ=${tz}] a mixed-shape field's day STARTS at local midnight of that day (B4 review A2 — overdueCalendarDays, client-view formatDate, the RFI log/email):`);
  {
    const bare = calendarDayStart('2026-09-15');
    ok('a bare day starts at local midnight of that day',
      bare !== null && toCalendarDayString(bare) === '2026-09-15' && bare.getHours() === 0, `got ${bare?.toString()}`);
    eq('a noon-UTC DatePickerModal instant starts on its own day', toCalendarDayString(calendarDayStart('2026-09-15T12:00:00.000Z')!), '2026-09-15');
    const evening = new Date(2026, 8, 4, 21, 0); // 9 pm local Sep 4 — its toISOString() may start with Sep 5
    eq('an evening instant starts on its LOCAL day', toCalendarDayString(calendarDayStart(evening.toISOString())!), '2026-09-04');
    eq('garbage is null', calendarDayStart('soon'), null);
    // The defect: the spec parses a bare day as UTC midnight — the previous local day west of Greenwich.
    ok('in America/Denver the naive parse of the bare day really names Sep 14',
      tz !== 'America/Denver' || toCalendarDayString(new Date('2026-09-15')) === '2026-09-14');
  }

  console.log(`[TZ=${tz}] month arithmetic clamps to the end of the target month (B4 review item 1):`);
  {
    // The three values app/warranties.tsx used to store in warranties.end_date.
    eq('Jan 31 + 1 month is Feb 28, not Mar 3', addCalendarMonths('2026-01-31', 1), '2026-02-28');
    eq('a leap day + 12 months is Feb 28 of the next year, not Mar 1', addCalendarMonths('2028-02-29', 12), '2029-02-28');
    eq('Aug 31 + 6 months is Feb 28, not Mar 3', addCalendarMonths('2026-08-31', 6), '2027-02-28');
    eq('Jan 31 + 1 month in a leap year is Feb 29', addCalendarMonths('2028-01-31', 1), '2028-02-29');
    eq('a mid-month day is untouched', addCalendarMonths('2026-03-15', 12), '2027-03-15');
    eq('Mar 31 + 1 month is Apr 30', addCalendarMonths('2026-03-31', 1), '2026-04-30');
    eq('crossing a year boundary', addCalendarMonths('2026-11-20', 3), '2027-02-20');
    eq('a full ISO timestamp is read by its date part', addCalendarMonths('2026-01-31T00:00:00.000Z', 1), '2026-02-28');
    eq('unparseable input is null', addCalendarMonths('next year', 1), null);
    eq('empty input is null', addCalendarMonths('', 1), null);
  }

  console.log(`[TZ=${tz}] day arithmetic survives the DST fall-back (B4 review item 2):`);
  {
    // US DST ends 2026-11-01 (a Sunday): the day is 25 hours long, so
    // `getTime() + 1 * 86_400_000` from Nov 1 midnight lands on Nov 1 23:00
    // in Denver and getDate() names the wrong day from then on.
    const nov1 = parseCalendarDay('2026-11-01')!;
    eq('Nov 1 + 1 day is Nov 2', toCalendarDayString(addCalendarDays(nov1, 1)), '2026-11-02');
    eq('Nov 1 + 7 days is Nov 8', toCalendarDayString(addCalendarDays(nov1, 7)), '2026-11-08');
    eq('Nov 1 - 1 day is Oct 31', toCalendarDayString(addCalendarDays(nov1, -1)), '2026-10-31');
    eq('Oct 31 + 2 days crosses the fall-back to Nov 2', toCalendarDayString(addCalendarDays(parseCalendarDay('2026-10-31')!, 2)), '2026-11-02');
    eq('Mar 7 + 2 days crosses the spring-forward to Mar 9', toCalendarDayString(addCalendarDays(parseCalendarDay('2026-03-07')!, 2)), '2026-03-09');
    eq('the result is local midnight', addCalendarDays(nov1, 1).getHours(), 0);
    // Only meaningful in a zone that observes US DST; in UTC/Tokyo the two agree.
    const msWalk = new Date(nov1.getTime() + 86_400_000);
    ok('in America/Denver the millisecond walk really does land on the wrong day',
      tz !== 'America/Denver' || msWalk.getDate() === 1,
      `ms walk from Nov 1 gave ${msWalk.toString()}`);
    // components/schedule/mobile/MonthCalendarSheet.tsx activeDayKeys walks a
    // task's days with addWorkingDays and keys them y-getMonth()-getDate(); on
    // a 7-day week the walk passes THROUGH the fall-back day. The ms walk keyed
    // Nov 1 twice and never Nov 2 in Denver (B4 review item 2).
    const keys: string[] = [];
    let day = addWorkingDays(parseCalendarDay('2026-10-26')!, 5, 7); // startDay 6 on a Mon anchor → Sat Oct 31
    for (let k = 0; k < 3; k++) { keys.push(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`); day = addWorkingDays(day, 1, 7); }
    eq('a 7-day-week task walked through the fall-back keys Oct 31, Nov 1, Nov 2', keys.join(' '), '2026-9-31 2026-10-1 2026-10-2');
    const wk: string[] = [];
    day = addWorkingDays(parseCalendarDay('2026-10-26')!, 5, 5); // startDay 6 on a 5-day week → Mon Nov 2
    for (let k = 0; k < 3; k++) { wk.push(toCalendarDayString(day)); day = addWorkingDays(day, 1, 5); }
    eq('a 5-day-week task after the fall-back keys Nov 2, 3, 4 (not Sat Oct 31)', wk.join(' '), '2026-11-02 2026-11-03 2026-11-04');
  }

  console.log(`[TZ=${tz}] local and Supabase-synced rows agree:`);
  {
    eq('full ISO timestamp truncates to its date part',
      formatCalendarDay('2026-08-30T00:00:00.000Z'), 'Aug 30, 2026');
    ok('a synced row renders identically to the local row',
      formatCalendarDay('2026-08-30T00:00:00.000Z') === formatCalendarDay('2026-08-30'));
    ok('a timestamp late in the UTC day still uses its own date part',
      formatCalendarDay('2026-08-30T23:59:59Z') === formatCalendarDay('2026-08-30'));
  }

  console.log(`[TZ=${tz}] bad input is never dressed up as a real date:`);
  {
    eq('month 13 is rejected, not rolled into next year', formatCalendarDay('2026-13-01'), '2026-13-01');
    eq('day 45 is rejected, not rolled into the next month', formatCalendarDay('2026-01-45'), '2026-01-45');
    eq('Feb 30 is rejected in a non-leap year', formatCalendarDay('2027-02-30'), '2027-02-30');
    eq('Feb 29 is rejected in a non-leap year', formatCalendarDay('2027-02-29'), '2027-02-29');
    eq('free text is echoed back', formatCalendarDay('next tuesday'), 'next tuesday');
    eq('empty string yields empty string', formatCalendarDay(''), '');
    eq('null yields empty string', formatCalendarDay(null), '');
    eq('undefined yields empty string', formatCalendarDay(undefined), '');
    eq('parse rejects month 13', parseCalendarDay('2026-13-01'), null);
    eq('parse rejects day 45', parseCalendarDay('2026-01-45'), null);
  }
}

if (process.env[TZ_CHILD_FLAG]) {
  runtimeChecks();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Parent: run the runtime checks under each timezone ────────────────────

console.log('\nruntime checks under three timezones:');
for (const tz of TIMEZONES) {
  const res = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TZ: tz, [TZ_CHILD_FLAG]: '1' },
    encoding: 'utf8',
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  const childFails = out.split('\n').filter(l => /^\s*FAIL /.test(l));
  ok(`TZ=${tz}: every runtime check passes`, res.status === 0 && childFails.length === 0,
    childFails.join('\n       ') || out.slice(-400));
  const resolved = /\[TZ=([^\]]+)\]/.exec(out)?.[1];
  ok(`TZ=${tz}: the child actually ran in that zone`, resolved === tz, `child reported ${resolved}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Source enumeration — every date-ish parse in app/ and components/.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sites that parse a date-ish expression with `new Date()` / `Date.parse()`
 * and have been READ and judged safe. `line` is the exact call text (not a
 * line number — numbers drift with every edit above them). Every entry must
 * still match a live site; a stale entry fails the run.
 */
interface Allowed { file: string; line: string; reason: string; added: string }
const ALLOWED: Allowed[] = [
  // ── Full ISO instants (written with toISOString()), never a bare day ──
  { file: 'app/daily-report.tsx', line: 'new Date(reportDate)', added: '2026-09-04',
    reason: 'reportDate is an instant — useState(new Date().toISOString()) / DatePickerModal.onChange(picked.toISOString()); daily_reports.date is a text column that round-trips it unchanged' },
  { file: 'app/daily-report.tsx', line: 'new Date(lastReport.date)', added: '2026-09-04',
    reason: 'DailyFieldReport.date is the same instant as reportDate (saved as `date: reportDate`)' },
  { file: 'app/daily-report.tsx', line: 'Date.parse(b.date)', added: '2026-09-04',
    reason: 'sort key over DailyFieldReport.date instants; ordering is unaffected by the UTC/local question' },
  { file: 'app/daily-report.tsx', line: 'Date.parse(a.date)', added: '2026-09-04',
    reason: 'sort key over DailyFieldReport.date instants (the other half of the same comparator)' },
  { file: 'app/report-inbox.tsx', line: 'new Date(dr.date)', added: '2026-09-04',
    reason: 'DailyFieldReport.date is a full ISO instant (see app/daily-report.tsx), so an instant parse names the local day correctly' },
  // RFI.dateRequired is NOT an instant: app/photo-triage.tsx and the voice
  // parsers write a bare 'YYYY-MM-DD', DatePickerModal writes noon UTC, and
  // app/rfi.tsx's two-week default is a bare local day. Every screen reader
  // (report-inbox, weekly-snapshot, project-detail, rfi.tsx) resolves it
  // parseCalendarDay-first (daysUntilCalendarDay / formatCalendarDay), so no
  // `new Date(…dateRequired)` site remains to allow (B4 review A2). The
  // readers this enumerator CANNOT see — app/client-view.tsx formatDate(iso),
  // utils/delayScan/rfiBlocking.ts overdueCalendarDays (behind app/rfi.tsx's
  // overdue badge) and the utils/ readers (pdfGenerator RFI log, emailService,
  // mageAgent, rfiLatency, oacEngine) — go through calendarDayStart, which
  // keeps a true instant on its local day; pinned in the runtime block above.
  { file: 'app/report-inbox.tsx', line: 'new Date(r.dateSubmitted ?? r.createdAt)', added: '2026-09-04',
    reason: 'both are toISOString() instants — app/rfi.tsx (`dateSubmitted: now`) and app/photo-triage.tsx (same, since B4 review A2; it used to write the bare UTC day)' },
  { file: 'app/report-inbox.tsx', line: 'new Date(s.submittedDate ?? s.createdAt)', added: '2026-09-04',
    reason: 'both are toISOString() instants (app/submittal.tsx:244)' },
  { file: 'app/report-inbox.tsx', line: 'new Date(inv.dueDate)', added: '2026-09-04',
    reason: 'Invoice.dueDate is an instant — app/invoice.tsx getDueDate() returns toISOString()' },
  { file: 'app/report-inbox.tsx', line: 'new Date(inv.issueDate ?? inv.createdAt)', added: '2026-09-04',
    reason: 'Invoice.issueDate = now (a toISOString() instant) in app/invoice.tsx buildNewInvoice' },
  { file: 'app/reports.tsx', line: 'new Date(r.issueDate)', added: '2026-09-04', reason: 'Invoice.issueDate instant (see report-inbox entry)' },
  { file: 'app/reports.tsx', line: 'new Date(r.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant (getDueDate → toISOString())' },
  { file: 'app/submittal.tsx', line: 'new Date(cycle.sentDate)', added: '2026-09-04', reason: 'sentDate = new Date().toISOString() (app/submittal.tsx:205/264)' },
  { file: 'app/submittal.tsx', line: 'new Date(cycle.returnDate)', added: '2026-09-04', reason: 'returnDate is stamped with toISOString() alongside sentDate' },
  { file: 'app/(tabs)/discover/bids.tsx', line: 'new Date(deadline)', added: '2026-09-04', reason: 'getDeadlineInfo(bid.response_deadline): public_bids.response_deadline is timestamptz (schema.sql:374)' },
  { file: 'app/(tabs)/discover/bids.tsx', line: 'new Date(bid.response_deadline)', added: '2026-09-04', reason: 'timestamptz column (schema.sql:374)' },
  { file: 'app/(tabs)/discover/bids.tsx', line: 'new Date(a.posted_date)', added: '2026-09-04', reason: 'posted_date is timestamptz (schema.sql:373)' },
  { file: 'app/(tabs)/discover/bids.tsx', line: 'new Date(b.posted_date)', added: '2026-09-04', reason: 'posted_date is timestamptz (schema.sql:373)' },
  { file: 'app/(tabs)/mage-id-bids/index.tsx', line: 'new Date(b.posted_date)', added: '2026-09-04', reason: 'homeowner RFP posted_date = new Date().toISOString() (app/post-rfp.tsx:390); sort key' },
  { file: 'app/(tabs)/mage-id-bids/index.tsx', line: 'new Date(a.posted_date)', added: '2026-09-04', reason: 'same sort key, other operand' },
  { file: 'app/nearby-rfps.tsx', line: 'new Date(b.posted_date)', added: '2026-09-04', reason: 'posted_date instant (app/post-rfp.tsx:390); sort key' },
  { file: 'app/nearby-rfps.tsx', line: 'new Date(a.posted_date)', added: '2026-09-04', reason: 'same sort key, other operand' },
  { file: 'app/cash-flow.tsx', line: 'new Date(inv.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant' },
  { file: 'app/cash-flow.tsx', line: 'new Date(ep.expectedDate)', added: '2026-09-04', reason: 'expectedDate: date.toISOString() (app/cash-flow.tsx:360)' },
  { file: 'app/bid-detail.tsx', line: 'new Date(dateStr)', added: '2026-09-04', reason: 'formats public_bids timestamptz fields (posted_date / response_deadline)' },
  { file: 'app/bid-detail.tsx', line: 'new Date(deadline)', added: '2026-09-04', reason: 'getCountdown(bid.response_deadline): timestamptz' },
  { file: 'app/retention.tsx', line: 'new Date(inv.issueDate)', added: '2026-09-04', reason: 'Invoice.issueDate instant' },
  { file: 'app/payments.tsx', line: 'new Date(a.issueDate)', added: '2026-09-04', reason: 'Invoice.issueDate instant; sort key' },
  { file: 'app/payments.tsx', line: 'new Date(b.issueDate)', added: '2026-09-04', reason: 'same sort key, other operand' },
  { file: 'app/client-view.tsx', line: "new Date(co.approvers.find(a => a.role === 'Client' && a.status === 'approved')?.responseDate ?? co.updatedAt)", added: '2026-09-04',
    reason: 'responseDate: now, where now = new Date().toISOString() (app/client-view.tsx submitApproval, both approver entries); updatedAt is an instant' },
  { file: 'app/invoice.tsx', line: 'new Date(issueDate)', added: '2026-09-04', reason: 'getDueDate(issueDate): issueDate is the toISOString() instant buildNewInvoice writes (issueDate: now)' },
  { file: 'app/invoice.tsx', line: 'new Date(existingInvoice.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant' },
  { file: 'app/invoice.tsx', line: 'new Date(r.date)', added: '2026-09-04', reason: 'payment record date = new Date().toISOString() (app/invoice.tsx handleMarkPaid / handleReleaseRetention)' },
  { file: 'app/invoice.tsx', line: 'new Date(p.date)', added: '2026-09-04', reason: 'payment record date instant (same writer)' },
  { file: 'app/post-bid.tsx', line: 'new Date(deadline.trim())', added: '2026-09-04', reason: 'validity gate only — the regex on the next line enforces YYYY-MM-DD and the Date value is not used for a day' },
  { file: 'app/shared-photos.tsx', line: 'new Date(dates[0])', added: '2026-09-04', reason: 'photo capture timestamps (payload.photos[].ts), instants' },
  { file: 'app/shared-photos.tsx', line: 'new Date(dates[dates.length - 1])', added: '2026-09-04', reason: 'photo capture timestamps, instants' },
  { file: 'app/project-detail.tsx', line: 'new Date(inv.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant' },
  { file: 'app/project-detail.tsx', line: 'new Date(dr.date)', added: '2026-09-04', reason: 'DailyFieldReport.date instant (see app/daily-report.tsx)' },
  { file: 'app/project-detail.tsx', line: 'new Date(b.date)', added: '2026-09-04', reason: 'DFR sort key over instants' },
  { file: 'app/project-detail.tsx', line: 'new Date(a.date)', added: '2026-09-04', reason: 'DFR sort key, other operand' },
  { file: 'components/AIInvoicePredictor.tsx', line: 'new Date(inv.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant' },
  { file: 'components/AIInvoicePredictor.tsx', line: 'new Date(lastPayment.date)', added: '2026-09-04', reason: 'payment record date instant (app/invoice.tsx handleMarkPaid / handleReleaseRetention)' },
  { file: 'components/AIInvoicePredictor.tsx', line: 'new Date(invoice.dueDate)', added: '2026-09-04', reason: 'Invoice.dueDate instant' },
  { file: 'components/NextStepHero.tsx', line: 'new Date(r.dateSubmitted ?? Date.now())', added: '2026-09-04', reason: 'RFI.dateSubmitted instant (app/rfi.tsx:287, dateSubmitted: now)' },
  // ── Clones of a Date instance (the parameter is typed Date), not parses ──
  { file: 'app/schedule-wizard.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'addDays(date: Date) clone' },
  { file: 'components/schedule/InteractiveGantt.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'addDays(date: Date) clone' },
  { file: 'components/schedule/GanttChart.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'addDays(date: Date) clone' },
  { file: 'components/schedule/ResourceSwimlanes.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'addDays(date: Date) clone' },
  { file: 'components/schedule/LookaheadView.tsx', line: 'new Date(date)', added: '2026-09-04', reason: 'getMonday(date: Date) clone' },
  { file: 'components/schedule/VerticalGantt.tsx', line: 'new Date(projectStartDate)', added: '2026-09-04', reason: 'projectStartDate is a Date prop; clone before setDate()' },
  { file: 'components/schedule/mobile/WeekStrip.tsx', line: 'new Date(selectedDate)', added: '2026-09-04', reason: 'selectedDate is a Date; clone before shifting a week' },
  { file: 'components/schedule/TaskInspector.tsx', line: 'new Date(startDate)', added: '2026-09-04', reason: 'dayToDate(startDate: Date, …) clone' },
  { file: 'components/schedule/WeatherReschedulePrompt.tsx', line: 'new Date(startDate)', added: '2026-09-04', reason: 'clone of the local `startDate` Date inside the push loop (:57)' },
  { file: 'components/schedule/WeatherReschedulePrompt.tsx', line: 'new Date(projectStartDate)', added: '2026-09-04', reason: 'projectStartDate is a Date prop; clone before setDate() (:95)' },
];

/**
 * Sites that are NOT resolved and NOT judged safe. They are listed here — not
 * in ALLOWED — so the guard passes on the tree the 2026-09-04 fix pass left
 * without lying about them: every entry is either a bare-day-as-UTC defect in
 * a file outside that pass's file set, or a field whose writer could not be
 * traced to a format. Fix the site (or verify the writer) and DELETE the entry;
 * a stale entry fails the run.
 */
interface Unresolved extends Allowed { status: 'defect' | 'unverified' }
const UNRESOLVED: Unresolved[] = [
  { file: 'app/time-tracking.tsx', line: 'new Date(entry.date)', status: 'defect', added: '2026-09-04',
    reason: 'hooks/useTimeEntries.ts:307 writes the UTC day (toISOString().split(\'T\')[0]) and this parses it as UTC — history weekday is a day early and the writer flips at 5–6 pm local (audit appendix)' },
  { file: 'app/oac-meeting.tsx', line: 'new Date(a.dueBy)', status: 'defect', added: '2026-09-04',
    reason: 'AI-extracted "ISO date" (bare) parsed as UTC in the minutes and the exported HTML — two sites, one snippet (audit appendix)' },
  { file: 'app/(tabs)/mage-id-bids/index.tsx', line: 'new Date(r.deadline)', status: 'defect', added: '2026-09-04',
    reason: 'homeowner deadline is typed as YYYY-MM-DD (app/post-rfp.tsx:898) and stored bare; daysLeft is one short west of Greenwich. Fix: daysUntilCalendarDay. Outside the B4 edit region (Nearby entry only)' },
  { file: 'app/nearby-rfps.tsx', line: 'new Date(r.deadline)', status: 'defect', added: '2026-09-04',
    reason: 'same bare deadline as mage-id-bids; B4 owned copy only' },
  { file: 'components/schedule/SchedulerHeader.tsx', line: 'new Date(t.deadline)', status: 'defect', added: '2026-09-04',
    reason: 'overdue count parses the bare deadline as UTC midnight — overdue from ~6 pm the evening before (UX-F9 class); file not in the B4 set' },
  { file: 'components/schedule/WeatherReschedulePrompt.tsx', line: 'new Date(startISO)', status: 'defect', added: '2026-09-04',
    reason: 'startISO is toISOString().split(\'T\')[0] of a local date (the UTC day) re-parsed as UTC; forecast-day matching drifts at negative offsets. validate-schedule-date-basis.ts calls this a clone — it is not' },
  { file: 'app/buyout.tsx', line: 'new Date(p.requiredByDate)', status: 'unverified', added: '2026-09-04',
    reason: 'mapped from required_by_date (contexts/ProjectContext.tsx bidPackagesQuery row mapping); no writer found in app code, so the format is unknown' },
  { file: 'app/buyout.tsx', line: 'new Date(pkg.requiredByDate)', status: 'unverified', added: '2026-09-04', reason: 'same field as above' },
  { file: 'app/equipment-detail.tsx', line: 'new Date(u.date)', status: 'unverified', added: '2026-09-04',
    reason: 'EquipmentUtilizationEntry.date — logUtilization callers were not traced to a format' },
  { file: 'app/equipment-detail.tsx', line: 'new Date(a.date)', status: 'unverified', added: '2026-09-04', reason: 'same field, sort key' },
  { file: 'app/equipment-detail.tsx', line: 'new Date(b.date)', status: 'unverified', added: '2026-09-04', reason: 'same field, sort key' },
  { file: 'app/(tabs)/subs/index.tsx', line: 'new Date(bid.date)', status: 'unverified', added: '2026-09-04',
    reason: 'SubBidRecord.date — writer not traced' },
  { file: 'app/cash-flow.tsx', line: 'new Date(dw.weekDate)', status: 'unverified', added: '2026-09-04',
    reason: 'utils/cashFlowEngine.ts weekStart string; construction not verified' },
];

interface Hit { file: string; lineNo: number; snippet: string }

/** Block comments become spaces (line numbers survive); `//` comments are cut
 *  unless the `//` sits inside a string literal (odd quote count before it). */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return noBlocks.split('\n').map(line => {
    let from = 0;
    for (;;) {
      const i = line.indexOf('//', from);
      if (i < 0) return line;
      const before = line.slice(0, i);
      const inString = ["'", '"', '`'].some(q => (before.split(q).length - 1) % 2 === 1);
      if (!inString) return before;
      from = i + 2;
    }
  }).join('\n');
}

// `Iso`/`ISO` suffixes are included because the schedule anchors travel under
// names like baseIso / projectStartISO / startISO and carry calendar days.
// `updatedAt`-style instants contain "date" by accident and are stripped
// before the test.
const DATE_ISH = /date|Date|deadline|dueBy|Iso\b|ISO\b/;

/** Every `new Date(<arg>)` / `Date.parse(<arg>)` whose <arg> names a date-ish
 *  value and is not already resolved as a calendar day. */
function findDateParses(file: string, src: string): Hit[] {
  const code = stripComments(src);
  const hits: Hit[] = [];
  const re = /\b(new\s+Date|Date\.parse)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    // Balanced-paren scan for the argument list.
    let depth = 1;
    let i = m.index + m[0].length;
    const argStart = i;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    const arg = code.slice(argStart, i - 1).trim();
    const lineNo = code.slice(0, m.index).split('\n').length;
    const line = code.split('\n')[lineNo - 1] ?? '';
    const snippet = `${m[1].replace(/\s+/g, ' ')}(${arg})`;

    if (arg === '') continue;                        // new Date()
    if (/^Date\.(now\(\)|UTC\()/.test(arg)) continue; // an instant / instant arithmetic
    if (/^\d+$/.test(arg)) continue;                 // epoch millis literal
    if (/\.getTime\(\)|\bMs\b|Millis/.test(arg)) continue; // millisecond arithmetic
    if (/,/.test(arg.replace(/\([^()]*\)/g, ''))) continue; // new Date(y, m, d) components
    if (!DATE_ISH.test(arg.replace(/\b\w*[uU]pdatedAt\b/g, ''))) continue;
    if (/T\d\d:\d\d:\d\d/.test(arg)) continue;       // explicit local-time suffix ('T00:00:00', 'T12:00:00')
    if (/parseCalendarDay\(/.test(line)) continue;   // resolved on the same line
    hits.push({ file, lineNo, snippet });
  }
  return hits;
}

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== 'node_modules') out.push(...listSources(full)); }
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

console.log('\nthe enumerator itself still sees the bug:');
{
  const bad = findDateParses('x.tsx', `const a = new Date(item.dueDate);\nconst b = Date.parse(sched.startDate);\nconst c = new Date(f.date).toLocaleDateString();\nconst d = Date.parse(baseIso); const e = new Date(payload.projectStartISO);`);
  eq('flags bare parses of dueDate / startDate / f.date / baseIso / projectStartISO', bad.length, 5);
  const guarded = findDateParses('x.tsx', [
    `const a = new Date(item.dueDate + 'T00:00:00');`,
    `const b = parseCalendarDay(iso) ?? new Date(iso.startDate);`,
    `const c = new Date(); const d = new Date(Date.now()); const e = new Date(baseMs);`,
    `const f = new Date(d.getFullYear(), d.getMonth(), 1); const g = new Date(now);`,
    `const k = new Date(row.updatedAt); const l = new Date(Date.now() + 7 * 86400000); const m = new Date(Date.UTC(y, mo, d, 12));`,
    `const n = new Date(dateISO + 'T12:00:00');`,
    `// const h = new Date(task.deadline);`,
    `/* new Date(schedule.startDate) */ const i = 1;`,
  ].join('\n'));
  eq('ignores the T00:00:00 suffix, parseCalendarDay lines, instants, components and comments', guarded.length, 0);
  const url = findDateParses('x.tsx', `const u = 'https://x.test/a'; const j = new Date(row.dueDate);`);
  eq('a // inside a string does not hide the rest of the line', url.length, 1);
}

console.log('\nevery date-ish parse in app/ and components/ is resolved or allowed:');
{
  const files = [...listSources(join(ROOT, 'app')), ...listSources(join(ROOT, 'components'))];
  const hits: Hit[] = [];
  for (const full of files) {
    const rel = full.slice(ROOT.length + 1);
    hits.push(...findDateParses(rel, readFileSync(full, 'utf8')));
  }
  const matched = new Set<Allowed>();
  const known = new Set<Unresolved>();
  // Fixed since the 2026-09-04 pass (B4 review): app/(tabs)/schedule/index.tsx
  // `new Date(date)` (open-meteo day vs a noon-anchored task range — now a
  // calendar-day comparison) and app/documents.tsx `new Date(p.expiresDate)`
  // (permits.expires_date is a `date` column, supabase/schema.sql ~1245 — not
  // text as the old entry claimed; now normalised at the aggregation site).
  const unallowed = hits.filter(h => {
    const entry = ALLOWED.find(a => a.file === h.file && a.line === h.snippet);
    if (entry) { matched.add(entry); return false; }
    const listed = UNRESOLVED.find(a => a.file === h.file && a.line === h.snippet);
    if (listed) { known.add(listed); return false; }
    return true;
  });
  ok(`scanned ${files.length} source files`, files.length > 300, `only ${files.length} files found`);
  ok(`no new date-ish parse (found ${hits.length} candidate(s): ${hits.length - unallowed.length - hits.filter(h => UNRESOLVED.some(u => u.file === h.file && u.line === h.snippet)).length} allowed, ${hits.filter(h => UNRESOLVED.some(u => u.file === h.file && u.line === h.snippet)).length} listed unresolved)`,
    unallowed.length === 0,
    unallowed.map(h => `${h.file}:${h.lineNo}: ${h.snippet}  → parseCalendarDay / formatCalendarDay / todayCalendarDay, or add to ALLOWED with a reason`).join('\n       '));
  const stale = ALLOWED.filter(a => !matched.has(a));
  ok('every ALLOWED entry still matches a live site (no blind entries)', stale.length === 0,
    stale.map(a => `${a.file}: ${a.line}`).join('\n       '));
  const staleKnown = UNRESOLVED.filter(a => !known.has(a));
  ok('every UNRESOLVED entry still matches a live site (delete the entry when the site is fixed)', staleKnown.length === 0,
    staleKnown.map(a => `${a.file}: ${a.line}`).join('\n       '));
  const defects = UNRESOLVED.filter(u => u.status === 'defect').length;
  console.log(`       ${defects} known defect(s) and ${UNRESOLVED.length - defects} unverified site(s) remain listed in UNRESOLVED — outside the 2026-09-04 fix set`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Unrelated guards that have always lived in this file — kept so the rewrite
// does not silently drop coverage.
// ═══════════════════════════════════════════════════════════════════════════

// ── The filter rail can share its row with the More-filters button ────────
// Yoga's DefaultFlexShrink is 0.0f on native (Style.h), so a horizontal
// ScrollView sized from its own content cannot give width back to a sibling —
// the audited "filter chips clipped by the filter button". `flex: 1` fixes it
// through flexBasis, not shrink: processFlexBasis (Node.cpp) resolves a
// positive flex with auto basis to points(0) on native, so the rail starts at
// zero and grows into the leftover space. Layout is invisible to a render
// test, so the style is pinned textually instead.

console.log('\nthe punch-list filter rail is flexible:');
{
  const punch = read('app/punch-list.tsx');
  ok('filterScroll declares flex: 1', /filterScroll: \{[^}]*flex: 1/.test(punch),
    (punch.match(/filterScroll: \{[^}]*\}/) ?? []).join(''));
  ok('the horizontal ScrollView in the filter bar applies it',
    /style=\{styles\.filterScroll\}/.test(punch));
}

// ── The header eyebrow carries the real brand ─────────────────────────────
// Pre-launch de-brand left 43 eyebrows reading "· MAGE" instead of the
// product name, "MAGE ID". Every app/ and components/ eyebrow is covered —
// no path is excluded. Prose uses of MAGE (the assistant's name in "Ask
// MAGE") are deliberately NOT covered here — only the brand line.

console.log('\nheader eyebrows say MAGE ID:');
{
  const stale: string[] = [];
  for (const full of [...listSources(join(ROOT, 'app')), ...listSources(join(ROOT, 'components'))]) {
    if (!full.endsWith('.tsx')) continue;
    const src = readFileSync(full, 'utf8');
    for (const line of src.split('\n')) {
      // Only the eyebrow/brand-line form: "… · MAGE" immediately closing a
      // JSX text node or a string prop. Prose like "· MAGE never stores…"
      // does not match and is left to a product decision.
      if (/· MAGE(?=["<])/.test(line)) stale.push(`${full.slice(ROOT.length + 1)}: ${line.trim()}`);
    }
  }
  ok('no header eyebrow still reads "· MAGE"', stale.length === 0, stale.join('\n       '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
