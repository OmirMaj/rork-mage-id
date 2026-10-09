#!/bin/bash
# scripts/marketing-screens/reshoot.sh: the one command.
#
#   bash scripts/marketing-screens/reshoot.sh            build (if there is no build yet), shoot everything, publish
#   bash scripts/marketing-screens/reshoot.sh --build    build again first (after the app's code changed)
#   bash scripts/marketing-screens/reshoot.sh home co    shoot only these ids, then publish
#
# Publishes the web-ready files into marketing/screenshots/screens/ and, when
# SITE is set, the full set (PNG + WebP + manifest.json) into that folder:
#   SITE="$HOME/Desktop/MAGE ID - CLAUDE/design-previews/marketing-site/screens" bash scripts/marketing-screens/reshoot.sh
#
# What each file is:
#   build.sh      exports the real web build, twice (shipped, and in-testing with the dark features on)
#   server.ts     serves the build and stands in for the backend, on this machine only
#   world.ts      the one made-up job every screen shows
#   screens.ts    the list of shots
#   shoot.ts      drives headless Chrome at iPhone size (393 x 852 at 3x) and takes the pictures
#   statusbar.ts  the 9:41 phone status bar drawn into the top safe area
#   publish.ts    WebP at 1x and 2x, and the manifest
set -euo pipefail
cd "$(dirname "$0")/../.."
BUILD=0; IDS=()
for a in "$@"; do if [ "$a" = --build ]; then BUILD=1; else IDS+=("$a"); fi; done
DIST=${DIST:-$PWD/.marketing-screens-dist}; DIST_TESTING=${DIST_TESTING:-$PWD/.marketing-screens-dist-testing}
export DIST DIST_TESTING
if [ $BUILD = 1 ] || [ ! -f "$DIST/index.html" ]; then bash scripts/marketing-screens/build.sh shipped; fi
if [ $BUILD = 1 ] || [ ! -f "$DIST_TESTING/index.html" ]; then bash scripts/marketing-screens/build.sh in-testing; fi
bun run scripts/marketing-screens/shoot.ts ${IDS[@]+"${IDS[@]}"}
bun run scripts/marketing-screens/publish.ts
