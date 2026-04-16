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
import {
  Share2,
  X,
  FileText,
  Users,
  BarChart3,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask, ProjectSchedule, CompanyBranding } from '@/types';
import { getPhaseColor } from '@/utils/scheduleEngine';
import { generateSchedulePdf } from '@/utils/schedulePdfGenerator';

interface ScheduleShareSheetProps {
  visible: boolean;
  onClose: () => void;
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  projectStartDate: Date;
  projectName: string;
  companyName?: string;
  branding?: CompanyBranding;
}

function ScheduleShareSheet({
  visible,
  onClose,
  schedule,
  tasks,
  projectStartDate,
  projectName,
  companyName,
  branding,
}: ScheduleShareSheetProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareMode, setShareMode] = useState<'full' | 'gantt' | 'trade'>('full');
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);

  const phases = React.useMemo(() => {
    const set = new Set(tasks.map(t => t.phase));
    return Array.from(set);
  }, [tasks]);

  const handleShare = useCallback(async () => {
    setIsGenerating(true);
    try {
      const effectiveBranding: CompanyBranding | undefined = branding ?? (companyName ? {
        companyName,
        contactName: '',
        email: '',
        phone: '',
        address: '',
        licenseNumber: '',
        tagline: '',
      } : undefined);

      await generateSchedulePdf({
        schedule,
        projectStartDate,
        projectName,
        branding: effectiveBranding,
        mode: shareMode,
        selectedPhase: shareMode === 'trade' ? (selectedPhase ?? undefined) : undefined,
      });

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err) {
      console.log('[ScheduleShare] Error generating PDF:', err);
      Alert.alert('Error', 'Failed to generate schedule PDF.');
    } finally {
      setIsGenerating(false);
    }
  }, [schedule, tasks, shareMode, selectedPhase, projectStartDate, projectName, companyName, branding, onClose]);

  const canShare = shareMode !== 'trade' || !!selectedPhase;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={st.sheet}>
          <View style={st.handle} />
          <View style={st.header}>
            <View style={st.headerLeft}>
              <Share2 size={18} color={Colors.primary} />
              <Text style={st.headerTitle}>Export Schedule</Text>
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
              style={[st.modeBtn, shareMode === 'gantt' && st.modeBtnActive]}
              onPress={() => setShareMode('gantt')}
            >
              <BarChart3 size={14} color={shareMode === 'gantt' ? '#FFF' : Colors.textSecondary} />
              <Text style={[st.modeBtnText, shareMode === 'gantt' && st.modeBtnTextActive]}>Gantt Only</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.modeBtn, shareMode === 'trade' && st.modeBtnActive]}
              onPress={() => setShareMode('trade')}
            >
              <Users size={14} color={shareMode === 'trade' ? '#FFF' : Colors.textSecondary} />
              <Text style={[st.modeBtnText, shareMode === 'trade' && st.modeBtnTextActive]}>By Trade</Text>
            </TouchableOpacity>
          </View>

          <View style={st.infoRow}>
            <Text style={st.infoText}>
              {shareMode === 'full'
                ? 'Complete schedule with task table, Gantt chart, summary & risk items'
                : shareMode === 'gantt'
                ? 'Header + visual Gantt chart only (1 page)'
                : 'Tasks filtered by trade/phase — great for subcontractors'}
            </Text>
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
            style={[st.shareBtn, (!canShare || isGenerating) && { opacity: 0.6 }]}
            onPress={handleShare}
            disabled={isGenerating || !canShare}
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

  modeRow: { flexDirection: 'row', gap: 6 },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
  },
  modeBtnActive: { backgroundColor: Colors.primary },
  modeBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  modeBtnTextActive: { color: '#FFF' },

  infoRow: { paddingHorizontal: 4 },
  infoText: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },

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
