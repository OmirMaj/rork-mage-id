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
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';

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
    color: '#1565C0',
    type: 'Federal',
    hideCount: true,
  },
  {
    name: 'NY State Contract Reporter',
    description: 'All NYS agency procurement notices & bids',
    url: 'https://nyspro.ogs.ny.gov/content/nys-contract-reporter',
    color: '#2E7D32',
    type: 'State',
  },
  {
    name: 'NYC PASSPort',
    description: 'New York City procurement portal — municipal bids',
    url: 'https://passport.cityofnewyork.us/page.aspx/en/rfp/request_browse_public',
    color: '#E65100',
    type: 'Municipal',
  },
  {
    name: 'BidNet Direct',
    description: 'State & local government bids across all 50 states',
    url: 'https://www.bidnetdirect.com/public/solicitations/open',
    color: '#6A1B9A',
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

type DiscoverTab = 'overview' | 'bids' | 'companies' | 'hire' | 'estimate' | 'schedule' | 'materials';

interface TabDef {
  id: DiscoverTab;
  label: string;
  icon?: React.ElementType;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
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
        <Text style={styles.headerSubtitle}>Bids, companies, tools & more</Text>

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
              <Plus size={16} color="#1565C0" />
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

        <View style={styles.sectionHeaderRow}>
          <View style={[styles.sectionAccent, { backgroundColor: '#0A84FF' }]} />
          <View>
            <Text style={styles.sectionLabel}>SMART TOOLS</Text>
            <Text style={styles.sectionHint}>Quick estimates & project schedules</Text>
          </View>
        </View>

        <NavigationCard
          icon={Sparkles}
          iconColor="#0A84FF"
          iconBg="#0A84FF15"
          title="Estimator"
          subtitle="AI-powered quick estimates & templates"
          onPress={() => navigateTo('/(tabs)/discover/estimate')}
        />

        <NavigationCard
          icon={CalendarDays}
          iconColor="#FF9F0A"
          iconBg="#FF9F0A15"
          title="Schedule Maker"
          subtitle="AI-generate or template-based schedules"
          onPress={() => navigateTo('/(tabs)/discover/schedule')}
        />

        <NavigationCard
          icon={DollarSign}
          iconColor="#34C759"
          iconBg="#34C75915"
          title="Materials Pricing"
          subtitle="Live prices, regional rates & cost tracking"
          onPress={() => navigateTo('/(tabs)/discover/materials')}
        />

        <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
          <View style={[styles.sectionAccent, { backgroundColor: '#1565C0' }]} />
          <View>
            <Text style={styles.sectionLabel}>ONLINE JOBS & BIDS</Text>
            <Text style={styles.sectionHint}>Government contracts, private bids & company listings</Text>
          </View>
        </View>

        <NavigationCard
          icon={Gavel}
          iconColor="#1565C0"
          iconBg="#1565C015"
          title="Public Bids"
          subtitle="Government & private bid opportunities"
          count={1317}
          countColor="#1565C0"
          onPress={() => navigateTo('/(tabs)/discover/bids')}
        />

        <NavigationCard
          icon={Building2}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '15'}
          title="Companies"
          subtitle="Bond capacity & certifications"
          count={2957}
          countColor={Colors.primary}
          onPress={() => navigateTo('/(tabs)/discover/companies')}
        />

        <NavigationCard
          icon={Briefcase}
          iconColor={Colors.accent}
          iconBg={Colors.accent + '15'}
          title="Job Listings"
          subtitle="Construction jobs & direct hire openings"
          count={869}
          countColor={Colors.accent}
          onPress={() => navigateTo('/(tabs)/discover/hire')}
        />

        <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
          <View style={[styles.sectionAccent, { backgroundColor: '#6A1B9A' }]} />
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
  largeTitle: { fontSize: 34, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5, marginTop: 8 },
  headerSubtitle: { fontSize: 15, color: Colors.textSecondary, marginTop: 2, marginBottom: 14 },
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
    fontSize: 13,
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
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  quickActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: 12,
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
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.6,
  },
  sectionHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 1,
  },
  navCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: Colors.borderLight,
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
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navInfo: { flex: 1, gap: 2 },
  navTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  navSubtitle: { fontSize: 13, color: Colors.textSecondary },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navCountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  navCountText: {
    fontSize: 13,
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
    borderRadius: 14,
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
  bidSourceName: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, marginBottom: 4 },
  bidSourceDesc: { fontSize: 11, color: Colors.textSecondary, lineHeight: 15, marginBottom: 10 },
  bidSourceFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bidSourceLink: { fontSize: 11, fontWeight: '600' as const },
  tipCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary + '08',
    borderRadius: 14,
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
  tipTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.primary },
  tipText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
});
