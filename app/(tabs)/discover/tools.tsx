// app/(tabs)/discover/tools.tsx — cross-project workflow hub.
//
// Re-added Phase 17 after Tools was orphaned by an earlier tab-removal
// phase. Lives inside Discover as a pushed sub-route — both the
// "Tools" soft-tab pill on Discover overview and the MANAGE WORK
// NavigationCard route here.
//
// Section order is intent-based, not alphabetical:
//   1. AI Hub      — marquee AI features
//   1b. Industry   — Construction News (publisher headlines)
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
// subtitles) and the icon. `route` is written out beside `feature`
// because scripts/validate-feature-search.ts greps route literals out of
// app/(tabs)/** to prove every desktop destination is reachable on a phone —
// scripts/validate-nav-coverage.ts asserts each literal equals the registry
// route, so the two cannot fork.
//
// PLAIN TRADE (2026-10-05): a row no longer has a `tone`. Each of the 53 rows
// used to pick its own chip hue by hand, which told the contractor nothing;
// every glyph is now 24 pt single ink (components/ui/toolList.tsx), each
// section opens with a numbered title block, and the only green on this
// screen is a row while it is pressed. scripts/validate-tool-list.ts fails a
// row that brings a colour back.

import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter } from 'expo-router';
import {
  Calendar, Users, Camera, ListChecks, Layers, Clock, Wallet, BarChart3, Banknote,
  FileSignature, ShieldCheck, UserPlus, Gavel, FileDown, PackageCheck, Inbox, TrendingUp,
  Download, Wrench, ArrowLeft, ScanLine, HardHat, IdCard, ScanEye, Truck, Hourglass, Store,
  Zap, BadgeCheck, CalendarClock, Code, FileSearch, BookOpen, PenTool, KeyRound, Target,
  PieChart, SlidersHorizontal, ScrollText, Award, Stamp, Newspaper,
} from 'lucide-react-native';
import {
  MageAIMark, MageEquipment, MageTakeoff, MageChangeOrder, MageRFI, MageSubmittal,
  MageDailyReport, MagePunch, MagePlans, MagePayApp, MageCOI,
} from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { NavRow } from '@/components/NavRow';
import { ToolGroupHeader } from '@/components/ui/toolList';
import EmptyState from '@/components/EmptyState';
import { useProjects } from '@/contexts/ProjectContext';
import { featureFor, isFeatureHidden, type FeatureId } from '@/utils/featureRegistry';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useClaimedCrewProfile } from '@/hooks/useClaimedCrewProfile';

const SECTIONS = [
  'AI HUB', 'INDUSTRY', 'DECISIONS', 'FIELD', 'MONEY', 'FIND WORK',
  'COMPLIANCE', 'CLOSEOUT', 'REPORTING', 'NETWORK',
] as const;
type ToolSection = (typeof SECTIONS)[number];

