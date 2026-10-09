# Phone 3D: build notes

The Living Model's Job Replay draws in 3D on the iPhone, with the same scene
code the web uses. This note is for whoever cuts the next iPhone build and for
the first test on a real phone. Lane PHONE3D, 2026-10-09.

## The Landing Pass (2026-10-09), Read This First

The lane was reviewed before it went to main, and these things changed. The
app was then built a third time for the simulator, on the changed code (see
"The Third Simulator Build" below). The pictures and timings further down are
from the first two builds.

| What | Before | Now |
|---|---|---|
| Leaving the 3D view | expo-gl's own view threw every time it left the screen (see "The Throw on Leaving") | Caught in `phone3d/engine.ts` (`quietSurface`) |
| A finger on the model | The page behind could scroll and take the drag away | The page is held still while a finger is on the model |
| The picture's cost | Full 3x screen, 4 samples, 2048 shadow map | Standard: 2 pixels a point, 1024 shadow map. High: as before. One table |
| Units | The scene worked in its own units, 1.5 a point on a 3x phone | Points everywhere. Nothing is converted |
| The line under the model | The browser's ("One finger scrolls the page") | The phone's ("Drag to turn...") |
| The flat fallback | The 3D help line stayed under a flat picture | One message above the flat replay, nothing 3D under it |
| A surface that never starts | "Loading" for good | The flat replay after ten seconds |

### The Throw on Leaving

This was the one finding that would have shown on the founder's phone.

expo-gl's view, as it leaves the screen, asks the reanimated library to forget
the drawing context (`runOnUI(...)`). It skips that only if requiring the
library throws. In this app the require does not throw: `metro.config.js`
points it at an empty object (`stubs/react-native-reanimated-absent.js`, there
since build 12). So `runOnUI` is undefined and the call is a TypeError, on
every unmount of a 3D view whose surface had started: changing tab, going back,
changing the appearance, a failed frame.

The simulator proof never hit it. The only unmount in that proof was the dark
launch, where the first view left before its surface had started.

The fix is a wrapper around expo-gl's view that catches its own leaving. expo-gl
forgets the context on the line before the one that throws, and the native
surface ends with its native view, so nothing is left behind. Rule D7 of
`bun run test:phone-3d` holds the wrapper and the two facts it depends on (the
stub is an empty object, Metro points at it). If reanimated is ever added for
real, the wrapper is harmless and can stay.

### Standard and High

`utils/livingModel/phoneViewCore.ts`, `PHONE_3D_QUALITY`. One table.

| | Buffer | Samples a pixel | Shadow map |
|---|---|---|---|
| Standard, 3x phone (Plus, Pro, Max) | 2 pixels a point | 4 | 1024 |
| Standard, 2x phone | 2 pixels a point (its own) | 2 | 1024 |
| High | the full screen | 4 | 2048 |

On an iPhone 15 Pro Max a 390 by 380 point view is 780 by 760 pixels at
Standard and 1170 by 1140 at High: Standard fills under half the pixels.

expo-gl always makes its buffer at the screen's own scale, so a smaller buffer
is made by laying the surface out smaller and growing it back: at Standard on a
3x phone the surface is two thirds of the view each way, moved to the middle,
and scaled 1.5 times (`phoneViewCore.surfaceBox`). The fingers and the labels
are separate views over it and are not scaled. The scene reads the buffer the
phone really made (`viewSize`), so the picture fills the buffer whatever size it
came out.

The scaling was seen in the simulator (below): the picture fills the box and the
labels sit on their rooms. It has not been seen on a real phone. If Standard
looks wrong there (the picture in one corner, or soft in a way High is not),
switch to High and say so.

The owner alone gets a "3D Quality" switch under the model, Standard or High.
It is remembered until the app is closed. Changing it builds the view again.

### How the Page Scrolls Around the Model

The model is a box 380 points tall in a page that scrolls. One finger on the
model turns it. An iPhone's scrolling page takes an up-and-down drag for itself
at the native level, whatever JavaScript says, so while a finger is on the
model the page is told not to scroll (`onHold`, `scrollEnabled`). The page
scrolls from anywhere outside the box: the tabs, the legend, the scrubber, the
room list. On the smallest iPhone the app supports (667 points tall) about 150
points of page stay visible around the box, so there is always somewhere to
scroll from.

