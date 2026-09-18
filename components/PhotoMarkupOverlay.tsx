// components/PhotoMarkupOverlay.tsx
//
// Draws a photo's saved markup — the arrows, circles, freehand strokes and
// text labels from app/photo-annotator.tsx — over whatever is rendering the
// photo underneath.
//
// WHY it lives here rather than inside one screen: the markup IS the question.
// A GC circles a duct clashing with a beam and writes "conflict here", then
// sends the photo to an RFI or the punch list — and until this component was
// shared, only the project-detail lightbox could draw it. Everywhere else the
// architect and the sub saw a plain ceiling photo and had to ask which
// conflict, which turned a 3-day RFI into a 6-day one (audit 2026-09-17 #12).
//
// Coordinates are normalized 0..1 (the annotator's contract), so the overlay
// measures its own box on layout and scales to it — one saved markup is correct
// at any size.
//
// THE FRAME MATTERS. app/photo-annotator.tsx draws on a SQUARE canvas
// (styles.canvas: aspectRatio 1) showing the photo with contentFit="cover", and
// normalizes every point against that square. So this overlay is faithful only
// over a square box rendering the same photo with cover. Put it over a
// letterboxed `contain` view of a non-square photo and the circle lands beside
// the thing it was drawn around — a mark in the wrong place is worse than no
// mark. So a caller either gives this component a square cover frame, or uses
// ContainedPhotoMarkupOverlay below, which works out where that square landed
// inside a letterboxed photo and draws there. (The durable fix is to flatten
// the markup into the image on save, which needs a native screenshot module
// this app does not ship and cannot add over OTA.)

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Image as RNImage } from 'react-native';
import Svg, {
  Circle as SvgCircle,
  Line as SvgLine,
  Path as SvgPath,
  Polygon as SvgPolygon,
  Text as SvgTextEl,
} from 'react-native-svg';

import { useTheme } from '@/contexts/ThemeContext';
import type { PhotoMarkup, ProjectPhoto } from '@/types';

/** The annotator's three pen colours. Kept in step with the palette in
 *  app/photo-annotator.tsx — a drawing that changes colour between the screen
 *  it was drawn on and the screen it is read on reads as a different mark. */
const COLOR_HEX_MARKUP: Record<'red' | 'yellow' | 'green', string> = {
  red:    '#E5484D',
  yellow: '#F5A623',
  green:  '#1E8E4A',
};

/**
 * Find the ProjectPhoto a copied URI came from.
 *
 * RFI attachments and punch items store a URI, not a photo id (see the handoff
 * in the audit note), and per ProjectPhoto.uri that URI is either a device-local
 * `file://` path or a short-lived signed URL. So match on every form the same
 * photo can be carrying: what it renders as now, its device-local original, and
 * its durable bucket path.
 */
export function photoForUri(
  photos: ProjectPhoto[] | undefined,
  uri: string | undefined,
): ProjectPhoto | undefined {
  if (!uri) return undefined;
  return (photos ?? []).find(
    p => p.uri === uri || p.localUri === uri || p.storagePath === uri,
  );
}

/** The markup a copied URI should still be drawn with, or [] when there is
 *  none — callers can render unconditionally and get nothing when there is
 *  nothing to draw. */
export function markupForUri(
  photos: ProjectPhoto[] | undefined,
  uri: string | undefined,
): PhotoMarkup[] {
  const markup = photoForUri(photos, uri)?.markup;
  return Array.isArray(markup) ? markup : [];
}

/**
 * The gallery photo a punch item or RFI was raised from, if the record kept its
 * id (PunchItem / RFI `sourcePhotoId`, column `source_photo_id`, migration
 * 20260917180000). Read defensively: records written before it exist without
 * one, and those fall back to the URI match.
 */
