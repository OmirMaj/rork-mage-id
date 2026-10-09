// components/livingModel/JobReplay3D.web.tsx — Job Replay in 3D. WEB ONLY.
//
// The Living Model, Phase 1. Metro picks this file for the web bundle and
// JobReplay3D.tsx (which draws nothing) for iOS and Android.
//
// HOW THE 3D LIBRARY IS KEPT OUT OF EVERYTHING ELSE. `three` is loaded in ONE
// place, `loadThree` below: a dynamic import, behind Platform.OS === 'web',
// called from an effect when this view mounts. So:
//   - the phone bundle never reads this file and never resolves the library;
//   - every other web screen pays nothing, because the library is its own
//     chunk and is fetched only when Job Replay opens;
//   - jest never loads it (the phone file is the one jest resolves).
// scripts/validate-living-model.ts fails on a static import of the library
// anywhere, and on a second dynamic import.
//
// The scene itself is built in ./threeScene.ts from plain numbers
// (utils/livingModel/sceneCore.ts). This file is the canvas, the pointer and
// keyboard handling, the room labels and the two toggles.
//
// A THEME CHANGE MAKES A NEW SCENE. The scene holds the palette's colours, so
// when the palette changes the old scene is thrown away (its WebGL context is
// given back) and a new one is made on a FRESH canvas. `ready` goes false in
// the cleanup, so the rooms and their stages are drawn into the new scene the
// moment it is ready. Leaving `ready` true there is how the view once went
// blank on a theme change; scripts/validate-living-model.ts plants that.
//
// THE PAGE STILL SCROLLS. The wheel zooms the model only after the person
// clicks it (the canvas has focus) or while Ctrl or Cmd is held; otherwise the
// wheel scrolls the page as it does everywhere else. On a narrow screen one
// finger scrolls the page and two fingers move, turn and zoom the model. A
// line under the view says so.
//
// A LOST CONTEXT (the browser took the graphics memory back) is said in a plain
// sentence with a Reload View button, which makes a new scene.
//
// MOTION. Nothing here animates on its own: the picture changes only when the
// scrubber moves or the person turns the model. The clock that plays the job
// steps a week at a time under Reduce Motion (replayShared.useReplayState).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { Button } from '@/components/ui';
import { roomLayers } from '@/utils/livingModel/replayCore';
import { DEFAULT_CUT_M, canvasTouchAction, oneFingerTurnsModel, pinSize, wheelShouldZoom } from '@/utils/livingModel/sceneCore';
import { ToolButton } from './RoomEditor';
import type { JobReplay3DProps } from './jobReplay3DProps';
import { StageLegend, stageLine, usePalette } from './replayShared';
import { makeLivingModelStyles } from './styles';
import { createJobScene, type JobSceneHandle, type RoomLook } from './threeScene';

export const JOB_REPLAY_3D_ON_THIS_PLATFORM = true;

/** The one place the 3D library is loaded: on the web, and only when asked. */
function loadThree(): Promise<typeof import('three')> {
  if (Platform.OS !== 'web') return Promise.reject(new Error('The 3D view is on the web only.'));
  return import('three');
}

/**
 * `loadLibrary` is for the jest suite only, which cannot run a dynamic import: it hands in a stand-in so the view's own
 * start, theme change and lost-context paths can be run with no WebGL. The app never passes it (the validator checks),
 * so in the app the library comes from `loadThree` and nowhere else.
 */