One thing to expect: a very fast flick that starts on the model can be taken by
the page before the hold arrives. Then neither moves; do it again.

### The Third Simulator Build

Same commands as below, iPhone 15 Pro Max simulator, on the landing-pass code.

- Standard, week 6: the model fills its box, labels on their rooms. So the
  smaller surface grown back, the points-only units and the 1024 shadow map
  all draw.
- High (`quality=high`), week 6: the same picture.
- With the High model on screen the simulator was switched to dark
  (`xcrun simctl ui booted appearance dark`). The view was built again and
  drew in 3D in the dark colours. That is an unmount of a view whose surface
  had started, the case that threw before the fix: with the old code it would
  have ended on the flat replay and "could not start".

Still not shown by any simulator: fingers, the page holding still, changing
tab, speed, heat.

### Not Changed

`threeScene.ts` got three options (`antialias`, `maxPixelRatio`,
`shadowMapSize`) and a check before `forceContextLoss`. With no options it does
what it did: smoothing on, 2 pixels a point at most, a 2048 shadow map, the
context given back. `bun run test:living-model` rule E7 runs the scene builder
and reads those values.

## What Changed, in One Paragraph

One native module was added: `expo-gl` (`~16.0.10`, the range Expo SDK 54
ships). It gives the app an OpenGL ES drawing surface. `three` 0.180.0, already
a dependency for the web view, draws into that surface. The scene is built by
`components/livingModel/threeScene.ts`, the file the web calls (it gained three
options in the landing pass; with none it does what it did). The
phone's own code is four new files and one rewritten file:

| File | What it is |
|---|---|
| `components/livingModel/JobReplay3D.tsx` | The phone entry (rewritten). Picks the 3D view, or the flat replay with one line. |
| `components/livingModel/phone3d/engine.ts` | The one optional lookup of the native module, and the one lazy read of `expo-gl`, `three` and the scene builder. |
| `components/livingModel/phone3d/phoneScene.ts` | Stands in for a browser canvas, converts points, shows each frame. |
| `components/livingModel/phone3d/Phone3DView.tsx` | The drawing surface, fingers, labels, the frame loop. |
| `utils/livingModel/phoneViewCore.ts` | The arithmetic: fingers, sizes, the label rule. Pure. |
| `hooks/usePhone3DCopy.ts` | Four strings, English and Spanish. |
| `app/dev-phone-3d.tsx` | The simulator check. Off in every build anyone installs. |
| `utils/phone3dSpikeLaunch.ts`, `utils/livingModel/phoneSpikeSample.ts` | The check's way in and its sample job. |

## What the Next EAS Build Needs

Nothing by hand.

- `expo-gl` is autolinked. `pod install` picked it up on this Mac as the pod
  `ExpoGL` with no Podfile change.
- It has no config plugin and needs no `app.json` change, no `Info.plist` key
  and no permission string. It asks the person for nothing.
- Its podspec floor is iOS 15.1, the same as the app.
- It does not need `react-native-reanimated`. That is an optional peer used
  only for worklets, which this app does not turn on. The Metro stub for
  reanimated stays as it is.
- `eas.json`, `app.json`, `expo.version` and `runtimeVersion` were not touched.

Because the runtime version policy is `appVersion` and the version stays
1.0.0, the JavaScript in this branch also reaches builds that do NOT contain
`expo-gl` (build 22 and earlier) over the air. On those builds the one lookup
answers "not in this build", none of `expo-gl`, `three` or the scene builder is
evaluated, and Job Replay draws the flat replay with the line "3D needs the
newest version of the app." That path is what jest runs
(`__tests__/smoke/living-model.test.tsx`, tests 11 and 12).

## How Three Draws Into expo-gl

`threeScene.createJobScene(THREE, canvas, palette)` makes its own
`THREE.WebGLRenderer({ canvas, ... })`. It was written for a browser canvas.
The phone hands it a stand-in object instead of a canvas
(`phoneScene.canvasStandIn`):

