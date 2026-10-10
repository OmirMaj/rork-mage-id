#!/bin/sh
# scripts/demo-job/render.sh — draws the Demo Job's plan sheets and writes the
# PNG files the app bundles (assets/demo-job/). Run it from the repo root after
# changing utils/demoJob/model.ts or scripts/demo-job/draw-plans.ts.
#
# Needs Google Chrome (it is only used to turn each SVG into a PNG, offline).
set -eu
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
OUT="assets/demo-job"
mkdir -p "$OUT"
bun run scripts/demo-job/draw-plans.ts "$TMP"
for key in a-101 a-102 a-301; do
  printf '<!doctype html><html><body style="margin:0;background:#fff"><img src="%s.svg" width="2400" height="1600" style="display:block"></body></html>' "$key" > "$TMP/$key.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=2400,1600 --screenshot="$TMP/$key.png" "file://$TMP/$key.html" >/dev/null 2>&1
  cp "$TMP/$key.png" "$OUT/plan-$key.png"
done
bun -e 'import { createHash } from "node:crypto"; import { drawDemoPlans } from "./scripts/demo-job/draw-plans.ts"; const d = drawDemoPlans(); console.log("# The drawings the images beside this note were rendered from (scripts/demo-job/render.sh)."); for (const k of Object.keys(d)) console.log(k + " " + createHash("sha256").update(d[k]).digest("hex").slice(0, 16));' > "$OUT/drawn-from.txt"
rm -rf "$TMP"
ls -la "$OUT"
