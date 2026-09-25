import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import { usePathname, useRouter, type Href, type Route } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Home, Wrench, Settings, BarChart3,
  FileText, Building2, Search, HardHat, Gavel, Lock, IdCard,
  Wallet, MessageCircle, Camera, Inbox, TrendingUp,
  Users, ShieldCheck, Bell, Briefcase, BadgeCheck, Code,
  PenTool, Store, Clock, ChevronDown, ChevronRight,
  ScrollText, UserPlus, Handshake, ListChecks, FileSignature,
  Presentation, LayoutDashboard, Plus,
  PieChart, LineChart, Coins, BellRing,
  Scale, ScanEye, ScanLine, Mic, FileSearch, Target, Zap, Upload,
  CalendarClock, Truck, Megaphone, Newspaper, BookOpen,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react-native';
import {
  MageAIMark, MageProject, MageSummary, MageEstimate, MageSchedule,
  MageRFI, MageSubmittal, MagePayApp, MageChangeOrder, MageTakeoff,
  MagePunch, MageMargin, MagePlans, MageCostDb, MageEquipment,
  MageDailyReport, MageInvoice, MageContract,
} from '@/components/icons';
import { useSearch } from '@/contexts/SearchContext';
import { useCoreData } from '@/contexts/ProjectContext';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { HIRE_ENABLED } from '@/contexts/HireContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useClaimedCrewProfile } from '@/hooks/useClaimedCrewProfile';
import { featureFor, type FeatureId } from '@/utils/featureRegistry';
import {
  SIDEBAR_SECTIONS_KEY, jobScopedTarget, jobSwitchTarget, normalizeRoutePath, parseSectionState,
} from '@/utils/activeProject';
import { RowLink, routeHref, type RowLinkState } from '@/components/desktop/RowLink';
import { JobSwitcher } from '@/components/desktop/JobSwitcher';
import { CreateMenu } from '@/components/CreateMenu';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useSidebarRail } from '@/hooks/useSidebarRail';

interface NavItem {
  key: string;
  /** Rail label. Deliberately the sidebar's own, not the registry title: a
   *  240pt rail says "Plans" where the registry says "Plans & Drawings". */
  label: string;
  // Accepts lucide icons AND the bespoke MageAIMark (a plain function
  // component, so `typeof Home`'s ForwardRef type would reject it).
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  /** Where the row goes with no active job. Kept as a literal even though
   *  `feature` already names the destination, because
   *  scripts/validate-feature-search.ts:68 and its iOS-reachability pass grep
   *  this string out of the file — see the note in utils/featureRegistry.ts.
   *  scripts/validate-nav-coverage.ts asserts it equals featureFor(feature).route,
   *  so the two cannot disagree. Typed `Route`, so a typo is a tsc error. */
  route: Route;
  /** The job-scoped home, when it is a DIFFERENT screen from `route`. Only
   *  Schedule has one: its registry route is the Discover on-ramp, which lists
   *  every job's schedule and ignores `projectId`, while the schedule tab
   *  (app/(tabs)/schedule) honours it. Named `jobRoute`, never `route`, so the
   *  sidebar↔registry parity greps above do not read it as a destination. */
  jobRoute?: Route;
  section: string;
  /** The registry row this destination IS. The tier gate is read from it —
   *  there is deliberately no `requires` field here any more. The sidebar
   *  carried its own copy until 2026-09-07 and two had drifted:
   *  /plan-intelligence advertised ask_your_plans (Business) while
   *  app/plan-intelligence.tsx:61 enforces ai_estimate_wizard (Pro), so a Pro
   *  subscriber saw a lock on a feature they already owned; and
   *  /client-portal-setup carried no gate at all while the screen renders a
   *  Paywall on client_portal (:169), so the wall arrived unannounced.
   *  So is whether the row carries the active job: `projectScoped` on the
   *  registry row (utils/activeProject jobScopedTarget).
   *  Undefined only for rows with no registry entry (Direct Hire, Messages —
   *  both HIRE_ENABLED-gated and filtered out below). */
  feature?: FeatureId;
}

