#!/bin/sh
# scripts/patch-ios-space-paths.sh
#
# WHY: this checkout lives at "…/MAGE ID - CLAUDE". Two dependency build
# scripts interpolate $PROJECT_DIR into a `basename` call WITHOUT quoting it.
# Xcode runs those under /bin/sh, which word-splits, so the spaced path becomes
# four arguments and `basename` returns garbage. In expo-updates that garbage
# fails an `if [ "x$B" != "xPods" ]` guard and the script `exit 0`s — silently.
# The build then SUCCEEDS with no app.manifest in the bundle, and the app dies
# on launch in Release with:
#
#   NSInternalInconsistencyException: The embedded manifest is invalid or
#   could not be read. Make sure you have configured expo-updates correctly
#   in your Xcode Build Phases.
#
# That is a silent, build-green, runtime-fatal failure. It is invisible on EAS
# because EAS checks out to a path with no spaces — which is exactly why it
# survived: local Release builds were the only thing it broke, and nobody had
# run one (docs/START-HERE.md: "A Release build has never been run").
#
# The sibling bugs in OUR OWN files (ios/Podfile, ios/MAGEID.xcodeproj) are
# fixed properly in-repo. These two live in node_modules and come back on every
# install, so this script re-applies them. It is idempotent and never fails the
# install: a missing file or an already-quoted line is a no-op.
#
# THE REAL FIX is to check out to a path with no spaces. Do that and this
# script becomes dead weight — delete it, and the postinstall hook with it.
set -e
patched=0
for f in \
  node_modules/expo-updates/scripts/create-updates-resources-ios.sh \
  node_modules/expo-constants/scripts/get-app-config-ios.sh
do
  [ -f "$f" ] || continue
  grep -q 'basename \$PROJECT_DIR' "$f" 2>/dev/null || continue
  sed -i '' 's|basename \$PROJECT_DIR|basename "$PROJECT_DIR"|g' "$f"
  echo "  quoted \$PROJECT_DIR in $f"
  patched=$((patched + 1))
done
[ "$patched" -gt 0 ] && echo "patch-ios-space-paths: fixed $patched script(s)" || true
exit 0
