import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput, Platform} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Copy, Send, Link, Check, X, RefreshCw, Lock,
  HardHat, Building2, FileText, Inbox, Mail, FileSignature,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import type { LienWaiver, SubPortalLink } from '@/types';
import { loadLienWaiversChecked, WAIVER_LABELS } from '@/utils/lienWaiverEngine';
import { shareText } from '@/utils/shareText';
import { generateUUID } from '@/utils/generateId';
import { useSubSubmittedInvoices } from '@/hooks/useSubSubmittedInvoices';
import { PayWhatsEarnedCard } from '@/components/subInvoice/PayWhatsEarnedCard';
import { copyToClipboard } from '@/utils/clipboard';
import { SendPortalLinkModal } from '@/components/SendPortalLinkModal';
import RecordPaymentModal, { type PaymentDetail } from '@/components/RecordPaymentModal';
import { reconciliationState, reconciliationLabel, paymentSummary } from '@/utils/apReconciliation';
import {
  buildSubPortalSnapshot, buildSubPortalUrl, buildShortSubPortalUrl,
} from '@/utils/subPortalSnapshot';
import { formatMoney } from '@/utils/formatters';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWriteDetailed } from '@/utils/offlineQueue';
import { pendingRetentionHeld } from '@/utils/invoiceBilling';
import { sendEmail } from '@/utils/emailService';
import {
  wrapEmailHtml, emailDivider, emailQuote,
} from '@/utils/emailLayout';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const SUB_PORTAL_BASE_URL = 'https://mageid.app/sub-portal';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://nteoqhcswappxxjlpvap.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';

/** The four numbers the "Overpayment risk" dialog puts in front of the GC. */
export interface SubOverpayment {
  overage: number;
  commitmentTotal: number;
  alreadyApproved: number;
  thisAmount: number;
}

/** Minimal shapes this math needs — kept structural so the guard script can
 *  exercise it without dragging in SubSubmittedInvoice/Commitment. */
interface OverpaymentInvoice {
  id: string;
  amount?: number;
  status: string;
  commitmentId?: string;
}
interface OverpaymentCommitment {
  amount?: number;
  changeAmount?: number;
  paidToDate?: number;
}

// --- BEGIN computeSubOverpayment (extracted + executed by
//     scripts/validate-sub-overpayment.ts — keep the sentinels) ---
/**
 * Would paying/approving `invoice` push this sub past their commitment value?
 * Returns null when it would not. Pure and exported so the guard can pin the
 * exact dollar figures the dialog shows.
 */
export function computeSubOverpayment(args: {
  invoice: OverpaymentInvoice;
  commitment: OverpaymentCommitment;
  /** Every sub-submitted invoice on this portal, including `invoice` itself. */
  siblings: OverpaymentInvoice[];
}): SubOverpayment | null {
  const { invoice, commitment, siblings } = args;
  const commitmentTotal = (commitment.amount ?? 0) + (commitment.changeAmount ?? 0);
  const thisAmount = invoice.amount ?? 0;

  // commitment.paidToDate is the server rollup kept by the
  // recompute_commitment_paid_to_date trigger, and it sums every APPROVED
  // *and* PAID sub invoice on the commitment. "Mark paid" only renders on
  // invoices that are already 'approved', so the invoice in hand is ALREADY
  // inside paidToDate — the old `paidToDate + thisAmount` counted this draw
  // twice. On the final $10,000 draw of a fully-billed $50,000 commitment the
  // GC got a blocking destructive "Overpayment risk / Overage: $10,000" on a
  // payment that was exactly on contract. Subtract our own contribution back
  // out here so it is added exactly once below. On the approve path the
  // invoice is still 'submitted', so nothing is subtracted — that path was
  // always right.
  const countedInRollup = invoice.status === 'approved' || invoice.status === 'paid';
  const rollupAlreadyApproved = typeof commitment.paidToDate === 'number'
    ? Math.max(0, commitment.paidToDate - (countedInRollup ? thisAmount : 0))
    : 0;

  // Same figure computed from what THIS device knows. The old code treated
  // this as an either/or fallback for "offline or column missing", but
  // ProjectContext maps `paid_to_date == null ? 0 : Number(...)`, so the
  // value is never null and the fallback was dead code. That mattered in the
  // other direction: an approval made offline is queued by supabaseWrite and
  // the trigger has not run, so the rollup reads stale-low (0 on a brand-new
  // commitment) and the guard silently failed OPEN. Take the larger of the
  // two — the server sees invoices this device never cached, and this device
  // sees approvals the server has not rolled up yet.
  const localAlreadyApproved = siblings
    .filter(i => i.id !== invoice.id
      && i.commitmentId === invoice.commitmentId
      && (i.status === 'approved' || i.status === 'paid'))
    .reduce((sum, i) => sum + (i.amount ?? 0), 0);

  const alreadyApproved = Math.max(rollupAlreadyApproved, localAlreadyApproved);
  const overage = alreadyApproved + thisAmount - commitmentTotal;
  if (overage <= 0) return null;
  return { overage, commitmentTotal, alreadyApproved, thisAmount };
}
// --- END computeSubOverpayment ---

/** Minimal shapes the release prefill needs — structural for the same reason. */
interface ReleaseInvoice extends OverpaymentInvoice {
  retentionAmount?: number;
  /** The day money left the account (YYYY-MM-DD). */
  paidOn?: string;
  /** When the GC recorded the payment (ISO instant). */
  paidAt?: string;
  createdAt?: string;
}
interface ReleaseSub {
  id: string;
  companyName: string;
  email?: string;
}