interface ToolRow {
  /** Registry row that owns this destination. Every row sets it (the
   *  Construction News registry row landed in the wave-4 integration pass);
   *  it stays optional only as a fallback — a row without it opens its own
   *  `route` and never shows a tier chip. */
  feature?: FeatureId;
  /** Must equal featureFor(feature).route — see the header note. */
  route: string;
  /** Accepts lucide icons AND the bespoke Mage glyph set (plain function
   *  components, so `LucideIcon`'s ForwardRef type rejects them). Same
   *  widening, for the same reason, as components/DesktopSidebar.tsx:39 —
   *  which is why the bespoke marks were fully deployed on the desktop rail
   *  and almost absent from the iOS surfaces this file owns. */
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  subtitle: string;
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
  { feature: 'construction-ai', route: '/(tabs)/construction-ai', Icon: MageAIMark, title: 'Construction AI', subtitle: 'Code check, AI permit roadmap & plan review', testID: 'tools-construction-ai', section: 'AI HUB' },
  // Cost X-Ray was reachable only from the desktop sidebar and Cmd-K — the
  // 2026-08-03 UX audit flagged flagship features missing from the Tools grid,
  // which is the only discovery surface on iOS. Restored from PR #85.
  { feature: 'cost-xray', route: '/cost-xray', Icon: ScanEye, title: 'Cost X-Ray', subtitle: "Camera prices the hidden conditions you can't see — on your learned costs", testID: 'tools-cost-xray', section: 'AI HUB' },
  { feature: 'takeoff', route: '/takeoff', Icon: MageTakeoff, title: 'AI takeoff', subtitle: 'Upload a PDF, get a quantity takeoff with linear / area / count', testID: 'tools-takeoff', section: 'AI HUB' },
  { feature: 'plan-intelligence', route: '/plan-intelligence', Icon: FileSearch, title: 'Plan intelligence', subtitle: 'AI reads the floor plan room by room — and learns your prices every job', testID: 'tools-plan-intelligence', section: 'AI HUB' },
  { feature: 'ai-punch', route: '/ai-punch', Icon: ListChecks, title: 'AI punch from photos', subtitle: 'Walk a site with the camera, get a punch list back', testID: 'tools-ai-punch', section: 'AI HUB' },
  { feature: 'compare-drawings', route: '/compare-drawings', Icon: Layers, title: 'Compare drawings', subtitle: 'See exactly what changed between two plan revisions', testID: 'tools-compare-drawings', section: 'AI HUB' },
  { feature: 'extract-submittals', route: '/extract-submittals', Icon: BookOpen, title: 'Spec book extract', subtitle: 'Pull submittal requirements out of a 200-page spec book in one tap', testID: 'tools-spec-extract', section: 'AI HUB' },
  { feature: 'scan', route: '/scan', Icon: ScanLine, title: 'Scan anything', subtitle: 'Snap any doc (invoice, business card, COI) and it files itself to the right project', testID: 'tools-scan', section: 'AI HUB' },

  // ── INDUSTRY — what is happening outside the GC's own jobs. Construction
  // News merges a curated set of publisher feeds (supabase/functions/
  // construction-news); it needs no project and gates on no tier.
  { route: '/construction-news', Icon: Newspaper, title: 'Construction news', subtitle: 'Latest construction industry headlines', testID: 'tools-construction-news', feature: 'construction-news', section: 'INDUSTRY' },

  // ── DECISIONS — what is waiting on the GC to act on.
  // PRODUCT-F4 / UX-F16: the marketed chase list was sidebar-only —
  // unreachable on iPhone except through search.
  { feature: 'waiting-on', route: '/waiting-on', Icon: Hourglass, title: 'Waiting on others', subtitle: 'Who owes you an answer — overdue RFIs, submittals, sub confirmations', testID: 'tools-waiting-on', section: 'DECISIONS', needsProjects: true },
  { feature: 'change-order', route: '/change-order', Icon: MageChangeOrder, title: 'Change orders', subtitle: 'Review, approve, send to client', testID: 'tools-change-orders', section: 'DECISIONS', needsProjects: true },
  { feature: 'rfi', route: '/rfi', Icon: MageRFI, title: 'RFIs', subtitle: 'Requests for information across all projects', testID: 'tools-rfi', section: 'DECISIONS', needsProjects: true },
  { feature: 'submittal', route: '/submittal', Icon: MageSubmittal, title: 'Submittals', subtitle: 'Spec submittals waiting for review', testID: 'tools-submittal', section: 'DECISIONS', needsProjects: true },
  { feature: 'oac-meeting', route: '/oac-meeting', Icon: Calendar, title: 'OAC meetings', subtitle: 'Owner-architect-contractor meetings & follow-ups', testID: 'tools-oac-meeting', section: 'DECISIONS', needsProjects: true },
  // PRODUCT-F4: sidebar-only before — the owner-facing delay record was
  // unreachable on the phone that logs the delays.
  { feature: 'delay-events', route: '/delay-events', Icon: CalendarClock, title: 'Delay register', subtitle: 'Weather, RFI and owner delays with the notice clock running', testID: 'tools-delay-events', section: 'DECISIONS', needsProjects: true },

