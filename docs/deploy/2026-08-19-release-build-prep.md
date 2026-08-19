# iOS Release build — pre-flight (founder triggers)

_2026-08-19. The Release production build has never run since the iOS build fix;
only Debug was verified, and Release bundling breaking was the whole bug. This
is the highest-risk unknown between here and TestFlight. Below is what I verified
statically and the exact command to run._

## The command

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
eas build --profile production --platform ios
```

Then, once it succeeds:

```bash
eas submit --platform ios --latest      # ascAppId 6762229238, team HKT2J284D2
```

## What the "Release bundling breaks" bug actually was — and why it's fixed

`@sentry/react-native/expo` and the RN template inject **unquoted** backtick
command substitutions into two Xcode build phases — "Bundle React Native code and
images" and "Upload Debug Symbols to Sentry". `--print` returns an **absolute**
path, and this repo lives in `MAGE ID - CLAUDE` (a space). Unquoted, the path
word-splits: `/bin/sh: /Users/.../Desktop/MAGE: No such file or directory`.

- In **Debug** the phase body is a no-op (`SKIP_BUNDLING=1`) so it looks
  cosmetic — but the phase still *fails*, cancelling every later phase (Embed
  Pods Frameworks / Copy Pods Resources / EXConstants manifest).
- In **Release** it breaks JS bundling outright.

Fix: `plugins/withQuotedXcodeScriptPaths.js` rewrites ``` `cmd` ``` →
`"$(cmd)"` (POSIX-identical, suppresses word-splitting) on both phases, on every
`expo prebuild` (ios/ is gitignored). It is listed **after**
`@sentry/react-native/expo` in `app.json` so it runs on the already-injected
Sentry script.

**Statically verified (2026-08-19):**
- Plugin ordering in `app.json`: `@sentry/react-native/expo` → then
  `./plugins/withQuotedXcodeScriptPaths` ✓
- The rewrite on the real failing string produces valid quoted `$( )` with no
  residual backticks, and is idempotent ✓ (unit-checked via
  `quoteBacktickSubstitutions`).
- `PHASES_TO_FIX` covers both the bundle phase and the Sentry symbol-upload phase ✓

**Still unverified (only a real Release build can confirm):** that the quoted
bundle phase actually produces the JS bundle and the build reaches "Embed Pods
Frameworks" and the archive. That's what this build proves.

## Production profile (eas.json) — checked, no changes made

- `channel: production` ✓ (OTA updates on the `production` branch will reach it)
- `autoIncrement: true` ✓ (build number bumps automatically)
- `credentialsSource: remote` ✓ (EAS-managed signing)
- `version 1.0.0`, `runtimeVersion { policy: appVersion }` — a native build, so
  this establishes the runtime baseline all future OTA updates target.
- I did **not** touch the eas.json billing key or any `env` secret.

## Watch for, when it runs

1. The bundle phase log — confirm it prints the JS bundle step without the
   `No such file or directory` split. That's the direct proof the fix holds.
2. If prebuild is skipped and a stale `ios/` is reused, the plugin won't have
   re-applied — a clean build (or `eas build --clear-cache`) guarantees prebuild
   runs the plugin.

## Not build blockers, but Release-functionality blockers (founder-owned)

These do not stop the build; they affect the shipped app and are on the
START-HERE "blocked on the founder" list:
- **RevenueCat webhook secret unset** → paying users get 403 on every
  server-gated AI feature.
- **Sandbox web billing key live in production** → web purchases are not real
  money.
- `cost_seeds.deleted_at` column migration pending.
