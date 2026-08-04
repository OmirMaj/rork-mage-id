import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Dimensions, TextInput, Platform, Modal, FlatList,
} from 'react-native';
import MageRefreshControl from '@/components/MageRefreshControl';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured, SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import {
  Globe, CalendarDays, DollarSign, FileText, Image as ImageIcon,
  ClipboardList, CheckCircle2, MessageSquare, ChevronDown, ChevronUp,
  BarChart3, Flag, GitBranch, Lock,
  FileSignature, X, Check, ThumbsDown, ShieldCheck, Send,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { usePortalThread } from '@/hooks/usePortalThread';
import { formatMoney } from '@/utils/formatters';
import type { ScheduleTask, ChangeOrder, COApprover, COAuditEntry } from '@/types';
import { getStatusColor, getStatusLabel, getPhaseColor } from '@/utils/scheduleEngine';
import { documentTypeInfo } from '@/mocks/documents';
import { fetchActiveContract } from '@/utils/contractEngine';
import { fetchCloseoutBinder } from '@/utils/closeoutBinderEngine';
import type { ProjectDocument } from '@/types';
import SignaturePad from '@/components/SignaturePad';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import * as Linking from 'expo-linking';
import { isFinancingAvailable } from '@/utils/financing';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { buildOwnerConfidence } from '@/utils/ownerConfidence';
import {
  buildOwnerDecisions, summarizeOwnerDecisions, buildCOConsentRecord, buildCOAuditDetail,
  ESIGN_DISCLOSURE_TEXT, ESIGN_DISCLOSURE_VERSION,
} from '@/utils/portalOwnerCore';
import OwnerConfidenceCard from '@/components/OwnerConfidenceCard';
import { InfoBubble } from '@/components/InfoBubble';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { showAlert } from '@/utils/alert';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type SectionKey = 'messages' | 'schedule' | 'budget' | 'invoices' | 'changeOrders' | 'photos' | 'dailyReports' | 'punchList' | 'rfis' | 'documents';

function SectionHeader({ title, icon, count, expanded, onToggle, infoTerm }: {
  title: string; icon: React.ReactNode; count?: number; expanded: boolean; onToggle: () => void; infoTerm?: string;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
      {infoTerm ? <InfoBubble term={infoTerm} size={15} /> : null}
      {count !== undefined && (
        <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
      )}
      {expanded ? <ChevronUp size={16} color={themeColors.textMuted} strokeWidth={1.75} /> : <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />}
    </TouchableOpacity>
  );
}

function TaskRow({ task }: { task: ScheduleTask }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const statusColor = getStatusColor(task.status);
  const phaseColor = getPhaseColor(task.phase);
  return (
    <View style={styles.taskRow}>
      <View style={[styles.taskPhaseBar, { backgroundColor: phaseColor }]} />
      <View style={styles.taskContent}>
        <View style={styles.taskTitleRow}>
          {task.isMilestone && <Flag size={11} color={Colors.warning} strokeWidth={1.75} />}
          {task.isCriticalPath && <GitBranch size={11} color={themeColors.danger} strokeWidth={1.75} />}
          <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
        </View>
        <Text style={styles.taskMeta}>{task.phase} · {task.durationDays}d</Text>
        <View style={styles.taskProgressRow}>
          <View style={styles.taskProgressBar}>
            <View style={[styles.taskProgressFill, { width: `${task.progress}%` as any, backgroundColor: statusColor }]} />
          </View>
          <Text style={[styles.taskProgressPct, { color: statusColor }]}>{task.progress}%</Text>
        </View>
      </View>
      <View style={[styles.taskStatusBadge, { backgroundColor: statusColor + '20' }]}>
        <Text style={[styles.taskStatusText, { color: statusColor }]}>{getStatusLabel(task.status)}</Text>
      </View>
    </View>
  );
}

export default function ClientViewScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { portalId, inviteId, clientName: clientNameParam } = useLocalSearchParams<{ portalId: string; inviteId?: string; clientName?: string }>();
  const {
    projects, getChangeOrdersForProject, getInvoicesForProject, getDailyReportsForProject,
    getPunchItemsForProject, getPhotosForProject, getRFIsForProject, getWarrantiesForProject,
    updateProject, updateChangeOrder,
    settings,
  } = useProjects();

  // Find project by portalId
  const project = useMemo(() =>
    projects.find(p => p.clientPortal?.portalId === portalId && p.clientPortal?.enabled),
    [projects, portalId]
  );

  const portal = project?.clientPortal;

  // GC↔client thread lives in Supabase (portal_messages, keyed by
  // portal_id). Pre-fix this screen wrote/read a LOCAL store while the
  // GC's client-messages screen read Supabase — client replies were
  // silently lost. Same hook + table as the GC side now.
  const thread = usePortalThread({ projectId: project?.id, portalId: portal?.portalId });

  const changeOrders = useMemo(() => project ? getChangeOrdersForProject(project.id) : [], [project, getChangeOrdersForProject]);
  const invoices = useMemo(() => project ? getInvoicesForProject(project.id) : [], [project, getInvoicesForProject]);
  const ownerConfidence = useMemo(
    () => (project ? buildOwnerConfidence({ project, changeOrders, invoices, nowMs: Date.now() }) : null),
    [project, changeOrders, invoices],
  );
  const dailyReports = useMemo(() => project ? getDailyReportsForProject(project.id) : [], [project, getDailyReportsForProject]);
  const punchItems = useMemo(() => project ? getPunchItemsForProject(project.id) : [], [project, getPunchItemsForProject]);
  const photos = useMemo(() => project ? getPhotosForProject(project.id) : [], [project, getPhotosForProject]);
  const rfis = useMemo(() => project ? getRFIsForProject(project.id) : [], [project, getRFIsForProject]);

  // Real documents shared with the homeowner. Sourced from the SAME places
  // the setup screen builds the portal snapshot from — the signed contract,
  // the closeout binder, and any warranty docs — instead of the old
  // hardcoded MOCK_DOCUMENTS (which were keyed to fictional 'p-1'/'p-2'
  // projects and could never match a real UUID). Only surface items that
  // are genuinely client-facing: a contract once it's been sent/signed, a
  // binder once it's finalized/sent, warranties on the project.
  // Fetched unconditionally (not gated on showDocuments) because the
  // "Waiting on you" card below needs to know whether a sent contract is
  // still unsigned — that's the single biggest thing an owner holds up.
  // The documents list still gates its own row on showDocuments.
  const contractQ = useQuery({
    queryKey: ['portal-contract', project?.id],
    queryFn: () => project ? fetchActiveContract(project.id) : Promise.resolve(null),
    enabled: !!project?.id,
  });
  const closeoutQ = useQuery({
    queryKey: ['portal-closeout', project?.id],
    queryFn: () => project ? fetchCloseoutBinder(project.id) : Promise.resolve(null),
    enabled: !!project?.id && portal?.showDocuments === true,
  });
  const warranties = useMemo(
    () => project ? getWarrantiesForProject(project.id) : [],
    [project, getWarrantiesForProject],
  );

  // What's waiting on the OWNER — same pure builder the static portal uses,
  // so both surfaces rank the same way. Selections aren't loaded on this
  // screen (they live in the portal snapshot), so selection deadlines only
  // surface in the browser portal today.
  const ownerDecisions = useMemo(() => {
    if (!project) return [];
    const contract = contractQ.data;
    return buildOwnerDecisions({
      today: new Date().toISOString().slice(0, 10),
      contract: contract && contract.status === 'sent'
        ? {
            status: 'sent',
            needsSignature: !contract.homeownerSignature,
            sentAt: contract.sentAt ?? contract.updatedAt,
            title: contract.title,
          }
        : null,
      changeOrders: changeOrders.map(c => ({
        id: c.id, number: c.number, description: c.description,
        status: c.status, changeAmount: c.changeAmount, dateSubmitted: c.date,
      })),
      coApprovalEnabled: !!portal?.coApprovalEnabled,
      invoices: invoices.map(i => ({
        id: i.id, number: i.number, status: i.status,
        balance: Math.max(0, (i.totalDue ?? 0) - (i.amountPaid ?? 0)),
        dueDate: i.dueDate,
      })),
    });
  }, [project, contractQ.data, changeOrders, invoices, portal?.coApprovalEnabled]);

  const documents = useMemo<ProjectDocument[]>(() => {
    if (!project) return [];
    const out: ProjectDocument[] = [];

    const contract = contractQ.data;
    // The contract is only a client-facing document once the GC has sent it
    // (draft contracts are internal). contractEngine gates portal viewers on
    // status >= sent as well.
    if (contract && (contract.status === 'sent' || contract.status === 'signed')) {
      out.push({
        id: contract.id,
        projectId: project.id,
        projectName: project.name,
        type: contract.kind === 'proposal' ? 'proposal' : 'contract',
        title: contract.title,
        status: contract.status === 'signed' ? 'signed' : 'pending_signature',
        createdAt: contract.createdAt,
        signedAt: contract.signedAt,
        signedBy: contract.homeownerSignature?.name,
        fileUrl: contract.signedPdfUrl,
      });
    }

    const binder = closeoutQ.data;
    // Closeout binder becomes visible to the homeowner once finalized/sent.
    if (binder && (binder.status === 'finalized' || binder.status === 'sent')) {
      out.push({
        id: binder.id,
        projectId: project.id,
        projectName: project.name,
        type: 'other',
        title: `${project.name} — Closeout Binder`,
        status: 'signed',
        createdAt: binder.createdAt,
        signedAt: binder.finalizedAt ?? binder.sentAt,
        fileUrl: binder.pdfUrl,
      });
    }

    for (const w of warranties) {
      // Only warranty docs the GC has actually SENT to the portal. Drafts /
      // recalled items must never leak to the client — matches the app's
      // "edits-after-send never leak" portal contract.
      if (w.portalState?.status !== 'sent') continue;
      out.push({
        id: w.id,
        projectId: project.id,
        projectName: project.name,
        type: 'other',
        title: w.title,
        status: 'signed',
        createdAt: w.createdAt,
        expiresAt: w.endDate,
        signedBy: w.provider,
        fileUrl: w.documentUri,
      });
    }

    return out;
  }, [project, contractQ.data, closeoutQ.data, warranties]);

  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    messages: true, schedule: true, budget: true, invoices: true, changeOrders: false,
    photos: true, dailyReports: false, punchList: false, rfis: false, documents: false,
  });

  // Realtime: when the GC updates anything on this project, invalidate local
  // react-query caches so the client portal re-renders with fresh data.
  // We scope the subscription to the single project row to avoid noisy
  // re-fetches when unrelated records change.
  const queryClient = useQueryClient();
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['changeOrders'] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['dailyReports'] }),
        queryClient.invalidateQueries({ queryKey: ['punchItems'] }),
        queryClient.invalidateQueries({ queryKey: ['photos'] }),
        queryClient.invalidateQueries({ queryKey: ['rfis'] }),
      ]);
      setLastUpdatedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!isSupabaseConfigured || !project?.id) return;
    const projectId = project.id;
    const channel = supabase
      .channel(`client-portal-${projectId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['projects'] });
          setLastUpdatedAt(new Date());
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'change_orders', filter: `project_id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['changeOrders'] });
          setLastUpdatedAt(new Date());
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'invoices', filter: `project_id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['invoices'] });
          setLastUpdatedAt(new Date());
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'daily_reports', filter: `project_id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['dailyReports'] });
          setLastUpdatedAt(new Date());
        },
      )
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'photos', filter: `project_id=eq.${projectId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['photos'] });
          setLastUpdatedAt(new Date());
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [project?.id, queryClient]);

  const [passcodeEntry, setPasscodeEntry] = useState('');
  const [passcodeUnlocked, setPasscodeUnlocked] = useState(false);
  const [passcodeError, setPasscodeError] = useState(false);
  // Distinguish "wrong passcode" from "edge function unreachable" so the user
  // sees a useful message and a double-tap of Unlock doesn't fire two requests.
  const [passcodeErrorKind, setPasscodeErrorKind] = useState<'invalid' | 'network' | null>(null);
  const [verifying, setVerifying] = useState(false);

  // CO approval modal state
  const [approvalCO, setApprovalCO] = useState<ChangeOrder | null>(null);
  const [approvalMode, setApprovalMode] = useState<'approve' | 'reject'>('approve');
  const [approverName, setApproverName] = useState<string>(typeof clientNameParam === 'string' ? clientNameParam : '');
  const [rejectionReason, setRejectionReason] = useState('');
  const [signaturePaths, setSignaturePaths] = useState<string[]>([]);
  // Approving a change order is signing a contract amendment, so the signer
  // affirmatively consents to sign electronically rather than just tapping a
  // button. Same bar the static portal clears (marketing/portal/index.html).
  const [esignConsent, setEsignConsent] = useState(false);
  const [submittingApproval, setSubmittingApproval] = useState(false);

  // Lightbox state for Site Photos
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const screenW = Dimensions.get('window').width;

  // Mark invite viewed when client opens portal (after passcode if required)
  const canRecordAccess = !!project && !!portal && (!portal.requirePasscode || passcodeUnlocked);
  useEffect(() => {
    if (!canRecordAccess || !project || !portal) return;
    const invites = portal.invites ?? [];
    if (invites.length === 0) return;

    const now = new Date().toISOString();
    let changed = false;
    const nextInvites = invites.map(inv => {
      // If a specific inviteId was passed on the link, only update that one
      if (inviteId) {
        if (inv.id === inviteId && inv.status !== 'viewed') {
          changed = true;
          return { ...inv, status: 'viewed' as const, accessedAt: now };
        }
        return inv;
      }
      // Otherwise, mark all pending invites as viewed (no client identity signal)
      if (inv.status === 'pending' && !inv.accessedAt) {
        changed = true;
        return { ...inv, status: 'viewed' as const, accessedAt: now };
      }
      return inv;
    });

    if (changed) {
      updateProject(project.id, { clientPortal: { ...portal, invites: nextInvites } });
    }
    // Only run when unlock state or portalId changes — not on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRecordAccess, project?.id, inviteId]);

  const toggleSection = (key: SectionKey) => setExpanded(p => ({ ...p, [key]: !p[key] }));

  // Portal messages (Q&A thread) — Supabase, the SAME source the GC's
  // client-messages screen reads. usePortalThread polls + realtime-subs
  // on portal_id, so the client sees GC replies and their own sent
  // message after it round-trips.
  const messages = thread.messages;
  const [composeBody, setComposeBody] = useState('');
  const sendingMsg = thread.isSendingClient;

  const handleSendMessage = useCallback(() => {
    if (!project || !portal?.portalId) return;
    const body = composeBody.trim();
    if (!body) return;
    const authorName =
      (typeof clientNameParam === 'string' && clientNameParam.trim()) ||
      portal.invites?.find(i => i.id === inviteId)?.name ||
      'Client';
    thread.sendClientMessage({
      portalId: portal.portalId,
      projectId: project.id,
      authorName,
      inviteId: typeof inviteId === 'string' ? inviteId : undefined,
      body,
    });
    setComposeBody('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, portal, composeBody, inviteId, clientNameParam, thread]);

  const openApprovalFlow = useCallback((co: ChangeOrder, mode: 'approve' | 'reject') => {
    setApprovalCO(co);
    setApprovalMode(mode);
    setSignaturePaths([]);
    setRejectionReason('');
    setEsignConsent(false);
    if (!approverName && clientNameParam) setApproverName(String(clientNameParam));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [approverName, clientNameParam]);

  const closeApprovalFlow = useCallback(() => {
    setApprovalCO(null);
    setSignaturePaths([]);
    setRejectionReason('');
    setEsignConsent(false);
    setSubmittingApproval(false);
  }, []);

  const submitApproval = useCallback(async () => {
    if (!approvalCO || !project) return;
    if (!approverName.trim()) {
      showAlert('Name Required', 'Please enter your name as it appears on the contract.');
      return;
    }
    if (approvalMode === 'approve' && signaturePaths.length === 0) {
      showAlert('Signature Required', 'Please sign above to approve this change order.');
      return;
    }
    if (approvalMode === 'approve' && !esignConsent) {
      showAlert(
        'Consent Required',
        'Approving a change order is an electronic signature. Please read the disclosure and check "I agree" to continue.',
      );
      return;
    }
    if (approvalMode === 'reject' && !rejectionReason.trim()) {
      showAlert('Reason Required', 'Please briefly explain why you are rejecting this change order.');
      return;
    }

    setSubmittingApproval(true);

    const now = new Date().toISOString();
    const existingApprovers: COApprover[] = approvalCO.approvers ?? [];
    const existingAudit: COAuditEntry[] = approvalCO.auditTrail ?? [];

    // Find or create a "Client" approver slot
    let approverUpdated = false;
    const nextApprovers: COApprover[] = existingApprovers.map(a => {
      if (!approverUpdated && a.role === 'Client' && a.status === 'pending') {
        approverUpdated = true;
        return {
          ...a,
          name: approverName.trim(),
          status: approvalMode === 'approve' ? 'approved' : 'rejected',
          responseDate: now,
          rejectionReason: approvalMode === 'reject' ? rejectionReason.trim() : undefined,
        };
      }
      return a;
    });
    if (!approverUpdated) {
      nextApprovers.push({
        id: generateUUID(),
        name: approverName.trim(),
        email: '',
        role: 'Client',
        required: true,
        order: nextApprovers.length,
        status: approvalMode === 'approve' ? 'approved' : 'rejected',
        responseDate: now,
        rejectionReason: approvalMode === 'reject' ? rejectionReason.trim() : undefined,
      });
    }

    // ── Build the retainable consent record. Byte-identical to
    //    the one the static portal builds (utils/portalOwnerCore.ts is the
    //    single source for both), so a CO signed in-app and one signed in the
    //    browser produce the same artifact and the same hash.
    const signatureData = signaturePaths.join(' ');
    const signatureHash = signaturePaths.length > 0
      ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, signatureData, { encoding: Crypto.CryptoEncoding.HEX })
        .catch(() => undefined)
      : undefined;
    const consentRecord = buildCOConsentRecord({
      changeOrderId: approvalCO.id,
      changeOrderNumber: approvalCO.number,
      description: approvalCO.description ?? '',
      changeAmount: approvalCO.changeAmount ?? 0,
      newContractTotal: approvalCO.newContractTotal,
      decision: approvalMode === 'approve' ? 'approved' : 'declined',
      signerName: approverName.trim(),
      signatureHash: approvalMode === 'approve' ? signatureHash : undefined,
      signatureStrokeCount: approvalMode === 'approve' ? signaturePaths.length : undefined,
      reason: approvalMode === 'reject' ? rejectionReason.trim() : undefined,
      portalId: portal?.portalId ?? '',
      signedAt: now,
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    const documentHash = await Crypto
      .digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, consentRecord, { encoding: Crypto.CryptoEncoding.HEX })
      .catch(() => undefined);

    const auditEntry: COAuditEntry = {
      id: generateUUID(),
      action: approvalMode === 'approve' ? 'client_signed_via_portal' : 'client_declined_via_portal',
      actor: approverName.trim(),
      timestamp: now,
      detail: buildCOAuditDetail({
        decision: approvalMode === 'approve' ? 'approved' : 'declined',
        signatureStrokeCount: approvalMode === 'approve' ? signaturePaths.length : undefined,
        documentHash,
        reason: rejectionReason.trim(),
      }),
    };

    const nextStatus = approvalMode === 'approve' ? 'approved' : 'rejected';

    // Persist the approval to change_order_approvals so the GC actually
    // sees it. RLS allows anon INSERT when portal_id matches a real
    // project's client_portal->>'portalId'. If the insert fails (offline,
    // misconfigured, missing tables), we still update the local view —
    // the visitor at least gets immediate feedback — but flag it so they
    // know to follow up.
    let serverPersisted = false;
    if (isSupabaseConfigured && portal?.portalId) {
      try {
        const { error: insertError } = await supabase
          .from('change_order_approvals')
          .insert({
            portal_id: portal.portalId,
            project_id: project.id,
            invite_id: typeof inviteId === 'string' ? inviteId : null,
            change_order_id: approvalCO.id,
            decision: approvalMode === 'approve' ? 'approved' : 'declined',
            signer_name: approverName.trim(),
            signer_email: null,
            note: approvalMode === 'reject' ? rejectionReason.trim() : null,
            // Signature + sealed consent record. Columns added by
            // supabase/migrations/20260803120500_portal_co_esignature.sql.
            signature_data: approvalMode === 'approve' ? signatureData : null,
            signature_hash: approvalMode === 'approve' ? (signatureHash ?? null) : null,
            consent_record: consentRecord,
            document_hash: documentHash ?? null,
            consent_version: ESIGN_DISCLOSURE_VERSION,
            consent_accepted: approvalMode === 'approve' ? esignConsent : true,
            sealed_at: now,
          });
        if (insertError) throw insertError;
        serverPersisted = true;
      } catch (err) {
        console.log('[client-view] CO approval insert failed:', err);
      }
    }

    updateChangeOrder(approvalCO.id, {
      status: nextStatus,
      approvers: nextApprovers,
      auditTrail: [...existingAudit, auditEntry],
    });

    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    const verb = approvalMode === 'approve' ? 'approved' : 'rejected';
    // Don't assert a notification we don't actively send. The insert lands in
    // the contractor's dashboard (change_order_approvals), but there's no
    // push/email fan-out on this path — so tell the homeowner exactly what
    // happened rather than implying the GC was pinged.
    const tail = serverPersisted
      ? 'Your response has been recorded and will appear in your contractor\'s dashboard.'
      : 'We saved your response locally. If you don\'t hear back within a day, please contact the contractor directly.';
    showAlert(
      approvalMode === 'approve' ? 'Approved' : 'Rejected',
      `Change Order #${approvalCO.number} has been ${verb}. ${tail}`,
      [{ text: 'OK', onPress: closeApprovalFlow }]
    );
  }, [approvalCO, project, portal, inviteId, approverName, signaturePaths, approvalMode, rejectionReason, esignConsent, updateChangeOrder, closeApprovalFlow]);

  const financingEnabledForPortal = isFinancingAvailable(settings);

  // Budget metrics
  const contractValue = effectiveEstimateTotal(project);
  const invoicedTotal = invoices.reduce((s, i) => s + i.totalDue, 0);
  const paidTotal = invoices.reduce((s, i) => s + i.amountPaid, 0);
  const approvedCOs = changeOrders.filter(c => c.status === 'approved');
  const coTotal = approvedCOs.reduce((s, c) => s + c.changeAmount, 0);
  const revisedContract = contractValue + coTotal;
  // Financial-truth metrics tied to the estimate spine: what's paid, what's
  // billed-but-unpaid, what's still to come, and the homeowner's remaining
  // balance against the projected final (revised contract).
  const outstanding = Math.max(0, invoicedTotal - paidTotal);
  const notYetBilled = Math.max(0, revisedContract - invoicedTotal);
  const balanceRemaining = Math.max(0, revisedContract - paidTotal);
  const pctOf = (n: number) => (revisedContract > 0 ? Math.round((n / revisedContract) * 100) : 0);

  // Schedule metrics
  const tasks = project?.schedule?.tasks ?? [];
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const scheduleProgress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const healthScore = project?.schedule?.healthScore ?? 0;

  if (!project || !portal) {
    return (
      <View style={styles.notFoundContainer}>
        <Stack.Screen options={{ title: 'Client Portal', headerShown: false }} />
        <Globe size={48} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.notFoundTitle}>Portal Not Found</Text>
        <Text style={styles.notFoundSubtitle}>This portal link may be expired or invalid.</Text>
      </View>
    );
  }

  const passcodeRequired = !!portal.requirePasscode && !!portal.passcode;

  if (passcodeRequired && !passcodeUnlocked) {
    const verify = async () => {
      // Drop double-taps. Pre-fix the button had no in-flight state, so an
      // impatient client could fire two requests and double the rate-limit
      // ding on the edge function for a single valid attempt.
      if (verifying) return;
      const trimmed = passcodeEntry.trim();
      if (!trimmed) return;
      setVerifying(true);
      // Server-side validation. Pre-fix this was a JS string compare against
      // `portal.passcode` which was loaded into the snapshot — anyone with
      // the link could read the passcode out of the JS heap or URL hash and
      // bypass the gate entirely. The edge function uses the service role
      // to look up the canonical passcode, constant-time compares, and
      // adds a 250ms delay on failures to slow brute force.
      try {
        const { data, error } = await supabase.functions.invoke('validate-portal-passcode', {
          body: { portalId, passcode: trimmed },
        });
        if (error) {
          // The edge-functions client throws this for both 4xx (bad passcode)
          // and 5xx / unreachable (network). Try to disambiguate by status —
          // FunctionsHttpError exposes `context.status` on recent versions.
          // If we can't tell, default to 'invalid' (better UX than scaring
          // someone with a network message when they probably mistyped).
          const status = (error as { context?: { status?: number } })?.context?.status;
          const kind: 'invalid' | 'network' = status === 401 || status === 403 ? 'invalid' : 'network';
          setPasscodeError(true);
          setPasscodeErrorKind(kind);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }
        if (!data?.ok) {
          setPasscodeError(true);
          setPasscodeErrorKind('invalid');
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }
        setPasscodeUnlocked(true);
        setPasscodeError(false);
        setPasscodeErrorKind(null);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        // Thrown — TypeError from fetch usually means offline / DNS / no edge
        // function deployed. Treat as network so the message tells the truth.
        // We deliberately don't fall back to a client-side compare here:
        // that's the bug we're fixing.
        console.warn('[client-view] passcode verify failed:', err);
        setPasscodeError(true);
        setPasscodeErrorKind('network');
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } finally {
        setVerifying(false);
      }
    };
    return (
      <View style={styles.passcodeContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.passcodeCard}>
          <View style={styles.passcodeIconWrap}>
            <Lock size={32} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.passcodeTitle}>Protected Portal</Text>
          <Text style={styles.passcodeSub}>{project.name}</Text>
          <Text style={styles.passcodeDesc}>
            Enter the passcode shared with you to access this project portal.
          </Text>
          <TextInput
            style={[styles.passcodeInput, passcodeError && { borderColor: themeColors.danger }]}
            value={passcodeEntry}
            onChangeText={(v) => {
              setPasscodeEntry(v);
              if (passcodeError) {
                setPasscodeError(false);
                setPasscodeErrorKind(null);
              }
            }}
            placeholder="Enter passcode"
            placeholderTextColor={themeColors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={verify}
            returnKeyType="done"
            editable={!verifying}
          />
          {passcodeError ? (
            <Text style={styles.passcodeErrorText}>
              {passcodeErrorKind === 'network'
                ? "Couldn't reach the server. Check your connection and try again."
                : 'Incorrect passcode. Please try again.'}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[styles.passcodeBtn, verifying && { opacity: 0.6 }]}
            onPress={verify}
            activeOpacity={0.85}
            disabled={verifying}
          >
            <Text style={styles.passcodeBtnText}>{verifying ? 'Verifying…' : 'Unlock Portal'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          { paddingBottom: insets.bottom + 32 },
          // On wide desktop windows, constrain the portal content column to a
          // comfortable centered max-width so it doesn't stretch edge-to-edge
          // and read poorly. Same pattern as project-detail / bid-detail.
          layout.isDesktop && { maxWidth: 1200, alignSelf: 'center' as const, width: '100%' as const },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MageRefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerBrand}>
            <Globe size={22} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.headerBrandText}>Client Portal</Text>
          </View>
          <Text style={styles.headerProjectName}>{project.name}</Text>
          <Text style={styles.headerLocation}>{project.location}</Text>
          <Text style={styles.headerLastUpdated} testID="client-last-updated">
            Last updated {lastUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: project.status === 'in_progress' ? '#34C75940' : '#FF950040' }]}>
            <Text style={[styles.statusBadgeText, { color: project.status === 'in_progress' ? themeColors.success : Colors.warning }]}>
              {project.status === 'in_progress' ? 'In Progress' : project.status === 'completed' ? 'Completed' : 'Active'}
            </Text>
          </View>
        </View>

        {/* Welcome message */}
        {!!portal.welcomeMessage && (
          <View style={styles.welcomeCard}>
            <MessageSquare size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.welcomeText}>{portal.welcomeMessage}</Text>
          </View>
        )}

        {/* Owner Confidence — the at-a-glance "on time & on budget" hero, in
            place of the old three-stat strip. Schedule + billing are shown
            richer here (with projected finish, milestones, and what needs the
            owner); punch items keep their own section below. */}
        {ownerConfidence && (
          <OwnerConfidenceCard confidence={ownerConfidence} showBudget={!!portal.showBudgetSummary} />
        )}

        {/* Waiting on you — the owner is usually the bottleneck and usually
            doesn't know it. Ranked overdue-first by the same pure builder the
            static portal uses (utils/portalOwnerCore.ts), so both surfaces
            agree on what's open and how urgent it is. */}
        {ownerDecisions.length > 0 && (
          <View style={styles.decisionsCard}>
            <View style={styles.decisionsHead}>
              <ClipboardList size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.decisionsTitle}>Waiting on you</Text>
              <Text style={styles.decisionsSub}>{summarizeOwnerDecisions(ownerDecisions)}</Text>
            </View>
            {ownerDecisions.map(d => {
              const tone = d.urgency === 'overdue' ? themeColors.danger
                : d.urgency === 'due_soon' ? Colors.warning
                : themeColors.textMuted;
              return (
                <View key={`${d.kind}-${d.id}`} style={styles.decisionRow}>
                  <View style={[styles.decisionDot, { backgroundColor: tone }]} />
                  <View style={styles.decisionBody}>
                    <Text style={styles.decisionTitle}>{d.title}</Text>
                    <Text style={styles.decisionDetail}>{d.detail}</Text>
                  </View>
                  <Text style={[styles.decisionFlag, { color: tone }]}>
                    {d.urgency === 'overdue'
                      ? `${d.daysOverdue ?? 0}d late`
                      : d.urgency === 'due_soon' ? 'Due soon' : 'Open'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Messages Section — always on, it's the main 2-way channel */}
        <View style={styles.section}>
          <SectionHeader
            title="Messages"
            icon={<MessageSquare size={18} color={themeColors.accent} strokeWidth={1.75} />}
            count={messages.length || undefined}
            expanded={expanded.messages}
            onToggle={() => toggleSection('messages')}
          />
          {expanded.messages && (
            <View style={styles.sectionBody}>
              {messages.length === 0 ? (
                <View style={styles.msgEmpty}>
                  <MessageSquare size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.msgEmptyTitle}>Ask us anything.</Text>
                  <Text style={styles.msgEmptyHint}>
                    Questions about the schedule, finishes, or anything on-site — this goes straight to your GC.
                  </Text>
                </View>
              ) : (
                <View style={styles.msgList}>
                  {messages.map(m => {
                    const mine = m.authorType === 'client';
                    return (
                      <View
                        key={m.id}
                        style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}
                      >
                        <View style={[styles.msgBubble, mine ? styles.msgBubbleMine : styles.msgBubbleTheirs]}>
                          <Text style={[styles.msgAuthor, mine && styles.msgAuthorMine]}>
                            {mine ? 'You' : m.authorName}
                          </Text>
                          <Text style={[styles.msgBody, mine && styles.msgBodyMine]}>{m.body}</Text>
                          <Text style={[styles.msgTime, mine && styles.msgTimeMine]}>
                            {new Date(m.createdAt).toLocaleString('en-US', {
                              month: 'short', day: 'numeric',
                              hour: 'numeric', minute: '2-digit',
                            })}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              <View style={styles.msgCompose}>
                <TextInput
                  style={styles.msgInput}
                  value={composeBody}
                  onChangeText={setComposeBody}
                  placeholder="Write a message…"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  textAlignVertical="top"
                  editable={!sendingMsg}
                />
                <TouchableOpacity
                  style={[styles.msgSendBtn, (!composeBody.trim() || sendingMsg) && styles.msgSendBtnDisabled]}
                  onPress={handleSendMessage}
                  disabled={!composeBody.trim() || sendingMsg}
                  activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Send"><Send size={16} color="#fff" strokeWidth={1.75} /></TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Schedule Section */}
        {portal.showSchedule && tasks.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Project Schedule"
              icon={<CalendarDays size={18} color={themeColors.info} strokeWidth={1.75} />}
              count={tasks.length}
              expanded={expanded.schedule}
              onToggle={() => toggleSection('schedule')}
            />
            {expanded.schedule && (
              <View style={styles.sectionBody}>
                {/* Health bar */}
                <View style={styles.healthRow}>
                  <Text style={styles.healthLabel}>Schedule Health</Text>
                  <View style={styles.healthBar}>
                    <View style={[styles.healthFill, {
                      width: `${healthScore}%` as any,
                      backgroundColor: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : themeColors.danger,
                    }]} />
                  </View>
                  <Text style={[styles.healthPct, {
                    color: healthScore >= 80 ? themeColors.success : healthScore >= 60 ? Colors.warning : themeColors.danger,
                  }]}>{healthScore}%</Text>
                </View>
                {/* Tasks by phase */}
                {tasks.map(task => <TaskRow key={task.id} task={task} />)}
              </View>
            )}
          </View>
        )}

        {/* Budget Summary */}
        {portal.showBudgetSummary && (
          <View style={styles.section}>
            <SectionHeader
              title="Budget Summary"
              icon={<BarChart3 size={18} color={themeColors.success} strokeWidth={1.75} />}
              expanded={expanded.budget}
              onToggle={() => toggleSection('budget')}
            />
            {expanded.budget && (
              <View style={styles.sectionBody}>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Original Contract</Text>
                  <Text style={styles.budgetValue}>{formatMoney(contractValue)}</Text>
                </View>
                {coTotal !== 0 && (
                  <View style={styles.budgetRow}>
                    <Text style={styles.budgetLabel}>Approved Change Orders</Text>
                    <Text style={[styles.budgetValue, { color: coTotal > 0 ? themeColors.danger : themeColors.success }]}>
                      {coTotal > 0 ? '+' : ''}{formatMoney(coTotal)}
                    </Text>
                  </View>
                )}
                <View style={[styles.budgetRow, styles.budgetRowTotal]}>
                  <Text style={styles.budgetLabelTotal}>Revised Contract</Text>
                  <Text style={styles.budgetValueTotal}>{formatMoney(revisedContract)}</Text>
                </View>
                <Text style={styles.budgetCaption}>Projected final cost — your contract plus any change orders you&apos;ve approved.</Text>

                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Total Invoiced</Text>
                  <Text style={styles.budgetValue}>{formatMoney(invoicedTotal)}</Text>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Total Paid</Text>
                  <Text style={[styles.budgetValue, { color: themeColors.success }]}>{formatMoney(paidTotal)}</Text>
                </View>
                {outstanding > 0 && (
                  <View style={styles.budgetRow}>
                    <Text style={styles.budgetLabel}>Invoiced, awaiting payment</Text>
                    <Text style={[styles.budgetValue, { color: themeColors.accent }]}>{formatMoney(outstanding)}</Text>
                  </View>
                )}
                <View style={[styles.budgetRow, styles.budgetRowTotal]}>
                  <Text style={styles.budgetLabelTotal}>Balance Remaining</Text>
                  <Text style={styles.budgetValueTotal}>{formatMoney(balanceRemaining)}</Text>
                </View>

                {/* Where your money stands — paid / due now / remaining, as one bar */}
                <View style={styles.moneyBarWrap}>
                  <View style={styles.moneyBar}>
                    {revisedContract > 0 ? (
                      <>
                        {paidTotal > 0 && <View style={[styles.moneyBarSeg, { backgroundColor: themeColors.success, flexGrow: paidTotal }]} />}
                        {outstanding > 0 && <View style={[styles.moneyBarSeg, { backgroundColor: themeColors.accent, flexGrow: outstanding }]} />}
                        {notYetBilled > 0 && <View style={[styles.moneyBarSeg, { backgroundColor: themeColors.line, flexGrow: notYetBilled }]} />}
                      </>
                    ) : null}
                  </View>
                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: themeColors.success }]} />
                      <Text style={styles.legendText}>Paid {pctOf(paidTotal)}%</Text>
                    </View>
                    {outstanding > 0 && (
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: themeColors.accent }]} />
                        <Text style={styles.legendText}>Due now {pctOf(outstanding)}%</Text>
                      </View>
                    )}
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: themeColors.line }]} />
                      <Text style={styles.legendText}>Remaining {pctOf(notYetBilled)}%</Text>
                    </View>
                  </View>
                </View>

                {/* What changed the price — every approved change order, itemized,
                    so the homeowner sees exactly why the number moved. */}
                {approvedCOs.length > 0 && (
                  <View style={styles.coBreakdown}>
                    <Text style={styles.coBreakdownTitle}>What changed the price</Text>
                    {approvedCOs.map(co => (
                      <View key={co.id} style={styles.coLine}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.coLineLabel} numberOfLines={1}>
                            CO #{co.number} · {co.description || co.reason || 'Change order'}
                          </Text>
                          {co.date ? <Text style={styles.coLineDate}>{co.date}</Text> : null}
                        </View>
                        <Text style={[styles.coLineAmount, { color: co.changeAmount >= 0 ? themeColors.danger : themeColors.success }]}>
                          {co.changeAmount >= 0 ? '+' : ''}{formatMoney(co.changeAmount)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {financingEnabledForPortal && project?.id && (
                  <View style={{ marginTop: 14 }}>
                    <TouchableOpacity
                      style={{ backgroundColor: '#1F6FEB', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' }}
                      activeOpacity={0.8}
                      onPress={() => {
                        void Linking.openURL(`${SUPABASE_FUNCTIONS_URL}/financing-redirect?project=${encodeURIComponent(project.id)}&src=portal`);
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Finance this project</Text>
                    </TouchableOpacity>
                    <Text style={[styles.budgetLabel, { marginTop: 6, textAlign: 'center' }]}>
                      Financing is provided by a third party, subject to credit approval. MAGE ID is not a lender.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Invoices */}
        {portal.showInvoices && invoices.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Invoices"
              infoTerm="pay_app"
              icon={<DollarSign size={18} color={Colors.warning} strokeWidth={1.75} />}
              count={invoices.length}
              expanded={expanded.invoices}
              onToggle={() => toggleSection('invoices')}
            />
            {expanded.invoices && (
              <View style={styles.sectionBody}>
                {invoices.map(inv => {
                  const statusColor = inv.status === 'paid' ? '#34C759' : inv.status === 'overdue' ? themeColors.danger : '#FF9500';
                  return (
                    <View key={inv.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle}>Invoice #{inv.number}</Text>
                        <Text style={styles.listRowMeta}>Due {new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                      </View>
                      <View style={styles.listRowRight}>
                        <Text style={styles.listRowAmount}>{formatMoney(inv.totalDue)}</Text>
                        <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                          <Text style={[styles.listStatusText, { color: statusColor }]}>
                            {inv.status === 'paid' ? 'Paid' : inv.status === 'overdue' ? 'Overdue' : inv.status === 'partially_paid' ? 'Partial' : 'Sent'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Change Orders */}
        {portal.showChangeOrders && changeOrders.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Change Orders"
              infoTerm="change_order"
              icon={<FileText size={18} color={themeColors.danger} strokeWidth={1.75} />}
              count={changeOrders.length}
              expanded={expanded.changeOrders}
              onToggle={() => toggleSection('changeOrders')}
            />
            {expanded.changeOrders && (
              <View style={styles.sectionBody}>
                {changeOrders.map(co => {
                  const statusColor = co.status === 'approved' ? '#34C759' : co.status === 'rejected' ? themeColors.danger : '#FF9500';
                  const awaitingClient = co.status === 'submitted' || co.status === 'under_review' || co.status === 'revised';
                  return (
                    <View key={co.id} style={styles.coCard}>
                      <View style={styles.listRow}>
                        <View style={styles.listRowLeft}>
                          <Text style={styles.listRowTitle}>CO #{co.number} — {co.description}</Text>
                          <Text style={styles.listRowMeta}>{new Date(co.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                        </View>
                        <View style={styles.listRowRight}>
                          <Text style={[styles.listRowAmount, { color: co.changeAmount > 0 ? themeColors.danger : themeColors.success }]}>
                            {co.changeAmount > 0 ? '+' : ''}{formatMoney(co.changeAmount)}
                          </Text>
                          <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                            <Text style={[styles.listStatusText, { color: statusColor }]}>
                              {co.status.charAt(0).toUpperCase() + co.status.slice(1).replace('_', ' ')}
                            </Text>
                          </View>
                        </View>
                      </View>
                      {awaitingClient && (
                        <View style={styles.coActions}>
                          <TouchableOpacity
                            style={[styles.coActionBtn, styles.coActionReject]}
                            onPress={() => openApprovalFlow(co, 'reject')}
                            activeOpacity={0.85}
                          >
                            <ThumbsDown size={14} color={themeColors.danger} strokeWidth={1.75} />
                            <Text style={[styles.coActionText, { color: themeColors.danger }]}>Reject</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.coActionBtn, styles.coActionApprove]}
                            onPress={() => openApprovalFlow(co, 'approve')}
                            activeOpacity={0.85}
                          >
                            <FileSignature size={14} color="#FFF" strokeWidth={1.75} />
                            <Text style={[styles.coActionText, { color: '#FFF' }]}>Sign & Approve</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {co.status === 'approved' && co.approvers?.some(a => a.role === 'Client' && a.status === 'approved') && (
                        <View style={styles.coSignedBanner}>
                          <ShieldCheck size={12} color={themeColors.success} strokeWidth={1.75} />
                          <Text style={styles.coSignedBannerText}>
                            Approved by {co.approvers.find(a => a.role === 'Client' && a.status === 'approved')?.name} on{' '}
                            {new Date(co.approvers.find(a => a.role === 'Client' && a.status === 'approved')?.responseDate ?? co.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Site Photos */}
        {portal.showPhotos && photos.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Site Photos"
              icon={<ImageIcon size={18} color={Colors.purple} strokeWidth={1.75} />}
              count={photos.length}
              expanded={expanded.photos}
              onToggle={() => toggleSection('photos')}
            />
            {expanded.photos && (
              <View style={styles.photoGrid}>
                {photos.map((photo, i) => (
                  <TouchableOpacity key={photo.id} style={styles.photoThumb} activeOpacity={0.8} onPress={() => setLightboxIndex(i)}>
                    <Image source={{ uri: photo.uri }} style={styles.photoImg} resizeMode="cover" />
                    {photo.tag && (
                      <View style={styles.photoTag}><Text style={styles.photoTagText}>{photo.tag}</Text></View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Daily Reports */}
        {portal.showDailyReports && dailyReports.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Daily Reports"
              icon={<ClipboardList size={18} color="#32ADE6" strokeWidth={1.75} />}
              count={dailyReports.length}
              expanded={expanded.dailyReports}
              onToggle={() => toggleSection('dailyReports')}
            />
            {expanded.dailyReports && (
              <View style={styles.sectionBody}>
                {dailyReports.slice(0, 5).map(report => (
                  <View key={report.id} style={styles.listRow}>
                    <View style={styles.listRowLeft}>
                      <Text style={styles.listRowTitle}>{new Date(report.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                      <Text style={styles.listRowMeta} numberOfLines={2}>{report.workPerformed || 'No summary provided'}</Text>
                    </View>
                    <View style={styles.listRowRight}>
                      <Text style={styles.listRowAmount}>{report.weather.conditions}</Text>
                      <Text style={styles.listStatusText}>{report.weather.temperature}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Punch List */}
        {portal.showPunchList && punchItems.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Punch List"
              infoTerm="punch_list"
              icon={<CheckCircle2 size={18} color={themeColors.success} strokeWidth={1.75} />}
              count={punchItems.filter(p => p.status !== 'closed').length}
              expanded={expanded.punchList}
              onToggle={() => toggleSection('punchList')}
            />
            {expanded.punchList && (
              <View style={styles.sectionBody}>
                {punchItems.map(item => {
                  const statusColor = item.status === 'closed' ? '#34C759' : item.status === 'in_progress' ? '#007AFF' : '#FF9500';
                  return (
                    <View key={item.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle} numberOfLines={1}>{item.description}</Text>
                        <Text style={styles.listRowMeta}>{item.location} · {item.assignedSub}</Text>
                      </View>
                      <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.listStatusText, { color: statusColor }]}>
                          {item.status === 'closed' ? 'Closed' : item.status === 'in_progress' ? 'In Progress' : 'Open'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* RFIs */}
        {portal.showRFIs && rfis.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="RFIs"
              infoTerm="rfi"
              icon={<MessageSquare size={18} color={Colors.warning} strokeWidth={1.75} />}
              count={rfis.filter(r => r.status === 'open').length}
              expanded={expanded.rfis}
              onToggle={() => toggleSection('rfis')}
            />
            {expanded.rfis && (
              <View style={styles.sectionBody}>
                {rfis.map(rfi => {
                  const statusColor = rfi.status === 'answered' ? '#34C759' : rfi.status === 'closed' ? themeColors.textMuted : '#FF9500';
                  return (
                    <View key={rfi.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle} numberOfLines={1}>RFI #{rfi.number} — {rfi.subject}</Text>
                        <Text style={styles.listRowMeta}>Due {new Date(rfi.dateRequired).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                      </View>
                      <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.listStatusText, { color: statusColor }]}>
                          {rfi.status.charAt(0).toUpperCase() + rfi.status.slice(1)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Documents */}
        {portal.showDocuments && (
          <View style={styles.section}>
            <SectionHeader
              title="Documents"
              icon={<FileText size={18} color="#8E8E93" strokeWidth={1.75} />}
              count={documents.length}
              expanded={expanded.documents}
              onToggle={() => toggleSection('documents')}
            />
            {expanded.documents && (
              <View style={styles.sectionBody}>
                {documents.length === 0 ? (
                  <View style={styles.emptyDocs}>
                    <FileText size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.emptyDocsText}>No documents shared yet.</Text>
                    <Text style={styles.emptyDocsHint}>Contracts, lien waivers, permits, and COIs will appear here.</Text>
                  </View>
                ) : (
                  documents.map(doc => {
                    const typeInfo = documentTypeInfo(themeColors)[doc.type] ?? { label: doc.type, color: themeColors.textMuted, bgColor: themeColors.surfaceAlt };
                    const statusColor = doc.status === 'signed' ? '#34C759' : doc.status === 'expired' ? themeColors.danger : doc.status === 'pending_signature' ? '#FF9500' : themeColors.textMuted;
                    const hasFile = !!doc.fileUrl;
                    const rowInner = (
                      <>
                        <View style={styles.listRowLeft}>
                          <Text
                            style={[styles.listRowTitle, !hasFile && { color: themeColors.textMuted }]}
                            numberOfLines={1}
                          >
                            {doc.title}
                          </Text>
                          <Text style={styles.listRowMeta}>
                            {typeInfo.label}
                            {doc.signedAt ? ` · Signed ${new Date(doc.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                            {doc.expiresAt ? ` · Exp ${new Date(doc.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                            {!hasFile ? ' · Not available yet' : ''}
                          </Text>
                        </View>
                        <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                          <Text style={[styles.listStatusText, { color: statusColor }]}>
                            {doc.status === 'pending_signature' ? 'Pending' : doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                          </Text>
                        </View>
                      </>
                    );
                    if (!hasFile) {
                      return (
                        <View
                          key={doc.id}
                          style={[styles.listRow, { opacity: 0.5 }]}
                          accessibilityRole="text"
                          accessibilityLabel={`${doc.title}, not available yet`}
                        >
                          {rowInner}
                        </View>
                      );
                    }
                    return (
                      <TouchableOpacity
                        key={doc.id}
                        style={styles.listRow}
                        activeOpacity={0.7}
                        onPress={() => { void Linking.openURL(doc.fileUrl!); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${doc.title}`}
                      >
                        {rowInner}
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Globe size={14} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text style={styles.footerText}>Powered by MAGE ID · Secure client portal</Text>
        </View>
      </ScrollView>

      {/* CO Digital Approval Modal */}
      <Modal
        visible={!!approvalCO}
        transparent
        animationType="slide"
        onRequestClose={closeApprovalFlow}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {approvalMode === 'approve' ? 'Sign & Approve' : 'Reject Change Order'}
              </Text>
              <TouchableOpacity onPress={closeApprovalFlow} style={styles.modalClose} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {approvalCO && (
                <View style={styles.modalSummary}>
                  <Text style={styles.modalSummaryLabel}>Change Order #{approvalCO.number}</Text>
                  <Text style={styles.modalSummaryTitle}>{approvalCO.description}</Text>
                  <View style={styles.modalSummaryRow}>
                    <Text style={styles.modalSummaryKey}>Change Amount</Text>
                    <Text style={[styles.modalSummaryVal, { color: approvalCO.changeAmount > 0 ? themeColors.danger : themeColors.success }]}>
                      {approvalCO.changeAmount > 0 ? '+' : ''}{formatMoney(approvalCO.changeAmount)}
                    </Text>
                  </View>
                  <View style={styles.modalSummaryRow}>
                    <Text style={styles.modalSummaryKey}>New Contract Total</Text>
                    <Text style={styles.modalSummaryVal}>{formatMoney(approvalCO.newContractTotal)}</Text>
                  </View>
                  {!!approvalCO.reason && (
                    <Text style={styles.modalSummaryReason}>{approvalCO.reason}</Text>
                  )}
                </View>
              )}

              <Text style={styles.modalFieldLabel}>Your Name</Text>
              <TextInput
                style={styles.modalInput}
                value={approverName}
                onChangeText={setApproverName}
                placeholder="Full legal name as on contract"
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="words"
              />

              {approvalMode === 'approve' ? (
                <>
                  <Text style={styles.modalFieldLabel}>Signature</Text>
                  <Text style={styles.modalFieldHint}>
                    By signing below, you authorize this change order and agree to the adjusted contract total.
                  </Text>
                  <View style={styles.signatureWrap}>
                    <SignaturePad
                      width={300}
                      height={150}
                      onSave={(paths) => setSignaturePaths(paths)}
                      onClear={() => setSignaturePaths([])}
                    />
                  </View>
                  {signaturePaths.length > 0 && (
                    <View style={styles.signatureConfirm}>
                      <Check size={14} color={themeColors.success} strokeWidth={1.75} />
                      <Text style={styles.signatureConfirmText}>Signature captured</Text>
                    </View>
                  )}

                  {/* Signing consent. A drawn mark on its own says nothing
                      about what the signer thought they were agreeing to, so
                      the disclosure is on screen and the consent is an explicit
                      tap. Same text the static portal shows. */}
                  <View style={styles.esignBox}>
                    <ScrollView style={styles.esignScroll} nestedScrollEnabled>
                      <Text style={styles.esignDisclosure}>{ESIGN_DISCLOSURE_TEXT}</Text>
                    </ScrollView>
                    <TouchableOpacity
                      style={styles.esignCheckRow}
                      onPress={() => setEsignConsent(v => !v)}
                      activeOpacity={0.8}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: esignConsent }}
                    >
                      <View style={[styles.esignCheckbox, esignConsent && styles.esignCheckboxOn]}>
                        {esignConsent && <Check size={13} color="#FFF" strokeWidth={3} />}
                      </View>
                      <Text style={styles.esignCheckLabel}>
                        I agree to sign this change order electronically, and I approve the scope and the
                        change to my contract total shown above.
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Reason for Rejection</Text>
                  <TextInput
                    style={[styles.modalInput, { minHeight: 100, textAlignVertical: 'top' }]}
                    value={rejectionReason}
                    onChangeText={setRejectionReason}
                    placeholder="Briefly explain what needs to change before you can approve…"
                    placeholderTextColor={themeColors.textMuted}
                    multiline
                  />
                </>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={closeApprovalFlow} activeOpacity={0.85}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSubmitBtn,
                  approvalMode === 'reject' && { backgroundColor: themeColors.danger },
                  submittingApproval && { opacity: 0.6 },
                ]}
                onPress={submitApproval}
                activeOpacity={0.85}
                disabled={submittingApproval}
              >
                {approvalMode === 'approve'
                  ? <FileSignature size={15} color="#FFF" strokeWidth={1.75} />
                  : <ThumbsDown size={15} color="#FFF" strokeWidth={1.75} />
                }
                <Text style={styles.modalSubmitText}>
                  {approvalMode === 'approve' ? 'Approve & Sign' : 'Submit Rejection'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Site Photos Lightbox */}
      <Modal
        visible={lightboxIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxIndex(null)}
      >
        <View style={styles.lbBackdrop}>
          <View style={styles.lbHeader}>
            <TouchableOpacity onPress={() => setLightboxIndex(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Close lightbox">
              <X size={22} color="#FFF" strokeWidth={1.75} />
            </TouchableOpacity>
            <Text style={styles.lbCaption} numberOfLines={1}>
              {lightboxIndex !== null ? [
                photos[lightboxIndex]?.tag,
                photos[lightboxIndex]?.location || photos[lightboxIndex]?.locationLabel,
                new Date(photos[lightboxIndex]?.timestamp || photos[lightboxIndex]?.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              ].filter(Boolean).join('  ·  ') : ''}
            </Text>
          </View>
          {lightboxIndex !== null && (
            <FlatList
              data={photos}
              keyExtractor={p => p.id}
              horizontal
              pagingEnabled
              initialScrollIndex={Math.max(0, Math.min(lightboxIndex, photos.length - 1))}
              getItemLayout={(_, index) => ({ length: screenW, offset: screenW * index, index })}
              onMomentumScrollEnd={e => setLightboxIndex(Math.round(e.nativeEvent.contentOffset.x / screenW))}
              renderItem={({ item }) => (
                <View style={{ width: screenW }}>
                  <Image source={{ uri: item.uri }} style={styles.lbImage} resizeMode="contain" />
                </View>
              )}
              showsHorizontalScrollIndicator={false}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 8) / 3;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  notFoundContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  notFoundTitle: { fontSize: Type.title3.fontSize, fontWeight: '700', color: t.text },
  notFoundSubtitle: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, textAlign: 'center' },

  passcodeContainer: { flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  passcodeCard: { backgroundColor: t.surface, borderRadius: 20, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center', borderWidth: 1, borderColor: t.line, gap: 10 },
  passcodeIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: t.accent + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  passcodeTitle: { fontSize: Type.title3.fontSize, fontWeight: '700', color: t.text },
  passcodeSub: { fontSize: Type.bodyCompact.fontSize, color: t.accent, fontWeight: '600' },
  passcodeDesc: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  passcodeInput: { width: '100%', minHeight: 50, borderRadius: Tokens.radius.card, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, fontSize: Type.callout.fontSize, color: t.text, marginTop: 12, textAlign: 'center', letterSpacing: 2 },
  passcodeErrorText: { fontSize: Type.caption1.fontSize, color: t.danger, marginTop: 4 },
  passcodeBtn: { width: '100%', minHeight: 50, borderRadius: Tokens.radius.card, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  passcodeBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: '#FFF' },

  header: {
    backgroundColor: t.accent,
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'flex-start',
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, opacity: 0.8 },
  headerBrandText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: '#FFF', letterSpacing: 1 },
  headerProjectName: { fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  headerLocation: { fontSize: Type.footnote.fontSize, color: '#FFFFFF99', marginBottom: 4 },
  headerLastUpdated: { fontSize: Type.caption2.fontSize, color: '#FFFFFF80', marginBottom: 12, fontStyle: 'italic' as const },
  statusBadge: { borderRadius: Tokens.radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: Type.caption1.fontSize, fontWeight: '700' },

  welcomeCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    margin: 16, backgroundColor: t.accent + '10',
    borderRadius: Tokens.radius.card, padding: 14,
    borderLeftWidth: 3, borderLeftColor: t.accent,
  },
  welcomeText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 20 },

  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  statCard: {
    flex: 1, backgroundColor: Colors.card,
    borderRadius: Tokens.radius.card, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: t.line,
  },
  statLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600', marginBottom: 4 },
  statValue: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  statSub: { fontSize: 10, color: t.textMuted, marginTop: 2 },

  section: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  sectionTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text, flex: 1 },
  badge: { backgroundColor: t.accent + '20', borderRadius: Tokens.radius.md, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent },

  sectionBody: { padding: 12, gap: 8 },

  // Health bar
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  healthLabel: { fontSize: Type.caption1.fontSize, color: t.textMuted, width: 100 },
  healthBar: { flex: 1, height: 6, backgroundColor: t.line, borderRadius: 3, overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 3 },
  healthPct: { fontSize: Type.caption1.fontSize, fontWeight: '700', width: 34, textAlign: 'right' },

  // Task rows
  taskRow: { flexDirection: 'row', backgroundColor: t.bg, borderRadius: Tokens.radius.sm, overflow: 'hidden', marginBottom: 4 },
  taskPhaseBar: { width: 3 },
  taskContent: { flex: 1, padding: 10 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  taskTitle: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text, flex: 1 },
  taskMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginBottom: 6 },
  taskProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskProgressBar: { flex: 1, height: 4, backgroundColor: t.line, borderRadius: 2, overflow: 'hidden' },
  taskProgressFill: { height: '100%', borderRadius: 2 },
  taskProgressPct: { fontSize: Type.caption2.fontSize, fontWeight: '600', width: 28, textAlign: 'right' },
  taskStatusBadge: { margin: 10, alignSelf: 'center', borderRadius: Tokens.radius.xs, paddingHorizontal: 7, paddingVertical: 3 },
  taskStatusText: { fontSize: 10, fontWeight: '700' },

  // Budget
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  budgetRowTotal: { borderTopWidth: 1, borderTopColor: t.line, marginTop: 4, paddingTop: 10 },
  budgetLabel: { fontSize: Type.footnote.fontSize, color: t.textMuted },
  budgetValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  budgetLabelTotal: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  budgetValueTotal: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text },
  invoiceProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  invoiceProgressBar: { flex: 1, height: 8, backgroundColor: t.line, borderRadius: 4, overflow: 'hidden' },
  invoiceProgressFill: { height: '100%', backgroundColor: t.success, borderRadius: 4 },
  invoiceProgressPct: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textMuted },
  budgetCaption: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginBottom: 8, lineHeight: 16 },
  moneyBarWrap: { marginTop: 12 },
  moneyBar: { flexDirection: 'row', height: 10, borderRadius: Tokens.radius.full, overflow: 'hidden', backgroundColor: t.line },
  moneyBarSeg: { height: '100%' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: Tokens.radius.full },
  legendText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' },
  coBreakdown: { marginTop: 14, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10 },
  coBreakdownTitle: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, letterSpacing: 0.6, marginBottom: 6 },
  coLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  coLineLabel: { fontSize: Type.footnote.fontSize, color: t.text },
  coLineDate: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 1 },
  coLineAmount: { fontSize: Type.footnote.fontSize, fontWeight: '700' },

  // List rows (invoices, COs, RFIs, punch)
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: t.bg, borderRadius: Tokens.radius.sm, padding: 10, marginBottom: 4 },
  listRowLeft: { flex: 1, marginRight: 10 },
  listRowTitle: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text, marginBottom: 2 },
  listRowMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  listRowRight: { alignItems: 'flex-end', gap: 4 },
  listRowAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  listStatusBadge: { borderRadius: Tokens.radius.xs, paddingHorizontal: 7, paddingVertical: 3 },
  listStatusText: { fontSize: 10, fontWeight: '700', color: t.textMuted },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 4 },
  photoThumb: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: Tokens.radius.sm, overflow: 'hidden', backgroundColor: t.line },
  photoImg: { width: '100%', height: '100%' },
  photoTag: { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#00000080', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  photoTagText: { fontSize: 9, color: '#FFF', fontWeight: '600' },

  // Lightbox
  lbBackdrop: { flex: 1, backgroundColor: '#000000F2' },
  lbHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12 },
  lbCaption: { flex: 1, color: '#FFF', fontSize: 13, fontWeight: '600' },
  lbImage: { width: '100%', height: '100%' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  footerText: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  // Change order card (wrapper for row + actions)
  coCard: { backgroundColor: t.bg, borderRadius: Tokens.radius.sm, marginBottom: 6, overflow: 'hidden' },
  coActions: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingBottom: 10,
    borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10,
  },
  coActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: Tokens.radius.sm,
  },
  coActionApprove: { backgroundColor: t.success },
  coActionReject: { backgroundColor: t.danger + '15', borderWidth: 1, borderColor: t.danger + '40' },
  coActionText: { fontSize: Type.footnote.fontSize, fontWeight: '700' },
  coSignedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#34C75915', paddingHorizontal: 10, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#34C75920',
  },
  coSignedBannerText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: Colors.successDark, flex: 1 },

  // Empty documents state
  emptyDocs: { alignItems: 'center', padding: 20, gap: 6 },
  emptyDocsText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  emptyDocsHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center' },

  // Messages (Q&A thread)
  msgEmpty: { alignItems: 'center', padding: 18, gap: 6 },
  msgEmptyTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  msgEmptyHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 17, paddingHorizontal: 10 },
  msgList: { gap: 8, paddingBottom: 12 },
  msgRow: { flexDirection: 'row' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  msgBubble: {
    maxWidth: '84%', borderRadius: Tokens.radius.card, paddingHorizontal: 12, paddingVertical: 8,
  },
  msgBubbleMine: { backgroundColor: t.accent, borderBottomRightRadius: 4 },
  msgBubbleTheirs: { backgroundColor: Colors.surfaceAlt, borderBottomLeftRadius: 4 },
  msgAuthor: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textSecondary, marginBottom: 2 },
  msgAuthorMine: { color: 'rgba(255,255,255,0.85)' },
  msgBody: { fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 19 },
  msgBodyMine: { color: '#fff' },
  msgTime: { fontSize: 10, color: t.textMuted, marginTop: 4 },
  msgTimeMine: { color: 'rgba(255,255,255,0.7)' },
  msgCompose: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
  },
  msgInput: {
    flex: 1, minHeight: 40, maxHeight: 120,
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: Type.bodyCompact.fontSize, color: t.text, backgroundColor: t.surface,
  },
  msgSendBtn: {
    width: 40, height: 40, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  msgSendBtnDisabled: { opacity: 0.5 },

  // Approval modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '90%', paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700', color: t.text },
  modalClose: { padding: 4 },
  modalBody: { paddingHorizontal: 20, paddingTop: 14 },
  modalSummary: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 16,
  },
  modalSummaryLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600', marginBottom: 4, letterSpacing: 0.5 },
  modalSummaryTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text, marginBottom: 10 },
  modalSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  modalSummaryKey: { fontSize: Type.footnote.fontSize, color: t.textMuted },
  modalSummaryVal: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  modalSummaryReason: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 8, fontStyle: 'italic', lineHeight: 17 },
  modalFieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text, marginBottom: 6, marginTop: 4 },
  modalFieldHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginBottom: 10, lineHeight: 16 },
  modalInput: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: Type.bodyCompact.fontSize, color: t.text, marginBottom: 14,
  },
  signatureWrap: { alignItems: 'center', marginBottom: 10 },
  signatureConfirm: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginBottom: 14 },
  signatureConfirmText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.success },
  esignBox: {
    backgroundColor: t.surfaceAlt ?? t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.card, padding: 12, marginBottom: 14, gap: 10,
  },
  esignScroll: { maxHeight: 118 },
  esignDisclosure: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 17 },
  esignCheckRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  esignCheckbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center', marginTop: 1, backgroundColor: t.surface,
  },
  esignCheckboxOn: { backgroundColor: t.accent, borderColor: t.accent },
  esignCheckLabel: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 18, fontWeight: '600' },
  decisionsCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.card, gap: 10,
  },
  decisionsHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  decisionsTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  decisionsSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  decisionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  decisionDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  decisionBody: { flex: 1 },
  decisionTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text, lineHeight: 19 },
  decisionDetail: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 2 },
  decisionFlag: { fontSize: Type.caption2.fontSize, fontWeight: '700' },
  modalActions: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  modalCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: Tokens.radius.card, alignItems: 'center',
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  modalCancelText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  modalSubmitBtn: {
    flex: 2, flexDirection: 'row', gap: 8, paddingVertical: 13, borderRadius: Tokens.radius.card,
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.success,
  },
  modalSubmitText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: '#FFF' },
});
