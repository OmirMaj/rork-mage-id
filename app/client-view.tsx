import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, Dimensions, TextInput, Platform, Modal, Alert,
  RefreshControl,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Globe, CalendarDays, DollarSign, FileText, Image as ImageIcon,
  ClipboardList, CheckCircle2, MessageSquare, ChevronDown, ChevronUp,
  TrendingUp, Clock, AlertTriangle, BarChart3, Flag, GitBranch, Lock,
  FileSignature, X, Check, ThumbsUp, ThumbsDown, ShieldCheck, Send,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import type { ScheduleTask, ChangeOrder, COApprover, COAuditEntry } from '@/types';
import { getStatusColor, getStatusLabel, getPhaseColor } from '@/utils/scheduleEngine';
import { MOCK_DOCUMENTS, DOCUMENT_TYPE_INFO } from '@/mocks/documents';
import SignaturePad from '@/components/SignaturePad';
import { generateUUID } from '@/utils/generateId';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type SectionKey = 'messages' | 'schedule' | 'budget' | 'invoices' | 'changeOrders' | 'photos' | 'dailyReports' | 'punchList' | 'rfis' | 'documents';

function SectionHeader({ title, icon, count, expanded, onToggle }: {
  title: string; icon: React.ReactNode; count?: number; expanded: boolean; onToggle: () => void;
}) {
  return (
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
      {count !== undefined && (
        <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
      )}
      {expanded ? <ChevronUp size={16} color={Colors.textMuted} /> : <ChevronDown size={16} color={Colors.textMuted} />}
    </TouchableOpacity>
  );
}

