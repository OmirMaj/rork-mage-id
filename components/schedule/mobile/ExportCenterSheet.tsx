import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, FileText, Hammer, FileStack, Sheet, Share as ShareIcon, CalendarPlus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import type { Project, ScheduleTask, ScheduleBaseline } from '@/types';
import type { CpmResult } from '@/utils/cpm';
import {
  assembleScheduleReport, pickPaperSize,
  type ReportPaperSize, type ReportSectionKey, type ReportOptions,
} from '@/utils/scheduleReportModel';
import { renderScheduleReportHtml } from '@/utils/scheduleReportHtml';
import { generateScheduleReportPdf, shareScheduleCsv, buildScheduleShareUrl } from '@/utils/scheduleReportExport';

const ALL_SECTIONS: ReportSectionKey[] = ['kpis','critPath','risks','lookahead','milestones','gantt','slippages','phaseProgress','weather'];
const SIZES: { key: ReportPaperSize | 'auto'; label: string }[] = [
  { key: 'auto', label: 'Auto' }, { key: 'letter', label: 'Letter' }, { key: 'a4', label: 'A4' },
  { key: 'tabloid', label: 'Tabloid' }, { key: 'a3', label: 'A3' }, { key: 'arch_d', label: 'Arch D' }, { key: 'arch_e', label: 'Arch E' },
];

interface Props {
  visible: boolean; onClose: () => void;
  project: Project; tasks: ScheduleTask[]; startDateIso: string; cpm: CpmResult;
  baseline?: ScheduleBaseline | null;
  nonWorkingDates?: string[];
  onExportIcal: () => void;
}

