# Scan The Room: The Owner Preview Build, And What Is Left

Updated 2026-10-08 by lane SCANBUILD. The native module is now under
`modules/mage-room-scan`, so the next iPhone build carries the scanner. The flag
stays off (`SCAN_ROOM_ENABLED = false`): only the owner's account
(`utils/owner.ts`) sees the one row that opens it. **Nobody has run the scanner
on a phone yet.** The first scan is the test.

## What The Owner Preview Build Contains

- The Swift module (Apple RoomPlan's own scanner, full screen), linked by Expo
  autolinking from `modules/mage-room-scan`.
- A new camera sentence in `app.json` (section 2).
- One row on the project page, under the project's name, on iPhone only:
  **Scan A Room (Owner Preview)**. It is drawn only for an email in
  `OWNER_EMAILS`. Everyone else has no row, `/scan-room` sends them Home, and
  the app never looks the native module up for them
  (`utils/roomScan/allowed.ts`, `bun run test:scan-room` rule N9).
- For the owner, after a scan: a **Scan Facts** block (iOS version, device
  model, scan time, raw size, top-level keys, and the counts of walls, doors,
  windows, openings and objects three ways: what the iPhone counted in Swift,
  what the file holds, what the app understood) and a **Share Raw Scan Data**
  button.
- The raw scan is kept on the phone the moment the scanner closes, before the
  app tries to read it, under `mageid_room_scan_raw::<scanId>`, with one small
  record of the last scan under `mageid_room_scan_last`. A scan that cannot be
  read is still there to share, also after the app is closed and opened again.
- No USDZ file, no video, no camera frame, no upload. The module asks RoomPlan
  for the finished room and nothing else.

What it does NOT contain: any change to `expo.version`, the bundle ids,
`eas.json` or the orientation keys. No migration, no edge function.

## How It Was Built And Checked (2026-10-08, On A Mac With Xcode 27.0)

The three Swift files compiled UNCHANGED against the real ExpoModulesCore and
Apple's RoomPlan, and the whole app linked. These are the commands that worked,
run from the repo root. `ios/` is gitignored and was deleted afterwards.

```sh
npx expo-modules-autolinking search --platform apple   # lists mage-ar-track and mage-room-scan
npx expo prebuild --platform ios --no-install
(cd ios && LANG=en_US.UTF-8 pod install)
SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild -workspace ios/MAGEID.xcworkspace -scheme MAGEID -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' -derivedDataPath ios/DerivedData -jobs 4 \
  IPHONEOS_DEPLOYMENT_TARGET=15.1 CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
otool -L ios/DerivedData/Build/Products/Release-iphoneos/MAGEID.app/MAGEID | grep RoomPlan
otool -l ios/DerivedData/Build/Products/Release-iphoneos/MAGEID.app/MAGEID | grep -B2 -A4 RoomPlan
nm -m  ios/DerivedData/Build/Products/Release-iphoneos/MAGEID.app/MAGEID | grep "(from RoomPlan)"
```

What the last three printed:

```
/System/Library/Frameworks/RoomPlan.framework/RoomPlan (compatibility version 1.0.0, current version 1.0.0, weak)
          cmd LC_LOAD_WEAK_DYLIB
         name /System/Library/Frameworks/RoomPlan.framework/RoomPlan (offset 24)
minos 15.1
50 undefined RoomPlan symbols, every one "weak external"
```

Three things about that build that were NOT the module, so nobody mistakes them
for it:

1. **Xcode 27 refuses pods whose own deployment target is below iOS 15** (twelve
   third-party resource targets). `IPHONEOS_DEPLOYMENT_TARGET=15.1` on the
   command line gets past it. It is the app's own floor, so the weak link was
   tested at the right floor.
2. **RevenueCat 5.67.1 does not compile with Xcode 27's Swift**
   (`PaywallColor.swift`: a memberwise initializer clashes with its own). One
   line was changed in the local `ios/Pods` copy only
   (`(any Sendable)?` to `Optional<any Sendable>`). Nothing in the repo changed.
   EAS builds with an older Xcode and is not affected today; it will be when the
   EAS image moves to Xcode 27.
3. **The JavaScript bundle step of that build failed** on this Mac only: the
   checkout's `node_modules` is a link to a folder with a space in its name, and
   the "Bundle React Native code and images" script still has one unquoted
   path (`plugins/withQuotedXcodeScriptPaths.js` quotes the second path on that
   line and misses the first). Every native target compiled and the app binary
   linked before that step, which is what this check was for. EAS builds in a
   path with no spaces.

So: the native half is compiled and linked. It has not run.

`bun run test:scan-room` now holds the build to this: the module is under
`modules/` and found by the autolinking search, the podspec weak-links RoomPlan
and keeps iOS 15.1, every RoomPlan use is behind `@available(iOS 16.0, *)` or an
`if #available`, no USDZ, video or frame is asked for, and the owner gate
holds. **The two Swift typechecks only run on a Mac** (they need Xcode or the
Command Line Tools; on the Linux gate on GitHub they print SKIPPED, so a Swift
mistake is caught on a Mac or in the EAS build, not on GitHub). The autolinking
search and every other rule run on Linux too. The link and the `otool` check are
not in any gate: they were done by hand, once, as above.

## Your First Scan, Step By Step

1. Install the new build from TestFlight on the iPhone 15 Pro Max. Sign in with
   your own account (the one in `OWNER_EMAILS`).
2. Open any project you own. Under the project's name there is a row:
   **Scan A Room (Owner Preview)**. Tap it. (No row: you are signed in with
   another account, or the build is an older one.)
3. The start screen says what a scan is and lists five tips. The first time,
   it shows **Allow Camera**. Tap it. The system asks, with the new sentence.
   Tap Allow. (If you refuse, the screen offers **Open Settings**.)
4. Pick a small plain room first: a bathroom or a bedroom, lights on, doors
   closed. Tap **Start Scanning**.
5. Apple's scanner opens full screen with Cancel and Done at the top. Walk the
   room slowly and point the phone at every wall, floor to ceiling. White
   outlines appear on what it has found. Thirty seconds to two minutes is
   plenty for one room. Keep the app open and the phone unlocked.
6. Tap **Done**. Apple shows the finished model for a moment, then the scanner
   closes.
7. One of two screens follows.
   - **The floor plan**, with the room drawn and its sizes. Scroll down: below
     the plan is **Scan Facts**. Read the counts. The three columns (Phone,
     File, App) should say the same numbers. A row in the warning colour is a
     mismatch.
   - **"The scan finished, but MAGE could not read it yet."** That is not a
     failure of the scan. It is the answer we need: the same Scan Facts block is
     there, with the raw size, the top-level keys and the error.
8. Either way, tap **Share Raw Scan Data** and send the file to yourself
   (AirDrop to the Mac, or Messages, or Mail). The file is named
   `mage-room-scan-<date>-<room name>.json`. It holds the room's shapes and
   sizes and the facts on that screen. No photos, no video.
9. Before leaving the room, measure two walls and the ceiling height with a
   tape and write them down with the file.
10. **BLOCKING, in a bathroom: the toilet and the sink.** With a tape, write
    down for the toilet and for the sink: how wide it is along the wall, how
    far it comes out from the wall, and how far its center line is from each
    side wall. Send those with the file. The reason is under
    **Clearance Check** below: nobody knows yet which of a box's two floor
    sizes Apple calls its depth.

If the app was closed before you shared: open the row again. The start screen
shows **Last Scan On This Phone** with the same block and the same button.

## What To Send Back

1. The `.json` file from Share Raw Scan Data, for every scan you make (good and
   bad). A scan that could not be read is the most useful one.
2. Which screen you got in step 7, and a screenshot of Scan Facts.
3. The tape sizes of two walls and the ceiling height of that room.
4. Anything the scanner itself did that looked wrong: the Cancel and Done bar
   covering Apple's own words at the top, a long wait after Done, the screen
   going dark, the phone getting hot.
5. If a scan stopped with a sentence on the start screen, a screenshot of it
   (your account also sees a line starting "What the iPhone said:").

## Every Way A Scan Can End, And What The Screen Says

| What happened | What you see |
| --- | --- |
| The build has no scanner (an older build, with this JavaScript over the air) | "This version of the app does not include room scanning." No crash: the lookup answers "not in this build". |
| iOS below 16 | "Room scanning needs iOS 16 or later." |
| No LiDAR | "This iPhone has no LiDAR sensor." |
| Camera never asked | Allow Camera button |
| Camera refused | The reason, and an Open Settings button |
| You tap Cancel | Back on the start screen: "The scan was cancelled. Nothing was saved." |
| You tap Done after a few seconds | The unread screen: "The scan finished, but it holds no walls." with Scan Facts |
| RoomPlan stops the scan (tracking lost, too hot, too large) | "The iPhone stopped the scan before it finished." and, for you, RoomPlan's own error |
| The phone is locked, or the app leaves the screen | The scanner closes. "The scan stopped because the app left the screen." |
| The room would not encode as data | The unread screen, with the iPhone's own counts |
| The app cannot read the JSON | The unread screen, with the raw size, the keys, the error and the share button |

## What Remains Before The Public Can Have It

**THE PHYSICAL iOS 15 LAUNCH TEST IS STILL REQUIRED BEFORE A PUBLIC RELEASE AND IS NOT COVERED BY THIS BUILD.**
`otool` shows RoomPlan as a weak link, which is
the reason to expect an iOS 15 phone to launch. It is not a launch. A build that
carries this module has to be opened once on a PHYSICAL iOS 15 phone before any
release to the public. A simulator cannot stand in: the simulator compiles
RoomPlan out, so it proves nothing about the link. The owner's iPhone 15 Pro Max
cannot run iOS 15 either.

Also still owed, in this order:

1. A real export parses, and is a fixture (section 5). The first scan starts
   this.
2. The scanner is checked by hand on the phone: every line of the UNSURE list
   (section 4).
3. The App Store privacy answers and the privacy page cover a saved room shape
   (section 2).
4. The ten-room tape-measure test (section 8).
5. Then, and only then, `SCAN_ROOM_ENABLED = true`, with a door for everyone
   (the owner row is replaced by a project-page tile).

## 0. What Had To Be True Before This Build (Done 2026-10-08, Except Step 4)

1. **Move it back.** Done: the module is in `modules/mage-room-scan`.
2. **Compile it once against the real ExpoModulesCore.** Done, in a local
   build. It compiled unchanged.
3. **Run `otool -L` on the built app and require RoomPlan to be a WEAK link.**
   Done. The line ends in `(..., weak)`.
4. **Launch that build once on a PHYSICAL iOS 15 phone.** NOT DONE. See above.
   The simulator compiles RoomPlan out (`#if canImport(RoomPlan) &&
   !targetEnvironment(simulator)`), so a simulator proves nothing about the
   link: it never links RoomPlan at all.

## 1. Founder decisions first

1. **Does the next iPhone build carry the scanner?** Yes, since 2026-10-08. A
   build made before that has no scanner in it, and there the screen says "This
   version of the app does not include room scanning".
2. **A job with no estimate.** Decided 2026-10-06: the confirm sheet starts the
   estimate. It uses the app's own "new estimate from cost lines" writer
   (`utils/estimateLanding.buildNewEstimate`, the one the AI takeoff's Replace
   and the Drawing Analyzer use) at the markup the contractor has already
   stated in the estimator, the wizard or Quick Quote. If he has never stated
   one, the push is blocked and says to choose a markup first: a markup he
   never chose is never written.
3. **Where the scan lives.** This lane keeps a scan on the phone it was made on
   (section 6). Decide whether Phase 1 needs the cloud table before launch.
4. **The door into the feature.** For the owner: one row under the project's
   name (`components/roomScan/ScanRoomOwnerRow.tsx`). For everyone else there
   is none yet. The project-page tile is
   five small edits in `app/project-detail.tsx` plus one row in
   `utils/projectWorkspaceLayout.ts` (copy the `permitPath` tile), and it
   belongs in the change that turns the flag on.

## 2. Permission wording (changed 2026-10-08, in the same commit as the module)

`app.json` `expo.ios.infoPlist.NSCameraUsageDescription` is now the old text and
one added sentence:

> MAGE ID uses your camera to capture jobsite photos for daily reports,
> punch-list items, RFIs, and project documentation. Photos are stored against
> the project they were taken on. On iPhone it also uses the camera to track
> how the phone moves through a space while a measuring screen is open, so it
> can record where on the floor you were standing; no video is recorded, kept
> or uploaded, and the tracking stops when you leave that screen. When you scan
> a room on an iPhone with a LiDAR sensor, the camera and the depth sensor
> measure the room, and the app keeps the room's measurements (its walls,
> doors, windows and fixtures, and their sizes) on your phone; video of a scan
> is not recorded, kept or uploaded.