function TaskRow({ task }: { task: ScheduleTask }) {
  const statusColor = getStatusColor(task.status);
  const phaseColor = getPhaseColor(task.phase);
  return (
    <View style={styles.taskRow}>
      <View style={[styles.taskPhaseBar, { backgroundColor: phaseColor }]} />
      <View style={styles.taskContent}>
        <View style={styles.taskTitleRow}>
          {task.isMilestone && <Flag size={11} color="#FF9500" />}
          {task.isCriticalPath && <GitBranch size={11} color={Colors.error} />}
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
  const insets = useSafeAreaInsets();
  const { portalId, inviteId, clientName: clientNameParam } = useLocalSearchParams<{ portalId: string; inviteId?: string; clientName?: string }>();
  const {
    projects, getChangeOrdersForProject, getInvoicesForProject, getDailyReportsForProject,
    getPunchItemsForProject, getPhotosForProject, getRFIsForProject, updateProject, updateChangeOrder,
    getPortalMessagesForProject, addPortalMessage, markPortalMessagesRead, getUnreadPortalMessageCount,
  } = useProjects();

  // Find project by portalId
  const project = useMemo(() =>
    projects.find(p => p.clientPortal?.portalId === portalId && p.clientPortal?.enabled),
    [projects, portalId]
  );

  const portal = project?.clientPortal;

  const changeOrders = useMemo(() => project ? getChangeOrdersForProject(project.id) : [], [project, getChangeOrdersForProject]);
  const invoices = useMemo(() => project ? getInvoicesForProject(project.id) : [], [project, getInvoicesForProject]);
  const dailyReports = useMemo(() => project ? getDailyReportsForProject(project.id) : [], [project, getDailyReportsForProject]);
  const punchItems = useMemo(() => project ? getPunchItemsForProject(project.id) : [], [project, getPunchItemsForProject]);
  const photos = useMemo(() => project ? getPhotosForProject(project.id) : [], [project, getPhotosForProject]);
  const rfis = useMemo(() => project ? getRFIsForProject(project.id) : [], [project, getRFIsForProject]);
  const documents = useMemo(
    () => project ? MOCK_DOCUMENTS.filter(d => d.projectId === project.id) : [],
    [project]
  );

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

  // CO approval modal state
  const [approvalCO, setApprovalCO] = useState<ChangeOrder | null>(null);
  const [approvalMode, setApprovalMode] = useState<'approve' | 'reject'>('approve');
  const [approverName, setApproverName] = useState<string>(typeof clientNameParam === 'string' ? clientNameParam : '');
  const [rejectionReason, setRejectionReason] = useState('');
  const [signaturePaths, setSignaturePaths] = useState<string[]>([]);
  const [submittingApproval, setSubmittingApproval] = useState(false);

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

  // Portal messages (Q&A thread) — client side
  const messages = useMemo(
    () => project ? getPortalMessagesForProject(project.id) : [],
    [project, getPortalMessagesForProject],
  );
  const unreadFromGc = useMemo(
    () => project ? getUnreadPortalMessageCount(project.id, 'client') : 0,
    [project, getUnreadPortalMessageCount],
  );
  const [composeBody, setComposeBody] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  // Mark all messages from GC as read once the client has opened the portal.
  useEffect(() => {
    if (!canRecordAccess || !project) return;
    if (unreadFromGc === 0) return;
    markPortalMessagesRead(project.id, 'client');
  }, [canRecordAccess, project?.id, unreadFromGc, markPortalMessagesRead]);

  const handleSendMessage = useCallback(() => {
    if (!project || !portal) return;
    const body = composeBody.trim();
    if (!body) return;
    const authorName =
      (typeof clientNameParam === 'string' && clientNameParam.trim()) ||
      portal.invites?.find(i => i.id === inviteId)?.name ||
      'Client';
    setSendingMsg(true);
    try {
      addPortalMessage({
        projectId: project.id,
        portalId: portal.portalId,
        authorType: 'client',
        authorName,
        inviteId: typeof inviteId === 'string' ? inviteId : undefined,
        body,
        readByGc: false,
        readByClient: true,
      });
      setComposeBody('');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setSendingMsg(false);
    }
  }, [project, portal, composeBody, inviteId, clientNameParam, addPortalMessage]);

  const openApprovalFlow = useCallback((co: ChangeOrder, mode: 'approve' | 'reject') => {
    setApprovalCO(co);
    setApprovalMode(mode);
    setSignaturePaths([]);
    setRejectionReason('');
    if (!approverName && clientNameParam) setApproverName(String(clientNameParam));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [approverName, clientNameParam]);

  const closeApprovalFlow = useCallback(() => {
    setApprovalCO(null);
    setSignaturePaths([]);
    setRejectionReason('');
    setSubmittingApproval(false);
  }, []);

  const submitApproval = useCallback(() => {
    if (!approvalCO || !project) return;
    if (!approverName.trim()) {
      Alert.alert('Name Required', 'Please enter your name as it appears on the contract.');
      return;
    }
    if (approvalMode === 'approve' && signaturePaths.length === 0) {
      Alert.alert('Signature Required', 'Please sign above to approve this change order.');
      return;
    }
    if (approvalMode === 'reject' && !rejectionReason.trim()) {
      Alert.alert('Reason Required', 'Please briefly explain why you are rejecting this change order.');
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

    const auditEntry: COAuditEntry = {
      id: generateUUID(),
      action: approvalMode === 'approve' ? 'client_approved_via_portal' : 'client_rejected_via_portal',
      actor: approverName.trim(),
      timestamp: now,
      detail: approvalMode === 'approve'
        ? `Digitally signed via client portal. Signature stroke count: ${signaturePaths.length}.`
        : `Rejected via client portal. Reason: ${rejectionReason.trim()}`,
    };

    const nextStatus = approvalMode === 'approve' ? 'approved' : 'rejected';

    updateChangeOrder(approvalCO.id, {
      status: nextStatus,
      approvers: nextApprovers,
      auditTrail: [...existingAudit, auditEntry],
    });

    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    const verb = approvalMode === 'approve' ? 'approved' : 'rejected';
    Alert.alert(
      approvalMode === 'approve' ? 'Approved' : 'Rejected',
      `Change Order #${approvalCO.number} has been ${verb}. The contractor has been notified.`,
      [{ text: 'OK', onPress: closeApprovalFlow }]
    );
  }, [approvalCO, project, approverName, signaturePaths, approvalMode, rejectionReason, updateChangeOrder, closeApprovalFlow]);

  // Budget metrics
  const contractValue = project?.estimate?.grandTotal ?? 0;
  const invoicedTotal = invoices.reduce((s, i) => s + i.totalDue, 0);
  const paidTotal = invoices.reduce((s, i) => s + i.amountPaid, 0);
  const coTotal = changeOrders.filter(c => c.status === 'approved').reduce((s, c) => s + c.changeAmount, 0);
  const revisedContract = contractValue + coTotal;

  // Schedule metrics
  const tasks = project?.schedule?.tasks ?? [];
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const scheduleProgress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const healthScore = project?.schedule?.healthScore ?? 0;

  if (!project || !portal) {
    return (
      <View style={styles.notFoundContainer}>
        <Stack.Screen options={{ title: 'Client Portal', headerShown: false }} />
        <Globe size={48} color={Colors.textMuted} />
        <Text style={styles.notFoundTitle}>Portal Not Found</Text>
        <Text style={styles.notFoundSubtitle}>This portal link may be expired or invalid.</Text>
      </View>
    );
  }

  const passcodeRequired = !!portal.requirePasscode && !!portal.passcode;

  if (passcodeRequired && !passcodeUnlocked) {
    const verify = () => {
      if (passcodeEntry.trim() === (portal.passcode ?? '').trim()) {
        setPasscodeUnlocked(true);
        setPasscodeError(false);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setPasscodeError(true);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    };
    return (
      <View style={styles.passcodeContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.passcodeCard}>
          <View style={styles.passcodeIconWrap}>
            <Lock size={32} color={Colors.primary} />
          </View>
          <Text style={styles.passcodeTitle}>Protected Portal</Text>
          <Text style={styles.passcodeSub}>{project.name}</Text>
          <Text style={styles.passcodeDesc}>
            Enter the passcode shared with you to access this project portal.
          </Text>
          <TextInput
            style={[styles.passcodeInput, passcodeError && { borderColor: Colors.error }]}
            value={passcodeEntry}
            onChangeText={(v) => { setPasscodeEntry(v); if (passcodeError) setPasscodeError(false); }}
            placeholder="Enter passcode"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={verify}
            returnKeyType="done"
          />
          {passcodeError ? (
            <Text style={styles.passcodeErrorText}>Incorrect passcode. Please try again.</Text>
          ) : null}
          <TouchableOpacity style={styles.passcodeBtn} onPress={verify} activeOpacity={0.85}>
            <Text style={styles.passcodeBtnText}>Unlock Portal</Text>
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerBrand}>
            <Globe size={22} color="#FFF" />
            <Text style={styles.headerBrandText}>Client Portal</Text>
          </View>
          <Text style={styles.headerProjectName}>{project.name}</Text>
          <Text style={styles.headerLocation}>{project.location}</Text>
          <Text style={styles.headerLastUpdated} testID="client-last-updated">
            Last updated {lastUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: project.status === 'in_progress' ? '#34C75940' : '#FF950040' }]}>
            <Text style={[styles.statusBadgeText, { color: project.status === 'in_progress' ? '#34C759' : '#FF9500' }]}>
              {project.status === 'in_progress' ? 'In Progress' : project.status === 'completed' ? 'Completed' : 'Active'}
            </Text>
          </View>
        </View>

        {/* Welcome message */}
        {!!portal.welcomeMessage && (
          <View style={styles.welcomeCard}>
            <MessageSquare size={16} color={Colors.primary} />
            <Text style={styles.welcomeText}>{portal.welcomeMessage}</Text>
          </View>
        )}

        {/* Quick stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Schedule</Text>
            <Text style={[styles.statValue, { color: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error }]}>
              {scheduleProgress}%
            </Text>
            <Text style={styles.statSub}>complete</Text>
          </View>
          {portal.showBudgetSummary && (
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Invoiced</Text>
              <Text style={styles.statValue}>{formatMoney(invoicedTotal)}</Text>
              <Text style={styles.statSub}>of {formatMoney(revisedContract)}</Text>
            </View>
          )}
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Punch List</Text>
            <Text style={[styles.statValue, { color: punchItems.filter(p => p.status !== 'closed').length > 0 ? '#FF9500' : '#34C759' }]}>
              {punchItems.filter(p => p.status !== 'closed').length}
            </Text>
            <Text style={styles.statSub}>open items</Text>
          </View>
        </View>

        {/* Messages Section — always on, it's the main 2-way channel */}
        <View style={styles.section}>
          <SectionHeader
            title="Messages"
            icon={<MessageSquare size={18} color={Colors.primary} />}
            count={messages.length || undefined}
            expanded={expanded.messages}
            onToggle={() => toggleSection('messages')}
          />
          {expanded.messages && (
            <View style={styles.sectionBody}>
              {messages.length === 0 ? (
                <View style={styles.msgEmpty}>
                  <MessageSquare size={20} color={Colors.textMuted} />
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
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  editable={!sendingMsg}
                />
                <TouchableOpacity
                  style={[styles.msgSendBtn, (!composeBody.trim() || sendingMsg) && styles.msgSendBtnDisabled]}
                  onPress={handleSendMessage}
                  disabled={!composeBody.trim() || sendingMsg}
                  activeOpacity={0.8}
                >
                  <Send size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Schedule Section */}
        {portal.showSchedule && tasks.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Project Schedule"
              icon={<CalendarDays size={18} color="#007AFF" />}
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
                      backgroundColor: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error,
                    }]} />
                  </View>
                  <Text style={[styles.healthPct, {
                    color: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error,
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
              icon={<BarChart3 size={18} color="#34C759" />}
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
                    <Text style={[styles.budgetValue, { color: coTotal > 0 ? Colors.error : '#34C759' }]}>
                      {coTotal > 0 ? '+' : ''}{formatMoney(coTotal)}
                    </Text>
                  </View>
                )}
                <View style={[styles.budgetRow, styles.budgetRowTotal]}>
                  <Text style={styles.budgetLabelTotal}>Revised Contract</Text>
                  <Text style={styles.budgetValueTotal}>{formatMoney(revisedContract)}</Text>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Total Invoiced</Text>
                  <Text style={styles.budgetValue}>{formatMoney(invoicedTotal)}</Text>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Total Paid</Text>
                  <Text style={[styles.budgetValue, { color: '#34C759' }]}>{formatMoney(paidTotal)}</Text>
                </View>
                {/* Invoice progress bar */}
                <View style={styles.invoiceProgressRow}>
                  <View style={styles.invoiceProgressBar}>
                    <View style={[styles.invoiceProgressFill, { width: revisedContract > 0 ? `${Math.min(100, (paidTotal / revisedContract) * 100)}%` as any : '0%' }]} />
                  </View>
                  <Text style={styles.invoiceProgressPct}>
                    {revisedContract > 0 ? Math.round((paidTotal / revisedContract) * 100) : 0}% paid
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Invoices */}
        {portal.showInvoices && invoices.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Invoices"
              icon={<DollarSign size={18} color="#FF9500" />}
              count={invoices.length}
              expanded={expanded.invoices}
              onToggle={() => toggleSection('invoices')}
            />
            {expanded.invoices && (
              <View style={styles.sectionBody}>
                {invoices.map(inv => {
                  const statusColor = inv.status === 'paid' ? '#34C759' : inv.status === 'overdue' ? Colors.error : '#FF9500';
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
              icon={<FileText size={18} color="#FF3B30" />}
              count={changeOrders.length}
              expanded={expanded.changeOrders}
              onToggle={() => toggleSection('changeOrders')}
            />
            {expanded.changeOrders && (
              <View style={styles.sectionBody}>
                {changeOrders.map(co => {
                  const statusColor = co.status === 'approved' ? '#34C759' : co.status === 'rejected' ? Colors.error : '#FF9500';
                  const awaitingClient = co.status === 'submitted' || co.status === 'under_review' || co.status === 'revised';
                  return (
                    <View key={co.id} style={styles.coCard}>
                      <View style={styles.listRow}>
                        <View style={styles.listRowLeft}>
                          <Text style={styles.listRowTitle}>CO #{co.number} — {co.description}</Text>
                          <Text style={styles.listRowMeta}>{new Date(co.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                        </View>
                        <View style={styles.listRowRight}>
                          <Text style={[styles.listRowAmount, { color: co.changeAmount > 0 ? Colors.error : '#34C759' }]}>
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
                            <ThumbsDown size={14} color={Colors.error} />
                            <Text style={[styles.coActionText, { color: Colors.error }]}>Reject</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.coActionBtn, styles.coActionApprove]}
                            onPress={() => openApprovalFlow(co, 'approve')}
                            activeOpacity={0.85}
                          >
                            <FileSignature size={14} color="#FFF" />
                            <Text style={[styles.coActionText, { color: '#FFF' }]}>Sign & Approve</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {co.status === 'approved' && co.approvers?.some(a => a.role === 'Client' && a.status === 'approved') && (
                        <View style={styles.coSignedBanner}>
                          <ShieldCheck size={12} color="#34C759" />
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
              icon={<ImageIcon size={18} color="#5856D6" />}
              count={photos.length}
              expanded={expanded.photos}
              onToggle={() => toggleSection('photos')}
            />
            {expanded.photos && (
              <View style={styles.photoGrid}>
                {photos.slice(0, 9).map(photo => (
                  <View key={photo.id} style={styles.photoThumb}>
                    <Image source={{ uri: photo.uri }} style={styles.photoImg} resizeMode="cover" />
                    {photo.tag && (
                      <View style={styles.photoTag}><Text style={styles.photoTagText}>{photo.tag}</Text></View>
                    )}
                  </View>
                ))}
                {photos.length > 9 && (
                  <View style={[styles.photoThumb, styles.photoMoreOverlay]}>
                    <Text style={styles.photoMoreText}>+{photos.length - 9}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Daily Reports */}
        {portal.showDailyReports && dailyReports.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Daily Reports"
              icon={<ClipboardList size={18} color="#32ADE6" />}
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
              icon={<CheckCircle2 size={18} color="#34C759" />}
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
              icon={<MessageSquare size={18} color="#FF9500" />}
              count={rfis.filter(r => r.status === 'open').length}
              expanded={expanded.rfis}
              onToggle={() => toggleSection('rfis')}
            />
            {expanded.rfis && (
              <View style={styles.sectionBody}>
                {rfis.map(rfi => {
                  const statusColor = rfi.status === 'answered' ? '#34C759' : rfi.status === 'closed' ? Colors.textMuted : '#FF9500';
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
              icon={<FileText size={18} color="#8E8E93" />}
              count={documents.length}
              expanded={expanded.documents}
              onToggle={() => toggleSection('documents')}
            />
            {expanded.documents && (
              <View style={styles.sectionBody}>
                {documents.length === 0 ? (
                  <View style={styles.emptyDocs}>
                    <FileText size={20} color={Colors.textMuted} />
                    <Text style={styles.emptyDocsText}>No documents shared yet.</Text>
                    <Text style={styles.emptyDocsHint}>Contracts, lien waivers, permits, and COIs will appear here.</Text>
                  </View>
                ) : (
                  documents.map(doc => {
                    const typeInfo = DOCUMENT_TYPE_INFO[doc.type] ?? { label: doc.type, color: Colors.textMuted, bgColor: Colors.surfaceAlt };
                    const statusColor = doc.status === 'signed' ? '#34C759' : doc.status === 'expired' ? Colors.error : doc.status === 'pending_signature' ? '#FF9500' : Colors.textMuted;
                    return (
                      <View key={doc.id} style={styles.listRow}>
                        <View style={styles.listRowLeft}>
                          <Text style={styles.listRowTitle} numberOfLines={1}>{doc.title}</Text>
                          <Text style={styles.listRowMeta}>
                            {typeInfo.label}
                            {doc.signedAt ? ` · Signed ${new Date(doc.signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                            {doc.expiresAt ? ` · Exp ${new Date(doc.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                          </Text>
                        </View>
                        <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                          <Text style={[styles.listStatusText, { color: statusColor }]}>
                            {doc.status === 'pending_signature' ? 'Pending' : doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Globe size={14} color={Colors.textMuted} />
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
              <TouchableOpacity onPress={closeApprovalFlow} style={styles.modalClose}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {approvalCO && (
                <View style={styles.modalSummary}>
                  <Text style={styles.modalSummaryLabel}>Change Order #{approvalCO.number}</Text>
                  <Text style={styles.modalSummaryTitle}>{approvalCO.description}</Text>
                  <View style={styles.modalSummaryRow}>
                    <Text style={styles.modalSummaryKey}>Change Amount</Text>
                    <Text style={[styles.modalSummaryVal, { color: approvalCO.changeAmount > 0 ? Colors.error : '#34C759' }]}>
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
                placeholderTextColor={Colors.textMuted}
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
                      <Check size={14} color="#34C759" />
                      <Text style={styles.signatureConfirmText}>Signature captured</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Reason for Rejection</Text>
                  <TextInput
                    style={[styles.modalInput, { minHeight: 100, textAlignVertical: 'top' }]}
                    value={rejectionReason}
                    onChangeText={setRejectionReason}
                    placeholder="Briefly explain what needs to change before you can approve…"
                    placeholderTextColor={Colors.textMuted}
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
                  approvalMode === 'reject' && { backgroundColor: Colors.error },
                  submittingApproval && { opacity: 0.6 },
                ]}
                onPress={submitApproval}
                activeOpacity={0.85}
                disabled={submittingApproval}
              >
                {approvalMode === 'approve'
                  ? <FileSignature size={15} color="#FFF" />
                  : <ThumbsDown size={15} color="#FFF" />
                }
                <Text style={styles.modalSubmitText}>
                  {approvalMode === 'approve' ? 'Approve & Sign' : 'Submit Rejection'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 8) / 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  notFoundContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  notFoundTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  notFoundSubtitle: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },

  passcodeContainer: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  passcodeCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 28, width: '100%', maxWidth: 380, alignItems: 'center', borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  passcodeIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  passcodeTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  passcodeSub: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  passcodeDesc: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  passcodeInput: { width: '100%', minHeight: 50, borderRadius: 12, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 14, fontSize: 16, color: Colors.text, marginTop: 12, textAlign: 'center', letterSpacing: 2 },
  passcodeErrorText: { fontSize: 12, color: Colors.error, marginTop: 4 },
  passcodeBtn: { width: '100%', minHeight: 50, borderRadius: 12, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  passcodeBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },

  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'flex-start',
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, opacity: 0.8 },
  headerBrandText: { fontSize: 12, fontWeight: '600', color: '#FFF', letterSpacing: 1 },
  headerProjectName: { fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  headerLocation: { fontSize: 13, color: '#FFFFFF99', marginBottom: 4 },
  headerLastUpdated: { fontSize: 11, color: '#FFFFFF80', marginBottom: 12, fontStyle: 'italic' as const },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },

  welcomeCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    margin: 16, backgroundColor: Colors.primary + '10',
    borderRadius: 12, padding: 14,
    borderLeftWidth: 3, borderLeftColor: Colors.primary,
  },
  welcomeText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20 },

  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  statCard: {
    flex: 1, backgroundColor: Colors.card,
    borderRadius: 12, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  statLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '800', color: Colors.text },
  statSub: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },

  section: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  badge: { backgroundColor: Colors.primary + '20', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  sectionBody: { padding: 12, gap: 8 },

  // Health bar
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  healthLabel: { fontSize: 12, color: Colors.textMuted, width: 100 },
  healthBar: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 3 },
  healthPct: { fontSize: 12, fontWeight: '700', width: 34, textAlign: 'right' },

  // Task rows
  taskRow: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: 8, overflow: 'hidden', marginBottom: 4 },
  taskPhaseBar: { width: 3 },
  taskContent: { flex: 1, padding: 10 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  taskTitle: { fontSize: 13, fontWeight: '600', color: Colors.text, flex: 1 },
  taskMeta: { fontSize: 11, color: Colors.textMuted, marginBottom: 6 },
  taskProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskProgressBar: { flex: 1, height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  taskProgressFill: { height: '100%', borderRadius: 2 },
  taskProgressPct: { fontSize: 11, fontWeight: '600', width: 28, textAlign: 'right' },
  taskStatusBadge: { margin: 10, alignSelf: 'center', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  taskStatusText: { fontSize: 10, fontWeight: '700' },

  // Budget
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  budgetRowTotal: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4, paddingTop: 10 },
  budgetLabel: { fontSize: 13, color: Colors.textMuted },
  budgetValue: { fontSize: 14, fontWeight: '600', color: Colors.text },
  budgetLabelTotal: { fontSize: 14, fontWeight: '700', color: Colors.text },
  budgetValueTotal: { fontSize: 16, fontWeight: '800', color: Colors.text },
  invoiceProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  invoiceProgressBar: { flex: 1, height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  invoiceProgressFill: { height: '100%', backgroundColor: '#34C759', borderRadius: 4 },
  invoiceProgressPct: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },

  // List rows (invoices, COs, RFIs, punch)
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.background, borderRadius: 8, padding: 10, marginBottom: 4 },
  listRowLeft: { flex: 1, marginRight: 10 },
  listRowTitle: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 2 },
  listRowMeta: { fontSize: 11, color: Colors.textMuted },
  listRowRight: { alignItems: 'flex-end', gap: 4 },
  listRowAmount: { fontSize: 14, fontWeight: '700', color: Colors.text },
  listStatusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  listStatusText: { fontSize: 10, fontWeight: '700', color: Colors.textMuted },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 4 },
  photoThumb: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.border },
  photoImg: { width: '100%', height: '100%' },
  photoTag: { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#00000080', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  photoTagText: { fontSize: 9, color: '#FFF', fontWeight: '600' },
  photoMoreOverlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000060' },
  photoMoreText: { fontSize: 20, fontWeight: '800', color: '#FFF' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  footerText: { fontSize: 12, color: Colors.textMuted },

  // Change order card (wrapper for row + actions)
  coCard: { backgroundColor: Colors.background, borderRadius: 8, marginBottom: 6, overflow: 'hidden' },
  coActions: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingBottom: 10,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10,
  },
  coActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 8,
  },
  coActionApprove: { backgroundColor: '#34C759' },
  coActionReject: { backgroundColor: Colors.error + '15', borderWidth: 1, borderColor: Colors.error + '40' },
  coActionText: { fontSize: 13, fontWeight: '700' },
  coSignedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#34C75915', paddingHorizontal: 10, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: '#34C75920',
  },
  coSignedBannerText: { fontSize: 11, fontWeight: '600', color: '#2E7D32', flex: 1 },

  // Empty documents state
  emptyDocs: { alignItems: 'center', padding: 20, gap: 6 },
  emptyDocsText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  emptyDocsHint: { fontSize: 11, color: Colors.textMuted, textAlign: 'center' },

  // Messages (Q&A thread)
  msgEmpty: { alignItems: 'center', padding: 18, gap: 6 },
  msgEmptyTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  msgEmptyHint: { fontSize: 12, color: Colors.textMuted, textAlign: 'center', lineHeight: 17, paddingHorizontal: 10 },
  msgList: { gap: 8, paddingBottom: 12 },
  msgRow: { flexDirection: 'row' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  msgBubble: {
    maxWidth: '84%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  msgBubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  msgBubbleTheirs: { backgroundColor: Colors.surfaceAlt, borderBottomLeftRadius: 4 },
  msgAuthor: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginBottom: 2 },
  msgAuthorMine: { color: 'rgba(255,255,255,0.85)' },
  msgBody: { fontSize: 14, color: Colors.text, lineHeight: 19 },
  msgBodyMine: { color: '#fff' },
  msgTime: { fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  msgTimeMine: { color: 'rgba(255,255,255,0.7)' },
  msgCompose: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  msgInput: {
    flex: 1, minHeight: 40, maxHeight: 120,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 14, color: Colors.text, backgroundColor: Colors.surface,
  },
  msgSendBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  msgSendBtnDisabled: { opacity: 0.5 },

  // Approval modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '90%', paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalClose: { padding: 4 },
  modalBody: { paddingHorizontal: 20, paddingTop: 14 },
  modalSummary: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 16,
  },
  modalSummaryLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 4, letterSpacing: 0.5 },
  modalSummaryTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  modalSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  modalSummaryKey: { fontSize: 13, color: Colors.textMuted },
  modalSummaryVal: { fontSize: 14, fontWeight: '700', color: Colors.text },
  modalSummaryReason: { fontSize: 12, color: Colors.textMuted, marginTop: 8, fontStyle: 'italic', lineHeight: 17 },
  modalFieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 6, marginTop: 4 },
  modalFieldHint: { fontSize: 11, color: Colors.textMuted, marginBottom: 10, lineHeight: 16 },
  modalInput: {
    backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: Colors.text, marginBottom: 14,
  },
  signatureWrap: { alignItems: 'center', marginBottom: 10 },
  signatureConfirm: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginBottom: 14 },
  signatureConfirmText: { fontSize: 12, fontWeight: '600', color: '#34C759' },
  modalActions: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  modalCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: Colors.text },
  modalSubmitBtn: {
    flex: 2, flexDirection: 'row', gap: 8, paddingVertical: 13, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#34C759',
  },
  modalSubmitText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
});
