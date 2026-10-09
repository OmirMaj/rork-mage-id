# Scan The Room: What The Next Native Build Needs

Written 2026-10-06 by lane SCANROOM. The JavaScript for Phase 1 is in the repo
and dark (`SCAN_ROOM_ENABLED = false`). The native module is written and
typechecks against Apple's iOS SDK (iPhoneOS 27.0, deployment target 15.1, and
the simulator SDK). It has never been compiled against the real
ExpoModulesCore, linked into an app or run on a phone. Nothing here has been
applied, built or submitted.

**The module is NOT in the build.** It waits in `native-staging/mage-room-scan`,
a folder Expo autolinking does not look at (autolinking reads `modules/` and
`node_modules`; `package.json` sets no other path). So the next `eas build`
does not compile this Swift, and no build carries it by accident.
`bun run test:scan-room` fails if the folder is back under `modules/` or if
`package.json` points autolinking at the staging folder.

Work through this page in order. Do not turn the flag on until section 8 is
done.

## 0. Before any build that carries the scanner

Do these four steps in this order. Each one can stop the build.

1. **Move it back.** `git mv native-staging/mage-room-scan modules/mage-room-scan`,
   and change the path in `scripts/validate-scan-room.ts` (the N4 rule then
   has to be told the module is meant to be linked). Do this in the same
   change as the camera sentence in section 2.
2. **Compile it once against the real ExpoModulesCore**, in a local build
   (`npx expo prebuild -p ios`, then build in Xcode) or an EAS `preview` build.
   The typecheck in this repo stubs ExpoModulesCore, so this is the first time
   the module's calls into it are compiled for real. Fix what the compiler
   says before going on.
3. **Run `otool -L` on the built app and require RoomPlan to be a WEAK link.**
   `otool -L MAGEID.app/MAGEID | grep RoomPlan` (and the same on the framework
   that holds the module, if the pods are built as frameworks). The line must
   end in `(..., weak)`. A line without `weak` is a hard link: the app would
   crash at launch on iOS 15 (dyld: Library not loaded) before any JavaScript
   runs. If it is not weak, add `-weak_framework RoomPlan` to `OTHER_LDFLAGS`
   through a config plugin, rebuild and run `otool -L` again.
4. **Launch that build once on a PHYSICAL iOS 15 phone.** The app must open.
   The simulator compiles RoomPlan out (`#if canImport(RoomPlan) &&
   !targetEnvironment(simulator)`), so a simulator proves nothing about the
   link: it never links RoomPlan at all. Only a real phone on iOS 15 shows
   whether a build with the module still launches.

## 1. Founder decisions first

1. **Does the next iPhone build carry the scanner?** Not unless someone does
   section 0. The module is outside `modules/`, so a build made today has no
   scanner in it and the screen says "This version of the app does not include
   room scanning".
2. **A job with no estimate.** Decided 2026-10-06: the confirm sheet starts the
   estimate. It uses the app's own "new estimate from cost lines" writer
   (`utils/estimateLanding.buildNewEstimate`, the one the AI takeoff's Replace
   and the Drawing Analyzer use) at the markup the contractor has already
   stated in the estimator, the wizard or Quick Quote. If he has never stated
   one, the push is blocked and says to choose a markup first: a markup he
   never chose is never written.
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
- The podspec sets `s.weak_frameworks = 'RoomPlan'`. **Prove the weak link
  twice: `otool -L` on the built app, then one launch on a PHYSICAL iOS 15
  phone** (section 0, steps 3 and 4). A hard link would crash at launch (dyld:
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

A typecheck is not a link and not a run. What is still unsure:

| # | File | What | Why unsure | What to do |
|---|---|---|---|---|
| 1 | `MageRoomScan.podspec` | `s.weak_frameworks = 'RoomPlan'` | Not checked that CocoaPods plus a static framework carries the weak link into the app target. The simulator slice compiles RoomPlan out, so only a device build shows it | Section 0: `otool -L` must show RoomPlan as weak, then one launch on a physical iOS 15 phone. If it is not weak, add `-weak_framework RoomPlan` to `OTHER_LDFLAGS` through a config plugin |
| 2 | all three | The typecheck used the iPhoneOS 27.0 SDK | EAS may build with an older Xcode. The RoomPlan calls used are all iOS 16 API, so an older SDK should accept them, but that was not run | First EAS build log |
| 3 | `MageRoomScanModule.swift` | Every call into ExpoModulesCore | Read against the source, never compiled against it | Section 0, step 2: one local or preview build before anything else |
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
3. **The trim cut list** takes wall-to-wall lengths with no extra for a mitre
   or a cope unless he sets an allowance, and joints a run longer than the
   longest stick at the end of a full stick.
4. **The "long wall" line** is 12 ft. Outside tests put the sensor's error
   growing on long walls; ten real rooms taped by the founder say whether 12 ft
   is the right place to draw it, and whether `MIN_TAPE_PAIRS = 5` and
   `MIN_LONG_PAIRS = 4` are enough.
5. **Outside corners** are read from the outline. A real scan may break one
   wall into two with a small kink; corners turning under 10 degrees are
   ignored, and that number is a guess.

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
