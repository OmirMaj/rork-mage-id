import React, { useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Linking, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Gavel, Building2, Briefcase, ExternalLink,
  Plus, Search, Award, Sparkles, CalendarDays, ChevronRight, DollarSign,
  Wrench,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface BidSource {
  name: string;
  description: string;
  url: string;
  color: string;
  type: string;
  hideCount?: boolean;
}

const LIVE_BID_SOURCES: BidSource[] = [
  {
    name: 'SAM.gov',
    description: 'Federal contract opportunities — all US government bids',
    url: 'https://sam.gov/search/?index=opp&sort=-modifiedDate&page=1&pageSize=25',
    color: Colors.infoDark,
    type: 'Federal',
    hideCount: true,
  },
  {
    name: 'NY State Contract Reporter',
    description: 'All NYS agency procurement notices & bids',
    url: 'https://nyspro.ogs.ny.gov/content/nys-contract-reporter',
    color: Colors.successDark,
    type: 'State',
  },
  {
    name: 'NYC PASSPort',
    description: 'New York City procurement portal — municipal bids',
    url: 'https://passport.cityofnewyork.us/page.aspx/en/rfp/request_browse_public',
    color: Colors.warningDark,
    type: 'Municipal',
  },
  {
    name: 'BidNet Direct',
    description: 'State & local government bids across all 50 states',
    url: 'https://www.bidnetdirect.com/public/solicitations/open',
    color: Colors.purple,
    type: 'Multi-State',
  },
  {
    name: 'Dodge Construction Network',
    description: 'Private & public construction project leads',
    url: 'https://www.construction.com/',
    color: '#00695C',
    type: 'Private + Public',
  },
  {
    name: 'NYS ESD MWBE',
    description: 'Empire State Development MWBE directory & opportunities',
    url: 'https://ny.newnycontracts.com/',
    color: '#AD1457',
    type: 'MWBE',
  },
  {
    name: 'NYC SBS M/WBE',
    description: 'NYC Small Business Services — certified M/WBE opportunities',
    url: 'https://www1.nyc.gov/nycbusiness/mwbe',
    color: '#FF6F00',
    type: 'MWBE',
  },
  {
    name: 'USASpending.gov',
    description: 'Track federal spending & find awarded contracts',
    url: 'https://www.usaspending.gov/search',
    color: '#37474F',
    type: 'Federal',
    hideCount: true,
  },
];

type DiscoverTab = 'overview' | 'tools' | 'bids' | 'companies' | 'hire' | 'estimate' | 'schedule' | 'materials';

interface TabDef {
  id: DiscoverTab;
  label: string;
  icon?: React.ElementType;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  // Tools sits second — every cross-project workflow (Approvals,
  // Compliance hub, Permit calendar, Cash flow, Pipeline, 1099-NEC,
  // etc.) lives here. Previously cluttered Summary; previously its own
  // bottom tab. Now it lives inside Discover where the user can find
  // it alongside the other "things to explore" entries.
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'bids', label: 'Public Bids', icon: Gavel },
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'hire', label: 'Direct Hire', icon: Briefcase },
  { id: 'estimate', label: 'Estimator', icon: Sparkles },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'materials', label: 'Materials', icon: DollarSign },
];

