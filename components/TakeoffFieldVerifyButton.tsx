// TakeoffFieldVerifyButton — opens the camera (mobile only) so the user
// can snap a photo at the job site to verify a single takeoff quantity.
//
// Stores photo URI + GPS + an optional measured value locally. No upload and
// no AR overlay — those need physical-device testing.
//
// WHAT THE MEASURED VALUE IS NOW FOR (audit 2026-09-11, F6). It used to be
// written to AsyncStorage and read by nothing but this component's own photo
// view: the GC measured the wall and the app filed the number. When it
// disagrees with the quantity of record, this modal now offers to ADOPT it —
// one tap, with the delta on screen — and that is the whole route by which a
// tape measure reaches the learned rate: the row's quantity of record feeds the
// priced estimate, the estimate line is what a commitment links to, and
// utils/costDatabase divides that commitment by the line's quantity. See
// utils/fieldMeasuredQuantity for why adoption is explicit rather than
// automatic (a partial measurement typed into an aggregate row would publish a
// wildly wrong rate stamped "measured").
//
// On web we render a "this is mobile-only" notice rather than failing
// silently.

import React, { memo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, TextInput, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Camera, X, MapPin, Check, Ruler } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { TakeoffFieldVerification } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import {
  measurementVerdict, adoptOffer, formatMeasured,
} from '@/utils/fieldMeasuredQuantity';

