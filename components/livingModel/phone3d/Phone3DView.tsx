// components/livingModel/phone3d/Phone3DView.tsx — Job Replay in 3D, on the phone.
//
// The Living Model, lane PHONE3D. Mounted ONLY by components/livingModel/JobReplay3D.tsx,
// and only after ./engine has answered that this build has the 3D engine and
// has read it. This file imports neither expo-gl nor the 3D library: it is
// handed both (the `engine` prop), the way threeScene.ts is handed the library.
//
// WHAT IS THE SAME AS THE WEB. The scene: components/livingModel/threeScene.ts
// builds it, unchanged, through ./phoneScene. The stage colours, the cut walls,
// the faint plan ahead of today, the corner card and the two buttons.
//
// WHAT IS THE PHONE'S OWN.
//   Fingers  one finger turns, two fingers move, a pinch zooms, a tap picks
//            the room under it (utils/livingModel/phoneViewCore).
//   Labels   ordinary Text over the drawing, so the words stay sharp. Each is
//            moved to its room about thirty times a second while the model
//            turns; a room that is small on the screen shows its name alone,
//            and a very small one shows no label.
//   Frames   a frame is drawn only when something changed (a finger, the
//            scrubber, Play) and nothing is drawn otherwise. Drawing stops
//            when the screen is not the one in front and when the app is not
//            active: an iPhone ends an app that draws in the background.
//   Failure  a start or a frame that throws is reported once (onFailed) and
//            the caller draws the flat replay. Nothing here may take the
//            screen down.
//
// MOTION. Nothing here moves on its own. The drawing fades in once when its
// first frame is ready, and not at all under Reduce Motion.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, PanResponder, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { usePhone3DCopy } from '@/hooks/usePhone3DCopy';
import { useReducedMotion } from '@/components/ui';
import { roomBounds } from '@/utils/livingModel/modelCore';
import {
  LABEL_THROTTLE_MS, frameStats, gestureBegin, gestureEnd, gestureMove, labelDetail,
  type FingerPoint, type GestureState, type LabelDetail,
} from '@/utils/livingModel/phoneViewCore';
import { roomLayers } from '@/utils/livingModel/replayCore';
import { DEFAULT_CUT_M } from '@/utils/livingModel/sceneCore';
import { ToolButton } from '../RoomEditor';
import type { JobReplay3DProps } from '../jobReplay3DProps';
import { stageLine, usePalette } from '../replayShared';
import { makeLivingModelStyles } from '../styles';
import type { RoomLook } from '../threeScene';
import type { Phone3DEngine, PhoneGl } from './engine';
import { canvasStandIn, makePhoneScene, type PhoneScene } from './phoneScene';

/** For the spike route and the build notes only. The Living Model screen passes none of this. */
export interface Phone3DDebug {
  /** Turn the default view by this many points of finger travel. */
  orbitDx?: number;
  orbitDy?: number;
  /** Zoom the default view by this factor. */
  zoom?: number;
  /** Change this to turn the model for `spinFrames` frames, each one timed to the end of the phone's drawing. */
  spinToken?: number;
  spinFrames?: number;
  onSpin?: (r: { frames: number; medianMs: number; p95Ms: number; worstMs: number; medianGapMs: number; p95GapMs: number }) => void;
  /** What threw, in the error's own words. The Living Model screen shows a plain sentence instead. */
  onError?: (what: string) => void;
}

export type Phone3DViewProps = Omit<JobReplay3DProps, 'onUnavailable'> & {
  engine: Phone3DEngine;
  /** The view could not start, or a frame threw. Called at most once. */
  onFailed: () => void;
  debug?: Phone3DDebug;
};

const touchesOf = (e: GestureResponderEvent): FingerPoint[] =>
  (e.nativeEvent.touches ?? []).map((t) => ({ id: String(t.identifier), x: t.pageX, y: t.pageY }));