- `getContext('webgl2')` answers expo-gl's context, so the renderer draws into
  it instead of asking a browser for one. Any other name answers null.
- `width` and `height` are plain numbers the renderer writes.
- `style` is an empty object. `addEventListener` and `removeEventListener` do
  nothing.

After every `render()` the wrapper calls `gl.endFrameEXP()`. expo-gl draws off
screen until that call.

The scene is handed the view's size in points and the buffer's pixels a point
(`phoneViewCore.viewSize`), and the phone raises the scene's pixel-ratio cap
from the web's 2 (`maxPixelRatio`). A tap, a two-finger move and a label are in
points on both sides. (As first built the scene was handed `buffer / 2` and
every point was converted by 1.5 on a 3x phone; the landing pass removed that.)

### Changes Wanted in the Living Model's Own Files

All six were made in the landing pass (above): the phone's own line under the
model, the fallback, the two unused strings deleted, and `threeScene.ts` taking
its pixel-ratio cap and smoothing from the caller and checking before it gives
a context back.

## What Differs From the Web Render, and Why

The picture is the same scene, so walls, openings, studs, pipes, wires, batts,
board, trim, the cut-away height, the faint plan ahead of today and the stage
colour on each floor are the web's. What is different:

- **Resolution.** The web caps at 2 pixels a point. So does the phone at
  Standard. At High the phone draws the full 3 pixels a point of a Pro Max
  screen.
- **Smooth edges.** On the web the browser smooths them. On the phone the
  GLView does, at 2 or 4 samples a pixel (the table above).
- **Shadows.** One 2048 shadow map on the web and at High; 1024 at Standard.
- **Fingers.** One finger turns, two move, a pinch zooms, a twist turns, a
  tap picks. The page behind does not scroll while a finger is on the model.
  In a phone's web browser one finger scrolls the page instead.
- **Labels.** Ordinary React Native text over the drawing, moved about thirty
  times a second while the model turns. How much a label shows (both lines,
  the name, or a dot) is the web's own rule (`sceneCore.pinSize`). The phone
  adds one thing: two labels never sit on one another; the larger room keeps
  its label until the model is turned or zoomed.
- **Frames.** The web asks for a frame sixty times a second and draws when
  something changed. The phone asks for a frame only when something changed.
- **Lost context.** A browser can take a WebGL context away and give it back.
  A phone does not; the view is built again when its theme changes and
  nothing else.

## What Does Not Work on the Phone That Works on the Web

- **Keyboard.** The web turns and zooms with the arrow keys, plus and minus.
  The phone has fingers only.
- **Tapping a label.** On the web a room's label is a button. On the phone the
  labels take no touch, so a tap on one falls through to the model and picks
  the room under the finger. The result is the same room in almost every case.
- **Hover.** The web grows the label of the room under the pointer. A phone
  has no pointer; the picked room's label grows instead.
- **Screen reader, room by room.** The web's labels are buttons a screen reader
  can stop on. The phone's model is one image with a description; the room
  list under it reads each room.
- **The legend in the corner card.** The phone's card shows the week alone, as
  the web does on a narrow screen. The legend is drawn under the view.

## Proof in the iOS Simulator

The whole app was built on this Mac for the iOS Simulator (Release, the
JavaScript bundled in, no Metro server), installed on an iPhone 15 Pro Max
simulator running iOS 26.5, and opened on the check route. The 3D model drew:
walls, openings, studs, stage colours, labels, light and dark.

Saved in `design-previews/living-model/` in the main checkout:

| File | What it shows |
|---|---|
| `phone-3d-week3.png` | Week 3, reported. Framing up, rough-in starting in the kitchen (its floor is blue). |
| `phone-3d-week6.png` | Week 6 (today in the sample). Drywall at 30 percent. |
| `phone-3d-done.png` | Week 10, the planned reading. Past today the finishes are faint, as the rule is. |
| `phone-3d-done-turned.png` | The same, turned and zoomed by the check's own `dx`, `dy` and `zoom`. |
| `phone-3d-dark.png` | Dark appearance, week 6, turned a little. |

