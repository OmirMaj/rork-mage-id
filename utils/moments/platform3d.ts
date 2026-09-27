// platform3d.ts — where the 3D moments (the letter fold's rotateX, the hand-off
// turn's rotateY) are allowed to run.
//
// Android is OFF until a mid-range Android device test passes (judge MUSTFIX):
// perspective + rotateX/rotateY with backfaceVisibility is the combination
// most likely to flicker or drop frames there. Android gets the Reduce Motion
// cross-fade instead. An unknown platform gets the cross-fade too.
//
// Pure TypeScript: no react-native import (bun loads it). Callers pass
// Platform.OS.

export const MOMENTS_3D = { ios: true, web: true, android: false } as const;

export function can3DFor(os: string): boolean {
  if (os === 'ios') return MOMENTS_3D.ios;
  if (os === 'web') return MOMENTS_3D.web;
  if (os === 'android') return MOMENTS_3D.android;
  return false;
}