// ─── Information architecture (wave 6b, 2026-09-23) ───────────────────────
// The founder runs the web app on a 1512×945 laptop, and the rail it replaced
// had 65 rows with the project tools starting COLLAPSED below the fold — and
// none of them knew which job he was on: every project tool opened on a "Pick
// a project" list, the pick was forgotten on refresh and on the next tool, and
// "Recent" was just the first three rows of the project array.
//
// So the rail is re-tiered around the job:
//   Top          brand, Search (⌘K), the job switcher, + New
//   THIS JOB     always expanded — Overview and the seven tools a PM opens
//                every day — every row carries the active job
//   More for this job  (collapsed, saved) — the rest of the project tools
//   WORKSPACE    always expanded — the cross-job surfaces
//   RECENT       recently OPENED jobs (not the first rows of the list)
//   BUSINESS / FINANCE / SETUP & TOOLS  collapsed, open state saved
//   ACCOUNT      pinned to the bottom
// Rows are 32 px (down from 38). Measured on the founder's 1512×945 MacBook,
// where Chrome leaves a ~858 px viewport: the top block and all of THIS JOB
// (plus its "More for this job" toggle) fit with room to spare, but the nav
// scroll area ends near y=735, so a seventh WORKSPACE row (Construction News,
// until wave 6c) was clipped and BUSINESS / FINANCE / SETUP & TOOLS sit below
// the fold. Wave 6c moved Construction News into SETUP & TOOLS: WORKSPACE is
// six rows again and fully visible. Every destination the old rail had is still
// here — scripts/validate-nav-coverage.ts pins the full route list — it is the
// ORDER that changed, not the reach.
//
// Live counts beside RFIs / COs / punch items are wave 6c. Until they are
// computed from the same getters the project screens use, the rows show no
// number at all rather than a wrong one.
//
// This rail is one of four rendered nav surfaces; utils/featureRegistry.ts is
// the source they all name. A row owns its label, icon and section (rail
// voice); the destination, the tier gate and the job scoping come from
// `feature`.
const NAV_ITEMS: NavItem[] = [
  // ── THIS JOB — the daily tools, always expanded. Overview is rendered
  //    separately (it needs the job, and has no registry row).
  { key: 'schedule',          label: 'Schedule',         icon: MageSchedule,    route: '/(tabs)/discover/schedule',        jobRoute: '/(tabs)/schedule', section: 'THIS JOB', feature: 'schedule' },
  { key: 'daily-report',      label: 'Daily Reports',    icon: MageDailyReport, route: '/daily-report',                     section: 'THIS JOB', feature: 'daily-report' },
  { key: 'rfi',               label: 'RFIs',             icon: MageRFI,         route: '/rfi',                              section: 'THIS JOB', feature: 'rfi' },
  { key: 'submittal',         label: 'Submittals',       icon: MageSubmittal,   route: '/submittal',                        section: 'THIS JOB', feature: 'submittal' },
  { key: 'change-order',      label: 'Change Orders',    icon: MageChangeOrder, route: '/change-order',                     section: 'THIS JOB', feature: 'change-order' },
  { key: 'invoice',           label: 'Invoices',         icon: MageInvoice,     route: '/invoice',                          section: 'THIS JOB', feature: 'invoice' },
  { key: 'punch-list',        label: 'Punch List',       icon: MagePunch,       route: '/punch-list',                       section: 'THIS JOB', feature: 'punch-list' },

  // ── More for this job — PLANNING
  { key: 'estimate',          label: 'Estimate',         icon: MageEstimate,    route: '/(tabs)/discover/estimate',        section: 'PLANNING', feature: 'estimate' },
  { key: 'last-planner',      label: 'Last Planner',     icon: ListChecks,      route: '/last-planner',                     section: 'PLANNING', feature: 'last-planner' },
  { key: 'plans',             label: 'Plans',            icon: MagePlans,       route: '/plans',                            section: 'PLANNING', feature: 'plans' },
  // Ask-your-plans conversational plan search. The gate is ai_estimate_wizard
  // (Pro), not ask_your_plans (Business) — the sidebar's own copy said the
  // latter until 2026-09-07 and painted a Business lock on a Pro feature.
  { key: 'plan-intelligence', label: 'Plan Intelligence', icon: FileSearch,     route: '/plan-intelligence',                section: 'PLANNING', feature: 'plan-intelligence' },
  // Weekly Snapshot intentionally omitted from the rail: it's a single-project
  // screen that dead-ends on "No project to snapshot yet" without a param and
  // has no picker. It's reachable from inside each project (project-detail
  // passes { projectId }).

  // ── More for this job — FIELD OPS
  // T&M ticket — signed-on-site record of extra work. Sits first because the
  // super notices the work while writing the daily report (THIS JOB, above).
  { key: 'field-ticket',      label: 'T&M Tickets',      icon: FileSignature,   route: '/field-ticket',                     section: 'FIELD OPS', feature: 'field-ticket' },
  { key: 'time-tracking',     label: 'Time Tracking',    icon: Clock,           route: '/time-tracking',                    section: 'FIELD OPS', feature: 'time-tracking' },
  { key: 'photo-triage',      label: 'Photo Triage',     icon: Camera,          route: '/photo-triage',                     section: 'FIELD OPS', feature: 'photo-triage' },
  // Scan-Anything: classify → extract → auto-file any document/photo.
  { key: 'scan',              label: 'Scan Anything',    icon: ScanLine,        route: '/scan',                             section: 'FIELD OPS', feature: 'scan' },
  { key: 'safety',            label: 'Safety',           icon: HardHat,         route: '/safety',                           section: 'FIELD OPS', feature: 'safety' },
  { key: 'oac-meeting',       label: 'OAC Meetings',     icon: Presentation,    route: '/oac-meeting',                      section: 'FIELD OPS', feature: 'oac-meeting' },
  // Neither screen calls useTierAccess, so their registry rows carry no
  // `requires` — a lock badge here would be a promise the code does not keep.
  { key: 'deliveries',        label: 'Deliveries',       icon: Truck,           route: '/deliveries',                       section: 'FIELD OPS', feature: 'deliveries' },
  { key: 'building-access',   label: 'Building Access',  icon: Building2,       route: '/building-access',                  section: 'FIELD OPS', feature: 'building-access' },
  { key: 'equipment',         label: 'Equipment',        icon: MageEquipment,   route: '/(tabs)/equipment',                section: 'FIELD OPS', feature: 'equipment' },
  // The notice register runs across every job, so it takes no job param.
  { key: 'delay-events',      label: 'Delay Register',   icon: CalendarClock,   route: '/delay-events',                     section: 'FIELD OPS', feature: 'delay-events' },

  // ── More for this job — FINANCIALS
  { key: 'aia-pay-app',       label: 'AIA Pay Apps',     icon: MagePayApp,      route: '/aia-pay-app',                      section: 'FINANCIALS', feature: 'aia-pay-app' },
  { key: 'budget-dashboard',  label: 'Budget Dashboard', icon: PieChart,        route: '/budget-dashboard',                 section: 'FINANCIALS', feature: 'budget-dashboard' },
  { key: 'job-costing',       label: 'Job Costing',      icon: Coins,           route: '/job-costing',                      section: 'FINANCIALS', feature: 'job-costing' },

  // ── More for this job — CLIENT
  { key: 'client-portal',     label: 'Client Portal',    icon: Briefcase,       route: '/client-portal-setup',              section: 'CLIENT', feature: 'client-portal' },
  { key: 'contract',          label: 'Contracts',        icon: MageContract,    route: '/contract',                         section: 'CLIENT', feature: 'contract' },
  // Good/better/best proposals. Its only other inbound link is a tile in
  // app/(tabs)/discover/tools.tsx, which is phone-only, so without this row a
  // paid feature was click-unreachable on the laptop where proposals get written.
  { key: 'smart-proposal',    label: 'Smart Proposal',   icon: FileSignature,   route: '/smart-proposal',                   section: 'CLIENT', feature: 'smart-proposal' },
  { key: 'selections',        label: 'Selections',       icon: PenTool,         route: '/selections',                       section: 'CLIENT', feature: 'selections' },
  { key: 'closeout',          label: 'Closeout',         icon: ShieldCheck,     route: '/closeout-binder',                  section: 'CLIENT', feature: 'closeout-binder' },
  // Shipped with ZERO inbound navigation until this row. It's the artifact the
  // homeowner keeps after the job ends — the best referral surface we have.
  { key: 'home-passport',     label: 'Home Passport',    icon: BadgeCheck,      route: '/home-passport',                    section: 'CLIENT', feature: 'home-passport' },

  // ── WORKSPACE — the cross-job surfaces, always expanded
  { key: 'home',              label: 'Projects',         icon: MageProject,     route: '/(tabs)/(home)',                   section: 'WORKSPACE', feature: 'projects' },
  { key: 'summary',           label: 'Summary',          icon: MageSummary,     route: '/(tabs)/summary',                  section: 'WORKSPACE', feature: 'summary' },
  { key: 'waiting-on',        label: 'Waiting on Others', icon: Inbox,          route: '/waiting-on',                       section: 'WORKSPACE', feature: 'waiting-on' },
  { key: 'margin-board',      label: 'Margin Board',     icon: MageMargin,      route: '/portfolio-margin',                 section: 'WORKSPACE', feature: 'margin-board' },
  { key: 'ask-mage',          label: 'Ask MAGE',         icon: MageAIMark,      route: '/ask',                              section: 'WORKSPACE', feature: 'ask-mage' },
  // "Inbox" is the notifications inbox (app/notifications-inbox.tsx) — the
  // place things addressed to you land. It moved up from ACCOUNT because it is
  // work, not settings.
  { key: 'notifications',     label: 'Inbox',            icon: Bell,            route: '/notifications-inbox',              section: 'WORKSPACE', feature: 'notifications' },

  // ── BUSINESS — finding work and the people you do it with (collapsed)
  { key: 'leads',             label: 'Leads',            icon: UserPlus,        route: '/leads',                            section: 'BUSINESS', feature: 'leads' },
  { key: 'mage-id-bids',      label: 'MAGE ID Bids',     icon: Gavel,           route: '/(tabs)/mage-id-bids',             section: 'BUSINESS', feature: 'mage-id-bids' },
  { key: 'bids',              label: 'Public Bids',      icon: ScrollText,      route: '/(tabs)/discover/bids',            section: 'BUSINESS', feature: 'public-bids' },
  // Publish a solicitation of your own. Its only other inbound link is a card
  // inside the Discover tab, which does not exist on desktop (audit
  // 2026-09-07, navigation-ia #1).
  { key: 'post-bid',          label: 'Post a Bid',       icon: Megaphone,       route: '/post-bid',                         section: 'BUSINESS', feature: 'post-bid' },
  // JUDGES bid scoring — screen self-titles "Bid Advisor" (app/judges.tsx).
  { key: 'judges',            label: 'Bid Advisor',      icon: Scale,           route: '/judges',                           section: 'BUSINESS', feature: 'judges' },
  { key: 'auto-bids',         label: 'Pre-priced Bids',  icon: Zap,             route: '/auto-bids',                        section: 'BUSINESS', feature: 'auto-bids' },
  // "(sample)": the screen is a mock catalog of invented suppliers — audit
  // round 2, #11. Drop the suffix when real suppliers are onboarded.
  { key: 'marketplace',       label: 'Suppliers (sample)', icon: Store,         route: '/(tabs)/marketplace',              section: 'BUSINESS', feature: 'marketplace' },
  { key: 'subs',              label: 'Subs',             icon: HardHat,         route: '/(tabs)/subs',                     section: 'BUSINESS', feature: 'subs' },
  { key: 'contacts',          label: 'Contacts',         icon: Users,           route: '/contacts',                         section: 'BUSINESS', feature: 'contacts' },
  { key: 'crew',              label: 'Crew',             icon: IdCard,          route: '/crew',                             section: 'BUSINESS', feature: 'crew' },
  { key: 'companies',         label: 'Companies',        icon: Building2,       route: '/(tabs)/discover/companies',       section: 'BUSINESS', feature: 'companies' },
  { key: 'hire',              label: 'Hire',             icon: Handshake,       route: '/(tabs)/discover/hire',            section: 'BUSINESS' },
  { key: 'track-record',      label: 'Track Record',     icon: Target,          route: '/track-record',                     section: 'BUSINESS', feature: 'track-record' },
  // Gate is job_costing (app/estimate-scorecard.tsx:51), NOT brain_accuracy like
  // Track Record one row up. The registry row carries it; this note stays as a
  // reading aid for anyone scanning the rail.
  { key: 'estimate-scorecard', label: 'Estimate Scorecard', icon: BarChart3,    route: '/estimate-scorecard',               section: 'BUSINESS', feature: 'estimate-scorecard' },
  { key: 'business',          label: 'Your Business',    icon: Briefcase,       route: '/business',                         section: 'BUSINESS', feature: 'business' },

  // ── FINANCE — the company's money across jobs (collapsed)
  { key: 'wip-report',        label: 'WIP Report',       icon: TrendingUp,      route: '/wip-report',                       section: 'FINANCE', feature: 'wip-report' },
  { key: 'cash-flow',         label: 'Cash Flow',        icon: LineChart,       route: '/cash-flow',                        section: 'FINANCE', feature: 'cash-flow' },
  { key: 'payments',          label: 'Payments',         icon: Wallet,          route: '/payments',                         section: 'FINANCE', feature: 'payments' },
  { key: 'reports',           label: 'Reports',          icon: BarChart3,       route: '/reports',                          section: 'FINANCE', feature: 'reports' },
  { key: 'margin-alerts',     label: 'Margin Alerts',    icon: BellRing,        route: '/margin-alerts',                    section: 'FINANCE', feature: 'margin-alerts' },

  // ── SETUP & TOOLS — the cost book and the AI tools (collapsed)
  { key: 'cost-database',     label: 'Cost Database',    icon: MageCostDb,      route: '/cost-database',                    section: 'SETUP & TOOLS', feature: 'cost-database' },
  { key: 'cost-seed',         label: 'Seed Your Rates',  icon: Upload,          route: '/cost-seed',                        section: 'SETUP & TOOLS', feature: 'cost-seed' },
  // The embed widget turns a contractor's own website into a lead source; the
  // setup screen shipped with no inbound navigation before this row.
  { key: 'widget-setup',      label: 'Website Widget',   icon: Code,            route: '/widget-setup',                     section: 'SETUP & TOOLS', feature: 'widget-setup' },
  { key: 'cost-xray',         label: 'Cost X-Ray',       icon: ScanEye,         route: '/cost-xray',                        section: 'SETUP & TOOLS', feature: 'cost-xray' },
  { key: 'area-takeoff',      label: 'Visual Takeoff',   icon: MageTakeoff,     route: '/area-takeoff',                     section: 'SETUP & TOOLS', feature: 'area-takeoff' },
  // MAGE Copilot hub — the universal voice→build engine's front door.
  { key: 'copilot-hub',       label: 'MAGE Copilot',     icon: Mic,             route: '/copilot-hub',                      section: 'SETUP & TOOLS', feature: 'copilot-hub' },
  { key: 'construction-ai',   label: 'Construction AI',  icon: MageAIMark,      route: '/(tabs)/construction-ai',          section: 'SETUP & TOOLS', feature: 'construction-ai' },
  // Construction News — publisher-feed headlines (founder request 2026-09-22).
  // Ungated. Moved out of WORKSPACE in wave 6c, which brings WORKSPACE back to
  // six rows and fully above the fold on the founder's 858 px viewport.
  { key: 'construction-news', label: 'Construction News', icon: Newspaper,
    route: '/construction-news', section: 'SETUP & TOOLS', feature: 'construction-news' },

  // ── ACCOUNT (pinned to bottom)
  { key: 'messages',          label: 'Messages',         icon: MessageCircle,   route: '/messages',                         section: 'ACCOUNT' },
  { key: 'report-inbox',      label: 'Report Inbox',     icon: Inbox,           route: '/report-inbox',                     section: 'ACCOUNT', feature: 'report-inbox' },
  { key: 'tutorials',         label: 'Help & tutorials', icon: BookOpen,        route: '/tutorials',                        section: 'ACCOUNT', feature: 'tutorials' },
  { key: 'settings',          label: 'Settings',         icon: Settings,        route: '/(tabs)/settings',                 section: 'ACCOUNT', feature: 'settings' },
];

