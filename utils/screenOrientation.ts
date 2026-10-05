// utils/screenOrientation.ts — which way a screen may turn.
//
// The iPhone build allows portrait + both landscapes in its Info.plist (the
// next App Store build on; app.json ios.infoPlist). The plist is only the outer
// limit: every navigator pins `orientation: 'portrait_up'` in its screenOptions
// (the literal, so the validator can read it) and a screen is opened by putting ROTATABLE_ORIENTATION on its Stack.Screen.
// The allow-list of opened screens lives in scripts/validate-landscape-lock.ts
// and only changes there.
//
// `orientation` is react-native-screens' own native-stack option: it is in every
// build already shipped, so this file adds no native module. On a build whose
// plist is still portrait-only, 'all' simply never rotates (the mask still
// contains portrait). NEVER use a landscape-only value: on that build UIKit
// finds no common orientation and throws.
//
// ANDROID STAYS PORTRAIT. react-native-screens maps 'all' to
// SCREEN_ORIENTATION_FULL_SENSOR, which overrides the manifest's portrait lock
// at runtime, so the rotatable value is iOS-only.

import { Platform } from 'react-native';

/** What an opened screen carries: every orientation the plist allows on iOS, portrait elsewhere. */
export const ROTATABLE_ORIENTATION: 'all' | 'portrait_up' = Platform.OS === 'ios' ? 'all' : 'portrait_up';

/**
 * `supportedOrientations` for a React Native <Modal> rendered BY an opened
 * screen. A Modal is its own view controller and defaults to portrait only on
 * an iPhone, so without this a sheet opened sideways is presented upright.
 * Always includes portrait (see the landscape-only warning above).
 */
export const ROTATABLE_MODAL_ORIENTATIONS: ('portrait' | 'landscape')[] = ['portrait', 'landscape'];
