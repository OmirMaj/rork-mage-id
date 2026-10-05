// CreateMenu — the "+ New…" bottom sheet that surfaces every creatable
// thing in the app with a 1-line plain-English subtitle.
//
// Inspired by Notion's `/` slash command + Linear's `Cmd+K` palette.
// Why this matters: audit found that even after the design refresh,
// users had no way to discover features they didn't know existed (e.g.,
// "I had no idea I could create an OAC meeting from this app"). A
// single bottom-sheet listing every creatable entity with a one-line
// description is the mobile analog to the desktop command palette and
// the cheapest possible feature-discoverability surface.
//
// Triggered by the (+) button on the home screen. Search box at top
// filters in real time. Tapping a row routes to the relevant screen
// in "create" mode.
//
// Each entry: icon + plain-English label + 1-sentence description +
// optional "Pro" / "Business" tier chip.
//
// One of four rendered navigation surfaces; utils/featureRegistry.ts is the
// source they all name. A row that has a registry entry declares `feature`,
// and its DESTINATION and TIER CHIP are read from there. This sheet kept its
// own `tier` field until 2026-09-07 and it had rotted in the direction that
// costs the most: Submittal, Sub COI (both Business), and Estimate, Photo /
// markup, Client portal invite, Lien Waiver, Cash Flow setup (all Pro) showed
// NO chip, so a free tester tapped through and hit a full paywall the chip
// exists to warn about. `tier` survives only for the rows with no registry
// entry — the param-carrying create routes (/bill-from-estimate,
// /scope-sheet, /schedule-wizard?scratch=1, /copilot?capabilityId=…) that are
// modes of a screen rather than destinations of their own.

import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated, Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform,
  useWindowDimensions,
  type NativeSyntheticEvent, type TextInputKeyPressEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Search, X, ChevronRight, ChevronLeft, FolderPlus,
  Camera,
  ScrollText, Footprints, Users, Mail, Shield, BookOpen, UserPlus, Gavel,
  Wallet, Ruler, FileCheck, Zap, Mic, PenTool,
  Clock, Truck, ShieldCheck, CalendarCheck, Plus, HardHat,
} from 'lucide-react-native';
import {
  MageAIMark, MageEstimate, MageSchedule, MageInvoice, MageChangeOrder, MagePayApp,
  MageDailyReport, MagePunch, MageRFI, MageSubmittal, MagePlans, MageCOI,
} from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { featureFor, type FeatureId } from '@/utils/featureRegistry';
import { REQUIRED_TIER } from '@/utils/featureTiers';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens, Layout, Shadow } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { useIsDesktopWeb, useDesktopShellInset } from '@/components/ui/desktop';
import { useRiseOnOpen, useSwapFade, webMotion } from '@/components/ui';
import { ToolGlyph, ToolGroupHeader, ToolLockTag, toolListStyles, TOOL_CHEVRON_SIZE, TOOL_CHEVRON_OPACITY } from '@/components/ui/toolList';
import { useSheetDialogScope } from '@/components/ui/Sheet';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { movePaletteSelection } from '@/utils/paletteRows';
import { pickDefaultProjectId } from '@/utils/defaultProjectId';
import { statusLabel } from '@/utils/projectStage';
import { alwaysPicksJob, fieldGroupFirst, moneyRowsHidden, newJobThenFor, pickerRank, sortJobsForPicker, type NewJobThen } from '@/utils/uxDoors';
import { SOURCE_PROJECT, UX_PARAM, subPortalSetupHref } from '@/utils/uxRoutes';

interface CreateOption {
  /** Human label (plain English). */
  label: string;
  /** One-sentence description. */
  subtitle: string;
  /** Lucide icon. */
  /** Accepts lucide icons AND the bespoke Mage glyph set. Widened for the
   *  same reason as components/DesktopSidebar.tsx:39 — the narrow type is
   *  what forced the `MageAIMark as unknown as LucideIcon` cast below and
   *  kept every other bespoke mark off the primary create surface. */
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  /** Route to push when tapped. When `feature` is set this must equal
   *  featureFor(feature).route — scripts/validate-nav-coverage.ts asserts it,
   *  and the push itself uses the registry route. The literal stays because
   *  scripts/validate-feature-search.ts greps this file for route strings to
   *  prove sidebar destinations are reachable on a phone. */
  href: string;
  /** The registry row this creates into, when the destination is one. Owns
   *  the tier chip. */
  feature?: FeatureId;
  /** Optional category for grouping. */
  category: 'project' | 'money' | 'docs' | 'field' | 'people' | 'tools';
  /** Tier chip for the rows with NO registry entry only. Ignored when
   *  `feature` is set — that would be the second copy of the gate again. */
  tier?: 'pro' | 'business';
  /** Search keywords beyond the label. */
  keywords?: string[];
  /** True when the destination screen needs a `projectId`. Pre-audit
   *  these routed bare and dead-ended on a "pick a project" empty state;
   *  now we interpose an in-sheet project picker and pass `projectId`. */
  scoped?: boolean;
  /** Name of the route param the destination reads the project id from.
   *  Defaults to `projectId`; a few screens read `id` instead — passing
   *  the wrong name re-creates the dead-end the picker is meant to fix. */
  param?: string;
  /** Static extra params merged into the route (e.g. `{ type:'progress' }`). */
  extraParams?: Record<string, string>;
  /** After the job, ask which sub (UX wave D3): the destination needs a
   *  `subId` too, and without one it dead-ends on "Project or sub not found". */
  subPicker?: boolean;
}

