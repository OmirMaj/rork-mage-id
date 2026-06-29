# App screenshots for the marketing site

The marketing site frames real device screenshots from
`marketing/screenshots/screens/` (1290×2796, iPhone Pro Max). To capture more,
use the helper script **on your Mac** (it needs Xcode + the iOS Simulator —
it can't run in CI or a Linux cloud session).

## Quick start

```bash
# 1. Get the app running on a simulator (either works):
bun run ios          # builds a dev client and installs it on the sim
#   …or open the app in Expo Go on the sim with `bun run start` running.

# 2. (optional) Sign in once, then load demo data so screens aren't empty:
./scripts/capture-screenshots.sh seed      # opens the in-app dev seeder

# 3. Capture:
./scripts/capture-screenshots.sh deeplink  # auto-walks the SCREENS list
./scripts/capture-screenshots.sh manual    # you navigate, it captures on Enter
./scripts/capture-screenshots.sh one 30-invoice   # a single named shot
```

New PNGs land in `marketing/screenshots/screens/`. Eyeball them, delete any that
caught the wrong/empty screen, then ask Claude to wire the good ones into the
marketing pages.

## Notes

- Device defaults to **iPhone 16 Pro Max** (the App-Store 1290×2796 canvas).
  Override with `DEVICE_NAME="iPhone 15 Pro Max" ./scripts/capture-screenshots.sh …`.
- The script sets a clean 9:41 / full-battery status bar automatically.
- `deeplink` mode opens `rork-app:///<route>` for each screen. Screens that need
  a specific record id (e.g. a single project) can't be deep-linked blind —
  capture those with `manual` mode.
- Edit the `SCREENS=( … )` array in `capture-screenshots.sh` to change which
  routes get captured and what each file is named.
