import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Home, Wrench, Settings, BarChart3,
  FileText, Building2, Search, HardHat, Gavel, Lock, IdCard,
  Wallet, ClipboardList, MessageCircle, Camera, Inbox, TrendingUp, Receipt,
  Users, ShieldCheck, Bell, Briefcase, BadgeCheck, Code,
  PenTool, Store, Clock, ChevronDown, ChevronRight,
  ScrollText, UserPlus, Handshake, ListChecks, FileSignature,
  Presentation,
  PieChart, LineChart, Coins, BellRing,
  Scale, ScanEye, ScanLine, Mic, FileSearch, Target, Zap, Upload,
} from 'lucide-react-native';
import {
  MageAIMark, MageProject, MageSummary, MageEstimate, MageSchedule,
  MageRFI, MageSubmittal, MagePayApp, MageChangeOrder, MageTakeoff,
  MagePunch, MageMargin, MagePlans, MageCostDb, MageEquipment,
  MageDailyReport, MageInvoice, MageContract,
} from '@/components/icons';
import { useSearch } from '@/contexts/SearchContext';
import { useCoreData } from '@/contexts/ProjectContext';
import { HIRE_ENABLED } from '@/contexts/HireContext';
import { useTierAccess, type FeatureKey } from '@/hooks/useTierAccess';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';

interface NavItem {
  key: string;
  label: string;
  // Accepts lucide icons AND the bespoke MageAIMark (a plain function
  // component, so `typeof Home`'s ForwardRef type would reject it).
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  route: string;
  section: string;
  // Optional feature gate — when set, sidebar shows a small lock badge if
  // the user's tier doesn't unlock it. Tap still routes (Paywall renders
  // on the destination screen) so the upgrade flow stays one tap away.
  requires?: FeatureKey;
}

