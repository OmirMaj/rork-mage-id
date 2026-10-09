// components/livingModel/phone3d/phoneScene.ts — the web's scene, on the
// phone's drawing surface.
//
// The scene is built by components/livingModel/threeScene.ts, the SAME file
// the web view calls, unchanged. That builder asks for a browser canvas and
// makes its own renderer from it. The phone has no canvas: expo-gl hands over
// a WebGL2 drawing context and nothing else. So this file makes the smallest
// object the renderer accepts in a canvas's place:
//
//   getContext('webgl2')  answers the phone's context, so the renderer draws
//                         into it instead of asking a browser for one
//   width / height        the drawing buffer, in pixels (the renderer writes them)
//   style                 an empty object (the scene never asks the renderer to style it)
//   addEventListener / removeEventListener   nothing: a phone context is not
//                         lost and restored the way a browser tab's is
//
// and then wraps the scene's handle so that the rest of the phone view talks
// in POINTS of the screen (utils/livingModel/phoneViewCore.viewSize says why
// the scene's own units are not points on a 3x phone), and so that every
// drawn frame is shown: expo-gl draws off screen until endFrameEXP is called.
import { modelBounds } from '@/utils/livingModel/modelCore';
import { nextZoom, pointsPerMetre, viewSize, type PhoneViewSize } from '@/utils/livingModel/phoneViewCore';
import { fitSpan } from '@/utils/livingModel/sceneCore';
import type { PlacedRoom } from '@/utils/livingModel/types';
import type { JobSceneHandle, RoomLook } from '../threeScene';
import type { PhoneGl } from './engine';

export interface CanvasStandIn {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  style: Record<string, unknown>;
  addEventListener: () => void;
  removeEventListener: () => void;
  getContext: (name: string) => PhoneGl | null;
}

/** What the renderer is handed where the web hands it a canvas. */
export function canvasStandIn(gl: PhoneGl): CanvasStandIn {
  return {
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    clientWidth: gl.drawingBufferWidth,
    clientHeight: gl.drawingBufferHeight,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: (name) => (name === 'webgl2' ? gl : null),
  };
}

export interface PhoneScene {
  /** The view was laid out, in points. False when the size cannot be used yet. */
  layout: (widthPt: number, heightPt: number) => boolean;
  setRooms: (rooms: readonly PlacedRoom[], cutHeightM: number | null) => void;
  apply: (looks: ReadonlyMap<string, RoomLook>) => void;
  /** Draws one frame and shows it. With `wait`, also waits for the phone to finish drawing, for timing. */
  draw: (wait?: boolean) => void;
  /** Waits until the phone has run every drawing call it was handed. For timing only. */
  settle: () => void;
  orbit: (dxPt: number, dyPt: number) => void;
  pan: (dxPt: number, dyPt: number) => void;
  zoomBy: (factor: number) => void;
  resetView: () => void;
  /** The room under a point of the view, in points from its top left. */
  pickAt: (xPt: number, yPt: number) => string | null;
  /** Where a room's label goes, in points from the view's top left. */
  labelAt: (roomId: string) => { x: number; y: number } | null;
  /** Points of screen per metre of floor at the current zoom. */
  pointsPerMetre: () => number;
  dispose: () => void;
}

export function makePhoneScene(handle: JobSceneHandle, gl: PhoneGl): PhoneScene {
  let size: PhoneViewSize | null = null;
  let spanM = 8;
  let zoom = 1;
  return {
    layout(widthPt, heightPt) {
      const next = viewSize(widthPt, heightPt, gl.drawingBufferWidth, gl.drawingBufferHeight);
      if (!next) return false;
      size = next;
      handle.resize(next.width, next.height, next.pixelRatio);
      return true;
    },
    setRooms(rooms, cutHeightM) {
      handle.setRooms(rooms, cutHeightM);
      // The same box and span the scene fits its camera to (threeScene.setRooms).
      const level = rooms.length ? rooms[0].level : 0;
      spanM = fitSpan(modelBounds({ version: 1, projectId: '', rooms: [...rooms], links: {}, updatedAt: '' }, level)).span;
    },
    apply: (looks) => handle.apply(looks),
    draw(wait) {
      handle.render();
      gl.endFrameEXP();
      // getError answers only after the phone has run every queued call, so it is the wait.
      if (wait) gl.getError?.();
    },
    settle: () => { gl.getError?.(); },
    // Turning is by the finger's travel in points, the same feel as a mouse on the web.
    orbit: (dxPt, dyPt) => handle.orbit(dxPt, dyPt),
    // Moving follows the fingers, so it is worked in the scene's own units.
    pan(dxPt, dyPt) {
      const k = size?.unitsPerPoint ?? 1;
      handle.pan(dxPt * k, dyPt * k);
    },
    zoomBy(factor) {
      zoom = nextZoom(zoom, factor);
      handle.zoomBy(factor);
    },
    resetView() {
      zoom = 1;
      handle.resetView();
    },
    pickAt(xPt, yPt) {
      const k = size?.unitsPerPoint ?? 1;
      return handle.pick(xPt * k, yPt * k);
    },
    labelAt(roomId) {
      const p = handle.project(roomId);
      const k = size?.unitsPerPoint ?? 1;
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x / k, y: p.y / k } : null;
    },
    pointsPerMetre: () => (size ? pointsPerMetre(size, spanM, zoom) : 0),
    dispose: () => handle.dispose(),
  };
}
