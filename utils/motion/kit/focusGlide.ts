// focusGlide.ts — the gliding marker (Status Focus Sidebar), pure (imports ./kitSpec only).
//
// components/ui/SegmentedControl.tsx's recipe on either axis: the marker's two
// edges run on separate springs (the leading edge on glideLead, the trailing
// on glideTrail) and a view w0 long is centred at (L + R) / 2 and scaled to
// R − L. At rest there is no marker: the active item paints its own fill.

import { KIT_SPRING, type KitSpring } from './kitSpec';

export type KitRect = { x: number; y: number; w: number; h: number };
export type FocusAxis = 'x' | 'y';

export type FocusGlide = {
  from: KitRect;
  to: KitRect;
  axis: FocusAxis;
  /** Moving right (x) or down (y). */
  forward: boolean;
  /** The low edge's and the high edge's springs. */
  lowSpring: KitSpring;
  highSpring: KitSpring;
};

const ok = (r: KitRect | undefined | null): r is KitRect =>
  !!r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n)) && r.w > 0 && r.h > 0;

/** Moving forward, the high edge leads and the low edge trails; backward, the reverse. */
export function edgeSprings(forward: boolean): { lowSpring: KitSpring; highSpring: KitSpring } {
  return forward
    ? { lowSpring: KIT_SPRING.glideTrail, highSpring: KIT_SPRING.glideLead }
    : { lowSpring: KIT_SPRING.glideLead, highSpring: KIT_SPRING.glideTrail };
}

/**
 * The glide for a change of the active item, or null for today's instant swap:
 * Reduce Motion, an unmeasured or zero-size item, or the two items in different
 * columns (axis y) / rows (axis x).
 */
export function planFocusGlide(from: KitRect | undefined | null, to: KitRect | undefined | null, axis: FocusAxis, reduced: boolean): FocusGlide | null {
  if (reduced || !ok(from) || !ok(to)) return null;
  if (axis === 'y' ? from.x !== to.x : from.y !== to.y) return null;
  const forward = axis === 'y' ? to.y > from.y : to.x > from.x;
  return { from, to, axis, forward, ...edgeSprings(forward) };
}

/** A view w0 long, centred on [L, R]: translate = (L+R)/2 − w0/2, scale = (R−L)/w0. */
export function edgeTransform(L: number, R: number, w0: number): { translate: number; scale: number } {
  if (!(w0 > 0)) return { translate: L, scale: 1 };
  return { translate: (L + R) / 2 - w0 / 2, scale: (R - L) / w0 };
}

/** The low / high edge positions of a rect along the axis. */
export function edgesOf(r: KitRect, axis: FocusAxis): { low: number; high: number } {
  return axis === 'y' ? { low: r.y, high: r.y + r.h } : { low: r.x, high: r.x + r.w };
}
