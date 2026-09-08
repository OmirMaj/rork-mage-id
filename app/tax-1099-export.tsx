// Year-end 1099-NEC export — the report a CPA actually wants.
//
// Rolls up sub payments by subcontractor for a chosen calendar year,
// flags every recipient owed a 1099 (paid >= thresholdForYear(year) — $2,000
// for 2026+, $600 before; MONEY-F4), and exports a CSV the
// CPA can map into their own template (Bench / Pilot / TurboTax for
// Business / paper Form 1099-NEC). Surfaces TIN-missing, address-blank,
// W-9-not-on-file warnings inline so the GC can chase the data BEFORE
// year-end instead of in February.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  ChevronLeft, FileSpreadsheet, Calendar, AlertTriangle, CheckCircle2, Share2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { buildTax1099Dataset, tax1099DatasetToCsv, thresholdInfoForYear, THRESHOLD_PROVISIONAL_NOTE, COVERAGE_NOTE, type Tax1099Row } from '@/utils/tax1099Export';
import type { SubSubmittedInvoice } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

/**
 * The per-row notes, minus the two sentences the screen now renders as their
 * own elements — the coverage disclosure (stated ONCE above the totals) and the
 * undated-commitment figure (its own amber line on the row it belongs to).
 *
 * Both used to arrive only inside this semicolon-joined blob, in 11px italic,
 * on every row: eleven subs carried eleven copies of the same disclosure, and
 * the gaps that actually need chasing — TIN missing, W-9 not on file — read as
 * more of the same noise. Printing a sentence twice, a line apart, on a screen
 * whose whole job is telling a GC which dollar figures he can trust reads as
 * two different facts about the same money.
 *
 * The CSV is untouched: its `Notes` column keeps every segment, because that
 * column is what the CPA parses and the screen is not its editor.
 *
 * Matching is deliberately loose-jointed and FAIL-SAFE. utils/tax1099Export.ts
 * joins with '; ', COVERAGE_NOTE holds no semicolon so it survives as one
 * segment, and the commitment sentence holds exactly one so it splits into a
 * prefixed half and its trailing clause. If either is reworded upstream, the
 * filter stops matching and the sentence comes BACK on the row — visibly
 * duplicated, never silently dropped, which is the direction a tax screen
 * should fail in.
 */
const COMMITMENT_NOTE_PREFIX = 'Commitments record ';
const COMMITMENT_NOTE_TAIL = 'confirm the year against your books';
function notesForScreen(notes: string): string {
  return notes
    .split('; ')
    .filter(n => n !== COVERAGE_NOTE && !n.startsWith(COMMITMENT_NOTE_PREFIX) && n !== COMMITMENT_NOTE_TAIL)
    .join('; ');
}