const OPTIONS: CreateOption[] = [
  // Project-level
  { label: 'Start by voice', subtitle: 'Say the project out loud and MAGE sets it up', Icon: Mic, href: '/copilot?capabilityId=new_project', category: 'project', keywords: ['voice', 'dictate', 'speak', 'talk', 'ai', 'copilot', 'new', 'job'] },
  { label: 'Project', subtitle: 'Start a new project from scratch', Icon: FolderPlus, href: '/?openCreate=1', category: 'project', keywords: ['job', 'new'] },
  { label: 'Estimate', subtitle: 'Build a line-item quote with materials + labor', Icon: MageEstimate, href: '/estimate-wizard', feature: 'estimate-wizard', category: 'project', scoped: true },
  { label: 'Schedule', subtitle: 'Plan tasks with a Gantt or Today list', Icon: MageSchedule, href: '/schedule-wizard?scratch=1', category: 'project', scoped: true },
  { label: 'Lead', subtitle: 'Capture a client inquiry — voice or form', Icon: UserPlus, href: '/leads', feature: 'leads', category: 'project', keywords: ['pipeline', 'sales'] },
  { label: 'Lead by voice', subtitle: 'Say what the client told you — MAGE files the lead', Icon: Mic, href: '/copilot?capabilityId=lead', category: 'project', keywords: ['voice', 'dictate', 'sales', 'inquiry', 'homeowner', 'copilot'] },

  // Money
  { label: 'Quick Quote', subtitle: 'Fast bid for a small project', Icon: Zap, href: '/quick-quote', feature: 'quick-quote', category: 'money', keywords: ['quote', 'fast', 'bid', 'proposal', 'small job'] },
  { label: 'Invoice', subtitle: 'Bill the client for completed work', Icon: MageInvoice, href: '/invoice', feature: 'invoice', category: 'money', scoped: true },
  { label: 'Change Order', subtitle: 'Add scope or cost on top of the contract', Icon: MageChangeOrder, href: '/change-order', feature: 'change-order', category: 'money', keywords: ['co'], scoped: true },
  // "Progress draw", not "Progress Billing, AIA G702/G703" — the GC's word
  // (UX wave D3). The AIA words stay searchable.
  { label: 'Progress draw', subtitle: 'Bill the next draw — AIA-style G702/G703', Icon: MagePayApp, href: '/bill-from-estimate', category: 'money', keywords: ['aia', 'pay app', 'g702', 'g703', 'progress billing', 'draw'], scoped: true, extraParams: { type: 'progress' } },
  { label: 'Buyout package', subtitle: 'Send a trade out for sub bids', Icon: Gavel, href: '/buyout', feature: 'buyout', category: 'money', keywords: ['subs', 'sub bids', 'awards'], scoped: true },
  { label: 'Scope Sheet', subtitle: 'AI inclusions & exclusions from your estimate', Icon: FileCheck, href: '/scope-sheet', category: 'docs', keywords: ['scope', 'inclusions', 'exclusions', 'clarifications', 'assumptions', 'sow'], scoped: true },
  { label: 'Lien Waiver', subtitle: 'Sub sign-off — proof they\'ve been paid', Icon: ScrollText, href: '/lien-waivers', feature: 'lien-waivers', category: 'money', keywords: ['waiver', 'release'], scoped: true },

  // Field — the site's own rows (UX wave D3). Each is gated like its
  // destination through the registry `feature` (the lock chip), and carries
  // the route contract's flag (utils/uxRoutes) so the screen opens on the
  // action, not on a list.
  { label: 'Daily Report', subtitle: 'What got done today on site', Icon: MageDailyReport, href: '/daily-report', feature: 'daily-report', category: 'field', keywords: ['dfr', 'log'], scoped: true },
  { label: 'Punch Item', subtitle: 'Something to fix before final walkthrough', Icon: MagePunch, href: '/punch-list', feature: 'punch-list', category: 'field', keywords: ['punch list'], scoped: true },
  { label: 'Clock in', subtitle: 'Clock the crew in on this project', Icon: Clock, href: '/time-tracking', feature: 'time-tracking', category: 'field', keywords: ['time', 'crew', 'hours', 'timesheet', 'payroll'], scoped: true, extraParams: { [UX_PARAM.clockIn]: '1' } },
  { label: 'Delivery arrived', subtitle: 'A truck showed up — log it with the ticket', Icon: Truck, href: '/deliveries', feature: 'deliveries', category: 'field', keywords: ['delivery', 'material', 'truck', 'ticket', 'received', 'supplier'], scoped: true, extraParams: { [UX_PARAM.arrived]: '1' } },
  { label: 'Code check', subtitle: 'Check the work against code for this project', Icon: ShieldCheck, href: '/(tabs)/construction-ai', feature: 'construction-ai', category: 'field', keywords: ['code', 'inspection', 'inspector', 'building code'], scoped: true, extraParams: { [UX_PARAM.source]: SOURCE_PROJECT } },
  { label: 'Send lineup', subtitle: 'Text tomorrow\'s lineup to the crew and subs', Icon: CalendarCheck, href: '/tomorrow-lineup', feature: 'tomorrow-lineup', category: 'field', keywords: ['lineup', 'tomorrow', 'crew text', 'dispatch'], scoped: true },

  // Documentation
  { label: 'RFI', subtitle: 'Ask the architect a formal question', Icon: MageRFI, href: '/rfi', feature: 'rfi', category: 'docs', keywords: ['request for information'], scoped: true },
  { label: 'Submittal', subtitle: 'Send a product spec for architect approval', Icon: MageSubmittal, href: '/submittal', feature: 'submittal', category: 'docs', scoped: true },
  { label: 'Selection', subtitle: 'Lock in a tile, fixture, or finish', Icon: PenTool, href: '/selections', feature: 'selections', category: 'docs', scoped: true },
  { label: 'Photo / markup', subtitle: 'Capture site photo, draw on it', Icon: Camera, href: '/photo-triage', feature: 'photo-triage', category: 'field', keywords: ['picture'], scoped: true },
  { label: 'Plan / drawing', subtitle: 'Upload a PDF set, mark it up', Icon: MagePlans, href: '/plans', feature: 'plans', category: 'docs', keywords: ['blueprint'], scoped: true },
  { label: 'Permit', subtitle: 'Track issued permits and inspections', Icon: Shield, href: '/permits', feature: 'permits', category: 'docs', scoped: true },
  { label: 'Sub COI', subtitle: 'Add a subcontractor\'s insurance certificate', Icon: MageCOI, href: '/coi-vault', feature: 'coi-vault', category: 'docs', keywords: ['certificate', 'insurance'] },

  // People & meetings
  { label: 'OAC Meeting', subtitle: 'The owner-architect-contractor weekly', Icon: Users, href: '/oac-meeting', feature: 'oac-meeting', category: 'people', keywords: ['meeting'], scoped: true },
  { label: 'Client portal invite', subtitle: 'Give the client read access', Icon: Mail, href: '/client-portal-setup', feature: 'client-portal', category: 'people', scoped: true, param: 'id' },
  { label: 'Sub portal invite', subtitle: 'Give a sub a private upload link', Icon: Mail, href: '/sub-portal-setup', category: 'people', scoped: true, subPicker: true },

  // Closeout
  { label: 'Handover Checklist', subtitle: 'The walkthrough-day checklist', Icon: Footprints, href: '/handover', feature: 'handover', category: 'docs', scoped: true },
  { label: 'Closeout Binder', subtitle: 'The PDF packet you give the client', Icon: BookOpen, href: '/closeout-binder', feature: 'closeout-binder', category: 'docs', scoped: true },

  // Tools
  { label: 'Cash Flow setup', subtitle: 'Forecast the next 12 weeks of money', Icon: Wallet, href: '/cash-flow', feature: 'cash-flow', category: 'tools', scoped: true },
  // AI Takeoff is a metered free demo (aiTakeoff freeLifetimeCap=1), NOT a
  // Pro-locked feature — the /takeoff screen has no canAccess gate, it only
  // meters via checkAILimit and gives free users 1 lifetime trial. Every
  // other entry point (the Estimator tab CTAs) routes here ungated, so the
  // Create menu must NOT paint a Pro lock chip on it or the same feature has
  // two contradictory doors. The Pro wall lives one step later, on
  // "Convert to estimate" (takeoff-estimate.tsx), where it belongs. That
  // invariant now lives where it belongs too: the registry's `takeoff` row
  // carries no `requires`, and scripts/validate-nav-coverage.ts asserts it.
  { label: 'AI Takeoff', subtitle: 'Upload plans, get LF / SF / EA quantities', Icon: Ruler, href: '/takeoff', feature: 'takeoff', category: 'tools', keywords: ['quantity', 'measure', 'takeoff', 'plans'] },
  { label: 'AI Drawing Estimate', subtitle: 'Upload plans, get a priced starting estimate', Icon: MageAIMark, href: '/drawing-analyzer', category: 'tools', tier: 'pro', keywords: ['estimate', 'plans', 'drawings'] },
];

