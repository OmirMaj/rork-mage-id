import React, { useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Linking, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import {
  Gavel, Building2, ChevronRight, ExternalLink,
  Plus, Search, Award, Users, UserCheck, Briefcase, HardHat,
  Sparkles, Calculator,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';

interface BidSource {
  name: string;
  description: string;
  url: string;
  color: string;
  type: string;
}

const LIVE_BID_SOURCES: BidSource[] = [
  {
    name: 'SAM.gov',
    description: 'Federal contract opportunities — all US government bids',
    url: 'https://sam.gov/search/?index=opp&sort=-modifiedDate&page=1&pageSize=25',
    color: '#1565C0',
    type: 'Federal',
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
  },
];

function SectionCard({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  count,
  onPress,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  count: number;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={[styles.sectionCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.sectionCardInner}
      >
        <View style={[styles.sectionIconWrap, { backgroundColor: iconBg }]}>
          <Icon size={22} color={iconColor} />
        </View>
        <View style={styles.sectionInfo}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
        <View style={styles.sectionRight}>
          {count > 0 && (
            <View style={[styles.countBadge, { backgroundColor: iconBg }]}>
              <Text style={[styles.countText, { color: iconColor }]}>{count}</Text>
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
  const fabScale = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.spring(fabScale, { toValue: 1, useNativeDriver: true, delay: 300, speed: 12 }).start();
  }, [fabScale]);

  const bidsCountQuery = useQuery({
    queryKey: ['cached_bids_count'],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from('cached_bids')
          .select('*', { count: 'exact', head: true });
        console.log('[Discover] cached_bids count:', count, 'error:', error);
        if (error) return 0;
        return count ?? 0;
      } catch (err) {
        console.log('[Discover] cached_bids count fetch failed:', err);
        return 0;
      }
    },
    retry: 1,
  });

  const companiesCountQuery = useQuery({
    queryKey: ['cached_companies_count'],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from('cached_companies')
          .select('*', { count: 'exact', head: true });
        console.log('[Discover] cached_companies count:', count, 'error:', error);
        if (error) return 0;
        return count ?? 0;
      } catch (err) {
        console.log('[Discover] cached_companies count fetch failed:', err);
        return 0;
      }
    },
    retry: 1,
  });

  const profilesCountQuery = useQuery({
    queryKey: ['worker_profiles_count'],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from('worker_profiles')
          .select('*', { count: 'exact', head: true })
          .not('availability_status', 'is', null);
        console.log('[Discover] worker_profiles count:', count, 'error:', error);
        if (error) return 0;
        return count ?? 0;
      } catch (err) {
        console.log('[Discover] worker_profiles count fetch failed:', err);
        return 0;
      }
    },
    retry: 1,
  });

  const jobsCountQuery = useQuery({
    queryKey: ['cached_jobs_count'],
    queryFn: async () => {
      try {
        const { count, error } = await supabase
          .from('cached_jobs')
          .select('*', { count: 'exact', head: true });
        console.log('[Discover] cached_jobs count:', count, 'error:', error);
        if (error) return 0;
        return count ?? 0;
      } catch (err) {
        console.log('[Discover] cached_jobs count fetch failed:', err);
        return 0;
      }
    },
    retry: 1,
  });

  const openBids = bidsCountQuery.data ?? 0;
  const companiesCount = companiesCountQuery.data ?? 0;
  const profilesCount = profilesCountQuery.data ?? 0;
  const jobsCount = jobsCountQuery.data ?? 0;

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
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.largeTitle}>Discover</Text>
          <Text style={styles.headerSubtitle}>Find work, hire talent, explore opportunities</Text>
        </View>

        <TouchableOpacity
          style={styles.aiEstimateCard}
          onPress={() => {
            if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigateTo('/(tabs)/tools/estimate');
          }}
          activeOpacity={0.85}
          testID="discover-ai-estimate"
        >
          <View style={styles.aiEstimateIconRow}>
            <View style={styles.aiEstimateIconWrap}>
              <Sparkles size={20} color="#fff" />
            </View>
            <View style={styles.aiEstimateIconWrap2}>
              <Calculator size={16} color="#fff" />
            </View>
          </View>
          <Text style={styles.aiEstimateTitle}>AI Quick Estimate</Text>
          <Text style={styles.aiEstimateSubtitle}>Describe any project, get a full estimate in seconds</Text>
          <View style={styles.aiEstimateCta}>
            <Text style={styles.aiEstimateCtaText}>Try it now</Text>
            <ChevronRight size={14} color="#fff" />
          </View>
        </TouchableOpacity>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => navigateTo('/post-bid')}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: '#1565C0' + '15' }]}>
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
            onPress={() => navigateTo('/contractor-profile')}
            activeOpacity={0.7}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: Colors.accent + '15' }]}>
              <UserCheck size={16} color={Colors.accent} />
            </View>
            <Text style={styles.quickActionLabel}>My Profile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dividerSection}>
          <View style={styles.dividerAccent} />
          <Text style={styles.sectionLabel}>ONLINE JOBS & BIDS</Text>
        </View>
        <Text style={styles.sectionHint}>
          Government contracts, private bids & company listings
        </Text>

        <SectionCard
          icon={Gavel}
          iconColor="#1565C0"
          iconBg={'#1565C012'}
          title="Public Bids"
          subtitle="Government & private bid opportunities"
          count={openBids}
          onPress={() => navigateTo('/(tabs)/discover/bids')}
        />

        <SectionCard
          icon={Building2}
          iconColor={Colors.primary}
          iconBg={Colors.primary + '12'}
          title="Companies"
          subtitle="Bond capacity & certifications"
          count={companiesCount}
          onPress={() => navigateTo('/(tabs)/discover/companies')}
        />

        <SectionCard
          icon={HardHat}
          iconColor="#E65100"
          iconBg={'#E6510012'}
          title="Job Listings"
          subtitle="Construction jobs & direct hire openings"
          count={jobsCount}
          onPress={() => navigateTo('/(tabs)/hire')}
        />

        <Text style={styles.portalSectionLabel}>LIVE BID DATABASES</Text>
        <Text style={styles.sectionHint}>
          Browse real government & private bid portals — updated daily
        </Text>

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

        <View style={styles.sectionSpacer} />

        <View style={styles.dividerSection}>
          <View style={[styles.dividerAccent, { backgroundColor: Colors.accent }]} />
          <Text style={styles.sectionLabel}>CONTRACTOR DIRECTORY</Text>
        </View>
        <Text style={styles.sectionHint}>
          Browse profiles of contractors, subs & workers available for hire
        </Text>

        <SectionCard
          icon={Users}
          iconColor={Colors.accent}
          iconBg={Colors.accent + '12'}
          title="Browse Profiles"
          subtitle="Find contractors & workers near you"
          count={profilesCount}
          onPress={() => navigateTo('/(tabs)/discover/hire')}
        />

        <TouchableOpacity
          style={styles.createProfileCard}
          onPress={() => navigateTo('/contractor-profile')}
          activeOpacity={0.85}
        >
          <View style={styles.createProfileLeft}>
            <View style={styles.createProfileIconWrap}>
              <Briefcase size={20} color={Colors.accent} />
            </View>
            <View style={styles.createProfileInfo}>
              <Text style={styles.createProfileTitle}>Create Your Profile</Text>
              <Text style={styles.createProfileSub}>Get discovered by clients & other contractors</Text>
            </View>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </TouchableOpacity>

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

      <Animated.View style={[styles.fab, { bottom: insets.bottom + 90, transform: [{ scale: fabScale }] }]}>
        <TouchableOpacity
          style={styles.fabButton}
          onPress={() => {
            if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigateTo('/(tabs)/tools/estimate');
          }}
          activeOpacity={0.85}
          testID="discover-fab-estimate"
        >
          <Calculator size={22} color="#fff" />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 12, marginBottom: 16 },
  largeTitle: { fontSize: 34, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 15, color: Colors.textSecondary, marginTop: 2 },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 24,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
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
  dividerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 6,
    gap: 10,
  },
  dividerAccent: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: '#1565C0',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.8,
  },
  portalSectionLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 6,
  },
  sectionHint: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingHorizontal: 20,
    marginBottom: 12,
    lineHeight: 18,
  },
  sectionSpacer: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginHorizontal: 20,
    marginVertical: 20,
  },
  sectionCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  sectionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionInfo: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  sectionSubtitle: { fontSize: 13, color: Colors.textSecondary },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countText: { fontSize: 13, fontWeight: '700' as const },
  bidSourcesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8,
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
  createProfileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: Colors.accent + '08',
    borderWidth: 1,
    borderColor: Colors.accent + '20',
  },
  createProfileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  createProfileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.accent + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createProfileInfo: { flex: 1, gap: 2 },
  createProfileTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.accent },
  createProfileSub: { fontSize: 12, color: Colors.textSecondary },
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
  aiEstimateCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 20,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  aiEstimateIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  aiEstimateIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiEstimateIconWrap2: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiEstimateTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: '#fff',
    marginBottom: 4,
  },
  aiEstimateSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 20,
    marginBottom: 14,
  },
  aiEstimateCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  aiEstimateCtaText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#fff',
  },
  fab: {
    position: 'absolute',
    right: 20,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});