export function JobReplay3D({ model, level, moments, selectedId, onSelect, onUnavailable, weekLine, atToday, height, compact, loadLibrary = loadThree }: JobReplay3DProps & { loadLibrary?: () => Promise<typeof import('three')> }) {
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const palette = usePalette();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<View | null>(null);
  const sceneRef = useRef<JobSceneHandle | null>(null);
  const pinRefs = useRef(new Map<string, HTMLElement>());
  const dirty = useRef(true);
  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [cut, setCut] = useState(true);
  const rooms = useMemo(() => model.rooms.filter((r) => r.level === level), [model, level]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hoverRef = useRef<string | null>(null);
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  // One canvas per scene: a scene gives its WebGL context back when it is thrown away, so the next one needs a canvas of its own.
  const sceneKey = useMemo(() => ({ palette, reloads }), [palette, reloads]);
  const canvasKeys = useRef({ of: sceneKey, n: 0 });
  if (canvasKeys.current.of !== sceneKey) canvasKeys.current = { of: sceneKey, n: canvasKeys.current.n + 1 };
  const canvasKey = canvasKeys.current.n;

  // Start: load the library, make the scene, wire the pointer, the wheel and the keys.
  useEffect(() => {
    let alive = true;
    let raf = 0;
    let handle: JobSceneHandle | null = null;
    let observer: ResizeObserver | null = null;
    const canvas = canvasRef.current;
    const cleanups: (() => void)[] = [];
    void loadLibrary().then((THREE) => {
      if (!alive || !canvas) return;
      try {
        handle = createJobScene(THREE, canvas, palette);
      } catch {
        onUnavailableRef.current();
        return;
      }
      sceneRef.current = handle;
      const size = () => {
        const b = canvas.getBoundingClientRect();
        handle?.resize(b.width, b.height, window.devicePixelRatio || 1);
        dirty.current = true;
      };
      size();
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(size); observer.observe(canvas); }

      const ptr = new Map<number, { x: number; y: number }>();
      let down: { x: number; y: number } | null = null;
      let pinch = 0;
      let twist = 0;
      let mid = { x: 0, y: 0 };
      const pair = () => {
        const [p, q] = [...ptr.values()];
        return { d: Math.hypot(p.x - q.x, p.y - q.y), a: Math.atan2(q.y - p.y, q.x - p.x), m: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
      };
      const onDown = (e: PointerEvent) => {
        // A pointer the browser no longer tracks cannot be captured; the drag still works without it.
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not captured */ }
        ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptr.size === 1) down = { x: e.clientX, y: e.clientY };
        else {
          down = null;
          const g = pair();
          pinch = g.d;
          twist = g.a;
          mid = g.m;
        }
      };
      const onMove = (e: PointerEvent) => {
        const p = ptr.get(e.pointerId);
        if (!p || !handle) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (ptr.size === 1) {
          // On a narrow screen one finger belongs to the page (it scrolls); the model moves with two.
          if (!oneFingerTurnsModel(e.pointerType, compactRef.current)) return;
          if (e.shiftKey || e.buttons === 2) handle.pan(dx, dy); else handle.orbit(dx, dy);
        } else if (ptr.size === 2) {
          const g = pair();
          if (pinch > 0) handle.zoomBy(g.d / pinch);
          let turn = g.a - twist;
          if (turn > Math.PI) turn -= Math.PI * 2; else if (turn < -Math.PI) turn += Math.PI * 2;
          handle.turnBy(turn);
          handle.pan(g.m.x - mid.x, g.m.y - mid.y);
          pinch = g.d;
          twist = g.a;
          mid = g.m;
        }
        dirty.current = true;
      };
      const onUp = (e: PointerEvent) => {
        if (!ptr.has(e.pointerId)) return;
        ptr.delete(e.pointerId);
        if (down && handle && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
          const b = canvas.getBoundingClientRect();
          const hit = handle.pick(e.clientX - b.left, e.clientY - b.top);
          onSelectRef.current(hit && hit !== selectedRef.current ? hit : null);
        }
        down = null;
      };
      // The browser took the touch (the page is scrolling): nothing was tapped.
      const onCancel = (e: PointerEvent) => { ptr.delete(e.pointerId); down = null; };
      const onWheel = (e: WheelEvent) => {
        if (!wheelShouldZoom(e, typeof document !== 'undefined' && document.activeElement === canvas)) return;
        e.preventDefault();
        handle?.zoomBy(Math.exp(-e.deltaY * 0.0012));
        dirty.current = true;
      };
      // Two fingers are for the model: the page must not scroll or zoom under them.
      const onTouch = (e: TouchEvent) => { if (e.touches.length >= 2 && e.cancelable) e.preventDefault(); };
      const onMenu = (e: Event) => e.preventDefault();
      const onLost = (e: Event) => { e.preventDefault(); if (alive) setLost(true); };
      const onKey = (e: KeyboardEvent) => {
        if (!handle) return;
        const k = e.key;
        if (k === 'ArrowLeft') handle.orbit(24, 0);
        else if (k === 'ArrowRight') handle.orbit(-24, 0);
        else if (k === 'ArrowUp') handle.orbit(0, 20);
        else if (k === 'ArrowDown') handle.orbit(0, -20);
        else if (k === '+' || k === '=') handle.zoomBy(1.15);
        else if (k === '-' || k === '_') handle.zoomBy(1 / 1.15);
        else if (k === '0') handle.resetView();
        else return;
        e.preventDefault();
        dirty.current = true;
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onCancel);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('touchstart', onTouch, { passive: false });
      canvas.addEventListener('touchmove', onTouch, { passive: false });
      canvas.addEventListener('contextmenu', onMenu);
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('keydown', onKey);
      cleanups.push(() => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onCancel);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('touchstart', onTouch);
        canvas.removeEventListener('touchmove', onTouch);
        canvas.removeEventListener('contextmenu', onMenu);
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('keydown', onKey);
      });

      // Draw only when something changed: no frame is spent on a still picture.
      const frame = () => {
        if (dirty.current && handle) {
          dirty.current = false;
          handle.render();
          pinRefs.current.forEach((el, roomId) => {
            const p = handle?.project(roomId);
            // A label that is not on the page yet has nothing to place.
            if (!p || !el.style) return;
            el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
            // A label no wider than its room: the stage line, then the name, give way in a small room.
            const sized = pinSize(handle?.roomWidthPx(roomId) ?? Number.NaN, roomId === selectedRef.current || roomId === hoverRef.current);
            const size = compactRef.current && sized === 'full' && roomId !== selectedRef.current ? 'name' : sized;
            const [name, sub] = [el.children[1], el.children[2]] as (HTMLElement | undefined)[];
            if (name) name.style.display = size === 'dot' ? 'none' : '';
            if (sub) sub.style.display = size === 'full' ? '' : 'none';
            el.style.padding = size === 'dot' ? '3px' : '';
            el.style.zIndex = size === 'full' ? '2' : '1';
          });
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      setReady(true);
    }).catch(() => { if (alive) onUnavailableRef.current(); });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      for (const c of cleanups) c();
      handle?.dispose();
      sceneRef.current = null;
      // This scene is gone. The next one starts empty, so the rooms and their stages have to be drawn into it again.
      setReady(false);
    };
  }, [palette, reloads, loadLibrary]);

  // The rooms, or the wall height, changed: build the shapes again.
  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    sceneRef.current.setRooms(rooms, cut ? DEFAULT_CUT_M : null);
    dirty.current = true;
  }, [ready, rooms, cut]);

  // The moment, or the reading, changed: show each room's stage.
  useEffect(() => {
    if (!ready || !sceneRef.current) return;
    const looks = new Map<string, RoomLook>();
    for (const r of rooms) {
      const m = moments.get(r.id);
      if (!m) continue;
      const a = m.solid;
      looks.set(r.id, {
        solid: roomLayers(m.solid),
        ghost: roomLayers(m.ghost),
        opens: a.demolition != null || a.framing != null || a.rough_in != null || a.insulation != null || a.drywall != null,
        stage: m.stage,
      });
    }
    sceneRef.current.apply(looks);
    dirty.current = true;
  }, [ready, rooms, moments, cut]);

  // The selected room's label is drawn in full: place the labels again.
  useEffect(() => { dirty.current = true; }, [selectedId, compact]);

  return (
    <View ref={boxRef} style={[styles.stage3d, { height }]} testID="lm-replay-3d">
      {React.createElement('canvas', {
        key: canvasKey,
        ref: canvasRef,
        tabIndex: 0,
        role: 'img',
        'aria-label': copy.canvasA11yBody,
        style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', touchAction: canvasTouchAction(compact), outlineOffset: -2 },
      })}
      {!ready && !lost ? <Text style={[styles.note, styles.stageNote]}>{copy.loading3dBody}</Text> : null}
      {ready && !lost ? rooms.map((r) => {
        const m = moments.get(r.id);
        const on = r.id === selectedId;
        return (
          <Pressable
            key={r.id}
            ref={(el) => { if (el) pinRefs.current.set(r.id, el as unknown as HTMLElement); else pinRefs.current.delete(r.id); dirty.current = true; }}
            style={[styles.pin, on && styles.pinOn]}
            onPress={() => onSelect(on ? null : r.id)}
            onHoverIn={() => { hoverRef.current = r.id; dirty.current = true; }}
            onHoverOut={() => { if (hoverRef.current === r.id) hoverRef.current = null; dirty.current = true; }}
            accessibilityRole="button"
            accessibilityLabel={copy.roomA11yLabel(r.name, stageLine(m, copy))}
            testID={`lm-pin-${r.id}`}
          >
            <View style={[styles.swatch, { backgroundColor: palette.stage[m?.stage ?? 'no_tasks'] }]} />
            <Text style={styles.pinName} numberOfLines={1}>{r.name}</Text>
            <Text style={styles.pinSub} numberOfLines={1}>{stageLine(m, copy)}</Text>
          </Pressable>
        );
      }) : null}
      {lost ? (
        <View style={styles.stageLost} testID="lm-3d-lost">
          <Text style={styles.para}>{copy.contextLostBody}</Text>
          <Button label={copy.reloadViewLabel} variant="secondary" size="sm" onPress={() => { setLost(false); setReloads((n) => n + 1); }} testID="lm-reload-view" />
        </View>
      ) : null}
      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.hudRow}>
          <Text style={styles.hudWeek}>{weekLine}</Text>
          {atToday ? <View style={styles.todayTag}><Text style={styles.todayTagText}>{copy.todayLabel}</Text></View> : null}
        </View>
        {compact ? null : <StageLegend />}
      </View>
      <View style={styles.viewBtns}>
        <ToolButton label={cut ? copy.fullWallsLabel : copy.cutWallsLabel} onPress={() => setCut((c) => !c)} testID="lm-cut" />
        <ToolButton label={copy.resetViewLabel} onPress={() => { sceneRef.current?.resetView(); dirty.current = true; }} testID="lm-reset-view" />
      </View>
    </View>
  );
}
