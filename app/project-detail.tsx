import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Modal,
  TextInput, Pressable, KeyboardAvoidingView,
} from 'react-native';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import {
  DollarSign, Users, TrendingDown, MapPin,
  ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Trash2, Package, AlertTriangle, Lightbulb, CalendarDays,
  Mail, MessageSquare, X, BarChart3, ArrowDownRight, Shield, Layers,
  FileText, ShoppingCart, UserPlus, Send, Share2, Eye, PenTool, Crown, Pencil,
  Plus, Receipt, ClipboardList, Repeat, CheckSquare, Camera, Globe, Link, Copy, Wallet, Archive, Activity,
} from 'lucide-react-native';
import { PROJECT_TYPES, type ProjectType, type ProjectCollaborator, type EntityRef } from '@/types';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import EntityActionSheet from '@/components/EntityActionSheet';
import { generateUUID } from '@/utils/generateId';
import AIProjectReport from '@/components/AIProjectReport';
import AIAutoScheduleButton from '@/components/AIAutoScheduleButton';
import { generateAndSharePDF, buildEstimateTextForEmail, generateRFILogPDF } from '@/utils/pdfGenerator';
import { generateAndShareCloseoutPacket } from '@/utils/closeoutPacketGenerator';
import { prefetchProjectPlans } from '@/utils/planPrefetch';
import { exportProjectIcs } from '@/utils/icsGenerator';
import { formatMoney } from '@/utils/formatters';
import { getEffectiveInvoiceStatus } from '@/utils/projectFinancials';

