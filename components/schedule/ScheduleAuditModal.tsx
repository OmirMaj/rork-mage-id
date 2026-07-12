// ScheduleAuditModal — a read-only viewer over the schedule audit log.
//
// Every CPM-affecting edit (task create/delete/edit, dependency changes,
// progress updates, baselines, reflows, voice commands, sub updates) is
// appended to AsyncStorage by utils/scheduleAudit. This modal renders that
// log grouped by day so a user can see "who changed what, when" — the
// history P6's audit famously can't show for logic changes.

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { loadAuditFromAsyncStorage, groupAuditByDay, summarizeTaskDiff } from '@/utils/scheduleAudit';
import type { ScheduleAuditEntry } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function ScheduleAuditModal(props: {
  visible: boolean;
  projectId: string;
  onClose: () => void;
}): React.JSX.Element {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<ScheduleAuditEntry[] | null>(null);

  useEffect(() => {
    if (!props.visible || !props.projectId) return;
    let cancelled = false;
    setEntries(null);
    loadAuditFromAsyncStorage(props.projectId).then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => { cancelled = true; };
  }, [props.visible, props.projectId]);

  const days = entries && entries.length > 0 ? groupAuditByDay(entries) : [];

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>History</Text>
            <TouchableOpacity onPress={props.onClose} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={themeColors.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {entries === null ? (
              <Text style={styles.loadingText}>Loading…</Text>
            ) : entries.length === 0 ? (
              <Text style={styles.emptyText}>
                No schedule history yet — edits you make will show up here.
              </Text>
            ) : (
              days.map(({ day, entries: dayEntries }) => (
                <View key={day} style={styles.dayGroup}>
                  <Text style={styles.dayHead}>{day}</Text>
                  {dayEntries.map((entry) => (
                    <View key={entry.id} style={styles.entryRow}>
                      <View style={styles.entryHead}>
                        <Text style={styles.entryTime}>{formatTime(entry.at)}</Text>
                        <Text style={styles.entryUser} numberOfLines={1}>{entry.user}</Text>
                        <View style={styles.kindChip}>
                          <Text style={styles.kindChipText}>{entry.kind.replace(/_/g, ' ')}</Text>
                        </View>
                      </View>
                      <Text style={styles.entrySummary}>{entry.summary}</Text>
                      {entry.before && entry.after && (
                        <Text style={styles.entryDiff}>
                          {summarizeTaskDiff(entry.before, entry.after)}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '90%' as const,
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10, gap: 12,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: Tokens.radius.full,
    backgroundColor: t.line,
    alignSelf: 'center', marginBottom: 4,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  list: { flex: 1 },

  loadingText: {
    fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic',
    paddingVertical: 24, textAlign: 'center',
  },
  emptyText: {
    fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic',
    paddingVertical: 24, textAlign: 'center', lineHeight: 18,
  },

  dayGroup: { marginBottom: 8 },
  dayHead: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase' as const, marginTop: 6, marginBottom: 6,
  },

  entryRow: {
    padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 6,
  },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  entryTime: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  entryUser: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textMuted },
  kindChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft,
  },
  kindChipText: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.accent,
    letterSpacing: 0.3, textTransform: 'uppercase' as const,
  },
  entrySummary: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text, marginTop: 6 },
  entryDiff: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 3, lineHeight: 15 },
});
