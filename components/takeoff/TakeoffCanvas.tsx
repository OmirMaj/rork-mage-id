// components/takeoff/TakeoffCanvas.tsx — the desktop takeoff's drawing
// surface (wave 4, lane T2): the sheet on a white "paper", real zoom/pan, the
// shapes in their condition colours, a floating tool strip, a zoom control and
// a status line. Desktop web only (TakeoffWorkspace mounts it).
//
// THE TRANSFORM (utils/takeoff/viewTransform — T1's one equation). The paper
// View sits at (paper.left, paper.top), fitRect's contain-fit of the sheet at
// scale 1, and carries `translate(tx, ty) scale(scale)` with transform-origin
// 0 0. The image and ONE react-native-svg overlay live inside it in paper
// coordinates, so the shapes ride the transform; stroke widths are divided by
// the scale so a line stays 2–3 px on screen at any zoom.
//
// INPUT. Native DOM listeners on the canvas node (react-native-web hands the
// ref back as the HTMLElement), NOT the RN responder system: 'wheel' is
// registered { passive: false } so it can preventDefault the page's own
// scroll/zoom, and a middle-button / Space / Pan-tool drag pans. Coordinates
// are clientX/Y minus the node's bounding rect. Every listener is removed on
// unmount. Native: none of this attaches (the workspace never renders there).
//
// VERTEX DRAG (list-3 lane TK-a). With Select on and a measurement selected,
// a left press within 7 px of one of ITS vertices (hitVertex, checked BEFORE
// hitShape) drags that point. The move is a LOCAL preview (dragPreview) drawn
// in place of the stored point; only the release writes, through ONE
// onMoveVertex call (one undo entry). A release off the sheet, or Esc during
// the drag, cancels and writes nothing. Shift snaps to 0/45/90° against the
// previous vertex. The Esc listener is a window CAPTURE listener that stops
// the key while a drag is live, so the page's Esc (clear the selection) does
// not also fire.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polygon, Polyline } from 'react-native-svg';
import { Hand, Hash, Minus, MousePointer2, Ruler, Square } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { isTypingTarget } from '@/hooks/useHotkeys';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { centroid, type NormPoint } from '@/utils/takeoffGeometry';
import {
  canvasToNorm, hitVertex, normToCanvas, panBy, snap45, zoomAt,
  type PaperRect, type ViewT,
} from '@/utils/takeoff/viewTransform';
import type { ConditionKind } from '@/utils/takeoff/conditions';

export type TakeoffTool = 'select' | 'pan' | 'area' | 'linear' | 'count' | 'scale';

export interface CanvasShape {
  id: string;
  /** The condition it measures — hovering that condition's row thickens it. */
  conditionId: string;
  kind: ConditionKind;
  points: NormPoint[];
  color: string;
  /** Quantity chip text at the centroid (shown only when zoomed in enough). */
  label: string | null;
}

export interface TakeoffCanvasProps {
  uri: string | null;
  paper: PaperRect | null;
  aspect: number | null;
  view: ViewT;
  onView: React.Dispatch<React.SetStateAction<ViewT>>;
  onCanvasSize: (size: { w: number; h: number }) => void;
  shapes: CanvasShape[];
  /** The in-progress shape (area/linear), or the scale's first point. */
  draft: { kind: ConditionKind | 'scale'; points: NormPoint[]; color: string } | null;
  selectedId: string | null;
  /** The condition whose panel row is hovered: its shapes draw as `selected` draws. null = none. */
  emphasisConditionId: string | null;
  tool: TakeoffTool;
  onTool: (t: TakeoffTool) => void;
  /** Why the drawing tools are off (reading the sheet size / couldn't), or null. */
  toolsOffReason: string | null;
  /** Area/linear on a sheet with no usable scale: the non-modal strip. */
  showScaleStrip: boolean;
  grayscale: boolean;
  statusLine: string;
  onAddPoint: (p: NormPoint) => void;
  onFinish: () => void;
  onSelect: (id: string | null) => void;
  /** A vertex drag was released on the sheet: called ONCE per drag (one undo entry). */
  onMoveVertex: (id: string, index: number, point: NormPoint) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

const TOOLS: { tool: TakeoffTool; key: string; label: string; Icon: typeof Square }[] = [
  { tool: 'select', key: 'V', label: 'Select', Icon: MousePointer2 },
  { tool: 'pan', key: 'H', label: 'Pan', Icon: Hand },
  { tool: 'area', key: 'A', label: 'Area', Icon: Square },
  { tool: 'linear', key: 'L', label: 'Linear', Icon: Minus },
  { tool: 'count', key: 'C', label: 'Count', Icon: Hash },
  { tool: 'scale', key: 'K', label: 'Scale', Icon: Ruler },
];

const DRAW_TOOLS: readonly TakeoffTool[] = ['area', 'linear', 'count', 'scale'];

const pointsAttr = (pts: NormPoint[], paper: PaperRect) =>
  pts.map((p) => `${p.x * paper.w},${p.y * paper.h}`).join(' ');

/** Distance from p to segment ab (canvas px). */
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  const qx = a.x + u * dx - p.x;
  const qy = a.y + u * dy - p.y;
  return Math.sqrt(qx * qx + qy * qy);
}

