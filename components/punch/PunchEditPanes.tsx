// components/punch/PunchEditPanes.tsx — the right-hand 25 % of the punch item
// add/edit panel on a wide web window (utils/punchEditLayout decides when).
//
// Founder, 2026-09-22: "When adding photos to punchlist on the web browser. Why
// not make it like 75% of the screen be the edit item then other 25% is the
// photo so you can visualize." So this pane shows the item's photo LARGE — as
// wide as the pane, with the markup he drew — and owns the photo controls
// (add / replace / remove), with the plan close-up under it when the item is
// pinned. Tapping the photo opens it full size (PunchPhotoViewer); tapping the
// close-up opens the pin step.
//
// The photo is a SQUARE cover frame on purpose: that is the annotator's own
// frame, the one PhotoMarkupOverlay's marks are normalised against. A
// letterboxed photo would put the circle beside the defect (the full-size
// viewer uses the contained overlay for exactly that reason).
//
// Nothing here writes. The screen owns the state and decides what a button may
// do (utils/punchEditLayout.punchPhotoActionBlocked); a blocked button is drawn
// disabled with its reason under it, never hidden.

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, type LayoutChangeEvent } from 'react-native';
import { ImagePlus, ImageOff, MapPin, Maximize2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button, EyebrowLabel } from '@/components/ui';
import { PhotoMarkupOverlay } from '@/components/PhotoMarkupOverlay';
import { pinCropWindow, PIN_MARKER_SIZE } from '@/utils/punchPlanPin';
import { closeUpMarkerPlacement, loadedImageAspect } from '@/utils/punchEditLayout';
import type { PhotoMarkup } from '@/types';

export interface PunchEditPinThumb {
  /** A renderable sheet image (signed URL / local copy). */
  imageUri: string;
  /** Width / height from the sheet record; the loaded image's own shape wins. */
  storedAspect: number | null;
  x: number;
  y: number;
  number: number | null;
  label: string;
}

export interface PunchEditPhotoPaneProps {
  /** The photo in front of him (saved, replaced in this sheet, or the prefill). */
  photoUri: string | undefined;
  markup: PhotoMarkup[];
  /** One line under the photo about what Update will do with it, or null. */
  pendingNote: string | null;
  onOpenPhoto: () => void;
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  /** Why Add / Replace / Remove cannot run, or null when it can. */
  addBlocked: string | null;
  replaceBlocked: string | null;
  removeBlocked: string | null;
  /** The plan close-up, when the item is pinned and its sheet has an image. */
  pin: PunchEditPinThumb | null;
  /** The pin row's words when there is no close-up to draw ("Not pinned yet", …). */
  pinText: string;
  onOpenPin: (() => void) | null;
  pinBlocked: string | null;
}

