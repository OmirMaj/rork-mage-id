// lien-waivers — GC-side hub for managing lien waivers on a project.
// Generate one of the four waiver types pre-filled from a paid invoice
// or commitment. Status flows: requested → signed → received.
//
// WHO SIGNS. This screen used to capture the sub's email and send nothing to
// it, while "Mark signed" let the GC type the sub's name and stored it as the
// sub's signature under `role: 'gc'` — a contractor signing his own
// subcontractor's release. The primary action is now "Request signature",
// which emails the sub a token-gated link to sign the document themselves
// (utils/lienWaiverEngine.requestLienWaiverSignature). Recording a waiver that
// was signed on paper is still here, because plenty of subs sign paper — but
// it is labelled as the contractor's record of a paper original, and the PDF
// prints it that way rather than as the sub's signature.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Plus, FileSignature, FileDown, CheckCircle2,
  Clock, XCircle, Trash2, ShieldCheck, AlertTriangle, Send, Landmark,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import {
  fetchLienWaiversForProject, saveLienWaiver, deleteLienWaiver,
  shareLienWaiverPDF, WAIVER_LABELS, lienWaiverDocContext,
  lienWaiverFormLabel, requestLienWaiverSignature,
} from '@/utils/lienWaiverEngine';
import { isStatutoryWaiverState, statutoryStateName } from '@/utils/lienWaiverForms';
import { copyToClipboard } from '@/utils/clipboard';
import { formatMoney } from '@/utils/formatters';
import { statusPillStyle } from '@/utils/statusPill';
import type { LienWaiver, LienWaiverType, CompanyBranding } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert, showPrompt } from '@/utils/alert';
import { formatCalendarDay, todayCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import { useSafeBack } from '@/hooks/useSafeBack';

/** A calendar day from whatever the invoice screen passed as prefillThroughDate
 *  (see the seed below): 'YYYY-MM-DD' as-is, an ISO instant as its LOCAL day,
 *  anything else (or nothing) as today. */
function normaliseThroughDate(value: string | undefined): string {
  return calendarDayOf(value) ?? todayCalendarDay();
}

export default function LienWaiversScreen() {
  const goBack = useSafeBack(); // UX-F18: cold-start safe
  const { canAccess } = useTierAccess();
  if (!canAccess('lien_waiver_manager')) {
    return (
      <Paywall
        visible={true}
        feature="Lien Waiver Manager"
        requiredTier="pro"
        onClose={goBack}
      />
    );
  }
  return <LienWaiversScreenInner />;
}

function LienWaiversScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  // UX-F18: Back must work when this screen is the first route of a fresh
  // web tab or a cold-start deep link (nothing to pop).
  const goBack = useSafeBack();
  const { projectId, prefillFromInvoice, prefillAmount, prefillThroughDate } = useLocalSearchParams<{
    projectId: string;
    prefillFromInvoice?: string;
    prefillAmount?: string;
    prefillThroughDate?: string;
  }>();
  const { getProject, settings, getInvoicesForProject, getCommitmentsForProject, subcontractors } = useProjects() as any;
  const project = projectId ? getProject(projectId) : undefined;

  const [waivers, setWaivers] = useState<LienWaiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [addModal, setAddModal] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);

  // Prefill seed for the New Waiver modal — populated when this screen
  // is opened with `prefillFromInvoice` query params (the "Collect a
  // lien waiver" CTA on a paid invoice). Resolves the sub from the
  // invoice's commitmentId so the GC doesn't have to retype the name.
  const prefillSeed = useMemo(() => {
    if (!prefillFromInvoice) return null;
    const invoice = (getInvoicesForProject(projectId ?? '') ?? []).find((i: any) => i.id === prefillFromInvoice);
    if (!invoice) return null;
    let subName = '';
    let subEmail: string | undefined;
    let subCompanyId: string | undefined;
    if (invoice.commitmentId) {
      const commit = (getCommitmentsForProject(projectId ?? '') ?? []).find((c: any) => c.id === invoice.commitmentId);
      if (commit) {
        subName = commit.vendorName ?? '';
        subCompanyId = commit.companyId ?? commit.subcontractorId;
        if (subCompanyId) {
          const sub = subcontractors?.find((s: any) => s.id === subCompanyId);
          if (sub) subEmail = sub.email ?? undefined;
        }
      }
    }
    return {
      invoiceId: prefillFromInvoice,
      commitmentId: invoice.commitmentId,
      subName,
      subEmail,
      subCompanyId,
      paidAmount: prefillAmount ? Number(prefillAmount) : (invoice.amountPaid ?? invoice.totalDue ?? 0),
      // UX-F3: a LOCAL calendar day. toISOString().slice(0, 10) wrote
      // tomorrow's date on a waiver created after ~6 pm Denver time.
      // B4 review A4: the invoice screen hands over paidDate / issueDate —
      // full toISOString() instants — or a bare UTC day, and the raw value
      // used to be stored and printed as-is. Normalised to a calendar day
      // here: an instant becomes its LOCAL day (the day the GC issued or
      // paid), a bare day is kept.
      throughDate: normaliseThroughDate(prefillThroughDate),
    };
  }, [prefillFromInvoice, projectId, prefillAmount, prefillThroughDate, getInvoicesForProject, getCommitmentsForProject, subcontractors]);

  // Auto-open the modal when arriving with prefill params.
  useEffect(() => {
    if (prefillSeed && !loading) setAddModal(true);
  }, [prefillSeed, loading]);

  const branding = useMemo<CompanyBranding>(() => ({
    companyName:   settings?.branding?.companyName ?? 'MAGE ID',
    contactName:   settings?.branding?.contactName ?? '',
    phone:         settings?.branding?.phone ?? '',
    email:         settings?.branding?.email ?? '',
    address:       settings?.branding?.address ?? '',
    licenseNumber: settings?.branding?.licenseNumber ?? '',
    tagline:       settings?.branding?.tagline ?? '',
    logoUri:       settings?.branding?.logoUri,
  }), [settings]);

  const refresh = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    const list = await fetchLienWaiversForProject(projectId);
    setWaivers(list);
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      setLoading(true); await refresh(); setLoading(false);
    })();
  }, [refresh]);

  const handleCreate = useCallback(async (input: { waiverType: LienWaiverType; subName: string; subEmail?: string; throughDate: string; paidAmount: number; notes?: string }) => {
    if (!projectId || !input.subName.trim()) return;
    const saved = await saveLienWaiver({
      projectId,
      waiverType: input.waiverType,
      subName: input.subName.trim(),
      subEmail: input.subEmail?.trim() || undefined,
      throughDate: input.throughDate,
      paidAmount: input.paidAmount,
      notes: input.notes,
      status: 'requested',
      // Carry through any prefill linkage so the waiver references the
      // source invoice and commitment for downstream reporting.
      invoiceId: prefillSeed?.invoiceId,
      commitmentId: prefillSeed?.commitmentId,
      subCompanyId: prefillSeed?.subCompanyId,
    });
    if (saved) {
      setWaivers(prev => [saved, ...prev]);
      setAddModal(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      showAlert('Save failed', 'Could not save the waiver.');
    }
  }, [projectId, prefillSeed]);

  // One resolution of the jobsite, shared by the PDF, the form label, and the
  // signing request — so what the badge on the card says is necessarily the
  // form the sub is emailed.
  const docCtx = useMemo(() => lienWaiverDocContext(project), [project]);

  const projectCommitments = useMemo(
    () => (projectId ? getCommitmentsForProject(projectId) ?? [] : []),
    [projectId, getCommitmentsForProject],
  );

  /**
   * The same jobsite, plus what THIS sub furnished.
   *
   * Texas, Arizona and Georgia all leave a blank for it — "to the following
   * extent: ____ (job description)" — and that blank is the SCOPE of the
   * release. Left empty it printed a line of underscores, so a Texas
   * unconditional final waiver came out of the app without saying what it
   * released. The waiver already carries the commitment it was collected
   * against, so the answer is a lookup, not a guess: no commitment, no
   * description, and the statutory blank stays a blank for the signer to fill
   * — this never invents one.
   */
  const docCtxFor = useCallback((w: LienWaiver) => lienWaiverDocContext(project, {
    jobDescription: (projectCommitments.find((c: any) => c.id === w.commitmentId)?.description ?? '').trim(),
  }), [project, projectCommitments]);

  const handleExport = useCallback(async (w: LienWaiver) => {
    setExporting(w.id);
    try {
      await shareLienWaiverPDF(w, branding, docCtxFor(w));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      showAlert('Export failed', e instanceof Error ? e.message : 'Could not generate PDF.');
    } finally {
      setExporting(null);
    }
  }, [branding, docCtxFor]);

  // Email the sub a link to sign their own waiver. Every outcome gets its own
  // message: a Resend accept, a composer that only opened a draft, a missing
  // address, and a database that has not had the signing migration applied are
  // four different situations and only one of them means the sub has been
  // asked.
  //
  // The ref is the re-entry latch. `requesting` disables the button, but that
  // only takes effect on the next render, and each press mints a NEW token that
  // invalidates the last — so a double tap emails the sub two links of which
  // the first is already dead.
  const requestInFlight = useRef(false);
  // Lets the no-email branch below re-enter the send once the address is saved,
  // without the callback having to name the function it lives inside. Assigned
  // in an effect rather than during render; nothing can reach it before then
  // because the only way in is a press.
  const requestRef = useRef<((w: LienWaiver) => Promise<void>) | null>(null);

  /** Save an address the GC typed into the missing-email prompt, then send. */
  const saveEmailThenRequest = useCallback(async (w: LienWaiver, typed: string | null | undefined) => {
    const email = (typed ?? '').trim();
    if (!email) return;   // they cancelled or cleared the field
    if (!email.includes('@') || /\s/.test(email)) {
      showAlert('That is not an email address', `"${email}" has no "@" in it, so there is nowhere to send the waiver.`);
      return;
    }
    const saved = await saveLienWaiver({ ...w, id: w.id, subEmail: email });
    if (!saved) {
      showAlert('Could not save that address', 'The email was not saved, so nothing was sent. Try again.');
      return;
    }
    setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
    // Send against the SAVED row, not the stale one the button was pressed on.
    await requestRef.current?.(saved);
  }, []);

  const handleRequestSignature = useCallback(async (w: LienWaiver) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRequesting(w.id);
    try {
      const result = await requestLienWaiverSignature(w, branding, docCtxFor(w), {
        senderEmail: settings?.branding?.email,
        senderName: settings?.branding?.contactName,
      });
      if (result.outcome === 'sent') {
        await refresh();
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        showAlert('Signing link sent', `${w.subName} can now open the waiver and sign it. You'll see it here once they do.`);
        return;
      }
      if (result.outcome === 'no_email') {
        // Covers both an empty field and a typo'd one — the engine rejects
        // anything without an "@", and "No email on this waiver" reads as a
        // lie to a GC who can see an address sitting in the field.
        //
        // ASK FOR IT HERE. The address is only settable in the New Waiver
        // modal and a saved waiver has no edit screen anywhere in this app, so
        // "fix it on the waiver and try again" named a remedy the product does
        // not have: the GC's only route was to delete the waiver and retype it.
        showPrompt(
          w.subEmail ? 'That address will not send' : 'Where should the link go?',
          w.subEmail
            ? `"${w.subEmail}" is not an address we can send to. Type ${w.subName}'s email and we'll save it and send the signing link.`
            : `Type ${w.subName}'s email. We'll save it on this waiver and send them the signing link.`,
          (value) => { void saveEmailThenRequest(w, value); },
          'plain-text',
          w.subEmail ?? '',
        );
        return;
      }
      if (result.outcome === 'voided') {
        // Sending on a voided waiver would set its status back to 'requested',
        // and the signing page decides whether to show a Sign button off exactly
        // that status — so the sub would be handed a live link to a release this
        // contractor had already cancelled.
        showAlert(
          'This waiver is voided',
          `It was cancelled, so ${w.subName} is not being asked to sign it. Create a new waiver if you need one.`,
        );
        return;
      }
      if (result.outcome === 'already_signed') {
        showAlert(
          'This waiver is already signed',
          `${w.subName} has signed it. Re-sending would replace the signed document with a fresh unsigned one, so it is refused.`,
        );
        return;
      }
      if (result.outcome === 'email_failed' && result.signUrl) {
        const url = result.signUrl;
        // The row IS updated on this path — the token and the sealed document
        // are stored, only the mail failed. Refresh so the card stops offering
        // "Request signature" as if nothing had happened and shows the link is
        // live; without it the GC taps again and kills the link they are about
        // to paste.
        await refresh();
        showAlert(
          'Email did not go out',
          'The waiver is ready to sign but the email was not accepted. Copy the signing link and send it yourself.',
          [
            { text: 'Close', style: 'cancel' },
            { text: 'Copy link', onPress: () => { void copyToClipboard(url); } },
          ],
        );
        return;
      }
      if (result.outcome === 'not_provisioned') {
        showAlert(
          'Signing is not switched on yet',
          'Sub-signed waivers need a database update that has not been applied to this account yet. Until then, use Record paper waiver.',
        );
        return;
      }
      showAlert('Could not send', result.error || 'The signing request did not go out. Try again.');
    } finally {
      requestInFlight.current = false;
      setRequesting(null);
    }
  }, [branding, docCtxFor, refresh, settings, saveEmailThenRequest]);

  useEffect(() => { requestRef.current = handleRequestSignature; }, [handleRequestSignature]);

  const handleStatusChange = useCallback(async (w: LienWaiver, status: LienWaiver['status']) => {
    const saved = await saveLienWaiver({ ...w, id: w.id, status });
    if (saved) setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
  }, []);

  // Recording a PAPER waiver. This is not the sub signing — it is the GC
  // saying "I have their signed paper original in the file", which is a
  // different fact and is stored and printed as one. The sub's own signature
  // comes back through the signing page with role 'sub'.
  const handleRecordPaper = useCallback(async (w: LienWaiver) => {
    const persist = async (rawName: string) => {
      const name = rawName.trim();
      if (!name || name.length < 2) {
        showAlert('Name required', 'Type the subcontractor\'s legal name as it appears on the paper waiver.');
        return;
      }
      try {
        const saved = await saveLienWaiver({
          ...w, id: w.id,
          status: 'signed',
          signedAt: new Date().toISOString(),
          // role 'gc': the contractor attesting to a paper original. Never
          // 'sub' — only the token-gated signing page writes that.
          subSignature: { name, role: 'gc', signedAt: new Date().toISOString() },
        });
        if (saved) {
          setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } else {
          showAlert('Save failed', 'Could not record this waiver. Try again.');
        }
      } catch (e) {
        showAlert('Save failed', e instanceof Error ? e.message : 'Try again.');
      }
    };
    // showPrompt covers every platform now (native Alert.prompt on iOS, the
    // themed modal on Android + web), so the old hand-rolled window.prompt
    // fallback this file carried for web is no longer needed.
    showPrompt(
      'Record a paper waiver',
      'Only for a waiver the sub has already signed on paper. Type the name as it appears on that original — this is recorded as your record of it, not as their signature.',
      (name) => { if (name != null) void persist(name); },
      'plain-text',
      w.subName,
    );
  }, []);

  const handleDelete = useCallback((w: LienWaiver) => {
    showAlert(
      `Delete waiver for ${w.subName}?`,
      'This is permanent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const ok = await deleteLienWaiver(w.id);
            if (ok) setWaivers(prev => prev.filter(x => x.id !== w.id));
          },
        },
      ],
    );
  }, []);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <EmptyState
          icon={<ShieldCheck size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title="Lien waivers live inside a project"
          message="A lien waiver is tied to a specific job's payments, so it lives inside a project. To generate one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Lien Waivers inside the project tile grid.',
            'Pick the waiver type — we auto-fill the sub, paid amount, and through-date.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Lien Waivers</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddModal(true)}>
          <Plus size={14} color="#FFF" strokeWidth={1.75} />
          <Text style={styles.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>
      <FeatureHeader
        eyebrow="Lien Waivers"
        title="Sign-offs your bank wants"
        subtitle="A signed slip from each sub saying &ldquo;I&apos;ve been paid; I won&apos;t lien the job.&rdquo; Most lenders require these on every draw. We auto-fill from the invoice — you just pick the type."
        explainer={{
          term: 'Lien Waiver',
          definition: 'A lien waiver is a legal document a contractor or subcontractor signs giving up their right to file a mechanic\'s lien against the property for the amount they\'ve been paid. Banks require these on most draws to make sure no sub will come back later claiming they weren\'t paid.',
          whenToUse: [
            'Every time you pay a sub on a bank-financed project',
            'Before issuing the next progress draw to the lender',
            'At final payment / closeout (a "final unconditional waiver")',
          ],
        }}
      />

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {loading && (
          <View style={styles.loading}><ActivityIndicator size="small" color={themeColors.accent} /></View>
        )}

        {!loading && waivers.length === 0 && (
          <View style={styles.emptyCard}>
            <ShieldCheck size={28} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No waivers yet</Text>
            <Text style={styles.emptyBody}>
              Generate a lien waiver after every sub payment. Banks ask for them on every draw.
              We'll auto-fill the sub's name, paid amount, and through-date — you just pick the type.
            </Text>
            <TouchableOpacity style={styles.bigCta} onPress={() => setAddModal(true)}>
              <Plus size={14} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.bigCtaText}>New waiver</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Which form this job gets, said once at the top rather than
            discovered on the PDF. A statutory state is the good news; anywhere
            else the old warning is still the honest thing to print. */}
        {isStatutoryWaiverState(docCtx.jobsiteState) ? (
          <View style={styles.statuteBanner}>
            <Landmark size={14} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.statuteBannerText}>
              This jobsite is in {statutoryStateName(docCtx.jobsiteState)}. Waivers print on that state&apos;s statutory form
              — check the citation and &ldquo;text as of&rdquo; date on the PDF, and have counsel confirm the
              current wording before you rely on it.
            </Text>
          </View>
        ) : (
          <View style={styles.disclaimer}>
            <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.disclaimerText}>
              This job prints the general form. CA, TX, FL, GA and AZ prescribe their own statutory
              wording; if the jobsite is in one of them, set the project&apos;s address so we use it.
            </Text>
          </View>
        )}

        {waivers.map(w => (
          <WaiverCard
            key={w.id}
            waiver={w}
            exporting={exporting === w.id}
            requesting={requesting === w.id}
            formLabel={lienWaiverFormLabel(w, docCtx)}
            onExport={() => handleExport(w)}
            onRequestSignature={() => handleRequestSignature(w)}
            onRecordPaper={() => handleRecordPaper(w)}
            onMarkReceived={() => handleStatusChange(w, 'received')}
            onMarkVoid={() => handleStatusChange(w, 'voided')}
            onDelete={() => handleDelete(w)}
          />
        ))}
      </ScrollView>

      <NewWaiverModal
        visible={addModal}
        onClose={() => setAddModal(false)}
        onCreate={handleCreate}
        seed={prefillSeed}
      />
    </View>
  );
}

