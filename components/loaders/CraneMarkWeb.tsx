// CraneMarkWeb — the web's tower crane, rebuilt as composited divs (lane WEB).
//
// Only ever rendered at 120 px and up (CORE's CraneSvg gate in
// components/CraneLoader.tsx; below that the web draws the level). The box is
// EXACTLY size × size·300/340 — CraneLoader's full-screen crane and the
// estimate overlay's 288 px crane keep their place.
//
// WHY DIVS. The old crane was SVG driven by three JS Animated loops: it froze
// whenever the page was busy, and even CSS on SVG runs on Chrome's main thread.
// Here every part is a plain absolutely-positioned View (a div on RN-web);
// strokes are thin Views, so they stay crisp at any size; the moving parts
// animate transform / opacity through ONE 6-second CSS cycle
// (components/loaders/css/craneCss.ts), which the browser composites:
//
//   trolley (translateX) › pendulum (rotate about the trolley pin)
//     › cable (scaleY from the top) + hook (translateY) carrying the beam
//   tower (translateY, clipped at the ground) + the new floor (opacity)
//
// It swings the beam out, lowers it, SETS it on the building (the hook's beam
// hides and the new slab shows in the same pixels), rises empty, returns,
// picks the next beam, and the building sinks one floor — so it grows forever.
//
// Reduce Motion: a still crane — trolley out, the beam hanging on the lowered
// hook, no classes. No JS loop here at all (no Animated, no timers, no frames).
// Theme read whole and null-safe (components/loaders rule).

import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useReducedMotion } from '@/components/ui/motion';
import { splashFallbackColors } from './themeFallback';
import { craneGeometry, craneStyles, type CraneGeometry } from './css/craneCss';

type Seg = [number, number, number, number];

/** A stroke from (x1,y1) to (x2,y2) in viewBox units, as a thin View. */
function stroke(g: CraneGeometry, [x1, y1, x2, y2]: Seg, w: number, color: string, opacity?: number): ViewStyle {
  const t = g.sw(w);
  const o = opacity != null ? { opacity } : null;
  if (y1 === y2) {
    const l = g.u(Math.min(x1, x2));
    return { position: 'absolute', left: l, top: g.u(y1) - Math.floor(t / 2), width: Math.max(1, g.u(Math.max(x1, x2)) - l), height: t, backgroundColor: color, ...o };
  }
  if (x1 === x2) {
    const tp = g.u(Math.min(y1, y2));
    return { position: 'absolute', left: g.u(x1) - Math.floor(t / 2), top: tp, width: t, height: Math.max(1, g.u(Math.max(y1, y2)) - tp), backgroundColor: color, ...o };
  }
  const X1 = x1 * g.k;
  const Y1 = y1 * g.k;
  const X2 = x2 * g.k;
  const Y2 = y2 * g.k;
  const len = Math.hypot(X2 - X1, Y2 - Y1);
  const deg = (Math.atan2(Y2 - Y1, X2 - X1) * 180) / Math.PI;
  return {
    position: 'absolute',
    left: (X1 + X2) / 2 - len / 2,
    top: (Y1 + Y2) / 2 - t / 2,
    width: len,
    height: t,
    backgroundColor: color,
    transform: [{ rotate: `${Math.round(deg * 1000) / 1000}deg` }],
    ...o,
  };
}

/** Old SVG strokes, 340 × 300 units. */
const FOOTING: Seg[] = [[60, 272, 66, 256], [66, 256, 96, 256], [96, 256, 102, 272]];
const MAST: Seg[] = [[70, 74, 70, 256], [92, 74, 92, 256]];
const LATTICE: Seg[] = [
  [70, 256, 92, 218], [92, 256, 70, 218], [70, 218, 92, 180], [92, 218, 70, 180], [70, 180, 92, 142],
  [92, 180, 70, 142], [70, 142, 92, 104], [92, 142, 70, 104], [70, 104, 92, 74], [92, 104, 70, 74],
];
const APEX: Seg[] = [[81, 34, 70, 56], [81, 34, 92, 56]];
const COUNTER_JIB: Seg[] = [[30, 56, 70, 56], [81, 34, 34, 56], [40, 66, 68, 66]];
const JIB: Seg[] = [
  [92, 56, 300, 56], [100, 70, 278, 70], [81, 34, 300, 56],
  [120, 56, 120, 70], [160, 56, 160, 70], [200, 56, 200, 70], [240, 56, 240, 70], [278, 56, 278, 70],
  [120, 70, 160, 56], [160, 70, 200, 56], [200, 70, 240, 56], [240, 70, 278, 56],
];

