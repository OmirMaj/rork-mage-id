// ScheduleSettingsMenu — gear-icon dropdown with per-schedule preferences.
//
// Lives in the schedule-pro header. Today it exposes:
//   - Critical-float threshold: how much slack (in days) still counts as
//     critical. 0 = strict CPM (default). Raising it surfaces "near-critical"
//     tasks that a single slip would turn red.
//   - Working days per week: 5 or 7, plus quick-set helpers.
//
// The component is intentionally a popover (not a full modal) — one-shot
// tweaks should feel lightweight, and the user stays in context.

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, Platform,
} from 'react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Settings, X } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface ScheduleSettingsMenuProps {
  visible: boolean;
  criticalFloatThresholdDays: number;
  workingDaysPerWeek: number;
  onClose: () => void;
  onApply: (patch: { criticalFloatThresholdDays: number; workingDaysPerWeek: number }) => void;
}

export default function ScheduleSettingsMenu({
  visible, criticalFloatThresholdDays, workingDaysPerWeek, onClose, onApply,
}: ScheduleSettingsMenuProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [threshold, setThreshold] = useState(String(criticalFloatThresholdDays));
  const [wdpw, setWdpw] = useState<number>(workingDaysPerWeek);

  useEffect(() => {
    if (visible) {
      setThreshold(String(criticalFloatThresholdDays));
      setWdpw(workingDaysPerWeek);
    }
  }, [visible, criticalFloatThresholdDays, workingDaysPerWeek]);

  const apply = () => {
    const parsed = Math.max(0, Math.min(30, Math.round(Number(threshold) || 0)));
    onApply({ criticalFloatThresholdDays: parsed, workingDaysPerWeek: wdpw });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={styles.backdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Settings size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.title}>Schedule settings</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.textSecondary} strokeWidth={1.75} /></TouchableOpacity>
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Critical slack threshold</Text>
              <Text style={styles.help}>
                Tasks with total float ≤ this many days glow as critical. Set to 0 for strict CPM.
              </Text>
            </View>
            <View style={styles.thresholdInput}>
              <TextInput
                value={threshold}
                onChangeText={setThreshold}
                keyboardType="numeric"
                style={styles.input}
                maxLength={3}
              />
              <Text style={styles.unit}>d</Text>
            </View>
          </View>

          <View style={styles.quickRow}>
            {[0, 1, 2, 3, 5].map(n => (
              <TouchableOpacity
                key={n}
                onPress={() => setThreshold(String(n))}
                style={[styles.chip, String(n) === threshold && styles.chipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, String(n) === threshold && styles.chipTextActive]}>
                  {n === 0 ? 'Strict (0d)' : `≤${n}d`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.row, { marginTop: 18 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Working days per week</Text>
              <Text style={styles.help}>
                5 skips Sat/Sun automatically. 7 counts every calendar day.
              </Text>
            </View>
            <View style={styles.segControl}>
              {[5, 6, 7].map(n => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setWdpw(n)}
                  style={[styles.segBtn, wdpw === n && styles.segBtnActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.segText, wdpw === n && styles.segTextActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnGhost} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={apply} activeOpacity={0.7}>
              <Text style={styles.btnPrimaryText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 480,
    maxWidth: '92%',
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  title: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  closeBtn: { padding: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  help: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2, lineHeight: 15 },
  thresholdInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  input: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    width: 36,
    textAlign: 'center',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  unit: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  quickRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.surfaceAlt,
  },
  chipActive: { backgroundColor: t.accent },
  chipText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary },
  chipTextActive: { color: '#fff' },
  segControl: {
    flexDirection: 'row',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.sm,
    padding: 2,
  },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.xs },
  segBtnActive: { backgroundColor: t.surface },
  segText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textSecondary },
  segTextActive: { color: t.text },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: t.line,
  },
  btnGhost: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.xs },
  btnGhostText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.textSecondary },
  btnPrimary: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.xs, backgroundColor: t.accent },
  btnPrimaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#fff' },
});