  // ── FIELD — what crews + owners do day-to-day.
  { feature: 'last-planner', route: '/last-planner', Icon: ListChecks, title: 'Last Planner', subtitle: '3-week lookahead, weekly commitments & PPC reliability', testID: 'tools-last-planner', section: 'FIELD', needsProjects: true },
  { feature: 'daily-report', route: '/daily-report', Icon: MageDailyReport, title: 'Daily reports', subtitle: 'Voice-first DFRs with photo + GPS', testID: 'tools-daily-report', section: 'FIELD', needsProjects: true },
  { feature: 'photo-triage', route: '/photo-triage', Icon: Camera, title: 'Photo triage', subtitle: 'Tag, organize & file jobsite photos', testID: 'tools-photo-triage', section: 'FIELD', needsProjects: true },
  { feature: 'punch-list', route: '/punch-list', Icon: MagePunch, title: 'Punch list', subtitle: 'Walk-through items + closeout', testID: 'tools-punch-list', section: 'FIELD', needsProjects: true },
  { feature: 'selections', route: '/selections', Icon: PenTool, title: 'Selections', subtitle: 'Finish picks, fixtures, appliances', testID: 'tools-selections', section: 'FIELD', needsProjects: true },
  { feature: 'time-tracking', route: '/time-tracking', Icon: Clock, title: 'Time tracking', subtitle: 'Crew hours & timesheets', testID: 'tools-time-tracking', section: 'FIELD', needsProjects: true },
  { feature: 'plans', route: '/plans', Icon: MagePlans, title: 'Plans & drawings', subtitle: 'Markup, compare versions, share', testID: 'tools-plans', section: 'FIELD', needsProjects: true },
  // Safety hub — Business-tier. Only reachable via DesktopSidebar before this
  // tile, so it shipped dark on iOS (the primary target). It renders its own
  // Paywall for non-Business.
  //
  // Opened from here it has no projectId, and app/safety.tsx now handles that
  // with a ToolProjectPicker (audit #81): picking a job sets ?projectId= on the
  // hub, so JHAs, toolbox talks, the hazard log, incidents and inspections are
  // one tap away. The company-wide tiles (certifications, forms, OSHA 300)
  // need no project and stay under the picker. An invited foreman on a free
  // plan also gets in, and the picker lists only the jobs he was invited to.
  { feature: 'safety', route: '/safety', Icon: HardHat, title: 'Safety', subtitle: 'JHAs, toolbox talks, incidents, inspections & OSHA logs', testID: 'tools-safety', section: 'FIELD', needsProjects: true },
  // PRODUCT-F4 / UX-F16: the 09-02 Deliveries batch shipped with no iOS entry
  // point at all (sidebar ≥1024pt + search only).
  { feature: 'deliveries', route: '/deliveries', Icon: Truck, title: 'Deliveries', subtitle: "What's arriving, what's late — chase it before the crew waits", testID: 'tools-deliveries', section: 'FIELD', needsProjects: true },
  { feature: 'building-access', route: '/building-access', Icon: KeyRound, title: 'Building access', subtitle: 'Freight elevator, dock and badge bookings that gate a delivery', testID: 'tools-building-access', section: 'FIELD', needsProjects: true },
  { feature: 'equipment', route: '/(tabs)/equipment', Icon: MageEquipment, title: 'Equipment', subtitle: "Rentals, utilization and what's on which site", testID: 'tools-equipment', section: 'FIELD', needsProjects: true },