export function sourcePhotoIdOf(record: unknown): string | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const id = (record as { sourcePhotoId?: unknown }).sourcePhotoId;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * The markup for a photo that was carried onto a punch item or RFI — by the
 * source photo's ID first, the copied URI only as a fallback.
 *
 * Why the id has to win: the URI match only holds on the device that took the
 * photo. A punch photo is re-uploaded under `punch-<itemId>` and comes back to
 * every other device as a signed URL for THAT object; an RFI attachment is a
 * `file://` path or a signed URL re-minted every session. Neither ever equals
 * the source photo's uri / localUri / storagePath on the office device, on web,
 * or for the sub — so a URI-only lookup drew the plain photo there and the
 * circle around the clash silently vanished (audit 2026-09-17 #12, review 2).
 */
export function markupForSource(
  photos: ProjectPhoto[] | undefined,
  sourcePhotoId: string | undefined,
  uri: string | undefined,
): PhotoMarkup[] {
  if (sourcePhotoId) {
    const byId = (photos ?? []).find(p => p.id === sourcePhotoId)?.markup;
    if (Array.isArray(byId)) return byId;
  }
  return markupForUri(photos, uri);
}

/**
 * Where a square, cover-normalized markup belongs inside a box that is showing
 * the WHOLE photo letterboxed (`resizeMode="contain"`).
 *
 * The full-screen views are the ones that matter — a sub arguing "that's not my
 * scope" is looking at the big picture, not a 44pt thumbnail — but they show
 * the whole frame, while the annotator drew on a centred SQUARE CROP of it. So
 * the marks do not cover the box; they cover the part of the letterboxed image
 * that the annotator's canvas was showing. Two steps:
 *
 *   1. `contain` fits the image: scale = min(bw/iw, bh/ih), centred.
 *   2. the annotator's canvas was the centred square crop of that image, which
 *      at the same scale is a square of side min(iw, ih) * scale, centred on
 *      the same point.
 *
 * Returns undefined when either size is not yet known or is degenerate —
 * callers then draw nothing, because a mark in the wrong place is worse than
 * no mark.
 */
export function containedMarkupFrame(
  box: { width: number; height: number },
  image: { width: number; height: number },
): { left: number; top: number; size: number } | undefined {
  const { width: bw, height: bh } = box;
  const { width: iw, height: ih } = image;
  if (!(bw > 0 && bh > 0 && iw > 0 && ih > 0)) return undefined;
  if (![bw, bh, iw, ih].every(Number.isFinite)) return undefined;
  const scale = Math.min(bw / iw, bh / ih);
  const size = Math.min(iw, ih) * scale;
  return {
    left: (bw - size) / 2,
    top: (bh - size) / 2,
    size,
  };
}

export function PhotoMarkupOverlay({ markup }: { markup: PhotoMarkup[] }) {
  const { colors: themeColors } = useTheme();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Defensive: a photo persisted before markup support, or a partial AI tool
  // failure, can leave `markup` undefined. Treat non-array as empty.
  const safeMarkup = Array.isArray(markup) ? markup : [];
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size.w > 0 && size.h > 0 && (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          {safeMarkup.map((m, i) => {
            const stroke = COLOR_HEX_MARKUP[m.color];
            const w = size.w;
            const h = size.h;
            if (m.type === 'arrow') {
              const [p1, p2] = m.points;
              if (!p1 || !p2) return null;
              const x1 = p1.x * w, y1 = p1.y * h, x2 = p2.x * w, y2 = p2.y * h;
              const dx = x2 - x1, dy = y2 - y1;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / len, uy = dy / len;
              const head = 14;
              const left = `${x2 - ux * head + uy * head / 2},${y2 - uy * head - ux * head / 2}`;
              const right = `${x2 - ux * head - uy * head / 2},${y2 - uy * head + ux * head / 2}`;
              return (
                <React.Fragment key={`a-${i}`}>
                  <SvgLine x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
                  <SvgPolygon points={`${x2},${y2} ${left} ${right}`} fill={stroke} />
                </React.Fragment>
              );
            }
            if (m.type === 'circle') {
              const [p1, p2] = m.points;
              if (!p1 || !p2) return null;
              const cx = (p1.x + p2.x) / 2 * w;
              const cy = (p1.y + p2.y) / 2 * h;
              const r = Math.sqrt((p2.x - p1.x) ** 2 * w * w + (p2.y - p1.y) ** 2 * h * h) / 2;
              return <SvgCircle key={`c-${i}`} cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={3} fill="none" />;
            }
            if (m.type === 'freehand') {
              const d = m.points
                .map((p, j) => `${j === 0 ? 'M' : 'L'}${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`)
                .join(' ');
              return <SvgPath key={`f-${i}`} d={d} stroke={stroke} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
            }
            if (m.type === 'text' && m.text) {
              const [p] = m.points;
              if (!p) return null;
              const x = p.x * w, y = p.y * h;
              const len = m.text.length * 8 + 16;
              return (
                <React.Fragment key={`t-${i}`}>
                  <SvgPolygon
                    points={`${x},${y - 16} ${x + len},${y - 16} ${x + len},${y + 8} ${x},${y + 8}`}
                    fill={stroke}
                    opacity={0.92}
                  />
                  <SvgTextEl x={x + 8} y={y + 2} fill={themeColors.surface} fontSize={13} fontWeight="700">{m.text}</SvgTextEl>
                </React.Fragment>
              );
            }
            return null;
          })}
        </Svg>
      )}
    </View>
  );
}

/**
 * The same marks, over a photo rendered with `contain`. Measures its own box
 * and asks the platform for the image's intrinsic size; until it has both it
 * draws nothing, and if the image never reports a size (an expired signed URL,
 * a web CORS refusal) it keeps drawing nothing rather than guessing a frame.
 */
export function ContainedPhotoMarkupOverlay({ markup, uri }: {
  markup: PhotoMarkup[];
  uri: string | undefined;
}) {
  const [box, setBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [image, setImage] = useState<{ width: number; height: number } | undefined>(undefined);

  useEffect(() => {
    if (!uri || markup.length === 0) { setImage(undefined); return; }
    let live = true;
    // Cancelled on unmount / URI change: a late callback for the PREVIOUS photo
    // would size this one's frame against the wrong picture.
    RNImage.getSize(
      uri,
      (width, height) => { if (live) setImage({ width, height }); },
      () => { if (live) setImage(undefined); },
    );
    return () => { live = false; };
  }, [uri, markup.length]);

  const frame = image ? containedMarkupFrame(box, image) : undefined;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {!!frame && (
        <View style={{ position: 'absolute', left: frame.left, top: frame.top, width: frame.size, height: frame.size }}>
          <PhotoMarkupOverlay markup={markup} />
        </View>
      )}
    </View>
  );
}

export default PhotoMarkupOverlay;