It is true of the Swift: the module takes RoomPlan's finished room (surfaces and
objects with sizes and positions), reads no camera frame, records nothing and
writes no file. The validators that hold it:

- `scripts/validate-scan-room.ts` rule N8 pins the three clauses of the new
  sentence and that the measuring screen's part is still there; rule N5 fails if
  the Swift ever asks for a USDZ file, a camera frame or video.
- `scripts/validate-ar-spike.ts` pins the scan clause beside its own three.
- `scripts/validate-ios-permission-strings.ts` does not pin the wording. It
  checks that every purpose string starts with "MAGE ID " and is specific. The
  new string passes unchanged.

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
- The podspec sets `s.weak_frameworks = 'RoomPlan'`. The weak link is proven
  once (`otool -L` on the built app, 2026-10-08) and owed once more: **one
  launch on a PHYSICAL iOS 15 phone** (section 0, step 4). A hard link would crash at launch (dyld:
  Library not loaded) before any JavaScript runs. This is the single most
  important device check. A simulator cannot stand in for it: the simulator
  compiles RoomPlan out, so it proves nothing.
- Joining rooms and `polygonCorners` are iOS 17. Phase 1 uses neither natively.

## 4. Every Swift line to read before trusting the build (UNSURE list)

Two things were checked on a Mac with Xcode on 2026-10-06, and
`bun run test:scan-room` repeats both whenever Xcode is installed:

