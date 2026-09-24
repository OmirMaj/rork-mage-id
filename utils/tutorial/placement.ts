// utils/tutorial/placement.ts — spotlight geometry, pure.
//
// The spotlight is FOUR dim rects around an EMPTY hole, so the real control
// under the hole receives the real touch — no forwarding, no fake button.
// That only works if the four rects plus the hole tile the layer exactly: a
// 1 px gap is a tap that lands on the screen behind the dim, and an overlap
// is a strip of the real control that looks lit but swallows the tap.
// scripts/validate-tutorial-placement.ts checks the tiling by area.
//
// All coordinates are in the LAYER's space (target.measureInWindow minus
// layer.measureInWindow), which cancels iOS pageSheet offsets, the Android
// status bar, the desktop sidebar and web scroll containers.

import type { Gesture, Rect, Size } from './types';

export const HOLE_PAD = 8;
export const CARD_GUTTER = 16;
export const CARD_GAP = 12;
export const CARD_MAX_W_PHONE = 360;
export const CARD_MAX_W_WIDE = 420;
/** A hole covering more than this share of the layer (the plan canvas) docks
 *  the card at the top, like the reference video's top pill. */
export const DOCK_HOLE_SHARE = 0.6;
/** Centre in the top 45 % of the usable height → card below the hole. */
export const BELOW_THRESHOLD = 0.45;
/** Scroll-into-view margin: a target closer than this to an edge is scrolled. */
export const SCROLL_MARGIN = 72;
/** Fingertip offset from the hole centre (spec §7). */
export const HAND_OFFSET = { x: 8, y: 10 } as const;
const HAND_INSET = 4;

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));

/** The target rect grown by `pad` and clamped to the layer. Never negative. */
export function holeRect(target: Rect, layer: Size, pad: number = HOLE_PAD): Rect {
  const x0 = clamp(target.x - pad, 0, layer.w);
  const y0 = clamp(target.y - pad, 0, layer.h);
  const x1 = clamp(target.x + target.w + pad, 0, layer.w);
  const y1 = clamp(target.y + target.h + pad, 0, layer.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** [top, bottom, left, right]. Top and bottom span the full width; left and
 *  right fill the hole's own band. Together with the hole they tile the layer
 *  with no gap and no overlap. */
export function dimRects(hole: Rect, layer: Size): [Rect, Rect, Rect, Rect] {
  const top: Rect = { x: 0, y: 0, w: layer.w, h: hole.y };
  const bottom: Rect = { x: 0, y: hole.y + hole.h, w: layer.w, h: Math.max(0, layer.h - (hole.y + hole.h)) };
  const left: Rect = { x: 0, y: hole.y, w: hole.x, h: hole.h };
  const right: Rect = { x: hole.x + hole.w, y: hole.y, w: Math.max(0, layer.w - (hole.x + hole.w)), h: hole.h };
  return [top, bottom, left, right];
}

export interface CardPlacementInput {
  hole: Rect;
  /** Measured card height (so Dynamic Type is handled). Width is decided here. */
  cardH: number;
  layer: Size;
  insets: { top: number; bottom: number };
  keyboardH: number;
  wide: boolean;
}

export interface CardPlacement {
  x: number;
  y: number;
  width: number;
  side: 'below' | 'above' | 'top';
  /** Caret x relative to the card's left edge; null when docked. */
  caretX: number | null;
}

export function cardWidth(layerW: number, wide: boolean): number {
  const max = wide ? CARD_MAX_W_WIDE : CARD_MAX_W_PHONE;
  return Math.max(0, Math.min(max, layerW - CARD_GUTTER * 2));
}

export function placeCard(input: CardPlacementInput): CardPlacement {
  const { hole, cardH, layer, insets, keyboardH, wide } = input;
  const width = cardWidth(layer.w, wide);
  const minX = CARD_GUTTER;
  const maxX = layer.w - CARD_GUTTER - width;
  const holeCx = hole.x + hole.w / 2;
  const x = clamp(holeCx - width / 2, minX, maxX);

  const topBound = insets.top;
  // With the keyboard up its top edge is the floor; the safe-area inset sits
  // under the keyboard and no longer applies.
  const floor = keyboardH > 0 ? layer.h - keyboardH : layer.h - insets.bottom;
  const docked: CardPlacement = { x, y: topBound + 8, width, side: 'top', caretX: null };

  const layerArea = Math.max(1, layer.w * layer.h);
  if ((hole.w * hole.h) / layerArea > DOCK_HOLE_SHARE) return docked;

  const belowY = hole.y + hole.h + CARD_GAP;
  const aboveY = hole.y - CARD_GAP - cardH;
  const fitsBelow = belowY + cardH <= floor;
  const fitsAbove = aboveY >= topBound;
  const usableH = Math.max(1, floor - topBound);
  const preferBelow = (hole.y + hole.h / 2 - topBound) / usableH < BELOW_THRESHOLD;

  const caret = (cx: number) => clamp(holeCx - cx, 20, width - 20);
  if (preferBelow && fitsBelow) return { x, y: belowY, width, side: 'below', caretX: caret(x) };
  if (!preferBelow && fitsAbove) return { x, y: aboveY, width, side: 'above', caretX: caret(x) };
  if (fitsBelow) return { x, y: belowY, width, side: 'below', caretX: caret(x) };
  if (fitsAbove) return { x, y: aboveY, width, side: 'above', caretX: caret(x) };
  return docked;
}

/** The fingertip point: the hole centre plus the hand offset for 'tap', or the
 *  normalized point inside the TARGET for 'tap-point' (the Kitchen label on
 *  the sample plan). Always clamped inside the hole. */
export function handPoint(hole: Rect, gesture: Gesture, target?: Rect | null, point?: { x: number; y: number } | null): { x: number; y: number } {
  let px: number;
  let py: number;
  if (gesture === 'tap-point' && target && point) {
    px = target.x + clamp(point.x, 0, 1) * target.w;
    py = target.y + clamp(point.y, 0, 1) * target.h;
  } else {
    px = hole.x + hole.w / 2 + HAND_OFFSET.x;
    py = hole.y + hole.h / 2 + HAND_OFFSET.y;
  }
  const inset = Math.min(HAND_INSET, hole.w / 2, hole.h / 2);
  return {
    x: clamp(px, hole.x + inset, hole.x + hole.w - inset),
    y: clamp(py, hole.y + inset, hole.y + hole.h - inset),
  };
}

/** Is `rect` fully inside `area` inset by `margin`? When not, which way the
 *  content must scroll to bring it in ('down' = the target is below). Used for
 *  scroll-into-view on step entry (margin SCROLL_MARGIN). */
export function rectVisibleIn(rect: Rect, area: Rect, margin: number = 0): { visible: boolean; scroll: 'up' | 'down' | null } {
  const top = area.y + margin;
  const bottom = area.y + area.h - margin;
  const left = area.x;
  const right = area.x + area.w;
  const inside = rect.y >= top && rect.y + rect.h <= bottom && rect.x >= left && rect.x + rect.w <= right;
  if (inside) return { visible: true, scroll: null };
  if (rect.y < top) return { visible: false, scroll: 'up' };
  if (rect.y + rect.h > bottom) return { visible: false, scroll: 'down' };
  return { visible: false, scroll: null };
}

/** Native scroll target for bringing `rect` (in scroll-content coordinates)
 *  into view: 35 % down the viewport, never negative. */
export function scrollOffsetFor(rectYInContent: number, viewportH: number): number {
  return Math.max(0, Math.round(rectYInContent - 0.35 * viewportH));
}
