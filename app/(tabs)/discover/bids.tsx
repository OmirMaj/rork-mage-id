import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, Platform, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Clock, DollarSign, ArrowLeft, Navigation, AlertCircle, Crosshair, ChevronDown, X, Filter, Building } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import MageRefreshControl from '@/components/MageRefreshControl';
import { SkeletonRow } from '@/components/Skeleton';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { US_STATES } from '@/constants/states';

interface CachedBid {
  id: string;
  title: string;
  department: string;
  deadline: string;
  estimated_value: number;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  source_url: string;
  set_aside: string | null;
  fetched_at: string;
}

interface BidWithDistance extends CachedBid {
  distance: number | null;
}

interface NearbyCity {
  city: string;
  state: string;
  distance: number;
  count: number;
}

const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;

const SET_ASIDE_TYPES = [
  'Small Business', 'MWBE', 'SDVOSB', 'HUBZone', '8(a)', 'WOSB', 'None',
] as const;

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return 'Not specified';
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  return `$${amount.toLocaleString()}`;
}

function getDeadlineInfo(deadline: string | null | undefined): { text: string; color: string; bgColor: string } {
  if (!deadline) return { text: 'No deadline', color: '#9E9E9E', bgColor: '#F5F5F5' };
  const diff = new Date(deadline).getTime() - Date.now();
  if (isNaN(diff)) return { text: 'No deadline', color: '#9E9E9E', bgColor: '#F5F5F5' };
  if (diff <= 0) return { text: 'Expired', color: '#9E9E9E', bgColor: '#F5F5F5' };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 3) return { text: `${days}d ${Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))}h left`, color: '#D32F2F', bgColor: '#FFEBEE' };
  if (days <= 7) return { text: `${days} days left`, color: '#F57F17', bgColor: '#FFF8E1' };
  if (days > 30) return { text: `${Math.floor(days / 30)}mo ${days % 30}d left`, color: '#2E7D32', bgColor: '#E8F5E9' };
  return { text: `${days} days left`, color: '#2E7D32', bgColor: '#E8F5E9' };
}

