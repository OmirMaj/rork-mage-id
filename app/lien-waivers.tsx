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
  RefreshControl, AppState,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Plus, FileSignature, FileDown, CheckCircle2,
  Clock, XCircle, Trash2, ShieldCheck, AlertTriangle, Send, Landmark, WifiOff, Lock,
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
  loadLienWaiversChecked, readLienWaiverCache, fetchLienWaiverChecked,
  createLienWaiverChecked, updateLienWaiverStatus, recordPaperLienWaiver,
  saveLienWaiver, deleteLienWaiver, lienWaiverAccessGate,
  shareLienWaiverPDF, WAIVER_LABELS, lienWaiverDocContext,
  lienWaiverFormLabel, requestLienWaiverSignature,
} from '@/utils/lienWaiverEngine';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { classifyError } from '@/utils/errorCopy';
import { pdfFailureMessage } from '@/utils/platformFile';
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

const LIEN_WAIVER_TYPES: LienWaiverType[] = ['conditional_partial', 'unconditional_partial', 'conditional_final', 'unconditional_final'];

/** "Offline" vs "the read failed" — two different sentences on screen. */
function isOfflineError(message: string): boolean {
  return classifyError({ message }) === 'offline';
}

/** "3:42 PM" today, "Sep 12, 3:42 PM" otherwise — when the cached list was read. */
function seenAtLabel(iso: string | null): string {
  if (!iso) return 'an earlier visit';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an earlier visit';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

export default function LienWaiversScreen() {
  const goBack = useSafeBack(); // UX-F18: cold-start safe
  const { canAccess } = useTierAccess();
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  // #29 interim (productDecision #29 — lien waivers are owner-only for now).
  // Resolved BEFORE the tier check: an invited PM on a free plan is not a
  // pricing question, and "checking access" must never flash the paywall.
  const roleState = useProjectRoleState(gateProjectId || undefined);
  if (gateProjectId) {
    // Loading and a failed read are their own states (collaborator-gates
    // contract): a settled null is "no access", with a reason; never a spinner
    // forever, never the paywall.
    const gate = lienWaiverAccessGate({
      role: roleState.role,
      isLoading: roleState.isLoading,
      isError: roleState.isError,
      isPaused: roleState.isPaused,
      reason: roleState.reason,
    });
    if (gate.kind === 'loading') return <LienWaiverGateView state="loading" onBack={goBack} />;
    if (gate.kind === 'error') {
      return (
        <LienWaiverGateView
          state="error"
          message="Couldn't check your access to this job. Check your connection and try again."
          onRetry={() => { void roleState.refetch(); }}
          onBack={goBack}
        />
      );
    }
    if (gate.kind === 'blocked') return <LienWaiverGateView state="blocked" message={gate.message} onBack={goBack} />;
  }
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

/** Checking access / couldn't check / not yours to issue — never a list, and
 *  never a New, Request, Record, Void, Received or Delete control. */
function LienWaiverGateView({ state, message, onRetry, onBack }: {
  state: 'loading' | 'error' | 'blocked';
  message?: string;
  onRetry?: () => void;
  onBack: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID={`lien-waivers-gate-${state}`}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Lien Waivers</Text>
        </View>
      </View>
      <View style={styles.emptyCard}>
        {state === 'loading' ? (
          <>
            <ActivityIndicator size="small" color={themeColors.accent} />
            <Text style={styles.emptyBody}>Checking your access to this job…</Text>
          </>
        ) : (
          <>
            {state === 'blocked'
              ? <Lock size={28} color={themeColors.textMuted} strokeWidth={1.75} />
              : <AlertTriangle size={28} color={Colors.warningLabel} strokeWidth={1.75} />}
            <Text style={styles.emptyTitle}>{state === 'blocked' ? 'Managed by the project owner' : 'Couldn’t check access'}</Text>
            <Text style={styles.emptyBody}>{message}</Text>
            {onRetry && (
              <TouchableOpacity style={styles.bigCta} onPress={onRetry} accessibilityRole="button">
                <Text style={styles.bigCtaText}>Try again</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
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
  const {
    projectId, prefillFromInvoice, prefillAmount, prefillThroughDate,
    prefillSubName, prefillSubEmail, prefillSubCompanyId, prefillCommitmentId,
    prefillInvoiceId, prefillWaiverType, prefillWaiverReason,
  } = useLocalSearchParams<{
    projectId: string;
    prefillFromInvoice?: string;
    prefillAmount?: string;
    prefillThroughDate?: string;
    // Explicit identity — the sub portal's "Collect release" (see below).
    prefillSubName?: string;
    prefillSubEmail?: string;
    prefillSubCompanyId?: string;
    prefillCommitmentId?: string;
    prefillInvoiceId?: string;
    prefillWaiverType?: string;
    prefillWaiverReason?: string;
  }>();
  const { getProject, settings, getInvoicesForProject, getCommitmentsForProject, subcontractors } = useProjects() as any;
  const project = projectId ? getProject(projectId) : undefined;

  const [waivers, setWaivers] = useState<LienWaiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // #30: a failed read is its own state, never "No waivers yet". `seenAt` is
  // when the list on screen was read, when it is this phone's cached copy
  // rather than a fresh answer from the server.
  const [loadError, setLoadError] = useState<{ offline: boolean } | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);

  // Prefill seed for the New Waiver modal — populated when this screen
  // is opened with `prefillFromInvoice` query params (the "Collect a
  // lien waiver" CTA on a paid invoice). Resolves the sub from the
  // invoice's commitmentId so the GC doesn't have to retype the name.
  //
  // EXPLICIT PARAMS WIN. Screen audit 2026-09-16: the commitmentId walk below
  // reads a field the owner `Invoice` type does not have, so this CTA has only
  // ever opened with a blank sub name — and it cannot resolve a sub-submitted
  // invoice at all (no reader for that table here). The sub portal already
  // holds the sub it is paying, so it passes name / email / ids / waiver type
  // straight through, and nothing is looked up that could silently miss.
  const prefillSeed = useMemo(() => {
    if (prefillSubName) {
      const type = LIEN_WAIVER_TYPES.find(t => t === prefillWaiverType);
      return {
        invoiceId: prefillInvoiceId || prefillFromInvoice || undefined,
        commitmentId: prefillCommitmentId || undefined,
        subName: prefillSubName,
        subEmail: prefillSubEmail || undefined,
        subCompanyId: prefillSubCompanyId || undefined,
        paidAmount: prefillAmount && Number.isFinite(Number(prefillAmount)) ? Number(prefillAmount) : 0,
        throughDate: normaliseThroughDate(prefillThroughDate),
        waiverType: type,
        // Why that type was picked, shown under the type chips — a default the
        // GC cannot see the reason for is a default he cannot check.
        waiverReason: type ? (prefillWaiverReason || undefined) : undefined,
      };
    }
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
        // Commitment has no companyId; the sub's roster id is subcontractorId.
        // Handover matches on commitmentId first, then this id.
        subCompanyId = commit.subcontractorId ?? undefined;
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
  }, [prefillFromInvoice, projectId, prefillAmount, prefillThroughDate, prefillSubName, prefillSubEmail, prefillSubCompanyId,
    prefillCommitmentId, prefillInvoiceId, prefillWaiverType, prefillWaiverReason,
    getInvoicesForProject, getCommitmentsForProject, subcontractors]);

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

  // Each read is numbered; only the newest may write state. Focus, the app
  // coming back to the foreground and pull-to-refresh can all fire together,
  // and an older answer landing last would put a stale list back on screen.
  const readSeq = useRef(0);
  const refresh = useCallback(async () => {
    if (!projectId) { setLoading(false); return; }
    const seq = ++readSeq.current;
    const res = await loadLienWaiversChecked(projectId);
    if (seq !== readSeq.current) return;
    if (res.ok) {
      setWaivers(res.waivers);
      setLoadError(null);
      setSeenAt(null);
      return;
    }
    // The read failed. Show what this phone last saw — labelled as such —
    // and never the "No waivers yet" card, which on a job with signed
    // releases is the one thing that must not be said (#30).
    const cached = await readLienWaiverCache(projectId);
    if (seq !== readSeq.current) return;
    setLoadError({ offline: isOfflineError(res.error) });
    if (cached) {
      setWaivers(cached.waivers);
      setSeenAt(cached.savedAt);
    }
    // No cache: whatever is on screen (empty on a first open) stays, and the
    // error card below says the list could not be read.
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      setLoading(true); await refresh(); setLoading(false);
    })();
  }, [refresh]);

  // #31: the screen used to read once, on mount, and never again — so a sub's
  // e-signature never appeared while the GC had it open, and "Record paper
  // waiver" was offered on a card the sub had already signed. Re-read when the
  // screen regains focus and when the app comes back from Mail or Messages.
  // The first focus is skipped: the mount effect above already reads.
  const focusedOnce = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focusedOnce.current) { focusedOnce.current = true; return; }
    void refresh();
  }, [refresh]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  }, [refresh]);

  const handleCreate = useCallback(async (input: { waiverType: LienWaiverType; subName: string; subEmail?: string; throughDate: string; paidAmount: number; notes?: string }) => {
    if (!projectId || !input.subName.trim()) return;
    const res = await createLienWaiverChecked({
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
    if (res.ok) {
      setWaivers(prev => [res.waiver, ...prev]);
      setAddModal(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void refresh();
    } else if (isOfflineError(res.error)) {
      // A waiver is created on the server (it carries the id the signing link
      // is built on), so offline it cannot be saved yet — say that, not "failed".
      showAlert('You’re offline', 'The waiver was not saved — this phone has no signal. Your entries are still in the form; tap Create again once you’re back online.');
    } else {
      showAlert('Save failed', `The waiver was not saved. ${res.error}`);
    }
  }, [projectId, prefillSeed, refresh]);

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
      // CONTRACT 25: a blocked pop-up on web reads as exactly that; anything
      // else keeps this screen's own sentence. No success haptic on this path.
      showAlert('Export failed', pdfFailureMessage(e, 'Could not generate the PDF. Try again.'));
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
      if (isOfflineError(result.error ?? '')) {
        // The token is minted on the server row before the email goes, so this
        // is online-only by design (an optimistic token is a link that 404s).
        showAlert('You’re offline', 'A signing link is created on the server, so it can only be sent with signal. Nothing was sent — try again once you’re back online.');
        return;
      }
      showAlert('Could not send', result.error || 'The signing request did not go out. Try again.');
    } finally {
      requestInFlight.current = false;
      setRequesting(null);
    }
  }, [branding, docCtxFor, refresh, settings, saveEmailThenRequest]);

  useEffect(() => { requestRef.current = handleRequestSignature; }, [handleRequestSignature]);

  // One write at a time per screen: a double tap on Void or Mark received used
  // to fire two upserts of the same stale card. The ref blocks re-entry at
  // once; `busy` greys the card on the next render.
  const writeInFlight = useRef(false);

  /**
   * Change the status and nothing else (#31) — never an upsert of the card,
   * which rewrote the sub's email, the notes and the amount with this phone's
   * stale copy. And say when it did not save (#30): Void and Mark received
   * used to fail with no message at all.
   */
  const handleStatusChange = useCallback(async (w: LienWaiver, status: LienWaiver['status']) => {
    if (writeInFlight.current) return;
    writeInFlight.current = true;
    setBusy(w.id);
    const verb = status === 'voided' ? 'void this waiver' : status === 'received' ? 'mark it received' : 'update this waiver';
    try {
      const res = await updateLienWaiverStatus(w.id, status);
      if (!res.ok) {
        showAlert(
          `Couldn’t ${verb}`,
          isOfflineError(res.error)
            ? 'Not saved — this phone is offline. Check your signal and try again.'
            : 'Not saved. Check your signal and try again.',
        );
        return;
      }
      if (!res.waiver) {
        showAlert(`Couldn’t ${verb}`, 'This waiver is no longer on the job — it may have been deleted on another device. The list has been refreshed.');
        void refresh();
        return;
      }
      const saved = res.waiver;
      setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      void refresh();
    } finally {
      writeInFlight.current = false;
      setBusy(null);
    }
  }, [refresh]);

  /**
   * Void behind a destructive confirm (#31). The row is re-read first, because
   * the card may still say REQUESTED over a release the sub signed a minute
   * ago — and voiding a signed release is the one version of this that needs
   * to be said out loud.
   */
  const handleVoid = useCallback(async (w: LienWaiver) => {
    const fresh = await fetchLienWaiverChecked(w.id);
    const current = fresh.ok && fresh.waiver ? fresh.waiver : w;
    if (fresh.ok && fresh.waiver) setWaivers(prev => prev.map(x => x.id === w.id ? current : x));
    if (fresh.ok && !fresh.waiver) {
      showAlert('This waiver is gone', 'It is no longer on the job — it may have been deleted on another device.');
      void refresh();
      return;
    }
    if (current.status === 'voided') return;
    const signedBody = current.signedAt
      ? `${current.subName}'s signed release${current.subSignature?.role === 'gc' ? ' (your paper record)' : ''} from ${new Date(current.signedAt).toLocaleDateString()} will be marked VOID. You can no longer rely on it, and this can't be undone.`
      : `The signing link stops working and ${current.subName} can no longer sign it. This can't be undone.`;
    showAlert(
      current.signedAt ? 'Void a signed waiver?' : 'Void this waiver?',
      signedBody,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Void', style: 'destructive', onPress: () => { void handleStatusChange(current, 'voided'); } },
      ],
    );
  }, [handleStatusChange, refresh]);

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
      if (writeInFlight.current) return;
      writeInFlight.current = true;
      setBusy(w.id);
      try {
        // Conditional on the ROW still being unsigned (#31): this used to be an
        // upsert of the card, which replaced a sub's e-signature and consent
        // record with the GC's paper note whenever the card was stale.
        const res = await recordPaperLienWaiver(w.id, name);
        if (res.ok) {
          const saved = res.waiver;
          setWaivers(prev => prev.map(x => x.id === w.id ? saved : x));
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          void refresh();
        } else if (res.reason === 'already_signed') {
          const live = res.waiver;
          if (live) setWaivers(prev => prev.map(x => x.id === w.id ? live : x));
          void refresh();
          const on = live?.signedAt ? new Date(live.signedAt).toLocaleDateString() : 'an earlier date';
          showAlert(
            live?.subSignature?.role === 'gc' ? 'Already recorded' : `${w.subName} already e-signed this`,
            live?.subSignature?.role === 'gc'
              ? `A paper record for this waiver was already saved on ${on}. Nothing was changed.`
              : `${live?.subSignature?.name || w.subName} already e-signed this on ${on}; their electronic signature is on file. No paper record was added over it.`,
          );
        } else {
          showAlert(
            'Save failed',
            isOfflineError(res.error)
              ? 'Not saved — this phone is offline. Check your signal and try again.'
              : 'Could not record this waiver. Check your signal and try again.',
          );
        }
      } catch (e) {
        showAlert('Save failed', e instanceof Error ? e.message : 'Try again.');
      } finally {
        writeInFlight.current = false;
        setBusy(null);
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
  }, [refresh]);

  const handleDelete = useCallback((w: LienWaiver) => {
    showAlert(
      `Delete waiver for ${w.subName}?`,
      'This is permanent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (writeInFlight.current) return;
            writeInFlight.current = true;
            setBusy(w.id);
            try {
              // True only when a row actually went (#30) — a filtered delete
              // answers "no error" too, and the card used to vanish over a row
              // that was still on the server.
              const ok = await deleteLienWaiver(w.id);
              if (ok) {
                setWaivers(prev => prev.filter(x => x.id !== w.id));
                void refresh();
              } else {
                showAlert('Couldn’t delete', 'The waiver was not deleted. Check your signal and try again.');
                void refresh();
              }
            } finally {
              writeInFlight.current = false;
              setBusy(null);
            }
          },
        },
      ],
    );
  }, [refresh]);

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

      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onPullRefresh(); }} tintColor={themeColors.accent} />}
      >
        {loading && (
          <View style={styles.loading}><ActivityIndicator size="small" color={themeColors.accent} /></View>
        )}

        {/* #30 — a read that failed is said as one. With a list on screen it
            is labelled as what this phone last saw; with nothing to show it is
            an error card, never "No waivers yet" and never a New button that
            invites a duplicate of a waiver the job may already have. */}
        {!loading && loadError && waivers.length > 0 && (
          <View style={styles.staleBanner} testID="lien-waivers-stale">
            <WifiOff size={14} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.staleBannerText}>
              {loadError.offline
                ? `Offline — showing what this phone last saw at ${seenAtLabel(seenAt)}.`
                : `Couldn’t refresh — showing what this phone last saw at ${seenAtLabel(seenAt)}.`}
            </Text>
            <TouchableOpacity onPress={() => { void onPullRefresh(); }} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.staleBannerAction}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loading && loadError && waivers.length === 0 && (
          <View style={styles.emptyCard} testID="lien-waivers-load-failed">
            <WifiOff size={28} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>Couldn&apos;t load waivers — check your signal</Text>
            <Text style={styles.emptyBody}>
              This phone has no saved copy of this job&apos;s waivers, so we can&apos;t say whether any exist.
              Nothing has been lost — retry once you have signal.
            </Text>
            <TouchableOpacity style={styles.bigCta} onPress={() => { void onPullRefresh(); }} accessibilityRole="button">
              <Text style={styles.bigCtaText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !loadError && waivers.length === 0 && (
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
            busy={busy === w.id}
            offline={!!loadError?.offline}
            formLabel={lienWaiverFormLabel(w, docCtx)}
            onExport={() => handleExport(w)}
            onRequestSignature={() => handleRequestSignature(w)}
            onRecordPaper={() => handleRecordPaper(w)}
            onMarkReceived={() => handleStatusChange(w, 'received')}
            onMarkVoid={() => { void handleVoid(w); }}
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

function WaiverCard({ waiver, exporting, requesting, busy, offline, formLabel, onExport, onRequestSignature, onRecordPaper, onMarkReceived, onMarkVoid, onDelete }: {
  waiver: LienWaiver;
  exporting: boolean;
  requesting: boolean;
  /** A status change / paper record / delete for this card is in flight. */
  busy: boolean;
  /** The last read failed for want of signal — sending a link needs the server. */
  offline: boolean;
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
          <TouchableOpacity
            style={[styles.actionPrimary, (offline || busy) && styles.actionDisabled]}
            onPress={onRequestSignature}
            disabled={requesting || offline || busy}
            accessibilityState={{ disabled: requesting || offline || busy }}
          >
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
          <TouchableOpacity style={[styles.actionSecondary, busy && styles.actionDisabled]} onPress={onRecordPaper} disabled={busy}>
            <FileSignature size={13} color={themeColors.text} strokeWidth={1.75} />
            <Text style={styles.actionSecondaryText}>Record paper waiver</Text>
          </TouchableOpacity>
        )}
        {waiver.status === 'signed' && (
          <TouchableOpacity style={[styles.actionPrimary, busy && styles.actionDisabled]} onPress={onMarkReceived} disabled={busy}>
            <CheckCircle2 size={13} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.actionPrimaryText}>Mark received</Text>
          </TouchableOpacity>
        )}
        {(waiver.status === 'requested' || waiver.status === 'signed') && (
          <TouchableOpacity style={[styles.actionGhost, busy && styles.actionDisabled]} onPress={onMarkVoid} disabled={busy}>
            <XCircle size={13} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.actionGhostText}>Void</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.actionGhost, busy && styles.actionDisabled]} onPress={onDelete} disabled={busy} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={13} color={themeColors.danger} strokeWidth={1.75} /></TouchableOpacity>
      </View>
      {offline && waiver.status === 'requested' && (
        // The signing link is minted on the server row before the email goes —
        // an optimistic, queued token would be a link that 404s — so offline
        // the button is greyed and says why rather than failing on the tap.
        <Text style={styles.offlineNote}>Sending a signing link needs signal. Pull down to retry once you&apos;re back online.</Text>
      )}
    </View>
  );
}

function NewWaiverModal({ visible, onClose, onCreate, seed }: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { waiverType: LienWaiverType; subName: string; subEmail?: string; throughDate: string; paidAmount: number; notes?: string }) => void;
  /** Optional prefill from a "Create lien waiver" CTA on a paid invoice. */
  seed?: { subName?: string; subEmail?: string; paidAmount?: number; throughDate?: string; waiverType?: LienWaiverType; waiverReason?: string } | null;
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
      setType(seed?.waiverType ?? 'unconditional_partial');
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
            {LIEN_WAIVER_TYPES.map(t => (
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
          {seed?.waiverType && seed.waiverReason && type === seed.waiverType && (
            <Text style={styles.typeHint}>Picked for this payment: {seed.waiverReason}</Text>
          )}

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
  actionDisabled: { opacity: 0.45 },
  offlineNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16 },

  staleBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: Tokens.radius.md, marginBottom: 12,
    backgroundColor: Colors.warning + '0D',
    borderWidth: 1, borderColor: Colors.warning + '30',
  },
  staleBannerText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.text, lineHeight: 16 },
  staleBannerAction: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.accent },

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
