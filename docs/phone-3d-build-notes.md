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

None is needed for the phone to draw. Each of these would remove a workaround.
They were left alone because another lane is editing those files.

1. `threeScene.ts`, `resize`: take the cap as an argument, or do not clamp when
   the caller passes a ratio. Then `phoneScene` can hand over points and the
   unit conversion goes away.
2. `threeScene.ts`, `JobSceneHandle`: add `pointsPerMetre(): number` (the
   camera's zoom). `phoneScene` mirrors the zoom limits (0.5 to 6) and the fit
   formula to know how big a room is on the screen. A change to either in
   `threeScene.ts` would leave the phone's label rule out of step.
3. `threeScene.ts`, `createJobScene`: accept `antialias` in `opts`. On the phone
   the smoothing comes from the GLView's `msaaSamples`, and the renderer's own
   `antialias: true` is ignored.
4. `LivingModelScreen.tsx`, the Replay tab. Three small things:
   - Under the 3D view it prints `orbitHelpSub`, which talks about Shift and
     scrolling. On the phone it should print `usePhone3DCopy().touchHelpSub`.
     Today the phone shows the web's sentence.
   - When the phone falls back to the flat replay it does so INSIDE
     `JobReplay3D`, because calling `onUnavailable` makes the screen print
     "This browser could not start the 3D view." So the screen still prints the
     turn-and-zoom help under a flat picture, and the honesty lines carry the
     test id `lm-honesty-3d`. The clean fix: let `onUnavailable` carry a reason,
     and let the screen choose the sentence.
   - `phoneNoteTitleBody` and `phoneNoteBody` ("The 3D view is on the web for
     now.") are no longer shown by anything and can be deleted with their
     Spanish.

## What Differs From the Web Render, and Why

SIMULATOR_DIFFS

## What Does Not Work on the Phone That Works on the Web

- **Keyboard.** The web turns and zooms with the arrow keys, plus and minus.
  The phone has fingers only.
- **Tapping a label.** On the web a room's label is a button. On the phone the
  labels take no touch, so a tap on one falls through to the model and picks
  the room under the finger. The result is the same room in almost every case.
- **Screen reader, room by room.** The web's labels are buttons a screen reader
  can stop on. The phone's model is one image with a description; the room
  list under it reads each room.
- **The legend in the corner card.** The phone's card shows the week alone, as
  the web does on a narrow screen. The legend is drawn under the view.

## Proof in the iOS Simulator

SIMULATOR_PROOF

## Frame Timing

SIMULATOR_TIMING

## The Size Cost

SIZE_COST

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

BUILD_COMMANDS

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
