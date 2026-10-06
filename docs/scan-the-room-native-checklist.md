# Scan The Room: What The Next Native Build Needs

Written 2026-10-06 by lane SCANROOM. The JavaScript for Phase 1 is in the repo
and dark (`SCAN_ROOM_ENABLED = false`). The native module
(`modules/mage-room-scan`) is written and has never been compiled against the
iOS SDK or run on a phone. Nothing here has been applied, built or submitted.

Work through this page in order. Do not turn the flag on until section 8 is
done.

## 1. Founder decisions first

1. **Does the next iPhone build carry the scanner?** `modules/` autolinks into
   every iOS build, so the next `eas build` will compile this Swift whether or
   not the feature is on. If the answer is "not yet", move
   `modules/mage-room-scan` out of `modules/` before building.
2. **A job with no estimate.** Today the priced draft can only go into a job
   that already has an estimate (the takeoff's own rule: an empty estimate has
   no markup ratio, so pushed lines would carry no markup). A fresh job shows
   "This project has no estimate yet". Decide whether a scan may start an
   estimate at the default markup in Settings.
3. **Where the scan lives.** This lane keeps a scan on the phone it was made on
   (section 6). Decide whether Phase 1 needs the cloud table before launch.
4. **The door into the feature.** There is none yet. The project-page tile is
   five small edits in `app/project-detail.tsx` plus one row in
   `utils/projectWorkspaceLayout.ts` (copy the `permitPath` tile), and it
   belongs in the change that turns the flag on.

## 2. Permission wording (must ship in the same commit as the build)

`app.json` `expo.ios.infoPlist.NSCameraUsageDescription` today ends:

> ... so it can record where on the floor you were standing; no video is
> recorded, kept or uploaded, and the tracking stops when you leave that
> screen.

That sentence is about the measuring screen and stays true of it. A room scan
keeps something: the shape and sizes of the room. Proposed new string (the
existing text, then one added sentence):

> MAGE ID uses your camera to capture jobsite photos for daily reports,
> punch-list items, RFIs, and project documentation. Photos are stored against
> the project they were taken on. On iPhone it also uses the camera to track
> how the phone moves through a space while a measuring screen is open, so it
> can record where on the floor you were standing; no video is recorded, kept
> or uploaded, and the tracking stops when you leave that screen. On an iPhone
> with a LiDAR sensor it also uses the camera and the depth sensor to measure a
> room when you start a room scan; the scan saves the shape and sizes of the
> room to your project, and no video is saved.

Validator changes, in the same commit:

- `scripts/validate-ar-spike.ts` (the block that reads
  `NSCameraUsageDescription`): its three pins still pass on the new string
  (`track how the phone moves`, `no video is recorded, kept or uploaded`,
  `stops when you leave`). Add one pin so the scan sentence cannot be quietly
  removed while the module is linked:
  `ok('the camera purpose string covers a room scan', /measure a room when you start a room scan/i.test(camera) && /no video is saved/i.test(camera));`
- `scripts/validate-ios-permission-strings.ts`: it does not pin the wording. It
  checks that every purpose string starts with "MAGE ID " and is specific. The
  new string passes unchanged. (The build plan said this file pins the text. It
  does not.)
- `scripts/validate-scan-room.ts` rule N8 fails on purpose when `app.json`
  mentions a room scan while this lane's rule still says "not changed by this
  lane". Replace that check with the pin above, in the same commit.

No new Info.plist key is needed. RoomPlan uses the camera permission only.
There is no separate LiDAR permission. Do not add
`UIRequiredDeviceCapabilities`.

Also in that commit, outside the code:

- App Store privacy answers: a saved room shape tied to a project and an
  address is user content. Review "User Content" and "Other Data" with the
  lawyer question already open for the privacy paragraph.
- The privacy page: one paragraph on what a scan saves (shape and sizes, no
  video, no photo), where it is kept, and that the contractor can delete it.

## 3. iOS availability

- The app's floor stays iOS 15.1. RoomPlan needs iOS 16 and a LiDAR sensor
  (iPhone 12 Pro and newer Pro models, and iPad Pro; the app does not support
  iPad).
- The podspec sets `s.weak_frameworks = 'RoomPlan'`. **Check on an iOS 15
  phone or simulator that the app launches with the module linked.** A hard
  link would crash at launch (dyld: Library not loaded) before any JavaScript
  runs. This is the single most important device check.
- Joining rooms and `polygonCorners` are iOS 17. Phase 1 uses neither natively.

## 4. Every Swift line to read before trusting the build (UNSURE list)

Written from Apple's documentation. The Mac typecheck uses hand-written stubs
(`modules/mage-room-scan/typecheck/Stubs.swift`), so it proves the Swift is
well-formed, not that it matches Apple's SDK.

