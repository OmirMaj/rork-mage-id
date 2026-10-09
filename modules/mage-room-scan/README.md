# mage-room-scan

A thin Expo module over Apple RoomPlan (`RoomCaptureView`), for Scan The Room.
It presents Apple's own scanner full screen and hands back Apple's
`CapturedRoom` as JSON, untouched. All geometry, quantities and pricing live in
TypeScript under `utils/roomScan/`, where they are tested without a phone and
can be fixed over the air.

**Status (2026-10-08, lane SCANBUILD): in the build, for the owner only.** The
three Swift files compiled unchanged against the real ExpoModulesCore and
Apple's RoomPlan, and the whole app linked for a real iPhone (Release,
`iphoneos`, unsigned) on a Mac. `otool` showed RoomPlan as a weak link
(`LC_LOAD_WEAK_DYLIB`) with all 50 of its symbols weak imports. **It has still
never run on a phone.** The feature stays dark behind `SCAN_ROOM_ENABLED = false`
(`constants/featureFlags.ts`); only the owner's account reaches it
(`utils/roomScan/allowed.ts`).

## Why it is under modules/

Expo autolinking compiles every folder under `<appRoot>/modules` into the next
iOS build by itself. That is how the scanner gets into the owner preview build.
`bun run test:scan-room` fails if the folder leaves `modules/`, if
`package.json` leaves it out of autolinking, if the podspec stops weak-linking
RoomPlan or raises the iOS 15.1 floor, or if the Swift asks for a USDZ file, a
camera frame or video.

What is still owed before the public can have it is in
`docs/scan-the-room-native-checklist.md`. The first item is one launch of a
build that carries this module on a PHYSICAL iOS 15 phone. Not a simulator: the
simulator compiles RoomPlan out, so it proves nothing about the link.

## What comes back from a scan

`startScan` resolves with Apple's `CapturedRoom` as JSON, untouched, and beside
it a small `summary` counted in Swift on the `CapturedRoom` itself (walls,
doors, windows, openings, objects, each wall's dimensions, and the first wall's
transform as 16 numbers). The summary does not pass through `JSONEncoder`, so it
is what the JSON and the TypeScript parser are checked against. A room that will
not encode still comes back as a finished scan, with an empty JSON string, the
reason in `encodeError`, and the summary.

## Why there is no JavaScript in here

Same rule, same reason, as `modules/mage-ar-track` (read its README). The
directory holds native code and autolinking config only. JS reaches the module
exactly one way:

```ts
// utils/roomScan/native.ts, inside native(userEmail), after the gate
cached = requireOptionalNativeModule<MageRoomScanNative>('MageRoomScan');
```

`app.json`'s `runtimeVersion` policy is `appVersion` and `expo.version` stays
`1.0.0`, so every over-the-air update lands on every installed build, including
the ones built before this module existed. `requireOptionalNativeModule`
returns `null` there; `requireNativeModule` would throw. So: no `main`, no
`index.ts`, one nullable lookup that is not at module scope and is refused
for everyone the gate refuses (the flag is off and he is not the owner). `scripts/validate-scan-room.ts` pins all of it.

## How it reaches the Podfile

Autolinking. `expo-modules-autolinking` scans `<appRoot>/modules` and the
generated Podfile calls `use_expo_modules!`, so a directory there is linked with
no entry in the root `package.json`, no Podfile edit and no config plugin.
`"platforms": ["apple"]` keeps Android untouched. Locally, run
`npx expo prebuild -p ios` before `expo run:ios`.

## What it does not require

- **No `UIRequiredDeviceCapabilities`.** LiDAR is checked at run time
  (`RoomCaptureSession.isSupported`). A capability key would narrow the
  installed base of a shipping app for ever.
- **No minimum-iOS bump.** The floor stays 15.1. RoomPlan is iOS 16:
  `import RoomPlan` is behind `#if canImport(RoomPlan)`, every type that names
  it is `@available(iOS 16.0, *)`, the podspec weak-links the framework, and
  on iOS 15 the module answers `osTooOld`.
- **No camera prompt of its own.** It reads the permission and refuses with a
  typed error; JS raises the prompt through expo-image-picker.

## The camera sentence

`app.json`'s camera purpose string covers a room scan since 2026-10-08: when
you scan a room the app keeps the room's measurements on your phone, and video
of a scan is not recorded, kept or uploaded. That is true of this Swift: it
asks RoomPlan for the finished room only, reads no camera frame, records
nothing, and writes no file (the USDZ export is off unless asked for, and the
app never asks). `scripts/validate-scan-room.ts` (rules N5 and N8) and
`scripts/validate-ar-spike.ts` pin both the sentence and the Swift.

## The ways it says "no"

| reason | what happened |
|---|---|
| `notInThisBuild` | The optional lookup returned `null`. Only a new iPhone build adds native code. |
| `osTooOld` | iOS below 16. |
| `noLidar` | `RoomCaptureSession.isSupported` is false. |
| `simulator` | Compiled out. No camera, no LiDAR. |
| `cameraUndetermined` | Never asked. The screen offers the prompt. |
| `cameraDenied` | Refused. Only Settings changes it. |

And a scan that started can end six ways, each settled exactly once: done,
cancelled, a session error (with RoomPlan's own error name), interrupted (the
app left the screen: `E_ROOM_SCAN_INTERRUPTED`), a room that would not encode
(still resolved, with `encodeError`), and a scanner that never got on screen.

Each has its own sentence on the screen (`hooks/useRoomScanCopy.ts`).

## Typechecking the Swift

`scripts/validate-scan-room.ts` does it two ways.

1. **Against stubs, on any Mac with the Command Line Tools.** The three files
   in `ios/` are typechecked against `typecheck/Stubs.swift`, with RoomPlan
   present and with it compiled out. The stubs are a claim about Apple's API.
   They catch typos, access control and optionality.
2. **Against Apple's own iOS SDK, when full Xcode is installed.** The same three
   files, unchanged, are typechecked against the real UIKit, AVFoundation and
   RoomPlan for a phone (deployment target 15.1) and for the simulator. Only
   ExpoModulesCore is a stub there (the top section of `Stubs.swift`); the
   calls it stands in for were read against
   `node_modules/expo-modules-core/ios`. This is the check that says the
   RoomPlan names and signatures are right. It last passed on Xcode's
   iPhoneOS 27.0 SDK on 2026-10-08.

Neither is a link or a run. The link was done once by hand on 2026-10-08 (the
commands and the `otool` lines are in the checklist). Whether the weak link
holds on a real iOS 15 phone, and everything RoomPlan does with a camera, is
settled only by a build on a phone. Both typechecks only run on a Mac: on the
Linux gate they are skipped.

## Not in this module yet

The build plan lists these for the same native build, so a later phase does not
need another one. None is written: joining rooms (`StructureBuilder`, iOS 17),
drawing a plan image, Quick Look preview of the USDZ, saving an `ARWorldMap`.