/** Every creatable thing, in display order — the desktop Cmd+K palette's
 *  Actions lane reads the same rows (components/search/CommandPalette). */
export type { CreateOption };
export const CREATE_OPTIONS: readonly CreateOption[] = OPTIONS;

const CATEGORY_LABELS: Record<CreateOption['category'], string> = {
  project: 'Start',
  money: 'Money',
  docs: 'Documents',
  field: 'Field',
  people: 'People',
  tools: 'Tools',
};

/** The list-first screens on desktop web (wave 6c, lanes G/H): a "New …"
 *  from this menu adds `new=1` so the create form opens over the log. */
const LIST_FIRST_HREFS: ReadonlySet<string> = new Set(['/rfi', '/submittal', '/change-order', '/invoice', '/daily-report']);
/** On a phone (UX wave D3): "+ > Punch item" opens the Add form, not the
 *  list — the route contract's `new=1` (utils/uxRoutes punchListNewHref). */
const PHONE_NEW_HREFS: ReadonlySet<string> = new Set(['/punch-list']);

/** The routes this menu can open that app/_layout.tsx presents as
 *  `presentation: 'modal'`. iOS cannot present one while this sheet is still
 *  dismissing, so only these wait for the sheet to go (onDismiss on iOS, the
 *  old 280 ms gap elsewhere); every other row navigates at once, with no dead
 *  beat. scripts/validate-smooth-shell.ts keeps this in step with the layout. */
