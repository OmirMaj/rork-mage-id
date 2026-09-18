# mage-ar-track

A thin Expo module over ARKit world tracking, built for ONE job: measuring how
far off an auto-placed punch pin would land on the founder's own floor. It is a
**trial instrument, not a feature**. It draws nothing.

## Why there is no JavaScript in here

This directory contains native code and autolinking config only. Nothing in
`app/`, `components/` or `utils/` imports the `modules/` path, and Metro's graph
never contains this folder. JS reaches the module exactly one way:

```ts
// utils/arTrack/native.ts
const Native = requireOptionalNativeModule<MageArTrackNative>('MageArTrack');
```

`requireOptionalNativeModule` returns `null` when the installed binary has no
such module, where `requireNativeModule` would throw.

That is not a style preference. `app.json`'s `runtimeVersion` policy is
`appVersion`, and `expo.version` is `1.0.0`. If the AR build keeps `1.0.0`, the
new binary and every EXISTING production install share runtime `1.0.0`, so
every later `eas update --branch production` lands on **both**. A bundle that
imported this module at the top level would then reach installs whose binary has
no native half — which is exactly how build #12 rolled back silently
(`react-native-reanimated`; see `metro.config.js` and
`scripts/validate-native-surface.ts`).

So: no `main`, no `index.ts`, no JS entry point, and one nullable lookup behind
a feature check. `scripts/validate-ar-spike.ts` pins all of it.

## How it reaches the Podfile

`ios/` and `android/` are **gitignored**. The checked-in state of this repo is
Continuous Native Generation: EAS runs `expo prebuild` fresh on every build, so
anything hand-written into `ios/` on a developer's machine is thrown away.
Native code has to arrive through `app.json` plus autolinking.

`expo-modules-autolinking` defaults its `nativeModulesDir` to `<appRoot>/modules`
(`node_modules/expo-modules-autolinking/build/commands/autolinkingOptions.js`),
and the generated `ios/Podfile` already calls `use_expo_modules!`. A directory
here with an `expo-module.config.json` is therefore linked with:

- **no** entry in the repo's `package.json`,
- **no** Podfile edit,
- **no** config plugin.

`"platforms": ["apple"]` in `expo-module.config.json` means Android autolinking
never sees this module at all, so the Android build is untouched.

The sibling `package.json` here exists only to feed `ios/MageArTrack.podspec`
its version/licence/author fields, the same way every first-party Expo module's
podspec reads `../package.json`.

**Locally**, a dev client needs `npx expo prebuild -p ios` before
`expo run:ios`, or the module will not be in the Podfile.

## What it does NOT require

- **No `UIRequiredDeviceCapabilities: arkit`.** Capability requirements can only
  be maintained or relaxed across app updates — adding one would permanently
  narrow the installed base of a shipping app for a spike. Apple's guidance when
  AR is not the app's core purpose is the runtime `isSupported` check, which is
  what `getCapabilities()` does.
- **No minimum-iOS bump.** World tracking is iOS 11, `raycastQuery` is 13,
  `sceneDepth` is 14 — all under the 15.1 floor the Podfile already pins. Only
  `captureHighResolutionFrame` needs 16, and it is `@available`-guarded with a
  typed error on 15.x.
- **No new privacy label.** Frames stay on device; the one still that
  `captureFrame` writes goes to the app cache. **If this module ever uploads a
  frame, that stops being true and the App Store privacy answers change.**

`NSCameraUsageDescription` in `app.json` was extended with a true clause about
this tracking. `scripts/validate-ar-spike.ts` fails the build if that clause is
removed while the code still uses the camera.

## The five "no" states

Each gets its own sentence on `app/dev-ar-measure.tsx` — never one shared
"AR is unavailable":

| reason | what happened |
|---|---|
| `notInThisBuild` | `requireOptionalNativeModule` returned `null`. Only a new iPhone build can add native code; an OTA cannot. |
| `simulator` | Compiled out by `#if targetEnvironment(simulator)`. No camera, no motion sensors. |
| `unsupportedDevice` | `ARWorldTrackingConfiguration.isSupported` is false. |
| `cameraUndetermined` | Never asked. The button offers the prompt. |
| `cameraDenied` | Refused. Terminal until Settings changes. |

`hasLidar: false` is a sixth, softer state: it disables only the depth option,
with the reason on the control. LiDAR is Pro-only from the iPhone 12 Pro. The
raycast path works on every device.