What the simulator could NOT show: fingers. Nothing on a Mac's command line
can touch a simulator's glass, and the tool that can was not given access.
Turning and zooming were driven through the check's parameters, which call
the same `orbit` and `zoomBy` a finger does. The finger arithmetic itself
(one finger, two fingers, pinch, twist, tap) is run against hand-worked
answers in `bun run test:phone-3d`. A real finger on a real phone is the
first thing to try.

The app was built twice: once on this lane's own code, and again after the
branch took in the Living Model's review fixes from main (the stage colour on
each floor, the twist, the web's label rule). The saved pictures are from the
second build. The timings below are from the first; the drawing code they
time did not change.

One thing the simulator taught: wait. A frame takes seconds there (see Frame
Timing), and a dark-appearance launch builds the scene twice, once as the app
starts and once when the saved theme arrives. A screenshot taken twelve
seconds after launch showed labels over an empty box. Thirty seconds showed
the model.

## Frame Timing

Measured in the simulator by the check route: the model is turned a little
each frame, and each frame is timed twice. "JavaScript" is the time to work out
the frame and hand every drawing call to expo-gl. "Drawn" also waits for the
drawing to finish.

| Model | JavaScript, a frame | Drawn, a frame, in the simulator |
|---|---|---|
| 7 rooms, 4 samples a pixel | 1.8 ms (1.9 at the slow end) | 2,394 ms (3,539 at the slow end) |
| 7 rooms, no smoothing | 1.9 ms | 668 ms |
| 40 rooms, 4 samples a pixel | 8.4 ms (8.6 at the slow end) | 1,210 ms (2,089 at the slow end) |

Read these carefully.

- **The "drawn" numbers say nothing about an iPhone.** The simulator has no
  graphics chip of its own for OpenGL ES. It draws on the Mac's processor, one
  pixel at a time, which is why taking the smoothing off made it almost four
  times faster. A real iPhone draws this on its graphics chip. In the
  simulator the model takes seconds to follow a turn; that is expected and is
  not what a phone will do.
- **The JavaScript numbers do carry over, roughly.** A frame has a budget of
  16.7 ms at sixty a second. Seven rooms use about a tenth of it. Forty rooms
  use about half of it on this Mac, and an iPhone 15 Pro Max is somewhat
  slower than this Mac at JavaScript. So a forty-room job is the case to
  watch on the real phone: it may not hold sixty frames a second while
  turning. Each room is nine separate shapes; merging a room's shapes that
  share a material (in `threeScene.ts`) is the fix if it stutters.
- While nothing changes, no frame is drawn at all.

## The Size Cost

`npx expo export --platform ios`, the same export an over-the-air update
sends, measured before (the commit this lane started from, `59ce5150`) and
after (this branch before it merged main):

| | Hermes bundle | Whole export |
|---|---|---|
| Before | 31,138,866 bytes (31.14 MB) | 34,424 KB |
| After | 32,650,720 bytes (32.65 MB) | 35,900 KB |
| Added | 1,511,854 bytes (1.51 MB, 4.9 percent) | 1,476 KB |

Almost all of it is `three`. A phone bundle is one file, so the library is in
every update from now on, whether or not the person ever opens Job Replay. It
is not RUN at start-up: Hermes reads a module's code when it is first asked
for, and the only thing that asks is the 3D view. Start-up time should not
move; download size does. If the size matters later, the library's smaller
build (`three.module.min.js` with `three.core.min.js`) or a build with only
the classes the scene uses would cut most of it.

## The Real-Phone Checklist

For the founder, on his iPhone 15 Pro Max, with the new build installed. Sign
in with the owner account: the Living Model is an owner preview. Nothing below
can be learned from a simulator.

**Start**

1. Open a job that has rooms in its Living Model (or add two rooms in the Rooms
   tab and tick a task for each in Tasks).
2. Tap Job Replay. Within a second or two you should see walls standing on a
   floor, with a label on each room.
   - If you see a flat floor plan and "3D needs the newest version of the app."
     the build on the phone has no 3D engine. Check the build number.
   - If you see a flat floor plan and "The 3D view could not start on this
     phone." the engine is there and failed. That is the one to report.

**Fingers** (the first thing to try; no simulator could)

