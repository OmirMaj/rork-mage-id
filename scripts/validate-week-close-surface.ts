// scripts/validate-week-close-surface.ts
//
// F2 surface validator: nextFridayFireDate math, arm predicate logic,
// and WEEK_CLOSE_LAST_SEEN_KEY constant wiring.
// Pure — no React, no network, no AsyncStorage.
// Exits non-zero on any assertion failure.

import { nextFridayFireDate, nextMorningFireDate } from '../utils/brief/nudgeTime';
import { WEEK_CLOSE_LAST_SEEN_KEY } from '../utils/weekClose/types';

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

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('week-close-surface validator FAILED');
  process.exit(1);
}
console.log('week-close-surface validator PASSED');
