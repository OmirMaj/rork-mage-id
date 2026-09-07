// stubs/react-native-reanimated-absent.js
//
// WHY THIS FILE EXISTS (audit 2026-09-03, APPSTORE-F2).
//
// Build #12 rolled back every OTA silently. The cause: `react-native-reanimated`
// was removed from package.json, but bun still installs it — `expo-router`
// declares it as an OPTIONAL PEER, so it lands in node_modules on every clean
// install. Metro bundles what resolves, not what package.json declares, so
// `react-native-gesture-handler`'s guarded `require('react-native-reanimated')`
// pulled the whole JS half into the bundle. That JS eagerly binds a native
// module the installed binary does not have, throws
// "Native part of Reanimated doesn't seem to be initialized", and expo-updates
// rolls the update back. The founder saw no changes no matter how many times
// they restarted.
//
// Deleting node_modules and reinstalling does NOT fix it — verified 2026-09-06,
// the markers are back in the exported bundle after a clean `bun install`. The
// only durable fix is to stop the specifier resolving, which metro.config.js
// does by pointing it here.
//
// WHY AN EMPTY OBJECT IS THE RIGHT STUB, not a throw:
// the single consumer in this app's graph is
// `react-native-gesture-handler/.../reanimatedWrapper.js`, which does
//
//     try { Reanimated = require('react-native-reanimated'); } catch { Reanimated = undefined; }
//     if (!Reanimated?.useSharedValue) Reanimated = undefined;
//
// so an object with no `useSharedValue` takes exactly the same branch as an
// absent module: the wrapper falls back to its non-reanimated implementation.
// A throwing stub would take the `catch`, which is the same outcome by a
// noisier route. The app itself imports reanimated nowhere (checked across
// app/ components/ hooks/ utils/ contexts/ lib/ constants/ types/ plugins/),
// and the `Swipeable` it uses is gesture-handler's legacy component, not
// `ReanimatedSwipeable`.
//
// TO UNDO THIS, when a native build actually ships the reanimated native
// module: add `react-native-reanimated` back to package.json dependencies,
// delete the resolver branch in metro.config.js, delete this file, and add the
// row to NATIVE_FINGERPRINTS' expectations in
// scripts/validate-native-surface.ts — that guard exports the real bundle and
// will tell you which side of the line you are on.

module.exports = {};
