import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, ActivityIndicator, Linking, RefreshControl, Platform, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Star, ArrowLeft, Navigation, AlertCircle, Phone, Globe } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';

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

function renderStars(rating: number | null | undefined): string {
  if (rating == null) return '☆☆☆☆☆';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - half);
}

function CompanyCard({ company, onPress }: { company: CompanyWithDistance; onPress: () => void }) {
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
          <Star size={14} color="#F5A623" fill="#F5A623" />
          <Text style={styles.ratingValue}>{company.rating != null ? company.rating.toFixed(1) : 'N/A'}</Text>
          <Text style={styles.ratingStars}>{renderStars(company.rating)}</Text>
          <Text style={styles.reviewCount}>({company.total_reviews ?? company.review_count ?? 0} reviews)</Text>
        </View>

        <View style={styles.addressRow}>
          <MapPin size={13} color={Colors.textSecondary} />
          <Text style={styles.addressText} numberOfLines={2}>{formattedAddress || 'Address not available'}</Text>
        </View>

        <View style={styles.cardFooter}>
          {company.distance !== null && (
            <View style={styles.distanceBadge}>
              <Navigation size={11} color={Colors.info} />
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
              <Phone size={14} color="#FFF" />
              <Text style={styles.actionBtnText}>Call</Text>
            </TouchableOpacity>
          ) : null}
          {company.website ? (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnOutline]}
              onPress={(e) => { e.stopPropagation(); handleWebsite(); }}
              activeOpacity={0.7}
            >
              <Globe size={14} color={Colors.primary} />
              <Text style={[styles.actionBtnText, { color: Colors.primary }]}>Website</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CachedCompaniesScreen() {
  const insets = useSafeAreaInsets();
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
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Finding companies near you...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredCompanies}
          renderItem={renderCompany}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No companies found</Text>
              <Text style={styles.emptySubtitle}>
                Try increasing the radius or changing the specialty filter
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
  countPill: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: '#2E7D32' },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  list: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 14, marginBottom: 12, overflow: 'hidden' as const,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  companyPhoto: { width: '100%', height: 140 },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { fontSize: 18, fontWeight: '800' as const, color: Colors.primary },
  cardTopInfo: { flex: 1 },
  companyName: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  specialtyText: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, marginBottom: 8 },
  ratingValue: { fontSize: 14, fontWeight: '700' as const, color: '#F5A623' },
  ratingStars: { fontSize: 12, color: '#F5A623', letterSpacing: 1 },
  reviewCount: { fontSize: 12, color: Colors.textMuted },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, paddingHorizontal: 16, marginBottom: 8 },
  addressText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight, gap: 8 },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  distanceText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  actionBtnOutline: { backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '30' },
  actionBtnText: { fontSize: 12, fontWeight: '600' as const, color: '#FFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
});