// --- BEGIN subPaymentReleasePrefill (extracted + executed by
//     scripts/validate-sub-overpayment.ts — keep the sentinels) ---
/**
 * The lien-waiver prefill for ONE sub invoice, as /lien-waivers route params.
 *
 * Screen audit 2026-09-16 (subs-network): the GC paid the sub from this screen
 * and nothing asked for the release, although app/lien-waivers.tsx can build
 * and email one. An unwaived payment is how a second-tier supplier or the
 * sub's own crew liens the owner's property AFTER the sub was paid; the moment
 * the sub is motivated to sign is before or as the money moves, not at
 * closeout.
 *
 * Identity is passed EXPLICITLY (name, email, sub id, commitment id) rather
 * than as an invoice id for the waiver screen to resolve: that screen reads
 * owner `Invoice` rows, has no reader for sub_submitted_invoices, and its
 * commitment walk depends on a field `Invoice` does not carry — a lookup would
 * silently open a blank form.
 *
 * Waiver type follows what has actually happened to the money:
 *   approved, not yet paid → CONDITIONAL (the release takes effect only when
 *                            the payment clears — asking for an unconditional
 *                            one before paying is asking him to waive for
 *                            money he does not have)
 *   paid                   → UNCONDITIONAL
 *   …_FINAL only when this draw brings the commitment to its full value AND
 *   no retainage is held on any of its invoices — retainage still owed means
 *   the sub has not been paid in full, and a final release would waive it.
 *   No commitment on the invoice (the portal lets a sub bill "whole
 *   contract") → partial, because final-draw arithmetic is not available and
 *   a guessed "final" would be a waiver of rights nobody computed.
 */
export function subPaymentReleasePrefill(args: {
  projectId: string;
  invoice: ReleaseInvoice;
  sub: ReleaseSub;
  commitment: OverpaymentCommitment | null;
  siblings: ReleaseInvoice[];
}): Record<string, string> & { prefillWaiverType: string; prefillWaiverReason: string } {
  const { projectId, invoice, sub, commitment, siblings } = args;
  const paid = invoice.status === 'paid';
  const thisAmount = invoice.amount ?? 0;

  let isFinal = false;
  let finalReason = '';
  if (invoice.commitmentId && commitment) {
    const commitmentTotal = (commitment.amount ?? 0) + (commitment.changeAmount ?? 0);
    const onCommitment = siblings.filter(i => i.commitmentId === invoice.commitmentId
      && (i.status === 'approved' || i.status === 'paid'));
    const localOthers = onCommitment
      .filter(i => i.id !== invoice.id)
      .reduce((sum, i) => sum + (i.amount ?? 0), 0);
    // The release is only offered on approved/paid invoices, and the
    // paid_to_date rollup already counts those — take this draw back out so it
    // is added exactly once (the computeSubOverpayment double-count, again).
    const rollupOthers = typeof commitment.paidToDate === 'number'
      ? Math.max(0, commitment.paidToDate - thisAmount)
      : 0;
    const billedThrough = Math.max(localOthers, rollupOthers) + thisAmount;
    // Through the one retainage definition (utils/invoiceBilling), not the raw
    // column — a sub invoice carries only the stored amount, so this is that
    // amount floored at zero, but it stays one answer if the row ever grows a
    // percent or a release.
    const retainageHeld = [invoice, ...onCommitment].some(i => pendingRetentionHeld({ retentionAmount: i.retentionAmount }) > 0);
    if (commitmentTotal > 0 && billedThrough >= commitmentTotal - 0.005) {
      if (retainageHeld) finalReason = 'This draw completes the contract, but retainage is still held, so the release stays partial until it is paid.';
      else { isFinal = true; finalReason = 'This draw brings the contract to its full value.'; }
    }
  } else {
    finalReason = 'This invoice is not tied to a commitment, so the app cannot tell whether it is the last draw.';
  }

  const waiverType = `${paid ? 'unconditional' : 'conditional'}_${isFinal ? 'final' : 'partial'}`;
  const moneyReason = paid
    ? 'You recorded this payment, so the release is unconditional.'
    : 'Not paid yet, so the release is conditional on the payment clearing.';

  const params: Record<string, string> = {
    projectId,
    prefillSubName: sub.companyName,
    prefillSubCompanyId: sub.id,
    prefillInvoiceId: invoice.id,
    prefillAmount: String(thisAmount),
    // The day the money moved when recorded, else when the payment was logged,
    // else the day the sub billed. lien-waivers normalises an instant to its
    // LOCAL calendar day.
    prefillThroughDate: invoice.paidOn || invoice.paidAt || invoice.createdAt || '',
    prefillWaiverType: waiverType,
    prefillWaiverReason: [moneyReason, finalReason].filter(Boolean).join(' '),
  };
  if (sub.email) params.prefillSubEmail = sub.email;
  if (invoice.commitmentId) params.prefillCommitmentId = invoice.commitmentId;
  return params as Record<string, string> & { prefillWaiverType: string; prefillWaiverReason: string };
}
// --- END subPaymentReleasePrefill ---

/**
 * Read-backs after writing a link that has no token yet. The write rides the
 * offline queue, so the server's default lands whenever the queue flushes; past
 * the last read the GC gets "Try again" rather than an endless wait.
 */
const SUB_TOKEN_READBACK_DELAYS_MS = [1200, 3000, 8000, 20000];

export default function SubPortalSetupScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess } = useTierAccess();
  // Subcontractor management is a Business-only feature per the paywall
  // claim. Pre-fix the FeatureKey existed but had no callsite — any tier
  // could configure sub portals. Wiring it here gates the entry point;
  // the rest of the sub workflows (sub list view, COI, prequal) were
  // already either gated by other keys or are read-only.
  if (!canAccess('subcontractor_management')) {
    return (
      <Paywall
        visible={true}
        feature="Subcontractor Portals"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SubPortalSetupScreenInner />;
}

/**
 * Waits for the saved sub portal links before the editor mounts.
 *
 * The editor decides ONCE, in its state initialiser, whether this sub already
 * has a link or gets a new one — and the new one is written straight away so
 * the server can mint its token. Mounted before the links had loaded, that
 * decision read "no link" for a sub who had one, and the write created a
 * second row: a second portal URL for the same sub, with the first one the GC
 * had already sent still live. An 800ms grace before the write papered over it
 * on a fast load and lost on a slow one. Now there is nothing to race: until
 * the context says the links are loaded (from the server or the local cache),
 * no link is chosen and nothing is written.
 */
function SubPortalSetupScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { subPortalLinksLoaded } = useProjects();
  if (!subPortalLinksLoaded) {
    return (
      <View style={styles.loadingContainer} testID="sub-portal-links-loading">
        <Stack.Screen
          options={{
            title: 'Sub Portal',
            headerLeft: () => (
              <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
                <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
              </TouchableOpacity>
            ),
          }}
        />
        <Text style={styles.loadingText}>Loading this sub&apos;s portal link…</Text>
      </View>
    );
  }
  return <SubPortalSetupEditor />;
}