  // ── MONEY — every cash-related workflow.
  { feature: 'win-optimizer', route: '/win-optimizer', Icon: Target, title: 'Win optimizer', subtitle: 'The bid price that wins AND profits — learned from your own win/loss history', testID: 'tools-win-optimizer', section: 'MONEY' },
  { feature: 'smart-proposal', route: '/smart-proposal', Icon: FileSignature, title: 'Smart proposal', subtitle: 'Good / better / best, priced to win — send, track, close', testID: 'tools-smart-proposal', section: 'MONEY' },
  { feature: 'cash-flow', route: '/cash-flow', Icon: Wallet, title: 'Cash flow', subtitle: 'Multi-week forecast across all projects', testID: 'tools-cash-flow', section: 'MONEY', needsProjects: true },
  { feature: 'budget-dashboard', route: '/budget-dashboard', Icon: PieChart, title: 'Budget dashboard', subtitle: 'Earned-value (CPI/SPI) for one project — pick a project to chart', testID: 'tools-budget-dashboard', section: 'MONEY', needsProjects: true },
  // WIP Report — Business-tier. Portfolio-wide (no projectId needed); renders
  // its own Paywall for non-Business. Was desktop-sidebar-only before this row.
  { feature: 'wip-report', route: '/wip-report', Icon: TrendingUp, title: 'WIP report', subtitle: 'Over/under billings & earned revenue across the portfolio', testID: 'tools-wip-report', section: 'MONEY', needsProjects: true },
  { feature: 'estimate-calibration', route: '/estimate-calibration', Icon: SlidersHorizontal, title: 'Estimate calibration', subtitle: 'Where your bids run high or low — and the fix', testID: 'tools-estimate-calibration', section: 'MONEY', needsProjects: true },
  // PRODUCT-F4: sidebar-only before.
  { feature: 'estimate-scorecard', route: '/estimate-scorecard', Icon: BarChart3, title: 'Estimate scorecard', subtitle: 'Bid vs. actual on your closed jobs — where the money went', testID: 'tools-estimate-scorecard', section: 'MONEY', needsProjects: true },
  { feature: 'payments', route: '/payments', Icon: Banknote, title: 'Payments', subtitle: 'Client payment status & history', testID: 'tools-payments', section: 'MONEY', needsProjects: true },
  { feature: 'aia-pay-app', route: '/aia-pay-app', Icon: MagePayApp, title: 'Pay apps', subtitle: 'G702/G703 auto-populated from invoices', testID: 'tools-aia-pay-app', section: 'MONEY', needsProjects: true },
  { feature: 'lien-waivers', route: '/lien-waivers', Icon: ScrollText, title: 'Lien waivers', subtitle: 'Generate & track conditional / unconditional', testID: 'tools-lien-waivers', section: 'MONEY', needsProjects: true },
  { feature: 'leads', route: '/leads', Icon: UserPlus, title: 'Pipeline', subtitle: 'Inquiries → qualified → proposal → won', testID: 'tools-pipeline', section: 'MONEY' },
  { feature: 'buyout', route: '/buyout', Icon: Gavel, title: 'Buyout', subtitle: 'Sub package builder + bid award flow', testID: 'tools-buyout', section: 'MONEY' },
  { feature: 'sub-scorecard', route: '/sub-scorecard', Icon: Award, title: 'Sub scorecard', subtitle: "Who's actually good? Graded from your real job costs", testID: 'tools-sub-scorecard', section: 'MONEY' },
  { feature: 'tax-1099', route: '/tax-1099-export', Icon: FileDown, title: '1099-NEC export', subtitle: 'Year-end CSV for your CPA — flags subs paid ≥ $600', testID: 'tools-tax-1099', section: 'MONEY' },

  // ── FIND WORK — PRODUCT-F4: both were sidebar-only.
  // #16 (wave 5): a pre-priced bid uses his closed jobs' costs when he has
  // them, and the owner's budget when he doesn't — "from your cost book"
  // promised history that a new account doesn't have.
  { feature: 'auto-bids', route: '/auto-bids', Icon: Zap, title: 'Pre-priced bids', subtitle: 'Open bids priced from what your closed jobs cost, or the owner\u2019s budget — review before you send', testID: 'tools-auto-bids', section: 'FIND WORK' },
  // Audit round 2, #11: this read "Vendors, yards and price history". The
  // screen is a MOCK catalog (mocks/suppliers.ts) with no price history and
  // no real vendor in it; say so on the door, not only once inside.
  { feature: 'marketplace', route: '/(tabs)/marketplace', Icon: Store, title: 'Supplier catalog (demo)', subtitle: 'Example listings. These suppliers are not real.', testID: 'tools-suppliers', section: 'FIND WORK' },

  // ── COMPLIANCE — the regulatory side.
  { feature: 'coi-vault', route: '/coi-vault', Icon: MageCOI, title: 'COI vault', subtitle: 'Sub insurance certificates + expiry tracking', testID: 'tools-coi-vault', section: 'COMPLIANCE', needsProjects: true },
  { feature: 'permits', route: '/permits', Icon: Stamp, title: 'Permits', subtitle: 'Filings, inspections, expirations', testID: 'tools-permits', section: 'COMPLIANCE', needsProjects: true },
  { feature: 'warranties', route: '/warranties', Icon: ShieldCheck, title: 'Warranties', subtitle: 'Workmanship + product warranties on file', testID: 'tools-warranties', section: 'COMPLIANCE', needsProjects: true },

