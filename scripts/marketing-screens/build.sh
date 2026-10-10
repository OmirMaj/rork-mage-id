#!/bin/bash
# scripts/marketing-screens/build.sh [shipped|in-testing|all]
#
# Exports the real web build of the app for the screenshot harness. The only
# difference from the build app.mageid.app serves is where the backend lives:
# EXPO_PUBLIC_SUPABASE_URL points at the stand-in on this machine (server.ts),
# so no shot can reach a real account.
#
# "in-testing" is a SECOND export with the switched-off features turned on
# (constants/featureFlags.ts is edited for the length of the export and put
# back, even if the export fails). Its shots go to in-testing/ and may only be
# shown under an "In Testing" label.
#
# Memory: an export is a Metro run (about 2 GB). Set HEAVY=/path/to/heavy.sh
# to queue behind the machine's other heavy jobs.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
WHAT=${1:-all}
FLAGS=constants/featureFlags.ts
TESTING_FLAGS="LIVING_MODEL_ENABLED SCAN_ROOM_ENABLED CLEARANCE_CHECK_ENABLED PROOF_PACK_ENABLED"

export_web() { # <out dir>
  rm -rf "$1"
  EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:8797 EXPO_PUBLIC_OPENWEATHER_API_KEY=marketing-screens-stand-in \
    EXPO_NO_TELEMETRY=1 CI=1 ${HEAVY:+bash "$HEAVY"} npx expo export --platform web --output-dir "$1"
}

if [ "$WHAT" = shipped ] || [ "$WHAT" = all ]; then
  export_web "${DIST:-$ROOT/.marketing-screens-dist}"
fi

if [ "$WHAT" = in-testing ] || [ "$WHAT" = all ]; then
  cp "$FLAGS" "$FLAGS.marketing-screens-backup"
  trap 'mv -f "$ROOT/$FLAGS.marketing-screens-backup" "$ROOT/$FLAGS"' EXIT
  for f in $TESTING_FLAGS; do
    grep -q "^export const $f = false;" "$FLAGS" || { echo "flag $f is not 'false' in $FLAGS: it may have shipped; move its screens to the shipped set"; exit 1; }
    sed -i.tmp "s/^export const $f = false;/export const $f = true;/" "$FLAGS" && rm -f "$FLAGS.tmp"
  done
  export_web "${DIST_TESTING:-$ROOT/.marketing-screens-dist-testing}"
fi