| # | File | What | Why unsure | What to do |
|---|---|---|---|---|
| 1 | `MageRoomScan.podspec` | `s.weak_frameworks = 'RoomPlan'` | Not checked that CocoaPods plus a static framework carries the weak link into the app target | Launch on iOS 15. If it crashes at launch, add `-weak_framework RoomPlan` to `OTHER_LDFLAGS` through a config plugin |
| 2 | `RoomScanSupport.swift` | `class RoomScanViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate` | `RoomCaptureViewDelegate` inherits `NSCoding` in the SDK. A `UIViewController` already conforms, which is why the controller is its own delegate. If the compiler asks for `encode(with:)`, add an empty override | First compile |
| 3 | `RoomScanSupport.swift` | `captureView(shouldPresent:error:)` and `captureView(didPresent:error:)` | Exact parameter labels (`roomDataForProcessing`, `processedResult`) are from Apple's sample | First compile |
| 4 | `RoomScanSupport.swift` | `captureSession(_:didProvide:)` switch over `RoomCaptureSession.Instruction` | Case names (`moveCloseToWall`, `moveAwayFromWall`, `slowDown`, `turnOnLight`, `lowTexture`, `normal`) are from the documentation | First compile |
| 5 | `RoomScanSupport.swift` | `captureSession(_:didEndWith:error:)` | Whether a failed session also calls `captureView(didPresent:)`. The code reports the error here and guards against resolving twice | Deny the camera mid-scan, cover the lens, and check one result arrives |
| 6 | `RoomScanSupport.swift` | `try processedResult.export(to: url, exportOptions: .parametric)` | Signature from the documentation; off by default (`exportUsdz: false`) | Turn it on in a dev build and log the file size |
| 7 | `RoomScanSupport.swift` | `JSONEncoder().encode(processedResult)` | `CapturedRoom` is documented as `Codable`. The KEY NAMES and the layout of `transform` and `dimensions` in the output are not documented | Section 5 |
| 8 | `RoomScanSupport.swift` | `UINavigationController` wrapper with system Cancel and Done | Whether the bar covers Apple's own coaching text at the top of `RoomCaptureView` | Look at it on a phone. If it does, make the bar transparent or move the buttons |
| 9 | `RoomScanSupport.swift` | `viewWillDisappear` stops the session | Whether stopping there also fires when Apple presents its own sheet on top | Check a normal Done still returns a room |
| 10 | `MageRoomScanModule.swift` | `AsyncFunction("startScan") { (options: RoomScanStartOptions, promise: Promise) in ... }.runOnQueue(.main)` | The record-plus-promise closure form with `runOnQueue` is used by Expo's own modules, not by `mage-ar-track` | First compile |
| 11 | `MageRoomScanModule.swift` | `self.appContext?.utilities?.currentViewController()` | Returns the top controller in Expo SDK 54. Not checked from inside a modal route | Start a scan from the screen as it is presented |
| 12 | `RoomScanSupport.swift` | `UIApplication.shared.isIdleTimerDisabled` | Restored in two places; check the phone still sleeps after a scan | Leave the phone after a scan |
| 13 | `RoomScanSupport.swift` | `#if canImport(RoomPlan) && !targetEnvironment(simulator)` | Whether RoomPlan can be imported on the simulator at all is moot here: the simulator slice never imports it | Build for the simulator once |

## 5. First real export (the parser has not read one)

`utils/roomScan/capturedRoomParser.ts` was written from Apple's documented
structure. The three fixtures in `scripts/fixtures/scan-room/` were built by
hand. Before anything else is tested:

1. Scan one small room. Get the raw JSON off the phone (log
   `capturedRoomJson` from a dev build, or add a share button to an owner-only
   screen).
2. Save it as `scripts/fixtures/scan-room/real-<room>.json` and add it to
   `validate-scan-room.ts` with the room's taped sizes as the answers.
3. Expect to fix: the names of the top-level lists, how `category` and
   `confidence` are written, whether `transform` is 16 numbers or 4 columns,
   whether `dimensions` is an array, where `polygonCorners` live and in which
   frame, how `curve` is written. The parser already accepts several spellings
   of each. The real export says which one is true.
4. Check the plan is not mirrored: stand in the doorway, note which side the
   window is on, compare with the drawing.
5. Check ceiling height against a tape. The parser takes a wall's height from
   its `dimensions`. If walls come back with no height, the screen asks for it.

## 6. Storage, and the table this lane did not create