  // ── CLOSEOUT — substantial completion + handover.
  { feature: 'closeout-binder', route: '/closeout-binder', Icon: PackageCheck, title: 'Closeout binder', subtitle: 'Manuals, warranties, as-builts in one PDF', testID: 'tools-closeout-binder', section: 'CLOSEOUT', needsProjects: true },
  { feature: 'handover', route: '/handover', Icon: Users, title: 'Handover', subtitle: 'Walkthrough checklist + signature capture', testID: 'tools-handover', section: 'CLOSEOUT', needsProjects: true },
  // PRODUCT-F4: the homeowner's keepsake record — the best referral surface in
  // the product — had zero inbound navigation on iOS.
  { feature: 'home-passport', route: '/home-passport', Icon: BadgeCheck, title: 'Home Passport', subtitle: 'The record the homeowner keeps — warranties, permits, model numbers', testID: 'tools-home-passport', section: 'CLOSEOUT', needsProjects: true },

  // ── REPORTING — what came in + raw exports.
  // Weekly Snapshot is deliberately absent: it is a single-project view that
  // dead-ends on "No project to snapshot yet" without a projectId, and it is
  // surfaced from inside each project (project-detail passes { projectId }).
  { feature: 'report-inbox', route: '/report-inbox', Icon: Inbox, title: 'Reports inbox', subtitle: 'Every DFR, RFI, submittal, invoice & CO across all jobs, in one filterable list', testID: 'tools-reports-inbox', section: 'REPORTING', needsProjects: true },
  { feature: 'data-export', route: '/data-export', Icon: Download, title: 'Data export', subtitle: 'Full project export — CSVs of everything', testID: 'tools-data-export', section: 'REPORTING', needsProjects: true },

  // ── NETWORK — subs + companies + crew. Pre-fix the Subs tab was hidden on
  // mobile (`href: null` in app/(tabs)/_layout.tsx), orphaning Sub Prequal
  // entirely from mobile users.
  { feature: 'subs', route: '/(tabs)/subs', Icon: HardHat, title: 'Subs', subtitle: "Prequal packets, COIs, ratings — every sub you've worked with", testID: 'tools-subs', section: 'NETWORK' },
  { feature: 'contacts', route: '/contacts', Icon: Users, title: 'Contacts', subtitle: 'Architects, engineers, suppliers — your project directory', testID: 'tools-contacts', section: 'NETWORK' },
  // PRODUCT-F4: the embed widget is how a contractor turns their own website
  // into a lead source; its setup was sidebar-only.
  { feature: 'widget-setup', route: '/widget-setup', Icon: Code, title: 'Website widget', subtitle: 'Embed an instant-estimate form on your site — leads land in Pipeline', testID: 'tools-widget-setup', section: 'NETWORK' },
  // Crew roster — Business-tier worker profiles / ID scan. Distinct from the
  // marketplace Hire flow (worker-detail). Sidebar-only before this row;
  // renders its own Paywall for non-Business.
  { feature: 'crew', route: '/crew', Icon: IdCard, title: 'Crew', subtitle: 'Worker profiles, ID verification & project assignments', testID: 'tools-crew', section: 'NETWORK' },
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

