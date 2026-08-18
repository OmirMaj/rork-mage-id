import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { MapPin, DollarSign, ArrowLeft, Navigation, AlertCircle, Briefcase } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import ConstructionLoader from '@/components/ConstructionLoader';
import MageRefreshControl from '@/components/MageRefreshControl';
import { SkeletonRow } from '@/components/Skeleton';
import { supabase } from '@/lib/supabase';
import { HIRE_ENABLED } from '@/contexts/HireContext';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface CachedJob {
  id: string;
  title: string;
  company_name: string;
  salary_min: number;
  salary_max: number;
  trade_category: string;
  contract_type: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  apply_url: string;
  fetched_at: string;
}

interface JobWithDistance extends CachedJob {
  distance: number | null;
}

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

const TRADE_FILTERS = [
  'Electrical', 'Plumbing', 'Carpentry', 'HVAC', 'Welding',
  'Masonry', 'Roofing', 'Management', 'Labor', 'General Construction',
] as const;

const TRADE_BADGE_COLORS: Record<string, string> = {
  'Electrical': '#F57F17',
  'Plumbing': '#1565C0',
  'Carpentry': '#6D4C41',
  'HVAC': '#00838F',
  'Welding': '#E65100',
  'Masonry': '#78909C',
  'Roofing': '#AD1457',
  'Management': '#4527A0',
  'Labor': '#2E7D32',
  'General Construction': '#37474F',
};

function formatSalary(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null && max == null) return 'Salary not listed';
  const fmtVal = (v: number) => {
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
    return `${v.toLocaleString()}`;
  };
  if (min != null && max != null) return `${fmtVal(min)} – ${fmtVal(max)}`;
  if (min != null) return `From ${fmtVal(min)}`;
  return `Up to ${fmtVal(max!)}`;
}

function getTradeColor(trade: string | null | undefined): string {
  if (!trade) return '#FF6A1A';
  const key = Object.keys(TRADE_BADGE_COLORS).find(
    k => trade.toLowerCase().includes(k.toLowerCase())
  );
  return key ? TRADE_BADGE_COLORS[key] : '#FF6A1A';
}

