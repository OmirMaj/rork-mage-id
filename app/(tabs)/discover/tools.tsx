// app/(tabs)/discover/tools.tsx — cross-project workflow hub.
//
// Re-added Phase 17 after Tools was orphaned by an earlier tab-removal
// phase. Lives inside Discover as a pushed sub-route — both the
// "Tools" soft-tab pill on Discover overview and the MANAGE WORK
// NavigationCard route here.
//
// Section order is intent-based, not alphabetical:
//   1. AI Hub      — marquee AI features
//   2. Decisions   — what's waiting on the GC to approve
//   3. Field       — what crews + owners are doing day-to-day
//   4. Money       — cash, draws, taxes, sales pipeline
//   5. Find work   — pre-priced bids, suppliers (PRODUCT-F4: sidebar-only before)
//   6. Compliance  — COI, permits, warranties
//   7. Closeout    — substantial completion + handover + Home Passport
//   8. Reporting   — daily report inbox, snapshots, data exports
//   9. Network     — subs, contacts, widget, crew
//
// This grid used to be ~500 lines of hand-written <NavRow> JSX — one of the
// five parallel navigation catalogs the 2026-09-07 audit found. It is now a
// table, and every row names a `feature`: utils/featureRegistry.ts owns the
// destination, this file owns the copy (sentence case, phone-length
// subtitles), the icon and the tone. `route` is written out beside `feature`
// because scripts/validate-feature-search.ts greps route literals out of
// app/(tabs)/** to prove every desktop destination is reachable on a phone —
// scripts/validate-nav-coverage.ts asserts each literal equals the registry
// route, so the two cannot fork.
//
// Tones stay inside NavRow's 7-tone palette (neutral/primary/success/warning/
// error/info/accent) so color carries semantic weight.

import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter } from 'expo-router';
import {
  MessageSquare, FileText, Calendar, Users,
  ClipboardList, Camera, ListChecks, Layers, Clock, ImageIcon,
  Wallet, BarChart3, Banknote, FileSignature, ShieldCheck,
  Trophy, UserPlus, Gavel, FileDown, FileCheck, AlertTriangle,
  PackageCheck, Inbox, TrendingUp, Download, Wrench, ArrowLeft,
  Ruler, ScanLine, HardHat, ScanSearch, IdCard, ScanEye,
  Truck, Building2, Hourglass, Store, Zap, BadgeCheck, CalendarClock, Code,
  type LucideIcon,
} from 'lucide-react-native';
import { MageAIMark, MageEquipment } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { NavRow, type NavRowTone } from '@/components/NavRow';
import EmptyState from '@/components/EmptyState';
import { useProjects } from '@/contexts/ProjectContext';
import { featureFor, type FeatureId } from '@/utils/featureRegistry';

const SECTIONS = [
  'AI HUB', 'DECISIONS', 'FIELD', 'MONEY', 'FIND WORK',
  'COMPLIANCE', 'CLOSEOUT', 'REPORTING', 'NETWORK',
] as const;
type ToolSection = (typeof SECTIONS)[number];

interface ToolRow {
  /** Registry row that owns this destination. */
  feature: FeatureId;
  /** Must equal featureFor(feature).route — see the header note. */
  route: string;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  tone: NavRowTone;
  testID: string;
  section: ToolSection;
  /** Hidden until the user has a project. Gating is per ROW, not per section:
   *  Money's Win Optimizer and Smart Proposal are pre-project surfaces sitting
   *  above eight rows that are not. */
  needsProjects?: boolean;
}

