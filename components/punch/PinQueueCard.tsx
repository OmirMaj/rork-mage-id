// components/punch/PinQueueCard.tsx — what Pin items shows about the item he
// is pinning: its photo (with the markup he drew), #number, list, status,
// description, where he said it is, and where the photo's GPS says it was.
//
//   layout "strip" — a phone: a full-bleed row above the plan. The photo is a
//     104/128pt square (56 collapsed) — big enough to recognise the defect,
//     small enough that the plan below keeps ≥ 300pt on an iPhone SE
//     (utils/punchPinQueue pinCanvasHeight, executed by the guard).
//   layout "pane"  — web ≥ 900 wide: a column beside the plan.
//
// Deliberately NOT a card surface: plain background, no radius, a hairline.
// The photo taps through to PunchPhotoViewer. No geometry lives here.
//
// PinQueueNav is the Back + Undo pair that sits in PlanPinStep's footer row.

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { ChevronLeft, Undo2, Minimize2, Maximize2, ImageOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Badge, StatusPill } from '@/components/ui';
import { PhotoMarkupOverlay } from '@/components/PhotoMarkupOverlay';
import { UNPLACED_LOCATION_LABEL } from '@/utils/punchLocations';
import { punchListTypeOf, type PhotoMarkup, type PunchItem } from '@/types';
import type { PinSeed } from '@/utils/punchPinQueue';
import { useT } from '@/contexts/LanguageContext';

export interface PinQueueCardProps {
  layout: 'strip' | 'pane';
  item: PunchItem;
  number: number;
  position: number;
  total: number;
  photoSize: number;
  width?: number | null;
  markup: PhotoMarkup[];
  seedSource: PinSeed['source'];
  /** The export's state for the item: sheet-missing gets its own note. */
  sheetMissing: boolean;
  /** Label of the sheet a 'sheet-only' item is filed to. */
  seedSheetLabel?: string | null;
  pinned: boolean;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onOpenPhoto: () => void;
}