function inside(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** The shape under a canvas point: counts and edges within 6 px, else an area's inside. */
export function hitShape(shapes: CanvasShape[], view: ViewT, paper: PaperRect, x: number, y: number): string | null {
  const p = { x, y };
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const c = s.points.map((q) => normToCanvas(view, paper, q));
    if (s.kind === 'count') {
      if (c.some((q) => Math.hypot(q.x - x, q.y - y) <= 8)) return s.id;
      continue;
    }
    const segs = s.kind === 'area' ? [...c, c[0]] : c;
    for (let k = 0; k + 1 < segs.length; k++) if (segDist(p, segs[k], segs[k + 1]) <= 6) return s.id;
    if (s.kind === 'area' && c.length >= 3 && inside(p, c)) return s.id;
  }
  return null;
}

/** A vertex drag in progress: the shape, the vertex, and where it would land. */
export type DragPreview = { id: string; index: number; point: NormPoint };

/** The shape's points with the dragged vertex replaced (the stored points otherwise). */
export function previewPoints(s: CanvasShape, drag: DragPreview | null): NormPoint[] {
  if (!drag || drag.id !== s.id || drag.index < 0 || drag.index >= s.points.length) return s.points;
  return s.points.map((q, i) => (i === drag.index ? drag.point : q));
}