function NavigationCard({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  count,
  countColor,
  onPress,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  count?: number;
  countColor?: string;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={[styles.navCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.navCardInner}
      >
        <View style={[styles.navIconWrap, { backgroundColor: iconBg }]}>
          <Icon size={22} color={iconColor} />
        </View>
        <View style={styles.navInfo}>
          <Text style={styles.navTitle}>{title}</Text>
          <Text style={styles.navSubtitle}>{subtitle}</Text>
        </View>
        <View style={styles.navRight}>
          {count !== undefined && countColor && (
            <View style={[styles.navCountBadge, { backgroundColor: countColor + '12' }]}>
              <Text style={[styles.navCountText, { color: countColor }]}>{count}</Text>
            </View>
          )}
          <ChevronRight size={18} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tabScrollRef = useRef<ScrollView>(null);

  console.log('[Discover] Rendering DiscoverScreen v2');

  const handleTabPress = useCallback((tab: DiscoverTab) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (tab === 'overview') return;
    const routes: Record<string, string> = {
      tools: '/(tabs)/tools',
      bids: '/(tabs)/discover/bids',
      companies: '/(tabs)/discover/companies',
      hire: '/(tabs)/discover/hire',
      estimate: '/(tabs)/discover/estimate',
      schedule: '/(tabs)/discover/schedule',
      materials: '/(tabs)/discover/materials',
    };
    if (routes[tab]) router.push(routes[tab] as any);
  }, [router]);

  const openBidSource = useCallback((url: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(url).catch(() => {});
  }, []);

  const navigateTo = useCallback((path: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as any);
  }, [router]);

  return (
    <View style={styles.container}>
      <View style={[styles.headerArea, { paddingTop: insets.top }]}>
        <Text style={styles.largeTitle}>Discover</Text>
        <Text style={styles.headerSubtitle}>Tools · bids · companies · AI · marketplace</Text>

        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
          style={styles.tabBarScroll}
        >
          {TABS.map((tab) => {
            const isActive = tab.id === 'overview';
            const TabIcon = tab.icon;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabPill, isActive && styles.tabPillActive]}
                onPress={() => handleTabPress(tab.id)}
                activeOpacity={0.7}
                testID={`discover-tab-${tab.id}`}
              >
                {TabIcon && <TabIcon size={14} color={isActive ? '#FFF' : Colors.textSecondary} />}
                <Text style={[styles.tabPillText, isActive && styles.tabPillTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => navigateTo('/post-bid')}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: '#1565C015' }]}>
              <Plus size={16} color={Colors.infoDark} />
            </View>
            <Text style={styles.quickActionLabel}>Post Bid</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => navigateTo('/post-job')}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.primary + '15' }]}>
              <Plus size={16} color={Colors.primary} />
            </View>
            <Text style={styles.quickActionLabel}>Post Job</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => navigateTo('/(tabs)/settings')}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.accent + '15' }]}>
              <Search size={16} color={Colors.accent} />
            </View>
            <Text style={styles.quickActionLabel}>My Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Tools — the cross-project workflow hub. Approvals, OAC
            actions, sub change requests, deliveries, draws, cash flow,
            pipeline, 1099-NEC, compliance hub, permit calendar/leads/
            templates, insurance claim package, expeditors, reports
            inbox. Lifted out of Summary (which is now just a summary)
            and surfaced here as the first card on Discover so users
            who used to look in Summary still land on it quickly. */}
        <View style={styles.sectionHeaderRow}>
          <View style={[styles.sectionAccent, { backgroundColor: '#D97706' }]} />
          <View>
            <Text style={styles.sectionLabel}>MANAGE WORK</Text>
            <Text style={styles.sectionHint}>Approvals, cash flow, permits, compliance & 14 more</Text>
          </View>
        </View>

        <NavigationCard
          icon={Wrench}
          iconColor="#D97706"
          iconBg={'#D97706' + '15'}
          title="Tools"
          subtitle="Every cross-project workflow in one place"
          onPress={() => navigateTo('/(tabs)/tools')}
        />

        <View style={styles.sectionHeaderRow}>
          <View style={[styles.sectionAccent, { backgroundColor: Colors.primary }]} />
          <View>
            <Text style={styles.sectionLabel}>SMART TOOLS</Text>
            <Text style={styles.sectionHint}>AI estimates, schedules, code checks & pricing</Text>
          </View>
        </View>

        {/* Smart-tools group: all share the SAME tone (`primary`) so the
            section reads as one coherent set of AI-powered tools. The
            previous rainbow (5 different system-color hexes) was pure
            decoration — color carried no meaning, just noise. */}
        <NavigationCard
          icon={Sparkles}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '15'}
          title="Estimator"
          subtitle="AI-powered quick estimates & templates"
          onPress={() => navigateTo('/(tabs)/discover/estimate')}
        />

        <NavigationCard
          icon={Award}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '15'}
          title="Quick Estimate Wizard"
          subtitle="Answer 8 questions, get an AI-generated estimate"
          onPress={() => navigateTo('/estimate-wizard')}
        />

        <NavigationCard
          icon={Gavel}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '15'}
          title="Construction AI"
          subtitle="Ask building code questions, get instant answers"
          onPress={() => navigateTo('/(tabs)/construction-ai')}
        />

        <NavigationCard
          icon={CalendarDays}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '15'}
          title="Schedule Maker"
          subtitle="AI-generate or template-based schedules"
          onPress={() => navigateTo('/(tabs)/discover/schedule')}
        />

        <NavigationCard
          icon={DollarSign}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '15'}
          title="Materials Pricing"
          subtitle="Live prices, regional rates & cost tracking"
          onPress={() => navigateTo('/(tabs)/discover/materials')}
        />

        <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
          <View style={[styles.sectionAccent, { backgroundColor: Colors.primary }]} />
          <View>
            <Text style={styles.sectionLabel}>MAGE ID MARKETPLACE</Text>
            <Text style={styles.sectionHint}>Homeowners post projects, contractors bid, you pick a winner</Text>
          </View>
        </View>

        <NavigationCard
          icon={Sparkles}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '15'}
          title="MAGE ID Bids"
          subtitle="Browse nearby private projects · post your own"
          onPress={() => navigateTo('/(tabs)/mage-id-bids')}
        />

        {/* External-jobs group: all share `info` (blue) tone — they're
            inbound opportunities you sift through. Keeps semantic
            grouping while killing the unmotivated rainbow. */}
        <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
          <View style={[styles.sectionAccent, { backgroundColor: Colors.info }]} />
          <View>
            <Text style={styles.sectionLabel}>ONLINE JOBS & BIDS</Text>
            <Text style={styles.sectionHint}>Government contracts, private bids & company listings</Text>
          </View>
        </View>

        <NavigationCard
          icon={Gavel}
          iconColor={Colors.info}
          iconBg={Colors.info + '15'}
          title="Public Bids"
          subtitle="Government & private bid opportunities"
          count={1317}
          countColor={Colors.info}
          onPress={() => navigateTo('/(tabs)/discover/bids')}
        />

        <NavigationCard
          icon={Building2}
          iconColor={Colors.info}
          iconBg={Colors.info + '15'}
          title="Companies"
          subtitle="Bond capacity & certifications"
          count={2957}
          countColor={Colors.info}
          onPress={() => navigateTo('/(tabs)/discover/companies')}
        />

        <NavigationCard
          icon={Briefcase}
          iconColor={Colors.info}
          iconBg={Colors.info + '15'}
          title="Job Listings"
          subtitle="Construction jobs & direct hire openings"
          count={869}
          countColor={Colors.info}
          onPress={() => navigateTo('/(tabs)/discover/hire')}
        />

        {/* Live-databases group: third tone (`accent` orange) — these are
            external resources you visit, not work happening in MAGE ID. */}
        <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
          <View style={[styles.sectionAccent, { backgroundColor: Colors.accent }]} />
          <View>
            <Text style={styles.sectionLabel}>LIVE BID DATABASES</Text>
            <Text style={styles.sectionHint}>Browse real government & private bid portals — updated daily</Text>
          </View>
        </View>

        <View style={styles.bidSourcesGrid}>
          {LIVE_BID_SOURCES.map((source) => (
            <TouchableOpacity
              key={source.name}
              style={styles.bidSourceCard}
              onPress={() => openBidSource(source.url)}
              activeOpacity={0.7}
            >
              <View style={styles.bidSourceTop}>
                <View style={[styles.bidSourceDot, { backgroundColor: source.color }]} />
                <View style={[styles.bidSourceTypeBadge, { backgroundColor: source.color + '14' }]}>
                  <Text style={[styles.bidSourceTypeText, { color: source.color }]}>{source.type}</Text>
                </View>
              </View>
              <Text style={styles.bidSourceName}>{source.name}</Text>
              <Text style={styles.bidSourceDesc} numberOfLines={2}>{source.description}</Text>
              <View style={styles.bidSourceFooter}>
                <ExternalLink size={12} color={source.color} />
                <Text style={[styles.bidSourceLink, { color: source.color }]}>Open Portal</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Award size={16} color={Colors.primary} />
            <Text style={styles.tipTitle}>Pro Tip</Text>
          </View>
          <Text style={styles.tipText}>
            Register your company certifications (MWBE, DBE, etc.) in the Companies section to get matched with bids that require your qualifications.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerArea: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingBottom: 0,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  largeTitle: { fontSize: Type.largeTitle.fontSize, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5, marginTop: 8 },
  headerSubtitle: { fontSize: Type.subhead.fontSize, color: Colors.textSecondary, marginTop: 2, marginBottom: 14 },
  tabBarScroll: { marginHorizontal: -20 },
  tabBar: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  tabPillActive: {
    backgroundColor: Colors.text,
    borderColor: Colors.text,
  },
  tabPillText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  tabPillTextActive: {
    color: '#FFF',
  },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginTop: 18,
    marginBottom: 8,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  quickActionIcon: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 12,
  },
  sectionAccent: {
    width: 4,
    height: 36,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  sectionLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.6,
  },
  sectionHint: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 1,
  },
  navCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: Tokens.radius.panel,
    backgroundColor: Colors.surface,
    // Black outline matches the rest of the app's card surfaces.
    // Drops the shadow — the defined edge carries enough weight.
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  navCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  navIconWrap: {
    width: 48,
    height: 48,
    borderRadius: Tokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navInfo: { flex: 1, gap: 2 },
  navTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: Colors.text },
  navSubtitle: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navCountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.md,
  },
  navCountText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
  },
  bidSourcesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 20,
  },
  bidSourceCard: {
    width: '47.5%' as any,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  bidSourceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  bidSourceDot: { width: 8, height: 8, borderRadius: 4 },
  bidSourceTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bidSourceTypeText: { fontSize: 9, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  bidSourceName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text, marginBottom: 4 },
  bidSourceDesc: { fontSize: Type.caption2.fontSize, color: Colors.textSecondary, lineHeight: 15, marginBottom: 10 },
  bidSourceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bidSourceLink: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const },
  tipCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary + '08',
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '18',
    marginBottom: 20,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  tipTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.primary },
  tipText: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, lineHeight: 19 },
});
