import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Modal,
  TextInput, Pressable, KeyboardAvoidingView, Image, LayoutAnimation, UIManager, Switch,
} from 'react-native';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import CraneLoader from '@/components/CraneLoader';
import ProjectHero from '@/components/ProjectHero';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import {
  DollarSign, Users, TrendingDown, MapPin, Presentation, Gavel,
  ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Trash2, Package, AlertTriangle, CalendarDays,
  Mail, MessageSquare, X, BarChart3, ArrowDownRight, Shield, ShieldAlert, ScanSearch, Layers, Scale, ShieldCheck,
  FileText, ShoppingCart, UserPlus, Send, Share2, Eye, PenTool, Crown, Pencil, ScanLine,
  Plus, Receipt, ClipboardList, Repeat, CheckSquare, Camera, ImagePlus, Globe, Link, Copy, Wallet, Archive, Activity,
  HardHat, FolderOpen, ScrollText, BookOpen, Footprints,
  Clock, Lock, Mic, FileSignature, CalendarClock, Truck, Info,
} from 'lucide-react-native';
import {
  MageAIMark, MageRFI, MageSubmittal, MagePlans, MagePunch,
  MageEstimate, MageSchedule, MageContract, MageChangeOrder, MageInvoice,
  MageDailyReport, MageMargin,
} from '@/components/icons';
import { cleanProjectTypeOther, projectTypeBlockReason, PROJECT_TYPE_OTHER_MAX } from '@/utils/projectTypes';
import { PROJECT_TYPES, CONTRACT_MODES, CONTRACT_MODE_LABELS, CONTRACT_TERM_RANGES, type ContractMode, type Project, type ProjectContract, type ProjectType, type EntityRef, type ProjectPhoto, type PhotoMarkup, type EstimateChangeReason, type EstimateRevision, type PortalState, type ChangeOrder } from '@/types';
import { COScheduleReflowPreviewModal } from '@/components/schedule/COScheduleReflowPreviewModal';
import { CollaboratorsManager } from '@/components/collaborators/CollaboratorsManager';
import { diffEstimates, snapshotPatch, restorePatch, effectiveEstimateTotal } from '@/utils/estimateCommit';
import BidConfidenceBadge from '@/components/BidConfidenceBadge';
import Svg, { Path as SvgPath, Circle as SvgCircle, Line as SvgLine, Polygon as SvgPolygon, Text as SvgTextEl } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useProjectCapGate } from '@/hooks/useProjectCapGate';
import { isSampleProjectName } from '@/utils/projectCap';
import { deleteProjectSafetyRefusal, DELETE_SAFETY_ACTION } from '@/utils/projectContextPure';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { useQueryClient } from '@tanstack/react-query';
import Paywall from '@/components/Paywall';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import EntityActionSheet from '@/components/EntityActionSheet';
import { generateUUID } from '@/utils/generateId';
import { stampPhotoLocation } from '@/utils/photoGeoStamp';
import AIProjectReport from '@/components/AIProjectReport';
import AIAutoScheduleButton from '@/components/AIAutoScheduleButton';
import { generateAndSharePDF, buildEstimateTextForEmail, generateRFILogPDF } from '@/utils/pdfGenerator';
import { getOfflineQueue, processOfflineQueue } from '@/utils/offlineQueue';
import { processPhotoUploadQueue } from '@/utils/photoUploadQueue';
import { requestSyncSheet } from '@/utils/syncLedger';
import { insertStillQueued } from '@/utils/invoiceWrites';
import {
  teamCountLabel, filedByLine, leaveDialogCopy, leftProjectMessage, missingProjectView, JUST_JOINED_NOT_LOADED,
} from '@/utils/projectRole';
import { invoiceRoleGate, INVOICE_OWNER_ONLY_REASON } from '@/utils/billingFlowCore';
import { computeBulkSavings } from '@/utils/bulkSavings';
import {
  buildPhotoSharePayload,
  encodePhotoShareToken,
  groupPhotosByDay,
  PHOTO_SHARE_MAX,
} from '@/utils/photoShareToken';
import { buildShareUrl } from '@/utils/webAppOrigin';
import { NextStepHero } from '@/components/NextStepHero';
import { generateAndShareCloseoutPacket } from '@/utils/closeoutPacketGenerator';
import { prefetchProjectPlans } from '@/utils/planPrefetch';
import HardHatTap from '@/components/animations/HardHatTap';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import BlueprintReveal from '@/components/animations/BlueprintReveal';
import InspectionReadyCard from '@/components/inspectionPrep/InspectionReadyCard';
import CodeLookSheet from '@/components/codeLook/CodeLookSheet';
import BuildingRecordCard from '@/components/buildingRecord/BuildingRecordCard';
import ProjectCodeChecksCard from '@/components/codeThread/ProjectCodeChecksCard';
import ScopeGapsCard from '@/components/scopeGaps/ScopeGapsCard';
import { fireConfetti } from '@/components/animations/Confetti';
import ConcretePour from '@/components/animations/ConcretePour';
import { nailIt } from '@/components/animations/NailItToast';
import { AnimatedFill } from '@/components/animations/AnimatedFill';
import { CollapseChevron } from '@/components/animations/CollapseChevron';
import FilterChipRow, { type FilterChip } from '@/components/FilterChipRow';
import { exportProjectIcs } from '@/utils/icsGenerator';
import { exportProjectAccountingCsv, type AccountingFormat } from '@/utils/accountingExport';
import { formatMoney, displayText, parseLenientNumber } from '@/utils/formatters';
import { canViewFinancials, isFinancialsBlinded, ROLE_LABELS } from '@/utils/roleBlinding';
import { pricingRoleFor } from '@/utils/fieldTicketCore';
import { useAuth } from '@/contexts/AuthContext';
import { getEffectiveInvoiceStatus, getDaysPastDue } from '@/utils/projectFinancials';
import { invoiceOutstanding, invoiceIsSettled } from '@/utils/invoiceBilling'; // MONEY-F5
import { computeARAgingReport } from '@/utils/financialReports';
import { fetchActiveContract } from '@/utils/contractEngine';
import { fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { fetchCloseoutBinder } from '@/utils/closeoutBinderEngine';
import { loadLienWaiversChecked } from '@/utils/lienWaiverEngine';
import { STATUS_TONES } from '@/utils/statusPill';
import { supabase } from '@/lib/supabase';
import { portalShareUrl, maskPortalLinkToken, proposalBlockReason } from '@/utils/portalSnapshot';
import { Button } from '@/components/ui';
import ClientDocumentAskSheet from '@/components/ClientDocumentAskSheet';
import { useClientDocumentGate } from '@/hooks/useClientDocumentGate';
import { toClientEstimateView } from '@/utils/clientEstimateView';
import { nextProposalStamp, proposalTermsState, splitLabel } from '@/utils/paymentTerms';
import { syncPortalSnapshotLite } from '@/utils/portalLiteSync';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { showAlert, showPrompt } from '@/utils/alert';
import { daysUntilCalendarDay, dayOrInstantDate, calendarDayOf } from '@/utils/calendarDate';
import { pdfFailureMessage } from '@/utils/platformFile';
// Wave 6c, lane E — the desktop workspace (see the render's `isDesktop ?`).
import { tileGridColumns, useIsDesktopWeb } from '@/components/ui/desktop';
import { TileGrid } from '@/components/ui/TileGrid';
import { segmentedDesktop } from '@/components/ui/SegmentedControl';
import { useSheetFrame, useSheetPrimaryHotkey, useSheetDialogScope, SheetOverlay, SheetScrim } from '@/components/ui/Sheet';
import { canOpenSchedulePro, proFitsWindow, scheduleDestination, SCHEDULE_PRO_FEATURE } from '@/utils/scheduleRoute';
import { getSidebarRail } from '@/utils/sidebarRailStore';
import { SidePanel } from '@/components/desktop/SidePanel';
import { RowLink, routeHref } from '@/components/desktop/RowLink';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { useProjectPulse } from '@/hooks/useProjectPulse';
import { ProjectWorkspaceHeader } from '@/components/project/ProjectWorkspaceHeader';
import { ProjectKpiStrip } from '@/components/project/ProjectKpiStrip';
import { ProjectOverviewColumns } from '@/components/project/ProjectOverviewColumns';
import { PROJECT_STAGES, STAGE_LABELS, STAGE_TO_STATUS, stageForStatus, type ProjectStage } from '@/utils/projectStage';
import {
  LIST_SECTION_ROUTES, isListSection, isPanelSection, sectionIndexHref, sectionTitle,
} from '@/utils/projectWorkspaceLayout';
// Learn-by-doing tutorials (utils/tutorial): every hub tile and group header is
// a spotlight target — each tutorial ends by lighting the tile its result
// landed on ("Daily Reports · 5"). Idle cost: a View and a Map write each.
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { TutorialScrollAnchor } from '@/components/tutorial/TutorialScrollAnchor';
import { useTutorialPractice } from '@/utils/tutorial/store';
import type { FeatureKey } from '@/utils/tutorial/types';
import {
  computeDailyLogCompletion, calendarOfSchedule,
  dailyLogHeadline, dailyLogEmptyDayLine, dailyLogGapLine, dailyLogTodayLine,
} from '@/utils/dailyLogCompletion';

const ESTIMATE_REASON_LABEL: Record<EstimateChangeReason, string> = {
  manual: 'Manual save',
  sent_to_client: 'Sent to client',
  converted_to_contract: 'Converted to contract',
  pre_overwrite: 'Before re-estimate',
  restore: 'Restored',
  xray: 'Cost X-Ray scan',
};

// Enable LayoutAnimation on Android (no-op on iOS — already enabled).
// Without this, the smooth collapse/expand animation only works on iOS.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}


type SectionKey = 'linkedEstimate' | 'materials' | 'labor' | 'summary' | 'schedule' | 'notes' | 'collaborators' | 'changeOrders' | 'invoices' | 'dailyReports' | 'fieldTickets' | 'punchList' | 'rfis' | 'submittals' | 'oacMeetings' | 'budget' | 'photos' | 'clientPortal' | 'communications' | 'activity' | 'calendar' | 'plans' | 'permits' | 'contract' | 'selections' | 'lienWaivers' | 'closeoutBinder' | 'handover' | 'timeTracking' | 'projectFiles' | 'scope' | 'deliveries' | 'safety' | 'aiReport';

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

// ─── Lifecycle stages ──
// The 4-stage construction lifecycle, mapped onto the 5 underlying
// Project.status values. The table is utils/projectStage — one source for this
// page's chips, the desktop stage switch and Home's stage filter (wave 6c).
// Tapping a chip advances the project to that stage (with a confirm), landing
// on the most "settled" status in it (STAGE_TO_STATUS). Read on every render.
type LifecycleStage = ProjectStage;
const LIFECYCLE_STAGES = PROJECT_STAGES.map(key => ({ key, ...STAGE_LABELS[key] }));
const statusToStage = stageForStatus;

/** A hub tile (the phone grid and the desktop section index draw the same list). */
type Tile = { key: SectionKey; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; color: string; count: number | null };

// ── Pure hub rules ───────────────────────────────────────────────────────
// Module-level and free of React so scripts/validate-project-hub-rules.ts can
// lift each function out of this file and RUN it (the carriedOpenBook
// pattern). Keep them self-contained: no imports referenced inside.

/**
 * A change order still waiting on someone (#39). ONE predicate for both the
 * "Pending" chip's count and the list it filters: the two were separate
 * copies, neither had 'submitted', so every CO he had SENT was in no chip but
 * "All" — while its orphan "Approve CO #N" row still showed under the list.
 */
function isPendingCO(c: { status: string }): boolean {
  return c.status === 'submitted' || c.status === 'under_review' || c.status === 'revised' || c.status === 'draft';
}

/**
 * Which tiles wear a lock (#171, #91, #71, #81). The lock must say what the
 * screen behind it will do, so it asks the SAME question the screen asks:
 * project-scoped work goes through the collaborator grant (useProjectAccess),
 * OWNER-ONLY features (Permits = job_costing, the Client Portal) through his
 * own tier. While the collaborator read is in flight the project-scoped locks
 * are withheld rather than guessed — a free foreman saw "upgrade required"
 * flash on the very tiles he was invited to use.
 */
function hubLockedTileKeys(args: {
  canAccessProject: (feature: string) => boolean;
  canAccessOwnTier: (feature: string) => boolean;
  roleLoading: boolean;
}): Set<string> {
  const s = new Set<string>();
  const { canAccessProject, canAccessOwnTier, roleLoading } = args;
  if (!roleLoading) {
    if (!canAccessProject('punch_list_closeout')) s.add('punchList');
    if (!canAccessProject('rfis_submittals')) { s.add('rfis'); s.add('submittals'); }
    if (!canAccessProject('change_orders_invoicing')) { s.add('changeOrders'); s.add('fieldTickets'); }
    // Plans tile routes to /plans, which gates on 'plan_markup' (Pro).
    if (!canAccessProject('plan_markup')) s.add('plans');
    if (!canAccessProject('safety_management')) s.add('safety');
    // Time Tracking (#62): Business on his own jobs, or a field/editor seat on
    // the GC's job clocking the GC's crew on the GC's plan (crew_time_tracking,
    // the same two-way rule app/time-tracking.tsx's clock gate applies).
    if (!canAccessOwnTier('subcontractor_management') && !canAccessProject('crew_time_tracking')) s.add('timeTracking');
  }
  if (!canAccessOwnTier('job_costing')) s.add('permits');
  if (!canAccessOwnTier('client_portal')) s.add('clientPortal');
  return s;
}

/**
 * What this person may do to the JOB itself, by role (#92). Every write here
 * that RLS refuses matches 0 rows with no error, which the offline queue
 * counts as done — so a control the server will refuse must not be offered
 * as if it worked:
 *  - Delete: only the owner (projects_delete is `auth.uid() = user_id`); an
 *    editor's delete is refused too. A collaborator gets "Leave project".
 *  - Edit: owner or editor (projects_update); field and viewer see it
 *    disabled with the reason.
 *  - Money group / Financial Health: hidden unless the role may see money —
 *    FAIL CLOSED while it is unknown (canViewFinancials(null) is false).
 *  - Client Portal: owner only (its credentials are stripped for anyone else).
 * `role` is the resolved role; the owner is recognised offline from the
 * cached row by the caller (pricingRoleFor), never guessed here.
 */
function hubPermissions(role: 'owner' | 'editor' | 'viewer' | 'field' | null): {
  showMoney: boolean;
  showClientPortal: boolean;
  canDelete: boolean;
  canLeave: boolean;
  editBlockedReason: string | null;
} {
  const isOwner = role === 'owner';
  return {
    showMoney: role === 'owner' || role === 'editor' || role === 'viewer',
    showClientPortal: isOwner,
    canDelete: isOwner,
    canLeave: role === 'editor' || role === 'viewer' || role === 'field',
    editBlockedReason:
      role === 'owner' || role === 'editor' ? null
      : role === 'viewer' ? 'You have view-only access to this job — only the project owner or an editor can change its details.'
      : role === 'field' ? 'Field access runs the work on this job — only the project owner or an editor can change its details.'
      : "Your access to this job hasn't been confirmed on this device yet, so its details can't be changed here. Check your signal and reopen the job.",
  };
}

// The Team count (#173/#129) is utils/projectRole teamCountLabel: a number
// only from a roster the server has answered (never while paused offline).

/**
 * The project's RFI list order (#143). Under "Open", the one with the
 * earliest due DAY first — overdue ones at the top, undated ones last —
 * instead of newest number first, which pushed the oldest (most likely
 * overdue) RFIs below a 5-row cap. `dueDay` is calendarDayOf(dateRequired):
 * the field holds a bare day from some writers and an instant from others,
 * and a bare day compares as a string only once both are days.
 */
function sortRFIsForHub<T extends { number: number; status: string; dateRequired?: string | null }>(
  rows: T[],
  filter: string,
  dueDay: (value: string | null | undefined) => string | null,
): T[] {
  if (filter !== 'open') return rows;
  return [...rows].sort((a, b) => {
    const da = dueDay(a.dateRequired);
    const db = dueDay(b.dateRequired);
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (da && !db) return -1;
    if (!da && db) return 1;
    return b.number - a.number;
  });
}

/** Submittals that need HIS action first (#143): revise & resubmit, then
 *  rejected, then waiting on review, approved last. Stable within a rank. */
function sortSubmittalsForHub<T extends { currentStatus: string }>(rows: T[]): T[] {
  const RANK: Record<string, number> = {
    revise_resubmit: 0, rejected: 1, pending: 2, in_review: 3, approved_as_noted: 4, approved: 5,
  };
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => ((RANK[a.row.currentStatus] ?? 3) - (RANK[b.row.currentStatus] ?? 3)) || a.i - b.i)
    .map(x => x.row);
}

/** The Money group's tiles — hidden together from a role that may not see money (#92). */
const HUB_MONEY_TILE_KEYS: readonly string[] = ['budget', 'contract', 'selections', 'linkedEstimate', 'changeOrders', 'invoices', 'lienWaivers', 'closeoutBinder', 'handover'];

/** Whether a tile (or a ?tile= deep link to its section) is shown to this role. */
function hubTileVisible(key: string, perms: { showMoney: boolean; showClientPortal: boolean }): boolean {
  if (!perms.showMoney && HUB_MONEY_TILE_KEYS.includes(key)) return false;
  if (!perms.showClientPortal && key === 'clientPortal') return false;
  return true;
}

/** The feature behind each locked tile — for the reason printed on it. */
const TILE_LOCK_FEATURE: Record<string, string> = {
  punchList: 'punch_list_closeout', rfis: 'rfis_submittals', submittals: 'rfis_submittals',
  changeOrders: 'change_orders_invoicing', fieldTickets: 'change_orders_invoicing',
  plans: 'plan_markup', safety: 'safety_management', permits: 'job_costing', clientPortal: 'client_portal',
  timeTracking: 'subcontractor_management',
};

/**
 * Why a tile is locked, in words (a blocked control says why). Permits are
 * OWNER-ONLY (job_costing): a collaborator's upgrade would not open the GC's
 * permits, so he is told whose they are, not sold a plan (#91, FOUNDER #91).
 */
function tileLockReason(key: string, role: 'owner' | 'editor' | 'viewer' | 'field' | null, requiredTier: string | null): string {
  if (key === 'permits' && role != null && role !== 'owner') return 'Permits are managed by the project owner';
  // A viewer seat is not locked out by a plan — a Business upsell would be a lie.
  if (key === 'timeTracking' && role === 'viewer') return 'Clocking crew in needs a field or editor seat';
  if (!requiredTier) return 'Upgrade required';
  return `Needs ${requiredTier.charAt(0).toUpperCase()}${requiredTier.slice(1)}`;
}

/**
 * What to tell a collaborator whose "Leave project" did not go through (#92),
 * or null when it did. The server half (project-invite {action:'leave'}) ships
 * with team-invites; until it is deployed the function answers "Unknown
 * action", and that must read as "not available yet", never as done — the
 * job reappearing on the next load is exactly the silent failure #92 is about.
 */
function leaveFailureMessage(r: { reached: boolean; serverError: string | null; ok: boolean }): string | null {
  if (!r.reached) return "Couldn't reach the server, so you're still on this job. Check your signal and try again.";
  if (r.serverError && /unknown action/i.test(r.serverError)) {
    return "Leaving a project isn't available on the server yet, so you're still on this job. Ask the project owner to remove you from the Team list.";
  }
  if (r.serverError) return `The server didn't let you leave, so you're still on this job: ${r.serverError}`;
  if (!r.ok) return "The server didn't confirm you left, so you're still on this job. Try again in a moment.";
  return null;
}