function SubPortalSetupEditor() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { projectId, subId } = useLocalSearchParams<{ projectId: string; subId: string }>();

  // Only mounted once subPortalLinksLoaded is true (see SubPortalSetupScreenInner),
  // so `existing` below is the loaded answer and the initialiser's "new link"
  // branch is reached only for a sub who genuinely has none.
  const {
    getProject, subcontractors, settings,
    getCommitmentsForProject, getPunchItemsForProject, getPlanSheetsForProject,
    getSubPortalLinkFor, upsertSubPortalLink, adoptSubPortalToken,
    commitments: allCommitments,
  } = useProjects();

  const project = useMemo(() => projectId ? getProject(projectId) : undefined, [projectId, getProject]);
  const sub = useMemo(() => subcontractors.find(s => s.id === subId), [subcontractors, subId]);
  const commitments = useMemo(() => projectId ? getCommitmentsForProject(projectId).filter(c => c.subcontractorId === subId) : [], [projectId, subId, getCommitmentsForProject]);
  const projectPunchItems = useMemo(() => projectId ? getPunchItemsForProject(projectId) : [], [projectId, getPunchItemsForProject]);
  // For the "On sheet A-101" label on pinned items in the sub's portal.
  const projectPlanSheets = useMemo(() => projectId ? getPlanSheetsForProject(projectId) : [], [projectId, getPlanSheetsForProject]);

  const existing = useMemo(() =>
    projectId && subId ? getSubPortalLinkFor(projectId, subId) : undefined,
    [projectId, subId, getSubPortalLinkFor],
  );

  const [link, setLink] = useState<SubPortalLink>(() => {
    if (existing) return existing;
    return {
      id: `sub-portal-${(projectId ?? '').slice(0, 6)}-${(subId ?? '').slice(0, 6)}-${Date.now().toString(36)}`,
      projectId: projectId ?? '',
      subcontractorId: subId ?? '',
      enabled: true,
      requirePasscode: false,
      welcomeMessage: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  const submitted = useSubSubmittedInvoices({ subPortalId: link.id });

  // Lien releases already collected on this job, keyed by the sub invoice they
  // were collected against, so each row can show "paid" and "released" as the
  // two different facts they are. Re-read on focus: the release is created on
  // /lien-waivers and this screen is what the GC comes back to.
  const [releases, setReleases] = useState<LienWaiver[]>([]);
  // #30 (CONTRACT 6): a failed read is not "no release on file" — reading it
  // that way offered "Collect release" for a payment already released, and a
  // second waiver sent to a sub who signed the first.
  const [releasesReadFailed, setReleasesReadFailed] = useState(false);
  useFocusEffect(useCallback(() => {
    if (!projectId) return;
    let live = true;
    void loadLienWaiversChecked(projectId)
      .then(res => {
        if (!live) return;
        if (res.ok) { setReleases(res.waivers); setReleasesReadFailed(false); }
        else setReleasesReadFailed(true);
      })
      .catch(() => { if (live) setReleasesReadFailed(true); });
    return () => { live = false; };
  }, [projectId]));
  const releasesByInvoice = useMemo(() => {
    const m = new Map<string, LienWaiver[]>();
    for (const w of releases) {
      if (!w.invoiceId || w.status === 'voided') continue;
      m.set(w.invoiceId, [...(m.get(w.invoiceId) ?? []), w]);
    }
    return m;
  }, [releases]);

  /** `asPaid` — the payment was JUST recorded and the invoice list has not
   *  re-rendered with it yet, so read the invoice as paid on that day. */
  const openRelease = useCallback((invoiceId: string, asPaid?: { paidOn?: string }) => {
    const found = submitted.invoices.find(i => i.id === invoiceId);
    if (!found || !sub || !projectId) return;
    const inv = asPaid
      ? { ...found, status: 'paid' as const, paidOn: asPaid.paidOn ?? found.paidOn, paidAt: found.paidAt ?? new Date().toISOString() }
      : found;
    const params = subPaymentReleasePrefill({
      projectId,
      invoice: inv,
      sub: { id: sub.id, companyName: sub.companyName, email: sub.email },
      commitment: inv.commitmentId ? allCommitments.find(c => c.id === inv.commitmentId) ?? null : null,
      siblings: submitted.invoices,
    });
    router.push({ pathname: '/lien-waivers', params } as never);
  }, [submitted.invoices, sub, projectId, allCommitments, router]);
  /** Invoice id whose payment sheet is open (mark-paid or detail correction). */
  const [payingId, setPayingId] = useState<string | null>(null);

  const snapshot = useMemo(() => {
    if (!project || !sub) return null;
    return buildSubPortalSnapshot({
      link,
      project,
      sub,
      settings,
      commitments,
      submittedInvoices: submitted.invoices,
      punchItems: projectPunchItems,
      planSheets: projectPlanSheets,
      schedule: project.schedule,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      contactEmail: settings?.branding?.email,
      contactName: settings?.branding?.contactName ?? settings?.branding?.companyName,
    });
  }, [link, project, sub, settings, commitments, submitted.invoices, projectPunchItems, projectPlanSheets]);

  // Server copy of the snapshot (sub_portal_snapshots), written through the
  // offline queue like every other write. The page reads it FIRST — with the
  // punch list merged live at read time (migration 20260919200000) — so a
  // SHORT link (no #d= hash) is the one worth handing out: it never freezes.
  // But only once the server copy is known to exist for this link; before
  // that (queued offline, refused, still in flight) a short link would open
  // the "link not found" page, so the long link with the hash goes out
  // instead and still works on its own. `serverCopyFor` is the link id whose
  // copy has been confirmed written.
  const [serverCopyFor, setServerCopyFor] = useState<string | null>(null);
  useEffect(() => {
    if (!snapshot || !project?.id || !link.id) return;
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void supabaseWriteDetailed('sub_portal_snapshots', 'upsert', {
        sub_portal_id: link.id,
        project_id: project.id,
        snapshot: snapshot as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      }).then(outcome => {
        if (cancelled) return;
        // 'queued' / 'failed' leave an earlier confirmed copy standing: the row
        // exists, and the page merges the punch list live either way.
        if (outcome === 'synced') setServerCopyFor(link.id);
      });
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [snapshot, project?.id, link.id]);

  const portalUrl = useMemo(() => {
    // The no-snapshot fallback used to be `${SUB_PORTAL_BASE_URL}/${link.id}`
    // — the sub-portal twin of the token-less homeowner link. Both sub-portal
    // RPCs gate on `?t=`, so that URL opened a page the sub could read and
    // could not submit an invoice from, and it was what Copy, Share and the
    // email invite all handed out until the first snapshot landed.
    if (!snapshot || serverCopyFor === link.id) return buildShortSubPortalUrl(SUB_PORTAL_BASE_URL, link.id, link.accessToken);
    return buildSubPortalUrl(SUB_PORTAL_BASE_URL, link.id, snapshot, link.accessToken);
  }, [snapshot, link.id, link.accessToken, serverCopyFor]);

  // The link's `?t=` token is the SERVER's (sub_portal_links.access_token has a
  // random default). If this screen's copy has none — a brand-new link, or one
  // cached before the loader carried the token — write the link (an upsert;
  // `access_token` is omitted, so an existing token is untouched and a new row
  // gets the default) and read the token back until it lands. Never mint one
  // here: a phone-made token is one the server never agreed to, and every link
  // shared with it fails on the sub's first invoice.
  //
  // Also adopt the loaded link's token when the read-back (or a later refetch)
  // delivers it after this screen mounted — and a different link for this sub
  // if one arrives before this screen has written its own.
  const wroteLinkRef = React.useRef(false);
  const latestLinkRef = React.useRef(link);
  latestLinkRef.current = link;
  useEffect(() => {
    if (!existing) return;
    if (existing.id === link.id) {
      if (existing.accessToken && existing.accessToken !== link.accessToken) {
        const serverToken = existing.accessToken;
        setLink(l => ({ ...l, accessToken: serverToken }));
      }
    } else if (!wroteLinkRef.current) {
      setLink(existing);
    }
  }, [existing, link.id, link.accessToken]);

  const [tokenState, setTokenState] = useState<'idle' | 'working' | 'failed'>('idle');
  const [tokenAttempt, setTokenAttempt] = useState(0);
  useEffect(() => {
    if (!link.enabled || link.accessToken) return;
    if (!isSupabaseConfigured) { setTokenState('failed'); return; }
    let cancelled = false;
    setTokenState('working');
    const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    void (async () => {
      // No wait before this write: the editor only mounts after the saved links
      // have loaded, so `link` is already the sub's existing link or a
      // genuinely new one — never a stand-in for a link that hasn't loaded.
      wroteLinkRef.current = true;
      upsertSubPortalLink(latestLinkRef.current);
      for (const delay of SUB_TOKEN_READBACK_DELAYS_MS) {
        await wait(delay);
        if (cancelled) return;
        const { data, error } = await supabase
          .from('sub_portal_links').select('access_token').eq('id', link.id).maybeSingle();
        if (cancelled) return;
        const token = !error && typeof data?.access_token === 'string' && data.access_token ? data.access_token : null;
        if (token) {
          setLink(l => (l.id === link.id ? { ...l, accessToken: token } : l));
          adoptSubPortalToken(link.id, token);
          setTokenState('idle');
          return;
        }
      }
      if (!cancelled) setTokenState('failed');
    })();
    return () => { cancelled = true; };
    // Keyed on id/enabled/token and the Retry counter — not the whole link, or
    // every keystroke in the welcome message would restart the read-back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.id, link.enabled, link.accessToken, tokenAttempt]);

  // Copy / Share / Email all hand out portalUrl. Without the token that URL
  // opens a portal the sub cannot submit an invoice from, so each door stops
  // here and says why instead.
  const tokenPending = link.enabled && !link.accessToken;
  const warnIfTokenPending = useCallback((): boolean => {
    if (!tokenPending) return false;
    if (tokenState === 'failed') {
      showAlert(
        "Couldn't set up the secure link",
        "The link's security key hasn't come back from the server — you may be offline. The sub couldn't submit invoices from the link as it is.",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Try again', onPress: () => setTokenAttempt(n => n + 1) },
        ],
      );
    } else {
      showAlert(
        'Setting up the secure link',
        "The link's security key is on its way from the server. Try again in a few seconds.",
      );
    }
    return true;
  }, [tokenPending, tokenState]);

  const persist = useCallback((updates: Partial<SubPortalLink>) => {
    const next = { ...link, ...updates, updatedAt: new Date().toISOString() };
    // The token is never minted here — the read-back effect above fetches the
    // server's. `next` keeps whatever token this link already holds.
    wroteLinkRef.current = true;
    setLink(upsertSubPortalLink(next));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [link, upsertSubPortalLink]);

  // Send modal state — replaces the native-only shareText() path so
  // web users can actually dispatch the link instead of seeing nothing.
  const [showSendModal, setShowSendModal] = useState(false);

  const shareMessage = useMemo(
    () => `Hi ${sub?.contactName || sub?.companyName || ''}, here's your sub portal for ${project?.name ?? 'the project'}:\n\n${portalUrl}\n\nYou can review your scope and submit invoices from this page — no login needed.`,
    [sub?.contactName, sub?.companyName, project?.name, portalUrl],
  );

  const handleCopy = useCallback(async () => {
    if (warnIfTokenPending()) return;
    const ok = await copyToClipboard(portalUrl);
    if (Platform.OS !== 'web' && ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      ok ? 'Copied' : 'Copy failed',
      ok ? 'The sub portal link has been copied.' : 'Could not copy the link.',
    );
  }, [portalUrl, warnIfTokenPending]);

  const handleShare = useCallback(() => {
    if (warnIfTokenPending()) return;
    setShowSendModal(true);
    persist({ lastSharedAt: new Date().toISOString() });
  }, [persist, warnIfTokenPending]);

  // Email-the-link path. Routes through the send-email edge function
  // (Resend) so the invite arrives from noreply@mageid.app with the
  // GC's company name in the FROM line — instead of forcing the GC to
  // copy/paste the URL into Mail. Uses the shared wrapEmailHtml shell
  // so the invite matches the rest of MAGE ID's transactional mail.
  const [emailing, setEmailing] = useState(false);
  const handleEmailInvite = useCallback(async () => {
    if (!sub || !project) return;
    if (warnIfTokenPending()) return;
    const recipientEmail = (sub.email ?? '').trim();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      showAlert(
        'No email on file',
        `${sub.companyName} doesn't have an email saved. Edit the sub from the Subs tab to add one, then try again.`,
      );
      return;
    }
    setEmailing(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    try {
      const companyName = settings?.branding?.companyName || 'MAGE ID';
      const senderName = settings?.branding?.contactName || companyName;
      const senderEmail = settings?.branding?.email;
      const greeting = sub.contactName?.split(' ')[0] || sub.companyName;
      const passcodeLine = link.requirePasscode && link.passcode
        ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#4A5159;">
             Your passcode is <strong style="color:#0B0D10;font-size:18px;letter-spacing:1px;">${link.passcode}</strong> — keep it private.
           </p>`
        : '';

      const html = wrapEmailHtml({
        preheader: `Your sub portal for ${project.name} is ready — review your scope and submit invoices.`,
        eyebrow: 'Sub portal',
        title: `${project.name}`,
        subtitle: `Hi ${greeting}, ${companyName} just set up your portal.`,
        bodyHtml: [
          `<p style="margin:0 0 14px 0;font-size:14px;line-height:21px;color:#4A5159;">
             You can review your scope, see open punch items and schedule, and submit invoices for review — no app to install, no account to create. Bookmark the link below: your punch list on it is live, and you can mark items fixed from it. Contract and payment figures show the date your contractor last updated them.
           </p>`,
          link.welcomeMessage ? emailQuote(link.welcomeMessage) : '',
          passcodeLine,
          emailDivider(),
          `<p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:#4A5159;">
             <strong style="color:#0B0D10;">Project:</strong> ${project.name}<br/>
             ${project.location ? `<strong style="color:#0B0D10;">Location:</strong> ${project.location}<br/>` : ''}
             ${sub.trade ? `<strong style="color:#0B0D10;">Trade:</strong> ${sub.trade}<br/>` : ''}
           </p>`,
        ].join(''),
        cta: { label: 'Open your portal', href: portalUrl },
        companyName,
        project: { name: project.name, location: project.location },
        sender: { name: senderName, email: senderEmail, phone: settings?.branding?.phone },
      });

      const subject = `${project.name} — your sub portal from ${companyName}`;
      const result = await sendEmail({
        to: recipientEmail,
        subject,
        html,
        replyTo: senderEmail,
        fromCompanyName: companyName,
      });

      if (result.success) {
        persist({ lastSharedAt: new Date().toISOString() });
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showAlert('Invite sent', `${sub.companyName} should see the email within a minute.`);
      } else {
        showAlert('Could not send', result.error || 'The email did not go out. Try again or use Send link to message it manually.');
      }
    } catch (err) {
      console.error('[sub-portal-setup] email failed', err);
      showAlert('Could not send', 'Unexpected error. Try again or use Send link.');
    } finally {
      setEmailing(false);
    }
  }, [sub, project, settings, portalUrl, link, persist, warnIfTokenPending]);

  // Sub overpayment guard. Before approving or marking-paid a sub-submitted
  // invoice, check whether this invoice + everything previously approved/paid
  // against the same commitment would push the sub over the contract value.
  // Surfaces a confirm dialog the GC can override (an actual change-order may
  // explain the overage), but stops silent overpayment by default.
  const checkOverpayment = useCallback(
    (invoiceId: string): (SubOverpayment & { subName: string }) | null => {
      const invoice = submitted.invoices.find(i => i.id === invoiceId);
      if (!invoice || !invoice.commitmentId) return null;
      const commitment = allCommitments.find(c => c.id === invoice.commitmentId);
      if (!commitment) return null;
      const numbers = computeSubOverpayment({
        invoice,
        commitment,
        siblings: submitted.invoices,
      });
      if (!numbers) return null;
      return { ...numbers, subName: sub?.companyName ?? 'this sub' };
    },
    [submitted.invoices, allCommitments, sub],
  );

  const handleApprove = useCallback((id: string) => {
    const guard = checkOverpayment(id);
    const doApprove = () => {
      submitted.approve(id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    if (guard) {
      showAlert(
        'Overpayment risk',
        `Approving this would push ${guard.subName} over their commitment.\n\n` +
        `Commitment value: ${formatMoney(guard.commitmentTotal)}\n` +
        `Already approved: ${formatMoney(guard.alreadyApproved)}\n` +
        `This invoice: ${formatMoney(guard.thisAmount)}\n` +
        `Overage: ${formatMoney(guard.overage)}\n\n` +
        `If a change order covers this, approve anyway and update the commitment. Otherwise reject and ask the sub to revise.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Approve anyway', style: 'destructive', onPress: doApprove },
        ],
      );
      return;
    }
    doApprove();
  }, [submitted, checkOverpayment]);

  const handleReject = useCallback((id: string) => {
    submitted.reject(id, 'Rejected — please check the details and resubmit.');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [submitted]);

  const handleMarkPaid = useCallback((id: string) => {
    const guard = checkOverpayment(id);
    // Opens the reconciliation sheet rather than flipping status blind — MAGE
    // never moves the money, so the check/ACH detail is what makes paid-vs-owed
    // reconcile against a bank statement. The sheet is skippable.
    const openSheet = () => setPayingId(id);
    if (guard) {
      showAlert(
        'Overpayment risk',
        `Paying this invoice would push ${guard.subName} ${formatMoney(guard.overage)} over their commitment of ${formatMoney(guard.commitmentTotal)}. Update the commitment with a change order first, or pay anyway.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Pay anyway', style: 'destructive', onPress: openSheet },
        ],
      );
      return;
    }
    openSheet();
  }, [checkOverpayment]);

  /** Commit the payment (with or without detail) and close the sheet. */
  const commitPayment = useCallback((detail?: PaymentDetail) => {
    const id = payingId;
    if (!id) return;
    const target = submitted.invoices.find(i => i.id === id);
    // Already paid → this is a detail correction, which must NOT re-stamp
    // paid_at (that would overwrite when the payment was actually recorded).
    if (target?.status === 'paid' && detail) {
      submitted.reconcile(id, detail);
      setPayingId(null);
      return;
    }
    submitted.markPaid(id, detail);
    setPayingId(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Ask for the release NOW. Screen audit 2026-09-16: marking paid used to
    // close the sheet and say nothing, and a release chased at closeout is a
    // signature on money that left months ago — the sub has no reason to sign.
    // Skipped when an unconditional release is already on file for this
    // invoice (collected ahead of the payment).
    const onFile = releasesByInvoice.get(id) ?? [];
    if (onFile.some(w => w.waiverType.startsWith('unconditional'))) return;
    showAlert(
      'Collect the lien release?',
      `${sub?.companyName ?? 'The sub'} is paid. A signed release tied to this payment is your proof of it when a supplier or his crew files a lien on the owner's property, and the one he is most likely to sign is the one asked for today. The waiver opens pre-filled from this invoice, ready to send him to sign.`,
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Collect release', style: 'default', onPress: () => openRelease(id, { paidOn: detail?.paidOn }) },
      ],
    );
  }, [payingId, submitted, releasesByInvoice, sub, openRelease]);

  if (!project || !sub) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Sub Portal' }} />
        <Text style={styles.loadingText}>Project or sub not found.</Text>
      </View>
    );
  }

  const totalCommitment = commitments.reduce((s, c) => s + c.amount + (c.changeAmount ?? 0), 0);
  const pendingTotal = submitted.pending.reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Sub Portal',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        {...fabScroll}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <HardHat size={22} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.heroEyebrow}>Sub portal</Text>
          <Text style={styles.heroTitle}>{sub.companyName}</Text>
          <Text style={styles.heroMeta}>
            {sub.trade}{sub.contactName ? ` · ${sub.contactName}` : ''}
          </Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Commitment value</Text>
              <Text style={styles.heroStatValue}>{formatMoney(totalCommitment)}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Pending review</Text>
              <Text style={[styles.heroStatValue, submitted.pending.length > 0 && { color: themeColors.accent }]}>
                {submitted.pending.length} · {formatMoney(pendingTotal)}
              </Text>
            </View>
          </View>
        </View>

        {/* Share */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Share with {sub.contactName?.split(' ')[0] || 'sub'}</Text>
          <Text style={styles.sectionSubtitle}>
            One link to review their scope, submit invoices, and track payment — no account needed.
          </Text>
          <View style={styles.linkBox}>
            <Link size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.linkText} numberOfLines={1}>{portalUrl}</Text>
          </View>
          <View style={styles.shareRow}>
            <TouchableOpacity style={styles.shareBtn} onPress={handleCopy} activeOpacity={0.85}>
              <Copy size={16} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.shareBtnText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85}>
              <Send size={16} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareBtn, styles.shareBtnPrimary, emailing && { opacity: 0.6 }]}
              onPress={handleEmailInvite}
              disabled={emailing}
              activeOpacity={0.85}
            >
              <Mail size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={[styles.shareBtnText, { color: '#FFF' }]}>
                {emailing ? 'Sending…' : 'Email invite'}
              </Text>
            </TouchableOpacity>
          </View>
          {link.lastSharedAt && (
            <Text style={styles.lastShared}>
              Last shared {new Date(link.lastSharedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          )}
        </View>

        {/* Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <View style={styles.togglesCard}>
            <View style={[styles.toggleRow, styles.toggleRowBorder]}>
              <View style={styles.toggleLeft}>
                <RefreshCw size={18} color={themeColors.accent} strokeWidth={1.75} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Portal enabled</Text>
                  <Text style={styles.toggleDesc}>Disable to revoke the link</Text>
                </View>
              </View>
              <Switch
                value={link.enabled}
                onValueChange={val => persist({ enabled: val })}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>
            <View style={[styles.toggleRow, link.requirePasscode && styles.toggleRowBorder]}>
              <View style={styles.toggleLeft}>
                <Lock size={18} color={themeColors.accent} strokeWidth={1.75} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Require passcode</Text>
                  <Text style={styles.toggleDesc}>4-digit code shared separately</Text>
                </View>
              </View>
              <Switch
                value={!!link.requirePasscode}
                onValueChange={val => persist({ requirePasscode: val, passcode: val ? (link.passcode || String(Math.floor(1000 + Math.random() * 9000))) : undefined })}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>
            {link.requirePasscode && (
              <View style={styles.passcodeRow}>
                <Text style={styles.passcodeLabel}>Passcode</Text>
                <TextInput
                  style={styles.passcodeInput}
                  value={link.passcode ?? ''}
                  onChangeText={val => persist({ passcode: val.replace(/[^0-9]/g, '').slice(0, 4) })}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            )}
          </View>
        </View>

        {/* Commitments */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scope shared on portal</Text>
          {commitments.length === 0 ? (
            <View style={styles.emptyCard}>
              <Building2 size={28} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyText}>No commitments for this sub yet.</Text>
              <Text style={styles.emptySub}>Add a commitment to scope what they&apos;re billing against.</Text>
            </View>
          ) : (
            <View style={styles.cardList}>
              {commitments.map(c => {
                const total = c.amount + (c.changeAmount ?? 0);
                return (
                  <View key={c.id} style={styles.commitCard}>
                    <View style={styles.commitHead}>
                      <View style={styles.commitNumPill}>
                        <Text style={styles.commitNumText}>#{c.number}</Text>
                      </View>
                      <Text style={styles.commitDesc} numberOfLines={2}>{c.description}</Text>
                    </View>
                    <View style={styles.commitFoot}>
                      <Text style={styles.commitAmount}>{formatMoney(total)}</Text>
                      <Text style={styles.commitStatus}>{c.status}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Submitted invoices */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Invoices from {sub.companyName}</Text>
            {submitted.pending.length > 0 && (
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{submitted.pending.length} new</Text>
              </View>
            )}
          </View>
          {submitted.invoices.length === 0 ? (
            <View style={styles.emptyCard}>
              <Inbox size={28} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyText}>No invoices submitted yet.</Text>
              <Text style={styles.emptySub}>You&apos;ll see them here as soon as they&apos;re sent through the portal.</Text>
            </View>
          ) : (
            <View style={styles.cardList}>
              {submitted.invoices.map(inv => {
                const statusColor = inv.status === 'paid' ? themeColors.success
                  : inv.status === 'approved' ? themeColors.accent
                  : inv.status === 'rejected' ? themeColors.danger
                  : Colors.warningLabel;
                return (
                  <View key={inv.id} style={styles.invoiceCard}>
                    <View style={styles.invoiceHead}>
                      <View>
                        <Text style={styles.invoiceNum}>Invoice #{inv.invoiceNumber}</Text>
                        <Text style={styles.invoiceMeta}>
                          {new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {inv.submittedByName ? ` · ${inv.submittedByName}` : ''}
                        </Text>
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.statusPillText, { color: statusColor }]}>{inv.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.invoiceAmount}>{formatMoney(inv.amount)}</Text>
                    {inv.retentionAmount != null && inv.retentionAmount > 0 && (
                      <Text style={styles.invoiceRet}>
                        Retainage held: {formatMoney(inv.retentionAmount)}
                      </Text>
                    )}
                    {inv.description && (
                      <Text style={styles.invoiceDesc} numberOfLines={3}>{inv.description}</Text>
                    )}
                    {inv.lineItems && inv.lineItems.length > 0 && (
                      <View style={styles.invoiceLines}>
                        {inv.lineItems.slice(0, 5).map((li, idx) => (
                          <View key={idx} style={styles.invoiceLine}>
                            <Text style={styles.invoiceLineDesc} numberOfLines={1}>{li.description}</Text>
                            <Text style={styles.invoiceLineAmt}>{formatMoney(li.amount)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {inv.status === 'submitted' && project && sub ? (<PayWhatsEarnedCard invoice={inv} siblings={submitted.invoices} commitment={allCommitments.find(c => c.id === inv.commitmentId)} project={project} sub={sub} />) : null}
                    {inv.status === 'submitted' && (
                      <View style={styles.invoiceCtas}>
                        <TouchableOpacity
                          style={styles.invCtaReject}
                          onPress={() => handleReject(inv.id)}
                          disabled={submitted.isResponding}
                        >
                          <X size={14} color={themeColors.text} strokeWidth={1.75} />
                          <Text style={styles.invCtaText}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.invCtaApprove}
                          onPress={() => handleApprove(inv.id)}
                          disabled={submitted.isResponding}
                        >
                          <Check size={14} color="#FFF" strokeWidth={1.75} />
                          <Text style={[styles.invCtaText, { color: '#FFF' }]}>Approve</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {inv.status === 'approved' && (
                      <View style={styles.invoiceCtas}>
                        <TouchableOpacity
                          style={styles.invCtaApprove}
                          onPress={() => handleMarkPaid(inv.id)}
                          disabled={submitted.isResponding}
                        >
                          <Check size={14} color="#FFF" strokeWidth={1.75} />
                          <Text style={[styles.invCtaText, { color: '#FFF' }]}>Mark paid</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {/* Reconciliation — MAGE never moved this money, so show
                        whether the GC recorded HOW it was paid. An unreconciled
                        payment closes the balance in-app but ties to nothing on
                        a bank statement. */}
                    {inv.status === 'paid' && (() => {
                      const state = reconciliationState(inv);
                      const summary = paymentSummary(inv);
                      const done = state === 'reconciled';
                      return (
                        <View style={styles.reconRow}>
                          <Text
                            style={[styles.reconLabel, { color: done ? themeColors.successLabel : Colors.warning }]}
                            numberOfLines={1}
                          >
                            {summary ?? reconciliationLabel(inv)}
                          </Text>
                          {!done && (
                            <TouchableOpacity
                              onPress={() => setPayingId(inv.id)}
                              style={styles.reconBtn}
                              disabled={submitted.isResponding}
                              accessibilityRole="button"
                              accessibilityLabel="Add payment detail"
                              testID={`recon-add-${inv.id}`}
                            >
                              <Text style={styles.reconBtnText}>Add detail</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })()}
                    {/* Lien release — "paid" is not "released". Offered from
                        approval on, because a conditional release collected
                        BEFORE the money moves is the one the sub is motivated
                        to sign. */}
                    {(inv.status === 'approved' || inv.status === 'paid') && (() => {
                      const onFile = releasesByInvoice.get(inv.id) ?? [];
                      const unconditional = onFile.find(w => w.waiverType.startsWith('unconditional'));
                      const shown = unconditional ?? onFile[0];
                      // Paid against a conditional release only: the payment has
                      // cleared, so the unconditional one is now the document
                      // that ends a claim.
                      const needsUnconditional = inv.status === 'paid' && !unconditional;
                      const signed = shown && (shown.status === 'signed' || shown.status === 'received');
                      return (
                        <View style={styles.reconRow}>
                          <FileSignature
                            size={13}
                            color={shown && signed ? themeColors.successLabel : Colors.warningLabel}
                            strokeWidth={1.75}
                          />
                          <Text
                            style={[styles.reconLabel, { color: shown && signed ? themeColors.successLabel : Colors.warningLabel }]}
                            numberOfLines={2}
                          >
                            {shown
                              ? `${WAIVER_LABELS[shown.waiverType].short} release ${shown.status === 'requested' ? (shown.signRequestedAt ? 'sent, not signed' : 'drafted, not sent') : shown.status}`
                              : releasesReadFailed ? 'Couldn\u2019t check lien releases \u2014 check your signal'
                              : inv.status === 'paid' ? 'Paid · no lien release collected' : 'No lien release yet'}
                            {shown && needsUnconditional ? ' · unconditional still needed' : ''}
                          </Text>
                          {(!shown || needsUnconditional) && !releasesReadFailed ? (
                            <TouchableOpacity
                              onPress={() => openRelease(inv.id)}
                              style={styles.reconBtn}
                              accessibilityRole="button"
                              accessibilityLabel={`Collect lien release for invoice ${inv.invoiceNumber}`}
                              testID={`release-collect-${inv.id}`}
                            >
                              <Text style={styles.reconBtnText}>Collect release</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              onPress={() => router.push({ pathname: '/lien-waivers', params: { projectId: projectId ?? '' } } as never)}
                              style={styles.reconBtn}
                              accessibilityRole="button"
                              accessibilityLabel="Open lien waivers"
                              testID={`release-open-${inv.id}`}
                            >
                              <Text style={styles.reconBtnText}>View</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })()}
                    {inv.notesFromGc && (
                      <Text style={styles.invoiceNotes}>Note: {inv.notesFromGc}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
      <SendPortalLinkModal
        visible={showSendModal}
        onClose={() => setShowSendModal(false)}
        subject={`Sub portal — ${project?.name ?? 'Project'}`}
        message={shareMessage}
        link={portalUrl}
      />
      {(() => {
        const target = payingId ? submitted.invoices.find(i => i.id === payingId) : null;
        if (!target) return null;
        const isCorrection = target.status === 'paid';
        return (
          <RecordPaymentModal
            visible
            mode={isCorrection ? 'reconcile' : 'pay'}
            title={`Invoice #${target.invoiceNumber}`}
            amountLabel={formatMoney(target.amount)}
            initial={{
              method: target.paymentMethod,
              reference: target.paymentReference,
              paidOn: target.paidOn,
            }}
            onCancel={() => setPayingId(null)}
            onSubmit={(detail) => commitPayment(detail)}
            onSkip={isCorrection ? undefined : () => commitPayment(undefined)}
          />
        );
      })()}
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  loadingText: { color: t.textMuted, fontSize: Type.bodyCompact.fontSize },

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
  heroEyebrow: {
    fontSize: Type.caption2.fontSize, fontWeight: '700', letterSpacing: 1.5,
    color: t.accent, textTransform: 'uppercase', marginBottom: 4,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginBottom: 4 },
  heroMeta: { fontSize: Type.footnote.fontSize, color: t.textMuted },
  heroStats: { flexDirection: 'row', gap: 12, marginTop: 14 },
  heroStat: { flex: 1, padding: 12, borderRadius: Tokens.radius.md, backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line },
  heroStatLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 },
  heroStatValue: { fontSize: Type.body.fontSize, fontWeight: '800', color: t.text },

  section: { marginHorizontal: 16, marginBottom: 22 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sectionTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text },
  sectionSubtitle: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginTop: 2, marginBottom: 12, lineHeight: 18 },

  linkBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 10,
  },
  linkText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text },
  shareRow: { flexDirection: 'row', gap: 8 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  shareBtnPrimary: { backgroundColor: t.accentFill, borderColor: t.accent },
  shareBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  lastShared: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 8 },

  togglesCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: t.line },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleLabels: { flex: 1 },
  toggleLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  toggleDesc: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },
  passcodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  passcodeLabel: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  passcodeInput: {
    backgroundColor: t.bg, borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 8,
    fontSize: Type.subheadline.fontSize, fontWeight: '700', letterSpacing: 4,
    minWidth: 100, textAlign: 'center',
    color: t.text,
  },

  cardList: { gap: 10 },
  commitCard: {
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  commitHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  commitNumPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs, backgroundColor: t.accent + '15' },
  commitNumText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent },
  commitDesc: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text, lineHeight: 19 },
  commitFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commitAmount: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text },
  commitStatus: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },

  emptyCard: {
    alignItems: 'center', padding: 26,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, borderStyle: 'dashed',
    gap: 6,
  },
  emptyText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  emptySub: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 17 },

  pendingBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.full, backgroundColor: t.accent + '15' },
  pendingBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent },

  invoiceCard: {
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  invoiceHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  invoiceNum: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  invoiceMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  invoiceAmount: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginVertical: 4 },
  invoiceRet: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginBottom: 4 },
  invoiceDesc: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18, marginVertical: 6 },
  invoiceLines: { marginTop: 8, gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line },
  invoiceLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  invoiceLineDesc: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textMuted },
  invoiceLineAmt: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },

  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  statusPillText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },

  invoiceCtas: { flexDirection: 'row', gap: 8, marginTop: 12 },
  invCtaApprove: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
  },
  invCtaReject: {
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 11, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  invCtaText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  invoiceNotes: { marginTop: 10, fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic', lineHeight: 17 },
  // Payment reconciliation strip on a paid invoice.
  reconRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  reconLabel: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '600' },
  reconBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
  },
  reconBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textSecondary },
});