- The three Swift files, unchanged, typecheck against Apple's real UIKit,
  AVFoundation and RoomPlan (iPhoneOS 27.0 SDK, deployment target 15.1) and
  against the simulator SDK. So the RoomPlan type names, delegate method
  labels, `Instruction` cases, `export(to:exportOptions:)` and the `NSCoding`
  inheritance are right for that SDK.
- ExpoModulesCore was a stub in that check. Each call into it
  (`Record`, `@Field`, `Exception.code` and `reason`, `GenericException`,
  `Promise.resolve` and `reject`, `AsyncFunction` with a record and a promise,
  `.runOnQueue(.main)`, `appContext?.utilities?.currentViewController()`) was
  read against `node_modules/expo-modules-core/ios` and is used the same way by
  Expo's own modules (`expo-document-picker`, `expo-apple-authentication`).

On 2026-10-08 the same three files (plus the Swift summary and the interruption
handling added that day) were compiled against the real ExpoModulesCore and
linked into the whole app. A link is not a run. What is still unsure:

| # | File | What | Why unsure | What to do |
|---|---|---|---|---|
| 1 | `MageRoomScan.podspec` | `s.weak_frameworks = 'RoomPlan'` | SETTLED ON A MAC 2026-10-08: `otool -L` on the linked app shows RoomPlan as weak, `otool -l` shows `LC_LOAD_WEAK_DYLIB`, all 50 imported symbols are weak. Still unsure: that an iOS 15 phone really launches | One launch on a PHYSICAL iOS 15 phone |
| 2 | all three | The typecheck used the iPhoneOS 27.0 SDK | EAS may build with an older Xcode. The RoomPlan calls used are all iOS 16 API, so an older SDK should accept them, but that was not run | First EAS build log |
| 3 | `MageRoomScanModule.swift` | Every call into ExpoModulesCore | SETTLED 2026-10-08: compiled unchanged against the real ExpoModulesCore (Expo SDK 54) in a full Release build. Never run | The first scan |
| 4 | `RoomScanSupport.swift` | `captureSession(_:didEndWith:error:)` | Whether a failed session also calls `captureView(didPresent:)`. The code reports the error here; the completion is taken before it is called (`take()`), so a second report does nothing | Deny the camera mid-scan, cover the lens, and check exactly one result arrives |
| 5 | `RoomScanSupport.swift` | `captureView(shouldPresent:error:)` returns false on an error | It now also fails the scan itself (review round, 2026-10-06), so the screen is not left waiting whether or not the session delegate reported first | Force an error (cover the lens for a long time) and check the screen closes with one failure |
| 6 | `RoomScanSupport.swift` | `try processedResult.export(to: url, exportOptions: .parametric)` | Compiles; never run. Off by default (`exportUsdz: false`) | Turn it on in a dev build and log the file size |
| 7 | `RoomScanSupport.swift` | `JSONEncoder().encode(processedResult)` | Compiles (`CapturedRoom` is `Codable`). The KEY NAMES and the layout of `transform` and `dimensions` in the output are not documented | Section 5 |
| 8 | `RoomScanSupport.swift` | `UINavigationController` wrapper with system Cancel and Done | Whether the bar covers Apple's own coaching text at the top of `RoomCaptureView` | Look at it on a phone. If it does, make the bar transparent or move the buttons |
| 9 | `RoomScanSupport.swift` | `viewWillDisappear` stops the session, and settles as cancelled when the scanner is being dismissed from outside | Whether it also fires when Apple presents its own sheet on top, and so ends a scan early. `isBeingDismissed` should be false then, so the scan is not cancelled, but that was not run | Check a normal Done still returns a room. Then dismiss the scanner from outside (open a deep link mid-scan) and check the start screen is not left waiting |
| 10 | `RoomScanSupport.swift` | `doneTapped` calls `captureSession.stop()` and waits for `captureView(didPresent:)` | Apple's sample does the same. How long processing takes, and what the person sees meanwhile, is not known | Time it on a phone. Add a "Working" label if it is more than a second or two |
| 11 | `MageRoomScanModule.swift` | `self.appContext?.utilities?.currentViewController()` | Returns the top controller in Expo SDK 54. Not checked from inside a modal route | Start a scan from the screen as it is presented |
| 12 | `RoomScanSupport.swift` | `UIApplication.shared.isIdleTimerDisabled` | Put back to what it was BEFORE the scan (not to false), once | Leave the phone after a scan: it must sleep as it did before. Start a scan from a screen that keeps the phone awake: it must stay awake after |
| 13 | `MageRoomScanModule.swift` | `private var scanning` read and written on the main queue | `.runOnQueue(.main)` is what keeps it on one queue; the completion is called from `dismiss`, also on main. `present` now rejects and clears the guard when UIKit did not present | Tap Start Scan twice quickly. Start a scan while another sheet is up: one typed error, and the next scan still starts |
| 14 | `RoomScanSupport.swift` | `presenter.presentedViewController == nil`, `viewIfLoaded?.window`, and `nav.presentingViewController == nil` right after `present` | That UIKit sets `presentingViewController` before `present` returns was read in the documentation, not run | Start a scan from the modal route as it is presented, and from a screen with a sheet open |
| 15 | `RoomScanSupport.swift` | `interrupted()` on `UIApplication.didEnterBackgroundNotification` | New 2026-10-08. Ends the scan with `E_ROOM_SCAN_INTERRUPTED` when the app goes to the background, and dismisses without animation. Not run: whether a phone call banner or the notification shade also fires it (they should not: they resign active, they do not background) | Lock the phone mid-scan: the scanner is gone on unlock and the start screen says why. Pull the notification shade down mid-scan: the scan must go on |
| 16 | `RoomScanSupport.swift` | `summary(of:)` | New 2026-10-08. Reads counts, each wall's `dimensions` and the first wall's `transform` from the `CapturedRoom`. Compiles; never run | Scan Facts after the first scan: the iPhone column is this |
| 17 | `RoomScanSupport.swift` | a scan stopped after a few seconds | Not known whether RoomPlan hands back a room with no walls (the screen then says the scan holds no walls) or an error (the screen then says the iPhone stopped the scan). Both are handled; which one happens is not known | Tap Done three seconds into a scan |

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
2. **iOS 15 with the module.** Section 0, steps 3 and 4: `otool -L` shows
   RoomPlan as a weak link, and the build launches on a physical iOS 15 phone.
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
    where its price came from (and which of his trades, when it is not the
    line's own), a line with no price shows No Price Yet, the total leaves it
    out. Open In Estimate asks first. After yes, the estimate has the lines,
    its history has the old estimate, and pricing the same scan again updates
    the lines instead of adding copies. Then on a job with NO estimate: the
    sheet says it starts one and at which markup, and the estimate opens with
    the lines at that markup. As a viewer or a field seat: the screen does not
    open.
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

## The Order List And The Learning Loop

Lane SCANORDER (2026-10-08). Dark behind the same `SCAN_ROOM_ENABLED = false`.
It needs no native code: it reads the room model the scanner will produce. Until
then every room it has seen is a hand-built fixture. **No real scan has been
through it.**

### What Was Built

- **The order list** (`utils/roomScan/orderListCore.ts`): what to buy for the
  room from its true outline. Drywall sheets with a cut layout per wall and for
  the ceiling (`cutPlanCore.ts`). Flooring or floor tile, and wall tile on the
  wet walls he marks. Paint and primer. Baseboard, crown and casing as stock
  lengths with a cut list (`trimPackCore.ts`).
- **The learning loop** (`utils/roomScan/learnCore.ts`, `learnStore.ts`): the
  scanned and taped length of every wall he types over, the facts those pairs
  support, and a suggestion he can accept or ignore.
- **Three ways out, each after its own confirm:** copied as plain text, the
  share sheet as plain text, and material lines in the estimate through the
  same takeoff path the room draft uses. There is no PDF: the app's only
  purchase PDF (`utils/purchaseOrderPdf.ts`) needs a commitment and its linked
  estimate lines, and cannot take a list.

### What Stays On The Phone

Nothing uploaded, nothing sent to a model, no table, no migration.

| Key | Holds |
| --- | --- |
| `mageid_room_scans::<projectId>` | each saved scan now also carries his order choices, the quantities and prices he typed, what the list said each time it left the screen, and the scan's taped pairs |
| `mageid_room_scan_tape::<userId>` | his taped walls across every saved scan on this phone, capped at 500 |

Both are under the owned `mageid_` prefix, so the tenant-switch sweep removes
them. The tape list carries the user's id in its key. A pair is written when he
saves the scan and removed when he deletes it.

### What Needs A Real Scan Or A Real Job Before It Is Trusted

1. **Every sheet count.** The layout assumes a flat rectangle per wall at the
   wall's tallest point, 48 in courses from the ceiling, no knowledge of studs
   or joists, and offcuts kept at 12 in and over. Hang one real room from the
   list and count what was left.
2. **The rules of thumb.** About 1 screw per square foot, 1 gallon of compound
   per 100 sq ft, 370 ft of tape per 1,000 sq ft, 10, 15 and 20 percent for
   straight, diagonal and herringbone, 5 percent more for a room that is not a
   plain rectangle, 350 sq ft to a gallon of paint and 300 for primer. Each is
   labelled a rule of thumb or shown as an allowance, and each is a number a
   working contractor should read and correct.
3. **The trim cut list** takes wall-to-wall lengths for baseboard and crown
   with no extra for a cope or a scarf, and joints a run longer than the longest
   stick. Casing is cut with its mitres (see the review round below). A list of
   more than 10 pieces is packed longest piece first, which is not always the
   fewest feet.
4. **The "long wall" line** is 12 ft. Outside tests put the sensor's error
   growing on long walls; ten real rooms taped by the founder say whether 12 ft
   is the right place to draw it, and whether `MIN_TAPE_PAIRS = 5` and
   `MIN_LONG_PAIRS = 4` are enough.
5. **Outside corners** are read from the outline. A real scan may break one
   wall into two with a small kink; corners turning under 10 degrees are
   ignored, and that number is a guess.

### The Review Round (2026-10-08)

An independent reviewer probed the cores: the arithmetic was right and several
results were not what a hanger or a trim carpenter would hang or buy. What
changed, and what each change still assumes:

- **Minimum end piece, 16 in.** A course longer than a sheet is never finished
  with a strip: a 98 in wall on 96 in sheets is 82 + 16. Sixteen inches is one
  stud bay at 16 in on centre. Framing at 24 in on centre would want 24. *A
  working hanger should say which.*
- **Butt joints staggered 16 in** from one course to the next. Each course is
  tried full sheets first, then from the other end, then starting with a half
  sheet, then in equal pieces. Many hangers stagger by 4 ft. The scan does not
  know where the studs are, so no joint is promised to land on one.
- **A gap at the floor up to 2 in** is left for the baseboard instead of a
  strip of board, so an 8 ft 1 1/8 in wall does not buy a third course.
- **A longer sheet is suggested, never chosen:** when a run is 1 to 24 in
  longer than the sheet and the next size would span it.
- **No spare sheet** unless he taps Add One Spare. *A hanger may say one spare
  per room is the trade's habit; the list does not assume it.*
- **The strip between a door and a corner** (4 5/8 in in the fixture bathroom)
  is still a piece: the wall there is that narrow. It is marked as such. A
  hanger might hang the course across the doorway and cut the door out instead.
- **Casing with its mitres.** 2 1/4 in wide by default (2 1/2, 3 1/4 and 3 1/2
  are offered). A head, a sill and an apron are the opening plus twice the
  width. A door leg is the opening plus once (one mitre, square at the floor).
  A picture-framed window leg is the opening plus TWICE (a mitre at each end),
  which is 2 1/4 in more per leg than "once to each leg". The reveal, about
  3/16 in, is not added. Doors are cased on the side in this room only unless
  he chooses both sides. *A trim carpenter should check the leg rule and
  whether he wants a reveal in the number.*
- **Trim is one line for each kind, in feet of stick.** The line's key no
  longer carries the stick length, so choosing other sticks is the same line.
- **A second send to the estimate** removes the lines the list no longer has
  and names them on the confirm sheet first. A line he changed by hand in the
  estimate is left alone and named. The removal is the takeoff push's own
  UPDATE run to a quantity of zero, then the emptied line is taken out.
- **What your tape says** adds only to a long wall whose length is still the
  scan's own, and reads walls from the same phone model when there are at
  least four of them. *Whether one phone model's error carries to another is
  not known. It needs real scans from two phones.*

### Bought Versus Scanned: What The App Does Not Hold

`learnCore.wasteFactors` compares what the order list said a room measures
with what was bought, per trade, on finished jobs, and offers "On your last 4
jobs you bought about 9 percent more tile than the scan said." It runs on
fixtures only. It is **not wired**, because the app has no reliable record of a
bought quantity:

- `MaterialReceipt.lines` (`types/index.ts`, `utils/materialReceipt.ts`,
  `mageid_material_receipts` and the `material_receipts` table) is the only
  record with a quantity, a unit and a project. Its trade is optional free text
  that falls back to "Materials". Its unit is whatever the receipt printed
  (box, sheet, bag), and nothing converts a box of tile to square feet. Nothing
  says every receipt for a trade on a job was scanned, so a missing receipt
  would read as negative waste.
- `qbo_cost_lines` (`utils/qbo/qboCostMap.ts`) has dollars and no quantity. A
  confirmed line becomes a receipt with a made-up quantity of 1.
- `DeliveryReceipt.items` (`utils/deliverySchedule.ts`) has an optional
  quantity that neither writer fills (`app/deliveries.tsx`,
  `utils/deliveryArrival.ts`).
- `Commitment` (`types/index.ts`) has dollars only. A purchase order's
  quantities are copied from the estimate, so they are the prediction again.
- The cost book (`utils/costDatabase.ts`) learns a price from a closed job
  using the ESTIMATE's quantity. It never sees a bought one.

What would make it real, smallest first:

1. Keep what the list said. Done in this lane: `SavedScan.orderSent` records
   each line's quantity and the room's own measure before waste.
2. On the receipt review screen, let him tie a receipt line to an order line
   ("this is the tile for the hall bath") and type what a box covers. That
   gives a trade, a unit that matches, and a deliberate link in one tap.
3. A "that is everything for this trade" tick when the job closes, so a missing
   receipt is not read as thrift.
4. Then feed `wasteFactors` only from jobs that are closed
   (`utils/estimateActuals.isClosedProject`) and ticked, never from
   QuickBooks-origin receipts.

### What A Later Cloud Phase Needs

Nothing here is needed while the lane is dark and on one phone.

- **A table for tape pairs**, so his history follows him to a new phone and,
  only if he agrees, joins everyone's:

  ```sql
  create table public.room_scan_tape_pairs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    scan_id uuid not null,
    wall_id text not null,
    scanned_m numeric not null,
    taped_m numeric not null,
    length_class text not null check (length_class in ('short', 'mid', 'long')),
    device_model text not null default '',
    room_type text not null,
    taped_at timestamptz not null,
    unique (user_id, scan_id, wall_id)
  );
  -- RLS: a row is readable and writable by its user_id only.
  ```

- **Writes through `utils/offlineQueue`**, after the `room_scans` table above
  exists, with `delete-account` listing both tables.
- **A plain consent line** before any pair leaves the phone. Pooled numbers
  ("on this iPhone model, long walls run about an inch short") are the part
  nobody else can copy, and they need his yes, a privacy paragraph, and an App
  Store privacy line, in the repo before the switch.
- **Order snapshots** (`SavedScan.orderSent`) ride on the scan row. No table of
  their own.
- **Nothing is sent to a model.** If a later phase wants a model to read a
  receipt against an order line, that goes through the existing AI consent and
  the call log, and is a separate decision.

## Clearance Check

Added 2026-10-09 (lane CLEARANCE), reviewed and reworked the same day. It is
for the owner only, behind ITS OWN gate (`utils/roomScan/clearanceAllowed.ts`):
the owner account always, and anyone else only when `CLEARANCE_CHECK_ENABLED`
(`constants/featureFlags.ts`, false) is on AND `CLEARANCE_REFS_REVIEW` in
`utils/roomScan/clearanceRefs.ts` names an architect or an expediter who has
read the table. Turning `SCAN_ROOM_ENABLED` on shows it to nobody new.

It measures the distances an inspector commonly looks at off the scan and sets
each beside a commonly used figure. The rules and the hand-worked rooms are in
`scripts/validate-scan-clearance.ts`; the figures are one table,
`utils/roomScan/clearanceRefs.ts`; the plain-English copy of the table for the
founder is `design-previews/big-bets/CLEARANCE-FIGURES.md` (on the founder's
Mac beside the repo, not checked in).

No real scan has been through it.

### BLOCKING: which box axis is depth

**This blocks the first real scan from being trusted, and blocks
`CLEARANCE_CHECK_ENABLED` from ever being turned on.**

The scan gives a toilet or a sink as a box with two floor sizes and a turn.
Apple does not document which of the two sizes is the depth (the way the
fixture comes out from the wall). `utils/roomScan/clearanceCore.ts` therefore
does NOT trust the box's own axes: `fixtureFacing` reads the back from the room
(the one box axis with a wall within reach) and declines to label the fixture
whenever the room cannot say, with the sentence "MAGE cannot tell which way
this fixture faces. Tape it." Today that means a toilet or a sink in a corner,
or with a side wall within about 12 in of its box, is NOT labelled at all.
That is the commonest place for a toilet, so the feature is deliberately
holding back until this item is done.

On the first real bathroom scan, confirm on a real toilet and a real sink:

1. Tape each one: its size along the wall, how far it comes out from the wall,
   and its center line to each side wall (step 10 of the first scan).
2. Open the shared raw file (**Share Raw Scan Data**) and Scan Facts, the
   scan's own summary. Find the toilet and the sink under `objects`. Each has
   `dimensions` (three numbers) and a `transform`.
3. Say which of the three numbers is the size along the wall, which is the
   height and which is the size out from the wall, and which way the
   transform's axes point for each. Check both fixtures: they may differ.
4. Correct the convention in code from what the scan's own summary shows:
   `utils/roomScan/capturedRoomParser.ts` (which number becomes `widthM` and
   which `depthM`, and what `rotationRad` means) and the header of
   `utils/roomScan/clearanceCore.ts`. Add the real export as a fixture with
   the taped answers worked by hand.
5. Only then decide whether a fixture in a corner can be labelled from the
   box's own axes. Until then it stays declined.

### What else to check on a real LiDAR iPhone, with a tape

1. **Where a fixture's box sits.** Tape the toilet's center line to each side
   wall and compare. The margin is 1.5 in by default; if real boxes sit further
   off than that, the default has to grow.
2. **Whether the box holds the tank.** The back of the box is taken to be at
   the wall. If Apple's box stops at the bowl, the back wall can be out of
   reach and the toilet reads as standing free.
3. **A sink in a vanity.** The check takes a cabinet that holds the sink's
   center as the vanity and measures from the cabinet's front. See whether a
   real scan draws the vanity as a cabinet at all, and whether the sink's box
   sits inside it.
4. **Boxes that overlap.** A toilet or sink the scan draws across another
   fixed thing is left out and said. See how often a real scan does that to
   things that only stand close.
5. **A door's swing.** It is not modelled. Every row for the space in front
   says "A door swinging into this space is not counted."
6. **What a door's width is.** The parser reads one width per door. Tape the
   leaf and the frame opening and see which one the scan drew. No door is
   labelled: the row is a plain number.
7. **A window's sill.** The sill is the bottom of the box the scan drew, above
   the lowest wall bottom. Tape one.
8. **The lowest ceiling.** A soffit or a beam may not be in a wall's height at
   all. Scan a room with one and see whether the lowest height shows.
9. **Stairs.** The scan gives one box. If a real export turns out to carry
   more (it is not documented to), stairs can be added; until then they are
   left out and the screen says so.

### What a professional has to read

Every figure in the table is marked as NOT confirmed by the repo's checked data
for New York City or Baltimore, and no section number is shown. An independent
reviewer read the table on 2026-10-09 and it was changed as each row's comment
says; that read is not a professional's sign-off and none of it is confirmed.
An architect or an expediter has to read the table, and be named in
`CLEARANCE_REFS_REVIEW`, before the gate can open for anyone else. The
questions to put to them are at the top of
`design-previews/big-bets/CLEARANCE-FIGURES.md`.
