import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Modal,
  TextInput, Pressable, KeyboardAvoidingView, Image, LayoutAnimation, UIManager, Switch,
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
  HardHat, FolderOpen, Hammer, ScrollText, BookOpen, Footprints, Zap, Sparkles,
  Clock,
} from 'lucide-react-native';
import { PROJECT_TYPES, type ProjectType, type ProjectCollaborator, type EntityRef, type ProjectPhoto, type PhotoMarkup } from '@/types';
import Svg, { Path as SvgPath, Circle as SvgCircle, Line as SvgLine, Polygon as SvgPolygon, Text as SvgTextEl } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import EntityActionSheet from '@/components/EntityActionSheet';
import UniversalMicButton from '@/components/UniversalMicButton';
import { generateUUID } from '@/utils/generateId';
import AIProjectReport from '@/components/AIProjectReport';
import AIAutoScheduleButton from '@/components/AIAutoScheduleButton';
import { generateAndSharePDF, buildEstimateTextForEmail, generateRFILogPDF } from '@/utils/pdfGenerator';
import {
  buildPhotoSharePayload,
  encodePhotoShareToken,
  PHOTO_SHARE_MAX,
} from '@/utils/photoShareToken';
import { generateAndShareCloseoutPacket } from '@/utils/closeoutPacketGenerator';
import { prefetchProjectPlans } from '@/utils/planPrefetch';
import HardHatTap from '@/components/animations/HardHatTap';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import BlueprintReveal from '@/components/animations/BlueprintReveal';
import { fireConfetti } from '@/components/animations/Confetti';
import ConcretePour from '@/components/animations/ConcretePour';
import { nailIt } from '@/components/animations/NailItToast';
import FilterChipRow, { type FilterChip } from '@/components/FilterChipRow';
import { exportProjectIcs } from '@/utils/icsGenerator';
import { formatMoney } from '@/utils/formatters';
import { getEffectiveInvoiceStatus } from '@/utils/projectFinancials';
import { fetchActiveContract } from '@/utils/contractEngine';
import { fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { fetchCloseoutBinder } from '@/utils/closeoutBinderEngine';
import { fetchLienWaiversForProject } from '@/utils/lienWaiverEngine';
import { STATUS_TONES } from '@/utils/statusPill';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { buildPortalSnapshot } from '@/utils/portalSnapshot';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Enable LayoutAnimation on Android (no-op on iOS — already enabled).
// Without this, the smooth collapse/expand animation only works on iOS.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Same constants as in app/client-portal-setup.tsx — kept in sync with that
// file so the snapshot rebuilt from project-detail matches the one rebuilt
// from the dedicated Client Portal screen.
const PROJECT_DETAIL_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://nteoqhcswappxxjlpvap.supabase.co';
const PROJECT_DETAIL_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';

type SectionKey = 'linkedEstimate' | 'materials' | 'labor' | 'summary' | 'schedule' | 'notes' | 'collaborators' | 'changeOrders' | 'invoices' | 'dailyReports' | 'punchList' | 'rfis' | 'submittals' | 'oacMeetings' | 'budget' | 'photos' | 'clientPortal' | 'communications' | 'activity' | 'calendar' | 'plans' | 'permits' | 'contract' | 'selections' | 'lienWaivers' | 'closeoutBinder' | 'handover' | 'timeTracking' | 'projectFiles';

/** Tile group keys for the collapsible section grouping. */
type TileGroupKey = 'field' | 'money' | 'docs' | 'people';
type DetailModalType = 'total' | 'savings' | null;
type EditModalType = boolean;

function createId(_prefix: string): string {
  return generateUUID();
}

// Inline portal-permission toggle list — shown directly under "Share Project
// with Client" so the GC doesn't have to dig into a sub-screen for the
// common cases. Mirrors the PERMISSION_TOGGLES list on client-portal-setup;
// the dedicated screen still exists for passcode / language / welcome msg.
const PORTAL_INLINE_TOGGLES: { key: 'showSchedule' | 'showBudgetSummary' | 'showInvoices' | 'showChangeOrders' | 'showPhotos' | 'showDailyReports' | 'showPunchList' | 'showRFIs' | 'showDocuments'; label: string }[] = [
  { key: 'showSchedule',      label: 'Project schedule' },
  { key: 'showInvoices',      label: 'Invoices' },
  { key: 'showChangeOrders',  label: 'Change orders' },
  { key: 'showPhotos',        label: 'Site photos' },
  { key: 'showBudgetSummary', label: 'Budget summary' },
  { key: 'showDailyReports',  label: 'Daily reports' },
  { key: 'showPunchList',     label: 'Punch list' },
  { key: 'showRFIs',          label: 'RFIs' },
  { key: 'showDocuments',     label: 'Documents' },
];

// ─── Lifecycle stages (Pre-Con / Construction / Post-Con / Closeout) ──
// The 4-stage construction lifecycle, mapped onto the 5 underlying
// Project.status values. Tapping a chip advances the project to that
// stage (with a confirm). Read on every render — no extra state.
type LifecycleStage = 'precon' | 'construction' | 'postcon' | 'closeout';

const LIFECYCLE_STAGES: { key: LifecycleStage; label: string; short: string }[] = [
  { key: 'precon',       label: 'Pre-Con',      short: 'Pre' },
  { key: 'construction', label: 'Construction', short: 'Con' },
  { key: 'postcon',      label: 'Post-Con',     short: 'Post' },
  { key: 'closeout',     label: 'Closeout',     short: 'Done' },
];

// Stage → underlying status. We pick the most "settled" status in each
// stage so manual advancement lands on a non-ambiguous bucket.
const STAGE_TO_STATUS: Record<LifecycleStage, 'estimated' | 'in_progress' | 'completed' | 'closed'> = {
  precon: 'estimated',
  construction: 'in_progress',
  postcon: 'completed',
  closeout: 'closed',
};

function statusToStage(s: string | undefined): LifecycleStage {
  switch (s) {
    case 'in_progress': return 'construction';
    case 'completed':   return 'postcon';
    case 'closed':      return 'closeout';
    case 'draft':
    case 'estimated':
    default:            return 'precon';
  }
}

export default function ProjectDetailScreen() {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const detailStyles = useThemedStyles(makeDetailStyles);
  const { navigateTo } = useEntityNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ctx = useProjects() as any;
  const { getProject, deleteProject, updateProject, settings, addCollaborator, removeCollaborator, getChangeOrdersForProject, getInvoicesForProject, getDailyReportsForProject, updateChangeOrder, getPunchItemsForProject, getPhotosForProject, getCommEventsForProject, addCommEvent, getRFIsForProject, getSubmittalsForProject, getWarrantiesForProject, getPlanSheetsForProject, getPermitsForProject, invoices: allInvoices, changeOrders: allChangeOrders } = useProjects();
  const getOACMeetingsForProject = ctx.getOACMeetingsForProject;
  const { tier } = useSubscription();

  const changeOrders = useMemo(() => getChangeOrdersForProject(id ?? ''), [id, getChangeOrdersForProject]);
  const projectInvoices = useMemo(() => getInvoicesForProject(id ?? ''), [id, getInvoicesForProject]);
  const dailyReports = useMemo(() => getDailyReportsForProject(id ?? ''), [id, getDailyReportsForProject]);
  const punchItems = useMemo(() => getPunchItemsForProject(id ?? ''), [id, getPunchItemsForProject]);
  const projectPhotos = useMemo(() => getPhotosForProject(id ?? ''), [id, getPhotosForProject]);
  const commEvents = useMemo(() => getCommEventsForProject(id ?? ''), [id, getCommEventsForProject]);
  const projectRFIs = useMemo(() => getRFIsForProject(id ?? ''), [id, getRFIsForProject]);
  const projectSubmittals = useMemo(() => getSubmittalsForProject(id ?? ''), [id, getSubmittalsForProject]);
  const projectOACMeetings = useMemo(() => (getOACMeetingsForProject?.(id ?? '') ?? []), [id, getOACMeetingsForProject]);
  const projectWarranties = useMemo(() => getWarrantiesForProject(id ?? ''), [id, getWarrantiesForProject]);
  const projectPlans = useMemo(() => getPlanSheetsForProject(id ?? ''), [id, getPlanSheetsForProject]);
  const projectPermits = useMemo(() => getPermitsForProject(id ?? ''), [id, getPermitsForProject]);

  // Pre-cache plan PNGs the moment a project opens. The marketing site
  // promises plans work offline; for that to be true, the bytes have to
  // already be on disk before the user walks out of wifi range. Fire-and-
  // forget \u2014 no spinner, no blocking.
  useEffect(() => {
    if (Array.isArray(projectPlans) && projectPlans.length > 0) prefetchProjectPlans(projectPlans);
    // We only care about the URI list \u2014 re-prefetching when sheet metadata
    // changes (e.g. a sheet number rename) is wasted bandwidth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, Array.isArray(projectPlans) ? projectPlans.map((p) => p.imageUri).join('|') : '']);

  // Load status badges for the Money-group tiles so the GC sees what's
  // blocking handover at a glance: contract awaiting signature,
  // selections in progress, binder ready to deliver, etc. These are
  // async fetches against Supabase \u2014 we tolerate failure (just no
  // badge). Refetches when the route remounts (id changes).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const [contract, sels, binder, waivers] = await Promise.all([
          fetchActiveContract(id),
          fetchSelectionsForProject(id),
          fetchCloseoutBinder(id),
          fetchLienWaiversForProject(id),
        ]);
        if (cancelled) return;
        const next: typeof tileBadges = {};
        // Contract \u2014 most useful when it's hanging in 'sent' awaiting
        // signature, or already 'signed'.
        if (contract) {
          if (contract.status === 'signed') next.contract = { label: 'Signed', tone: 'success' };
          else if (contract.status === 'sent') next.contract = { label: 'Awaiting signature', tone: 'pending' };
          else if (contract.status === 'void') next.contract = { label: 'Void', tone: 'danger' };
          else next.contract = { label: 'Draft', tone: 'neutral' };
        } else {
          next.contract = { label: 'Not drafted', tone: 'neutral' };
        }
        // Selections \u2014 "X of Y picked" or "no allowances yet".
        if (sels.length > 0) {
          const chosen = sels.filter(s => (s.options ?? []).some(o => o.isChosen)).length;
          next.selections = chosen === sels.length
            ? { label: `All ${sels.length} picked`, tone: 'success' }
            : { label: `${chosen} of ${sels.length} picked`, tone: 'pending' };
        }
        // Closeout binder
        if (binder) {
          if (binder.status === 'sent') next.closeoutBinder = { label: 'Delivered', tone: 'success' };
          else if (binder.status === 'finalized') next.closeoutBinder = { label: 'Ready to deliver', tone: 'pending' };
          else next.closeoutBinder = { label: 'Draft', tone: 'neutral' };
        }
        // Lien waivers
        if (waivers.length > 0) {
          const open = waivers.filter(w => w.status === 'requested').length;
          next.lienWaivers = open === 0
            ? { label: `${waivers.length} on file`, tone: 'success' }
            : { label: `${open} pending`, tone: 'pending' };
        }
        setTileBadges(next);
      } catch (err) {
        console.warn('[project-detail] tile badge load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const project = useMemo(() => getProject(id ?? ''), [id, getProject]);

  // ── Portal snapshot background sync ──────────────────────────────────
  // Pushes the homeowner-portal snapshot to Supabase any time a project
  // with the portal enabled is viewed. Without this, the cache only
  // refreshes when the GC opens the dedicated Client Portal setup screen
  // — which they may rarely revisit once setup is complete, leaving
  // shared links pointing at a missing snapshot ("link expired").
  //
  // The snapshot built here is "lite" — it omits sections that aren't in
  // scope on this screen (AIA pay apps, commitments, message thread).
  // The full rich snapshot still gets written from client-portal-setup
  // when the GC visits that screen. Either way, the homeowner sees a
  // working portal — the lite version covers ~90% of the data.
  //
  // Debounced 2s so rapid edits / re-renders don't hammer the table.
  useEffect(() => {
    if (!project) return;
    const portal = project.clientPortal;
    if (!portal?.enabled || !portal.portalId) return;
    if (!isSupabaseConfigured) return;

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const [contract, selections, closeoutBinder] = await Promise.all([
          fetchActiveContract(project.id).catch(() => undefined),
          fetchSelectionsForProject(project.id).catch(() => undefined),
          fetchCloseoutBinder(project.id).catch(() => undefined),
        ]);
        if (cancelled) return;

        const snap = buildPortalSnapshot({
          project,
          portal,
          settings,
          invoices: projectInvoices,
          changeOrders,
          dailyReports,
          punchItems,
          photos: projectPhotos,
          rfis: projectRFIs,
          warranties: projectWarranties,
          // Optional rich data — fetched async, omitted on failure.
          contract: contract ?? undefined,
          selections: selections ?? undefined,
          closeoutBinder: closeoutBinder ?? undefined,
          // Not in scope on project-detail. Filled by client-portal-setup.
          aiaPayApps: [],
          commitments: [],
          messages: [],
          supabaseUrl: PROJECT_DETAIL_SUPABASE_URL,
          supabaseAnonKey: PROJECT_DETAIL_SUPABASE_ANON_KEY,
          contactEmail: settings?.branding?.email,
          contactName: settings?.branding?.contactName ?? settings?.branding?.companyName,
        });

        const { error } = await supabase
          .from('portal_snapshots')
          .upsert({
            portal_id: portal.portalId,
            project_id: project.id,
            snapshot: snap as unknown as Record<string, unknown>,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'portal_id' });
        if (error) console.warn('[portal-snapshot] background sync failed:', error.message);
        else console.log('[portal-snapshot] synced for portalId', portal.portalId);
      } catch (err) {
        console.warn('[portal-snapshot] background sync threw:', err);
      }
    }, 2000);

    return () => { cancelled = true; clearTimeout(t); };
  }, [
    project, settings, projectInvoices, changeOrders, dailyReports,
    punchItems, projectPhotos, projectRFIs, projectWarranties,
  ]);


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
    oacMeetings: false,
    budget: true,
    photos: true,
    clientPortal: false,
    communications: true,
    activity: false,
    calendar: false,
    plans: false,
    permits: false,
    contract: false,
    selections: false,
    lienWaivers: false,
    closeoutBinder: false,
    handover: false,
    timeTracking: false,
    projectFiles: false,
  });
  const [detailModal, setDetailModal] = useState<DetailModalType>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [showEditModal, setShowEditModal] = useState<EditModalType>(false);
  const [activeTile, setActiveTile] = useState<SectionKey | null>(null);
  // Tile group collapse state — Field & Money expanded by default, Docs & People collapsed.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TileGroupKey>>(new Set(['docs', 'people']));
  // Async status badges for the Money-group tiles. Loaded once when the
  // project is opened. Each badge is { label, tone } where tone maps to
  // the status-pill colors. Drives the small text under each tile so
  // the GC sees what's blocking handover at a glance.
  const [tileBadges, setTileBadges] = useState<Partial<Record<SectionKey, { label: string; tone: 'pending' | 'success' | 'danger' | 'info' | 'neutral' }>>>({});
  // Photos filter — 'all' or a normalized tag. The chip row defaults to 'all'
  // and we derive the chip set from photos at render-time so new tags appear
  // automatically without code changes.
  const [photoFilter, setPhotoFilter] = useState<string>('all');
  // Photo lightbox — shows the full-size image when a thumb is tapped.
  const [lightboxPhoto, setLightboxPhoto] = useState<ProjectPhoto | null>(null);
  // RFI status filter — defaults to 'open' so the user lands on the work
  // that needs their attention, not a wall of closed RFIs.
  const [rfiFilter, setRfiFilter] = useState<'open' | 'answered' | 'closed' | 'all'>('open');
  // Invoice status filter — defaults to 'unpaid' (anything not fully paid)
  // because that's the AR pile every contractor cares about.
  const [invoiceFilter, setInvoiceFilter] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  // Change order status filter — defaults to 'pending' (submitted, awaiting approval).
  const [coFilter, setCoFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const toggleGroup = useCallback((key: TileGroupKey) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Animate the collapse/expand. Using scaleXY (not opacity) so the
    // body view's HEIGHT actually shrinks during collapse — fixes the
    // "huge gap that only disappears after clicking another collapsible"
    // bug, which was caused by opacity-only animation leaving the
    // collapsed body's phantom layout space behind for one frame.
    if (Platform.OS !== 'web') {
      LayoutAnimation.configureNext({
        duration: 220,
        create: { type: 'easeInEaseOut', property: 'scaleXY' },
        update: { type: 'easeInEaseOut' },
        delete: { type: 'easeInEaseOut', property: 'scaleXY' },
      });
    }
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
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

  const currentStage: LifecycleStage = useMemo(
    () => statusToStage(project?.status),
    [project?.status],
  );

  const handleStageTap = useCallback((stage: LifecycleStage) => {
    if (!project || !id) return;
    if (stage === currentStage) return;
    const label = LIFECYCLE_STAGES.find(s => s.key === stage)?.label ?? stage;
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    Alert.alert(
      'Move project stage?',
      `Mark "${project.name}" as ${label}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          onPress: () => {
            updateProject(id, { status: STAGE_TO_STATUS[stage] });
            if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          },
        },
      ],
    );
  }, [project, id, currentStage, updateProject]);

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
      body += `Materials: ${formatMoney(legacy.materialTotal)}\n`;
      body += `Labor: ${formatMoney(legacy.laborTotal)}\n`;
      body += `Grand Total: ${formatMoney(legacy.grandTotal)}\n`;
    }
    if (project.schedule) {
      const taskCount = Array.isArray(project.schedule.tasks) ? project.schedule.tasks.length : 0;
      body += `\nSchedule: ${project.schedule.totalDurationDays ?? 0} days, ${taskCount} tasks\n`;
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
      nailIt(`RFI log exported · ${projectRFIs.length} ${projectRFIs.length === 1 ? 'RFI' : 'RFIs'}`);
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
          // The hammer-strike toast both haptic-pulses and announces success
          // without an Alert that blocks the share sheet.
          nailIt('Closeout packet built and shared.');
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

  const handleSharePhotoTimeline = useCallback(async () => {
    if (!project) return;
    if (projectPhotos.length === 0) {
      Alert.alert('Photo timeline', 'No photos to share yet. Take some jobsite photos first.');
      return;
    }
    const { payload, droppedLocal, droppedExcess } = buildPhotoSharePayload(
      project.name ?? 'Project',
      projectPhotos,
      { gcName: settings?.branding?.companyName },
    );
    if (payload.photos.length === 0) {
      Alert.alert(
        'Photo timeline',
        droppedLocal > 0
          ? 'These photos haven’t synced yet. Wait until the offline-sync pill shows "Synced," then try again.'
          : 'No shareable photos found.',
      );
      return;
    }
    const token = encodePhotoShareToken(payload);
    const base = Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://mageid.app';
    const url = `${base}/shared-photos?t=${token}`;
    const ok = await (await import('@/utils/clipboard')).copyToClipboard(url);
    const extras: string[] = [];
    if (droppedLocal > 0) extras.push(`${droppedLocal} photo${droppedLocal === 1 ? '' : 's'} skipped (not yet synced)`);
    if (droppedExcess > 0) extras.push(`oldest ${droppedExcess} trimmed (cap ${PHOTO_SHARE_MAX})`);
    const detail = extras.length > 0 ? `\n\n${extras.join(' · ')}` : '';
    if (ok) {
      Alert.alert('Photo timeline copied', `Link copied to clipboard. Paste it into a text, email, or client portal.${detail}`);
    } else {
      Alert.alert('Photo timeline link', `${url}${detail}`);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, projectPhotos, settings?.branding?.companyName]);

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
    // Defensive: a persisted estimate from an older schema may be missing
    // .materials. Treat missing/non-array as empty so the savings panel
    // renders zeros instead of crashing on .filter/.length.
    const materials = Array.isArray(estimate.materials) ? estimate.materials : [];
    const itemsWithSavings = materials.filter(m => (m.savings ?? 0) > 0);
    const topSavers = [...itemsWithSavings].sort((a, b) => (b.savings ?? 0) - (a.savings ?? 0)).slice(0, 8);
    const totalBulkSavings = estimate.bulkSavingsTotal ?? 0;
    const savingsRate = (estimate.grandTotal ?? 0) > 0 ? (totalBulkSavings / ((estimate.grandTotal ?? 0) + totalBulkSavings)) * 100 : 0;
    const itemsAtBulk = itemsWithSavings.length;
    const totalItems = materials.length;
    return { topSavers, totalBulkSavings, savingsRate, itemsAtBulk, totalItems };
  }, [estimate]);

  const openDetail = useCallback((type: 'total' | 'savings') => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetailModal(type);
  }, []);

  const renderTotalDetailModal = useCallback(() => {
    if (!estimate || !totalBreakdown) return null;
    const rows = [
      { label: 'Materials', value: estimate.materialTotal, pct: totalBreakdown.materialPct, color: themeColors.success, icon: Package },
      { label: 'Labor', value: estimate.laborTotal, pct: totalBreakdown.laborPct, color: themeColors.info, icon: Users },
      { label: 'Permits & Fees', value: estimate.permits, pct: totalBreakdown.permitPct, color: themeColors.accent, icon: Shield },
      { label: 'Overhead', value: estimate.overhead, pct: totalBreakdown.overheadPct, color: '#AF52DE', icon: Layers },
    ];
    const maxPct = Math.max(...rows.map(r => r.pct));

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <View style={detailStyles.heroSection}>
          <View style={detailStyles.heroIconWrap}>
            <BarChart3 size={28} color={themeColors.accent} />
          </View>
          <Text style={detailStyles.heroAmount}>{formatMoney(estimate.grandTotal)}</Text>
          <Text style={detailStyles.heroSubtitle}>Total Project Value</Text>
          <View style={detailStyles.heroChips}>
            <View style={detailStyles.heroChip}>
              <Text style={detailStyles.heroChipLabel}>${(estimate.pricePerSqFt ?? 0).toFixed(2)}</Text>
              <Text style={detailStyles.heroChipSub}>per sq ft</Text>
            </View>
            <View style={[detailStyles.heroChip, { backgroundColor: themeColors.successSoft }]}>
              <Text style={[detailStyles.heroChipLabel, { color: themeColors.success }]}>-{formatMoney(estimate.bulkSavingsTotal)}</Text>
              <Text style={[detailStyles.heroChipSub, { color: themeColors.success }]}>savings applied</Text>
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
              <Text style={detailStyles.barValue}>{formatMoney(row.value)}</Text>
            </View>
          ))}
        </View>

        <Text style={detailStyles.sectionLabel}>Additional Costs</Text>
        <View style={detailStyles.additionalCard}>
          <View style={detailStyles.additionalRow}>
            <View style={detailStyles.additionalLeft}>
              <View style={[detailStyles.additionalDot, { backgroundColor: themeColors.accent }]} />
              <Text style={detailStyles.additionalLabel}>Tax</Text>
            </View>
            <View style={detailStyles.additionalRight}>
              <Text style={detailStyles.additionalValue}>{formatMoney(estimate.tax)}</Text>
              <Text style={detailStyles.additionalPct}>{totalBreakdown.taxRate.toFixed(1)}%</Text>
            </View>
          </View>
          <View style={detailStyles.additionalDivider} />
          <View style={detailStyles.additionalRow}>
            <View style={detailStyles.additionalLeft}>
              <View style={[detailStyles.additionalDot, { backgroundColor: themeColors.danger }]} />
              <Text style={detailStyles.additionalLabel}>Contingency</Text>
            </View>
            <View style={detailStyles.additionalRight}>
              <Text style={detailStyles.additionalValue}>{formatMoney(estimate.contingency)}</Text>
              <Text style={detailStyles.additionalPct}>{totalBreakdown.contingencyRate.toFixed(1)}%</Text>
            </View>
          </View>
          <View style={detailStyles.additionalDivider} />
          <View style={detailStyles.additionalRow}>
            <View style={detailStyles.additionalLeft}>
              <View style={[detailStyles.additionalDot, { backgroundColor: themeColors.success }]} />
              <Text style={[detailStyles.additionalLabel, { color: themeColors.success }]}>Bulk Savings</Text>
            </View>
            <View style={detailStyles.additionalRight}>
              <Text style={[detailStyles.additionalValue, { color: themeColors.success }]}>-{formatMoney(estimate.bulkSavingsTotal)}</Text>
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
                <Text style={detailStyles.breakdownValue}>{formatMoney(item.value)}</Text>
              </View>
              {idx < 3 && <View style={detailStyles.breakdownDivider} />}
            </View>
          ))}
          <View style={detailStyles.breakdownDividerThick} />
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.breakdownLabelBold}>Subtotal</Text>
            <Text style={detailStyles.breakdownValueBold}>{formatMoney(estimate.subtotal)}</Text>
          </View>
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.breakdownLabel}>+ Tax</Text>
            <Text style={detailStyles.breakdownValue}>{formatMoney(estimate.tax)}</Text>
          </View>
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.breakdownLabel}>+ Contingency</Text>
            <Text style={detailStyles.breakdownValue}>{formatMoney(estimate.contingency)}</Text>
          </View>
          <View style={detailStyles.breakdownRow}>
            <Text style={[detailStyles.breakdownLabel, { color: themeColors.success }]}>- Bulk Savings</Text>
            <Text style={[detailStyles.breakdownValue, { color: themeColors.success }]}>-{formatMoney(estimate.bulkSavingsTotal)}</Text>
          </View>
          <View style={detailStyles.breakdownDividerThick} />
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.grandLabel}>Grand Total</Text>
            <Text style={detailStyles.grandValue}>{formatMoney(estimate.grandTotal)}</Text>
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
          <View style={[detailStyles.heroIconWrap, { backgroundColor: themeColors.successSoft }]}>
            <TrendingDown size={28} color={themeColors.success} />
          </View>
          <Text style={[detailStyles.heroAmount, { color: themeColors.success }]}>{formatMoney(savingsBreakdown.totalBulkSavings)}</Text>
          <Text style={detailStyles.heroSubtitle}>Total Bulk Savings</Text>
          <View style={detailStyles.heroChips}>
            <View style={[detailStyles.heroChip, { backgroundColor: themeColors.successSoft }]}>
              <Text style={[detailStyles.heroChipLabel, { color: themeColors.success }]}>{(savingsBreakdown.savingsRate ?? 0).toFixed(1)}%</Text>
              <Text style={[detailStyles.heroChipSub, { color: themeColors.success }]}>savings rate</Text>
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
            <View style={[detailStyles.infoStep, { backgroundColor: themeColors.accent + '15' }]}>
              <Text style={[detailStyles.infoStepNum, { color: themeColors.accent }]}>1</Text>
            </View>
            <View style={detailStyles.infoTextWrap}>
              <Text style={detailStyles.infoTitle}>Volume Thresholds</Text>
              <Text style={detailStyles.infoDesc}>Each material has a minimum bulk quantity. Once met, a lower per-unit price is unlocked.</Text>
            </View>
          </View>
          <View style={detailStyles.infoRow}>
            <View style={[detailStyles.infoStep, { backgroundColor: themeColors.success + '15' }]}>
              <Text style={[detailStyles.infoStepNum, { color: themeColors.success }]}>2</Text>
            </View>
            <View style={detailStyles.infoTextWrap}>
              <Text style={detailStyles.infoTitle}>Automatic Application</Text>
              <Text style={detailStyles.infoDesc}>When your estimate quantities exceed bulk thresholds, savings are calculated automatically.</Text>
            </View>
          </View>
          <View style={detailStyles.infoRow}>
            <View style={[detailStyles.infoStep, { backgroundColor: themeColors.accent + '15' }]}>
              <Text style={[detailStyles.infoStepNum, { color: themeColors.accent }]}>3</Text>
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
            <View style={[detailStyles.infoCard, { backgroundColor: themeColors.accentSoft, borderColor: themeColors.accent + '30' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <Lightbulb size={18} color={themeColors.accent} />
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

  // Memoized so the options object reference is stable between renders.
  // Inline `<Stack.Screen options={{ headerRight: () => ... }} />` allocates
  // a fresh object + function every render, which caused react-navigation's
  // useNavigationCache to call setOptions on every render and triggered
  // "Maximum update depth exceeded" in production (Sentry RN-1). Both the
  // object and the headerRight function need stable identity.
  //
  // Both hooks live ABOVE the `if (!project) return` early-exit so the hook
  // call order stays stable across renders (rules-of-hooks). They tolerate
  // a missing project via the optional chain in the title fallback.
  const headerRight = useCallback(
    () => (
      <TouchableOpacity onPress={openEditModal} style={{ padding: 6 }} activeOpacity={0.7} testID="edit-project-btn" accessibilityRole="button" accessibilityLabel="Edit"><Pencil size={20} color={themeColors.accent} /></TouchableOpacity>
    ),
    [openEditModal],
  );
  const stackScreenOptions = useMemo(
    () => ({ title: project?.name || 'Project Details', headerRight }),
    [project?.name, headerRight],
  );

  if (!project) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const linkedEstimate = project.linkedEstimate;
  // Defensive: linkedEstimate can come back with .items undefined if the
  // record was persisted before items became a required array (legacy
  // data, or AI tool failures partway through). The naive `.items.length`
  // crashes the whole screen. Treat missing/non-array items as empty.
  const linkedItems = Array.isArray(linkedEstimate?.items) ? linkedEstimate!.items : [];
  const hasAnyEstimate = !!(linkedEstimate && linkedItems.length > 0) || !!estimate;
  const collaborators = project.collaborators ?? [];

  const heroTotal = linkedEstimate?.grandTotal ?? estimate?.grandTotal ?? 0;
  const heroLabel = linkedEstimate ? `${linkedItems.length} items` : estimate ? `${Array.isArray(estimate.materials) ? estimate.materials.length : 0} materials` : '';

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={stackScreenOptions} />
      <ScrollView
        contentContainerStyle={[{ paddingBottom: insets.bottom + 40 }, layout.isDesktop && { maxWidth: 1200, alignSelf: 'center' as const, width: '100%' as any }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The hero card unrolls like a blueprint when the project opens. */}
        <BlueprintReveal>
        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroName}>{project.name}</Text>
              <View style={styles.heroMeta}>
                <MapPin size={14} color={themeColors.textMuted} />
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
                {/* The estimate total rolls up like a tape measure unrolling —
                    helps the number land instead of just appearing. */}
                <TapeRollNumber
                  value={heroTotal}
                  formatter={(n) => formatMoney(Math.round(n))}
                  style={styles.heroStatValue}
                  duration={900}
                />
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
                      <Text style={[styles.smallStatValue, { color: themeColors.success }]}>
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
                      <Text style={[styles.smallStatValue, { color: themeColors.accent }]}>
                        {formatMoney(linkedEstimate.markupTotal)}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          )}
        </View>
        </BlueprintReveal>

        {/* Lifecycle stage strip — Pre-Con → Construction → Post-Con → Closeout.
            Tapping a stage prompts to advance project.status.
            The 4 stages map onto the 5 underlying status values (draft+estimated
            collapse into Pre-Con). */}
        <View style={styles.stageStrip}>
          <View style={styles.stageHeaderRow}>
            <Text style={styles.stageHeaderLabel}>Project Stage</Text>
            <Text style={styles.stageHeaderCount}>
              {LIFECYCLE_STAGES.findIndex(s => s.key === currentStage) + 1} of {LIFECYCLE_STAGES.length}
            </Text>
          </View>
          <View style={styles.stageChipsRow}>
            {LIFECYCLE_STAGES.map((stage, idx) => {
              const isActive = stage.key === currentStage;
              const stageIdx = LIFECYCLE_STAGES.findIndex(s => s.key === currentStage);
              const isPast = idx < stageIdx;
              return (
                <TouchableOpacity
                  key={stage.key}
                  onPress={() => handleStageTap(stage.key)}
                  activeOpacity={0.75}
                  style={[
                    styles.stageChip,
                    isActive && styles.stageChipActive,
                    !isActive && isPast && styles.stageChipPast,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Stage: ${stage.label}${isActive ? ' (current)' : ''}`}
                  testID={`stage-chip-${stage.key}`}
                >
                  <Text
                    style={[
                      styles.stageChipText,
                      isActive && styles.stageChipTextActive,
                      !isActive && isPast && styles.stageChipTextPast,
                    ]}
                    numberOfLines={1}
                  >
                    {stage.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.stageProgressTrack}>
            <View
              style={[
                styles.stageProgressFill,
                {
                  width: `${((LIFECYCLE_STAGES.findIndex(s => s.key === currentStage) + 1) / LIFECYCLE_STAGES.length) * 100}%`,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push({ pathname: '/weekly-snapshot' as any, params: { projectId: id } })}
            activeOpacity={0.7}
            testID="project-weekly-snapshot-btn"
          >
            <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
              <CalendarDays size={18} color={themeColors.accent} />
            </View>
            <Text style={styles.quickActionLabel}>This Week</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push({ pathname: '/cash-flow' as any, params: { projectId: id } })}
            activeOpacity={0.7}
            testID="project-cash-flow-btn"
          >
            <View style={[styles.quickActionIcon, { backgroundColor: themeColors.success + '15' }]}>
              <Wallet size={18} color={themeColors.success} />
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
              <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
                <Receipt size={18} color={themeColors.accent} />
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
              <View style={[styles.quickActionIcon, { backgroundColor: themeColors.info + '15' }]}>
                <CalendarDays size={18} color={themeColors.info} />
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
              <View style={[styles.quickActionIcon, { backgroundColor: themeColors.info + '15' }]}>
                <CalendarDays size={18} color={themeColors.info} />
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
              <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
                <Receipt size={18} color={themeColors.accent} />
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
            <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
              <TrendingDown size={18} color={themeColors.accent} />
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
            <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
              <Archive size={18} color={themeColors.accent} />
            </View>
            <Text style={styles.quickActionLabel}>{generatingCloseout ? 'Building…' : 'Closeout'}</Text>
            {/* Concrete-pour progress bar appears under the button while
                generation is in flight. Indeterminate-ish — we don't have
                a real % from the PDF generator, so we show a slow ramp to
                ~85% and finish on success. */}
            {generatingCloseout && (
              <ConcretePour value={0.85} height={3} fillColor={themeColors.accent} duration={2400} hideShine={false} style={{ marginTop: 6, width: '100%' }} />
            )}
          </TouchableOpacity>
        </View>

        {/* Section tile groups — collapsible, organized by workflow domain.
            Field & Money default-expanded (most-used). Documentation & People
            default-collapsed (lower frequency). Group header shows the sum of
            tile counts so you can spot a busy section without expanding it. */}
        {(() => {
          type Tile = { key: SectionKey; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; color: string; count: number | null };
          // Tile icons are intentionally NEUTRAL (themeColors.textSecondary).
          // Color earns its way onto the screen by communicating STATE,
          // not by decorating workflow categories. The status badge under
          // each tile is the only colored thing — that's what the user
          // should scan for "what needs me right now?". Group headers keep
          // their soft category tint to differentiate workflow domains.
          const NEUTRAL = themeColors.textSecondary;
          // Tile color = group color. May 2026: replaced a 24-color
          // bespoke palette (the audit called it a sticker-sheet rainbow
          // — "color carried no meaning, just noise"). Now every tile
          // inherits the color of its group header. Color SIGNALS which
          // workflow domain the tile belongs to (Field / Money / Docs /
          // People) instead of being decorative.
          //
          // Same 4 colors used by the group headers below. Defined here
          // because `allTiles` is built before `groups` and needs the
          // per-tile color at construction time.
          const FIELD_COLOR  = themeColors.accent;   // orange
          const MONEY_COLOR  = themeColors.success;  // green
          const DOCS_COLOR   = themeColors.info;     // blue
          const PEOPLE_COLOR = themeColors.info;     // blue (same as docs)
          const GROUP_BY_KEY: Partial<Record<SectionKey, string>> = {
            // field
            dailyReports: FIELD_COLOR, timeTracking: FIELD_COLOR,
            punchList: FIELD_COLOR, photos: FIELD_COLOR,
            plans: FIELD_COLOR, schedule: FIELD_COLOR,
            // money
            budget: MONEY_COLOR, contract: MONEY_COLOR, selections: MONEY_COLOR,
            linkedEstimate: MONEY_COLOR, changeOrders: MONEY_COLOR,
            invoices: MONEY_COLOR, lienWaivers: MONEY_COLOR,
            closeoutBinder: MONEY_COLOR, handover: MONEY_COLOR,
            // docs
            rfis: DOCS_COLOR, submittals: DOCS_COLOR, permits: DOCS_COLOR,
            projectFiles: DOCS_COLOR, activity: DOCS_COLOR, calendar: DOCS_COLOR,
            // people
            collaborators: PEOPLE_COLOR, clientPortal: PEOPLE_COLOR,
            oacMeetings: PEOPLE_COLOR, communications: PEOPLE_COLOR,
          };
          const colorFor = (k: SectionKey): string => GROUP_BY_KEY[k] ?? NEUTRAL;
          const allTiles: Tile[] = [
            ...(hasAnyEstimate ? [{ key: 'linkedEstimate' as SectionKey, label: 'Estimate Items', icon: ShoppingCart, color: colorFor('linkedEstimate'), count: linkedItems.length || estimate?.materials.length || 0 }] : []),
            ...(project.schedule ? [{ key: 'schedule' as SectionKey, label: 'Schedule', icon: CalendarDays, color: colorFor('schedule'), count: Array.isArray(project.schedule.tasks) ? project.schedule.tasks.length : 0 }] : []),
            { key: 'collaborators', label: 'Team', icon: Users, color: colorFor('collaborators'), count: collaborators.length + 1 },
            { key: 'contract', label: 'Contract', icon: FileText, color: colorFor('contract'), count: null as number | null },
            { key: 'selections', label: 'Selections', icon: ShoppingCart, color: colorFor('selections'), count: null as number | null },
            { key: 'lienWaivers', label: 'Lien Waivers', icon: ScrollText, color: colorFor('lienWaivers'), count: null as number | null },
            { key: 'closeoutBinder', label: 'Closeout Binder', icon: BookOpen, color: colorFor('closeoutBinder'), count: null as number | null },
            { key: 'handover', label: 'Handover Checklist', icon: Footprints, color: colorFor('handover'), count: null as number | null },
            { key: 'changeOrders', label: 'Change Orders', icon: Repeat, color: colorFor('changeOrders'), count: changeOrders.length },
            { key: 'invoices', label: 'Invoices', icon: Receipt, color: colorFor('invoices'), count: projectInvoices.length },
            { key: 'dailyReports', label: 'Daily Reports', icon: ClipboardList, color: colorFor('dailyReports'), count: dailyReports.length },
            { key: 'timeTracking', label: 'Time Tracking', icon: Clock, color: colorFor('timeTracking'), count: null as number | null },
            { key: 'punchList', label: 'Punch List', icon: CheckSquare, color: colorFor('punchList'), count: punchItems.length },
            { key: 'rfis', label: 'RFIs', icon: FileText, color: colorFor('rfis'), count: projectRFIs.length },
            { key: 'submittals', label: 'Submittals', icon: FileText, color: colorFor('submittals'), count: projectSubmittals.length },
            { key: 'oacMeetings', label: 'OAC Meetings', icon: Users, color: colorFor('oacMeetings'), count: projectOACMeetings.length },
            { key: 'permits', label: 'Permits', icon: Shield, color: colorFor('permits'), count: projectPermits.length },
            { key: 'projectFiles', label: 'Project Files', icon: FolderOpen, color: colorFor('projectFiles'), count: null as number | null },
            ...(hasAnyEstimate ? [{ key: 'budget' as SectionKey, label: 'Financial Health', icon: DollarSign, color: colorFor('budget'), count: null as number | null }] : []),
            { key: 'photos', label: 'Photos', icon: Camera, color: colorFor('photos'), count: projectPhotos.length },
            { key: 'plans', label: 'Plans', icon: Layers, color: colorFor('plans'), count: projectPlans.length },
            { key: 'clientPortal', label: 'Client Portal', icon: Globe, color: colorFor('clientPortal'), count: null as number | null },
            { key: 'communications', label: 'Communications', icon: Mail, color: colorFor('communications'), count: commEvents.length },
            { key: 'activity', label: 'Activity', icon: Activity, color: colorFor('activity'), count: null as number | null },
            { key: 'calendar', label: 'Calendar Feed', icon: CalendarDays, color: colorFor('calendar'), count: null as number | null },
          ];

          const groups: { key: TileGroupKey; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; color: string; tileKeys: SectionKey[] }[] = [
            { key: 'field', label: 'Field Ops', icon: HardHat, color: themeColors.accent, tileKeys: ['dailyReports', 'timeTracking', 'punchList', 'photos', 'plans', 'schedule'] },
            { key: 'money', label: 'Money', icon: DollarSign, color: themeColors.success, tileKeys: ['budget', 'contract', 'selections', 'linkedEstimate', 'changeOrders', 'invoices', 'lienWaivers', 'closeoutBinder', 'handover'] },
            { key: 'docs', label: 'Documentation', icon: FolderOpen, color: themeColors.info, tileKeys: ['rfis', 'submittals', 'permits', 'projectFiles', 'activity', 'calendar'] },
            { key: 'people', label: 'People & Communication', icon: Users, color: themeColors.info, tileKeys: ['collaborators', 'clientPortal', 'oacMeetings', 'communications'] },
          ];

          const tileByKey = new Map<SectionKey, Tile>(allTiles.map(t => [t.key, t]));

          const renderTile = (tile: Tile) => {
            const TileIcon = tile.icon;
            return (
              <HardHatTap
                key={tile.key}
                style={styles.sectionTile}
                hatColor={tile.color}
                onPress={() => {
                  if (tile.key === 'activity') { router.push({ pathname: '/activity-feed' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'calendar') { void handleExportCalendar(); return; }
                  if (tile.key === 'plans') { router.push({ pathname: '/plans' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'permits') { router.push({ pathname: '/permits' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'contract') { router.push({ pathname: '/contract' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'selections') { router.push({ pathname: '/selections' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'lienWaivers') { router.push({ pathname: '/lien-waivers' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'closeoutBinder') { router.push({ pathname: '/closeout-binder' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'handover') { router.push({ pathname: '/handover' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'oacMeetings') { router.push({ pathname: '/oac-meeting' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'timeTracking') { router.push({ pathname: '/time-tracking' as any, params: { projectId: id } }); return; }
                  if (tile.key === 'projectFiles') { router.push({ pathname: '/project-files' as any, params: { projectId: id } }); return; }
                  setActiveTile(tile.key);
                }}
                testID={`section-tile-${tile.key}`}
              >
                <View style={[styles.sectionTileIcon, { backgroundColor: tile.color + '15' }]}>
                  <TileIcon size={20} color={tile.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.sectionTileLabel} numberOfLines={1}>{tile.label}</Text>
                  {tileBadges[tile.key] && (
                    <Text
                      style={[styles.sectionTileStatus, { color: STATUS_TONES[tileBadges[tile.key]!.tone].color }]}
                      numberOfLines={1}
                    >
                      {tileBadges[tile.key]!.label}
                    </Text>
                  )}
                </View>
                {tile.count !== null && tile.count !== undefined && (
                  <View style={styles.sectionTileBadge}>
                    <Text style={styles.sectionTileBadgeText}>{tile.count}</Text>
                  </View>
                )}
                <ChevronRight size={16} color={themeColors.textMuted} />
              </HardHatTap>
            );
          };

          return (
            <View style={styles.sectionGroups}>
              {groups.map(group => {
                const groupTiles = group.tileKeys.map(k => tileByKey.get(k)).filter((t): t is Tile => t !== undefined);
                if (groupTiles.length === 0) return null;
                const groupCountSum = groupTiles.reduce((acc, t) => acc + (t.count ?? 0), 0);
                const collapsed = collapsedGroups.has(group.key);
                const GroupIcon = group.icon;
                return (
                  <View key={group.key} style={styles.tileGroup}>
                    <TouchableOpacity
                      style={styles.tileGroupHeader}
                      onPress={() => toggleGroup(group.key)}
                      activeOpacity={0.7}
                      testID={`tile-group-${group.key}`}
                    >
                      <View style={[styles.tileGroupHeaderIcon, { backgroundColor: group.color + '15' }]}>
                        <GroupIcon size={18} color={group.color} />
                      </View>
                      <Text style={styles.tileGroupHeaderLabel}>{group.label}</Text>
                      {groupCountSum > 0 && (
                        <View style={styles.tileGroupBadge}>
                          <Text style={styles.tileGroupBadgeText}>{groupCountSum}</Text>
                        </View>
                      )}
                      {collapsed ? <ChevronDown size={18} color={themeColors.textMuted} /> : <ChevronUp size={18} color={themeColors.textMuted} />}
                    </TouchableOpacity>
                    {/* No wrapper — conditional render only. LayoutAnimation
                        in toggleGroup() handles the smooth open/close.
                        SawCutReveal had a bug where it kept the body mounted
                        at opacity 0 after collapse, leaving phantom height
                        ("the gap that won't go away"). */}
                    {!collapsed && (
                      <View style={styles.tileGroupBody}>
                        {groupTiles.map(renderTile)}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })()}

        <Modal
          visible={activeTile !== null}
          animationType="slide"
          presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
          onRequestClose={() => setActiveTile(null)}
        >
          <View style={{ flex: 1, backgroundColor: themeColors.bg, paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }}>
            <View style={styles.sectionModalHeader}>
              <TouchableOpacity
                onPress={() => setActiveTile(null)}
                style={styles.sectionModalBack}
                activeOpacity={0.7}
                testID="section-modal-back"
              >
                <ChevronLeft size={22} color={themeColors.text} />
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

        {linkedEstimate && linkedItems.length > 0 && activeTile === 'linkedEstimate' && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggleSection('linkedEstimate')}
              activeOpacity={0.7}
              testID="linked-estimate-section"
            >
              <ShoppingCart size={20} color={themeColors.accent} />
              <Text style={styles.sectionTitle}>
                Estimate Items — {formatMoney(linkedEstimate.grandTotal, 2)}
              </Text>
              {expanded.linkedEstimate ? (
                <ChevronUp size={18} color={themeColors.textMuted} />
              ) : (
                <ChevronDown size={18} color={themeColors.textMuted} />
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
                {linkedItems.map((item, idx) => {
                  // Defensive coercion: legacy estimates (or rows persisted
                  // before lineTotal/markup/quantity were canonical) can
                  // arrive without these fields, which used to crash with
                  // "Cannot read property 'toFixed' of undefined" the moment
                  // the user opened the Estimate Items section.
                  const safeName = item.name ?? 'Unnamed item';
                  const safeCategory = item.category ?? '';
                  const safeSupplier = item.supplier ?? '';
                  const safeQty = typeof item.quantity === 'number' ? item.quantity : 0;
                  const safeUnit = item.unit ?? 'ea';
                  const safeMarkup = typeof item.markup === 'number' ? item.markup : 0;
                  // Derive lineTotal if missing — quantity × (bulk or unit price) × (1+markup).
                  const derivedTotal = safeQty *
                    (item.usesBulk ? (item.bulkPrice ?? item.unitPrice ?? 0) : (item.unitPrice ?? 0)) *
                    (1 + safeMarkup / 100);
                  const safeTotal = typeof item.lineTotal === 'number' ? item.lineTotal : derivedTotal;
                  return (
                    <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
                      <View style={{ flex: 2 }}>
                        <Text style={styles.tableCellName} numberOfLines={1}>{safeName}</Text>
                        <Text style={styles.tableCellSub}>
                          {[safeCategory, safeSupplier].filter(Boolean).join(' · ') || '—'}
                        </Text>
                        {item.usesBulk && (
                          <View style={styles.bulkBadge}>
                            <TrendingDown size={10} color={themeColors.success} />
                            <Text style={styles.bulkBadgeText}>Bulk rate</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.tableCell, { flex: 1 }]}>
                        {safeQty} {safeUnit}
                      </Text>
                      <Text style={[styles.tableCell, { flex: 1 }]}>
                        {safeMarkup}%
                      </Text>
                      <Text style={[styles.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>
                        ${safeTotal.toFixed(2)}
                      </Text>
                    </View>
                  );
                })}
                <View style={styles.linkedSummaryRow}>
                  <View style={styles.linkedSummaryItem}>
                    <Text style={styles.linkedSummaryLabel}>Base</Text>
                    <Text style={styles.linkedSummaryValue}>{formatMoney(linkedEstimate.baseTotal, 2)}</Text>
                  </View>
                  <View style={styles.linkedSummaryItem}>
                    <Text style={[styles.linkedSummaryLabel, { color: themeColors.accent }]}>Markup</Text>
                    <Text style={[styles.linkedSummaryValue, { color: themeColors.accent }]}>+{formatMoney(linkedEstimate.markupTotal, 2)}</Text>
                  </View>
                  <View style={styles.linkedSummaryItem}>
                    <Text style={[styles.linkedSummaryLabel, { fontWeight: '700' as const }]}>Total</Text>
                    <Text style={[styles.linkedSummaryValue, { color: themeColors.accent, fontWeight: '800' as const }]}>{formatMoney(linkedEstimate.grandTotal, 2)}</Text>
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
                    <CalendarDays size={16} color={themeColors.info} />
                    <Text style={styles.crossLinkText}>View Schedule ({Array.isArray(project.schedule.tasks) ? project.schedule.tasks.length : 0} tasks · {project.schedule.totalDurationDays ?? 0}d)</Text>
                    <ChevronRight size={16} color={themeColors.textMuted} />
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
              <CalendarDays size={20} color={themeColors.info} />
              <Text style={styles.sectionTitle}>Schedule</Text>
              {expanded.schedule ? (
                <ChevronUp size={18} color={themeColors.textMuted} />
              ) : (
                <ChevronDown size={18} color={themeColors.textMuted} />
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
                {(Array.isArray(project.schedule.tasks) ? project.schedule.tasks : []).map(task => (
                  <View key={task.id} style={styles.scheduleTaskRow}>
                    <View style={[styles.scheduleStatusDot, { backgroundColor: task.status === 'done' ? themeColors.success : task.status === 'in_progress' ? themeColors.info : themeColors.accent }]} />
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
                  <CalendarDays size={16} color={themeColors.info} />
                  <Text style={styles.crossLinkText}>Open Full Schedule</Text>
                  <ChevronRight size={16} color={themeColors.textMuted} />
                </TouchableOpacity>

                {hasAnyEstimate && (
                  <TouchableOpacity
                    style={styles.crossLinkBtn}
                    onPress={() => estimate ? openDetail('total') : undefined}
                    activeOpacity={estimate ? 0.7 : 1}
                    testID="schedule-view-estimate-link"
                  >
                    <Receipt size={16} color={themeColors.accent} />
                    <Text style={styles.crossLinkText}>View Estimate ({formatMoney(heroTotal)})</Text>
                    <ChevronRight size={16} color={themeColors.textMuted} />
                  </TouchableOpacity>
                )}
                {!hasAnyEstimate && (
                  <TouchableOpacity
                    style={styles.crossLinkBtn}
                    onPress={() => navigateFromTile('/(tabs)/discover/estimate' as any, 'replace')}
                    activeOpacity={0.7}
                    testID="schedule-create-estimate-link"
                  >
                    <Receipt size={16} color={themeColors.accent} />
                    <Text style={styles.crossLinkText}>Create Estimate for This Project</Text>
                    <ChevronRight size={16} color={themeColors.textMuted} />
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
                <Package size={20} color={themeColors.accent} />
                <Text style={styles.sectionTitle}>
                  Materials — {formatMoney(estimate.materialTotal)}
                </Text>
                {expanded.materials ? (
                  <ChevronUp size={18} color={themeColors.textMuted} />
                ) : (
                  <ChevronDown size={18} color={themeColors.textMuted} />
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
                  {(Array.isArray(estimate.materials) ? estimate.materials : []).map((item, idx) => (
                    <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
                      <View style={{ flex: 2 }}>
                        <Text style={styles.tableCellName} numberOfLines={1}>{item.name}</Text>
                        {(item.savings ?? 0) > 0 && (
                          <View style={styles.savingsBadge}>
                            <TrendingDown size={10} color={themeColors.success} />
                            <Text style={styles.savingsText}>Save ${(item.savings ?? 0).toFixed(0)}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.tableCell, { flex: 1 }]}>
                        {item.quantity} {item.unit}
                      </Text>
                      <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' as const }]}>
                        ${(item.unitPrice ?? 0).toFixed(2)}
                      </Text>
                      <Text style={[styles.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>
                        {formatMoney(item.totalPrice)}
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
                <Users size={20} color={themeColors.accent} />
                <Text style={styles.sectionTitle}>
                  Labor — {formatMoney(estimate.laborTotal)}
                </Text>
                {expanded.labor ? (
                  <ChevronUp size={18} color={themeColors.textMuted} />
                ) : (
                  <ChevronDown size={18} color={themeColors.textMuted} />
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
                  {(Array.isArray(estimate.labor) ? estimate.labor : []).map((item, idx) => (
                    <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
                      <Text style={[styles.tableCellName, { flex: 2 }]} numberOfLines={1}>{item.role}</Text>
                      <Text style={[styles.tableCell, { flex: 1 }]}>${item.hourlyRate ?? 0}</Text>
                      <Text style={[styles.tableCell, { flex: 1 }]}>{item.hours ?? 0}h</Text>
                      <Text style={[styles.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>
                        {formatMoney(item.totalCost)}
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
                <DollarSign size={20} color={themeColors.accent} />
                <Text style={styles.sectionTitle}>Cost Summary</Text>
                {expanded.summary ? (
                  <ChevronUp size={18} color={themeColors.textMuted} />
                ) : (
                  <ChevronDown size={18} color={themeColors.textMuted} />
                )}
              </TouchableOpacity>

              {expanded.summary && (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Materials</Text>
                    <Text style={styles.summaryValue}>{formatMoney(estimate.materialTotal)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Labor</Text>
                    <Text style={styles.summaryValue}>{formatMoney(estimate.laborTotal)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Permits</Text>
                    <Text style={styles.summaryValue}>{formatMoney(estimate.permits)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Overhead</Text>
                    <Text style={styles.summaryValue}>{formatMoney(estimate.overhead)}</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal</Text>
                    <Text style={styles.summaryValue}>{formatMoney(estimate.subtotal)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Tax</Text>
                    <Text style={styles.summaryValue}>{formatMoney(estimate.tax)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Contingency</Text>
                    <Text style={styles.summaryValue}>{formatMoney(estimate.contingency)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <View style={styles.savingsHighlight}>
                      <TrendingDown size={14} color={themeColors.success} />
                      <Text style={[styles.summaryLabel, { color: themeColors.success }]}>Bulk Savings</Text>
                    </View>
                    <Text style={[styles.summaryValue, { color: themeColors.success }]}>
                      -{formatMoney(estimate.bulkSavingsTotal)}
                    </Text>
                  </View>
                  <View style={styles.grandTotalDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.grandTotalLabel}>Grand Total</Text>
                    <Text style={styles.grandTotalValue}>{formatMoney(estimate.grandTotal)}</Text>
                  </View>
                </View>
              )}
            </View>

            {Array.isArray(estimate.notes) && estimate.notes.length > 0 && (
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => toggleSection('notes')}
                  activeOpacity={0.7}
                >
                  <Lightbulb size={20} color={themeColors.accent} />
                  <Text style={styles.sectionTitle}>Tips & Notes</Text>
                  {expanded.notes ? (
                    <ChevronUp size={18} color={themeColors.textMuted} />
                  ) : (
                    <ChevronDown size={18} color={themeColors.textMuted} />
                  )}
                </TouchableOpacity>

                {expanded.notes && (
                  <View style={styles.notesContainer}>
                    {(estimate.notes ?? []).map((note, idx) => (
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
            <Users size={20} color={themeColors.info} />
            <Text style={styles.sectionTitle}>
              Team ({collaborators.length + 1})
            </Text>
            {expanded.collaborators ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.collaborators && (
            <View style={styles.collabCard}>
              <View style={styles.collabMember}>
                <View style={[styles.collabAvatar, { backgroundColor: themeColors.accent }]}>
                  <Crown size={14} color={"#FFFFFF"} />
                </View>
                <View style={styles.collabInfo}>
                  <Text style={styles.collabName}>You (Owner)</Text>
                  <Text style={styles.collabEmail}>{branding.email || 'Set email in settings'}</Text>
                </View>
                <View style={[styles.collabRoleBadge, { backgroundColor: themeColors.accent + '15' }]}>
                  <Text style={[styles.collabRoleText, { color: themeColors.accent }]}>Owner</Text>
                </View>
              </View>

              {collaborators.map(collab => (
                <View key={collab.id} style={styles.collabMember}>
                  <View style={[styles.collabAvatar, { backgroundColor: collab.role === 'editor' ? themeColors.info : themeColors.textMuted }]}>
                    {collab.role === 'editor' ? <PenTool size={12} color="#fff" /> : <Eye size={12} color="#fff" />}
                  </View>
                  <View style={styles.collabInfo}>
                    <Text style={styles.collabName}>{collab.name}</Text>
                    <Text style={styles.collabEmail}>{collab.email}</Text>
                  </View>
                  <View style={styles.collabActions}>
                    <View style={[styles.collabRoleBadge, {
                      backgroundColor: collab.status === 'pending' ? themeColors.accentSoft : (collab.role === 'editor' ? themeColors.info : themeColors.line),
                    }]}>
                      <Text style={[styles.collabRoleText, {
                        color: collab.status === 'pending' ? themeColors.accent : (collab.role === 'editor' ? themeColors.info : themeColors.textSecondary),
                      }]}>
                        {collab.status === 'pending' ? 'Pending' : collab.role === 'editor' ? 'Editor' : 'Viewer'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.collabRemoveBtn}
                      onPress={() => handleRemoveCollaborator(collab.id, collab.name)}
                      activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                      <X size={14} color={themeColors.danger} />
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
                <UserPlus size={16} color={themeColors.accent} />
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
            <Repeat size={20} color={themeColors.accent} />
            <Text style={styles.sectionTitle}>
              Change Orders ({changeOrders.length})
            </Text>
            {expanded.changeOrders ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.changeOrders && (
            <View style={styles.coCard}>
              {changeOrders.length === 0 && (
                <Text style={styles.coEmptyText}>No change orders yet.</Text>
              )}
              {changeOrders.length > 0 && (() => {
                const counts = {
                  pending: changeOrders.filter(c => c.status === 'under_review' || c.status === 'draft' || c.status === 'revised').length,
                  approved: changeOrders.filter(c => c.status === 'approved').length,
                };
                const chips: FilterChip<'pending' | 'approved' | 'all'>[] = [
                  { value: 'pending', label: 'Pending', count: counts.pending, color: themeColors.accent },
                  { value: 'approved', label: 'Approved', count: counts.approved, color: themeColors.success },
                  { value: 'all', label: 'All', count: changeOrders.length },
                ];
                return (
                  <FilterChipRow
                    chips={chips}
                    value={coFilter}
                    onChange={setCoFilter}
                    noPadding
                    testID="co-status-filter"
                  />
                );
              })()}
              {(coFilter === 'all' ? changeOrders : changeOrders.filter(c => {
                if (coFilter === 'pending') return c.status === 'under_review' || c.status === 'draft' || c.status === 'revised';
                if (coFilter === 'approved') return c.status === 'approved';
                return true;
              })).map(co => (
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
                    <Text style={[styles.coAmount, { color: (co.changeAmount ?? 0) >= 0 ? themeColors.accent : themeColors.success }]}>
                      {(co.changeAmount ?? 0) >= 0 ? '+' : ''}{formatMoney(co.changeAmount, 2)}
                    </Text>
                    <View style={[styles.coBadge, {
                      backgroundColor: co.status === 'approved' ? themeColors.successSoft : co.status === 'rejected' ? themeColors.danger : co.status === 'submitted' ? themeColors.info : themeColors.line
                    }]}>
                      <Text style={[styles.coBadgeText, {
                        color: co.status === 'approved' ? themeColors.success : co.status === 'rejected' ? themeColors.danger : co.status === 'submitted' ? themeColors.info : themeColors.textSecondary
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
                      // 🎉 Burst — change orders are real money/scope
                      // events; the GC celebrates each approval.
                      fireConfetti({ count: 35 });
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
                <Plus size={16} color={themeColors.accent} />
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
            <Receipt size={20} color={themeColors.success} />
            <Text style={styles.sectionTitle}>
              Invoices ({projectInvoices.length})
            </Text>
            {expanded.invoices ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.invoices && (
            <View style={styles.coCard}>
              {projectInvoices.length === 0 && (
                <Text style={styles.coEmptyText}>No invoices yet.</Text>
              )}
              {projectInvoices.length > 0 && (() => {
                const counts = {
                  unpaid: projectInvoices.filter(i => i.amountPaid < i.totalDue).length,
                  paid: projectInvoices.filter(i => i.amountPaid >= i.totalDue).length,
                };
                const chips: FilterChip<'unpaid' | 'paid' | 'all'>[] = [
                  { value: 'unpaid', label: 'Unpaid', count: counts.unpaid, color: themeColors.accent },
                  { value: 'paid', label: 'Paid', count: counts.paid, color: themeColors.success },
                  { value: 'all', label: 'All', count: projectInvoices.length },
                ];
                return (
                  <FilterChipRow
                    chips={chips}
                    value={invoiceFilter}
                    onChange={setInvoiceFilter}
                    noPadding
                    testID="invoice-status-filter"
                  />
                );
              })()}
              {(invoiceFilter === 'all' ? projectInvoices : projectInvoices.filter(i => {
                if (invoiceFilter === 'unpaid') return i.amountPaid < i.totalDue;
                if (invoiceFilter === 'paid') return i.amountPaid >= i.totalDue;
                return true;
              })).map(inv => {
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
                      <Text style={styles.invAmount}>{formatMoney(inv.totalDue, 2)}</Text>
                      <View style={[styles.coBadge, {
                        backgroundColor: displayStatus === 'paid' ? themeColors.successSoft : displayStatus === 'overdue' ? themeColors.danger : displayStatus === 'partially_paid' ? themeColors.accentSoft : displayStatus === 'sent' ? themeColors.info : themeColors.line
                      }]}>
                        <Text style={[styles.coBadgeText, {
                          color: displayStatus === 'paid' ? themeColors.success : displayStatus === 'overdue' ? themeColors.danger : displayStatus === 'partially_paid' ? themeColors.accent : displayStatus === 'sent' ? themeColors.info : themeColors.textSecondary
                        }]}>
                          {displayStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <View style={styles.invBtnRow}>
                {/* Quick Invoice — skips bill-from-estimate entirely.
                    Goes straight to /invoice with no prefill so the GC
                    can type an amount + description and send. Fastest
                    path for one-off bills (final cleanup, allowance
                    overage, deposit on a sub) that don't need to draw
                    against estimate line items. */}
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/invoice' as any, params: { projectId: id, type: 'quick' } })}
                  activeOpacity={0.7}
                  testID="add-quick-invoice-btn"
                >
                  <Zap size={16} color={themeColors.accent} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Quick</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/bill-from-estimate' as any, params: { projectId: id, type: 'progress' } })}
                  activeOpacity={0.7}
                  testID="add-progress-bill-btn"
                >
                  <ClipboardList size={16} color={themeColors.info} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.info }]}>Progress</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/bill-from-estimate' as any, params: { projectId: id, type: 'full' } })}
                  activeOpacity={0.7}
                  testID="add-full-invoice-btn"
                >
                  <Receipt size={16} color={themeColors.success} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.success }]}>Full</Text>
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
            <ClipboardList size={20} color={themeColors.accent} />
            <Text style={styles.sectionTitle}>
              Daily Reports ({dailyReports.length})
            </Text>
            {expanded.dailyReports ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.dailyReports && (
            <View style={styles.coCard}>
              {dailyReports.length === 0 && (
                <Text style={styles.coEmptyText}>No daily reports yet.</Text>
              )}
              {dailyReports.length > 0 && (() => {
                // Group DFRs by ISO week. Week label is "Week of Mon Apr 7"
                // — same as how site superintendents talk about the calendar.
                // Newest week first; within a week, newest day first. Keeps
                // the most-recent entries on top without forcing the user to
                // scroll to find what they wrote yesterday.
                const buckets = new Map<string, { label: string; weekStart: number; reports: typeof dailyReports }>();
                for (const dr of dailyReports) {
                  const d = new Date(dr.date);
                  // Find Monday of that week (locale-agnostic: shift back by
                  // dayOfWeek - 1, treating Sunday=0 as 7 so Sun belongs to
                  // the prior week's Monday).
                  const day = d.getDay() === 0 ? 7 : d.getDay();
                  const monday = new Date(d);
                  monday.setDate(d.getDate() - (day - 1));
                  monday.setHours(0, 0, 0, 0);
                  const key = monday.toISOString().slice(0, 10);
                  const label = `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                  if (!buckets.has(key)) {
                    buckets.set(key, { label, weekStart: monday.getTime(), reports: [] });
                  }
                  buckets.get(key)!.reports.push(dr);
                }
                const orderedWeeks = Array.from(buckets.values()).sort((a, b) => b.weekStart - a.weekStart);
                return orderedWeeks.map(week => (
                  <View key={week.weekStart} style={styles.dfrWeekBucket}>
                    <View style={styles.dfrWeekHeader}>
                      <Text style={styles.dfrWeekLabel}>{week.label}</Text>
                      <View style={styles.dfrWeekBadge}>
                        <Text style={styles.dfrWeekBadgeText}>{week.reports.length}</Text>
                      </View>
                    </View>
                    {week.reports
                      .slice()
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map(dr => (
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
                          backgroundColor: dr.status === 'sent' ? themeColors.successSoft : themeColors.accent + '15'
                        }]}>
                          <Text style={[styles.coBadgeText, {
                            color: dr.status === 'sent' ? themeColors.success : themeColors.accent
                          }]}>
                            {dr.status === 'sent' ? 'Sent' : 'Saved'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ));
              })()}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/daily-report' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="add-daily-report-btn"
              >
                <Plus size={16} color={themeColors.accent} />
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
            <CheckSquare size={20} color={themeColors.accent} />
            <Text style={styles.sectionTitle}>
              Punch List ({punchItems.length})
            </Text>
            {expanded.punchList ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
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
                  <View style={[styles.punchDot, { backgroundColor: pi.status === 'closed' ? themeColors.success : pi.status === 'ready_for_review' ? themeColors.accent : pi.status === 'in_progress' ? themeColors.info : themeColors.danger }]} />
                  <View style={styles.coInfo}>
                    <Text style={styles.coNumber} numberOfLines={1}>{pi.description}</Text>
                    <Text style={styles.coDesc} numberOfLines={1}>{pi.location || 'No location'} · {pi.assignedSub || 'Unassigned'}</Text>
                  </View>
                  <View style={[styles.coBadge, {
                    backgroundColor: pi.status === 'closed' ? themeColors.successSoft : pi.status === 'ready_for_review' ? themeColors.accentSoft : pi.status === 'in_progress' ? themeColors.info : themeColors.danger
                  }]}>
                    <Text style={[styles.coBadgeText, {
                      color: pi.status === 'closed' ? themeColors.success : pi.status === 'ready_for_review' ? themeColors.accent : pi.status === 'in_progress' ? themeColors.info : themeColors.danger
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
                <CheckSquare size={16} color={themeColors.accent} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Manage Punch List</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.coAddBtn, { marginTop: 8 }]}
                onPress={() => navigateFromTile({ pathname: '/warranties' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="open-warranties-btn"
              >
                <CheckSquare size={16} color={themeColors.accent} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Warranties</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.coAddBtn, { marginTop: 8 }]}
                onPress={() => navigateFromTile({ pathname: '/retention' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="open-retention-btn"
              >
                <CheckSquare size={16} color={themeColors.accent} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Retention Tracker</Text>
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
            <FileText size={20} color={themeColors.info} />
            <Text style={styles.sectionTitle}>
              RFIs ({projectRFIs.length})
            </Text>
            {expanded.rfis ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.rfis && (
            <View style={styles.coCard}>
              {projectRFIs.length === 0 && (
                <Text style={styles.coEmptyText}>No RFIs yet.</Text>
              )}
              {projectRFIs.length > 0 && (() => {
                const counts = {
                  open: projectRFIs.filter(r => r.status === 'open').length,
                  answered: projectRFIs.filter(r => r.status === 'answered').length,
                  closed: projectRFIs.filter(r => r.status === 'closed' || r.status === 'void').length,
                };
                const chips: FilterChip<'open' | 'answered' | 'closed' | 'all'>[] = [
                  { value: 'open', label: 'Open', count: counts.open, color: themeColors.accent },
                  { value: 'answered', label: 'Answered', count: counts.answered, color: themeColors.info },
                  { value: 'closed', label: 'Closed', count: counts.closed, color: themeColors.success },
                  { value: 'all', label: 'All', count: projectRFIs.length },
                ];
                return (
                  <FilterChipRow
                    chips={chips}
                    value={rfiFilter}
                    onChange={setRfiFilter}
                    noPadding
                    testID="rfi-status-filter"
                  />
                );
              })()}
              {(rfiFilter === 'all' ? projectRFIs : projectRFIs.filter(r => {
                if (rfiFilter === 'open') return r.status === 'open';
                if (rfiFilter === 'answered') return r.status === 'answered';
                if (rfiFilter === 'closed') return r.status === 'closed' || r.status === 'void';
                return true;
              })).slice(0, 5).map(rfi => {
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
                      {isOverdue && <Text style={{ fontSize: Type.caption2.fontSize, color: themeColors.danger, fontWeight: '600' as const }}>Overdue</Text>}
                      <View style={[styles.coBadge, {
                        backgroundColor: rfi.status === 'open' ? themeColors.accentSoft : rfi.status === 'answered' ? themeColors.info : rfi.status === 'closed' ? themeColors.successSoft : themeColors.line
                      }]}>
                        <Text style={[styles.coBadgeText, {
                          color: rfi.status === 'open' ? themeColors.accent : rfi.status === 'answered' ? themeColors.info : rfi.status === 'closed' ? themeColors.success : themeColors.textSecondary
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
                  <Plus size={16} color={themeColors.info} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.info }]}>New RFI</Text>
                </TouchableOpacity>
                {projectRFIs.length > 0 && (
                  <TouchableOpacity
                    style={[styles.coAddBtn, { flex: 1, backgroundColor: themeColors.surfaceAlt ?? themeColors.line }]}
                    onPress={handleExportRFILog}
                    activeOpacity={0.7}
                    testID="export-rfi-log-btn"
                  >
                    <Share2 size={15} color={themeColors.text} />
                    <Text style={[styles.coAddBtnText, { color: themeColors.text }]}>Export Log</Text>
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
            <FileText size={20} color={themeColors.info} />
            <Text style={styles.sectionTitle}>
              Submittals ({projectSubmittals.length})
            </Text>
            {expanded.submittals ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
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
                    backgroundColor: sub.currentStatus === 'approved' ? themeColors.successSoft : sub.currentStatus === 'rejected' ? themeColors.danger : sub.currentStatus === 'revise_resubmit' ? themeColors.danger : themeColors.accentSoft
                  }]}>
                    <Text style={[styles.coBadgeText, {
                      color: sub.currentStatus === 'approved' ? themeColors.success : sub.currentStatus === 'rejected' ? themeColors.danger : sub.currentStatus === 'revise_resubmit' ? themeColors.danger : themeColors.accent
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
                <Plus size={16} color={themeColors.info} />
                <Text style={[styles.coAddBtnText, { color: themeColors.info }]}>New Submittal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/extract-submittals' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="extract-submittals-btn"
              >
                <Sparkles size={16} color={themeColors.accent} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Extract from spec book (AI)</Text>
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
              <DollarSign size={20} color={themeColors.success} />
              <Text style={styles.sectionTitle}>Financial Health</Text>
              {expanded.budget ? (
                <ChevronUp size={18} color={themeColors.textMuted} />
              ) : (
                <ChevronDown size={18} color={themeColors.textMuted} />
              )}
            </TouchableOpacity>

            {expanded.budget && (
              <View style={styles.coCard}>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                  <View style={{ flex: 1, backgroundColor: themeColors.successSoft, borderRadius: Tokens.radius.md, padding: 12, alignItems: 'center' as const }}>
                    <Text style={{ fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.success }}>Budget</Text>
                    <Text style={{ fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: themeColors.success }}>
                      {formatMoney(project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: themeColors.info, borderRadius: Tokens.radius.md, padding: 12, alignItems: 'center' as const }}>
                    <Text style={{ fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.info }}>Spent</Text>
                    <Text style={{ fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: themeColors.info }}>
                      {formatMoney(allInvoices.filter(inv => inv.projectId === id).reduce((s, inv) => s + (inv.amountPaid ?? 0), 0))}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.coAddBtn}
                  onPress={() => navigateFromTile({ pathname: '/budget-dashboard' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-budget-dashboard"
                >
                  <DollarSign size={16} color={themeColors.success} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.success }]}>Full Budget Dashboard</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/job-costing' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-job-costing"
                >
                  <BarChart3 size={16} color={themeColors.accent} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Job Cost-to-Complete</Text>
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
            <Camera size={20} color={themeColors.info} />
            <Text style={styles.sectionTitle}>
              Photos ({projectPhotos.length})
            </Text>
            {expanded.photos ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.photos && (
            <View style={styles.coCard}>
              {projectPhotos.length === 0 && (
                <Text style={styles.coEmptyText}>No photos yet. Photos from daily reports will appear here.</Text>
              )}
              {projectPhotos.length > 0 && (
                <TouchableOpacity
                  style={styles.photoShareBtn}
                  onPress={() => { void handleSharePhotoTimeline(); }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Share photo timeline link"
                  testID="photos-share-timeline"
                >
                  <Share2 size={14} color={themeColors.accent} />
                  <Text style={styles.photoShareBtnText}>Share read-only timeline</Text>
                  <Text style={styles.photoShareBtnHint}>{projectPhotos.length > PHOTO_SHARE_MAX ? `${PHOTO_SHARE_MAX} most recent` : 'No login needed'}</Text>
                </TouchableOpacity>
              )}
              {projectPhotos.length > 0 && (() => {
                // Build tag filter chips from the actual data — every distinct
                // tag becomes a chip, plus an "All" at the front. New tags
                // appear automatically without code changes.
                const tagCounts = projectPhotos.reduce<Record<string, number>>((acc, p) => {
                  const t = (p.tag ?? 'Untagged').trim() || 'Untagged';
                  acc[t] = (acc[t] ?? 0) + 1;
                  return acc;
                }, {});
                const chips: FilterChip<string>[] = [
                  { value: 'all', label: 'All', count: projectPhotos.length },
                  ...Object.entries(tagCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tag, count]) => ({ value: tag, label: tag, count })),
                ];
                const filtered = photoFilter === 'all'
                  ? projectPhotos
                  : projectPhotos.filter(p => (p.tag ?? 'Untagged').trim() === photoFilter || ((p.tag ?? '').trim() === '' && photoFilter === 'Untagged'));
                // Show 12 thumbs at this density; user can hit the gallery
                // for the full set (route TBD — for now we show the count).
                const visible = filtered.slice(0, 12);
                return (
                  <>
                    <FilterChipRow
                      chips={chips}
                      value={photoFilter}
                      onChange={setPhotoFilter}
                      noPadding
                      testID="photos-tag-filter"
                    />
                    <View style={styles.photoGrid}>
                      {visible.map(photo => (
                        <TouchableOpacity
                          key={photo.id}
                          style={styles.photoThumb}
                          activeOpacity={0.85}
                          onPress={() => setLightboxPhoto(photo)}
                          testID={`photo-thumb-${photo.id}`}
                        >
                          {photo.uri ? (
                            <Image source={{ uri: photo.uri }} style={styles.photoThumbImage} resizeMode="cover" />
                          ) : (
                            <Camera size={20} color={themeColors.textMuted} />
                          )}
                          {(photo.markup?.length ?? 0) > 0 && (
                            <View style={styles.photoThumbMarkupBadge}>
                              <Pencil size={10} color={themeColors.surface} />
                            </View>
                          )}
                          <View style={styles.photoThumbDateOverlay}>
                            <Text style={styles.photoThumbDate}>{new Date(photo.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {filtered.length > 12 && (
                      <Text style={styles.punchMoreText}>+{filtered.length - 12} more in this filter</Text>
                    )}
                  </>
                );
              })()}
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
            <Globe size={20} color={themeColors.info} />
            <Text style={styles.sectionTitle}>Client Portal</Text>
            {expanded.clientPortal ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.clientPortal && (
            <View style={styles.coCard}>
              <View style={styles.portalInfo}>
                <Globe size={24} color={themeColors.info} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.portalTitle}>Share Project with Client</Text>
                  <Text style={styles.portalDesc}>Read-only link with progress, invoices, photos and more. Toggle exactly what your client sees.</Text>
                </View>
              </View>
              {project.clientPortal?.enabled ? (
                <>
                  <View style={styles.portalLinkRow}>
                    <View style={styles.portalLinkBox}>
                      <Link size={12} color={themeColors.info} />
                      <Text style={styles.portalLinkText} numberOfLines={1}>mageid.app/portal/{project.clientPortal.portalId}</Text>
                    </View>
                    <TouchableOpacity style={styles.portalCopyBtn} onPress={() => { Alert.alert('Copied', 'Portal link copied to clipboard.'); }} accessibilityRole="button" accessibilityLabel="Copy">
                      <Copy size={14} color={themeColors.accent} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.portalInviteCount}>
                    <Users size={13} color={themeColors.textMuted} />
                    <Text style={styles.portalInviteCountText}>
                      {project.clientPortal.invites?.length ?? 0} client{(project.clientPortal.invites?.length ?? 0) !== 1 ? 's' : ''} invited
                    </Text>
                  </View>

                  {/* Inline permission toggles. Tapping a switch flips the
                      single key on project.clientPortal — same call shape
                      as on the dedicated setup screen. */}
                  <View style={styles.portalTogglesLabelRow}>
                    <Text style={styles.portalTogglesLabel}>What clients can see</Text>
                  </View>
                  <View style={styles.portalTogglesCard}>
                    {PORTAL_INLINE_TOGGLES.map((row, idx) => {
                      const current = (project.clientPortal as any)?.[row.key] as boolean | undefined;
                      return (
                        <View
                          key={row.key}
                          style={[
                            styles.portalToggleRow,
                            idx < PORTAL_INLINE_TOGGLES.length - 1 && styles.portalToggleRowBorder,
                          ]}
                        >
                          <Text style={styles.portalToggleLabel}>{row.label}</Text>
                          <Switch
                            value={!!current}
                            onValueChange={val => {
                              if (!id) return;
                              const cp = project.clientPortal!;
                              updateProject(id, { clientPortal: { ...cp, [row.key]: val } });
                            }}
                            trackColor={{ false: themeColors.line, true: themeColors.accent }}
                            thumbColor="#FFF"
                            testID={`portal-inline-${row.key}`}
                          />
                        </View>
                      );
                    })}
                  </View>

                  {/* Quick entry into the messaging thread. MUST go through
                      navigateFromTile, not router.push — this section
                      renders inside the iOS pageSheet tile-modal, and a
                      naked push would mount the messages screen BEHIND
                      the sheet (only visible after Back). */}
                  <TouchableOpacity
                    style={styles.portalMessagesRow}
                    onPress={() => navigateFromTile({ pathname: '/client-messages', params: { id } })}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Open messages"
                  >
                    <MessageSquare size={14} color={themeColors.accent} />
                    <Text style={styles.portalMessagesText}>Messages</Text>
                    <Text style={styles.portalMessagesOpen}>Open ›</Text>
                  </TouchableOpacity>

                  {/* Less-common options (passcode, welcome msg, homeowner
                      language, weekly update) still live on the dedicated
                      screen. Renamed from "Manage Portal Settings" to a
                      lighter "Advanced settings" link. */}
                  <TouchableOpacity
                    style={styles.portalAdvancedLink}
                    onPress={() => navigateFromTile({ pathname: '/client-portal-setup', params: { id } })}
                    activeOpacity={0.7}
                    testID="portal-advanced-link"
                  >
                    <Text style={styles.portalAdvancedLinkText}>Advanced settings (passcode, language, welcome) ›</Text>
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
                  <Globe size={16} color={themeColors.info} />
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
            <Mail size={20} color={themeColors.info} />
            <Text style={styles.sectionTitle}>Communications</Text>
            <View style={styles.coBadge}>
              <Text style={styles.coBadgeText}>{commEvents.length}</Text>
            </View>
            {expanded.communications ? (
              <ChevronUp size={18} color={themeColors.textMuted} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} />
            )}
          </TouchableOpacity>

          {expanded.communications && (
            <View style={styles.coCard}>
              {commEvents.length === 0 ? (
                <View style={styles.commEmpty}>
                  <Mail size={24} color={themeColors.textMuted} />
                  <Text style={styles.commEmptyText}>No activity yet. Sending documents, approvals, and notes will appear here.</Text>
                </View>
              ) : (
                commEvents.slice(0, 10).map(event => (
                  <View key={event.id} style={styles.commEventRow}>
                    <View style={[styles.commEventDot, {
                      backgroundColor: event.type.includes('approved') ? themeColors.success
                        : event.type.includes('rejected') ? themeColors.danger
                        : event.type.includes('overdue') ? themeColors.accent
                        : event.isPrivate ? themeColors.textMuted
                        : themeColors.info
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
                <Plus size={14} color={themeColors.info} />
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
                <PenTool size={12} color={themeColors.accent} />
                <Text style={styles.signatureNoteText}>Signature will be included</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.shareBtnPrimary}
              onPress={() => setShowShareModal(true)}
              activeOpacity={0.7}
              testID="open-share-modal"
            >
              <Share2 size={18} color={"#FFFFFF"} />
              <Text style={styles.shareBtnPrimaryText}>Share Estimate</Text>
            </TouchableOpacity>
          </View>
        )}

        {!hasAnyEstimate && (
          <View style={styles.noEstimate}>
            <AlertTriangle size={32} color={themeColors.accent} />
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
          <Pencil size={18} color={themeColors.accent} />
          <Text style={styles.editButtonText}>Edit Project</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} activeOpacity={0.7}>
          <Trash2 size={18} color={themeColors.danger} />
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
              testID="close-detail-modal" accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={themeColors.text} />
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
              <TouchableOpacity onPress={() => setShowShareModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.shareModalDesc}>
              Choose how to share your estimate{project.schedule ? ' and schedule' : ''}. PDFs include your company branding{branding.signatureData?.length ? ', logo, and signature' : branding.logoUri ? ' and logo' : ''}.
            </Text>

            <TouchableOpacity style={styles.shareOption} onPress={handleSharePDF} activeOpacity={0.7} testID="share-pdf-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: themeColors.accent + '12' }]}>
                <FileText size={20} color={themeColors.accent} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Share as PDF</Text>
                <Text style={styles.shareOptionDesc}>Professional document with full branding</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shareOption} onPress={handleShareEmail} activeOpacity={0.7} testID="share-email-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: themeColors.info + '12' }]}>
                <Mail size={20} color={themeColors.info} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Send via Email</Text>
                <Text style={styles.shareOptionDesc}>Formatted text in your email client</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shareOption} onPress={handleShareText} activeOpacity={0.7} testID="share-text-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: themeColors.success + '12' }]}>
                <MessageSquare size={20} color={themeColors.success} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Send via Text</Text>
                <Text style={styles.shareOptionDesc}>Quick summary with cost breakdown</Text>
              </View>
            </TouchableOpacity>

            {project.schedule && (
              <TouchableOpacity style={styles.shareOption} onPress={handleShareSchedulePDF} activeOpacity={0.7} testID="share-schedule-option">
                <View style={[styles.shareOptionIcon, { backgroundColor: themeColors.accent + '12' }]}>
                  <CalendarDays size={20} color={themeColors.accent} />
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
                  <TouchableOpacity onPress={() => setShowEditModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.inviteFieldLabel}>Project Name</Text>
                <TextInput
                  style={styles.inviteInput}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="Project name"
                  placeholderTextColor={themeColors.textMuted}
                  testID="edit-name-input"
                />

                <Text style={styles.inviteFieldLabel}>Description</Text>
                <TextInput
                  style={[styles.inviteInput, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]}
                  value={editDescription}
                  onChangeText={setEditDescription}
                  placeholder="Brief description..."
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  testID="edit-desc-input"
                />

                <Text style={styles.inviteFieldLabel}>Location</Text>
                <TextInput
                  style={styles.inviteInput}
                  value={editLocation}
                  onChangeText={setEditLocation}
                  placeholder="City, State"
                  placeholderTextColor={themeColors.textMuted}
                  testID="edit-location-input"
                />

                <Text style={styles.inviteFieldLabel}>Square Footage</Text>
                <TextInput
                  style={styles.inviteInput}
                  value={editSquareFootage}
                  onChangeText={setEditSquareFootage}
                  placeholder="e.g. 2000"
                  placeholderTextColor={themeColors.textMuted}
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
                <TouchableOpacity onPress={() => setShowInviteModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} />
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
                placeholderTextColor={themeColors.textMuted}
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
                placeholderTextColor={themeColors.textMuted}
                testID="invite-name-input"
              />

              <Text style={styles.inviteFieldLabel}>Role</Text>
              <View style={styles.inviteRoleRow}>
                <TouchableOpacity
                  style={[styles.inviteRoleBtn, inviteRole === 'editor' && styles.inviteRoleBtnActive]}
                  onPress={() => setInviteRole('editor')}
                  activeOpacity={0.7}
                >
                  <PenTool size={14} color={inviteRole === 'editor' ? "#FFFFFF" : themeColors.text} />
                  <Text style={[styles.inviteRoleBtnText, inviteRole === 'editor' && styles.inviteRoleBtnTextActive]}>Editor</Text>
                  <Text style={[styles.inviteRoleDesc, inviteRole === 'editor' && { color: 'rgba(255,255,255,0.7)' }]}>Can edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.inviteRoleBtn, inviteRole === 'viewer' && styles.inviteRoleBtnActive]}
                  onPress={() => setInviteRole('viewer')}
                  activeOpacity={0.7}
                >
                  <Eye size={14} color={inviteRole === 'viewer' ? "#FFFFFF" : themeColors.text} />
                  <Text style={[styles.inviteRoleBtnText, inviteRole === 'viewer' && styles.inviteRoleBtnTextActive]}>Viewer</Text>
                  <Text style={[styles.inviteRoleDesc, inviteRole === 'viewer' && { color: 'rgba(255,255,255,0.7)' }]}>Read only</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.inviteActionRow}>
                <TouchableOpacity style={styles.inviteCancelBtn} onPress={() => setShowInviteModal(false)} activeOpacity={0.8}>
                  <Text style={styles.inviteCancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.inviteSendBtn} onPress={handleInvite} activeOpacity={0.85} testID="send-invite-btn">
                  <Send size={16} color={"#FFFFFF"} />
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

      {/* Photo lightbox — full-screen image viewer when a thumb is tapped.
          Tap anywhere or the close button to dismiss. Built-in modal so
          we don't need a separate gallery screen for the common case. */}
      <Modal
        visible={lightboxPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxPhoto(null)}
      >
        <Pressable style={styles.lightboxOverlay} onPress={() => setLightboxPhoto(null)}>
          {lightboxPhoto && (
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={styles.lightboxImageWrap}
            >
              <Image source={{ uri: lightboxPhoto.uri }} style={styles.lightboxImage} resizeMode="contain" />
              {/* Markup overlay — re-renders the same SVG primitives the
                  annotator drew, scaled to the displayed image. We use
                  the actual rendered size (square crop) for now; web/RN
                  return wraps via flexbox so this lines up. */}
              {(lightboxPhoto.markup?.length ?? 0) > 0 && (
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  <PhotoMarkupOverlay markup={lightboxPhoto.markup ?? []} />
                </View>
              )}
            </Pressable>
          )}
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setLightboxPhoto(null)}
            activeOpacity={0.7}
            testID="photo-lightbox-close" accessibilityRole="button" accessibilityLabel="Close">
            <X size={20} color={themeColors.surface} />
          </TouchableOpacity>
          {lightboxPhoto && (
            <TouchableOpacity
              style={styles.lightboxMarkupBtn}
              onPress={() => {
                const photoToEdit = lightboxPhoto;
                setLightboxPhoto(null);
                setTimeout(() => {
                  router.push({ pathname: '/photo-annotator' as any, params: { photoId: photoToEdit.id } });
                }, 100);
              }}
              activeOpacity={0.85}
              testID="photo-lightbox-markup"
            >
              <Pencil size={14} color={themeColors.surface} />
              <Text style={styles.lightboxMarkupBtnText}>{(lightboxPhoto.markup?.length ?? 0) > 0 ? 'Edit markup' : 'Add markup'}</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Modal>

      {/* Always-rendered FAB; UniversalMicButton hides itself internally
          when there's no project to scope to. Keeps the parent hook tree
          stable across project-loading transitions. */}
      <UniversalMicButton projectId={project?.id} />
    </View>
  );
}

// Renders a list of PhotoMarkup primitives over an absolute-positioned
// View. Coordinates are normalized 0..1 so we measure on layout and
// scale to the actual rendered size — the lightbox image uses
// `resizeMode="contain"` and the SVG overlay sizes itself to the
// container, which gives a consistent overlay across phones / tablets
// / web.
const COLOR_HEX_MARKUP: Record<'red' | 'yellow' | 'green', string> = {
  red:    '#E5484D',
  yellow: '#F5A623',
  green:  '#1E8E4A',
};
function PhotoMarkupOverlay({ markup }: { markup: PhotoMarkup[] }) {
  const { colors: themeColors } = useTheme();
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // Defensive: a photo persisted before markup support, or a partial AI
  // tool failure, can leave `markup` undefined. Treat non-array as empty.
  const safeMarkup = Array.isArray(markup) ? markup : [];
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size.w > 0 && size.h > 0 && (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          {safeMarkup.map((m, i) => {
            const stroke = COLOR_HEX_MARKUP[m.color];
            // Use the smaller dimension as the normalization basis so a
            // square-canvas overlay still works on a non-square image.
            const w = size.w;
            const h = size.h;
            if (m.type === 'arrow') {
              const [p1, p2] = m.points;
              const x1 = p1.x * w, y1 = p1.y * h, x2 = p2.x * w, y2 = p2.y * h;
              const dx = x2 - x1, dy = y2 - y1;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / len, uy = dy / len;
              const head = 14;
              const left = `${x2 - ux * head + uy * head / 2},${y2 - uy * head - ux * head / 2}`;
              const right = `${x2 - ux * head - uy * head / 2},${y2 - uy * head + ux * head / 2}`;
              return (
                <React.Fragment key={`a-${i}`}>
                  <SvgLine x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
                  <SvgPolygon points={`${x2},${y2} ${left} ${right}`} fill={stroke} />
                </React.Fragment>
              );
            }
            if (m.type === 'circle') {
              const [p1, p2] = m.points;
              const cx = (p1.x + p2.x) / 2 * w;
              const cy = (p1.y + p2.y) / 2 * h;
              const r = Math.sqrt((p2.x - p1.x) ** 2 * w * w + (p2.y - p1.y) ** 2 * h * h) / 2;
              return <SvgCircle key={`c-${i}`} cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={3} fill="none" />;
            }
            if (m.type === 'freehand') {
              const d = m.points
                .map((p, j) => `${j === 0 ? 'M' : 'L'}${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`)
                .join(' ');
              return <SvgPath key={`f-${i}`} d={d} stroke={stroke} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
            }
            if (m.type === 'text' && m.text) {
              const [p] = m.points;
              const x = p.x * w, y = p.y * h;
              const len = m.text.length * 8 + 16;
              return (
                <React.Fragment key={`t-${i}`}>
                  <SvgPolygon
                    points={`${x},${y - 16} ${x + len},${y - 16} ${x + len},${y + 8} ${x},${y + 8}`}
                    fill={stroke}
                    opacity={0.92}
                  />
                  <SvgTextEl x={x + 8} y={y + 2} fill={themeColors.surface} fontSize={13} fontWeight="700">{m.text}</SvgTextEl>
                </React.Fragment>
              );
            }
            return null;
          })}
        </Svg>
      )}
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subheadline.fontSize, color: themeColors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: themeColors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: Tokens.radius.md },
  backBtnText: { color: "#FFFFFF", fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
  heroCard: { backgroundColor: themeColors.accent, marginHorizontal: 20, marginTop: 16, borderRadius: 20, padding: 22, shadowColor: themeColors.accentLabel, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8 },
  heroHeader: { marginBottom: 16 },
  heroTitleBlock: {},
  heroName: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: "#FFFFFF", letterSpacing: -0.3 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  heroMetaText: { fontSize: Type.bodyCompact.fontSize, color: 'rgba(255,255,255,0.75)' },
  heroDesc: { fontSize: Type.footnote.fontSize, color: 'rgba(255,255,255,0.6)', marginTop: 6, lineHeight: 18 },
  heroStats: {},
  heroStatMain: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: Tokens.radius.lg, padding: 16, alignItems: 'center', marginBottom: 12 },
  heroTapHint: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: '500' as const, marginTop: 4, letterSpacing: 0.3 },
  heroStatLabel: { fontSize: Type.footnote.fontSize, color: 'rgba(255,255,255,0.7)', fontWeight: '500' as const, marginBottom: 4 },
  heroStatValue: { fontSize: 32, fontWeight: '800' as const, color: "#FFFFFF", letterSpacing: -1 },
  heroStatsRow: { flexDirection: 'row', gap: 8 },
  heroStatSmall: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: Tokens.radius.md, padding: 10, alignItems: 'center' },
  smallStatLabel: { fontSize: Type.caption2.fontSize, color: 'rgba(255,255,255,0.6)', fontWeight: '500' as const, marginBottom: 2 },
  smallStatValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  section: { marginHorizontal: 20, marginTop: 18 },
  // Section headers across project-detail. Bumped border weight 1 → 1.5px
  // and ink-tinted color so each section reads as its own card with a
  // clear edge. Title size 16 → 17 with -0.3 tracking and 800 weight to
  // match the new project-card typography.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1.5,
    borderColor: themeColors.text + '12',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionTitle: {
    flex: 1,
    fontSize: Type.body.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
    letterSpacing: -0.3,
  },
  tableContainer: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, marginTop: 8, borderWidth: 1, borderColor: themeColors.line, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  tableHeaderText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  tableRowAlt: { backgroundColor: themeColors.surfaceAlt },
  tableCellName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, color: themeColors.text },
  tableCellSub: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2 },
  tableCell: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary },
  tableCellBold: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  bulkBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  bulkBadgeText: { fontSize: 10, fontWeight: '600' as const, color: themeColors.success },
  savingsBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  savingsText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.success },
  linkedSummaryRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 12, gap: 8, backgroundColor: themeColors.accent + '06', borderTopWidth: 1, borderTopColor: themeColors.accent + '15' },
  linkedSummaryItem: { flex: 1, alignItems: 'center', gap: 2 },
  linkedSummaryLabel: { fontSize: Type.caption2.fontSize, fontWeight: '500' as const, color: themeColors.textSecondary },
  linkedSummaryValue: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  summaryCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 18, marginTop: 8, borderWidth: 1, borderColor: themeColors.line },
  scheduleCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 16, marginTop: 8, borderWidth: 1, borderColor: themeColors.line },
  scheduleTopRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  scheduleMetric: { flex: 1, backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.card, padding: 12 },
  scheduleMetricLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  scheduleMetricValue: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  scheduleSectionTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text, marginBottom: 10 },
  scheduleTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: themeColors.line },
  scheduleStatusDot: { width: 8, height: 8, borderRadius: 4 },
  scheduleTaskTextWrap: { flex: 1 },
  scheduleTaskName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text, marginBottom: 2 },
  scheduleTaskMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  scheduleTaskProgress: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.info },
  crossLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, marginTop: 10, backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: themeColors.line },
  crossLinkText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  summaryLabel: { fontSize: Type.subhead.fontSize, color: themeColors.textSecondary },
  summaryValue: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  summaryDivider: { height: 1, backgroundColor: themeColors.line, marginVertical: 8 },
  savingsHighlight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  grandTotalDivider: { height: 2, backgroundColor: themeColors.accent, marginVertical: 10, borderRadius: 1 },
  grandTotalLabel: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: themeColors.text },
  grandTotalValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  notesContainer: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, padding: 16, marginTop: 8, borderWidth: 1, borderColor: themeColors.line, gap: 12 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: themeColors.accent, marginTop: 7 },
  noteText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary, lineHeight: 20 },
  noEstimate: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 40, marginTop: 20 },
  noEstimateTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text, marginTop: 12 },
  noEstimateText: { fontSize: Type.subhead.fontSize, color: themeColors.textSecondary, textAlign: 'center' as const, marginTop: 8, lineHeight: 22 },
  collabCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, marginTop: 8, borderWidth: 1, borderColor: themeColors.line, padding: 14, gap: 10 },
  collabMember: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  collabAvatar: { width: 36, height: 36, borderRadius: Tokens.radius.xl, alignItems: 'center', justifyContent: 'center' },
  collabInfo: { flex: 1, gap: 2 },
  collabName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  collabEmail: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  collabActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collabRoleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  collabRoleText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  collabRemoveBtn: { width: 28, height: 28, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.danger, alignItems: 'center', justifyContent: 'center' },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '10', borderWidth: 1, borderColor: themeColors.accent + '20', marginTop: 4 },
  inviteBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  shareSection: { marginHorizontal: 20, marginTop: 18, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 18, borderWidth: 1, borderColor: themeColors.line, gap: 12 },
  shareSectionTitle: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  shareBrandingNote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: -6 },
  signatureNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4 },
  signatureNoteText: { fontSize: Type.caption1.fontSize, color: themeColors.accent, fontWeight: '500' as const },
  shareBtnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: themeColors.accent, borderRadius: Tokens.radius.lg, paddingVertical: 14, shadowColor: themeColors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 3 },
  shareBtnPrimaryText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  editButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.accent + '10', borderRadius: Tokens.radius.card, paddingVertical: 16, gap: 8, marginHorizontal: 20, marginTop: 24, borderWidth: 1, borderColor: themeColors.accent + '20' },
  editButtonText: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  editTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  editTypeChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.card, backgroundColor: themeColors.line },
  editTypeChipActive: { backgroundColor: themeColors.accent },
  editTypeChipLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  editTypeChipLabelActive: { color: "#FFFFFF" },
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.danger, borderRadius: Tokens.radius.card, paddingVertical: 16, gap: 8, marginHorizontal: 20, marginTop: 14, borderWidth: 1, borderColor: themeColors.danger + '30' },
  deleteButtonText: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: themeColors.danger },
  shareModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'center', padding: 20 },
  shareModalCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius["2xl"], padding: 22, gap: 14, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  shareModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shareModalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  shareModalDesc: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary, lineHeight: 20 },
  shareOption: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.panel, padding: 16, borderWidth: 1, borderColor: themeColors.line },
  shareOptionIcon: { width: 44, height: 44, borderRadius: Tokens.radius.card, alignItems: 'center', justifyContent: 'center' },
  shareOptionInfo: { flex: 1, gap: 2 },
  shareOptionTitle: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  shareOptionDesc: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  inviteModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  inviteModalCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 10 },
  inviteModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  inviteModalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  inviteDesc: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary, lineHeight: 20 },
  inviteFieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  inviteInput: { minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  inviteRoleRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  inviteRoleBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line },
  inviteRoleBtnActive: { backgroundColor: themeColors.accent },
  inviteRoleBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  inviteRoleBtnTextActive: { color: "#FFFFFF" },
  inviteRoleDesc: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary },
  inviteActionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  inviteCancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  inviteCancelBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  inviteSendBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  inviteSendBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  coCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, marginTop: 8, borderWidth: 1, borderColor: themeColors.line, padding: 14, gap: 4 },
  coEmptyText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, paddingVertical: 8 },
  coRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: themeColors.line, gap: 10 },
  coInfo: { flex: 1, gap: 2 },
  coNumber: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  coDesc: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  coRight: { alignItems: 'flex-end', gap: 4 },
  coAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  invAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  coBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  coBadgeText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  coApproveRow: { flexDirection: 'row', gap: 8, paddingTop: 8 },
  coApproveBtn: { flex: 1, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.successSoft, alignItems: 'center', borderWidth: 1, borderColor: themeColors.success + '30' },
  coApproveBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.success },
  coRejectBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: Tokens.radius.md, backgroundColor: themeColors.danger, alignItems: 'center', borderWidth: 1, borderColor: themeColors.danger + '30' },
  coRejectBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.danger },
  coAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '10', borderWidth: 1, borderColor: themeColors.accent + '20', marginTop: 8 },
  coAddBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  invBtnRow: { flexDirection: 'row', gap: 8 },
  punchProgress: { marginBottom: 8 },
  punchProgressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  punchProgressLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  punchProgressPercent: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  punchProgressTrack: { height: 6, backgroundColor: themeColors.line, borderRadius: 3, overflow: 'hidden' as const },
  punchProgressFill: { height: 6, backgroundColor: themeColors.accent, borderRadius: 3 },
  punchDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  punchMoreText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, paddingVertical: 4 },
  dfrWeekBucket: { marginBottom: 8 },
  dfrWeekHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 4, paddingVertical: 6 },
  dfrWeekLabel: { flex: 1, fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  dfrWeekBadge: { backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.sm, paddingHorizontal: 7, paddingVertical: 1, minWidth: 20, alignItems: 'center' as const },
  dfrWeekBadgeText: { fontSize: 10, fontWeight: '700' as const, color: themeColors.textSecondary },
  photoShareBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accentSoft,
    borderWidth: 1,
    borderColor: themeColors.line,
    marginBottom: 12,
  },
  photoShareBtnText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700' as const,
    color: themeColors.accent,
  },
  photoShareBtnHint: {
    fontSize: 11,
    color: themeColors.textMuted,
    fontWeight: '600' as const,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  photoThumb: { width: 72, height: 72, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden' as const, position: 'relative' as const },
  photoThumbImage: { width: '100%', height: '100%' },
  photoThumbDate: { fontSize: 9, color: themeColors.surface, fontWeight: '700' as const },
  photoThumbDateOverlay: { position: 'absolute' as const, bottom: 4, left: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 1, paddingHorizontal: 4, borderRadius: 5, alignItems: 'center' as const },
  photoThumbMarkupBadge: {
    position: 'absolute' as const, top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#FF6A1A', alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  lightboxOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center' as const, justifyContent: 'center' as const, padding: 16 },
  lightboxImageWrap: { width: '100%', height: '80%', alignItems: 'center' as const, justifyContent: 'center' as const, position: 'relative' as const },
  lightboxImage: { width: '100%', height: '100%' },
  lightboxClose: { position: 'absolute' as const, top: 50, right: 20, padding: 12, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: Tokens.radius["2xl"] },
  lightboxMarkupBtn: {
    position: 'absolute' as const, bottom: 60, alignSelf: 'center' as const,
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(255,106,26,0.95)',
  },
  lightboxMarkupBtnText: { color: themeColors.surface, fontWeight: '800' as const, fontSize: Type.footnote.fontSize },
  portalInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  portalTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, marginBottom: 2 },
  portalDesc: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 18 },
  portalBadge: { alignSelf: 'flex-start' as const, backgroundColor: '#5856D6' + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm, marginBottom: 8 },
  portalBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.info },
  portalLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  portalLinkBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  portalLinkText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.info },
  portalCopyBtn: { width: 40, height: 40, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '12', alignItems: 'center', justifyContent: 'center' },
  portalEnableBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: '#5856D6' + '12', borderWidth: 1, borderColor: '#5856D6' + '20' },
  portalEnableBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.info },
  portalInviteCount: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, marginBottom: 10 },
  portalInviteCountText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  portalTogglesLabelRow: { marginTop: 4, marginBottom: 6 },
  portalTogglesLabel: {
    fontSize: 11, fontWeight: '800' as const,
    color: themeColors.textMuted,
    letterSpacing: 1.2,
  },
  portalTogglesCard: {
    backgroundColor: themeColors.surfaceAlt,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: themeColors.line,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  portalToggleRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 8,
  },
  portalToggleRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: themeColors.line },
  portalToggleLabel: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.text, fontWeight: '500' as const },
  portalMessagesRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '10',
    borderWidth: 1, borderColor: themeColors.accent + '24',
    marginBottom: 8,
  },
  portalMessagesText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.text, fontWeight: '600' as const },
  portalMessagesOpen: { fontSize: Type.caption1.fontSize, color: themeColors.accent, fontWeight: '700' as const, letterSpacing: 0.4 },
  portalAdvancedLink: {
    paddingVertical: 10, alignItems: 'center' as const,
  },
  portalAdvancedLinkText: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.accent,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  commEmpty: { alignItems: 'center' as const, paddingVertical: 20, gap: 8 },
  commEmptyText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, textAlign: 'center' as const, lineHeight: 18 },
  commEventRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  commEventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  commEventContent: { flex: 1, gap: 2 },
  commEventSummary: { fontSize: Type.footnote.fontSize, fontWeight: '500' as const, color: themeColors.text, lineHeight: 18 },
  commEventTime: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted },
  commAddNoteBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.info, marginTop: 8 },
  commAddNoteBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.info },
  quickActions: { flexDirection: 'row' as const, paddingHorizontal: 20, marginTop: 12, gap: 10, flexWrap: 'wrap' as const },
  stageStrip: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: themeColors.surface,
    borderWidth: 1,
    borderColor: themeColors.line,
    borderRadius: Tokens.radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  stageHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stageHeaderLabel: { fontSize: 11, fontWeight: '800' as const, color: themeColors.textMuted, letterSpacing: 1.2 },
  stageHeaderCount: { fontSize: 11, fontWeight: '700' as const, color: themeColors.accent, letterSpacing: 0.6 },
  stageChipsRow: { flexDirection: 'row', gap: 6 },
  stageChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageChipActive: {
    backgroundColor: themeColors.accent,
    borderColor: themeColors.accent,
  },
  stageChipPast: {
    backgroundColor: themeColors.accentSoft,
    borderColor: themeColors.accent + '40',
  },
  stageChipText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: themeColors.textSecondary,
    letterSpacing: -0.1,
  },
  stageChipTextActive: { color: '#FFFFFF' },
  stageChipTextPast: { color: themeColors.accent },
  stageProgressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: themeColors.line,
    overflow: 'hidden',
  },
  stageProgressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: themeColors.accent,
  },
  quickActionBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: themeColors.line, flexGrow: 1, flexShrink: 1, flexBasis: '47%' as const, minHeight: 56 },
  quickActionBtnFull: { flexBasis: '100%' as const },
  quickActionIcon: { width: 32, height: 32, borderRadius: Tokens.radius.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  quickActionLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text, flexShrink: 1 },
  sectionGrid: { paddingHorizontal: 20, marginTop: 18, gap: 8 },
  // Tight, predictable spacing: collapsed groups stack snugly. The body
  // has no marginBottom — separation between groups comes ONLY from
  // sectionGroups.gap, so collapsing a group never leaves phantom space.
  sectionGroups: { paddingHorizontal: 20, marginTop: 14, gap: 6 },
  tileGroup: { gap: 6 },
  tileGroupHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingHorizontal: 4, paddingVertical: 6, minHeight: 40 },
  tileGroupHeaderIcon: { width: 28, height: 28, borderRadius: Tokens.radius.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  tileGroupHeaderLabel: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  tileGroupBadge: { backgroundColor: themeColors.surfaceAlt, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 1, minWidth: 22, alignItems: 'center' as const },
  tileGroupBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  tileGroupBody: { gap: 8 },
  sectionTile: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: themeColors.line, minHeight: 56 },
  sectionTileIcon: { width: 36, height: 36, borderRadius: Tokens.radius.md, alignItems: 'center' as const, justifyContent: 'center' as const },
  sectionTileLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  sectionTileStatus: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, marginTop: 2, letterSpacing: 0.1 },
  sectionTileBadge: { backgroundColor: themeColors.line, borderRadius: Tokens.radius.md, paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center' as const },
  sectionTileBadgeText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  sectionModalHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: themeColors.line },
  sectionModalBack: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, paddingVertical: 6, paddingHorizontal: 4, minWidth: 72 },
  sectionModalBackText: { fontSize: Type.callout.fontSize, fontWeight: '500' as const, color: themeColors.accent },
  sectionModalTitle: { flex: 1, textAlign: 'center' as const, fontSize: Type.body.fontSize, fontWeight: '700' as const, color: themeColors.text },
});

const makeDetailStyles = (themeColors: ThemeColors) => StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: themeColors.bg },
  modalHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: themeColors.line, alignSelf: 'center', marginBottom: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: themeColors.line, backgroundColor: themeColors.bg },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text, letterSpacing: -0.3 },
  modalCloseBtn: { width: 32, height: 32, borderRadius: Tokens.radius.panel, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  heroSection: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, gap: 6 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: themeColors.accent + '12', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  heroAmount: { fontSize: 38, fontWeight: '800' as const, color: themeColors.text, letterSpacing: -1.5 },
  heroSubtitle: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary, fontWeight: '500' as const },
  heroChips: { flexDirection: 'row', gap: 10, marginTop: 14 },
  heroChip: { backgroundColor: themeColors.line, borderRadius: Tokens.radius.card, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', gap: 2 },
  heroChipLabel: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  heroChipSub: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, fontWeight: '500' as const },
  sectionLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 8, marginTop: 4 },
  barChartWrap: { marginHorizontal: 20, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 16, gap: 16, marginBottom: 20, borderWidth: 1, borderColor: themeColors.line },
  barRow: { gap: 6 },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, color: themeColors.text },
  barPct: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: themeColors.line, overflow: 'hidden' as const },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  additionalCard: { marginHorizontal: 20, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: themeColors.line },
  additionalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  additionalLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  additionalDot: { width: 8, height: 8, borderRadius: 4 },
  additionalLabel: { fontSize: Type.subhead.fontSize, color: themeColors.text, fontWeight: '500' as const },
  additionalRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  additionalValue: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text },
  additionalPct: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textMuted, backgroundColor: themeColors.line, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' as const },
  additionalDivider: { height: 1, backgroundColor: themeColors.line, marginVertical: 4 },
  fullBreakdownCard: { marginHorizontal: 20, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 18, gap: 8, marginBottom: 20, borderWidth: 1, borderColor: themeColors.line },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary },
  breakdownValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  breakdownLabelBold: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  breakdownValueBold: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  breakdownDivider: { height: 1, backgroundColor: themeColors.line },
  breakdownDividerThick: { height: 2, backgroundColor: themeColors.accent + '30', borderRadius: 1, marginVertical: 4 },
  grandLabel: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: themeColors.text },
  grandValue: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  infoCard: { marginHorizontal: 20, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 16, gap: 16, marginBottom: 20, borderWidth: 1, borderColor: themeColors.line },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoStep: { width: 28, height: 28, borderRadius: Tokens.radius.lg, alignItems: 'center', justifyContent: 'center' },
  infoStepNum: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  infoTextWrap: { flex: 1 },
  infoTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  infoDesc: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 19, marginTop: 2 },
  topSaversCard: { marginHorizontal: 20, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: themeColors.line },
  saverRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  saverRank: { width: 26, height: 26, borderRadius: 13, backgroundColor: themeColors.successSoft, alignItems: 'center', justifyContent: 'center' },
  saverRankText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.success },
  saverInfo: { flex: 1, gap: 2 },
  saverName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, color: themeColors.text },
  saverMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  saverSavings: { alignItems: 'flex-end', gap: 1 },
  saverAmount: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.success },
  saverPct: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.success },
  saverDivider: { height: 1, backgroundColor: themeColors.line },
});
