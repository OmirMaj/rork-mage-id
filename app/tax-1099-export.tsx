// Year-end 1099-NEC export — the report a CPA actually wants.
//
// Rolls up sub payments by subcontractor for a chosen calendar year,
// flags every recipient owed a 1099 (>= $600), and exports a CSV the
// CPA can map into their own template (Bench / Pilot / TurboTax for
// Business / paper Form 1099-NEC). Surfaces TIN-missing, address-blank,
// W-9-not-on-file warnings inline so the GC can chase the data BEFORE
// year-end instead of in February.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  ChevronLeft, FileSpreadsheet, Calendar, AlertTriangle, CheckCircle2, Share2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { buildTax1099Dataset, tax1099DatasetToCsv, type Tax1099Row } from '@/utils/tax1099Export';
import type { SubSubmittedInvoice } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function Tax1099ExportScreen() {
  const insets = useSafeAreaInsets();
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
        .select('id,sub_portal_id,project_id,subcontractor_id,commitment_id,invoice_number,amount,retention_amount,status,created_at,reviewed_at,paid_at')
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
      Alert.alert('Export failed', (err as Error).message ?? 'Could not generate CSV.');
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
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: Tokens.spacing.xxs }}>
              <ChevronLeft size={24} color={Colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <FileSpreadsheet size={20} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Year-end 1099-NEC export</Text>
          <Text style={styles.heroBody}>
            Sub-payments rolled up for the year, flagged for who needs a 1099 (paid &ge; $600), with TIN / W-9 / address gaps surfaced. Hand the CSV to your CPA — they map it into their template.
          </Text>
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
              <Calendar size={12} color={year === y ? '#FFF' : Colors.textMuted} />
              <Text style={[styles.yearChipText, year === y && styles.yearChipTextActive]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loadingInvoices ? (
          <View style={styles.busyWrap}>
            <ActivityIndicator color={Colors.primary} />
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

            {(totals.missingTin > 0 || totals.missingW9 > 0 || totals.missingAddress > 0) && (
              <View style={styles.warnBanner}>
                <AlertTriangle size={14} color="#7A4500" />
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
              rows.map(r => (
                <View key={r.subcontractorId} style={[styles.row, !r.required1099 && r.totalPaid <= 0 && { opacity: 0.5 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{r.recipientName}</Text>
                    <Text style={styles.rowMeta}>
                      {r.totalPaid > 0
                        ? `$${r.totalPaid.toLocaleString(undefined, { maximumFractionDigits: 2 })} · ${r.paymentCount} payment${r.paymentCount === 1 ? '' : 's'}`
                        : 'No payments this year'}
                    </Text>
                    {r.notes ? <Text style={styles.rowNotes}>{r.notes}</Text> : null}
                  </View>
                  {r.required1099 && (
                    <View style={[styles.flag, { backgroundColor: Colors.warning + '20', borderColor: Colors.warning }]}>
                      <Text style={[styles.flagText, { color: Colors.warning }]}>1099</Text>
                    </View>
                  )}
                  {!r.required1099 && r.totalPaid > 0 && (
                    <View style={[styles.flag, { backgroundColor: Colors.success + '14', borderColor: Colors.success }]}>
                      <CheckCircle2 size={11} color={Colors.success} />
                    </View>
                  )}
                </View>
              ))
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
                    <Share2 size={16} color="#FFF" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: {
    margin: Tokens.spacing.md, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '20',
  },
  heroIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Tokens.spacing.sm,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: Colors.text, marginBottom: Tokens.spacing.xs },
  heroBody: { fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 19 },
  sectionLabel: {
    marginHorizontal: Tokens.spacing.md, marginTop: Tokens.spacing.xs, marginBottom: 6,
    fontSize: Type.caption1.fontSize, fontWeight: '800', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  yearRow: { flexDirection: 'row', gap: Tokens.spacing.xs, paddingHorizontal: Tokens.spacing.md, marginBottom: Tokens.spacing.sm },
  yearChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: 7, borderRadius: 999,
    backgroundColor: Colors.fillTertiary, borderWidth: 1, borderColor: Colors.border,
  },
  yearChipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  yearChipText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.text },
  yearChipTextActive: { color: '#FFF' },
  busyWrap: { padding: Tokens.spacing.xl, alignItems: 'center', gap: Tokens.spacing.xs },
  busyText: { fontSize: Type.caption1.fontSize, color: Colors.textMuted },
  summaryGrid: { flexDirection: 'row', gap: Tokens.spacing.xs, marginHorizontal: Tokens.spacing.md, marginBottom: Tokens.spacing.sm },
  summaryCell: {
    flex: 1, padding: 14, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  summaryValue: { fontSize: Type.title2.fontSize, fontWeight: '800', color: Colors.text },
  summaryLabel: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.xxs },
  warnBanner: {
    flexDirection: 'row', gap: Tokens.spacing.xs, alignItems: 'flex-start',
    marginHorizontal: Tokens.spacing.md, marginBottom: Tokens.spacing.sm, padding: Tokens.spacing.sm,
    borderRadius: Tokens.radius.md, backgroundColor: '#FFF4E0',
    borderWidth: 1, borderColor: Colors.warning + '40',
  },
  warnTitle: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: '#7A4500', marginBottom: Tokens.spacing.hairline },
  warnBody: { fontSize: Type.caption2.fontSize, color: '#7A4500', lineHeight: 16 },
  emptyCard: {
    margin: Tokens.spacing.md, padding: Tokens.spacing.md, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.fillTertiary, borderWidth: 1, borderColor: Colors.border,
  },
  emptyText: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: Tokens.spacing.md, marginBottom: 6, padding: Tokens.spacing.sm,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: Colors.text },
  rowMeta: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },
  rowNotes: { fontSize: 11, color: '#7A4500', marginTop: Tokens.spacing.xxs, fontStyle: 'italic' },
  flag: { paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs, borderRadius: 999, borderWidth: 1 },
  flagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs,
    marginHorizontal: Tokens.spacing.md, marginTop: 14,
    paddingVertical: 14, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary,
  },
  exportBtnText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '700' },
  disclaimerText: {
    marginHorizontal: Tokens.spacing.md, marginTop: Tokens.spacing.sm,
    fontSize: 11, color: Colors.textMuted, lineHeight: 16, fontStyle: 'italic',
  },
});