## Design decisions worth not re-litigating

**`worldAlignment = .gravity`, not `.gravityAndHeading`.** The heading variant
ties the x/z axes to the compass, and the compass is the error source the
research rejected for indoor work (5.6°/9.2° heading error; magnetic
interference from the steel it would be measuring). Gravity alone gives a true
vertical and leaves heading to the origin the founder sets.

**Origin by subtraction, not `ARSession.setWorldOrigin(relativeTransform:)`.**
That call exists and is Apple-sanctioned, and it stays available for later. It
was not used here because passing the camera transform would carry the phone's
pitch and roll into the world basis and tilt the world off gravity, and because
it MUTATES the session — a bad matrix would silently corrupt every later reading
with nothing left to audit. Subtraction is arithmetic that can be printed,
logged, and redone from the exported raw track, which is the point of a measured
trial.

**`sessionShouldAttemptRelocalization` is true, and every reading carries an
epoch.** Without relocalization, ARKit starts a new world after an interruption
and the origin quietly stops meaning anything while every reading still looks
valid. With it, two readings from different epochs are comparable only when the
boundary is marked `relocalized: true`. `utils/arTrack/session.ts` refuses a
distance that spans an un-relocalized break and says so on screen.

**The origin-relative `local` point is LEFT-handed, and the fit never sees
it.** `local` is x = right, y = up, z = FORWARD of the way he faced at
setOrigin — a reading aid ("12 m ahead, 3 m right"). Because forward is ARKit's
−z, that frame is a reflection of ARKit world. Fed to a proper-rotation plan fit
it mirrors the floor, so `utils/arTrack/driftMath.ts` fits on the raw `world`
translation only. The validator carries a TS mirror of the Swift formula and
pins its text.

## The pass/fail bar — fixed before the walk (`utils/arTrack/bar.ts`)

Written down on 2026-09-17, before any data. It is copied into every exported
session file (`_derived.passFailBar`) and every number is pinned by
`scripts/validate-ar-spike.ts`, so moving it after the walk is a visible diff.
R = the short dimension of the median room on his floor, off the calibrated
sheet (typically 3–4 m).

**Which samples count:** tracked, in the same ARKit world as the anchors, and
at least **8 minutes AND 40 m** of walking since the last confirmed position.

| verdict | room-hit | median miss | worst miss | also |
|---|---|---|---|---|
| **Placed pin** (arrives pre-pinned) | ≥ 90% | ≤ 0.5R | ≤ 1.2R | zero cross-floor errors; tracking normal ≥ 95% of wall time; holds for ≥ 30 min / 150 m |
| **Suggestion only** (greyed, his tap still required) | ≥ 70% | ≤ 1.0R | ≤ 3R | |
| **Kill** (any one) | < 70% | > 1.0R | | any confident cross-floor error; tracking lost more than once per 10 min on bare floor; battery > 40%/hour; thermal throttling inside 30 min; re-anchoring needed more often than every 10 min |

**Kill regardless of metres — the null model.** Phase 1 already ships "carry the
last room pin" for free. ARKit must cut the median miss by **≥ 30%** AND post a
**higher room-hit rate** than that, or the AR track is dead.

Loop closure at the return station is reported and is **never** the bar.

## Typechecking the Swift without Xcode

`scripts/validate-ar-spike.ts` typechecks `ios/ARTrackSession.swift` and
`ios/ARTrackTypes.swift` — both the device slice and the simulator slice —
against `typecheck/Stubs.swift` whenever the Command Line Tools' `swiftc` and a
macOS SDK are present. It catches the class of error that breaks every iOS
build regardless of SDK (access control, typos, optionality). `typecheck/` sits
beside `ios/`, so the podspec never compiles the stubs.

## The numbers this exists to replace

Do not quote ARKit marketing. The two honest published figures are:

- **0.14–0.79 m** of error at the END of **84–145 m CLOSED loops** — a
  flattering denominator, because a constant scale or heading bias cancels at
  the start point;
- **~0.02–0.04 m/s** of relative drift, which at a ~1.1 m/s walking pace is
  roughly **2–4% of the distance walked, one way** (~0.9–1.8 m over 50 m).

And ARKit tracks the **phone**, not the defect across the room. A pin on the
defect needs a raycast, or LiDAR depth that only Pro iPhones carry.