/** Always expanded, and every row carries the active job. */
const JOB_SECTION = 'THIS JOB';
/** The rest of the project tools, behind one saved "More for this job" toggle,
 *  sub-labelled so eight-plus rows stay scannable. */
const MORE_JOB_SECTIONS = ['PLANNING', 'FIELD OPS', 'FINANCIALS', 'CLIENT'];
const MORE_TOGGLE = 'MORE FOR THIS JOB';
/** Always expanded. */
const WORKSPACE_SECTION = 'WORKSPACE';
/** Collapsed by default; open state saved under mageid_sidebar_sections. */
const COLLAPSIBLE_SECTIONS = ['BUSINESS', 'FINANCE', 'SETUP & TOOLS'];
const ACCOUNT_SECTION = 'ACCOUNT';

// ─── Client-persona sidebar ──────────────────────────────────────────────
// A property owner posting renovations needs a much smaller surface: post a
// project, see active RFPs, talk to awarded contractors, manage account. Most
// contractor-side routes aren't even authorized for clients server-side. No
// job switcher: their "projects" are RFPs, not jobs they run.
const CLIENT_NAV_ITEMS: NavItem[] = [
  { key: 'home',          label: 'Home',           icon: Home,          route: '/(tabs)/(home)', section: 'PROPERTY OWNER', feature: 'projects' },
  { key: 'my-rfps',       label: 'My Projects',    icon: Briefcase,     route: '/my-rfps',       section: 'PROPERTY OWNER', feature: 'my-rfps' },
  { key: 'post-rfp',      label: 'Post a Project', icon: FileText,      route: '/post-rfp',      section: 'PROPERTY OWNER', feature: 'post-rfp' },

  { key: 'messages',      label: 'Messages',       icon: MessageCircle, route: '/messages',      section: 'ACCOUNT' },
  { key: 'notifications', label: 'Notifications',  icon: Bell,          route: '/notifications-inbox', section: 'ACCOUNT', feature: 'notifications' },
  { key: 'settings',      label: 'Settings',       icon: Settings,      route: '/(tabs)/settings', section: 'ACCOUNT', feature: 'settings' },
];
const CLIENT_SECTIONS = ['PROPERTY OWNER'];