function WaiverCard({ waiver, exporting, requesting, formLabel, onExport, onRequestSignature, onRecordPaper, onMarkReceived, onMarkVoid, onDelete }: {
  waiver: LienWaiver;
  exporting: boolean;
  requesting: boolean;
  /** "California statutory form · Cal. Civ. Code § 8132" or "General form". */
  formLabel: string;
  onExport: () => void;
  onRequestSignature: () => void;
  onRecordPaper: () => void;
  onMarkReceived: () => void;
  onMarkVoid: () => void;
  onDelete: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const meta = WAIVER_LABELS[waiver.waiverType];
  // Use the shared statusPillStyle so SIGNED/RECEIVED/VOIDED/REQUESTED
  // match the same color scheme used on contract + closeout binder.
  // Icons stay per-status because they convey extra meaning beyond color.
  const statusIcons = {
    received: CheckCircle2,
    signed:   FileSignature,
    voided:   XCircle,
    requested: Clock,
  } as const;
  const Icon = statusIcons[waiver.status] ?? Clock;
  const labelMap: Record<typeof waiver.status, string> = {
    received: 'RECEIVED', signed: 'SIGNED', voided: 'VOIDED', requested: 'REQUESTED',
  };
  const { color: statusColor, backgroundColor: statusBg } = statusPillStyle(waiver.status);
  const statusCfg = { bg: statusBg, color: statusColor, label: labelMap[waiver.status] };
  const StatusIcon = Icon;

  return (
    <View style={styles.waiverCard}>
      <View style={styles.waiverHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.waiverType}>{meta.short.toUpperCase()}</Text>
          <Text style={styles.waiverSubName}>{waiver.subName}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusCfg.bg }]}>
          <StatusIcon size={11} color={statusCfg.color} />
          <Text style={[styles.statusPillText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
      </View>

      <View style={styles.waiverGrid}>
        <View style={styles.waiverField}>
          <Text style={styles.waiverFieldLabel}>Through</Text>
          {/* UX-F3: a calendar day — new Date() of it was UTC midnight, a day early west of Greenwich */}
          <Text style={styles.waiverFieldValue}>{formatCalendarDay(waiver.throughDate)}</Text>
        </View>
        <View style={styles.waiverField}>
          <Text style={styles.waiverFieldLabel}>Amount</Text>
          <Text style={styles.waiverFieldValue}>{formatMoney(waiver.paidAmount)}</Text>
        </View>
      </View>

      <Text style={styles.formLabel}>{formLabel}</Text>

      {/* A signature the SUB gave and a paper original the GC recorded are
          different facts. The card says which one this is, because the row
          used to read "Signed by <name>" for both. */}
      {waiver.subSignature && (
        <View style={[styles.sigPreview, waiver.subSignature.role === 'gc' && styles.sigPreviewPaper]}>
          <FileSignature size={12} color={waiver.subSignature.role === 'gc' ? Colors.warningLabel : themeColors.success} strokeWidth={1.75} />
          <Text style={styles.sigPreviewText}>
            {waiver.subSignature.role === 'gc'
              ? <>Paper waiver recorded by you for <Text style={{ fontWeight: '800' }}>{waiver.subSignature.name}</Text> on {new Date(waiver.subSignature.signedAt).toLocaleDateString()}</>
              : <>Signed by <Text style={{ fontWeight: '800' }}>{waiver.subSignature.name}</Text> on {new Date(waiver.subSignature.signedAt).toLocaleDateString()}</>}
          </Text>
        </View>
      )}

      {!waiver.subSignature && waiver.signRequestedAt && (
        <View style={styles.sigPreview}>
          <Send size={12} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.sigPreviewText}>
            Signing link sent to {waiver.subEmail ?? 'the sub'} on {new Date(waiver.signRequestedAt).toLocaleDateString()}
          </Text>
        </View>
      )}

      <View style={styles.waiverActions}>
        <TouchableOpacity style={styles.actionSecondary} onPress={onExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size="small" color={themeColors.text} /> : (
            <>
              <FileDown size={13} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.actionSecondaryText}>PDF</Text>
            </>
          )}
        </TouchableOpacity>
        {waiver.status === 'requested' && (
          <TouchableOpacity style={styles.actionPrimary} onPress={onRequestSignature} disabled={requesting}>
            {requesting ? <ActivityIndicator size="small" color="#FFF" /> : (
              <>
                <Send size={13} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.actionPrimaryText}>
                  {waiver.signRequestedAt ? 'Resend to sub' : 'Request signature'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {waiver.status === 'requested' && (
          <TouchableOpacity style={styles.actionSecondary} onPress={onRecordPaper}>
            <FileSignature size={13} color={themeColors.text} strokeWidth={1.75} />
            <Text style={styles.actionSecondaryText}>Record paper waiver</Text>
          </TouchableOpacity>
        )}
        {waiver.status === 'signed' && (
          <TouchableOpacity style={styles.actionPrimary} onPress={onMarkReceived}>
            <CheckCircle2 size={13} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.actionPrimaryText}>Mark received</Text>
          </TouchableOpacity>
        )}
        {(waiver.status === 'requested' || waiver.status === 'signed') && (
          <TouchableOpacity style={styles.actionGhost} onPress={onMarkVoid}>
            <XCircle size={13} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.actionGhostText}>Void</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionGhost} onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={13} color={themeColors.danger} strokeWidth={1.75} /></TouchableOpacity>
      </View>
    </View>
  );
}

function NewWaiverModal({ visible, onClose, onCreate, seed }: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { waiverType: LienWaiverType; subName: string; subEmail?: string; throughDate: string; paidAmount: number; notes?: string }) => void;
  /** Optional prefill from a "Create lien waiver" CTA on a paid invoice. */
  seed?: { subName?: string; subEmail?: string; paidAmount?: number; throughDate?: string } | null;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [type, setType] = useState<LienWaiverType>('unconditional_partial');
  const [subName, setSubName] = useState('');
  const [subEmail, setSubEmail] = useState('');
  const [throughDate, setThroughDate] = useState(todayCalendarDay()); // UX-F3: local day
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (visible) {
      setType('unconditional_partial');
      setSubName(seed?.subName ?? '');
      setSubEmail(seed?.subEmail ?? '');
      setThroughDate(seed?.throughDate ?? todayCalendarDay());
      setAmount(seed?.paidAmount ? String(seed.paidAmount) : '');
    }
  }, [visible, seed]);

  const handleSubmit = () => {
    const trimmedName = subName.trim();
    const trimmedEmail = subEmail.trim();
    const numericAmount = Number(amount);
    if (!trimmedName) {
      showAlert('Sub name required', 'Type the subcontractor\'s legal company or person name.');
      return;
    }
    if (!isFinite(numericAmount) || numericAmount <= 0) {
      showAlert('Amount required', 'Enter the dollar amount paid through this date.');
      return;
    }
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      showAlert('Email looks off', 'Either fix the email or leave it blank.');
      return;
    }
    onCreate({
      waiverType: type,
      subName: trimmedName,
      subEmail: trimmedEmail || undefined,
      throughDate,
      paidAmount: numericAmount,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New lien waiver</Text>
          <Text style={styles.modalBody}>Pick the type, fill in the sub + amount, generate the PDF.</Text>

          <Text style={styles.modalLabel}>Type</Text>
          <View style={styles.typeRow}>
            {(['conditional_partial', 'unconditional_partial', 'conditional_final', 'unconditional_final'] as LienWaiverType[]).map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, type === t && styles.typeChipActive]}
                onPress={() => setType(t)}
              >
                <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{WAIVER_LABELS[t].short}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.typeHint}>{WAIVER_LABELS[type].description}</Text>

          <Text style={styles.modalLabel}>Subcontractor name *</Text>
          <TextInput
            style={styles.modalInput}
            value={subName}
            onChangeText={setSubName}
            placeholder="Hallway Homes LLC"
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.modalLabel}>Subcontractor email</Text>
          <TextInput
            style={styles.modalInput}
            value={subEmail}
            onChangeText={setSubEmail}
            placeholder="where we send the signing link"
            placeholderTextColor={themeColors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <View style={styles.modalRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalLabel}>Through date</Text>
              <TextInput
                style={styles.modalInput}
                value={throughDate}
                onChangeText={setThroughDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={themeColors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalLabel}>Paid amount *</Text>
              <TextInput
                style={styles.modalInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={themeColors.textMuted}
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, (!subName.trim() || !amount) && styles.modalConfirmDisabled]}
              onPress={handleSubmit}
              disabled={!subName.trim() || !Number(amount) || Number(amount) <= 0}
            >
              <Plus size={14} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.modalConfirmText}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: t.accentFill },
  addBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFF' },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: { backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 28, alignItems: 'center', gap: 10, marginTop: 22, borderWidth: 1, borderColor: t.line },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4 },
  emptyBody:  { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  bigCta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 11, backgroundColor: t.accentFill, marginTop: 8 },
  bigCtaText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '800' },

  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: Tokens.radius.md, marginBottom: 12,
    backgroundColor: Colors.warning + '0D',
    borderWidth: 1, borderColor: Colors.warning + '30',
  },
  disclaimerText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.text, lineHeight: 16 },

  statuteBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: Tokens.radius.md, marginBottom: 12,
    backgroundColor: t.success + '0D',
    borderWidth: 1, borderColor: t.success + '30',
  },
  statuteBannerText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.text, lineHeight: 16 },

  formLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '700' },

  waiverCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 10, gap: 10,
  },
  waiverHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waiverType: { fontSize: 9, fontWeight: '800', color: t.accent, letterSpacing: 0.8 },
  waiverSubName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: t.text, marginTop: 3 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  waiverGrid: { flexDirection: 'row', gap: 12 },
  waiverField: { flex: 1, padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  waiverFieldLabel: { fontSize: 9, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6 },
  waiverFieldValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, marginTop: 2 },

  sigPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: t.success + '0D', borderWidth: 1, borderColor: t.success + '30' },
  // A GC-recorded paper waiver is amber, not green: it is a filing note, not
  // a signature the sub gave.
  sigPreviewPaper: { backgroundColor: Colors.warning + '0D', borderColor: Colors.warning + '30' },
  sigPreviewText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.text },

  waiverActions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  actionPrimary: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: t.accentFill },
  actionPrimaryText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: '#FFF' },
  actionSecondary: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  actionSecondaryText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  actionGhost: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9 },
  actionGhostText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: Colors.warningLabel },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(11, 13, 16, 0.75)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: t.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 8 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text },
  modalBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 18 },
  modalLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8 },
  modalInput: {
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: -4 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  typeChipActive: { backgroundColor: t.accent + '15', borderColor: t.accent },
  typeChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.text },
  typeChipTextActive: { color: t.accent },
  typeHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16, marginTop: 4, fontStyle: 'italic' },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 11, backgroundColor: t.bg, alignItems: 'center', borderWidth: 1, borderColor: t.line },
  modalCancelText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  modalConfirm: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 11, backgroundColor: t.accentFill },
  modalConfirmDisabled: { opacity: 0.45 },
  modalConfirmText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },
});
