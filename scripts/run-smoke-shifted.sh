#!/bin/bash
# scripts/run-smoke-shifted.sh — run the smoke and desktop-web jest suites as if
# today were another day, to catch a test whose fixtures carry a date while the
# screen reads the real clock (green on the day it was written, red the next).
#
# Not part of ship-check (it runs both suites several times over); run it at a
# release gate. On the founder's 18 GB Mac wrap it in the scratchpad heavy.sh.
#
#   bash scripts/run-smoke-shifted.sh            # +40 days, then +100 days
#   bash scripts/run-smoke-shifted.sh 3 -20      # any list of day shifts
#   bash scripts/run-smoke-shifted.sh -- __tests__/smoke/foo.test.tsx   # one file, default shifts
#
# Extra knobs the detector reads (see __tests__/setup/clock-shift-env.native.js):
#   MAGE_CLOCK_DATE=YYYY-MM-DD  start from that local day instead of today
#   MAGE_CLOCK_AT=HH:MM         local time of day (e.g. 23:50, just before midnight)
#   TZ=Pacific/Kiritimati       any timezone (default America/New_York, as CI)
# A failure here that passes in a normal run means the test needs a clock pin:
# pinDateOnly() for render() suites, mountRoute(url, { now }) for route suites
# (__tests__/helpers/testClock.ts). If the screen itself is wrong about dates,
# that is an app bug: report it, do not pin over it.
set -u
cd "$(dirname "$0")/.." || exit 1

SHIFTS=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do SHIFTS+=("$1"); shift; done
[ "${1:-}" = "--" ] && shift
[ ${#SHIFTS[@]} -eq 0 ] && SHIFTS=(40 100)

# The goldens and day-count checks are recorded in the founder's zone, and CI pins
# it too (scripts/ci-ship-check.ts CHILD_ENV TZ). Use it here unless TZ is set,
# so a shifted run measures the calendar, not the machine's zone.
export TZ=${TZ:-America/New_York}
# If jest.config.js pins the zone itself, it reads MAGE_TEST_TZ; pass the same one.
export MAGE_TEST_TZ=${MAGE_TEST_TZ:-$TZ}

WORKERS=${JEST_MAX_WORKERS:-2}
status=0
for n in "${SHIFTS[@]}"; do
  echo "== smoke, clock shifted ${n} days =="
  MAGE_CLOCK_SHIFT_DAYS=$n npx jest --ci -w "$WORKERS" --config jest.config.js \
    --testEnvironment ./__tests__/setup/clock-shift-env.native.js "$@" || status=1
  echo "== desktop web, clock shifted ${n} days =="
  MAGE_CLOCK_SHIFT_DAYS=$n npx jest --ci -w "$WORKERS" --config __tests__/web/jest.web.config.js \
    --testEnvironment ./__tests__/setup/clock-shift-env.web.js --passWithNoTests "$@" || status=1
done
exit $status