export function PunchEditPhotoPane(p: PunchEditPhotoPaneProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [paneW, setPaneW] = useState(0);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = p.photoUri && p.photoUri !== failedUri ? p.photoUri : undefined;
  const side = Math.max(0, paneW);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setPaneW(prev => (prev === w ? prev : w));
  };

  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.paneContent} testID="punch-edit-photo-pane">
      <View onLayout={onLayout}>
        <EyebrowLabel>Photo</EyebrowLabel>
        {uri ? (
          <TouchableOpacity
            onPress={p.onOpenPhoto}
            activeOpacity={0.9}
            accessibilityRole="imagebutton"
            accessibilityLabel="Item photo, opens full size"
            testID="punch-edit-photo"
            style={[styles.photo, side > 0 && { width: side, height: side }]}
          >
            <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailedUri(uri)} />
            <PhotoMarkupOverlay markup={p.markup} />
            <View style={styles.expand} pointerEvents="none">
              <Maximize2 size={14} color={Colors.textOnAccent} strokeWidth={2} />
            </View>
          </TouchableOpacity>
        ) : p.photoUri ? (
          // It had a photo and the photo will not load (an expired link, a
          // file on another device). Saying so beats an empty square.
          <View style={[styles.photo, styles.failed, side > 0 && { width: side, height: side }]} testID="punch-edit-photo-failed">
            <ImageOff size={22} color={t.textMuted} strokeWidth={1.75} />
            <Text style={styles.dropHint}>This photo didn’t load. Replace it, or close and reopen the item.</Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={p.addBlocked ? undefined : p.onPickPhoto}
            disabled={!!p.addBlocked}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            accessibilityState={{ disabled: !!p.addBlocked }}
            testID="punch-edit-photo-add"
            style={[styles.photo, styles.drop, side > 0 && { width: side, height: side }]}
          >
            <ImagePlus size={26} color={p.addBlocked ? t.textMuted : t.accentLabel} strokeWidth={1.75} />
            <Text style={[styles.dropTitle, p.addBlocked && { color: t.textMuted }]}>Add photo</Text>
            <Text style={styles.dropHint}>Choose a picture of the defect from this computer.</Text>
          </TouchableOpacity>
        )}
      </View>

      {p.photoUri ? (
        <View style={styles.actions}>
          <Button size="sm" variant="secondary" label="Replace" onPress={p.onPickPhoto} disabled={!!p.replaceBlocked} testID="punch-edit-photo-replace" />
          <Button size="sm" variant="ghost" label="Remove" onPress={p.onRemovePhoto} disabled={!!p.removeBlocked} testID="punch-edit-photo-remove" />
        </View>
      ) : null}
      {p.photoUri && (p.replaceBlocked || p.removeBlocked) ? (
        <Text style={styles.note} testID="punch-edit-photo-blocked">{p.replaceBlocked ?? p.removeBlocked}</Text>
      ) : null}
      {!p.photoUri && p.addBlocked ? <Text style={styles.note}>{p.addBlocked}</Text> : null}
      {p.pendingNote ? <Text style={styles.pending} testID="punch-edit-photo-pending">{p.pendingNote}</Text> : null}

      <View style={styles.planBlock}>
        <EyebrowLabel>On the plan</EyebrowLabel>
        {p.pin && side > 0 ? (
          // Keyed by the sheet image: a pin moved to another sheet (or a sheet
          // that becomes loadable) starts over — not stuck on "didn't load" or
          // drawn with the previous sheet's shape.
          <PinCloseUp key={p.pin.imageUri} pin={p.pin} side={side} onPress={p.onOpenPin} blocked={p.pinBlocked} />
        ) : (
          <View style={styles.pinRow}>
            <MapPin size={14} color={t.textMuted} strokeWidth={2} />
            <Text style={styles.pinText}>{p.pinText}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/** A square close-up of the sheet around the pin — the same window the PDF
 *  prints beside the item (utils/punchPlanPin.pinCropWindow). The loaded
 *  image's own shape wins; the size stored on the sheet stands in until it
 *  loads (the pin step's rule, components/punch/PlanPinStep). With neither,
 *  no window is drawn — one on a guessed aspect would sit the marker beside
 *  the spot — and the pane says the close-up is not available. */
function PinCloseUp({ pin, side, onPress, blocked }: {
  pin: PunchEditPinThumb;
  side: number;
  onPress: (() => void) | null;
  blocked: string | null;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [loadedAspect, setLoadedAspect] = useState<number | null>(null);
  // The image loaded but its shape could not be read (and the sheet has no
  // stored size): no window can be drawn without guessing, so say so instead
  // of leaving an empty white square.
  const [shapeUnknown, setShapeUnknown] = useState(false);
  const [failed, setFailed] = useState(false);
  const aspect = loadedAspect ?? pin.storedAspect;
  const w = aspect ? pinCropWindow(pin.x, pin.y, aspect) : null;
  const mark = w ? closeUpMarkerPlacement(w.pinX, w.pinY, side, PIN_MARKER_SIZE) : null;
  const canPress = !!onPress && !blocked;
  const body = failed ? (
    <View style={[styles.closeUp, styles.failed, { width: side, height: side * 0.6 }]}>
      <ImageOff size={18} color={t.textMuted} strokeWidth={1.75} />
      <Text style={styles.dropHint}>The plan sheet didn’t load.</Text>
    </View>
  ) : !w && shapeUnknown ? (
    <View style={styles.pinRow} testID="punch-edit-pin-no-closeup">
      <MapPin size={14} color={t.textMuted} strokeWidth={2} />
      <Text style={styles.pinText}>{`${pin.label} — close-up not available`}</Text>
    </View>
  ) : (
    <View style={[styles.closeUp, { width: side, height: side }]}>
      <Image
        source={{ uri: pin.imageUri }}
        // Until the window is known the image sits invisible at full size so
        // onLoad can report its real shape.
        style={w
          ? { position: 'absolute', left: (-w.left / w.width) * side, top: (-w.top / w.height) * side, width: side / w.width, height: side / w.height }
          : { position: 'absolute', left: 0, top: 0, width: side, height: side, opacity: 0 }}
        resizeMode="stretch"
        onLoad={(e) => {
          // Native reports `source`; react-native-web hands over the DOM
          // event, whose <img> carries naturalWidth/Height (loadedImageAspect).
          const a = loadedImageAspect(e.nativeEvent);
          if (a) setLoadedAspect(a);
          else setShapeUnknown(true);
        }}
        onError={() => setFailed(true)}
      />
      {mark ? (
        <View
          pointerEvents="none"
          testID="punch-edit-pin-marker"
          style={[
            styles.marker,
            { left: mark.left, top: mark.top },
            // Near the top the marker hangs below the pin (tail up); near a
            // side the head runs inward — the clipping box never cuts the number.
            mark.below && styles.markerBelow,
            mark.align === 'start' && styles.markerStart,
            mark.align === 'end' && styles.markerEnd,
          ]}
        >
          <View style={styles.markerHead}>
            <Text style={styles.markerText} numberOfLines={1}>{pin.number ?? ''}</Text>
          </View>
          <View style={mark.below ? styles.markerTailUp : styles.markerTail} />
        </View>
      ) : null}
    </View>
  );
  return (
    <View>
      <TouchableOpacity
        onPress={canPress ? onPress ?? undefined : undefined}
        disabled={!canPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${pin.label}. ${canPress ? 'Opens the plan to move the pin' : ''}`}
        testID="punch-edit-pin-thumb"
      >
        {body}
      </TouchableOpacity>
      <Text style={styles.pinCaption} numberOfLines={2}>{pin.label}</Text>
      {blocked ? <Text style={styles.note}>{blocked}</Text> : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  pane: { flex: 1, backgroundColor: t.bg, borderLeftWidth: 1, borderLeftColor: t.line },
  paneContent: { padding: 18, gap: 10 },
  photo: {
    width: '100%', aspectRatio: 1, marginTop: 6, overflow: 'hidden',
    borderRadius: Tokens.radius.md, backgroundColor: Colors.fillSecondary,
  },
  expand: {
    position: 'absolute', right: 8, bottom: 8, width: 26, height: 26, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  drop: {
    alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.line, backgroundColor: t.surface,
  },
  failed: { alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16 },
  dropTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.accentLabel },
  dropHint: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  note: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  pending: { fontSize: Type.caption1.fontSize, color: t.accentLabel, fontWeight: '600', lineHeight: 17 },
  planBlock: { marginTop: 8, gap: 6 },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pinText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  closeUp: {
    // Plan paper is white in every theme, like the PDF's close-up.
    overflow: 'hidden', borderRadius: Tokens.radius.md, backgroundColor: Colors.textOnAccent,
    borderWidth: 1, borderColor: t.line,
  },
  marker: { position: 'absolute', width: PIN_MARKER_SIZE, height: PIN_MARKER_SIZE, alignItems: 'center', justifyContent: 'flex-end' },
  markerHead: {
    minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: Tokens.radius.full, backgroundColor: t.danger,
    borderWidth: 1.5, borderColor: Colors.textOnAccent, alignItems: 'center', justifyContent: 'center',
  },
  markerText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: Colors.textOnAccent },
  markerTail: {
    width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 6,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: t.danger,
  },
  markerTailUp: {
    width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 6,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: t.danger,
  },
  // column-reverse: the tail is drawn first, at the pin, with the head under it.
  markerBelow: { flexDirection: 'column-reverse' },
  markerStart: { alignItems: 'flex-start' },
  markerEnd: { alignItems: 'flex-end' },
  pinCaption: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 4 },
});
