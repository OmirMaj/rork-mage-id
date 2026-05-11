import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Home, Wrench, Settings, BarChart3, CalendarDays,
  Hammer, FileText, Building2, Search, HardHat, Gavel, LayoutDashboard, Lock,
  Wallet, ClipboardList, MessageCircle, Camera, Inbox, TrendingUp, Receipt,
  Users, ShieldCheck, Calculator, Bell, Briefcase, Image as ImageIcon,
  PenTool, Store, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSearch } from '@/contexts/SearchContext';
import { useTierAccess, type FeatureKey } from '@/hooks/useTierAccess';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface NavItem {
  key: string;
  label: string;
  icon: typeof Home;
  route: string;
  section: string;
  // Optional feature gate — when set, sidebar shows a small lock badge if
  // the user's tier doesn't unlock it. Tap still routes (Paywall renders
  // on the destination screen) so the upgrade flow stays one tap away.
  requires?: FeatureKey;
}

// The bids / companies / hire layouts under (tabs)/ were merged into the
// discover/ folder when those features moved under the unified Find Work
// shell. This sidebar pointed at the old (tabs)/bids etc. paths which now
// 404 in production. Routes below now point to the live discover/* paths.
//
// Audit (May 2026) expanded this from 12 destinations → 30+ to address
// the desktop navigability gap. Mobile users reach feature screens via
// the project-detail tile grids; desktop users (web) saw a sparse
// sidebar with no way to reach 50+ feature screens until they opened a
// project. Now every major feature has a sidebar entry.
const NAV_ITEMS: NavItem[] = [
  // ── PROJECT — top-level work surfaces
  { key: 'summary',           label: 'Summary',          icon: LayoutDashboard, route: '/(tabs)/summary',                  section: 'PROJECT' },
  { key: 'home',              label: 'Projects',         icon: Home,            route: '/(tabs)/(home)',                   section: 'PROJECT' },
  { key: 'tools',             label: 'Tools',            icon: Wrench,          route: '/(tabs)/discover/tools',           section: 'PROJECT' },
  { key: 'estimate',          label: 'Estimate',         icon: BarChart3,       route: '/(tabs)/discover/estimate',        section: 'PROJECT' },
  { key: 'schedule',          label: 'Schedule',         icon: CalendarDays,    route: '/(tabs)/discover/schedule',        section: 'PROJECT', requires: 'schedule_gantt_pdf' },
  { key: 'plans',             label: 'Plans',            icon: ImageIcon,       route: '/plans',                            section: 'PROJECT' },
  { key: 'weekly-snapshot',   label: 'Weekly Snapshot',  icon: TrendingUp,      route: '/weekly-snapshot',                  section: 'PROJECT' },

  // ── FIELD OPS — daily field operations
  { key: 'daily-report',      label: 'Daily Report',     icon: ClipboardList,   route: '/daily-report',                     section: 'FIELD OPS' },
  { key: 'time-tracking',     label: 'Time Tracking',    icon: Clock,           route: '/time-tracking',                    section: 'FIELD OPS' },
  { key: 'photo-triage',      label: 'Photo Triage',     icon: Camera,          route: '/photo-triage',                     section: 'FIELD OPS', requires: 'photo_documentation' },
  { key: 'punch-list',        label: 'Punch List',       icon: ClipboardList,   route: '/punch-list',                       section: 'FIELD OPS', requires: 'punch_list_closeout' },
  { key: 'rfi',               label: 'RFIs',             icon: FileText,        route: '/rfi',                              section: 'FIELD OPS', requires: 'rfis_submittals' },
  { key: 'submittal',         label: 'Submittals',       icon: FileText,        route: '/submittal',                        section: 'FIELD OPS', requires: 'rfis_submittals' },
  { key: 'oac-meeting',       label: 'OAC Meetings',     icon: Users,           route: '/oac-meeting',                      section: 'FIELD OPS' },
  { key: 'equipment',         label: 'Equipment',        icon: Hammer,          route: '/(tabs)/equipment',                section: 'FIELD OPS', requires: 'equipment_rental' },

  // ── FINANCIAL — money flow
  { key: 'invoice',           label: 'Invoices',         icon: Receipt,         route: '/invoice',                          section: 'FINANCIAL' },
  { key: 'change-order',      label: 'Change Orders',    icon: PenTool,         route: '/change-order',                     section: 'FINANCIAL', requires: 'change_orders_invoicing' },
  { key: 'aia-pay-app',       label: 'AIA Pay Apps',     icon: FileText,        route: '/aia-pay-app',                      section: 'FINANCIAL', requires: 'aia_pay_app' },
  { key: 'cash-flow',         label: 'Cash Flow',        icon: TrendingUp,      route: '/cash-flow',                        section: 'FINANCIAL', requires: 'cash_flow_forecaster' },
  { key: 'budget-dashboard',  label: 'Budget Dashboard', icon: BarChart3,       route: '/budget-dashboard',                 section: 'FINANCIAL', requires: 'full_budget_dashboard' },
  { key: 'job-costing',       label: 'Job Costing',      icon: Calculator,      route: '/job-costing',                      section: 'FINANCIAL', requires: 'job_costing' },
  { key: 'payments',          label: 'Payments',         icon: Wallet,          route: '/payments',                         section: 'FINANCIAL' },
  { key: 'reports',           label: 'Reports',          icon: BarChart3,       route: '/reports',                          section: 'FINANCIAL' },

  // ── CLIENT — homeowner-facing
  { key: 'client-portal',     label: 'Client Portal',    icon: Briefcase,       route: '/client-portal-setup',              section: 'CLIENT', requires: 'client_portal' },
  { key: 'contract',          label: 'Contracts',        icon: FileText,        route: '/contract',                         section: 'CLIENT' },
  { key: 'selections',        label: 'Selections',       icon: PenTool,         route: '/selections',                       section: 'CLIENT' },
  { key: 'closeout',          label: 'Closeout',         icon: ShieldCheck,     route: '/closeout-binder',                  section: 'CLIENT' },

  // ── MARKETPLACE — bids + suppliers
  { key: 'mage-id-bids',      label: 'MAGE ID Bids',     icon: Hammer,          route: '/(tabs)/mage-id-bids',             section: 'MARKETPLACE' },
  { key: 'bids',              label: 'Public Bids',      icon: FileText,        route: '/(tabs)/discover/bids',            section: 'MARKETPLACE' },
  { key: 'marketplace',       label: 'Suppliers',        icon: Store,           route: '/(tabs)/marketplace',              section: 'MARKETPLACE' },

  // ── NETWORK — people + AI assistant
  { key: 'companies',         label: 'Companies',        icon: Building2,       route: '/(tabs)/discover/companies',       section: 'NETWORK' },
  { key: 'subs',              label: 'Subs',             icon: HardHat,         route: '/(tabs)/subs',                     section: 'NETWORK' },
  { key: 'leads',             label: 'Leads',            icon: TrendingUp,      route: '/leads',                            section: 'NETWORK' },
  { key: 'contacts',          label: 'Contacts',         icon: Users,           route: '/contacts',                         section: 'NETWORK' },
  { key: 'hire',              label: 'Hire',             icon: HardHat,         route: '/(tabs)/discover/hire',            section: 'NETWORK' },
  { key: 'construction-ai',   label: 'AI Hub',           icon: Gavel,           route: '/(tabs)/construction-ai',          section: 'NETWORK' },

  // ── ACCOUNT
  { key: 'notifications',     label: 'Notifications',    icon: Bell,            route: '/notifications-inbox',              section: 'ACCOUNT' },
  { key: 'messages',          label: 'Messages',         icon: MessageCircle,   route: '/messages',                         section: 'ACCOUNT' },
  { key: 'report-inbox',      label: 'Report Inbox',     icon: Inbox,           route: '/report-inbox',                     section: 'ACCOUNT' },
  { key: 'settings',          label: 'Settings',         icon: Settings,        route: '/(tabs)/settings',                 section: 'ACCOUNT' },
];