export function ExportCenterSheet({ visible, onClose, project, tasks, startDateIso, cpm, baseline, nonWorkingDates, onExportIcal }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [size, setSize] = useState<ReportPaperSize | 'auto'>('auto');
  const [landscape, setLandscape] = useState(true);
  const [fitOne, setFitOne] = useState(false);
  const [showPred, setShowPred] = useState(false);
  const [sections, setSections] = useState<ReportSectionKey[]>(ALL_SECTIONS);

  const resolveSize = (sz: ReportPaperSize | 'auto'): ReportPaperSize => sz === 'auto' ? pickPaperSize(tasks.filter((t) => !t.isSummary).length) : sz;

  const runReport = async (override?: { paperSizeChoice?: ReportPaperSize | 'auto'; secs?: ReportSectionKey[]; singleWallSheet?: boolean; showPredecessors?: boolean }) => {
    if (busy) return;
    setBusy(true);
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const model = assembleScheduleReport({ project, tasks, startDateIso, cpm, baseline, nonWorkingDates });
      const opts: ReportOptions = {
        paperSize: resolveSize(override?.paperSizeChoice ?? size),
        orientation: landscape ? 'landscape' : 'portrait',
        sections: override?.secs ?? sections,
        fitToOnePage: fitOne,
        showPredecessors: override?.showPredecessors ?? showPred,
        singleWallSheet: override?.singleWallSheet ?? false,
      };
      const html = renderScheduleReportHtml(model, opts);
      await generateScheduleReportPdf(html, `${project.name} — Schedule Report`);
      onClose();
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Please try again.');
    } finally { setBusy(false); }
  };

  const runCsv = async () => { if (busy) return; setBusy(true); try { await shareScheduleCsv(tasks, new Date(startDateIso), project.name); onClose(); } catch (e) { Alert.alert('Export failed', e instanceof Error ? e.message : 'Try again.'); } finally { setBusy(false); } };
  const runShare = async () => {
    const url = buildScheduleShareUrl(project.name, new Date(startDateIso), tasks);
    if (!url) { Alert.alert('Schedule too large', 'This schedule is too large for a quick link — export a PDF instead.'); return; }
    try { const { Share } = await import('react-native'); await Share.share({ message: `${project.name} schedule: ${url}`, url }); onClose(); } catch { /* cancelled */ }
  };

  const toggleSection = (k: ReportSectionKey) => setSections((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '88%' }]}>
        <View style={styles.grab} />
        <View style={styles.headRow}><Text style={styles.title}>Export schedule</Text><TouchableOpacity onPress={onClose}><X size={20} color={colors.textMuted} strokeWidth={1.75} /></TouchableOpacity></View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.section}>One-tap</Text>
          <Preset icon={<FileText size={18} color={colors.accent} strokeWidth={1.75} />} label="Client Report" sub="A3 · summary + gantt · for the owner" onPress={() => runReport({ paperSizeChoice: 'a3', secs: ['kpis','critPath','risks','milestones','gantt','phaseProgress'] })} styles={styles} />
          <Preset icon={<Hammer size={18} color={colors.accent} strokeWidth={1.75} />} label="Field Gantt" sub="Arch D · look-ahead + big gantt · trailer wall" onPress={() => runReport({ paperSizeChoice: 'arch_d', secs: ['kpis','lookahead','risks','gantt'], singleWallSheet: true })} styles={styles} />
          <Preset icon={<FileStack size={18} color={colors.accent} strokeWidth={1.75} />} label="Full Dossier" sub="Auto size · everything + task register" onPress={() => runReport({ paperSizeChoice: 'auto', secs: [...ALL_SECTIONS, 'register'], showPredecessors: true })} styles={styles} />
          <Preset icon={<Sheet size={18} color={colors.accent} strokeWidth={1.75} />} label="CSV" sub="Open in Excel · 1 row per task" onPress={runCsv} styles={styles} />
          <Preset icon={<ShareIcon size={18} color={colors.accent} strokeWidth={1.75} />} label="Share link" sub="Read-only · no login" onPress={runShare} styles={styles} />
          <Preset icon={<CalendarPlus size={18} color={colors.accent} strokeWidth={1.75} />} label="iCal" sub="Add to Apple/Google Calendar" onPress={() => { onExportIcal(); onClose(); }} styles={styles} />

          <TouchableOpacity style={styles.customToggle} onPress={() => setShowCustom((v) => !v)}><Text style={styles.customToggleText}>{showCustom ? '▾ Customize' : '▸ Customize'}</Text></TouchableOpacity>
          {showCustom && (
            <View style={styles.customBox}>
              <Text style={styles.section}>Paper size</Text>
              <View style={styles.chipRow}>{SIZES.map((sz) => (
                <TouchableOpacity key={sz.key} style={[styles.chip, size === sz.key && styles.chipOn]} onPress={() => setSize(sz.key)}><Text style={[styles.chipText, size === sz.key && styles.chipTextOn]}>{sz.label}</Text></TouchableOpacity>
              ))}</View>
              <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Landscape</Text><Switch01 on={landscape} onToggle={() => setLandscape((v) => !v)} styles={styles} /></View>
              <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Fit to one page</Text><Switch01 on={fitOne} onToggle={() => setFitOne((v) => !v)} styles={styles} /></View>
              <View style={styles.toggleRow}><Text style={styles.toggleLabel}>Predecessors column</Text><Switch01 on={showPred} onToggle={() => setShowPred((v) => !v)} styles={styles} /></View>
              <Text style={styles.section}>Sections</Text>
              <View style={styles.chipRow}>{ALL_SECTIONS.map((k) => (
                <TouchableOpacity key={k} style={[styles.chip, sections.includes(k) && styles.chipOn]} onPress={() => toggleSection(k)}><Text style={[styles.chipText, sections.includes(k) && styles.chipTextOn]}>{k}</Text></TouchableOpacity>
              ))}</View>
              <TouchableOpacity style={[styles.generateBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => runReport()} testID="generate-report"><Text style={styles.generateBtnText}>{busy ? 'Generating…' : 'Generate PDF'}</Text></TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Preset({ icon, label, sub, onPress, styles }: { icon: React.ReactNode; label: string; sub: string; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <TouchableOpacity style={styles.preset} activeOpacity={0.7} onPress={onPress} testID={`preset-${label}`}>
      <View style={styles.presetIcon}>{icon}</View>
      <View style={{ flex: 1 }}><Text style={styles.presetLabel}>{label}</Text><Text style={styles.presetSub}>{sub}</Text></View>
      <Text style={styles.chev}>›</Text>
    </TouchableOpacity>
  );
}
function Switch01({ on, onToggle, styles }: { on: boolean; onToggle: () => void; styles: ReturnType<typeof makeStyles> }) {
  return <TouchableOpacity onPress={onToggle} style={[styles.sw, on && styles.swOn]}><View style={[styles.swKnob, on && styles.swKnobOn]} /></TouchableOpacity>;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, padding: 16 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginBottom: 12 },
  headRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '800' as const, color: t.text },
  section: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 0.5, textTransform: 'uppercase' as const, color: t.textMuted, marginTop: 12, marginBottom: 6 },
  preset: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 11 },
  presetIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  presetLabel: { fontSize: 15, fontWeight: '700' as const, color: t.text },
  presetSub: { fontSize: 11, color: t.textMuted, marginTop: 1 },
  chev: { fontSize: 20, color: t.textMuted },
  customToggle: { paddingVertical: 12 }, customToggleText: { fontSize: 14, fontWeight: '700' as const, color: t.accent },
  customBox: { gap: 4 },
  chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
  chipOn: { backgroundColor: t.accent },
  chipText: { fontSize: 12, fontWeight: '600' as const, color: t.text }, chipTextOn: { color: '#FFFFFF' },
  toggleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 8 },
  toggleLabel: { fontSize: 14, color: t.text },
  sw: { width: 44, height: 26, borderRadius: 13, backgroundColor: t.line, padding: 3 }, swOn: { backgroundColor: t.accent },
  swKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' }, swKnobOn: { alignSelf: 'flex-end' as const },
  generateBtn: { marginTop: 14, backgroundColor: t.accent, borderRadius: Tokens.radius.md, paddingVertical: 13, alignItems: 'center' as const },
  generateBtnText: { fontSize: 15, fontWeight: '800' as const, color: '#FFFFFF' },
});