export function Phone3DView({ engine, model, level, moments, selectedId, onSelect, onFailed, weekLine, atToday, height, debug }: Phone3DViewProps) {
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const phoneCopy = usePhone3DCopy();
  const palette = usePalette();
  const reduceMotion = useReducedMotion();
  const { GLView } = engine;
  const rooms = useMemo(() => model.rooms.filter((r) => r.level === level), [model, level]);
  const [ready, setReady] = useState(false);
  const [cut, setCut] = useState(true);
  const [details, setDetails] = useState<Record<string, LabelDetail>>({});

  const sceneRef = useRef<PhoneScene | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const raf = useRef(0);
  const dirty = useRef(false);
  const labelsStale = useRef(false);
  const labelsAt = useRef(0);
  const focused = useRef(true);
  const appActive = useRef(AppState.currentState == null || AppState.currentState === 'active');
  const failed = useRef(false);
  const alive = useRef(true);
  const labelViews = useRef(new Map<string, View>());
  const labelSizes = useRef(new Map<string, { w: number; h: number }>());
  const labelSpots = useRef(new Map<string, { x: number; y: number }>());
  const fade = useRef(new Animated.Value(0)).current;
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const reduceRef = useRef(reduceMotion);
  reduceRef.current = reduceMotion;
  const frameRef = useRef<(ts: number) => void>(() => {});

  const debugRef = useRef(debug);
  debugRef.current = debug;
  const fail = useCallback((e?: unknown) => {
    if (failed.current) return;
    failed.current = true;
    if (e !== undefined) debugRef.current?.onError?.(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    const s = sceneRef.current;
    sceneRef.current = null;
    try { s?.dispose(); } catch { /* the drawing surface is already gone */ }
    if (alive.current) onFailedRef.current();
  }, []);

  /** Ask for one frame. Nothing is asked for while the screen is not in front or the app is not active. */
  const requestDraw = useCallback(() => {
    dirty.current = true;
    labelsStale.current = true;
    if (raf.current || failed.current || !sceneRef.current || !focused.current || !appActive.current) return;
    raf.current = requestAnimationFrame((ts) => frameRef.current(ts));
  }, []);

  const placeLabels = useCallback((scene: PhoneScene) => {
    const ppm = scene.pointsPerMetre();
    let next: Record<string, LabelDetail> | null = null;
    for (const r of roomsRef.current) {
      const p = scene.labelAt(r.id);
      if (p) {
        labelSpots.current.set(r.id, p);
        const size = labelSizes.current.get(r.id);
        const v = labelViews.current.get(r.id);
        if (size && v) v.setNativeProps({ style: { opacity: 1, transform: [{ translateX: Math.round(p.x - size.w / 2) }, { translateY: Math.round(p.y - size.h / 2) }] } });
      }
      const b = roomBounds(r);
      const d = b ? labelDetail(Math.min(b.maxX - b.minX, b.maxY - b.minY), ppm) : 'none';
      (next ??= {})[r.id] = d;
    }
    if (next) {
      const n = next;
      setDetails((prev) => (Object.keys(n).length === Object.keys(prev).length && Object.keys(n).every((k) => prev[k] === n[k]) ? prev : n));
    }
  }, []);

  frameRef.current = (ts: number) => {
    raf.current = 0;
    const scene = sceneRef.current;
    if (!scene || failed.current || !focused.current || !appActive.current) return;
    if (dirty.current) {
      dirty.current = false;
      try { scene.draw(); } catch (e) { fail(e); return; }
    }
    if (labelsStale.current && ts - labelsAt.current >= LABEL_THROTTLE_MS) {
      labelsStale.current = false;
      labelsAt.current = ts;
      try { placeLabels(scene); } catch { /* a label that cannot be placed is left where it was */ }
    }
    // Something is still owed (a newer frame, or labels held back by the throttle): go round once more. Otherwise stop.
    if (dirty.current || labelsStale.current) raf.current = requestAnimationFrame((t) => frameRef.current(t));
  };

  // The drawing surface exists: build the scene on it.
  const onContextCreate = useCallback((gl: PhoneGl) => {
    if (!alive.current || failed.current) return;
    try {
      const scene = makePhoneScene(engine.createScene(canvasStandIn(gl), palette), gl);
      sceneRef.current = scene;
      if (sizeRef.current.w > 0) scene.layout(sizeRef.current.w, sizeRef.current.h);
      setReady(true);
    } catch (e) {
      fail(e);
    }
    // The palette is read once per drawing surface: JobReplay3D.tsx mounts a new view when the theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, fail]);

  const onBox = useCallback((e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    sizeRef.current = { w: width, h };
    if (sceneRef.current?.layout(width, h)) requestDraw();
  }, [requestDraw]);

  // The rooms, or the wall height, changed: build the shapes again.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    try {
      scene.setRooms(rooms, cut ? DEFAULT_CUT_M : null);
      if (debug?.orbitDx || debug?.orbitDy) scene.orbit(debug.orbitDx ?? 0, debug.orbitDy ?? 0);
      if (debug?.zoom && debug.zoom > 0) scene.zoomBy(debug.zoom);
    } catch (e) { fail(e); return; }
    labelsAt.current = 0;
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, rooms, cut, debug?.orbitDx, debug?.orbitDy, debug?.zoom]);

  // The moment, or the reading, changed: show each room's stage.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const looks = new Map<string, RoomLook>();
    for (const r of rooms) {
      const m = moments.get(r.id);
      if (!m) continue;
      const a = m.solid;
      looks.set(r.id, {
        solid: roomLayers(m.solid),
        ghost: roomLayers(m.ghost),
        opens: a.demolition != null || a.framing != null || a.rough_in != null || a.insulation != null || a.drywall != null,
      });
    }
    try { scene.apply(looks); } catch (e) { fail(e); return; }
    requestDraw();
  }, [ready, rooms, moments, cut, requestDraw, fail]);

  // The first frame is in: let the drawing be seen.
  useEffect(() => {
    if (!ready) return;
    if (reduceRef.current) { fade.setValue(1); return; }
    const a = Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [ready, fade]);

  // Draw only while this screen is the one in front.
  useFocusEffect(useCallback(() => {
    focused.current = true;
    requestDraw();
    return () => {
      focused.current = false;
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [requestDraw]));

  // Draw only while the app is active. Coming back draws once, so the picture is never a stale one.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      appActive.current = s === 'active';
      if (appActive.current) requestDraw();
      else { cancelAnimationFrame(raf.current); raf.current = 0; }
    });
    return () => sub.remove();
  }, [requestDraw]);

  // Leaving: stop the frames and give back every shape, material and the renderer.
  // The drawing surface itself is ended by the GLView when it leaves the screen.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      const s = sceneRef.current;
      sceneRef.current = null;
      try { s?.dispose(); } catch { /* the drawing surface is already gone */ }
    };
  }, []);

  // The spike's timed turn (app/dev-phone-3d.tsx). Each frame waits for the phone to finish drawing.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene || !debug?.spinToken) return;
    const total = Math.max(1, Math.min(600, debug.spinFrames ?? 120));
    const costs: number[] = [];
    const gaps: number[] = [];
    let n = 0;
    let last = 0;
    let id = 0;
    const step = (ts: number) => {
      const live = sceneRef.current;
      if (!live || failed.current) return;
      if (last) gaps.push(ts - last);
      last = ts;
      const t0 = performance.now();
      try { live.orbit(3, 0); live.draw(true); } catch (e) { fail(e); return; }
      costs.push(performance.now() - t0);
      if (++n < total) { id = requestAnimationFrame(step); return; }
      const c = frameStats(costs);
      const g = frameStats(gaps);
      labelsStale.current = true;
      requestDraw();
      debug.onSpin?.({ frames: c.frames, medianMs: c.medianMs, p95Ms: c.p95Ms, worstMs: c.worstMs, medianGapMs: g.medianMs, p95GapMs: g.p95Ms });
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, debug?.spinToken]);

  // Fingers. The model keeps the touch once it has it: the page behind does not scroll while it turns.
  const gesture = useRef<GestureState | null>(null);
  const tapAt = useRef({ x: 0, y: 0 });
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      gesture.current = gestureBegin(touchesOf(e), Date.now());
      tapAt.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
    },
    onPanResponderMove: (e) => {
      const scene = sceneRef.current;
      if (!gesture.current || !scene) return;
      const { state, acts } = gestureMove(gesture.current, touchesOf(e));
      gesture.current = state;
      if (!acts.length) return;
      try {
        for (const a of acts) {
          if (a.kind === 'orbit') scene.orbit(a.dx, a.dy);
          else if (a.kind === 'pan') scene.pan(a.dx, a.dy);
          else if (a.kind === 'zoom') scene.zoomBy(a.factor);
        }
      } catch (e) { fail(e); return; }
      requestDraw();
    },
    onPanResponderRelease: () => {
      const g = gesture.current;
      gesture.current = null;
      const scene = sceneRef.current;
      if (!g || !scene) return;
      if (gestureEnd(g, Date.now()).some((a) => a.kind === 'tap')) {
        let hit: string | null = null;
        try { hit = scene.pickAt(tapAt.current.x, tapAt.current.y); } catch { hit = null; }
        onSelectRef.current(hit && hit !== selectedRef.current ? hit : null);
      }
      labelsAt.current = 0;
      requestDraw();
    },
    onPanResponderTerminate: () => { gesture.current = null; },
  }), [requestDraw, fail]);

  return (
    <View style={[styles.stage3d, { height }]} testID="lm-replay-3d">
      {/* Measured here, inside the border: the drawing, the fingers and the labels all share this box. */}
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: fade }} onLayout={onBox}>
        <GLView style={{ flex: 1 }} msaaSamples={4} onContextCreate={onContextCreate} />
      </Animated.View>
      <View
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        {...pan.panHandlers}
        accessible
        accessibilityRole="image"
        accessibilityLabel={phoneCopy.modelA11yBody}
        accessibilityHint={phoneCopy.touchHelpSub}
        testID="lm-replay-3d-touch"
      />
      {!ready ? <Text style={[styles.note, { position: 'absolute', left: 12, bottom: 12 }]}>{copy.loading3dBody}</Text> : null}
      {ready ? rooms.map((r) => {
        const detail = details[r.id] ?? 'none';
        if (detail === 'none') return null;
        const m = moments.get(r.id);
        const spot = labelSpots.current.get(r.id);
        const size = labelSizes.current.get(r.id);
        const placed = spot && size ? { opacity: 1, transform: [{ translateX: Math.round(spot.x - size.w / 2) }, { translateY: Math.round(spot.y - size.h / 2) }] } : { opacity: 0 };
        return (
          <View
            key={r.id}
            ref={(el) => { if (el) labelViews.current.set(r.id, el); else { labelViews.current.delete(r.id); labelSizes.current.delete(r.id); } }}
            onLayout={(e) => {
              labelSizes.current.set(r.id, { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
              labelsAt.current = 0;
              requestDraw();
            }}
            style={[styles.pin, r.id === selectedId && styles.pinOn, placed]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={`lm-pin-${r.id}`}
          >
            <Text style={styles.pinName} numberOfLines={1}>{r.name}</Text>
            {detail === 'full' ? (
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: palette.stage[m?.stage ?? 'no_tasks'], width: 8, height: 8 }]} />
                <Text style={styles.pinSub} numberOfLines={1}>{stageLine(m, copy)}</Text>
              </View>
            ) : null}
          </View>
        );
      }) : null}
      <View style={styles.hud} pointerEvents="none">
        <View style={styles.hudRow}>
          <Text style={styles.hudWeek}>{weekLine}</Text>
          {atToday ? <View style={styles.todayTag}><Text style={styles.todayTagText}>{copy.todayLabel}</Text></View> : null}
        </View>
      </View>
      <View style={styles.viewBtns}>
        <ToolButton label={cut ? copy.fullWallsLabel : copy.cutWallsLabel} onPress={() => setCut((c) => !c)} testID="lm-cut" />
        <ToolButton label={copy.resetViewLabel} onPress={() => { try { sceneRef.current?.resetView(); } catch (e) { fail(e); return; } labelsAt.current = 0; requestDraw(); }} testID="lm-reset-view" />
      </View>
    </View>
  );
}