// ─── Information architecture (2026 declutter audit) ──────────────────────
// The flat 38-item rail across 7 always-expanded groups read as a wall. The
// research-backed fix (Procore / Jira / GitHub all do this): separate GLOBAL
// surfaces from PROJECT-SCOPED tools, and chunk the long tail behind
// collapsible group headers so the headers stay scannable while the items
// stay one click away. Distinct icons per destination (the old rail reused
// FileText/BarChart3 across ~10 items, which kills scannability).
//
// GLOBAL groups render expanded by default; PROJECT groups render collapsed
// by default (the group containing the active route auto-expands for
// context). Account is pinned to the bottom of the rail, dimmed.
const NAV_ITEMS: NavItem[] = [
  // ── WORKSPACE — global landing surfaces
  { key: 'summary',           label: 'Summary',          icon: MageSummary, route: '/(tabs)/summary',                  section: 'WORKSPACE' },
  { key: 'home',              label: 'Projects',         icon: MageProject,    route: '/(tabs)/(home)',                   section: 'WORKSPACE' },
  { key: 'ask-mage',          label: 'Ask MAGE',         icon: MageAIMark,      route: '/ask',                              section: 'WORKSPACE' },
  { key: 'business',          label: 'Your Business',    icon: Briefcase,       route: '/business',                         section: 'WORKSPACE', requires: 'brain_accuracy' },
  { key: 'track-record',      label: 'Track Record',     icon: Target,          route: '/track-record',                     section: 'WORKSPACE', requires: 'brain_accuracy' },
  { key: 'waiting-on',        label: 'Waiting on Others', icon: Inbox,          route: '/waiting-on',                       section: 'WORKSPACE' },
  { key: 'margin-board',      label: 'Margin Board',     icon: MageMargin,           route: '/portfolio-margin',                 section: 'WORKSPACE', requires: 'portfolio_margin' },
  { key: 'margin-alerts',     label: 'Margin Alerts',    icon: BellRing,        route: '/margin-alerts',                    section: 'WORKSPACE', requires: 'job_costing' },
  { key: 'cost-database',     label: 'Cost Database',    icon: MageCostDb,         route: '/cost-database',                    section: 'WORKSPACE', requires: 'job_costing' },
  { key: 'cost-seed',         label: 'Seed Your Rates',  icon: Upload,          route: '/cost-seed',                        section: 'WORKSPACE', requires: 'job_costing' },
  { key: 'area-takeoff',      label: 'Visual Takeoff',   icon: MageTakeoff,     route: '/area-takeoff',                     section: 'WORKSPACE', requires: 'job_costing' },
  { key: 'cost-xray',         label: 'Cost X-Ray',       icon: ScanEye,         route: '/cost-xray',                        section: 'WORKSPACE', requires: 'cost_xray' },
  // MAGE Copilot hub — the universal voice→build engine's front door.
  { key: 'copilot-hub',       label: 'MAGE Copilot',     icon: Mic,             route: '/copilot-hub',                      section: 'WORKSPACE' },

  // ── FIND WORK — marketplace / bids / suppliers
  { key: 'mage-id-bids',      label: 'MAGE ID Bids',     icon: Gavel,           route: '/(tabs)/mage-id-bids',             section: 'FIND WORK' },
  { key: 'bids',              label: 'Public Bids',      icon: ScrollText,      route: '/(tabs)/discover/bids',            section: 'FIND WORK' },
  { key: 'marketplace',       label: 'Suppliers',        icon: Store,           route: '/(tabs)/marketplace',              section: 'FIND WORK' },
  // JUDGES bid scoring — screen self-titles "Bid Advisor" (app/judges.tsx).
  { key: 'judges',            label: 'Bid Advisor',      icon: Scale,           route: '/judges',                           section: 'FIND WORK', requires: 'bid_scoring' },
  { key: 'auto-bids',         label: 'Pre-priced Bids',  icon: Zap,             route: '/auto-bids',                        section: 'FIND WORK', requires: 'bid_scoring' },

  // ── NETWORK — people + AI
  { key: 'leads',             label: 'Leads',            icon: UserPlus,        route: '/leads',                            section: 'NETWORK' },
  // The embed widget is how a contractor turns their own website into a lead
  // source, but the setup screen shipped with no inbound navigation — you could
  // not find your own widget ID without knowing to search for it.
  { key: 'widget-setup',      label: 'Website Widget',   icon: Code,            route: '/widget-setup',                     section: 'NETWORK' },
  { key: 'contacts',          label: 'Contacts',         icon: Users,           route: '/contacts',                         section: 'NETWORK' },
  { key: 'crew',              label: 'Crew',             icon: IdCard,          route: '/crew',                             section: 'NETWORK', requires: 'crew_management' },
  { key: 'subs',              label: 'Subs',             icon: HardHat,         route: '/(tabs)/subs',                     section: 'NETWORK' },
  { key: 'companies',         label: 'Companies',        icon: Building2,       route: '/(tabs)/discover/companies',       section: 'NETWORK' },
  { key: 'hire',              label: 'Hire',             icon: Handshake,       route: '/(tabs)/discover/hire',            section: 'NETWORK' },
  { key: 'construction-ai',   label: 'Construction AI',  icon: MageAIMark,      route: '/(tabs)/construction-ai',          section: 'NETWORK' },

  // ── PROJECT · OVERVIEW
  { key: 'estimate',          label: 'Estimate',         icon: MageEstimate,      route: '/(tabs)/discover/estimate',        section: 'OVERVIEW' },
  { key: 'schedule',          label: 'Schedule',         icon: MageSchedule,    route: '/(tabs)/discover/schedule',        section: 'OVERVIEW', requires: 'schedule_gantt_pdf' },
  { key: 'last-planner',      label: 'Last Planner',     icon: ListChecks,      route: '/last-planner',                     section: 'OVERVIEW', requires: 'schedule_gantt_pdf' },
  { key: 'plans',             label: 'Plans',            icon: MagePlans,       route: '/plans',                            section: 'OVERVIEW' },
  // Ask-your-plans conversational plan search.
  { key: 'plan-intelligence', label: 'Plan Intelligence', icon: FileSearch,     route: '/plan-intelligence',                section: 'OVERVIEW', requires: 'ask_your_plans' },
  // Weekly Snapshot intentionally omitted from the global rail: it's a
  // single-project screen (reads ?projectId, dead-ends on "No project to
  // snapshot yet" without one). It's reachable from inside each project
  // (project-detail passes { projectId }); a global rail link had no
  // projectId and always landed on the empty state.

  // ── PROJECT · FIELD OPS
  { key: 'daily-report',      label: 'Daily Report',     icon: MageDailyReport, route: '/daily-report',                     section: 'FIELD OPS' },
  // T&M ticket — signed-on-site record of extra work. Sits directly under the
  // daily report because that is where the super notices the work.
  { key: 'field-ticket',      label: 'T&M Tickets',      icon: FileSignature,   route: '/field-ticket',                     section: 'FIELD OPS', requires: 'change_orders_invoicing' },
  { key: 'time-tracking',     label: 'Time Tracking',    icon: Clock,           route: '/time-tracking',                    section: 'FIELD OPS', requires: 'subcontractor_management' },
  { key: 'photo-triage',      label: 'Photo Triage',     icon: Camera,          route: '/photo-triage',                     section: 'FIELD OPS', requires: 'photo_documentation' },
  // Scan-Anything: classify → extract → auto-file any document/photo.
  { key: 'scan',              label: 'Scan Anything',    icon: ScanLine,        route: '/scan',                             section: 'FIELD OPS', requires: 'scan_anything' },
  { key: 'punch-list',        label: 'Punch List',       icon: MagePunch,       route: '/punch-list',                       section: 'FIELD OPS', requires: 'punch_list_closeout' },
  { key: 'safety',            label: 'Safety',           icon: HardHat,         route: '/safety',                           section: 'FIELD OPS', requires: 'safety_management' },
  { key: 'rfi',               label: 'RFIs',             icon: MageRFI,    route: '/rfi',                              section: 'FIELD OPS', requires: 'rfis_submittals' },
  { key: 'submittal',         label: 'Submittals',       icon: MageSubmittal,       route: '/submittal',                        section: 'FIELD OPS', requires: 'rfis_submittals' },
  { key: 'oac-meeting',       label: 'OAC Meetings',     icon: Presentation,    route: '/oac-meeting',                      section: 'FIELD OPS' },
  { key: 'equipment',         label: 'Equipment',        icon: MageEquipment,           route: '/(tabs)/equipment',                section: 'FIELD OPS', requires: 'equipment_rental' },

  // ── PROJECT · FINANCIALS
  { key: 'invoice',           label: 'Invoices',         icon: MageInvoice,     route: '/invoice',                          section: 'FINANCIALS' },
  { key: 'change-order',      label: 'Change Orders',    icon: MageChangeOrder,   route: '/change-order',                     section: 'FINANCIALS', requires: 'change_orders_invoicing' },
  { key: 'aia-pay-app',       label: 'AIA Pay Apps',     icon: MagePayApp,        route: '/aia-pay-app',                      section: 'FINANCIALS', requires: 'aia_pay_app' },
  { key: 'budget-dashboard',  label: 'Budget Dashboard', icon: PieChart,        route: '/budget-dashboard',                 section: 'FINANCIALS', requires: 'full_budget_dashboard' },
  { key: 'wip-report',        label: 'WIP Report',       icon: TrendingUp,      route: '/wip-report',                       section: 'FINANCIALS', requires: 'wip_reporting' },
  { key: 'job-costing',       label: 'Job Costing',      icon: Coins,           route: '/job-costing',                      section: 'FINANCIALS', requires: 'job_costing' },
  { key: 'cash-flow',         label: 'Cash Flow',        icon: LineChart,       route: '/cash-flow',                        section: 'FINANCIALS', requires: 'cash_flow_forecaster' },
  { key: 'payments',          label: 'Payments',         icon: Wallet,          route: '/payments',                         section: 'FINANCIALS' },
  { key: 'reports',           label: 'Reports',          icon: BarChart3,       route: '/reports',                          section: 'FINANCIALS' },

  // ── PROJECT · CLIENT
  { key: 'client-portal',     label: 'Client Portal',    icon: Briefcase,       route: '/client-portal-setup',              section: 'CLIENT' },
  { key: 'contract',          label: 'Contracts',        icon: MageContract,    route: '/contract',                         section: 'CLIENT' },
  { key: 'selections',        label: 'Selections',       icon: PenTool,         route: '/selections',                       section: 'CLIENT' },
  { key: 'closeout',          label: 'Closeout',         icon: ShieldCheck,     route: '/closeout-binder',                  section: 'CLIENT' },
  // Shipped fully built with ZERO inbound navigation — reachable only by typing
  // "home passport" into the Cmd-K palette, which nobody does for a feature they
  // don't know exists. It's the artifact the homeowner keeps after the job ends,
  // so it's also the best referral surface in the product.
  { key: 'home-passport',     label: 'Home Passport',    icon: BadgeCheck,      route: '/home-passport',                    section: 'CLIENT' },

  // ── ACCOUNT (pinned to bottom)
  { key: 'notifications',     label: 'Notifications',    icon: Bell,            route: '/notifications-inbox',              section: 'ACCOUNT' },
  { key: 'messages',          label: 'Messages',         icon: MessageCircle,   route: '/messages',                         section: 'ACCOUNT' },
  { key: 'report-inbox',      label: 'Report Inbox',     icon: Inbox,           route: '/report-inbox',                     section: 'ACCOUNT' },
  { key: 'settings',          label: 'Settings',         icon: Settings,        route: '/(tabs)/settings',                 section: 'ACCOUNT' },
];

