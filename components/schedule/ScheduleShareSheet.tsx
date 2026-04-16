import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  Share2,
  X,
  FileText,
  Users,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule } from '@/types';
import {
  formatShortDate,
  getPhaseColor,
  getStatusLabel,
  getTaskDateRange,
  addWorkingDays,
} from '@/utils/scheduleEngine';

interface ScheduleShareSheetProps {
  visible: boolean;
  onClose: () => void;
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  projectStartDate: Date;
  projectName: string;
  companyName?: string;
}

function ScheduleShareSheet({
  visible,
  onClose,
  schedule,
  tasks,
  projectStartDate,
  projectName,
  companyName,
}: ScheduleShareSheetProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareMode, setShareMode] = useState<'full' | 'trade'>('full');
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);

  const phases = React.useMemo(() => {
    const set = new Set(tasks.map(t => t.phase));
    return Array.from(set);
  }, [tasks]);

  const generatePdfHtml = useCallback((filteredTasks: ScheduleTask[]): string => {
    const endDate = addWorkingDays(projectStartDate, schedule.totalDurationDays, schedule.workingDaysPerWeek);
    const totalProgress = filteredTasks.length > 0
      ? Math.round(filteredTasks.reduce((s, t) => s + t.progress, 0) / filteredTasks.length)
      : 0;

    const taskRows = filteredTasks.map(t => {
      const dr = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
      const phaseColor = getPhaseColor(t.phase);
      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${phaseColor};margin-right:6px;"></span>
            ${t.title}${t.isMilestone ? ' ⚑' : ''}${t.isCriticalPath ? ' ⚡' : ''}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#666;">${t.phase}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;">${formatShortDate(dr.start)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;">${formatShortDate(dr.end)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${t.durationDays}d</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;">
            <div style="background:#e5e5e5;border-radius:4px;height:8px;overflow:hidden;">
              <div style="background:${phaseColor};height:100%;width:${t.progress}%;border-radius:4px;"></div>
            </div>
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;font-weight:600;">${t.progress}%</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#888;">${getStatusLabel(t.status)}</td>
        </tr>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; padding: 30px; color: #1a1a1a; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
          .stats { display: flex; gap: 20px; margin-bottom: 24px; }
          .stat { background: #f5f5f5; border-radius: 10px; padding: 12px 16px; text-align: center; flex: 1; }
          .stat-value { font-size: 22px; font-weight: 800; }
          .stat-label { font-size: 11px; color: #888; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { text-align: left; padding: 8px 10px; background: #f8f8f8; border-bottom: 2px solid #ddd; font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.5px; }
          .footer { margin-top: 30px; font-size: 10px; color: #aaa; text-align: center; }
        </style>
      </head>
      <body>
        ${companyName ? `<div style="font-size:11px;color:#888;margin-bottom:4px;">${companyName}</div>` : ''}
        <h1>${projectName} — Schedule</h1>
        <div class="subtitle">
          ${formatShortDate(projectStartDate)} – ${formatShortDate(endDate)} · ${schedule.totalDurationDays} working days
          ${shareMode === 'trade' && selectedPhase ? ` · ${selectedPhase} only` : ''}
        </div>
        <div class="stats">
          <div class="stat"><div class="stat-value">${totalProgress}%</div><div class="stat-label">Complete</div></div>
          <div class="stat"><div class="stat-value">${filteredTasks.length}</div><div class="stat-label">Tasks</div></div>
          <div class="stat"><div class="stat-value">${schedule.totalDurationDays}</div><div class="stat-label">Duration</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Task</th><th>Phase</th><th>Start</th><th>End</th><th>Duration</th><th style="width:80px;">Progress</th><th>%</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${taskRows}
          </tbody>
        </table>
        <div class="footer">Generated by MAGE ID · ${new Date().toLocaleDateString()}</div>
      </body>
      </html>
    `;
  }, [schedule, projectStartDate, projectName, companyName, shareMode, selectedPhase]);

  const handleShare = useCallback(async () => {
    setIsGenerating(true);
    try {
      const filteredTasks = shareMode === 'trade' && selectedPhase
        ? tasks.filter(t => t.phase === selectedPhase)
        : tasks;

      const html = generatePdfHtml(filteredTasks);
      const { uri } = await Print.printToFileAsync({ html });

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${projectName} Schedule`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Sharing not available', 'Sharing is not supported on this device.');
      }

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err) {
      console.log('[ScheduleShare] Error generating PDF:', err);
      Alert.alert('Error', 'Failed to generate schedule PDF.');
    } finally {
      setIsGenerating(false);
    }
  }, [tasks, shareMode, selectedPhase, generatePdfHtml, projectName, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={st.sheet}>
          <View style={st.handle} />
          <View style={st.header}>
            <View style={st.headerLeft}>
              <Share2 size={18} color={Colors.primary} />
              <Text style={st.headerTitle}>Share Schedule</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={st.modeRow}>
            <TouchableOpacity
              style={[st.modeBtn, shareMode === 'full' && st.modeBtnActive]}
              onPress={() => setShareMode('full')}
            >
              <FileText size={14} color={shareMode === 'full' ? '#FFF' : Colors.textSecondary} />
              <Text style={[st.modeBtnText, shareMode === 'full' && st.modeBtnTextActive]}>Full Schedule</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.modeBtn, shareMode === 'trade' && st.modeBtnActive]}
              onPress={() => setShareMode('trade')}
            >
              <Users size={14} color={shareMode === 'trade' ? '#FFF' : Colors.textSecondary} />
              <Text style={[st.modeBtnText, shareMode === 'trade' && st.modeBtnTextActive]}>By Trade</Text>
            </TouchableOpacity>
          </View>

          {shareMode === 'trade' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.phaseScroll}>
              <View style={st.phaseRow}>
                {phases.map(phase => (
                  <TouchableOpacity
                    key={phase}
                    style={[st.phaseChip, selectedPhase === phase && st.phaseChipActive]}
                    onPress={() => setSelectedPhase(phase)}
                  >
                    <View style={[st.phaseChipDot, { backgroundColor: getPhaseColor(phase) }]} />
                    <Text style={[st.phaseChipText, selectedPhase === phase && st.phaseChipTextActive]}>{phase}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          <TouchableOpacity
            style={[st.shareBtn, isGenerating && { opacity: 0.6 }]}
            onPress={handleShare}
            disabled={isGenerating || (shareMode === 'trade' && !selectedPhase)}
            activeOpacity={0.85}
          >
            {isGenerating ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Share2 size={16} color="#FFF" />
            )}
            <Text style={st.shareBtnText}>
              {isGenerating ? 'Generating PDF...' : 'Generate & Share PDF'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 14,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.fillTertiary, alignSelf: 'center', marginBottom: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },

  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
  },
  modeBtnActive: { backgroundColor: Colors.primary },
  modeBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
  modeBtnTextActive: { color: '#FFF' },

  phaseScroll: { marginVertical: 2 },
  phaseRow: { flexDirection: 'row', gap: 6 },
  phaseChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  phaseChipActive: { backgroundColor: Colors.primary + '18', borderWidth: 1, borderColor: Colors.primary },
  phaseChipDot: { width: 6, height: 6, borderRadius: 3 },
  phaseChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  phaseChipTextActive: { color: Colors.primary },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  shareBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },
});

export default React.memo(ScheduleShareSheet);