export default function Tax1099ExportScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { subcontractors, commitments } = useProjects();

  // Default to last calendar year — the year a CPA usually asks for in
  // January / February. User can pick another year via chips.
  const defaultYear = useMemo(() => {
    const now = new Date();
    return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  }, []);
  const [year, setYear] = useState<number>(defaultYear);

  // Sub-submitted invoices live in Supabase only (no per-project
  // ProjectContext slice to read from here). Pull fresh on demand —
  // the dataset is small and only matters when the user is actually
  // generating an export.
  const [subInvoices, setSubInvoices] = useState<SubSubmittedInvoice[] | null>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadSubInvoices = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setSubInvoices([]);
      return;
    }
    setLoadingInvoices(true);
    try {
      const { data, error } = await supabase
        .from('sub_submitted_invoices')
        // MONEY-F4: paid_on (the day money left the account) decides the tax year.
        .select('id,sub_portal_id,project_id,subcontractor_id,commitment_id,invoice_number,amount,retention_amount,status,created_at,reviewed_at,paid_at,paid_on')
        .eq('status', 'paid');
      if (error) throw error;
      const mapped = (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        subPortalId: r.sub_portal_id as string,
        projectId: (r.project_id as string | null) ?? undefined,
        subcontractorId: (r.subcontractor_id as string | null) ?? undefined,
        commitmentId: (r.commitment_id as string | null) ?? undefined,
        invoiceNumber: r.invoice_number as string,
        amount: typeof r.amount === 'string' ? parseFloat(r.amount) : Number(r.amount),
        retentionAmount: r.retention_amount == null ? undefined :
          (typeof r.retention_amount === 'string' ? parseFloat(r.retention_amount) : Number(r.retention_amount)),
        status: r.status as SubSubmittedInvoice['status'],
        createdAt: r.created_at as string,
        reviewedAt: (r.reviewed_at as string | null) ?? undefined,
        paidAt: (r.paid_at as string | null) ?? undefined,
        paidOn: (r.paid_on as string | null) ?? undefined,
      })) as SubSubmittedInvoice[];
      setSubInvoices(mapped);
    } catch (err) {
      console.warn('[1099 export] sub invoice fetch failed', err);
      setSubInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  // Auto-load on mount.
  React.useEffect(() => {
    void loadSubInvoices();
  }, [loadSubInvoices]);

  const rows: Tax1099Row[] = useMemo(() => {
    if (!subInvoices) return [];
    return buildTax1099Dataset({
      year,
      subcontractors,
      commitments,
      subSubmittedInvoices: subInvoices,
    });
  }, [year, subcontractors, commitments, subInvoices]);

  const totals = useMemo(() => {
    const required1099 = rows.filter(r => r.required1099);
    const totalPaid = rows.reduce((sum, r) => sum + r.totalPaid, 0);
    const missingTin = required1099.filter(r => !r.tinLast4).length;
    const missingW9 = required1099.filter(r => !r.w9OnFile).length;
    const missingAddress = required1099.filter(r => !r.address).length;
    return {
      required1099Count: required1099.length,
      totalPaid,
      missingTin,
      missingW9,
      missingAddress,
    };
  }, [rows]);

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur, cur - 1, cur - 2, cur - 3];
  }, []);

  // MONEY-F4: the threshold is a function of the tax year, never a literal.
  // For 2027+ it is the unindexed $2,000 floor and the screen must say so.
  const thresholdInfo = thresholdInfoForYear(year);
  const thresholdLabel = `$${thresholdInfo.amount.toLocaleString('en-US')}`;

  const handleExport = useCallback(async () => {
    setGenerating(true);
    try {
      const csv = tax1099DatasetToCsv(rows);
      if (Platform.OS === 'web') {
        // Web fallback — pop a download.
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mage-id-1099-export-${year}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
        if (!dir) throw new Error('No filesystem available');
        const uri = `${dir}mage-id-1099-export-${year}.csv`;
        await FileSystem.writeAsStringAsync(uri, csv, { encoding: 'utf8' });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: `1099-NEC Export ${year}` });
        }
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      showAlert('Export failed', (err as Error).message ?? 'Could not generate CSV.');
    } finally {
      setGenerating(false);
    }
  }, [rows, year]);

  return (
    <>
      <Stack.Screen
        options={{
          title: '1099-NEC Export',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView {...fabScroll} style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <FileSpreadsheet size={20} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.heroTitle}>Year-end 1099-NEC export</Text>
          <Text style={styles.heroBody}>
            Sub-payments rolled up for the year — net of retention you still hold — flagged for who needs a 1099 (paid &ge; {thresholdLabel} for {year}), with TIN / W-9 / address gaps surfaced. Hand the CSV to your CPA — they map it into their template.
          </Text>
          {thresholdInfo.provisional && (
            <Text style={styles.heroCaveat} testID="threshold-provisional-note">
              {year} threshold is provisional: {THRESHOLD_PROVISIONAL_NOTE}.
            </Text>
          )}
        </View>

        <Text style={styles.sectionLabel}>Tax year</Text>
        <View style={styles.yearRow}>
          {yearOptions.map(y => (
            <TouchableOpacity
              key={y}
              onPress={() => setYear(y)}
              activeOpacity={0.85}
              style={[styles.yearChip, year === y && styles.yearChipActive]}
            >
              <Calendar size={12} color={year === y ? '#FFF' : themeColors.textMuted} strokeWidth={1.75} />
              <Text style={[styles.yearChipText, year === y && styles.yearChipTextActive]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loadingInvoices ? (
          <View style={styles.busyWrap}>
            <ActivityIndicator color={themeColors.accent} />
            <Text style={styles.busyText}>Loading sub payments…</Text>
          </View>
        ) : (
          <>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>{totals.required1099Count}</Text>
                <Text style={styles.summaryLabel}>Subs needing 1099</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>${totals.totalPaid.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                <Text style={styles.summaryLabel}>Total paid {year}</Text>
              </View>
            </View>

            {/* MONEY-1099-COV-1: what "Total paid" actually counts, stated
                directly under the figure it qualifies. The constant was
                exported for the screen and only ever reached the CSV, so a GC
                who pays his subs by check read a tile of zeros, believed the
                Y/N column, and under-filed — the penalty is per form, and the
                only place the limitation was written down was a column of a
                file he never opened. Same sentence the CSV carries, verbatim,
                so the screen and the export cannot drift. */}
            <View style={styles.coverageCard}>
              <Text style={styles.coverageTitle}>What this counts</Text>
              <Text style={styles.coverageBody} testID="coverage-note">{COVERAGE_NOTE}.</Text>
            </View>

            {(totals.missingTin > 0 || totals.missingW9 > 0 || totals.missingAddress > 0) && (
              <View style={styles.warnBanner}>
                <AlertTriangle size={14} color="#7A4500" strokeWidth={1.75} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warnTitle}>Gaps to chase before filing</Text>
                  <Text style={styles.warnBody}>
                    {totals.missingTin > 0 && `${totals.missingTin} sub${totals.missingTin === 1 ? '' : 's'} missing TIN. `}
                    {totals.missingW9 > 0 && `${totals.missingW9} missing W-9. `}
                    {totals.missingAddress > 0 && `${totals.missingAddress} missing address. `}
                    Open the sub in Subs → tap "Edit" to fill in.
                  </Text>
                </View>
              </View>
            )}

            <Text style={styles.sectionLabel}>Recipients</Text>
            {rows.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No subs in your roster yet.</Text>
              </View>
            ) : (
              // A row with undated commitment money is NOT a quiet row —
              // dimming it to half opacity was hiding the one figure that
              // tells the GC his $0 is a coverage gap and not a fact.
              rows.map(r => {
                const screenNotes = notesForScreen(r.notes);
                return (
                <View key={r.subcontractorId} style={[styles.row, !r.required1099 && r.totalPaid <= 0 && r.uncountedCommitmentPaid <= 0 && { opacity: 0.5 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{r.recipientName}</Text>
                    <Text style={styles.rowMeta}>
                      {r.totalPaid > 0
                        ? `$${r.totalPaid.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ${r.paymentCount} payment${r.paymentCount === 1 ? '' : 's'}`
                        : 'No sub-portal payments this year'}
                    </Text>
                    {/* Money the app KNOWS was paid to this sub and cannot put
                        in a tax year — the figure that explains a $0 row to the
                        GC who paid by check. It reached the CSV as its own
                        column and the screen not at all; a number the CPA is
                        told to go confirm is worth nothing if the only place it
                        appears is a file nobody opened. Deliberately outside
                        the counted total, exactly as the dataset keeps it:
                        `paidToDate` is an undated rollup and dating it by
                        guessing is what mis-files a 1099 — hence the
                        instruction to go check the books, which travels with
                        the figure rather than trailing the notes blob below. */}
                    {r.uncountedCommitmentPaid > 0 ? (
                      <Text style={styles.rowUncounted} testID={`uncounted-${r.subcontractorId}`}>
                        {`+ $${r.uncountedCommitmentPaid.toLocaleString(undefined, { maximumFractionDigits: 2 })} recorded on commitments — undated, so not counted above. Confirm the year against your books.`}
                      </Text>
                    ) : null}
                    {screenNotes ? <Text style={styles.rowNotes}>{screenNotes}</Text> : null}
                  </View>
                  {r.required1099 && (
                    <View style={[styles.flag, { backgroundColor: Colors.warning + '20', borderColor: Colors.warning }]}>
                      <Text style={[styles.flagText, { color: Colors.warningLabel }]}>1099</Text>
                    </View>
                  )}
                  {!r.required1099 && r.totalPaid > 0 && (
                    <View style={[styles.flag, { backgroundColor: themeColors.success + '14', borderColor: themeColors.success }]}>
                      <CheckCircle2 size={11} color={themeColors.success} strokeWidth={1.75} />
                    </View>
                  )}
                </View>
                );
              })
            )}

            <TouchableOpacity
              onPress={handleExport}
              disabled={generating || rows.length === 0}
              activeOpacity={0.85}
              style={[styles.exportBtn, (generating || rows.length === 0) && { opacity: 0.6 }]}
            >
              {generating
                ? <ActivityIndicator color="#FFF" />
                : (
                  <>
                    <Share2 size={16} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.exportBtnText}>Export CSV ({year})</Text>
                  </>
                )}
            </TouchableOpacity>

            <Text style={styles.disclaimerText}>
              MAGE ID isn&apos;t a tax-prep tool. We don&apos;t file 1099s for you, don&apos;t verify TIN matches, and don&apos;t compute backup withholding. Hand this CSV to your CPA — they map the columns into the IRS form (paper) or e-file via their service.
            </Text>
          </>
        )}
      </ScrollView>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  hero: {
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  heroIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  // Same reason as rowUncounted below: the hero's ground is `t.accent + '0D'`
  // over `t.bg`, i.e. the theme's, so a literal dark amber disappears into it
  // in dark mode — and this is the line that says the year's threshold is
  // PROVISIONAL, which is the one caveat a CPA must not miss.
  heroCaveat: { marginTop: 8, fontSize: Type.caption1.fontSize, color: t.warningLabel, lineHeight: 17, fontWeight: '600' },
  sectionLabel: {
    marginHorizontal: 16, marginTop: 8, marginBottom: 6,
    fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  yearRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  yearChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  yearChipActive: { backgroundColor: t.text, borderColor: t.text },
  yearChipText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  yearChipTextActive: { color: '#FFF' },
  busyWrap: { padding: 24, alignItems: 'center', gap: 8 },
  busyText: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  summaryGrid: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 12 },
  summaryCell: {
    flex: 1, padding: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  summaryValue: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text },
  summaryLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 4 },
  warnBanner: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    marginHorizontal: 16, marginBottom: 12, padding: 12,
    borderRadius: Tokens.radius.md, backgroundColor: '#FFF4E0',
    borderWidth: 1, borderColor: Colors.warning + '40',
  },
  warnTitle: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: '#7A4500', marginBottom: 2 },
  warnBody: { fontSize: Type.caption2.fontSize, color: '#7A4500', lineHeight: 16 },
  // Neutral, not amber: this is the permanent scope of the export, true on
  // every load, so it must not compete with the warn banner below it — which
  // marks gaps the GC can actually go close.
  coverageCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 12,
    borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  coverageTitle: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4,
  },
  coverageBody: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  emptyCard: {
    margin: 16, padding: 16, borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  emptyText: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 6, padding: 12,
    backgroundColor: t.surface, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
  },
  rowName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  rowMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  // Amber for "reconcile this before you file", at the weight of a figure
  // rather than a footnote — it is a dollar amount the GC has to chase.
  //
  // `t.warningLabel`, NOT the literal #7A4500 the warn banner above uses. That
  // banner paints its own literal cream ground (#FFF4E0), so a fixed dark amber
  // on it is a pinned pair and correct. These two sit on `styles.row`, whose
  // ground is `t.surface` — #14181D in dark, where #7A4500 measures 2.34:1 and
  // the figure the GC is being told to go reconcile is the one line on the
  // screen he cannot read. warningLabel is the theme's label ink for exactly
  // this (#B84A00 light / #FF9500 dark) and clears AA on both.
  rowUncounted: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.warningLabel, marginTop: 4 },
  rowNotes: { fontSize: 11, color: t.warningLabel, marginTop: 4, fontStyle: 'italic' },
  flag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  flagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 14,
    paddingVertical: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
  },
  exportBtnText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '700' },
  disclaimerText: {
    marginHorizontal: 16, marginTop: 12,
    fontSize: 11, color: t.textMuted, lineHeight: 16, fontStyle: 'italic',
  },
});
