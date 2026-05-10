// DashboardHero — Prepperly-inspired top-of-home dashboard.
//
// What it is:
//   The user pointed to a meal-prep app's homepage (Prepperly) and said
//   "I want my homepage to look something like this." This component is
//   the construction-PM transposition of that aesthetic: cream-toned
//   card on a tinted background, big serif-style headline, a row of
//   stat cards, a row of photo-overlay quick stats, a "This Week's
//   Featured Project" hero, and a right-rail of quick actions
//   (collapses to a vertical list on phone).
//
// Where it lives:
//   Mounted as a ListHeader piece on the existing home tab so the
//   Prepperly aesthetic sits ABOVE the project list — keeping the
//   list-driven nav users rely on while giving the homepage a
//   dashboard front door. Pre-fix the home tab opened straight to the
//   project list with a small filter chip row; first-launch users
//   landed on a screen with no narrative.
//
// What's a stat:
//   - Active Projects — count of projects with status='in_progress'
//   - Avg Daily Hours (this week) — sum of TimeEntry hours / 7
//   - Avg Photos per Day (this week) — count of project photos with
//     timestamp in last 7d / 7
//   - Outstanding Invoices — sum of (totalDue - amountPaid) for
//     unpaid invoices
//   - Pending Approvals — change orders awaiting GC sign + open RFIs
//   - Crew On Site — # workers currently clocked_in
//
// What's a quick action (right rail):
//   "Plan Today" → /(tabs)/summary
//   "Open Schedule" → most-recent project's /schedule-pro
//   "Approvals" → /approvals
//   "Run Estimate Review" → most-recent project's /estimate-review

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ImageBackground, ScrollView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ChevronRight, Plus, CalendarCheck, Search, ListChecks, Sparkles,
  Briefcase, Clock, Image as ImageIcon, Users, FileText, ShieldCheck,
  AlertTriangle, Gavel,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTimeEntries } from '@/hooks/useTimeEntries';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { formatMoneyShort } from '@/utils/formatters';
import { generateForecast, computeDangerWeekActions, type CashFlowWeek, type CashFlowAction } from '@/utils/cashFlowEngine';
import { loadCashFlowData, isSetupComplete } from '@/utils/cashFlowStorage';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface DashboardHeroProps {
  onNewProjectPress?: () => void;
}

