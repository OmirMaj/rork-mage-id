import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, Platform, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { MapPin, Star, StarHalf, ArrowLeft, Navigation, AlertCircle, Phone, Globe } from 'lucide-react-native';
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
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface CachedCompany {
  id: string;
  name: string;
  trade_specialty: string;
  rating: number;
  review_count: number;
  total_reviews: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  phone: string;
  website: string;
  photo_url: string | null;
  fetched_at: string;
}

interface CompanyWithDistance extends CachedCompany {
  distance: number | null;
}

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

const SPECIALTY_FILTERS = [
  'General Contractor', 'Electrical', 'Plumbing', 'HVAC',
  'Roofing', 'Building Materials Supply', 'Concrete Supply', 'Lumber Supply',
] as const;

function StarRow({ rating }: { rating: number | null | undefined }) {
  const r = rating ?? 0;
  const full = Math.floor(r);
  const half = r - full >= 0.5;
  const GOLD = '#F5A623';
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[0, 1, 2, 3, 4].map(i => {
        if (i < full) return <Star key={i} size={13} color={GOLD} fill={GOLD} strokeWidth={0} />;
        if (i === full && half) return <StarHalf key={i} size={13} color={GOLD} fill={GOLD} strokeWidth={0} />;
        return <Star key={i} size={13} color={GOLD} strokeWidth={1.5} />;
      })}
    </View>
  );
}

