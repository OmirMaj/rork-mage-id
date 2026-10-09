// utils/livingModel/planView.ts — fitting a floor of rooms into a box on the screen (pure).
import { GRID_LINE_M } from './modelCore';
import type { Bounds } from './types';

export interface PlanView {
  /** Pixels per metre. */
  scale: number;
  /** The metre position drawn at pixel 0, 0. */
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** A view that shows the bounds with `padM` of floor round them, centred. An empty model gets a room-sized patch of floor. */
export function fitPlanView(bounds: Bounds | null, width: number, height: number, padM: number = 1): PlanView {
  const b = bounds ?? { minX: 0, minY: 0, maxX: 6, maxY: 4.5 };
  const w = Math.max(1, b.maxX - b.minX) + padM * 2;
  const h = Math.max(1, b.maxY - b.minY) + padM * 2;
  const scale = Math.max(1, Math.min(width / w, height / h));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { scale, originX: cx - width / scale / 2, originY: cy - height / scale / 2, width, height };
}

export const toPx = (v: PlanView, p: { x: number; y: number }): { x: number; y: number } => ({ x: (p.x - v.originX) * v.scale, y: (p.y - v.originY) * v.scale });
export const toMetres = (v: PlanView, px: { x: number; y: number }): { x: number; y: number } => ({ x: px.x / v.scale + v.originX, y: px.y / v.scale + v.originY });

/** Grid lines to draw, in pixels: every foot when there is room for it, else every 2, 5 or 10 feet. */
export function gridLines(v: PlanView): { xs: number[]; ys: number[]; stepM: number } {
  let stepM = GRID_LINE_M;
  for (const k of [1, 2, 5, 10, 20]) {
    stepM = GRID_LINE_M * k;
    if (stepM * v.scale >= 9) break;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const x0 = Math.ceil(v.originX / stepM) * stepM;
  const y0 = Math.ceil(v.originY / stepM) * stepM;
  for (let x = x0, i = 0; (x - v.originX) * v.scale <= v.width && i < 400; x += stepM, i++) xs.push((x - v.originX) * v.scale);
  for (let y = y0, i = 0; (y - v.originY) * v.scale <= v.height && i < 400; y += stepM, i++) ys.push((y - v.originY) * v.scale);
  return { xs, ys, stepM };
}
