// validate-test-clock.ts — the clock-pin helper every dated test leans on is right.
//
// WHY. CI went red twice on 2026-09-30 because a suite's fixtures were dated one
// day and the screen read the real clock. __tests__/helpers/testClock.ts is the
// fix authors reach for: pinDateOnly() fakes Date (and only Date), localDayIso()
// names a local calendar day. If localDayIso slips to UTC, a fixture built for
// "today" lands on tomorrow every evening in New York; if the do-not-fake list
// loses a timer, a pinned test silently freezes that timer and stops testing the
// real screen. Neither shows up as a red test — it shows up as a wrong green one.
//
// Run: bun run scripts/validate-test-clock.ts
import { localDayIso, DATE_ONLY_DO_NOT_FAKE } from '../__tests__/helpers/testClock';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.info('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// Local wall-clock timestamps (built with the local Date constructor, so they are
// the same calendar moment in whatever TZ is active).
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();

// The day checks run under three zones, set at runtime (bun honours process.env.TZ
// changes): west of UTC (the founder's), far east of it, and the US west coast. A
// CI host on UTC would otherwise never see a UTC-vs-local mistake.
const ZONES = ['America/New_York', 'Pacific/Kiritimati', 'America/Los_Angeles'];
const hostTz = process.env.TZ;
for (const zone of ZONES) {
  process.env.TZ = zone;
  console.info(`\n[TZ=${zone}] localDayIso names the LOCAL day:`);
  eq('mid-afternoon', localDayIso(at(2026, 9, 28, 15, 0)), '2026-09-28');
  eq('just after midnight', localDayIso(at(2026, 9, 28, 0, 5)), '2026-09-28');
  eq('23:30 on a month-end stays on that day', localDayIso(at(2026, 9, 30, 23, 30)), '2026-09-30');
  eq('23:30 on Dec 31 stays in that year', localDayIso(at(2026, 12, 31, 23, 30)), '2026-12-31');
  eq('zero-pads month and day', localDayIso(at(2027, 1, 5, 12, 0)), '2027-01-05');
  // The trap localDayIso exists to avoid, made explicit: in any zone west of UTC
  // the UTC date at 23:30 local is already the next day.
  {
    const ms = at(2026, 12, 31, 23, 30);
    const tzOffsetMin = new Date(ms).getTimezoneOffset();
    if (tzOffsetMin > 0) {
      ok('differs from the UTC date late in the evening (this TZ is west of UTC)',
        localDayIso(ms) !== new Date(ms).toISOString().slice(0, 10));
    } else {
      console.info(`  · (UTC-vs-local check skipped: TZ offset ${tzOffsetMin} min is not west of UTC)`);
    }
  }

  console.info(`[TZ=${zone}] offsetDays moves whole local calendar days:`);
  eq('no offset is the same day', localDayIso(at(2026, 9, 28, 15, 0), 0), '2026-09-28');
  eq('+1 across a month', localDayIso(at(2026, 9, 30, 23, 30), 1), '2026-10-01');
  eq('+1 across a year', localDayIso(at(2026, 12, 31, 23, 30), 1), '2027-01-01');
  eq('-1 back across a year', localDayIso(at(2027, 1, 1, 0, 30), -1), '2026-12-31');
  eq('-1 back across a month', localDayIso(at(2026, 10, 1, 9, 0), -1), '2026-09-30');
  eq('+40 crosses a month', localDayIso(at(2026, 9, 28, 15, 0), 40), '2026-11-07');
  eq('+100 crosses the year', localDayIso(at(2026, 9, 28, 15, 0), 100), '2027-01-06');
  eq('-20 goes back a month', localDayIso(at(2026, 9, 28, 15, 0), -20), '2026-09-08');
  eq('+1 into a leap day', localDayIso(at(2028, 2, 28, 22, 0), 1), '2028-02-29');
  // US DST ends 2026-11-01. A day is not always 24 h; a calendar-day offset must
  // still land on the next calendar day at 00:30 local.
  eq('+1 across the November DST change', localDayIso(at(2026, 10, 31, 0, 30), 1), '2026-11-01');
  eq('+2 across the November DST change', localDayIso(at(2026, 10, 31, 0, 30), 2), '2026-11-02');
  eq('+1 across the March DST change', localDayIso(at(2027, 3, 13, 23, 30), 1), '2027-03-14');
}
if (hostTz === undefined) delete process.env.TZ; else process.env.TZ = hostTz;

console.info('\nDATE_ONLY_DO_NOT_FAKE fakes Date and nothing else:');
const TIMER_APIS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'hrtime', 'performance',
];
for (const api of TIMER_APIS) ok(`keeps ${api} real`, DATE_ONLY_DO_NOT_FAKE.includes(api));
ok('does not list Date (Date is the one thing a pin fakes)', !DATE_ONLY_DO_NOT_FAKE.includes('Date'));
ok('lists only known fakeable APIs', DATE_ONLY_DO_NOT_FAKE.every((a) => TIMER_APIS.includes(a)),
  DATE_ONLY_DO_NOT_FAKE.filter((a) => !TIMER_APIS.includes(a)).join(', '));
eq('no duplicates', new Set(DATE_ONLY_DO_NOT_FAKE).size, DATE_ONLY_DO_NOT_FAKE.length);
ok('is frozen (a test cannot edit the shared list)', Object.isFrozen(DATE_ONLY_DO_NOT_FAKE));

console.info(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
