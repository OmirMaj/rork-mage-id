import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Modal,
  Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  ChevronRight,
  X,
  Zap,
  Home,
  Building2,
  Wrench,
  Trees,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { SCHEDULE_TEMPLATES } from '@/constants/scheduleTemplates';
import type { ScheduleTemplate } from '@/constants/scheduleTemplates';

interface QuickBuildModalProps {
  visible: boolean;
  onClose: () => void;
  onTemplateSelect: (template: ScheduleTemplate, startDate: Date) => void;
}

type ProjectSize = 'small' | 'medium' | 'large';

const SIZE_LABELS: Record<ProjectSize, { label: string; factor: number; desc: string }> = {
  small: { label: 'Small', factor: 0.7, desc: 'Compact scope' },
  medium: { label: 'Medium', factor: 1.0, desc: 'Standard scope' },
  large: { label: 'Large', factor: 1.5, desc: 'Extended scope' },
};

const TEMPLATE_ICONS: Record<string, typeof Home> = {
  'kitchen-remodel': Wrench,
  'bathroom-remodel': Wrench,
  'basement-finish': Home,
  'roof-replacement': Home,
  'new-home': Building2,
  'commercial-ti': Building2,
  'exterior-renovation': Home,
  'parking-lot': Trees,
};

function getNextMonday(): Date {
  const now = new Date();
  const dow = now.getDay();
  const daysUntilMonday = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  const nextMon = new Date(now);
  nextMon.setDate(nextMon.getDate() + daysUntilMonday);
  nextMon.setHours(0, 0, 0, 0);
  return nextMon;
}

