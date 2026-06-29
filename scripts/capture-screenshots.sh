#!/usr/bin/env bash
#
# capture-screenshots.sh — one-command MAGE ID screenshot capture (macOS only)
# -----------------------------------------------------------------------------
# Boots an iPhone Pro Max simulator, sets a clean App-Store status bar, and
# captures screenshots straight into marketing/screenshots/screens/ at the exact
# 1290x2796 canvas the existing shots use.
#
# PREREQUISITES (one time):
#   - Xcode + an iOS Simulator runtime installed (`xcode-select --install`)
#   - The MAGE ID app installed & running on the booted simulator. Easiest:
#         bun run ios        # builds a dev client + installs to the sim
#     ...or open the app in Expo Go on the sim and leave the dev server running:
#         bun run start
#   - Sign in once on the sim, and (optional) run the in-app dev seeder so the
#     screens have realistic demo data:  open  rork-app:///dev-seeder
#
# USAGE:
#   ./scripts/capture-screenshots.sh deeplink         # auto-walk the SCREENS list
#   ./scripts/capture-screenshots.sh manual           # you navigate, it captures
#   ./scripts/capture-screenshots.sh one 30-invoice   # single shot, named now
#   ./scripts/capture-screenshots.sh seed             # just open the dev seeder
#
# After capture, hand control back to me (Claude) — I'll wire the new PNGs into
# the marketing pages.
# -----------------------------------------------------------------------------

set -euo pipefail

# --- config -----------------------------------------------------------------
DEVICE_NAME="${DEVICE_NAME:-iPhone 16 Pro Max}"   # 1290x2796 canvas. Override via env.
BUNDLE_ID="${BUNDLE_ID:-com.mageid.app}"
SCHEME="${SCHEME:-rork-app}"
SETTLE="${SETTLE:-2.5}"                            # seconds to let a screen render
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/marketing/screenshots/screens"

# Screens to auto-capture in `deeplink` mode: "filename|route"
# - filename has NO extension and NO leading number-bump; pick the next free
#   index yourself or reuse a name to overwrite. These are the gaps the
#   marketing site could still use beyond the 29 already shot.
# - Routes that need a specific record id can't be deep-linked blind; those are
#   marked MANUAL — run `manual` mode for them and navigate by hand.
SCREENS=(
  "30-invoice|invoice"
  "31-change-order|change-order"
  "32-rfi|rfi"
  "33-submittal|submittal"
  "34-aia-pay-app|aia-pay-app"
  "35-buyout|buyout"
  "36-bid-leveling|bid-leveling"
  "37-cost-database|cost-database"
  "38-contract|contract"
  "39-coi-vault|coi-vault"
  "40-punch-list|punch-list"
  "41-plans|plans"
  "42-drawing-analyzer|drawing-analyzer"
  "43-leads-crm|leads"
  "44-job-costing|job-costing"
  "45-margin-risk|margin-risk"
  "46-time-tracking|time-tracking"
  "47-warranties|warranties"
  "48-documents|documents"
  "49-last-planner|last-planner"
  "50-smart-proposal|smart-proposal"
  "51-win-optimizer|win-optimizer"
  "52-photo-triage|photo-triage"
  "53-weekly-snapshot|weekly-snapshot"
  "54-cash-flow|cash-flow"
  "55-budget-dashboard|budget-dashboard"
)

# --- helpers ----------------------------------------------------------------
die() { echo "❌ $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' not found — are you on macOS with Xcode installed?"; }

need xcrun
[ "$(uname -s)" = "Darwin" ] || die "This script must run on macOS (it needs the iOS Simulator). You're on $(uname -s)."

mkdir -p "$OUT_DIR"

# Resolve the simulator UDID (prefer an already-booted device of the right name)
udid() {
  local u
  u="$(xcrun simctl list devices booted | grep -F "$DEVICE_NAME" | grep -oE '[0-9A-F-]{36}' | head -1 || true)"
  if [ -z "$u" ]; then
    u="$(xcrun simctl list devices available | grep -F "$DEVICE_NAME" | grep -oE '[0-9A-F-]{36}' | head -1 || true)"
  fi
  echo "$u"
}

UDID="$(udid)"
[ -n "$UDID" ] || die "No simulator named \"$DEVICE_NAME\". Create one in Xcode > Settings > Components, or set DEVICE_NAME=..."

ensure_booted() {
  local state
  state="$(xcrun simctl list devices | grep "$UDID" | grep -oE '\((Booted|Shutdown)\)' | tr -d '()' || true)"
  if [ "$state" != "Booted" ]; then
    echo "▸ Booting $DEVICE_NAME …"
    xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
    open -a Simulator
    sleep 6
  fi
  # Clean, deterministic status bar (App Store style)
  xcrun simctl status_bar "$UDID" override \
    --time "9:41" \
    --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 \
    --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true
}

shot() {
  local name="$1" path="$OUT_DIR/$1.png"
  xcrun simctl io "$UDID" screenshot --type png "$path" >/dev/null
  echo "  ✅ $name.png  ($(du -h "$path" | cut -f1))"
}

open_route() {
  xcrun simctl openurl "$UDID" "$SCHEME:///$1" >/dev/null 2>&1 || true
}

# --- modes ------------------------------------------------------------------
mode="${1:-deeplink}"
case "$mode" in
  seed)
    ensure_booted
    echo "▸ Opening dev seeder so screens have demo data…"
    open_route "dev-seeder"
    echo "Run the seeder in-app, then re-run this script in 'deeplink' or 'manual' mode."
    ;;

  one)
    [ -n "${2:-}" ] || die "Usage: $0 one <filename-without-extension>"
    ensure_booted
    echo "▸ Capturing single shot in 3s — make sure the screen is showing…"
    sleep 3
    shot "$2"
    ;;

  manual)
    ensure_booted
    echo "▸ MANUAL mode. Navigate the app on the sim. For each screen, type a"
    echo "  filename (no extension) and press Enter to capture. Empty line = quit."
    while true; do
      printf "filename> "
      read -r name || break
      [ -z "$name" ] && break
      shot "$name"
    done
    ;;

  deeplink)
    ensure_booted
    echo "▸ DEEPLINK mode — walking ${#SCREENS[@]} screens (settle=${SETTLE}s each)."
    echo "  Tip: run '$0 seed' first if screens look empty."
    for entry in "${SCREENS[@]}"; do
      name="${entry%%|*}"; route="${entry##*|}"
      echo "▸ $name  ←  $SCHEME:///$route"
      open_route "$route"
      sleep "$SETTLE"
      shot "$name"
    done
    echo ""
    echo "Done. New PNGs are in marketing/screenshots/screens/."
    echo "Eyeball them, delete any that landed on the wrong/empty screen, then"
    echo "tell Claude to wire the good ones into the marketing pages."
    ;;

  *)
    die "Unknown mode '$mode'. Use: deeplink | manual | one <name> | seed"
    ;;
esac