const MODAL_ROUTES: ReadonlySet<string> = new Set(['/estimate-wizard', '/schedule-wizard', '/copilot', '/quick-quote']);

/** The route path of an href, without its query string. */
function routePath(href: string): string {
  const q = href.indexOf('?');
  return q === -1 ? href : href.slice(0, q);
}

/** Where a row goes. Registry route wins so a stale literal cannot misroute
 *  anyone in the window before ship-check next runs. */
function createHref(opt: CreateOption): string {
  return opt.feature ? featureFor(opt.feature).route : opt.href;
}

/** Push a job-scoped create destination for `projectId` — the one push both
 *  this menu (inside go(), below) and the desktop Cmd+K palette use.
 *  Desktop web only (wave 6c): the five project logs open LIST-first there
 *  (lanes G/H), so "New RFI" must say so — `new=1` opens the create form over
 *  the log. A phone keeps today's params exactly. */
export function pushCreateOption(
  router: Pick<ReturnType<typeof useRouter>, 'push'>,
  opt: CreateOption,
  projectId: string,
  desktopWeb: boolean,
): void {
  const opensCreate = desktopWeb && LIST_FIRST_HREFS.has(opt.href);
  const opensPhoneAdd = !desktopWeb && PHONE_NEW_HREFS.has(opt.href);
  router.push({
    pathname: createHref(opt) as never,
    // Most screens read `projectId`; a few read `id`. Passing the
    // wrong name re-creates the exact dead-end the picker fixes.
    params: {
      [opt.param ?? 'projectId']: projectId, ...(opt.extraParams ?? {}), ...(opensCreate ? { new: '1' } : {}),
      ...(opensPhoneAdd ? { [UX_PARAM.newItem]: '1' } : {}),
    },
  } as never);
}

/** Push a create destination that needs no job (Lead, Quick Quote, Sub COI,
 *  the home create modal …) — this menu's unscoped rows and the palette's. */
export function pushUnscopedCreateOption(router: Pick<ReturnType<typeof useRouter>, 'push'>, opt: CreateOption): void {
  router.push(createHref(opt) as never);
}

/** Keep `v` within [lo, hi] (lo wins when the window is too small for both). */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

export interface CreateMenuProps {
  visible: boolean;
  onClose: () => void;
  /** Optional handler for the "Project" entry — if set, called instead
   *  of routing. Lets the host (typically the home tab) open its
   *  create-project modal in place. `then` (UX wave D1) is the wizard the
   *  "+ New job" row of Estimate / Schedule asks for once the job exists;
   *  a host that ignores it still opens its create modal. */
  onCreateProject?: (then?: NewJobThen | null) => void;
  /** Desktop web only: the popover's top-left corner in window px (the
   *  sidebar's '+' passes its right edge + Layout.menu.offset). Omitted or
   *  null: the popover is centred in the content column, 12% down. */
  anchor?: { x: number; y: number } | null;
  /** Desktop web only: create for the active job without the project picker
   *  (default true). The header's 'Change' falls back to the picker. */
  activeJob?: boolean;
}