const TOOL_ROWS: ToolRow[] = [
  // ── AI HUB — marquee features. Pre-fix this only surfaced Construction AI;
  // the audit found 4 other AI features buried in project-detail's 28 tiles or
  // unreachable from the bottom nav entirely.
  { feature: 'construction-ai', route: '/(tabs)/construction-ai', Icon: MageAIMark, title: 'Construction AI', subtitle: 'Code check, AI permit roadmap & plan review', tone: 'accent', testID: 'tools-construction-ai', section: 'AI HUB' },
  // Cost X-Ray was reachable only from the desktop sidebar and Cmd-K — the
  // 2026-08-03 UX audit flagged flagship features missing from the Tools grid,
  // which is the only discovery surface on iOS. Restored from PR #85.
  { feature: 'cost-xray', route: '/cost-xray', Icon: ScanEye, title: 'Cost X-Ray', subtitle: "Camera prices the hidden conditions you can't see — on your learned costs", tone: 'accent', testID: 'tools-cost-xray', section: 'AI HUB' },
  { feature: 'takeoff', route: '/takeoff', Icon: Ruler, title: 'AI Takeoff', subtitle: 'Upload a PDF, get a quantity takeoff with linear / area / count', tone: 'accent', testID: 'tools-takeoff', section: 'AI HUB' },
  { feature: 'plan-intelligence', route: '/plan-intelligence', Icon: ScanSearch, title: 'Plan Intelligence', subtitle: 'AI reads the floor plan room by room — and learns your prices every job', tone: 'accent', testID: 'tools-plan-intelligence', section: 'AI HUB' },
  { feature: 'ai-punch', route: '/ai-punch', Icon: ListChecks, title: 'AI Punch from Photos', subtitle: 'Walk a site with the camera, get a punch list back', tone: 'accent', testID: 'tools-ai-punch', section: 'AI HUB' },
  { feature: 'compare-drawings', route: '/compare-drawings', Icon: Layers, title: 'Compare Drawings', subtitle: 'Diff two plan revisions, see exactly what changed', tone: 'accent', testID: 'tools-compare-drawings', section: 'AI HUB' },
  { feature: 'extract-submittals', route: '/extract-submittals', Icon: ScanLine, title: 'Spec Book Extract', subtitle: 'Pull submittal requirements out of a 200-page spec book in one tap', tone: 'accent', testID: 'tools-spec-extract', section: 'AI HUB' },
  { feature: 'scan', route: '/scan', Icon: ScanLine, title: 'Scan Anything', subtitle: 'Snap any doc — invoice, business card, COI — it files itself to the right project', tone: 'warning', testID: 'tools-scan', section: 'AI HUB' },

  // ── DECISIONS — what is waiting on the GC to act on.
  // PRODUCT-F4 / UX-F16: the marketed chase list was sidebar-only —
  // unreachable on iPhone except through search.
  { feature: 'waiting-on', route: '/waiting-on', Icon: Hourglass, title: 'Waiting on others', subtitle: 'Who owes you an answer — overdue RFIs, submittals, sub confirmations', tone: 'warning', testID: 'tools-waiting-on', section: 'DECISIONS', needsProjects: true },
  { feature: 'change-order', route: '/change-order', Icon: MessageSquare, title: 'Change orders', subtitle: 'Review, approve, send to client', tone: 'success', testID: 'tools-change-orders', section: 'DECISIONS', needsProjects: true },
  { feature: 'rfi', route: '/rfi', Icon: FileText, title: 'RFIs', subtitle: 'Requests for information across all projects', tone: 'info', testID: 'tools-rfi', section: 'DECISIONS', needsProjects: true },
  { feature: 'submittal', route: '/submittal', Icon: FileCheck, title: 'Submittals', subtitle: 'Spec submittals waiting for review', tone: 'info', testID: 'tools-submittal', section: 'DECISIONS', needsProjects: true },
  { feature: 'oac-meeting', route: '/oac-meeting', Icon: Calendar, title: 'OAC meetings', subtitle: 'Owner-architect-contractor meetings & follow-ups', tone: 'primary', testID: 'tools-oac-meeting', section: 'DECISIONS', needsProjects: true },
  // PRODUCT-F4: sidebar-only before — the owner-facing delay record was
  // unreachable on the phone that logs the delays.
  { feature: 'delay-events', route: '/delay-events', Icon: CalendarClock, title: 'Delay register', subtitle: 'Weather, RFI and owner delays with the notice clock running', tone: 'warning', testID: 'tools-delay-events', section: 'DECISIONS', needsProjects: true },

  // ── FIELD — what crews + owners do day-to-day.
  { feature: 'last-planner', route: '/last-planner', Icon: ListChecks, title: 'Last Planner', subtitle: '3-week lookahead, weekly commitments & PPC reliability', tone: 'accent', testID: 'tools-last-planner', section: 'FIELD', needsProjects: true },
  { feature: 'daily-report', route: '/daily-report', Icon: ClipboardList, title: 'Daily reports', subtitle: 'Voice-first DFRs with photo + GPS', tone: 'primary', testID: 'tools-daily-report', section: 'FIELD', needsProjects: true },
  { feature: 'photo-triage', route: '/photo-triage', Icon: Camera, title: 'Photo triage', subtitle: 'Tag, organize & file jobsite photos', tone: 'info', testID: 'tools-photo-triage', section: 'FIELD', needsProjects: true },
  { feature: 'punch-list', route: '/punch-list', Icon: ListChecks, title: 'Punch list', subtitle: 'Walk-through items + closeout', tone: 'warning', testID: 'tools-punch-list', section: 'FIELD', needsProjects: true },
  { feature: 'selections', route: '/selections', Icon: Layers, title: 'Selections', subtitle: 'Finish picks, fixtures, appliances', tone: 'accent', testID: 'tools-selections', section: 'FIELD', needsProjects: true },
  { feature: 'time-tracking', route: '/time-tracking', Icon: Clock, title: 'Time tracking', subtitle: 'Crew hours & timesheets', tone: 'primary', testID: 'tools-time-tracking', section: 'FIELD', needsProjects: true },
  { feature: 'plans', route: '/plans', Icon: ImageIcon, title: 'Plans & drawings', subtitle: 'Markup, compare versions, share', tone: 'info', testID: 'tools-plans', section: 'FIELD', needsProjects: true },
  // Safety hub — Business-tier. Only reachable via DesktopSidebar before this
  // tile, so it shipped dark on iOS (the primary target). /safety handles a
  // missing projectId (company-scoped tiles + picker) and renders its own
  // Paywall for non-Business.
  { feature: 'safety', route: '/safety', Icon: HardHat, title: 'Safety', subtitle: 'JHAs, toolbox talks, incidents, inspections & OSHA logs', tone: 'warning', testID: 'tools-safety', section: 'FIELD', needsProjects: true },
  // PRODUCT-F4 / UX-F16: the 09-02 Deliveries batch shipped with no iOS entry
  // point at all (sidebar ≥1024pt + search only).
  { feature: 'deliveries', route: '/deliveries', Icon: Truck, title: 'Deliveries', subtitle: "What's arriving, what's late — chase it before the crew waits", tone: 'accent', testID: 'tools-deliveries', section: 'FIELD', needsProjects: true },
  { feature: 'building-access', route: '/building-access', Icon: Building2, title: 'Building access', subtitle: 'Freight elevator, dock and badge bookings that gate a delivery', tone: 'info', testID: 'tools-building-access', section: 'FIELD', needsProjects: true },
  { feature: 'equipment', route: '/(tabs)/equipment', Icon: MageEquipment, title: 'Equipment', subtitle: "Rentals, utilization and what's on which site", tone: 'primary', testID: 'tools-equipment', section: 'FIELD', needsProjects: true },

  // ── MONEY — every cash-related workflow.
  { feature: 'win-optimizer', route: '/win-optimizer', Icon: Trophy, title: 'Win Optimizer', subtitle: 'The bid price that wins AND profits — learned from your own win/loss history', tone: 'accent', testID: 'tools-win-optimizer', section: 'MONEY' },
  { feature: 'smart-proposal', route: '/smart-proposal', Icon: FileSignature, title: 'Smart Proposal', subtitle: 'Good / better / best, priced to win — send, track, close', tone: 'accent', testID: 'tools-smart-proposal', section: 'MONEY' },
  { feature: 'cash-flow', route: '/cash-flow', Icon: Wallet, title: 'Cash flow', subtitle: 'Multi-week forecast across all projects', tone: 'primary', testID: 'tools-cash-flow', section: 'MONEY', needsProjects: true },
  { feature: 'budget-dashboard', route: '/budget-dashboard', Icon: BarChart3, title: 'Budget dashboard', subtitle: 'Earned-value (CPI/SPI) for one project — pick a project to chart', tone: 'success', testID: 'tools-budget-dashboard', section: 'MONEY', needsProjects: true },
  // WIP Report — Business-tier. Portfolio-wide (no projectId needed); renders
  // its own Paywall for non-Business. Was desktop-sidebar-only before this row.
  { feature: 'wip-report', route: '/wip-report', Icon: TrendingUp, title: 'WIP report', subtitle: 'Over/under billings & earned revenue across the portfolio', tone: 'success', testID: 'tools-wip-report', section: 'MONEY', needsProjects: true },
  { feature: 'estimate-calibration', route: '/estimate-calibration', Icon: TrendingUp, title: 'Estimate Calibration', subtitle: 'Where your bids run high or low — and the fix', tone: 'warning', testID: 'tools-estimate-calibration', section: 'MONEY', needsProjects: true },
  // PRODUCT-F4: sidebar-only before.
  { feature: 'estimate-scorecard', route: '/estimate-scorecard', Icon: BarChart3, title: 'Estimate scorecard', subtitle: 'Bid vs. actual on your closed jobs — where the money went', tone: 'success', testID: 'tools-estimate-scorecard', section: 'MONEY', needsProjects: true },
  { feature: 'payments', route: '/payments', Icon: Banknote, title: 'Payments', subtitle: 'Client payment status & history', tone: 'success', testID: 'tools-payments', section: 'MONEY', needsProjects: true },
  { feature: 'aia-pay-app', route: '/aia-pay-app', Icon: FileSignature, title: 'AIA pay applications', subtitle: 'G702/G703 auto-populated from invoices', tone: 'success', testID: 'tools-aia-pay-app', section: 'MONEY', needsProjects: true },
  { feature: 'lien-waivers', route: '/lien-waivers', Icon: ShieldCheck, title: 'Lien waivers', subtitle: 'Generate & track conditional / unconditional', tone: 'info', testID: 'tools-lien-waivers', section: 'MONEY', needsProjects: true },
  { feature: 'leads', route: '/leads', Icon: UserPlus, title: 'Pipeline', subtitle: 'Inquiries → qualified → proposal → won', tone: 'accent', testID: 'tools-pipeline', section: 'MONEY' },
  { feature: 'buyout', route: '/buyout', Icon: Gavel, title: 'Buyout', subtitle: 'Sub package builder + bid award flow', tone: 'info', testID: 'tools-buyout', section: 'MONEY' },
  { feature: 'sub-scorecard', route: '/sub-scorecard', Icon: Trophy, title: 'Sub Scorecard', subtitle: "Who's actually good? Graded from your real job costs", tone: 'accent', testID: 'tools-sub-scorecard', section: 'MONEY' },
  { feature: 'tax-1099', route: '/tax-1099-export', Icon: FileDown, title: '1099-NEC export', subtitle: 'Year-end CSV for your CPA — flags subs paid ≥ $600', tone: 'success', testID: 'tools-tax-1099', section: 'MONEY' },

  // ── FIND WORK — PRODUCT-F4: both were sidebar-only.
  { feature: 'auto-bids', route: '/auto-bids', Icon: Zap, title: 'Pre-priced bids', subtitle: 'Bids MAGE has already priced from your cost book — review and send', tone: 'accent', testID: 'tools-auto-bids', section: 'FIND WORK' },
  { feature: 'marketplace', route: '/(tabs)/marketplace', Icon: Store, title: 'Suppliers', subtitle: 'Vendors, yards and price history', tone: 'neutral', testID: 'tools-suppliers', section: 'FIND WORK' },

  // ── COMPLIANCE — the regulatory side.
  { feature: 'coi-vault', route: '/coi-vault', Icon: ShieldCheck, title: 'COI vault', subtitle: 'Sub insurance certificates + expiry tracking', tone: 'info', testID: 'tools-coi-vault', section: 'COMPLIANCE', needsProjects: true },
  { feature: 'permits', route: '/permits', Icon: AlertTriangle, title: 'Permits', subtitle: 'Filings, inspections, expirations', tone: 'warning', testID: 'tools-permits', section: 'COMPLIANCE', needsProjects: true },
  { feature: 'warranties', route: '/warranties', Icon: ShieldCheck, title: 'Warranties', subtitle: 'Workmanship + product warranties on file', tone: 'primary', testID: 'tools-warranties', section: 'COMPLIANCE', needsProjects: true },

  // ── CLOSEOUT — substantial completion + handover.
  { feature: 'closeout-binder', route: '/closeout-binder', Icon: PackageCheck, title: 'Closeout binder', subtitle: 'Manuals, warranties, as-builts in one PDF', tone: 'success', testID: 'tools-closeout-binder', section: 'CLOSEOUT', needsProjects: true },
  { feature: 'handover', route: '/handover', Icon: Users, title: 'Handover', subtitle: 'Walkthrough checklist + signature capture', tone: 'primary', testID: 'tools-handover', section: 'CLOSEOUT', needsProjects: true },
  // PRODUCT-F4: the homeowner's keepsake record — the best referral surface in
  // the product — had zero inbound navigation on iOS.
  { feature: 'home-passport', route: '/home-passport', Icon: BadgeCheck, title: 'Home Passport', subtitle: 'The record the homeowner keeps — warranties, permits, model numbers', tone: 'success', testID: 'tools-home-passport', section: 'CLOSEOUT', needsProjects: true },

  // ── REPORTING — what came in + raw exports.
  // Weekly Snapshot is deliberately absent: it is a single-project view that
  // dead-ends on "No project to snapshot yet" without a projectId, and it is
  // surfaced from inside each project (project-detail passes { projectId }).
  { feature: 'report-inbox', route: '/report-inbox', Icon: Inbox, title: 'Reports inbox', subtitle: 'Every DFR, RFI, submittal, invoice & CO across all jobs, in one filterable list', tone: 'info', testID: 'tools-reports-inbox', section: 'REPORTING', needsProjects: true },
  { feature: 'data-export', route: '/data-export', Icon: Download, title: 'Data export', subtitle: 'Full project export — CSVs of everything', tone: 'neutral', testID: 'tools-data-export', section: 'REPORTING', needsProjects: true },

  // ── NETWORK — subs + companies + crew. Pre-fix the Subs tab was hidden on
  // mobile (`href: null` in app/(tabs)/_layout.tsx), orphaning Sub Prequal
  // entirely from mobile users.
  { feature: 'subs', route: '/(tabs)/subs', Icon: HardHat, title: 'Subcontractors', subtitle: "Prequal packets, COIs, ratings — every sub you've worked with", tone: 'primary', testID: 'tools-subs', section: 'NETWORK' },
  { feature: 'contacts', route: '/contacts', Icon: Users, title: 'Contacts', subtitle: 'Architects, engineers, suppliers — your project directory', tone: 'info', testID: 'tools-contacts', section: 'NETWORK' },
  // PRODUCT-F4: the embed widget is how a contractor turns their own website
  // into a lead source; its setup was sidebar-only.
  { feature: 'widget-setup', route: '/widget-setup', Icon: Code, title: 'Website widget', subtitle: 'Embed an instant-estimate form on your site — leads land in Pipeline', tone: 'accent', testID: 'tools-widget-setup', section: 'NETWORK' },
  // Crew roster — Business-tier worker profiles / ID scan. Distinct from the
  // marketplace Hire flow (worker-detail). Sidebar-only before this row;
  // renders its own Paywall for non-Business.
  { feature: 'crew', route: '/crew', Icon: IdCard, title: 'Crew', subtitle: 'Worker profiles, ID verification & project assignments', tone: 'primary', testID: 'tools-crew', section: 'NETWORK' },
];

