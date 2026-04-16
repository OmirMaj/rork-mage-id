import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, ActivityIndicator, Linking, RefreshControl, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, DollarSign, ArrowLeft, Navigation, AlertCircle, Briefcase } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';

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
  if (!trade) return Colors.primary;
  const key = Object.keys(TRADE_BADGE_COLORS).find(
    k => trade.toLowerCase().includes(k.toLowerCase())
  );
  return key ? TRADE_BADGE_COLORS[key] : Colors.primary;
}

function JobCard({ job, onPress }: { job: JobWithDistance; onPress: () => void }) {
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
            <MapPin size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{job.city && job.state ? `${job.city}, ${job.state}` : job.city || job.state || 'Location not available'}</Text>
          </View>
          <View style={styles.metaItem}>
            <DollarSign size={13} color={Colors.primary} />
            <Text style={[styles.metaText, { color: Colors.primary, fontWeight: '600' as const }]}>
              {formatSalary(job.salary_min, job.salary_max)}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          {job.distance !== null && (
            <View style={styles.distanceBadge}>
              <Navigation size={11} color={Colors.info} />
              <Text style={styles.distanceText}>{job.distance} mi</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <View style={styles.applyHint}>
            <Briefcase size={12} color={Colors.primary} />
            <Text style={styles.applyHintText}>Tap to Apply</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CachedHireScreen() {
  const insets = useSafeAreaInsets();
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Finding jobs near you...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredJobs}
          renderItem={renderJob}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No jobs found</Text>
              <Text style={styles.emptySubtitle}>
                Try increasing the radius or changing the trade filter
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, paddingHorizontal: 16, paddingBottom: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 8, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: Colors.accent + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: Colors.accent },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  tradeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tradeBadgeText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  contractBadge: { backgroundColor: Colors.fillTertiary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  contractBadgeText: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary },
  cardTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 2, lineHeight: 22 },
  cardCompany: { fontSize: 13, color: Colors.textSecondary, marginBottom: 10 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  distanceText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  applyHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  applyHintText: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
});