3. Drag one finger across the model. It turns. The page does not move.
4. Drag one finger up and down on the model. It tilts. The page does not move.
5. Put two fingers on it and drag. It moves. Pinch. It zooms. Twist. It turns.
6. Tap a room. Its card opens under the model. Tap it again. It closes.
7. Put a finger on the legend or the scrubber, below the model, and drag up.
   The page scrolls. Scroll down to the room list and back up.
8. Flick fast up the page starting ON the model, a few times. Expected: the
   model tilts, or nothing moves. Not expected: the page stuck and unable to
   scroll afterwards. If that happens, report it.

**Leaving and coming back** (this is where the build could still surprise us)

9. Tap Rooms, then Job Replay again. Do it five times. The model comes back
   every time. No error screen.
10. Tap Back to the project, then open the Living Model again. Same.
11. With the model showing, go to the Home Screen, wait a minute, come back.
    The model is still there and still turns.
12. Lock the phone, unlock it. Same.
13. Switch the phone between light and dark (Control Center) with the model
    showing. It is drawn again in the new colours, in 3D, not flat.

**Play and speed**

14. Press Play and watch the job from start to finish. The walls should change
    smoothly and the labels stay on their rooms.
15. Turn the model with one finger for ten seconds. It should follow the finger
    with no stutter.

**3D Quality** (under the model, owner only)

16. It starts on Standard. Look at wall edges and the labels.
17. Tap High. The model is drawn again. Compare: are edges sharper? Is turning
    still smooth?
18. Tap Standard again. If Standard looks wrong in a way High does not (the
    picture sits in a corner, is stretched, or is blurry), stay on High and
    report it: the Standard path scales the picture and no screen has shown it
    yet.

**Heat**

19. Leave Job Replay open and untouched for five minutes. The phone stays cool.
    Nothing is drawn while nothing changes.
20. Open and close Job Replay ten times. The app should not get slower.

**An old build** (only if a phone with build 22 or earlier is to hand)

21. After the update arrives, Job Replay shows one line, "3D needs the newest
    version of the app.", and the flat replay under it. Nothing else changes.

What to send back if something is off: a screenshot, which step, and whether
Standard or High was on.

## How This Could Still Fail in the EAS Build

- **OpenGL ES is deprecated by Apple.** It still compiles and runs. The podspec
  silences the deprecation. If a future Xcode image drops the headers, expo-gl
  stops building and the fix is Expo's.
- **The EAS image's Xcode.** This was built with Xcode 27 on this Mac, which
  needed two local-only changes that have nothing to do with expo-gl (below).
  EAS builds with an older Xcode today and needs neither.
- **New Architecture.** The app has it on. expo-gl 16 is an Expo module with a
  Fabric-compatible view and it mounted in the simulator build with the new
  architecture on. A real-device build uses the same code.
- **Android was not built or run.** expo-gl autolinks on Android too (two
  modules, a CMake build against React Native's own headers, no permission, one
  manifest line that says OpenGL ES 2 is NOT required). It is the version Expo
  SDK 54 lists, so the build should pass, but it is unproven. Start-up cannot be
  touched by it: nothing reads expo-gl until Job Replay opens. On Android the
  3D view itself is unproven (and `msaaSamples` is iPhone only).
- **An EAS environment variable.** The simulator check's switch
  (`EXPO_PUBLIC_PHONE3D_SPIKE`) is in no file a build reads, and two validators
  fail if it is added. They cannot see variables set on expo.dev. It must not
  be set there.

## The Local Build Commands That Worked

All in the worktree. `ios/` is gitignored and was deleted afterwards.