function CreateMenuImpl({ visible, onClose, onCreateProject, anchor = null, activeJob = true }: CreateMenuProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // The sub step's two reads may be absent under a host that provides only
  // `projects` (the phone snapshot harness), so both are read defensively.
  const projectsCtx = useProjects();
  const { projects } = projectsCtx;
  const { isProOrAbove, isBusinessOrAbove } = useTierAccess();
  // A locked row keeps working (tapping still routes → the screen's own
  // Paywall is the real gate) — the chip just sets expectations so a free
  // tester sees "Business" before tapping instead of hitting a full wall.
  const lockedTier = useCallback((opt: CreateOption): 'pro' | 'business' | null => {
    // Registry first: the chip must name the wall the destination actually
    // enforces, not a second opinion maintained in this file.
    const requires = opt.feature ? featureFor(opt.feature).requires : undefined;
    const needs = requires ? REQUIRED_TIER[requires] : opt.tier;
    if (needs === 'business' && !isBusinessOrAbove) return 'business';
    if (needs === 'pro' && !isProOrAbove) return 'pro';
    return null;
  }, [isProOrAbove, isBusinessOrAbove]);

  /** Where a row goes. Registry route wins so a stale literal cannot misroute
   *  anyone in the window before ship-check next runs. */
  const hrefFor = useCallback((opt: CreateOption) => createHref(opt), []);
  const [query, setQuery] = useState('');
  // When set, the sheet swaps from the create list to an in-sheet project
  // picker for this scoped option. Swapping content (vs. opening a nested
  // Modal) sidesteps the iOS "can't present two modals back-to-back" bug.
  const [pickFor, setPickFor] = useState<CreateOption | null>(null);
  // Desktop web: 'Change' in the header — pick the job per row again instead
  // of creating for the active job.
  const [pickJob, setPickJob] = useState(false);
  // UX wave D3: "Sub portal invite" asks which sub once the job is known, so
  // the invite screen always gets a real subId.
  const [subFor, setSubFor] = useState<{ opt: CreateOption; projectId: string } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return OPTIONS;
    return OPTIONS.filter(o => {
      if (o.label.toLowerCase().includes(q)) return true;
      if (o.subtitle.toLowerCase().includes(q)) return true;
      if (o.keywords?.some(k => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query]);

  const handleClose = useCallback(() => {
    setQuery('');
    setPickFor(null);
    setPickJob(false);
    setSubFor(null);
    onClose();
  }, [onClose]);

  // Navigation that must wait for the sheet to finish dismissing (a modal
  // route, or the host's own create-project Modal). Run exactly once, by
  // whichever comes first: the Modal's onDismiss (iOS; RN-web too) or the
  // timeout (Android has no onDismiss; on iOS it is only a backstop).
  const pendingNav = useRef<(() => void) | null>(null);
  const runPending = useCallback(() => {
    const nav = pendingNav.current;
    pendingNav.current = null;
    nav?.();
  }, []);
  const go = useCallback((presentsModal: boolean, nav: () => void) => {
    if (!presentsModal) {
      // A pushed screen slides in under the fading sheet: no dead beat.
      nav();
      handleClose();
      return;
    }
    pendingNav.current = nav;
    handleClose();
    setTimeout(runPending, Platform.OS === 'ios' ? 600 : 280);
  }, [handleClose, runPending]);

  // Route to a scoped screen with the chosen project (go() above decides
  // whether it waits for the sheet to dismiss).
  // Desktop web only (wave 6c): the five project logs open LIST-first there
  // (lanes G/H), so "New RFI" must say so — `new=1` opens the create form
  // over the log. A phone keeps today's params exactly.
  const desktopWeb = useIsDesktopWeb();
  const isDesktopWeb = desktopWeb;
  const routeScoped = useCallback((opt: CreateOption, projectId: string) => {
    go(MODAL_ROUTES.has(routePath(hrefFor(opt))), () => {
      pushCreateOption(router, opt, projectId, desktopWeb);
    });
  }, [go, router, hrefFor, desktopWeb]);

  // The open menu is a dialog to the shortcut registry (hooks/useHotkeys): a
  // page-scope Esc behind it (a SplitView record) stays put, and the Modal's
  // own onRequestClose closes the menu once. A no-op off desktop web.
  useSheetDialogScope(visible);

  // Desktop web: the job the GC is in. A job-scoped row creates for it at
  // once (no picker), until he presses 'Change'.
  // Phone (UX wave D3): the same, from pickDefaultProjectId — the route /
  // real pick / recent job, NEVER the "most recently updated in-progress"
  // guess (that is fine for a sidebar highlight, not for a daily log or
  // payroll hours). No safe default → the picker, as before.
  const { activeProject, activeProjectId, recentProjectIds } = useActiveProject();
  const phoneDefaultJob = useMemo(() => {
    if (isDesktopWeb) return null;
    const pid = pickDefaultProjectId({ activeProjectId, recentProjectIds, projects });
    return pid ? projects.find(p => p.id === pid) ?? null : null;
  }, [isDesktopWeb, activeProjectId, recentProjectIds, projects]);
  const defaultJob = isDesktopWeb ? (activeJob ? activeProject : null) : phoneDefaultJob;
  const jobShortcut = defaultJob && !pickJob ? defaultJob : null;
  // Every picker lists live jobs first (the one he last touched on top),
  // completed then closed jobs last (D1: a closed job is never the top row).
  const sortedProjects = useMemo(() => sortJobsForPicker(projects, recentProjectIds ?? []), [projects, recentProjectIds]);

  // Group by category, preserving display order from the source array.
  // D3: the Field group floats to the top before 11 am on a weekday, or when
  // the job he is creating for makes him the field role — who never sees the
  // money rows (canViewFinancials: the field role is blinded from money).
  const defaultRole = (defaultJob as { myRole?: string } | null)?.myRole ?? null;
  // No default job: hide Money when every job he could pick makes him field.
  const hideMoney = useMemo(() => moneyRowsHidden(defaultRole, projects.map(p => p.myRole ?? null)), [defaultRole, projects]);
  const grouped = useMemo(() => {
    const out: Array<{ key: CreateOption['category']; label: string; items: CreateOption[] }> = [];
    const order: CreateOption['category'][] = fieldGroupFirst(new Date(), defaultRole)
      ? ['field', 'project', 'money', 'docs', 'people', 'tools']
      : ['project', 'money', 'field', 'docs', 'people', 'tools'];
    for (const cat of order) {
      if (cat === 'money' && hideMoney) continue;
      const items = filtered.filter(f => f.category === cat);
      if (items.length === 0) continue;
      out.push({ key: cat, label: CATEGORY_LABELS[cat], items });
    }
    return out;
    // `visible` re-reads the clock each time the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, defaultRole, hideMoney, visible]);

  // A scoped row with its job: straight to the screen, or — for the sub
  // portal invite — on to the sub step first.
  const startScoped = useCallback((opt: CreateOption, projectId: string) => {
    if (opt.subPicker) {
      setPickFor(null);
      setSubFor({ opt, projectId });
      return;
    }
    routeScoped(opt, projectId);
  }, [routeScoped]);

  // D1: "+ New job" — Home's create modal, which then opens the wizard for
  // the new job (the same chain its "what next?" sheet runs).
  const startNewJob = useCallback((opt: CreateOption) => {
    const then = newJobThenFor(opt.label);
    go(true, () => {
      if (onCreateProject) onCreateProject(then);
      else router.push((then ? `/?openCreate=1&then=${then}` : '/?openCreate=1') as never);
    });
  }, [go, onCreateProject, router]);

  const handleSelect = useCallback((opt: CreateOption) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();

    // Scoped destinations need a projectId or they dead-end on a "pick a
    // project" empty state (the audit's #1 discovery failure). Interpose
    // a picker — but skip it when the choice is trivial/forced.
    if (opt.scoped) {
      // D1: Estimate, Schedule and Scope Sheet ALWAYS ask which job, with
      // "+ New job" first — a new lead must not land on the live job.
      const always = alwaysPicksJob(opt.label);
      if (jobShortcut && !always) {
        startScoped(opt, jobShortcut.id);
        return;
      }
      if (projects.length === 0) {
        handleClose();
        setTimeout(() => {
          showAlert(
            'Create a project first',
            `Add a project, then you can attach a ${opt.label.toLowerCase()} to it.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'New project',
                onPress: () => {
                  const then = newJobThenFor(opt.label);
                  if (onCreateProject) onCreateProject(then);
                  else router.push((then ? `/?openCreate=1&then=${then}` : '/?openCreate=1') as never);
                },
              },
            ],
          );
        }, 280);
        return;
      }
      if (projects.length === 1 && !always) {
        startScoped(opt, projects[0].id);
        return;
      }
      setPickFor(opt);
      return;
    }

    // "Project" routes via callback when a host provides one (typically
    // the home tab passing its own setShowCreateModal). Everything else
    // routes through expo-router. Both "Project" doors end in a Modal (the
    // host's, or the home tab's ?openCreate=1) and a modal route can't be
    // presented while this sheet dismisses (iOS), so those wait; the rest
    // go now.
    const href = hrefFor(opt);
    go(opt.label === 'Project' || MODAL_ROUTES.has(routePath(href)), () => {
      if (opt.label === 'Project' && onCreateProject) {
        onCreateProject();
      } else {
        pushUnscopedCreateOption(router, opt);
      }
    });
  }, [handleClose, go, router, onCreateProject, projects, startScoped, hrefFor, jobShortcut]);

  // Desktop web: arrow keys move a highlight over the rows in display order
  // and Enter creates the highlighted one (the JobSwitcher pattern). The
  // highlight belongs to the query it was set under, so typing resets it.
  const flatRows = useMemo(() => grouped.flatMap(g => g.items), [grouped]);
  const [hl, setHl] = useState<{ q: string; i: number }>({ q: '', i: 0 });
  const highlight = hl.q === query ? Math.min(hl.i, Math.max(flatRows.length - 1, 0)) : 0;
  const onKeyNav = useCallback((e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = e.nativeEvent.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    e.preventDefault?.();
    setHl({ q: query, i: movePaletteSelection(highlight, key === 'ArrowDown' ? 1 : -1, flatRows.length) });
  }, [query, highlight, flatRows.length]);
  const runHighlighted = useCallback(() => {
    const opt = flatRows[highlight];
    if (opt) handleSelect(opt);
  }, [flatRows, highlight, handleSelect]);

  // Desktop web: a popover (Layout.sheet.form wide) at the caller's anchor,
  // clamped into the window, or centred in the content column 12% down.
  const { width: winW, height: winH } = useWindowDimensions();
  const shellInset = useDesktopShellInset(visible);
  const popoverMaxH = Math.round(winH * 0.7);
  const popoverPos = anchor
    ? {
        left: clamp(anchor.x, Layout.gutter, winW - Layout.sheet.form - Layout.gutter),
        top: clamp(anchor.y, Layout.gutter, winH - popoverMaxH - Layout.gutter),
      }
    : {
        left: Math.max(Layout.gutter, Math.round(shellInset + (winW - shellInset - Layout.sheet.form) / 2)),
        top: Math.round(winH * 0.12),
      };
  // The list scrolls inside the popover: its cap less the header + search.
  const listDesktop = { maxHeight: Math.max(popoverMaxH - 116, Layout.control.row * 3) };

  // The scrim fades (never slides up with the card); the card rises the last
  // few points into place on a phone and pops in on desktop web, and the
  // list ↔ project-picker swap crossfades. All null at rest and under Reduce
  // Motion (rise is null on web; swap is opacity only, so it cannot clash
  // with rise's translateY).
  const rise = useRiseOnOpen(visible);
  const swap = useSwapFade(subFor ? 'sub' : pickFor?.label ?? 'list');

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
      onDismiss={runPending}
      statusBarTranslucent
    >
      <TouchableOpacity style={[styles.backdrop, isDesktopWeb && styles.backdropDesktop]} activeOpacity={1} onPress={handleClose} />
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }, isDesktopWeb && styles.sheetDesktop, isDesktopWeb && popoverPos, desktopWeb ? webMotion('popIn') : rise, swap]}>
        {isDesktopWeb ? null : <View style={styles.handle} />}

        {subFor ? (
          <>
            {/* D3: the sub step — only real subs are offered, so the invite
                screen never reaches "Project or sub not found". Subs already
                under contract on this job come first. */}
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={() => setSubFor(null)} style={styles.closeBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
                <ChevronLeft size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
              <Text style={[Type.title2, { color: themeColors.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                {subFor.opt.label} → which sub?
              </Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={[{ maxHeight: '70%' as any }, isDesktopWeb && listDesktop]} showsVerticalScrollIndicator={false}>
              {(() => {
                const subs = (projectsCtx.subcontractors as typeof projectsCtx.subcontractors | undefined) ?? [];
                const commitmentsFor = projectsCtx.getCommitmentsForProject as typeof projectsCtx.getCommitmentsForProject | undefined;
                const onJob = new Set(
                  (commitmentsFor?.(subFor.projectId) ?? [])
                    .map(c => c.subcontractorId)
                    .filter((x): x is string => typeof x === 'string' && x.length > 0),
                );
                const ordered = [...subs.filter(sb => onJob.has(sb.id)), ...subs.filter(sb => !onJob.has(sb.id))];
                if (ordered.length === 0) {
                  return (
                    <View style={styles.emptyResult} testID="createmenu-no-subs">
                      <Text style={[Type.subhead, { color: themeColors.textSecondary, textAlign: 'center' }]}>
                        No subs yet. Add the sub first, then send the invite.
                      </Text>
                      <TouchableOpacity
                        style={[styles.row, { justifyContent: 'center' }]}
                        onPress={() => go(false, () => router.push('/(tabs)/subs' as never))}
                        accessibilityRole="button"
                        testID="createmenu-add-sub"
                      >
                        <Plus size={16} color={themeColors.accent} strokeWidth={2} />
                        <Text style={[Type.headline, { color: themeColors.accent }]}>Add a sub</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }
                return ordered.map(sb => (
                  <TouchableOpacity
                    key={sb.id}
                    style={[styles.row, isDesktopWeb && styles.rowDesktop]}
                    onPress={() => {
                      const pid = subFor.projectId;
                      go(false, () => router.push(subPortalSetupHref(pid, sb.id)));
                    }}
                    activeOpacity={0.55}
                    testID={`createmenu-pick-sub-${sb.id}`}
                  >
                    <ToolGlyph Icon={HardHat} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[Type.headline, { color: themeColors.text }]} numberOfLines={1}>{sb.companyName}</Text>
                      <Text style={[Type.footnote, { color: themeColors.textSecondary }]} numberOfLines={1}>
                        {[onJob.has(sb.id) ? 'On this project' : null, sb.trade, sb.contactName].filter(Boolean).join(' · ') || 'Sub'}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                ));
              })()}
            </ScrollView>
          </>
        ) : pickFor ? (
          <>
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={() => setPickFor(null)} style={styles.closeBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
                <ChevronLeft size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
              <Text style={[Type.title2, { color: themeColors.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                {pickFor.label} → which project?
              </Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            <ScrollView style={[{ maxHeight: '70%' as any }, isDesktopWeb && listDesktop]} showsVerticalScrollIndicator={false}>
              {/* D1: for Estimate, Schedule and Scope Sheet the first row is
                  a NEW job, so a new lead never lands on the live one. */}
              {alwaysPicksJob(pickFor.label) ? (
                <TouchableOpacity
                  style={[styles.row, isDesktopWeb && styles.rowDesktop]}
                  onPress={() => { if (pickFor) startNewJob(pickFor); }}
                  activeOpacity={0.55}
                  accessibilityRole="button"
                  testID="createmenu-new-job"
                >
                  <ToolGlyph Icon={Plus} color={themeColors.accentLabel} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[Type.headline, { color: themeColors.accent }]} numberOfLines={1}>
                      {defaultJob ? 'New project instead' : 'New project'}
                    </Text>
                    <Text style={[Type.footnote, { color: themeColors.textSecondary }]} numberOfLines={1}>
                      {newJobThenFor(pickFor.label) ? `Set up the project, then its ${pickFor.label.toLowerCase()}` : 'Set up the project first'}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              ) : null}
              {(() => {
                // The current job (when it is still open) leads, titled with
                // the row it creates: "Estimate for Henderson".
                const lead = defaultJob && pickerRank(defaultJob.status) === 0 && alwaysPicksJob(pickFor.label) ? defaultJob : null;
                const list = lead ? [lead, ...sortedProjects.filter(p => p.id !== lead.id)] : sortedProjects;
                return list.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.row, isDesktopWeb && styles.rowDesktop]}
                    onPress={() => { if (pickFor) startScoped(pickFor, p.id); }}
                    activeOpacity={0.55}
                    testID={`createmenu-pick-project-${p.id}`}
                  >
                    <ToolGlyph Icon={FolderPlus} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[Type.headline, { color: themeColors.text }]} numberOfLines={1}>
                        {lead && p.id === lead.id ? `${pickFor.label} for ${p.name}` : p.name}
                      </Text>
                      <Text style={[Type.footnote, { color: themeColors.textSecondary }]} numberOfLines={1}>
                        {lead && p.id === lead.id ? `Current project · ${statusLabel(p.status)}` : statusLabel(p.status)}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                ));
              })()}
            </ScrollView>
          </>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={[Type.title2, { color: themeColors.text }]}>Create new…</Text>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
            </View>

            {/* Desktop: the active job. Phone (D3): the safe default job —
                "For Henderson · Change". */}
            {defaultJob ? (
              <View style={styles.jobBar} testID="createmenu-job-bar">
                <Text style={[Type.footnote, styles.jobBarText]} numberOfLines={1}>
                  {pickJob ? 'Pick the job for each item' : `For ${defaultJob.name}`}
                </Text>
                <Text style={[Type.footnote, styles.jobBarText]}>·</Text>
                <TouchableOpacity
                  onPress={() => setPickJob(p => !p)}
                  accessibilityRole="button"
                  accessibilityLabel={pickJob ? `Create for ${defaultJob.name}` : 'Change the job'}
                  {...(isDesktopWeb ? null : { hitSlop: 8 })}
                  testID="createmenu-change-job"
                >
                  <Text style={[Type.footnote, styles.jobBarAction]}>{pickJob ? `Use ${defaultJob.name}` : 'Change'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.searchRow}>
              <Search size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              <TextInput
                style={[styles.searchInput, Type.body]}
                placeholder="Search for anything you can create…"
                placeholderTextColor={themeColors.textMuted}
                value={query}
                onChangeText={setQuery}
                autoFocus={false}
                {...(isDesktopWeb ? { autoFocus: true, onKeyPress: onKeyNav, onSubmitEditing: runHighlighted } : null)}
                returnKeyType="search"
              />
              {!!query && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={[{ maxHeight: '70%' as any }, isDesktopWeb && listDesktop]} showsVerticalScrollIndicator={false}>
              {grouped.length === 0 && (
                <View style={styles.emptyResult}>
                  <Text style={[Type.subhead, { color: themeColors.textSecondary, textAlign: 'center' }]}>
                    No matches. Try &ldquo;invoice&rdquo;, &ldquo;rfi&rdquo;, &ldquo;buyout&rdquo;…
                  </Text>
                </View>
              )}
              {grouped.map(g => (
                <View key={g.key} style={styles.group}>
                  {/* Plain trade: a title block per group (sheet letter, name,
                      how many things it holds), then bare rows. */}
                  <ToolGroupHeader index={g.label.charAt(0).toUpperCase()} label={g.label} count={g.items.length} style={styles.groupHeader} />
                  {g.items.map(opt => (
                    <TouchableOpacity
                      key={opt.label}
                      style={[styles.row, isDesktopWeb && styles.rowDesktop, isDesktopWeb && flatRows[highlight] === opt && styles.rowHighlightDesktop]}
                      onPress={() => handleSelect(opt)}
                      activeOpacity={0.55}
                      testID={`create-${opt.label.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <ToolGlyph Icon={opt.Icon} locked={!!lockedTier(opt)} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowName} numberOfLines={1}>
                          {opt.label}
                        </Text>
                        <Text style={styles.rowDesc} numberOfLines={1}>
                          {opt.subtitle}
                        </Text>
                      </View>
                      {(() => {
                        const lt = lockedTier(opt);
                        return lt ? <ToolLockTag label={lt === 'pro' ? 'Pro' : 'Business'} /> : null;
                      })()}
                      {isDesktopWeb && jobShortcut && opt.scoped && !alwaysPicksJob(opt.label) ? (
                        <Text style={[Type.footnote, styles.rowJob]} numberOfLines={1}>{jobShortcut.name}</Text>
                      ) : null}
                      <ChevronRight size={TOOL_CHEVRON_SIZE} color={themeColors.textMuted} strokeWidth={1.75} style={styles.rowChevron} />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </Animated.View>
    </Modal>
  );
}

export const CreateMenu = memo(CreateMenuImpl);

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: t.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 0,
    paddingTop: 8,
    maxHeight: '85%' as any,
  },
  handle: {
    alignSelf: 'center',
    width: 36, height: 5,
    borderRadius: 3,
    backgroundColor: t.line,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.panel,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
  },
  searchInput: {
    flex: 1,
    color: t.text,
    padding: 0,
  },
  // Plain trade (components/ui/toolList.tsx): each group is a title block and
  // bare rows — no chip behind the glyph, a hairline between rows.
  group: { marginTop: 8, marginBottom: 8 },
  groupHeader: { marginHorizontal: 16 },
  // The row carries the 16 pt inset itself: the sub and job pickers reuse it
  // without a group around them.
  row: { ...toolListStyles(t).row, ...toolListStyles(t).rowTight, marginHorizontal: 16 },
  rowName: { ...toolListStyles(t).name, ...toolListStyles(t).nameTight },
  rowDesc: toolListStyles(t).desc,
  rowChevron: { opacity: TOOL_CHEVRON_OPACITY },
  emptyResult: {
    paddingVertical: 32,
    paddingHorizontal: 24,
  },

  // ── Desktop web: the popover (every entry gated `isDesktopWeb &&`) ──
  // A popover beside the sidebar, not a sheet across the page: a clear
  // backdrop (click-outside still closes), all four corners rounded, a heavy
  // float shadow, form width, at most 70% of the window tall.
  backdropDesktop: { backgroundColor: 'transparent' },
  sheetDesktop: {
    bottom: 'auto',
    right: 'auto',
    width: Layout.sheet.form,
    maxWidth: Layout.sheet.form,
    maxHeight: '70%',
    borderRadius: Tokens.radius.xl,
    borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl,
    paddingTop: Layout.rowGap + 4,
    paddingBottom: Layout.rowGap,
    overflow: 'hidden',
    ...Shadow.heavy,
  },
  rowDesktop: { paddingVertical: 0, minHeight: Layout.control.row },
  rowHighlightDesktop: { backgroundColor: t.surfaceAlt, marginHorizontal: 8, paddingHorizontal: 10 },
  rowJob: { color: t.textMuted, maxWidth: Layout.menu.minWidth / 2 },
  jobBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginTop: -4,
    marginBottom: 8,
  },
  jobBarText: { color: t.textSecondary, flexShrink: 1 },
  jobBarAction: { color: t.accent, fontWeight: '600' as const },
});
