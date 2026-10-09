import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ShieldAlert, FileText, Download, AlertTriangle, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSafety } from '@/contexts/SafetyContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  buildOsha300Log, OSHA_CLASS_LABEL, buildOsha300ATotals, prefillHoursFromTimeEntries,
  osha300ARates, type Osha300ASummaryInput, availableOshaYears, currentOshaYear,
  incidentsForOwnEstablishment, hoursEntriesForOwnEstablishment, recordablesWithUnreadableDates,
} from '@/utils/safety/oshaLog';
import { useTimeEntriesMirror } from '@/hooks/useLaborRates';
import { Card, Button, StatusPill } from '@/components/ui';
import { exportOsha300Pdf, shareOsha300Csv } from '@/utils/safety/oshaExport';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { showAlert } from '@/utils/alert';
import { pdfFailureMessage } from '@/utils/platformFile';
import { useT } from '@/contexts/LanguageContext';
import { t } from '@/i18n/core';

/** "Missing … : tap to fix" as one sentence per combination (docs/I18N.md §3.5).
 *  `missing` holds oshaRowFromIncident's English field names. */
function missingLine(missing: string[]): string {
  const name = missing.includes('employee name');
  const title = missing.includes('job title');
  if (missing.length === 2 && name && title) return t('safety.osha.missingNameAndTitle', 'Missing employee name and job title: tap to fix');
  if (missing.length === 1 && name) return t('safety.osha.missingName', 'Missing employee name: tap to fix');
  if (missing.length === 1 && title) return t('safety.osha.missingTitle', 'Missing job title: tap to fix');
  return `Missing ${missing.join(' and ')}: tap to fix`;
}

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
  const { t, tn } = useT();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { incidents, refresh } = useSafety();
  // The log re-reads on focus (audit #119), so a foreman's newly filed
  // recordable case is on it without a relaunch.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const { settings, projects } = useProjects();
  const { user } = useAuth();

  // His establishment's cases only: incidents on projects he owns. A case he
  // filed as an invited foreman on his GC's job is the GC's record, not a row
  // on his own company's 300 (audit #82).
  const scopedIncidents = useMemo(() => {
    const own = incidentsForOwnEstablishment(incidents, projects, user?.id);
    return projectId ? own.filter((i) => i.projectId === projectId) : own;
  }, [incidents, projects, user?.id, projectId]);
  // OSHA 300 logs must be retained for 5 years and are routinely pulled for a
  // PRIOR year (audits, insurance, EMR). Offer any year that has a recordable
  // case, plus the current year (so a fresh year's log is reachable even before
  // its first case). Newest first; the current year is the default selection.
  // Same helper the Safety hub's tile counts with, so the two agree (#169).
  const currentYear = currentOshaYear();
  // Only a readable YYYY-MM-DD makes a year: a typed '9/18/26' used to add a
  // '9/18' chip (#168).
  const availableYears = useMemo(() => availableOshaYears(scopedIncidents, currentYear), [scopedIncidents, currentYear]);
  // Recordable cases no year's log can read. Counted as recordable everywhere
  // else, so they are named here instead of vanishing from every year.
  const undatedCases = useMemo(() => recordablesWithUnreadableDates(scopedIncidents), [scopedIncidents]);

  const [selectedYear, setSelectedYear] = useState(currentYear);
  // Keep the selection valid if the underlying incident set changes.
  const year = availableYears.includes(selectedYear) ? selectedYear : currentYear;

  // The establishment is HIS company: settings.branding.companyName, the name
  // on every document he sends (audit #86). This used to read
  // useCompanies().companies — the PUBLIC marketplace directory, readable by
  // every signed-in user — so the legal form printed 'My Company', whoever
  // registered a directory profile most recently, or 'All establishments'
  // once a second stranger did. With no name set there is nothing true to
  // print, so the exports are disabled below and say why.
  const companyName = (settings?.branding?.companyName ?? '').trim();
  const est = useMemo(() => ({ name: companyName, year }), [companyName, year]);
  const rows = useMemo(() => buildOsha300Log(scopedIncidents, est.year), [scopedIncidents, est.year]);

  // ── 300A summary (audit round 2 #4) ──────────────────────────────────────
  // Column totals need nothing new — they are sums over `rows`.
  const totals = useMemo(() => buildOsha300ATotals(rows), [rows]);
  // Hours are READ-ONLY from the time-tracking mirror, and only ever a pre-fill.
  // Scoped to the same project filter as the case list: dividing one job's
  // cases by the whole company's hours would print a rate that is simply wrong.
  // And to the same ESTABLISHMENT as the case list (audit #124): his own
  // shifts on a job another GC owns are that GC's hours, exactly as the cases
  // there are that GC's cases — counting them only in the denominator
  // understated his rates.
  const timeEntries = useTimeEntriesMirror();
  const prefill = useMemo(
    () => prefillHoursFromTimeEntries(
      hoursEntriesForOwnEstablishment(timeEntries, projects, user?.id),
      est.year,
      projectId || undefined,
    ),
    [timeEntries, projects, user?.id, est.year, projectId],
  );
  // Edited values keyed by year+scope, so switching the year never carries last
  // year's confirmed hours onto this year's rate.
  const scopeKey = `${est.year}:${projectId ?? 'all'}`;
  const [hoursEdit, setHoursEdit] = useState<Record<string, string>>({});
  const [employeesEdit, setEmployeesEdit] = useState<Record<string, string>>({});
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const hoursText = hoursEdit[scopeKey] ?? (prefill.totalHours > 0 ? String(prefill.totalHours) : '');
  const employeesText = employeesEdit[scopeKey] ?? (prefill.averageEmployees > 0 ? String(prefill.averageEmployees) : '');
  const hoursNum = Number(hoursText.replace(/,/g, '')) || 0;
  const employeesNum = Number(employeesText.replace(/,/g, '')) || 0;
  const confirmed = confirmedKey === scopeKey && hoursNum > 0;
  const hoursEdited = hoursEdit[scopeKey] !== undefined;
  // Rates exist only over a CONFIRMED denominator. Before that there is no rate
  // on screen at all — an auto-filled hours total from app clock-ins alone runs
  // low, and a low denominator inflates TRIR.
  const rates = useMemo(() => (confirmed ? osha300ARates(totals, hoursNum) : null), [confirmed, totals, hoursNum]);
  const projectScoped = !!projectId;
  const summaryInput = useMemo<Osha300ASummaryInput | undefined>(() => (confirmed ? {
    hoursWorked: hoursNum,
    averageEmployees: employeesNum,
    // i18n-keep-english: printed on the OSHA 300A PDF, which stays in English
    hoursSource: hoursEdited ? 'Hours entered by hand.' : prefill.sourceLabel,
    projectScoped,
  } : undefined), [confirmed, hoursNum, employeesNum, hoursEdited, prefill.sourceLabel, projectScoped]);

  const exportBlocked = companyName ? null : t('safety.osha.exportBlocked', 'Add your company name in Settings to print the OSHA 300.');

  const handleExportPdf = useCallback(async () => {
    if (!companyName) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    try {
      await exportOsha300Pdf(scopedIncidents, est, summaryInput);
    } catch (err) {
      // CONTRACT 25 (#147): a blocked web window throws the blocked sentence.
      showAlert(t('safety.osha.exportFailed', 'Export Failed'), pdfFailureMessage(err, t('safety.osha.pdfFailed', "Couldn't create the OSHA 300 PDF. Try again.")));
    }
  }, [scopedIncidents, est, summaryInput, companyName, t]);

  const handleExportCsv = useCallback(async () => {
    if (!companyName) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    try {
      await shareOsha300Csv(scopedIncidents, est);
    } catch {
      showAlert(t('safety.osha.exportFailed', 'Export Failed'), t('safety.osha.couldntCreateTheOsha', "Couldn't create the OSHA 300 CSV. Try again."));
    }
  }, [scopedIncidents, est, companyName, t]);

  // A row opens its incident for the fix — the 300 row missing a name used to
  // be a plain View, so he had to go find the case in the incidents list.
  const openCase = useCallback((incidentId: string) => {
    const inc = scopedIncidents.find((i) => i.id === incidentId);
    if (!inc?.projectId) return;
    router.push({ pathname: '/safety-incidents', params: { projectId: inc.projectId, incidentId } });
  }, [scopedIncidents, router]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: t('safety.osha.osha300Log', 'OSHA 300 Log') }} />
      <ScrollView {...fabScroll} contentContainerStyle={[{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryEyebrow}>{t('safety.osha.oshaForm300', 'OSHA Form 300')}</Text>
              <Text style={[styles.summaryTitle, !companyName && styles.summaryTitleMissing]}>
                {companyName || t('safety.osha.companyNameNotSet', 'Company Name Not Set')}
              </Text>
              <Text style={styles.summarySub}>{t('safety.osha.logYear', 'Log year {year}', { year: est.year })}</Text>
            </View>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeNum}>{rows.length}</Text>
              <Text style={styles.countBadgeLabel}>{t('safety.osha.recordableBadge', 'recordable')}</Text>
            </View>
          </View>
          <Text style={styles.derivedNote}>
            {t('safety.osha.caseClassificationAndDay', "Case classification and day counts are read from each incident's recorded OSHA outcome fields (fatality, days away, restriction, illness type). Only recordable cases from {year} are shown. Verify against your recordkeeping before posting.", { year: est.year })}
          </Text>
        </View>

        {availableYears.length > 1 ? (
          <View style={styles.yearSection}>
            <Text style={styles.yearLabel}>{t('safety.osha.logYearLabel', 'Log Year')}</Text>
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

        {/* Export PDF shows with ZERO cases too: a zero-case establishment still
            posts a 300A, and the PDF prints the "No recordable cases" 300 page
            plus the 300A once hours are confirmed. CSV is the case rows only,
            so it waits for a case. */}
        {exportBlocked ? (
          <View style={styles.blockedBanner} testID="osha-export-blocked">
            <AlertTriangle size={14} color={themeColors.warningLabel} strokeWidth={1.9} />
            <Text style={styles.blockedText}>{exportBlocked}</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/settings' as never)} accessibilityRole="button" accessibilityLabel={t('safety.osha.openSettings', 'Open Settings')} hitSlop={8}>
              <Text style={styles.blockedLink}>{t('safety.osha.openSettings', 'Open Settings')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {undatedCases.length > 0 ? (
          <View style={styles.blockedBanner} testID="osha-undated-cases">
            <AlertTriangle size={14} color={themeColors.warningLabel} strokeWidth={1.9} />
            <Text style={styles.blockedText}>
              {tn('safety.osha.recordableCasesHaveA', undatedCases.length, { one: "{count} recordable case has a date that needs fixing, so it is on no year's log. Tap to fix:", other: "{count} recordable cases have a date that needs fixing, so they are on no year's log. Tap to fix:" })}
            </Text>
            {undatedCases.map((inc) => (
              <TouchableOpacity key={inc.id} onPress={() => openCase(inc.id)} accessibilityRole="button" accessibilityLabel={t('safety.osha.fixThisCasesDate', "Fix This Case's Date")} hitSlop={6}>
                <Text style={styles.blockedLink} numberOfLines={1}>
                  {t('safety.osha.undatedCaseLink', '"{date}" · {description}', {
                    date: inc.occurredAt || t('safety.osha.noDate', 'no date'),
                    description: inc.description || t('safety.osha.untitledCase', 'Untitled case'),
                  })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <View style={styles.exportRow}>
          <TouchableOpacity
            style={[styles.exportPrimary, exportBlocked ? styles.exportDisabled : null]}
            onPress={handleExportPdf}
            disabled={!!exportBlocked}
            accessibilityState={{ disabled: !!exportBlocked }}
            activeOpacity={0.85}
            testID="osha-export-pdf"
          >
            <FileText size={16} color="#FFFFFF" strokeWidth={1.75} />
            <Text style={styles.exportPrimaryText}>{t('safety.osha.exportPdf', 'Export PDF')}</Text>
          </TouchableOpacity>
          {rows.length > 0 ? (
            <TouchableOpacity
              style={[styles.exportSecondary, exportBlocked ? styles.exportDisabled : null]}
              onPress={handleExportCsv}
              disabled={!!exportBlocked}
              accessibilityState={{ disabled: !!exportBlocked }}
              activeOpacity={0.85}
              testID="osha-export-csv"
            >
              <Download size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.exportSecondaryText}>{t('safety.osha.exportCsv', 'Export CSV')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {rows.length > 0 ? (
          <>
            {rows.map((r) => (
              <TouchableOpacity
                key={r.incidentId}
                style={styles.row}
                onPress={() => openCase(r.incidentId)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('safety.osha.openCase', 'Open case {caseNo}', { caseNo: r.caseNo })}
                testID={`osha-row-${r.caseNo}`}
              >
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
                  {r.missing.length > 0 ? (
                    <Text style={styles.rowMissing}>{missingLine(r.missing)}</Text>
                  ) : null}
                </View>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))}
          </>
        ) : (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<ShieldAlert size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title={t('safety.osha.noRecordableCasesIn', 'No Recordable Cases in {year}', { year: est.year })}
              // This used to send him to a second screen to type the case a
              // second time from memory — which is what made the 300 come up
              // short: the injury he wrote on the daily report at 4:30pm never
              // left that report. It does now (DFR-OSHA-BRIDGE in
              // app/daily-report.tsx), so say where cases come from rather than
              // naming one screen as the only door.
              message={
                availableYears.length > 1
                  ? t('safety.osha.emptyPickYear', 'Pick another log year above. OSHA-recordable cases land here from the incidents log and the Safety block on a daily report.')
                  : t('safety.osha.emptyHowCasesLand', 'Cases land here from the incidents log and the Safety block on a daily report, once the 1904 criteria make them recordable.')
              }
            />
          </View>
        )}

        {/* 300A summary. Always rendered: an establishment with zero cases still
            completes, certifies and posts a 300A. */}
        <Card style={styles.summary300A} testID="osha-300a">
          <Text style={styles.summaryEyebrow}>{projectScoped ? t('safety.osha.projectSummary', 'Project Summary') : t('safety.osha.oshaForm300a', 'OSHA Form 300A')}</Text>
          <Text style={styles.summary300ATitle}>
            {projectScoped ? t('safety.osha.projectTotals', 'Project Totals {year}', { year: est.year }) : t('safety.osha.annualSummary', 'Annual Summary {year}', { year: est.year })}
          </Text>
          {projectScoped ? (
            <Text style={styles.derivedNote}>
              {t('safety.osha.openedForOneProject', 'Opened for one project, so this is a project rate, not the establishment 300A. Open the OSHA log from the Safety hub with no project selected for the certifiable summary.')}
            </Text>
          ) : null}

          <View style={styles.totalsGrid}>
            {/* i18n-keep-english: OSHA Form 300A column letters and names, as printed on the federal form */}
            {[
              ['G · Deaths', totals.deaths],
              ['H · Days-Away Cases', totals.daysAwayCases],
              ['I · Restriction Cases', totals.restrictedCases],
              ['J · Other Cases', totals.otherCases],
              ['K · Days Away', totals.totalDaysAway],
              ['L · Days Restricted', totals.totalDaysRestricted],
              ['M1 · Injuries', totals.byType.injury],
              ['M2 · Skin', totals.byType.skin],
              ['M3 · Respiratory', totals.byType.respiratory],
              ['M4 · Poisoning', totals.byType.poisoning],
              ['M5 · Hearing Loss', totals.byType.hearing],
              ['M6 · Other Illness', totals.byType.other_illness],
            ].map(([label, value]) => (
              <View key={String(label)} style={styles.totalCell}>
                <Text style={styles.totalValue}>{value}</Text>
                <Text style={styles.totalLabel}>{label}</Text>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{t('safety.osha.totalHoursWorked', 'Total Hours Worked')}</Text>
              <TextInput
                style={styles.input}
                value={hoursText}
                onChangeText={(v) => { setHoursEdit((m) => ({ ...m, [scopeKey]: v })); setConfirmedKey(null); }}
                placeholder={t('safety.osha.fromPayroll', 'From payroll')}
                placeholderTextColor={themeColors.textMuted}
                keyboardType="number-pad"
                testID="osha-300a-hours"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>{t('safety.osha.averageEmployees', 'Average Employees')}</Text>
              <TextInput
                style={styles.input}
                value={employeesText}
                onChangeText={(v) => { setEmployeesEdit((m) => ({ ...m, [scopeKey]: v })); setConfirmedKey(null); }}
                placeholder={t('safety.osha.annualAverage', 'Annual average')}
                placeholderTextColor={themeColors.textMuted}
                keyboardType="number-pad"
                testID="osha-300a-employees"
              />
            </View>
          </View>
          <Text style={styles.derivedNote}>{hoursEdited ? t('safety.osha.hoursEnteredByHand', 'Hours entered by hand.') : prefill.sourceLabel}</Text>

          {confirmed && rates ? (
            <View style={styles.ratesRow}>
              {/* i18n-keep-english: OSHA rate acronyms (TRIR, DART) */}
              <StatusPill label={`TRIR ${rates.trir?.toFixed(2) ?? '—'}`} tone="neutral" />
              {/* i18n-keep-english: OSHA rate acronyms (TRIR, DART) */}
              <StatusPill label={`DART ${rates.dart?.toFixed(2) ?? '—'}`} tone="neutral" />
            </View>
          ) : (
            <>
              <Button
                label={t('safety.osha.confirmHoursToShow', 'Confirm Hours to Show TRIR and DART')}
                variant="secondary"
                onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  setConfirmedKey(scopeKey);
                }}
                disabled={hoursNum <= 0}
                testID="osha-300a-confirm"
              />
              <Text style={styles.derivedNote}>
                {hoursNum <= 0
                  ? t('safety.osha.enterHoursFirst', 'Enter total hours worked first. The rates are calculated from them.')
                  : t('safety.osha.ratesHidden', 'Rates stay hidden until you confirm these match payroll: app clock-ins alone usually run low, and low hours make the rate look worse than it is.')}
              </Text>
            </>
          )}
        </Card>
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
  summary300A: { marginHorizontal: 20, marginTop: 8, marginBottom: 16, gap: 10 },
  summary300ATitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  totalsGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  totalCell: { width: '31%' as const, minWidth: 92, paddingVertical: 6 },
  totalValue: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: themeColors.text, fontVariant: ['tabular-nums'] },
  totalLabel: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginBottom: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  ratesRow: { flexDirection: 'row' as const, gap: 8, flexWrap: 'wrap' as const },
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
  yearChipActive: { backgroundColor: themeColors.accentFill, borderColor: themeColors.accent },
  yearChipText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary, fontVariant: ['tabular-nums'] },
  yearChipTextActive: { color: '#FFFFFF' },
  exportRow: { flexDirection: 'row' as const, gap: 10, marginHorizontal: 20, marginBottom: 16 },
  exportPrimary: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill,
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
  rowMissing: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.danger, marginTop: 6 },
  summaryTitleMissing: { color: themeColors.warningLabel },
  exportDisabled: { opacity: 0.45 },
  blockedBanner: {
    marginHorizontal: 20, marginTop: 12, padding: 12, gap: 6, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.warningLabel + '14', borderWidth: 1, borderColor: themeColors.warningLabel + '33',
  },
  blockedText: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },
  blockedLink: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  classPill: {
    alignSelf: 'flex-start' as const, marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
    backgroundColor: themeColors.accent + '14',
  },
  classPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
});