export default function DashboardHero({ onNewProjectPress }: DashboardHeroProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { projects, invoices, changeOrders, rfis, settings, projectPhotos } = useProjects();
  const { liveEntries } = useTimeEntries();
  const responsive = useResponsiveLayout();

  // ─── Cash flow danger zone ────────────────────────────────
  // Vision-doc feature #2: surface "you're going to be broke on
  // June 14" before the GC opens any other tab. Self-contained —
  // loads the same data the Summary tab uses, but renders nothing
  // when the forecast is healthy or setup is incomplete. The
  // CashFlowAlerts component handles the same logic on summary
  // with a richer surface; here we just need the silent watchdog.
  const [forecast, setForecast] = useState<CashFlowWeek[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!(await isSetupComplete())) return;
        const data = await loadCashFlowData();
        if (cancelled) return;
        if (data.startingBalance > 0 || data.expenses.length > 0) {
          const f = generateForecast(
            data.startingBalance,
            data.expenses,
            [],
            data.expectedPayments,
            8,
            data.defaultPaymentTerms,
          );
          if (!cancelled) setForecast(f);
        }
      } catch (err) {
        console.warn('[DashboardHero] cash flow forecast load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [projects]);

  // First week within the next 6 where running balance goes
  // negative. We deliberately stop at week 6 — any further out and
  // the forecast is too speculative to alarm on. If no danger week
  // is found, the banner stays hidden.
  const dangerWeek = useMemo(() => {
    if (!forecast || forecast.length === 0) return null;
    return forecast.slice(0, 6).find(w => w.runningBalance < 0) ?? null;
  }, [forecast]);

  const dangerWeeksAway = useMemo(() => {
    if (!forecast || !dangerWeek) return 0;
    return forecast.indexOf(dangerWeek) + 1;
  }, [forecast, dangerWeek]);

  // Vision-doc feature #14: "Three actions to fix it". When the danger
  // banner appears, surface concrete next steps. Each action has a
  // route — tap once to land on the screen where the GC executes it.
  const dangerActions = useMemo<CashFlowAction[]>(() => {
    if (!dangerWeek || !forecast) return [];
    return computeDangerWeekActions({
      dangerWeek,
      invoices,
      forecast,
    });
  }, [dangerWeek, forecast, invoices]);

  // ─── Greeting ─────────────────────────────────────────────
  // Pulls the GC's first name from settings.branding.contactName,
  // falls back to user.name → user.email local-part → "there".
  // The greeting word rotates by hour so the page feels alive
  // (morning / afternoon / evening / night).
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return 'Working late,';
    if (h < 12) return 'Good morning,';
    if (h < 17) return 'Good afternoon,';
    if (h < 21) return 'Good evening,';
    return 'Wrapping up,';
  }, []);

  const firstName = useMemo(() => {
    const branding = settings?.branding?.contactName?.trim();
    if (branding) return branding.split(/\s+/)[0];
    const userName = user?.name?.trim();
    if (userName) return userName.split(/\s+/)[0];
    const email = user?.email?.trim();
    if (email && email.includes('@')) {
      const local = email.split('@')[0];
      // Title-case "danthompson" → "Dan Thompson" lossy; we just
      // upper the first char so "dan" reads as "Dan".
      return local.charAt(0).toUpperCase() + local.slice(1);
    }
    return 'there';
  }, [settings?.branding?.contactName, user?.name, user?.email]);

  // ─── Stats ────────────────────────────────────────────────
  const activeCount = useMemo(
    () => projects.filter(p => p.status === 'in_progress').length,
    [projects],
  );

  const outstanding = useMemo(
    () => invoices
      .filter(i => i.status !== 'paid')
      .reduce((s, i) => s + Math.max(0, (i.totalDue ?? 0) - (i.amountPaid ?? 0)), 0),
    [invoices],
  );

  const pendingApprovalCount = useMemo(() => {
    const co = changeOrders.filter(c =>
      c.status === 'submitted' || c.status === 'under_review' || c.status === 'revised',
    ).length;
    const openRfis = rfis.filter(r => r.status !== 'closed' && r.status !== 'answered').length;
    return co + openRfis;
  }, [changeOrders, rfis]);

  const onSiteCount = liveEntries.length;

  // Photos taken in the last 7 days, across all projects. Used for
  // the "field activity" pulse stat. Excludes photos without a
  // timestamp (legacy rows).
  const photosThisWeek = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 86_400_000;
    return projectPhotos.filter(p => {
      const t = p.timestamp ? Date.parse(p.timestamp) : NaN;
      return Number.isFinite(t) && t >= sevenDaysAgo;
    }).length;
  }, [projectPhotos]);

  // Featured project — the most-recently-updated active project.
  // Falls back to the first active project when no updatedAt is set,
  // and to the first project of any status when none are active.
  const featured = useMemo(() => {
    const activeSorted = [...projects]
      .filter(p => p.status === 'in_progress')
      .sort((a, b) => Date.parse(b.updatedAt ?? '0') - Date.parse(a.updatedAt ?? '0'));
    return activeSorted[0] ?? projects[0] ?? null;
  }, [projects]);

  // ─── Layout ──────────────────────────────────────────────
  // Phone: stack vertically. The right-rail quick actions render
  // as a horizontal scroll row. Tablet/web: side-by-side with the
  // existing project list as the primary surface.
  const isWide = !responsive.isPhone;

  return (
    <View style={styles.container}>
      {/* Cash flow danger zone — silent until there's a week with a
          negative running balance in the next 6 weeks. Tap to /cash-flow.
          Vision-doc feature #2: "Three actions to fix it" — left for
          v1.1; for now we just surface the problem. */}
      {dangerWeek && (
        <View style={styles.dangerBlock}>
          <TouchableOpacity
            style={styles.dangerBanner}
            activeOpacity={0.85}
            onPress={() => router.push('/cash-flow' as never)}
            accessibilityRole="button"
            accessibilityLabel="Open cash flow"
            testID="dashboard-cash-danger"
          >
            <View style={styles.dangerIconWrap}>
              <AlertTriangle size={14} color={Colors.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dangerTitle} numberOfLines={1}>
                Tight cash week ahead
              </Text>
              <Text style={styles.dangerBody} numberOfLines={2}>
                In {dangerWeeksAway} week{dangerWeeksAway === 1 ? '' : 's'} ({new Date(dangerWeek.weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}) projected balance dips to {formatMoneyShort(dangerWeek.runningBalance)}.
              </Text>
            </View>
            <ChevronRight size={14} color={Colors.error} />
          </TouchableOpacity>

          {/* Vision-doc feature #14: three actions to fix it. Inline
              under the banner so the GC sees the solution on the same
              screen as the problem. */}
          {dangerActions.length > 0 && (
            <View style={styles.dangerActions}>
              <Text style={styles.dangerActionsHeader}>Three actions to close the gap</Text>
              {dangerActions.map((action, idx) => (
                <TouchableOpacity
                  key={`${action.routePath}-${idx}`}
                  style={styles.dangerActionRow}
                  activeOpacity={0.85}
                  onPress={() => router.push({
                    pathname: action.routePath as never,
                    params: action.routeParams as never,
                  })}
                  testID={`dashboard-cash-action-${idx}`}
                >
                  <View
                    style={[
                      styles.dangerActionDot,
                      action.tone === 'positive' && { backgroundColor: Colors.success },
                      action.tone === 'neutral' && { backgroundColor: Colors.warning },
                      action.tone === 'cost' && { backgroundColor: Colors.info },
                    ]}
                  >
                    <Text style={styles.dangerActionDotText}>{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dangerActionLabel} numberOfLines={1}>{action.label}</Text>
                    <Text style={styles.dangerActionReason} numberOfLines={2}>{action.reason}</Text>
                  </View>
                  <ChevronRight size={12} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Hero header */}
      <View style={styles.heroRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.greetingName}>{firstName}</Text>
        </View>
        <View style={styles.heroActions}>
          {onNewProjectPress && (
            <TouchableOpacity
              style={styles.heroActionLight}
              onPress={onNewProjectPress}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Add project"
              testID="dashboard-new-project"
            >
              <Plus size={14} color={Colors.text} />
              <Text style={styles.heroActionLightText}>New Project</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.heroActionDark}
            onPress={() => router.push('/(tabs)/summary' as never)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Plan today"
            testID="dashboard-plan-today"
          >
            <CalendarCheck size={14} color="#FFFFFF" />
            <Text style={styles.heroActionDarkText}>Plan Today</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Top stat row — three primary signals. Wraps on phone, side-
          by-side on tablet/web. The "filled" portion of the bar is the
          progress toward the goal so the eye lands on what's lagging. */}
      <View style={[styles.statRow, isWide && styles.statRowWide]}>
        <StatCard
          label="Active projects"
          value={String(activeCount)}
          sub={projects.length > 0 ? `of ${projects.length} total` : 'Add a project to start'}
          Icon={Briefcase}
          tint={Colors.primary}
        />
        <StatCard
          label="On site now"
          value={String(onSiteCount)}
          sub={onSiteCount === 0 ? 'No crew clocked in' : `${onSiteCount === 1 ? 'worker' : 'workers'} working`}
          Icon={Users}
          tint={Colors.info}
        />
        <StatCard
          label="Photos this week"
          value={String(photosThisWeek)}
          sub={photosThisWeek === 0 ? 'Field activity is quiet' : `${(photosThisWeek / 7).toFixed(1)}/day avg`}
          Icon={ImageIcon}
          tint={Colors.warning}
        />
      </View>

      {/* Image-overlay stats — three "looks like a magazine cover"
          cards with a stock photo backdrop and the metric overlaid.
          Mirrors Prepperly's "Protein Goals / Grocery / Recipes"
          row but with construction-themed photos. We use
          deterministic Unsplash URLs; swap to first-party photos
          later. */}
      <ScrollView
        horizontal={!isWide}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.imgRow, isWide && styles.imgRowWide]}
      >
        <ImageStatCard
          title="Outstanding"
          value={formatMoneyShort(outstanding)}
          sub="across unpaid invoices"
          imageUrl="https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&q=80"
          onPress={() => router.push('/reports?tab=aging' as never)}
          testID="dashboard-stat-outstanding"
        />
        <ImageStatCard
          title="Approvals"
          value={String(pendingApprovalCount)}
          sub="need your decision"
          imageUrl="https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=400&q=80"
          onPress={() => router.push('/approvals' as never)}
          testID="dashboard-stat-approvals"
        />
        <ImageStatCard
          title="Active jobs"
          value={String(activeCount)}
          sub="in progress"
          imageUrl="https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=400&q=80"
          onPress={() => router.push('/(tabs)/(home)' as never)}
          testID="dashboard-stat-active"
        />
      </ScrollView>

      {/* Featured project + quick actions row. On phone these stack
          vertically; on tablet/web the actions sit to the right. */}
      <View style={[styles.featureRow, isWide && styles.featureRowWide]}>
        {featured ? (
          <TouchableOpacity
            style={[styles.featureCard, isWide && styles.featureCardWide]}
            onPress={() => router.push({ pathname: '/project-detail', params: { id: featured.id } } as never)}
            activeOpacity={0.9}
            testID="dashboard-featured"
          >
            <ImageBackground
              source={{ uri: 'https://images.unsplash.com/photo-1572177812156-58036aae439c?w=800&q=80' }}
              style={styles.featureBg}
              imageStyle={styles.featureBgImg}
            >
              <View style={styles.featureScrim} />
              <View style={styles.featureContent}>
                <Text style={styles.featureLabel}>This week&apos;s focus</Text>
                <Text style={styles.featureTitle} numberOfLines={2}>{featured.name}</Text>
                <Text style={styles.featureMeta} numberOfLines={2}>
                  {featured.location || 'Location not set'}
                  {featured.estimate?.grandTotal ? ` · ${formatMoneyShort(featured.estimate.grandTotal)} contract` : ''}
                </Text>
                <View style={styles.featureCta}>
                  <Text style={styles.featureCtaText}>Open project</Text>
                  <ChevronRight size={14} color="#FFFFFF" />
                </View>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.featureCardEmpty, isWide && styles.featureCardWide]}
            onPress={onNewProjectPress}
            activeOpacity={0.85}
          >
            <Plus size={22} color={Colors.primary} />
            <Text style={styles.featureEmptyTitle}>Start your first project</Text>
            <Text style={styles.featureEmptySub}>The dashboard fills in once you have an active job.</Text>
          </TouchableOpacity>
        )}

        <View style={[styles.actionRail, isWide && styles.actionRailWide]}>
          <ActionRow
            Icon={Gavel}
            title="Ask the code"
            sub="Permit Q&A · 8 metros · 172 sections"
            onPress={() => router.push('/permit-qa' as never)}
            testID="dashboard-action-permit-qa"
          />
          <ActionRow
            Icon={CalendarCheck}
            title="Plan today"
            sub="Approvals + OAC + cash flow"
            onPress={() => router.push('/(tabs)/summary' as never)}
          />
          <ActionRow
            Icon={Search}
            title="Browse projects"
            sub={`${projects.length} on file`}
            onPress={() => router.push('/(tabs)/(home)' as never)}
          />
          <ActionRow
            Icon={ListChecks}
            title="Approvals"
            sub={pendingApprovalCount > 0 ? `${pendingApprovalCount} waiting` : 'You\'re all clear'}
            onPress={() => router.push('/approvals' as never)}
          />
          <ActionRow
            Icon={Sparkles}
            title="AI estimate review"
            sub={featured ? `Review ${featured.name}` : 'Open a project first'}
            onPress={featured
              ? () => router.push({ pathname: '/estimate-review' as never, params: { projectId: featured.id } as never })
              : undefined}
            disabled={!featured}
          />
        </View>
      </View>
    </View>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StatCard({
  label, value, sub, Icon, tint,
}: {
  label: string;
  value: string;
  sub: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
  tint: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: tint + '15' }]}>
        <Icon size={14} color={tint} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function ImageStatCard({
  title, value, sub, imageUrl, onPress, testID,
}: {
  title: string;
  value: string;
  sub: string;
  imageUrl: string;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={styles.imgCard}
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
      disabled={!onPress}
      testID={testID}
    >
      <Text style={styles.imgCardTitle}>{title}</Text>
      <ImageBackground
        source={{ uri: imageUrl }}
        style={styles.imgCardImage}
        imageStyle={styles.imgCardImageInner}
      >
        <View style={styles.imgCardScrim} />
      </ImageBackground>
      <View style={styles.imgCardFooter}>
        <Text style={styles.imgCardValue}>{value}</Text>
        <Text style={styles.imgCardSub}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

function ActionRow({
  Icon, title, sub, onPress, disabled, testID,
}: {
  Icon: React.ComponentType<{ size: number; color: string }>;
  title: string;
  sub: string;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.85}
      testID={testID}
    >
      <View style={styles.actionIcon}>
        <Icon size={14} color={Colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{sub}</Text>
      </View>
      <ChevronRight size={14} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

void FileText;
void ShieldCheck;
void Clock;

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    margin: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    gap: 16,
    // Soft shadow for the cream-card-on-tinted-bg look the Prepperly
    // reference uses. Not as aggressive as a card-on-card pattern;
    // the subtlety matters.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 3,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },

  heroRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12 },
  greeting: { fontSize: Type.bodyCompact.fontSize, color: Colors.textMuted, fontWeight: '600' as const },
  greetingName: { fontSize: 32, fontWeight: '900' as const, color: Colors.text, letterSpacing: -1, marginTop: 2 },
  heroActions: { flexDirection: 'row' as const, gap: 8, alignItems: 'center' as const, marginTop: 6 },
  heroActionLight: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  heroActionLightText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.text },
  heroActionDark: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 999, backgroundColor: '#0F1115',
  },
  heroActionDarkText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },

  statRow: { flexDirection: 'row' as const, gap: 8, flexWrap: 'wrap' as const },
  statRowWide: {},
  statCard: {
    flex: 1,
    minWidth: 100,
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.surfaceAlt,
    gap: 4,
  },
  statIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 4 },
  statLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  statValue: { fontSize: 26, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.7 },
  statSub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted },

  imgRow: { gap: 10, paddingVertical: 4 },
  imgRowWide: { flexDirection: 'row' as const },
  imgCard: {
    width: 200,
    padding: 10,
    borderRadius: 18,
    backgroundColor: Colors.surfaceAlt,
    gap: 6,
  },
  imgCardTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: Colors.text },
  imgCardImage: { width: '100%', height: 110, borderRadius: 14, overflow: 'hidden' as const, backgroundColor: Colors.fillTertiary },
  imgCardImageInner: { borderRadius: 14 },
  imgCardScrim: { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.08)' },
  imgCardFooter: {},
  imgCardValue: { fontSize: 28, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.6 },
  imgCardSub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted },

  featureRow: { gap: 10 },
  featureRowWide: { flexDirection: 'row' as const, alignItems: 'stretch' as const },
  featureCard: { borderRadius: 20, overflow: 'hidden' as const, height: 200, backgroundColor: '#000' },
  featureCardWide: { flex: 1.5 },
  featureBg: { flex: 1, justifyContent: 'flex-end' as const },
  featureBgImg: { borderRadius: 20 },
  featureScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  featureContent: { padding: 16, gap: 4 },
  featureLabel: { fontSize: 10, fontWeight: '900' as const, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.5, textTransform: 'uppercase' as const },
  featureTitle: { fontSize: 24, fontWeight: '900' as const, color: '#FFFFFF', letterSpacing: -0.6, lineHeight: 28 },
  featureMeta: { fontSize: Type.footnote.fontSize, color: 'rgba(255,255,255,0.85)' },
  featureCta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, marginTop: 8, alignSelf: 'flex-start' as const, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)' },
  featureCtaText: { fontSize: 11, fontWeight: '800' as const, color: '#FFFFFF' },

  featureCardEmpty: { padding: 20, borderRadius: 20, backgroundColor: Colors.surfaceAlt, alignItems: 'center' as const, gap: 4, borderWidth: 1, borderColor: Colors.borderLight, borderStyle: 'dashed' as const },
  featureEmptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: Colors.text, marginTop: 4 },
  featureEmptySub: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, textAlign: 'center' as const },

  actionRail: { gap: 6 },
  actionRailWide: { flex: 1 },
  actionRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    padding: 12, borderRadius: 14, backgroundColor: Colors.surfaceAlt,
  },
  actionIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.surface, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: Colors.borderLight },
  actionTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.2 },
  actionSub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 1 },

  dangerBlock: { marginBottom: 4, gap: 0 },
  dangerBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    padding: 12,
    borderTopLeftRadius: Tokens.radius.md,
    borderTopRightRadius: Tokens.radius.md,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: Colors.error + '12',
    borderWidth: 1,
    borderColor: Colors.error + '40',
  },
  dangerActions: {
    backgroundColor: Colors.error + '06',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.error + '40',
    borderBottomLeftRadius: Tokens.radius.md,
    borderBottomRightRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  dangerActionsHeader: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    color: Colors.error,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  dangerActionRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingVertical: 8,
  },
  dangerActionDot: {
    width: 22,
    height: 22,
    borderRadius: Tokens.radius.full,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 1,
  },
  dangerActionDotText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    color: '#FFFFFF',
  },
  dangerActionLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  dangerActionReason: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  dangerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.error + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  dangerTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.error,
    letterSpacing: -0.2,
  },
  dangerBody: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
});

void Tokens;
void Platform;