export default function DiscoverToolsScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const { projects } = useProjects();
  const hasProjects = projects.length > 0;

  // Push the REGISTRY route, not the row's literal, so a literal that has
  // drifted since ship-check last ran cannot misroute anyone.
  const open = useCallback(
    (row: ToolRow) => router.push(featureFor(row.feature).route as never),
    [router],
  );

  const grouped = useMemo(
    () => SECTIONS.map(section => ({
      section,
      rows: TOOL_ROWS.filter(r => r.section === section && (hasProjects || !r.needsProjects)),
    })).filter(g => g.rows.length > 0),
    [hasProjects],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="tools-back-btn"
          >
            <ArrowLeft size={20} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.headerTitleStack}>
            <Text style={styles.headerTitle} numberOfLines={1}>Tools</Text>
            <Text style={styles.headerSubtitle}>Every cross-project workflow</Text>
          </View>
        </View>
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {grouped.map(({ section, rows }) => (
          <View key={section} style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>{section}</Text>
            <View style={styles.sectionCard}>
              {rows.map((row, i) => (
                <React.Fragment key={row.feature}>
                  {i > 0 && <View style={styles.divider} />}
                  <NavRow
                    Icon={row.Icon}
                    title={row.title}
                    subtitle={row.subtitle}
                    tone={row.tone}
                    onPress={() => open(row)}
                    testID={row.testID}
                  />
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}

        {!hasProjects && (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={<Wrench size={32} color={Colors.primary} strokeWidth={1.75} />}
              title="More tools unlock with projects"
              message="Most tools (Daily reports, Compliance, Closeout, Reporting) are project-aware. Create your first project to unlock them."
              actionLabel="Open Projects"
              onAction={() => router.push('/(tabs)/(home)' as never)}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// Section chrome: uppercase eyebrow title + bordered card container (iOS
// Settings vibe). Divider is indented past the icon column.
function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    header: {
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.sm,
      paddingBottom: Tokens.spacing.sm,
      backgroundColor: c.bg,
      borderBottomWidth: 0.5,
      borderBottomColor: c.line,
    },
    headerTop: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Tokens.spacing.sm,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: Tokens.radius.full,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: c.surface,
    },
    headerTitleStack: {
      flex: 1,
      gap: 2,
    },
    headerTitle: {
      ...Type.serifHeadline,
      color: c.text,
    },
    headerSubtitle: {
      fontSize: Type.caption1.fontSize,
      color: c.textSecondary,
    },
    sectionWrap: {
      marginTop: Tokens.spacing.md,
      paddingHorizontal: Tokens.spacing.md,
    },
    sectionTitle: {
      fontSize: Type.caption1.fontSize,
      color: c.textSecondary,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.6,
      fontWeight: '600' as const,
      paddingHorizontal: Tokens.spacing.xxs,
      paddingBottom: Tokens.spacing.xs,
    },
    sectionCard: {
      backgroundColor: c.surface,
      borderRadius: Tokens.radius.lg,
      borderWidth: 1,
      borderColor: c.line,
      overflow: 'hidden' as const,
    },
    divider: {
      height: 1,
      backgroundColor: c.line,
      marginLeft: 56, // align past the icon column
    },
    emptyWrap: {
      marginTop: Tokens.spacing.md,
      paddingHorizontal: Tokens.spacing.md,
    },
  });
}