const SECTIONS = ['PROJECT', 'FIELD OPS', 'FINANCIAL', 'CLIENT', 'MARKETPLACE', 'NETWORK', 'ACCOUNT'];

// Per-section icon tint — when an item isn't hovered or active, the
// icon shows in its section's signature color (at 80% opacity for the
// dark sidebar). Project = brand green, Field Ops = amber (warm/urgent),
// Financial = emerald, Client = blue (comms), Marketplace = orange,
// Network = violet (people + AI), Account = muted slate. Picks a hue
// per section instead of every icon being grey.
const SECTION_TINT: Record<string, string> = {
  'PROJECT':     '#22C55E', // brand green (lighter on dark bg)
  'FIELD OPS':   '#F59E0B', // amber
  'FINANCIAL':   '#10B981', // emerald
  'CLIENT':      '#3B82F6', // blue
  'MARKETPLACE': '#FB923C', // orange
  'NETWORK':     '#A78BFA', // violet
  'ACCOUNT':     '#94A3B8', // slate
};

function isActiveRoute(pathname: string, navKey: string, route: string): boolean {
  if (navKey === 'home') return pathname === '/' || pathname.includes('(home)');
  // Plain "bids" is the scraped public-bids tab; make sure the mage-id
  // route doesn't also light it up.
  if (navKey === 'bids') {
    return /\/bids(?:\/|$)/.test(pathname) && !pathname.includes('mage-id-bids');
  }
  // Strip Expo Router group folders e.g. `(tabs)` — the resolved pathname
  // never includes them — and compare on full path boundaries. Pre-fix this
  // used `pathname.includes(lastSegment)`, which painted Contracts active on
  // `/contract-export`, lit Subs on `/subscription-paywall`, and otherwise
  // mis-highlighted any route whose final segment was a substring of
  // another. The startsWith form keeps child routes (e.g. `/invoice/123`)
  // highlighting their parent without the false positives.
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
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const handleNav = useCallback((route: string) => {
    router.push(route as any);
  }, [router]);

  const groupedItems = SECTIONS.map(section => ({
    section,
    items: NAV_ITEMS.filter(item => item.section === section),
  }));

  return (
    <View style={[styles.container, { width, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.brandSection}>
        <View style={styles.brandIcon}>
          <Wrench size={20} color={Colors.textOnPrimary} />
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
          >
            <Search
              size={18}
              color={hoveredKey === '__search' ? Colors.text : Colors.textSecondary}
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
        {groupedItems.map(({ section, items }) => (
          <View key={section} style={styles.navSection}>
            <Text style={styles.sectionLabel}>{section}</Text>
            {items.map(item => {
              const active = isActiveRoute(pathname, item.key, item.route);
              const hovered = hoveredKey === item.key;
              const Icon = item.icon;
              const locked = !!item.requires && !canAccess(item.requires);

              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.navItem,
                    active && styles.navItemActive,
                    hovered && !active && styles.navItemHovered,
                  ]}
                  onPress={() => handleNav(item.route)}
                  activeOpacity={0.7}
                  {...(Platform.OS === 'web' ? {
                    onMouseEnter: () => setHoveredKey(item.key),
                    onMouseLeave: () => setHoveredKey(null),
                  } as any : {})}
                  testID={`sidebar-${item.key}`}
                >
                  {/* Active state is now a solid pill (matches the SaaS-
                      dashboard reference) instead of a left-bar + 9% tint
                      combo. Pill alone reads cleaner; the bar was redundant
                      visual noise once the bg was strong enough to anchor
                      the active item. */}
                  <Icon
                    size={18}
                    color={
                      active
                        ? Colors.textOnPrimary
                        : (SECTION_TINT[item.section] ?? '#94A3B8')
                    }
                    strokeWidth={active ? 2.2 : 1.8}
                  />
                  <Text style={[
                    styles.navLabel,
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
            })}
          </View>
        ))}
      </ScrollView>

      {/* Dev-mode footer — only shown in dev builds. The "v2.0 / Desktop
          Mode" label was reading as a debug stamp on the production site;
          quiet by default, available locally for build diagnostics. */}
      {__DEV__ && (
        <View style={styles.footer}>
          <View style={styles.footerDivider} />
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
    paddingHorizontal: Tokens.spacing.sm,
  },
  brandSection: {
    alignItems: 'center' as const,
    paddingBottom: Tokens.spacing.lg,
    marginBottom: Tokens.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: Tokens.spacing.xs,
  },
  brandName: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800' as const,
    color: Colors.surface,
    letterSpacing: 1,
  },
  brandTagline: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500' as const,
    letterSpacing: 0.5,
    marginTop: Tokens.spacing.hairline,
  },
  navScroll: {
    flex: 1,
  },
  navSection: {
    marginBottom: Tokens.spacing.md,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 1.2,
    paddingHorizontal: Tokens.spacing.sm,
    marginBottom: 6,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: Tokens.spacing.sm,
    borderRadius: Tokens.radius.md,
    marginBottom: Tokens.spacing.hairline,
    position: 'relative' as const,
  },
  // Solid pill in brand green for the active item — high-contrast against
  // the dark sidebar surface, matches the reference dashboard's active
  // treatment. Replaces the 9%-opacity tint + left-bar combo, which was
  // too subtle on a dark bg to read as "you are here".
  navItemActive: {
    backgroundColor: Colors.primary,
  },
  navItemHovered: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  navLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.6)',
  },
  navLabelActive: {
    color: Colors.textOnPrimary,
    fontWeight: '600' as const,
  },
  navLabelHovered: {
    color: Colors.surface,
  },
  searchItem: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  kbdWrap: {
    marginLeft: 'auto' as const,
    paddingHorizontal: 6,
    paddingVertical: Tokens.spacing.hairline,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  kbd: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.3,
  },
  footer: {
    alignItems: 'center' as const,
    paddingTop: Tokens.spacing.sm,
  },
  footerDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignSelf: 'stretch' as const,
    marginBottom: Tokens.spacing.sm,
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
    marginTop: Tokens.spacing.hairline,
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
