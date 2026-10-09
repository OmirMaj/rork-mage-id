// components/livingModel/phone3d/engine.ts — the ONLY place the phone reaches
// its 3D engine: the native drawing surface (expo-gl) and the 3D library
// (`three`), with the scene builder the web already uses.
//
// ── WHY THE LOOKUP IS OPTIONAL, AND WHY THAT IS NOT NEGOTIABLE ─────────────
// app.json's runtimeVersion policy is `appVersion` and expo.version stays
// 1.0.0, so this JavaScript lands over the air on EVERY installed build,
// including build 22 and earlier, whose binary has no expo-gl. `expo-gl`'s own
// index calls requireNativeModule at module scope, which THROWS on those
// builds. So:
//   1. `phone3DEngineInBuild` asks for the native half with
//      requireOptionalNativeModule, which answers null and cannot throw. It is
//      called from a component, never at module scope.
//   2. Only when the native half is there does `loadPhone3DEngine` read
//      `expo-gl`, `three` and the scene builder, each with a dynamic import
//      inside a try. A build without the engine never evaluates one line of
//      any of them.
//   3. Nothing else in the app imports `expo-gl`. Nothing imports `three` at
//      module scope on any platform.
// scripts/validate-phone-3d.ts and scripts/validate-living-model.ts pin all
// three by static read, each with a planted break.
//
// ── START-UP ───────────────────────────────────────────────────────────────
// A phone bundle is one file, so the library's code is IN the over-the-air
// bundle (docs/phone-3d-build-notes.md has the megabytes). It is not RUN at
// start-up: a dynamic import's module is evaluated the first time it is
// asked for, and the only caller is the 3D view, when Job Replay opens.
//
// From 'expo', not 'expo-modules-core': `expo` is the declared dependency and
// re-exports the same function (the pattern of utils/roomScan/native.ts).
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { JobSceneHandle } from '../threeScene';
import type { LivingModelPalette } from '@/utils/livingModel/palette';

/** The names expo-gl registers its native module and its native view under. */
export const EXPO_GL_NATIVE_MODULE = 'ExponentGLObjectManager';

/** The part of expo-gl's drawing context this view calls itself. The 3D library calls the rest. */
export interface PhoneGl {
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  /** Shows what was drawn. expo-gl draws off screen until this is called. */
  endFrameEXP: () => void;
  flush?: () => void;
  getError?: () => number;
}

export type PhoneGlViewProps = ViewProps & {
  onContextCreate: (gl: PhoneGl) => void;
  /** iPhone only: samples per pixel for smooth edges. */
  msaaSamples?: number;
};

export interface Phone3DEngine {
  GLView: ComponentType<PhoneGlViewProps>;
  /** Builds the scene on a drawing context. The same builder the web view calls. */
  createScene: (canvas: unknown, palette: LivingModelPalette) => JobSceneHandle;
}

let inBuild: boolean | null = null;

/**
 * Is the native half of the 3D engine in THIS installed build? False on build
 * 22 and earlier, in a web browser, and under jest. Cannot throw.
 */
export function phone3DEngineInBuild(): boolean {
  if (inBuild != null) return inBuild;
  if (Platform.OS === 'web') { inBuild = false; return inBuild; }
  try {
    inBuild = requireOptionalNativeModule(EXPO_GL_NATIVE_MODULE) != null;
  } catch {
    inBuild = false;
  }
  return inBuild;
}

let loading: Promise<Phone3DEngine | null> | null = null;

/**
 * Reads the engine the first time the 3D view opens. Answers null, and never
 * rejects, when the build has no engine or any part of it will not load: the
 * caller draws the flat replay.
 */
export function loadPhone3DEngine(): Promise<Phone3DEngine | null> {
  if (!phone3DEngineInBuild()) return Promise.resolve(null);
  if (loading) return loading;
  loading = (async (): Promise<Phone3DEngine | null> => {
    try {
      const [gl, THREE, scene] = await Promise.all([import('expo-gl'), import('three'), import('../threeScene')]);
      const GLView = (gl as { GLView?: unknown }).GLView as Phone3DEngine['GLView'] | undefined;
      if (!GLView || typeof scene.createJobScene !== 'function' || typeof THREE.WebGLRenderer !== 'function') return null;
      return {
        GLView,
        createScene: (canvas, palette) => scene.createJobScene(THREE, canvas as HTMLCanvasElement, palette),
      };
    } catch {
      return null;
    }
  })();
  // A failed read is not remembered: the next time the view opens it is tried again.
  void loading.then((e) => { if (!e) loading = null; });
  return loading;
}