function CompanyCard({ company, onPress }: { company: CompanyWithDistance; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handleCall = useCallback(() => {
    if (!company.phone) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const tel = `tel:${company.phone.replace(/[^\d+]/g, '')}`;
    Linking.openURL(tel).catch(() => {
      console.log('[Companies] Failed to open phone:', tel);
    });
  }, [company.phone]);

  const handleWebsite = useCallback(() => {
    if (!company.website) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let url = company.website;
    if (url && !url.startsWith('http')) url = 'https://' + url;
    Linking.openURL(url).catch(() => {
      console.log('[Companies] Failed to open website:', url);
    });
  }, [company.website]);

  const formattedAddress = useMemo(() => {
    const parts = [company.address, company.city, company.state, company.zip].filter(Boolean);
    return parts.join(', ');
  }, [company.address, company.city, company.state, company.zip]);

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`cached-company-${company.id}`}
      >
        {company.photo_url ? (
          <Image source={{ uri: company.photo_url }} style={styles.companyPhoto} resizeMode="cover" />
        ) : null}

        <View style={styles.cardTop}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{company.name ? company.name.charAt(0) : '?'}</Text>
          </View>
          <View style={styles.cardTopInfo}>
            <Text style={styles.companyName} numberOfLines={1}>{company.name ?? 'Unknown Company'}</Text>
            <Text style={styles.specialtyText}>{company.trade_specialty ?? 'Specialty not listed'}</Text>
          </View>
        </View>

        <View style={styles.ratingRow}>
          <Star size={14} color="#F5A623" fill="#F5A623" strokeWidth={1.75} />
          <Text style={styles.ratingValue}>{company.rating != null ? company.rating.toFixed(1) : 'N/A'}</Text>
          <StarRow rating={company.rating} />
          <Text style={styles.reviewCount}>({company.total_reviews ?? company.review_count ?? 0} reviews)</Text>
        </View>

        <View style={styles.addressRow}>
          <MapPin size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
          <Text style={styles.addressText} numberOfLines={2}>{formattedAddress || 'Address not available'}</Text>
        </View>

        <View style={styles.cardFooter}>
          {company.distance !== null && (
            <View style={styles.distanceBadge}>
              <Navigation size={11} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.distanceText}>{company.distance} mi</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {company.phone ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={(e) => { e.stopPropagation(); handleCall(); }}
              activeOpacity={0.7}
            >
              <Phone size={14} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.actionBtnText}>Call</Text>
            </TouchableOpacity>
          ) : null}
          {company.website ? (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnOutline]}
              onPress={(e) => { e.stopPropagation(); handleWebsite(); }}
              activeOpacity={0.7}
            >
              <Globe size={14} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={[styles.actionBtnText, { color: themeColors.accent }]}>Website</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CachedCompaniesScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { location, loading: locationLoading } = useUserLocation();
  const [selectedRadius, setSelectedRadius] = useState<number>(50);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | undefined>();

  const { data: companies, isLoading, refetch, isRefetching, error: _companiesQueryError } = useQuery({
    queryKey: ['cached_companies'],
    queryFn: async () => {
      console.log('[CachedCompanies] === START FETCH ===');
      console.log('[CachedCompanies] Supabase URL:', process.env.EXPO_PUBLIC_SUPABASE_URL?.substring(0, 40));
      try {
        const { data, error, status, statusText } = await supabase
          .from('cached_companies')
          .select('*')
          .order('fetched_at', { ascending: false });
        console.log('[CachedCompanies] Response status:', status, statusText);
        console.log('[CachedCompanies] Error:', error ? JSON.stringify(error) : 'none');
        console.log('[CachedCompanies] Data count:', data?.length ?? 'null');
        if (data && data.length > 0) {
          console.log('[CachedCompanies] First row sample:', JSON.stringify(data[0]).substring(0, 200));
        }
        if (error) {
          console.log('[CachedCompanies] Supabase error, returning empty:', error.message);
          return [];
        }
        return (data ?? []) as CachedCompany[];
      } catch (err: any) {
        console.log('[CachedCompanies] Network/fetch error:', err?.message);
        return [];
      }
    },
    retry: 1,
  });

  const companiesWithDistance = useMemo<CompanyWithDistance[]>(() => {
    if (!companies) return [];
    return companies.map(c => ({
      ...c,
      distance: location && c.latitude && c.longitude
        ? getDistanceMiles(location.latitude, location.longitude, c.latitude, c.longitude)
        : null,
    }));
  }, [companies, location]);

  const filteredCompanies = useMemo(() => {
    let result = companiesWithDistance;

    if (selectedSpecialty) {
      result = result.filter(c =>
        c.trade_specialty?.toLowerCase().includes(selectedSpecialty.toLowerCase())
      );
    }

    if (location) {
      result = result.filter(c => c.distance === null || c.distance <= selectedRadius);
      result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    }

    return result;
  }, [companiesWithDistance, selectedRadius, selectedSpecialty, location]);

  const handleCompanyPress = useCallback((_company: CachedCompany) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const renderCompany = useCallback(({ item }: { item: CompanyWithDistance }) => (
    <CompanyCard company={item} onPress={() => handleCompanyPress(item)} />
  ), [handleCompanyPress]);

  const loading = isLoading || locationLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeft size={20} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Companies</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredCompanies.length}</Text>
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

        <Text style={[styles.filterSectionLabel, { marginTop: 8 }]}>SPECIALTY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, !selectedSpecialty && styles.chipActive]}
            onPress={() => { setSelectedSpecialty(undefined); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
          >
            <Text style={[styles.chipText, !selectedSpecialty && styles.chipTextActive]}>All</Text>
          </TouchableOpacity>
          {SPECIALTY_FILTERS.map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.chip, selectedSpecialty === s && styles.chipActive]}
              onPress={() => { setSelectedSpecialty(selectedSpecialty === s ? undefined : s); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Text style={[styles.chipText, selectedSpecialty === s && styles.chipTextActive]}>{s}</Text>
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
          data={filteredCompanies}
          renderItem={renderCompany}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <MageRefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyTitle}>No companies match yet</Text>
              <Text style={styles.emptySubtitle}>
                Companies are construction firms publishing public profiles in your area. Try a wider radius, clear the specialty filter, or check back as more companies join.
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
  countPill: { backgroundColor: Colors.successLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.card },
  countPillText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.successDark },
  filterSectionLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Tokens.radius.xl, backgroundColor: t.bg, marginRight: 6 },
  chipActive: { backgroundColor: t.accent },
  chipText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, marginBottom: 12, overflow: 'hidden' as const,
    // Black outline matches every other card across the app.
    borderWidth: 1, borderColor: t.line,
  },
  companyPhoto: { width: '100%', height: 140 },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.accent + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: t.accent },
  cardTopInfo: { flex: 1 },
  companyName: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text },
  specialtyText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '600' as const, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, marginBottom: 8 },
  ratingValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#F5A623' },
  ratingStars: { fontSize: Type.caption1.fontSize, color: '#F5A623', letterSpacing: 1 },
  reviewCount: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingHorizontal: 16, marginBottom: 8 },
  addressText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: t.line, gap: 8 },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.xs },
  distanceText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.info },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.accent, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.sm },
  actionBtnOutline: { backgroundColor: t.accent + '12', borderWidth: 1, borderColor: t.accent + '30' },
  actionBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: '#FFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  emptySubtitle: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
});
