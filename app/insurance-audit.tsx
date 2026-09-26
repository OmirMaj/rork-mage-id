// Insurance audit pack — sub payments vs. workers' comp certificates.
//
// The GC's annual workers' comp premium audit asks one thing about every sub
// he paid: was there a WC certificate covering the day he paid them? This
// screen lines up what MAGE already holds — sub-portal invoices marked paid,
// bills he recorded against a subcontract, and the certificates in the COI
// vault — and states what the records show (utils/insuranceAuditPack). No
// insurance advice, and "can't tell" is never "covered".
//
// Loads sub_submitted_invoices exactly as app/tax-1099-export.tsx does (same
// select list, same mapping) and keeps its load-error honesty: a failed read is
// not an empty year — the headline says the portal half is missing and both
// exports stay disabled until a read succeeds.
//
// Nothing here sends anything: "Ask for the certificate" opens an editable
// draft and the share sheet only on his tap.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import { AlertTriangle, RefreshCw, FileSpreadsheet, FileText, Send, CalendarDays } from 'lucide-react-native';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Card, Button, ScreenHeader, StatusPill, type StatusTone } from '@/components/ui';
import DatePickerModal from '@/components/DatePickerModal';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { SubSubmittedInvoice } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { shareText } from '@/utils/shareText';
import { deliverTextFile, openPrintWindowOrThrow, printHtmlDocument, pdfFailureMessage } from '@/utils/platformFile';
import { formatCalendarDay } from '@/utils/calendarDate';
import {
  buildInsuranceAudit, auditGcPaymentsFromReceipts, requestMessageFor, toCsv, toPdfHtml, formatCents,
  STATUS_LABEL, EXEMPTION_NOTE, AUDIT_SOURCES_NOTE, type CoverageStatus, type AuditSubRow, type AuditPayment,
} from '@/utils/insuranceAuditPack';

const STATUS_TONE: Record<CoverageStatus, StatusTone> = {
  covered: 'success',
  not_covered: 'error',
  no_certificate: 'error',
  dates_missing: 'warning',
  unconfirmed: 'warning',
  undated: 'neutral',
};

type PeriodMode = { kind: 'year'; year: number } | { kind: 'custom' };

