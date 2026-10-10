#!/bin/bash
# ota.sh "<message>" — publish production + republish to preview, from the release worktree (GATE_WT), with a CLEARED Metro cache,
# and REFUSE to republish if the iOS bundle is incomplete (2026-10-02: waves 3+4 shipped a 1.5 MB / 950-module
# iOS bundle from a stale cache while Android was 18 MB / 5,2xx modules; iPhones rolled back silently).
set -u
cd "${GATE_WT:-/private/tmp/claude-501/gate-wt}" || exit 1
# The release worktree MUST hold the repo-root .env: EXPO_PUBLIC_* values are inlined at bundle time, and a temp
# cleaner has deleted .env from worktrees before (2026-10-10: updates went out with no RevenueCat or OpenWeather
# key). Refuse to publish without it, and after publishing check every value is really in the iOS bundle.
[ -s .env ] || { echo "!!! no .env in $(pwd). Copy the repo-root .env here first. NOT publishing."; exit 3; }
LOG="${OTA_LOG:-${TMPDIR:-/tmp}/mageid-ota-last.log}"
eas update --branch production --message "$1" --clear-cache --non-interactive > $LOG 2>&1 || { echo "OTA FAILED (see $LOG)"; exit 1; }
IOSM=$(grep -oE "iOS Bundled [0-9]+ms .*\(([0-9]+) modules\)" $LOG | grep -oE "[0-9]+ modules" | grep -oE "[0-9]+")
ANDM=$(grep -oE "Android Bundled [0-9]+ms .*\(([0-9]+) modules\)" $LOG | grep -oE "[0-9]+ modules" | grep -oE "[0-9]+")
IOSMB=$(grep -oE "ios/entry-[a-f0-9]+\.hbc \([0-9.]+ MB\)" $LOG | grep -oE "[0-9.]+ MB" | grep -oE "[0-9.]+")
G=$(grep "Update group ID" $LOG | awk '{print $4}')
echo "group $G  iOS ${IOSM:-?} modules ${IOSMB:-?} MB  Android ${ANDM:-?} modules"
if [ -z "${IOSM:-}" ] || [ -z "${ANDM:-}" ] || [ "$IOSM" -lt $((ANDM - 100)) ] || [ "$(echo "${IOSMB:-0} < 10" | bc)" = 1 ]; then
  echo "!!! iOS BUNDLE LOOKS INCOMPLETE — NOT republishing to preview. Re-run with a fresh cache (rm -rf \$TMPDIR/metro-* \$TMPDIR/haste-map-*) and publish again NOW."
  exit 2
fi
# Metro drops the other platform's branch, so the Android key is only in the Android bundle and a *_WEB_* key is
# in neither phone bundle: a value passes if either phone bundle carries it, and web-only keys are skipped.
HBC=$(ls dist/_expo/static/js/ios/*.hbc 2>/dev/null | head -1)
ABC=$(ls dist/_expo/static/js/android/*.hbc 2>/dev/null | head -1)
MISSING=""
while IFS='=' read -r k v; do
  case "$k" in
    EXPO_PUBLIC_*_WEB_*) ;;
    EXPO_PUBLIC_*) v=${v%\"}; v=${v#\"}
      [ -n "$v" ] && ! LC_ALL=C grep -aqF "$v" "${HBC:-/dev/null}" && ! LC_ALL=C grep -aqF "$v" "${ABC:-/dev/null}" && MISSING="$MISSING $k";;
  esac
done < .env
if [ -z "$HBC" ] || [ -n "$MISSING" ]; then
  echo "!!! the phone bundles are missing:${MISSING:- (no bundle found)}. NOT republishing to preview. Fix .env and publish again NOW."
  exit 4
fi
eas update:republish --group "$G" --destination-channel preview --message "$1" --non-interactive 2>&1 | grep -E "group ID|rror" | head -2