// ─── Property-manager sidebar (wave 6c, phase-0 D2) ───────────────────────
// A property manager runs a portfolio of buildings, not RFPs: they got the
// CLIENT rail (Post a Project, My Projects) until 6c, which is the homeowner's
// flow. Their own set: the portfolio (Home) and their contacts, plus the same
// account rows. Still minimal — no job switcher, no contractor tools.
const PM_NAV_ITEMS: NavItem[] = [
  { key: 'home',          label: 'Portfolio',      icon: Building2,     route: '/(tabs)/(home)', section: 'PROPERTY MANAGER', feature: 'projects' },
  { key: 'contacts',      label: 'Contacts',       icon: Users,         route: '/contacts',      section: 'PROPERTY MANAGER', feature: 'contacts' },

  { key: 'messages',      label: 'Messages',       icon: MessageCircle, route: '/messages',      section: 'ACCOUNT' },
  { key: 'notifications', label: 'Notifications',  icon: Bell,          route: '/notifications-inbox', section: 'ACCOUNT', feature: 'notifications' },
  { key: 'settings',      label: 'Settings',       icon: Settings,      route: '/(tabs)/settings', section: 'ACCOUNT', feature: 'settings' },
];
const PM_SECTIONS = ['PROPERTY MANAGER'];

/** Pro Scheduler — where the Schedule row goes when there is a job and the
 *  plan includes it (wave 6c). Not a NAV_ITEMS row: its registry entry is
 *  'schedule-pro', and the row stays 'Schedule'. */
const SCHEDULE_PRO_ROUTE: Route = '/schedule-pro';

/** Does `pathname` (resolved, group-free) sit on this row's destination? */
function isActiveRoute(pathname: string, item: NavItem): boolean {
  if (item.key === 'home') return pathname === '/' || pathname.includes('(home)');
  // The Schedule row opens Pro when the plan has it, so it lights up there too.
  if (item.key === 'schedule' && (pathname === SCHEDULE_PRO_ROUTE || pathname.startsWith(SCHEDULE_PRO_ROUTE + '/'))) {
    return true;
  }
  // Plain "bids" is the scraped public-bids tab; make sure the mage-id
  // route doesn't also light it up.
  if (item.key === 'bids') {
    return /\/bids(?:\/|$)/.test(pathname) && !pathname.includes('mage-id-bids');
  }
  return [item.route, item.jobRoute].some(r => {
    if (!r) return false;
    const normalized = normalizeRoutePath(r);
    if (normalized === '/') return false;
    return pathname === normalized || pathname.startsWith(normalized + '/');
  });
}

/** Paths where picking another job in the switcher should STAY on the tool
 *  and swap its job — every row that carries the job. Built once from the
 *  table, so a row that starts carrying the job is also a stay-put tool. */
const JOB_TOOL_ROUTES: ReadonlyMap<string, Route> = new Map<string, Route>([
  ...NAV_ITEMS.flatMap((item): [string, Route][] => {
    const scoped = item.feature ? featureFor(item.feature).projectScoped === true : false;
    if (item.jobRoute) return [[normalizeRoutePath(item.jobRoute), item.jobRoute]];
    return scoped ? [[normalizeRoutePath(item.route), item.route]] : [];
  }),
  // The Schedule row's Pro target (wave 6c): a job switch on Pro stays on Pro
  // with the new ?projectId.
  ['/schedule-pro', SCHEDULE_PRO_ROUTE],
]);

