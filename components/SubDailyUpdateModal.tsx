// SubDailyUpdateModal — half-sheet on the shared schedule URL where a
// sub posts a daily progress update against a single task.
//
// Inputs the sub fills:
//   - Progress % (today's number, not cumulative — drives the bar overlay)
//   - Hours worked + crew count (optional)
//   - Notes (free text)
//   - Blocker (optional, drives the GC's "needs you" inbox)
//   - Photos (camera + library on mobile, library only on web)
//
// On submit, we persist locally + open a mailto/sms to the GC with a
// summary so the GC sees the update immediately even if they aren't
// in the app. The local copy lives so the sub can re-open the link
// the next day and see their last update.

import React, { memo, useCallback, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, TextInput,
  Image, Platform, Linking, Alert, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  X, CheckCircle2, Camera, Plus, Trash2, AlertTriangle, Mail, MessageSquare,
  Users, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ScheduleTask, SubScheduleUpdate } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface SubDailyUpdateModalProps {
  visible: boolean;
  onClose: () => void;
  task: ScheduleTask | null;
  /** Subbing as — the name from `?asSub=` query. */
  subName: string;
  projectId: string;
  projectName: string;
  /** GC contact info from the share payload — drives the optional notify
   *  email/SMS that opens after submit. Optional; if absent we just save. */
  gcEmail?: string;
  gcPhone?: string;
  gcName?: string;
  /** The most recent update for this task+sub, if one exists. Used to
   *  pre-fill the form so a sub can patch yesterday's number forward. */
  previousUpdate?: SubScheduleUpdate;
  /** Called with the assembled update — caller persists. */
  onSubmit: (update: SubScheduleUpdate) => Promise<void> | void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ssu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function SubDailyUpdateModalImpl({
  visible, onClose, task, subName, projectId, projectName,
  gcEmail, gcPhone, gcName, previousUpdate, onSubmit,
}: SubDailyUpdateModalProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [progress, setProgress] = useState<string>(() => String(previousUpdate?.progressPercent ?? task?.progress ?? 0));
  const [hours, setHours] = useState<string>(() => String(previousUpdate?.hoursWorked ?? ''));
  const [crew, setCrew] = useState<string>(() => String(previousUpdate?.crewCount ?? ''));
  const [notes, setNotes] = useState<string>(previousUpdate?.notes ?? '');
  const [blocker, setBlocker] = useState<string>(previousUpdate?.blocker ?? '');
  const [photos, setPhotos] = useState<{ uri: string; timestamp: string }[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset form whenever the modal opens against a different task.
  React.useEffect(() => {
    if (!visible) return;
    setProgress(String(previousUpdate?.progressPercent ?? task?.progress ?? 0));
    setHours(String(previousUpdate?.hoursWorked ?? ''));
    setCrew(String(previousUpdate?.crewCount ?? ''));
    setNotes(previousUpdate?.notes ?? '');
    setBlocker(previousUpdate?.blocker ?? '');
    setPhotos([]);
  }, [visible, previousUpdate, task]);

  const progressNum = useMemo(() => {
    const n = parseFloat(progress);
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, Math.round(n)));
  }, [progress]);

  const handleAddPhoto = useCallback(async (source: 'camera' | 'library') => {
    if (Platform.OS === 'web' && source === 'camera') {
      Alert.alert('Camera unavailable on web', 'Use Library instead.');
      return;
    }
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, exif: false, allowsMultipleSelection: false });
      if (result.canceled || !result.assets?.[0]) return;
      setPhotos(prev => [...prev, { uri: result.assets[0].uri, timestamp: new Date().toISOString() }]);
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
    } catch (e) {
      console.warn('[SubDailyUpdate] photo pick failed', e);
    }
  }, []);

  const handleRemovePhoto = useCallback((idx: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!task || !subName) return;
    setBusy(true);
    try {
      const update: SubScheduleUpdate = {
        id: generateId(),
        projectId,
        taskId: task.id,
        subName,
        forDate: todayISO(),
        progressPercent: progressNum,
        hoursWorked: hours.trim() ? parseFloat(hours) : undefined,
        crewCount: crew.trim() ? Math.max(0, Math.round(parseFloat(crew))) : undefined,
        notes: notes.trim() || undefined,
        blocker: blocker.trim() || undefined,
        photos,
        postedAt: new Date().toISOString(),
      };
      await onSubmit(update);
      // Compose + open a notification reply so the GC sees this immediately.
      const subject = `[Daily Update] ${projectName} — ${task.title} — ${update.progressPercent}% (${subName})`;
      const lines = [
        `Hi${gcName ? ' ' + gcName : ''},`,
        '',
        `Daily update on ${projectName}:`,
        `  • Task: ${task.title}`,
        `  • Today: ${update.progressPercent}% complete`,
        update.hoursWorked != null ? `  • Hours: ${update.hoursWorked}` : null,
        update.crewCount != null ? `  • Crew: ${update.crewCount}` : null,
        update.notes ? `  • Notes: ${update.notes}` : null,
        update.blocker ? `  ⚠ BLOCKER: ${update.blocker}` : null,
        '',
        `— ${subName}`,
        '',
        '(Sent via MAGE ID schedule link)',
      ].filter(Boolean).join('\n');
      const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines)}`;
      const mailto = `mailto:${gcEmail ?? ''}?${params}`;
      const sms = `sms:${gcPhone ?? ''}?body=${encodeURIComponent(`${subject}\n— ${subName}`)}`;
      const url = gcEmail ? mailto : (gcPhone ? sms : null);
      if (url) {
        try {
          const can = await Linking.canOpenURL(url);
          if (can) await Linking.openURL(url);
        } catch { /* ignore */ }
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [task, subName, projectId, projectName, progressNum, hours, crew, notes, blocker, photos, onSubmit, onClose, gcEmail, gcPhone, gcName]);

  if (!task) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={[styles.card, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Today&apos;s update</Text>
              <Text style={styles.sub}>{task.title}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.text} /></TouchableOpacity>
          </View>

          <ScrollView
            style={{ maxHeight: 560 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Progress slider — big, friendly, easy to tap on a phone. */}
            <View style={styles.section}>
              <Text style={styles.label}>Today&apos;s progress</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressNum}%` }]} />
                <Text style={styles.progressText}>{progressNum}%</Text>
              </View>
              <View style={styles.progressBtnRow}>
                {[0, 25, 50, 75, 100].map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.progressBtn, progressNum === p && styles.progressBtnActive]}
                    onPress={() => {
                      setProgress(String(p));
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                  >
                    <Text style={[styles.progressBtnText, progressNum === p && { color: '#FFF' }]}>
                      {p}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                value={progress}
                onChangeText={setProgress}
                keyboardType="number-pad"
                style={styles.numberInput}
                placeholder="Or type exact %"
                placeholderTextColor={themeColors.textMuted}
              />
            </View>

            {/* Hours + crew side-by-side */}
            <View style={[styles.section, styles.row2]}>
              <View style={{ flex: 1 }}>
                <View style={styles.labelRow}>
                  <Clock size={11} color={themeColors.textMuted} />
                  <Text style={styles.label}>Hours worked</Text>
                </View>
                <TextInput
                  value={hours}
                  onChangeText={setHours}
                  keyboardType="decimal-pad"
                  style={styles.numberInput}
                  placeholder="8"
                  placeholderTextColor={themeColors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.labelRow}>
                  <Users size={11} color={themeColors.textMuted} />
                  <Text style={styles.label}>Crew on site</Text>
                </View>
                <TextInput
                  value={crew}
                  onChangeText={setCrew}
                  keyboardType="number-pad"
                  style={styles.numberInput}
                  placeholder="3"
                  placeholderTextColor={themeColors.textMuted}
                />
              </View>
            </View>

            {/* Notes */}
            <View style={styles.section}>
              <Text style={styles.label}>What got done today</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                style={styles.textArea}
                placeholder="Hung 22 sheets on 2F south wall. Started taping NE bedroom."
                placeholderTextColor={themeColors.textMuted}
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Blocker */}
            <View style={styles.section}>
              <View style={styles.labelRow}>
                <AlertTriangle size={11} color={Colors.warning} />
                <Text style={styles.label}>Blocker (optional)</Text>
              </View>
              <TextInput
                value={blocker}
                onChangeText={setBlocker}
                style={[styles.textArea, blocker.length > 0 && styles.textAreaWarn]}
                placeholder="Need joint compound by tomorrow AM. Drywall finisher out sick rest of week."
                placeholderTextColor={themeColors.textMuted}
                multiline
                numberOfLines={2}
              />
              {blocker.trim() && (
                <Text style={styles.blockerHint}>
                  We&apos;ll flag this on the GC&apos;s dashboard with high priority.
                </Text>
              )}
            </View>

            {/* Photos */}
            <View style={styles.section}>
              <Text style={styles.label}>Photos {photos.length > 0 ? `(${photos.length})` : ''}</Text>
              <View style={styles.photoGrid}>
                {photos.map((p, i) => (
                  <View key={`${p.uri}-${i}`} style={styles.photoTile}>
                    <Image source={{ uri: p.uri }} style={styles.photoImg} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.photoRemove}
                      onPress={() => handleRemovePhoto(i)}
                      hitSlop={6} accessibilityRole="button" accessibilityLabel="Delete">
                      <Trash2 size={11} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  style={[styles.photoTile, styles.photoAdd]}
                  onPress={() => handleAddPhoto(Platform.OS === 'web' ? 'library' : 'camera')}
                  activeOpacity={0.85}
                >
                  <Camera size={18} color={themeColors.accent} />
                  <Text style={styles.photoAddLabel}>{Platform.OS === 'web' ? 'Pick' : 'Snap'}</Text>
                </TouchableOpacity>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    style={[styles.photoTile, styles.photoAdd]}
                    onPress={() => handleAddPhoto('library')}
                    activeOpacity={0.85}
                  >
                    <Plus size={18} color={themeColors.accent} />
                    <Text style={styles.photoAddLabel}>Library</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={onClose}
              disabled={busy}
            >
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={busy}
              activeOpacity={0.85}
            >
              <CheckCircle2 size={14} color="#FFF" />
              <Text style={styles.primaryBtnText}>
                {busy ? 'Sending…' : (gcEmail ? 'Save + email GC' : gcPhone ? 'Save + text GC' : 'Save')}
              </Text>
              {gcEmail
                ? <Mail size={12} color="rgba(255,255,255,0.85)" />
                : gcPhone ? <MessageSquare size={12} color="rgba(255,255,255,0.85)" /> : null}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const SubDailyUpdateModal = memo(SubDailyUpdateModalImpl);

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.line,
    alignSelf: 'center', marginBottom: 8,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  title: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  sub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  section: { marginBottom: 14 },
  row2: { flexDirection: 'row', gap: 10 },
  label: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },

  // Progress
  progressBar: {
    height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    overflow: 'hidden', justifyContent: 'center',
    position: 'relative',
  },
  progressFill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: t.accent + '40',
  },
  progressText: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, textAlign: 'center', letterSpacing: -0.2 },
  progressBtnRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  progressBtn: {
    flex: 1, paddingVertical: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    alignItems: 'center',
  },
  progressBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
  progressBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },

  numberInput: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    padding: 12, fontSize: Type.bodyCompact.fontSize, color: t.text, marginTop: 6,
  },

  textArea: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    padding: 12, fontSize: Type.bodyCompact.fontSize, color: t.text,
    minHeight: 70, textAlignVertical: 'top' as const,
  },
  textAreaWarn: {
    borderColor: Colors.warning + '60',
    backgroundColor: Colors.warning + '08',
  },
  blockerHint: { fontSize: Type.caption2.fontSize, color: Colors.warning, fontStyle: 'italic', marginTop: 4 },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoTile: {
    width: 72, height: 72, borderRadius: Tokens.radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    position: 'relative',
  },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoAdd: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.accent + '0D',
    borderColor: t.accent + '30', borderStyle: 'dashed',
    gap: 4,
  },
  photoAddLabel: { fontSize: 10, fontWeight: '700', color: t.accent },

  footer: { flexDirection: 'row', gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line },
  secondaryBtn: {
    flex: 1, paddingVertical: 14, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  primaryBtn: {
    flex: 1.6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: t.accent,
  },
  primaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },
});
