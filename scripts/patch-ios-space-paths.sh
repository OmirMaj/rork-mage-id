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
# PORTABILITY, and why there is no `set -e` here.
#
# This runs from `postinstall`, so it runs on EVERY `bun install` — including
# Linux CI and the Netlify build image, which have GNU sed, not BSD sed. The
# first version used `sed -i ''`, which is BSD syntax: GNU sed reads the empty
# string as its script argument and exits non-zero. Under `set -e` that killed
# the whole install, and Netlify failed in the "Install dependencies" stage
# before the build command ever ran — every app.mageid.app deploy from
# 2026-09-06 onward. A patch for a macOS-only build detail must never be able
# to fail an install on a machine that will never run an iOS build.
#
# So: write through a temp file instead of `sed -i` (portable everywhere), and
# make every failure a no-op. The script always exits 0.
patched=0
for f in \
  node_modules/expo-updates/scripts/create-updates-resources-ios.sh \
  node_modules/expo-constants/scripts/get-app-config-ios.sh
do
  [ -f "$f" ] || continue
  grep -q 'basename \$PROJECT_DIR' "$f" 2>/dev/null || continue
  tmp="$f.mageid-tmp.$$"
  if sed 's|basename \$PROJECT_DIR|basename "$PROJECT_DIR"|g' "$f" > "$tmp" 2>/dev/null &&
     [ -s "$tmp" ] &&
     mv "$tmp" "$f" 2>/dev/null
  then
    echo "  quoted \$PROJECT_DIR in $f"
    patched=$((patched + 1))
  else
    rm -f "$tmp" 2>/dev/null || true
    echo "  skipped $f (could not patch; not fatal)"
  fi
done
[ "$patched" -gt 0 ] && echo "patch-ios-space-paths: fixed $patched script(s)" || true
exit 0
