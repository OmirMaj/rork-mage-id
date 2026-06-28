// TakeoffFieldVerifyButton — opens the camera (mobile only) so the user
// can snap a photo at the job site to verify a single takeoff quantity.
//
// Scaffolding-grade: stores photo URI + GPS + an optional measured value
// locally. No upload, no AR overlay, no automated comparison against the
// drawing yet. Those are follow-ups that need physical-device testing.
//
// On web we render a "this is mobile-only" notice rather than failing
// silently.

import React, { memo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert, TextInput, Modal } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Camera, X, MapPin, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { TakeoffFieldVerification } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface TakeoffFieldVerifyButtonProps {
  rowKey: string;
  /** Quantity the AI extracted — shown next to the user's input for comparison. */
  aiQuantity: number;
  unit: string;
  /** Existing verification for this row, if any — toggles button into "view" mode. */
  existing?: TakeoffFieldVerification;
  onCapture: (v: TakeoffFieldVerification) => void;
  onDelete?: (id: string) => void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function TakeoffFieldVerifyButtonImpl({
  rowKey, aiQuantity, unit, existing, onCapture, onDelete,
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
      Alert.alert(
        'Mobile-only feature',
        'Field verification needs the device camera + GPS. Use the iOS or Android app on site.',
      );
      return;
    }
    setBusy(true);
    try {
      const camPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (!camPerm.granted) {
        Alert.alert('Camera access needed', 'Open Settings → MAGE ID → Camera to enable.');
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
    const delta = existing.measuredQuantity != null
      ? existing.measuredQuantity - aiQuantity : undefined;
    const tone = delta == null ? themeColors.textMuted
      : Math.abs(delta) / Math.max(1, aiQuantity) < 0.05 ? themeColors.success
      : Colors.warning;
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
                    <Text style={styles.compareLabel}>AI</Text>
                    <Text style={styles.compareValue}>{Math.round(aiQuantity)} {unit}</Text>
                  </View>
                  <View style={styles.compareDivider} />
                  <View style={styles.compareItem}>
                    <Text style={styles.compareLabel}>Field</Text>
                    <Text style={styles.compareValue}>
                      {existing.measuredQuantity != null ? `${existing.measuredQuantity} ${unit}` : '—'}
                    </Text>
                  </View>
                </View>
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
                placeholder={`AI says ${Math.round(aiQuantity)}`}
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
    padding: 14, backgroundColor: t.accent,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  commitBtnText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' },
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