function QuickBuildModal({ visible, onClose, onTemplateSelect }: QuickBuildModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedTemplate, setSelectedTemplate] = useState<ScheduleTemplate | null>(null);
  const [selectedSize, setSelectedSize] = useState<ProjectSize>('medium');

  const startDate = useMemo(() => getNextMonday(), []);

  const handleSelectTemplate = useCallback((template: ScheduleTemplate) => {
    setSelectedTemplate(template);
    setStep(2);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleSelectSize = useCallback((size: ProjectSize) => {
    setSelectedSize(size);
    setStep(3);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const scaledTemplate = useMemo<ScheduleTemplate | null>(() => {
    if (!selectedTemplate) return null;
    const factor = SIZE_LABELS[selectedSize].factor;
    return {
      ...selectedTemplate,
      tasks: selectedTemplate.tasks.map(t => ({
        ...t,
        duration: t.isMilestone ? 0 : Math.max(1, Math.round(t.duration * factor)),
      })),
    };
  }, [selectedTemplate, selectedSize]);

  const totalDuration = useMemo(() => {
    if (!scaledTemplate) return 0;
    return scaledTemplate.tasks.reduce((sum, t) => sum + t.duration, 0);
  }, [scaledTemplate]);

  const handleCreate = useCallback(() => {
    if (!scaledTemplate) return;
    onTemplateSelect(scaledTemplate, startDate);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep(1);
    setSelectedTemplate(null);
    setSelectedSize('medium');
  }, [scaledTemplate, startDate, onTemplateSelect]);

  const handleClose = useCallback(() => {
    setStep(1);
    setSelectedTemplate(null);
    setSelectedSize('medium');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={handleClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Zap size={20} color={Colors.accent} />
              <Text style={s.headerTitle}>Quick Build</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <X size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={s.stepIndicator}>
            {[1, 2, 3].map(n => (
              <View key={n} style={[s.stepDot, step >= n && s.stepDotActive]} />
            ))}
          </View>

          {step === 1 && (
            <>
              <Text style={s.stepTitle}>What type of project?</Text>
              <ScrollView showsVerticalScrollIndicator={false} style={s.scrollContent}>
                {SCHEDULE_TEMPLATES.map(template => {
                  const Icon = TEMPLATE_ICONS[template.id] ?? Wrench;
                  return (
                    <TouchableOpacity
                      key={template.id}
                      style={s.templateCard}
                      onPress={() => handleSelectTemplate(template)}
                      activeOpacity={0.7}
                    >
                      <View style={s.templateIconWrap}>
                        <Icon size={18} color={Colors.primary} />
                      </View>
                      <View style={s.templateInfo}>
                        <Text style={s.templateName}>{template.name}</Text>
                        <Text style={s.templateMeta}>{template.taskCount} tasks · {template.typicalDuration}</Text>
                      </View>
                      <ChevronRight size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={s.stepTitle}>How big is the project?</Text>
              <Text style={s.stepSubtitle}>{selectedTemplate?.name}</Text>
              <View style={s.sizeOptions}>
                {(Object.keys(SIZE_LABELS) as ProjectSize[]).map(size => {
                  const info = SIZE_LABELS[size];
                  const isActive = selectedSize === size;
                  return (
                    <TouchableOpacity
                      key={size}
                      style={[s.sizeCard, isActive && s.sizeCardActive]}
                      onPress={() => handleSelectSize(size)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.sizeLabel, isActive && s.sizeLabelActive]}>{info.label}</Text>
                      <Text style={[s.sizeDesc, isActive && s.sizeDescActive]}>{info.desc}</Text>
                      <Text style={[s.sizeFactor, isActive && s.sizeFactorActive]}>{info.factor}x</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {step === 3 && scaledTemplate && (
            <>
              <Text style={s.stepTitle}>Review & Go</Text>
              <View style={s.reviewCard}>
                <Text style={s.reviewLabel}>Template</Text>
                <Text style={s.reviewValue}>{scaledTemplate.name}</Text>
              </View>
              <View style={s.reviewRow}>
                <View style={s.reviewCard}>
                  <Text style={s.reviewLabel}>Tasks</Text>
                  <Text style={s.reviewValue}>{scaledTemplate.tasks.length}</Text>
                </View>
                <View style={s.reviewCard}>
                  <Text style={s.reviewLabel}>Est. Duration</Text>
                  <Text style={s.reviewValue}>{totalDuration}d</Text>
                </View>
                <View style={s.reviewCard}>
                  <Text style={s.reviewLabel}>Size</Text>
                  <Text style={s.reviewValue}>{SIZE_LABELS[selectedSize].label}</Text>
                </View>
              </View>
              <View style={s.reviewCard}>
                <Text style={s.reviewLabel}>Start Date</Text>
                <Text style={s.reviewValue}>
                  {startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </Text>
              </View>

              <ScrollView style={s.taskPreview} showsVerticalScrollIndicator={false}>
                {scaledTemplate.tasks.filter(t => !t.isMilestone).map(t => (
                  <View key={t.id} style={s.previewRow}>
                    <Text style={s.previewName} numberOfLines={1}>{t.name}</Text>
                    <Text style={s.previewDur}>{t.duration}d</Text>
                  </View>
                ))}
              </ScrollView>

              <TouchableOpacity style={s.createBtn} onPress={handleCreate} activeOpacity={0.85}>
                <Zap size={16} color="#FFF" />
                <Text style={s.createBtnText}>Create Schedule</Text>
              </TouchableOpacity>
            </>
          )}

          {step > 1 && (
            <TouchableOpacity style={s.backBtn} onPress={() => setStep(prev => (prev - 1) as 1 | 2 | 3)}>
              <Text style={s.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
    gap: 10,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.fillTertiary, alignSelf: 'center', marginBottom: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },

  stepIndicator: { flexDirection: 'row', gap: 6, alignSelf: 'center' },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.fillTertiary },
  stepDotActive: { backgroundColor: Colors.primary },

  stepTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  stepSubtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: -4 },

  scrollContent: { maxHeight: 380 },

  templateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  templateIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateInfo: { flex: 1, gap: 2 },
  templateName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  templateMeta: { fontSize: 12, color: Colors.textSecondary },

  sizeOptions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  sizeCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 16,
    padding: 18,
    gap: 6,
    borderWidth: 2,
    borderColor: Colors.borderLight,
  },
  sizeCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  sizeLabel: { fontSize: 16, fontWeight: '800' as const, color: Colors.text },
  sizeLabelActive: { color: Colors.primary },
  sizeDesc: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center' as const },
  sizeDescActive: { color: Colors.primary },
  sizeFactor: { fontSize: 13, fontWeight: '700' as const, color: Colors.textMuted },
  sizeFactorActive: { color: Colors.primary },

  reviewCard: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    padding: 12,
    gap: 2,
    flex: 1,
  },
  reviewRow: { flexDirection: 'row', gap: 8 },
  reviewLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  reviewValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },

  taskPreview: { maxHeight: 200, marginTop: 4 },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  previewName: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '500' as const },
  previewDur: { fontSize: 12, fontWeight: '700' as const, color: Colors.textMuted },

  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    marginTop: 6,
  },
  createBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#FFF' },

  backBtn: { alignSelf: 'center', paddingVertical: 8 },
  backBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
});

export default React.memo(QuickBuildModal);