  // Tier badge. Tools is the only feature-discovery surface on iPhone, and it
  // was showing a free contractor twenty rows with nothing to separate the
  // ones he can open from the ones that bounce him to a plan chooser — his
  // first three taps were three paywalls, which reads as bait rather than as a
  // price boundary. NavRow already had the slot (`meta`) and this file never
  // passed it.
  //
  // The gate is read from the registry entry, never from a field on the row,
  // so the badge and the destination's own gate cannot fork — the same rule
  // components/DesktopSidebar.tsx:155 states for its lock icon. Do NOT add a
  // `requires` field to ToolRow to badge more rows: that is a second source of
  // truth and it will drift from the gate the screen enforces.
  //
  // Consequence, so nobody reads a missing badge as a bug. MEASURED against
  // this grid, not quoted from the registry-wide validator: of the 53 rows
  // here, 22 badge, 21 have no tier gate anywhere, and TEN gate on canAccess()
  // with no registry `requires`, so they stay blank — construction-ai
  // ('ai_code_check'), takeoff ('ai_estimate_wizard'), ai-punch
  // ('punch_list_closeout'), plans ('plan_markup'), permits, oac-meeting,
  // win-optimizer, sub-scorecard, estimate-calibration, closeout-binder.
  // Fixing them is one line each IN THE REGISTRY and this badge picks each one
  // up with no edit here.
  //
  // Do NOT extend that list by eye. compare-drawings and extract-submittals
  // look like paid AI rows and are NOT gated (grep: zero canAccess in either
  // screen) — giving them a `requires` would put a lock chip in front of a
  // screen that opens, which scripts/validate-feature-registry-gates.ts fails
  // on by name. Run that script for the real list.
  //
  // A partial badge set is still strictly better than none: an unbadged row is
  // a wall 10 times in 31 (32%) where before the change every row was a coin
  // flip at 32 in 53 (60%). No badge here ever over-claims — the same
  // validator proves no chip advertises a tier its destination does not
  // enforce, in either direction.
  const { canAccess, requiredTierFor } = useTierAccess();
  // #74 (wave 5): for a worker who claimed his crew profile and has no crew
  // plan, the Crew row is HIS profile — "My Profile", no Business chip (the
  // screen already opens for him; only the row's words were a roster's).
  const claimedCrewWorker = useClaimedCrewProfile();
  const crewAsProfile = useCallback((row: ToolRow): boolean => {
    if (row.feature !== 'crew' || !claimedCrewWorker) return false;
    const requires = featureFor('crew').requires;
    return !!requires && !canAccess(requires);
  }, [claimedCrewWorker, canAccess]);
  const tierMeta = useCallback((row: ToolRow): string | undefined => {
    if (!row.feature) return undefined;
    if (crewAsProfile(row)) return undefined;
    const requires = featureFor(row.feature).requires;
    if (!requires || canAccess(requires)) return undefined;
    return requiredTierFor(requires).toUpperCase();
  }, [canAccess, requiredTierFor, crewAsProfile]);

  // Push the REGISTRY route, not the row's literal, so a literal that has
  // drifted since ship-check last ran cannot misroute anyone.
  const open = useCallback(
    (row: ToolRow) => router.push((row.feature ? featureFor(row.feature).route : row.route) as never),
    [router],
  );

  const grouped = useMemo(
    () => SECTIONS.map(section => ({
      section,
      // A row whose destination is switched off by a content-rights flag
      // (isFeatureHidden) is not shown; a section left empty drops below.
      rows: TOOL_ROWS.filter(r => r.section === section && (hasProjects || !r.needsProjects) && !isFeatureHidden(r.feature)),
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
            <ArrowLeft size={24} color={themeColors.text} strokeWidth={2} />
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
        {grouped.map(({ section, rows }, gi) => (
          <View key={section} style={styles.sectionWrap}>
            {/* Title block: sheet number, name, how many tools are in it. */}
            <ToolGroupHeader index={String(gi + 1).padStart(2, '0')} label={section} count={rows.length} />
            {rows.map(row => {
              const tier = tierMeta(row);
              return (
                <NavRow
                  key={row.testID}
                  Icon={row.Icon}
                  title={crewAsProfile(row) ? 'My profile' : row.title}
                  subtitle={crewAsProfile(row) ? 'Your crew profile — phone, email and trades' : row.subtitle}
                  meta={tier}
                  locked={!!tier}
                  onPress={() => open(row)}
                  testID={row.testID}
                />
              );
            })}
          </View>
        ))}

        {!hasProjects && (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={<Wrench size={32} color={Colors.primary} strokeWidth={1.75} />}
              title="Most tools need a project"
              message="Daily reports, compliance, closeout and reporting work on a project. Create your first project to use them."
              actionLabel="Open projects"
              onAction={() => router.push('/(tabs)/(home)' as never)}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// Section chrome (Plain trade): a title-block header and bare rows on the
// concrete ground — no section card, no per-row divider (NavRow draws its own
// hairline).
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
      gap: 6,
    },
    backBtn: {
      width: 40,
      height: 40,
      marginLeft: -10,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
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
      marginTop: 22,
      paddingHorizontal: Tokens.spacing.md,
    },
    emptyWrap: {
      marginTop: Tokens.spacing.md,
      paddingHorizontal: Tokens.spacing.md,
    },
  });
}