// The rail paints its own dark ground in BOTH themes (self-darkening chrome,
// scripts/validate-theme-baking.ts), so its inks are white alphas rather than
// theme tokens. The one themed fill is the active row (colors.accentFill).
const RAIL = {
  ground: '#1C1C1E',
  ink: '#FFFFFF',
  label: 'rgba(255,255,255,0.6)',
  dim: 'rgba(255,255,255,0.45)',
  muted: 'rgba(255,255,255,0.3)',
  hover: 'rgba(255,255,255,0.06)',
  rule: 'rgba(255,255,255,0.06)',
} as const;

interface DesktopSidebarProps {
  width: number;
}

/** A native tooltip on web: RN-web forwards no `title` prop, so the attribute
 *  is set on the DOM node (and mirrored in data-title for tests). Native gets
 *  a plain View; the label is on the control's accessibilityLabel either way. */
function RailTip({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as { setAttribute?: (k: string, v: string) => void } | null;
    node?.setAttribute?.('title', label);
  }, [label]);
  return (
    <View
      ref={ref}
      style={styles.railTip}
      // RN's View type has no dataSet; RN-web renders it as data-title.
      {...(Platform.OS === 'web' ? ({ dataSet: { title: label } } as object) : {})}
    >
      {children}
    </View>
  );
}