A scan is saved on the phone only, in AsyncStorage under the app-owned prefix:
`mageid_room_scans::<projectId>` (the room models) and
`mageid_room_scan_raw::<scanId>` (Apple's JSON). The tenant-switch sweep
removes both. Nothing is written to the server. A scan made on one phone is not
on another, and signing out removes it. **Tell the founder this before anyone
relies on a saved scan.**

No migration is in `supabase/migrations/`. The table the build plan proposes,
for the sync lane to apply with the Supabase `apply_migration` tool (never
`supabase db push`) BEFORE any update that writes to it, or the offline queue
drops the writes:

```sql
create table public.room_scans (
  id                 uuid primary key,
  project_id         uuid not null references public.projects(id) on delete cascade,
  user_id            uuid not null,
  name               text not null,
  captured_at        timestamptz not null,
  server_received_at timestamptz not null default now(),
  scan               jsonb not null,
  quantities         jsonb not null,
  raw                jsonb,
  raw_sha256         text not null,
  usdz_path          text,
  deleted_at         timestamptz,
  constraint room_scans_size check (octet_length(scan::text) + coalesce(octet_length(raw::text), 0) <= 2097152)
);
alter table public.room_scans enable row level security;
-- Policies: copy takeoff_docs (project owner and accepted collaborators).
-- Also: add room_scans to supabase/functions/delete-account, and prove the
-- file in PGlite the way the last migrations were proven.
```

Not run anywhere, not proven in PGlite. The 2 MB cap is a guess until real
exports are measured. Writes go through `utils/offlineQueue.ts`
(`supabaseWriteDetailed`), never `supabase.from().insert` from a screen. No
storage bucket is needed while the USDZ file is off.

## 7. What to test on a real LiDAR iPhone, and how

Nothing here can be shown on a simulator. RoomPlan does not run there.

1. **Old build, new update.** Install the current App Store or TestFlight build
   (without the module). Publish this JavaScript to its channel with the flag
   on in a preview branch. The app must open, and `/scan-room` must say "This
   version of the app does not include room scanning".
2. **iOS 15 with the module.** Section 3. The app must launch.
3. **A non-LiDAR iPhone with the module** (a standard iPhone 13 or 15). The
   screen must say "This iPhone has no LiDAR sensor".
4. **Camera permission.** Fresh install: Allow Camera shows the system prompt
   with the new sentence. Refuse it: the screen offers Open Settings and a scan
   does not start.
5. **A scan starts, finishes and returns JSON.** Then section 5.
6. **Cancel.** Returns to the start with nothing saved and no error.
7. **Interruptions.** Take a phone call mid-scan. Lock the phone mid-scan. Kill
   the app mid-scan. No crash on return, no half-saved scan.
8. **Hard rooms, on purpose:** a bathroom with a full-wall mirror, a room with
   a glass slider, a dark basement, a room over 30 ft, a stair hall, a sloped
   attic, a gutted room with open studs, a room full of stacked material, a
   hallway, a closet. Write down what the plan got wrong.
9. **Corrections.** Tap a wall, type a tape value: the area changes, the wall
   is outlined, the opposite wall moves and says so. Type a value that cannot
   close: the floor area goes to Not Known.
10. **Pricing.** On a job with an estimate and a cost book: each line shows
    where its price came from, a line with no price shows No Price Yet, the
    total leaves it out. Open In Estimate asks first. After yes, the estimate
    has the lines, its history has the old estimate, and pricing the same scan
    again updates the lines instead of adding copies.
11. **Heat and battery** over five scans in a row.
12. **iOS 16, 17, 18 and 26**, from TestFlight, not from Xcode (a developer
    report says captures look wrong on iOS 26 from Xcode only; not confirmed).
13. **Spanish.** Switch the app to Spanish and read all four screens.

## 8. The ten-room tape-measure test (agreed with the founder)

The app quotes nobody's accuracy number until this exists.

- Ten rooms, real jobs if possible: at least two bathrooms, one kitchen, one
  bedroom, one room over 20 ft, one with a mirror wall, one not square.
- In each: scan it once. Then measure every wall with a tape (and a laser if
  there is one), the ceiling height in two places, every door and window width
  and height.
- Record per measurement: room, what was measured, tape value, scan value, the
  difference in inches, the iPhone model, the iOS version.
- From the table: the typical miss and the worst miss on a wall, by wall
  length; the miss on floor area; how often a wall, door or window was missed
  or invented.
- That table is what any sentence about how close a scan is must quote, with
  the number of rooms beside it. Until it exists the screen says only: "A phone
  scan can be off by an inch or more."
- The screen's Tape Check (one wall per room, kept beside the scan, never used
  to scale it) is the long-run version of this table. The model stores it
  (`RoomScan.tapeChecks`); the plan screen does not ask for it yet.

## 9. Not built in this lane

- The project-page tile and any other door into the feature.
- Cloud sync of scans (section 6) and the USDZ upload.
- The native extras the build plan wants in the same build: joining rooms,
  a plan image (which is what lets a scan become a Plan Sheet with punch pins),
  Quick Look, `ARWorldMap`.
- The tape check prompt on the plan screen; a trade picker on a draft line.
- A file cleanup step on sign-out (nothing writes a file yet).