```sh
# 1. The native project (about a minute), then the pods (about a minute).
EXPO_PUBLIC_PHONE3D_SPIKE=1 CI=1 npx expo prebuild --platform ios --no-install
(cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install)

# 2. Xcode 27 only, local Pods copy only, never the repo. RevenueCat 5.67.1,
#    ios/Pods/RevenueCat/Sources/Paywalls/PaywallColor.swift line 46:
#      fileprivate var _underlyingColor: (any Sendable)?
#    becomes
#      fileprivate var _underlyingColor: Optional<any Sendable>
sed -i '' '46s/(any Sendable)?/Optional<any Sendable>/' ios/Pods/RevenueCat/Sources/Paywalls/PaywallColor.swift

# 3. Release for the simulator, JavaScript bundled in, unsigned (about four minutes).
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 SENTRY_DISABLE_AUTO_UPLOAD=true \
NODE_OPTIONS=--max-old-space-size=4096 EXPO_PUBLIC_PHONE3D_SPIKE=1 \
xcodebuild -workspace ios/MAGEID.xcworkspace -scheme MAGEID -configuration Release \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15 Pro Max' \
  -derivedDataPath ios/DerivedData -jobs 4 IPHONEOS_DEPLOYMENT_TARGET=15.1 \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO ONLY_ACTIVE_ARCH=YES build

# 4. Run it. The launch argument opens the check and sets its week and angle.
xcrun simctl boot "iPhone 15 Pro Max"
xcrun simctl install booted ios/DerivedData/Build/Products/Release-iphonesimulator/MAGEID.app
xcrun simctl launch booted com.mageid.app -phone3d "week=6"
xcrun simctl io booted screenshot week6.png
xcrun simctl launch --terminate-running-process booted com.mageid.app -phone3d "week=10&planned=1&dx=-200&dy=-70&zoom=1.6"
xcrun simctl ui booted appearance dark
xcrun simctl launch --terminate-running-process booted com.mageid.app -phone3d "week=6&rooms=40&spin=5"   # timing, printed on the screen
xcrun simctl launch --terminate-running-process booted com.mageid.app -phone3d "week=6&quality=high"      # the full screen; standard is the default
xcrun simctl shutdown booted
rm -rf ios
```

Four things learned on the way:

- **Do not open the check with a link.** `xcrun simctl openurl booted
  mageid://dev-phone-3d` makes iOS ask "Open in MAGE ID?" and nothing on a
  command line can press Open. Worse, while that question is up the app is
  not active, so the 3D view rightly draws nothing. The launch argument
  (`utils/phone3dSpikeLaunch.ts`) is the way in. If the question does appear,
  shut the simulator down and boot it again.
- **`IPHONEOS_DEPLOYMENT_TARGET=15.1` on the command line.** Xcode 27 refuses
  pods whose own target is below iOS 15.
- **The space in the main checkout's name did not bite.** `node_modules` here
  is a link to "MAGE ID - CLAUDE/node_modules", and the bundle step passed:
  `plugins/withQuotedXcodeScriptPaths.js` did its job.
- **Metro leaves `__tests__` out of every bundle.** The check's sample job is
  therefore a copy of the fixture (`utils/livingModel/phoneSpikeSample.ts`),
  and `bun run test:phone-3d` fails if the two ever differ.

How `expo-gl` was installed, since this worktree's `node_modules` is a link to
the main checkout's: the package's own tarball (`npm pack expo-gl@16.0.10`) was
unpacked into the shared `node_modules/expo-gl`, adding one folder and touching
nothing else, and `bun add expo-gl@~16.0.10 --lockfile-only` wrote
`package.json` and `bun.lock`. Its one dependency, `invariant`, was already
installed. A clean `bun install` gives the same tree.

## The Gates That Hold This

- `bun run test:phone-3d` (`scripts/validate-phone-3d.ts`): the finger and size
  arithmetic against hand-worked answers; the quality table; the optional
  lookup; expo-gl named in one file and read lazily; the flat replay always
  reachable and the screen told about it; frames only when something changed
  and never in the background; the page held while a finger is on the model;
  leaving cannot throw; a surface that never starts; the simulator check's
  switch in no build profile; the flag still off; the words. Every rule has a
  planted break that must turn it red.
- `bun run test:living-model`, rule E7: the scene builder run with no options
  still makes the web's renderer (smoothing on, 2 pixels a point at most, the
  context given back), and takes a caller's own.
- `bun run test:living-model`, rules E1 to E4 and G5: `three` has no static
  import anywhere, one lazy read per platform, the scene builder has one static
  importer (the web view) and one lazy one (the phone's engine file); expo-gl
  is at the SDK's range and no other 3D dependency is added.
- `bun run test:native-surface`: the real iOS export carries the 3D library
  only together with a declared expo-gl and its lookup, and no second 3D
  engine.