export interface TakeoffFieldVerifyButtonProps {
  rowKey: string;
  /**
   * The quantity currently OF RECORD for this row — the user's override if
   * they have edited it, else the AI's read. (This was called `aiQuantity`,
   * which was already false at the one call site: app/takeoff.tsx passes the
   * override-aware number. The name mattered once the measurement could be
   * adopted: a measurement already applied has to read as agreement, not
   * offer itself again.)
   */
  currentQuantity: number;
  unit: string;
  /** Existing verification for this row, if any — toggles button into "view" mode. */
  existing?: TakeoffFieldVerification;
  onCapture: (v: TakeoffFieldVerification) => void;
  onDelete?: (id: string) => void;
  /**
   * Adopt the measured quantity as the row's quantity of record. Omit and the
   * measurement stays a photo caption — which is exactly the state F6
   * described, so every call site should pass it.
   */
  onUseMeasured?: (measuredQuantity: number) => void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function TakeoffFieldVerifyButtonImpl({
  rowKey, currentQuantity, unit, existing, onCapture, onDelete, onUseMeasured,
}: TakeoffFieldVerifyButtonProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{
    photoUri: string;
    measured: string;
    note: string;
    lat?: number;
    lon?: number;
  } | null>(null);
  const [viewing, setViewing] = useState(false);

  const open = useCallback(async () => {
    if (Platform.OS === 'web') {
      showAlert(
        'Mobile-only feature',
        'Field verification needs the device camera + GPS. Use the iOS or Android app on site.',
      );
      return;
    }
    setBusy(true);
    try {
      const camPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (!camPerm.granted) {
        showAlert('Camera access needed', 'Open Settings → MAGE ID → Camera to enable.');
        setBusy(false);
        return;
      }

      const r = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
        exif: false,
      });
      if (r.canceled || !r.assets?.[0]) {
        setBusy(false);
        return;
      }

      // Best-effort GPS — non-fatal if denied.
      let lat: number | undefined;
      let lon: number | undefined;
      try {
        const locPerm = await Location.requestForegroundPermissionsAsync();
        if (locPerm.granted) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
        }
      } catch {/* ignore */}

      setDraft({
        photoUri: r.assets[0].uri,
        measured: '',
        note: '',
        lat, lon,
      });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } finally {
      setBusy(false);
    }
  }, []);

  const commit = useCallback(() => {
    if (!draft) return;
    const measuredNum = parseFloat(draft.measured);
    onCapture({
      id: generateId(),
      rowKey,
      photoUri: draft.photoUri,
      note: draft.note || undefined,
      latitude: draft.lat,
      longitude: draft.lon,
      measuredQuantity: Number.isFinite(measuredNum) ? measuredNum : undefined,
      capturedAt: new Date().toISOString(),
    });
    setDraft(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [draft, onCapture, rowKey]);

  if (existing) {
    // One verdict drives the pill tone, the pill's delta and whether the modal
    // offers to adopt the measurement — the tolerance used to live inline here
    // and governed nothing but a colour.
    const verdict = measurementVerdict(currentQuantity, existing);
    const delta = verdict.kind === 'none' ? undefined : verdict.delta;
    const tone = verdict.kind === 'none' ? themeColors.textMuted
      : verdict.kind === 'agrees' ? themeColors.success
      : Colors.warningLabel;
    // The offer is decided in utils/fieldMeasuredQuantity, not here, so the
    // rule that closes F6 on screen is a function a guard can RUN rather than
    // a ternary a guard can only grep (scripts/validate-estimate-cost-basis
    // §6k executes it, including the no-writer case).
    const adopt = adoptOffer(verdict, unit, !!onUseMeasured);
    return (
      <>
        <TouchableOpacity
          style={[styles.btn, styles.btnVerified]}
          onPress={() => setViewing(true)}
          activeOpacity={0.7}
        >
          <Check size={11} color={themeColors.success} strokeWidth={1.75} />
          {/* "Field-stamped" honestly describes what we did — captured a
              photo + (best-effort) GPS at the row. "Verified" implied we
              had reconciled the field measurement against the AI takeoff,
              which the GC has to do themselves. */}
          <Text style={styles.btnVerifiedText}>Field-stamped</Text>
          {delta != null && (
            <Text style={[styles.btnDeltaText, { color: tone }]}>
              {delta >= 0 ? '+' : ''}{Math.round(delta)} {unit}
            </Text>
          )}
        </TouchableOpacity>
        <Modal visible={viewing} transparent animationType="fade" onRequestClose={() => setViewing(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>Field verification</Text>
                <TouchableOpacity onPress={() => setViewing(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={18} color={themeColors.text} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              <Image source={{ uri: existing.photoUri }} style={styles.modalImage} contentFit="contain" />
              <View style={styles.modalBody}>
                <View style={styles.compareRow}>
                  <View style={styles.compareItem}>
                    {/* "Takeoff", not "AI": this is the quantity of record,
                        which is the user's own edit whenever they made one. */}
                    <Text style={styles.compareLabel}>Takeoff</Text>
                    <Text style={styles.compareValue}>{formatMeasured(Math.round(currentQuantity), unit)}</Text>
                  </View>
                  <View style={styles.compareDivider} />
                  <View style={styles.compareItem}>
                    <Text style={styles.compareLabel}>Field</Text>
                    <Text style={styles.compareValue}>
                      {existing.measuredQuantity != null ? formatMeasured(existing.measuredQuantity, unit) : '—'}
                    </Text>
                  </View>
                </View>
                {/* THE ROUTE OUT OF THE PHOTO ALBUM. Adopting the measurement
                    makes it the quantity the estimate prices and the cost book
                    divides by; see utils/fieldMeasuredQuantity. */}
                {adopt && (
                  <>
                    <TouchableOpacity
                      style={styles.adoptBtn}
                      onPress={() => {
                        onUseMeasured?.(adopt.measured);
                        setViewing(false);
                        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={adopt.label}
                    >
                      <Ruler size={13} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.adoptBtnText}>{adopt.label}</Text>
                    </TouchableOpacity>
                    <Text style={styles.adoptNote}>{adopt.consequence}</Text>
                  </>
                )}
                {verdict.kind === 'agrees' && (
                  <Text style={styles.adoptNote}>
                    Matches the takeoff quantity — nothing to change.
                  </Text>
                )}
                {existing.note && <Text style={styles.modalNote}>{existing.note}</Text>}
                {existing.latitude != null && (
                  <View style={styles.gpsRow}>
                    <MapPin size={11} color={themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.gpsText}>
                      {existing.latitude.toFixed(5)}, {existing.longitude?.toFixed(5)}
                    </Text>
                  </View>
                )}
                <Text style={styles.timestampText}>
                  {new Date(existing.capturedAt).toLocaleString()}
                </Text>
              </View>
              {onDelete && (
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => {
                    onDelete(existing.id);
                    setViewing(false);
                  }}
                >
                  <Text style={styles.deleteBtnText}>Delete verification</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>
      </>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={styles.btn}
        onPress={open}
        disabled={busy}
        activeOpacity={0.7}
      >
        <Camera size={11} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.btnText}>Verify on site</Text>
      </TouchableOpacity>

      {/* Confirm modal — user types the value they measured + an optional note. */}
      <Modal visible={!!draft} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Verify quantity</Text>
              <TouchableOpacity onPress={() => setDraft(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {draft?.photoUri && (
              <Image source={{ uri: draft.photoUri }} style={styles.modalImage} contentFit="contain" />
            )}
            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>What you measured ({unit})</Text>
              <TextInput
                value={draft?.measured ?? ''}
                onChangeText={t => setDraft(d => d ? { ...d, measured: t } : d)}
                keyboardType="decimal-pad"
                placeholder={`Takeoff says ${Math.round(currentQuantity)}`}
                placeholderTextColor={themeColors.textMuted}
                style={styles.modalInput}
              />
              <Text style={styles.modalLabel}>Note (optional)</Text>
              <TextInput
                value={draft?.note ?? ''}
                onChangeText={t => setDraft(d => d ? { ...d, note: t } : d)}
                placeholder="e.g. Bowed wall, used 25 ft tape"
                placeholderTextColor={themeColors.textMuted}
                style={[styles.modalInput, { minHeight: 60 }]}
                multiline
              />
              {draft?.lat != null && (
                <View style={styles.gpsRow}>
                  <MapPin size={11} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={styles.gpsText}>GPS attached</Text>
                </View>
              )}
            </View>
            <TouchableOpacity style={styles.commitBtn} onPress={commit}>
              <Check size={14} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.commitBtnText}>Save verification</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

export const TakeoffFieldVerifyButton = memo(TakeoffFieldVerifyButtonImpl);

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.xs,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  btnText: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '700' },
  btnVerified: {
    backgroundColor: t.success + '0D', borderColor: t.success + '30',
  },
  btnVerifiedText: { fontSize: Type.caption2.fontSize, color: t.success, fontWeight: '700' },
  btnDeltaText: { fontSize: 10, fontWeight: '800', marginLeft: 2 },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCard: {
    width: '100%', maxWidth: 460,
    backgroundColor: t.bg, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line,
    overflow: 'hidden',
  },
  modalHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14, borderBottomWidth: 1, borderBottomColor: t.line,
    backgroundColor: Colors.card,
  },
  modalTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  modalImage: { width: '100%', height: 220, backgroundColor: '#1a1a1a' },
  modalBody: { padding: 14, gap: 8 },
  modalLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalInput: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md, padding: 12,
    borderWidth: 1, borderColor: t.line,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  modalNote: { fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 16, fontStyle: 'italic' },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gpsText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },
  timestampText: { fontSize: 10, color: t.textMuted, marginTop: 4 },
  commitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: 14, backgroundColor: t.accentFill,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  commitBtnText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
  adoptBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '12', borderWidth: 1, borderColor: t.accent + '33',
  },
  adoptBtnText: { color: t.accent, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
  adoptNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15 },
  deleteBtn: { padding: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.line },
  deleteBtnText: { color: t.danger, fontSize: Type.footnote.fontSize, fontWeight: '700' },

  compareRow: {
    flexDirection: 'row', alignItems: 'stretch', gap: 0,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    overflow: 'hidden',
  },
  compareItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  compareLabel: { fontSize: 10, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  compareValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  compareDivider: { width: 1, alignSelf: 'stretch', backgroundColor: t.line },
});
