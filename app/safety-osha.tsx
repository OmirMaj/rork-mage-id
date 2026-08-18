import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ShieldAlert, FileText, Download } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSafety } from '@/contexts/SafetyContext';
import { useCompanies } from '@/contexts/CompaniesContext';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { buildOsha300Log, OSHA_CLASS_LABEL } from '@/utils/safety/oshaLog';
import { exportOsha300Pdf, shareOsha300Csv } from '@/utils/safety/oshaExport';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { showAlert } from '@/utils/alert';

export default function SafetyOshaScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('safety_management')) {
    return (
      <Paywall
        visible={true}
        feature="Safety Management"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SafetyOshaInner />;
}

function SafetyOshaInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { incidents } = useSafety();
  const { companies } = useCompanies();

  const scopedIncidents = useMemo(
    () => (projectId ? incidents.filter((i) => i.projectId === projectId) : incidents),
    [incidents, projectId],
  );
  // OSHA 300 logs must be retained for 5 years and are routinely pulled for a
  // PRIOR year (audits, insurance, EMR). Offer any year that has a recordable
  // case, plus the current year (so a fresh year's log is reachable even before
  // its first case). Newest first; the current year is the default selection.
  const currentYear = String(new Date().getFullYear());
  const availableYears = useMemo(() => {
    const years = new Set<string>([currentYear]);
    for (const inc of scopedIncidents) {
      if (!inc.oshaRecordable) continue;
      const y = (inc.occurredAt ?? '').slice(0, 4);
      if (y.length === 4) years.add(y);
    }
    return Array.from(years).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [scopedIncidents, currentYear]);

  const [selectedYear, setSelectedYear] = useState(currentYear);
  // Keep the selection valid if the underlying incident set changes.
  const year = availableYears.includes(selectedYear) ? selectedYear : currentYear;

  // OSHA 300 is a per-establishment form. We only have a clean establishment
  // when a single company profile exists (or a project is selected under it);
  // with multiple company profiles and no project, an org-wide log commingles
  // establishments, so we must NOT stamp one company's name over it — title it
  // neutrally instead of falsely branding it as companies[0].
  const est = useMemo(() => {
    const orgWideMultiCompany = !projectId && companies.length > 1;
    const name = orgWideMultiCompany
      ? 'All establishments'
      : (companies[0]?.companyName || 'My Company');
    return { name, year };
  }, [companies, projectId, year]);
  const rows = useMemo(() => buildOsha300Log(scopedIncidents, est.year), [scopedIncidents, est.year]);

  const handleExportPdf = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    try {
      await exportOsha300Pdf(scopedIncidents, est);
    } catch {
      showAlert('Export failed', 'Could not generate the OSHA 300 PDF. Please try again.');
    }
  }, [scopedIncidents, est]);

  const handleExportCsv = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    try {
      await shareOsha300Csv(scopedIncidents, est);
    } catch {
      showAlert('Export failed', 'Could not generate the OSHA 300 CSV. Please try again.');
    }
  }, [scopedIncidents, est]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: 'OSHA 300 Log' }} />
      <ScrollView {...fabScroll} contentContainerStyle={[{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryEyebrow}>OSHA Form 300</Text>
              <Text style={styles.summaryTitle}>{est.name}</Text>
              <Text style={styles.summarySub}>Log year {est.year}</Text>
            </View>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeNum}>{rows.length}</Text>
              <Text style={styles.countBadgeLabel}>recordable</Text>
            </View>
          </View>
          <Text style={styles.derivedNote}>
            Case classification and day counts are read from each incident&apos;s recorded OSHA outcome
            fields (fatality, days away, restriction, illness type). Only recordable cases from {est.year}
            are shown. Verify against your recordkeeping before posting.
          </Text>
        </View>

        {availableYears.length > 1 ? (
          <View style={styles.yearSection}>
            <Text style={styles.yearLabel}>Log year</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearRow}>
              {availableYears.map((y) => {
                const active = y === year;
                return (
                  <TouchableOpacity
                    key={y}
                    style={[styles.yearChip, active && styles.yearChipActive]}
                    onPress={() => {
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                      setSelectedYear(y);
                    }}
                    activeOpacity={0.85}
                    testID={`osha-year-${y}`}
                  >
                    <Text style={[styles.yearChipText, active && styles.yearChipTextActive]}>{y}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {rows.length > 0 ? (
          <>
            <View style={styles.exportRow}>
              <TouchableOpacity style={styles.exportPrimary} onPress={handleExportPdf} activeOpacity={0.85} testID="osha-export-pdf">
                <FileText size={16} color="#FFFFFF" strokeWidth={1.75} />
                <Text style={styles.exportPrimaryText}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.exportSecondary} onPress={handleExportCsv} activeOpacity={0.85} testID="osha-export-csv">
                <Download size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.exportSecondaryText}>Export CSV</Text>
              </TouchableOpacity>
            </View>

            {rows.map((r) => (
              <View key={r.caseNo} style={styles.row}>
                <View style={styles.caseChip}>
                  <Text style={styles.caseChipText}>{r.caseNo}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowEmployee}>{r.employeeName}</Text>
                  <Text style={styles.rowMeta}>
                    {r.dateOfIncident || '—'}
                    {r.jobTitle && r.jobTitle !== '—' ? ` · ${r.jobTitle}` : ''}
                  </Text>
                  {r.description ? (
                    <Text style={styles.rowDesc} numberOfLines={3}>{r.description}</Text>
                  ) : null}
                  <View style={styles.classPill}>
                    <Text style={styles.classPillText}>{OSHA_CLASS_LABEL[r.classification]}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        ) : (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<ShieldAlert size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title={`No recordable cases in ${est.year}`}
              message={
                availableYears.length > 1
                  ? 'Pick another log year above, or add recordable incidents in the Incidents log for OSHA 300 reporting.'
                  : 'Recordable incidents from the Incidents log appear here for OSHA 300 reporting.'
              }
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  // Record lists (certs / incidents / inspections / forms) — desktop gets the
  // viewport rather than a 760px column stranded in the middle.
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
  summaryCard: {
    marginHorizontal: 20, marginTop: 16, marginBottom: 16,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 18,
    borderWidth: 1, borderColor: themeColors.line,
    gap: 12,
  },
  summaryTop: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12 },
  summaryEyebrow: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: themeColors.accent,
    letterSpacing: 0.8, textTransform: 'uppercase' as const,
  },
  summaryTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: themeColors.text, marginTop: 2, letterSpacing: -0.3 },
  summarySub: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  countBadge: {
    alignItems: 'center' as const, justifyContent: 'center' as const,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '14',
    minWidth: 82,
  },
  countBadgeNum: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  countBadgeLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.accent, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  derivedNote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17 },
  yearSection: { marginBottom: 16 },
  yearLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
    marginHorizontal: 20, marginBottom: 8,
  },
  yearRow: { paddingHorizontal: 20, gap: 8 },
  yearChip: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surface,
    borderWidth: 1, borderColor: themeColors.line,
  },
  yearChipActive: { backgroundColor: themeColors.accent, borderColor: themeColors.accent },
  yearChipText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary, fontVariant: ['tabular-nums'] },
  yearChipTextActive: { color: '#FFFFFF' },
  exportRow: { flexDirection: 'row' as const, gap: 10, marginHorizontal: 20, marginBottom: 16 },
  exportPrimary: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent,
  },
  exportPrimaryText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  exportSecondary: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, paddingVertical: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20',
  },
  exportSecondaryText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  row: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12,
    marginHorizontal: 20, marginBottom: 10,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1, borderColor: themeColors.line,
  },
  caseChip: {
    minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 8,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: themeColors.line,
  },
  caseChipText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const, color: themeColors.textSecondary, fontVariant: ['tabular-nums'] },
  rowEmployee: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  rowMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  rowDesc: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 6, lineHeight: 18 },
  classPill: {
    alignSelf: 'flex-start' as const, marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: themeColors.accent + '14',
  },
  classPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
});
