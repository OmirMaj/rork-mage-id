# mage-room-scan

A thin Expo module over Apple RoomPlan (`RoomCaptureView`), for Scan The Room.
It presents Apple's own scanner full screen and hands back Apple's
`CapturedRoom` as JSON, untouched. All geometry, quantities and pricing live in
TypeScript under `utils/roomScan/`, where they are tested without a phone and
can be fixed over the air.

**Status: written, never compiled against the iOS SDK, never run on a phone,
not in any release.** The feature is dark behind `SCAN_ROOM_ENABLED = false`
(`constants/featureFlags.ts`). Read `docs/scan-the-room-native-checklist.md`
before the first build.

## Why there is no JavaScript in here

Same rule, same reason, as `modules/mage-ar-track` (read its README). The
directory holds native code and autolinking config only. JS reaches the module
exactly one way:

```ts
// utils/roomScan/native.ts, inside native(), after the flag check
cached = requireOptionalNativeModule<MageRoomScanNative>('MageRoomScan');
```

`app.json`'s `runtimeVersion` policy is `appVersion` and `expo.version` stays
`1.0.0`, so every over-the-air update lands on every installed build, including
the ones built before this module existed. `requireOptionalNativeModule`
returns `null` there; `requireNativeModule` would throw. So: no `main`, no
`index.ts`, one nullable lookup that is not at module scope and is refused
while the flag is off. `scripts/validate-scan-room.ts` pins all of it.

## How it reaches the Podfile

Autolinking. `expo-modules-autolinking` scans `<appRoot>/modules` and the
generated Podfile calls `use_expo_modules!`, so this directory is linked with
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

## What it DOES require before any build

The camera purpose string in `app.json` must change in the same commit that
ships a build containing this module: today it says "no video is recorded, kept
or uploaded", and a scan keeps the shape of the room. The wording and the
validator change are written out in `docs/scan-the-room-native-checklist.md`.
This lane does not touch `app.json`.

## The ways it says "no"

| reason | what happened |
|---|---|
| `notInThisBuild` | The optional lookup returned `null`. Only a new iPhone build adds native code. |
| `osTooOld` | iOS below 16. |
| `noLidar` | `RoomCaptureSession.isSupported` is false. |
| `simulator` | Compiled out. No camera, no LiDAR. |
| `cameraUndetermined` | Never asked. The screen offers the prompt. |
| `cameraDenied` | Refused. Only Settings changes it. |

Each has its own sentence on the screen (`hooks/useRoomScanCopy.ts`).

## Typechecking the Swift without Xcode

`scripts/validate-scan-room.ts` typechecks the three files in `ios/` against
`typecheck/Stubs.swift`, with RoomPlan present and with it compiled out,
whenever the Command Line Tools' `swiftc` is on the machine. The stubs are a
claim about Apple's API, written from the documentation. They catch typos,
access control and optionality. They cannot catch a RoomPlan signature the
stubs have wrong. EAS and a real phone are the final word.

## Not in this module yet

The build plan lists these for the same native build, so a later phase does not
need another one. None is written: joining rooms (`StructureBuilder`, iOS 17),
drawing a plan image, Quick Look preview of the USDZ, saving an `ARWorldMap`.
