/**
 * __tests__/setup/clock-shift-env.native.js — the shifted-clock DETECTOR for the
 * smoke suite (jest.config.js, the jest-expo iOS preset).
 *
 * WHY. CI went red twice on 2026-09-30 because a suite's fixtures were dated one
 * day and the screen read the real clock: green on the day it was written, red the
 * day after. This environment runs any suite as if today were a different day, so
 * that kind of test shows itself on purpose instead of by surprise.
 *
 * OPT-IN, CLI ONLY. Neither jest config names it. Use:
 *   MAGE_CLOCK_SHIFT_DAYS=40 npx jest -w 1 --config jest.config.js \
 *     --testEnvironment ./__tests__/setup/clock-shift-env.native.js
 * (scripts/run-smoke-shifted.sh wraps both suites.)
 *
 * Knobs (all optional; with none of them set this file changes nothing):
 *   MAGE_CLOCK_SHIFT_DAYS  integer number of LOCAL calendar days to move "now"
 *                          (negative moves back). Wall-clock time is kept across
 *                          a DST change.
 *   MAGE_CLOCK_DATE        YYYY-MM-DD: start from this local day instead of today
 *                          (the shift in days is applied after it).
 *   MAGE_CLOCK_AT          HH:MM: set the local time of day, e.g. 23:50 for "just
 *                          before midnight".
 * The offset is worked out once per test file; the clock then keeps running in
 * real time from the shifted start.
 *
 * WHAT IT SHIFTS (three places, because there are three ways a test reads "now"):
 *  (i)   global Date. Date.now() and `new Date()` with no argument are shifted.
 *        `new Date(anything)` is NOT — a fixture date stays the fixture date.
 *  (ii)  jest.useFakeTimers() without a `now`. Jest otherwise seeds the fake
 *        clock from the OUTER realm's real Date (@jest/fake-timers
 *        modernFakeTimers.js `now: fakeTimersConfig.now ?? Date.now()`), which
 *        the test's global Date does not reach. expo-router's renderRouter makes
 *        exactly that call before every route mount, so without this wrap a route
 *        suite would never see the shift. A test that pins is left alone: one
 *        that passes its own `now`, and one that spies on the outer realm's
 *        Date.now (the GOLDEN_CLOCK pattern of the phone-golden suites).
 *  (iii) jest.useRealTimers() / uninstall. Sinon puts back whatever Date it found
 *        at install time; the shifted Date is put back again afterwards anyway so
 *        the shift can never silently fall off mid-file.
 * Timers, animation frames, microtasks and performance.now() are never touched.
 */
'use strict';

const ReactNativeEnv = require('react-native/jest/react-native-env.js');

// This module runs in jest's OUTER realm, so this is the outer Date.now — the
// one @jest/fake-timers seeds a bare useFakeTimers() from. Captured at load so a
// test that spies on it (the GOLDEN_CLOCK pin, below) can be recognised.
const OUTER_NATIVE_NOW = Date.now;

const INT_RE = /^[+-]?\d+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AT_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * How far (ms) the clock moves for these env vars, read at real time `realNow`.
 * 0 means "no shift" and the environment then installs nothing at all.
 */
function readClockShiftMs(env, realNow) {
  const rawDays = (env.MAGE_CLOCK_SHIFT_DAYS ?? '').trim();
  const rawDate = (env.MAGE_CLOCK_DATE ?? '').trim();
  const rawAt = (env.MAGE_CLOCK_AT ?? '').trim();
  if (!rawDays && !rawDate && !rawAt) return 0;

  if (rawDays && !INT_RE.test(rawDays)) {
    throw new Error(`MAGE_CLOCK_SHIFT_DAYS must be a whole number of days, got "${rawDays}"`);
  }
  const days = rawDays ? parseInt(rawDays, 10) : 0;

  const target = new Date(realNow);
  if (rawDate) {
    const m = DATE_RE.exec(rawDate);
    if (!m) throw new Error(`MAGE_CLOCK_DATE must be YYYY-MM-DD, got "${rawDate}"`);
    target.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if (days) target.setDate(target.getDate() + days);
  if (rawAt) {
    const m = AT_RE.exec(rawAt);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      throw new Error(`MAGE_CLOCK_AT must be HH:MM (24h), got "${rawAt}"`);
    }
    target.setHours(Number(m[1]), Number(m[2]), 0, 0);
  }
  return target.getTime() - realNow;
}

/**
 * A Date constructor that reads "now" `shiftMs` ahead of `RealDate`.
 * It shares RealDate.prototype, so `instanceof Date` holds for every date either
 * one makes, and a subclass (`class X extends Date`) still works.
 */
function makeShiftedDate(RealDate, shiftMs) {
  function Date(...args) {
    if (!new.target) return new RealDate(RealDate.now() + shiftMs).toString();
    const d = args.length === 0 ? new RealDate(RealDate.now() + shiftMs) : new RealDate(...args);
    if (new.target !== Date) Object.setPrototypeOf(d, new.target.prototype);
    return d;
  }
  Object.defineProperty(Date, 'length', { value: 7 });
  Date.prototype = RealDate.prototype;
  Date.UTC = RealDate.UTC;
  Date.parse = RealDate.parse;
  Date.now = function now() {
    return RealDate.now() + shiftMs;
  };
  Date.__mageClockShiftMs = shiftMs;
  return Date;
}

/**
 * Install the shift on a constructed jest environment (node or jsdom). Shared by
 * clock-shift-env.web.js. Returns the shift in ms (0 = nothing installed).
 */
function applyClockShift(env, processEnv = process.env) {
  const global = env.global;
  const RealDate = global.Date;
  const shiftMs = readClockShiftMs(processEnv, RealDate.now());
  if (!shiftMs) return 0;

  const ShiftedDate = makeShiftedDate(RealDate, shiftMs);
  const putShiftBack = () => {
    global.Date = ShiftedDate;
  };
  putShiftBack(); // (i)

  const timers = env.fakeTimersModern;
  if (timers) {
    const installFake = timers.useFakeTimers.bind(timers);
    timers.useFakeTimers = (config) => {
      // (ii) Two pins are honoured exactly, never shifted:
      //  - jest.useFakeTimers({ now }) / pinDateOnly / mountRoute(url, { now });
      //  - the GOLDEN_CLOCK pin of the phone-golden suites (w6c-home and kin):
      //    jest.spyOn(<outer realm Date>, 'now'), which is what a bare
      //    useFakeTimers() — renderRouter's — reads its start time from.
      const pinned = (config != null && config.now != null) || Date.now !== OUTER_NATIVE_NOW;
      installFake(pinned ? config : { ...(config ?? {}), now: RealDate.now() + shiftMs });
    };
    const restoreReal = timers.useRealTimers.bind(timers);
    timers.useRealTimers = () => {
      restoreReal();
      putShiftBack(); // (iii)
    };
  }
  return shiftMs;
}

class ClockShiftNativeEnv extends ReactNativeEnv {
  constructor(config, context) {
    super(config, context);
    applyClockShift(this);
  }
}

module.exports = ClockShiftNativeEnv;
module.exports.applyClockShift = applyClockShift;
module.exports.readClockShiftMs = readClockShiftMs;