// Global groups render expanded; project groups render collapsed by default.
const GLOBAL_SECTIONS = ['WORKSPACE', 'FIND WORK', 'NETWORK'];
const PROJECT_SECTIONS = ['OVERVIEW', 'FIELD OPS', 'FINANCIALS', 'CLIENT'];
const SECTIONS = [...GLOBAL_SECTIONS, ...PROJECT_SECTIONS];
const ACCOUNT_SECTION = 'ACCOUNT';

// ─── Client-persona sidebar ──────────────────────────────────────────────
// A property owner posting renovations needs a much smaller surface: post a
// project, see active RFPs, talk to awarded contractors, manage account. Most
// contractor-side routes aren't even authorized for clients server-side.
const CLIENT_NAV_ITEMS: NavItem[] = [
  { key: 'home',          label: 'Home',           icon: Home,          route: '/(tabs)/(home)', section: 'PROPERTY OWNER' },
  { key: 'my-rfps',       label: 'My Projects',    icon: Briefcase,     route: '/my-rfps',       section: 'PROPERTY OWNER' },
  { key: 'post-rfp',      label: 'Post a Project', icon: FileText,      route: '/post-rfp',      section: 'PROPERTY OWNER' },

  { key: 'messages',      label: 'Messages',       icon: MessageCircle, route: '/messages',      section: 'ACCOUNT' },
  { key: 'notifications', label: 'Notifications',  icon: Bell,          route: '/notifications-inbox', section: 'ACCOUNT' },
  { key: 'settings',      label: 'Settings',       icon: Settings,      route: '/(tabs)/settings', section: 'ACCOUNT' },
];
const CLIENT_SECTIONS = ['PROPERTY OWNER'];