type SectionKey = 'linkedEstimate' | 'materials' | 'labor' | 'summary' | 'schedule' | 'notes' | 'collaborators' | 'changeOrders' | 'invoices' | 'dailyReports' | 'punchList' | 'rfis' | 'submittals' | 'budget' | 'photos' | 'clientPortal' | 'communications' | 'activity' | 'calendar' | 'plans';
type DetailModalType = 'total' | 'savings' | null;
type EditModalType = boolean;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ProjectDetailScreen() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const { navigateTo } = useEntityNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getProject, deleteProject, updateProject, settings, addCollaborator, removeCollaborator, getChangeOrdersForProject, getInvoicesForProject, getDailyReportsForProject, updateChangeOrder, getPunchItemsForProject, getPhotosForProject, getCommEventsForProject, addCommEvent, getRFIsForProject, getSubmittalsForProject, getWarrantiesForProject, getPlanSheetsForProject, invoices: allInvoices, changeOrders: allChangeOrders } = useProjects();
  const { tier } = useSubscription();

  const changeOrders = useMemo(() => getChangeOrdersForProject(id ?? ''), [id, getChangeOrdersForProject]);
  const projectInvoices = useMemo(() => getInvoicesForProject(id ?? ''), [id, getInvoicesForProject]);
  const dailyReports = useMemo(() => getDailyReportsForProject(id ?? ''), [id, getDailyReportsForProject]);
  const punchItems = useMemo(() => getPunchItemsForProject(id ?? ''), [id, getPunchItemsForProject]);
  const projectPhotos = useMemo(() => getPhotosForProject(id ?? ''), [id, getPhotosForProject]);
  const commEvents = useMemo(() => getCommEventsForProject(id ?? ''), [id, getCommEventsForProject]);
  const projectRFIs = useMemo(() => getRFIsForProject(id ?? ''), [id, getRFIsForProject]);
  const projectSubmittals = useMemo(() => getSubmittalsForProject(id ?? ''), [id, getSubmittalsForProject]);
  const projectWarranties = useMemo(() => getWarrantiesForProject(id ?? ''), [id, getWarrantiesForProject]);
  const projectPlans = useMemo(() => getPlanSheetsForProject(id ?? ''), [id, getPlanSheetsForProject]);

  // Pre-cache plan PNGs the moment a project opens. The marketing site
  // promises plans work offline; for that to be true, the bytes have to
  // already be on disk before the user walks out of wifi range. Fire-and-
  // forget \u2014 no spinner, no blocking.
  useEffect(() => {
    if (projectPlans.length > 0) prefetchProjectPlans(projectPlans);
    // We only care about the URI list \u2014 re-prefetching when sheet metadata
    // changes (e.g. a sheet number rename) is wasted bandwidth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, projectPlans.map((p) => p.imageUri).join('|')]);

  const project = useMemo(() => getProject(id ?? ''), [id, getProject]);
  // `estimate` is nullable until the project loads (or if it has no estimate
  // attached). We compute it here so the useMemo/useCallback hooks below can
  // depend on it unconditionally — moving them below the `if (!project)` early
  // return would violate rules of hooks.
  const estimate = useMemo(() => project?.estimate, [project]);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    linkedEstimate: true,
    materials: true,
    labor: true,
    summary: true,
    schedule: true,
    notes: false,
    collaborators: true,
    changeOrders: true,
    invoices: true,
    dailyReports: true,
    punchList: true,
    rfis: true,
    submittals: true,
    budget: true,
    photos: true,
    clientPortal: false,
    communications: true,
    activity: false,
    calendar: false,
    plans: false,
  });
  const [detailModal, setDetailModal] = useState<DetailModalType>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [showEditModal, setShowEditModal] = useState<EditModalType>(false);
  const [activeTile, setActiveTile] = useState<SectionKey | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editType, setEditType] = useState<ProjectType>('renovation');
  const [editSquareFootage, setEditSquareFootage] = useState('');
  const [generatingCloseout, setGeneratingCloseout] = useState<boolean>(false);
  const [actionSheetRef, setActionSheetRef] = useState<EntityRef | null>(null);

  const toggleSection = useCallback((section: SectionKey) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // The tile-section modal renders as an iOS pageSheet. If we navigate while
  // it's still presented, the new screen mounts BEHIND the sheet — the classic
  // "press back and the new screen appears" bug. Dismiss the sheet first,
  // then navigate after iOS finishes the dismiss animation (~300ms).
  const navigateFromTile = useCallback((route: string | { pathname: string; params?: Record<string, string | number | undefined> }, mode: 'push' | 'replace' = 'push') => {
    setActiveTile(null);
    const delay = Platform.OS === 'ios' ? 350 : 0;
    setTimeout(() => {
      if (mode === 'replace') router.replace(route as any);
      else router.push(route as any);
    }, delay);
  }, [router]);

  const openEditModal = useCallback(() => {
    if (!project) return;
    setEditName(project.name);
    setEditDescription(project.description || '');
    setEditLocation(project.location || '');
    setEditType(project.type);
    setEditSquareFootage(project.squareFootage > 0 ? project.squareFootage.toString() : '');
    setShowEditModal(true);
  }, [project]);

  const handleSaveEdit = useCallback(() => {
    if (!id) return;
    const name = editName.trim();
    if (!name) {
      Alert.alert('Missing Name', 'Please enter a project name.');
      return;
    }
    const sqft = parseFloat(editSquareFootage) || 0;
    updateProject(id, {
      name,
      description: editDescription.trim(),
      location: editLocation.trim() || 'United States',
      type: editType,
      squareFootage: sqft,
    });
    setShowEditModal(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    console.log('[ProjectDetail] Project updated:', id);
  }, [id, editName, editDescription, editLocation, editType, editSquareFootage, updateProject]);

  const branding = useMemo(() => settings.branding ?? {
    companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '',
  }, [settings.branding]);

  const handleSharePDF = useCallback(async () => {
    if (!project) return;
    try {
      setShowShareModal(false);
      await generateAndSharePDF(project, branding, 'share');
    } catch (e) {
      console.error('[ProjectDetail] PDF share error:', e);
      Alert.alert('Error', 'Failed to generate PDF. Please try again.');
    }
  }, [project, branding]);

  const handleShareEmail = useCallback(async () => {
    if (!project) return;
    setShowShareModal(false);

    const subject = branding.companyName
      ? `${branding.companyName} - Estimate: ${project.name}`
      : `Estimate: ${project.name}`;

    const body = buildEstimateTextForEmail(project, branding);
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(mailtoUrl).catch(() => {
      Alert.alert('Unable to open email', 'Please check your email app is configured.');
    });
  }, [project, branding]);

  const handleShareText = useCallback(() => {
    if (!project) return;
    setShowShareModal(false);
    let body = '';
    if (branding.companyName) body += `${branding.companyName}\n`;
    body += `Estimate: ${project.name}\n`;
    body += `Location: ${project.location}\n`;
    const linked = project.linkedEstimate;
    const legacy = project.estimate;
    if (linked) {
      body += `Total: $${linked.grandTotal.toFixed(2)} (${linked.items.length} items)\n`;
    } else if (legacy) {
      body += `\nCost Summary:\n`;
      body += `Materials: $${legacy.materialTotal.toLocaleString()}\n`;
      body += `Labor: $${legacy.laborTotal.toLocaleString()}\n`;
      body += `Grand Total: $${legacy.grandTotal.toLocaleString()}\n`;
    }
    if (project.schedule) {
      body += `\nSchedule: ${project.schedule.totalDurationDays} days, ${project.schedule.tasks.length} tasks\n`;
    }
    if (branding.contactName) body += `\nContact: ${branding.contactName}`;
    if (branding.phone) body += `\nPhone: ${branding.phone}`;
    if (branding.email) body += `\nEmail: ${branding.email}`;
    const url = Platform.OS === 'ios'
      ? `sms:&body=${encodeURIComponent(body)}`
      : `sms:?body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open messages', 'Please check your messaging app.');
    });
  }, [project, branding]);

  const handleShareSchedulePDF = useCallback(async () => {
    if (!project) return;
    try {
      setShowShareModal(false);
      await generateAndSharePDF(project, branding, 'share');
    } catch (e) {
      console.error('[ProjectDetail] Schedule PDF share error:', e);
      Alert.alert('Error', 'Failed to generate schedule PDF.');
    }
  }, [project, branding]);

  // Export the project's complete RFI log as a PDF — the document a GC would
  // hand the architect at the project meeting or attach to a closeout binder.
  // We export ALL RFIs (open, answered, closed, void) because the architect
  // typically wants the full audit trail. Web falls back to print-preview via
  // shareHtml; native gets a proper file URI + share sheet.
  const handleExportRFILog = useCallback(async () => {
    if (!project) return;
    if (projectRFIs.length === 0) {
      Alert.alert('No RFIs', 'There are no RFIs to export on this project yet.');
      return;
    }
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await generateRFILogPDF(projectRFIs, project, branding);
    } catch (e) {
      console.error('[ProjectDetail] RFI log PDF error:', e);
      Alert.alert('Error', 'Failed to generate RFI log PDF.');
    }
  }, [project, projectRFIs, branding]);

  const handleGenerateCloseoutPacket = useCallback(async () => {
    if (!project || !id) return;
    if (generatingCloseout) return;
    const openPunchCount = punchItems.filter(p => p.status !== 'closed').length;
    const unpaidInvoices = projectInvoices.filter(i => {
      const net = (i.totalDue ?? 0) - Math.max(0, (i.retentionAmount ?? 0) - (i.retentionReleased ?? 0));
      return (i.amountPaid ?? 0) < net;
    });
    const warn: string[] = [];
    if (openPunchCount > 0) warn.push(`${openPunchCount} open punch item${openPunchCount === 1 ? '' : 's'}`);
    if (unpaidInvoices.length > 0) warn.push(`${unpaidInvoices.length} unpaid invoice${unpaidInvoices.length === 1 ? '' : 's'}`);
    const proceed = async () => {
      setGeneratingCloseout(true);
      try {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const ok = await generateAndShareCloseoutPacket({
          project,
          branding,
          changeOrders,
          invoices: projectInvoices,
          dailyReports,
          punchItems,
          warranties: projectWarranties,
          photos: projectPhotos,
          photoCount: projectPhotos.length,
        });
        if (ok) {
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert('Closeout Packet', 'Could not generate the closeout packet. Please try again.');
        }
      } catch (err) {
        console.error('[ProjectDetail] Closeout packet error:', err);
        Alert.alert('Error', 'Failed to generate closeout packet.');
      } finally {
        setGeneratingCloseout(false);
      }
    };
    if (warn.length > 0) {
      Alert.alert(
        'Generate Closeout Packet?',
        `Heads up — this project still has ${warn.join(' and ')}. Generate anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Generate', onPress: () => { void proceed(); } },
        ],
      );
    } else {
      void proceed();
    }
  }, [project, id, branding, changeOrders, projectInvoices, dailyReports, punchItems, projectWarranties, projectPhotos, generatingCloseout]);

  const handleExportCalendar = useCallback(async () => {
    if (!project) return;
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await exportProjectIcs({
        project,
        invoices: projectInvoices,
        warranties: projectWarranties,
      });
      if (result.eventCount === 0) {
        Alert.alert(
          'Calendar Feed',
          'No schedule tasks, invoice due dates, or warranty expirations found for this project yet. Add items to the schedule to populate the feed.',
        );
        return;
      }
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert('Calendar Feed', `Downloaded ${result.eventCount} event${result.eventCount === 1 ? '' : 's'} to your calendar file. Open it to import.`);
      }
    } catch (err) {
      console.error('[ProjectDetail] Calendar export error:', err);
      Alert.alert('Calendar Feed', 'Could not generate the calendar feed. Please try again.');
    }
  }, [project, projectInvoices, projectWarranties]);

  const handleInvite = useCallback(() => {
    if (!project || !id) return;
    const email = inviteEmail.trim();
    const name = inviteName.trim() || email.split('@')[0];
    if (!email || !email.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    const collab: ProjectCollaborator = {
      id: createId('collab'),
      email,
      name,
      role: inviteRole,
      status: 'pending',
      invitedAt: new Date().toISOString(),
    };
    addCollaborator(id, collab);

    const inviteLink = `https://mageid.app/invite/${id}?email=${encodeURIComponent(email)}&role=${inviteRole}`;
    const subject = `${branding.companyName || 'MAGE ID'} - Project Invitation: ${project.name}`;
    const body = `You've been invited to collaborate on "${project.name}" as ${inviteRole === 'editor' ? 'an Editor' : 'a Viewer'}.\n\nProject: ${project.name}\nLocation: ${project.location}\n\nClick the link below to join this project:\n${inviteLink}\n\n${branding.companyName ? `From: ${branding.companyName}` : 'From: MAGE ID'}${branding.contactName ? `\nContact: ${branding.contactName}` : ''}${branding.phone ? `\nPhone: ${branding.phone}` : ''}`;
    const mailUrl = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(mailUrl).catch(() => {
      console.log('[ProjectDetail] Could not open email client');
    });

    setInviteEmail('');
    setInviteName('');
    setShowInviteModal(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Invited', `${name} has been invited as ${inviteRole}.`);
  }, [project, id, inviteEmail, inviteName, inviteRole, branding, addCollaborator]);

  const handleRemoveCollaborator = useCallback((collabId: string, collabName: string) => {
    if (!id) return;
    Alert.alert('Remove Collaborator', `Remove ${collabName} from this project?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => {
          removeCollaborator(id, collabId);
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
        },
      },
    ]);
  }, [id, removeCollaborator]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Project',
      'Are you sure you want to delete this project? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (id) deleteProject(id);
            if (Platform.OS !== 'web') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            router.back();
          },
        },
      ]
    );
  }, [id, deleteProject, router]);

  // --- Estimate-dependent hooks ---
  // These must live ABOVE the `if (!project)` early return so they run on
  // every render. They already handle the null case internally.
  const totalBreakdown = useMemo(() => {
    if (!estimate) return null;
    const materialPct = estimate.subtotal > 0 ? (estimate.materialTotal / estimate.subtotal) * 100 : 0;
    const laborPct = estimate.subtotal > 0 ? (estimate.laborTotal / estimate.subtotal) * 100 : 0;
    const permitPct = estimate.subtotal > 0 ? (estimate.permits / estimate.subtotal) * 100 : 0;
    const overheadPct = estimate.subtotal > 0 ? (estimate.overhead / estimate.subtotal) * 100 : 0;
    const taxRate = estimate.subtotal > 0 ? (estimate.tax / estimate.subtotal) * 100 : 0;
    const contingencyRate = estimate.subtotal > 0 ? (estimate.contingency / estimate.subtotal) * 100 : 0;
    return { materialPct, laborPct, permitPct, overheadPct, taxRate, contingencyRate };
  }, [estimate]);

  const savingsBreakdown = useMemo(() => {
    if (!estimate) return null;
    const itemsWithSavings = estimate.materials.filter(m => m.savings > 0);
    const topSavers = [...itemsWithSavings].sort((a, b) => b.savings - a.savings).slice(0, 8);
    const totalBulkSavings = estimate.bulkSavingsTotal;
    const savingsRate = estimate.grandTotal > 0 ? (totalBulkSavings / (estimate.grandTotal + totalBulkSavings)) * 100 : 0;
    const itemsAtBulk = itemsWithSavings.length;
    const totalItems = estimate.materials.length;
    return { topSavers, totalBulkSavings, savingsRate, itemsAtBulk, totalItems };
  }, [estimate]);

  const openDetail = useCallback((type: 'total' | 'savings') => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetailModal(type);
  }, []);

  const renderTotalDetailModal = useCallback(() => {
    if (!estimate || !totalBreakdown) return null;
    const rows = [
      { label: 'Materials', value: estimate.materialTotal, pct: totalBreakdown.materialPct, color: '#1A6B3C', icon: Package },
      { label: 'Labor', value: estimate.laborTotal, pct: totalBreakdown.laborPct, color: '#007AFF', icon: Users },
      { label: 'Permits & Fees', value: estimate.permits, pct: totalBreakdown.permitPct, color: '#FF9500', icon: Shield },
      { label: 'Overhead', value: estimate.overhead, pct: totalBreakdown.overheadPct, color: '#AF52DE', icon: Layers },
    ];
    const maxPct = Math.max(...rows.map(r => r.pct));

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <View style={detailStyles.heroSection}>
          <View style={detailStyles.heroIconWrap}>
            <BarChart3 size={28} color={Colors.primary} />
          </View>
          <Text style={detailStyles.heroAmount}>${estimate.grandTotal.toLocaleString()}</Text>
          <Text style={detailStyles.heroSubtitle}>Total Project Value</Text>
          <View style={detailStyles.heroChips}>
            <View style={detailStyles.heroChip}>
              <Text style={detailStyles.heroChipLabel}>${estimate.pricePerSqFt.toFixed(2)}</Text>
              <Text style={detailStyles.heroChipSub}>per sq ft</Text>
            </View>
            <View style={[detailStyles.heroChip, { backgroundColor: Colors.successLight }]}>
              <Text style={[detailStyles.heroChipLabel, { color: Colors.success }]}>-${estimate.bulkSavingsTotal.toLocaleString()}</Text>
              <Text style={[detailStyles.heroChipSub, { color: Colors.success }]}>savings applied</Text>
            </View>
          </View>
        </View>

        <Text style={detailStyles.sectionLabel}>Cost Composition</Text>
        <View style={detailStyles.barChartWrap}>
          {rows.map(row => (
            <View key={row.label} style={detailStyles.barRow}>
              <View style={detailStyles.barLabelRow}>
                <row.icon size={14} color={row.color} />
                <Text style={detailStyles.barLabel}>{row.label}</Text>
                <Text style={detailStyles.barPct}>{row.pct.toFixed(1)}%</Text>
              </View>
              <View style={detailStyles.barTrack}>
                <View style={[detailStyles.barFill, { width: `${maxPct > 0 ? (row.pct / maxPct) * 100 : 0}%`, backgroundColor: row.color }]} />
              </View>
              <Text style={detailStyles.barValue}>${row.value.toLocaleString()}</Text>
            </View>
          ))}
        </View>

        <Text style={detailStyles.sectionLabel}>Additional Costs</Text>
        <View style={detailStyles.additionalCard}>
          <View style={detailStyles.additionalRow}>
            <View style={detailStyles.additionalLeft}>
              <View style={[detailStyles.additionalDot, { backgroundColor: Colors.warning }]} />
              <Text style={detailStyles.additionalLabel}>Tax</Text>
            </View>
            <View style={detailStyles.additionalRight}>
              <Text style={detailStyles.additionalValue}>${estimate.tax.toLocaleString()}</Text>
              <Text style={detailStyles.additionalPct}>{totalBreakdown.taxRate.toFixed(1)}%</Text>
            </View>
          </View>
          <View style={detailStyles.additionalDivider} />
          <View style={detailStyles.additionalRow}>
            <View style={detailStyles.additionalLeft}>
              <View style={[detailStyles.additionalDot, { backgroundColor: Colors.error }]} />
              <Text style={detailStyles.additionalLabel}>Contingency</Text>
            </View>
            <View style={detailStyles.additionalRight}>
              <Text style={detailStyles.additionalValue}>${estimate.contingency.toLocaleString()}</Text>
              <Text style={detailStyles.additionalPct}>{totalBreakdown.contingencyRate.toFixed(1)}%</Text>
            </View>
          </View>
          <View style={detailStyles.additionalDivider} />
          <View style={detailStyles.additionalRow}>
            <View style={detailStyles.additionalLeft}>
              <View style={[detailStyles.additionalDot, { backgroundColor: Colors.success }]} />
              <Text style={[detailStyles.additionalLabel, { color: Colors.success }]}>Bulk Savings</Text>
            </View>
            <View style={detailStyles.additionalRight}>
              <Text style={[detailStyles.additionalValue, { color: Colors.success }]}>-${estimate.bulkSavingsTotal.toLocaleString()}</Text>
            </View>
          </View>
        </View>

        <Text style={detailStyles.sectionLabel}>Full Breakdown</Text>
        <View style={detailStyles.fullBreakdownCard}>
          {[
            { label: 'Materials Subtotal', value: estimate.materialTotal },
            { label: 'Labor Subtotal', value: estimate.laborTotal },
            { label: 'Permits & Fees', value: estimate.permits },
            { label: 'Overhead', value: estimate.overhead },
          ].map((item, idx) => (
            <View key={idx}>
              <View style={detailStyles.breakdownRow}>
                <Text style={detailStyles.breakdownLabel}>{item.label}</Text>
                <Text style={detailStyles.breakdownValue}>${item.value.toLocaleString()}</Text>
              </View>
              {idx < 3 && <View style={detailStyles.breakdownDivider} />}
            </View>
          ))}
          <View style={detailStyles.breakdownDividerThick} />
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.breakdownLabelBold}>Subtotal</Text>
            <Text style={detailStyles.breakdownValueBold}>${estimate.subtotal.toLocaleString()}</Text>
          </View>
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.breakdownLabel}>+ Tax</Text>
            <Text style={detailStyles.breakdownValue}>${estimate.tax.toLocaleString()}</Text>
          </View>
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.breakdownLabel}>+ Contingency</Text>
            <Text style={detailStyles.breakdownValue}>${estimate.contingency.toLocaleString()}</Text>
          </View>
          <View style={detailStyles.breakdownRow}>
            <Text style={[detailStyles.breakdownLabel, { color: Colors.success }]}>- Bulk Savings</Text>
            <Text style={[detailStyles.breakdownValue, { color: Colors.success }]}>-${estimate.bulkSavingsTotal.toLocaleString()}</Text>
          </View>
          <View style={detailStyles.breakdownDividerThick} />
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.grandLabel}>Grand Total</Text>
            <Text style={detailStyles.grandValue}>${estimate.grandTotal.toLocaleString()}</Text>
          </View>
        </View>
      </ScrollView>
    );
  }, [estimate, totalBreakdown, insets.bottom]);

  const renderSavingsDetailModal = useCallback(() => {
    if (!estimate || !savingsBreakdown) return null;

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <View style={detailStyles.heroSection}>
          <View style={[detailStyles.heroIconWrap, { backgroundColor: Colors.successLight }]}>
            <TrendingDown size={28} color={Colors.success} />
          </View>
          <Text style={[detailStyles.heroAmount, { color: Colors.success }]}>${savingsBreakdown.totalBulkSavings.toLocaleString()}</Text>
          <Text style={detailStyles.heroSubtitle}>Total Bulk Savings</Text>
          <View style={detailStyles.heroChips}>
            <View style={[detailStyles.heroChip, { backgroundColor: Colors.successLight }]}>
              <Text style={[detailStyles.heroChipLabel, { color: Colors.success }]}>{savingsBreakdown.savingsRate.toFixed(1)}%</Text>
              <Text style={[detailStyles.heroChipSub, { color: Colors.success }]}>savings rate</Text>
            </View>
            <View style={detailStyles.heroChip}>
              <Text style={detailStyles.heroChipLabel}>{savingsBreakdown.itemsAtBulk}/{savingsBreakdown.totalItems}</Text>
              <Text style={detailStyles.heroChipSub}>items w/ savings</Text>
            </View>
          </View>
        </View>

        <Text style={detailStyles.sectionLabel}>How Bulk Savings Work</Text>
        <View style={detailStyles.infoCard}>
          <View style={detailStyles.infoRow}>
            <View style={[detailStyles.infoStep, { backgroundColor: Colors.primary + '15' }]}>
              <Text style={[detailStyles.infoStepNum, { color: Colors.primary }]}>1</Text>
            </View>
            <View style={detailStyles.infoTextWrap}>
              <Text style={detailStyles.infoTitle}>Volume Thresholds</Text>
              <Text style={detailStyles.infoDesc}>Each material has a minimum bulk quantity. Once met, a lower per-unit price is unlocked.</Text>
            </View>
          </View>
          <View style={detailStyles.infoRow}>
            <View style={[detailStyles.infoStep, { backgroundColor: Colors.success + '15' }]}>
              <Text style={[detailStyles.infoStepNum, { color: Colors.success }]}>2</Text>
            </View>
            <View style={detailStyles.infoTextWrap}>
              <Text style={detailStyles.infoTitle}>Automatic Application</Text>
              <Text style={detailStyles.infoDesc}>When your estimate quantities exceed bulk thresholds, savings are calculated automatically.</Text>
            </View>
          </View>
          <View style={detailStyles.infoRow}>
            <View style={[detailStyles.infoStep, { backgroundColor: Colors.accent + '15' }]}>
              <Text style={[detailStyles.infoStepNum, { color: Colors.accent }]}>3</Text>
            </View>
            <View style={detailStyles.infoTextWrap}>
              <Text style={detailStyles.infoTitle}>Reflected in Total</Text>
              <Text style={detailStyles.infoDesc}>Bulk savings are deducted from the grand total, reducing your overall project cost.</Text>
            </View>
          </View>
        </View>

        {savingsBreakdown.topSavers.length > 0 && (
          <>
            <Text style={detailStyles.sectionLabel}>Top Savings by Item</Text>
            <View style={detailStyles.topSaversCard}>
              {savingsBreakdown.topSavers.map((item, idx) => {
                const savingsPct = item.unitPrice > 0 ? ((item.savings) / (item.unitPrice * item.quantity)) * 100 : 0;
                return (
                  <View key={idx}>
                    <View style={detailStyles.saverRow}>
                      <View style={detailStyles.saverRank}>
                        <Text style={detailStyles.saverRankText}>#{idx + 1}</Text>
                      </View>
                      <View style={detailStyles.saverInfo}>
                        <Text style={detailStyles.saverName} numberOfLines={1}>{item.name}</Text>
                        <Text style={detailStyles.saverMeta}>{item.quantity} {item.unit} · ${item.unitPrice.toFixed(2)}/unit</Text>
                      </View>
                      <View style={detailStyles.saverSavings}>
                        <Text style={detailStyles.saverAmount}>${item.savings.toFixed(0)}</Text>
                        <Text style={detailStyles.saverPct}>{savingsPct.toFixed(0)}% off</Text>
                      </View>
                    </View>
                    {idx < savingsBreakdown.topSavers.length - 1 && <View style={detailStyles.saverDivider} />}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {savingsBreakdown.itemsAtBulk < savingsBreakdown.totalItems && (
          <>
            <Text style={detailStyles.sectionLabel}>Optimization Tip</Text>
            <View style={[detailStyles.infoCard, { backgroundColor: Colors.warningLight, borderColor: Colors.warning + '30' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <Lightbulb size={18} color={Colors.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={[detailStyles.infoTitle, { marginBottom: 4 }]}>Unlock More Savings</Text>
                  <Text style={detailStyles.infoDesc}>
                    {savingsBreakdown.totalItems - savingsBreakdown.itemsAtBulk} material(s) aren't yet at bulk thresholds. Increasing quantities on those items could unlock additional discounts.
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    );
  }, [estimate, savingsBreakdown, insets.bottom]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const linkedEstimate = project.linkedEstimate;
  const hasAnyEstimate = !!(linkedEstimate && linkedEstimate.items.length > 0) || !!estimate;
  const collaborators = project.collaborators ?? [];

  const heroTotal = linkedEstimate?.grandTotal ?? estimate?.grandTotal ?? 0;
  const heroLabel = linkedEstimate ? `${linkedEstimate.items.length} items` : estimate ? `${estimate.materials.length} materials` : '';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: project.name || 'Project Details',
        headerRight: () => (
          <TouchableOpacity onPress={openEditModal} style={{ padding: 6 }} activeOpacity={0.7} testID="edit-project-btn">
            <Pencil size={20} color={Colors.primary} />
          </TouchableOpacity>
        ),
      }} />
      <ScrollView
        contentContainerStyle={[{ paddingBottom: insets.bottom + 40 }, layout.isDesktop && { maxWidth: 1200, alignSelf: 'center' as const, width: '100%' as any }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroName}>{project.name}</Text>
              <View style={styles.heroMeta}>
                <MapPin size={14} color={Colors.textMuted} />
                <Text style={styles.heroMetaText}>{project.location}</Text>
              </View>
              {project.description ? (
                <Text style={styles.heroDesc}>{project.description}</Text>
              ) : null}
            </View>
          </View>

          {hasAnyEstimate && (
            <View style={styles.heroStats}>
              <TouchableOpacity
                style={styles.heroStatMain}
                onPress={() => estimate ? openDetail('total') : undefined}
                activeOpacity={estimate ? 0.7 : 1}
                testID="hero-total-tap"
              >
                <Text style={styles.heroStatLabel}>Total Estimate</Text>
                <Text style={styles.heroStatValue}>{formatMoney(heroTotal)}</Text>
                <Text style={styles.heroTapHint}>{heroLabel}{estimate ? ' · Tap for breakdown' : ''}</Text>
              </TouchableOpacity>
              <View style={styles.heroStatsRow}>
                {estimate && (
                  <>
                    <View style={styles.heroStatSmall}>
                      <Text style={styles.smallStatLabel}>Per Sq Ft</Text>
                      <Text style={styles.smallStatValue}>${estimate.pricePerSqFt.toFixed(2)}</Text>
                    </View>
                    <View style={styles.heroStatSmall}>
                      <Text style={styles.smallStatLabel}>Duration</Text>
                      <Text style={styles.smallStatValue}>{estimate.estimatedDuration}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.heroStatSmall}
                      onPress={() => openDetail('savings')}
                      activeOpacity={0.7}
                      testID="hero-savings-tap"
                    >
                      <Text style={styles.smallStatLabel}>Bulk Savings</Text>
                      <Text style={[styles.smallStatValue, { color: Colors.success }]}>
                        {formatMoney(estimate.bulkSavingsTotal)}
                      </Text>
                      <ArrowDownRight size={10} color="rgba(255,255,255,0.5)" />
                    </TouchableOpacity>
                  </>
                )}
                {!estimate && linkedEstimate && (
                  <>
                    <View style={styles.heroStatSmall}>
                      <Text style={styles.smallStatLabel}>Markup</Text>
                      <Text style={styles.smallStatValue}>{linkedEstimate.globalMarkup}%</Text>
                    </View>
                    <View style={styles.heroStatSmall}>
                      <Text style={styles.smallStatLabel}>Base Cost</Text>
                      <Text style={styles.smallStatValue}>{formatMoney(linkedEstimate.baseTotal)}</Text>
                    </View>
                    <View style={styles.heroStatSmall}>
                      <Text style={styles.smallStatLabel}>+ Markup</Text>
                      <Text style={[styles.smallStatValue, { color: Colors.accent }]}>
                        {formatMoney(linkedEstimate.markupTotal)}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          )}
        </View>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push({ pathname: '/cash-flow' as any, params: { projectId: id } })}
            activeOpacity={0.7}
            testID="project-cash-flow-btn"
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.success + '15' }]}>
              <Wallet size={18} color={Colors.success} />
            </View>
            <Text style={styles.quickActionLabel}>Cash Flow</Text>
          </TouchableOpacity>
          {!hasAnyEstimate && (
            <TouchableOpacity
              style={styles.quickActionBtn}
              onPress={() => router.replace('/(tabs)/discover/estimate' as any)}
              activeOpacity={0.7}
              testID="project-create-estimate-btn"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: Colors.primary + '15' }]}>
                <Receipt size={18} color={Colors.primary} />
              </View>
              <Text style={styles.quickActionLabel}>Estimate</Text>
            </TouchableOpacity>
          )}
          {!project.schedule && (
            <TouchableOpacity
              style={styles.quickActionBtn}
              onPress={() => router.replace('/(tabs)/discover/schedule' as any)}
              activeOpacity={0.7}
              testID="project-create-schedule-btn"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: Colors.info + '15' }]}>
                <CalendarDays size={18} color={Colors.info} />
              </View>
              <Text style={styles.quickActionLabel}>Schedule</Text>
            </TouchableOpacity>
          )}
          {project.schedule && (
            <TouchableOpacity
              style={styles.quickActionBtn}
              onPress={() => router.replace('/(tabs)/schedule' as any)}
              activeOpacity={0.7}
              testID="project-view-schedule-btn"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: Colors.info + '15' }]}>
                <CalendarDays size={18} color={Colors.info} />
              </View>
              <Text style={styles.quickActionLabel}>Schedule</Text>
            </TouchableOpacity>
          )}
          {hasAnyEstimate && (
            <TouchableOpacity
              style={styles.quickActionBtn}
              onPress={() => router.replace('/(tabs)/estimate' as any)}
              activeOpacity={0.7}
              testID="project-view-estimate-btn"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: Colors.primary + '15' }]}>
                <Receipt size={18} color={Colors.primary} />
              </View>
              <Text style={styles.quickActionLabel}>Estimate</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push({ pathname: '/payment-predictions' as any, params: { projectId: id } })}
            activeOpacity={0.7}
            testID="project-payment-forecast-btn"
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.accent + '15' }]}>
              <TrendingDown size={18} color={Colors.accent} />
            </View>
            <Text style={styles.quickActionLabel}>Forecast</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickActionBtn, styles.quickActionBtnFull, generatingCloseout && { opacity: 0.5 }]}
            onPress={handleGenerateCloseoutPacket}
            activeOpacity={0.7}
            disabled={generatingCloseout}
            testID="project-closeout-packet-btn"
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.warning + '15' }]}>
              <Archive size={18} color={Colors.warning} />
            </View>
            <Text style={styles.quickActionLabel}>{generatingCloseout ? 'Building…' : 'Closeout'}</Text>
          </TouchableOpacity>
        </View>

        {/* Section tile grid — replaces the long scroll of cards */}
        <View style={styles.sectionGrid}>
          {([
            ...(hasAnyEstimate ? [{ key: 'linkedEstimate' as SectionKey, label: 'Estimate Items', icon: ShoppingCart, color: Colors.primary, count: linkedEstimate?.items.length ?? estimate?.materials.length ?? 0 }] : []),
            ...(project.schedule ? [{ key: 'schedule' as SectionKey, label: 'Schedule', icon: CalendarDays, color: Colors.info, count: project.schedule.tasks.length }] : []),
            { key: 'collaborators' as SectionKey, label: 'Team', icon: Users, color: Colors.info, count: collaborators.length + 1 },
            { key: 'changeOrders' as SectionKey, label: 'Change Orders', icon: Repeat, color: Colors.accent, count: changeOrders.length },
            { key: 'invoices' as SectionKey, label: 'Invoices', icon: Receipt, color: Colors.success, count: projectInvoices.length },
            { key: 'dailyReports' as SectionKey, label: 'Daily Reports', icon: ClipboardList, color: Colors.primary, count: dailyReports.length },
            { key: 'punchList' as SectionKey, label: 'Punch List', icon: CheckSquare, color: Colors.accent, count: punchItems.length },
            { key: 'rfis' as SectionKey, label: 'RFIs', icon: FileText, color: Colors.info, count: projectRFIs.length },
            { key: 'submittals' as SectionKey, label: 'Submittals', icon: FileText, color: '#5856D6', count: projectSubmittals.length },
            ...(hasAnyEstimate ? [{ key: 'budget' as SectionKey, label: 'Financial Health', icon: DollarSign, color: Colors.success, count: null as number | null }] : []),
            { key: 'photos' as SectionKey, label: 'Photos', icon: Camera, color: Colors.info, count: projectPhotos.length },
            { key: 'plans' as SectionKey, label: 'Plans', icon: Layers, color: Colors.primary, count: projectPlans.length },
            { key: 'clientPortal' as SectionKey, label: 'Client Portal', icon: Globe, color: '#5856D6', count: null as number | null },
            { key: 'communications' as SectionKey, label: 'Communications', icon: Mail, color: Colors.info, count: commEvents.length },
            { key: 'activity' as SectionKey, label: 'Activity', icon: Activity, color: Colors.accent, count: null as number | null },
            { key: 'calendar' as SectionKey, label: 'Calendar Feed', icon: CalendarDays, color: Colors.info, count: null as number | null },
          ]).map(tile => {
            const TileIcon = tile.icon;
            return (
              <TouchableOpacity
                key={tile.key}
                style={styles.sectionTile}
                onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  if (tile.key === 'activity') {
                    router.push({ pathname: '/activity-feed' as any, params: { projectId: id } });
                    return;
                  }
                  if (tile.key === 'calendar') {
                    void handleExportCalendar();
                    return;
                  }
                  if (tile.key === 'plans') {
                    router.push({ pathname: '/plans' as any, params: { projectId: id } });
                    return;
                  }
                  setActiveTile(tile.key);
                }}
                activeOpacity={0.7}
                testID={`section-tile-${tile.key}`}
              >
                <View style={[styles.sectionTileIcon, { backgroundColor: tile.color + '15' }]}>
                  <TileIcon size={20} color={tile.color} />
                </View>
                <Text style={styles.sectionTileLabel} numberOfLines={1}>{tile.label}</Text>
                {tile.count !== null && tile.count !== undefined && (
                  <View style={styles.sectionTileBadge}>
                    <Text style={styles.sectionTileBadgeText}>{tile.count}</Text>
                  </View>
                )}
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>

        <Modal
          visible={activeTile !== null}
          animationType="slide"
          presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
          onRequestClose={() => setActiveTile(null)}
        >
          <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }}>
            <View style={styles.sectionModalHeader}>
              <TouchableOpacity
                onPress={() => setActiveTile(null)}
                style={styles.sectionModalBack}
                activeOpacity={0.7}
                testID="section-modal-back"
              >
                <ChevronLeft size={22} color={Colors.text} />
                <Text style={styles.sectionModalBackText}>Back</Text>
              </TouchableOpacity>
              <Text style={styles.sectionModalTitle} numberOfLines={1}>
                {activeTile === 'linkedEstimate' ? 'Estimate Items'
                  : activeTile === 'schedule' ? 'Schedule'
                  : activeTile === 'materials' ? 'Materials'
                  : activeTile === 'labor' ? 'Labor'
                  : activeTile === 'summary' ? 'Cost Summary'
                  : activeTile === 'notes' ? 'Tips & Notes'
                  : activeTile === 'collaborators' ? 'Team'
                  : activeTile === 'changeOrders' ? 'Change Orders'
                  : activeTile === 'invoices' ? 'Invoices'
                  : activeTile === 'dailyReports' ? 'Daily Reports'
                  : activeTile === 'punchList' ? 'Punch List'
                  : activeTile === 'rfis' ? 'RFIs'
                  : activeTile === 'submittals' ? 'Submittals'
                  : activeTile === 'budget' ? 'Financial Health'
                  : activeTile === 'photos' ? 'Photos'
                  : activeTile === 'clientPortal' ? 'Client Portal'
                  : activeTile === 'communications' ? 'Communications'
                  : ''}
              </Text>
              <View style={{ width: 72 }} />
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 4 }}
              showsVerticalScrollIndicator={false}
            >

        {linkedEstimate && linkedEstimate.items.length > 0 && activeTile === 'linkedEstimate' && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggleSection('linkedEstimate')}
              activeOpacity={0.7}
              testID="linked-estimate-section"
            >
              <ShoppingCart size={20} color={Colors.primary} />
              <Text style={styles.sectionTitle}>
                Estimate Items — {formatMoney(linkedEstimate.grandTotal, 2)}
              </Text>
              {expanded.linkedEstimate ? (
                <ChevronUp size={18} color={Colors.textMuted} />
              ) : (
                <ChevronDown size={18} color={Colors.textMuted} />
              )}
            </TouchableOpacity>

            {expanded.linkedEstimate && (
              <View style={styles.tableContainer}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, { flex: 2 }]}>Item</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1 }]}>Qty</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1 }]}>Markup</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' as const }]}>Total</Text>
                </View>
                {linkedEstimate.items.map((item, idx) => (
                  <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
                    <View style={{ flex: 2 }}>
                      <Text style={styles.tableCellName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.tableCellSub}>{item.category} · {item.supplier}</Text>
                      {item.usesBulk && (
                        <View style={styles.bulkBadge}>
                          <TrendingDown size={10} color={Colors.success} />
                          <Text style={styles.bulkBadgeText}>Bulk rate</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.tableCell, { flex: 1 }]}>
                      {item.quantity} {item.unit}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 1 }]}>
                      {item.markup}%
                    </Text>
                    <Text style={[styles.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>
                      ${item.lineTotal.toFixed(2)}
                    </Text>
                  </View>
                ))}
                <View style={styles.linkedSummaryRow}>
                  <View style={styles.linkedSummaryItem}>
                    <Text style={styles.linkedSummaryLabel}>Base</Text>
                    <Text style={styles.linkedSummaryValue}>{formatMoney(linkedEstimate.baseTotal, 2)}</Text>
                  </View>
                  <View style={styles.linkedSummaryItem}>
                    <Text style={[styles.linkedSummaryLabel, { color: Colors.accent }]}>Markup</Text>
                    <Text style={[styles.linkedSummaryValue, { color: Colors.accent }]}>+{formatMoney(linkedEstimate.markupTotal, 2)}</Text>
                  </View>
                  <View style={styles.linkedSummaryItem}>
                    <Text style={[styles.linkedSummaryLabel, { fontWeight: '700' as const }]}>Total</Text>
                    <Text style={[styles.linkedSummaryValue, { color: Colors.primary, fontWeight: '800' as const }]}>{formatMoney(linkedEstimate.grandTotal, 2)}</Text>
                  </View>
                </View>
                {!project.schedule && (
                  <View style={{ marginTop: 8 }}>
                    <AIAutoScheduleButton
                      project={project}
                      estimate={linkedEstimate}
                      onScheduleCreated={(schedule) => {
                        if (schedule) updateProject(project.id, { schedule });
                      }}
                      testID="auto-schedule-from-estimate"
                    />
                  </View>
                )}
                {project.schedule && (
                  <TouchableOpacity
                    style={styles.crossLinkBtn}
                    onPress={() => navigateFromTile('/(tabs)/schedule' as any, 'replace')}
                    activeOpacity={0.7}
                    testID="estimate-view-schedule-link"
                  >
                    <CalendarDays size={16} color={Colors.info} />
                    <Text style={styles.crossLinkText}>View Schedule ({project.schedule.tasks.length} tasks · {project.schedule.totalDurationDays}d)</Text>
                    <ChevronRight size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {project.schedule && activeTile === 'schedule' && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggleSection('schedule')}
              activeOpacity={0.7}
              testID="project-schedule-section"
            >
              <CalendarDays size={20} color={Colors.info} />
              <Text style={styles.sectionTitle}>Schedule</Text>
              {expanded.schedule ? (
                <ChevronUp size={18} color={Colors.textMuted} />
              ) : (
                <ChevronDown size={18} color={Colors.textMuted} />
              )}
            </TouchableOpacity>

            {expanded.schedule && (
              <View style={styles.scheduleCard}>
                <View style={styles.scheduleTopRow}>
                  <View style={styles.scheduleMetric}>
                    <Text style={styles.scheduleMetricLabel}>Duration</Text>
                    <Text style={styles.scheduleMetricValue}>{project.schedule.totalDurationDays} days</Text>
                  </View>
                  <View style={styles.scheduleMetric}>
                    <Text style={styles.scheduleMetricLabel}>Critical path</Text>
                    <Text style={styles.scheduleMetricValue}>{project.schedule.criticalPathDays} days</Text>
                  </View>
                  <View style={styles.scheduleMetric}>
                    <Text style={styles.scheduleMetricLabel}>Alignment</Text>
                    <Text style={styles.scheduleMetricValue}>{project.schedule.laborAlignmentScore}/100</Text>
                  </View>
                </View>

                <Text style={styles.scheduleSectionTitle}>Tasks</Text>
                {project.schedule.tasks.map(task => (
                  <View key={task.id} style={styles.scheduleTaskRow}>
                    <View style={[styles.scheduleStatusDot, { backgroundColor: task.status === 'done' ? Colors.success : task.status === 'in_progress' ? Colors.info : Colors.warning }]} />
                    <View style={styles.scheduleTaskTextWrap}>
                      <Text style={styles.scheduleTaskName}>{task.title}</Text>
                      <Text style={styles.scheduleTaskMeta}>{task.phase} · Day {task.startDay} · {task.durationDays}d · {task.crew}</Text>
                    </View>
                    <Text style={styles.scheduleTaskProgress}>{task.progress}%</Text>
                  </View>
                ))}

                <TouchableOpacity
                  style={styles.crossLinkBtn}
                  onPress={() => navigateFromTile('/(tabs)/schedule' as any, 'replace')}
                  activeOpacity={0.7}
                  testID="schedule-open-full-link"
                >
                  <CalendarDays size={16} color={Colors.info} />
                  <Text style={styles.crossLinkText}>Open Full Schedule</Text>
                  <ChevronRight size={16} color={Colors.textMuted} />
                </TouchableOpacity>

                {hasAnyEstimate && (
                  <TouchableOpacity
                    style={styles.crossLinkBtn}
                    onPress={() => estimate ? openDetail('total') : undefined}
                    activeOpacity={estimate ? 0.7 : 1}
                    testID="schedule-view-estimate-link"
                  >
                    <Receipt size={16} color={Colors.primary} />
                    <Text style={styles.crossLinkText}>View Estimate ({formatMoney(heroTotal)})</Text>
                    <ChevronRight size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
                {!hasAnyEstimate && (
                  <TouchableOpacity
                    style={styles.crossLinkBtn}
                    onPress={() => navigateFromTile('/(tabs)/discover/estimate' as any, 'replace')}
                    activeOpacity={0.7}
                    testID="schedule-create-estimate-link"
                  >
                    <Receipt size={16} color={Colors.primary} />
                    <Text style={styles.crossLinkText}>Create Estimate for This Project</Text>
                    <ChevronRight size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {estimate && activeTile === 'linkedEstimate' && (
          <>
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => toggleSection('materials')}
                activeOpacity={0.7}
              >
                <Package size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>
                  Materials — ${estimate.materialTotal.toLocaleString()}
                </Text>
                {expanded.materials ? (
                  <ChevronUp size={18} color={Colors.textMuted} />
                ) : (
                  <ChevronDown size={18} color={Colors.textMuted} />
                )}
              </TouchableOpacity>

              {expanded.materials && (
                <View style={styles.tableContainer}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableHeaderText, { flex: 2 }]}>Item</Text>
                    <Text style={[styles.tableHeaderText, { flex: 1 }]}>Qty</Text>
                    <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' as const }]}>Unit $</Text>
                    <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' as const }]}>Total</Text>
                  </View>
                  {estimate.materials.map((item, idx) => (
                    <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
                      <View style={{ flex: 2 }}>
                        <Text style={styles.tableCellName} numberOfLines={1}>{item.name}</Text>
                        {item.savings > 0 && (
                          <View style={styles.savingsBadge}>
                            <TrendingDown size={10} color={Colors.success} />
                            <Text style={styles.savingsText}>Save ${item.savings.toFixed(0)}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.tableCell, { flex: 1 }]}>
                        {item.quantity} {item.unit}
                      </Text>
                      <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' as const }]}>
                        ${item.unitPrice.toFixed(2)}
                      </Text>
                      <Text style={[styles.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>
                        ${item.totalPrice.toLocaleString()}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => toggleSection('labor')}
                activeOpacity={0.7}
              >
                <Users size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>
                  Labor — ${estimate.laborTotal.toLocaleString()}
                </Text>
                {expanded.labor ? (
                  <ChevronUp size={18} color={Colors.textMuted} />
                ) : (
                  <ChevronDown size={18} color={Colors.textMuted} />
                )}
              </TouchableOpacity>

              {expanded.labor && (
                <View style={styles.tableContainer}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableHeaderText, { flex: 2 }]}>Role</Text>
                    <Text style={[styles.tableHeaderText, { flex: 1 }]}>Rate/hr</Text>
                    <Text style={[styles.tableHeaderText, { flex: 1 }]}>Hours</Text>
                    <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' as const }]}>Total</Text>
                  </View>
                  {estimate.labor.map((item, idx) => (
                    <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
                      <Text style={[styles.tableCellName, { flex: 2 }]} numberOfLines={1}>{item.role}</Text>
                      <Text style={[styles.tableCell, { flex: 1 }]}>${item.hourlyRate}</Text>
                      <Text style={[styles.tableCell, { flex: 1 }]}>{item.hours}h</Text>
                      <Text style={[styles.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>
                        ${item.totalCost.toLocaleString()}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => toggleSection('summary')}
                activeOpacity={0.7}
              >
                <DollarSign size={20} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Cost Summary</Text>
                {expanded.summary ? (
                  <ChevronUp size={18} color={Colors.textMuted} />
                ) : (
                  <ChevronDown size={18} color={Colors.textMuted} />
                )}
              </TouchableOpacity>

              {expanded.summary && (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Materials</Text>
                    <Text style={styles.summaryValue}>${estimate.materialTotal.toLocaleString()}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Labor</Text>
                    <Text style={styles.summaryValue}>${estimate.laborTotal.toLocaleString()}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Permits</Text>
                    <Text style={styles.summaryValue}>${estimate.permits.toLocaleString()}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Overhead</Text>
                    <Text style={styles.summaryValue}>${estimate.overhead.toLocaleString()}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal</Text>
                    <Text style={styles.summaryValue}>${estimate.subtotal.toLocaleString()}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Tax</Text>
                    <Text style={styles.summaryValue}>${estimate.tax.toLocaleString()}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Contingency</Text>
                    <Text style={styles.summaryValue}>${estimate.contingency.toLocaleString()}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <View style={styles.savingsHighlight}>
                      <TrendingDown size={14} color={Colors.success} />
                      <Text style={[styles.summaryLabel, { color: Colors.success }]}>Bulk Savings</Text>
                    </View>
                    <Text style={[styles.summaryValue, { color: Colors.success }]}>
                      -${estimate.bulkSavingsTotal.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.grandTotalDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.grandTotalLabel}>Grand Total</Text>
                    <Text style={styles.grandTotalValue}>${estimate.grandTotal.toLocaleString()}</Text>
                  </View>
                </View>
              )}
            </View>

            {estimate.notes.length > 0 && (
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => toggleSection('notes')}
                  activeOpacity={0.7}
                >
                  <Lightbulb size={20} color={Colors.accent} />
                  <Text style={styles.sectionTitle}>Tips & Notes</Text>
                  {expanded.notes ? (
                    <ChevronUp size={18} color={Colors.textMuted} />
                  ) : (
                    <ChevronDown size={18} color={Colors.textMuted} />
                  )}
                </TouchableOpacity>

                {expanded.notes && (
                  <View style={styles.notesContainer}>
                    {estimate.notes.map((note, idx) => (
                      <View key={idx} style={styles.noteRow}>
                        <View style={styles.noteBullet} />
                        <Text style={styles.noteText}>{note}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </>
        )}

        {activeTile === 'collaborators' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('collaborators')}
            activeOpacity={0.7}
            testID="collaborators-section"
          >
            <Users size={20} color={Colors.info} />
            <Text style={styles.sectionTitle}>
              Team ({collaborators.length + 1})
            </Text>
            {expanded.collaborators ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.collaborators && (
            <View style={styles.collabCard}>
              <View style={styles.collabMember}>
                <View style={[styles.collabAvatar, { backgroundColor: Colors.primary }]}>
                  <Crown size={14} color={Colors.textOnPrimary} />
                </View>
                <View style={styles.collabInfo}>
                  <Text style={styles.collabName}>You (Owner)</Text>
                  <Text style={styles.collabEmail}>{branding.email || 'Set email in settings'}</Text>
                </View>
                <View style={[styles.collabRoleBadge, { backgroundColor: Colors.primary + '15' }]}>
                  <Text style={[styles.collabRoleText, { color: Colors.primary }]}>Owner</Text>
                </View>
              </View>

              {collaborators.map(collab => (
                <View key={collab.id} style={styles.collabMember}>
                  <View style={[styles.collabAvatar, { backgroundColor: collab.role === 'editor' ? Colors.info : Colors.textMuted }]}>
                    {collab.role === 'editor' ? <PenTool size={12} color="#fff" /> : <Eye size={12} color="#fff" />}
                  </View>
                  <View style={styles.collabInfo}>
                    <Text style={styles.collabName}>{collab.name}</Text>
                    <Text style={styles.collabEmail}>{collab.email}</Text>
                  </View>
                  <View style={styles.collabActions}>
                    <View style={[styles.collabRoleBadge, {
                      backgroundColor: collab.status === 'pending' ? Colors.warningLight : (collab.role === 'editor' ? Colors.infoLight : Colors.fillTertiary),
                    }]}>
                      <Text style={[styles.collabRoleText, {
                        color: collab.status === 'pending' ? Colors.warning : (collab.role === 'editor' ? Colors.info : Colors.textSecondary),
                      }]}>
                        {collab.status === 'pending' ? 'Pending' : collab.role === 'editor' ? 'Editor' : 'Viewer'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.collabRemoveBtn}
                      onPress={() => handleRemoveCollaborator(collab.id, collab.name)}
                      activeOpacity={0.7}
                    >
                      <X size={14} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <TouchableOpacity
                style={styles.inviteBtn}
                onPress={() => setShowInviteModal(true)}
                activeOpacity={0.7}
                testID="invite-collab-btn"
              >
                <UserPlus size={16} color={Colors.primary} />
                <Text style={styles.inviteBtnText}>Invite Collaborator</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}

        {activeTile === 'changeOrders' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('changeOrders')}
            activeOpacity={0.7}
            testID="change-orders-section"
          >
            <Repeat size={20} color={Colors.accent} />
            <Text style={styles.sectionTitle}>
              Change Orders ({changeOrders.length})
            </Text>
            {expanded.changeOrders ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.changeOrders && (
            <View style={styles.coCard}>
              {changeOrders.length === 0 && (
                <Text style={styles.coEmptyText}>No change orders yet.</Text>
              )}
              {changeOrders.map(co => (
                <TouchableOpacity
                  key={co.id}
                  style={styles.coRow}
                  onPress={() => navigateFromTile({ pathname: '/change-order' as any, params: { projectId: id, coId: co.id } })}
                  activeOpacity={0.7}
                >
                  <View style={styles.coInfo}>
                    <Text style={styles.coNumber}>CO #{co.number}</Text>
                    <Text style={styles.coDesc} numberOfLines={1}>{co.description}</Text>
                  </View>
                  <View style={styles.coRight}>
                    <Text style={[styles.coAmount, { color: co.changeAmount >= 0 ? Colors.accent : Colors.success }]}>
                      {co.changeAmount >= 0 ? '+' : '-'}${Math.abs(co.changeAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                    <View style={[styles.coBadge, {
                      backgroundColor: co.status === 'approved' ? Colors.successLight : co.status === 'rejected' ? Colors.errorLight : co.status === 'submitted' ? Colors.infoLight : Colors.fillTertiary
                    }]}>
                      <Text style={[styles.coBadgeText, {
                        color: co.status === 'approved' ? Colors.success : co.status === 'rejected' ? Colors.error : co.status === 'submitted' ? Colors.info : Colors.textSecondary
                      }]}>
                        {co.status.charAt(0).toUpperCase() + co.status.slice(1)}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              {changeOrders.filter(co => co.status === 'submitted').map(co => (
                <View key={`approve-${co.id}`} style={styles.coApproveRow}>
                  <TouchableOpacity
                    style={styles.coApproveBtn}
                    onPress={() => {
                      const impactDays = co.scheduleImpactDays ?? 0;
                      const shouldApplyImpact = impactDays > 0 && !co.scheduleImpactApplied && !!project?.schedule;
                      updateChangeOrder(co.id, {
                        status: 'approved',
                        scheduleImpactApplied: shouldApplyImpact ? true : co.scheduleImpactApplied,
                      });
                      if (shouldApplyImpact && project?.schedule) {
                        const nextSchedule = {
                          ...project.schedule,
                          bufferDays: (project.schedule.bufferDays ?? 0) + impactDays,
                          totalDurationDays: (project.schedule.totalDurationDays ?? 0) + impactDays,
                          updatedAt: new Date().toISOString(),
                        };
                        updateProject(project.id, { schedule: nextSchedule });
                      }
                      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert(
                        'Approved',
                        shouldApplyImpact
                          ? `CO #${co.number} has been approved. Schedule extended by ${impactDays} day${impactDays === 1 ? '' : 's'}.`
                          : `CO #${co.number} has been approved.`
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.coApproveBtnText}>Approve CO #{co.number}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.coRejectBtn}
                    onPress={() => {
                      updateChangeOrder(co.id, { status: 'rejected' });
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.coRejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/change-order' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="add-change-order-btn"
              >
                <Plus size={16} color={Colors.accent} />
                <Text style={styles.coAddBtnText}>New Change Order</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}

        {activeTile === 'invoices' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('invoices')}
            activeOpacity={0.7}
            testID="invoices-section"
          >
            <Receipt size={20} color={Colors.success} />
            <Text style={styles.sectionTitle}>
              Invoices ({projectInvoices.length})
            </Text>
            {expanded.invoices ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.invoices && (
            <View style={styles.coCard}>
              {projectInvoices.length === 0 && (
                <Text style={styles.coEmptyText}>No invoices yet.</Text>
              )}
              {projectInvoices.map(inv => {
                const _balance = inv.totalDue - inv.amountPaid;
                const displayStatus = getEffectiveInvoiceStatus(inv);
                return (
                  <TouchableOpacity
                    key={inv.id}
                    style={styles.coRow}
                    onPress={() => navigateFromTile({ pathname: '/invoice' as any, params: { projectId: id, invoiceId: inv.id } })}
                    onLongPress={() => {
                      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setActiveTile(null);
                      const delay = Platform.OS === 'ios' ? 350 : 0;
                      setTimeout(() => {
                        setActionSheetRef({ kind: 'invoice', id: inv.id, projectId: id });
                      }, delay);
                    }}
                    delayLongPress={350}
                    activeOpacity={0.7}
                  >
                    <View style={styles.coInfo}>
                      <Text style={styles.coNumber}>
                        {inv.type === 'progress' ? 'Progress Bill' : 'Invoice'} #{inv.number}
                      </Text>
                      <Text style={styles.coDesc} numberOfLines={1}>
                        {inv.paymentTerms.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} · Due {new Date(inv.dueDate).toLocaleDateString()}
                      </Text>
                    </View>
                    <View style={styles.coRight}>
                      <Text style={styles.invAmount}>${inv.totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                      <View style={[styles.coBadge, {
                        backgroundColor: displayStatus === 'paid' ? Colors.successLight : displayStatus === 'overdue' ? Colors.errorLight : displayStatus === 'partially_paid' ? Colors.warningLight : displayStatus === 'sent' ? Colors.infoLight : Colors.fillTertiary
                      }]}>
                        <Text style={[styles.coBadgeText, {
                          color: displayStatus === 'paid' ? Colors.success : displayStatus === 'overdue' ? Colors.error : displayStatus === 'partially_paid' ? Colors.warning : displayStatus === 'sent' ? Colors.info : Colors.textSecondary
                        }]}>
                          {displayStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <View style={styles.invBtnRow}>
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/bill-from-estimate' as any, params: { projectId: id, type: 'full' } })}
                  activeOpacity={0.7}
                  testID="add-full-invoice-btn"
                >
                  <Receipt size={16} color={Colors.success} />
                  <Text style={[styles.coAddBtnText, { color: Colors.success }]}>Full Invoice</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/bill-from-estimate' as any, params: { projectId: id, type: 'progress' } })}
                  activeOpacity={0.7}
                  testID="add-progress-bill-btn"
                >
                  <ClipboardList size={16} color={Colors.info} />
                  <Text style={[styles.coAddBtnText, { color: Colors.info }]}>Progress Bill</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
        )}

        {activeTile === 'dailyReports' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('dailyReports')}
            activeOpacity={0.7}
            testID="daily-reports-section"
          >
            <ClipboardList size={20} color={Colors.primary} />
            <Text style={styles.sectionTitle}>
              Daily Reports ({dailyReports.length})
            </Text>
            {expanded.dailyReports ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.dailyReports && (
            <View style={styles.coCard}>
              {dailyReports.length === 0 && (
                <Text style={styles.coEmptyText}>No daily reports yet.</Text>
              )}
              {dailyReports.map(dr => (
                <TouchableOpacity
                  key={dr.id}
                  style={styles.coRow}
                  onPress={() => navigateFromTile({ pathname: '/daily-report' as any, params: { projectId: id, reportId: dr.id } })}
                  activeOpacity={0.7}
                >
                  <View style={styles.coInfo}>
                    <Text style={styles.coNumber}>{new Date(dr.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                    <Text style={styles.coDesc} numberOfLines={1}>
                      {dr.weather.conditions || 'No weather'} · {dr.manpower.reduce((s, m) => s + m.headcount, 0)} workers · {dr.photos.length} photos
                    </Text>
                  </View>
                  <View style={[styles.coBadge, {
                    backgroundColor: dr.status === 'sent' ? Colors.successLight : Colors.primary + '15'
                  }]}>
                    <Text style={[styles.coBadgeText, {
                      color: dr.status === 'sent' ? Colors.success : Colors.primary
                    }]}>
                      {dr.status === 'sent' ? 'Sent' : 'Saved'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/daily-report' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="add-daily-report-btn"
              >
                <Plus size={16} color={Colors.primary} />
                <Text style={styles.coAddBtnText}>New Daily Report</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}

        {activeTile === 'punchList' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('punchList')}
            activeOpacity={0.7}
            testID="punch-list-section"
          >
            <CheckSquare size={20} color={Colors.accent} />
            <Text style={styles.sectionTitle}>
              Punch List ({punchItems.length})
            </Text>
            {expanded.punchList ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.punchList && (
            <View style={styles.coCard}>
              {punchItems.length > 0 && (
                <View style={styles.punchProgress}>
                  <View style={styles.punchProgressHeader}>
                    <Text style={styles.punchProgressLabel}>Completion</Text>
                    <Text style={styles.punchProgressPercent}>
                      {punchItems.length > 0 ? Math.round((punchItems.filter(pi => pi.status === 'closed').length / punchItems.length) * 100) : 0}%
                    </Text>
                  </View>
                  <View style={styles.punchProgressTrack}>
                    <View style={[styles.punchProgressFill, { width: `${punchItems.length > 0 ? (punchItems.filter(pi => pi.status === 'closed').length / punchItems.length) * 100 : 0}%` }]} />
                  </View>
                </View>
              )}
              {punchItems.length === 0 && (
                <Text style={styles.coEmptyText}>No punch items yet.</Text>
              )}
              {punchItems.slice(0, 5).map(pi => (
                <View key={pi.id} style={styles.coRow}>
                  <View style={[styles.punchDot, { backgroundColor: pi.status === 'closed' ? Colors.success : pi.status === 'ready_for_review' ? Colors.warning : pi.status === 'in_progress' ? Colors.info : Colors.error }]} />
                  <View style={styles.coInfo}>
                    <Text style={styles.coNumber} numberOfLines={1}>{pi.description}</Text>
                    <Text style={styles.coDesc} numberOfLines={1}>{pi.location || 'No location'} · {pi.assignedSub || 'Unassigned'}</Text>
                  </View>
                  <View style={[styles.coBadge, {
                    backgroundColor: pi.status === 'closed' ? Colors.successLight : pi.status === 'ready_for_review' ? Colors.warningLight : pi.status === 'in_progress' ? Colors.infoLight : Colors.errorLight
                  }]}>
                    <Text style={[styles.coBadgeText, {
                      color: pi.status === 'closed' ? Colors.success : pi.status === 'ready_for_review' ? Colors.warning : pi.status === 'in_progress' ? Colors.info : Colors.error
                    }]}>
                      {pi.status === 'ready_for_review' ? 'Review' : pi.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Text>
                  </View>
                </View>
              ))}
              {punchItems.length > 5 && (
                <Text style={styles.punchMoreText}>+{punchItems.length - 5} more items</Text>
              )}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/punch-list' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="open-punch-list-btn"
              >
                <CheckSquare size={16} color={Colors.accent} />
                <Text style={[styles.coAddBtnText, { color: Colors.accent }]}>Manage Punch List</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.coAddBtn, { marginTop: 8 }]}
                onPress={() => navigateFromTile({ pathname: '/warranties' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="open-warranties-btn"
              >
                <CheckSquare size={16} color={Colors.primary} />
                <Text style={[styles.coAddBtnText, { color: Colors.primary }]}>Warranties</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.coAddBtn, { marginTop: 8 }]}
                onPress={() => navigateFromTile({ pathname: '/retention' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="open-retention-btn"
              >
                <CheckSquare size={16} color={Colors.warning} />
                <Text style={[styles.coAddBtnText, { color: Colors.warning }]}>Retention Tracker</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}

        {activeTile === 'rfis' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('rfis')}
            activeOpacity={0.7}
            testID="rfis-section"
          >
            <FileText size={20} color={Colors.info} />
            <Text style={styles.sectionTitle}>
              RFIs ({projectRFIs.length})
            </Text>
            {expanded.rfis ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.rfis && (
            <View style={styles.coCard}>
              {projectRFIs.length === 0 && (
                <Text style={styles.coEmptyText}>No RFIs yet.</Text>
              )}
              {projectRFIs.slice(0, 5).map(rfi => {
                const isOverdue = rfi.status === 'open' && new Date(rfi.dateRequired) < new Date();
                return (
                  <TouchableOpacity
                    key={rfi.id}
                    style={styles.coRow}
                    onPress={() =>
                      navigateTo(
                        { kind: 'rfi', id: rfi.id, projectId: id },
                        { fromSheet: true, onBeforeNavigate: () => setActiveTile(null) },
                      )
                    }
                    onLongPress={() => {
                      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      setActiveTile(null);
                      const delay = Platform.OS === 'ios' ? 350 : 0;
                      setTimeout(() => {
                        setActionSheetRef({ kind: 'rfi', id: rfi.id, projectId: id });
                      }, delay);
                    }}
                    delayLongPress={350}
                    activeOpacity={0.7}
                  >
                    <View style={styles.coInfo}>
                      <Text style={styles.coNumber}>RFI #{rfi.number}: {rfi.subject}</Text>
                      <Text style={styles.coDesc} numberOfLines={1}>{rfi.assignedTo || 'Unassigned'} · {rfi.priority}</Text>
                    </View>
                    <View style={styles.coRight}>
                      {isOverdue && <Text style={{ fontSize: 11, color: Colors.error, fontWeight: '600' as const }}>Overdue</Text>}
                      <View style={[styles.coBadge, {
                        backgroundColor: rfi.status === 'open' ? Colors.warningLight : rfi.status === 'answered' ? Colors.infoLight : rfi.status === 'closed' ? Colors.successLight : Colors.fillTertiary
                      }]}>
                        <Text style={[styles.coBadgeText, {
                          color: rfi.status === 'open' ? Colors.warning : rfi.status === 'answered' ? Colors.info : rfi.status === 'closed' ? Colors.success : Colors.textSecondary
                        }]}>
                          {rfi.status.charAt(0).toUpperCase() + rfi.status.slice(1)}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/rfi' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="add-rfi-btn"
                >
                  <Plus size={16} color={Colors.info} />
                  <Text style={[styles.coAddBtnText, { color: Colors.info }]}>New RFI</Text>
                </TouchableOpacity>
                {projectRFIs.length > 0 && (
                  <TouchableOpacity
                    style={[styles.coAddBtn, { flex: 1, backgroundColor: Colors.fillSecondary ?? Colors.fillTertiary }]}
                    onPress={handleExportRFILog}
                    activeOpacity={0.7}
                    testID="export-rfi-log-btn"
                  >
                    <Share2 size={15} color={Colors.text} />
                    <Text style={[styles.coAddBtnText, { color: Colors.text }]}>Export Log</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>
        )}

        {activeTile === 'submittals' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('submittals')}
            activeOpacity={0.7}
            testID="submittals-section"
          >
            <FileText size={20} color={'#5856D6'} />
            <Text style={styles.sectionTitle}>
              Submittals ({projectSubmittals.length})
            </Text>
            {expanded.submittals ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.submittals && (
            <View style={styles.coCard}>
              {projectSubmittals.length === 0 && (
                <Text style={styles.coEmptyText}>No submittals yet.</Text>
              )}
              {projectSubmittals.slice(0, 5).map(sub => (
                <TouchableOpacity
                  key={sub.id}
                  style={styles.coRow}
                  onPress={() => navigateFromTile({ pathname: '/submittal' as any, params: { projectId: id, submittalId: sub.id } })}
                  activeOpacity={0.7}
                >
                  <View style={styles.coInfo}>
                    <Text style={styles.coNumber}>#{sub.number}: {sub.title}</Text>
                    <Text style={styles.coDesc} numberOfLines={1}>{sub.specSection} · {sub.reviewCycles.length} cycles</Text>
                  </View>
                  <View style={[styles.coBadge, {
                    backgroundColor: sub.currentStatus === 'approved' ? Colors.successLight : sub.currentStatus === 'rejected' ? Colors.errorLight : sub.currentStatus === 'revise_resubmit' ? Colors.errorLight : Colors.warningLight
                  }]}>
                    <Text style={[styles.coBadgeText, {
                      color: sub.currentStatus === 'approved' ? Colors.success : sub.currentStatus === 'rejected' ? Colors.error : sub.currentStatus === 'revise_resubmit' ? Colors.error : Colors.warning
                    }]}>
                      {sub.currentStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/submittal' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="add-submittal-btn"
              >
                <Plus size={16} color={'#5856D6'} />
                <Text style={[styles.coAddBtnText, { color: '#5856D6' }]}>New Submittal</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}

        {hasAnyEstimate && activeTile === 'budget' && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggleSection('budget')}
              activeOpacity={0.7}
              testID="budget-section"
            >
              <DollarSign size={20} color={Colors.success} />
              <Text style={styles.sectionTitle}>Financial Health</Text>
              {expanded.budget ? (
                <ChevronUp size={18} color={Colors.textMuted} />
              ) : (
                <ChevronDown size={18} color={Colors.textMuted} />
              )}
            </TouchableOpacity>

            {expanded.budget && (
              <View style={styles.coCard}>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                  <View style={{ flex: 1, backgroundColor: Colors.successLight, borderRadius: 10, padding: 12, alignItems: 'center' as const }}>
                    <Text style={{ fontSize: 11, fontWeight: '600' as const, color: Colors.success }}>Budget</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800' as const, color: Colors.success }}>
                      ${(project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0).toLocaleString()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: Colors.infoLight, borderRadius: 10, padding: 12, alignItems: 'center' as const }}>
                    <Text style={{ fontSize: 11, fontWeight: '600' as const, color: Colors.info }}>Spent</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800' as const, color: Colors.info }}>
                      ${allInvoices.filter(inv => inv.projectId === id).reduce((s, inv) => s + inv.amountPaid, 0).toLocaleString()}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.coAddBtn}
                  onPress={() => navigateFromTile({ pathname: '/budget-dashboard' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-budget-dashboard"
                >
                  <DollarSign size={16} color={Colors.success} />
                  <Text style={[styles.coAddBtnText, { color: Colors.success }]}>Full Budget Dashboard</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/job-costing' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-job-costing"
                >
                  <BarChart3 size={16} color={Colors.primary} />
                  <Text style={[styles.coAddBtnText, { color: Colors.primary }]}>Job Cost-to-Complete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {activeTile === 'photos' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('photos')}
            activeOpacity={0.7}
            testID="photos-section"
          >
            <Camera size={20} color={Colors.info} />
            <Text style={styles.sectionTitle}>
              Photos ({projectPhotos.length})
            </Text>
            {expanded.photos ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.photos && (
            <View style={styles.coCard}>
              {projectPhotos.length === 0 && (
                <Text style={styles.coEmptyText}>No photos yet. Photos from daily reports will appear here.</Text>
              )}
              {projectPhotos.length > 0 && (
                <View style={styles.photoGrid}>
                  {projectPhotos.slice(0, 6).map(photo => (
                    <View key={photo.id} style={styles.photoThumb}>
                      <Camera size={20} color={Colors.textMuted} />
                      <Text style={styles.photoThumbDate}>{new Date(photo.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                    </View>
                  ))}
                </View>
              )}
              {projectPhotos.length > 6 && (
                <Text style={styles.punchMoreText}>+{projectPhotos.length - 6} more photos</Text>
              )}
            </View>
          )}
        </View>
        )}

        {activeTile === 'clientPortal' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('clientPortal')}
            activeOpacity={0.7}
            testID="client-portal-section"
          >
            <Globe size={20} color={'#5856D6'} />
            <Text style={styles.sectionTitle}>Client Portal</Text>
            {expanded.clientPortal ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.clientPortal && (
            <View style={styles.coCard}>
              <View style={styles.portalInfo}>
                <Globe size={24} color={'#5856D6'} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.portalTitle}>Share Project with Client</Text>
                  <Text style={styles.portalDesc}>Give clients a read-only link to view schedule, invoices, photos & more. Control exactly what they see.</Text>
                </View>
              </View>
              {project.clientPortal?.enabled ? (
                <>
                  <View style={styles.portalLinkRow}>
                    <View style={styles.portalLinkBox}>
                      <Link size={12} color={Colors.info} />
                      <Text style={styles.portalLinkText} numberOfLines={1}>mageid.app/portal/{project.clientPortal.portalId}</Text>
                    </View>
                    <TouchableOpacity style={styles.portalCopyBtn} onPress={() => { Alert.alert('Copied', 'Portal link copied to clipboard.'); }}>
                      <Copy size={14} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.portalInviteCount}>
                    <Users size={13} color={Colors.textMuted} />
                    <Text style={styles.portalInviteCountText}>
                      {project.clientPortal.invites?.length ?? 0} client{(project.clientPortal.invites?.length ?? 0) !== 1 ? 's' : ''} invited
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.portalEnableBtn}
                    onPress={() => navigateFromTile({ pathname: '/client-portal-setup', params: { id } })}
                    activeOpacity={0.7}
                  >
                    <Globe size={16} color={'#5856D6'} />
                    <Text style={styles.portalEnableBtnText}>Manage Portal Settings</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.portalEnableBtn}
                  onPress={() => {
                    updateProject(id ?? '', {
                      clientPortal: {
                        enabled: true,
                        portalId: `portal-${id?.slice(0, 8)}-${Date.now().toString(36)}`,
                        showSchedule: true,
                        showChangeOrders: true,
                        showInvoices: true,
                        showPhotos: true,
                        showBudgetSummary: false,
                        showDailyReports: false,
                        showPunchList: false,
                        showRFIs: false,
                        showDocuments: false,
                        invites: [],
                      },
                    });
                    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    navigateFromTile({ pathname: '/client-portal-setup', params: { id } });
                  }}
                  activeOpacity={0.7}
                >
                  <Globe size={16} color={'#5856D6'} />
                  <Text style={styles.portalEnableBtnText}>Enable Client Portal</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        )}

        {activeTile === 'communications' && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => toggleSection('communications')}
            activeOpacity={0.7}
            testID="communications-section"
          >
            <Mail size={20} color={Colors.info} />
            <Text style={styles.sectionTitle}>Communications</Text>
            <View style={styles.coBadge}>
              <Text style={styles.coBadgeText}>{commEvents.length}</Text>
            </View>
            {expanded.communications ? (
              <ChevronUp size={18} color={Colors.textMuted} />
            ) : (
              <ChevronDown size={18} color={Colors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.communications && (
            <View style={styles.coCard}>
              {commEvents.length === 0 ? (
                <View style={styles.commEmpty}>
                  <Mail size={24} color={Colors.textMuted} />
                  <Text style={styles.commEmptyText}>No activity yet. Sending documents, approvals, and notes will appear here.</Text>
                </View>
              ) : (
                commEvents.slice(0, 10).map(event => (
                  <View key={event.id} style={styles.commEventRow}>
                    <View style={[styles.commEventDot, {
                      backgroundColor: event.type.includes('approved') ? Colors.success
                        : event.type.includes('rejected') ? Colors.error
                        : event.type.includes('overdue') ? Colors.warning
                        : event.isPrivate ? Colors.textMuted
                        : Colors.info
                    }]} />
                    <View style={styles.commEventContent}>
                      <Text style={styles.commEventSummary} numberOfLines={2}>{event.summary}</Text>
                      <Text style={styles.commEventTime}>
                        {new Date(event.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        {event.isPrivate ? ' · Private' : ''}
                      </Text>
                    </View>
                  </View>
                ))
              )}
              <TouchableOpacity
                style={styles.commAddNoteBtn}
                onPress={() => {
                  if (Platform.OS === 'ios' && typeof (Alert as any).prompt === 'function') {
                    (Alert as any).prompt('Internal Note', 'Add a private note to this project', (text: string) => {
                      if (text?.trim()) {
                        addCommEvent({
                          id: generateUUID(),
                          projectId: id ?? '',
                          type: 'internal_note',
                          summary: text.trim(),
                          actor: settings.branding?.contactName || 'You',
                          isPrivate: true,
                          timestamp: new Date().toISOString(),
                        });
                      }
                    });
                  } else {
                    Alert.alert('Add Note', 'Use the note feature to log internal project notes.');
                  }
                }}
                activeOpacity={0.7}
              >
                <Plus size={14} color={Colors.info} />
                <Text style={styles.commAddNoteBtnText}>Add Internal Note</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}
            </ScrollView>
          </View>
        </Modal>

        {hasAnyEstimate && (
          <View style={styles.shareSection}>
            <Text style={styles.shareSectionTitle}>Share</Text>
            {branding.companyName ? (
              <Text style={styles.shareBrandingNote}>Branded as: {branding.companyName}</Text>
            ) : null}
            {branding.signatureData && branding.signatureData.length > 0 && (
              <View style={styles.signatureNote}>
                <PenTool size={12} color={Colors.primary} />
                <Text style={styles.signatureNoteText}>Signature will be included</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.shareBtnPrimary}
              onPress={() => setShowShareModal(true)}
              activeOpacity={0.7}
              testID="open-share-modal"
            >
              <Share2 size={18} color={Colors.textOnPrimary} />
              <Text style={styles.shareBtnPrimaryText}>Share Estimate</Text>
            </TouchableOpacity>
          </View>
        )}

        {!hasAnyEstimate && (
          <View style={styles.noEstimate}>
            <AlertTriangle size={32} color={Colors.warning} />
            <Text style={styles.noEstimateTitle}>No Estimate Yet</Text>
            <Text style={styles.noEstimateText}>
              Go to the Estimate tab to search materials and link an estimate to this project.
            </Text>
          </View>
        )}

        {project && (
          <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
            <AIProjectReport
              project={project}
              invoices={allInvoices}
              changeOrders={allChangeOrders}
              subscriptionTier={tier as any}
            />
          </View>
        )}

        <TouchableOpacity style={styles.editButton} onPress={openEditModal} activeOpacity={0.7} testID="edit-project-bottom-btn">
          <Pencil size={18} color={Colors.primary} />
          <Text style={styles.editButtonText}>Edit Project</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} activeOpacity={0.7}>
          <Trash2 size={18} color={Colors.error} />
          <Text style={styles.deleteButtonText}>Delete Project</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={detailModal !== null}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setDetailModal(null)}
      >
        <View style={[detailStyles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={detailStyles.modalHandle} />
          <View style={detailStyles.modalHeader}>
            <Text style={detailStyles.modalTitle}>
              {detailModal === 'total' ? 'Cost Breakdown' : 'Savings Detail'}
            </Text>
            <TouchableOpacity
              style={detailStyles.modalCloseBtn}
              onPress={() => setDetailModal(null)}
              activeOpacity={0.7}
              testID="close-detail-modal"
            >
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>
          {detailModal === 'total' && renderTotalDetailModal()}
          {detailModal === 'savings' && renderSavingsDetailModal()}
        </View>
      </Modal>

      <Modal
        visible={showShareModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShareModal(false)}
      >
        <Pressable style={styles.shareModalOverlay} onPress={() => setShowShareModal(false)}>
          <Pressable style={styles.shareModalCard} onPress={() => undefined}>
            <View style={styles.shareModalHeader}>
              <Text style={styles.shareModalTitle}>Share Estimate</Text>
              <TouchableOpacity onPress={() => setShowShareModal(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.shareModalDesc}>
              Choose how to share your estimate{project.schedule ? ' and schedule' : ''}. PDFs include your company branding{branding.signatureData?.length ? ', logo, and signature' : branding.logoUri ? ' and logo' : ''}.
            </Text>

            <TouchableOpacity style={styles.shareOption} onPress={handleSharePDF} activeOpacity={0.7} testID="share-pdf-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: Colors.primary + '12' }]}>
                <FileText size={20} color={Colors.primary} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Share as PDF</Text>
                <Text style={styles.shareOptionDesc}>Professional document with full branding</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shareOption} onPress={handleShareEmail} activeOpacity={0.7} testID="share-email-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: Colors.info + '12' }]}>
                <Mail size={20} color={Colors.info} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Send via Email</Text>
                <Text style={styles.shareOptionDesc}>Formatted text in your email client</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shareOption} onPress={handleShareText} activeOpacity={0.7} testID="share-text-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: Colors.success + '12' }]}>
                <MessageSquare size={20} color={Colors.success} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Send via Text</Text>
                <Text style={styles.shareOptionDesc}>Quick summary with cost breakdown</Text>
              </View>
            </TouchableOpacity>

            {project.schedule && (
              <TouchableOpacity style={styles.shareOption} onPress={handleShareSchedulePDF} activeOpacity={0.7} testID="share-schedule-option">
                <View style={[styles.shareOptionIcon, { backgroundColor: '#FF9500' + '12' }]}>
                  <CalendarDays size={20} color="#FF9500" />
                </View>
                <View style={styles.shareOptionInfo}>
                  <Text style={styles.shareOptionTitle}>Schedule PDF</Text>
                  <Text style={styles.shareOptionDesc}>Estimate + schedule with company logo</Text>
                </View>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.inviteModalOverlay}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.inviteModalCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.inviteModalHeader}>
                  <Text style={styles.inviteModalTitle}>Edit Project</Text>
                  <TouchableOpacity onPress={() => setShowEditModal(false)}>
                    <X size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.inviteFieldLabel}>Project Name</Text>
                <TextInput
                  style={styles.inviteInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Project name"
                  placeholderTextColor={Colors.textMuted}
                  testID="edit-name-input"
                />

                <Text style={styles.inviteFieldLabel}>Description</Text>
                <TextInput
                  style={[styles.inviteInput, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]}
                  value={editDescription}
                  onChangeText={setEditDescription}
                  placeholder="Brief description..."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  testID="edit-desc-input"
                />

                <Text style={styles.inviteFieldLabel}>Location</Text>
                <TextInput
                  style={styles.inviteInput}
                  value={editLocation}
                  onChangeText={setEditLocation}
                  placeholder="City, State"
                  placeholderTextColor={Colors.textMuted}
                  testID="edit-location-input"
                />

                <Text style={styles.inviteFieldLabel}>Square Footage</Text>
                <TextInput
                  style={styles.inviteInput}
                  value={editSquareFootage}
                  onChangeText={setEditSquareFootage}
                  placeholder="e.g. 2000"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  testID="edit-sqft-input"
                />

                <Text style={styles.inviteFieldLabel}>Project Type</Text>
                <View style={styles.editTypeGrid}>
                  {PROJECT_TYPES.map(pt => (
                    <TouchableOpacity
                      key={pt.id}
                      style={[styles.editTypeChip, editType === pt.id && styles.editTypeChipActive]}
                      onPress={() => setEditType(pt.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.editTypeChipLabel, editType === pt.id && styles.editTypeChipLabelActive]}>{pt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.inviteActionRow}>
                  <TouchableOpacity style={styles.inviteCancelBtn} onPress={() => setShowEditModal(false)} activeOpacity={0.8}>
                    <Text style={styles.inviteCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.inviteSendBtn} onPress={handleSaveEdit} activeOpacity={0.85} testID="save-edit-btn">
                    <Text style={styles.inviteSendBtnText}>Save Changes</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.inviteModalOverlay}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.inviteModalCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.inviteModalHeader}>
                <Text style={styles.inviteModalTitle}>Invite Collaborator</Text>
                <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.inviteDesc}>
                Invite someone to collaborate on "{project.name}". They'll receive an email invitation.
              </Text>

              <Text style={styles.inviteFieldLabel}>Email Address</Text>
              <TextInput
                style={styles.inviteInput}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="colleague@company.com"
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                testID="invite-email-input"
              />

              <Text style={styles.inviteFieldLabel}>Name (optional)</Text>
              <TextInput
                style={styles.inviteInput}
                value={inviteName}
                onChangeText={setInviteName}
                placeholder="John Smith"
                placeholderTextColor={Colors.textMuted}
                testID="invite-name-input"
              />

              <Text style={styles.inviteFieldLabel}>Role</Text>
              <View style={styles.inviteRoleRow}>
                <TouchableOpacity
                  style={[styles.inviteRoleBtn, inviteRole === 'editor' && styles.inviteRoleBtnActive]}
                  onPress={() => setInviteRole('editor')}
                  activeOpacity={0.7}
                >
                  <PenTool size={14} color={inviteRole === 'editor' ? Colors.textOnPrimary : Colors.text} />
                  <Text style={[styles.inviteRoleBtnText, inviteRole === 'editor' && styles.inviteRoleBtnTextActive]}>Editor</Text>
                  <Text style={[styles.inviteRoleDesc, inviteRole === 'editor' && { color: 'rgba(255,255,255,0.7)' }]}>Can edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inviteRoleBtn, inviteRole === 'viewer' && styles.inviteRoleBtnActive]}
                  onPress={() => setInviteRole('viewer')}
                  activeOpacity={0.7}
                >
                  <Eye size={14} color={inviteRole === 'viewer' ? Colors.textOnPrimary : Colors.text} />
                  <Text style={[styles.inviteRoleBtnText, inviteRole === 'viewer' && styles.inviteRoleBtnTextActive]}>Viewer</Text>
                  <Text style={[styles.inviteRoleDesc, inviteRole === 'viewer' && { color: 'rgba(255,255,255,0.7)' }]}>Read only</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.inviteActionRow}>
                <TouchableOpacity style={styles.inviteCancelBtn} onPress={() => setShowInviteModal(false)} activeOpacity={0.8}>
                  <Text style={styles.inviteCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.inviteSendBtn} onPress={handleInvite} activeOpacity={0.85} testID="send-invite-btn">
                  <Send size={16} color={Colors.textOnPrimary} />
                  <Text style={styles.inviteSendBtnText}>Send Invite</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <EntityActionSheet
        entityRef={actionSheetRef}
        onClose={() => setActionSheetRef(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 18, color: Colors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '600' as const },
  heroCard: { backgroundColor: Colors.primary, marginHorizontal: 20, marginTop: 16, borderRadius: 20, padding: 22, shadowColor: Colors.primaryDark, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
  heroHeader: { marginBottom: 16 },
  heroTitleBlock: {},
  heroName: { fontSize: 22, fontWeight: '800' as const, color: Colors.textOnPrimary, letterSpacing: -0.3 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  heroMetaText: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },
  heroDesc: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 6, lineHeight: 18 },
  heroStats: {},
  heroStatMain: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12 },
  heroTapHint: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: '500' as const, marginTop: 4, letterSpacing: 0.3 },
  heroStatLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '500' as const, marginBottom: 4 },
  heroStatValue: { fontSize: 32, fontWeight: '800' as const, color: Colors.textOnPrimary, letterSpacing: -1 },
  heroStatsRow: { flexDirection: 'row', gap: 8 },
  heroStatSmall: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 10, alignItems: 'center' },
  smallStatLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: '500' as const, marginBottom: 2 },
  smallStatValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.textOnPrimary },
  section: { marginHorizontal: 20, marginTop: 18 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  sectionTitle: { flex: 1, fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  tableContainer: { backgroundColor: Colors.card, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  tableHeaderText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  tableRowAlt: { backgroundColor: Colors.surfaceAlt },
  tableCellName: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  tableCellSub: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  tableCell: { fontSize: 13, color: Colors.textSecondary },
  tableCellBold: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  bulkBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  bulkBadgeText: { fontSize: 10, fontWeight: '600' as const, color: Colors.success },
  savingsBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  savingsText: { fontSize: 11, fontWeight: '600' as const, color: Colors.success },
  linkedSummaryRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 12, gap: 8, backgroundColor: Colors.primary + '06', borderTopWidth: 1, borderTopColor: Colors.primary + '15' },
  linkedSummaryItem: { flex: 1, alignItems: 'center', gap: 2 },
  linkedSummaryLabel: { fontSize: 11, fontWeight: '500' as const, color: Colors.textSecondary },
  linkedSummaryValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  summaryCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 18, marginTop: 8, borderWidth: 1, borderColor: Colors.cardBorder },
  scheduleCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: Colors.cardBorder },
  scheduleTopRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  scheduleMetric: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 12, padding: 12 },
  scheduleMetricLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  scheduleMetricValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  scheduleSectionTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, marginBottom: 10 },
  scheduleTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  scheduleStatusDot: { width: 8, height: 8, borderRadius: 4 },
  scheduleTaskTextWrap: { flex: 1 },
  scheduleTaskName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  scheduleTaskMeta: { fontSize: 12, color: Colors.textSecondary },
  scheduleTaskProgress: { fontSize: 13, fontWeight: '700' as const, color: Colors.info },
  crossLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, marginTop: 10, backgroundColor: Colors.surfaceAlt, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  crossLinkText: { flex: 1, fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  summaryLabel: { fontSize: 15, color: Colors.textSecondary },
  summaryValue: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  summaryDivider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 8 },
  savingsHighlight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grandTotalDivider: { height: 2, backgroundColor: Colors.primary, marginVertical: 10, borderRadius: 1 },
  grandTotalLabel: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  grandTotalValue: { fontSize: 22, fontWeight: '800' as const, color: Colors.primary },
  notesContainer: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: Colors.cardBorder, gap: 12 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent, marginTop: 7 },
  noteText: { flex: 1, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  noEstimate: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 40, marginTop: 20 },
  noEstimateTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginTop: 12 },
  noEstimateText: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center' as const, marginTop: 8, lineHeight: 22 },
  collabCard: { backgroundColor: Colors.card, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, gap: 10 },
  collabMember: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  collabAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  collabInfo: { flex: 1, gap: 2 },
  collabName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  collabEmail: { fontSize: 12, color: Colors.textSecondary },
  collabActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collabRoleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  collabRoleText: { fontSize: 11, fontWeight: '700' as const },
  collabRemoveBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '20', marginTop: 4 },
  inviteBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  shareSection: { marginHorizontal: 20, marginTop: 18, backgroundColor: Colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: Colors.cardBorder, gap: 12 },
  shareSectionTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  shareBrandingNote: { fontSize: 12, color: Colors.textMuted, marginTop: -6 },
  signatureNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4 },
  signatureNoteText: { fontSize: 12, color: Colors.primary, fontWeight: '500' as const },
  shareBtnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 3 },
  shareBtnPrimaryText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
  editButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '10', borderRadius: 12, paddingVertical: 16, gap: 8, marginHorizontal: 20, marginTop: 24, borderWidth: 1, borderColor: Colors.primary + '20' },
  editButtonText: { fontSize: 16, fontWeight: '600' as const, color: Colors.primary },
  editTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  editTypeChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: Colors.fillTertiary },
  editTypeChipActive: { backgroundColor: Colors.primary },
  editTypeChipLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  editTypeChipLabelActive: { color: Colors.textOnPrimary },
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.errorLight, borderRadius: 12, paddingVertical: 16, gap: 8, marginHorizontal: 20, marginTop: 14, borderWidth: 1, borderColor: Colors.error + '30' },
  deleteButtonText: { fontSize: 16, fontWeight: '600' as const, color: Colors.error },
  shareModalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  shareModalCard: { backgroundColor: Colors.surface, borderRadius: 24, padding: 22, gap: 14, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  shareModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shareModalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  shareModalDesc: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  shareOption: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.surfaceAlt, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder },
  shareOptionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  shareOptionInfo: { flex: 1, gap: 2 },
  shareOptionTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  shareOptionDesc: { fontSize: 12, color: Colors.textSecondary },
  inviteModalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  inviteModalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 10 },
  inviteModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  inviteModalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  inviteDesc: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  inviteFieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  inviteInput: { minHeight: 48, borderRadius: 14, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  inviteRoleRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  inviteRoleBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.fillTertiary },
  inviteRoleBtnActive: { backgroundColor: Colors.primary },
  inviteRoleBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  inviteRoleBtnTextActive: { color: Colors.textOnPrimary },
  inviteRoleDesc: { fontSize: 11, color: Colors.textSecondary },
  inviteActionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  inviteCancelBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  inviteCancelBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  inviteSendBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  inviteSendBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.textOnPrimary },
  coCard: { backgroundColor: Colors.card, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, gap: 4 },
  coEmptyText: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' as const, paddingVertical: 8 },
  coRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 10 },
  coInfo: { flex: 1, gap: 2 },
  coNumber: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  coDesc: { fontSize: 12, color: Colors.textSecondary },
  coRight: { alignItems: 'flex-end', gap: 4 },
  coAmount: { fontSize: 14, fontWeight: '700' as const },
  invAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  coBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  coBadgeText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  coApproveRow: { flexDirection: 'row', gap: 8, paddingTop: 8 },
  coApproveBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.successLight, alignItems: 'center', borderWidth: 1, borderColor: Colors.success + '30' },
  coApproveBtnText: { fontSize: 13, fontWeight: '700' as const, color: Colors.success },
  coRejectBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: Colors.errorLight, alignItems: 'center', borderWidth: 1, borderColor: Colors.error + '30' },
  coRejectBtnText: { fontSize: 13, fontWeight: '700' as const, color: Colors.error },
  coAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '20', marginTop: 8 },
  coAddBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  invBtnRow: { flexDirection: 'row', gap: 8 },
  punchProgress: { marginBottom: 8 },
  punchProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  punchProgressLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  punchProgressPercent: { fontSize: 14, fontWeight: '800' as const, color: Colors.primary },
  punchProgressTrack: { height: 6, backgroundColor: Colors.fillTertiary, borderRadius: 3, overflow: 'hidden' as const },
  punchProgressFill: { height: 6, backgroundColor: Colors.primary, borderRadius: 3 },
  punchDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  punchMoreText: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' as const, paddingVertical: 4 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoThumbDate: { fontSize: 9, color: Colors.textMuted, fontWeight: '600' as const },
  portalInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  portalTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 2 },
  portalDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  portalBadge: { alignSelf: 'flex-start' as const, backgroundColor: '#5856D6' + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 8 },
  portalBadgeText: { fontSize: 11, fontWeight: '700' as const, color: '#5856D6' },
  portalLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  portalLinkBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  portalLinkText: { flex: 1, fontSize: 13, color: Colors.info },
  portalCopyBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center' },
  portalEnableBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 10, backgroundColor: '#5856D6' + '12', borderWidth: 1, borderColor: '#5856D6' + '20' },
  portalEnableBtnText: { fontSize: 14, fontWeight: '600' as const, color: '#5856D6' },
  portalInviteCount: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, marginBottom: 10 },
  portalInviteCountText: { fontSize: 12, color: Colors.textMuted },
  commEmpty: { alignItems: 'center' as const, paddingVertical: 20, gap: 8 },
  commEmptyText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' as const, lineHeight: 18 },
  commEventRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  commEventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  commEventContent: { flex: 1, gap: 2 },
  commEventSummary: { fontSize: 13, fontWeight: '500' as const, color: Colors.text, lineHeight: 18 },
  commEventTime: { fontSize: 11, color: Colors.textMuted },
  commAddNoteBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.infoLight, marginTop: 8 },
  commAddNoteBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.info },
  quickActions: { flexDirection: 'row' as const, paddingHorizontal: 20, marginTop: 12, gap: 10, flexWrap: 'wrap' as const },
  quickActionBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.cardBorder, flexGrow: 1, flexShrink: 1, flexBasis: '47%' as const, minHeight: 56 },
  quickActionBtnFull: { flexBasis: '100%' as const },
  quickActionIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center' as const, justifyContent: 'center' as const },
  quickActionLabel: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, flexShrink: 1 },
  sectionGrid: { paddingHorizontal: 20, marginTop: 18, gap: 8 },
  sectionTile: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, backgroundColor: Colors.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.cardBorder, minHeight: 56 },
  sectionTileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const },
  sectionTileLabel: { flex: 1, fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  sectionTileBadge: { backgroundColor: Colors.fillTertiary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center' as const },
  sectionTileBadgeText: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary },
  sectionModalHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  sectionModalBack: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, paddingVertical: 6, paddingHorizontal: 4, minWidth: 72 },
  sectionModalBackText: { fontSize: 16, fontWeight: '500' as const, color: Colors.primary },
  sectionModalTitle: { flex: 1, textAlign: 'center' as const, fontSize: 17, fontWeight: '700' as const, color: Colors.text },
});

const detailStyles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, backgroundColor: Colors.background },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  heroSection: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, gap: 6 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  heroAmount: { fontSize: 38, fontWeight: '800' as const, color: Colors.text, letterSpacing: -1.5 },
  heroSubtitle: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' as const },
  heroChips: { flexDirection: 'row', gap: 10, marginTop: 14 },
  heroChip: { backgroundColor: Colors.fillTertiary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', gap: 2 },
  heroChipLabel: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  heroChipSub: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' as const },
  sectionLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 8, marginTop: 4 },
  barChartWrap: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  barRow: { gap: 6 },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: { flex: 1, fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  barPct: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: Colors.fillTertiary, overflow: 'hidden' as const },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  additionalCard: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  additionalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  additionalLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  additionalDot: { width: 8, height: 8, borderRadius: 4 },
  additionalLabel: { fontSize: 15, color: Colors.text, fontWeight: '500' as const },
  additionalRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  additionalValue: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  additionalPct: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, backgroundColor: Colors.fillTertiary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' as const },
  additionalDivider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 4 },
  fullBreakdownCard: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 18, gap: 8, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { fontSize: 14, color: Colors.textSecondary },
  breakdownValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  breakdownLabelBold: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  breakdownValueBold: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  breakdownDivider: { height: 1, backgroundColor: Colors.borderLight },
  breakdownDividerThick: { height: 2, backgroundColor: Colors.primary + '30', borderRadius: 1, marginVertical: 4 },
  grandLabel: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  grandValue: { fontSize: 22, fontWeight: '800' as const, color: Colors.primary },
  infoCard: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoStep: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  infoStepNum: { fontSize: 13, fontWeight: '700' as const },
  infoTextWrap: { flex: 1 },
  infoTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  infoDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginTop: 2 },
  topSaversCard: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: 16, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  saverRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  saverRank: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.successLight, alignItems: 'center', justifyContent: 'center' },
  saverRankText: { fontSize: 11, fontWeight: '700' as const, color: Colors.success },
  saverInfo: { flex: 1, gap: 2 },
  saverName: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  saverMeta: { fontSize: 12, color: Colors.textMuted },
  saverSavings: { alignItems: 'flex-end', gap: 1 },
  saverAmount: { fontSize: 15, fontWeight: '700' as const, color: Colors.success },
  saverPct: { fontSize: 11, fontWeight: '600' as const, color: Colors.success },
  saverDivider: { height: 1, backgroundColor: Colors.borderLight },
});
