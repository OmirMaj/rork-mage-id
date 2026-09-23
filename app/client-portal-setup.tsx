import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput, Platform, Share,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  Globe, Copy, Send, Trash2, Eye, EyeOff, CheckCircle2,
  CalendarDays, DollarSign, Image, FileText, ClipboardList,
  MessageSquare, BarChart3, Users, ChevronLeft, Plus, Link, Clock, Lock,
  Mail, RefreshCw, Check, X, HandCoins, Sunrise, Briefcase, AlertTriangle,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import { TIME_ENTRIES_MIRROR_QUERY_KEY } from '@/hooks/useTimeEntries';
import type { JobCostActualSources } from '@/utils/jobCostEngine';
import type { ClientPortalSettings, ClientPortalInvite } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { sendEmailNative, sendEmail, buildPortalInviteEmailHtml } from '@/utils/emailService';
import { copyToClipboard } from '@/utils/clipboard';
import { SendPortalLinkModal } from '@/components/SendPortalLinkModal';
import { wrapEmailHtml, emailQuote, escapeHtml } from '@/utils/emailLayout';
import {
  buildPortalSnapshot, buildPortalUrl, buildShortPortalUrl, estimateSnapshotSizeKb,
  maskPortalLinkToken, PORTAL_BASE_URL, proposalBlockReason,
  buildPortalDocuments, closeoutIsShared,
  PORTAL_PROPOSAL_ACCEPTANCE_LIVE, PROPOSAL_ACCEPTANCE_OFF_REASON,
} from '@/utils/portalSnapshot';
import { PENDING_CO_STATUSES } from '@/utils/portalOwnerCore';
import { loadBakedPassport } from '@/utils/passport/passportStore';
import type { BakedHomePassport } from '@/utils/passport/types';
import { usePortalBudgetProposals } from '@/hooks/usePortalBudgetProposals';
import { usePortalThread } from '@/hooks/usePortalThread';
import { formatMoney } from '@/utils/formatters';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadActiveContract } from '@/utils/contractEngine';
import { defaultPortalLiteSyncIO, portalSettingsDiffer, isPortalOwner } from '@/utils/portalLiteSync';
import { LANGUAGES } from '@/utils/portalLanguages';
import {
  linkState, expiresAtFromDuration, expiresAtForPolicy, durationLabel, isHandedOver,
  PORTAL_LINK_DURATION_OPTIONS, DEFAULT_PORTAL_LINK_DURATION_DAYS, HANDOVER_GRACE_DAYS,
} from '@/utils/portalLinkExpiry';
import type { PortalLinkStateKind, PortalLinkDuration } from '@/utils/portalLinkExpiry';
import { useAuth } from '@/contexts/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { Button } from '@/components/ui';
import { nailIt } from '@/components/animations/NailItToast';
import ClientDocumentAskSheet from '@/components/ClientDocumentAskSheet';
import { useClientDocumentGate } from '@/hooks/useClientDocumentGate';
import { toClientEstimateView } from '@/utils/clientEstimateView';
import { fetchProposalAcceptanceState } from '@/utils/proposalAcceptances';
import {
  acceptanceStateFromRead, isValidStamp, nextProposalStamp, proposalTermsState, splitLabel,
  type AcceptanceState,
} from '@/utils/paymentTerms';

// The GC's last link-duration pick, remembered across PROJECTS. A GC who
// always gives clients 90 days should not re-pick it on every new job, and the
// per-project value alone can't carry that. Device-scoped preference, so it is
// correct for the tenant sweep to wipe it on sign-out (next tenant gets the
// default, until handover).
const LINK_DURATION_PREF_KEY = 'mageid_portal_link_duration_days';
/** Sentinel for "Until handover" — AsyncStorage only stores strings. */
const UNTIL_HANDOVER_PREF = 'until_handover';
/**
 * What "No expiry" was stored as before 2026-09-16. That option is retired and
 * its meaning (a link that outlives a long job) is now until-handover, so a
 * stored 'none' reads as until-handover and is rewritten once to the new
 * sentinel — nobody's remembered choice silently falls back to a fixed clock.
 */
const LEGACY_NO_EXPIRY_PREF = 'none';

/**
 * Who this account is to the project, for the purpose of the share link.
 * 'unknown' is a cache that predates `ownerUserId` (or no session yet) — the
 * heal confirms against the server before it reads any credential.
 */
type PortalOwnership = 'owner' | 'collaborator' | 'unknown';
function portalOwnershipOf(ownerUserId: string | undefined, userId: string | null): PortalOwnership {
  if (!ownerUserId || !userId) return 'unknown';
  return ownerUserId === userId ? 'owner' : 'collaborator';
}

/**
 * The token the SERVER holds for this project's portal, or null when it has
 * none. `ok: false` means the read itself failed (offline, RLS refused) — a
 * different state from "none", and never a reason to write anything.
 *
 * Only ever called for a project this account owns: the server row carries the
 * homeowner's credential, and a collaborator's copy is stripped on purpose
 * (AUTH-F5). The token is never logged.
 */
async function readServerPortalToken(
  projectId: string,
): Promise<{ ok: true; token: string | null } | { ok: false }> {
  // Through the owner-only getter (20260923170000, #82): the key now lives in
  // portal_credentials, which no client can SELECT, and the projects row's
  // mirror is stripped once the held migration lands — so a direct
  // direct read of the row's client_portal column would go blind then.
  const { data, error } = await supabase.rpc('portal_get_owner_token', { p_project_id: projectId });
  if (error) {
    // 42501 is the getter's refusal: no row this account owns. The caller has
    // already confirmed ownership (locally or from user_id), so here it means
    // the job's insert hasn't reached the server yet — the same "none" the
    // old row read returned for a missing row. Anything else is a failed read.
    if ((error as { code?: string }).code === '42501') return { ok: true, token: null };
    return { ok: false };
  }
  return { ok: true, token: typeof data === 'string' && data.length > 0 ? data : null };
}

/**
 * How long to wait between read-backs after the empty-token write. The write
 * rides the offline queue, so the trigger's token lands whenever the queue
 * flushes — a few spaced reads cover a normal connection without hammering a
 * bad one; past the last one the GC gets a Retry, not an endless spinner.
 */
const TOKEN_READBACK_DELAYS_MS = [1500, 4000, 10000, 20000];
// Supabase URL + anon key are public — fine to bake into the static portal
// page so it can POST a budget proposal back to the GC. RLS gates access.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://nteoqhcswappxxjlpvap.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';

interface PermissionToggle {
  key: keyof ClientPortalSettings;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const PERMISSION_TOGGLES: PermissionToggle[] = [
  {
    key: 'showSchedule',
    label: 'Project Schedule',
    description: 'Gantt chart & task progress',
    icon: <CalendarDays size={18} color={"#1565C0"} strokeWidth={1.75} />,
  },
  {
    key: 'showBudgetSummary',
    label: 'Budget Summary',
    description: 'Overall spend vs. contract value',
    icon: <BarChart3 size={18} color={"#2E7D44"} strokeWidth={1.75} />,
  },
  {
    key: 'showInvoices',
    label: 'Invoices',
    description: 'Invoice history & payment status',
    icon: <DollarSign size={18} color={Colors.warningLabel} strokeWidth={1.75} />,
  },
  {
    key: 'showChangeOrders',
    label: 'Change Orders',
    description: 'Approved & pending change orders',
    icon: <FileText size={18} color={"#C84038"} strokeWidth={1.75} />,
  },
  {
    key: 'showPhotos',
    label: 'Site Photos',
    description: 'Progress photos from the field',
    icon: <Image size={18} color={Colors.purple} strokeWidth={1.75} />,
  },
  {
    key: 'showDailyReports',
    label: 'Daily Reports',
    description: 'Weather, crew, and work summaries',
    icon: <ClipboardList size={18} color="#32ADE6" strokeWidth={1.75} />,
  },
  {
    key: 'showPunchList',
    label: 'Punch List',
    description: 'Open items & completion status',
    icon: <CheckCircle2 size={18} color={"#2E7D44"} strokeWidth={1.75} />,
  },
  {
    key: 'showRFIs',
    label: 'RFIs',
    description: 'Requests for information',
    icon: <MessageSquare size={18} color={Colors.warningLabel} strokeWidth={1.75} />,
  },
  {
    key: 'showDocuments',
    // WAS "Contracts, lien waivers, permits" — over a section that shipped a
    // literal empty array, so the switch made nothing appear. Two of the three
    // nouns were wrong even once it was wired: the contract has its own portal
    // section (turning this on would print it twice), and nothing in this app
    // stores a lien waiver a homeowner could be shown. What this switch
    // actually publishes is the permit record and any warranty already sent to
    // the portal — records, not downloadable files, which is why the
    // description says "on record".
    label: 'Documents',
    description: 'Permits and sent warranties, on record (no file attached)',
    icon: <FileText size={18} color="#8E8E93" strokeWidth={1.75} />,
  },
];

/** One signed proposal decision, as `proposal_approvals` stores it. */
interface ProposalApprovalRow {
  id: string;
  proposal_id: string;
  decision: 'accepted' | 'declined';
  signer_name: string | null;
  note: string | null;
  proposal_total: number | null;
  document_hash: string | null;
  created_at: string;
}

const DEFAULT_PORTAL: ClientPortalSettings = {
  enabled: true,
  portalId: '',
  showSchedule: true,
  showBudgetSummary: false,
  showInvoices: true,
  showChangeOrders: true,
  showPhotos: true,
  showDailyReports: false,
  showPunchList: false,
  showRFIs: false,
  showDocuments: false,
  welcomeMessage: '',
  invites: [],
  // Off by default — only relevant for the small fraction of projects
  // where the GC is collecting an early budget input from the owner.
  clientCanSetBudget: false,
  // Off by default; turn on per project to invite owners to approve COs
  // from the portal.
  coApprovalEnabled: false,
  // Off by default. Turning it on puts a signable price in front of the
  // homeowner, which is not something a section-visibility toggle should do
  // by accident. Needs a priced estimate; the row below says so when there
  // isn't one rather than offering a switch that does nothing.
  proposalApprovalEnabled: false,
  // Defaults to English. GC picks the homeowner's language in the
  // setup screen — drives AI summary language + portal UI strings.
  homeownerLanguage: 'en',
};

export default function ClientPortalSetupScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  // Tier gate. Pre-fix this screen had ZERO access check — a free user
  // could fully configure a passcode-protected portal and dispatch weekly
  // homeowner emails (which cost real Resend $). The `client_portal`
  // FeatureKey was declared in useTierAccess.ts with REQUIRED_TIER='pro'
  // but never referenced anywhere in the codebase. Now wired here.
  if (!canAccess('client_portal')) {
    return (
      <Paywall
        visible={true}
        feature="Client Portal"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <ClientPortalSetupScreenInner />;
}

function ClientPortalSetupScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { id: paramId } = useLocalSearchParams<{ id: string }>();
  const {
    projects, getProject, updateProject,
    settings,
    getInvoicesForProject, getChangeOrdersForProject,
    getDailyReportsForProject, getPunchItemsForProject,
    getPhotosForProject, getRFIsForProject,
    getAIAPayAppsForProject,
    getCommitmentsForProject, getWarrantiesForProject, getPermitsForProject,
    equipment, permits, subcontractors,
    portalListsServerRead, settingsLoaded, requestPortalPublish,
  } = useProjects();
  // #16: the persist timer below re-reads these when it FIRES. The provider
  // drops portalListsServerRead the moment the app returns to the foreground
  // (the lists are re-reading), so a pass armed before that must not publish.
  const publishGateRef = useRef({ portalListsServerRead, settingsLoaded });
  publishGateRef.current = { portalListsServerRead, settingsLoaded };
  // The actual-cost streams the open-book / GMP block discloses. Without them
  // an open-book client is shown a cost-to-date built from subcontracts alone
  // (audit round 2, #16).
  const { receipts, isLoading: receiptsLoading } = useMaterialReceipts();
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier, overtimeRule, isLoading: ratesLoading } = useLaborRates();
  const costSources = useMemo<JobCostActualSources>(() => ({
    receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits, subcontractors,
  }), [receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits, subcontractors]);
  // Those stores read [] / {} until AsyncStorage answers. The snapshot below
  // auto-publishes to portal_snapshots, and for a GMP / open-book job it
  // discloses cost-to-date — so a push in that beat would hand the homeowner
  // a subcontract-only number, and project-detail's lite writer would carry
  // that block forward after the GC left. Same readiness rule ProjectHero and
  // margin-alerts use; the mirror hook has no loading flag, so read its cache.
  const queryClient = useQueryClient();
  const mirrorLoaded = queryClient.getQueryState(TIME_ENTRIES_MIRROR_QUERY_KEY)?.data !== undefined;
  const costSourcesReady = !receiptsLoading && !ratesLoading && mirrorLoaded;
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Reached from the sidebar, universal search or a deep link there is no
  // project id, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const id = pickedProjectId ?? paramId ?? '';

  const project = useMemo(() => getProject(id ?? ''), [id, getProject]);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramId ? paramId : undefined;
  const proposalQ = usePortalBudgetProposals(id);
  // Pass BOTH projectId + portalId so the messages query can filter by
  // portal_id (the only column both sides actually populate) while
  // approvals still filter by project_id.
  const threadQ = usePortalThread({ projectId: id, portalId: project?.clientPortal?.portalId });
  const unreadFromClient = threadQ.unreadFromClient.length;
  // Recent messages preview — both directions, sourced from Supabase via
  // usePortalThread (the same source the dedicated thread screen uses).
  // Take the last 3 from the time-sorted list.
  const recentMessages = useMemo(
    () => threadQ.messages.slice(-3),
    [threadQ.messages],
  );