export function PinQueueCard(p: PinQueueCardProps) {
  const { t } = useT();
  const { colors: tc } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = p.item.photoUri && p.item.photoUri !== failedUri ? p.item.photoUri : undefined;
  const isPane = p.layout === 'pane';
  const list = punchListTypeOf(p.item);
  const typed = (p.item.location ?? '').trim();
  const locationText = typed || UNPLACED_LOCATION_LABEL;
  const gps = (p.item.photoLocationLabel ?? '').trim();
  const seedNote = p.sheetMissing
    ? t('field.punchWalk.queue.seed.sheetDeleted', 'Its plan sheet was deleted — pin it again.')
    : p.seedSource === 'drawing-pin'
      ? t('field.punchWalk.queue.seed.drawingPin', 'Placed where its plan-viewer pin is — Save to keep it.')
      : p.seedSource === 'sheet-only'
        ? (p.seedSheetLabel
          ? t('field.punchWalk.queue.seed.sheetOnly', 'Filed to {sheet} without a spot — tap where it is.', { sheet: p.seedSheetLabel })
          : t('field.punchWalk.queue.seed.sheetOnlyNoLabel', 'Filed to a sheet without a spot — tap where it is.'))
        : null;
  // The screen reader's one line for the card: each variant is ONE sentence.
  // One-letter placeholders: n number, i position, o total, d description, l location, g photo GPS.
  const a11yVars = {
    n: p.number, i: p.position, o: p.total,
    d: p.item.description || t('field.punchWalk.queue.a11y.noDescription', 'no description'),
    l: locationText, g: gps,
  };
  const groupLabel = gps
    ? (p.pinned
      ? t('field.punchWalk.queue.a11y.gpsPinned', 'Item {n}, {i} of {o}: {d}, {l}, photo GPS {g}. Pinned.', a11yVars)
      : t('field.punchWalk.queue.a11y.gpsNotPinned', 'Item {n}, {i} of {o}: {d}, {l}, photo GPS {g}. Not pinned.', a11yVars))
    : (p.pinned
      ? t('field.punchWalk.queue.a11y.pinned', 'Item {n}, {i} of {o}: {d}, {l}. Pinned.', a11yVars)
      : t('field.punchWalk.queue.a11y.notPinned', 'Item {n}, {i} of {o}: {d}, {l}. Not pinned.', a11yVars));

  const photo = (
    <TouchableOpacity
      onPress={uri ? p.onOpenPhoto : undefined}
      disabled={!uri}
      activeOpacity={0.85}
      accessibilityRole="imagebutton"
      accessibilityLabel={uri ? t('field.punchWalk.queue.photoForOpensFull', 'Photo for #{number}, opens full screen', { number: p.number }) : t('field.punchWalk.queue.noPhotoFor', 'No photo for #{number}', { number: p.number })}
      accessibilityState={{ disabled: !uri }}
      testID="pin-queue-photo"
      style={[styles.photo, { width: p.photoSize, height: p.photoSize }]}
    >
      {uri ? (
        <>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailedUri(uri)} />
          {/* A square cover frame is the overlay's contract (the annotator's crop). */}
          <PhotoMarkupOverlay markup={p.markup} />
        </>
      ) : (
        <View style={styles.noPhoto}>
          <ImageOff size={p.photoSize > 80 ? 20 : 14} color={tc.textMuted} strokeWidth={1.75} />
          {p.photoSize > 80 && <Text style={styles.noPhotoText}>{t('field.punchWalk.queue.noPhoto', 'No photo')}</Text>}
        </View>
      )}
    </TouchableOpacity>
  );

  const text = (
    <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={groupLabel}>
      <View style={styles.topRow}>
        <Text style={styles.number}>#{p.number}</Text>
        <Badge tone={list === 'punch' ? 'danger' : 'neutral'}>{list === 'punch' ? t('field.punchWalk.queue.badgePunch', 'Punch') : t('field.punchWalk.queue.badgeCrew', 'Crew list')}</Badge>
        {p.item.status === 'closed' && <StatusPill label={t('field.punchWalk.queue.closed', 'Closed')} tone="neutral" size="compact" />}
      </View>
      <Text style={styles.desc} numberOfLines={isPane ? undefined : p.collapsed ? 1 : 2}>
        {p.item.description || t('field.punchWalk.queue.noDescription', 'No description')}
      </Text>
      <Text style={styles.meta} numberOfLines={isPane ? undefined : 1}>
        <Text style={typed ? styles.metaStrong : undefined}>{locationText}</Text>
        {gps ? t('field.punchWalk.queue.gpsFact', ' · Photo GPS · {gps}', { gps }) : ''}
      </Text>
      {seedNote && <Text style={styles.seed} numberOfLines={isPane ? undefined : 1}>{seedNote}</Text>}
    </View>
  );

  if (isPane) {
    return (
      <ScrollView
        style={[styles.pane, { width: p.width ?? undefined }]}
        contentContainerStyle={styles.paneContent}
        testID="pin-queue-card"
      >
        {photo}
        {text}
      </ScrollView>
    );
  }

  return (
    <View style={styles.strip} testID="pin-queue-card">
      {photo}
      {text}
      {p.onToggleCollapsed && (
        <TouchableOpacity
          onPress={p.onToggleCollapsed}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={p.collapsed ? t('field.punchWalk.queue.biggerPhoto', 'Bigger photo') : t('field.punchWalk.queue.smallerPhoto', 'Smaller photo')}
          testID="pin-queue-photo-toggle"
        >
          {p.collapsed
            ? <Maximize2 size={18} color={tc.textSecondary} strokeWidth={1.75} />
            : <Minimize2 size={18} color={tc.textSecondary} strokeWidth={1.75} />}
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Back + Undo, the first two buttons of the Skip / Next row. Undo is always drawn so the row never shifts. */
export function PinQueueNav({ backNumber, undoNumber, onBack, onUndo }: {
  backNumber: number | null;
  undoNumber: number | null;
  onBack: () => void;
  onUndo: () => void;
}) {
  const { t } = useT();
  const { colors: tc } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const backOff = backNumber === null;
  const undoOff = undoNumber === null;
  return (
    <>
      <TouchableOpacity
        onPress={onBack}
        disabled={backOff}
        style={[styles.navBtn, backOff && styles.navBtnOff]}
        accessibilityRole="button"
        accessibilityLabel={backOff ? t('field.punchWalk.queue.firstItem', 'First item') : t('field.punchWalk.queue.backTo', 'Back to #{backNumber}', { backNumber })}
        accessibilityState={{ disabled: backOff }}
        testID="pin-queue-back"
      >
        <ChevronLeft size={20} color={backOff ? tc.textMuted : tc.accent} strokeWidth={2} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onUndo}
        disabled={undoOff}
        style={[styles.navBtn, undoOff && styles.navBtnOff]}
        accessibilityRole="button"
        accessibilityLabel={undoOff ? t('field.punchWalk.queue.nothingToUndoYet', 'Nothing to undo yet') : t('field.punchWalk.queue.undoThePinOn', 'Undo the pin on #{undoNumber}', { undoNumber })}
        accessibilityState={{ disabled: undoOff }}
        testID="pin-queue-undo"
      >
        <Undo2 size={18} color={undoOff ? tc.textMuted : tc.accent} strokeWidth={2} />
      </TouchableOpacity>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  strip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: t.bg, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  pane: { flexGrow: 0, backgroundColor: t.bg, borderRightWidth: 1, borderRightColor: t.line },
  paneContent: { padding: 16, gap: 14 },
  photo: { overflow: 'hidden', backgroundColor: Colors.fillSecondary, borderRadius: Tokens.radius.sm },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  noPhotoText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 },
  number: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  desc: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18 },
  meta: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 3 },
  metaStrong: { color: t.text, fontWeight: '600' },
  seed: { fontSize: Type.caption1.fontSize, color: t.accentLabel, marginTop: 3 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -8 },
  navBtn: {
    width: 44, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: Tokens.radius.md, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
  },
  navBtnOff: { opacity: 0.5 },
});