const DesktopSidebar = React.memo(function DesktopSidebar({ width }: DesktopSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { openSearch } = useSearch();
  const { canAccess } = useTierAccess();
  const claimedCrewWorker = useClaimedCrewProfile();
  const { colors } = useTheme();
  const { userRole, projects } = useCoreData();
  const { activeProjectId, activeProject, recentProjectIds } = useActiveProject();
  const [createOpen, setCreateOpen] = useState(false);
  // The 64 px icon rail (wave 6c): canvas routes (Schedule Pro, the plan
  // viewer) default to it, Cmd/Ctrl+Backslash or the header button toggles
  // it, remembered per kind of route (utils/sidebarRail).
  const { collapsed, toggle: toggleRail } = useSidebarRail();

  // Mirror the tab bar's isMinimalPersona (app/(tabs)/_layout.tsx): both
  // client AND property_manager get the minimal nav. Previously the sidebar
  // only checked 'client', so a property manager saw the full contractor rail
  // on web while their phone showed the minimal one (CLAUDE.md: keep sidebar
  // and tab bar in sync). Since wave 6c each gets its OWN minimal set.
  const isMinimalPersona = userRole === 'client' || userRole === 'property_manager';
  const isPropertyManager = userRole === 'property_manager';
  // Direct Hire + Messages belong to the same orphaned subsystem, gated
  // behind HIRE_ENABLED for launch. Hide their rail entries when it's off.
  const navItems = useMemo(
    () => (isMinimalPersona ? (userRole === 'property_manager' ? PM_NAV_ITEMS : CLIENT_NAV_ITEMS) : NAV_ITEMS)
      .filter(item => HIRE_ENABLED || (item.key !== 'hire' && item.key !== 'messages')),
    [isMinimalPersona, userRole],
  );
  const minimalSections = isPropertyManager ? PM_SECTIONS : CLIENT_SECTIONS;
  const itemsIn = useCallback(
    (section: string) => navItems.filter(item => item.section === section),
    [navItems],
  );
  const jobId = isMinimalPersona ? null : activeProjectId;

  // Which section holds the current page — shown open for context, without
  // writing that into the saved state (a visit is not a preference).
  const activeSection = useMemo(
    () => navItems.find(it => isActiveRoute(pathname, it))?.section ?? null,
    [navItems, pathname],
  );

  // Saved open state for the collapsible groups. Read once; a missing,
  // corrupted or unreadable value means "all collapsed", which is the default.
  const [savedOpen, setSavedOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SIDEBAR_SECTIONS_KEY)
      .then(raw => { if (!cancelled) setSavedOpen(parseSectionState(raw)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const toggleSection = useCallback((section: string) => {
    setSavedOpen(prev => {
      const next = { ...prev, [section]: !prev[section] };
      AsyncStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);
  // A group that holds the current page is shown open for context — and until
  // 6c its header could not close it (the click saved "closed", the page kept
  // it open). The click now forces it for THIS SESSION only: never saved, and
  // cleared as soon as the page moves to another section.
  const [forced, setForced] = useState<Record<string, boolean>>({});
  useEffect(() => { setForced({}); }, [activeSection]);
  const isOpen = useCallback((toggle: string, members: readonly string[]) =>
    forced[toggle] ?? (!!savedOpen[toggle] || (activeSection !== null && members.includes(activeSection))),
  [forced, savedOpen, activeSection]);

  // Pro Scheduler is the Schedule row's target when there is a job and the
  // plan includes it (wave 6c); otherwise the row opens as before. Checked
  // against the JOB (useProjectAccess), exactly as /schedule-pro gates it: an
  // invited collaborator on a free plan, on a Pro GC's job, is let in there,
  // so the row must send him there too (validate-collaborator-gates).
  const jobAccess = useProjectAccess(jobId ?? undefined);
  const proSchedule = jobAccess.canAccess('schedule_gantt_pdf');

  /** A row's href: the active job rides along on job-scoped rows only. */
  const hrefFor = useCallback((item: NavItem): Href => {
    if (item.key === 'schedule' && jobId && proSchedule) {
      return routeHref(SCHEDULE_PRO_ROUTE, { projectId: jobId });
    }
    const projectScoped = item.feature ? featureFor(item.feature).projectScoped === true : false;
    const t = jobScopedTarget(item.route, { projectScoped, jobRoute: item.jobRoute, activeProjectId: jobId });
    return routeHref(t.pathname, t.params);
  }, [jobId, proSchedule]);

  /** Picking a job on a project tool stays on the tool; elsewhere it opens
   *  the job's Overview. */
  const hrefForJob = useCallback((projectId: string): Href => {
    const t = jobSwitchTarget(pathname, projectId, JOB_TOOL_ROUTES);
    return routeHref(t.pathname, t.params);
  }, [pathname]);

  const recentJobs = useMemo(
    () => (isMinimalPersona ? [] : recentProjectIds
      .map(id => projects.find(p => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p)),
    [isMinimalPersona, recentProjectIds, projects],
  );

  const rowStyle = useCallback((active: boolean) => (s: RowLinkState) => [
    styles.navItem,
    active ? { backgroundColor: colors.accentFill } : s.hovered ? styles.navItemHovered : null,
  ], [colors.accentFill]);

  const railRowStyle = useCallback((active: boolean) => (s: RowLinkState) => [
    styles.railItem,
    active ? { backgroundColor: colors.accentFill } : s.hovered ? styles.navItemHovered : null,
  ], [colors.accentFill]);

  const renderNavItem = useCallback((item: NavItem, dimmed = false) => {
    const active = isActiveRoute(pathname, item);
    const Icon = item.icon;
    // Gate read from the registry, never from a field on the row — see NavItem.
    const requires = item.feature ? featureFor(item.feature).requires : undefined;
    // #74 (wave 5): a claimed crew worker without the crew plan sees his own
    // profile here — "My Profile", unlocked (the screen opens for him).
    const asProfile = item.feature === 'crew' && claimedCrewWorker && !!requires && !canAccess(requires);
    const locked = !asProfile && !!requires && !canAccess(requires);
    const label = asProfile ? 'My Profile' : item.label;
    const baseColor = dimmed ? RAIL.dim : RAIL.label;

    return (
      <RowLink
        key={item.key}
        href={hrefFor(item)}
        style={rowStyle(active)}
        selected={active}
        testID={`sidebar-${item.key}`}
        accessibilityLabel={`${label}${locked ? ' (requires upgrade)' : ''}${active ? ', current page' : ''}`}
      >
        {({ hovered }: RowLinkState) => (
          <>
            <Icon
              size={16}
              color={active || hovered ? RAIL.ink : baseColor}
              strokeWidth={active ? 2.2 : 1.8}
            />
            <Text
              style={[
                styles.navLabel,
                dimmed && styles.navLabelDimmed,
                active && styles.navLabelActive,
                hovered && !active && styles.navLabelHovered,
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
            {locked && (
              <View style={styles.lockBadge}>
                <Lock size={10} color="rgba(255,255,255,0.55)" strokeWidth={2.2} />
              </View>
            )}
          </>
        )}
      </RowLink>
    );
  }, [pathname, canAccess, claimedCrewWorker, hrefFor, rowStyle]);

  /** The collapsed rail's square: the icon alone, the label in the a11y
   *  label and the web tooltip. Same href, gate and active state as the row. */
  const renderRailItem = useCallback((item: NavItem) => {
    const active = isActiveRoute(pathname, item);
    const Icon = item.icon;
    const requires = item.feature ? featureFor(item.feature).requires : undefined;
    const asProfile = item.feature === 'crew' && claimedCrewWorker && !!requires && !canAccess(requires);
    const locked = !asProfile && !!requires && !canAccess(requires);
    const label = asProfile ? 'My Profile' : item.label;
    return (
      <RailTip key={item.key} label={`${label}${locked ? ' (requires upgrade)' : ''}`}>
        <RowLink
          href={hrefFor(item)}
          style={railRowStyle(active)}
          selected={active}
          testID={`sidebar-${item.key}`}
          accessibilityLabel={`${label}${locked ? ' (requires upgrade)' : ''}${active ? ', current page' : ''}`}
        >
          {({ hovered }: RowLinkState) => (
            <Icon size={18} color={active || hovered ? RAIL.ink : RAIL.label} strokeWidth={active ? 2.2 : 1.8} />
          )}
        </RowLink>
      </RailTip>
    );
  }, [pathname, canAccess, claimedCrewWorker, hrefFor, railRowStyle]);

  const renderToggle = (toggle: string, label: string, open: boolean, members: readonly string[]) => (
    <Pressable
      style={styles.sectionHeader}
      onPress={() => {
        // The group holding the current page: a session-only override.
        if (activeSection !== null && members.includes(activeSection)) {
          setForced(f => ({ ...f, [toggle]: !isOpen(toggle, members) }));
        } else {
          toggleSection(toggle);
        }
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${open ? 'expanded' : 'collapsed'}`}
      accessibilityState={{ expanded: open }}
      testID={`sidebar-section-${toggle}`}
    >
      <Text style={styles.sectionLabel}>{label}</Text>
      {open
        ? <ChevronDown size={13} color={RAIL.muted} strokeWidth={2} />
        : <ChevronRight size={13} color={RAIL.muted} strokeWidth={2} />}
    </Pressable>
  );

  const accountItems = itemsIn(ACCOUNT_SECTION);
  const moreOpen = isOpen(MORE_TOGGLE, MORE_JOB_SECTIONS);
  const overviewActive = !!activeProjectId && normalizeRoutePath(pathname) === '/project-detail';

  const createMenu = !isMinimalPersona && (
    <CreateMenu
      visible={createOpen}
      onClose={() => setCreateOpen(false)}
      // "Project" opens Home's own create sheet (?openCreate=1, consumed by
      // app/(tabs)/(home)/index.tsx) — one create-project flow, not two.
      onCreateProject={() => {
        setCreateOpen(false);
        router.push(routeHref('/(tabs)/(home)', { openCreate: '1' }));
      }}
    />
  );

  // ── Collapsed: the 64 px icon rail ─────────────────────────────────────
  // Brand, Search, + New, the job chip (expands), Overview + THIS JOB,
  // WORKSPACE, and Settings + expand at the bottom. JobSwitcher, RECENT, the
  // section labels, "More for this job" and BUSINESS / FINANCE / SETUP &
  // TOOLS are one expand away.
  if (collapsed) {
    const settingsItem = accountItems.find(item => item.key === 'settings');
    const jobInitial = activeProject?.name?.trim().charAt(0).toUpperCase() || null;
    return (
      <View
        style={[styles.container, styles.containerRail, { width, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }]}
        accessibilityRole={Platform.OS === 'web' ? ('navigation' as never) : undefined}
        accessibilityLabel="Primary navigation"
      >
        <View style={[styles.brandSection, styles.brandSectionRail]}>
          <View style={[styles.brandIcon, { backgroundColor: colors.accent }]}>
            <Wrench size={16} color={RAIL.ink} strokeWidth={1.75} />
          </View>
        </View>

        <RailTip label="Search (⌘K)">
          <Pressable
            style={(s) => [styles.railItem, (s as RowLinkState).hovered && styles.navItemHovered]}
            onPress={openSearch}
            testID="sidebar-search"
            accessibilityRole="button"
            accessibilityLabel="Open universal search"
          >
            <Search size={18} color={RAIL.label} strokeWidth={1.8} />
          </Pressable>
        </RailTip>

        {!isMinimalPersona && (
          <RailTip label="New">
            <Pressable
              style={(s) => [styles.railItem, (s as RowLinkState).hovered && styles.navItemHovered]}
              onPress={() => setCreateOpen(true)}
              testID="sidebar-new"
              accessibilityRole="button"
              accessibilityLabel="New: create a project, estimate, RFI, invoice or anything else"
            >
              <Plus size={18} color={RAIL.ink} strokeWidth={2} />
            </Pressable>
          </RailTip>
        )}

        {!isMinimalPersona && jobInitial && (
          <RailTip label={`${activeProject?.name ?? 'This job'}: expand to switch jobs`}>
            <Pressable
              style={[styles.jobChip, { backgroundColor: colors.accentFill }]}
              onPress={toggleRail}
              testID="sidebar-job-chip"
              accessibilityRole="button"
              accessibilityLabel={`Current job ${activeProject?.name ?? ''}. Expand the sidebar to switch jobs`}
            >
              <Text style={styles.jobChipText}>{jobInitial}</Text>
            </Pressable>
          </RailTip>
        )}

        <ScrollView style={[styles.navScroll, styles.railScrollView]} contentContainerStyle={styles.railScroll} showsVerticalScrollIndicator={false}>
          {isMinimalPersona ? (
            minimalSections.flatMap(section => itemsIn(section)).map(item => renderRailItem(item))
          ) : (
            <>
              {activeProjectId ? (
                <RailTip label="Overview">
                  <RowLink
                    href={routeHref('/project-detail', { id: activeProjectId })}
                    style={railRowStyle(overviewActive)}
                    selected={overviewActive}
                    testID="sidebar-job-overview"
                    accessibilityLabel={`Overview of ${activeProject?.name ?? 'this job'}${overviewActive ? ', current page' : ''}`}
                  >
                    {({ hovered }: RowLinkState) => (
                      <LayoutDashboard size={18} color={overviewActive || hovered ? RAIL.ink : RAIL.label} strokeWidth={overviewActive ? 2.2 : 1.8} />
                    )}
                  </RowLink>
                </RailTip>
              ) : null}
              {itemsIn(JOB_SECTION).map(item => renderRailItem(item))}
              <View style={styles.railDivider} />
              {itemsIn(WORKSPACE_SECTION).map(item => renderRailItem(item))}
            </>
          )}
        </ScrollView>

        <View style={styles.accountSection}>
          <View style={styles.footerDivider} />
          {settingsItem ? renderRailItem(settingsItem) : null}
          <RailTip label="Expand sidebar (⌘\)">
            <Pressable
              style={(s) => [styles.railItem, (s as RowLinkState).hovered && styles.navItemHovered]}
              onPress={toggleRail}
              testID="sidebar-expand"
              accessibilityRole="button"
              accessibilityLabel="Expand sidebar"
            >
              <PanelLeftOpen size={18} color={RAIL.label} strokeWidth={1.8} />
            </Pressable>
          </RailTip>
        </View>

        {createMenu}
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { width, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }]}
      accessibilityRole={Platform.OS === 'web' ? ('navigation' as never) : undefined}
      accessibilityLabel="Primary navigation"
    >
      {/* Brand — one 48 px row (was a 100 px stacked lockup), with the
          collapse button on the right (wave 6c). */}
      <View style={styles.brandSection}>
        <View style={[styles.brandIcon, { backgroundColor: colors.accent }]}>
          <Wrench size={16} color={RAIL.ink} strokeWidth={1.75} />
        </View>
        <Text style={styles.brandName}>MAGE ID</Text>
        <Pressable
          style={(s) => [styles.collapseButton, (s as RowLinkState).hovered && styles.navItemHovered]}
          onPress={toggleRail}
          testID="sidebar-collapse"
          accessibilityRole="button"
          accessibilityLabel="Collapse sidebar"
        >
          <PanelLeftClose size={16} color={RAIL.label} strokeWidth={1.8} />
        </Pressable>
      </View>

      <Pressable
        style={(s) => [styles.navItem, styles.searchItem, (s as RowLinkState).hovered && styles.navItemHovered]}
        onPress={openSearch}
        testID="sidebar-search"
        accessibilityRole="button"
        accessibilityLabel="Open universal search"
      >
        <Search size={16} color={RAIL.label} strokeWidth={1.8} />
        <Text style={styles.navLabel}>Search</Text>
        {Platform.OS === 'web' && (
          <View style={styles.kbdWrap}>
            <Text style={styles.kbd}>⌘K</Text>
          </View>
        )}
      </Pressable>

      {!isMinimalPersona && (
        <View style={styles.topBlock}>
          <JobSwitcher hrefForJob={hrefForJob} />
          <Pressable
            style={(s) => [styles.navItem, styles.newItem, (s as RowLinkState).hovered && styles.navItemHovered]}
            onPress={() => setCreateOpen(true)}
            testID="sidebar-new"
            accessibilityRole="button"
            accessibilityLabel="New: create a project, estimate, RFI, invoice or anything else"
          >
            <Plus size={16} color={RAIL.ink} strokeWidth={2} />
            <Text style={[styles.navLabel, styles.navLabelHovered]}>New</Text>
          </Pressable>
        </View>
      )}

      <ScrollView style={styles.navScroll} showsVerticalScrollIndicator={false}>
        {isMinimalPersona ? (
          minimalSections.map(section => (
            <View key={section} style={styles.navSection}>
              <Text style={[styles.sectionLabel, styles.staticLabel]}>{section}</Text>
              {itemsIn(section).map(item => renderNavItem(item))}
            </View>
          ))
        ) : (
          <>
            {/* THIS JOB — always expanded. With no job yet the rows still work:
                they open bare and the screen's own picker asks, as before. */}
            <View style={styles.navSection}>
              {/* The job's name is on the switcher directly above; the header
                  stays a label so the eye finds the section, not a second name. */}
              <Text style={[styles.sectionLabel, styles.staticLabel]}>{JOB_SECTION}</Text>
              {activeProjectId ? (
                <RowLink
                  href={routeHref('/project-detail', { id: activeProjectId })}
                  style={rowStyle(overviewActive)}
                  selected={overviewActive}
                  testID="sidebar-job-overview"
                  accessibilityLabel={`Overview of ${activeProject?.name ?? 'this job'}${overviewActive ? ', current page' : ''}`}
                >
                  {({ hovered }: RowLinkState) => (
                    <>
                      <LayoutDashboard size={16} color={overviewActive || hovered ? RAIL.ink : RAIL.label} strokeWidth={overviewActive ? 2.2 : 1.8} />
                      <Text style={[styles.navLabel, overviewActive && styles.navLabelActive, hovered && !overviewActive && styles.navLabelHovered]}>
                        Overview
                      </Text>
                    </>
                  )}
                </RowLink>
              ) : null}
              {itemsIn(JOB_SECTION).map(item => renderNavItem(item))}
              {renderToggle(MORE_TOGGLE, 'More for this job', moreOpen, MORE_JOB_SECTIONS)}
              {moreOpen && MORE_JOB_SECTIONS.map(sub => (
                <View key={sub} style={styles.subGroup}>
                  <Text style={styles.subLabel}>{sub}</Text>
                  {itemsIn(sub).map(item => renderNavItem(item))}
                </View>
              ))}
            </View>

            <View style={styles.navSection}>
              <Text style={[styles.sectionLabel, styles.staticLabel]}>{WORKSPACE_SECTION}</Text>
              {itemsIn(WORKSPACE_SECTION).map(item => renderNavItem(item))}
            </View>

            {/* Recently OPENED jobs, from the job context — closed, sample,
                deleted and other accounts' jobs never appear. */}
            {recentJobs.length > 0 && (
              <View style={styles.navSection}>
                <Text style={[styles.sectionLabel, styles.staticLabel]}>RECENT</Text>
                {recentJobs.map(p => {
                  const current = p.id === activeProjectId;
                  return (
                    <RowLink
                      key={p.id}
                      href={routeHref('/project-detail', { id: p.id })}
                      style={(s) => [styles.navItem, current ? styles.recentCurrent : s.hovered ? styles.navItemHovered : null]}
                      selected={current}
                      testID={`sidebar-recent-${p.id}`}
                      accessibilityLabel={`Open project ${p.name}${current ? ', current job' : ''}`}
                    >
                      {({ hovered }: RowLinkState) => (
                        <>
                          <Clock size={14} color={current || hovered ? RAIL.ink : RAIL.dim} strokeWidth={1.8} />
                          <Text style={[styles.navLabel, (current || hovered) && styles.navLabelHovered]} numberOfLines={1}>
                            {p.name}
                          </Text>
                          {current ? <View style={[styles.currentDot, { backgroundColor: colors.accent }]} /> : null}
                        </>
                      )}
                    </RowLink>
                  );
                })}
              </View>
            )}

            {COLLAPSIBLE_SECTIONS.map(section => {
              const items = itemsIn(section);
              if (items.length === 0) return null;
              const open = isOpen(section, [section]);
              return (
                <View key={section} style={styles.navSection}>
                  {renderToggle(section, section, open, [section])}
                  {open && items.map(item => renderNavItem(item))}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Account — pinned to the bottom of the rail, dimmed. */}
      {accountItems.length > 0 && (
        <View style={styles.accountSection}>
          <View style={styles.footerDivider} />
          {accountItems.map(item => renderNavItem(item, true))}
        </View>
      )}

      {__DEV__ && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>MAGE ID v2.0</Text>
          <Text style={styles.footerSubtext}>Desktop Mode</Text>
        </View>
      )}

      {createMenu}
    </View>
  );
});

export default DesktopSidebar;

/** 32 px rows (was 38): paddingVertical 0 + a fixed height, so a long label
 *  truncates instead of growing the row and pushing THIS JOB below the fold. */
const ROW_HEIGHT = 32;

const styles = StyleSheet.create({
  container: {
    backgroundColor: RAIL.ground,
    borderRightWidth: 1,
    borderRightColor: RAIL.rule,
    paddingHorizontal: 10,
  },
  brandSection: {
    height: 48,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 6,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: RAIL.rule,
  },
  brandIcon: {
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  brandName: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800' as const,
    color: RAIL.ink,
    letterSpacing: 1,
  },
  // The expanded header's collapse button, right-aligned (wave 6c).
  collapseButton: {
    marginLeft: 'auto' as const,
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // ── The collapsed 64 px rail (wave 6c) ──
  // 64 − 2 × 12 = the 40 px square (Layout.control.md).
  containerRail: {
    paddingHorizontal: (Layout.sidebar.rail - Layout.control.md) / 2,
    alignItems: 'center' as const,
  },
  brandSectionRail: {
    alignSelf: 'stretch' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 0,
  },
  railTip: {
    marginBottom: 2,
  },
  railItem: {
    width: Layout.control.md,
    height: Layout.control.md,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  railScroll: {
    alignItems: 'center' as const,
  },
  railScrollView: {
    alignSelf: 'stretch' as const,
  },
  railDivider: {
    width: 24,
    height: 1,
    backgroundColor: RAIL.rule,
    marginVertical: 8,
  },
  jobChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginVertical: 6,
  },
  jobChipText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: RAIL.ink,
  },
  topBlock: {
    marginTop: 6,
    marginBottom: 4,
  },
  navScroll: {
    flex: 1,
    marginTop: 4,
  },
  navSection: {
    marginBottom: 12,
  },
  // A collapsible group's header is a pressable toggle (label + chevron).
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    height: 26,
    paddingHorizontal: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: RAIL.muted,
    letterSpacing: 1.2,
  },
  staticLabel: {
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 4,
  },
  subGroup: {
    marginBottom: 4,
  },
  subLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.22)',
    letterSpacing: 1.1,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 2,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    height: ROW_HEIGHT,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.md,
    marginBottom: 1,
    position: 'relative' as const,
  },
  navItemHovered: {
    backgroundColor: RAIL.hover,
  },
  recentCurrent: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  currentDot: {
    marginLeft: 'auto' as const,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  navLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '500' as const,
    color: RAIL.label,
    flexShrink: 1,
  },
  navLabelDimmed: {
    color: RAIL.dim,
  },
  navLabelActive: {
    color: RAIL.ink,
    fontWeight: '600' as const,
  },
  navLabelHovered: {
    color: RAIL.ink,
  },
  searchItem: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: RAIL.rule,
  },
  newItem: {
    marginTop: 2,
  },
  kbdWrap: {
    marginLeft: 'auto' as const,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  kbd: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.3,
  },
  accountSection: {
    paddingTop: 6,
  },
  footer: {
    alignItems: 'center' as const,
    paddingTop: 8,
  },
  footerDivider: {
    height: 1,
    backgroundColor: RAIL.rule,
    alignSelf: 'stretch' as const,
    marginBottom: 6,
  },
  footerText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 0.5,
  },
  footerSubtext: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.15)',
    marginTop: 2,
  },
  lockBadge: {
    marginLeft: 'auto' as const,
    width: 18,
    height: 18,
    borderRadius: Tokens.radius.xs,
    backgroundColor: RAIL.hover,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
