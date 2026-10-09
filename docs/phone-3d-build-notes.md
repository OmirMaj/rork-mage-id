# Phone 3D: build notes

The Living Model's Job Replay draws in 3D on the iPhone, with the same scene
code the web uses. This note is for whoever cuts the next iPhone build and for
the first test on a real phone. Lane PHONE3D, 2026-10-09.

## What Changed, in One Paragraph

One native module was added: `expo-gl` (`~16.0.10`, the range Expo SDK 54
ships). It gives the app an OpenGL ES drawing surface. `three` 0.180.0, already
a dependency for the web view, draws into that surface. The scene is built by
`components/livingModel/threeScene.ts`, the file the web calls, unchanged. The
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
`THREE.WebGLRenderer({ canvas, ... })`. It was written for a browser canvas and
it was not edited. The phone hands it a stand-in object instead of a canvas
(`phoneScene.canvasStandIn`):

- `getContext('webgl2')` answers expo-gl's context, so the renderer draws into
  it instead of asking a browser for one. Any other name answers null.
- `width` and `height` are plain numbers the renderer writes.
- `style` is an empty object. `addEventListener` and `removeEventListener` do
  nothing.

After every `render()` the wrapper calls `gl.endFrameEXP()`. expo-gl draws off
screen until that call.

One real difference had to be worked around. `threeScene.resize` caps the pixel
ratio at 2 and sets its viewport to width x height x ratio. The drawing buffer
on a Pro Max is 3 pixels a point. Handing the scene the size in points would
fill two thirds of the buffer. So the scene is handed `buffer / ratio` (1.5
scene units a point on a 3x phone), and every point that goes in (a tap, a
two-finger move) or comes out (a label) is converted by that one factor
(`phoneViewCore.viewSize`).

### Changes Wanted in the Living Model's Own Files

None is needed for the phone to draw. They were left alone because another
lane was editing those files.