function BidCard({ bid, onPress }: { bid: BidWithDistance; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const deadlineInfo = getDeadlineInfo(bid.deadline);

  return (
    <Animated.View style={[styles.bidCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`cached-bid-${bid.id}`}
      >
        <View style={styles.bidHeader}>
          {bid.set_aside ? (
            <View style={styles.setAsideBadge}>
              <Text style={styles.setAsideText}>{bid.set_aside}</Text>
            </View>
          ) : (
            <View style={styles.openBadge}>
              <Text style={styles.openBadgeText}>Open</Text>
            </View>
          )}
          <View style={[styles.countdownBadge, { backgroundColor: deadlineInfo.bgColor }]}>
            <Clock size={11} color={deadlineInfo.color} />
            <Text style={[styles.countdownText, { color: deadlineInfo.color }]}>{deadlineInfo.text}</Text>
          </View>
        </View>

        <Text style={styles.bidTitle} numberOfLines={2}>{bid.title ?? 'Untitled Bid'}</Text>
        <Text style={styles.bidDepartment} numberOfLines={1}>{bid.department ?? 'Department not listed'}</Text>

        <View style={styles.bidMeta}>
          <View style={styles.metaItem}>
            <MapPin size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{bid.city && bid.state ? `${bid.city}, ${bid.state}` : bid.city || bid.state || 'Location not available'}</Text>
          </View>
          <View style={styles.metaItem}>
            <DollarSign size={13} color={Colors.primary} />
            <Text style={[styles.metaText, { color: Colors.primary, fontWeight: '600' as const }]}>
              {formatCurrency(bid.estimated_value)}
            </Text>
          </View>
        </View>

        <View style={styles.bidFooter}>
          <View style={styles.footerLeft}>
            {bid.distance !== null && (
              <View style={styles.distanceBadge}>
                <Navigation size={11} color={Colors.info} />
                <Text style={styles.distanceText}>{bid.distance} mi</Text>
              </View>
            )}
            {bid.city ? (
              <View style={styles.cityBadge}>
                <Building size={10} color={Colors.textSecondary} />
                <Text style={styles.cityBadgeText}>{bid.city}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.deadlineDate}>
            {bid.deadline ? `Due: ${new Date(bid.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'No deadline'}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CachedBidsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { location } = useUserLocation();
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
  const [selectedSetAside, setSelectedSetAside] = useState<string | undefined>();
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<'all' | 'nearby' | 'state' | 'city'>('all');
  const [showStateList, setShowStateList] = useState(false);
  const [showSetAsideDropdown, setShowSetAsideDropdown] = useState(false);

  const { data: bids, isLoading, refetch, isRefetching, error: bidsQueryError } = useQuery({
    queryKey: ['cached_bids'],
    queryFn: async () => {
      console.log('[CachedBids] === START FETCH ===');
      try {
        const { data, error, status, statusText } = await supabase
          .from('cached_bids')
          .select('*')
          .order('fetched_at', { ascending: false });
        console.log('[CachedBids] Response status:', status, statusText);
        console.log('[CachedBids] Error:', error ? JSON.stringify(error) : 'none');
        console.log('[CachedBids] Data count:', data?.length ?? 'null');
        if (error) {
          console.log('[CachedBids] Supabase error, returning empty:', error.message);
          return [];
        }
        return (data ?? []) as CachedBid[];
      } catch (err: any) {
        console.log('[CachedBids] Network/fetch error:', err?.message);
        return [];
      }
    },
    retry: 1,
  });

  const bidsWithDistance = useMemo<BidWithDistance[]>(() => {
    if (!bids) return [];
    return bids.map(bid => ({
      ...bid,
      distance: location && bid.latitude && bid.longitude
        ? getDistanceMiles(location.latitude, location.longitude, bid.latitude, bid.longitude)
        : null,
    }));
  }, [bids, location]);

  const nearbyCities = useMemo<NearbyCity[]>(() => {
    if (!bidsWithDistance.length) return [];
    const cityMap = new Map<string, { city: string; state: string; distance: number; count: number }>();
    for (const bid of bidsWithDistance) {
      if (!bid.city) continue;
      const key = `${bid.city}_${bid.state ?? ''}`.toLowerCase();
      const existing = cityMap.get(key);
      if (existing) {
        existing.count += 1;
        if (bid.distance !== null && bid.distance < existing.distance) {
          existing.distance = bid.distance;
        }
      } else {
        cityMap.set(key, {
          city: bid.city,
          state: bid.state ?? '',
          distance: bid.distance ?? 99999,
          count: 1,
        });
      }
    }
    return Array.from(cityMap.values())
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 20);
  }, [bidsWithDistance]);

  const filteredBids = useMemo(() => {
    let result = bidsWithDistance;

    if (selectedSetAside) {
      if (selectedSetAside === 'None') {
        result = result.filter(b => !b.set_aside);
      } else {
        result = result.filter(b => b.set_aside?.toLowerCase().includes(selectedSetAside.toLowerCase()));
      }
    }

    if (locationMode === 'nearby' && location && selectedRadius !== null) {
      result = result.filter(b => b.distance === null || b.distance <= selectedRadius);
    }

    if (locationMode === 'state' && selectedState) {
      result = result.filter(b => b.state?.toUpperCase() === selectedState.toUpperCase());
    }

    if (locationMode === 'city' && selectedCity) {
      result = result.filter(b => b.city?.toLowerCase() === selectedCity.toLowerCase());
    }

    if (location) {
      result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    }

    return result;
  }, [bidsWithDistance, selectedRadius, selectedSetAside, location, locationMode, selectedState, selectedCity]);

  const handleBidPress = useCallback((bid: CachedBid) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (bid.source_url) {
      Linking.openURL(bid.source_url).catch(() => {
        console.log('[CachedBids] Failed to open URL:', bid.source_url);
      });
    }
  }, []);

  const handleLocationModeChange = useCallback((mode: 'all' | 'nearby' | 'state' | 'city') => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setLocationMode(mode);
    if (mode === 'nearby' && selectedRadius === null) {
      setSelectedRadius(50);
    }
    if (mode !== 'state') {
      setShowStateList(false);
    }
    if (mode === 'state') {
      setShowStateList(true);
    }
    if (mode !== 'city') {
      setSelectedCity(null);
    }
  }, [selectedRadius]);

  const handleSetAsideSelect = useCallback((value: string | undefined) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedSetAside(value);
    setShowSetAsideDropdown(false);
  }, []);

  const renderBid = useCallback(({ item }: { item: BidWithDistance }) => (
    <BidCard bid={item} onPress={() => handleBidPress(item)} />
  ), [handleBidPress]);

  const loading = isLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Public Bids</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredBids.length}</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          <View style={styles.filterBlock}>
            <Text style={styles.filterSectionLabel}>LOCATION</Text>
            <View style={styles.locationRow}>
              <TouchableOpacity
                style={[styles.locationChip, locationMode === 'all' && styles.locationChipActive]}
                onPress={() => handleLocationModeChange('all')}
              >
                <Text style={[styles.locationChipText, locationMode === 'all' && styles.locationChipTextActive]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationChip, locationMode === 'nearby' && styles.locationChipActive]}
                onPress={() => handleLocationModeChange('nearby')}
              >
                <Crosshair size={12} color={locationMode === 'nearby' ? '#FFF' : Colors.textSecondary} />
                <Text style={[styles.locationChipText, locationMode === 'nearby' && styles.locationChipTextActive]}>Near Me</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationChip, locationMode === 'city' && styles.locationChipActive]}
                onPress={() => handleLocationModeChange('city')}
              >
                <Building size={12} color={locationMode === 'city' ? '#FFF' : Colors.textSecondary} />
                <Text style={[styles.locationChipText, locationMode === 'city' && styles.locationChipTextActive]}>City</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.locationChip, locationMode === 'state' && styles.locationChipActive]}
                onPress={() => handleLocationModeChange('state')}
              >
                <ChevronDown size={12} color={locationMode === 'state' ? '#FFF' : Colors.textSecondary} />
                <Text style={[styles.locationChipText, locationMode === 'state' && styles.locationChipTextActive]}>
                  {selectedState ? selectedState : 'State'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.filterBlock}>
            <Text style={styles.filterSectionLabel}>SET-ASIDE</Text>
            <TouchableOpacity
              style={styles.dropdownButton}
              onPress={() => { setShowSetAsideDropdown(true); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Filter size={13} color={selectedSetAside ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.dropdownButtonText, selectedSetAside && styles.dropdownButtonTextActive]}>
                {selectedSetAside ?? 'All Types'}
              </Text>
              <ChevronDown size={14} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {locationMode === 'nearby' && (
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
        )}

        {locationMode === 'city' && nearbyCities.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {nearbyCities.map(c => (
              <TouchableOpacity
                key={`${c.city}_${c.state}`}
                style={[styles.cityChip, selectedCity?.toLowerCase() === c.city.toLowerCase() && styles.chipActive]}
                onPress={() => {
                  setSelectedCity(selectedCity?.toLowerCase() === c.city.toLowerCase() ? null : c.city);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.cityChipText, selectedCity?.toLowerCase() === c.city.toLowerCase() && styles.chipTextActive]} numberOfLines={1}>
                  {c.city}{c.state ? `, ${c.state}` : ''}
                </Text>
                {c.distance < 99999 && (
                  <Text style={[styles.cityChipMeta, selectedCity?.toLowerCase() === c.city.toLowerCase() && { color: 'rgba(255,255,255,0.7)' }]}>
                    {c.distance}mi · {c.count}
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {locationMode === 'state' && showStateList && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {US_STATES.map(s => (
              <TouchableOpacity
                key={s.abbr}
                style={[styles.stateChip, selectedState === s.abbr && styles.chipActive]}
                onPress={() => {
                  setSelectedState(selectedState === s.abbr ? null : s.abbr);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.chipText, selectedState === s.abbr && styles.chipTextActive]}>{s.abbr}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      <Modal
        visible={showSetAsideDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSetAsideDropdown(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSetAsideDropdown(false)}
        >
          <View style={styles.dropdownModal}>
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>Set-Aside Type</Text>
              <TouchableOpacity onPress={() => setShowSetAsideDropdown(false)}>
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.dropdownItem, !selectedSetAside && styles.dropdownItemActive]}
              onPress={() => handleSetAsideSelect(undefined)}
            >
              <Text style={[styles.dropdownItemText, !selectedSetAside && styles.dropdownItemTextActive]}>All Types</Text>
              {!selectedSetAside && <View style={styles.dropdownCheck} />}
            </TouchableOpacity>
            {SET_ASIDE_TYPES.map(sa => (
              <TouchableOpacity
                key={sa}
                style={[styles.dropdownItem, selectedSetAside === sa && styles.dropdownItemActive]}
                onPress={() => handleSetAsideSelect(selectedSetAside === sa ? undefined : sa)}
              >
                <Text style={[styles.dropdownItemText, selectedSetAside === sa && styles.dropdownItemTextActive]}>{sa}</Text>
                {selectedSetAside === sa && <View style={styles.dropdownCheck} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {bidsQueryError ? (
        <View style={styles.loadingContainer}>
          <AlertCircle size={40} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Query Error</Text>
          <Text style={styles.emptySubtitle}>{bidsQueryError.message}</Text>
          <TouchableOpacity onPress={() => { void refetch(); }} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View>
          {/* Skeleton rows replace the centered loader — preserves the
              list rhythm so content fades in rather than punches through. */}
          {[0, 1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filteredBids}
          renderItem={renderBid}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <MageRefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No bids found</Text>
              <Text style={styles.emptySubtitle}>
                Try changing your location or removing filters
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
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 8, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  filterRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  filterBlock: { flex: 1 },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  locationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  locationChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: Colors.background },
  locationChipActive: { backgroundColor: Colors.primary },
  locationChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  locationChipTextActive: { color: '#FFF' },
  dropdownButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderLight,
  },
  dropdownButtonText: { flex: 1, fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  dropdownButtonTextActive: { color: Colors.primary, fontWeight: '600' as const },
  chipRow: { flexDirection: 'row', marginTop: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  cityChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18,
    backgroundColor: Colors.background, marginRight: 6, alignItems: 'center',
  },
  cityChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' as const },
  cityChipMeta: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  stateChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  list: { padding: 16, paddingBottom: 100 },
  bidCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  bidHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  setAsideBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  setAsideText: { fontSize: 11, fontWeight: '700' as const, color: '#2E7D32', textTransform: 'uppercase' as const },
  openBadge: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  openBadgeText: { fontSize: 11, fontWeight: '700' as const, color: '#1565C0', textTransform: 'uppercase' as const },
  countdownBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  countdownText: { fontSize: 11, fontWeight: '600' as const },
  bidTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 4, lineHeight: 22 },
  bidDepartment: { fontSize: 13, color: Colors.textSecondary, marginBottom: 10 },
  bidMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  bidFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  distanceText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  cityBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.fillSecondary, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  cityBadgeText: { fontSize: 11, fontWeight: '500' as const, color: Colors.textSecondary },
  deadlineDate: { fontSize: 12, color: Colors.textMuted },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
  retryButton: { marginTop: 12, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryButtonText: { color: '#FFF', fontWeight: '600' as const },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center',
  },
  dropdownModal: {
    width: '80%', backgroundColor: Colors.surface, borderRadius: 16, paddingVertical: 8, maxHeight: 400,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
  },
  dropdownHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight,
  },
  dropdownTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  dropdownItemActive: { backgroundColor: Colors.primary + '08' },
  dropdownItemText: { fontSize: 15, color: Colors.text, fontWeight: '400' as const },
  dropdownItemTextActive: { color: Colors.primary, fontWeight: '600' as const },
  dropdownCheck: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
});
