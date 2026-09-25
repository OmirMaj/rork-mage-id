#!/bin/sh
# scripts/ci-generate-expo-types.sh — restore the two GENERATED, GITIGNORED type
# files that `tsc --noEmit` needs and that a fresh checkout does not have.
#
# WHY THIS EXISTS. Both files are produced by the Expo dev server on a laptop
# and then never thought about again. Neither is in git. On a CI runner — or in
# a fresh worktree — `bun run typecheck` therefore means something DIFFERENT
# from what it means locally, in both directions. Measured 2026-09-12 against a
# clean `git clone` + `bun install --frozen-lockfile`:
#
#   1. expo-env.d.ts  (one line: /// <reference types="expo/types" />)
#      Missing → `tsc --noEmit` FAILS with two errors that exist on nobody's
#      machine:
#        app/(tabs)/settings/index.tsx(636,23): error TS2339: Property
#          'hovered' does not exist on type 'PressableStateCallbackType'.
#        app/persona-select.tsx(264,38): same
#      `hovered` is added by node_modules/expo/types/react-native-web.d.ts,
#      which nothing references without this file. So CI's very first run would
#      have been red on main, for a reason no reviewer could act on — and a
#      check that is red on main teaches you to ignore the X, which is the one
#      outcome the whole ship-gate workflow exists to avoid.
#
#   2. .expo/types/router.d.ts  (expo-router typed routes; experiments.typedRoutes)
#      Missing → typecheck gets WEAKER and says nothing about it. Measured with
#      a deliberately bogus `router.push('/definitely-not-a-real-route')`:
#      1 error in the laptop checkout, 0 errors in the fresh clone. Every route
#      string in 30+ screens would have been unchecked in CI while CLAUDE.md
#      tells you the router type-checks them. A guard that silently downgrades
#      itself is the dark-guard pattern this repo already has a validator for.
#
# `expo export` does NOT write either file (verified — it only fills .expo/cache
# and .expo/web). The dev server does, within a few seconds, and `--offline`
# means it needs no network and contacts nothing.
#
# FAILURE IS LOUD. If either file cannot be produced, this exits non-zero and
# the workflow stops. It must never "carry on without" — that is how you get a
# green build over an unchecked type surface.
#
# Run via: sh scripts/ci-generate-expo-types.sh   (idempotent; safe locally)
#
# REFRESH (opt-in, wave 6d). An existing router.d.ts is KEPT, so a route added
# since it was written (e.g. /attention) reads to tsc as "not a route" until the
# file is regenerated. `EXPO_TYPEGEN_REFRESH=1 sh scripts/ci-generate-expo-types.sh`
# regenerates it; if the dev server fails to write a new one, the old file is
# put back and the script still exits non-zero. Unset (CI's default), nothing
# changes: a present file is kept and the script exits 0.

set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT" || exit 1

PORT=${EXPO_TYPEGEN_PORT:-18081}   # NOT 8081 — that is the dev server a human
                                   # may already have open on this machine.
WAIT_SECONDS=${EXPO_TYPEGEN_WAIT:-120}
ROUTER_TYPES=".expo/types/router.d.ts"
# Log outside the work tree: a stray untracked file in the repo is exactly what
# validate-import-tracking.ts is watching for.
LOG="${TMPDIR:-/tmp}/mageid-expo-typegen.$$.log"

# ── 1. expo-env.d.ts ────────────────────────────────────────────────────────
# Content is Expo's own template, reproduced verbatim. It is a reference
# directive, not logic; if a future Expo version writes something else, the
# dev-server start below overwrites it anyway.
if [ -f expo-env.d.ts ]; then
  echo "expo-types: expo-env.d.ts already present"
else
  printf '/// <reference types="expo/types" />\n\n// NOTE: This file should not be edited and should be in your git ignore' > expo-env.d.ts
  echo "expo-types: wrote expo-env.d.ts"
fi

# ── 2. .expo/types/router.d.ts ──────────────────────────────────────────────
REFRESH=${EXPO_TYPEGEN_REFRESH:-0}
if [ -f "$ROUTER_TYPES" ] && [ "$REFRESH" != "1" ]; then
  echo "expo-types: $ROUTER_TYPES already present (EXPO_TYPEGEN_REFRESH=1 regenerates it)"
  exit 0
fi
STALE_TYPES=""
if [ "$REFRESH" = "1" ] && [ -f "$ROUTER_TYPES" ]; then
  STALE_TYPES="${TMPDIR:-/tmp}/mageid-router-types.$$.d.ts"
  mv "$ROUTER_TYPES" "$STALE_TYPES" || exit 1
  echo "expo-types: EXPO_TYPEGEN_REFRESH=1 — regenerating $ROUTER_TYPES"
fi

echo "expo-types: starting an offline dev server on :$PORT to generate typed routes…"
CI=1 EXPO_NO_TELEMETRY=1 npx expo start --offline --port "$PORT" > "$LOG" 2>&1 &
SERVER_PID=$!

# Always take the server down, however this script leaves.
cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  # Give Metro a moment, then insist.
  sleep 1
  kill -9 "$SERVER_PID" 2>/dev/null
  # A refresh that produced nothing puts the old file back (the exit stays
  # non-zero); one that succeeded drops the old copy.
  if [ -n "$STALE_TYPES" ] && [ -f "$STALE_TYPES" ]; then
    if [ -f "$ROUTER_TYPES" ]; then rm -f "$STALE_TYPES"; else mv "$STALE_TYPES" "$ROUTER_TYPES"; fi
  fi
}
trap cleanup EXIT INT TERM

i=0
while [ "$i" -lt "$WAIT_SECONDS" ]; do
  if [ -f "$ROUTER_TYPES" ]; then
    echo "expo-types: generated $ROUTER_TYPES after ${i}s"
    exit 0
  fi
  # If the server died, stop waiting for a file it will never write.
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "expo-types: the dev server exited before writing $ROUTER_TYPES" >&2
    tail -30 "$LOG" >&2
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done

echo "expo-types: TIMED OUT after ${WAIT_SECONDS}s waiting for $ROUTER_TYPES" >&2
echo "expo-types: without it, typecheck stops checking route strings and says nothing." >&2
tail -30 "$LOG" >&2
exit 1
