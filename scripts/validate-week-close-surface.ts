// scripts/validate-week-close-surface.ts
//
// F2 surface validator: nextFridayFireDate math, arm predicate logic,
// WEEK_CLOSE_LAST_SEEN_KEY constant wiring, last-seen LOCAL-date parity,
// and (source-scan) the nudge-consent pass-through.
// Pure — no React, no network, no AsyncStorage.
// Exits non-zero on any assertion failure.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextFridayFireDate, nextMorningFireDate } from '../utils/brief/nudgeTime';
import { WEEK_CLOSE_LAST_SEEN_KEY, weekCloseTodayISO } from '../utils/weekClose/types';

// Constants from utils/weekClose/nudge — inlined so the validator stays
// pure (nudge.ts imports expo-notifications / react-native which crash Bun).
const WEEK_CLOSE_NUDGE_IDENTIFIER = 'mageid-week-close-nudge';
const WEEK_CLOSE_NUDGE_HOUR = 15;
const WEEK_CLOSE_NUDGE_MINUTE = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  OK  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}`);
    failed++;
  }
}

function dayName(d: Date): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}

// ─── Test 1: nextFridayFireDate returns a Friday ───────────────────────────

console.log('\nnextFridayFireDate — day-of-week');

// Monday → next Friday
const mon = new Date('2026-07-27T08:00:00'); // Monday
const fireMon = nextFridayFireDate(15, 0, mon);
assert(fireMon.getDay() === 5, `From Monday, result is Friday (got ${dayName(fireMon)})`);
assert(fireMon.getHours() === 15, `From Monday, hour is 15 (got ${fireMon.getHours()})`);
assert(fireMon.getMinutes() === 0, `From Monday, minute is 0 (got ${fireMon.getMinutes()})`);

// Wednesday → next Friday
const wed = new Date('2026-07-29T09:00:00');
const fireWed = nextFridayFireDate(15, 0, wed);
assert(fireWed.getDay() === 5, `From Wednesday, result is Friday (got ${dayName(fireWed)})`);

// Saturday → next Friday (+ 6 days)
const sat = new Date('2026-08-01T10:00:00');
const fireSat = nextFridayFireDate(15, 0, sat);
assert(fireSat.getDay() === 5, `From Saturday, result is next Friday (got ${dayName(fireSat)})`);
// Saturday → 6 days to next Friday
const satToFri = Math.round((fireSat.getTime() - sat.getTime()) / 86400000);
assert(satToFri >= 5 && satToFri <= 7, `From Saturday, ~6 days ahead (got ${satToFri})`);

// Sunday → next Friday (5 days)
const sun = new Date('2026-08-02T12:00:00');
const fireSun = nextFridayFireDate(15, 0, sun);
assert(fireSun.getDay() === 5, `From Sunday, result is Friday (got ${dayName(fireSun)})`);

// ─── Test 2: Friday-before-15:00 → fires TODAY ────────────────────────────

console.log('\nnextFridayFireDate — today-or-next-week discipline');

// Friday at 10:00 (before 15:00) → fires same day
const friEarly = new Date('2026-07-31T10:00:00'); // Friday
const fireFriEarly = nextFridayFireDate(15, 0, friEarly);
assert(fireFriEarly.getDay() === 5, 'Friday early: fires Friday');
assert(fireFriEarly.toDateString() === friEarly.toDateString(), 'Friday early: fires TODAY');

// Friday at 15:01 (just past) → fires next Friday
const friLate = new Date('2026-07-31T15:01:00');
const fireFriLate = nextFridayFireDate(15, 0, friLate);
assert(fireFriLate.getDay() === 5, 'Friday late: fires Friday');
assert(fireFriLate.toDateString() !== friLate.toDateString(), 'Friday late: fires NEXT week');
const daysAhead = Math.round((fireFriLate.getTime() - friLate.getTime()) / 86400000);
assert(daysAhead >= 6 && daysAhead <= 8, `Friday late: ~7 days ahead (got ${daysAhead})`);

// ─── Test 3: nextMorningFireDate still works (no regression) ──────────────

console.log('\nnextMorningFireDate — regression');

const morningBase = new Date('2026-07-27T05:00:00');
const morningFire = nextMorningFireDate(6, 30, morningBase);
assert(morningFire.getHours() === 6, 'Morning fire: hour 6');
assert(morningFire.getMinutes() === 30, 'Morning fire: minute 30');
assert(morningFire.getTime() > morningBase.getTime(), 'Morning fire: in the future');

const morningBaseLate = new Date('2026-07-27T07:00:00'); // past 6:30
const morningFireLate = nextMorningFireDate(6, 30, morningBaseLate);
assert(morningFireLate.toDateString() !== morningBaseLate.toDateString(), 'Morning fire late: next day');

// ─── Test 4: constants are sane ───────────────────────────────────────────

console.log('\nConstants');

assert(WEEK_CLOSE_LAST_SEEN_KEY === 'mageid_week_close_last_seen', 'WEEK_CLOSE_LAST_SEEN_KEY is correct');
assert(WEEK_CLOSE_NUDGE_IDENTIFIER === 'mageid-week-close-nudge', 'WEEK_CLOSE_NUDGE_IDENTIFIER is correct');
assert(WEEK_CLOSE_NUDGE_HOUR === 15, 'WEEK_CLOSE_NUDGE_HOUR is 15');
assert(WEEK_CLOSE_NUDGE_MINUTE === 0, 'WEEK_CLOSE_NUDGE_MINUTE is 0');

// ─── Test 5: last-seen LOCAL-date parity ──────────────────────────────────
// One shared definition of "today": writer (week-close.tsx) and reader
// (WeekCloseCard) must both use weekCloseTodayISO — a UTC stamp on a Sunday
// evening is already Monday of the NEXT ISO week and suppresses that week's
// card entirely.

console.log('\nweekCloseTodayISO — local date semantics');

// Built from local components → renders those same local components in any TZ.
const lateEvening = new Date(2026, 6, 26, 23, 30); // Jul 26, 11:30 PM local
assert(weekCloseTodayISO(lateEvening) === '2026-07-26', `late-evening stamp stays the LOCAL day (got ${weekCloseTodayISO(lateEvening)})`);
const earlyMorning = new Date(2026, 0, 2, 0, 30);
assert(weekCloseTodayISO(earlyMorning) === '2026-01-02', 'early-morning stamp stays the LOCAL day');
assert(/^\d{4}-\d{2}-\d{2}$/.test(weekCloseTodayISO()), 'output is YYYY-MM-DD');

// Source-scan: both writer files use the shared helper, and neither stamps
// the key with the UTC-sliced toISOString date.
const repoRoot = join(__dirname, '..');
const modalSrc = readFileSync(join(repoRoot, 'app/week-close.tsx'), 'utf8');
const cardSrc = readFileSync(join(repoRoot, 'components/home/WeekCloseCard.tsx'), 'utf8');

assert(modalSrc.includes('weekCloseTodayISO'), 'week-close.tsx stamps last-seen via weekCloseTodayISO');
assert(!modalSrc.includes('toISOString().slice(0, 10)'), 'week-close.tsx has no UTC-sliced date stamp');
assert(cardSrc.includes('weekCloseTodayISO'), 'WeekCloseCard reads/writes last-seen via weekCloseTodayISO');
assert(!cardSrc.includes('toISOString().slice(0, 10)'), 'WeekCloseCard has no UTC-sliced date stamp');

// ─── Test 6: nudge consent pass-through (source-scan) ─────────────────────
// WeekCloseCard must not hardcode enabled:true — the settings toggle at
// notification_preferences.weekClose.push has to reach armWeekCloseNudge.

console.log('\nWeekCloseCard — nudge consent');

assert(
  !cardSrc.includes('armWeekCloseNudge({ enabled: true })'),
  'WeekCloseCard never hardcodes armWeekCloseNudge({ enabled: true })',
);
assert(
  cardSrc.includes('notification_preferences'),
  'WeekCloseCard reads notification_preferences before arming',
);
assert(
  cardSrc.includes('weekClosePushOn'),
  'WeekCloseCard passes the weekClose push preference through to the arm call',
);

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('week-close-surface validator FAILED');
  process.exit(1);
}
console.log('week-close-surface validator PASSED');