function isActiveRoute(pathname: string, navKey: string, route: string): boolean {
  if (navKey === 'home') return pathname === '/' || pathname.includes('(home)');
  // Plain "bids" is the scraped public-bids tab; make sure the mage-id
  // route doesn't also light it up.
  if (navKey === 'bids') {
    return /\/bids(?:\/|$)/.test(pathname) && !pathname.includes('mage-id-bids');
  }
  // Strip Expo Router group folders e.g. `(tabs)` — the resolved pathname
  // never includes them — and compare on full path boundaries.
  const normalized = '/' + route
    .split('/')
    .filter(seg => seg.length > 0 && !seg.startsWith('('))
    .join('/');
  if (normalized === '/') return false;
  return pathname === normalized || pathname.startsWith(normalized + '/');
}

interface DesktopSidebarProps {
  width: number;
}

const DesktopSidebar = React.memo(function DesktopSidebar({ width }: DesktopSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { openSearch } = useSearch();
  const { canAccess } = useTierAccess();
  const { colors } = useTheme();
  const { userRole, projects } = useCoreData();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const handleNav = useCallback((route: string) => {
    router.push(route as any);
  }, [router]);

  // Mirror the tab bar's isMinimalPersona (app/(tabs)/_layout.tsx): both
  // client AND property_manager get the minimal nav. Previously the sidebar
  // only checked 'client', so a property manager saw the full contractor rail
  // on web while their phone showed the minimal one (CLAUDE.md: keep sidebar
  // and tab bar in sync).
  const isMinimalPersona = userRole === 'client' || userRole === 'property_manager';
  // Direct Hire + Messages belong to the same orphaned subsystem, gated
  // behind HIRE_ENABLED for launch. Hide their rail entries when it's off.
  const navItems = useMemo(
    () => (isMinimalPersona ? CLIENT_NAV_ITEMS : NAV_ITEMS)
      .filter(item => HIRE_ENABLED || (item.key !== 'hire' && item.key !== 'messages')),
    [isMinimalPersona],
  );
  const sections = isMinimalPersona ? CLIENT_SECTIONS : SECTIONS;

  // Account items render pinned to the bottom of the rail (dimmed), separate
  // from the scrollable section list.
  const accountItems = useMemo(
    () => navItems.filter(item => item.section === ACCOUNT_SECTION),
    [navItems],
  );
  const groupedItems = useMemo(
    () => sections.map(section => ({
      section,
      items: navItems.filter(item => item.section === section),
    })),
    [sections, navItems],
  );

  // Which section holds the currently-active route — auto-expanded for context.
  const activeSection = useMemo(() => {
    const hit = navItems.find(it => isActiveRoute(pathname, it.key, it.route));
    return hit?.section ?? null;
  }, [navItems, pathname]);

  // Collapse state: project-tool groups start collapsed, everything else open.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of SECTIONS) init[s] = !PROJECT_SECTIONS.includes(s);
    for (const s of CLIENT_SECTIONS) init[s] = true;
    return init;
  });

  // Reveal the active section automatically (without fighting manual toggles
  // elsewhere). Per GOV.UK accordion research we drive this from a deliberate
  // default rather than persisting arbitrary state across sessions.
  useEffect(() => {
    if (activeSection) {
      setOpenSections(prev => (prev[activeSection] ? prev : { ...prev, [activeSection]: true }));
    }
  }, [activeSection]);

  const toggleSection = useCallback((section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const recentProjects = useMemo(
    () => (isMinimalPersona ? [] : projects.slice(0, 3)),
    [isMinimalPersona, projects],
  );

  const renderNavItem = useCallback((item: NavItem, dimmed = false) => {
    const active = isActiveRoute(pathname, item.key, item.route);
    const hovered = hoveredKey === item.key;
    const Icon = item.icon;
    const locked = !!item.requires && !canAccess(item.requires);
    const baseColor = dimmed ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.6)';

    return (
      <TouchableOpacity
        key={item.key}
        style={[
          styles.navItem,
          active && [styles.navItemActive, { backgroundColor: colors.accent }],
          hovered && !active && styles.navItemHovered,
        ]}
        onPress={() => handleNav(item.route)}
        activeOpacity={0.7}
        {...(Platform.OS === 'web' ? {
          onMouseEnter: () => setHoveredKey(item.key),
          onMouseLeave: () => setHoveredKey(null),
        } as any : {})}
        testID={`sidebar-${item.key}`}
        accessibilityRole="button"
        accessibilityLabel={`${item.label}${locked ? ' (requires upgrade)' : ''}${active ? ', current page' : ''}`}
        accessibilityState={{ selected: active, disabled: locked }}
      >
        <Icon
          size={18}
          color={active ? '#FFFFFF' : hovered ? '#FFFFFF' : baseColor}
          strokeWidth={active ? 2.2 : 1.8}
        />
        <Text style={[
          styles.navLabel,
          dimmed && styles.navLabelDimmed,
          active && styles.navLabelActive,
          hovered && !active && styles.navLabelHovered,
        ]}>
          {item.label}
        </Text>
        {locked && (
          <View style={styles.lockBadge}>
            <Lock size={10} color="rgba(255,255,255,0.55)" strokeWidth={2.2} />
          </View>
        )}
      </TouchableOpacity>
    );
  }, [pathname, hoveredKey, canAccess, colors.accent, handleNav]);

  return (
    <View
      style={[styles.container, { width, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 12 }]}
      accessibilityRole={Platform.OS === 'web' ? ('navigation' as never) : undefined}
      accessibilityLabel="Primary navigation"
    >
      <View style={styles.brandSection}>
        <View style={[styles.brandIcon, { backgroundColor: colors.accent }]}>
          <Wrench size={20} color={'#FFFFFF'} strokeWidth={1.75} />
        </View>
        <Text style={styles.brandName}>MAGE ID</Text>
        <Text style={styles.brandTagline}>Construction Suite</Text>
      </View>

      <ScrollView style={styles.navScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.navSection}>
          <TouchableOpacity
            style={[styles.navItem, styles.searchItem]}
            onPress={openSearch}
            activeOpacity={0.7}
            {...(Platform.OS === 'web' ? {
              onMouseEnter: () => setHoveredKey('__search'),
              onMouseLeave: () => setHoveredKey(null),
            } as any : {})}
            testID="sidebar-search"
            accessibilityRole="button"
            accessibilityLabel="Open universal search"
          >
            <Search
              size={18}
              color={hoveredKey === '__search' ? '#FFFFFF' : 'rgba(255,255,255,0.6)'}
              strokeWidth={1.8}
            />
            <Text style={[styles.navLabel, hoveredKey === '__search' && styles.navLabelHovered]}>
              Search
            </Text>
            {Platform.OS === 'web' && (
              <View style={styles.kbdWrap}>
                <Text style={styles.kbd}>⌘K</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Recent projects — zero-effort frecency re-navigation (last 3 opened). */}
        {recentProjects.length > 0 && (
          <View style={styles.navSection}>
            <Text style={styles.sectionLabel}>RECENT</Text>
            {recentProjects.map(p => (
              <TouchableOpacity
                key={p.id}
                style={styles.navItem}
                onPress={() => handleNav(`/project-detail?id=${p.id}`)}
                activeOpacity={0.7}
                {...(Platform.OS === 'web' ? {
                  onMouseEnter: () => setHoveredKey(`recent-${p.id}`),
                  onMouseLeave: () => setHoveredKey(null),
                } as any : {})}
                testID={`sidebar-recent-${p.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Open project ${p.name}`}
              >
                <Clock size={16} color={hoveredKey === `recent-${p.id}` ? '#FFFFFF' : 'rgba(255,255,255,0.5)'} strokeWidth={1.8} />
                <Text style={[styles.navLabel, hoveredKey === `recent-${p.id}` && styles.navLabelHovered]} numberOfLines={1}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {groupedItems.map(({ section, items }) => {
          if (items.length === 0) return null;
          const isProjectGroup = PROJECT_SECTIONS.includes(section);
          const open = openSections[section] ?? !isProjectGroup;
          const showProjectDivider = !isMinimalPersona && section === PROJECT_SECTIONS[0];

          return (
            <View key={section} style={styles.navSection}>
              {showProjectDivider && (
                <View style={styles.projectDivider}>
                  <View style={styles.projectDividerLine} />
                  <Text style={styles.projectDividerLabel}>PROJECT TOOLS</Text>
                  <View style={styles.projectDividerLine} />
                </View>
              )}
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => toggleSection(section)}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={`${section} section, ${open ? 'expanded' : 'collapsed'}`}
                accessibilityState={{ expanded: open }}
                testID={`sidebar-section-${section}`}
              >
                <Text style={styles.sectionLabel}>{section}</Text>
                {open
                  ? <ChevronDown size={13} color="rgba(255,255,255,0.3)" strokeWidth={2} />
                  : <ChevronRight size={13} color="rgba(255,255,255,0.3)" strokeWidth={2} />}
              </TouchableOpacity>
              {open && items.map(item => renderNavItem(item))}
            </View>
          );
        })}
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
    </View>
  );
});

export default DesktopSidebar;

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1C1E',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
  },
  brandSection: {
    alignItems: 'center' as const,
    paddingBottom: 20,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 8,
  },
  brandName: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  brandTagline: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500' as const,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  navScroll: {
    flex: 1,
  },
  navSection: {
    marginBottom: 14,
  },
  // Section header is now a pressable collapse toggle (label + chevron).
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 1.2,
  },
  // "PROJECT TOOLS" divider separates the global rail from project-scoped
  // groups — the core IA split that tames the clutter.
  projectDivider: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 4,
    marginTop: 2,
    marginBottom: 10,
  },
  projectDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  projectDividerLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.28)',
    letterSpacing: 1.4,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.md,
    marginBottom: 2,
    position: 'relative' as const,
  },
  navItemActive: {
    // backgroundColor set inline via theme colors.accent
  },
  navItemHovered: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  navLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.6)',
    flexShrink: 1,
  },
  navLabelDimmed: {
    color: 'rgba(255,255,255,0.45)',
  },
  navLabelActive: {
    color: '#FFFFFF',
    fontWeight: '600' as const,
  },
  navLabelHovered: {
    color: '#FFFFFF',
  },
  searchItem: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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
    paddingTop: 10,
  },
  footerDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignSelf: 'stretch' as const,
    marginBottom: 8,
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
