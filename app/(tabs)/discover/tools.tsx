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
//   5. Compliance  — COI, permits, warranties
//   6. Closeout    — substantial completion + handover
//   7. Reporting   — daily report inbox, snapshots, data exports
//
// Route targets verified against the actual app/ directory — every
// NavRow links to a route file that exists. Tones constrained to
// NavRow's 7-tone palette (neutral/primary/success/warning/error/info/
// accent) so color carries semantic weight.

import React from 'react';
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
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { NavRow } from '@/components/NavRow';
import EmptyState from '@/components/EmptyState';
import { useProjects } from '@/contexts/ProjectContext';

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
        {/* AI Hub — marquee features. Pre-fix this only surfaced
            Construction AI; the audit found 4 other AI features that
            were buried in project-detail (28 tiles) or unreachable
            from the bottom nav entirely. Surfacing them here turns
            them from "hidden gems" into discoverable wedge features
            against competitors that don't have them. */}
        <Section title="AI HUB" styles={styles}>
          <NavRow
            Icon={MageAIMark}
            title="Construction AI"
            subtitle="Code check, AI permit roadmap & plan review"
            tone="accent"
            onPress={() => router.push('/(tabs)/construction-ai' as never)}
            testID="tools-construction-ai"
          />
          <Divider styles={styles} />
          {/* Cost X-Ray was reachable only from the desktop sidebar and Cmd-K —
              the 2026-08-03 UX audit flagged flagship features missing from the
              Tools grid, which is the only discovery surface on iOS. Restored
              from PR #85. */}
          <NavRow
            Icon={ScanEye}
            title="Cost X-Ray"
            subtitle="Camera prices the hidden conditions you can't see — on your learned costs"
            tone="accent"
            onPress={() => router.push('/cost-xray' as never)}
            testID="tools-cost-xray"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={Ruler}
            title="AI Takeoff"
            subtitle="Upload a PDF, get a quantity takeoff with linear / area / count"
            tone="accent"
            onPress={() => router.push('/takeoff' as never)}
            testID="tools-takeoff"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={ScanSearch}
            title="Plan Intelligence"
            subtitle="AI reads the floor plan room by room — and learns your prices every job"
            tone="accent"
            onPress={() => router.push('/plan-intelligence' as never)}
            testID="tools-plan-intelligence"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={ListChecks}
            title="AI Punch from Photos"
            subtitle="Walk a site with the camera, get a punch list back"
            tone="accent"
            onPress={() => router.push('/ai-punch' as never)}
            testID="tools-ai-punch"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={Layers}
            title="Compare Drawings"
            subtitle="Diff two plan revisions, see exactly what changed"
            tone="accent"
            onPress={() => router.push('/compare-drawings' as never)}
            testID="tools-compare-drawings"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={ScanLine}
            title="Spec Book Extract"
            subtitle="Pull submittal requirements out of a 200-page spec book in one tap"
            tone="accent"
            onPress={() => router.push('/extract-submittals' as never)}
            testID="tools-spec-extract"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={ScanLine}
            title="Scan Anything"
            subtitle="Snap any doc — invoice, business card, COI — it files itself to the right project"
            tone="warning"
            onPress={() => router.push('/scan' as never)}
            testID="tools-scan"
          />
        </Section>

        {/* Decisions — what's waiting on the GC to act on. */}
        {hasProjects && (
          <Section title="DECISIONS" styles={styles}>
            <NavRow
              Icon={MessageSquare}
              title="Change orders"
              subtitle="Review, approve, send to client"
              tone="success"
              onPress={() => router.push('/change-order' as never)}
              testID="tools-change-orders"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={FileText}
              title="RFIs"
              subtitle="Requests for information across all projects"
              tone="info"
              onPress={() => router.push('/rfi' as never)}
              testID="tools-rfi"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={FileCheck}
              title="Submittals"
              subtitle="Spec submittals waiting for review"
              tone="info"
              onPress={() => router.push('/submittal' as never)}
              testID="tools-submittal"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={Calendar}
              title="OAC meetings"
              subtitle="Owner-architect-contractor meetings & follow-ups"
              tone="primary"
              onPress={() => router.push('/oac-meeting' as never)}
              testID="tools-oac-meeting"
            />
          </Section>
        )}

        {/* Field — what crews + owners do day-to-day. */}
        {hasProjects && (
          <Section title="FIELD" styles={styles}>
            <NavRow
              Icon={ListChecks}
              title="Last Planner"
              subtitle="3-week lookahead, weekly commitments & PPC reliability"
              tone="accent"
              onPress={() => router.push('/last-planner' as never)}
              testID="tools-last-planner"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={ClipboardList}
              title="Daily reports"
              subtitle="Voice-first DFRs with photo + GPS"
              tone="primary"
              onPress={() => router.push('/daily-report' as never)}
              testID="tools-daily-report"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={Camera}
              title="Photo triage"
              subtitle="Tag, organize & file jobsite photos"
              tone="info"
              onPress={() => router.push('/photo-triage' as never)}
              testID="tools-photo-triage"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={ListChecks}
              title="Punch list"
              subtitle="Walk-through items + closeout"
              tone="warning"
              onPress={() => router.push('/punch-list' as never)}
              testID="tools-punch-list"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={Layers}
              title="Selections"
              subtitle="Finish picks, fixtures, appliances"
              tone="accent"
              onPress={() => router.push('/selections' as never)}
              testID="tools-selections"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={Clock}
              title="Time tracking"
              subtitle="Crew hours & timesheets"
              tone="primary"
              onPress={() => router.push('/time-tracking' as never)}
              testID="tools-time-tracking"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={ImageIcon}
              title="Plans & drawings"
              subtitle="Markup, compare versions, share"
              tone="info"
              onPress={() => router.push('/plans' as never)}
              testID="tools-plans"
            />
            <Divider styles={styles} />
            {/* Safety hub — Business-tier. Only reachable via DesktopSidebar
                before this tile, so it shipped dark on iOS (the primary
                target). /safety handles a missing projectId (company-scoped
                tiles + picker) and renders its own Paywall for non-Business. */}
            <NavRow
              Icon={HardHat}
              title="Safety"
              subtitle="JHAs, toolbox talks, incidents, inspections & OSHA logs"
              tone="warning"
              onPress={() => router.push('/safety' as never)}
              testID="tools-safety"
            />
          </Section>
        )}

        {/* Money — every cash-related workflow. */}
        <Section title="MONEY" styles={styles}>
          <NavRow
            Icon={Trophy}
            title="Win Optimizer"
            subtitle="The bid price that wins AND profits — learned from your own win/loss history"
            tone="accent"
            onPress={() => router.push('/win-optimizer' as never)}
            testID="tools-win-optimizer"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={FileSignature}
            title="Smart Proposal"
            subtitle="Good / better / best, priced to win — send, track, close"
            tone="accent"
            onPress={() => router.push('/smart-proposal' as never)}
            testID="tools-smart-proposal"
          />
          <Divider styles={styles} />
          {hasProjects && (
            <>
              <NavRow
                Icon={Wallet}
                title="Cash flow"
                subtitle="Multi-week forecast across all projects"
                tone="primary"
                onPress={() => router.push('/cash-flow' as never)}
                testID="tools-cash-flow"
              />
              <Divider styles={styles} />
              <NavRow
                Icon={BarChart3}
                title="Budget dashboard"
                subtitle="Earned-value (CPI/SPI) for one project — pick a project to chart"
                tone="success"
                onPress={() => router.push('/budget-dashboard' as never)}
                testID="tools-budget-dashboard"
              />
              <Divider styles={styles} />
              {/* WIP Report — Business-tier. Portfolio-wide (no projectId
                  needed); renders its own Paywall for non-Business. Was
                  desktop-sidebar-only before this tile. */}
              <NavRow
                Icon={TrendingUp}
                title="WIP report"
                subtitle="Over/under billings & earned revenue across the portfolio"
                tone="success"
                onPress={() => router.push('/wip-report' as never)}
                testID="tools-wip-report"
              />
              <Divider styles={styles} />
              <NavRow
                Icon={TrendingUp}
                title="Estimate Calibration"
                subtitle="Where your bids run high or low — and the fix"
                tone="warning"
                onPress={() => router.push('/estimate-calibration' as never)}
                testID="tools-estimate-calibration"
              />
              <Divider styles={styles} />
              <NavRow
                Icon={Banknote}
                title="Payments"
                subtitle="Client payment status & history"
                tone="success"
                onPress={() => router.push('/payments' as never)}
                testID="tools-payments"
              />
              <Divider styles={styles} />
              <NavRow
                Icon={FileSignature}
                title="AIA pay applications"
                subtitle="G702/G703 auto-populated from invoices"
                tone="success"
                onPress={() => router.push('/aia-pay-app' as never)}
                testID="tools-aia-pay-app"
              />
              <Divider styles={styles} />
              <NavRow
                Icon={ShieldCheck}
                title="Lien waivers"
                subtitle="Generate & track conditional / unconditional"
                tone="info"
                onPress={() => router.push('/lien-waivers' as never)}
                testID="tools-lien-waivers"
              />
              <Divider styles={styles} />
            </>
          )}
          <NavRow
            Icon={UserPlus}
            title="Pipeline"
            subtitle="Inquiries → qualified → proposal → won"
            tone="accent"
            onPress={() => router.push('/leads' as never)}
            testID="tools-pipeline"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={Gavel}
            title="Buyout"
            subtitle="Sub package builder + bid award flow"
            tone="info"
            onPress={() => router.push('/buyout' as never)}
            testID="tools-buyout"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={Trophy}
            title="Sub Scorecard"
            subtitle="Who's actually good? Graded from your real job costs"
            tone="accent"
            onPress={() => router.push('/sub-scorecard' as never)}
            testID="tools-sub-scorecard"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={FileDown}
            title="1099-NEC export"
            subtitle="Year-end CSV for your CPA — flags subs paid ≥ $600"
            tone="success"
            onPress={() => router.push('/tax-1099-export' as never)}
            testID="tools-tax-1099"
          />
        </Section>

        {/* Compliance — the regulatory side. */}
        {hasProjects && (
          <Section title="COMPLIANCE" styles={styles}>
            <NavRow
              Icon={ShieldCheck}
              title="COI vault"
              subtitle="Sub insurance certificates + expiry tracking"
              tone="info"
              onPress={() => router.push('/coi-vault' as never)}
              testID="tools-coi-vault"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={AlertTriangle}
              title="Permits"
              subtitle="Filings, inspections, expirations"
              tone="warning"
              onPress={() => router.push('/permits' as never)}
              testID="tools-permits"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={ShieldCheck}
              title="Warranties"
              subtitle="Workmanship + product warranties on file"
              tone="primary"
              onPress={() => router.push('/warranties' as never)}
              testID="tools-warranties"
            />
          </Section>
        )}

        {/* Closeout — substantial completion + handover. */}
        {hasProjects && (
          <Section title="CLOSEOUT" styles={styles}>
            <NavRow
              Icon={PackageCheck}
              title="Closeout binder"
              subtitle="Manuals, warranties, as-builts in one PDF"
              tone="success"
              onPress={() => router.push('/closeout-binder' as never)}
              testID="tools-closeout-binder"
            />
            <Divider styles={styles} />
            <NavRow
              Icon={Users}
              title="Handover"
              subtitle="Walkthrough checklist + signature capture"
              tone="primary"
              onPress={() => router.push('/handover' as never)}
              testID="tools-handover"
            />
          </Section>
        )}

        {/* Reporting — what came in + scheduled digests + raw exports. */}
        {hasProjects && (
          <Section title="REPORTING" styles={styles}>
            <NavRow
              Icon={Inbox}
              title="Reports inbox"
              subtitle="Every DFR, RFI, submittal, invoice & CO across all jobs, in one filterable list"
              tone="info"
              onPress={() => router.push('/report-inbox' as never)}
              testID="tools-reports-inbox"
            />
            <Divider styles={styles} />
            {/* Weekly snapshot is a single-project view — it needs a projectId
                and shows a dead-end "No project to snapshot yet" empty state
                when opened without one. It's surfaced from inside each project
                (project-detail passes { projectId }); linking it here globally
                only ever dead-ended, so it's removed from this cross-project hub. */}
            <NavRow
              Icon={Download}
              title="Data export"
              subtitle="Full project export — CSVs of everything"
              tone="neutral"
              onPress={() => router.push('/data-export' as never)}
              testID="tools-data-export"
            />
          </Section>
        )}

        {/* Network — subs + companies + crew. Pre-fix the Subs tab was
            hidden on mobile (`href: null` in app/(tabs)/_layout.tsx),
            orphaning Sub Prequal entirely from mobile users. Now reachable
            from Tools alongside the rest of the cross-project workflows. */}
        <Section title="NETWORK" styles={styles}>
          <NavRow
            Icon={HardHat}
            title="Subcontractors"
            subtitle="Prequal packets, COIs, ratings — every sub you've worked with"
            tone="primary"
            onPress={() => router.push('/(tabs)/subs' as never)}
            testID="tools-subs"
          />
          <Divider styles={styles} />
          <NavRow
            Icon={Users}
            title="Contacts"
            subtitle="Architects, engineers, suppliers — your project directory"
            tone="info"
            onPress={() => router.push('/contacts' as never)}
            testID="tools-contacts"
          />
          <Divider styles={styles} />
          {/* Crew roster — Business-tier worker profiles / ID scan. Distinct
              from the marketplace Hire flow (worker-detail). Sidebar-only
              before this tile; renders its own Paywall for non-Business. */}
          <NavRow
            Icon={IdCard}
            title="Crew"
            subtitle="Worker profiles, ID verification & project assignments"
            tone="primary"
            onPress={() => router.push('/crew' as never)}
            testID="tools-crew"
          />
        </Section>

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

// Local Section component — uppercase eyebrow title + bordered card
// container. iOS Settings vibe, consistent with the existing tools
// pattern. Local to this file because Discover overview uses a
// different visual rhythm (NavigationCard with side accent).
function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.sectionWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

// Divider — thin hairline between NavRows inside a Section card.
// iOS-Settings style: indented from the left so it doesn't cut under
// the icon column.
function Divider({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return <View style={styles.divider} />;
}

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