export default function ProjectDetailScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  // So the tutorial coach can scroll a tile into view (TutorialScrollAnchor).
  const hubScrollRef = useRef<ScrollView>(null);
  const layout = useResponsiveLayout();
  // Wave 6c: `isDesktop` gates LAYOUT (web >= 900 CSS px, or any platform
  // >= 1024 — an iPhone never). `deskWeb` gates what only a browser has: the
  // URL (?tile=) and list-first routing to the logs.
  const isDesktop = layout.isDesktop;
  const deskWeb = useIsDesktopWeb();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const detailStyles = useThemedStyles(makeDetailStyles);
  const { navigateTo } = useEntityNavigation();
  // `tile` deep-links straight to a section modal (e.g. NextStepHero's
  // "Review RFIs" → ?tile=rfis). `edit=1` auto-opens the edit-project
  // modal. Both are consumed once on mount so the user lands ON the
  // action, not on the tile grid. (Scope + estimator now have their own
  // screens — /project-scope and /estimate-wizard?projectId — so they no
  // longer route through here.)
  // `justJoined=1` (#111/#130): he just accepted an invite — a job the list
  // has not re-read yet is "hasn't loaded", never "not found".
  const { id, tile: tileParam, edit: editParam, justJoined: justJoinedParam, prep: prepParam } =
    useLocalSearchParams<{ id: string; tile?: string; edit?: string; justJoined?: string; prep?: string }>();
  const ctx = useProjects() as any;
  const { user: authUser } = useAuth();
  const { getProject, deleteProject, updateProject, settings, getChangeOrdersForProject, getInvoicesForProject, getDailyReportsForProject, getFieldTicketsForProject, updateChangeOrder, getPunchItemsForProject, getPhotosForProject, addProjectPhoto, updateProjectPhoto, getCommEventsForProject, addCommEvent, getRFIsForProject, getSubmittalsForProject, getWarrantiesForProject, getPlanSheetsForProject, getPermitsForProject, invoices: allInvoices, changeOrders: allChangeOrders, getAIAPayAppsForProject, projectsLoaded, getBidPackagesForProject, getCommitmentsForProject, settingsLoaded, bidPackageBids, forgetSharedProject, portalListsServerRead, portalAiaListServerRead, projectsFetching, countQueuedForProject, countUnsavedForProject, flushPendingProjectSyncs } = useProjects();
  const getOACMeetingsForProject = ctx.getOACMeetingsForProject;
  const { tier } = useSubscription();
  const { canAccess, requiredTierFor } = useTierAccess();
  // Project-scoped access (#171/#91): the tile locks ask the same question
  // the screens behind them ask, so an invited foreman is not told "upgrade"
  // on the Punch List he was invited to run. Call shapes kept exactly
  // (validate-field-schedule-update pins them).
  const { canAccess: canAccessProject } = useProjectAccess(id);
  const roleState = useProjectRoleState(id);
  // Tiles whose screens hard-gate behind a paywall. Pre-fix a free user
  // tapped Punch List / RFIs / Change Orders and hit a full-screen wall
  // with no warning; a small lock on the tile sets the expectation.
  // The tutorial practice pass (utils/tutorial/practicePass), opt-in here so
  // the sample's Punch List tile the punch tutorial lights is not drawn
  // locked. Display only: every screen behind a tile runs its own gate, and
  // only punch-walk and invoice honour the pass (see hooks/useProjectAccess).
  const hubPractice = useTutorialPractice(id);
  const lockedTileKeys = useMemo(
    () => hubLockedTileKeys({
      canAccessProject: f => canAccessProject(f as Parameters<typeof canAccessProject>[0]) || hubPractice.has(f as FeatureKey),
      canAccessOwnTier: f => canAccess(f as Parameters<typeof canAccess>[0]),
      roleLoading: roleState.isLoading,
    }) as Set<SectionKey>,
    [canAccessProject, canAccess, roleState.isLoading, hubPractice],
  );

  // Inline gate flags for the Financial Health sub-buttons and the AI
  // spec-book extract. These route into hard paywalls; a small trailing lock
  // sets the expectation instead of dropping the user onto a wall. Most of
  // these destinations gate on 'job_costing' (Pro); the Full Budget Dashboard
  // is Business, and Extract-from-spec-book is a Pro AI feature.
  // These stay on his OWN tier: job_costing and full_budget_dashboard are
  // OWNER_ONLY_FEATURES — the GC's book, never inherited by a collaborator.
  const lockJobCosting = !canAccess('job_costing');
  const lockBudgetDashboard = !canAccess('full_budget_dashboard');
  const lockSpecExtract = !canAccess('job_costing'); // Pro AI feature (spec book vision spend)

  const changeOrders = useMemo(() => getChangeOrdersForProject(id ?? ''), [id, getChangeOrdersForProject]);
  const projectInvoices = useMemo(() => getInvoicesForProject(id ?? ''), [id, getInvoicesForProject]);
  // A/R for THIS project, straight from the same function the Reports screen's
  // A/R Aging tab renders — reused rather than re-derived so the project list
  // and the report can never print two different "outstanding" numbers.
  const projectAR = useMemo(
    () => computeARAgingReport(projectInvoices.filter(i => i.status !== 'draft'), []),
    [projectInvoices],
  );
  const dailyReports = useMemo(() => getDailyReportsForProject(id ?? ''), [id, getDailyReportsForProject]);
  const projectFieldTickets = useMemo(() => getFieldTicketsForProject(id ?? ''), [id, getFieldTicketsForProject]);
  const punchItems = useMemo(() => getPunchItemsForProject(id ?? ''), [id, getPunchItemsForProject]);
  const projectPhotos = useMemo(() => getPhotosForProject(id ?? ''), [id, getPhotosForProject]);
  const commEvents = useMemo(() => getCommEventsForProject(id ?? ''), [id, getCommEventsForProject]);
  const projectRFIs = useMemo(() => getRFIsForProject(id ?? ''), [id, getRFIsForProject]);
  const projectSubmittals = useMemo(() => getSubmittalsForProject(id ?? ''), [id, getSubmittalsForProject]);
  const projectOACMeetings = useMemo(() => (getOACMeetingsForProject?.(id ?? '') ?? []), [id, getOACMeetingsForProject]);
  const projectWarranties = useMemo(() => getWarrantiesForProject(id ?? ''), [id, getWarrantiesForProject]);
  const projectAIAPayApps = useMemo(() => getAIAPayAppsForProject(id ?? ''), [id, getAIAPayAppsForProject]);
  const projectPlans = useMemo(() => getPlanSheetsForProject(id ?? ''), [id, getPlanSheetsForProject]);
  const projectPermits = useMemo(() => getPermitsForProject(id ?? ''), [id, getPermitsForProject]);
  const projectBidPackages = useMemo(() => getBidPackagesForProject(id ?? ''), [id, getBidPackagesForProject]);
  const projectCommitments = useMemo(() => getCommitmentsForProject(id ?? ''), [id, getCommitmentsForProject]);

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
        // Per-fetch catch: one failing money fetch must not reject the whole
        // batch and blank all four badges (three of which fetched fine).
        const [contract, sels, binder, waivers] = await Promise.all([
          fetchActiveContract(id).catch(() => null),
          fetchSelectionsForProject(id).catch(() => []),
          fetchCloseoutBinder(id).catch(() => null),
          // #30 (CONTRACT 6): a failed read is said, never shown as none.
          loadLienWaiversChecked(id).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : 'read failed' })),
        ]);
        if (cancelled) return;
        // Kept for the Client Portal "Terms needed" badge below, which needs
        // proposalBlockReason's contract gate without a second fetch.
        setPortalBadgeContract(contract ?? null);
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
        if (!waivers.ok) {
          next.lienWaivers = { label: 'Couldn\u2019t check', tone: 'neutral' };
        } else if (waivers.waivers.length > 0) {
          const open = waivers.waivers.filter(w => w.status === 'requested').length;
          next.lienWaivers = open === 0
            ? { label: `${waivers.waivers.length} on file`, tone: 'success' }
            : { label: `${open} pending`, tone: 'pending' };
        }
        // Merge, don't replace — the sibling scope-badge effect writes a
        // 'scope' key that a full replace here would silently wipe.
        setTileBadges(prev => ({ ...prev, ...next }));
      } catch (err) {
        console.warn('[project-detail] tile badge load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const project = useMemo(() => getProject(id ?? ''), [id, getProject]);

  // The role that decides what this person may do to the JOB (#92, #174): the
  // live collaborator read, else — offline, or before it lands — the role
  // stamped on the cached project, with the owner recognised from its row
  // (pricingRoleFor, as field-ticket does). Null means unconfirmed: every
  // permission below fails closed on it.
  const hubRole = roleState.role ?? pricingRoleFor(project?.myRole ?? null, project?.ownerUserId, authUser?.id);
  const hubPerms = useMemo(() => hubPermissions(hubRole), [hubRole]);
  // #173: the Team count reads the same rows (same react-query key) the Team
  // list below draws, so the two can never disagree — no extra fetch.
  const teamRoster = useProjectCollaborators(project?.id);
  // #129: `hasData`, not "not loading and not failed" — a read paused offline
  // is neither, and printed "Team (1)" from an unread roster.
  const teamCount = teamCountLabel({
    hasData: teamRoster.hasData,
    viewerIsOwner: hubRole === 'owner',
    rows: teamRoster.collaborators,
  });
  // #38: billing the client is the job OWNER's alone (the #41 rule, one gate
  // shared with app/invoice.tsx). A collaborator's invoice was written under
  // his own user_id — the GC never saw it — and its Pay link minted on HIS
  // Stripe account, so the homeowner paid the wrong contractor. The owner is
  // recognised from the cached row, offline too; everyone else sees why.
  const billGate = invoiceRoleGate({
    hasProject: !!project,
    role: roleState.role,
    isLoading: roleState.isLoading,
    isError: roleState.isError,
    isPaused: roleState.isPaused,
    stampedRole: project?.myRole,
    ownedLocally: !!project?.ownerUserId && !!authUser?.id && project.ownerUserId === authUser.id,
  });
  const billBlockedReason: string | null =
    billGate === 'open' ? null
    : billGate === 'loading' ? 'Checking your role on this job before billing opens…'
    : billGate === 'error' ? "Couldn't confirm you own this job, so billing stays off. Check your signal and reopen the job."
    : billGate === 'paused' ? "You're offline and this phone hasn't confirmed you own this job, so billing stays off until it can."
    : INVOICE_OWNER_ONLY_REASON;

  // How complete the daily log is over THIS project's working days. The number
  // is coverage, not content — a day filed as "no work on site" counts exactly
  // as much as a busy one, and non-working days are never misses. Pure math
  // lives in utils/dailyLogCompletion.ts.
  const dfrRecord = useMemo(() => computeDailyLogCompletion({
    reports: dailyReports,
    calendar: calendarOfSchedule(project?.schedule),
    startDateISO: project?.schedule?.startDate ?? null,
  }), [dailyReports, project?.schedule]);

  // Estimate items keyed for the CO reflow's estimate-link anchor tier
  // (ScheduleTask.linkedEstimateItems stores materialIds). Memoized because the
  // preview modal re-runs CPM whenever this array's identity changes.
  const coReflowEstimateItems = useMemo(
    () => (project?.linkedEstimate?.items ?? []).map(i => ({ id: i.materialId, name: i.name })),
    [project?.linkedEstimate],
  );

  // Scope tile badge — shows "Not set" when the project has no scope data.
  // Runs synchronously off project (no async fetch needed).
  useEffect(() => {
    const isSet = !!project?.scope && (project.scope.scope ?? '').trim().length > 0;
    if (!isSet) {
      setTileBadges(prev => ({ ...prev, scope: { label: 'Not set', tone: 'neutral' } }));
    } else {
      setTileBadges(prev => { const { scope: _s, ...rest } = prev; return rest; });
    }
  }, [project?.scope]);

  // ── Portal snapshot background sync ──────────────────────────────────
  // The homeowner portal reads only portal_snapshots, so opening a job with
  // the portal on re-publishes the LITE snapshot. The body lives in
  // utils/portalLiteSync (shared with the provider-level sync in
  // ProjectContext): owner-only, never from a DEFAULT (unloaded) profile, any
  // failed rich read skips the push, only allowlisted sections are carried
  // from the published row, and one run per project. Don't re-inline a copy
  // of the merge here — two copies drifted before (hotfix #104, audit #44).
  // Debounced 2s so rapid edits / re-renders don't hammer the table.
  // #23 round 2: and only while every list the snapshot is rebuilt from was
  // read from the server since the latest return to the foreground — the
  // provider's own gate (portalListsServerRead). A section missing from a
  // publish is gone (#44), so publishing a failed read's empty invoices, or
  // this morning's photos, would take them off the homeowner's page. It runs
  // again when the flag turns true (it is a dependency).
  useEffect(() => {
    if (!project || !portalListsServerRead) return;
    const t = setTimeout(() => {
      void syncPortalSnapshotLite(project.id, {
        project, userId: authUser?.id, settings, settingsLoaded,
        invoices: projectInvoices, changeOrders, dailyReports, punchItems,
        photos: projectPhotos, rfis: projectRFIs, warranties: projectWarranties,
        permits: projectPermits,
        // #15: the job's pay apps, so one sent to the client appears (and a
        // recalled one leaves) on this push instead of waiting for Client
        // Portal setup. PRESENT = built fresh; ABSENT = the published section
        // is carried. Passed ONLY under the provider's own AIA gate
        // (portalAiaListServerRead — read from the server in this foreground
        // epoch): a list that failed or lags would build the section without a
        // pay app shared from another device, and the overlay can only remove,
        // never add it back (integration round 1). Fresh, an empty list is the
        // truth and is passed like the provider passes it.
        ...(portalAiaListServerRead ? { aiaPayApps: projectAIAPayApps } : {}),
      });
    }, 2000);
    return () => clearTimeout(t);
  }, [project, portalListsServerRead, portalAiaListServerRead, authUser?.id, settings, settingsLoaded, projectInvoices, changeOrders, dailyReports, punchItems, projectPhotos, projectRFIs, projectWarranties, projectPermits, projectAIAPayApps]);


  // `estimate` is nullable until the project loads (or if it has no estimate
  // attached). We compute it here so the useMemo/useCallback hooks below can
  // depend on it unconditionally — moving them below the `if (!project)` early
  // return would violate rules of hooks.
  const estimate = useMemo(() => project?.estimate, [project]);

  // Real buyout savings — derived from awarded BidPackages + signed Commitments.
  // Shows NOTHING when no packages have been awarded yet (hasRealData = false).
  // #11 (wave 5): the estimate lines ride along so a package whose budget was
  // stored at SELL is refused, never printed as Bulk Savings on a client PDF.
  const bulkSavingsSummary = useMemo(
    () => computeBulkSavings(id ?? '', projectBidPackages, projectCommitments, bidPackageBids, undefined, { estimateItems: project?.linkedEstimate?.items }),
    [id, projectBidPackages, projectCommitments, bidPackageBids, project?.linkedEstimate?.items],
  );
  const totalBulkSavings = bulkSavingsSummary.bulkSavings;
  const showBulkSavings = bulkSavingsSummary.hasRealData && bulkSavingsSummary.bulkSavings > 0;

  // Count of Outbox-worthy items (drafts + recalled + unsent edits) for this project.
  // Drives the entry-row badge shown in the Client Portal section of the tile grid.
  const outboxCount = useMemo(() => {
    if (!project) return 0;
    const pid = project.id;
    const isDraft = (s?: PortalState) => s?.status === 'draft' || s?.status === 'recalled';
    const isUnsentEdit = (s?: PortalState, updatedAt?: string) =>
      s?.status === 'sent' && s.sentAt != null && updatedAt != null &&
      new Date(updatedAt).getTime() > new Date(s.sentAt).getTime();
    const inProject = <T extends { projectId: string; portalState?: PortalState; updatedAt?: string }>(arr: T[]) =>
      arr.filter(x => x.projectId === pid && (isDraft(x.portalState) || isUnsentEdit(x.portalState, x.updatedAt))).length;
    // AIA pay apps use savedAt (not updatedAt) as their modification timestamp.
    const aiaCount = projectAIAPayApps.filter(a =>
      a.projectId === pid && (isDraft(a.portalState) || isUnsentEdit(a.portalState, a.savedAt))
    ).length;
    const photoCount = projectPhotos.filter(p => {
      const ps = p.portalState;
      if (!ps) return false;
      if (isDraft(ps)) return true;
      if (ps.status === 'sent' && ps.sentAt) {
        const ts = (p as { timestamp?: string }).timestamp;
        return ts != null && new Date(ts).getTime() > new Date(ps.sentAt).getTime();
      }
      return false;
    }).length;
    return (
      inProject(changeOrders) +
      inProject(projectInvoices) +
      aiaCount +
      inProject(projectRFIs as { projectId: string; portalState?: PortalState; updatedAt?: string }[]) +
      inProject(projectSubmittals as { projectId: string; portalState?: PortalState; updatedAt?: string }[]) +
      inProject(dailyReports) +
      photoCount +
      inProject(projectWarranties)
    );
  }, [
    project, changeOrders, projectInvoices, projectAIAPayApps,
    projectRFIs, projectSubmittals, dailyReports, projectPhotos, projectWarranties,
  ]);

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
    // Routes out to /field-ticket rather than opening an in-screen section,
    // so this flag is never read — present only to satisfy the exhaustive map.
    fieldTickets: true,
    // PRODUCT-F4: routes out to /deliveries the same way — flag never read.
    deliveries: true,
    // #81: routes out to /safety — flag never read.
    safety: true,
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
    scope: false,
    // Desktop-only section (the ⋯ menu's AI project report) — flag never read.
    aiReport: false,
  });
  const [detailModal, setDetailModal] = useState<DetailModalType>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  // Inline note composer — the fallback for platforms without Alert.prompt
  // (iOS) or window.prompt (web). Chiefly Android, where the old button was
  // a dead "use the note feature" Alert that created nothing.
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [showEditModal, setShowEditModal] = useState<EditModalType>(false);
  const [activeTile, setActiveTile] = useState<SectionKey | null>(null);
  // Tile group collapse state — Field & Money expanded by default, Docs & People collapsed.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<TileGroupKey>>(new Set(['docs', 'people']));
  // Async status badges for the Money-group tiles. Loaded once when the
  // project is opened. Each badge is { label, tone } where tone maps to
  // the status-pill colors. Drives the small text under each tile so
  // the GC sees what's blocking handover at a glance.
  const [tileBadges, setTileBadges] = useState<Partial<Record<SectionKey, { label: string; tone: 'pending' | 'success' | 'danger' | 'info' | 'neutral' }>>>({});
  // The active contract from the badge batch; undefined until it has loaded,
  // so the portal badge never guesses whether a sent contract blocks it.
  const [portalBadgeContract, setPortalBadgeContract] = useState<ProjectContract | null | undefined>(undefined);

  // ── Proposal payment terms (Direction B) ─────────────────────────────
  // A portal switched on before the GC's terms existed publishes its proposal
  // read-only ("Your contractor is confirming the payment schedule") and
  // nobody can accept it. This is the screen he actually opens, so this is
  // where he finds out: a "Terms needed" badge on the Client Portal tile, and
  // a one-tap confirm inside it. Its own effect, merged into tileBadges, so
  // the async money batch above and this synchronous check never overwrite
  // each other.
  const portalTerms = useMemo(
    () => proposalTermsState({ portal: project?.clientPortal, profileSplit: settings?.paymentSplit, acceptance: 'none' }),
    [project?.clientPortal, settings?.paymentSplit],
  );
  const portalTermsNeeded = !!project
    && portalBadgeContract !== undefined
    && portalTerms.state === 'unconfirmed'
    && !proposalBlockReason(project, portalBadgeContract ?? undefined);
  useEffect(() => {
    if (portalTermsNeeded) {
      setTileBadges(prev => ({ ...prev, clientPortal: { label: 'Terms needed', tone: 'pending' } }));
    } else {
      setTileBadges(prev => { const { clientPortal: _c, ...rest } = prev; return rest; });
    }
  }, [portalTermsNeeded]);

  const termsGate = useClientDocumentGate();
  /** Stamp this portal's proposal with his terms — one tap when saved, the
   *  deposit step when not. Saved in the same press, merging only the two
   *  proposal keys onto the saved portal, so the lite push below publishes
   *  exactly what the stamp says. */
  const confirmPortalProposalTerms = useCallback(() => {
    const cp = project?.clientPortal;
    if (!id || !project || !cp) return;
    const est = project.linkedEstimate;
    termsGate.run(
      { terms: true, purpose: 'portal_proposal', total: est ? toClientEstimateView(est).projectTotal : null, projectType: project.type ?? null },
      (a) => {
        // A FIRST stamp: the proposal has none, so it cannot have been accepted.
        const next = nextProposalStamp({ existing: cp.proposalPaymentTerms, split: a.split, acceptance: 'none', nowIso: new Date().toISOString() });
        if ('refused' in next) { showAlert('Payment terms', next.refused); return; }
        updateProject(id, {
          clientPortal: { ...cp, proposalApprovalEnabled: cp.proposalApprovalEnabled, proposalPaymentTerms: next.stamp },
        });
      },
    );
  }, [id, project, termsGate, updateProject]);

  // ── Wave 6c: the desktop workspace ────────────────────────────────────
  // The job becomes the active one (the sidebar's Recent list, the project
  // tools' default job). Desktop only: the phone has no sidebar.
  const { setActiveProject } = useActiveProject();
  useEffect(() => {
    if (isDesktop && project?.id) setActiveProject(project.id);
  }, [isDesktop, project?.id, setActiveProject]);
  // ONE predicate for "pending" (#39) — the CO chip, its list and the pulse.
  const pendingCOs = useMemo(() => changeOrders.filter(isPendingCO), [changeOrders]);
  // The job's numbers, read once: ProjectHero (phone) and the KPI strip /
  // overview (desktop) show the same margin, the same one % complete.
  const pulse = useProjectPulse(project ?? null, { contract: portalBadgeContract ?? null, pendingChangeOrders: pendingCOs });
  // Open / close a section. Desktop web: the URL holds it (?tile=), so Back, a
  // reload and a shared link reopen it — the follow effect below applies it.
  // Everywhere else: local state, exactly as before.
  const openSection = useCallback((key: SectionKey) => {
    if (deskWeb) router.setParams({ tile: key });
    else setActiveTile(key);
  }, [deskWeb, router]);
  const closeSection = useCallback(() => {
    if (deskWeb) router.setParams({ tile: undefined });
    else setActiveTile(null);
  }, [deskWeb, router]);
  // The root row's width (the side panel docks at >= 1200, overlays below)
  // and the section index's (its rows are sized to the index's columns).
  const panelRow = useContainerWidth();
  const indexBox = useContainerWidth();
  // The three transparent card sheets (share, edit, note) centre as dialogs
  // on desktop; on a phone each frame is inert (null styles, own animation).
  const fShare = useSheetFrame('dialog', { visible: showShareModal, animationType: 'fade' });
  const fEdit = useSheetFrame('form', { visible: showEditModal, animationType: 'slide' });
  const fNote = useSheetFrame('dialog', { visible: showNoteModal, animationType: 'slide' });
  // Wave 6d (sheet batch I): the opaque cost-breakdown sheet docks as a
  // right-hand panel on desktop (fRev, the revision sheet, sits below its
  // state). On a phone the frame is inert: null styles, the original slide,
  // `transparent` undefined — the pageSheet stands as it was.
  const fCost = useSheetFrame('panel', { visible: detailModal !== null, animationType: 'slide' });
  // The phone section sheet (a pageSheet the desktop never mounts) is a
  // dialog to the shortcut registry while it is up; no style change.
  useSheetDialogScope(!isDesktop && activeTile !== null);
  // Photos filter — 'all' or a normalized tag. The chip row defaults to 'all'
  // and we derive the chip set from photos at render-time so new tags appear
  // automatically without code changes.
  const [photoFilter, setPhotoFilter] = useState<string>('all');
  // Photo lightbox — shows the full-size image when a thumb is tapped.
  const [lightboxPhoto, setLightboxPhoto] = useState<ProjectPhoto | null>(null);
  // Photo Code Look on the lightbox photo. Mounted ONLY while set: a closed,
  // always-mounted sheet would hold a dialog hotkey scope on desktop.
  const [codeLookTarget, setCodeLookTarget] = useState<{ photoUri: string; sourcePhotoId: string } | null>(null);
  // D3-2: free-text photo search (matches tag / location / linked-task /
  // geo-label — all already persisted on ProjectPhoto) + auto-album-by-date
  // toggle. Default grouped: albums are the library win for a long project.
  const [photoSearch, setPhotoSearch] = useState<string>('');
  const [photoGroupByDate, setPhotoGroupByDate] = useState<boolean>(true);
  // RFI status filter — defaults to 'open' so the user lands on the work
  // that needs their attention, not a wall of closed RFIs.
  const [rfiFilter, setRfiFilter] = useState<'open' | 'answered' | 'closed' | 'all'>('open');
  // Invoice status filter — defaults to 'unpaid' (anything not fully paid)
  // because that's the AR pile every contractor cares about.
  const [invoiceFilter, setInvoiceFilter] = useState<'unpaid' | 'paid' | 'all'>('unpaid');
  // Change order status filter — defaults to 'pending' (submitted, awaiting approval).
  const [coFilter, setCoFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  // CO whose schedule impact is being previewed before approval. Approving a CO
  // with schedule days now genuinely reflows the Gantt, so the GC sees which
  // task absorbs the days and what shifts before anything is written.
  const [coReflowPreview, setCoReflowPreview] = useState<ChangeOrder | null>(null);
  // Estimate revision detail modal — stores the revision being inspected, or null when closed.
  const [selectedRevision, setSelectedRevision] = useState<EstimateRevision | null>(null);
  const fRev = useSheetFrame('panel', { visible: selectedRevision !== null, animationType: 'slide' });
  // The photo lightbox is a full-window viewer: a dialog while it is open.
  useSheetDialogScope(lightboxPhoto !== null);
  // Revision detail sub-view: null = summary+delta, 'items' = line-items list.
  const [revDetailView, setRevDetailView] = useState<'delta' | 'items'>('delta');

  // Persist a private internal note. Single path used by every platform's
  // note-entry UI (iOS Alert.prompt, web window.prompt, Android/other modal)
  // so the addCommEvent payload stays identical regardless of surface.
  const submitNote = useCallback((raw: string | null | undefined) => {
    const text = raw?.trim();
    if (!text) return;
    addCommEvent({
      id: generateUUID(),
      projectId: id ?? '',
      type: 'internal_note',
      summary: text,
      actor: settings.branding?.contactName || 'You',
      isPrivate: true,
      timestamp: new Date().toISOString(),
    });
  }, [addCommEvent, id, settings.branding?.contactName]);

  const toggleGroup = useCallback((key: TileGroupKey) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Animate the collapse/expand. The smooth height-collapse (no "huge gap
    // that only disappears after clicking another collapsible") comes from the
    // body being CONDITIONALLY RENDERED (mount/unmount) plus the `update`
    // easeInEaseOut collapsing sibling layout — NOT from the create/delete
    // property. Create/delete MUST use `opacity`, never `scaleXY`: on the New
    // Architecture (Fabric), a `scaleXY` create/delete makes the layout-anim
    // driver interpolate the view's `transform` array, and when a
    // created/deleted subtree contains any view with its own `transform`, the
    // interpolator indexes past the shorter TransformOperation vector →
    // out-of-bounds → SIGABRT (hard native crash to springboard). This fired
    // reliably navigating out of a tile section. `opacity` sidesteps transform
    // interpolation entirely (same crash-safe config as HomeFabStack).
    if (Platform.OS !== 'web') {
      LayoutAnimation.configureNext({
        duration: 220,
        create: { type: 'easeInEaseOut', property: 'opacity' },
        update: { type: 'easeInEaseOut' },
        delete: { type: 'easeInEaseOut', property: 'opacity' },
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
  // Q6 · his words when the type is Other.
  const [editTypeOther, setEditTypeOther] = useState('');
  const [editSquareFootage, setEditSquareFootage] = useState('');
  // Contract block. Strings while typing; parsed and range-checked on save
  // against CONTRACT_TERM_RANGES — the same bounds as the DB CHECKs, because a
  // CHECK violation is terminal in the offline queue and would take the
  // estimate riding in the same project_financials upsert down with it.
  const [editContractMode, setEditContractMode] = useState<ContractMode | undefined>(undefined);
  const [editGmpCap, setEditGmpCap] = useState('');
  const [editFeeKind, setEditFeeKind] = useState<'percent' | 'amount'>('percent');
  const [editFee, setEditFee] = useState('');
  const [editRetainage, setEditRetainage] = useState('');
  // Whether he typed in the retainage field at all — decides if a carried
  // (assumed) rate keeps that label or becomes his stated contract rate.
  const [editRetainageTouched, setEditRetainageTouched] = useState(false);
  const [generatingCloseout, setGeneratingCloseout] = useState<boolean>(false);
  const [actionSheetRef, setActionSheetRef] = useState<EntityRef | null>(null);

  const toggleSection = useCallback((section: SectionKey) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // The tile-section modal renders as an iOS pageSheet. If we navigate while
  // it's still presented, the new screen mounts BEHIND the sheet — the classic
  // "press back and the new screen appears" bug. Dismiss the sheet first,
  // then navigate after iOS finishes the dismiss animation (~300ms).
  // Desktop (wave 6c): the section is a side panel, not a sheet — it stays
  // open (and ?tile= stays in the URL), so Back returns to it.
  const navigateFromTile = useCallback((route: string | { pathname: string; params?: Record<string, string | number | undefined> }, mode: 'push' | 'replace' = 'push') => {
    if (!isDesktop) setActiveTile(null);
    const delay = isDesktop ? 0 : (Platform.OS === 'ios' ? 350 : 0);
    setTimeout(() => {
      if (mode === 'replace') router.replace(route as any);
      else router.push(route as any);
    }, delay);
  }, [router, isDesktop]);

  const openEditModal = useCallback(() => {
    if (!project) return;
    setEditName(project.name);
    setEditDescription(project.description || '');
    setEditLocation(project.location || '');
    setEditType(project.type);
    setEditTypeOther(project.projectTypeOther ?? '');
    setEditSquareFootage(project.squareFootage > 0 ? project.squareFootage.toString() : '');
    setEditContractMode(project.contractMode);
    setEditGmpCap(project.gmpCap != null ? String(project.gmpCap) : '');
    // A stored flat amount with no percent opens on "amount"; everything else
    // (including nothing set) opens on percent, the common cost-plus fee.
    const feeIsAmount = project.contractorFeePercent == null && project.contractorFeeAmount != null;
    setEditFeeKind(feeIsAmount ? 'amount' : 'percent');
    setEditFee(feeIsAmount ? String(project.contractorFeeAmount) : project.contractorFeePercent != null ? String(project.contractorFeePercent) : '');
    setEditRetainage(project.retainagePercent != null ? String(project.retainagePercent) : '');
    setEditRetainageTouched(false);
    setShowEditModal(true);
  }, [project]);

  // Edit is offered only where the save would land (#92): projects_update
  // admits the owner or an editor; a field / viewer PATCH matched 0 rows and
  // his edit vanished with no error. Every entry point — header pencil,
  // bottom button, the ?edit=1 deep link — comes through here.
  const requestEdit = useCallback(() => {
    if (hubPerms.editBlockedReason) {
      showAlert("You can't edit this job", hubPerms.editBlockedReason);
      return;
    }
    openEditModal();
  }, [hubPerms.editBlockedReason, openEditModal]);

  // Consume the tile/edit deep-link params exactly once, after the
  // project has loaded. NextStepHero (and any future caller) can drop
  // the user directly into the relevant section or the edit modal
  // instead of the tile grid. Guarded by a ref so navigating around
  // inside the screen doesn't re-trigger it.
  const deepLinkConsumed = useRef(false);
  useEffect(() => {
    if (deepLinkConsumed.current) return;
    if (!project) return;
    if (editParam === '1' || editParam === 'true') {
      // Wait for the role while it is still being read, so a collaborator is
      // not told "unconfirmed" a second before it resolves.
      if (roleState.isLoading && hubRole == null) return;
      deepLinkConsumed.current = true;
      requestEdit();
      return;
    }
    // Desktop web follows ?tile= for as long as it is in the URL (below).
    if (tileParam && !deskWeb) {
      // A link into a section this role doesn't get (#92) lands on the grid.
      if (!hubTileVisible(tileParam, hubPerms)) {
        if (roleState.isLoading && hubRole == null) return;
        deepLinkConsumed.current = true;
        return;
      }
      deepLinkConsumed.current = true;
      setActiveTile(tileParam as SectionKey);
    }
  }, [project, editParam, tileParam, requestEdit, roleState.isLoading, hubRole, hubPerms, deskWeb]);

  // Desktop web: ?tile= IS the open section. A log section (RFIs, invoices…)
  // is not drawn here — the URL is handed to its log (lanes G/H) and dropped
  // from this page's entry, so Back lands on the job. A side-panel section
  // this role may see opens; one it may not waits for the role, then closes.
  const followPid = project?.id;
  const followedList = useRef<string | null>(null);
  useEffect(() => {
    if (!deskWeb || !followPid) return;
    const key = typeof tileParam === 'string' && tileParam ? tileParam : null;
    if (key && isListSection(key)) {
      if (followedList.current === key) return;
      followedList.current = key;
      router.setParams({ tile: undefined });
      router.push(routeHref(LIST_SECTION_ROUTES[key], { projectId: followPid }));
      return;
    }
    followedList.current = null;
    if (key && isPanelSection(key)) {
      if (hubTileVisible(key, hubPerms)) {
        setActiveTile(prev => (prev === key ? prev : key));
        return;
      }
      if (roleState.isLoading && hubRole == null) return;
    }
    setActiveTile(prev => (prev === null ? prev : null));
  }, [deskWeb, followPid, tileParam, hubPerms, roleState.isLoading, hubRole, router]);

  const currentStage: LifecycleStage = useMemo(
    () => statusToStage(project?.status),
    [project?.status],
  );

  const handleStageTap = useCallback((stage: LifecycleStage) => {
    if (!project || !id) return;
    if (stage === currentStage) return;
    const label = LIFECYCLE_STAGES.find(s => s.key === stage)?.label ?? stage;
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
    // Distinguish a backward move (e.g. Closeout → Pre-Con) from a normal
    // advance. Regressing can hide/disable downstream affordances, so it
    // gets explicit "this moves backward" copy and a destructive button.
    const currentIdx = LIFECYCLE_STAGES.findIndex(s => s.key === currentStage);
    const targetIdx = LIFECYCLE_STAGES.findIndex(s => s.key === stage);
    const isBackward = targetIdx < currentIdx;
    const apply = () => {
      updateProject(id, { status: STAGE_TO_STATUS[stage] });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    };
    if (isBackward) {
      showAlert(
        `Move back to ${label}?`,
        `This regresses "${project.name}" to an earlier stage. Downstream stages will be treated as incomplete and some later-stage tools may be hidden.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Move back', style: 'destructive', onPress: apply },
        ],
      );
    } else {
      showAlert(
        'Move project stage?',
        `Mark "${project.name}" as ${label}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Move', onPress: apply },
        ],
      );
    }
  }, [project, id, currentStage, updateProject]);

  // Who may change the contract terms from this device. They are money
  // (project_financials — 'field' cannot even read them), so the block is
  // not shown to a field foreman at all, and it is shown read-only — with the
  // reason — where a save could not honestly carry them: a viewer's write is
  // refused by RLS, and a shared job whose financials failed to load would
  // be writing over terms this device never saw.
  const contractAccess = useMemo((): { hidden: boolean; lockedReason: string | null } => {
    if (!project) return { hidden: true, lockedReason: null };
    // FAIL-CLOSED on an unknown role: isFinancialsBlinded(null) is false, so
    // a collaborator whose role had not loaded (offline, first launch) was
    // shown the money block. The owner is recognised from the row itself
    // (pricingRoleFor, as field-ticket does); anyone else unconfirmed sees
    // the block locked with the reason and no figures.
    const role = pricingRoleFor(project.myRole ?? null, project.ownerUserId, authUser?.id);
    if (isFinancialsBlinded(role)) return { hidden: true, lockedReason: null };
    if (!canViewFinancials(role)) return { hidden: false, lockedReason: "Your access to this job hasn't been confirmed on this device yet, so its contract terms stay hidden until it loads. Check your signal and reopen the job." };
    if (project.myRole === 'viewer') return { hidden: false, lockedReason: 'You have view-only access to this job, so its contract terms can only be changed by the owner or an editor.' };
    if (project.financialsLoaded === false) return { hidden: false, lockedReason: "This job's money didn't load from the server on this device, so contract terms are locked here until it does — saving now could overwrite terms you haven't seen." };
    return { hidden: false, lockedReason: null };
  }, [project, authUser?.id]);

  const feeApplies = editContractMode === 'cost_plus' || editContractMode === 'gmp' || editContractMode === 'open_book';
  const portalShowsCost = editContractMode === 'gmp' || editContractMode === 'open_book';

  /**
   * The contract-term patch from the modal, or an error sentence. Terms that do
   * not belong to the chosen mode are CLEARED rather than left behind: utils/
   * wip.ts reads gmpCap as a contract value whatever the mode, so a cap kept
   * after switching a job to fixed price would still drive its WIP line.
   */
  const buildContractPatch = useCallback((): { patch: Partial<Project> } | { error: string } => {
    const readNumber = (raw: string, label: string, range: { min: number; max: number }): { value: number | undefined } | { error: string } => {
      if (!raw.trim()) return { value: undefined };
      const n = parseLenientNumber(raw);
      if (n == null || n < range.min || n > range.max) {
        return { error: Number.isFinite(range.max) ? `${label} must be a number from ${range.min} to ${range.max}.` : `${label} must be a number of ${range.min} or more.` };
      }
      return { value: n };
    };
    const cap = editContractMode === 'gmp' ? readNumber(editGmpCap, 'GMP cap', CONTRACT_TERM_RANGES.gmpCap) : { value: undefined };
    if ('error' in cap) return cap;
    const feeRange = editFeeKind === 'percent' ? CONTRACT_TERM_RANGES.contractorFeePercent : CONTRACT_TERM_RANGES.contractorFeeAmount;
    const fee = feeApplies ? readNumber(editFee, editFeeKind === 'percent' ? 'Fee percent' : 'Fee amount', feeRange) : { value: undefined };
    if ('error' in fee) return fee;
    const ret = readNumber(editRetainage, 'Retainage', CONTRACT_TERM_RANGES.retainagePercent);
    if ('error' in ret) return ret;
    // Retainage he did not touch keeps its provenance (a rate carried from an
    // earlier invoice stays labelled "carried"); one he typed — even the same
    // number — is his answer off the contract. Blank stores nothing: "not on
    // file", never a guessed 0.
    const retUnchanged = !editRetainageTouched && ret.value != null && ret.value === project?.retainagePercent;
    return {
      patch: {
        contractMode: editContractMode,
        gmpCap: cap.value,
        contractorFeePercent: editFeeKind === 'percent' ? fee.value : undefined,
        contractorFeeAmount: editFeeKind === 'amount' ? fee.value : undefined,
        retainagePercent: ret.value,
        retainagePercentAssumed: ret.value == null ? undefined : retUnchanged ? project?.retainagePercentAssumed : false,
      },
    };
  }, [editContractMode, editGmpCap, editFeeKind, editFee, editRetainage, editRetainageTouched, feeApplies, project?.retainagePercent, project?.retainagePercentAssumed]);

  const capGate = useProjectCapGate();
  const handleSaveEdit = useCallback(() => {
    if (!id) return;
    const name = editName.trim();
    if (!name) {
      showAlert('Missing Name', 'Please enter a project name.');
      return;
    }
    // #156 (CONTRACT 21): renaming a 'Sample — ' job to a real name makes it
    // count toward the free plan's one job. At the cap the server keeps the
    // sample name (20260923040000) without an error, so the rename would seem
    // to save and then revert on the next load. Put the name back, keep his
    // other edits in the sheet, and say why.
    if (project && isSampleProjectName(project.name) && !isSampleProjectName(name) && !capGate.canCreate(name)) {
      setEditName(project.name);
      capGate.explainAndOfferUpgrade();
      return;
    }
    let contractPatch: Partial<Project> = {};
    if (!contractAccess.hidden && !contractAccess.lockedReason) {
      const built = buildContractPatch();
      if ('error' in built) {
        showAlert('Check the contract terms', built.error);
        return;
      }
      contractPatch = built.patch;
    }
    // Q6: Other needs his words — checked before anything is written.
    const typeBlock = projectTypeBlockReason(editType, editTypeOther);
    if (typeBlock) {
      showAlert('Describe the job', typeBlock);
      return;
    }
    const sqft = parseFloat(editSquareFootage) || 0;
    updateProject(id, {
      name,
      description: editDescription.trim(),
      // Blank = no address. 'United States' geocoded to the Kansas centroid
      // and showed Kansas weather for the job (lane Q2, 2026-09-24).
      location: editLocation.trim(),
      type: editType,
      // Leaving Other drops the words (the write sends NULL for them anyway).
      projectTypeOther: editType === 'other' ? cleanProjectTypeOther(editTypeOther) : undefined,
      squareFootage: sqft,
      ...contractPatch,
    });
    setShowEditModal(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    console.log('[ProjectDetail] Project updated:', id);
  }, [id, editName, editDescription, editLocation, editType, editTypeOther, editSquareFootage, updateProject, contractAccess, buildContractPatch, project, capGate]);

  const branding = useMemo(() => settings.branding ?? {
    companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '',
  }, [settings.branding]);

  const handleSharePDF = useCallback(async () => {
    if (!project) return;
    try {
      setShowShareModal(false);
      // Inject the real buyout-derived savings into the project's estimate
      // before passing to the PDF generator so the printed figure is real.
      // undefined when no packages are awarded yet — the generator already
      // guards (bulkSavingsTotal ?? 0) > 0 before printing the line.
      const projectForPdf = project.estimate
        ? {
            ...project,
            estimate: {
              ...project.estimate,
              bulkSavingsTotal: showBulkSavings ? totalBulkSavings : undefined,
            },
          }
        : project;
      await generateAndSharePDF(projectForPdf, branding, 'share');
    } catch (e) {
      console.error('[ProjectDetail] PDF share error:', e);
      showAlert('Error', pdfFailureMessage(e, 'Failed to generate PDF. Please try again.'));
    }
  }, [project, branding, showBulkSavings, totalBulkSavings]);

  // Copy the client-portal share link to the clipboard. The previous
  // version of the inline portal section called showAlert('Copied', …)
  // WITHOUT ever calling the clipboard API — users saw a "Copied" toast
  // over an empty clipboard. This hooks the real clipboard util and
  // gives a meaningful "Copy failed" path so silent failures can't
  // recur. Used by both the dedicated Copy button and the tappable
  // link pill.
  //
  // The URL this copies is the one the client actually receives, `?t=` and
  // all: every portal RPC (approve a change order, sign the contract, accept a
  // selection) refuses a request without that token, so a bare
  // `mageid.app/portal/<id>` is not a shorter link — it is a portal the client
  // cannot act in. portalShareUrl returns null rather than build one, and null
  // is reported as the missing step, not copied.
  const portalLink = useMemo(
    () => portalShareUrl(project?.clientPortal),
    [project?.clientPortal],
  );

  // #71: the Client Portal is a Pro feature (client-portal-setup gates on the
  // same key). This screen used to write enabled=true for a free account and
  // then land him on that paywall, leaving a half-enabled portal whose link
  // pill pointed him back to it. Nothing portal-related writes or hands out a
  // link here without the entitlement; the locked control says why and opens
  // the paywall instead. NOTE: this is the only enforcement — the token RPCs
  // and trg_portal_access_token do no tier check (founder decision #71).
  const portalEntitled = canAccess('client_portal');
  const [portalPaywallOpen, setPortalPaywallOpen] = useState(false);
  const openPortalPaywall = useCallback(() => {
    // Close the tile sheet first: a modal opened from inside the iOS
    // pageSheet mounts behind it (same reason as navigateFromTile). The
    // desktop side panel is not a sheet: it stays open beside the paywall.
    if (!isDesktop) setActiveTile(null);
    setTimeout(() => setPortalPaywallOpen(true), isDesktop ? 0 : (Platform.OS === 'ios' ? 350 : 0));
  }, [isDesktop]);

  const handleCopyPortalLink = useCallback(async () => {
    if (!portalEntitled) { openPortalPaywall(); return; }
    if (!portalLink) {
      // The key is minted by the server (trg_portal_access_token) on the
      // write that turns the portal on — not by the setup screen's Save,
      // which this used to send him to. It reaches this device once that
      // write has synced and the job is re-read.
      showAlert(
        'Secure link on its way',
        "The key that lets your client approve and sign is created on the server when the portal is turned on. It reaches this device once that change has synced — reopen this job in a moment and copy again. If you're offline, it arrives when you're back online.",
      );
      return;
    }
    const ok = await (await import('@/utils/clipboard')).copyToClipboard(portalLink);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showAlert(
      ok ? 'Copied' : 'Copy failed',
      ok ? 'Portal link copied to clipboard.' : 'Could not copy the link. Long-press the URL above to select it manually.',
    );
  }, [portalLink, portalEntitled, openPortalPaywall]);

  const handleShareEmail = useCallback(async () => {
    if (!project) return;
    setShowShareModal(false);

    const subject = branding.companyName
      ? `${branding.companyName} - Estimate: ${project.name}`
      : `Estimate: ${project.name}`;

    // Mirror the same patched-project pattern used by handleSharePDF so the
    // emailed estimate text and the PDF agree on the bulk-savings figure.
    const projectForEmail = project.estimate
      ? {
          ...project,
          estimate: {
            ...project.estimate,
            bulkSavingsTotal: showBulkSavings ? totalBulkSavings : undefined,
          },
        }
      : project;
    const body = buildEstimateTextForEmail(projectForEmail, branding);
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(mailtoUrl).catch(() => {
      showAlert('Unable to open email', 'Please check your email app is configured.');
    });
  }, [project, branding, showBulkSavings, totalBulkSavings]);

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
      showAlert('Unable to open messages', 'Please check your messaging app.');
    });
  }, [project, branding]);

  const handleShareSchedulePDF = useCallback(async () => {
    if (!project) return;
    try {
      setShowShareModal(false);
      const projectForPdf = project.estimate
        ? {
            ...project,
            estimate: {
              ...project.estimate,
              bulkSavingsTotal: showBulkSavings ? totalBulkSavings : undefined,
            },
          }
        : project;
      await generateAndSharePDF(projectForPdf, branding, 'share');
    } catch (e) {
      console.error('[ProjectDetail] Schedule PDF share error:', e);
      showAlert('Error', pdfFailureMessage(e, 'Failed to generate schedule PDF.'));
    }
  }, [project, branding, showBulkSavings, totalBulkSavings]);

  // Export the project's complete RFI log as a PDF — the document a GC would
  // hand the architect at the project meeting or attach to a closeout binder.
  // We export ALL RFIs (open, answered, closed, void) because the architect
  // typically wants the full audit trail. Web falls back to print-preview via
  // shareHtml; native gets a proper file URI + share sheet.
  const handleExportRFILog = useCallback(async () => {
    if (!project) return;
    if (projectRFIs.length === 0) {
      showAlert('No RFIs', 'There are no RFIs to export on this project yet.');
      return;
    }
    // #148: RFI numbers are assigned by the server when an RFI lands, so an
    // RFI whose INSERT is still in the offline queue carries a provisional
    // number — a log printed now could hand the architect a number the server
    // later changes. #29: only a queued INSERT means "no number yet". A queued
    // UPDATE (a subject typo fixed offline) is an RFI the server numbered
    // weeks ago, and the log prints the device copy's newer text anyway.
    try {
      const queue = await getOfflineQueue();
      const waiting = projectRFIs.filter(r => insertStillQueued(queue, 'rfis', r.id)).length;
      if (waiting > 0) {
        showAlert(
          'RFI log not ready',
          `RFI numbers are assigned when an RFI reaches the server — ${waiting} RFI${waiting === 1 ? ' is' : 's are'} still waiting to sync. Try again once you're back online.`,
        );
        return;
      }
    } catch { /* an unreadable queue does not block the export; the server copy is what prints */ }
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await generateRFILogPDF(projectRFIs, project, branding);
      nailIt(`RFI log exported · ${projectRFIs.length} ${projectRFIs.length === 1 ? 'RFI' : 'RFIs'}`);
    } catch (e) {
      console.error('[ProjectDetail] RFI log PDF error:', e);
      showAlert('Error', pdfFailureMessage(e, 'Failed to generate RFI log PDF.'));
    }
  }, [project, projectRFIs, branding]);

  const handleGenerateCloseoutPacket = useCallback(async () => {
    if (!project || !id) return;
    if (generatingCloseout) return;
    const openPunchCount = punchItems.filter(p => p.status !== 'closed').length;
    // MONEY-F5: one definition of "still owed" — net of held retention.
    const unpaidInvoices = projectInvoices.filter(i => invoiceOutstanding(i) > 0);
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
          showAlert('Closeout Packet', 'Could not generate the closeout packet. Please try again.');
        }
      } catch (err) {
        // CONTRACT 25 (#147): on web a blocked window now THROWS (it used to
        // return true and show "built and shared" with nothing opened). The
        // blocked sentence passes through; no success toast on this path.
        console.error('[ProjectDetail] Closeout packet error:', err);
        showAlert('Closeout Packet', pdfFailureMessage(err, 'Failed to generate closeout packet.'));
      } finally {
        setGeneratingCloseout(false);
      }
    };
    if (warn.length > 0) {
      showAlert(
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
      // SCHED-NO-ANCHOR: an undated schedule contributes NO task events (the
      // generator refuses to date them off today). The count alone would read
      // as a complete calendar — and "no schedule tasks found" would be flatly
      // false on a 20-task plan — so the skip is stated either way.
      const { undatedSchedule, skippedTaskCount } = result.scheduleSkip;
      const skipNote = undatedSchedule
        ? ` ${skippedTaskCount} schedule task${skippedTaskCount === 1 ? '' : 's'} ${skippedTaskCount === 1 ? 'was' : 'were'} left out: this schedule has no start date, so its tasks have day numbers but no calendar days yet.`
        : '';
      if (result.eventCount === 0) {
        showAlert(
          'Calendar Feed',
          undatedSchedule
            ? `Nothing could be written to a calendar file.${skipNote} Set the start date on the Schedule tab and export again.`
            : 'No schedule tasks, invoice due dates, or warranty expirations found for this project yet. Add items to the schedule to populate the feed.',
        );
        return;
      }
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (undatedSchedule) showAlert('Calendar Feed', `Exported ${result.eventCount} event${result.eventCount === 1 ? '' : 's'}.${skipNote}`);
      } else {
        showAlert('Calendar Feed', `Downloaded ${result.eventCount} event${result.eventCount === 1 ? '' : 's'} to your calendar file. Open it to import.${skipNote}`);
      }
    } catch (err) {
      console.error('[ProjectDetail] Calendar export error:', err);
      showAlert('Calendar Feed', 'Could not generate the calendar feed. Please try again.');
    }
  }, [project, projectInvoices, projectWarranties]);

  const handleExportAccounting = useCallback(async () => {
    if (!project) return;
    const run = async (format: AccountingFormat) => {
      try {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const result = await exportProjectAccountingCsv({ format, project, invoices: projectInvoices });
        if (result.rowCount === 0) {
          showAlert('Nothing to export', 'No billable invoices on this project yet (draft invoices are excluded).');
          return;
        }
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        nailIt(`Exported ${result.rowCount} line${result.rowCount === 1 ? '' : 's'} · ${format === 'xero' ? 'Xero' : 'QuickBooks'}`);
      } catch (err) {
        console.error('[ProjectDetail] Accounting export error:', err);
        showAlert('Error', 'Could not export the accounting CSV. Please try again.');
      }
    };
    showAlert('Export to accounting', 'Choose the format your bookkeeper imports.', [
      { text: 'QuickBooks Online', onPress: () => { void run('quickbooks'); } },
      { text: 'Xero', onPress: () => { void run('xero'); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [project, projectInvoices]);

  // Capture a jobsite photo straight into the project gallery. 'camera' opens
  // the device camera (falls back to the library on web, which has no camera
  // capture); 'library' picks from the roll.
  //
  // The GPS stamp genuinely does not block now. It used to be
  // `const stamp = await stampPhotoLocation();` directly beneath a comment
  // asserting it "never blocks" — it blocked, for up to ~4.5s per shot (a 3s
  // fix race plus a 1.5s reverse-geocode), and that worst case is the NORMAL
  // case in the below-grade structure where the fix never lands. No spinner,
  // no photo, four and a half seconds, times twenty shots. The photo is now
  // written first and the coordinates are patched onto it by id if and when
  // they arrive — the pattern app/daily-report.tsx:815 already documents.
  const handleCapturePhoto = useCallback(async (source: 'camera' | 'library') => {
    if (!project) return;
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'library' || Platform.OS === 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { showAlert('Permission Required', 'Photo library access is needed to add photos.'); return; }
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { showAlert('Permission Required', 'Camera access is needed to take photos.'); return; }
        result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      }
      if (result.canceled || !result.assets[0]) return;
      const photoId = createId('photo');
      const now = new Date().toISOString();
      addProjectPhoto({
        id: photoId,
        projectId: project.id,
        uri: result.assets[0].uri,
        timestamp: now,
        createdAt: now,
        tag: 'Progress',
      });
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Coordinates arrive on their own schedule and are patched on by id. A
      // photo deleted while the fix was still running is simply not found, so
      // a late stamp can never resurrect it. A photo that never gets a fix
      // keeps no coordinates — the documented contract of stampPhotoLocation.
      //
      // Camera captures on a phone ONLY. A Library pick (and every web upload —
      // on web 'Take Photo' is a file picker too) may have been taken anywhere
      // at any time; the phone's CURRENT position is not where that picture was
      // taken. The stamp is persisted and reaches the client (shared-timeline
      // caption with a map pin, the handover packet, the Home Passport's
      // 'Address:' doc), so stamping a library pick would publish a guess — often
      // the GC's own home address — as GPS proof. Same rule as
      // app/daily-report.tsx and app/field-ticket.tsx.
      if (source !== 'camera' || Platform.OS === 'web') return;
      void stampPhotoLocation()
        .then(stamp => {
          if (!stamp) return;
          updateProjectPhoto(photoId, {
            latitude: stamp.latitude,
            longitude: stamp.longitude,
            locationAccuracyMeters: stamp.accuracyMeters,
            locationLabel: stamp.label,
          });
        })
        .catch(() => {/* stampPhotoLocation already swallows; belt and braces */});
    } catch (err) {
      console.log('[project-detail] Photo capture error:', err);
      showAlert('Could not add photo', 'Something went wrong capturing that photo. Please try again.');
    }
  }, [project, addProjectPhoto, updateProjectPhoto]);

  const handleSharePhotoTimeline = useCallback(async () => {
    if (!project) return;
    if (projectPhotos.length === 0) {
      showAlert('Photo timeline', 'No photos to share yet. Take some jobsite photos first.');
      return;
    }
    // #62 / #164 (CONTRACT 11): a v2 share carries photo ids, not URLs —
    // the page re-signs them for an hour each time it is opened — and leaves
    // out photos drafted or recalled in the client portal.
    const { payload, droppedLocal, droppedExcess, droppedWithdrawn } = buildPhotoSharePayload(
      project.name ?? 'Project',
      projectPhotos,
      { gcName: settings?.branding?.companyName, projectId: project.id },
    );
    if (payload.photos.length === 0) {
      showAlert(
        'Photo timeline',
        droppedWithdrawn > 0 && droppedLocal === 0
          ? 'These photos are drafted or recalled in the client portal — send them first.'
          : droppedLocal > 0
            ? 'These photos haven’t synced yet. Wait until the offline-sync pill shows "Synced," then try again.'
            : 'No shareable photos found.',
      );
      return;
    }
    const token = encodePhotoShareToken(payload);
    const url = buildShareUrl('shared-photos', token,
      Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null);
    const ok = await (await import('@/utils/clipboard')).copyToClipboard(url);
    const extras: string[] = [];
    if (droppedLocal > 0) extras.push(`${droppedLocal} photo${droppedLocal === 1 ? '' : 's'} skipped (not yet synced)`);
    if (droppedExcess > 0) extras.push(`oldest ${droppedExcess} trimmed (cap ${PHOTO_SHARE_MAX})`);
    if (droppedWithdrawn > 0) extras.push(`${droppedWithdrawn} withdrawn from the client portal`);
    const detail = extras.length > 0 ? `\n\n${extras.join(' · ')}` : '';
    if (ok) {
      showAlert('Photo timeline copied', `Link copied to clipboard. Paste it into a text, email, or client portal. The link keeps working — photos load fresh each time it is opened.${detail}`);
    } else {
      showAlert('Photo timeline link', `${url}${detail}`);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, projectPhotos, settings?.branding?.companyName]);


  // Set the instant a delete is confirmed so the render between
  // deleteProject(id) (project becomes null) and router.back() completing
  // shows the loading state, not a "Project not found" flash.
  const deletingRef = useRef(false);
  // #61 (wave 5, CONTRACT 22): what the job's safety log holds, as this device
  // knows it. The incident count is passed to deleteProject so the refusal is
  // decided on the same list the screen shows — but only once the log has
  // hydrated: before that an empty list means "not loaded", and passing 0
  // would skip the context's own device + server check.
  const safetyCtx = useSafety();
  const jobSafety = useMemo(() => {
    if (!id) return { incidents: 0, jhas: 0, talks: 0, hazards: 0, hydrated: false };
    return {
      incidents: safetyCtx.getIncidentsForProject(id).length,
      jhas: safetyCtx.getJhasForProject(id).length,
      talks: safetyCtx.getToolboxTalksForProject(id).length,
      hazards: safetyCtx.getHazardsForProject(id).length,
      hydrated: safetyCtx.incidentsHydrated,
    };
  }, [id, safetyCtx]);

  // #61: what the confirm says about the job's safety log, and the up-front
  // refusal — OSHA keeps the 300 log for 5 years, so a job with injury /
  // near-miss records is refused before Delete is offered, in the same
  // sentence the context refuses with.
  const deleteSafety = useMemo(() => {
    const knownIncidents = jobSafety.hydrated ? jobSafety.incidents : undefined;
    const parts: string[] = [];
    if (jobSafety.jhas > 0) parts.push(`${jobSafety.jhas} JHA${jobSafety.jhas === 1 ? '' : 's'}`);
    if (jobSafety.talks > 0) parts.push(`${jobSafety.talks} toolbox talk${jobSafety.talks === 1 ? '' : 's'}`);
    if (jobSafety.hazards > 0) parts.push(`${jobSafety.hazards} hazard${jobSafety.hazards === 1 ? '' : 's'}`);
    return {
      knownIncidents,
      refusal: deleteProjectSafetyRefusal(project?.name, knownIncidents),
      safetyLine: parts.length > 0 ? `\n\nThis job's safety records go with it: ${parts.join(', ')}.` : '',
    };
  }, [jobSafety, project?.name]);

  // The refusal's way forward: close the job (records kept) instead.
  const markJobClosed = useCallback(() => {
    if (!id) return;
    if (project?.status === 'closed') { nailIt('Job is already closed'); return; }
    updateProject(id, { status: 'closed', closedAt: new Date().toISOString() });
    nailIt('Job marked closed');
  }, [id, project?.status, updateProject]);

  const showDeleteRefusal = useCallback((reason: string, offerClose: boolean) => {
    showAlert(
      offerClose ? 'Keep this job — mark it closed' : "Couldn't delete this job",
      reason,
      offerClose
        ? [{ text: 'Cancel', style: 'cancel' }, { text: 'Mark closed', onPress: markJobClosed }]
        : [{ text: 'OK' }],
    );
  }, [markJobClosed]);

  const handleDelete = useCallback(() => {
    // #92: only the owner's delete reaches the server. Anyone else's matched
    // 0 rows under RLS while this device wiped the job and every cached child
    // record — and the job came back on the next load.
    if (!hubPerms.canDelete) {
      showAlert(
        "You can't delete this job",
        hubPerms.canLeave
          ? 'Only the project owner can delete it. You can leave it instead.'
          : "Your access to this job hasn't been confirmed on this device yet. Check your signal and reopen the job.",
      );
      return;
    }
    // NAME THE JOB. This is the most destructive action in the product — no
    // undo, no trash — and until 2026-09-07 it read "Delete this project and
    // everything in it?" to a GC running eight of them, on a modal that hides
    // the screen behind it. "This" is not something you can check before you
    // tap Delete. project.name is right here; the button that opened this
    // dialog lives inside the loaded-project branch, so the fallback is only
    // for the impossible case.
    const name = project?.name?.trim() || 'this project';
    if (deleteSafety.refusal) { showDeleteRefusal(deleteSafety.refusal, true); return; } // #61
    const { knownIncidents, safetyLine } = deleteSafety;
    showAlert(
      `Delete ${name}?`,
      `This permanently removes ${name} and everything in it: invoices, change orders, daily reports, punch items, photos, RFIs, submittals, permits, COIs, warranties, OAC meetings, field tickets, and its safety records (JHAs, toolbox talks, hazards). A job with injury or near-miss records can't be deleted — close it instead. This cannot be undone.${safetyLine}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (!id) return;
            deletingRef.current = true;
            void (async () => {
              // CONTRACT 22: deleteProject refuses BEFORE anything local is
              // touched — nothing is removed and we stay on the job.
              // Only a POSITIVE count is passed. SafetyContext marks incidents
              // hydrated even when the server read failed and it fell back to
              // this phone's cache, so a 0 here can be stale (an incident filed
              // on another device). With no count the context runs its own
              // device + queue + server check and refuses offline.
              const res = await deleteProject(id, knownIncidents !== undefined && knownIncidents > 0 ? { safetyIncidentCount: knownIncidents } : undefined);
              if (!res.ok) {
                deletingRef.current = false;
                showDeleteRefusal(res.reason, res.action === DELETE_SAFETY_ACTION);
                return;
              }
              if (Platform.OS !== 'web') {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              router.back();
            })();
          },
        },
      ]
    );
  }, [id, project?.name, deleteProject, router, hubPerms.canDelete, hubPerms.canLeave, deleteSafety, showDeleteRefusal]);

  // #92 — a collaborator's way off a job. Delete is the owner's alone (RLS
  // refuses anyone else's delete with 0 rows and no error, which the queue
  // counts as done, so the job came back on the next load). Leave revokes his
  // OWN project_collaborators row on the server and only then lets the
  // project drop from this device; the job's records are the owner's and are
  // not touched here.
  const queryClient = useQueryClient();
  const safeBack = useSafeBack();
  const [leaving, setLeaving] = useState(false);
  // #8/#128: the pre-leave flush + count (a Leave tap on a weak signal can
  // take a few seconds; the button says what it is doing).
  const [checkingLeave, setCheckingLeave] = useState(false);
  // #8/#128: before he leaves, send what he can WHILE HE IS STILL A MEMBER
  // (the leave sweep discards every write still queued for the job the moment
  // the server drops his row), then count what is left. Best-effort each: a
  // flush that cannot reach the server leaves the entries, and the count says so.
  const flushThenCountForLeave = useCallback(async (): Promise<number> => {
    if (!id) return 0;
    try { await flushPendingProjectSyncs(); } catch { /* counted below */ }
    try { await processOfflineQueue(); } catch { /* counted below */ }
    try { await processPhotoUploadQueue(); } catch { /* counted below */ }
    try { return await countQueuedForProject(id); } catch { return 0; }
  }, [id, flushPendingProjectSyncs, countQueuedForProject]);

  const handleLeave = useCallback(() => {
    if (!id || leaving || checkingLeave) return;
    const name = project?.name?.trim() || 'this project';
    // The server call, reached only from the destructive button below.
    const runLeave = async () => {
      setLeaving(true);
      let reached = true;
      let serverError: string | null = null;
      let ok = false;
      try {
        const res = await supabase.functions.invoke('project-invite', { body: { action: 'leave', projectId: id } });
        if (res.error) {
          const err = res.error as { name?: string; message?: string; context?: { json?: () => Promise<unknown> } };
          if (err.name === 'FunctionsFetchError' || err.name === 'FunctionsRelayError') reached = false;
          else {
            const body = await err.context?.json?.().catch(() => null) as { error?: string } | null | undefined;
            serverError = body?.error ?? err.message ?? 'unknown error';
          }
        } else {
          const data = res.data as { error?: string } | null;
          if (data?.error) serverError = data.error;
          else ok = true;
        }
      } catch {
        reached = false;
      }
      const failure = leaveFailureMessage({ reached, serverError, ok });
      if (failure) {
        setLeaving(false);
        showAlert("Couldn't leave this project", failure);
        return;
      }
      // Confirmed by the server. Take the job off this device AS ONE HE
      // LEFT (forgetSharedProject records it) before anything re-reads
      // the list — otherwise the reload finds it gone with a foreign
      // owner, reads that as the owner removing him (#90), and tells
      // him so: a guess shown as fact, on top of "You left".
      const forgot = forgetSharedProject(id);
      void queryClient.invalidateQueries({ queryKey: ['project_collaborators', id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // #8/#128: the sweep reports how many unsent changes went with the job.
      const dropped = forgot.ok ? await (forgot.dropped ?? Promise.resolve(0)).catch(() => 0) : 0;
      setLeaving(false);
      showAlert('You left the project', leftProjectMessage(name, forgot.ok, dropped));
      safeBack();
    };
    void (async () => {
      setCheckingLeave(true);
      const pending = await flushThenCountForLeave();
      // Integration round 3: the part a sync can never send (under Not saved).
      const unsaved = pending > 0 ? await countUnsavedForProject(id).catch(() => 0) : 0;
      setCheckingLeave(false);
      // Android's Alert shows at most three buttons (leaveDialogCopy).
      const copy = leaveDialogCopy(name, pending, unsaved, Platform.OS === 'android' ? 3 : 4);
      showAlert(copy.title, copy.message, [
        { text: 'Cancel', style: 'cancel' },
        // "Sync first" re-runs the drain and asks again with the new count.
        ...(copy.offerSyncFirst ? [{ text: 'Sync first', onPress: () => { handleLeaveRef.current(); } }] : []),
        // Refused lines go only through Retry / Discard on the sheet.
        ...(copy.offerOpenNotSaved ? [{ text: 'Open Not saved', onPress: () => { requestSyncSheet(); } }] : []),
        {
          text: copy.leaveLabel,
          style: 'destructive' as const,
          onPress: () => {
            void (async () => {
              // Re-counted at the tap: a change queued while the dialog was
              // open must not be discarded behind a "nothing pending" dialog.
              // (More than the dialog said — not merely > 0: with only Not-saved
              // lines left, "Leave anyway" re-opened this same dialog forever.)
              if (!copy.offerSyncFirst) {
                const now = await countQueuedForProject(id).catch(() => 0);
                if (now > pending) { handleLeaveRef.current(); return; }
              }
              await runLeave();
            })();
          },
        },
      ]);
    })();
  }, [id, leaving, checkingLeave, project?.name, flushThenCountForLeave, countQueuedForProject, countUnsavedForProject, queryClient, safeBack, forgetSharedProject]);
  const handleLeaveRef = useRef(handleLeave);
  handleLeaveRef.current = handleLeave;


  // --- Estimate-dependent hooks ---
  // These must live ABOVE the `if (!project)` early return so they run on
  // every render. They already handle the null case internally.
  const totalBreakdown = useMemo(() => {
    if (!estimate) return null;
    // Percentages are of the SUBTOTAL, but an estimate saved without one (a
    // wizard/older shape) printed 0.0% on every row next to a real Grand
    // Total. Fall back to the rows' own sum — a real figure, not a guess.
    const rowsSum = (estimate.materialTotal ?? 0) + (estimate.laborTotal ?? 0)
      + (estimate.permits ?? 0) + (estimate.overhead ?? 0);
    const base = estimate.subtotal > 0 ? estimate.subtotal : rowsSum;
    const pctOf = (v: number | undefined) => (base > 0 ? ((v ?? 0) / base) * 100 : 0);
    const materialPct = pctOf(estimate.materialTotal);
    const laborPct = pctOf(estimate.laborTotal);
    const permitPct = pctOf(estimate.permits);
    const overheadPct = pctOf(estimate.overhead);
    // Older / demo shapes (utils/demoSeed onboarding projects) store tax as
    // `taxAmount` and carry a `markupAmount` EstimateBreakdown has no field
    // for. Read both, so the breakdown labels them instead of lumping $106,900
    // of markup and tax into "Other / unreconciled".
    const legacy = estimate as unknown as { taxAmount?: number; markupAmount?: number };
    const tax = estimate.tax ?? legacy.taxAmount ?? 0;
    const markup = legacy.markupAmount != null && Number.isFinite(legacy.markupAmount) ? legacy.markupAmount : 0;
    const taxRate = pctOf(tax);
    const contingencyRate = pctOf(estimate.contingency);
    // Whatever the Grand Total holds that the rows above do not explain
    // (to the cent) is printed as its own line, so the sheet adds up instead
    // of silently disagreeing with its own total. Buyout savings are NOT part
    // of it: a stored grandTotal is never net of savings (they are computed
    // later, from awards), so subtracting them here printed the savings back
    // as "+ Other / unreconciled" right under "− Bulk savings". They are shown
    // BELOW the Grand Total, as a total after buyout.
    const explained = base + tax + markup + (estimate.contingency ?? 0);
    const unreconciled = Math.round(((estimate.grandTotal ?? 0) - explained) * 100) / 100;
    return { base, materialPct, laborPct, permitPct, overheadPct, tax, markup, taxRate, contingencyRate, unreconciled };
  }, [estimate]);

  const savingsBreakdown = useMemo(() => {
    if (!estimate) return null;
    // Defensive: a persisted estimate from an older schema may be missing
    // .materials. Treat missing/non-array as empty so the savings panel
    // renders zeros instead of crashing on .filter/.length.
    const materials = Array.isArray(estimate.materials) ? estimate.materials : [];
    const itemsWithSavings = materials.filter(m => (m.savings ?? 0) > 0);
    const topSavers = [...itemsWithSavings].sort((a, b) => (b.savings ?? 0) - (a.savings ?? 0)).slice(0, 8);
    // Use the buyout-derived savings (real), not a seeded fabricated field.
    const savingsRate = (estimate.grandTotal ?? 0) > 0 && showBulkSavings ? (totalBulkSavings / ((estimate.grandTotal ?? 0) + totalBulkSavings)) * 100 : 0;
    const itemsAtBulk = itemsWithSavings.length;
    const totalItems = materials.length;
    return { topSavers, totalBulkSavings, savingsRate, itemsAtBulk, totalItems };
  }, [estimate, totalBulkSavings, showBulkSavings]);

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
            <BarChart3 size={28} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={detailStyles.heroAmount}>{formatMoney(estimate.grandTotal)}</Text>
          <Text style={detailStyles.heroSubtitle}>Total Project Value</Text>
          <View style={detailStyles.heroChips}>
            <View style={detailStyles.heroChip}>
              <Text style={detailStyles.heroChipLabel}>${(estimate.pricePerSqFt ?? 0).toFixed(2)}</Text>
              <Text style={detailStyles.heroChipSub}>per sq ft</Text>
            </View>
            {showBulkSavings ? (
              <View style={[detailStyles.heroChip, { backgroundColor: themeColors.successSoft }]}>
                <Text style={[detailStyles.heroChipLabel, { color: themeColors.success }]}>-{formatMoney(totalBulkSavings)}</Text>
                <Text style={[detailStyles.heroChipSub, { color: themeColors.success }]}>savings applied</Text>
              </View>
            ) : null}
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
              <Text style={detailStyles.additionalValue}>{formatMoney(totalBreakdown.tax)}</Text>
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
          {showBulkSavings ? (
            <>
              <View style={detailStyles.additionalDivider} />
              <View style={detailStyles.additionalRow}>
                <View style={detailStyles.additionalLeft}>
                  <View style={[detailStyles.additionalDot, { backgroundColor: themeColors.success }]} />
                  <Text style={[detailStyles.additionalLabel, { color: themeColors.success }]}>Bulk Savings</Text>
                </View>
                <View style={detailStyles.additionalRight}>
                  <Text style={[detailStyles.additionalValue, { color: themeColors.success }]}>-{formatMoney(totalBulkSavings)}</Text>
                </View>
              </View>
            </>
          ) : null}
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
            <Text style={detailStyles.breakdownValueBold}>{formatMoney(totalBreakdown.base)}</Text>
          </View>
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.breakdownLabel}>+ Tax</Text>
            <Text style={detailStyles.breakdownValue}>{formatMoney(totalBreakdown.tax)}</Text>
          </View>
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.breakdownLabel}>+ Contingency</Text>
            <Text style={detailStyles.breakdownValue}>{formatMoney(estimate.contingency)}</Text>
          </View>
          {totalBreakdown.markup !== 0 ? (
            <View style={detailStyles.breakdownRow} testID="cost-breakdown-markup">
              <Text style={detailStyles.breakdownLabel}>+ Markup</Text>
              <Text style={detailStyles.breakdownValue}>{formatMoney(totalBreakdown.markup)}</Text>
            </View>
          ) : null}
          {Math.abs(totalBreakdown.unreconciled) >= 0.01 ? (
            <View style={detailStyles.breakdownRow} testID="cost-breakdown-unreconciled">
              <Text style={detailStyles.breakdownLabel}>{totalBreakdown.unreconciled > 0 ? '+' : '-'} Other / unreconciled</Text>
              <Text style={detailStyles.breakdownValue}>{totalBreakdown.unreconciled > 0 ? '' : '-'}{formatMoney(Math.abs(totalBreakdown.unreconciled))}</Text>
            </View>
          ) : null}
          <View style={detailStyles.breakdownDividerThick} />
          <View style={detailStyles.breakdownRow}>
            <Text style={detailStyles.grandLabel}>Grand Total</Text>
            <Text style={detailStyles.grandValue}>{formatMoney(estimate.grandTotal)}</Text>
          </View>
          {showBulkSavings ? (
            <>
              <View style={detailStyles.breakdownRow} testID="cost-breakdown-buyout-savings">
                <Text style={[detailStyles.breakdownLabel, { color: themeColors.success }]}>- Buyout savings (awarded packages)</Text>
                <Text style={[detailStyles.breakdownValue, { color: themeColors.success }]}>-{formatMoney(totalBulkSavings)}</Text>
              </View>
              <View style={detailStyles.breakdownRow}>
                <Text style={detailStyles.breakdownLabelBold}>Total after buyout savings</Text>
                <Text style={detailStyles.breakdownValueBold}>{formatMoney(Math.round(((estimate.grandTotal ?? 0) - totalBulkSavings) * 100) / 100)}</Text>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    );
  }, [estimate, totalBreakdown, insets.bottom, showBulkSavings, totalBulkSavings]);

  const renderSavingsDetailModal = useCallback(() => {
    if (!estimate || !savingsBreakdown) return null;

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <View style={detailStyles.heroSection}>
          <View style={[detailStyles.heroIconWrap, { backgroundColor: themeColors.successSoft }]}>
            <TrendingDown size={28} color={themeColors.success} strokeWidth={1.75} />
          </View>
          <Text style={[detailStyles.heroAmount, { color: themeColors.success }]}>{formatMoney(totalBulkSavings)}</Text>
          <Text style={detailStyles.heroSubtitle}>Total Bulk Savings</Text>
          <View style={detailStyles.heroChips}>
            {showBulkSavings && (savingsBreakdown.savingsRate ?? 0) > 0 ? (
              <View style={[detailStyles.heroChip, { backgroundColor: themeColors.successSoft }]}>
                <Text style={[detailStyles.heroChipLabel, { color: themeColors.success }]}>{(savingsBreakdown.savingsRate ?? 0).toFixed(1)}%</Text>
                <Text style={[detailStyles.heroChipSub, { color: themeColors.success }]}>savings rate</Text>
              </View>
            ) : null}
            <View style={detailStyles.heroChip}>
              <Text style={detailStyles.heroChipLabel}>{savingsBreakdown.itemsAtBulk}/{savingsBreakdown.totalItems}</Text>
              <Text style={detailStyles.heroChipSub}>items w/ savings</Text>
            </View>
          </View>
        </View>

        {/* Provenance chip — shows only when savings are from real buyout data */}
        {showBulkSavings ? (
          <>
            <Text style={detailStyles.sectionLabel}>Source</Text>
            <View style={[detailStyles.infoCard, { paddingVertical: 12 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ArrowDownRight size={16} color={themeColors.success} strokeWidth={1.75} />
                <Text style={[detailStyles.infoDesc, { flex: 1 }]}>
                  Measured from your buyout · {bulkSavingsSummary.awardedPackageCount} awarded package{bulkSavingsSummary.awardedPackageCount !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>

            {bulkSavingsSummary.byPackage.length > 0 && (
              <>
                <Text style={detailStyles.sectionLabel}>By Package</Text>
                <View style={detailStyles.topSaversCard}>
                  {bulkSavingsSummary.byPackage.map((pkg, idx) => (
                    <View key={pkg.packageId}>
                      <View style={detailStyles.saverRow}>
                        <View style={detailStyles.saverInfo}>
                          <Text style={detailStyles.saverName} numberOfLines={1}>{pkg.packageName}</Text>
                          <Text style={detailStyles.saverMeta}>Budget {formatMoney(pkg.estimateBudget)} · Awarded {formatMoney(pkg.awardedAmount)}</Text>
                        </View>
                        <View style={detailStyles.saverSavings}>
                          <Text style={[detailStyles.saverAmount, pkg.savings < 0 ? { color: themeColors.danger } : {}]}>
                            {pkg.savings < 0 ? '+' : '-'}{formatMoney(Math.abs(pkg.savings))}
                          </Text>
                          <Text style={detailStyles.saverPct}>{pkg.savings >= 0 ? 'saved' : 'over'}</Text>
                        </View>
                      </View>
                      {idx < bulkSavingsSummary.byPackage.length - 1 && <View style={detailStyles.saverDivider} />}
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        ) : null}

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
      </ScrollView>
    );
  }, [estimate, savingsBreakdown, showBulkSavings, bulkSavingsSummary, insets.bottom, themeColors]);

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
  // A section tile's press — the phone grid's push chain, moved here verbatim
  // so the desktop section index runs the same one (the tile's final
  // setActiveTile is now openSection: the URL on desktop web). On
  // desktop web a log section opens its log first (lanes G/H: RFIs,
  // submittals, change orders, invoices, daily reports; the punch list).
  const pressTile = useCallback((tile: { key: SectionKey }) => {
    if (deskWeb && isListSection(tile.key)) { router.push(routeHref(LIST_SECTION_ROUTES[tile.key], { projectId: id ?? '' })); return; }
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
    if (tile.key === 'safety') { router.push({ pathname: '/safety' as any, params: { projectId: id } }); return; }
    if (tile.key === 'timeTracking') { router.push({ pathname: '/time-tracking' as any, params: { projectId: id } }); return; }
    if (tile.key === 'fieldTickets') { router.push({ pathname: '/field-ticket' as any, params: { projectId: id } }); return; }
    if (tile.key === 'deliveries') { router.push({ pathname: '/deliveries', params: { projectId: id } }); return; }
    if (tile.key === 'projectFiles') { router.push({ pathname: '/project-files' as any, params: { projectId: id } }); return; }
    if (tile.key === 'scope') { router.push({ pathname: '/project-scope', params: { id } } as never); return; }
    openSection(tile.key);
  }, [deskWeb, router, id, handleExportCalendar, openSection]);
  // The schedule, from the KPI strip and the overview: the existing push
  // (router.replace + the focus nonce — MobileScheduleScreen otherwise keeps
  // whichever job it last showed). Lane DC sends Pro tiers on desktop web on
  // to Schedule Pro.
  //
  // Wave 6d (F8): on desktop web the link is scheduleDestination's (the one
  // answer to "which schedule screen"), and Schedule Pro is PUSHED, so Back
  // returns to this job page. It used to replace to the classic tab, which
  // then <Redirect>ed to Pro — two replaces, and Back skipped the job. The
  // phone line below is unchanged.
  const openSchedule = useCallback(() => {
    if (deskWeb) {
      const href = scheduleDestination({
        projectId: id ?? '',
        webDesktop: true,
        canPro: canOpenSchedulePro(canAccess(SCHEDULE_PRO_FEATURE), project?.myRole),
        proFits: proFitsWindow(layout.width, true, getSidebarRail().pref),
      });
      if (href.pathname === '/schedule-pro') router.push(href); else router.replace(href);
      return;
    }
    router.replace(routeHref('/(tabs)/schedule', { projectId: id ?? '', focus: String(Date.now()) }));
  }, [router, id, deskWeb, canAccess, project?.myRole, layout.width]);
  const buildSchedule = useCallback(() => { router.replace(routeHref('/(tabs)/discover/schedule')); }, [router]);
  // Cmd/Ctrl+Enter (and Cmd+S) save the edit and note sheets on desktop web.
  useSheetPrimaryHotkey(showEditModal, handleSaveEdit);
  const saveNoteDraft = useCallback(() => { submitNote(noteDraft); setShowNoteModal(false); }, [submitNote, noteDraft]);
  useSheetPrimaryHotkey(showNoteModal, noteDraft.trim() ? saveNoteDraft : null);

  const headerRight = useCallback(
    () => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TouchableOpacity onPress={() => router.push({ pathname: '/scan' as any, params: { projectId: id } })} style={{ padding: 6 }} activeOpacity={0.7} testID="project-scan-btn" accessibilityRole="button" accessibilityLabel="Scan a document"><ScanLine size={20} color={themeColors.accent} strokeWidth={1.75} /></TouchableOpacity>
        <TouchableOpacity onPress={requestEdit} style={{ padding: 6 }} activeOpacity={0.7} testID="edit-project-btn" accessibilityRole="button" accessibilityLabel={hubPerms.editBlockedReason ? `Edit, unavailable. ${hubPerms.editBlockedReason}` : 'Edit'}><Pencil size={20} color={hubPerms.editBlockedReason ? themeColors.textMuted : themeColors.accent} strokeWidth={1.75} /></TouchableOpacity>
      </View>
    ),
    [requestEdit, hubPerms.editBlockedReason, router, id, themeColors.accent, themeColors.textMuted],
  );
  // #70/#94: opened cold from a push, a link or a reload there is nothing to
  // pop, and the stack drew no back arrow — the job was a dead end. Offer a
  // way to the Projects list only then; a normal push keeps the native back.
  const canGoBack = router.canGoBack();
  const headerLeft = useCallback(
    () => (
      <TouchableOpacity
        onPress={() => router.replace('/(tabs)/(home)')}
        style={{ padding: 6, flexDirection: 'row', alignItems: 'center' }}
        activeOpacity={0.7}
        testID="project-header-home"
        accessibilityRole="button"
        accessibilityLabel="Back to your projects"
      >
        <ChevronLeft size={22} color={themeColors.accent} strokeWidth={1.75} />
      </TouchableOpacity>
    ),
    [router, themeColors.accent],
  );
  // Desktop: the workspace header carries the name and the actions, so the
  // stack header is hidden (the title still names the browser tab).
  const stackScreenOptions = useMemo(
    () => ({ title: project?.name || 'Project Details', headerRight, ...(canGoBack ? {} : { headerLeft }), ...(isDesktop ? { headerShown: false } : {}) }),
    [project?.name, headerRight, canGoBack, headerLeft, isDesktop],
  );

  if (!project) {
    // Distinguish "still hydrating" (or mid-delete) from "genuinely missing".
    // getProject(id) returns null in every case, so without this a valid
    // project deep-linked on a cold start flashed "Project not found" for a
    // frame before the store loaded — and again briefly right after a delete.
    // #111/#130: and while the list is re-reading — a job he just joined (or
    // a link to one just shared) arrives with that refetch; "not found" is
    // said only after a read has finished without it.
    const missing = missingProjectView({
      projectsLoaded, projectsFetching: !!projectsFetching, deleting: deletingRef.current, justJoined: justJoinedParam === '1',
    });
    if (missing === 'loading') {
      return (
        <>
          <Stack.Screen options={{ title: 'Loading…' }} />
          <CraneLoader label="Loading projects" />
        </>
      );
    }
    if (missing === 'joined') {
      return (
        <View style={[styles.container, styles.center, { backgroundColor: themeColors.bg }]} testID="project-just-joined-missing">
          <Stack.Screen options={{ title: 'Project' }} />
          <Text style={styles.notFoundText}>{JUST_JOINED_NOT_LOADED}</Text>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => { void queryClient.refetchQueries({ queryKey: ['projects', authUser?.id] }); }}
            accessibilityRole="button"
            testID="project-just-joined-retry"
          >
            <Text style={styles.backBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
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

  const heroTotal = effectiveEstimateTotal(project);
  // THE one % complete (utils/projectProgress, via the pulse).
  const heroProgress = pulse.progress;
  const heroLabel = linkedEstimate ? `${linkedItems.length} items` : estimate ? `${Array.isArray(estimate.materials) ? estimate.materials.length : 0} materials` : '';

  // ── The hub's tiles: the phone grid and the desktop section index ──
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
    dailyReports: FIELD_COLOR, timeTracking: FIELD_COLOR, fieldTickets: FIELD_COLOR, deliveries: FIELD_COLOR, safety: FIELD_COLOR,
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
    scope: DOCS_COLOR,
    // people
    collaborators: PEOPLE_COLOR, clientPortal: PEOPLE_COLOR,
    oacMeetings: PEOPLE_COLOR, communications: PEOPLE_COLOR,
  };
  const colorFor = (k: SectionKey): string => GROUP_BY_KEY[k] ?? NEUTRAL;
  const allTiles: Tile[] = [
    ...(hasAnyEstimate ? [{ key: 'linkedEstimate' as SectionKey, label: 'Estimate Items', icon: MageEstimate, color: colorFor('linkedEstimate'), count: linkedItems.length || estimate?.materials.length || 0 }] : []),
    ...(project.schedule ? [{ key: 'schedule' as SectionKey, label: 'Schedule', icon: MageSchedule, color: colorFor('schedule'), count: Array.isArray(project.schedule.tasks) ? project.schedule.tasks.length : 0 }] : []),
    // #173: no number while the roster is loading / failed, or for a
    // collaborator (who can read only his own row) — never a guessed 1.
    { key: 'collaborators', label: teamCount ? `Team (${teamCount})` : 'Team', icon: Users, color: colorFor('collaborators'), count: null as number | null },
    { key: 'contract', label: 'Contract', icon: MageContract, color: colorFor('contract'), count: null as number | null },
    { key: 'selections', label: 'Selections', icon: PenTool, color: colorFor('selections'), count: null as number | null },
    { key: 'lienWaivers', label: 'Lien Waivers', icon: ScrollText, color: colorFor('lienWaivers'), count: null as number | null },
    { key: 'closeoutBinder', label: 'Closeout Binder', icon: BookOpen, color: colorFor('closeoutBinder'), count: null as number | null },
    { key: 'handover', label: 'Handover Checklist', icon: Footprints, color: colorFor('handover'), count: null as number | null },
    { key: 'changeOrders', label: 'Change Orders', icon: MageChangeOrder, color: colorFor('changeOrders'), count: changeOrders.length },
    { key: 'invoices', label: 'Invoices', icon: MageInvoice, color: colorFor('invoices'), count: projectInvoices.length },
    { key: 'dailyReports', label: 'Daily Reports', icon: MageDailyReport, color: colorFor('dailyReports'), count: dailyReports.length },
    // T&M ticket — extra work signed for on site. The badge counts
    // SIGNED-BUT-UNBILLED tickets, because that number is money the GC
    // has already earned and not yet asked for.
    { key: 'fieldTickets', label: 'T&M Tickets', icon: FileSignature, color: colorFor('fieldTickets'), count: projectFieldTickets.filter(x => x.status === 'signed').length },
    // PRODUCT-F4 / UX-F16: Deliveries had no entry point on iPhone at all.
    { key: 'deliveries', label: 'Deliveries', icon: Truck, color: colorFor('deliveries'), count: null as number | null },
    { key: 'timeTracking', label: 'Time Tracking', icon: Clock, color: colorFor('timeTracking'), count: null as number | null },
    // #81: Safety had no way in from the job. The hub and its project
    // picker are app/safety.tsx's; this only opens it on this job.
    { key: 'safety', label: 'Safety', icon: HardHat, color: colorFor('safety'), count: null as number | null },
    { key: 'punchList', label: 'Punch List', icon: MagePunch, color: colorFor('punchList'), count: punchItems.length },
    { key: 'rfis', label: 'RFIs', icon: MageRFI, color: colorFor('rfis'), count: projectRFIs.length },
    { key: 'submittals', label: 'Submittals', icon: MageSubmittal, color: colorFor('submittals'), count: projectSubmittals.length },
    { key: 'oacMeetings', label: 'OAC Meetings', icon: Presentation, color: colorFor('oacMeetings'), count: projectOACMeetings.length },
    { key: 'permits', label: 'Permits', icon: Shield, color: colorFor('permits'), count: projectPermits.length },
    { key: 'projectFiles', label: 'Project Files', icon: Archive, color: colorFor('projectFiles'), count: null as number | null },
    { key: 'scope', label: 'Scope', icon: ClipboardList, color: colorFor('scope'), count: null as number | null },
    ...(hasAnyEstimate ? [{ key: 'budget' as SectionKey, label: 'Financial Health', icon: MageMargin, color: colorFor('budget'), count: null as number | null }] : []),
    { key: 'photos', label: 'Photos', icon: Camera, color: colorFor('photos'), count: projectPhotos.length },
    { key: 'plans', label: 'Plans', icon: MagePlans, color: colorFor('plans'), count: projectPlans.length },
    { key: 'clientPortal', label: 'Client Portal', icon: Globe, color: colorFor('clientPortal'), count: null as number | null },
    { key: 'communications', label: 'Communications', icon: Mail, color: colorFor('communications'), count: commEvents.length },
    { key: 'activity', label: 'Activity', icon: Activity, color: colorFor('activity'), count: null as number | null },
    { key: 'calendar', label: 'Calendar Feed', icon: CalendarDays, color: colorFor('calendar'), count: null as number | null },
  ];

  const groups: { key: TileGroupKey; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; color: string; tileKeys: SectionKey[] }[] = [
    { key: 'field', label: 'Field Ops', icon: HardHat, color: themeColors.accent, tileKeys: ['dailyReports', 'fieldTickets', 'deliveries', 'timeTracking', 'safety', 'punchList', 'photos', 'plans', 'schedule'] },
    { key: 'money', label: 'Money', icon: DollarSign, color: themeColors.success, tileKeys: ['budget', 'contract', 'selections', 'linkedEstimate', 'changeOrders', 'invoices', 'lienWaivers', 'closeoutBinder', 'handover'] },
    { key: 'docs', label: 'Documentation', icon: FolderOpen, color: themeColors.info, tileKeys: ['rfis', 'submittals', 'permits', 'projectFiles', 'scope', 'activity', 'calendar'] },
    { key: 'people', label: 'People & Communication', icon: Users, color: themeColors.info, tileKeys: ['collaborators', 'clientPortal', 'oacMeetings', 'communications'] },
  ];

  // #92: the tiles follow the role. Money (and Financial Health) only
  // for a role that may see money — hidden, not zeroed: "Invoices (0)"
  // to a foreman is a guess shown as fact. The Client Portal is the
  // owner's alone. Anyone else reaching these tiles met screens that
  // either blinded him or silently failed his writes.
  const visibleTiles = allTiles.filter(t => hubTileVisible(t.key, hubPerms));
  const tileByKey = new Map<SectionKey, Tile>(visibleTiles.map(t => [t.key, t]));

  // Every section's body, drawn once: the phone's section sheet and the
  // desktop side panel host the same JSX (moved here verbatim, wave 6c).
  const sectionBody = (
    <>

        {linkedEstimate && linkedItems.length > 0 && activeTile === 'linkedEstimate' && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() => toggleSection('linkedEstimate')}
              activeOpacity={0.7}
              testID="linked-estimate-section"
            >
              <ShoppingCart size={20} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>
                Estimate Items — {formatMoney(linkedEstimate.grandTotal, 2)}
              </Text>
              {expanded.linkedEstimate ? (
                <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
              ) : (
                <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
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
                            <TrendingDown size={10} color={themeColors.success} strokeWidth={1.75} />
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
                    // Same context drop as :2335 — this link's own label prints
                    // THIS project's task count and then opened another project.
                    onPress={() => navigateFromTile({ pathname: '/(tabs)/schedule', params: { projectId: id ?? '', focus: String(Date.now()) } } as any, 'replace')}
                    activeOpacity={0.7}
                    testID="estimate-view-schedule-link"
                  >
                    <CalendarDays size={16} color={themeColors.info} strokeWidth={1.75} />
                    <Text style={styles.crossLinkText}>View Schedule ({Array.isArray(project.schedule.tasks) ? project.schedule.tasks.length : 0} tasks · {project.schedule.totalDurationDays ?? 0}d)</Text>
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ── Save as revision button ── */}
            <TouchableOpacity
              style={styles.revSaveBtn}
              onPress={() => {
                const doSave = (note?: string) => {
                  const patch = snapshotPatch(project, 'manual', note?.trim() || undefined);
                  if (Object.keys(patch).length) {
                    updateProject(project.id, patch);
                    nailIt('Revision saved');
                  } else {
                    showAlert('No Changes', 'This estimate is identical to the latest revision.');
                  }
                };
                if (Platform.OS === 'ios') {
                  showPrompt(
                    'Save Revision',
                    'Add an optional note for this revision:',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Save', onPress: (note?: string) => doSave(note) },
                    ],
                    'plain-text',
                  );
                } else {
                  // Android / web fallback — save immediately without a note prompt.
                  doSave();
                }
              }}
              activeOpacity={0.7}
              testID="save-estimate-revision-btn"
            >
              <Layers size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.revSaveBtnText}>Save as Revision</Text>
            </TouchableOpacity>

            {/* ── Revisions subsection ── */}
            {(() => {
              const versions = (project.estimateVersions ?? []).slice().reverse(); // newest first
              return (
                <View style={styles.revSection}>
                  <Text style={styles.revSectionTitle}>Revisions</Text>
                  {versions.length === 0 && (
                    <Text style={styles.revEmptyText}>
                      No revisions yet — saved automatically when you re-estimate or send to a client.
                    </Text>
                  )}
                  {versions.map((rev) => (
                    <TouchableOpacity
                      key={rev.id}
                      style={styles.revRow}
                      onPress={() => { setSelectedRevision(rev); setRevDetailView('delta'); }}
                      activeOpacity={0.7}
                      testID={`rev-row-${rev.id}`}
                    >
                      <View style={styles.revRowLeft}>
                        <Text style={styles.revRowTitle}>Rev {rev.revNumber}</Text>
                        <Text style={styles.revRowMeta}>
                          {new Date(rev.createdAt).toLocaleDateString()} · {ESTIMATE_REASON_LABEL[rev.reason]}
                        </Text>
                      </View>
                      <Text style={styles.revRowTotal}>{formatMoney(rev.grandTotal)}</Text>
                      <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}

            {/* ── Create proposal from estimate ── */}
            {(() => {
              const versions = (project.estimateVersions ?? [])
                .slice()
                .sort((a, b) => b.revNumber - a.revNumber); // newest first
              const hasVersions = versions.length > 0;
              if (!hasVersions) {
                return (
                  <TouchableOpacity
                    style={[styles.revSaveBtn, { opacity: 0.45 }]}
                    disabled
                    activeOpacity={1}
                    testID="create-proposal-disabled"
                  >
                    <FileText size={16} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.revSaveBtnText}>Create Proposal — save a revision first</Text>
                  </TouchableOpacity>
                );
              }
              const handleCreateProposal = () => {
                if (versions.length === 1) {
                  // Only one revision — skip picker and go straight to it.
                  router.push({ pathname: '/contract' as any, params: { projectId: id, fromRevision: versions[0].id } });
                  return;
                }
                showAlert(
                  'Create Proposal',
                  'Choose a revision to base the proposal on:',
                  [
                    ...versions.map(rev => ({
                      text: `Rev ${rev.revNumber} · $${(rev.grandTotal ?? 0).toLocaleString()}${rev.note ? ' · ' + rev.note : ''}`,
                      onPress: () => {
                        router.push({ pathname: '/contract' as any, params: { projectId: id, fromRevision: rev.id } });
                      },
                    })),
                    { text: 'Cancel', style: 'cancel' as const },
                  ],
                );
              };
              return (
                <TouchableOpacity
                  style={styles.revSaveBtn}
                  onPress={handleCreateProposal}
                  activeOpacity={0.7}
                  testID="create-proposal-btn"
                >
                  <FileText size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.revSaveBtnText}>Create Proposal from Revision</Text>
                </TouchableOpacity>
              );
            })()}
            <ScopeGapsCard mode="project" projectId={project.id} />
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
              <CalendarDays size={20} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Schedule</Text>
              {expanded.schedule ? (
                <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
              ) : (
                <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
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
                    <View style={[styles.scheduleStatusDot, { backgroundColor: task.status === 'done' ? themeColors.success : task.status === 'in_progress' ? themeColors.info : themeColors.textMuted }]} />
                    <View style={styles.scheduleTaskTextWrap}>
                      <Text style={styles.scheduleTaskName}>{task.title}</Text>
                      <Text style={styles.scheduleTaskMeta}>{task.phase} · Day {task.startDay} · {task.durationDays}d · {task.crew}</Text>
                    </View>
                    <Text style={styles.scheduleTaskProgress}>{task.progress}%</Text>
                  </View>
                ))}

                <TouchableOpacity
                  style={styles.crossLinkBtn}
                  // Pass the CURRENT project so the schedule tab opens on it —
                  // without the param it shows whichever project was last
                  // active there (P0 context drop, 2026-07 sim audit). The
                  // `focus` nonce lets the schedule screen re-apply the param
                  // on every visit while ignoring stale sticky tab params.
                  onPress={() => navigateFromTile({ pathname: '/(tabs)/schedule', params: { projectId: id ?? '', focus: String(Date.now()) } } as any, 'replace')}
                  activeOpacity={0.7}
                  testID="schedule-open-full-link"
                >
                  <CalendarDays size={16} color={themeColors.info} strokeWidth={1.75} />
                  <Text style={styles.crossLinkText}>Open Full Schedule</Text>
                  <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>

                {hasAnyEstimate && (
                  <TouchableOpacity
                    style={styles.crossLinkBtn}
                    onPress={() => estimate ? openDetail('total') : undefined}
                    activeOpacity={estimate ? 0.7 : 1}
                    testID="schedule-view-estimate-link"
                  >
                    <Receipt size={16} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.crossLinkText}>View Estimate ({formatMoney(heroTotal)})</Text>
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                )}
                {!hasAnyEstimate && (
                  <TouchableOpacity
                    style={styles.crossLinkBtn}
                    onPress={() => navigateFromTile({ pathname: '/estimate-wizard', params: { projectId: id ?? '' } } as any, 'replace')}
                    activeOpacity={0.7}
                    testID="schedule-create-estimate-link"
                  >
                    <Receipt size={16} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.crossLinkText}>Create Estimate for This Project</Text>
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                )}
                {/* Dispatch to the marketplace — post this project's scope so
                    verified contractors bid. Reuses the homeowner-RFP pipeline
                    (post → bid → award creates the job in the winner's account),
                    prefilled from the project. */}
                <TouchableOpacity
                  style={styles.crossLinkBtn}
                  onPress={() => navigateFromTile({
                    pathname: '/post-rfp' as any,
                    params: {
                      prefillDescription: [project?.name, project?.description].filter(Boolean).join(' — '),
                      prefillAddress: project?.location ?? '',
                      prefillBudgetMax: heroTotal ? String(Math.round(heroTotal)) : '',
                      prefillWorkType: 'other',
                    },
                  })}
                  activeOpacity={0.7}
                  testID="project-post-for-bids"
                >
                  {/* Gavel, not Hammer — a hammer is carpentry. Gavel is already
                      the bid mark at components/DesktopSidebar.tsx:98; five
                      different glyphs meant "put this out to bid". */}
                  <Gavel size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.crossLinkText}>Post this project for bids</Text>
                  <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
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
                <Package size={20} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.sectionTitle}>
                  Materials — {formatMoney(estimate.materialTotal)}
                </Text>
                {expanded.materials ? (
                  <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
                ) : (
                  <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
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
                            <TrendingDown size={10} color={themeColors.success} strokeWidth={1.75} />
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
                <Users size={20} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.sectionTitle}>
                  Labor — {formatMoney(estimate.laborTotal)}
                </Text>
                {expanded.labor ? (
                  <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
                ) : (
                  <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
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
                <DollarSign size={20} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.sectionTitle}>Cost Summary</Text>
                {expanded.summary ? (
                  <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
                ) : (
                  <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
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
                  {showBulkSavings ? (
                    <View style={styles.summaryRow}>
                      <View style={styles.savingsHighlight}>
                        <TrendingDown size={14} color={themeColors.success} strokeWidth={1.75} />
                        <Text style={[styles.summaryLabel, { color: themeColors.success }]}>Bulk Savings</Text>
                      </View>
                      <Text style={[styles.summaryValue, { color: themeColors.success }]}>
                        -{formatMoney(totalBulkSavings)}
                      </Text>
                    </View>
                  ) : null}
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
                  <MageAIMark size={20} color={themeColors.accent} />
                  <Text style={styles.sectionTitle}>Tips & Notes</Text>
                  {expanded.notes ? (
                    <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
                  ) : (
                    <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
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
            <Users size={20} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>
              {teamCount ? `Team (${teamCount})` : 'Team'}
            </Text>
            {expanded.collaborators ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>

          {expanded.collaborators && (
            <View style={styles.collabCard}>
              {/* #174: "You (Owner)" only for the owner. A collaborator was
                  shown as the owner, with HIS OWN email under it. He sees a
                  neutral owner row — the owner's name is not readable from
                  his account, so none is guessed — and his own role. */}
              {hubRole === 'owner' ? (
                <View style={styles.collabMember} testID="team-owner-row-self">
                  <View style={[styles.collabAvatar, { backgroundColor: themeColors.accent }]}>
                    <Crown size={14} color={"#FFFFFF"} strokeWidth={1.75} />
                  </View>
                  <View style={styles.collabInfo}>
                    <Text style={styles.collabName}>You (Owner)</Text>
                    <Text style={styles.collabEmail}>{branding.email || 'Set email in settings'}</Text>
                  </View>
                  <View style={[styles.collabRoleBadge, { backgroundColor: themeColors.accent + '15' }]}>
                    <Text style={[styles.collabRoleText, { color: themeColors.accent }]}>Owner</Text>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.collabMember} testID="team-owner-row-other">
                    <View style={[styles.collabAvatar, { backgroundColor: themeColors.textMuted }]}>
                      <Crown size={14} color={"#FFFFFF"} strokeWidth={1.75} />
                    </View>
                    <View style={styles.collabInfo}>
                      <Text style={styles.collabName}>Project owner</Text>
                    </View>
                    <View style={[styles.collabRoleBadge, { backgroundColor: themeColors.line }]}>
                      <Text style={[styles.collabRoleText, { color: themeColors.textSecondary }]}>Owner</Text>
                    </View>
                  </View>
                  <View style={styles.collabMember} testID="team-you-row">
                    <View style={[styles.collabAvatar, { backgroundColor: themeColors.info }]}>
                      <Users size={14} color={"#FFFFFF"} strokeWidth={1.75} />
                    </View>
                    <View style={styles.collabInfo}>
                      <Text style={styles.collabName}>
                        {hubRole ? `You · ${ROLE_LABELS[hubRole]}` : 'You'}
                      </Text>
                      {!hubRole && (
                        <Text style={styles.collabEmail}>
                          {roleState.isError ? "Couldn't confirm your role on this job." : 'Checking your role on this job…'}
                        </Text>
                      )}
                    </View>
                  </View>
                </>
              )}

              {hubPerms.canLeave ? (
                // His account can read only his own collaborator row (RLS), so
                // the roster would be one line repeating the row above.
                <Text style={styles.collabEmail} testID="team-collaborator-note">
                  The project owner manages who else is on this job.
                </Text>
              ) : (
                <CollaboratorsManager projectId={project.id} onOpenClientPortal={() => openSection('clientPortal')} />
              )}
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
            <Repeat size={20} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>
              Change Orders ({changeOrders.length})
            </Text>
            {expanded.changeOrders ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>

          {expanded.changeOrders && (
            <View style={styles.coCard}>
              {changeOrders.length === 0 && (
                <Text style={styles.coEmptyText}>No change orders yet.</Text>
              )}
              {changeOrders.length > 0 && (() => {
                const counts = {
                  pending: changeOrders.filter(isPendingCO).length,
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
              {/* #39: the list and the Pending count read ONE predicate, and a
                  submitted CO's Approve / Reject row sits directly under ITS
                  row — so it can never show for a CO the filter is hiding. */}
              {(coFilter === 'all' ? changeOrders : changeOrders.filter(c => {
                if (coFilter === 'pending') return isPendingCO(c);
                if (coFilter === 'approved') return c.status === 'approved';
                return true;
              })).map(co => (
                <React.Fragment key={co.id}>
                  <TouchableOpacity
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
                  {co.status === 'submitted' && (
                    <View style={styles.coApproveRow} testID={`co-approve-row-${co.id}`}>
                      <TouchableOpacity
                        style={styles.coApproveBtn}
                        onPress={() => {
                          const impactDays = co.scheduleImpactDays ?? 0;
                          // A CO with schedule days now genuinely reflows the Gantt
                          // (anchor task extended → CPM re-run → successors shift →
                          // float + critical path recomputed). That is not something
                          // to do behind a one-handed jobsite tap, so it goes through
                          // the same preview-then-apply gesture resource leveling
                          // uses. The money-only case keeps the plain confirm.
                          if (impactDays > 0 && !co.scheduleImpactApplied && project?.schedule) {
                            setCoReflowPreview(co);
                            return;
                          }
                          showAlert(
                            `Approve CO #${co.number}?`,
                            `This commits ${formatMoney(co.changeAmount)} to the contract. This can't be undone with a tap.`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Approve',
                                onPress: () => {
                                  updateChangeOrder(co.id, { status: 'approved' });
                                  // Burst — change orders are real money/scope
                                  // events; the GC celebrates each approval.
                                  fireConfetti({ count: 35 });
                                  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                  showAlert('Approved', `CO #${co.number} has been approved.`);
                                },
                              },
                            ],
                          );
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.coApproveBtnText}>Approve CO #{co.number}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.coRejectBtn}
                        onPress={() => {
                          showAlert(
                            `Reject CO #${co.number}?`,
                            'This marks the change order rejected. You can reopen it later from the change-order screen.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Reject',
                                style: 'destructive',
                                onPress: () => {
                                  updateChangeOrder(co.id, { status: 'rejected' });
                                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                                },
                              },
                            ],
                          );
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.coRejectBtnText}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </React.Fragment>
              ))}
              {/* Approved, with real schedule days, that never landed on a task
                  — the client-portal case, where the CO is approved remotely and
                  nothing on the schedule could be matched to it. The days are
                  contractual either way; this is where the GC places them. */}
              {(project?.schedule?.tasks?.length ?? 0) > 0 && changeOrders
                .filter(co => co.status === 'approved' && (co.scheduleImpactDays ?? 0) > 0 && !co.scheduleImpactApplied)
                .map(co => (
                  <TouchableOpacity
                    key={`place-${co.id}`}
                    style={styles.coAddBtn}
                    onPress={() => setCoReflowPreview(co)}
                    activeOpacity={0.7}
                    testID={`co-place-days-${co.id}`}
                  >
                    <CalendarClock size={16} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.coAddBtnText}>
                      CO #{co.number}: place +{co.scheduleImpactDays}d on the schedule
                    </Text>
                  </TouchableOpacity>
                ))}
              {/* Draft by voice — MAGE Copilot: speak the change, confirm the
                  amount + schedule impact, hand off to the CO screen pre-filled. */}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/copilot', params: { capabilityId: 'change_order', projectId: id ?? '' } })}
                activeOpacity={0.7}
                testID="add-change-order-voice-btn"
              >
                <Mic size={16} color={themeColors.accent} strokeWidth={2} />
                <Text style={styles.coAddBtnText}>Draft by voice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/change-order' as any, params: { projectId: id, new: '1' } })}
                activeOpacity={0.7}
                testID="add-change-order-btn"
              >
                <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
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
            <Receipt size={20} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>
              Invoices ({projectInvoices.length})
            </Text>
            {expanded.invoices ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>

          {expanded.invoices && (
            <View style={styles.coCard}>
              {projectInvoices.length === 0 && (
                <Text style={styles.coEmptyText}>No invoices yet.</Text>
              )}
              {/* Money state at a glance. The per-row status pill already said
                  "Overdue"; what it never said was how much is actually out
                  the door and how long the worst one has been sitting. */}
              {projectAR.totals.totalOutstanding > 0 && (() => {
                const overdue = projectAR.rows.filter(r => r.daysPastDue > 0);
                const overdueTotal = overdue.reduce((s, r) => s + r.outstanding, 0);
                const worst = overdue.length > 0 ? overdue[0].daysPastDue : 0; // rows are worst-aged first
                return (
                  <View style={styles.arSummary} testID="invoices-ar-summary">
                    <View style={{ flex: 1 }}>
                      <Text style={styles.arSummaryLabel}>Outstanding</Text>
                      <Text style={styles.arSummaryValue}>{formatMoney(projectAR.totals.totalOutstanding, 2)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.arSummaryLabel}>Overdue</Text>
                      <Text style={[
                        styles.arSummaryValue,
                        { color: overdue.length > 0 ? themeColors.danger : themeColors.textSecondary },
                      ]}>
                        {overdue.length > 0 ? formatMoney(overdueTotal, 2) : '—'}
                      </Text>
                      {worst > 0 && (
                        <Text style={styles.arSummaryMeta}>
                          {overdue.length} invoice{overdue.length === 1 ? '' : 's'} · up to {worst}d late
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })()}
              {projectInvoices.some(i => i.status !== 'draft') && (
                <TouchableOpacity
                  style={styles.photoShareBtn}
                  onPress={() => { void handleExportAccounting(); }}
                  activeOpacity={0.8}
                  testID="invoices-accounting-export"
                >
                  <Share2 size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.photoShareBtnText}>Export to accounting (CSV)</Text>
                  <Text style={styles.photoShareBtnHint}>QuickBooks · Xero</Text>
                </TouchableOpacity>
              )}
              {projectInvoices.length > 0 && (() => {
                // MONEY-F5: settled = retention-net balance covered; held
                // retention does not keep an invoice in the Unpaid chip.
                const counts = {
                  unpaid: projectInvoices.filter(i => !invoiceIsSettled(i)).length,
                  paid: projectInvoices.filter(i => invoiceIsSettled(i)).length,
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
                if (invoiceFilter === 'unpaid') return !invoiceIsSettled(i); // MONEY-F5
                if (invoiceFilter === 'paid') return invoiceIsSettled(i);    // MONEY-F5
                return true;
              })).map(inv => {
                const _balance = invoiceOutstanding(inv); // MONEY-F5: net of held retention
                const displayStatus = getEffectiveInvoiceStatus(inv);
                // "Overdue" alone doesn't tell a GC whether to call today. Days
                // do. Same helper the invoice screen's header pill uses.
                const invDaysPastDue = getDaysPastDue(inv);
                return (
                  <TouchableOpacity
                    key={inv.id}
                    style={styles.coRow}
                    onPress={() => navigateFromTile({ pathname: '/invoice' as any, params: { projectId: id, invoiceId: inv.id } })}
                    onLongPress={() => {
                      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      if (!isDesktop) setActiveTile(null);
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
                          {invDaysPastDue > 0 ? ` · ${invDaysPastDue}d` : ''}
                        </Text>
                      </View>
                      {_balance > 0.5 && inv.amountPaid > 0 && (
                        <Text style={styles.invBalanceMeta}>{formatMoney(_balance, 2)} due</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
              {/* #38: billing is the owner's. Anyone else sees why, in place of
                  the buttons (Bill by voice included — it opens the same
                  invoice flow). */}
              {billBlockedReason ? (
                <Text style={styles.coEmptyText} testID="invoice-bill-blocked">{billBlockedReason}</Text>
              ) : (<>
              {/* Bill by voice — MAGE Copilot: say the draw, it opens billing
                  pre-set to progress or full. */}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/copilot', params: { capabilityId: 'invoice', projectId: id ?? '' } })}
                activeOpacity={0.7}
                testID="add-invoice-voice-btn"
              >
                <Mic size={16} color={themeColors.accent} strokeWidth={2} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Bill by voice</Text>
              </TouchableOpacity>
              <View style={styles.invBtnRow}>
                {/* Quick Invoice — skips bill-from-estimate entirely.
                    Goes straight to /invoice with no prefill so the GC
                    can type an amount + description and send. Fastest
                    path for one-off bills (final cleanup, allowance
                    overage, deposit on a sub) that don't need to draw
                    against estimate line items. */}
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/invoice' as any, params: { projectId: id, type: 'quick', new: '1' } })}
                  activeOpacity={0.7}
                  testID="add-quick-invoice-btn"
                >
                  <MageAIMark size={16} color={themeColors.accent} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Quick</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/bill-from-estimate' as any, params: { projectId: id, type: 'progress' } })}
                  activeOpacity={0.7}
                  testID="add-progress-bill-btn"
                >
                  <ClipboardList size={16} color={themeColors.info} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.info }]}>Progress</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/bill-from-estimate' as any, params: { projectId: id, type: 'full' } })}
                  activeOpacity={0.7}
                  testID="add-full-invoice-btn"
                >
                  <Receipt size={16} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.success }]}>Full</Text>
                </TouchableOpacity>
              </View>
              </>)}
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
            <ClipboardList size={20} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>
              Daily Reports ({dailyReports.length})
            </Text>
            {expanded.dailyReports ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>

          {expanded.dailyReports && (
            <View style={styles.coCard}>
              {/* The record's completeness, stated plainly. This is the
                  standing number; the home card only appears when there is
                  something to do about it. Gaps are reported as facts about
                  the record — there is deliberately no "fill in that day"
                  action, because a report written later carries the date it
                  was written, not the day it describes. */}
              {dfrRecord.hasRecord && dailyLogHeadline(dfrRecord) && (
                <View style={styles.dfrRecordBlock} testID="dfr-record-block">
                  <Text style={styles.dfrRecordHeadline}>{dailyLogHeadline(dfrRecord)}</Text>
                  {dailyLogEmptyDayLine(dfrRecord) && (
                    <Text style={styles.dfrRecordNote}>{dailyLogEmptyDayLine(dfrRecord)}</Text>
                  )}
                  {dailyLogGapLine(dfrRecord) && (
                    <Text style={styles.dfrRecordNote}>{dailyLogGapLine(dfrRecord)}</Text>
                  )}
                  {dailyLogTodayLine(dfrRecord) && (
                    <Text style={styles.dfrRecordDue}>{dailyLogTodayLine(dfrRecord)}</Text>
                  )}
                </View>
              )}
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
                  const d = dayOrInstantDate(dr.date);
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
                      .sort((a, b) => dayOrInstantDate(b.date).getTime() - dayOrInstantDate(a.date).getTime())
                      .map(dr => (
                      <TouchableOpacity
                        key={dr.id}
                        style={styles.coRow}
                        onPress={() => navigateFromTile({ pathname: '/daily-report' as any, params: { projectId: id, reportId: dr.id } })}
                        activeOpacity={0.7}
                      >
                        <View style={styles.coInfo}>
                          <Text style={styles.coNumber}>{dayOrInstantDate(dr.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                          <Text style={styles.coDesc} numberOfLines={1}>
                            {dr.weather.conditions || 'No weather'} · {dr.manpower.reduce((s, m) => s + m.headcount, 0)} workers · {dr.photos.length} photos
                          </Text>
                          {/* #63: who filed it, when it isn't the viewer — two
                              foremen on one job and day were indistinguishable. */}
                          {(() => {
                            const filed = filedByLine({
                              filedByUserId: dr.filedByUserId,
                              viewerId: authUser?.id,
                              ownerUserId: project.ownerUserId,
                              collaborators: teamRoster.collaborators,
                            });
                            return filed ? <Text style={styles.coDesc} numberOfLines={1} testID={`dfr-filed-by-${dr.id}`}>{filed}</Text> : null;
                          })()}
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
              {/* Log by voice — MAGE Copilot: dictate the day, it confirms
                  today's critical-path progress + writes the full report. */}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/copilot', params: { capabilityId: 'daily_report', projectId: id ?? '' } })}
                activeOpacity={0.7}
                testID="add-daily-report-voice-btn"
              >
                <Mic size={16} color={themeColors.accent} strokeWidth={2} />
                <Text style={styles.coAddBtnText}>Log by voice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/daily-report' as any, params: { projectId: id, new: '1' } })}
                activeOpacity={0.7}
                testID="add-daily-report-btn"
              >
                <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
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
            <CheckSquare size={20} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>
              Punch List ({punchItems.length})
            </Text>
            {expanded.punchList ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
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
                    <AnimatedFill value={punchItems.length > 0 ? (punchItems.filter(pi => pi.status === 'closed').length / punchItems.length) * 100 : 0} style={[styles.punchProgressFill, { width: `${punchItems.length > 0 ? (punchItems.filter(pi => pi.status === 'closed').length / punchItems.length) * 100 : 0}%` }]} />
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
              {/* Add by voice — MAGE Copilot: speak the defect, confirm the trade. */}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/copilot', params: { capabilityId: 'punch', projectId: id ?? '' } })}
                activeOpacity={0.7}
                testID="add-punch-voice-btn"
              >
                <Mic size={16} color={themeColors.accent} strokeWidth={2} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Add by voice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/punch-list' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="open-punch-list-btn"
              >
                <CheckSquare size={16} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Manage Punch List</Text>
              </TouchableOpacity>
              {/* #53 (productDecision, owner-only interim): warranties live on
                  the project owner's account, so only the owner is offered the
                  log / list buttons. An invitee who reaches /warranties anyway
                  reads why (app/warranties.tsx). */}
              {hubRole === 'owner' && (
                <>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/copilot', params: { capabilityId: 'warranty', projectId: id ?? '' } })}
                  activeOpacity={0.7}
                  testID="add-warranty-voice-btn"
                >
                  <Mic size={16} color={themeColors.accent} strokeWidth={2} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Log a warranty by voice</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.coAddBtn}
                  onPress={() => navigateFromTile({ pathname: '/warranties' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-warranties-btn"
                >
                  <CheckSquare size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Warranties</Text>
                </TouchableOpacity>
                </>
              )}
              <TouchableOpacity
                style={[styles.coAddBtn, { marginTop: 8 }]}
                onPress={() => navigateFromTile({ pathname: '/retention' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="open-retention-btn"
              >
                <CheckSquare size={16} color={themeColors.accent} strokeWidth={1.75} />
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
            {/* MageRFI, not FileText. The tile that opens this section already
                uses the bespoke mark and both are imported in this file — the
                generic document threw it away one tap later. */}
            <MageRFI size={20} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>
              RFIs ({projectRFIs.length})
            </Text>
            {expanded.rfis ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
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
              {/* #143: every RFI in the chip, not the newest 5 — the sheet
                  scrolls — and under "Open" the earliest due day first, so the
                  overdue ones are the ones he sees. */}
              {sortRFIsForHub(rfiFilter === 'all' ? projectRFIs : projectRFIs.filter(r => {
                if (rfiFilter === 'open') return r.status === 'open';
                if (rfiFilter === 'answered') return r.status === 'answered';
                if (rfiFilter === 'closed') return r.status === 'closed' || r.status === 'void';
                return true;
              }), rfiFilter, calendarDayOf).map(rfi => {
                // B4 review A2: dateRequired is a calendar day — overdue once the
                // due DAY is past (see app/report-inbox.tsx).
                // calendarDayOf first: dateRequired is a bare day from some
                // writers and a noon-UTC instant from DatePickerModal (#164).
                const isOverdue = rfi.status === 'open' && (daysUntilCalendarDay(calendarDayOf(rfi.dateRequired)) ?? 0) < 0;
                return (
                  <TouchableOpacity
                    key={rfi.id}
                    style={styles.coRow}
                    onPress={() =>
                      navigateTo(
                        { kind: 'rfi', id: rfi.id, projectId: id },
                        { fromSheet: true, onBeforeNavigate: () => { if (!isDesktop) setActiveTile(null); } },
                      )
                    }
                    onLongPress={() => {
                      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      if (!isDesktop) setActiveTile(null);
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
              {/* Raise by voice — MAGE Copilot: speak the question, confirm recipient. */}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/copilot', params: { capabilityId: 'rfi', projectId: id ?? '' } })}
                activeOpacity={0.7}
                testID="add-rfi-voice-btn"
              >
                <Mic size={16} color={themeColors.accent} strokeWidth={2} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Raise by voice</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={[styles.coAddBtn, { flex: 1 }]}
                  onPress={() => navigateFromTile({ pathname: '/rfi' as any, params: { projectId: id, new: '1' } })}
                  activeOpacity={0.7}
                  testID="add-rfi-btn"
                >
                  <Plus size={16} color={themeColors.info} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.info }]}>New RFI</Text>
                </TouchableOpacity>
                {projectRFIs.length > 0 && (
                  <TouchableOpacity
                    style={[styles.coAddBtn, { flex: 1, backgroundColor: themeColors.surfaceAlt ?? themeColors.line }]}
                    onPress={handleExportRFILog}
                    activeOpacity={0.7}
                    testID="export-rfi-log-btn"
                  >
                    <Share2 size={15} color={themeColors.text} strokeWidth={1.75} />
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
            <MageSubmittal size={20} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>
              Submittals ({projectSubmittals.length})
            </Text>
            {expanded.submittals ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>

          {expanded.submittals && (
            <View style={styles.coCard}>
              {projectSubmittals.length === 0 && (
                <Text style={styles.coEmptyText}>No submittals yet.</Text>
              )}
              {/* #143: all of them (a spec-book log is 30+), the ones that
                  need his action first. */}
              {sortSubmittalsForHub(projectSubmittals).map(sub => (
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
              {/* Log by voice — MAGE Copilot: speak the item, confirm spec + timing. */}
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/copilot', params: { capabilityId: 'submittal', projectId: id ?? '' } })}
                activeOpacity={0.7}
                testID="add-submittal-voice-btn"
              >
                <Mic size={16} color={themeColors.accent} strokeWidth={2} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Log by voice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/submittal' as any, params: { projectId: id, new: '1' } })}
                activeOpacity={0.7}
                testID="add-submittal-btn"
              >
                <Plus size={16} color={themeColors.info} strokeWidth={1.75} />
                <Text style={[styles.coAddBtnText, { color: themeColors.info }]}>New Submittal</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.coAddBtn}
                onPress={() => navigateFromTile({ pathname: '/extract-submittals' as any, params: { projectId: id } })}
                activeOpacity={0.7}
                testID="extract-submittals-btn"
                accessibilityRole="button"
                accessibilityLabel={`Extract from spec book with AI${lockSpecExtract ? ', locked, upgrade required' : ''}`}
              >
                <MageAIMark size={16} color={themeColors.accent} />
                <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Extract from spec book (AI)</Text>
                {lockSpecExtract && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
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
              <DollarSign size={20} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Financial Health</Text>
              {expanded.budget ? (
                <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
              ) : (
                <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
              )}
            </TouchableOpacity>

            {expanded.budget && (
              <View style={styles.coCard}>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                  <View style={{ flex: 1, backgroundColor: themeColors.successSoft, borderRadius: Tokens.radius.md, padding: 12, alignItems: 'center' as const }}>
                    <Text style={{ fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.success }}>Budget</Text>
                    <Text style={{ fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: themeColors.success }}>
                      {formatMoney(effectiveEstimateTotal(project))}
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
                  style={[styles.coAddBtn, { marginBottom: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/generative-setup' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-generative-setup"
                  accessibilityRole="button"
                  accessibilityLabel={`Set up project from estimate${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <MageAIMark size={16} color={themeColors.accent} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Set up project from estimate</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.coAddBtn}
                  onPress={() => navigateFromTile({ pathname: '/budget-dashboard' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-budget-dashboard"
                  accessibilityRole="button"
                  accessibilityLabel={`Full Budget Dashboard${lockBudgetDashboard ? ', locked, upgrade required' : ''}`}
                >
                  <DollarSign size={16} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.success }]}>Full Budget Dashboard</Text>
                  {lockBudgetDashboard && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/job-costing' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-job-costing"
                  accessibilityRole="button"
                  accessibilityLabel={`Job Cost-to-Complete${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <BarChart3 size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Job Cost-to-Complete</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/living-estimate' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-living-estimate"
                  accessibilityRole="button"
                  accessibilityLabel={`Living Estimate, margin at completion${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <Activity size={16} color={themeColors.info} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.info }]}>Living Estimate · margin at completion</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/margin-risk' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-margin-risk"
                  accessibilityRole="button"
                  accessibilityLabel={`Margin Risk Score${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <ShieldAlert size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Margin Risk Score</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/buyout-scope-gap' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-buyout-scope-gap"
                  accessibilityRole="button"
                  accessibilityLabel={`Buyout Scope-Gap Audit${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <ScanSearch size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Buyout Scope-Gap Audit</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/estimate-accuracy' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-estimate-accuracy"
                  accessibilityRole="button"
                  accessibilityLabel={`Estimate Accuracy, bid vs actual${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <Scale size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Estimate Accuracy · bid vs actual</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/estimate-confidence' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-estimate-confidence"
                  accessibilityRole="button"
                  accessibilityLabel={`Estimate Confidence, price check${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <ShieldCheck size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Estimate Confidence · price check</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/area-takeoff' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-area-takeoff"
                  accessibilityRole="button"
                  accessibilityLabel={`Visual Takeoff, trace to priced line${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <PenTool size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Visual Takeoff · trace → priced line</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coAddBtn, { marginTop: 8 }]}
                  onPress={() => navigateFromTile({ pathname: '/project-memory' as any, params: { projectId: id } })}
                  activeOpacity={0.7}
                  testID="open-project-memory"
                  accessibilityRole="button"
                  accessibilityLabel={`Project Memory, ask this job's history${lockJobCosting ? ', locked, upgrade required' : ''}`}
                >
                  <MageAIMark size={16} color={themeColors.accent} />
                  <Text style={[styles.coAddBtnText, { color: themeColors.accent }]}>Project Memory · ask this job&apos;s history</Text>
                  {lockJobCosting && <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 'auto' }} />}
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
            <Camera size={20} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>
              Photos ({projectPhotos.length})
            </Text>
            {expanded.photos ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>

          {expanded.photos && (
            <View style={styles.coCard}>
              <View style={styles.photoCaptureRow}>
                <TouchableOpacity
                  style={[styles.photoCaptureBtn, styles.photoCaptureBtnPrimary]}
                  onPress={() => { void handleCapturePhoto('camera'); }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Take a photo"
                  testID="photos-take-photo"
                >
                  <Camera size={16} color={themeColors.surface} strokeWidth={2} />
                  <Text style={styles.photoCaptureBtnPrimaryText}>Take Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.photoCaptureBtn}
                  onPress={() => { void handleCapturePhoto('library'); }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Add photos from library"
                  testID="photos-add-library"
                >
                  <ImagePlus size={16} color={themeColors.accent} strokeWidth={2} />
                  <Text style={styles.photoCaptureBtnText}>Library</Text>
                </TouchableOpacity>
              </View>
              {projectPhotos.length === 0 && (
                <Text style={styles.coEmptyText}>No photos yet. Tap Take Photo to capture the jobsite — photos from daily reports show up here too.</Text>
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
                  <Share2 size={14} color={themeColors.accent} strokeWidth={1.75} />
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
                // D3-2 search: applied AFTER the chip filter. Case-insensitive
                // substring over the fields ProjectPhoto already persists, so
                // "electrical rough" matches whichever field carries it. Empty
                // query is identity → byte-equivalent to the pre-D3-2 result.
                const q = photoSearch.trim().toLowerCase();
                const searched = q === ''
                  ? filtered
                  : filtered.filter(p =>
                      [p.tag, p.location, p.linkedTaskName, p.locationLabel]
                        .map(x => x ?? '')
                        .join(' ')
                        .toLowerCase()
                        .includes(q),
                    );
                const dayLabel = (dayISO: string) =>
                  dayISO === 'unknown'
                    ? 'Undated'
                    : new Date(dayISO + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                const renderThumb = (photo: ProjectPhoto) => (
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
                      <Camera size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                    )}
                    {(photo.markup?.length ?? 0) > 0 && (
                      <View style={styles.photoThumbMarkupBadge}>
                        <Pencil size={10} color={themeColors.surface} strokeWidth={1.75} />
                      </View>
                    )}
                    <View style={styles.photoThumbDateOverlay}>
                      <Text style={styles.photoThumbDate}>{new Date(photo.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                    </View>
                  </TouchableOpacity>
                );
                return (
                  <>
                    <FilterChipRow
                      chips={chips}
                      value={photoFilter}
                      onChange={setPhotoFilter}
                      noPadding
                      testID="photos-tag-filter"
                    />
                    <View style={styles.photoSearchRow}>
                      <TextInput
                        style={styles.photoSearchInput}
                        value={photoSearch}
                        onChangeText={setPhotoSearch}
                        placeholder="Search photos (tag, location, task)"
                        placeholderTextColor={themeColors.textMuted}
                        testID="photos-search-input"
                      />
                      <TouchableOpacity
                        style={styles.photoGroupToggle}
                        onPress={() => setPhotoGroupByDate(v => !v)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={photoGroupByDate ? 'Switch to grid view' : 'Group photos by date'}
                        testID="photos-group-toggle"
                      >
                        {photoGroupByDate ? (
                          <CalendarDays size={14} color={themeColors.accent} strokeWidth={1.75} />
                        ) : (
                          <Layers size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                        )}
                        <Text style={styles.photoGroupToggleText}>{photoGroupByDate ? 'By date' : 'Grid'}</Text>
                      </TouchableOpacity>
                    </View>
                    {searched.length === 0 ? (
                      <Text style={styles.punchMoreText}>{q !== '' ? 'No photos match your search.' : 'No photos in this tag.'}</Text>
                    ) : photoGroupByDate ? (
                      groupPhotosByDay(searched.map(p => ({ ts: p.timestamp, photo: p })))
                        .sort((a, b) => (a.dayISO === 'unknown' ? 1 : b.dayISO === 'unknown' ? -1 : 0))
                        .map(group => (
                        <View key={group.dayISO} testID={`photo-day-${group.dayISO}`}>
                          <Text style={styles.photoDayHeader}>{dayLabel(group.dayISO)}</Text>
                          <View style={styles.photoGrid}>
                            {group.items.map(({ photo }) => renderThumb(photo))}
                          </View>
                        </View>
                      ))
                    ) : (
                      <View style={styles.photoGrid}>
                        {searched.map(photo => renderThumb(photo))}
                      </View>
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
            <Globe size={20} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Client Portal</Text>
            {expanded.clientPortal ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>

          {expanded.clientPortal && (
            <View style={styles.coCard}>
              <View style={styles.portalInfo}>
                <Globe size={24} color={themeColors.info} strokeWidth={1.75} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.portalTitle}>Share Project with Client</Text>
                  <Text style={styles.portalDesc}>Read-only link with progress, invoices, photos and more. Toggle exactly what your client sees.</Text>
                </View>
              </View>
              {project.clientPortal?.enabled ? (
                <>
                  <View style={styles.portalLinkRow}>
                    {/* Whole pill is tappable now — long-standing user
                        feedback that tapping the link itself ought to
                        copy, in addition to the explicit Copy button. */}
                    <TouchableOpacity
                      style={styles.portalLinkBox}
                      onPress={handleCopyPortalLink}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Copy portal link"
                    >
                      <Link size={12} color={themeColors.info} strokeWidth={1.75} />
                      {/* PORTAL-07: print the link Copy hands out — token
                          included so the bare URL is never mistaken for it,
                          middle elided so a screenshot does not leak the key. */}
                      <Text style={styles.portalLinkText} numberOfLines={1}>
                        {!portalEntitled
                          ? 'Client portal is a Pro feature — upgrade to share the link'
                          : portalLink
                            ? maskPortalLinkToken(portalLink.replace(/^https:\/\//, ''))
                            : 'Secure link on its way — syncing'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.portalCopyBtn} onPress={handleCopyPortalLink} accessibilityRole="button" accessibilityLabel={portalEntitled ? 'Copy' : 'Copy, locked, Client portal is a Pro feature'}>
                      {portalEntitled
                        ? <Copy size={14} color={themeColors.accent} strokeWidth={1.75} />
                        : <Lock size={14} color={themeColors.textMuted} strokeWidth={2} />}
                    </TouchableOpacity>
                  </View>
                  {!portalEntitled && (
                    // Enabled on a plan without the portal (switched on before
                    // this gate, or since downgraded). Honest about both sides:
                    // the link already handed out still opens for the client —
                    // nothing on the server withdraws it — but sharing, messages
                    // and settings are Pro.
                    <View style={styles.portalTermsRow} testID="portal-locked-note">
                      <Text style={styles.portalDesc}>
                        Client portal is a Pro feature. A link you already sent still opens for your client, but sharing it, messages and portal settings need Pro.
                      </Text>
                      <Button label="See Pro" variant="secondary" size="sm" onPress={openPortalPaywall} testID="portal-locked-upgrade" />
                    </View>
                  )}
                  <View style={styles.portalInviteCount}>
                    <Users size={13} color={themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.portalInviteCountText}>
                      {project.clientPortal.invites?.length ?? 0} client{(project.clientPortal.invites?.length ?? 0) !== 1 ? 's' : ''} invited
                    </Text>
                  </View>

                  {portalTermsNeeded && (
                    <View style={styles.portalTermsRow} testID="portal-terms-needed">
                      <Text style={styles.portalDesc}>
                        Your client sees this proposal without payment terms and can&apos;t accept it yet.
                      </Text>
                      <Button
                        label={portalTerms.state === 'unconfirmed' && portalTerms.action === 'use-profile'
                          ? `Use ${splitLabel(portalTerms.profileSplit)}`
                          : 'Set your payment terms'}
                        variant="secondary" size="sm"
                        onPress={confirmPortalProposalTerms}
                        testID="portal-terms-confirm"
                      />
                    </View>
                  )}

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
                            disabled={!portalEntitled}
                            onValueChange={val => {
                              if (!id || !portalEntitled) return;
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

                  {/* Client Outbox: batch-send drafts/unsent edits. Hidden when
                      nothing is pending so the portal section stays clean. */}
                  {outboxCount > 0 ? (
                    <TouchableOpacity
                      style={styles.portalMessagesRow}
                      onPress={() => navigateFromTile({ pathname: '/client-outbox', params: { projectId: id ?? '' } })}
                      activeOpacity={0.7}
                      testID="client-outbox-entry"
                    >
                      <Send size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.portalMessagesText}>{`Client Outbox · ${outboxCount} item${outboxCount === 1 ? '' : 's'} to review`}</Text>
                      <Text style={styles.portalMessagesOpen}>Open ›</Text>
                    </TouchableOpacity>
                  ) : null}

                  {/* Quick entry into the messaging thread. MUST go through
                      navigateFromTile, not router.push — this section
                      renders inside the iOS pageSheet tile-modal, and a
                      naked push would mount the messages screen BEHIND
                      the sheet (only visible after Back). */}
                  <TouchableOpacity
                    style={styles.portalMessagesRow}
                    onPress={() => (portalEntitled ? navigateFromTile({ pathname: '/client-messages', params: { id } }) : openPortalPaywall())}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={portalEntitled ? 'Open messages' : 'Messages, locked, Client portal is a Pro feature'}
                  >
                    <MessageSquare size={14} color={portalEntitled ? themeColors.accent : themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.portalMessagesText}>Messages</Text>
                    {portalEntitled
                      ? <Text style={styles.portalMessagesOpen}>Open ›</Text>
                      : <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} />}
                  </TouchableOpacity>

                  {/* Less-common options (passcode, welcome msg, homeowner
                      language, weekly update) still live on the dedicated
                      screen. Renamed from "Manage Portal Settings" to a
                      lighter "Advanced settings" link. */}
                  <TouchableOpacity
                    style={styles.portalAdvancedLink}
                    onPress={() => (portalEntitled ? navigateFromTile({ pathname: '/client-portal-setup', params: { id } }) : openPortalPaywall())}
                    activeOpacity={0.7}
                    testID="portal-advanced-link"
                  >
                    <Text style={styles.portalAdvancedLinkText}>
                      {portalEntitled ? 'Advanced settings (passcode, language, welcome) ›' : 'Advanced settings — Pro'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                !portalEntitled ? (
                  // #71: locked BEFORE any write — no half-enabled portal.
                  <TouchableOpacity
                    style={styles.portalEnableBtn}
                    onPress={openPortalPaywall}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Enable Client Portal, locked, Client portal is a Pro feature"
                    testID="portal-enable-locked"
                  >
                    <Lock size={16} color={themeColors.textMuted} strokeWidth={2} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.portalEnableBtnText}>Enable Client Portal</Text>
                      <Text style={styles.portalDesc}>Client portal is a Pro feature</Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                <TouchableOpacity
                  style={styles.portalEnableBtn}
                  testID="portal-enable-btn"
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
                  <Globe size={16} color={themeColors.info} strokeWidth={1.75} />
                  <Text style={styles.portalEnableBtnText}>Enable Client Portal</Text>
                </TouchableOpacity>
                )
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
            <Mail size={20} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Communications</Text>
            <View style={styles.coBadge}>
              <Text style={styles.coBadgeText}>{commEvents.length}</Text>
            </View>
            {expanded.communications ? (
              <ChevronUp size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            )}
          </TouchableOpacity>

          {expanded.communications && (
            <View style={styles.coCard}>
              {commEvents.length === 0 ? (
                <View style={styles.commEmpty}>
                  <Mail size={24} color={themeColors.textMuted} strokeWidth={1.75} />
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
                    (Alert as any).prompt('Internal Note', 'Add a private note to this project', (text: string) => submitNote(text));
                  } else if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
                    // Web: native browser prompt.
                    submitNote(window.prompt('Add a private note to this project', ''));
                  } else {
                    // Android / anything without a system prompt: inline composer.
                    setNoteDraft('');
                    setShowNoteModal(true);
                  }
                }}
                activeOpacity={0.7}
              >
                <Plus size={14} color={themeColors.info} strokeWidth={1.75} />
                <Text style={styles.commAddNoteBtnText}>Add Internal Note</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        )}
        {activeTile === 'aiReport' && (
          <View style={{ paddingHorizontal: 20 }}>
            <AIProjectReport
              project={project}
              invoices={allInvoices}
              changeOrders={allChangeOrders}
              subscriptionTier={tier as any}
            />
          </View>
        )}
    </>
  );

  // The desktop section index: each column's row width (rows fill their
  // column; see indexRowsDesktop), and a row's words for a screen reader —
  // the phone tile's label, word for word.
  const indexRowWidth = indexBox.measured ? tileGridColumns(indexBox.width, Layout.tile.kpi).width : Layout.tile.kpi.min;
  const tileLockText = (tile: Tile): string | null => {
    if (!lockedTileKeys.has(tile.key)) return null;
    const lockFeature = TILE_LOCK_FEATURE[tile.key];
    return tileLockReason(tile.key, hubRole, lockFeature ? requiredTierFor(lockFeature as Parameters<typeof requiredTierFor>[0]) : null);
  };
  const tileA11yLabel = (tile: Tile, lockReason: string | null): string => `${tile.label}`
    + (tile.count != null ? `, ${tile.count} ${tile.count === 1 ? 'item' : 'items'}` : '')
    + (lockReason ? `, locked, ${lockReason}` : '');

  return (
    // Desktop: a ROW — the page, and the section side panel docked beside it.
    // (A ternary, not `isDesktop && …`, so a phone's style array is exactly
    // the two entries it always had.)
    <View
      style={isDesktop ? [styles.container, { backgroundColor: themeColors.bg }, styles.containerDesktop] : [styles.container, { backgroundColor: themeColors.bg }]}
      onLayout={isDesktop ? panelRow.onLayout : undefined}
    >
      <Stack.Screen options={stackScreenOptions} />
      <ScrollView
        ref={hubScrollRef}
        {...fabScroll}
        contentContainerStyle={[{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.pageDesktop]}
        showsVerticalScrollIndicator={false}
      >
        <TutorialScrollAnchor scrollRef={hubScrollRef}>
        {isDesktop ? (
          // ── The desktop workspace (wave 6c): one screen at 1512 x 945 ──
          <View style={isDesktop && styles.workspaceDesktop} testID="project-workspace">
            <ProjectWorkspaceHeader
              project={project}
              currentStage={currentStage}
              onStageChange={handleStageTap}
              invoices={projectInvoices}
              rfis={projectRFIs}
              punchItems={punchItems}
              roleError={pulse.roleError}
              onOpenTile={(key) => pressTile({ key: key as SectionKey })}
              hasAnyEstimate={hasAnyEstimate}
              onShare={() => setShowShareModal(true)}
              onEdit={requestEdit}
              editBlockedReason={hubPerms.editBlockedReason}
              generatingCloseout={generatingCloseout}
              onCloseoutPacket={handleGenerateCloseoutPacket}
              onAIReport={() => openSection('aiReport')}
              onExportCalendar={handleExportCalendar}
              canDelete={hubPerms.canDelete}
              canLeave={hubPerms.canLeave}
              onDelete={handleDelete}
              onLeave={handleLeave}
              leaveBusyReason={leaving ? 'Leaving…' : checkingLeave ? 'Sending unsynced changes…' : null}
            />
            <ProjectKpiStrip
              projectId={project.id}
              pulse={pulse}
              onOpenSchedule={openSchedule}
              listLinks={deskWeb}
              onOpenSection={openSection}
            />
            <InspectionReadyCard project={project} openKey={prepParam ?? null} />
            <BuildingRecordCard project={project} testID="project-building-record" />
            <ProjectCodeChecksCard project={project} />
            {/* One row of quick actions. Closeout lives in the header's ⋯. */}
            <TileGrid preset="action" phoneStyle={styles.quickActions} desktopStyle={isDesktop && styles.quickActionsDesktop}>
              <TouchableOpacity
                style={[styles.quickActionBtn, isDesktop && styles.quickActionBtnDesktop]}
                onPress={() => router.push(routeHref('/weekly-snapshot', { projectId: project.id }))}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID="project-weekly-snapshot-btn"
              >
                <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
                  <CalendarDays size={18} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <Text style={styles.quickActionLabel}>This Week</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickActionBtn, isDesktop && styles.quickActionBtnDesktop]}
                onPress={() => router.push(routeHref('/cash-flow', { projectId: project.id }))}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID="project-cash-flow-btn"
              >
                <View style={[styles.quickActionIcon, { backgroundColor: themeColors.success + '15' }]}>
                  <Wallet size={18} color={themeColors.success} strokeWidth={1.75} />
                </View>
                <Text style={styles.quickActionLabel}>Cash Flow</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickActionBtn, isDesktop && styles.quickActionBtnDesktop]}
                onPress={() => (hasAnyEstimate
                  ? router.replace(routeHref('/(tabs)/estimate/full', { projectId: project.id }))
                  : router.push(routeHref('/estimate-wizard', { projectId: project.id })))}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={hasAnyEstimate ? 'project-view-estimate-btn' : 'project-create-estimate-btn'}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
                  <Receipt size={18} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <Text style={styles.quickActionLabel}>Estimate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickActionBtn, isDesktop && styles.quickActionBtnDesktop]}
                onPress={project.schedule ? openSchedule : buildSchedule}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={project.schedule ? 'project-view-schedule-btn' : 'project-create-schedule-btn'}
              >
                <View style={[styles.quickActionIcon, { backgroundColor: themeColors.info + '15' }]}>
                  <CalendarDays size={18} color={themeColors.info} strokeWidth={1.75} />
                </View>
                <Text style={styles.quickActionLabel}>Schedule</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickActionBtn, isDesktop && styles.quickActionBtnDesktop]}
                onPress={() => router.push(routeHref('/payment-predictions', { projectId: project.id }))}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID="project-payment-forecast-btn"
              >
                <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
                  <TrendingDown size={18} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <Text style={styles.quickActionLabel}>Forecast</Text>
              </TouchableOpacity>
            </TileGrid>
            <ProjectOverviewColumns
              projectId={project.id}
              pulse={pulse}
              listLinks={deskWeb}
              onOpenSection={openSection}
              onOpenSchedule={openSchedule}
              onBuildSchedule={buildSchedule}
            />
            {/* The index of every section: four columns (Field, Money,
                Documentation, People), every group open — collapsing is a
                phone idea. Rendered HERE, not in a components/project file:
                the tutorial registry names this file for the hub.tile.* /
                hub.group.* targets, and the tutorial finales light
                hub.tile.dailyReports / invoices / punchList. A row is a real
                link where it leaves the page (a log on desktop web, or a
                screen of its own), a button where it opens the side panel. */}
            <View onLayout={indexBox.onLayout} testID="project-section-index">
              <TileGrid preset="kpi">
                {groups.map(group => {
                  const groupTiles = group.tileKeys.map(k => tileByKey.get(k)).filter((t): t is Tile => t !== undefined);
                  if (groupTiles.length === 0) return null;
                  const groupCountSum = groupTiles.reduce((acc, t) => acc + (t.count ?? 0), 0);
                  const GroupIcon = group.icon;
                  return (
                    <View key={group.key} style={isDesktop && styles.indexColDesktop}>
                      <TutorialTarget id={`hub.group.${group.key}`}>
                        <View style={isDesktop && styles.indexHeadDesktop} testID={`tile-group-${group.key}`} accessibilityRole="header">
                          <GroupIcon size={16} color={group.color} />
                          <Text style={styles.indexHeadLabel} numberOfLines={1}>{group.label}</Text>
                          {groupCountSum > 0 ? <Text style={styles.indexCount}>{groupCountSum}</Text> : null}
                        </View>
                      </TutorialTarget>
                      {/* Row-wrap, so each row's tutorial wrapper stretches it
                          exactly as the grid would (tutorial-target-layout's
                          desktop rule); the rows are sized to the column. */}
                      <View style={isDesktop && styles.indexRowsDesktop}>
                        {groupTiles.map(tile => {
                          const TileIcon = tile.icon;
                          const lockReason = tileLockText(tile);
                          const a11yLabel = tileA11yLabel(tile, lockReason);
                          const href = sectionIndexHref(tile.key, project.id, deskWeb);
                          const badge = tileBadges[tile.key];
                          const rowStyle = [isDesktop && styles.indexRowDesktop, { width: indexRowWidth }];
                          const body = (
                            <>
                              <TileIcon size={16} color={tile.color} />
                              <Text style={styles.indexRowLabel} numberOfLines={1}>{tile.label}</Text>
                              <View style={styles.indexRowTrail}>
                                {lockReason ? (
                                  <>
                                    <Lock size={12} color={themeColors.textMuted} strokeWidth={2.5} />
                                    <Text style={styles.indexRowNote} numberOfLines={1} testID={`section-tile-lock-reason-${tile.key}`}>{lockReason}</Text>
                                  </>
                                ) : tile.count != null ? (
                                  <Text style={styles.indexCount}>{tile.count}</Text>
                                ) : badge ? (
                                  <Text style={[styles.indexRowNote, { color: STATUS_TONES[badge.tone].color }]} numberOfLines={1}>{badge.label}</Text>
                                ) : null}
                              </View>
                            </>
                          );
                          return (
                            <TutorialTarget key={tile.key} id={`hub.tile.${tile.key}`} style={isDesktop ? styles.tileTargetDesktop : undefined}>
                              {href ? (
                                <RowLink href={href} style={rowStyle} accessibilityLabel={a11yLabel} testID={`section-tile-${tile.key}`}>
                                  {body}
                                </RowLink>
                              ) : (
                                <Pressable
                                  onPress={() => pressTile(tile)}
                                  style={rowStyle}
                                  accessibilityRole="button"
                                  accessibilityLabel={a11yLabel}
                                  testID={`section-tile-${tile.key}`}
                                >
                                  {body}
                                </Pressable>
                              )}
                            </TutorialTarget>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </TileGrid>
            </View>
          </View>
        ) : (
        <>
        {/* The hero card unrolls like a blueprint when the project opens. */}
        <BlueprintReveal>
        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroName}>{project.name}</Text>
              <View style={styles.heroMeta}>
                <MapPin size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.heroMetaText}>{displayText(project.location, 'No location set')}</Text>
              </View>
              {displayText(project.description) ? (
                <Text style={styles.heroDesc}>{displayText(project.description)}</Text>
              ) : null}
            </View>
          </View>

          {hasAnyEstimate && (
            <View style={styles.heroStats}>
              {/* The breakdown modal is computed ENTIRELY from the legacy
                  project.estimate (materialTotal / laborTotal / permits /
                  overhead), while heroTotal comes from effectiveEstimateTotal,
                  which prefers linkedEstimate. When a project carries both,
                  opening it puts stale legacy figures under a headline derived
                  from the linked grandTotal — two numbers on one card that
                  disagree. So the tap is only offered when the legacy estimate
                  IS the headline. Residual of PR #81; PR #116 restored the
                  sibling gate below but not this one. */}
              <TouchableOpacity
                style={styles.heroStatMain}
                onPress={() => estimate && !linkedEstimate ? openDetail('total') : undefined}
                activeOpacity={estimate && !linkedEstimate ? 0.7 : 1}
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
                <Text style={styles.heroTapHint}>{heroLabel}{estimate && !linkedEstimate ? ' · Tap for breakdown' : ''}</Text>
              </TouchableOpacity>
              <View style={{ marginTop: 10, marginBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <BidConfidenceBadge project={project} variant="light" />
                {heroProgress.hasSchedule && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 }}>
                    <View style={{ width: 44, height: 6, borderRadius: 3, backgroundColor: themeColors.line, overflow: 'hidden' }}>
                      <AnimatedFill value={heroProgress.pct} style={{ width: `${heroProgress.pct}%`, height: 6, backgroundColor: themeColors.accent }} />
                    </View>
                    <Text style={{ color: themeColors.text, fontSize: 12, fontWeight: '800' }}>{heroProgress.pct}% done</Text>
                  </View>
                )}
              </View>
              <View style={styles.heroStatsRow}>
                {/* Legacy estimate sub-stats ONLY when no linkedEstimate drives the
                    headline (effectiveEstimateTotal prefers linkedEstimate). Otherwise
                    per-sqft / duration / bulk-savings are stale legacy figures sitting
                    directly under a headline computed from the linked grandTotal — two
                    numbers on one card that disagree. Restored from PR #81. */}
                {estimate && !linkedEstimate && (
                  <>
                    <View style={styles.heroStatSmall}>
                      <Text style={styles.smallStatLabel}>Per Sq Ft</Text>
                      <Text style={styles.smallStatValue}>${estimate.pricePerSqFt.toFixed(2)}</Text>
                    </View>
                    <View style={styles.heroStatSmall}>
                      <Text style={styles.smallStatLabel}>Duration</Text>
                      <Text style={styles.smallStatValue}>{estimate.estimatedDuration}</Text>
                    </View>
                    {showBulkSavings ? (
                      <TouchableOpacity
                        style={styles.heroStatSmall}
                        onPress={() => openDetail('savings')}
                        activeOpacity={0.7}
                        testID="hero-savings-tap"
                      >
                        <Text style={styles.smallStatLabel}>Bulk Savings</Text>
                        <Text style={[styles.smallStatValue, { color: themeColors.success }]}>
                          {formatMoney(totalBulkSavings)}
                        </Text>
                        <ArrowDownRight size={10} color={themeColors.textMuted} strokeWidth={1.75} />
                      </TouchableOpacity>
                    ) : null}
                  </>
                )}
                {/* `linkedEstimate &&`, NOT `!estimate && linkedEstimate &&`.
                    With both present the legacy block above is off (its
                    !linkedEstimate guard) — so gating this one on !estimate too
                    left the row rendering NOTHING for exactly the projects that
                    have both, which is every project that had a legacy estimate
                    before one was attached (commitEstimatePatch sets
                    linkedEstimate and never clears project.estimate). The
                    linked estimate is the authoritative one whenever it exists,
                    so it owns the row. */}
                {linkedEstimate && (
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
        <InspectionReadyCard project={project} openKey={prepParam ?? null} />
        <BuildingRecordCard project={project} testID="project-building-record" />
        <ProjectCodeChecksCard project={project} />

        {/* Financial pulse — projected margin as the hero number, a margin-risk
            spirit level, and the numbers that move the finish. Renders nothing
            until the project has a margin basis (a budget). */}
        <ProjectHero project={project} pulse={pulse} />

        {/* NextStepHero — scoped to this project. Tells the user the
            single most-important action for this project alone: add
            scope, build estimate, send invoice, chase stale RFIs, etc.
            Hidden when nothing is pending — keep the project page calm
            once the GC is in the rhythm of the work. */}
        <NextStepHero
          projects={project ? [project] : []}
          invoices={projectInvoices}
          rfis={projectRFIs}
          punchItems={punchItems}
          scopeToProjectId={project?.id}
          testID="project-next-step"
        />

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
                    // Shrink before ellipsizing. A stage label read at 10pt is
                    // still a stage label; "Constru…" is not.
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
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

        {/* Universal MAGE Copilot — say what you need, it routes to the right
            interview. The one entry a contractor never has to hunt for. */}
        <TouchableOpacity
          style={styles.copilotHubBtn}
          onPress={() => router.push({ pathname: '/copilot-hub', params: { projectId: id ?? '' } } as any)}
          activeOpacity={0.85}
          testID="project-copilot-hub-btn"
        >
          <View style={styles.copilotHubIcon}>
            <Mic size={18} color={Colors.textOnAccent} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.copilotHubTitle}>Ask MAGE to do anything</Text>
            <Text style={styles.copilotHubSub}>Say it — daily report, RFI, change order, estimate…</Text>
          </View>
          <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickActionBtn}
            onPress={() => router.push({ pathname: '/weekly-snapshot' as any, params: { projectId: id } })}
            activeOpacity={0.7}
            testID="project-weekly-snapshot-btn"
          >
            <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
              <CalendarDays size={18} color={themeColors.accent} strokeWidth={1.75} />
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
              <Wallet size={18} color={themeColors.success} strokeWidth={1.75} />
            </View>
            <Text style={styles.quickActionLabel}>Cash Flow</Text>
          </TouchableOpacity>
          {!hasAnyEstimate && (
            <TouchableOpacity
              style={styles.quickActionBtn}
              onPress={() => router.push({ pathname: '/estimate-wizard', params: { projectId: id ?? '' } } as never)}
              activeOpacity={0.7}
              testID="project-create-estimate-btn"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
                <Receipt size={18} color={themeColors.accent} strokeWidth={1.75} />
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
                <CalendarDays size={18} color={themeColors.info} strokeWidth={1.75} />
              </View>
              <Text style={styles.quickActionLabel}>Schedule</Text>
            </TouchableOpacity>
          )}
          {project.schedule && (
            <TouchableOpacity
              style={styles.quickActionBtn}
              // Carry the project. Without projectId + the `focus` nonce,
              // MobileScheduleScreen keeps whichever project was last active
              // there and its effect returns early — the P0 context drop the
              // comment at :2335 already names and fixes for one call site.
              onPress={() => router.replace({ pathname: '/(tabs)/schedule', params: { projectId: id ?? '', focus: String(Date.now()) } } as any)}
              activeOpacity={0.7}
              testID="project-view-schedule-btn"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: themeColors.info + '15' }]}>
                <CalendarDays size={18} color={themeColors.info} strokeWidth={1.75} />
              </View>
              <Text style={styles.quickActionLabel}>Schedule</Text>
            </TouchableOpacity>
          )}
          {hasAnyEstimate && (
            <TouchableOpacity
              style={styles.quickActionBtn}
              onPress={() => router.replace({ pathname: '/(tabs)/estimate/full', params: { projectId: id ?? '' } } as any)}
              activeOpacity={0.7}
              testID="project-view-estimate-btn"
            >
              <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
                <Receipt size={18} color={themeColors.accent} strokeWidth={1.75} />
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
              <TrendingDown size={18} color={themeColors.accent} strokeWidth={1.75} />
            </View>
            <Text style={styles.quickActionLabel}>Forecast</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickActionBtn, !isDesktop && styles.quickActionBtnFull, generatingCloseout && { opacity: 0.5 }]}
            onPress={handleGenerateCloseoutPacket}
            activeOpacity={0.7}
            disabled={generatingCloseout}
            testID="project-closeout-packet-btn"
          >
            <View style={[styles.quickActionIcon, { backgroundColor: themeColors.accent + '15' }]}>
              <Archive size={18} color={themeColors.accent} strokeWidth={1.75} />
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

          const renderTile = (tile: Tile) => {
            // The phone's one-per-row stack (desktop draws the section index).
            const TileIcon = tile.icon;
            const isLocked = lockedTileKeys.has(tile.key);
            const lockFeature = TILE_LOCK_FEATURE[tile.key];
            const lockReason = isLocked
              ? tileLockReason(tile.key, hubRole, lockFeature ? requiredTierFor(lockFeature as Parameters<typeof requiredTierFor>[0]) : null)
              : null;
            // VoiceOver label: name + item count + locked state, so a
            // screen-reader user hears the tile is a button, how many items
            // it holds, and whether it's gated before opening it.
            const a11yLabel = `${tile.label}`
              + (tile.count != null ? `, ${tile.count} ${tile.count === 1 ? 'item' : 'items'}` : '')
              + (lockReason ? `, locked, ${lockReason}` : '');
            // The tutorial target wraps the tile; the tile's styles stay on
            // the HardHatTap, which puts them on its INNER Animated.View inside
            // an unstyled Pressable. The body is a stretching column, so an
            // unstyled wrapper is neutral. (Since wave 6c this grid is phone
            // only; the row-only desktop wrapper lives on in the desktop
            // section index above.)
            return (
              <TutorialTarget key={tile.key} id={`hub.tile.${tile.key}`} style={layout.isDesktop ? styles.tileTargetDesktop : undefined}>
              <HardHatTap
                style={styles.sectionTile}
                hatColor={tile.color}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel}
                accessibilityState={{ disabled: false }}
                hitSlop={6}
                onPress={() => pressTile(tile)}
                testID={`section-tile-${tile.key}`}
              >
                <View style={[styles.sectionTileIcon, { backgroundColor: tile.color + '15' }]}>
                  <TileIcon size={20} color={tile.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.sectionTileLabel} numberOfLines={1}>{tile.label}</Text>
                  {tileBadges[tile.key] ? (
                    <Text
                      style={[styles.sectionTileStatus, { color: STATUS_TONES[tileBadges[tile.key]!.tone].color }]}
                      numberOfLines={1}
                    >
                      {tileBadges[tile.key]!.label}
                    </Text>
                  ) : lockReason ? (
                    <Text style={[styles.sectionTileStatus, { color: themeColors.textMuted }]} numberOfLines={1} testID={`section-tile-lock-reason-${tile.key}`}>
                      {lockReason}
                    </Text>
                  ) : null}
                </View>
                {tile.count !== null && tile.count !== undefined && (
                  <View style={styles.sectionTileBadge}>
                    <Text style={styles.sectionTileBadgeText}>{tile.count}</Text>
                  </View>
                )}
                {lockedTileKeys.has(tile.key) && (
                  <Lock size={13} color={themeColors.textMuted} strokeWidth={2.5} style={{ marginLeft: 4 }} />
                )}
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </HardHatTap>
              </TutorialTarget>
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
                    <TutorialTarget id={`hub.group.${group.key}`}>
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
                      <CollapseChevron pair="downUp" open={!collapsed} size={18} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                    </TutorialTarget>
                    {/* No wrapper — conditional render only. LayoutAnimation
                        in toggleGroup() handles the smooth open/close.
                        SawCutReveal had a bug where it kept the body mounted
                        at opacity 0 after collapse, leaving phantom height
                        ("the gap that won't go away"). */}
                    {!collapsed && (
                      <View style={[styles.tileGroupBody, layout.isDesktop && styles.tileGroupBodyDesktop]}>
                        {groupTiles.map(renderTile)}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })()}
        </>
        )}

        {!isDesktop && (
        <Modal
          visible={activeTile !== null}
          animationType="slide"
          presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
          onRequestClose={closeSection}
        >
          <View style={{ flex: 1, backgroundColor: themeColors.bg, paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }}>
            <View style={styles.sectionModalHeader}>
              <TouchableOpacity
                onPress={closeSection}
                style={styles.sectionModalBack}
                activeOpacity={0.7}
                testID="section-modal-back"
              >
                <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                <Text style={styles.sectionModalBackText}>Back</Text>
              </TouchableOpacity>
              <Text style={styles.sectionModalTitle} numberOfLines={1}>
                {sectionTitle(activeTile)}
              </Text>
              <View style={{ width: 72 }} />
            </View>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 4 }}
              showsVerticalScrollIndicator={false}
            >
              {sectionBody}
            </ScrollView>
          </View>
          {/* Inside the tile sheet: on iOS a Modal presents from the topmost
              one, and the Client Portal row that opens it lives in here. */}
          <ClientDocumentAskSheet {...termsGate.sheet} />
        </Modal>
        )}

        {/* Phone only: desktop has Share / Edit / Delete-Leave in the header
            toolbar, and the AI report in its ⋯ menu (the side panel). */}
        {!isDesktop && (
        <>
        {hasAnyEstimate && (
          <View style={styles.shareSection}>
            <Text style={styles.shareSectionTitle}>Share</Text>
            {branding.companyName ? (
              <Text style={styles.shareBrandingNote}>Branded as: {branding.companyName}</Text>
            ) : null}
            {branding.signatureData && branding.signatureData.length > 0 && (
              <View style={styles.signatureNote}>
                <PenTool size={12} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.signatureNoteText}>Signature will be included</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.shareBtnPrimary}
              onPress={() => setShowShareModal(true)}
              activeOpacity={0.7}
              testID="open-share-modal"
            >
              <Share2 size={18} color={"#FFFFFF"} strokeWidth={1.75} />
              <Text style={styles.shareBtnPrimaryText}>Share Estimate</Text>
            </TouchableOpacity>
          </View>
        )}

        {!hasAnyEstimate && (
          <View style={styles.noEstimate}>
            <AlertTriangle size={32} color={themeColors.accent} strokeWidth={1.75} />
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

        <TouchableOpacity
          style={[styles.editButton, hubPerms.editBlockedReason ? { opacity: 0.55 } : null]}
          onPress={requestEdit}
          activeOpacity={0.7}
          testID="edit-project-bottom-btn"
          accessibilityRole="button"
          accessibilityState={{ disabled: !!hubPerms.editBlockedReason }}
        >
          <Pencil size={18} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.editButtonText}>Edit Project</Text>
        </TouchableOpacity>
        {hubPerms.editBlockedReason ? (
          <Text style={[styles.contractHint, { marginHorizontal: 20, marginTop: 6 }]} testID="edit-project-blocked-reason">
            {hubPerms.editBlockedReason}
          </Text>
        ) : null}

        {hubPerms.canDelete ? (
          <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} activeOpacity={0.7} testID="delete-project-btn">
            <Trash2 size={18} color={themeColors.dangerLabel} strokeWidth={1.75} />
            <Text style={styles.deleteButtonText}>Delete Project</Text>
          </TouchableOpacity>
        ) : hubPerms.canLeave ? (
          <TouchableOpacity
            style={[styles.deleteButton, (leaving || checkingLeave) ? { opacity: 0.55 } : null]}
            onPress={handleLeave}
            disabled={leaving || checkingLeave}
            activeOpacity={0.7}
            testID="leave-project-btn"
            accessibilityRole="button"
          >
            <ArrowDownRight size={18} color={themeColors.dangerLabel} strokeWidth={1.75} />
            <Text style={styles.deleteButtonText}>{leaving ? 'Leaving…' : checkingLeave ? 'Sending unsynced changes…' : 'Leave project'}</Text>
          </TouchableOpacity>
        ) : null}
        </>
        )}
        </TutorialScrollAnchor>
      </ScrollView>

      {/* Desktop: sections open in a side panel BESIDE the page (docked at a
          1200+ px row, over its right edge below that) — never a full-window
          sheet, so the sidebar and the page stay live. No onToggle: Cmd+J
          stays the shell's. */}
      {isDesktop && (
        <SidePanel
          open={activeTile !== null}
          onClose={closeSection}
          title={sectionTitle(activeTile)}
          panelId="project-section"
          containerWidth={panelRow.width}
          testID="project-section-panel"
        >
          {sectionBody}
        </SidePanel>
      )}
      {isDesktop && <ClientDocumentAskSheet {...termsGate.sheet} />}

      <Paywall
        visible={portalPaywallOpen}
        feature="Client Portal"
        requiredTier={requiredTierFor('client_portal')}
        onClose={() => setPortalPaywallOpen(false)}
      />

      <Modal
        visible={detailModal !== null}
        animationType={fCost.animationType}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        transparent={fCost.transparent}
        onRequestClose={() => setDetailModal(null)}
      >
        <SheetOverlay frame={fCost}>
        <SheetScrim frame={fCost} onPress={() => setDetailModal(null)} />
        <View style={[detailStyles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }, fCost.card]}>
          {fCost.showHandle && <View style={detailStyles.modalHandle} />}
          <View style={detailStyles.modalHeader}>
            <Text style={detailStyles.modalTitle}>
              {detailModal === 'total' ? 'Cost Breakdown' : 'Savings Detail'}
            </Text>
            <TouchableOpacity
              style={detailStyles.modalCloseBtn}
              onPress={() => setDetailModal(null)}
              activeOpacity={0.7}
              testID="close-detail-modal" accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={themeColors.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
          {detailModal === 'total' && renderTotalDetailModal()}
          {detailModal === 'savings' && renderSavingsDetailModal()}
        </View>
        </SheetOverlay>
      </Modal>

      {/* ── Revision Detail Modal ── */}
      <Modal
        visible={selectedRevision !== null}
        animationType={fRev.animationType}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        transparent={fRev.transparent}
        onRequestClose={() => setSelectedRevision(null)}
      >
        <SheetOverlay frame={fRev}>
        <SheetScrim frame={fRev} onPress={() => setSelectedRevision(null)} />
        {selectedRevision && (() => {
          // Chronological list (oldest first) for delta calc.
          const chronological = (project.estimateVersions ?? []).slice().sort(
            (a, b) => a.revNumber - b.revNumber,
          );
          const revIdx = chronological.findIndex(r => r.id === selectedRevision.id);
          const olderRev = revIdx > 0 ? chronological[revIdx - 1] : null;
          const diff = olderRev
            ? diffEstimates(olderRev.snapshot, selectedRevision.snapshot)
            : null;
          return (
            <View style={[{ flex: 1, backgroundColor: themeColors.bg, paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }, fRev.card]}>
              <View style={styles.sectionModalHeader}>
                <TouchableOpacity
                  onPress={() => setSelectedRevision(null)}
                  style={styles.sectionModalBack}
                  activeOpacity={0.7}
                  testID="rev-detail-back"
                >
                  <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  <Text style={styles.sectionModalBackText}>Back</Text>
                </TouchableOpacity>
                <Text style={styles.sectionModalTitle} numberOfLines={1}>
                  Rev {selectedRevision.revNumber}
                </Text>
                <View style={{ width: 72 }} />
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 40, paddingTop: 12 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Grand total hero */}
                <View style={styles.revDetailHero}>
                  <Text style={styles.revDetailHeroLabel}>Grand Total</Text>
                  <Text style={styles.revDetailHeroValue}>{formatMoney(selectedRevision.grandTotal)}</Text>
                  <Text style={styles.revDetailHeroMeta}>
                    {new Date(selectedRevision.createdAt).toLocaleDateString()} · {ESTIMATE_REASON_LABEL[selectedRevision.reason]}
                  </Text>
                  {selectedRevision.note ? (
                    <Text style={styles.revDetailNote}>{selectedRevision.note}</Text>
                  ) : null}
                </View>

                {/* Tab row */}
                <View style={[styles.revDetailTabRow, isDesktop && segmentedDesktop.container]}>
                  <TouchableOpacity
                    style={[styles.revDetailTab, revDetailView === 'delta' && styles.revDetailTabActive, isDesktop && segmentedDesktop.segment]}
                    onPress={() => setRevDetailView('delta')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.revDetailTabText, revDetailView === 'delta' && styles.revDetailTabTextActive]}>
                      Changes
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.revDetailTab, revDetailView === 'items' && styles.revDetailTabActive, isDesktop && segmentedDesktop.segment]}
                    onPress={() => setRevDetailView('items')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.revDetailTabText, revDetailView === 'items' && styles.revDetailTabTextActive]}>
                      Line Items
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Delta view */}
                {revDetailView === 'delta' && (
                  <View style={[styles.summaryCard, { marginHorizontal: 20 }]}>
                    {!diff && (
                      <Text style={styles.revEmptyText}>First revision — no prior to compare.</Text>
                    )}
                    {diff && diff.categories.length === 0 && (
                      <Text style={styles.revEmptyText}>No line-item changes from the previous revision.</Text>
                    )}
                    {diff && diff.categories.map((cat) => (
                      <View key={cat.key} style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>{cat.label}</Text>
                        <Text style={[styles.summaryValue, { color: cat.delta >= 0 ? themeColors.accent : themeColors.success }]}>
                          {cat.delta >= 0 ? '+' : ''}{formatMoney(cat.delta)}
                        </Text>
                      </View>
                    ))}
                    {diff && (
                      <>
                        <View style={styles.grandTotalDivider} />
                        <View style={styles.summaryRow}>
                          <Text style={styles.grandTotalLabel}>Net Change</Text>
                          <Text style={[styles.grandTotalValue, { color: diff.netDelta >= 0 ? themeColors.accent : themeColors.success }]}>
                            {diff.netDelta >= 0 ? '+' : ''}{formatMoney(diff.netDelta)}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                )}

                {/* Line items view */}
                {revDetailView === 'items' && (
                  <View style={[styles.tableContainer, { marginHorizontal: 20 }]}>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableHeaderText, { flex: 2 }]}>Item</Text>
                      <Text style={[styles.tableHeaderText, { flex: 1 }]}>Qty</Text>
                      <Text style={[styles.tableHeaderText, { flex: 1 }]}>Unit</Text>
                      <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' as const }]}>Total</Text>
                    </View>
                    {(Array.isArray(selectedRevision.snapshot.items) ? selectedRevision.snapshot.items : []).map((item, idx) => (
                      <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
                        <Text style={[styles.tableCellName, { flex: 2 }]} numberOfLines={1}>{item.name ?? 'Unnamed'}</Text>
                        <Text style={[styles.tableCell, { flex: 1 }]}>{item.quantity ?? 0}</Text>
                        <Text style={[styles.tableCell, { flex: 1 }]}>{item.unit ?? 'ea'}</Text>
                        <Text style={[styles.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>
                          {formatMoney(typeof item.lineTotal === 'number' ? item.lineTotal : 0)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Restore button */}
                <TouchableOpacity
                  style={styles.revRestoreBtn}
                  onPress={() => {
                    showAlert(
                      `Restore Rev ${selectedRevision.revNumber}?`,
                      'Your current estimate is saved as a revision first. Existing contracts/invoices are not changed — regenerate them if needed.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Restore',
                          style: 'destructive',
                          onPress: () => {
                            const patch = restorePatch(project, selectedRevision.id);
                            if (Object.keys(patch).length) {
                              updateProject(project.id, patch);
                              nailIt(`Rev ${selectedRevision.revNumber} restored`);
                            }
                            setSelectedRevision(null);
                          },
                        },
                      ],
                    );
                  }}
                  activeOpacity={0.7}
                  testID="restore-revision-btn"
                >
                  <Repeat size={16} color={'#FFFFFF'} strokeWidth={1.75} />
                  <Text style={styles.revRestoreBtnText}>Restore this revision</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          );
        })()}
        </SheetOverlay>
      </Modal>

      <Modal
        visible={showShareModal}
        transparent
        animationType={fShare.animationType}
        onRequestClose={() => setShowShareModal(false)}
      >
        <Pressable style={[styles.shareModalOverlay, fShare.overlay]} onPress={() => setShowShareModal(false)}>
          <Pressable style={[styles.shareModalCard, fShare.card]} onPress={() => undefined}>
            <View style={styles.shareModalHeader}>
              <Text style={styles.shareModalTitle}>Share Estimate</Text>
              <TouchableOpacity onPress={() => setShowShareModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            <Text style={styles.shareModalDesc}>
              Choose how to share your estimate{project.schedule ? ' and schedule' : ''}. PDFs include your company branding{branding.signatureData?.length ? ', logo, and signature' : branding.logoUri ? ' and logo' : ''}.
            </Text>

            <TouchableOpacity style={styles.shareOption} onPress={handleSharePDF} activeOpacity={0.7} testID="share-pdf-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: themeColors.accent + '12' }]}>
                <FileText size={20} color={themeColors.accent} strokeWidth={1.75} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Share as PDF</Text>
                <Text style={styles.shareOptionDesc}>Professional document with full branding</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shareOption} onPress={handleShareEmail} activeOpacity={0.7} testID="share-email-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: themeColors.info + '12' }]}>
                <Mail size={20} color={themeColors.info} strokeWidth={1.75} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Send via Email</Text>
                <Text style={styles.shareOptionDesc}>Formatted text in your email client</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shareOption} onPress={handleShareText} activeOpacity={0.7} testID="share-text-option">
              <View style={[styles.shareOptionIcon, { backgroundColor: themeColors.success + '12' }]}>
                <MessageSquare size={20} color={themeColors.success} strokeWidth={1.75} />
              </View>
              <View style={styles.shareOptionInfo}>
                <Text style={styles.shareOptionTitle}>Send via Text</Text>
                <Text style={styles.shareOptionDesc}>Quick summary with cost breakdown</Text>
              </View>
            </TouchableOpacity>

            {project.schedule && (
              <TouchableOpacity style={styles.shareOption} onPress={handleShareSchedulePDF} activeOpacity={0.7} testID="share-schedule-option">
                <View style={[styles.shareOptionIcon, { backgroundColor: themeColors.accent + '12' }]}>
                  <CalendarDays size={20} color={themeColors.accent} strokeWidth={1.75} />
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
        animationType={fEdit.animationType}
        onRequestClose={() => setShowEditModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.inviteModalOverlay}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[{ flexGrow: 1, justifyContent: 'flex-end' as const }, fEdit.scrollContent]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.inviteModalCard, { paddingBottom: insets.bottom + 20 }, fEdit.card]}>
                <View style={styles.inviteModalHeader}>
                  <Text style={styles.inviteModalTitle}>Edit Project</Text>
                  <TouchableOpacity onPress={() => setShowEditModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
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
                {editType === 'other' ? (
                  <>
                    <Text style={styles.inviteFieldLabel}>Describe the job</Text>
                    <TextInput
                      style={styles.inviteInput}
                      value={editTypeOther}
                      onChangeText={setEditTypeOther}
                      placeholder="e.g. Whole-house repipe"
                      placeholderTextColor={themeColors.textMuted}
                      maxLength={PROJECT_TYPE_OTHER_MAX}
                      testID="edit-type-other-input"
                    />
                  </>
                ) : null}

                {!contractAccess.hidden && (
                  <View style={styles.contractBlock} testID="edit-contract-block">
                    <Text style={styles.contractBlockTitle}>Contract</Text>
                    {contractAccess.lockedReason ? (
                      <View style={styles.contractNote}>
                        <Lock size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                        <Text style={styles.contractNoteText}>{contractAccess.lockedReason}</Text>
                      </View>
                    ) : (
                      <>
                        {project?.contractTermsLoaded !== true && (
                          // Empty terms are only written as NULL once this device
                          // has seen the server's copy (types/index.ts
                          // contractTermsSyncColumns), so say what that means.
                          <View style={styles.contractNote}>
                            <Info size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                            <Text style={styles.contractNoteText}>
                              {"Contract terms haven't been confirmed from the server on this device yet. What you enter saves; a field you clear won't remove a value saved from another device until they load."}
                            </Text>
                          </View>
                        )}

                        <Text style={styles.inviteFieldLabel}>Contract type</Text>
                        <View style={styles.editTypeGrid}>
                          <TouchableOpacity
                            style={[styles.editTypeChip, editContractMode === undefined && styles.editTypeChipActive]}
                            onPress={() => setEditContractMode(undefined)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityState={{ selected: editContractMode === undefined }}
                          >
                            <Text style={[styles.editTypeChipLabel, editContractMode === undefined && styles.editTypeChipLabelActive]}>Not set</Text>
                          </TouchableOpacity>
                          {CONTRACT_MODES.map(mode => (
                            <TouchableOpacity
                              key={mode}
                              style={[styles.editTypeChip, editContractMode === mode && styles.editTypeChipActive]}
                              onPress={() => setEditContractMode(mode)}
                              activeOpacity={0.7}
                              accessibilityRole="button"
                              accessibilityState={{ selected: editContractMode === mode }}
                              testID={`edit-contract-mode-${mode}`}
                            >
                              <Text style={[styles.editTypeChipLabel, editContractMode === mode && styles.editTypeChipLabelActive]}>{CONTRACT_MODE_LABELS[mode]}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>

                        {editContractMode === 'gmp' && (
                          <>
                            <Text style={styles.inviteFieldLabel}>GMP cap ($)</Text>
                            <TextInput
                              style={styles.inviteInput}
                              value={editGmpCap}
                              onChangeText={setEditGmpCap}
                              placeholder="Guaranteed maximum price"
                              placeholderTextColor={themeColors.textMuted}
                              keyboardType="decimal-pad"
                              testID="edit-gmp-cap-input"
                            />
                            <Text style={styles.contractHint}>
                              Your WIP report falls back to this as the contract value when nothing more specific — a pay application, a target budget — is on file.
                            </Text>
                          </>
                        )}

                        {feeApplies && (
                          <>
                            <Text style={styles.inviteFieldLabel}>Your fee</Text>
                            <View style={styles.editTypeGrid}>
                              {(['percent', 'amount'] as const).map(kind => (
                                <TouchableOpacity
                                  key={kind}
                                  style={[styles.editTypeChip, editFeeKind === kind && styles.editTypeChipActive]}
                                  onPress={() => setEditFeeKind(kind)}
                                  activeOpacity={0.7}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: editFeeKind === kind }}
                                >
                                  <Text style={[styles.editTypeChipLabel, editFeeKind === kind && styles.editTypeChipLabelActive]}>
                                    {kind === 'percent' ? '% of cost' : 'Flat $'}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                            <TextInput
                              style={styles.inviteInput}
                              value={editFee}
                              onChangeText={setEditFee}
                              placeholder={editFeeKind === 'percent' ? 'e.g. 15' : 'e.g. 25000'}
                              placeholderTextColor={themeColors.textMuted}
                              keyboardType="decimal-pad"
                              testID="edit-fee-input"
                            />
                          </>
                        )}

                        {/* What the client will actually see. portalSnapshot only
                            builds the cost breakdown for GMP / open book, and only
                            has something real to put in it once commitments exist
                            — so an empty commitment log is said out loud here
                            rather than discovered by the client. */}
                        {portalShowsCost && projectCommitments.length === 0 && (
                          <View style={[styles.contractNote, styles.contractNoteWarn]} testID="edit-contract-portal-empty">
                            <AlertTriangle size={14} color={themeColors.warningLabel} strokeWidth={1.75} />
                            <Text style={[styles.contractNoteText, styles.contractNoteWarnText]}>
                              No commitments are logged on this job yet, so the client portal&apos;s cost breakdown has nothing real to show. It fills in once you log subcontracts or purchase orders.
                            </Text>
                          </View>
                        )}
                        {portalShowsCost && projectCommitments.length > 0 && (
                          <Text style={styles.contractHint}>
                            The client portal shows committed and actual cost against budget from its next update.
                          </Text>
                        )}
                        {(editContractMode === 'fixed' || editContractMode === 'cost_plus') && (
                          <Text style={styles.contractHint}>
                            On this contract type the client portal shows what you&apos;ve billed, not your costs.
                          </Text>
                        )}

                        <Text style={styles.inviteFieldLabel}>Retainage (%)</Text>
                        <TextInput
                          style={styles.inviteInput}
                          value={editRetainage}
                          onChangeText={(t) => { setEditRetainage(t); setEditRetainageTouched(true); }}
                          placeholder="Leave blank if you don't know"
                          placeholderTextColor={themeColors.textMuted}
                          keyboardType="decimal-pad"
                          testID="edit-retainage-input"
                        />
                        {project?.retainagePercentAssumed === true && !editRetainageTouched && project.retainagePercent != null && (
                          <Text style={styles.contractHint}>
                            Carried from your earlier paperwork, not read off the contract. Retype it to record it as the contract rate.
                          </Text>
                        )}
                        {/* Says what the field does. A rate typed here now
                            outranks a different rate carried from the last
                            invoice (utils/retainageSource, audit round 2
                            #26), but a sent invoice keeps its own rate. */}
                        {editRetainage.trim().length > 0 && !(project?.retainagePercentAssumed === true && !editRetainageTouched) && (
                          <Text style={styles.contractHint}>
                            New invoices hold this rate. Invoices you have already sent keep the rate they went out with.
                          </Text>
                        )}
                      </>
                    )}
                  </View>
                )}

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


      {/* Inline internal-note composer — fallback for platforms without a
          system prompt (Android, and any web runtime lacking window.prompt).
          Reuses the invite-modal styles so no new tokens are introduced. */}
      <Modal
        visible={showNoteModal}
        transparent
        animationType={fNote.animationType}
        onRequestClose={() => setShowNoteModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.inviteModalOverlay}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[{ flexGrow: 1, justifyContent: 'flex-end' as const }, fNote.scrollContent]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.inviteModalCard, { paddingBottom: insets.bottom + 20 }, fNote.card]}>
                <View style={styles.inviteModalHeader}>
                  <Text style={styles.inviteModalTitle}>Internal Note</Text>
                  <TouchableOpacity onPress={() => setShowNoteModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.inviteDesc}>
                  Add a private note to "{project.name}". Only your team can see it.
                </Text>

                <TextInput
                  style={styles.inviteInput}
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="Type your note…"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  autoFocus
                  testID="internal-note-input"
                />

                <View style={styles.inviteActionRow}>
                  <TouchableOpacity style={styles.inviteCancelBtn} onPress={() => setShowNoteModal(false)} activeOpacity={0.8}>
                    <Text style={styles.inviteCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.inviteSendBtn}
                    onPress={() => { submitNote(noteDraft); setShowNoteModal(false); }}
                    activeOpacity={0.85}
                    disabled={!noteDraft.trim()}
                    testID="save-internal-note-btn"
                  >
                    <Plus size={16} color={"#FFFFFF"} strokeWidth={1.75} />
                    <Text style={styles.inviteSendBtnText}>Add Note</Text>
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
            <X size={20} color={themeColors.surface} strokeWidth={1.75} />
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
              <Pencil size={14} color={themeColors.surface} strokeWidth={1.75} />
              <Text style={styles.lightboxMarkupBtnText}>{(lightboxPhoto.markup?.length ?? 0) > 0 ? 'Edit markup' : 'Add markup'}</Text>
            </TouchableOpacity>
          )}
          {lightboxPhoto && (
            <TouchableOpacity
              testID="codelook-open-lightbox"
              accessibilityRole="button"
              accessibilityLabel="Code look"
              style={styles.lightboxCodeLookBtn}
              onPress={() => {
                const target = { photoUri: lightboxPhoto.uri, sourcePhotoId: lightboxPhoto.id };
                setLightboxPhoto(null);
                // A modal over a modal is unreliable on iOS — the same hand-off
                // the markup button uses.
                setTimeout(() => setCodeLookTarget(target), 100);
              }}
              activeOpacity={0.85}
            >
              <ScanSearch size={14} color={themeColors.surface} strokeWidth={1.75} />
              <Text style={styles.lightboxMarkupBtnText}>Code look</Text>
            </TouchableOpacity>
          )}
          {lightboxPhoto && project && (
            <View style={styles.lightboxPortalActions} onStartShouldSetResponder={() => true}>
              <PortalStatusPill portalState={lightboxPhoto.portalState} itemUpdatedAt={lightboxPhoto.timestamp} />
              <SendToClientButton
                kind="photo"
                itemId={lightboxPhoto.id}
                projectId={project.id}
                portalState={lightboxPhoto.portalState}
                itemUpdatedAt={lightboxPhoto.timestamp}
                canSend={true}
              />
            </View>
          )}
        </Pressable>
      </Modal>

      {codeLookTarget && project ? (
        <CodeLookSheet
          visible
          onClose={() => setCodeLookTarget(null)}
          project={project}
          photoUri={codeLookTarget.photoUri}
          sourcePhotoId={codeLookTarget.sourcePhotoId}
        />
      ) : null}

      {/* Preview-then-apply for a change order's schedule impact. Shows the
          anchor task, every downstream shift, the new finish and any critical
          path flips — and lets the GC pick a different task — before the CO is
          approved and the schedule is rewritten. */}
      {coReflowPreview !== null && (
        <COScheduleReflowPreviewModal
          visible
          changeOrder={coReflowPreview}
          schedule={project?.schedule ?? null}
          estimateItems={coReflowEstimateItems}
          intent={coReflowPreview.status === 'approved' ? 'place' : 'approve'}
          moneyLine={coReflowPreview.status === 'approved'
            ? undefined
            : `Commits ${formatMoney(coReflowPreview.changeAmount)} to the contract. This can't be undone with a tap.`}
          onClose={() => setCoReflowPreview(null)}
          onConfirm={(anchorTaskId) => {
            const co = coReflowPreview;
            const alreadyApproved = co.status === 'approved';
            setCoReflowPreview(null);
            // Approving and placing-later both land in the same context call:
            // an explicit anchor lets the reflow run on an already-approved CO.
            updateChangeOrder(co.id, alreadyApproved ? {} : { status: 'approved' }, { anchorTaskId });
            if (!alreadyApproved) fireConfetti({ count: 35 });
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }}
        />
      )}

      {/* No local mic FAB here — hands-on UI pass 2026-09-07, finding 8.
          BrainSurface already mounts the global orange Brain FAB on every
          screen, and this was the only screen in the app that ALSO drew
          UniversalMicButton's own floating dark mic, stacking two circles over
          the Cash Flow tile and giving the screen a GC lives in three
          concurrent ways to talk to the AI. The project-scoped door is the
          inline "Ask MAGE to do anything" card above, which carries the
          projectId into /copilot-hub. Mounting UniversalMicButton with
          `hideFab` would have left an unopenable modal plus three context
          subscriptions behind, so the mount is gone rather than muted. */}

      {/* Tutorial blocker: the hub's section, detail, revision, share, edit,
          note, action, lightbox, paywall and reflow sheets have no tutorial
          layer and draw ABOVE the root one on iOS, so while any is up the
          coach draws nothing rather than a dim and a card behind the sheet.
          Zero-size, inert. */}
      {(activeTile !== null || detailModal !== null || selectedRevision !== null || showShareModal || showEditModal
        || showNoteModal || actionSheetRef !== null || lightboxPhoto !== null || portalPaywallOpen || coReflowPreview !== null
        || codeLookTarget !== null)
        ? <TutorialTarget id="hub.modalUp" />
        : null}
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
  backBtn: { backgroundColor: themeColors.accentFill, paddingHorizontal: 24, paddingVertical: 12, borderRadius: Tokens.radius.md },
  backBtnText: { color: "#FFFFFF", fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
  heroCard: { backgroundColor: themeColors.surface, marginHorizontal: 20, marginTop: 16, borderRadius: 20, padding: 22, borderTopWidth: 4, borderTopColor: themeColors.accent, borderWidth: 1, borderColor: themeColors.line, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3 },
  heroHeader: { marginBottom: 16 },
  heroTitleBlock: {},
  heroName: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: themeColors.text, letterSpacing: -0.3 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  heroMetaText: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary },
  heroDesc: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, marginTop: 6, lineHeight: 18 },
  heroStats: {},
  heroStatMain: { backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.lg, padding: 16, alignItems: 'center', marginBottom: 12 },
  heroTapHint: { fontSize: 10, color: themeColors.textMuted, fontWeight: '500' as const, marginTop: 4, letterSpacing: 0.3 },
  heroStatLabel: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, fontWeight: '500' as const, marginBottom: 4 },
  heroStatValue: { fontSize: 32, fontWeight: '800' as const, color: themeColors.text, letterSpacing: -1 },
  heroStatsRow: { flexDirection: 'row', gap: 8 },
  heroStatSmall: { flex: 1, backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, padding: 10, alignItems: 'center' },
  smallStatLabel: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary, fontWeight: '500' as const, marginBottom: 2 },
  smallStatValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
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
  // Metric text, not a status — ink, not info-blue (sim-audit slop #5).
  scheduleTaskProgress: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
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
  shareBtnPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: themeColors.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3 },
  shareBtnPrimaryText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  editButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.accent + '10', borderRadius: Tokens.radius.card, paddingVertical: 16, gap: 8, marginHorizontal: 20, marginTop: 24, borderWidth: 1, borderColor: themeColors.accent + '20' },
  editButtonText: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  editTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  editTypeChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.card, backgroundColor: themeColors.line },
  editTypeChipActive: { backgroundColor: themeColors.accentFill },
  editTypeChipLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  editTypeChipLabelActive: { color: "#FFFFFF" },
  contractBlock: { gap: 10, marginTop: 8, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: themeColors.line },
  contractBlockTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  contractHint: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  contractNote: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, padding: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt },
  contractNoteText: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  contractNoteWarn: { backgroundColor: themeColors.warningSoft },
  contractNoteWarnText: { color: themeColors.warningLabel },
  // fg === bg: "Delete Project" and its Trash2 icon were `danger` on a solid
  // `danger` fill. The `danger + '30'` border it already carries only makes
  // sense over a soft fill, which is what this was before the alpha was lost.
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.dangerSoft, borderRadius: Tokens.radius.card, paddingVertical: 16, gap: 8, marginHorizontal: 20, marginTop: 14, borderWidth: 1, borderColor: themeColors.danger + '30' },
  deleteButtonText: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: themeColors.dangerLabel },
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
  inviteRoleBtnActive: { backgroundColor: themeColors.accentFill },
  inviteRoleBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  inviteRoleBtnTextActive: { color: "#FFFFFF" },
  inviteRoleDesc: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary },
  inviteActionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  inviteCancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  inviteCancelBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  inviteSendBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
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
  invBalanceMeta: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.textMuted },
  // A/R summary above the project's invoice list.
  arSummary: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12,
    paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1, borderColor: themeColors.line,
  },
  arSummaryLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase' as const, marginBottom: 3,
  },
  arSummaryValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: themeColors.text },
  arSummaryMeta: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2 },
  coBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  coBadgeText: { fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  coApproveRow: { flexDirection: 'row', gap: 8, paddingTop: 8 },
  coApproveBtn: { flex: 1, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.successSoft, alignItems: 'center', borderWidth: 1, borderColor: themeColors.success + '30' },
  coApproveBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.success },
  // fg === bg. Its sibling coApproveBtn is already successSoft + success — this
  // is the exact Close/Reject pair punch-list.tsx had, with the same fix.
  coRejectBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: Tokens.radius.md, backgroundColor: themeColors.dangerSoft, alignItems: 'center', borderWidth: 1, borderColor: themeColors.danger + '30' },
  coRejectBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.dangerLabel },
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
  dfrRecordBlock: {
    gap: 4, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8,
    backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md,
  },
  dfrRecordHeadline: { fontSize: Type.subheadEmphasized.fontSize, fontWeight: '700' as const, color: themeColors.text },
  dfrRecordNote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  dfrRecordDue: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.accent, lineHeight: 17 },
  dfrWeekBucket: { marginBottom: 8 },
  dfrWeekHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 4, paddingVertical: 6 },
  dfrWeekLabel: { flex: 1, fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  dfrWeekBadge: { backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.sm, paddingHorizontal: 7, paddingVertical: 1, minWidth: 20, alignItems: 'center' as const },
  dfrWeekBadgeText: { fontSize: 10, fontWeight: '700' as const, color: themeColors.textSecondary },
  photoCaptureRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 12,
  },
  photoCaptureBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  photoCaptureBtnPrimary: {
    flex: 1,
    backgroundColor: themeColors.accentFill,
    borderColor: themeColors.accentFill,
  },
  photoCaptureBtnPrimaryText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: themeColors.surface,
  },
  photoCaptureBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: themeColors.accent,
  },
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
  photoSearchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 8 },
  photoSearchInput: { flex: 1, minHeight: 40, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subhead.fontSize, color: themeColors.text },
  photoGroupToggle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, paddingHorizontal: 10, paddingVertical: 9, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.surfaceAlt },
  photoGroupToggleText: { fontSize: Type.caption1.fontSize, color: themeColors.text, fontWeight: '600' as const },
  photoDayHeader: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, fontWeight: '700' as const, marginTop: 12, marginBottom: 2 },
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
    position: 'absolute' as const, bottom: 120, alignSelf: 'center' as const,
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(255,106,26,0.95)',
  },
  lightboxCodeLookBtn: {
    position: 'absolute' as const, bottom: 176, alignSelf: 'center' as const,
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: Tokens.radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  lightboxMarkupBtnText: { color: themeColors.surface, fontWeight: '800' as const, fontSize: Type.footnote.fontSize },
  lightboxPortalActions: {
    position: 'absolute' as const, bottom: 16, left: 16, right: 16,
    gap: 8,
  },
  portalInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  portalTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, marginBottom: 2 },
  portalDesc: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 18 },
  portalTermsRow: { gap: 8, alignItems: 'flex-start' as const, marginTop: 10 },
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
  // fg === bg: "Add Internal Note" and its Plus icon were `info` on `info`.
  commAddNoteBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.info + '1F', marginTop: 8 },
  commAddNoteBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.info },
  quickActions: { flexDirection: 'row' as const, paddingHorizontal: 20, marginTop: 12, gap: 10, flexWrap: 'wrap' as const },
  copilotHubBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, marginHorizontal: 20, marginTop: 16, padding: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentSoft, borderWidth: 1, borderColor: themeColors.accentSoft },
  copilotHubIcon: { width: 36, height: 36, borderRadius: Tokens.radius.full, backgroundColor: themeColors.accent, alignItems: 'center' as const, justifyContent: 'center' as const },
  copilotHubTitle: { ...Type.subheadEmphasized, color: themeColors.accent },
  copilotHubSub: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 1 },
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
    // flexBasis 'auto', not flex:1. Equal quarters gave every chip ~67pt of
    // inner width and "Construction" needs ~79 at 12pt bold, so the stepper
    // rendered the CURRENT stage as "Constru…" — the one label a GC opens this
    // card to read (hands-on UI pass 2026-09-07, finding 9). Sized to content
    // the four labels total ~296pt and fit a 390pt phone with room to spare;
    // flexGrow still spreads the slack so the strip fills the card edge to edge.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
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
    // On a 320pt phone the row still overflows; flexShrink 0 makes the other
    // three give the width up first, so the current stage is the last thing
    // that would ever be trimmed rather than the first.
    flexShrink: 0,
    backgroundColor: themeColors.accentFill,
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
  // ── Wave 6c desktop workspace (layout only; colours stay on the phone styles) ──
  containerDesktop: { flexDirection: 'row' as const },
  pageDesktop: {
    maxWidth: Layout.page.dashboard,
    alignSelf: 'center' as const,
    width: '100%' as const,
    paddingHorizontal: Layout.gutter,
    paddingTop: Layout.groupGap,
    paddingBottom: Layout.sectionGap,
  },
  workspaceDesktop: { gap: 12 },
  quickActionsDesktop: { paddingHorizontal: 0, marginTop: 0 },
  quickActionBtnDesktop: { minHeight: Layout.tile.action.minHeight, paddingVertical: 0 },
  // The section index: a column per group, 28 px header and rows, no padding
  // (the tallest group — 9 rows — is 280 px, the one-screen budget).
  indexColDesktop: { gap: 0 },
  indexHeadDesktop: { height: 28, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 6 },
  indexRowsDesktop: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  indexRowDesktop: { height: 28, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 6, borderRadius: Tokens.radius.sm },
  indexHeadLabel: { flexShrink: 1, fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  indexRowLabel: { flexShrink: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  indexRowTrail: { marginLeft: 'auto' as const, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, flexShrink: 1, minWidth: 0 },
  indexCount: { marginLeft: 'auto' as const, fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, fontVariant: ['tabular-nums' as const] },
  indexRowNote: { maxWidth: 120, fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
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
  // Unreachable since wave 6c (the phone grid only renders when !isDesktop;
  // desktop draws the section index). Kept, with its `layout.isDesktop &&`
  // use, so the phone's style array stays byte-identical to the golden
  // snapshot (__tests__/smoke/project-workspace-desktop.test.tsx).
  tileGroupBodyDesktop: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  // The hub.tile.* tutorial wrapper in the desktop section index (row-only,
  // so the row-wrap list stretches it as it would the row itself).
  tileTargetDesktop: { flexDirection: 'row' as const },
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

  // ── Estimate revisions ──
  revSaveBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginTop: 10, paddingVertical: 12, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accent + '10', borderWidth: 1, borderColor: themeColors.accent + '25' },
  revSaveBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  revSection: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.card, marginTop: 12, borderWidth: 1, borderColor: themeColors.line, padding: 14, gap: 2 },
  revSectionTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginBottom: 6 },
  revEmptyText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, paddingVertical: 4, lineHeight: 18 },
  revRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: themeColors.line },
  revRowLeft: { flex: 1, gap: 2 },
  revRowTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  revRowMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  revRowTotal: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  revDetailHero: { alignItems: 'center' as const, paddingVertical: 20, paddingHorizontal: 20, gap: 4 },
  revDetailHeroLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  revDetailHeroValue: { fontSize: 36, fontWeight: '800' as const, color: themeColors.text, letterSpacing: -1 },
  revDetailHeroMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  revDetailNote: { fontSize: Type.footnote.fontSize, color: themeColors.text, fontStyle: 'italic' as const, marginTop: 4, textAlign: 'center' as const },
  revDetailTabRow: { flexDirection: 'row' as const, marginHorizontal: 20, marginBottom: 12, backgroundColor: themeColors.line, borderRadius: Tokens.radius.card, padding: 3 },
  revDetailTab: { flex: 1, paddingVertical: 8, alignItems: 'center' as const, borderRadius: Tokens.radius.md },
  revDetailTabActive: { backgroundColor: themeColors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  revDetailTabText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  revDetailTabTextActive: { color: themeColors.text },
  revRestoreBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accentFill },
  revRestoreBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
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