  // Pull contract / selections / closeout binder for the snapshot.
  // These are async fetches against Supabase so we wrap them in
  // useQuery — when they resolve the snapshot rebuilds and the URL
  // updates so the homeowner sees fresh data on the next portal load.
  //
  // #122: each read REPORTS failure (throws → the query errors and retries)
  // instead of resolving to "none". fetchActiveContract / fetchSelections /
  // fetchCloseoutBinder all turned a PostgREST error into null / [], so one
  // flaky read published a portal with the contract waiting for signature
  // gone and the proposal back. The persist effect below publishes only once
  // all three have SUCCEEDED.
  const contractQ = useQuery({
    queryKey: ['portal-contract', id],
    queryFn: async () => {
      if (!id) return null;
      const r = await loadActiveContract(id);
      if (!r.ok) throw new Error(r.error);
      return r.contract;
    },
    enabled: !!id,
  });
  const selectionsQ = useQuery({
    queryKey: ['portal-selections', id],
    queryFn: async () => {
      const io = id ? defaultPortalLiteSyncIO() : null;
      if (!id || !io) return [];
      const r = await io.loadSelections(id);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    },
    enabled: !!id,
  });
  const closeoutQ = useQuery({
    queryKey: ['portal-closeout', id],
    queryFn: async () => {
      const io = id ? defaultPortalLiteSyncIO() : null;
      if (!id || !io) return null;
      const r = await io.loadCloseoutBinder(id);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    },
    enabled: !!id,
  });
  const richReadsReady = contractQ.isSuccess && selectionsQ.isSuccess && closeoutQ.isSuccess;