1. **`LivingModelScreen.tsx`, the line under the 3D view. This one matters.**
   On a narrow screen the screen prints `copy.touchHelpSub`: "One finger
   scrolls the page. Two fingers move, turn and zoom the model". That is true
   in a phone's web browser and NOT true in the app, where one finger turns
   the model. On iOS and Android it should print
   `usePhone3DCopy().touchHelpSub` ("Drag to turn. Use two fingers to move.
   Pinch to zoom. Tap a room to pick it"). Until that line is changed the app
   prints the browser's sentence under the phone's view. The feature is dark
   (`LIVING_MODEL_ENABLED` is false), so only the owner sees it.
2. **`LivingModelScreen.tsx`, the fallback.** When the phone falls back to the
   flat replay it does so INSIDE `JobReplay3D`, because calling
   `onUnavailable` makes the screen print "This browser could not start the 3D
   view." So the screen still prints the help line under a flat picture, and
   the honesty lines carry the test id `lm-honesty-3d`. The clean fix: let
   `onUnavailable` carry a reason and let the screen choose the sentence.
3. **`hooks/useLivingModelCopy.ts`.** `phoneNoteTitleBody` and `phoneNoteBody`
   ("The 3D view is on the web for now.") are no longer shown by anything and
   can be deleted with their Spanish.
4. **`threeScene.ts`, `resize`.** Take the pixel ratio cap as an argument, or
   do not clamp a ratio the caller passes. Then `phoneScene` can hand over
   points and the unit conversion goes away.
5. **`threeScene.ts`, `createJobScene`.** Accept `antialias` in `opts`. On the
   phone the smoothing comes from the GLView's `msaaSamples`; the renderer's
   own `antialias: true` does nothing there.
6. **`threeScene.ts`, `dispose`.** It calls `renderer.forceContextLoss()`,
   which on the phone throws inside three (expo-gl has no
   `WEBGL_lose_context`) and is caught by the `try` already around it. It
   works. A check for the extension first would be tidier than a caught throw.

## What Differs From the Web Render, and Why

The picture is the same scene, so walls, openings, studs, pipes, wires, batts,
board, trim, the cut-away height, the faint plan ahead of today and the stage
colour on each floor are the web's. What is different:

- **Resolution.** The web caps at 2 pixels a point. The phone draws the full
  3 pixels a point of a Pro Max screen (about 1190 by 1140 pixels for the
  view), because expo-gl's buffer is the screen's own.
- **Smooth edges.** On the web the browser smooths them. On the phone the
  GLView does, at 4 samples a pixel.
- **Fingers.** One finger turns, two move, a pinch zooms, a twist turns, a
  tap picks. In a phone's web browser one finger scrolls the page instead.
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
| `phone-3d-week3.png` | Week 3, reported. Framing up, rough-in starting in the kitchen. |
| `phone-3d-week6.png` | Week 6 (today in the sample). Drywall at 30 percent. |
| `phone-3d-done.png` | Week 10, the planned reading. Past today the finishes are faint, as the rule is. |
| `phone-3d-done-turned.png` | The same, turned and zoomed by the check's own `dx`, `dy` and `zoom`. |
| `phone-3d-dark.png` | Dark appearance, turned. |

What the simulator could NOT show: fingers. Nothing on a Mac's command line
can touch a simulator's glass, and the tool that can was not given access.
Turning and zooming were driven through the check's parameters, which call
the same `orbit` and `zoomBy` a finger does. The finger arithmetic itself
(one finger, two fingers, pinch, twist, tap) is run against hand-worked
answers in `bun run test:phone-3d`. A real finger on a real phone is the
first thing to try.

Those pictures were taken before this branch took in the Living Model's review
fixes from main. After that merge the phone view also colours each floor by
stage, turns on a twist and uses the web's label rule. The merged code passed
the type check, the gate and the smoke tests, and was not built for the
simulator a second time.

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

## What Must Be Checked on a Real iPhone

Nothing below can be learned from a simulator. The simulator draws OpenGL ES
through the Mac's own graphics, with no heat and a great deal of memory.

1. **It draws at all.** Open a job, Living Model, Job Replay. Walls, openings
   and stage colours should match the web. If the flat replay appears with
   "The 3D view could not start on this phone." the engine is in the build and
   failed; that is the case to report.
2. **Frame rate with a real job.** Turn the model with one finger for ten
   seconds on a job with twenty or more rooms. It should follow the finger
   without stutter. The drawing buffer is the full 3x screen with 4x smoothing
   and one 2048 shadow map; if it stutters, the first things to lower are
   `msaaSamples` (in `Phone3DView.tsx`) and the shadow map size (in
   `threeScene.ts`).
3. **Play.** Press Play and watch a whole job. Every frame re-renders the room
   labels in React as well as the model.
4. **Memory.** In Xcode's memory gauge, or just by use: open and close Job
   Replay ten times, switching between Rooms and Job Replay. Memory should
   come back each time. Every shape, material and the renderer are given back
   when the view leaves; the GL context ends with its view.
5. **Heat and battery.** Leave Job Replay open and untouched for five minutes.
   The phone should stay cool: no frame is drawn while nothing changes.
6. **Backgrounding.** With the model on screen, go to the Home Screen, wait a
   minute, come back. The model should still be there and still turn. Then
   lock the phone and unlock it. Then take a phone call. An iPhone ends an app
   that draws with OpenGL ES in the background; the view stops its frames when
   the app is not active, and expo-gl pauses its own queue, but only a real
   phone proves it.
7. **Another screen on top.** Open a room card, go back, open the project
   page, come back. The model should redraw once and not keep drawing behind
   another screen.
8. **Rotation.** The app is locked to portrait except the plan viewer. Open the
   plan viewer, turn the phone, go back to Job Replay in portrait. The model
   should fill its box, not a corner of it.
9. **Dark and light.** Switch the appearance with Job Replay open. The view is
   built again with the new colours.
10. **Two fingers inside a scrolling page.** The model sits in a page that
    scrolls. One finger on the model should turn it, not scroll the page; a
    drag that starts outside the model should scroll.
11. **An old build.** On a phone that still has build 22, after the update
    arrives: Job Replay shows the flat replay and the line "3D needs the newest
    version of the app." Nothing else changes.

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
- **Android was not built.** expo-gl supports Android and the JavaScript is the
  same, but nothing here was run on Android.

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
  arithmetic against hand-worked answers; the optional lookup; expo-gl named in
  one file and read lazily; the flat replay always reachable; frames only when
  something changed and never in the background; the simulator check's switch
  in no build profile; the flag still off; the words. Every rule has a planted
  break that must turn it red.
- `bun run test:living-model`, rules E1 to E4 and G5: `three` has no static
  import anywhere, one lazy read per platform, the scene builder has one static
  importer (the web view) and one lazy one (the phone's engine file); expo-gl
  is at the SDK's range and no other 3D dependency is added.
- `bun run test:native-surface`: the real iOS export carries the 3D library
  only together with a declared expo-gl and its lookup, and no second 3D
  engine.