export default function TakeoffCanvas(props: TakeoffCanvasProps) {
  const { colors: t, resolved } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { uri, paper, view, shapes, draft, selectedId, tool, toolsOffReason, emphasisConditionId } = props;
  const nodeRef = useRef<View>(null);
  const live = useRef(props);
  live.current = props;
  const [hover, setHover] = useState<NormPoint | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [overHandle, setOverHandle] = useState(false);
  const fillAlpha = resolved === 'dark' ? '4D' : '38';

  // ── native DOM listeners (web) ─────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const node = nodeRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return undefined;
    let space = false;
    let drag: { x: number; y: number } | null = null;
    // The vertex drag (see VERTEX DRAG above): the stored points at press time, the
    // vertex, and the preview point (null until the pointer has moved onto the sheet).
    let vdrag: { id: string; index: number; points: NormPoint[]; point: NormPoint | null } | null = null;
    let handleHover = false;
    const local = (e: MouseEvent | WheelEvent) => {
      const r = node.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const selectedShape = (p: TakeoffCanvasProps) =>
      (p.tool === 'select' && p.selectedId && !p.toolsOffReason ? p.shapes.find((s) => s.id === p.selectedId) ?? null : null);
    /** The pointer's sheet point for a vertex drag: canvasToNorm, Shift-snapped against the previous vertex. */
    const dragPoint = (p: TakeoffCanvasProps, e: MouseEvent): NormPoint | null => {
      if (!vdrag || !p.paper) return null;
      const { x, y } = local(e);
      let n = canvasToNorm(p.view, p.paper, x, y);
      if (n && e.shiftKey && p.aspect && vdrag.index > 0) n = snap45(vdrag.points[vdrag.index - 1], n, p.aspect);
      return n;
    };
    const endVertexDrag = () => {
      vdrag = null;
      setDragPreview(null);
    };

    const onWheel = (e: WheelEvent) => {
      const p = live.current;
      e.preventDefault();
      const { x, y } = local(e);
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        p.onView((v) => zoomAt(v, factor, x, y, p.paper ?? undefined));
      } else {
        p.onView((v) => panBy(v, -e.deltaX, -e.deltaY));
      }
    };

    // A press on the tool strip / zoom control is that button's, not a vertex.
    const onControl = (e: Event) => {
      const el = e.target as { closest?: (sel: string) => unknown } | null;
      return typeof el?.closest === 'function' && !!el.closest('[role="button"]');
    };

    const onDown = (e: MouseEvent) => {
      const p = live.current;
      if (onControl(e)) return;
      if (e.button === 1 || (e.button === 0 && (space || p.tool === 'pan'))) {
        e.preventDefault();
        drag = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button !== 0 || !p.paper) return;
      const { x, y } = local(e);
      if (p.tool === 'select') {
        // A handle of the selected shape wins over picking another shape.
        const sel = selectedShape(p);
        const idx = sel ? hitVertex(sel.points, p.view, p.paper, x, y, 7) : -1;
        if (sel && idx >= 0) {
          e.preventDefault();
          vdrag = { id: sel.id, index: idx, points: sel.points, point: null };
          setDragPreview({ id: sel.id, index: idx, point: sel.points[idx] });
          return;
        }
        p.onSelect(hitShape(p.shapes, p.view, p.paper, x, y));
        return;
      }
      if (!DRAW_TOOLS.includes(p.tool) || p.toolsOffReason) return;
      // A count is placed on the first press; a double-click's second press
      // (detail ≥ 2) must not drop a second EA on the same spot.
      if (p.tool === 'count' && e.detail >= 2) return;
      let n = canvasToNorm(p.view, p.paper, x, y);
      if (!n) return; // outside the sheet: nothing honest to mean
      const last = p.draft?.points[p.draft.points.length - 1];
      if (last) {
        // A double-click's second press lands on the same spot: not a vertex.
        const lc = normToCanvas(p.view, p.paper, last);
        if (Math.hypot(lc.x - x, lc.y - y) < 3) return;
        if (e.shiftKey && p.aspect) n = snap45(last, n, p.aspect);
      }
      p.onAddPoint(n);
    };

    const onMove = (e: MouseEvent) => {
      const p = live.current;
      if (vdrag) {
        const n = dragPoint(p, e);
        // Off the sheet: the preview holds its last point; a release there cancels.
        if (n) {
          vdrag.point = n;
          const cur = vdrag;
          setDragPreview({ id: cur.id, index: cur.index, point: n });
        }
        return;
      }
      // The 'move' cursor over a handle of the selected shape.
      const sel = selectedShape(p);
      let onHandle = false;
      if (sel && p.paper) {
        const { x, y } = local(e);
        onHandle = hitVertex(sel.points, p.view, p.paper, x, y, 7) >= 0;
      }
      if (onHandle !== handleHover) { handleHover = onHandle; setOverHandle(onHandle); }
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag = { x: e.clientX, y: e.clientY };
        p.onView((v) => panBy(v, dx, dy));
        return;
      }
      if (p.draft && p.draft.points.length > 0 && p.paper) {
        const { x, y } = local(e);
        let n = canvasToNorm(p.view, p.paper, x, y);
        const last = p.draft.points[p.draft.points.length - 1];
        if (n && e.shiftKey && p.aspect) n = snap45(last, n, p.aspect);
        setHover(n);
      }
    };
    const onUp = (e: MouseEvent) => {
      drag = null;
      if (!vdrag) return;
      const cur = vdrag;
      const n = dragPoint(live.current, e);
      endVertexDrag();
      // Released off the sheet → cancelled. Never moved → nothing to write.
      if (!n || !cur.point) return;
      const was = cur.points[cur.index];
      if (was && was.x === n.x && was.y === n.y) return;
      live.current.onMoveVertex(cur.id, cur.index, n);
    };
    // Esc during a vertex drag cancels it — and only it (capture + stop, so the
    // page's Esc does not also clear the selection).
    const onEscCapture = (e: KeyboardEvent) => {
      if (!vdrag || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      endVertexDrag();
    };
    const onDbl = (e: MouseEvent) => { if (onControl(e)) return; e.preventDefault(); live.current.onFinish(); };
    const onContext = (e: MouseEvent) => { if (live.current.draft) e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || isTypingTarget(e.target)) return;
      space = e.type === 'keydown';
      if (!space) drag = null;
      // Keep the page from scrolling, but never steal Space from a focused button.
      const tgt = e.target as Node | null;
      if (tgt === document.body || (tgt && node.contains(tgt) && !onControl(e))) e.preventDefault();
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('mousedown', onDown);
    node.addEventListener('dblclick', onDbl);
    node.addEventListener('contextmenu', onContext);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('keydown', onEscCapture, true);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('mousedown', onDown);
      node.removeEventListener('dblclick', onDbl);
      node.removeEventListener('contextmenu', onContext);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('keydown', onEscCapture, true);
    };
  }, []);

  // No draft → no rubber band.
  const drafting = !!draft && draft.points.length > 0;
  useEffect(() => { if (!drafting) setHover(null); }, [drafting]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    props.onCanvasSize({ w: width, h: height });
  };

  // Shape strings are memoised per sheet/paper size; the zoom only changes stroke widths.
  const shapeAttrs = useMemo(
    () => (paper ? shapes.map((s) => ({ s, pts: pointsAttr(s.points, paper) })) : []),
    [shapes, paper],
  );

  const k = view.scale > 0 ? view.scale : 1;
  const cursor = dragPreview || (tool === 'select' && overHandle && selectedId)
    ? 'move'
    : tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : toolsOffReason ? 'not-allowed' : 'crosshair';
  // Selected, or its condition's row is hovered: drawn thicker.
  const thick = (s: CanvasShape) => s.id === selectedId || (emphasisConditionId != null && s.conditionId === emphasisConditionId);
  const statusText = dragPreview
    ? `Moving point ${dragPreview.index + 1} · release to place · Esc cancels`
    : props.statusLine;

  return (
    <View ref={nodeRef} style={[styles.canvas, { cursor } as object]} onLayout={onLayout} testID="takeoffws-canvas">
      {paper && uri ? (
        <View
          style={[
            styles.paper,
            {
              left: paper.left,
              top: paper.top,
              width: paper.w,
              height: paper.h,
              transform: [{ translateX: view.tx }, { translateY: view.ty }, { scale: view.scale }],
              transformOrigin: '0 0',
            },
          ]}
          testID="takeoffws-paper"
        >
          <Image
            source={{ uri }}
            style={[styles.image, props.grayscale && WEB_GRAYSCALE]}
            resizeMode="stretch"
            testID="takeoffws-sheet-image"
          />
          <Svg style={StyleSheet.absoluteFill} width={paper.w} height={paper.h}>
            {shapeAttrs.map(({ s, pts: stored }) => {
              const sel = thick(s);
              const dragged = dragPreview?.id === s.id;
              const livePts = dragged ? previewPoints(s, dragPreview) : s.points;
              const pts = dragged ? pointsAttr(livePts, paper) : stored;
              if (s.kind === 'area') {
                return <Polygon key={s.id} points={pts} fill={s.color + fillAlpha} stroke={s.color} strokeWidth={(sel ? 3.5 : 2) / k} />;
              }
              if (s.kind === 'linear') {
                return <Polyline key={s.id} points={pts} fill="none" stroke={s.color} strokeWidth={(sel ? 4.5 : 3) / k} strokeLinecap="round" strokeLinejoin="round" />;
              }
              return (
                <React.Fragment key={s.id}>
                  {livePts.map((q, i) => (
                    <Circle key={i} cx={q.x * paper.w} cy={q.y * paper.h} r={(sel ? 7 : 5) / k} fill={s.color} stroke={t.surface} strokeWidth={1.5 / k} />
                  ))}
                </React.Fragment>
              );
            })}
            {selectedId ? shapes.filter((s) => s.id === selectedId && s.kind !== 'count').flatMap((s) => previewPoints(s, dragPreview).map((q, i) => (
              <Circle key={`h-${s.id}-${i}`} cx={q.x * paper.w} cy={q.y * paper.h} r={3 / k} fill={t.surface} stroke={s.color} strokeWidth={1.5 / k} />
            ))) : null}
            {draft && draft.points.length > 0 ? (
              <>
                <Polyline
                  points={pointsAttr(hover ? [...draft.points, hover] : draft.points, paper)}
                  fill={draft.kind === 'area' ? draft.color + fillAlpha : 'none'}
                  stroke={draft.color}
                  strokeWidth={2 / k}
                  strokeDasharray={`${6 / k},${4 / k}`}
                  strokeLinecap="round"
                />
                {draft.points.map((q, i) => (
                  <Circle key={`d-${i}`} cx={q.x * paper.w} cy={q.y * paper.h} r={3 / k} fill={draft.color} />
                ))}
              </>
            ) : null}
          </Svg>
        </View>
      ) : null}

      {/* Quantity chips at each shape's centroid, in canvas space (so the text never scales). */}
      {paper && view.scale >= 0.6 ? shapes.map((s) => {
        if (!s.label || s.kind === 'count') return null;
        const c = normToCanvas(view, paper, centroid(previewPoints(s, dragPreview)));
        return (
          <View key={`l-${s.id}`} pointerEvents="none" style={[styles.chip, { left: c.x, top: c.y }]}>
            <Text style={styles.chipText} numberOfLines={1}>{s.label}</Text>
          </View>
        );
      }) : null}

      {props.showScaleStrip ? (
        <View style={styles.strip} pointerEvents="none" testID="takeoffws-scale-strip">
          <Text style={styles.stripText}>Set the scale first — press K, click both ends of a known dimension, type the length.</Text>
        </View>
      ) : null}

      <View style={styles.tools} testID="takeoffws-tools">
        {TOOLS.map(({ tool: tt, key, label, Icon }) => {
          const on = tt === tool;
          const off = !!toolsOffReason && DRAW_TOOLS.includes(tt);
          return (
            <Pressable
              key={tt}
              onPress={() => props.onTool(tt)}
              disabled={off}
              style={[styles.toolBtn, on && styles.toolBtnOn, off && styles.toolOff]}
              accessibilityRole="button"
              accessibilityLabel={`${label} (${key})`}
              accessibilityHint={off ? toolsOffReason ?? undefined : undefined}
              accessibilityState={{ selected: on, disabled: off }}
              testID={`takeoffws-tool-${tt}`}
            >
              <Icon size={16} color={on ? t.text : t.textMuted} strokeWidth={1.75} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.zoom} testID="takeoffws-zoom">
        <Pressable onPress={props.onZoomOut} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom out (-)">
          <Text style={styles.zoomText}>−</Text>
        </Pressable>
        <Text style={styles.zoomPct} testID="takeoffws-zoom-pct">{`${Math.round(view.scale * 100)}%`}</Text>
        <Pressable onPress={props.onZoomIn} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom in (+)">
          <Text style={styles.zoomText}>+</Text>
        </Pressable>
        <Pressable onPress={props.onFit} style={styles.fitBtn} accessibilityRole="button" accessibilityLabel="Fit (0)">
          <Text style={styles.zoomText}>Fit</Text>
        </Pressable>
      </View>

      <View style={styles.status} pointerEvents="none">
        <Text style={styles.statusText} numberOfLines={1} testID="takeoffws-status">{toolsOffReason ?? statusText}</Text>
      </View>
    </View>
  );
}

const WEB_GRAYSCALE = { filter: 'grayscale(1) contrast(1.05)' } as unknown as import('react-native').ImageStyle;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  canvas: { flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: t.surfaceAlt },
  paper: { position: 'absolute', backgroundColor: '#FFFFFF' },
  image: { width: '100%', height: '100%' },
  chip: {
    position: 'absolute',
    transform: [{ translateX: -40 }, { translateY: -10 }],
    width: 80,
    alignItems: 'center',
  },
  chipText: {
    ...Type.caption2,
    fontWeight: '700',
    color: t.text,
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.xs,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  strip: {
    position: 'absolute',
    top: 12,
    left: 12 + 40 + 12,
    right: 12,
    alignItems: 'center',
  },
  stripText: {
    ...Type.caption1,
    color: t.warningLabel,
    backgroundColor: t.warningSoft,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  tools: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 40,
    paddingVertical: 4,
    alignItems: 'center',
    gap: 2,
    backgroundColor: t.bg,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.md,
  },
  toolBtn: {
    width: Layout.control.sm,
    height: Layout.control.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Tokens.radius.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  toolBtnOn: { backgroundColor: t.surfaceAlt, borderLeftColor: t.accent },
  toolOff: { opacity: 0.35 },
  zoom: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    height: Layout.control.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.bg,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    overflow: 'hidden',
  },
  zoomBtn: { width: Layout.control.sm, height: Layout.control.sm, alignItems: 'center', justifyContent: 'center' },
  fitBtn: { height: Layout.control.sm, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: t.line },
  zoomText: { ...Type.footnote, color: t.textSecondary },
  zoomPct: { ...Type.caption1, color: t.text, width: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
  status: { position: 'absolute', left: 12, bottom: 12, right: 220 },
  statusText: {
    ...Type.caption1,
    color: t.textSecondary,
    alignSelf: 'flex-start',
    backgroundColor: t.bg,
    borderRadius: Tokens.radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
});