  // Signed proposal decisions the homeowner made from the portal. The
  // acceptance RPC (supabase/migrations/held/…_portal_proposal_acceptance.sql)
  // is the only writer; RLS scopes the read to the project's owner. The table
  // does not exist until that migration is applied, so a MISSING TABLE
  // resolves to an empty list — the section simply shows nothing yet, which is
  // the truth. Any OTHER error throws: this list also decides whether the
  // proposal's payment terms may still be replaced, and "the read failed"
  // turned into "nobody accepted" is how signed text would get rewritten
  // (utils/paymentTerms.acceptanceStateFromRead).
  const acceptancesQ = useQuery({
    queryKey: ['portal-proposal-approvals', id],
    enabled: !!id && isSupabaseConfigured,
    queryFn: async (): Promise<ProposalApprovalRow[]> => {
      const { data, error } = await supabase
        .from('proposal_approvals')
        .select('id, proposal_id, decision, signer_name, note, proposal_total, document_hash, created_at')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) {
        if (acceptanceStateFromRead({ data, error }) === 'none') return [];
        throw error;
      }
      return (data ?? []) as ProposalApprovalRow[];
    },
  });
  const acceptances = acceptancesQ.data ?? [];
  // For the terms row only. A failed read is 'unknown', which blocks replacing
  // the stamp; the replace handler still re-reads fresh before it writes.
  const acceptanceForTerms: AcceptanceState = acceptancesQ.isError
    ? 'unknown'
    : acceptances.some(a => a.decision === 'accepted') ? 'accepted' : 'none';

  // The proposal toggle needs something to propose — and the switch and the
  // builder have to agree on what "something" means. They ask the SAME
  // function (proposalBlockReason), so the switch can no longer turn on for a
  // project whose proposal buildPortalProposal then silently refuses to emit.
  //
  // That happened three ways before 2026-09-13, all measured: a project with a
  // contract already SENT (switch on, portal empty, no explanation anywhere);
  // an estimate whose lines carry no CSI division, which is what BOTH of the
  // app's own estimate builders produce, so the whole price rolled up to one
  // unlabelled "Other scope" line; and a finished job, which offered "accept
  // to get started" next to "your build is finished".
  const proposalBlock = project
    ? proposalBlockReason(project, contractQ.data ?? undefined)
    : { code: 'no-estimate' as const, gc: 'Needs a priced estimate on this project — build one and this turns on.' };
  const canProposeToClient = !proposalBlock;

  const [portal, setPortal] = useState<ClientPortalSettings>(() => {
    if (project?.clientPortal?.enabled) {
      return {
        ...DEFAULT_PORTAL,
        ...project.clientPortal,
        invites: project.clientPortal.invites ?? [],
      };
    }
    return {
      ...DEFAULT_PORTAL,
      portalId: `portal-${(id ?? '').slice(0, 8)}-${Date.now().toString(36)}`,
    };
  });

  // ─── The proposal's payment terms (Direction B, "ask when it matters") ────
  //
  // The portal proposal prints ONLY this portal's stamp
  // (portal.proposalPaymentTerms, see utils/portalSnapshot.buildPortalProposal),
  // a copy of the GC's saved terms taken when he switches the proposal on,
  // confirms it, or uses his current terms. Two rules make that a freeze and
  // not a race:
  //   · EVERY handler that sets the flag or the stamp also SAVES it, merging
  //     only those two keys onto the saved portal. The lite snapshot push
  //     app/project-detail.tsx runs on every project open rebuilds the
  //     proposal from the SAVED project — a stamp that lived only in this
  //     screen's state would publish once here and vanish on the next open.
  //   · Replacing a stamp awaits a FRESH acceptance read in the handler. The
  //     cached list above can be stale by the time he taps.
  const localOwnership = portalOwnershipOf(project?.ownerUserId, userId);
  // Filled in by the heal when the local cache cannot say (no ownerUserId).
  const [confirmedOwnership, setConfirmedOwnership] = useState<PortalOwnership>('unknown');
  const ownership: PortalOwnership = localOwnership !== 'unknown' ? localOwnership : confirmedOwnership;
  const isCollaborator = ownership === 'collaborator';
  // #19: only the OWNER changes what the client sees. A collaborator's sync
  // PATCH never carries client_portal (AUTH-F5), so an editor's "Saved" was
  // stored nowhere and published by no one. Ownership still unknown = Save
  // held until it is confirmed, never a "Saved" that did nothing.
  // A cache predating ownerUserId is decided by the lite writer's own rule
  // (isPortalOwner: owned exactly when it carries no collaborator role), so
  // "unknown" means only "no session yet" — not a Save that never unlocks.
  const isOwner = ownership === 'owner'
    || (ownership === 'unknown' && !!project && isPortalOwner(project, userId));
  const ownerOnlyReason = isCollaborator
    ? 'Only the project owner can change what the client sees on the portal.'
    : !isOwner ? 'Checking who owns this project — Save is available once that is confirmed.' : null;

  const gate = useClientDocumentGate();
  const proposalTotal = useMemo(() => {
    const est = project?.linkedEstimate;
    return est ? toClientEstimateView(est).projectTotal : null;
  }, [project?.linkedEstimate]);

  /** Save the proposal keys onto the SAVED portal, in the same press. A portal
   *  that was never saved has no access token yet (the DB trigger mints it on
   *  save), so no homeowner can open it; its Save persists the local state. */
  const persistProposalKeys = useCallback((keys: Partial<Pick<ClientPortalSettings, 'proposalApprovalEnabled' | 'proposalPaymentTerms'>>) => {
    if (!id || !project?.clientPortal?.enabled) return;
    updateProject(id, { clientPortal: { ...project.clientPortal, ...keys } });
  }, [id, project?.clientPortal, updateProject]);

  // A stamp written elsewhere (the first "Use on every job" confirms every
  // portal waiting on terms; the project-detail row) lands on the saved
  // project while this screen holds its own copy. Adopt it, or the next Save
  // here would write the portal back without it.
  const savedStamp = project?.clientPortal?.proposalPaymentTerms;
  useEffect(() => {
    if (!isValidStamp(savedStamp)) return;
    setPortal(p => (isValidStamp(p.proposalPaymentTerms) ? p : { ...p, proposalPaymentTerms: savedStamp }));
  }, [savedStamp]);

  const handleProposalSwitch = useCallback((val: boolean) => {
    // #19: only the owner changes what the client sees (said at the top).
    if (ownerOnlyReason) { showAlert('Not changed', ownerOnlyReason); return; }
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (!val) {
      // Off keeps the stamp: switching back on must print what the client
      // was already shown, not whatever the terms are by then.
      setPortal(p => ({ ...p, proposalApprovalEnabled: false }));
      persistProposalKeys({ proposalApprovalEnabled: false });
      return;
    }
    // #29: the switch is disabled while acceptance is not live; this is the
    // belt for any path that reaches the handler anyway.
    if (!PORTAL_PROPOSAL_ACCEPTANCE_LIVE) return;
    const existing = portal.proposalPaymentTerms;
    // A stamp answers the question; otherwise his saved terms do; otherwise
    // the sheet asks. Dismissing it leaves the switch off.
    gate.run(
      { terms: true, record: isValidStamp(existing) ? existing : null, purpose: 'portal_proposal', total: proposalTotal, projectType: project?.type ?? null },
      (a) => {
        // A stamp exists → kept (same split). No stamp → a FIRST stamp, which
        // needs no acceptance read: a proposal without terms can't be accepted.
        const next = nextProposalStamp({ existing, split: a.split, acceptance: 'none', nowIso: new Date().toISOString() });
        if ('refused' in next) { showAlert('Payment terms', next.refused); return; }
        setPortal(p => ({ ...p, proposalApprovalEnabled: true, proposalPaymentTerms: next.stamp }));
        persistProposalKeys({ proposalApprovalEnabled: true, proposalPaymentTerms: next.stamp });
      },
    );
  }, [portal.proposalPaymentTerms, gate, proposalTotal, project?.type, persistProposalKeys, ownerOnlyReason]);

  const [replacingTerms, setReplacingTerms] = useState(false);
  /** "Use 30 / 60 / 10 on this proposal" — replace the stamp with his current
   *  terms, only after a fresh read proves the client has not accepted. */
  const handleUseCurrentTerms = useCallback(async () => {
    const split = settings.paymentSplit;
    if (!id || !split) return;
    setReplacingTerms(true);
    try {
      const acceptance = await fetchProposalAcceptanceState(id);
      const next = nextProposalStamp({ existing: portal.proposalPaymentTerms, split, acceptance, nowIso: new Date().toISOString() });
      if ('refused' in next) {
        showAlert('Terms not changed', next.refused);
        void acceptancesQ.refetch();
        return;
      }
      setPortal(p => ({ ...p, proposalPaymentTerms: next.stamp }));
      persistProposalKeys({ proposalPaymentTerms: next.stamp });
      nailIt(`This proposal now prints ${splitLabel(next.stamp)} — your client must reload to accept`);
    } finally {
      setReplacingTerms(false);
    }
  }, [id, settings.paymentSplit, portal.proposalPaymentTerms, acceptancesQ, persistProposalKeys]);

  /** A proposal published without terms (before Direction B, or switched on
   *  elsewhere): one tap when his terms are saved, the deposit step when not. */
  const confirmTerms = useCallback(() => {
    gate.run(
      { terms: true, purpose: 'portal_proposal', total: proposalTotal, projectType: project?.type ?? null },
      (a) => {
        const next = nextProposalStamp({ existing: portal.proposalPaymentTerms, split: a.split, acceptance: 'none', nowIso: new Date().toISOString() });
        if ('refused' in next) { showAlert('Payment terms', next.refused); return; }
        setPortal(p => ({ ...p, proposalPaymentTerms: next.stamp }));
        persistProposalKeys({ proposalPaymentTerms: next.stamp });
      },
    );
  }, [gate, proposalTotal, project?.type, portal.proposalPaymentTerms, persistProposalKeys]);

  const termsState = proposalTermsState({ portal, profileSplit: settings.paymentSplit, acceptance: acceptanceForTerms });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // How long the NEXT generated link stays open. Distinct from
  // portal.linkExpiresAt, which describes the link that already exists — the
  // GC can be looking at an until-handover link while the picker sits on 30.
  // `null` is a real choice (until handover, and the default), so `??` (not
  // `||`) preserves it.
  const [durationChoice, setDurationChoice] = useState<PortalLinkDuration>(
    portal.linkDurationDays ?? DEFAULT_PORTAL_LINK_DURATION_DAYS,
  );
  // A tap must outrank the async preference load, which can land after the
  // GC has already picked something.
  const durationTouchedRef = useRef(false);
  useEffect(() => {
    if (durationTouchedRef.current) return;
    // This project's own choice is the more specific answer, and it can land
    // after mount (the `portal` state above is lazy-initialised once, so a
    // project that hydrates late would otherwise be stuck on the default).
    const persisted = project?.clientPortal?.linkDurationDays;
    if (persisted !== undefined) { setDurationChoice(persisted); return; }
    let cancelled = false;
    void AsyncStorage.getItem(LINK_DURATION_PREF_KEY)
      .then(raw => {
        if (cancelled || raw === null || durationTouchedRef.current) return;
        if (raw === UNTIL_HANDOVER_PREF) { setDurationChoice(null); return; }
        if (raw === LEGACY_NO_EXPIRY_PREF) {
          // Migrate once: the retired "No expiry" pick is until-handover now.
          setDurationChoice(null);
          void AsyncStorage.setItem(LINK_DURATION_PREF_KEY, UNTIL_HANDOVER_PREF).catch(() => {});
          return;
        }
        // Only a duration the picker still offers — a stale number would leave
        // no chip selected, which reads as "nothing chosen".
        const parsed = Number(raw);
        if (PORTAL_LINK_DURATION_OPTIONS.includes(parsed)) setDurationChoice(parsed);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [project?.clientPortal?.linkDurationDays]);

  // Deliberately NOT memoized on a captured `now`: a memo would freeze the
  // clock for as long as the screen stays mounted, so a link that lapses while
  // the GC has the app open would keep reading "expires in 1 day". Recomputing
  // per render is a handful of arithmetic ops.
  //
  // The date shown is the one the policy resolves to, not just the stored one:
  // an until-handover link on a closed-out job closes HANDOVER_GRACE_DAYS after
  // closeout even if this device never stored that date. Same resolver as the
  // snapshot push below, so the label and the database agree.
  const untilHandover = portal.linkDurationDays == null;
  const resolvedExpiresAt = expiresAtForPolicy({
    linkDurationDays: portal.linkDurationDays,
    linkExpiresAt: portal.linkExpiresAt,
    projectStatus: project?.status,
    closedAt: project?.closedAt,
  });
  const linkExpiry = linkState(resolvedExpiresAt, Date.now(), { untilHandover });
  // A closed-out job's until-handover link cannot be revived by regenerating
  // another until-handover link — the policy resolves to the same closing
  // date. The expired copy has to say so instead of promising a fix.
  const handoverClosed = untilHandover && isHandedOver(project?.status);
  // Badge + status colours per state. The pill here used to read "Active" in
  // green unconditionally, which is exactly the lie this track exists to fix.
  const linkTone: Record<PortalLinkStateKind, { badge: string; ink: string; short: string }> = {
    never:         { badge: themeColors.neutralSoft, ink: themeColors.textSecondary, short: 'Open' },
    active:        { badge: themeColors.successSoft, ink: themeColors.successLabel,  short: 'Active' },
    expiring_soon: { badge: themeColors.warningSoft, ink: themeColors.warningLabel,  short: 'Expiring' },
    expired:       { badge: themeColors.dangerSoft,  ink: themeColors.dangerLabel,   short: 'Expired' },
  };
  const tone = linkTone[linkExpiry.kind];

  // Baked Home Passport (FAQ + counts) — generated from the closeout-binder
  // screen, persisted in AsyncStorage, baked into snapshot v9 here.
  const [homePassport, setHomePassport] = useState<BakedHomePassport | null>(null);
  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    void loadBakedPassport(project.id).then(hp => { if (!cancelled) setHomePassport(hp); });
    return () => { cancelled = true; };
  }, [project?.id]);

  // ── What the Documents switch will actually publish, for THIS project.
  //
  // The section shipped a literal `[]` for its whole life, so the switch made
  // nothing appear and said nothing about it. Now that it ships real records,
  // the remaining silent case is a project that simply has none — no permits
  // logged, no warranty pushed to the portal. The GC should learn that from
  // the switch, not from their client asking where the permit went.
  const documentsSummary = useMemo(() => {
    if (!project) return null;
    const docs = buildPortalDocuments({
      projectId: project.id,
      permits: getPermitsForProject(project.id),
      warranties: getWarrantiesForProject(project.id),
      closeoutShared: closeoutIsShared(closeoutQ.data),
    });
    if (!docs.length) {
      return 'Nothing to publish yet — no permits logged on this project, and no warranty sent to the portal.';
    }
    return `${docs.length} record${docs.length === 1 ? '' : 's'} will appear on your client’s page.`;
  }, [project, getPermitsForProject, getWarrantiesForProject, closeoutQ.data]);

  // ── Change orders sitting in the client's court.
  //
  // Counted with the SAME status set the portal's "Waiting on you" list uses
  // (PENDING_CO_STATUSES) and the same shared-to-portal test the snapshot uses,
  // so this number can never contradict the page the homeowner is reading.
  const pendingClientCOCount = useMemo(() => {
    if (!project) return 0;
    return getChangeOrdersForProject(project.id).filter(c =>
      PENDING_CO_STATUSES.has(String(c.status ?? '').toLowerCase())
      // isShared(): a missing portalState is grandfathered as shared; only an
      // explicit non-'sent' state (draft, recalled) hides the CO.
      && (c.portalState == null || c.portalState.status === 'sent'),
    ).length;
  }, [project, getChangeOrdersForProject]);

  // Build a fresh snapshot every render so toggle changes / new data flow through
  // immediately. Snapshot is built only from sections the GC has toggled on,
  // then base64url-encoded into the URL's hash fragment (never sent to server).
  const buildSnapshotFor = useCallback((forPortal: ClientPortalSettings) => {
    if (!project) return null;
    return buildPortalSnapshot({
      project,
      portal: forPortal,
      settings,
      invoices: getInvoicesForProject(project.id),
      changeOrders: getChangeOrdersForProject(project.id),
      dailyReports: getDailyReportsForProject(project.id),
      punchItems: getPunchItemsForProject(project.id),
      photos: getPhotosForProject(project.id),
      rfis: getRFIsForProject(project.id),
      aiaPayApps: getAIAPayAppsForProject(project.id),
      messages: threadQ.messages.map(m => ({
        id: m.id,
        authorType: m.authorType,
        authorName: m.authorName,
        body: m.body,
        createdAt: m.createdAt,
      })),
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      contactEmail: settings?.branding?.email,
      contactName: settings?.branding?.contactName ?? settings?.branding?.companyName,
      contract: contractQ.data ?? undefined,
      selections: selectionsQ.data ?? undefined,
      closeoutBinder: closeoutQ.data ?? undefined,
      commitments: getCommitmentsForProject(project.id),
      warranties: getWarrantiesForProject(project.id),
      // Permits feed the Documents section. Before this the section shipped a
      // literal empty array, so the switch below made nothing appear at all.
      permits: getPermitsForProject(project.id),
      homePassport,
      costSources,
    });
  }, [
    project, settings,
    getInvoicesForProject, getChangeOrdersForProject,
    getDailyReportsForProject, getPunchItemsForProject,
    getPhotosForProject, getRFIsForProject,
    getAIAPayAppsForProject, threadQ.messages,
    contractQ.data, selectionsQ.data, closeoutQ.data,
    getCommitmentsForProject, getWarrantiesForProject, getPermitsForProject,
    homePassport, costSources,
  ]);
  // On-screen PREVIEW only: the local, unsaved switches (#18).
  const snapshot = useMemo(() => buildSnapshotFor(portal), [buildSnapshotFor, portal]);
  // #18: what the HOMEOWNER gets — the published row and every hash / invite
  // link — is built from the SAVED portal settings. A switch flipped "just to
  // look" changed the live page 1.5 s later and stayed changed after he backed
  // out; a "Require passcode" turned on without saving (so without the >= 4
  // character check handleSave runs) put up a gate no saved code could open.
  // The access token and portal id come from local state only because the
  // heal adopts the server's token there; everything else is the saved row.
  const savedPortal = project?.clientPortal;
  const publishPortal = useMemo<ClientPortalSettings | null>(() => {
    if (!savedPortal?.enabled) return null;
    // The token: the saved row's, else the one local state READ BACK from the
    // server (the heal and the adopt effect above — this screen never makes
    // one). Copied by key so no token value is ever written by hand here
    // (scripts/validate-portal-token-heal.ts).
    const readBackToken = savedPortal.accessToken
      ? {}
      : Object.fromEntries(Object.entries(portal).filter(([k, v]) => k === 'accessToken' && !!v));
    return {
      ...DEFAULT_PORTAL,
      ...readBackToken,
      ...savedPortal,
      invites: savedPortal.invites ?? [],
      portalId: savedPortal.portalId || portal.portalId,
    };
    // Keyed on the token alone: the switches must not rebuild the published
    // snapshot (that is the whole point of #18).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPortal, portal.portalId, portal.accessToken]);
  const publishedSnapshot = useMemo(
    () => (publishPortal ? buildSnapshotFor(publishPortal) : null),
    [buildSnapshotFor, publishPortal],
  );
  // #18: are the switches on screen different from what is saved (= live)?
  // Drives the "Unsaved changes" line and the leave-without-saving prompt.
  const hasUnsavedPortalChanges = useMemo(
    () => portalSettingsDiffer(portal, savedPortal),
    [portal, savedPortal],
  );
  // #18: leaving with unsaved switches asks first — they never reached the
  // client, and without this he got no sign they were thrown away.
  const navigation = useNavigation();
  const allowLeaveRef = useRef(false);
  const unsavedPortalRef = useRef(false);
  unsavedPortalRef.current = hasUnsavedPortalChanges;
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (allowLeaveRef.current || !unsavedPortalRef.current) return;
    e.preventDefault();
    showAlert(
      'Discard portal changes?',
      "Your changes aren't saved, so your client's page hasn't changed. Leave without saving?",
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { allowLeaveRef.current = true; navigation.dispatch(e.data.action); } },
      ],
    );
  }), [navigation]);

  // Short, share-friendly URL — `mageid.app/portal/<id>`. The static
  // portal HTML fetches the snapshot from `portal_snapshots` keyed by
  // the path id when no hash is present. This is what the GC copies
  // and shares — fits in SMS, doesn't get truncated, always works.
  const portalLink = useMemo(() => {
    return buildShortPortalUrl(PORTAL_BASE_URL, portal.portalId, undefined, portal.accessToken);
  }, [portal.portalId, portal.accessToken]);

  // ── The share link's access token: READ it, never make it.
  //
  // The token gates the homeowner's decisions and is a capability secret. A
  // DB trigger (portal_set_access_token) mints one server-side the first time
  // a portal is written with an EMPTY token, and on every later UPDATE with an
  // empty token it keeps the old one. So an empty write is always safe, and a
  // NON-EMPTY write always wins.
  //
  // WHY THIS WAS REWRITTEN (2026-09-16, "the links always expire"). The old
  // heal minted a token on the client whenever the local portal was enabled
  // without one, and wrote it. But local state lacks the token in normal
  // situations — the optimistic write never reads the server's token back, and
  // a collaborator's copy is stripped on purpose (AUTH-F5) — so the heal wrote
  // a fresh non-empty token OVER the real one, and every link the GC had
  // already sent stopped working. Production carried the proof: one portal
  // with a 64-char client-minted token among 48-char trigger tokens.
  //
  // Now, for a project this account OWNS whose persisted portal is enabled but
  // has no token here:
  //   1. read the token back from the server; if it has one, use it locally
  //      and write NOTHING;
  //   2. only if the server truly has none, write the portal with the token
  //      left EMPTY (the trigger mints) and read back until it lands.
  // A collaborator's project is never healed: the owner holds the credential,
  // and the link area says so instead of promising a wait that never ends.
  // Keyed on the PERSISTED portal (not the local `portal`, whose
  // DEFAULT_PORTAL.enabled is true) so a screen visit never enables a portal.
  const persistedToken = project?.clientPortal?.accessToken;
  useEffect(() => {
    // A token the loader already delivered for an owned project is the real
    // one — adopt it when the lazy `portal` initialiser ran before hydration.
    if (!persistedToken || portal.accessToken) return;
    const serverToken = persistedToken;
    setPortal(p => (p.accessToken ? p : { ...p, accessToken: serverToken }));
  }, [persistedToken, portal.accessToken]);

  const [tokenHeal, setTokenHeal] = useState<'idle' | 'working' | 'failed'>('idle');
  // Bumped by Retry; the ref makes one attempt per (project, retry) pair so a
  // re-render mid-flight cannot start a second, overlapping heal.
  const [healAttempt, setHealAttempt] = useState(0);
  const healRunRef = useRef<string | null>(null);
  const persistedPortalEnabled = !!project?.clientPortal?.enabled;
  useEffect(() => {
    if (!id || !persistedPortalEnabled || persistedToken || portal.accessToken) return;
    // Not owned: the credential is stripped for collaborators on purpose. Never
    // read it, never write a portal on the owner's behalf.
    if (localOwnership === 'collaborator') return;
    if (!isSupabaseConfigured || !userId) { setTokenHeal('failed'); return; }
    const runKey = `${id}:${healAttempt}`;
    if (healRunRef.current === runKey) return;
    healRunRef.current = runKey;

    let cancelled = false;
    const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
    setTokenHeal('working');
    void (async () => {
      try {
        // Ownership first, when the cache predates ownerUserId — confirmed from
        // user_id alone, BEFORE anything that carries the credential is read.
        if (localOwnership !== 'owner') {
          const { data, error } = await supabase
            .from('projects').select('user_id').eq('id', id).maybeSingle();
          if (cancelled) return;
          if (error) { setTokenHeal('failed'); return; }
          if (data && data.user_id !== userId) {
            setConfirmedOwnership('collaborator');
            setTokenHeal('idle');
            return;
          }
          setConfirmedOwnership('owner');
        }

        const adopt = (serverToken: string) => {
          setPortal(p => ({ ...p, accessToken: serverToken }));
          setTokenHeal('idle');
        };

        const first = await readServerPortalToken(id);
        if (cancelled) return;
        if (!first.ok) { setTokenHeal('failed'); return; }
        if (first.token) { adopt(first.token); return; }

        // The server truly has none. Write the persisted portal with the token
        // stripped — EMPTY, so the trigger mints one and nothing of ours can
        // ever overwrite a token that exists by the time the write lands.
        const persisted = project?.clientPortal;
        if (!persisted) { setTokenHeal('failed'); return; }
        const { accessToken: _none, ...portalWithoutToken } = persisted;
        updateProject(id, { clientPortal: portalWithoutToken });

        for (const delay of TOKEN_READBACK_DELAYS_MS) {
          await wait(delay);
          if (cancelled) return;
          const back = await readServerPortalToken(id);
          if (cancelled) return;
          if (back.ok && back.token) { adopt(back.token); return; }
        }
        setTokenHeal('failed');
      } catch {
        if (!cancelled) setTokenHeal('failed');
      }
    })();
    return () => {
      cancelled = true;
      // Let the same attempt run again if this one was torn down mid-flight
      // (project switch, unmount-remount) — otherwise it would never finish.
      if (healRunRef.current === runKey) healRunRef.current = null;
    };
    // project?.clientPortal is read inside only for the write; keying on it
    // would restart the heal on every optimistic update it causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, persistedPortalEnabled, persistedToken, portal.accessToken, localOwnership, userId, healAttempt]);

  const retryTokenHeal = useCallback(() => {
    setTokenHeal('idle');
    setHealAttempt(n => n + 1);
  }, []);

  // The access token must be present for the share link to authorize client
  // decisions. Until it is, Copy/Share/Email guard rather than hand out a
  // token-less link — and each reason it can be missing gets its own words.
  const linkPending = portal.enabled && !portal.accessToken;

  // A collaborator never holds the token (AUTH-F5), so for them this is not a
  // wait: only the owner can share the client link. It OUTRANKS linkNeedsSave
  // wherever the two are read (hint, alert), because a collaborator's Save
  // does not write the portal either — "tap Save" would be another dead end.
  const linkOwnerOnly = linkPending && isCollaborator;

  // `portal.enabled` is true from the moment this screen mounts
  // (DEFAULT_PORTAL.enabled — see the state initializer), while the heal is
  // keyed on the PERSISTED `project.clientPortal.enabled` and does nothing
  // when the portal has never been saved. On a brand new portal nothing is
  // syncing: name the actual next step instead of promising a moment.
  const linkNeedsSave = linkPending && !project?.clientPortal?.enabled;

  // The heal gave up (offline, the read was refused, the key never landed).
  // Says so, with a Retry, rather than "syncing" forever.
  const linkHealFailed = linkPending && !linkOwnerOnly && !linkNeedsSave && tokenHeal === 'failed';

  // Shared guard for the three doors the link goes out of. Returns true when
  // it took over, so callers bail — same contract as warnIfExpired().
  const warnIfLinkPending = useCallback((): boolean => {
    if (!linkPending) return false;
    if (linkOwnerOnly) {
      showAlert(
        'Only the project owner can share this link',
        'The client link carries the key that lets your client sign change orders, and that key stays with the project owner’s account. Ask the owner to send it.',
      );
    } else if (linkNeedsSave) {
      showAlert(
        'Save this portal first',
        'The security key that lets your client sign change orders is created when you save. Tap Save, then Copy or Share.',
      );
    } else if (linkHealFailed) {
      showAlert(
        'Couldn’t get the secure link',
        'This link’s security key didn’t come back from the server. Check your connection, then tap Retry under the link.',
      );
    } else {
      showAlert('Finalizing secure link', 'Fetching your portal’s security key from the server — try again in a moment.');
    }
    return true;
  }, [linkPending, linkOwnerOnly, linkNeedsSave, linkHealFailed]);

  // The full base64-hash URL is kept around as a backup for clients
  // whose snapshot cache hasn't propagated yet (e.g., right after
  // creation). Not currently used in the UI but available for debug.
  const portalLinkWithHash = useMemo(() => {
    // No snapshot yet: fall back to the SHORT link, which carries `?t=`. The
    // old fallback concatenated the portalId alone — a URL that opens a portal
    // the homeowner cannot sign or approve anything in.
    // #16/#18: the hash freezes the snapshot into the URL for good, so it is
    // the SAVED one, and only from lists the server has confirmed.
    if (!publishedSnapshot || !portalListsServerRead) return portalLink;
    return buildPortalUrl(PORTAL_BASE_URL, portal.portalId, publishedSnapshot);
  }, [publishedSnapshot, portalListsServerRead, portal.portalId, portalLink]);

  const snapshotSizeKb = useMemo(() => {
    return snapshot ? estimateSnapshotSizeKb(snapshot) : 0;
  }, [snapshot]);

  // Server-side persistence of the portal snapshot. Without this, the
  // portal URL relies entirely on the URL hash — which gets truncated
  // by SMS clients, broken by copy-paste, and can't be regenerated when
  // the homeowner re-opens an old link. Pushing to portal_snapshots
  // means the portal HTML can fetch by portal_id whenever the hash
  // is missing or corrupt. RLS gates writes to the project owner.
  //
  // Note: project-detail.tsx ALSO pushes a (lite) snapshot whenever the
  // GC opens a project with portal enabled, so most homeowner links stay
  // fresh without needing a visit to this screen. The push here is the
  // RICH version (includes message thread, AIA, contract, etc) and
  // overwrites the lite version on next save.
  const hasPersistedRef = useRef(false);
  // #16: 'held' = waiting on the lists / profile / ownership (said on screen),
  // 'refused' = the upsert came back with an error (said on screen — it used
  // to be a console.warn, so a refused publish looked like a published one).
  const [publishState, setPublishState] = useState<'idle' | 'held' | 'published' | 'refused'>('idle');
  const isOwnerRef = useRef(isOwner);
  isOwnerRef.current = isOwner;
  useEffect(() => {
    if (!publishedSnapshot || !publishPortal || !project?.id || !publishPortal.portalId) return;
    if (!isSupabaseConfigured) return;
    // #16: this is a FULL replace built from the device's lists. Never from
    // lists the server has not confirmed since the last foreground (a stale
    // cache would pull shared invoices / COs off the homeowner's page), never
    // from a profile that has not loaded (#104 — "MAGE ID" and a blank
    // contact), and never from a device that does not own the project (the
    // owner-only RLS refuses it anyway).
    if (!portalListsServerRead || !settingsLoaded || !isOwner) { setPublishState('held'); return; }
    // #122: this is a FULL replace of the row, so publishing before the
    // contract / selections / closeout reads have succeeded would drop the
    // contract card (and bring the proposal back) on a flaky connection — or
    // simply on the first 200 ms, before the reads land.
    if (!richReadsReady) return;
    // An open-book / GMP snapshot waits for the cost streams (see
    // costSourcesReady). Other modes disclose no cost-to-date, so they go now.
    const disclosesCost = project.contractMode === 'gmp' || project.contractMode === 'open_book';
    if (disclosesCost && !costSourcesReady) return;
    // Fire IMMEDIATELY on the first ready snapshot — old behavior was a
    // 1.5s debounce that meant a GC tapping in and out fast left the
    // table empty. Subsequent updates still debounce.
    const initialDelay = hasPersistedRef.current ? 1500 : 200;
    const t = setTimeout(() => {
      // Re-checked when the timer FIRES (#16): a foreground during the delay
      // drops the server-read flag, and that pass must not publish.
      const g = publishGateRef.current;
      if (!g.portalListsServerRead || !g.settingsLoaded || !isOwnerRef.current) { setPublishState('held'); return; }
      // #18: everything below is the SAVED portal, never the local switches.
      const portal = publishPortal;
      void supabase
        .from('portal_snapshots')
        .upsert({
          portal_id: portal.portalId,
          project_id: project.id,
          snapshot: publishedSnapshot as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
          // Link lifetime rides along with every snapshot push rather than
          // needing its own write — so it MUST be the policy's answer, not the
          // raw stored date. An until-handover link on a closed-out job closes
          // HANDOVER_GRACE_DAYS after closeout; pushing the stored null here
          // would reopen it on every refresh, fighting the database trigger
          // (portal_snapshots_link_expiry_policy) that computes the same rule.
          // link_duration_days stays NULL for until-handover: that NULL is how
          // the database knows the date is its to compute.
          // #18: the SAVED lifetime — an unsaved duration edit is not live.
          expires_at: expiresAtForPolicy({
            linkDurationDays: portal.linkDurationDays,
            linkExpiresAt: portal.linkExpiresAt,
            projectStatus: project.status,
            closedAt: project.closedAt,
          }),
          link_duration_days: portal.linkDurationDays ?? null,
        }, { onConflict: 'portal_id' })
        .then(({ error }) => {
          if (error) {
            console.warn('[portal-snapshot] persist failed:', error.message);
            setPublishState('refused');
          } else {
            hasPersistedRef.current = true;
            setPublishState('published');
          }
        }, () => setPublishState('refused'));
    }, initialDelay);
    return () => clearTimeout(t);
  }, [publishedSnapshot, publishPortal, project?.id, project?.status, project?.closedAt, project?.contractMode, costSourcesReady, richReadsReady, portalListsServerRead, settingsLoaded, isOwner]);

  // The hash link carries the snapshot itself and has no ?t= token, so the
  // page never refreshes it from the server. On a GMP / open-book job, one
  // copied before the cost streams load would freeze a subcontract-only
  // cost-to-date into the homeowner's link — so until they load, hand out the
  // short link, which reads the published (readiness-gated) snapshot instead.
  const snapshotHeldForCosts = (project?.contractMode === 'gmp' || project?.contractMode === 'open_book') && !costSourcesReady;
  const buildInviteLink = useCallback((invite?: ClientPortalInvite) => {
    // Same rule as portalLinkWithHash: the fallback keeps the access token.
    // #16/#18: the hash link is built from the SAVED settings and only from
    // server-confirmed lists — otherwise the short link, which always reads
    // the published row.
    const snapshot = publishedSnapshot;
    if (!portalListsServerRead) return buildShortPortalUrl(PORTAL_BASE_URL, portal.portalId, invite?.id, portal.accessToken);
    if (!snapshot || snapshotHeldForCosts) return buildShortPortalUrl(PORTAL_BASE_URL, portal.portalId, invite?.id, portal.accessToken);
    // Include invite.id so the portal page can greet the client by name + mark viewed
    const inviteSnapshot = invite
      ? { ...snapshot, clientName: invite.name }
      : snapshot;
    return buildPortalUrl(
      PORTAL_BASE_URL,
      portal.portalId,
      inviteSnapshot,
      invite?.id,
    );
  }, [publishedSnapshot, snapshotHeldForCosts, portalListsServerRead, portal.portalId, portal.accessToken]);

  // Short, shareable URL — `mageid.app/portal/<id>?inviteId=...` with no
  // base64 hash. Use this for SMS, email body, and anywhere the long
  // hash would get truncated or mangled. Works because the static
  // portal HTML falls back to fetching the snapshot from
  // `portal_snapshots` when the hash is missing.
  const buildShortInviteLink = useCallback((invite?: ClientPortalInvite) => {
    return buildShortPortalUrl(PORTAL_BASE_URL, portal.portalId, invite?.id, portal.accessToken);
  }, [portal.portalId, portal.accessToken]);

  // (Plain-text email body is now built inline in handleEmailInvite as
  // a fallback when Resend is unavailable — see below.)

  const handleToggle = useCallback((key: keyof ClientPortalSettings, value: boolean) => {
    // #19: the switches are disabled for a non-owner; this is the belt.
    if (ownerOnlyReason) return;
    setPortal(p => ({ ...p, [key]: value }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [ownerOnlyReason]);

  // Accept a client's budget proposal: marks it accepted in Supabase AND
  // writes the amount to project.targetBudget so the portal stat picks it up.
  // Declining just flips the row status; the GC can still set a budget by
  // building an estimate (the natural path).
  const handleAcceptProposal = useCallback((proposalId: string) => {
    const p = proposalQ.proposals.find(x => x.id === proposalId);
    if (!p || !id || !project) return;
    proposalQ.accept(proposalId);
    updateProject(id, {
      targetBudget: {
        amount: p.amount,
        setAt: new Date().toISOString(),
        setBy: 'client',
        clientName: p.proposerName ?? undefined,
        note: p.note ?? undefined,
        proposalId: p.id,
      },
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [proposalQ, id, project, updateProject]);

  const handleDeclineProposal = useCallback((proposalId: string) => {
    proposalQ.decline(proposalId);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [proposalQ]);

  const handleSave = useCallback(async () => {
    if (!id) return;
    // #19: never "Saved" for a save that reaches no one.
    if (ownerOnlyReason) { showAlert('Not saved', ownerOnlyReason); return; }
    if (portal.requirePasscode && (!portal.passcode || portal.passcode.trim().length < 4)) {
      showAlert('Passcode Required', 'Please enter a passcode of at least 4 characters, or turn off "Ask for a passcode".');
      return;
    }
    setIsSaving(true);
    try {
      // The two owner-sharing switches (supplier names, trade contacts) live
      // in the closeout binder, not on this screen. This screen's `portal`
      // state is a copy taken when it opened, so writing it whole would put
      // back a switch the GC turned OFF in the binder meanwhile. They are
      // always taken from the saved row.
      updateProject(id, {
        clientPortal: {
          ...portal,
          shareSupplierNames: project?.clientPortal?.shareSupplierNames,
          shareTradeContacts: project?.clientPortal?.shareTradeContacts,
        },
      });
      // The provider republishes the lite snapshot for this job too, so the
      // saved switches reach the homeowner even if he leaves right away.
      requestPortalPublish(id);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert('Saved', portalListsServerRead
        ? 'Portal settings updated.'
        : 'Portal settings saved. Your client\'s page will update when your lists finish syncing.');
    } finally {
      setIsSaving(false);
    }
  }, [id, portal, project?.clientPortal?.shareSupplierNames, project?.clientPortal?.shareTradeContacts, updateProject, ownerOnlyReason, requestPortalPublish, portalListsServerRead]);

  // Send modal state — replaces the old web "Share" Alert that just
  // showed the message text and couldn't actually dispatch anything.
  const [showSendModal, setShowSendModal] = useState(false);

  const shareMessage = useMemo(() => {
    // Deliberately DON'T bundle the passcode into the invite body. The whole
    // point of the passcode gate is out-of-band delivery — putting the code
    // in the same message as the link is security theater (one intercepted
    // message defeats it) and contradicts the "Share it separately" guidance
    // on this screen. We prompt the GC to text the code separately after send.
    return portal.welcomeMessage
      ? `${portal.welcomeMessage}\n\nView your project here:\n${portalLink}`
      : `You're invited to view live updates for "${project?.name}".\n\nLink: ${portalLink}`;
  }, [portal.welcomeMessage, portalLink, project?.name]);

  // Prompt the GC to deliver the passcode over a SEPARATE channel after an
  // invite goes out — matching the on-screen "share it separately" guidance.
  const promptPasscodeSeparately = useCallback(() => {
    if (!portal.requirePasscode || !portal.passcode) return;
    // Phase 0 honesty: the passcode is a light extra step on the page, not a
    // lock (the page loads the project before it asks). Say so here too, so
    // the GC does not treat the link as safe to forward.
    showAlert(
      'Now share the passcode separately',
      `Text or tell your client the passcode over a different channel than the link:\n\nPasscode: ${portal.passcode}\n\nThe link is still the key to the project. The passcode is a light extra step on the page, so share the link only with your client.`,
    );
  }, [portal.requirePasscode, portal.passcode]);

  // Premium HTML for the Share → Email path. Built once + passed to
  // SendPortalLinkModal so every email looks identical to the
  // individual-invite path (which already used wrapEmailHtml).
  const shareEmailHtml = useMemo(() => {
    if (!project?.name) return undefined;
    const companyName = settings?.branding?.companyName ?? 'MAGE ID';
    // The PERMISSION_TOGGLES list ↔ enabled portal flag mapping — used
    // to give the recipient a concrete "you can see X" preview.
    const visibleSections: string[] = PERMISSION_TOGGLES
      .filter(t => !!(portal as any)[t.key])
      .map(t => t.label);
    return buildPortalInviteEmailHtml({
      companyName,
      projectName: project.name,
      welcomeMessage: portal.welcomeMessage || undefined,
      portalUrl: portalLink,
      // Never embed the passcode in the invite email — it must travel over a
      // separate channel (we prompt the GC to send it after). Bundling code +
      // link in one message defeats the gate.
      passcode: null,
      visibleSections,
      contactName: settings?.branding?.contactName ?? settings?.branding?.companyName,
      contactEmail: settings?.branding?.email,
      contactPhone: settings?.branding?.phone,
    });
  }, [project?.name, settings, portal, portalLink]);

  const handlePickDuration = useCallback((days: PortalLinkDuration) => {
    durationTouchedRef.current = true;
    setDurationChoice(days);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, []);

  // Mint a fresh expiry from the chosen duration.
  //
  // The portalId is deliberately UNCHANGED. The founder asked for a new
  // expiry, not a new URL, and rotating the id would dead-end the link the
  // homeowner already has in their texts — turning "your link expired" into
  // "every link you were ever sent is now wrong". Revocation is a separate
  // decision and already has a button (Disable Client Portal).
  //
  // Persists immediately rather than waiting for Save: the GC's next move is
  // to re-send the link, and a lifetime that only exists in local state until
  // some later tap is a link that lapses again for no reason.
  //
  // The expiry goes through the same policy resolver as the snapshot push: a
  // fixed duration starts a fresh clock, and until-handover resolves against
  // the job — open (null) while it runs, closeout + HANDOVER_GRACE_DAYS once it
  // is closed out. Minting null for a closed job here would be overwritten by
  // the database on the next push anyway; storing the real date keeps the
  // label on this screen honest in the meantime.
  const handleGenerateLink = useCallback(() => {
    const nextExpiry = expiresAtForPolicy({
      linkDurationDays: durationChoice,
      linkExpiresAt: expiresAtFromDuration(durationChoice),
      projectStatus: project?.status,
      closedAt: project?.closedAt,
    });
    const next: ClientPortalSettings = {
      ...portal,
      linkDurationDays: durationChoice,
      linkExpiresAt: nextExpiry ?? undefined,
      linkGeneratedAt: new Date().toISOString(),
    };
    setPortal(next);
    // #18: persist ONLY the link keys onto the SAVED portal — writing the
    // whole local portal here published every unsaved switch with it.
    if (id) {
      const base = project?.clientPortal?.enabled ? project.clientPortal : next;
      updateProject(id, { clientPortal: { ...base, linkDurationDays: durationChoice, linkExpiresAt: nextExpiry ?? undefined, linkGeneratedAt: next.linkGeneratedAt } });
    }
    void AsyncStorage.setItem(
      LINK_DURATION_PREF_KEY,
      durationChoice === null ? UNTIL_HANDOVER_PREF : String(durationChoice),
    ).catch(() => {});
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const nextState = linkState(nextExpiry, Date.now(), { untilHandover: durationChoice === null });
    showAlert(
      'Link refreshed',
      durationChoice !== null
        ? `Same URL, new clock — it stays open for ${durationLabel(durationChoice)}. Send it again if your client lost the old message.`
        : nextState.kind === 'never'
          ? `Same URL — it stays open for the whole job, however long it runs, and closes ${HANDOVER_GRACE_DAYS} days after you close the project out.`
          : nextState.kind === 'expired'
            ? `This project was closed out, so an until-handover link is already closed (${nextState.label}). Pick 7, 30 or 90 days to reopen it for your client.`
            : `Same URL — the job is closed out, so it stays open until then: ${nextState.label}.`,
    );
  }, [durationChoice, portal, id, updateProject, project?.status, project?.closedAt]);

  // Stop an expired link from being handed out silently. This is the in-app
  // half of "the contractor should be notified" — the background notification
  // is Track 3; this is the part that catches them at the moment it matters,
  // with their thumb already on Copy.
  //
  // Returns true when it took over, so callers bail.
  const warnIfExpired = useCallback((): boolean => {
    if (linkExpiry.kind !== 'expired') return false;
    showAlert(
      'This link has expired',
      `${linkExpiry.label}. Anyone opening it sees a dead page — generate a new one before you send it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Generate new link', onPress: handleGenerateLink },
      ],
    );
    return true;
  }, [linkExpiry, handleGenerateLink]);

  const handleCopyLink = useCallback(async () => {
    // Use the shared clipboard util — previously this called
    // navigator.clipboard?.writeText without awaiting the Promise, so on
    // web the Alert fired before the write actually happened (or
    // silently failed in non-secure contexts) and the user saw "Copied"
    // over an empty clipboard.
    if (warnIfLinkPending()) return;
    if (warnIfExpired()) return;
    const ok = await copyToClipboard(portalLink);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showAlert(
      ok ? 'Copied' : 'Copy failed',
      ok
        ? 'Portal link copied to clipboard.'
        : 'Could not copy the link. Long-press to select the URL above and copy manually.',
    );
  }, [portalLink, warnIfLinkPending, warnIfExpired]);

  const handleShare = useCallback(() => {
    // Open the Send-by-Email/Text modal on every platform. We no longer
    // route through the native share sheet because the user explicitly
    // asked for a modal where they can add recipients directly. The share
    // body no longer carries the passcode (out-of-band delivery), so remind
    // the GC to send the code separately after the link goes out.
    // PORTAL-07: Copy guarded on `linkPending` and Share did not, so the
    // Send-by-email modal could dispatch a token-less `portalLink` during the
    // sync window — the one door where the client, not the GC, discovers the
    // link cannot approve a change order.
    if (warnIfLinkPending()) return;
    if (warnIfExpired()) return;
    setShowSendModal(true);
    if (portal.requirePasscode && portal.passcode) promptPasscodeSeparately();
  }, [portal.requirePasscode, portal.passcode, promptPasscodeSeparately, warnIfExpired, warnIfLinkPending]);

  // Auto-send a branded portal invite email through Resend (via the
  // send-email edge function). The homeowner gets a polished email with
  // a single big "Open my project portal" button — no long ugly URL,
  // no manual MailComposer step from the GC. Falls back to the native
  // mail composer only if Resend is unavailable.
  const handleEmailInvite = useCallback(async (invite: ClientPortalInvite) => {
    // Same expiry guard as Copy/Share — this is the third door the link goes
    // out of, and an expired invite email is the worst of the three because
    // the client finds out, not the GC.
    // PORTAL-07: and the same token guard, for exactly that reason — an
    // emailed link with no `?t=` opens the portal but silently cannot approve
    // a change order.
    if (warnIfLinkPending()) return;
    if (warnIfExpired()) return;
    // Use the SHORT URL (no #d= hash) so SMS / email forwarding never
    // truncates it. The static portal HTML fetches the snapshot from
    // portal_snapshots when no hash is present.
    const link = buildShortInviteLink(invite);
    const companyName = settings?.branding?.companyName ?? 'MAGE ID';
    const projectName = project?.name ?? 'your project';
    const recipientFirstName = invite.name?.split(' ')[0];
    const subject = `Your project portal — ${projectName}`;
    // The passcode is INTENTIONALLY not in this email. A passcode that ships
    // in the same message as the link protects nothing. We prompt the GC to
    // deliver it separately (SMS/call) after the invite sends — matching the
    // on-screen "share it separately" guidance.
    const passcodeHint = portal.requirePasscode && portal.passcode
      ? `<p style="margin:14px 0 0;padding:12px 14px;background:#F4EFE6;border:1px solid #E8DFCD;border-radius:10px;color:#0B0D10;font-size:14px;line-height:1.6;">This portal asks for a passcode. ${escapeHtml(recipientFirstName ?? 'You')} will receive it from your contractor in a separate message.</p>`
      : '';
    const welcomeBlock = portal.welcomeMessage
      ? emailQuote(portal.welcomeMessage)
      : '';
    const bodyHtml = `
      ${welcomeBlock}
      <p style="margin:0 0 8px;">We've set up a private portal where you can follow along with the project in real time — daily updates, photos, budget, schedule, contract, and any decisions that need your sign-off.</p>
      ${passcodeHint}
      <p style="margin:18px 0 0;color:#9AA3AD;font-size:12px;line-height:1.55;">No app to install. Open the link on your phone or computer — that's it. The portal stays at this URL for the life of the project.</p>
    `;
    const html = wrapEmailHtml({
      preheader: `Your live portal for ${projectName} — daily photos, schedule, decisions, and the contract.`,
      eyebrow: 'Project portal',
      title: `${projectName}`,
      subtitle: `Hi ${recipientFirstName ?? 'there'} — your live project view is ready.`,
      bodyHtml,
      cta: { label: 'Open my project portal', href: link },
      companyName,
      logoUri: settings?.branding?.logoUri,
      project: { name: projectName },
      contactName: settings?.branding?.contactName ?? settings?.branding?.companyName,
      contactEmail: settings?.branding?.email,
      contactPhone: settings?.branding?.phone,
      unsubscribe: { recipientEmail: invite.email, eventKey: 'portal_invite', enabled: true },
    });

    const result = await sendEmail({
      to: invite.email,
      subject,
      html,
      replyTo: settings?.branding?.email,
      fromCompanyName: companyName,
      unsubscribe: { recipientEmail: invite.email, eventKey: 'portal_invite', enabled: true },
    });

    if (result.success) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (portal.requirePasscode && portal.passcode) {
        // Passcode intentionally not in the email — prompt out-of-band delivery.
        promptPasscodeSeparately();
      } else {
        showAlert('Sent', `Invitation sent to ${invite.email}.`);
      }
      return;
    }

    // Fallback: if Resend is down, drop into the native composer with
    // the short link so the GC can verify + send manually. Passcode is
    // deliberately omitted here too — the GC delivers it separately.
    const fallbackBody = `${invite.name ? `Hi ${invite.name.split(' ')[0]},` : 'Hi,'}\n\nWe've set up a private portal for ${projectName} so you can follow along with the build.\n\nOpen it here:\n${link}\n\nNo app to install, no password to remember. Open on your phone or computer.\n\n— ${companyName}`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.open(`mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(fallbackBody)}`);
      }
      return;
    }
    const fallback = await sendEmailNative({
      to: invite.email,
      subject,
      body: fallbackBody,
      isHtml: false,
    });
    if (!fallback.success && fallback.error && fallback.error !== 'cancelled') {
      showAlert('Email Not Sent', fallback.error);
    }
  }, [buildShortInviteLink, project?.name, settings, portal.requirePasscode, portal.passcode, portal.welcomeMessage, promptPasscodeSeparately, warnIfExpired, warnIfLinkPending]);

  const handleResetPasscode = useCallback(() => {
    const generate = () => {
      const digits = Math.floor(1000 + Math.random() * 9000).toString();
      setPortal(p => ({ ...p, passcode: digits, requirePasscode: true }));
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showAlert('New Passcode', `New passcode: ${digits}\n\nRemember to tap Save and re-share it with clients.`);
    };
    showAlert(
      'Reset Passcode',
      'Generate a new 4-digit passcode? Your client will need the new code at the page\'s passcode step. It does not change the link: anyone who already has the link can still reach the project.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Generate', onPress: generate },
      ],
    );
  }, []);

  const handleAddInvite = useCallback(() => {
    const email = inviteEmail.trim().toLowerCase();
    const name = inviteName.trim();
    // RFC 5322-ish regex — catches "a@", "@b.com", typos like "@@" that
    // a `.includes('@')` check would silently let through. Anything that
    // can't get past Resend's validator should be caught here.
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!email || !EMAIL_REGEX.test(email)) {
      showAlert('Invalid Email', 'Please enter a valid email address — like name@example.com.');
      return;
    }
    if (portal.invites?.some(i => i.email === email)) {
      showAlert('Already Invited', 'This email has already been invited.');
      return;
    }
    const invite: ClientPortalInvite = {
      id: generateUUID(),
      email,
      name: name || email,
      invitedAt: new Date().toISOString(),
      status: 'pending',
    };
    setPortal(p => ({ ...p, invites: [...(p.invites ?? []), invite] }));
    setInviteEmail('');
    setInviteName('');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [inviteEmail, inviteName, portal.invites]);

  const handleRemoveInvite = useCallback((inviteId: string) => {
    showAlert('Remove Access', 'Remove this client\'s access?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: () => {
          setPortal(p => ({ ...p, invites: (p.invites ?? []).filter(i => i.id !== inviteId) }));
        },
      },
    ]);
  }, []);

  const handleDisablePortal = useCallback(() => {
    showAlert('Disable Portal', 'This will revoke all client access. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disable', style: 'destructive', onPress: () => {
          if (!id) return;
          // #134: revoking access also turns the weekly recap OFF, so turning
          // the portal back on never silently restarts emails he didn't
          // re-choose (the digest itself also refuses a disabled portal).
          // Built on the SAVED portal (#18) — unsaved switches are not kept.
          const base = project?.clientPortal ?? portal;
          allowLeaveRef.current = true;
          updateProject(id, {
            clientPortal: {
              ...base,
              enabled: false,
              ...(base.weeklyDigest ? { weeklyDigest: { ...base.weeklyDigest, enabled: false } } : {}),
            },
          });
          router.back();
        },
      },
    ]);
  }, [id, portal, project?.clientPortal, updateProject, router]);

  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: themeColors.bg }}>
        <Stack.Screen options={{ title: 'Client Portal' }} />
        <ToolProjectPicker
          toolName="Client Portal"
          message="Each project gets its own private homeowner portal with progress, photos, selections, and pay buttons."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<Briefcase size={36} color={themeColors.accent} strokeWidth={1.6} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Client Portal inside the project tile grid.',
            'Toggle which sections to share, then send the magic link to the homeowner.',
          ]}
        />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Client Portal',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving || !!ownerOnlyReason}
              style={[styles.headerSaveBtn, !!ownerOnlyReason && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityState={{ disabled: isSaving || !!ownerOnlyReason }}
              testID="portal-setup-save"
            >
              <Text style={styles.headerSaveBtnText}>{isSaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        {...fabScroll}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {/* #19 / #16 / #18: why a control is blocked, or why the client's page
            has not changed yet — said on the page, never a silent hold. */}
        {!!ownerOnlyReason && (
          <View style={styles.linkCard} testID="portal-setup-owner-only">
            <Text style={styles.expiryHint}>{ownerOnlyReason}</Text>
          </View>
        )}
        {!ownerOnlyReason && hasUnsavedPortalChanges && (
          <View style={styles.linkCard} testID="portal-setup-unsaved">
            <Text style={styles.expiryHint}>Unsaved changes — your client&apos;s page is unchanged until you tap Save.</Text>
          </View>
        )}
        {!ownerOnlyReason && !!project?.clientPortal?.enabled && publishState === 'held' && (
          <View style={styles.linkCard} testID="portal-setup-publish-held">
            <Text style={styles.expiryHint}>Portal will update when your lists finish syncing.</Text>
          </View>
        )}
        {!ownerOnlyReason && publishState === 'refused' && (
          <View style={styles.linkCard} testID="portal-setup-publish-refused">
            <Text style={styles.expiryHint}>Not published — the server refused this update, so your client still sees the last version. Check your connection and reopen this screen.</Text>
          </View>
        )}
        {/* Portal Link */}
        <View style={styles.linkCard}>
          <View style={styles.linkCardHeader}>
            <Globe size={20} color={Colors.purple} strokeWidth={1.75} />
            <Text style={styles.linkCardTitle}>Portal Link</Text>
            <View style={[styles.activeBadge, { backgroundColor: tone.badge }]}>
              <Text style={[styles.activeBadgeText, { color: tone.ink }]}>{tone.short}</Text>
            </View>
          </View>
          {/* PORTAL-07 (runtime audit 2026-09-06): this printed the bare
              `mageid.app/portal/<id>` while Copy and Share both handed out
              that URL PLUS `?t=<accessToken>` — and the token is what
              authorizes the homeowner's change-order e-signature. A GC who
              read the link off this screen to a client on the phone, or
              retyped it into their CRM, gave out a portal that opens but
              cannot approve anything, with no error on either end.
              The card now shows the SHARED link — with the token's middle
              elided, because it is a capability secret and this card has no
              max width, so on desktop the whole 64 characters land in every
              screenshot. See utils/portalSnapshot.maskPortalLinkToken. */}
          <View style={styles.linkRow}>
            <Link size={12} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.linkText} numberOfLines={1} testID="portal-link-display">
              {linkPending ? `${PORTAL_BASE_URL}/${portal.portalId}` : maskPortalLinkToken(portalLink)}
            </Text>
          </View>
          {/* Each pending reason gets its own words, and none promises a wait
              that is not happening: a collaborator never gets the key (the
              owner shares the link); on a never-saved portal the key arrives
              when the GC taps Save; a heal that gave up says so, with Retry. */}
          <Text style={styles.linkHint} testID="portal-link-hint">
            {linkOwnerOnly
              ? 'Only the project owner can share the client link. It carries the key that lets your client sign change orders, and that key stays with the owner\u2019s account \u2014 ask them to send it.'
              : linkNeedsSave
                ? 'Tap Save to finish securing this link — that is when the key your client needs to sign change orders is created.'
                : linkHealFailed
                  ? 'Couldn\u2019t get this link\u2019s security key from the server. Check your connection and tap Retry — Copy and Share stay locked until it arrives.'
                  : linkPending
                    ? 'Fetching this link\u2019s security key from the server — Copy and Share unlock when it arrives.'
                    : 'Ends in a security key that lets your client sign change orders — part of it is hidden here so a screenshot can\u2019t give it away. Use Copy: a shortened or retyped link opens the portal but cannot approve anything.'}
          </Text>
          {linkHealFailed && (
            <TouchableOpacity
              style={styles.generateLinkBtn}
              onPress={retryTokenHeal}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Retry fetching the secure link"
              testID="portal-link-retry-btn"
            >
              <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.generateLinkBtnText}>Retry</Text>
            </TouchableOpacity>
          )}
          {/* The shared link is now short — `/portal/<id>` with no
              base64 hash. The portal page fetches the snapshot from
              the server, so SMS / email truncation is no longer an
              issue. The snapshotSizeKb stat is kept around for the
              "everything's working" diagnostic below but no warning
              is shown to the GC. */}
          <View style={styles.linkActions}>
            <TouchableOpacity style={styles.linkActionBtn} onPress={handleCopyLink}>
              <Copy size={15} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.linkActionText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkActionBtn} onPress={handleShare}>
              <Send size={15} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.linkActionText}>Share</Text>
            </TouchableOpacity>
            {/* Preview as your client — opens the client-view with this
                portal's id so the GC can see exactly what the homeowner
                sees before sharing the link. Previously only reachable
                via the deep-link scheme, invisible in the app UI.
                `previewMode` marks the view as the GC LOOKING, not the client
                ACTING: the preview must render every client decision control
                read-only, because it is wired to the live writers (the CO
                approve flow inserts a real change_order_approvals row and
                flips the CO to `approved` with an audit entry labelled
                client_signed_via_portal). A GC checking their work must not be
                able to sign their own client's change order. */}
            <TouchableOpacity
              style={styles.linkActionBtn}
              onPress={() => router.push({ pathname: '/client-view' as never, params: { portalId: portal.portalId, previewMode: '1' } as never })}
              accessibilityRole="button"
              accessibilityLabel="Preview as your client"
              testID="portal-preview-client-btn"
            >
              <Eye size={15} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.linkActionText}>Preview</Text>
            </TouchableOpacity>
          </View>
          {/* Stated next to Preview because this is the moment the GC forms
              their belief about what their client can do. The sentence is
              about the CLIENT'S page, not about the preview, so it stays true
              however the preview is rendered. */}
          {!portal.coApprovalEnabled && (
            <Text style={styles.linkHint} testID="portal-signing-off-note">
              1-tap signing is off for this portal: your client&apos;s page lists change orders but has no approve
              button. They can only reply in Messages — turn signing on under Approvals &amp; messaging below.
            </Text>
          )}

          {/* Link lifetime. Lives inside the link card on purpose — "how long
              does this stay open" is a property of the URL above it, not a
              separate setting the GC has to go hunting for. */}
          <View style={styles.expiryBlock} testID="portal-link-expiry">
            <View style={styles.expiryStatusRow}>
              <Clock size={13} color={tone.ink} strokeWidth={1.75} />
              <Text style={[styles.expiryStatusText, { color: tone.ink }]} testID="portal-link-expiry-label">
                {linkExpiry.label}
              </Text>
            </View>
            {linkExpiry.kind === 'expired' && (
              <Text style={styles.expiryHint}>
                {handoverClosed
                  ? `This job was closed out, and the link closed ${HANDOVER_GRACE_DAYS} days later. To reopen it for your client, pick a number of days below and generate — the URL doesn\u2019t change, so the link they already have starts working again.`
                  : 'Your client sees a dead page until you generate a new one. The URL doesn\u2019t change, so the link they already have starts working again.'}
              </Text>
            )}

            <Text style={styles.expiryHeading}>How long a new link stays open</Text>
            <View style={styles.durationRow}>
              {PORTAL_LINK_DURATION_OPTIONS.map(opt => {
                const active = durationChoice === opt;
                return (
                  <TouchableOpacity
                    key={String(opt)}
                    style={[styles.durationChip, active && styles.durationChipActive]}
                    onPress={() => handlePickDuration(opt)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={durationLabel(opt)}
                    testID={`portal-link-duration-${opt ?? 'none'}`}
                  >
                    <Text style={[styles.durationChipText, active && styles.durationChipTextActive]}>
                      {durationLabel(opt)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Says what the selected policy really does. "Until handover" is
                the default and the least obvious: it is not "forever". */}
            <Text style={styles.expiryHint} testID="portal-link-duration-explainer">
              {durationChoice === null
                ? `Open for the whole job, however long it runs. It closes on its own ${HANDOVER_GRACE_DAYS} days after you close the project out \u2014 time for the final invoice and closeout paperwork.`
                : `Closes ${durationLabel(durationChoice)} after you generate it, whatever stage the job is at.`}
            </Text>

            <TouchableOpacity
              style={[styles.generateLinkBtn, isCollaborator && styles.generateLinkBtnDisabled]}
              onPress={handleGenerateLink}
              disabled={isCollaborator}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Generate new link"
              accessibilityState={{ disabled: isCollaborator }}
              testID="portal-generate-link-btn"
            >
              <RefreshCw size={14} color={isCollaborator ? themeColors.textMuted : themeColors.accent} strokeWidth={1.75} />
              <Text style={[styles.generateLinkBtnText, isCollaborator && { color: themeColors.textMuted }]}>Generate new link</Text>
            </TouchableOpacity>
            <Text style={styles.expiryHint}>
              {isCollaborator
                ? 'Only the project owner can change how long the client link stays open.'
                : 'Same URL either way — generating only resets the clock, so nobody you\u2019ve already sent it to loses access.'}
            </Text>
          </View>
        </View>

        {/* Passcode — an extra step, not a lock.
            Phase 0 honesty pass (2026-09-23). This said "Passcode Protection"
            and "Portal is locked". Neither is true: the portal page downloads
            the whole project before it shows the passcode screen, and the
            server never checks the passcode, so anyone holding the link can
            read the project with or without the code. The 192-bit token in
            the link is the only real credential. Until the passcode is
            enforced server-side, the copy says what it does. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Passcode (extra step)</Text>
          <Text style={styles.sectionSubtitle}>The link is the key: anyone who has it can reach this project. A passcode adds a light extra step on the page, not a lock. Share the link only with your client, and send the passcode separately.</Text>
          <View style={styles.togglesCard}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <Lock size={18} color={themeColors.accent} strokeWidth={1.75} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Ask for a passcode</Text>
                  <Text style={styles.toggleDesc}>{portal.requirePasscode ? 'The page asks for the passcode first. The link is still the key.' : 'The link alone opens the page'}</Text>
                </View>
              </View>
              <Switch
                disabled={!!ownerOnlyReason}
                value={!!portal.requirePasscode}
                onValueChange={val => setPortal(p => ({ ...p, requirePasscode: val }))}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>
          </View>
          {portal.requirePasscode && (
            <>
              <TextInput
                style={[styles.welcomeInput, { minHeight: 48, textAlign: 'center' as const, letterSpacing: 2, fontSize: Type.callout.fontSize, marginTop: 10 }]}
                value={portal.passcode ?? ''}
                onChangeText={val => setPortal(p => ({ ...p, passcode: val }))}
                editable={!ownerOnlyReason}
                placeholder="Enter a passcode (4-12 chars)"
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="none"
                maxLength={20}
              />
              <TouchableOpacity style={styles.resetPasscodeBtn} onPress={handleResetPasscode} disabled={!!ownerOnlyReason} activeOpacity={0.8}>
                <RefreshCw size={13} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.resetPasscodeText}>Generate New Passcode</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Homeowner Language */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Homeowner&apos;s Language</Text>
          <Text style={styles.sectionSubtitle}>
            The portal labels + AI daily summaries land in this language. Names of brands and the project itself stay in their original form.
          </Text>
          <View style={styles.langGrid}>
            {LANGUAGES.map(l => {
              const active = (portal.homeownerLanguage ?? 'en') === l.code;
              return (
                <TouchableOpacity
                  key={l.code}
                  style={[styles.langChip, active && styles.langChipActive]}
                  disabled={!!ownerOnlyReason}
                  onPress={() => {
                    setPortal(p => ({ ...p, homeownerLanguage: l.code }));
                    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                  }}
                  testID={`portal-lang-${l.code}`}
                >
                  <Text style={styles.langFlag}>{l.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.langEndonym, active && styles.langEndonymActive]}>{l.endonym}</Text>
                    <Text style={styles.langEnglish}>{l.englishName}</Text>
                  </View>
                  {active && <Check size={14} color={themeColors.accent} strokeWidth={1.75} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Welcome Message */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Welcome Message</Text>
          <Text style={styles.sectionSubtitle}>Optional message shown to clients when they open the portal</Text>
          <TextInput
            style={styles.welcomeInput}
            value={portal.welcomeMessage}
            onChangeText={val => setPortal(p => ({ ...p, welcomeMessage: val }))}
            editable={!ownerOnlyReason}
            placeholder="e.g. Hi! Here's a live view of your project. Feel free to reach out with any questions."
            placeholderTextColor={themeColors.textMuted}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Client Budget Input */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Client Budget Input</Text>
          <Text style={styles.sectionSubtitle}>
            Let the owner propose a starting budget directly from the portal — useful
            when you don&apos;t have an estimate yet and want to anchor the conversation.
          </Text>
          <View style={[styles.togglesCard, { padding: 0 }]}>
            <View style={[styles.toggleRow, (project?.targetBudget || proposalQ.pending.length > 0) && styles.toggleRowBorder]}>
              <View style={styles.toggleLeft}>
                <HandCoins size={18} color={Colors.orange} strokeWidth={1.75} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Allow client to suggest budget</Text>
                  <Text style={styles.toggleDesc}>Shows a &quot;Set your target budget&quot; card on the portal</Text>
                </View>
              </View>
              <Switch
                disabled={!!ownerOnlyReason}
                value={!!portal.clientCanSetBudget}
                onValueChange={val => handleToggle('clientCanSetBudget', val)}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>

            {/* Currently accepted budget */}
            {project?.targetBudget && (
              <View style={[styles.budgetStatus, proposalQ.pending.length > 0 && { borderBottomWidth: 1, borderBottomColor: themeColors.line }]}>
                <View style={styles.budgetStatusBadge}>
                  <Check size={14} color={Colors.successDark} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.budgetStatusLabel}>
                    Target budget {project.targetBudget.setBy === 'client' ? 'from client' : 'set by you'}
                  </Text>
                  <Text style={styles.budgetStatusValue}>{formatMoney(project.targetBudget.amount)}</Text>
                  {project.targetBudget.clientName && (
                    <Text style={styles.budgetStatusMeta}>Proposed by {project.targetBudget.clientName}</Text>
                  )}
                </View>
              </View>
            )}

            {/* Pending proposals */}
            {proposalQ.pending.map((p, idx) => (
              <View
                key={p.id}
                style={[
                  styles.proposalRow,
                  idx < proposalQ.pending.length - 1 && styles.toggleRowBorder,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.proposalAmount}>{formatMoney(p.amount)}</Text>
                  <Text style={styles.proposalMeta}>
                    {p.proposerName ? `${p.proposerName} · ` : ''}
                    {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                  {p.note && <Text style={styles.proposalNote} numberOfLines={2}>{p.note}</Text>}
                </View>
                <View style={styles.proposalCtas}>
                  <TouchableOpacity
                    style={[styles.proposalBtn, styles.proposalBtnAccept]}
                    onPress={() => handleAcceptProposal(p.id)}
                    disabled={proposalQ.isResponding}
                  >
                    <Check size={14} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.proposalBtnText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.proposalBtnDecline}
                    onPress={() => handleDeclineProposal(p.id)}
                    disabled={proposalQ.isResponding} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Weekly recap email — plain-English Friday digest. Reads
            the last 7 days of DFRs/photos/COs and ships a homeowner-
            friendly recap via the homeowner-weekly-digest edge fn.
            Defaults off — opt in here. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weekly recap email</Text>
          <Text style={styles.sectionSubtitle}>
            We email your client a plain-English recap every Friday — what got done this week, what&apos;s coming next. AI strips the contractor jargon. Off until you toggle it on.
          </Text>
          <View style={[styles.togglesCard, { padding: 0 }]}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <Sunrise size={18} color={Colors.orange} strokeWidth={1.75} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Send weekly recap</Text>
                  <Text style={styles.toggleDesc}>Friday afternoons. Goes to every portal invite email.</Text>
                </View>
              </View>
              <Switch
                disabled={!!ownerOnlyReason}
                value={!!portal.weeklyDigest?.enabled}
                onValueChange={val => handleToggle('weeklyDigest', { ...(portal.weeklyDigest ?? {}), enabled: val } as never)}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.previewWeeklyBtn, !id && { opacity: 0.5 }]}
            onPress={async () => {
              if (!id) return;
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              try {
                const { data, error } = await supabase.functions.invoke('homeowner-weekly-digest', {
                  body: { projectId: id, preview: true },
                });
                if (error) throw error;
                const sent = (data as { sent?: number } | null)?.sent ?? 0;
                const errs = (data as { errors?: string[] } | null)?.errors ?? [];
                // A preview that sent nothing says WHY: the function now skips
                // a closed job and an ended portal link, and a per-invite send
                // failure is not "no invites" either.
                if (errs.includes('portal_disabled')) {
                  // #134: the function refuses a disabled portal outright.
                  showAlert('Portal is off', 'Nothing was emailed. Turn the portal on to email your client.');
                } else if (sent > 0) {
                  showAlert('Preview sent', `Sent the recap to ${sent} portal invite${sent === 1 ? '' : 's'}. Check your inbox or your client's.`);
                } else if (errs.includes('project_closed')) {
                  // The closing email only goes out through the weekly recap's
                  // Friday run, which skips portals with the recap off — so
                  // promise it only when the recap is on.
                  showAlert('Job is closed', portal.weeklyDigest?.enabled
                    ? 'The Friday update stops at handover. Your client got (or will get on Friday) one last email saying the job is complete and when the portal link closes.'
                    : 'The Friday update stops at handover. The weekly recap is off for this portal, so no closing email goes out — tell your client yourself when the portal link closes.');
                } else if (errs.includes('portal_link_ended')) {
                  showAlert('Portal link has ended', 'Send your client a new portal link before previewing the weekly update.');
                } else if (errs.length === 0 || errs.includes('no_invites')) {
                  showAlert('No invites yet', 'Add a portal invite (with their email) before previewing the weekly recap.');
                } else if (errs.every(e => e === 'unsubscribed')) {
                  // Every invite unsubscribed from the weekly recap (or from all
                  // MAGE ID email) with a link in one of these emails. Only they
                  // can turn it back on.
                  showAlert('Your client turned these emails off', 'Everyone on this portal unsubscribed from the weekly recap, so nothing was sent. Only they can turn it back on, from "Manage email preferences" at the bottom of any MAGE ID email.');
                } else {
                  const refusal = errs.find(e => e !== 'unsubscribed') ?? errs[0];
                  showAlert('Preview not sent', `The email service refused it: ${refusal.replace(/^[^:]*:\s*/, '')}`);
                }
              } catch (err) {
                showAlert('Preview failed', (err as Error).message ?? 'Could not send preview.');
              }
            }}
            activeOpacity={0.85}
          >
            <Send size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.previewWeeklyBtnText}>Send today&apos;s preview now</Text>
          </TouchableOpacity>
        </View>

        {/* Change-order approvals + messaging */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Approvals & messaging</Text>
          <Text style={styles.sectionSubtitle}>
            Let the client respond from the portal — accept the proposal once it is switched on below, tap Approve / Decline on change orders, and send messages. They land here.
          </Text>
          <View style={styles.togglesCard}>
            {/* Accept the proposal — the decision that starts the job. It sits
                above the CO row because that is the order a job happens in.
                A switch that cannot do anything is worse than no switch, so
                without a priced estimate this row says why instead. */}
            <View style={[styles.toggleRow, styles.toggleRowBorder]}>
              <View style={styles.toggleLeft}>
                <FileText size={18} color={themeColors.accent} strokeWidth={1.75} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Accept the proposal</Text>
                  <Text style={styles.toggleDesc} testID="proposal-approval-desc">
                    {canProposeToClient
                      // #29: until the acceptance RPC is live the portal can
                      // show the proposal but cannot record a signature, so
                      // the switch must not promise one. It can still be
                      // turned OFF; it cannot be turned on.
                      ? (!PORTAL_PROPOSAL_ACCEPTANCE_LIVE
                        ? (portal.proposalApprovalEnabled
                          ? `Your client can read the proposal in the portal but can't accept it there yet. ${PROPOSAL_ACCEPTANCE_OFF_REASON}`
                          : PROPOSAL_ACCEPTANCE_OFF_REASON)
                        : 'Owner reviews the scope and price and signs to accept, from the portal')
                      : proposalBlock.gc}
                  </Text>
                </View>
              </View>
              <Switch
                value={!!portal.proposalApprovalEnabled && canProposeToClient}
                disabled={!canProposeToClient || (!PORTAL_PROPOSAL_ACCEPTANCE_LIVE && !portal.proposalApprovalEnabled)}
                onValueChange={handleProposalSwitch}
                testID="proposal-approval-switch"
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>
            {/* The payment terms this proposal prints — the portal's own
                stamp, never the live settings. One row per state; every action
                opens the sheet or writes the stamp directly, never names a
                screen to go find. */}
            {canProposeToClient && termsState.state !== 'off' && (
              <View style={[styles.proposalTermsRow, styles.toggleRowBorder]} testID="proposal-terms-row">
                {termsState.state === 'current' && (
                  <>
                    <Text style={styles.toggleDesc}>Prints your terms: {splitLabel(termsState.stamp)}.</Text>
                    <Button label="Change" variant="ghost" size="sm" onPress={() => gate.edit('terms')} testID="proposal-terms-change" />
                  </>
                )}
                {termsState.state === 'differs' && (
                  <>
                    <Text style={styles.toggleDesc}>
                      Prints {splitLabel(termsState.stamp)} — the terms your client was shown. Your terms are now {splitLabel(termsState.profileSplit)}.
                    </Text>
                    {termsState.action === 'use-current' ? (
                      <>
                        <Button
                          label={`Use ${splitLabel(termsState.profileSplit)} on this proposal`}
                          variant="secondary" size="sm"
                          onPress={handleUseCurrentTerms}
                          loading={replacingTerms}
                          testID="proposal-terms-use-current"
                        />
                        <Text style={styles.toggleDesc}>Your client will need to reload the page before accepting.</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.toggleDesc}>{termsState.reason}</Text>
                        <Button label="Try again" variant="ghost" size="sm" onPress={() => { void acceptancesQ.refetch(); }} testID="proposal-terms-retry" />
                      </>
                    )}
                  </>
                )}
                {termsState.state === 'unconfirmed' && (
                  <>
                    <Text style={styles.toggleDesc}>
                      Your client sees this proposal without payment terms and can&apos;t accept it yet.
                    </Text>
                    <Button
                      label={termsState.action === 'use-profile' ? `Use ${splitLabel(termsState.profileSplit)}` : 'Set your payment terms'}
                      variant="secondary" size="sm"
                      onPress={confirmTerms}
                      testID="proposal-terms-confirm"
                    />
                  </>
                )}
                {termsState.state === 'locked' && (
                  <Text style={styles.toggleDesc}>Accepted on {splitLabel(termsState.stamp)} — these can&apos;t change.</Text>
                )}
              </View>
            )}
            {/* What the switch does NOT do on its own. The switch saves the
                proposal to the project straight away, so it publishes within
                seconds — but a page the client already had open is a snapshot
                of before. Saying so here is the difference between a switch
                and a promise. */}
            {!!portal.proposalApprovalEnabled && canProposeToClient && (
              <View style={[styles.toggleRow, styles.toggleRowBorder]}>
                <Text style={styles.toggleDesc} testID="proposal-rollout-note">
                  Your client sees this proposal within seconds of switching it on. If their page was already open,
                  it asks them to refresh before accepting.
                </Text>
              </View>
            )}
            {acceptances.map((a, idx) => (
              <View key={a.id} style={[styles.coApprovalRow, styles.toggleRowBorder]}>
                <View style={[styles.budgetStatusBadge, a.decision === 'declined' && { backgroundColor: '#FBEAE7' }]}>
                  {a.decision === 'accepted'
                    ? <Check size={14} color={Colors.successDark} strokeWidth={1.75} />
                    : <X size={14} color="#C0392B" strokeWidth={1.75} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.coApprovalLabel}>
                    {a.decision === 'accepted' ? 'Proposal accepted' : 'Proposal declined'}
                    {typeof a.proposal_total === 'number' ? ` · ${formatMoney(a.proposal_total)}` : ''}
                  </Text>
                  <Text style={styles.coApprovalMeta}>
                    {a.signer_name ? a.signer_name : 'Client'} · {new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  {a.note ? <Text style={styles.coApprovalNote} numberOfLines={2}>{a.note}</Text> : null}
                  {a.document_hash
                    ? <Text style={styles.coApprovalNote} numberOfLines={1}>
                        Record SHA-256 {a.document_hash.slice(0, 24)}…
                      </Text>
                    : null}
                </View>
              </View>
            ))}
            <View style={[styles.toggleRow, threadQ.coApprovals.length > 0 && styles.toggleRowBorder]}>
              <View style={styles.toggleLeft}>
                <CheckCircle2 size={18} color={themeColors.accent} strokeWidth={1.75} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>1-tap CO approval</Text>
                  <Text style={styles.toggleDesc}>
                    {portal.coApprovalEnabled
                      ? 'Your client signs change orders on their page — drawn signature, ESIGN consent, and a sealed record you can produce later.'
                      : 'Off: your client’s page shows change orders but has no approve button. They can only reply in Messages.'}
                  </Text>
                </View>
              </View>
              <Switch
                disabled={!!ownerOnlyReason}
                value={!!portal.coApprovalEnabled}
                onValueChange={val => handleToggle('coApprovalEnabled', val)}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>
            {/* The blocked state, and why it matters RIGHT NOW.
                A new portal ships with coApprovalEnabled = false, and nothing
                anywhere told the GC that the signing path they think their
                client has is switched off. So the client types "yeah go ahead"
                into the message thread, the GC builds the work, and there is no
                signed amendment behind a five-figure change. The e-signature
                path is already built (drawn signature, ESIGN disclosure, a
                SHA-256-sealed consent record in change_order_approvals) — this
                row is the one tap that turns it on, and it only appears when
                there is actually a change order waiting. */}
            {!portal.coApprovalEnabled && pendingClientCOCount > 0 && (
              <TouchableOpacity
                style={[styles.toggleRow, styles.toggleRowBorder]}
                onPress={() => handleToggle('coApprovalEnabled', true)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Turn on 1-tap change order signing"
                testID="portal-co-signing-off-nudge"
              >
                <View style={styles.toggleLeft}>
                  <AlertTriangle size={18} color={Colors.warningLabel} strokeWidth={1.75} />
                  <View style={styles.toggleLabels}>
                    <Text style={styles.toggleLabel}>
                      {pendingClientCOCount === 1
                        ? '1 change order is waiting on your client'
                        : `${pendingClientCOCount} change orders are waiting on your client`}
                    </Text>
                    <Text style={styles.toggleDesc}>
                      With signing off they can only reply in Messages — and a message is not a signed change to
                      the contract. Tap to let them sign instead.
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
            {threadQ.coApprovals.slice(0, 5).map((a, idx) => (
              <View key={a.id} style={[styles.coApprovalRow, idx < 4 && styles.toggleRowBorder]}>
                <View style={[styles.budgetStatusBadge, a.decision === 'declined' && { backgroundColor: '#FBEAE7' }]}>
                  {a.decision === 'approved'
                    ? <Check size={14} color={Colors.successDark} strokeWidth={1.75} />
                    : <X size={14} color="#C0392B" strokeWidth={1.75} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.coApprovalLabel}>
                    CO {a.changeOrderId.slice(0, 8)} · {a.decision === 'approved' ? 'Approved' : 'Declined'}
                  </Text>
                  <Text style={styles.coApprovalMeta}>
                    {a.signerName ? a.signerName : 'Client'} · {new Date(a.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  {a.note && <Text style={styles.coApprovalNote} numberOfLines={2}>{a.note}</Text>}
                </View>
              </View>
            ))}
          </View>
          {/* Unified messages preview — both directions (your sent messages
              AND incoming client messages). Always rendered so this is the
              single entry point for the thread, replacing the older
              "Messages" CTA that was duplicated below. */}
          <TouchableOpacity
            style={styles.messagesPreview}
            onPress={() => router.push(`/client-messages?id=${id}` as any)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Open messages thread"
            testID="portal-recent-messages"
          >
            <View style={styles.messagesPreviewHeader}>
              <MessageSquare size={14} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.messagesPreviewLabel}>
                {recentMessages.length === 0 ? 'Messages' : 'Recent messages'}
              </Text>
              {unreadFromClient > 0 && (
                <View style={styles.unreadPill}>
                  <Text style={styles.unreadPillTxt}>{unreadFromClient}</Text>
                </View>
              )}
              <Text style={styles.messagesPreviewOpen}>
                {recentMessages.length === 0 ? 'Start ›' : 'Open ›'}
              </Text>
            </View>
            {recentMessages.length === 0 ? (
              <Text style={styles.messagesEmptyHint}>
                Two-way Q&A with everyone invited to the portal. Tap to send the first message.
              </Text>
            ) : (
              // Mini iMessage-style thread preview — left/right bubbles
              // matching the dedicated /client-messages screen so the two
              // views feel like the same conversation.
              recentMessages.map((m, idx) => {
                const mine = m.authorType === 'gc';
                const isUnread = !mine && !m.readByGc;
                const prev = idx > 0 ? recentMessages[idx - 1] : null;
                const senderChanged = !prev || prev.authorType !== m.authorType;
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.miniRow,
                      mine ? styles.miniRowMine : styles.miniRowTheirs,
                      senderChanged ? styles.miniRowGap : styles.miniRowTight,
                    ]}
                  >
                    <View
                      style={[
                        styles.miniBubble,
                        mine ? styles.miniBubbleMine : styles.miniBubbleTheirs,
                      ]}
                    >
                      <Text
                        style={[styles.miniBubbleText, mine && styles.miniBubbleTextMine]}
                        numberOfLines={2}
                      >
                        {m.body}
                      </Text>
                    </View>
                    {isUnread && <View style={styles.unreadDot} />}
                  </View>
                );
              })
            )}
          </TouchableOpacity>
        </View>

        {/* Auto-share */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AUTO-SHARE WITH CLIENT</Text>
          <Text style={styles.sectionSubtitle}>
            When ON, new items of that type are shared with your client the moment you save them.
            When OFF, new items go to your Outbox as Drafts — tap Send to share each one.
          </Text>
          <View style={styles.togglesCard}>
            {([
              ['Daily reports as I save them', 'dailyReports'],
              ['Photos as I upload them', 'photos'],
              ['Selection categories as I curate them', 'selections'],
              ['Warranty docs as I add them', 'warranties'],
            ] as const).map(([label, key], index, arr) => {
              const enabled = (portal.autoShare?.[key] ?? true) === true;
              return (
                <View key={key} style={[styles.toggleRow, index < arr.length - 1 && styles.toggleRowBorder]}>
                  <Text style={[styles.toggleLabel, { flex: 1 }]}>{label}</Text>
                  <Switch
                    disabled={!!ownerOnlyReason}
                    value={enabled}
                    onValueChange={(v) => {
                      setPortal(p => ({
                        ...p,
                        autoShare: { ...(p.autoShare ?? {}), [key]: v },
                      }));
                    }}
                    trackColor={{ false: themeColors.line, true: themeColors.accent }}
                    thumbColor="#FFF"
                  />
                </View>
              );
            })}
          </View>
        </View>

        {/* Permissions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What Clients Can See</Text>
          <Text style={styles.sectionSubtitle}>Toggle sections on or off. Changes take effect immediately after saving.</Text>
          <View style={styles.togglesCard}>
            {PERMISSION_TOGGLES.map((item, index) => (
              <View key={item.key} style={[styles.toggleRow, index < PERMISSION_TOGGLES.length - 1 && styles.toggleRowBorder]}>
                <View style={styles.toggleLeft}>
                  {item.icon}
                  <View style={styles.toggleLabels}>
                    <Text style={styles.toggleLabel}>{item.label}</Text>
                    <Text style={styles.toggleDesc}>{item.description}</Text>
                    {/* Only the Documents row states its own contents: it is
                        the one switch whose section can legitimately publish
                        nothing at all, and the one that spent its whole life
                        publishing nothing while looking like it worked. */}
                    {item.key === 'showDocuments' && portal.showDocuments && !!documentsSummary && (
                      <Text style={styles.toggleDesc} testID="portal-documents-summary">
                        {documentsSummary}
                      </Text>
                    )}
                  </View>
                </View>
                <Switch
                  disabled={!!ownerOnlyReason}
                  value={portal[item.key] as boolean}
                  onValueChange={val => handleToggle(item.key, val)}
                  trackColor={{ false: themeColors.line, true: themeColors.accent }}
                  thumbColor="#FFF"
                />
              </View>
            ))}
          </View>
        </View>

        {/* Invite Clients */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Invite Clients</Text>
          <Text style={styles.sectionSubtitle}>Add clients by email to track who has access</Text>
          <View style={styles.inviteForm}>
            <TextInput
              style={styles.input}
              value={inviteName}
              onChangeText={setInviteName}
              placeholder="Client name"
              placeholderTextColor={themeColors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="Email address"
              placeholderTextColor={themeColors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity style={[styles.inviteBtn, !!ownerOnlyReason && { opacity: 0.5 }]} onPress={handleAddInvite} disabled={!!ownerOnlyReason}>
              <Plus size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.inviteBtnText}>Add Client</Text>
            </TouchableOpacity>
          </View>

          {/* Invite List */}
          {(portal.invites ?? []).length > 0 && (
            <View style={styles.inviteList}>
              {(portal.invites ?? []).map(invite => (
                <View key={invite.id} style={styles.inviteRow}>
                  <View style={styles.inviteAvatar}>
                    <Text style={styles.inviteAvatarText}>{invite.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.inviteInfo}>
                    <Text style={styles.inviteName}>{invite.name}</Text>
                    <Text style={styles.inviteEmail}>{invite.email}</Text>
                  </View>
                  <View style={styles.inviteRight}>
                    <View style={[styles.inviteStatus, invite.status === 'viewed' && styles.inviteStatusViewed]}>
                      {invite.status === 'viewed'
                        ? <Eye size={10} color={themeColors.success} strokeWidth={1.75} />
                        : <Clock size={10} color={Colors.warningLabel} strokeWidth={1.75} />
                      }
                      <Text style={[styles.inviteStatusText, invite.status === 'viewed' && { color: themeColors.success }]}>
                        {invite.status === 'viewed' ? 'Viewed' : 'Pending'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handleEmailInvite(invite)} style={styles.emailInviteBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Email">
                      <Mail size={14} color={themeColors.accent} strokeWidth={1.75} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleRemoveInvite(invite.id)} style={styles.removeBtn} accessibilityRole="button" accessibilityLabel="Delete">
                      <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* The standalone Messages CTA that used to live here was removed —
            the unified preview at the top of this section is now the single
            entry point to the thread, so the GC's sent messages and the
            client's unread messages live in one place. */}

        {/* Weekly Update CTA */}
        <TouchableOpacity
          style={styles.weeklyUpdateBtn}
          onPress={() => router.push(`/client-update?projectId=${id}` as any)}
          activeOpacity={0.85}
          testID="draft-weekly-update-btn"
        >
          <View style={styles.weeklyUpdateIcon}>
            <MageAIMark size={16} color={themeColors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.weeklyUpdateTitle}>Draft Weekly Update</Text>
            <Text style={styles.weeklyUpdateSub}>AI writes a friendly progress email from the last 7 days. You edit, then send.</Text>
          </View>
          <Text style={styles.weeklyUpdateArrow}>›</Text>
        </TouchableOpacity>

        {/* Danger Zone */}
        <TouchableOpacity
          style={[styles.disableBtn, !!ownerOnlyReason && { opacity: 0.5 }]}
          onPress={handleDisablePortal}
          disabled={!!ownerOnlyReason}
          accessibilityState={{ disabled: !!ownerOnlyReason }}
        >
          <EyeOff size={16} color={themeColors.danger} strokeWidth={1.75} />
          <Text style={styles.disableBtnText}>Disable Client Portal</Text>
        </TouchableOpacity>
      </ScrollView>
      <SendPortalLinkModal
        visible={showSendModal}
        onClose={() => setShowSendModal(false)}
        subject={`Your project portal — ${project?.name ?? 'Project'}`}
        message={shareMessage}
        emailHtml={shareEmailHtml}
        link={portalLink}
      />
      <ClientDocumentAskSheet {...gate.sheet} />
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  headerSaveBtn: { paddingHorizontal: 4 },
  headerSaveBtnText: { fontSize: Type.callout.fontSize, fontWeight: '600', color: t.accent },

  linkCard: {
    margin: 16,
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: '#5856D620',
  },
  linkCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  linkCardTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text, flex: 1 },
  // Base only — background + ink are always overridden inline by the link
  // state tone, so these are the neutral fallback rather than a green that
  // would be wrong for three of the four states.
  activeBadge: { backgroundColor: t.neutralSoft, borderRadius: Tokens.radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  activeBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.bg, borderRadius: Tokens.radius.sm, padding: 10, marginBottom: 6 },
  linkText: { fontSize: Type.caption1.fontSize, color: t.info, flex: 1 },
  // PORTAL-07: the displayed link now carries its access token, which is long
  // and unreadable at a glance — so say what the tail is and why retyping it
  // breaks approvals, rather than letting the GC assume it is decoration.
  linkHint: { fontSize: Type.caption2.fontSize, color: t.textSecondary, lineHeight: 16, marginBottom: 12 },
  linkActions: { flexDirection: 'row', gap: 10 },
  linkActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.accent + '15', borderRadius: Tokens.radius.md, paddingVertical: 10 },
  linkActionText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.accent },

  // Link lifetime — status line, duration chips, regenerate.
  expiryBlock: { marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  expiryStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Colour is applied inline from the state tone — the row is the one place
  // that has to change hue with the data.
  expiryStatusText: { fontSize: Type.footnote.fontSize, fontWeight: '600', flex: 1 },
  expiryHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16, marginTop: 6 },
  expiryHeading: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textSecondary, marginTop: 14, marginBottom: 8 },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  durationChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: t.line,
    backgroundColor: t.surface,
  },
  durationChipActive: { borderColor: t.accent, backgroundColor: t.accentSoft },
  durationChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textSecondary },
  durationChipTextActive: { color: t.accentLabel },
  generateLinkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 10, paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.accent + '30',
  },
  generateLinkBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
  // Collaborator: the control stays visible (so the setting is discoverable)
  // but reads as unavailable; the line under it says why.
  generateLinkBtnDisabled: { backgroundColor: t.surface, borderColor: t.line },

  section: { paddingHorizontal: 16, marginBottom: 24 },
  sectionTitle: { fontSize: Type.body.fontSize, fontWeight: '700', color: t.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginBottom: 12, lineHeight: 18 },

  welcomeInput: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    padding: 12,
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },

  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    borderRadius: 11,
    minWidth: '47%', flexGrow: 1,
  },
  langChipActive: { borderColor: t.accent, backgroundColor: t.accent + '0F' },
  langFlag: { fontSize: Type.title2.fontSize },
  langEndonym: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  langEndonymActive: { color: t.accent },
  langEnglish: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 1 },

  togglesCard: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  toggleRowBorder: { borderBottomWidth: 1, borderBottomColor: t.line },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleLabels: { flex: 1 },
  toggleLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  toggleDesc: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },
  proposalTermsRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 8, alignItems: 'flex-start' },

  budgetStatus: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: Colors.successLight,
  },
  budgetStatusBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#D1ECDB',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  budgetStatusLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: Colors.successDark, letterSpacing: 0.4, textTransform: 'uppercase' },
  budgetStatusValue: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginTop: 2 },
  budgetStatusMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  proposalRow: {
    paddingHorizontal: 14, paddingVertical: 14,
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    // Theme-aware: the hardcoded cream '#FFF7EE' put dark-theme light text
    // (proposalAmount/proposalNote use t.text) on a light card — unreadable.
    backgroundColor: t.accentSoft,
  },
  proposalAmount: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text },
  proposalMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  proposalNote: { fontSize: Type.footnote.fontSize, color: t.text, marginTop: 6, lineHeight: 18 },
  proposalCtas: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  proposalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Tokens.radius.sm,
  },
  proposalBtnAccept: { backgroundColor: t.accentFill },
  proposalBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFF' },
  proposalBtnDecline: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center',
  },
  coApprovalRow: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 12,
    // Theme-aware: same class of bug as proposalRow — the pale green '#F4FAF6'
    // stranded dark-theme light text (coApprovalLabel/Note use t.text).
    backgroundColor: t.successSoft,
  },
  coApprovalLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  coApprovalMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  coApprovalNote: { fontSize: Type.caption1.fontSize, color: t.text, marginTop: 4, fontStyle: 'italic' },
  messagesPreview: {
    marginTop: 10, padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '08',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  messagesPreviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  messagesPreviewLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent, flex: 1 },
  messagesPreviewOpen: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 0.4 },
  messagesEmptyHint: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  // Mini iMessage-style bubbles — borderless, left/right aligned. Matches
  // the dedicated thread screen so the preview reads as the same chat.
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniRowMine:   { justifyContent: 'flex-end' },
  miniRowTheirs: { justifyContent: 'flex-start' },
  miniRowGap:   { marginTop: 6 },
  miniRowTight: { marginTop: 2 },
  miniBubble: {
    maxWidth: '78%',
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 14,
  },
  miniBubbleMine: { backgroundColor: t.accentFill },
  miniBubbleTheirs: { backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line },
  miniBubbleText: { fontSize: 13, color: t.text, lineHeight: 17 },
  miniBubbleTextMine: { color: '#FFFFFF' },
  unreadDot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: t.accent,
  },

  inviteForm: { gap: 8 },
  input: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    padding: 12,
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
  },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.card, paddingVertical: 13,
  },
  inviteBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: '#FFF' },

  inviteList: {
    marginTop: 12,
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden',
  },
  inviteRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: t.line },
  inviteAvatar: {
    width: 36, height: 36, borderRadius: Tokens.radius.xl,
    backgroundColor: t.accent + '25',
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  inviteAvatarText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.accent },
  inviteInfo: { flex: 1 },
  inviteName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  inviteEmail: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },
  inviteRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inviteStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FF950020', borderRadius: Tokens.radius.xs, paddingHorizontal: 6, paddingVertical: 3,
  },
  inviteStatusViewed: { backgroundColor: '#34C75920' },
  inviteStatusText: { fontSize: 10, fontWeight: '600', color: Colors.warningLabel },
  removeBtn: { padding: 4 },
  emailInviteBtn: { padding: 4 },
  resetPasscodeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 10, paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '12', borderWidth: 1, borderColor: t.accent + '30',
  },
  resetPasscodeText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.accent },

  disableBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 16,
    borderWidth: 1, borderColor: t.danger + '40',
    borderRadius: Tokens.radius.card, paddingVertical: 14,
  },
  disableBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600', color: t.danger },
  sizeWarning: {
    fontSize: Type.caption2.fontSize,
    color: Colors.warningLabel,
    marginTop: -6,
    marginBottom: 10,
    fontStyle: 'italic',
  },

  weeklyUpdateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.accent + '25',
    padding: 14,
  },
  weeklyUpdateIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  weeklyUpdateTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text, marginBottom: 2 },
  weeklyUpdateSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 16 },
  weeklyUpdateArrow: { fontSize: Type.title2.fontSize, color: t.textMuted, paddingHorizontal: 4 },

  unreadPill: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: t.danger,
    paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center',
    marginRight: 4,
  },
  unreadPillTxt: { color: '#fff', fontWeight: '800', fontSize: Type.caption2.fontSize },

  previewWeeklyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 10, paddingVertical: 11, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '12',
    borderWidth: 1, borderColor: t.accent + '30',
  },
  previewWeeklyBtnText: { color: t.accent, fontSize: Type.footnote.fontSize, fontWeight: '700' },
});
