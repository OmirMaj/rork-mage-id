# assets/brand-next — green native images, waiting for the next native build

These three PNGs are the 2026-09-16 green rebrand ("deep green on the concrete")
versions of the app's NATIVE images:

| File here | Replaces | Used by |
|---|---|---|
| `icon.png` | `assets/images/icon.png` | `app.json` `expo.icon` (App Store / home-screen icon) |
| `adaptive-icon.png` | `assets/images/adaptive-icon.png` | `app.json` `android.adaptiveIcon.foregroundImage` |
| `splash-icon.png` | `assets/images/splash-icon.png` | `app.json` `expo.splash.image` (native launch screen) |

## Why they are not live yet

An app icon and a native splash are compiled into the binary. An OTA update
(`eas update`) cannot change them, so the colour/type rebrand shipped over the air
while the installed build keeps showing the orange icon and splash.

They were also held back on purpose: the loader rebuild verifies its cold-start
frame against today's orange `assets/images/splash-icon.png`, pixel for pixel,
because that is what the installed build shows before JS runs. Swapping the file
in an OTA commit would make that check compare against an image no device shows.

Web favicons (`assets/images/favicon*.png`, `marketing/assets/favicon-*`,
`marketing/favicon.ico`) are web-only and switched to green with the OTA.
`public/manifest.webmanifest` still points its large PWA icons at
`assets/images/icon.png` / `adaptive-icon.png`, so those stay orange until the swap below.

## Shipping them (with the next native build)

1. `cp assets/brand-next/{icon,adaptive-icon,splash-icon}.png assets/images/`
2. Check `app.json` `splash.backgroundColor` / `android.adaptiveIcon.backgroundColor`
   against the green system (dark ground `#151816`, concrete `#ECEDE9`).
3. Re-baseline the loader's splash-pixel check against the new splash in the same commit.
4. `eas build --profile production --platform ios` (then Android), and submit to the App Store.
5. Delete this folder.