function JobCard({ job, onPress }: { job: JobWithDistance; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const tradeColor = getTradeColor(job.trade_category);

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`cached-job-${job.id}`}
      >
        <View style={styles.cardTopRow}>
          {job.trade_category ? (
            <View style={[styles.tradeBadge, { backgroundColor: tradeColor + '15' }]}>
              <Text style={[styles.tradeBadgeText, { color: tradeColor }]}>{job.trade_category}</Text>
            </View>
          ) : null}
          {job.contract_type ? (
            <View style={styles.contractBadge}>
              <Text style={styles.contractBadgeText}>{job.contract_type}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>{job.title ?? 'Untitled Job'}</Text>
        <Text style={styles.cardCompany}>{job.company_name ?? 'Company not listed'}</Text>

        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <MapPin size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.metaText}>{job.city && job.state ? `${job.city}, ${job.state}` : job.city || job.state || 'Location not available'}</Text>
          </View>
          <View style={styles.metaItem}>
            <DollarSign size={13} color={'#FF6A1A'} strokeWidth={1.75} />
            <Text style={[styles.metaText, { color: '#FF6A1A', fontWeight: '600' as const }]}>
              {formatSalary(job.salary_min, job.salary_max)}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          {job.distance !== null && (
            <View style={styles.distanceBadge}>
              <Navigation size={11} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.distanceText}>{job.distance} mi</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <View style={styles.applyHint}>
            <Briefcase size={12} color={'#FF6A1A'} strokeWidth={1.75} />
            <Text style={styles.applyHintText}>Tap to Apply</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CachedHireScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { location, loading: locationLoading } = useUserLocation();
  const [selectedRadius, setSelectedRadius] = useState<number>(50);
  const [selectedTrade, setSelectedTrade] = useState<string | undefined>();

  const { data: jobs, isLoading, refetch, isRefetching, error: _jobsQueryError } = useQuery({
    queryKey: ['cached_jobs'],
    queryFn: async () => {
      console.log('[CachedJobs] === START FETCH ===');
      console.log('[CachedJobs] Supabase URL:', process.env.EXPO_PUBLIC_SUPABASE_URL?.substring(0, 40));
      try {
        const { data, error, status, statusText } = await supabase
          .from('cached_jobs')
          .select('*')
          .order('fetched_at', { ascending: false });
        console.log('[CachedJobs] Response status:', status, statusText);
        console.log('[CachedJobs] Error:', error ? JSON.stringify(error) : 'none');
        console.log('[CachedJobs] Data count:', data?.length ?? 'null');
        if (data && data.length > 0) {
          console.log('[CachedJobs] First row sample:', JSON.stringify(data[0]).substring(0, 200));
        }
        if (error) {
          console.log('[CachedJobs] Supabase error, returning empty:', error.message);
          return [];
        }
        return (data ?? []) as CachedJob[];
      } catch (err: any) {
        console.log('[CachedJobs] Network/fetch error:', err?.message);
        return [];
      }
    },
    retry: 1,
  });

  const jobsWithDistance = useMemo<JobWithDistance[]>(() => {
    if (!jobs) return [];
    return jobs.map(job => ({
      ...job,
      distance: location && job.latitude && job.longitude
        ? getDistanceMiles(location.latitude, location.longitude, job.latitude, job.longitude)
        : null,
    }));
  }, [jobs, location]);

  const filteredJobs = useMemo(() => {
    let result = jobsWithDistance;

    if (selectedTrade) {
      result = result.filter(j =>
        j.trade_category?.toLowerCase().includes(selectedTrade.toLowerCase())
      );
    }

    if (location) {
      result = result.filter(j => j.distance === null || j.distance <= selectedRadius);
      result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    }

    return result;
  }, [jobsWithDistance, selectedRadius, selectedTrade, location]);

  const handleJobPress = useCallback((job: CachedJob) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (job.apply_url) {
      Linking.openURL(job.apply_url).catch(() => {
        console.log('[CachedJobs] Failed to open URL:', job.apply_url);
      });
    }
  }, []);

  const renderJob = useCallback(({ item }: { item: JobWithDistance }) => (
    <JobCard job={item} onPress={() => handleJobPress(item)} />
  ), [handleJobPress]);

  const loading = isLoading || locationLoading;

  // Direct Hire is part of the not-yet-launched hiring subsystem. Even if a
  // deep link reaches this route, show the same coming-soon state the other
  // hire destinations use rather than dead job listings.
  if (!HIRE_ENABLED) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
              <ArrowLeft size={20} color={themeColors.text} strokeWidth={1.75} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Direct Hire</Text>
          </View>
        </View>
        <View style={styles.emptyContainer}>
          <AlertCircle size={40} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text style={styles.emptyTitle}>Direct Hire is coming soon</Text>
          <Text style={styles.emptySubtitle}>
            The in-app hiring marketplace isn&apos;t available yet. We&apos;ll let you know when you can browse jobs and connect with workers.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeft size={20} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Direct Hire</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredJobs.length}</Text>
          </View>
        </View>

        <Text style={styles.filterSectionLabel}>RADIUS</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {RADIUS_OPTIONS.map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, selectedRadius === r && styles.chipActive]}
              onPress={() => { setSelectedRadius(r); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Text style={[styles.chipText, selectedRadius === r && styles.chipTextActive]}>{r} mi</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.filterSectionLabel, { marginTop: 8 }]}>TRADE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, !selectedTrade && styles.chipActive]}
            onPress={() => { setSelectedTrade(undefined); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
          >
            <Text style={[styles.chipText, !selectedTrade && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {TRADE_FILTERS.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.chip, selectedTrade === t && styles.chipActive]}
              onPress={() => { setSelectedTrade(selectedTrade === t ? undefined : t); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Text style={[styles.chipText, selectedTrade === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View>
          {[0, 1, 2, 3, 4].map(i => <SkeletonRow key={i} />)}
        </View>
      ) : (
        <FlatList
          {...fabScroll}
          data={filteredJobs}
          renderItem={renderJob}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <MageRefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyTitle}>No jobs posted yet</Text>
              <Text style={styles.emptySubtitle}>
                Hire shows open construction jobs near you posted by other GCs. Widen the radius, clear the trade filter, or post your own job from this screen to attract subs.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { backgroundColor: t.surface, borderBottomWidth: 0.5, borderBottomColor: t.line, paddingHorizontal: 16, paddingBottom: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 8, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: Tokens.radius.xl, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '800' as const, color: t.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: t.accent + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.card },
  countPillText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },
  filterSectionLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Tokens.radius.xl, backgroundColor: t.bg, marginRight: 6 },
  chipActive: { backgroundColor: t.accent },
  chipText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 16, marginBottom: 12,
    // Black outline matches every other card across the app.
    borderWidth: 1, borderColor: t.line,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  tradeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  tradeBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  contractBadge: { backgroundColor: t.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  contractBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  cardTitle: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 2, lineHeight: 22 },
  cardCompany: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginBottom: 10 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: t.line },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  distanceText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.info },
  applyHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  applyHintText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.accent },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  emptySubtitle: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
});