export default function CraneMarkWeb({ size }: { size: number }) {
  const theme = useTheme() as ReturnType<typeof useTheme> | undefined;
  const colors = theme?.colors ?? splashFallbackColors();
  const reduce = useReducedMotion();
  const g = craneGeometry(size);
  const css = reduce ? null : craneStyles(size);

  const steel = colors.textMuted;
  const accent = colors.accent;
  const u = g.u;

  const slabStyle = (left: number, top: number): ViewStyle => ({
    position: 'absolute',
    left,
    top,
    width: g.slabW,
    height: g.slabH,
    backgroundColor: colors.surface,
    borderColor: accent,
    borderWidth: g.slabBorder,
    borderRadius: Math.max(1, u(1)),
  });
  const colH = g.floorPx - g.slabH;
  const columns = (slabTop: number) => {
    const top = slabTop - colH;
    return [
      { position: 'absolute' as const, left: g.newSlabLeft + g.colInset, top, width: g.colW, height: colH, backgroundColor: steel },
      { position: 'absolute' as const, left: g.newSlabLeft + g.slabW - g.colInset - g.colW, top, width: g.colW, height: colH, backgroundColor: steel },
    ];
  };
  // Enough identical floors to reach below the ground in both seam states.
  const floors = Math.ceil((g.groundY - g.newSlabTop) / g.floorPx) + 1;

  // Reduce Motion: the still frame (trolley out, beam on the lowered hook).
  const still = {
    trolley: reduce ? { transform: [{ translateX: g.trolleyDx }] } : null,
    drop: reduce ? { transform: [{ translateY: g.hookDy }] } : null,
    newFloor: reduce ? styles.hidden : null,
  };
  const hw = g.sw(1.6);
  const cableW = g.sw(1.3);

  return (
    <View
      testID="crane-mark-web"
      style={{ width: size, height: g.H, pointerEvents: 'none' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* footing, mast + static lattice */}
      {FOOTING.map((s, i) => <View key={`f${i}`} style={stroke(g, s, 2, steel)} />)}
      {MAST.map((s, i) => <View key={`m${i}`} style={stroke(g, s, 2, steel)} />)}
      {LATTICE.map((s, i) => <View key={`l${i}`} style={stroke(g, s, 1.4, steel)} />)}

      {/* the building going up: floors clipped at the ground line */}
      <View testID="crane-tower-clip" style={[styles.clip, { width: size, height: g.groundY }]}>
        <View testID="crane-tower" style={[styles.layer, { width: size, height: g.groundY }, css?.tower]}>
          {Array.from({ length: floors }, (_, j) => {
            const top = g.newSlabTop + (j + 1) * g.floorPx;
            const [c1, c2] = columns(top);
            return (
              <React.Fragment key={`fl${j}`}>
                <View style={c1} />
                <View style={c2} />
                <View style={slabStyle(g.newSlabLeft, top)} />
              </React.Fragment>
            );
          })}
          <View testID="crane-new-cols" style={[styles.layer, { width: size, height: g.groundY }, css?.cols, still.newFloor]}>
            {columns(g.newSlabTop).map((c, i) => <View key={`nc${i}`} style={c} />)}
          </View>
          <View testID="crane-new-slab" style={[slabStyle(g.newSlabLeft, g.newSlabTop), css?.slab, still.newFloor]} />
        </View>
      </View>

      {/* the ground line, over the tower's clipped foot */}
      <View style={stroke(g, [14, 272, 326, 272], 1.3, colors.line)} />

      {/* operator cab, apex, counter-jib + counterweight, jib truss */}
      <View
        style={{
          position: 'absolute', left: u(66), top: u(56), width: u(30), height: u(16), borderRadius: u(2),
          backgroundColor: colors.surface, borderColor: steel, borderWidth: g.sw(1.4),
        }}
      />
      {APEX.map((s, i) => <View key={`a${i}`} style={stroke(g, s, 2, steel)} />)}
      {COUNTER_JIB.map((s, i) => <View key={`c${i}`} style={stroke(g, s, 2, steel)} />)}
      <View
        style={{
          position: 'absolute', left: u(22), top: u(54), width: u(16), height: u(18), borderRadius: Math.max(1, u(1)),
          backgroundColor: colors.surface, borderColor: steel, borderWidth: g.sw(1.5),
        }}
      />
      {JIB.map((s, i) => <View key={`j${i}`} style={stroke(g, s, 2, steel)} />)}

      {/* the moving rig */}
      <View testID="crane-trolley" style={[StyleSheet.absoluteFill, css?.trolley, still.trolley]}>
        <View
          style={{
            position: 'absolute', left: g.pinX - u(8), top: u(68), width: u(16), height: Math.max(2, u(7)),
            borderRadius: Math.max(1, u(1.5)), backgroundColor: steel,
          }}
        />
        <View
          testID="crane-pendulum"
          style={[StyleSheet.absoluteFill, { transformOrigin: `${g.pinX}px ${g.pinY}px` }, css?.pendulum]}
        >
          <View
            testID="crane-cable"
            style={[
              { position: 'absolute', left: g.pinX - Math.floor(cableW / 2), top: g.pinY, width: cableW, height: g.cableFull, backgroundColor: steel, transformOrigin: 'top' },
              css?.cable,
            ]}
          />
          <View testID="crane-hook" style={[StyleSheet.absoluteFill, css?.drop, still.drop]}>
            <View style={stroke(g, [120, 113, 120, 121], 1.6, steel)} />
            <View
              style={{
                position: 'absolute', left: g.pinX - u(4) - Math.floor(hw / 2), top: u(119), width: u(4) + hw, height: u(7),
                borderColor: steel, borderLeftWidth: hw, borderRightWidth: hw, borderBottomWidth: hw,
                borderBottomLeftRadius: u(3), borderBottomRightRadius: u(3),
              }}
            />
            <View style={stroke(g, [120, 121, 105, 132], 1, steel, 0.7)} />
            <View style={stroke(g, [120, 121, 135, 132], 1, steel, 0.7)} />
            <View testID="crane-beam" style={[slabStyle(g.beamLeft, g.beamTop), css?.beam]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0 },
  clip: { position: 'absolute', left: 0, top: 0, overflow: 'hidden' },
  hidden: { opacity: 0 },
});
