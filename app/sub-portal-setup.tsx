import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput, Platform, Share,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Copy, Send, Link, Check, X, RefreshCw, Lock,
  HardHat, Building2, FileText, Inbox, Mail,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import type { SubPortalLink } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { useSubSubmittedInvoices } from '@/hooks/useSubSubmittedInvoices';
import { copyToClipboard } from '@/utils/clipboard';
import { SendPortalLinkModal } from '@/components/SendPortalLinkModal';
import {
  buildSubPortalSnapshot, buildSubPortalUrl,
} from '@/utils/subPortalSnapshot';
import { formatMoney } from '@/utils/formatters';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
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

function SubPortalSetupScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { projectId, subId } = useLocalSearchParams<{ projectId: string; subId: string }>();

  const {
    getProject, subcontractors, settings,
    getCommitmentsForProject, getPunchItemsForProject,
    getSubPortalLinkFor, upsertSubPortalLink,
    commitments: allCommitments,
  } = useProjects();

  const project = useMemo(() => projectId ? getProject(projectId) : undefined, [projectId, getProject]);
  const sub = useMemo(() => subcontractors.find(s => s.id === subId), [subcontractors, subId]);
  const commitments = useMemo(() => projectId ? getCommitmentsForProject(projectId).filter(c => c.subcontractorId === subId) : [], [projectId, subId, getCommitmentsForProject]);
  const projectPunchItems = useMemo(() => projectId ? getPunchItemsForProject(projectId) : [], [projectId, getPunchItemsForProject]);

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
      schedule: project.schedule,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      contactEmail: settings?.branding?.email,
      contactName: settings?.branding?.contactName ?? settings?.branding?.companyName,
    });
  }, [link, project, sub, settings, commitments, submitted.invoices, projectPunchItems]);

  const portalUrl = useMemo(() => {
    if (!snapshot) return `${SUB_PORTAL_BASE_URL}/${link.id}`;
    return buildSubPortalUrl(SUB_PORTAL_BASE_URL, link.id, snapshot, link.accessToken);
  }, [snapshot, link.id, link.accessToken]);

  // Server-side persistence so the sub portal URL works even when the
  // URL hash is missing or corrupt. Same model as the homeowner portal:
  // push the snapshot to sub_portal_snapshots; the static page falls
  // back to fetching by sub_portal_id when hash decode fails.
  useEffect(() => {
    if (!snapshot || !project?.id || !link.id) return;
    if (!isSupabaseConfigured) return;
    const t = setTimeout(() => {
      void supabase
        .from('sub_portal_snapshots')
        .upsert({
          sub_portal_id: link.id,
          project_id: project.id,
          snapshot: snapshot as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'sub_portal_id' })
        .then(({ error }) => {
          if (error) console.warn('[sub-portal-snapshot] persist failed', error.message);
        });
    }, 1500);
    return () => clearTimeout(t);
  }, [snapshot, project?.id, link.id]);

  // Auto-heal: a link enabled before the access-token wiring landed carries no
  // `?t=` token in local state, so its share link would ship token-less and the
  // sub's submits would fall back to mailto. Mirror client-portal-setup's heal —
  // on mount, if the link is enabled but token-less, run it through
  // upsertSubPortalLink (which mints + preserves the token) and adopt the
  // resolved, token-bearing link. Ref-guarded so it fires once per screen.
  const tokenHealRef = React.useRef(false);
  useEffect(() => {
    if (tokenHealRef.current) return;
    if (!link.enabled || link.accessToken) return;
    tokenHealRef.current = true;
    const resolved = upsertSubPortalLink(link);
    setLink(resolved);
  }, [link, upsertSubPortalLink]);

  const persist = useCallback((updates: Partial<SubPortalLink>) => {
    const next = { ...link, ...updates, updatedAt: new Date().toISOString() };
    // upsertSubPortalLink mints + returns the `?t=` access token the first
    // time the link is enabled without one. Adopt the RESOLVED link (not our
    // pre-token `next`) as local state, mirroring client-portal-setup — so the
    // token-bearing link is what buildSubPortalUrl reads on the next render.
    // Otherwise the share link would ship token-less and every submit would
    // fall back to mailto.
    const resolved = upsertSubPortalLink(next);
    setLink(resolved);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [link, upsertSubPortalLink]);

  // Send modal state — replaces the native-only Share.share() path so
  // web users can actually dispatch the link instead of seeing nothing.
  const [showSendModal, setShowSendModal] = useState(false);

  const shareMessage = useMemo(
    () => `Hi ${sub?.contactName || sub?.companyName || ''}, here's your sub portal for ${project?.name ?? 'the project'}:\n\n${portalUrl}\n\nYou can review your scope and submit invoices from this page — no login needed.`,
    [sub?.contactName, sub?.companyName, project?.name, portalUrl],
  );

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(portalUrl);
    if (Platform.OS !== 'web' && ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      ok ? 'Copied' : 'Copy failed',
      ok ? 'The sub portal link has been copied.' : 'Could not copy the link.',
    );
  }, [portalUrl]);

  const handleShare = useCallback(() => {
    setShowSendModal(true);
    persist({ lastSharedAt: new Date().toISOString() });
  }, [persist]);

  // Email-the-link path. Routes through the send-email edge function
  // (Resend) so the invite arrives from noreply@mageid.app with the
  // GC's company name in the FROM line — instead of forcing the GC to
  // copy/paste the URL into Mail. Uses the shared wrapEmailHtml shell
  // so the invite matches the rest of MAGE ID's transactional mail.
  const [emailing, setEmailing] = useState(false);
  const handleEmailInvite = useCallback(async () => {
    if (!sub || !project) return;
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
             You can review your scope, see open punch items and schedule, and submit invoices for review — no app to install, no account to create. Just bookmark the link below; it stays up to date.
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
  }, [sub, project, settings, portalUrl, link, persist]);

  // Sub overpayment guard. Before approving or marking-paid a sub-submitted
  // invoice, check whether this invoice + everything previously approved/paid
  // against the same commitment would push the sub over the contract value.
  // Surfaces a confirm dialog the GC can override (an actual change-order may
  // explain the overage), but stops silent overpayment by default.
  const checkOverpayment = useCallback(
    (invoiceId: string): { overage: number; commitmentTotal: number; alreadyApproved: number; thisAmount: number; subName: string } | null => {
      const invoice = submitted.invoices.find(i => i.id === invoiceId);
      if (!invoice || !invoice.commitmentId) return null;
      const commitment = allCommitments.find(c => c.id === invoice.commitmentId);
      if (!commitment) return null;
      const commitmentTotal = (commitment.amount ?? 0) + (commitment.changeAmount ?? 0);
      // Prefer commitment.paidToDate (maintained server-side by the
      // recompute_commitment_paid_to_date trigger) when present; fall
      // back to a client-side sum when offline or the column is missing.
      const alreadyApproved = (commitment.paidToDate ?? null) != null
        ? (commitment.paidToDate as number)
        : submitted.invoices
            .filter(i => i.id !== invoiceId
              && i.commitmentId === invoice.commitmentId
              && (i.status === 'approved' || i.status === 'paid'))
            .reduce((sum, i) => sum + (i.amount ?? 0), 0);
      const thisAmount = invoice.amount ?? 0;
      const total = alreadyApproved + thisAmount;
      const overage = total - commitmentTotal;
      if (overage <= 0) return null;
      return {
        overage,
        commitmentTotal,
        alreadyApproved,
        thisAmount,
        subName: sub?.companyName ?? 'this sub',
      };
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
    const doPay = () => {
      submitted.markPaid(id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    if (guard) {
      showAlert(
        'Overpayment risk',
        `Paying this invoice would push ${guard.subName} ${formatMoney(guard.overage)} over their commitment of ${formatMoney(guard.commitmentTotal)}. Update the commitment with a change order first, or pay anyway.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Pay anyway', style: 'destructive', onPress: doPay },
        ],
      );
      return;
    }
    doPay();
  }, [submitted, checkOverpayment]);

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
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
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
                  : Colors.warning;
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
  shareBtnPrimary: { backgroundColor: t.accent, borderColor: t.accent },
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
    backgroundColor: t.accent,
  },
  invCtaReject: {
    paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 11, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  invCtaText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  invoiceNotes: { marginTop: 10, fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic', lineHeight: 17 },
});