export default function InsuranceAuditScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { subcontractors, commitments, cois, settings } = useProjects();
  const { receipts } = useMaterialReceipts();
  const gcName = settings?.branding?.companyName?.trim() || undefined;

  // ── Period: a calendar year by default; policy years rarely match it ──
  const thisYear = new Date().getFullYear();
  const [mode, setMode] = useState<PeriodMode>({ kind: 'year', year: thisYear });
  const [customStart, setCustomStart] = useState(`${thisYear}-01-01`);
  const [customEnd, setCustomEnd] = useState(`${thisYear}-12-31`);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const period = mode.kind === 'year'
    ? { start: `${mode.year}-01-01`, end: `${mode.year}-12-31`, label: `Calendar year ${mode.year}` }
    : { start: customStart, end: customEnd, label: `Policy year ${formatCalendarDay(customStart)}–${formatCalendarDay(customEnd)}` };
  const periodInvalid = period.start > period.end;

  // ── Portal payments — the tax-1099-export read, verbatim ──
  const [subInvoices, setSubInvoices] = useState<SubSubmittedInvoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadErrorRef = useRef<string | null>(null);

  const loadSubInvoices = useCallback(async () => {
    if (!isSupabaseConfigured) { setSubInvoices([]); return; }
    setLoading(true);
    setLoadError(null);
    loadErrorRef.current = null;
    try {
      const { data, error } = await supabase
        .from('sub_submitted_invoices')
        .select('id,sub_portal_id,project_id,subcontractor_id,commitment_id,invoice_number,amount,retention_amount,status,created_at,reviewed_at,paid_at,paid_on,payment_method,submitted_by_name,submitted_by_email')
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
        paymentMethod: (r.payment_method as string | null) ?? undefined,
        submittedByName: (r.submitted_by_name as string | null) ?? undefined,
        submittedByEmail: (r.submitted_by_email as string | null) ?? undefined,
      })) as SubSubmittedInvoice[];
      setSubInvoices(mapped);
    } catch (err) {
      console.warn('[insurance audit] sub invoice fetch failed', err);
      const message = "Couldn't load sub-portal payments. The totals below leave out anything subs submitted through the portal.";
      setLoadError(message);
      loadErrorRef.current = message;
      setSubInvoices(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadSubInvoices(); }, [loadSubInvoices]);
  useFocusEffect(useCallback(() => {
    if (loadErrorRef.current) void loadSubInvoices();
  }, [loadSubInvoices]));

  const audit = useMemo(() => buildInsuranceAudit({
    periodStart: period.start,
    periodEnd: period.end,
    periodLabel: period.label,
    subs: subcontractors,
    // null ONLY when the read failed — the engine then prefixes the headline
    // and blocks export. Still loading reads as an empty list (the screen
    // shows a spinner and blocks export itself).
    portalInvoices: loadError ? null : (subInvoices ?? []),
    gcRecordedPayments: auditGcPaymentsFromReceipts(receipts, commitments),
    cois,
    commitments,
  }), [period.start, period.end, period.label, subcontractors, loadError, subInvoices, receipts, commitments, cois]);

  const hasRows = audit.subs.some(s => s.payments.length > 0);
  // Until the portal read settles (or fails) no total is stated: a headline
  // built from half the sources would be a wrong number said as a fact.
  const ready = subInvoices !== null || !!loadError;
  const exportBlockedReason = periodInvalid
    ? 'The start date is after the end date — fix the period first.'
    : audit.exportBlockedReason
      ?? (subInvoices === null ? 'Loading sub-portal payments…'
        : !hasRows ? 'No sub payments in this period to export.' : null);

  // ── Drafts: one editable request per sub, opened by his tap ──
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const openDraft = useCallback((s: AuditSubRow) => {
    setDrafts(d => (d[s.subcontractorId] !== undefined ? d : { ...d, [s.subcontractorId]: requestMessageFor(s, s.needsCertificate, gcName) }));
  }, [gcName]);
  const sendDraft = useCallback(async (s: AuditSubRow) => {
    const message = drafts[s.subcontractorId] ?? requestMessageFor(s, s.needsCertificate, gcName);
    const outcome = await shareText({ message, title: "Workers' comp certificate" });
    if (outcome === 'copied') showAlert('Copied', 'Sharing is not available here, so the message is on your clipboard — paste it into a text or email.');
    else if (outcome === 'failed') showAlert('Could not open sharing', message);
  }, [drafts, gcName]);

  const fileStem = `insurance-audit-${period.start}-to-${period.end}`;
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);
  const exportCsv = useCallback(async () => {
    if (exportBlockedReason) { showAlert('Export not ready', exportBlockedReason); return; }
    setBusy('csv');
    try {
      const uri = await deliverTextFile(`${fileStem}.csv`, toCsv(audit), 'text/csv;charset=utf-8');
      if (uri && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Insurance audit CSV' });
      }
    } catch (err) {
      showAlert('Export failed', (err as Error)?.message ?? 'Could not build the CSV.');
    } finally {
      setBusy(null);
    }
  }, [audit, exportBlockedReason, fileStem]);
  const exportPdf = useCallback(async () => {
    if (exportBlockedReason) { showAlert('Export not ready', exportBlockedReason); return; }
    const html = toPdfHtml(audit, settings?.branding, gcName);
    if (Platform.OS === 'web') {
      // Synchronously inside the tap, or the browser treats it as a pop-up.
      try { openPrintWindowOrThrow(html); } catch (err) { showAlert('PDF not opened', pdfFailureMessage(err, 'Could not open the PDF.')); }
      return;
    }
    setBusy('pdf');
    try {
      const uri = await printHtmlDocument(html);
      if (uri && await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Insurance audit PDF', UTI: 'com.adobe.pdf' });
      }
    } catch (err) {
      showAlert('PDF failed', pdfFailureMessage(err, 'Could not build the PDF.'));
    } finally {
      setBusy(null);
    }
  }, [audit, exportBlockedReason, settings?.branding, gcName]);

  const yearOptions = [thisYear, thisYear - 1, thisYear - 2];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="insaudit-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        variant="tool"
        eyebrow="Workers' comp audit"
        title="Insurance audit pack"
        subtitle="Every sub payment against the certificate that should cover it"
        onBack={() => router.back()}
        testID="insaudit-header"
      />
      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        <Text style={styles.sectionLabel}>Period</Text>
        <View style={styles.chipRow}>
          {yearOptions.map(y => {
            const on = mode.kind === 'year' && mode.year === y;
            return (
              <TouchableOpacity key={y} onPress={() => setMode({ kind: 'year', year: y })} style={[styles.chip, on && styles.chipOn]} testID={`insaudit-year-${y}`} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{y}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity onPress={() => setMode({ kind: 'custom' })} style={[styles.chip, mode.kind === 'custom' && styles.chipOn]} testID="insaudit-custom" accessibilityRole="button" accessibilityState={{ selected: mode.kind === 'custom' }}>
            <Text style={[styles.chipText, mode.kind === 'custom' && styles.chipTextOn]}>Policy year</Text>
          </TouchableOpacity>
        </View>
        {mode.kind === 'custom' ? (
          <View style={styles.customRow}>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setPicking('start')} testID="insaudit-start" accessibilityRole="button" accessibilityLabel="Policy start date">
              <CalendarDays size={14} color={t.textSecondary} strokeWidth={1.75} />
              <Text style={styles.dateBtnText}>From {formatCalendarDay(customStart)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setPicking('end')} testID="insaudit-end" accessibilityRole="button" accessibilityLabel="Policy end date">
              <CalendarDays size={14} color={t.textSecondary} strokeWidth={1.75} />
              <Text style={styles.dateBtnText}>To {formatCalendarDay(customEnd)}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <Text style={styles.hint}>Policy years rarely match the calendar. Use your policy&apos;s start date.</Text>

        {loading ? (
          <View style={styles.busy}><ActivityIndicator color={t.accent} /><Text style={styles.muted}>Loading sub payments…</Text></View>
        ) : null}

        {loadError ? (
          <Card style={styles.errorCard} testID="insaudit-load-error">
            <View style={styles.row}>
              <AlertTriangle size={14} color={t.danger} strokeWidth={1.75} />
              <Text style={[styles.body, { flex: 1 }]}>{loadError}</Text>
            </View>
            <Button label="Retry" variant="secondary" size="sm" onPress={() => { void loadSubInvoices(); }} iconLeft={<RefreshCw size={13} color={t.accent} strokeWidth={1.75} />} testID="insaudit-retry" />
          </Card>
        ) : null}

        {ready ? (<>
        <Card style={styles.card} testID="insaudit-summary">
          <Text style={styles.headline} testID="insaudit-headline">{audit.headline}</Text>
          {hasRows ? (
            <View style={styles.statRow}>
              <Stat label="Paid in period" value={formatCents(audit.paidTotalCents)} styles={styles} />
              <Stat label="No WC certificate on the date" value={formatCents(audit.uncoveredWcCents)} styles={styles} tone={audit.uncoveredWcCents > 0 ? t.dangerLabel : undefined} testID="insaudit-uncovered" />
              <Stat label="Can't tell from the records" value={formatCents(audit.cantTellWcCents)} styles={styles} tone={audit.cantTellWcCents > 0 ? t.warningLabel : undefined} testID="insaudit-canttell" />
            </View>
          ) : null}
          <Text style={styles.note} testID="insaudit-sources-note">{AUDIT_SOURCES_NOTE}</Text>
          <Text style={styles.note} testID="insaudit-exemption-note">{EXEMPTION_NOTE}</Text>
        </Card>

        {audit.subs.map(s => (
          <SubCard
            key={s.subcontractorId}
            s={s}
            draft={drafts[s.subcontractorId]}
            onOpenDraft={() => openDraft(s)}
            onEditDraft={(v) => setDrafts(d => ({ ...d, [s.subcontractorId]: v }))}
            onSend={() => { void sendDraft(s); }}
            styles={styles}
            t={t}
          />
        ))}

        {audit.undatedPayments.length > 0 ? (
          <Card style={styles.card} testID="insaudit-undated">
            <Text style={styles.subName}>Undated — can&apos;t be tested against a certificate</Text>
            <Text style={styles.muted}>These payments have no usable date, so they may fall outside this period. They are counted in &quot;can&apos;t tell&quot;, never as covered.</Text>
            {audit.undatedPayments.map(p => (
              <Text key={p.key} style={styles.body}>{formatCents(p.amountCents, true)} · {p.source === 'portal' ? 'Sub-portal invoice' : 'Bill you recorded'}{p.reference ? ` ${p.reference}` : ''}</Text>
            ))}
          </Card>
        ) : null}
        </>) : null}

        <View style={styles.exportRow}>
          <Button label="Export CSV" variant="primary" onPress={() => { void exportCsv(); }} disabled={!!exportBlockedReason} loading={busy === 'csv'} iconLeft={<FileSpreadsheet size={15} color="#FFF" strokeWidth={1.75} />} testID="insaudit-export-csv" />
          <Button label="Export PDF for the auditor" variant="secondary" onPress={() => { void exportPdf(); }} disabled={!!exportBlockedReason} loading={busy === 'pdf'} iconLeft={<FileText size={15} color={t.accent} strokeWidth={1.75} />} testID="insaudit-export-pdf" />
        </View>
        {exportBlockedReason ? <Text style={styles.muted} testID="insaudit-export-blocked">{exportBlockedReason}</Text> : null}
      </ScrollView>

      <DatePickerModal
        visible={picking !== null}
        value={picking === 'end' ? customEnd : customStart}
        allowFuture
        title={picking === 'end' ? 'Policy year ends' : 'Policy year starts'}
        onClose={() => setPicking(null)}
        onChange={(iso) => {
          // The picker emits noon-UTC of the picked day: the date part IS the day.
          const day = iso.slice(0, 10);
          if (picking === 'end') setCustomEnd(day); else setCustomStart(day);
          setPicking(null);
        }}
      />
    </View>
  );
}

type S = ReturnType<typeof makeStyles>;

function Stat({ label, value, tone, styles, testID }: { label: string; value: string; tone?: string; styles: S; testID?: string }) {
  return (
    <View style={styles.stat} testID={testID}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function PaymentLine({ p, styles }: { p: AuditPayment; styles: S }) {
  return (
    <View style={styles.payment} testID={`insaudit-pay-${p.key}`}>
      <View style={styles.row}>
        <Text style={[styles.body, { flex: 1 }]}>
          {p.payDay ? formatCalendarDay(p.payDay) : 'Date unknown'} · {formatCents(p.amountCents, true)} · {p.source === 'portal' ? 'Sub-portal invoice' : 'Bill you recorded'}{p.reference ? ` ${p.reference}` : ''}
        </Text>
      </View>
      <View style={styles.pillRow}>
        <StatusPill size="compact" tone={STATUS_TONE[p.status.workers_comp]} label={`WC: ${STATUS_LABEL[p.status.workers_comp]}`} />
        <StatusPill size="compact" tone={STATUS_TONE[p.status.general_liability]} label={`GL: ${STATUS_LABEL[p.status.general_liability]}`} />
      </View>
      {p.certificates.workers_comp ? <Text style={styles.muted}>WC on file: {p.certificates.workers_comp}</Text> : null}
      {p.notes.length ? <Text style={styles.muted}>{p.notes.join('; ')}</Text> : null}
    </View>
  );
}

function SubCard({ s, draft, onOpenDraft, onEditDraft, onSend, styles, t }: {
  s: AuditSubRow; draft: string | undefined; onOpenDraft: () => void; onEditDraft: (v: string) => void; onSend: () => void; styles: S; t: ThemeColors;
}) {
  return (
    <Card style={styles.card} testID={`insaudit-sub-${s.subcontractorId}`}>
      <View style={styles.row}>
        <Text style={[styles.subName, { flex: 1 }]} numberOfLines={1}>{s.name}</Text>
        <Text style={styles.body}>{formatCents(s.paidCents, true)}</Text>
      </View>
      {s.uncoveredWcCents > 0 ? (
        <Text style={[styles.body, { color: t.dangerLabel }]}>{formatCents(s.uncoveredWcCents, true)} paid with no workers&apos; comp certificate covering the date</Text>
      ) : null}
      {s.payments.map(p => <PaymentLine key={p.key} p={p} styles={styles} />)}
      {s.commitmentNote ? <Text style={styles.muted}>{s.commitmentNote}</Text> : null}
      {s.needsCertificate.length > 0 ? (
        draft === undefined ? (
          <Button label="Ask for the certificate" variant="secondary" size="sm" onPress={onOpenDraft} testID={`insaudit-ask-${s.subcontractorId}`} />
        ) : (
          <View style={styles.draft}>
            <TextInput
              value={draft}
              onChangeText={onEditDraft}
              multiline
              style={styles.draftInput}
              accessibilityLabel={`Message to ${s.name}`}
              testID={`insaudit-draft-${s.subcontractorId}`}
            />
            {!s.phone && !s.email ? <Text style={styles.muted}>No phone or email on file — the share sheet opens so you can pick how to send it.</Text> : null}
            <Button label="Send…" variant="primary" size="sm" onPress={onSend} iconLeft={<Send size={13} color="#FFF" strokeWidth={1.75} />} testID={`insaudit-send-${s.subcontractorId}`} />
          </View>
        )
      ) : null}
    </Card>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  sectionLabel: { ...Type.caption1, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.full, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line },
  chipOn: { backgroundColor: t.text, borderColor: t.text },
  chipText: { ...Type.footnote, fontWeight: '700', color: t.text },
  chipTextOn: { color: t.bg },
  customRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line },
  dateBtnText: { ...Type.footnote, color: t.text },
  hint: { ...Type.caption1, color: t.textMuted, marginBottom: 12 },
  busy: { padding: 16, alignItems: 'center', gap: 8 },
  card: { marginBottom: 12 },
  errorCard: { marginBottom: 12, gap: 8, borderColor: t.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headline: { ...Type.headline, color: t.text, marginBottom: 10 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 10 },
  stat: { minWidth: 140 },
  statValue: { ...Type.title3, fontWeight: '700', color: t.text },
  statLabel: { ...Type.caption2, color: t.textMuted, marginTop: 2 },
  note: { ...Type.caption1, color: t.textSecondary, marginTop: 6, lineHeight: 17 },
  subName: { ...Type.headline, color: t.text, marginBottom: 4 },
  body: { ...Type.footnote, color: t.text },
  muted: { ...Type.caption1, color: t.textMuted, marginTop: 4, lineHeight: 17 },
  payment: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, gap: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  draft: { marginTop: 10, gap: 8 },
  draftInput: { ...Type.footnote, color: t.text, minHeight: 88, padding: 10, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt, textAlignVertical: 'top' },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16, marginBottom: 6 },
});
