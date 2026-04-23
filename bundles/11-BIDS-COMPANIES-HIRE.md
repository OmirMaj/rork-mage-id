# Bids, Companies, Hiring & Marketplace Listings


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Marketplace side of the app — bid listings, sub/company profiles, and
hiring workers for a job.


## Files in this bundle

- `app/(tabs)/bids/index.tsx`
- `app/(tabs)/companies/index.tsx`
- `app/(tabs)/hire/index.tsx`
- `app/(tabs)/subs/index.tsx`
- `app/bid-detail.tsx`
- `app/company-detail.tsx`
- `app/worker-detail.tsx`
- `app/job-detail.tsx`
- `app/post-bid.tsx`
- `app/post-job.tsx`
- `components/AIBidScorer.tsx`
- `components/AIBidScorecard.tsx`
- `components/AISubEvaluator.tsx`
- `components/ContactPickerModal.tsx`


---

### `app/(tabs)/bids/index.tsx`

```tsx
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, RefreshControl, Platform, Modal, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Clock, DollarSign, Navigation, AlertCircle, Crosshair, ChevronDown, X, Filter, Building, Search, Heart, Bookmark, FileText, Tag, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
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
  description?: string;
  bid_type?: string;
  category?: string;
  bond_required?: number;
  contact_email?: string;
  contact_phone?: string;
  apply_url?: string;
  source_name?: string;
  posted_by?: string;
  posted_date?: string;
  naics_code?: string;
  solicitation_number?: string;
  pre_bid_date?: string;
  scope_of_work?: string;
  documents_url?: string;
  required_certifications?: string[];
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

export interface TrackedBid {
  bidId: string;
  status: 'saved' | 'interested' | 'preparing' | 'submitted' | 'won' | 'lost';
  notes: string;
  proposalAmount: number | null;
  savedAt: string;
}

const TRACKED_BIDS_KEY = 'mageid_tracked_bids';
const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;
const SET_ASIDE_TYPES = ['Small Business', 'MWBE', 'SDVOSB', 'HUBZone', '8(a)', 'WOSB', 'None'] as const;
const VALUE_RANGES = [
  { label: '<$50K', min: 0, max: 50000 },
  { label: '$50K-$250K', min: 50000, max: 250000 },
  { label: '$250K-$1M', min: 250000, max: 1000000 },
  { label: '$1M+', min: 1000000, max: Infinity },
] as const;
const BID_TYPES = ['federal', 'state', 'municipal', 'county', 'private'] as const;
const SORT_OPTIONS = ['nearest', 'newest', 'deadline', 'value'] as const;

const BID_TYPE_LABELS: Record<string, string> = {
  federal: 'Federal', state: 'State', municipal: 'Municipal', county: 'County', private: 'Private',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  saved: { bg: '#E3F2FD', text: '#1565C0' },
  interested: { bg: '#FFF3E0', text: '#E65100' },
  preparing: { bg: '#F3E5F5', text: '#7B1FA2' },
  submitted: { bg: '#E8F5E9', text: '#2E7D32' },
  won: { bg: '#E8F5E9', text: '#1B5E20' },
  lost: { bg: '#FFEBEE', text: '#C62828' },
};

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

function BidCard({ bid, onPress, tracked }: { bid: BidWithDistance; onPress: () => void; tracked?: TrackedBid }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const deadlineInfo = getDeadlineInfo(bid.deadline);

  return (
    <Animated.View style={[styles.bidCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`bid-card-${bid.id}`}
      >
        <View style={styles.bidHeader}>
          <View style={styles.bidHeaderLeft}>
            {bid.set_aside ? (
              <View style={styles.setAsideBadge}>
                <Text style={styles.setAsideText}>{bid.set_aside}</Text>
              </View>
            ) : (
              <View style={styles.openBadge}>
                <Text style={styles.openBadgeText}>Open</Text>
              </View>
            )}
            {bid.bid_type && BID_TYPE_LABELS[bid.bid_type] && (
              <View style={styles.bidTypeBadge}>
                <Text style={styles.bidTypeText}>{BID_TYPE_LABELS[bid.bid_type]}</Text>
              </View>
            )}
          </View>
          <View style={styles.bidHeaderRight}>
            {tracked && (
              <View style={[styles.trackedBadge, { backgroundColor: STATUS_COLORS[tracked.status]?.bg ?? '#E3F2FD' }]}>
                <Bookmark size={10} color={STATUS_COLORS[tracked.status]?.text ?? '#1565C0'} />
              </View>
            )}
            <View style={[styles.countdownBadge, { backgroundColor: deadlineInfo.bgColor }]}>
              <Clock size={11} color={deadlineInfo.color} />
              <Text style={[styles.countdownText, { color: deadlineInfo.color }]}>{deadlineInfo.text}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.bidTitle} numberOfLines={2}>{bid.title ?? 'Untitled Bid'}</Text>
        <Text style={styles.bidDepartment} numberOfLines={1}>{bid.department ?? 'Department not listed'}</Text>

        {bid.description ? (
          <Text style={styles.bidDescription} numberOfLines={2}>{bid.description}</Text>
        ) : null}

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
            {bid.naics_code ? (
              <View style={styles.naicsBadge}>
                <Tag size={10} color={Colors.textMuted} />
                <Text style={styles.naicsText}>{bid.naics_code}</Text>
              </View>
            ) : null}
            {bid.solicitation_number ? (
              <View style={styles.naicsBadge}>
                <FileText size={10} color={Colors.textMuted} />
                <Text style={styles.naicsText} numberOfLines={1}>{bid.solicitation_number}</Text>
              </View>
            ) : null}
          </View>
          <ChevronRight size={16} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function BidsScreen() {
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedValueRange, setSelectedValueRange] = useState<number | null>(null);
  const [selectedBidType, setSelectedBidType] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<typeof SORT_OPTIONS[number]>('nearest');
  const [trackedBids, setTrackedBids] = useState<TrackedBid[]>([]);
  const [showMyBids, setShowMyBids] = useState(true);
  const [myBidsFilter, setMyBidsFilter] = useState<string>('all');

  useEffect(() => {
    AsyncStorage.getItem(TRACKED_BIDS_KEY).then(data => {
      if (data) {
        try { setTrackedBids(JSON.parse(data)); } catch { /* ignore */ }
      }
    }).catch(() => {});
  }, []);

  const { data: bids, isLoading, refetch, isRefetching, error: bidsQueryError } = useQuery({
    queryKey: ['cached_bids'],
    queryFn: async () => {
      console.log('[Bids] Fetching from cached_bids...');
      const { data, error } = await supabase
        .from('cached_bids')
        .select('*')
        .order('posted_date', { ascending: false });
      console.log('Bids data:', data?.length, 'Error:', error);
      if (error) throw new Error(`Supabase error: ${error.message}`);
      return (data ?? []) as CachedBid[];
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
        if (bid.distance !== null && bid.distance < existing.distance) existing.distance = bid.distance;
      } else {
        cityMap.set(key, { city: bid.city, state: bid.state ?? '', distance: bid.distance ?? 99999, count: 1 });
      }
    }
    return Array.from(cityMap.values()).sort((a, b) => a.distance - b.distance).slice(0, 20);
  }, [bidsWithDistance]);

  const trackedBidMap = useMemo(() => {
    const map = new Map<string, TrackedBid>();
    for (const tb of trackedBids) map.set(tb.bidId, tb);
    return map;
  }, [trackedBids]);

  const myTrackedBidsList = useMemo(() => {
    if (!bidsWithDistance.length) return [];
    return trackedBids
      .filter(tb => myBidsFilter === 'all' || tb.status === myBidsFilter)
      .map(tb => {
        const bid = bidsWithDistance.find(b => b.id === tb.bidId);
        return bid ? { bid, tracked: tb } : null;
      })
      .filter(Boolean) as Array<{ bid: BidWithDistance; tracked: TrackedBid }>;
  }, [trackedBids, bidsWithDistance, myBidsFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: trackedBids.length };
    for (const tb of trackedBids) counts[tb.status] = (counts[tb.status] ?? 0) + 1;
    return counts;
  }, [trackedBids]);

  const filteredBids = useMemo(() => {
    let result = bidsWithDistance;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(b =>
        (b.title ?? '').toLowerCase().includes(q) ||
        (b.department ?? '').toLowerCase().includes(q) ||
        (b.city ?? '').toLowerCase().includes(q) ||
        (b.description ?? '').toLowerCase().includes(q) ||
        (b.solicitation_number ?? '').toLowerCase().includes(q)
      );
    }

    if (selectedSetAside) {
      if (selectedSetAside === 'None') result = result.filter(b => !b.set_aside);
      else result = result.filter(b => b.set_aside?.toLowerCase().includes(selectedSetAside.toLowerCase()));
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

    if (selectedValueRange !== null) {
      const range = VALUE_RANGES[selectedValueRange];
      result = result.filter(b => b.estimated_value >= range.min && b.estimated_value < range.max);
    }

    if (selectedBidType) {
      result = result.filter(b => b.bid_type === selectedBidType);
    }

    switch (sortBy) {
      case 'nearest':
        result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
        break;
      case 'newest':
        result.sort((a, b) => new Date(b.fetched_at).getTime() - new Date(a.fetched_at).getTime());
        break;
      case 'deadline':
        result.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
        break;
      case 'value':
        result.sort((a, b) => (b.estimated_value ?? 0) - (a.estimated_value ?? 0));
        break;
    }

    return result;
  }, [bidsWithDistance, searchQuery, selectedRadius, selectedSetAside, location, locationMode, selectedState, selectedCity, selectedValueRange, selectedBidType, sortBy]);

  const handleBidPress = useCallback((bid: CachedBid) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/bid-detail', params: { id: bid.id, source: 'cached' } });
  }, [router]);

  const handleLocationModeChange = useCallback((mode: 'all' | 'nearby' | 'state' | 'city') => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setLocationMode(mode);
    if (mode === 'nearby' && selectedRadius === null) setSelectedRadius(50);
    if (mode !== 'state') setShowStateList(false);
    if (mode === 'state') setShowStateList(true);
    if (mode !== 'city') setSelectedCity(null);
  }, [selectedRadius]);

  const handleSetAsideSelect = useCallback((value: string | undefined) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedSetAside(value);
    setShowSetAsideDropdown(false);
  }, []);

  const renderBid = useCallback(({ item }: { item: BidWithDistance }) => (
    <BidCard bid={item} onPress={() => handleBidPress(item)} tracked={trackedBidMap.get(item.id)} />
  ), [handleBidPress, trackedBidMap]);

  const loading = isLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Public Bids</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredBids.length}</Text>
          </View>
        </View>

        <View style={[styles.searchBar]}>
          <Search size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search bids, departments, solicitations..."
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            returnKeyType="search"
            testID="bid-search-input"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filterRow}>
          <View style={styles.filterBlock}>
            <Text style={styles.filterSectionLabel}>LOCATION</Text>
            <View style={styles.locationRow}>
              <TouchableOpacity style={[styles.locationChip, locationMode === 'all' && styles.locationChipActive]} onPress={() => handleLocationModeChange('all')}>
                <Text style={[styles.locationChipText, locationMode === 'all' && styles.locationChipTextActive]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.locationChip, locationMode === 'nearby' && styles.locationChipActive]} onPress={() => handleLocationModeChange('nearby')}>
                <Crosshair size={12} color={locationMode === 'nearby' ? '#FFF' : Colors.textSecondary} />
                <Text style={[styles.locationChipText, locationMode === 'nearby' && styles.locationChipTextActive]}>Near Me</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.locationChip, locationMode === 'city' && styles.locationChipActive]} onPress={() => handleLocationModeChange('city')}>
                <Building size={12} color={locationMode === 'city' ? '#FFF' : Colors.textSecondary} />
                <Text style={[styles.locationChipText, locationMode === 'city' && styles.locationChipTextActive]}>City</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.locationChip, locationMode === 'state' && styles.locationChipActive]} onPress={() => handleLocationModeChange('state')}>
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {VALUE_RANGES.map((range, idx) => (
            <TouchableOpacity
              key={range.label}
              style={[styles.chip, selectedValueRange === idx && styles.chipActive]}
              onPress={() => {
                setSelectedValueRange(selectedValueRange === idx ? null : idx);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
            >
              <Text style={[styles.chipText, selectedValueRange === idx && styles.chipTextActive]}>{range.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.chipDivider} />
          {BID_TYPES.map(bt => (
            <TouchableOpacity
              key={bt}
              style={[styles.chip, selectedBidType === bt && styles.chipActive]}
              onPress={() => {
                setSelectedBidType(selectedBidType === bt ? null : bt);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
            >
              <Text style={[styles.chipText, selectedBidType === bt && styles.chipTextActive]}>{BID_TYPE_LABELS[bt] ?? bt}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.chipDivider} />
          {SORT_OPTIONS.map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.chip, sortBy === s && styles.sortChipActive]}
              onPress={() => { setSortBy(s); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            >
              <Text style={[styles.chipText, sortBy === s && styles.sortChipTextActive]}>
                {s === 'nearest' ? '📍 Nearest' : s === 'newest' ? '🕐 Newest' : s === 'deadline' ? '⏰ Deadline' : '💰 Value'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

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

      <Modal visible={showSetAsideDropdown} transparent animationType="fade" onRequestClose={() => setShowSetAsideDropdown(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSetAsideDropdown(false)}>
          <View style={styles.dropdownModal}>
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>Set-Aside Type</Text>
              <TouchableOpacity onPress={() => setShowSetAsideDropdown(false)}><X size={20} color={Colors.text} /></TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.dropdownItem, !selectedSetAside && styles.dropdownItemActive]} onPress={() => handleSetAsideSelect(undefined)}>
              <Text style={[styles.dropdownItemText, !selectedSetAside && styles.dropdownItemTextActive]}>All Types</Text>
              {!selectedSetAside && <View style={styles.dropdownCheck} />}
            </TouchableOpacity>
            {SET_ASIDE_TYPES.map(sa => (
              <TouchableOpacity key={sa} style={[styles.dropdownItem, selectedSetAside === sa && styles.dropdownItemActive]} onPress={() => handleSetAsideSelect(selectedSetAside === sa ? undefined : sa)}>
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
        <View style={styles.loadingContainer}>
          <ConstructionLoader size="lg" label="Loading bids..." />
        </View>
      ) : (
        <FlatList
          data={filteredBids}
          renderItem={renderBid}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />}
          ListHeaderComponent={
            trackedBids.length > 0 ? (
              <View style={styles.myBidsSection}>
                <TouchableOpacity style={styles.myBidsHeader} onPress={() => setShowMyBids(!showMyBids)} activeOpacity={0.7}>
                  <View style={styles.myBidsTitleRow}>
                    <Heart size={16} color={Colors.primary} />
                    <Text style={styles.myBidsTitle}>My Tracked Bids</Text>
                    <View style={styles.myBidsCount}><Text style={styles.myBidsCountText}>{trackedBids.length}</Text></View>
                  </View>
                  <ChevronDown size={16} color={Colors.textMuted} style={showMyBids ? { transform: [{ rotate: '180deg' }] } : undefined} />
                </TouchableOpacity>
                {showMyBids && (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusChipRow}>
                      {['all', 'saved', 'preparing', 'submitted', 'won', 'lost'].map(s => (
                        <TouchableOpacity
                          key={s}
                          style={[styles.statusChip, myBidsFilter === s && { backgroundColor: STATUS_COLORS[s]?.bg ?? Colors.primary + '15' }]}
                          onPress={() => setMyBidsFilter(s)}
                        >
                          <Text style={[styles.statusChipText, myBidsFilter === s && { color: STATUS_COLORS[s]?.text ?? Colors.primary, fontWeight: '600' as const }]}>
                            {s.charAt(0).toUpperCase() + s.slice(1)} {statusCounts[s] ? `(${statusCounts[s]})` : ''}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    {myTrackedBidsList.slice(0, 3).map(({ bid, tracked }) => (
                      <TouchableOpacity
                        key={bid.id}
                        style={styles.trackedBidRow}
                        onPress={() => handleBidPress(bid)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.trackedBidInfo}>
                          <Text style={styles.trackedBidTitle} numberOfLines={1}>{bid.title}</Text>
                          <Text style={styles.trackedBidMeta}>{formatCurrency(bid.estimated_value)} · {bid.city}, {bid.state}</Text>
                        </View>
                        <View style={[styles.trackedStatusBadge, { backgroundColor: STATUS_COLORS[tracked.status]?.bg ?? '#E3F2FD' }]}>
                          <Text style={[styles.trackedStatusText, { color: STATUS_COLORS[tracked.status]?.text ?? '#1565C0' }]}>
                            {tracked.status}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No bids found</Text>
              <Text style={styles.emptySubtitle}>Try changing your location or removing filters</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, paddingHorizontal: 16, paddingBottom: 8 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 8 },
  headerTitle: { fontSize: 28, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary, borderRadius: 12, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  filterRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  filterBlock: { flex: 1 },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  locationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  locationChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: Colors.background },
  locationChipActive: { backgroundColor: Colors.primary },
  locationChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  locationChipTextActive: { color: '#FFF' },
  dropdownButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderLight },
  dropdownButtonText: { flex: 1, fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  dropdownButtonTextActive: { color: Colors.primary, fontWeight: '600' as const },
  chipRow: { flexDirection: 'row', marginTop: 4, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  chipDivider: { width: 1, height: 20, backgroundColor: Colors.borderLight, marginHorizontal: 4, alignSelf: 'center' as const },
  sortChipActive: { backgroundColor: Colors.accent },
  sortChipTextActive: { color: '#FFF', fontWeight: '600' as const },
  cityChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6, alignItems: 'center' },
  cityChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' as const },
  cityChipMeta: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  stateChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  list: { padding: 16, paddingBottom: 100 },
  bidCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  bidHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  bidHeaderLeft: { flexDirection: 'row', gap: 6, alignItems: 'center', flex: 1 },
  bidHeaderRight: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  setAsideBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  setAsideText: { fontSize: 11, fontWeight: '700' as const, color: '#2E7D32', textTransform: 'uppercase' as const },
  openBadge: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  openBadgeText: { fontSize: 11, fontWeight: '700' as const, color: '#1565C0', textTransform: 'uppercase' as const },
  bidTypeBadge: { backgroundColor: Colors.primary + '12', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  bidTypeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.primary, textTransform: 'uppercase' as const },
  trackedBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const },
  countdownBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  countdownText: { fontSize: 11, fontWeight: '600' as const },
  bidTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 4, lineHeight: 22 },
  bidDepartment: { fontSize: 13, color: Colors.textSecondary, marginBottom: 4 },
  bidDescription: { fontSize: 12, color: Colors.textMuted, marginBottom: 8, lineHeight: 17 },
  bidMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  bidFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  distanceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  distanceText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  naicsBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.fillSecondary, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  naicsText: { fontSize: 10, fontWeight: '500' as const, color: Colors.textMuted },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 32 },
  retryButton: { marginTop: 12, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryButtonText: { color: '#FFF', fontWeight: '600' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  dropdownModal: { width: '80%', backgroundColor: Colors.surface, borderRadius: 16, paddingVertical: 8, maxHeight: 400, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 20, elevation: 10 },
  dropdownHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  dropdownTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  dropdownItemActive: { backgroundColor: Colors.primary + '08' },
  dropdownItemText: { fontSize: 15, color: Colors.text, fontWeight: '400' as const },
  dropdownItemTextActive: { color: Colors.primary, fontWeight: '600' as const },
  dropdownCheck: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  myBidsSection: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: Colors.primary + '20' },
  myBidsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  myBidsTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  myBidsTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  myBidsCount: { backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  myBidsCountText: { fontSize: 11, fontWeight: '700' as const, color: '#FFF' },
  statusChipRow: { flexDirection: 'row', marginTop: 10, marginBottom: 8 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: Colors.fillTertiary, marginRight: 6 },
  statusChipText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' as const },
  trackedBidRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 0.5, borderTopColor: Colors.borderLight, gap: 10 },
  trackedBidInfo: { flex: 1, gap: 2 },
  trackedBidTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  trackedBidMeta: { fontSize: 12, color: Colors.textSecondary },
  trackedStatusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  trackedStatusText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'capitalize' as const },
});

```


---

### `app/(tabs)/companies/index.tsx`

```tsx
import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, RefreshControl, Platform, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Star, Navigation, AlertCircle, Phone, Globe, Crosshair, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { US_STATES } from '@/constants/states';

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

const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;

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
        testID={`company-card-${company.id}`}
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

export default function CompaniesScreen() {
  const insets = useSafeAreaInsets();
  const { location } = useUserLocation();
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState<string | undefined>();
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<'all' | 'nearby' | 'state'>('all');
  const [showStateList, setShowStateList] = useState(false);

  const { data: companies, isLoading, refetch, isRefetching, error: companiesQueryError } = useQuery({
    queryKey: ['cached_companies'],
    queryFn: async () => {
      console.log('[Companies] Fetching from cached_companies...');
      const { data, error } = await supabase
        .from('cached_companies')
        .select('*')
        .order('fetched_at', { ascending: false });
      console.log('Companies data:', data?.length, 'Error:', error);
      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }
      return (data ?? []) as CachedCompany[];
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

    if (locationMode === 'nearby' && location && selectedRadius !== null) {
      result = result.filter(c => c.distance === null || c.distance <= selectedRadius);
    }

    if (locationMode === 'state' && selectedState) {
      result = result.filter(c => c.state?.toUpperCase() === selectedState.toUpperCase());
    }

    if (location) {
      result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    }

    return result;
  }, [companiesWithDistance, selectedRadius, selectedSpecialty, location, locationMode, selectedState]);

  const handleCompanyPress = useCallback((_company: CachedCompany) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleLocationModeChange = useCallback((mode: 'all' | 'nearby' | 'state') => {
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
  }, [selectedRadius]);

  const renderCompany = useCallback(({ item }: { item: CompanyWithDistance }) => (
    <CompanyCard company={item} onPress={() => handleCompanyPress(item)} />
  ), [handleCompanyPress]);

  const loading = isLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Companies</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredCompanies.length}</Text>
          </View>
        </View>

        <Text style={styles.filterSectionLabel}>LOCATION</Text>
        <View style={styles.locationRow}>
          <TouchableOpacity
            style={[styles.locationChip, locationMode === 'all' && styles.locationChipActive]}
            onPress={() => handleLocationModeChange('all')}
          >
            <Text style={[styles.locationChipText, locationMode === 'all' && styles.locationChipTextActive]}>All Locations</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.locationChip, locationMode === 'nearby' && styles.locationChipActive]}
            onPress={() => handleLocationModeChange('nearby')}
          >
            <Crosshair size={13} color={locationMode === 'nearby' ? '#FFF' : Colors.textSecondary} />
            <Text style={[styles.locationChipText, locationMode === 'nearby' && styles.locationChipTextActive]}>Near Me</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.locationChip, locationMode === 'state' && styles.locationChipActive]}
            onPress={() => handleLocationModeChange('state')}
          >
            <ChevronDown size={13} color={locationMode === 'state' ? '#FFF' : Colors.textSecondary} />
            <Text style={[styles.locationChipText, locationMode === 'state' && styles.locationChipTextActive]}>
              {selectedState ? selectedState : 'Pick State'}
            </Text>
          </TouchableOpacity>
        </View>

        {locationMode === 'nearby' && (
          <>
            <Text style={[styles.filterSectionLabel, { marginTop: 8 }]}>RADIUS</Text>
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
          </>
        )}

        {locationMode === 'state' && showStateList && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.chipRow, { marginTop: 8 }]}>
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

      {companiesQueryError ? (
        <View style={styles.loadingContainer}>
          <AlertCircle size={40} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Query Error</Text>
          <Text style={styles.emptySubtitle}>{companiesQueryError.message}</Text>
          <TouchableOpacity onPress={() => { void refetch(); }} style={{ marginTop: 12, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 }}>
            <Text style={{ color: '#FFF', fontWeight: '600' as const }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.loadingContainer}>
          <ConstructionLoader size="lg" label="Loading companies..." />
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
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 8 },
  headerTitle: { fontSize: 28, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: '#2E7D32' },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  locationRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  locationChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background },
  locationChipActive: { backgroundColor: Colors.primary },
  locationChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  locationChipTextActive: { color: '#FFF' },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  stateChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
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

```


---

### `app/(tabs)/hire/index.tsx`

```tsx
import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, RefreshControl, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, DollarSign, Navigation, AlertCircle, Briefcase, Crosshair, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { US_STATES } from '@/constants/states';

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

const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;

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
        testID={`job-card-${job.id}`}
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

export default function HireScreen() {
  const insets = useSafeAreaInsets();
  const { location } = useUserLocation();
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<string | undefined>();
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<'all' | 'nearby' | 'state'>('all');
  const [showStateList, setShowStateList] = useState(false);

  const { data: jobs, isLoading, refetch, isRefetching, error: jobsQueryError } = useQuery({
    queryKey: ['cached_jobs'],
    queryFn: async () => {
      console.log('[Hire] Fetching from cached_jobs...');
      const { data, error } = await supabase
        .from('cached_jobs')
        .select('*')
        .order('fetched_at', { ascending: false });
      console.log('Jobs data:', data?.length, 'Error:', error);
      if (error) {
        throw new Error(`Supabase error: ${error.message}`);
      }
      return (data ?? []) as CachedJob[];
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

    if (locationMode === 'nearby' && location && selectedRadius !== null) {
      result = result.filter(j => j.distance === null || j.distance <= selectedRadius);
    }

    if (locationMode === 'state' && selectedState) {
      result = result.filter(j => j.state?.toUpperCase() === selectedState.toUpperCase());
    }

    if (location) {
      result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    }

    return result;
  }, [jobsWithDistance, selectedRadius, selectedTrade, location, locationMode, selectedState]);

  const handleJobPress = useCallback((job: CachedJob) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (job.apply_url) {
      Linking.openURL(job.apply_url).catch(() => {
        console.log('[Hire] Failed to open URL:', job.apply_url);
      });
    }
  }, []);

  const handleLocationModeChange = useCallback((mode: 'all' | 'nearby' | 'state') => {
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
  }, [selectedRadius]);

  const renderJob = useCallback(({ item }: { item: JobWithDistance }) => (
    <JobCard job={item} onPress={() => handleJobPress(item)} />
  ), [handleJobPress]);

  const loading = isLoading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.headerTitle}>Direct Hire</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{filteredJobs.length}</Text>
          </View>
        </View>

        <Text style={styles.filterSectionLabel}>LOCATION</Text>
        <View style={styles.locationRow}>
          <TouchableOpacity
            style={[styles.locationChip, locationMode === 'all' && styles.locationChipActive]}
            onPress={() => handleLocationModeChange('all')}
          >
            <Text style={[styles.locationChipText, locationMode === 'all' && styles.locationChipTextActive]}>All Locations</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.locationChip, locationMode === 'nearby' && styles.locationChipActive]}
            onPress={() => handleLocationModeChange('nearby')}
          >
            <Crosshair size={13} color={locationMode === 'nearby' ? '#FFF' : Colors.textSecondary} />
            <Text style={[styles.locationChipText, locationMode === 'nearby' && styles.locationChipTextActive]}>Near Me</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.locationChip, locationMode === 'state' && styles.locationChipActive]}
            onPress={() => handleLocationModeChange('state')}
          >
            <ChevronDown size={13} color={locationMode === 'state' ? '#FFF' : Colors.textSecondary} />
            <Text style={[styles.locationChipText, locationMode === 'state' && styles.locationChipTextActive]}>
              {selectedState ? selectedState : 'Pick State'}
            </Text>
          </TouchableOpacity>
        </View>

        {locationMode === 'nearby' && (
          <>
            <Text style={[styles.filterSectionLabel, { marginTop: 8 }]}>RADIUS</Text>
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
          </>
        )}

        {locationMode === 'state' && showStateList && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.chipRow, { marginTop: 8 }]}>
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

      {jobsQueryError ? (
        <View style={styles.loadingContainer}>
          <AlertCircle size={40} color="#D32F2F" />
          <Text style={styles.emptyTitle}>Query Error</Text>
          <Text style={styles.emptySubtitle}>{jobsQueryError.message}</Text>
          <TouchableOpacity onPress={() => { void refetch(); }} style={{ marginTop: 12, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 }}>
            <Text style={{ color: '#FFF', fontWeight: '600' as const }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.loadingContainer}>
          <ConstructionLoader size="lg" label="Loading jobs..." />
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
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 8 },
  headerTitle: { fontSize: 28, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  countPill: { backgroundColor: Colors.accent + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countPillText: { fontSize: 13, fontWeight: '700' as const, color: Colors.accent },
  filterSectionLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  locationRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  locationChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background },
  locationChipActive: { backgroundColor: Colors.primary },
  locationChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  locationChipTextActive: { color: '#FFF' },
  chipRow: { flexDirection: 'row', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  stateChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: Colors.background, marginRight: 6 },
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

```


---

### `app/(tabs)/subs/index.tsx`

```tsx
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal,
  Alert, Platform, ScrollView, KeyboardAvoidingView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plus, Search, X, Phone, Mail, MapPin, Shield, FileText,
  AlertTriangle, CheckCircle, Clock, Trash2, Users,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import AISubEvaluator from '@/components/AISubEvaluator';
import type { Subcontractor, SubTrade, ComplianceStatus } from '@/types';
import { SUB_TRADES } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getComplianceStatus(sub: Subcontractor): ComplianceStatus {
  const now = new Date();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const licExpiry = sub.licenseExpiry ? new Date(sub.licenseExpiry) : null;
  const coiExpiry = sub.coiExpiry ? new Date(sub.coiExpiry) : null;

  if ((licExpiry && licExpiry < now) || (coiExpiry && coiExpiry < now)) return 'expired';
  if ((licExpiry && licExpiry.getTime() - now.getTime() < thirtyDays) ||
      (coiExpiry && coiExpiry.getTime() - now.getTime() < thirtyDays)) return 'expiring_soon';
  return 'compliant';
}

function getStatusColor(status: ComplianceStatus): string {
  if (status === 'compliant') return Colors.success;
  if (status === 'expiring_soon') return Colors.warning;
  return Colors.error;
}

function getStatusLabel(status: ComplianceStatus): string {
  if (status === 'compliant') return 'Compliant';
  if (status === 'expiring_soon') return 'Expiring Soon';
  return 'Expired';
}

export default function SubsScreen() {
  const insets = useSafeAreaInsets();
  const { subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, projects } = useProjects();
  const { tier } = useSubscription();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTrade, setFilterTrade] = useState<SubTrade | 'All'>('All');
  const [showForm, setShowForm] = useState(false);
  const [editingSub, setEditingSub] = useState<Subcontractor | null>(null);
  const [showDetail, setShowDetail] = useState<Subcontractor | null>(null);

  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [trade, setTrade] = useState<SubTrade>('General');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [coiExpiry, setCoiExpiry] = useState('');
  const [w9OnFile, setW9OnFile] = useState(false);
  const [notes, setNotes] = useState('');

  const resetForm = useCallback(() => {
    setCompanyName(''); setContactName(''); setPhone(''); setEmail('');
    setAddress(''); setTrade('General'); setLicenseNumber('');
    setLicenseExpiry(''); setCoiExpiry(''); setW9OnFile(false); setNotes('');
    setEditingSub(null);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((sub: Subcontractor) => {
    setEditingSub(sub);
    setCompanyName(sub.companyName);
    setContactName(sub.contactName);
    setPhone(sub.phone);
    setEmail(sub.email);
    setAddress(sub.address);
    setTrade(sub.trade);
    setLicenseNumber(sub.licenseNumber);
    setLicenseExpiry(sub.licenseExpiry);
    setCoiExpiry(sub.coiExpiry);
    setW9OnFile(sub.w9OnFile);
    setNotes(sub.notes);
    setShowForm(true);
    setShowDetail(null);
  }, []);

  const handleSave = useCallback(() => {
    const name = companyName.trim();
    if (!name) {
      Alert.alert('Missing Name', 'Please enter the company name.');
      return;
    }

    if (editingSub) {
      updateSubcontractor(editingSub.id, {
        companyName: name, contactName: contactName.trim(), phone: phone.trim(),
        email: email.trim(), address: address.trim(), trade, licenseNumber: licenseNumber.trim(),
        licenseExpiry, coiExpiry, w9OnFile, notes: notes.trim(),
      });
      Alert.alert('Updated', `${name} has been updated.`);
    } else {
      const sub: Subcontractor = {
        id: createId('sub'), companyName: name, contactName: contactName.trim(),
        phone: phone.trim(), email: email.trim(), address: address.trim(), trade,
        licenseNumber: licenseNumber.trim(), licenseExpiry, coiExpiry, w9OnFile,
        bidHistory: [], assignedProjects: [], notes: notes.trim(),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      addSubcontractor(sub);
      Alert.alert('Added', `${name} has been added.`);
    }

    setShowForm(false);
    resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [companyName, contactName, phone, email, address, trade, licenseNumber, licenseExpiry, coiExpiry, w9OnFile, notes, editingSub, addSubcontractor, updateSubcontractor, resetForm]);

  const handleDelete = useCallback((sub: Subcontractor) => {
    Alert.alert('Delete Subcontractor', `Delete ${sub.companyName}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          deleteSubcontractor(sub.id);
          setShowDetail(null);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  }, [deleteSubcontractor]);

  const filtered = useMemo(() => {
    let result = subcontractors;
    if (filterTrade !== 'All') result = result.filter(s => s.trade === filterTrade);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.companyName.toLowerCase().includes(q) ||
        s.contactName.toLowerCase().includes(q) ||
        s.trade.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [subcontractors, filterTrade, searchQuery]);

  const stats = useMemo(() => {
    const compliant = subcontractors.filter(s => getComplianceStatus(s) === 'compliant').length;
    const expiring = subcontractors.filter(s => getComplianceStatus(s) === 'expiring_soon').length;
    const expired = subcontractors.filter(s => getComplianceStatus(s) === 'expired').length;
    return { compliant, expiring, expired, total: subcontractors.length };
  }, [subcontractors]);

  const renderSub = useCallback(({ item }: { item: Subcontractor }) => {
    const status = getComplianceStatus(item);
    const statusColor = getStatusColor(status);
    return (
      <TouchableOpacity
        style={styles.subCard}
        onPress={() => setShowDetail(item)}
        activeOpacity={0.7}
        testID={`sub-${item.id}`}
      >
        <View style={styles.subCardTop}>
          <View style={[styles.tradeIcon, { backgroundColor: statusColor + '15' }]}>
            <Users size={16} color={statusColor} />
          </View>
          <View style={styles.subCardInfo}>
            <Text style={styles.subName}>{item.companyName}</Text>
            <Text style={styles.subContact}>{item.contactName} · {item.trade}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{getStatusLabel(status)}</Text>
          </View>
        </View>
        {item.phone || item.email ? (
          <View style={styles.subCardMeta}>
            {item.phone ? (
              <View style={styles.metaItem}>
                <Phone size={11} color={Colors.textMuted} />
                <Text style={styles.metaText}>{item.phone}</Text>
              </View>
            ) : null}
            {item.email ? (
              <View style={styles.metaItem}>
                <Mail size={11} color={Colors.textMuted} />
                <Text style={styles.metaText} numberOfLines={1}>{item.email}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }, []);

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        renderItem={renderSub}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View style={styles.headerRow}>
              <Text style={styles.largeTitle}>Subs</Text>
              <TouchableOpacity style={styles.addBtn} onPress={openCreate} activeOpacity={0.7} testID="add-sub">
                <Plus size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            {stats.total > 0 && (
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { borderLeftColor: Colors.success }]}>
                  <Text style={[styles.statNum, { color: Colors.success }]}>{stats.compliant}</Text>
                  <Text style={styles.statLabel}>Compliant</Text>
                </View>
                <View style={[styles.statCard, { borderLeftColor: Colors.warning }]}>
                  <Text style={[styles.statNum, { color: Colors.warning }]}>{stats.expiring}</Text>
                  <Text style={styles.statLabel}>Expiring</Text>
                </View>
                <View style={[styles.statCard, { borderLeftColor: Colors.error }]}>
                  <Text style={[styles.statNum, { color: Colors.error }]}>{stats.expired}</Text>
                  <Text style={styles.statLabel}>Expired</Text>
                </View>
              </View>
            )}

            <View style={styles.searchWrap}>
              <View style={styles.searchBar}>
                <Search size={15} color={Colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search subcontractors..."
                  placeholderTextColor={Colors.textMuted}
                  testID="subs-search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <View style={styles.clearBtn}><X size={10} color={Colors.textMuted} /></View>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterChip, filterTrade === 'All' && styles.filterChipActive]}
                onPress={() => setFilterTrade('All')}
              >
                <Text style={[styles.filterChipText, filterTrade === 'All' && styles.filterChipTextActive]}>All ({stats.total})</Text>
              </TouchableOpacity>
              {SUB_TRADES.map(t => {
                const count = subcontractors.filter(s => s.trade === t).length;
                if (count === 0) return null;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.filterChip, filterTrade === t && styles.filterChipActive]}
                    onPress={() => setFilterTrade(t)}
                  >
                    <Text style={[styles.filterChipText, filterTrade === t && styles.filterChipTextActive]}>{t} ({count})</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Users size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>{searchQuery ? 'No Results' : 'No Subcontractors'}</Text>
            <Text style={styles.emptyDesc}>
              {searchQuery ? 'Try a different search.' : 'Add your first subcontractor to start tracking compliance.'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity style={styles.emptyBtn} onPress={openCreate} activeOpacity={0.7}>
                <Plus size={16} color="#fff" />
                <Text style={styles.emptyBtnText}>Add Subcontractor</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editingSub ? 'Edit Subcontractor' : 'Add Subcontractor'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }}>
                    <X size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Company Name *</Text>
                <TextInput style={styles.input} value={companyName} onChangeText={setCompanyName} placeholder="Company name" placeholderTextColor={Colors.textMuted} testID="sub-company-input" />

                <Text style={styles.fieldLabel}>Contact Name</Text>
                <TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder="Primary contact" placeholderTextColor={Colors.textMuted} />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Phone</Text>
                    <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Email</Text>
                    <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="email@co.com" placeholderTextColor={Colors.textMuted} keyboardType="email-address" autoCapitalize="none" />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Address</Text>
                <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Street, City, State" placeholderTextColor={Colors.textMuted} />

                <Text style={styles.fieldLabel}>Trade Specialty</Text>
                <View style={styles.tradeGrid}>
                  {SUB_TRADES.map(t => (
                    <TouchableOpacity key={t} style={[styles.tradeChip, trade === t && styles.tradeChipActive]} onPress={() => setTrade(t)}>
                      <Text style={[styles.tradeChipText, trade === t && styles.tradeChipTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.sectionDivider}>COMPLIANCE</Text>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>License #</Text>
                    <TextInput style={styles.input} value={licenseNumber} onChangeText={setLicenseNumber} placeholder="GC-12345" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>License Expiry</Text>
                    <TextInput style={styles.input} value={licenseExpiry} onChangeText={setLicenseExpiry} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>COI Expiry</Text>
                    <TextInput style={styles.input} value={coiExpiry} onChangeText={setCoiExpiry} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                    <Text style={styles.fieldLabel}>W-9 On File</Text>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>{w9OnFile ? 'Yes' : 'No'}</Text>
                      <Switch value={w9OnFile} onValueChange={setW9OnFile} trackColor={{ false: Colors.border, true: Colors.primary }} thumbColor={Colors.surface} />
                    </View>
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput style={[styles.input, { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' as const }]} value={notes} onChangeText={setNotes} placeholder="Additional notes..." placeholderTextColor={Colors.textMuted} multiline />

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-sub">
                    <Text style={styles.saveBtnText}>{editingSub ? 'Update' : 'Add Subcontractor'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showDetail !== null} transparent animationType="slide" onRequestClose={() => setShowDetail(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.detailCard, { paddingBottom: insets.bottom + 20 }]}>
            {showDetail && (() => {
              const sub = showDetail;
              const status = getComplianceStatus(sub);
              const statusColor = getStatusColor(status);
              return (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={styles.formHeader}>
                    <Text style={styles.formTitle}>{sub.companyName}</Text>
                    <TouchableOpacity onPress={() => setShowDetail(null)}>
                      <X size={20} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.detailStatusBar, { backgroundColor: statusColor + '12', borderLeftColor: statusColor }]}>
                    {status === 'compliant' ? <CheckCircle size={16} color={statusColor} /> : status === 'expiring_soon' ? <Clock size={16} color={statusColor} /> : <AlertTriangle size={16} color={statusColor} />}
                    <Text style={[styles.detailStatusText, { color: statusColor }]}>{getStatusLabel(status)}</Text>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>CONTACT</Text>
                    {sub.contactName ? <View style={styles.detailRow}><Users size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>{sub.contactName}</Text></View> : null}
                    {sub.phone ? <View style={styles.detailRow}><Phone size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>{sub.phone}</Text></View> : null}
                    {sub.email ? <View style={styles.detailRow}><Mail size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>{sub.email}</Text></View> : null}
                    {sub.address ? <View style={styles.detailRow}><MapPin size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>{sub.address}</Text></View> : null}
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>COMPLIANCE</Text>
                    <View style={styles.detailRow}><Shield size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>License: {sub.licenseNumber || 'Not set'}</Text></View>
                    <View style={styles.detailRow}><FileText size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>License Expiry: {sub.licenseExpiry || 'Not set'}</Text></View>
                    <View style={styles.detailRow}><FileText size={14} color={Colors.textMuted} /><Text style={styles.detailRowText}>COI Expiry: {sub.coiExpiry || 'Not set'}</Text></View>
                    <View style={styles.detailRow}><CheckCircle size={14} color={sub.w9OnFile ? Colors.success : Colors.textMuted} /><Text style={styles.detailRowText}>W-9: {sub.w9OnFile ? 'On File' : 'Missing'}</Text></View>
                  </View>

                  {sub.bidHistory.length > 0 && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>BID HISTORY</Text>
                      {sub.bidHistory.map(bid => (
                        <View key={bid.id} style={styles.bidRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.bidProject}>{bid.projectName}</Text>
                            <Text style={styles.bidDate}>{new Date(bid.date).toLocaleDateString()}</Text>
                          </View>
                          <Text style={styles.bidAmount}>${bid.bidAmount.toLocaleString()}</Text>
                          <View style={[styles.bidOutcome, { backgroundColor: bid.outcome === 'won' ? Colors.successLight : bid.outcome === 'lost' ? Colors.errorLight : Colors.warningLight }]}>
                            <Text style={[styles.bidOutcomeText, { color: bid.outcome === 'won' ? Colors.success : bid.outcome === 'lost' ? Colors.error : Colors.warning }]}>
                              {bid.outcome.charAt(0).toUpperCase() + bid.outcome.slice(1)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {sub.notes ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>NOTES</Text>
                      <Text style={styles.detailNotes}>{sub.notes}</Text>
                    </View>
                  ) : null}

                  <AISubEvaluator
                    sub={sub}
                    projectContext={`Active projects: ${projects.length}. Trades needed: ${[...new Set(projects.flatMap(p => p.schedule?.tasks?.map(t => t.crew) ?? []).filter(Boolean))].join(', ') || 'Various'}`}
                    subscriptionTier={tier as any}
                  />

                  <View style={styles.detailActions}>
                    <TouchableOpacity style={styles.editDetailBtn} onPress={() => openEdit(sub)} activeOpacity={0.7}>
                      <Text style={styles.editDetailBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteDetailBtn} onPress={() => handleDelete(sub)} activeOpacity={0.7}>
                      <Trash2 size={16} color={Colors.error} />
                      <Text style={styles.deleteDetailBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 4, marginBottom: 16 },
  largeTitle: { fontSize: 34, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5 },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderLeftWidth: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  statNum: { fontSize: 24, fontWeight: '800' as const },
  statLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, marginTop: 2 },
  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary, borderRadius: 12, paddingHorizontal: 12, gap: 8, height: 40 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  clearBtn: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  filterRow: { paddingHorizontal: 16, gap: 6, marginBottom: 16 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.fillTertiary },
  filterChipActive: { backgroundColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff' },
  subCard: { marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  subCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tradeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  subCardInfo: { flex: 1, gap: 2 },
  subName: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  subContact: { fontSize: 13, color: Colors.textSecondary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  subCardMeta: { flexDirection: 'row', gap: 16, paddingLeft: 52 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 22 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  formCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8, maxHeight: '90%' },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  tradeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tradeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  tradeChipActive: { backgroundColor: Colors.primary },
  tradeChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  tradeChipTextActive: { color: '#fff' },
  sectionDivider: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 14, backgroundColor: Colors.surfaceAlt, borderRadius: 12 },
  switchLabel: { fontSize: 15, color: Colors.text },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#fff' },
  detailCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, maxHeight: '85%' },
  detailStatusBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, borderLeftWidth: 3, marginBottom: 16 },
  detailStatusText: { fontSize: 14, fontWeight: '700' as const },
  detailSection: { marginBottom: 20, gap: 8 },
  detailSectionTitle: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailRowText: { fontSize: 15, color: Colors.text },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  bidProject: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  bidDate: { fontSize: 12, color: Colors.textMuted },
  bidAmount: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  bidOutcome: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  bidOutcomeText: { fontSize: 10, fontWeight: '700' as const },
  detailNotes: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editDetailBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  editDetailBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#fff' },
  deleteDetailBtn: { flexDirection: 'row', minHeight: 48, paddingHorizontal: 20, borderRadius: 14, backgroundColor: Colors.errorLight, alignItems: 'center', justifyContent: 'center', gap: 6 },
  deleteDetailBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.error },
});

```


---

### `app/bid-detail.tsx`

```tsx
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert, Platform,
} from 'react-native';
import ConstructionLoader from '@/components/ConstructionLoader';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, Clock, DollarSign, Shield, ExternalLink, Mail, Building2, ChevronRight, Globe, Heart, Bookmark, Phone, FileText, Tag, Calendar, Users, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import { useBids } from '@/contexts/BidsContext';
import { useCompanies } from '@/contexts/CompaniesContext';
import { CERTIFICATIONS, CERT_COLORS } from '@/constants/certifications';
import { supabase } from '@/lib/supabase';
import AIBidScorecard from '@/components/AIBidScorecard';
import type { PublicBid } from '@/types';

const TRACKED_BIDS_KEY = 'mageid_tracked_bids';

interface TrackedBid {
  bidId: string;
  status: 'saved' | 'interested' | 'preparing' | 'submitted' | 'won' | 'lost';
  notes: string;
  proposalAmount: number | null;
  savedAt: string;
}

interface CachedBidDetail {
  id: string;
  title: string;
  department?: string;
  deadline: string;
  estimated_value: number;
  city: string;
  state: string;
  source_url?: string;
  set_aside?: string;
  description?: string;
  bid_type?: string;
  category?: string;
  bond_required?: number;
  contact_email?: string;
  contact_phone?: string;
  apply_url?: string;
  source_name?: string;
  posted_by?: string;
  posted_date?: string;
  naics_code?: string;
  solicitation_number?: string;
  pre_bid_date?: string;
  pre_bid_location?: string;
  scope_of_work?: string;
  documents_url?: string;
  required_certifications?: string[];
}

const BID_TYPE_LABELS: Record<string, string> = {
  federal: 'Federal', state: 'State', municipal: 'Municipal', county: 'County', private: 'Private',
};
const BID_CATEGORY_LABELS: Record<string, string> = {
  construction: 'Construction', it_services: 'IT Services', environmental: 'Environmental',
  energy: 'Energy', infrastructure: 'Infrastructure', transportation: 'Transportation',
  utilities: 'Utilities', healthcare: 'Healthcare', education: 'Education', residential: 'Residential',
};

const TRACKING_STATUSES = ['saved', 'interested', 'preparing', 'submitted', 'won', 'lost'] as const;
const STATUS_LABELS: Record<string, string> = {
  saved: 'Saved', interested: 'Interested', preparing: 'Preparing Proposal', submitted: 'Submitted', won: 'Won', lost: 'Lost',
};
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  saved: { bg: '#E3F2FD', text: '#1565C0' },
  interested: { bg: '#FFF3E0', text: '#E65100' },
  preparing: { bg: '#F3E5F5', text: '#7B1FA2' },
  submitted: { bg: '#E8F5E9', text: '#2E7D32' },
  won: { bg: '#E8F5E9', text: '#1B5E20' },
  lost: { bg: '#FFEBEE', text: '#C62828' },
};

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return 'Not specified';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateStr; }
}

function getCountdown(deadline: string | null | undefined): { text: string; urgent: boolean } {
  if (!deadline) return { text: 'No deadline', urgent: false };
  const diff = new Date(deadline).getTime() - Date.now();
  if (isNaN(diff)) return { text: 'No deadline', urgent: false };
  if (diff <= 0) return { text: 'Expired', urgent: true };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 30) return { text: `${Math.floor(days / 30)} months left`, urgent: false };
  if (days > 0) return { text: `${days} days left`, urgent: days <= 7 };
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return { text: `${hours} hours left`, urgent: true };
}

export default function BidDetailScreen() {
  const layout = useResponsiveLayout();
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const router = useRouter();
  const { bids: localBids } = useBids();
  const { companies } = useCompanies();
  const [trackedBid, setTrackedBid] = useState<TrackedBid | null>(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  const { data: cachedBid, isLoading: cachedLoading } = useQuery({
    queryKey: ['cached_bid_detail', id],
    queryFn: async () => {
      if (source !== 'cached') return null;
      console.log('[BidDetail] Fetching cached bid:', id);
      const { data, error } = await supabase
        .from('cached_bids')
        .select('*')
        .eq('id', id)
        .single();
      if (error) {
        console.log('[BidDetail] Supabase error:', error.message);
        return null;
      }
      return data as CachedBidDetail;
    },
    enabled: source === 'cached' && !!id,
  });

  const localBid = useMemo(() => {
    if (source === 'cached') return null;
    return localBids.find(b => b.id === id) ?? null;
  }, [localBids, id, source]);

  useEffect(() => {
    AsyncStorage.getItem(TRACKED_BIDS_KEY).then(data => {
      if (data) {
        try {
          const tracked = JSON.parse(data) as TrackedBid[];
          const found = tracked.find(t => t.bidId === id);
          if (found) setTrackedBid(found);
        } catch { /* ignore */ }
      }
    }).catch(() => {});
  }, [id]);

  const saveTracking = useCallback(async (status: TrackedBid['status'] | null) => {
    try {
      const raw = await AsyncStorage.getItem(TRACKED_BIDS_KEY);
      let tracked: TrackedBid[] = raw ? JSON.parse(raw) : [];

      if (status === null) {
        tracked = tracked.filter(t => t.bidId !== id);
        setTrackedBid(null);
      } else {
        const existing = tracked.find(t => t.bidId === id);
        if (existing) {
          existing.status = status;
          setTrackedBid({ ...existing });
        } else {
          const newTracked: TrackedBid = {
            bidId: id ?? '',
            status,
            notes: '',
            proposalAmount: null,
            savedAt: new Date().toISOString(),
          };
          tracked.push(newTracked);
          setTrackedBid(newTracked);
        }
      }

      await AsyncStorage.setItem(TRACKED_BIDS_KEY, JSON.stringify(tracked));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[BidDetail] Save tracking error:', err);
    }
  }, [id]);

  const handleToggleSave = useCallback(() => {
    if (trackedBid) {
      Alert.alert('Remove Bid', 'Remove this bid from your tracked bids?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void saveTracking(null) },
      ]);
    } else {
      void saveTracking('saved');
    }
  }, [trackedBid, saveTracking]);

  const handleStatusSelect = useCallback((status: TrackedBid['status']) => {
    void saveTracking(status);
    setShowStatusPicker(false);
  }, [saveTracking]);

  const title = cachedBid?.title ?? localBid?.title ?? 'Bid Details';
  const description = cachedBid?.description ?? localBid?.description ?? '';
  const city = cachedBid?.city ?? localBid?.city ?? '';
  const state = cachedBid?.state ?? localBid?.state ?? '';
  const estimatedValue = cachedBid?.estimated_value ?? localBid?.estimatedValue ?? 0;
  const bondRequired = cachedBid?.bond_required ?? localBid?.bondRequired ?? 0;
  const deadline = cachedBid?.deadline ?? localBid?.deadline ?? '';
  const bidType = cachedBid?.bid_type ?? localBid?.bidType ?? '';
  const category = cachedBid?.category ?? localBid?.category ?? '';
  const contactEmail = cachedBid?.contact_email ?? localBid?.contactEmail ?? '';
  const contactPhone = cachedBid?.contact_phone ?? '';
  const applyUrl = cachedBid?.apply_url ?? localBid?.applyUrl ?? '';
  const sourceUrl = cachedBid?.source_url ?? localBid?.sourceUrl ?? '';
  const sourceName = cachedBid?.source_name ?? localBid?.sourceName ?? '';
  const postedBy = cachedBid?.posted_by ?? localBid?.postedBy ?? '';
  const postedDate = cachedBid?.posted_date ?? localBid?.postedDate ?? '';
  const department = cachedBid?.department ?? (localBid as PublicBid | null)?.issuingAgency ?? '';
  const naicsCode = cachedBid?.naics_code ?? '';
  const solicitationNumber = cachedBid?.solicitation_number ?? '';
  const preBidDate = cachedBid?.pre_bid_date ?? '';
  const scopeOfWork = cachedBid?.scope_of_work ?? '';
  const documentsUrl = cachedBid?.documents_url ?? '';
  const requiredCerts = useMemo(() => cachedBid?.required_certifications ?? localBid?.requiredCertifications ?? [], [cachedBid?.required_certifications, localBid?.requiredCertifications]);
  const setAside = cachedBid?.set_aside ?? '';

  const countdown = getCountdown(deadline);

  const qualifiedCompanies = useMemo(() => {
    return companies.filter(c => {
      const meetsCapacity = bondRequired > 0 ? c.bondCapacity >= bondRequired : true;
      const meetsCerts = requiredCerts.length === 0 ||
        requiredCerts.some(cert => c.certifications.includes(cert as any));
      return meetsCapacity && meetsCerts;
    });
  }, [companies, bondRequired, requiredCerts]);

  const isLoading = source === 'cached' && cachedLoading;
  const bidNotFound = !isLoading && !cachedBid && !localBid;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Bid Details' }} />
        <View style={styles.centerContainer}>
          <ConstructionLoader size="lg" label="Loading bid details..." />
        </View>
      </View>
    );
  }

  if (bidNotFound) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Bid Details' }} />
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Bid not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Bid Details',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, layout.isDesktop && { maxWidth: 1200, alignSelf: 'center' as const, width: '100%' as any }]} showsVerticalScrollIndicator={false}>
        {layout.isDesktop ? (
          <View style={bidDesktopStyles.twoCol}>
            <View style={bidDesktopStyles.mainCol}>
              <View style={styles.topCard}>
                <View style={styles.topRow}>
                  <View style={styles.topBadges}>
                    {bidType ? <View style={[styles.typeBadge, { backgroundColor: Colors.primary + '15' }]}><Text style={[styles.typeBadgeText, { color: Colors.primary }]}>{BID_TYPE_LABELS[bidType] ?? bidType}</Text></View> : null}
                    {setAside ? <View style={[styles.typeBadge, { backgroundColor: '#E8F5E9' }]}><Text style={[styles.typeBadgeText, { color: '#2E7D32' }]}>{setAside}</Text></View> : null}
                  </View>
                </View>
                <Text style={styles.bidTitle}>{title}</Text>
                {department ? <Text style={styles.agency}>{department}</Text> : null}
                {(city || state) ? <View style={styles.locationRow}><MapPin size={14} color={Colors.textSecondary} /><Text style={styles.locationText}>{[city, state].filter(Boolean).join(', ')}</Text></View> : null}
              </View>
              {description ? <View style={styles.section}><Text style={styles.sectionTitle}>Description</Text><Text style={styles.description}>{description}</Text></View> : null}
              {scopeOfWork ? <View style={styles.section}><Text style={styles.sectionTitle}>Scope of Work</Text><Text style={styles.description}>{scopeOfWork}</Text></View> : null}
              {requiredCerts.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Required Certifications</Text>
                  <View style={styles.certGrid}>
                    {requiredCerts.map((certId, idx) => {
                      const info = CERTIFICATIONS.find(c => c.id === certId);
                      const color = CERT_COLORS[certId] || Colors.primary;
                      return <View key={`${certId}-${idx}`} style={[styles.certCard, { borderLeftColor: color }]}><Text style={[styles.certShort, { color }]}>{info?.shortLabel ?? certId}</Text><Text style={styles.certFull} numberOfLines={2}>{info?.label ?? certId}</Text></View>;
                    })}
                  </View>
                </View>
              )}
              <View style={styles.section}>
                <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Qualified Companies</Text><View style={styles.countBadge}><Text style={styles.countText}>{qualifiedCompanies.length}</Text></View></View>
                {qualifiedCompanies.length === 0 ? <Text style={styles.noResults}>No companies match</Text> : qualifiedCompanies.slice(0, 5).map(company => (
                  <TouchableOpacity key={company.id} style={styles.companyRow} onPress={() => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/company-detail' as any, params: { id: company.id } }); }}>
                    <View style={styles.companyInfo}><Text style={styles.companyName}>{company.companyName}</Text><Text style={styles.companyMeta}>{company.city}, {company.state}</Text></View>
                    <ChevronRight size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={bidDesktopStyles.sideCol}>
              {trackedBid && <View style={[styles.statusBadgeLarge, { backgroundColor: STATUS_COLORS[trackedBid.status]?.bg ?? '#E3F2FD', marginBottom: 12 }]}><Text style={[styles.statusBadgeLargeText, { color: STATUS_COLORS[trackedBid.status]?.text ?? '#1565C0' }]}>{STATUS_LABELS[trackedBid.status]}</Text></View>}
              <View style={[styles.statsGrid, { padding: 0, flexDirection: 'column' as const }]}>
                <View style={[styles.statCard, { width: '100%' as any }]}><DollarSign size={18} color={Colors.primary} /><Text style={styles.statLabel}>Estimated Value</Text><Text style={styles.statValue}>{formatCurrency(estimatedValue)}</Text></View>
                <View style={[styles.statCard, { width: '100%' as any }]}><Clock size={18} color={countdown.urgent ? '#FF3B30' : Colors.textSecondary} /><Text style={styles.statLabel}>Deadline</Text><Text style={[styles.statValue, countdown.urgent && { color: '#FF3B30' }]}>{countdown.text}</Text><Text style={styles.statSub}>{formatDate(deadline)}</Text></View>
                <View style={[styles.statCard, { width: '100%' as any }]}><Shield size={18} color={Colors.accent} /><Text style={styles.statLabel}>Bond Required</Text><Text style={styles.statValue}>{formatCurrency(bondRequired)}</Text></View>
              </View>
              {(contactEmail || contactPhone) ? (
                <View style={[styles.contactCard, { marginTop: 12 }]}>
                  {postedBy ? <Text style={styles.postedLabel}>Posted by: {postedBy}</Text> : null}
                  <View style={styles.contactActions}>
                    {contactEmail ? <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(`mailto:${contactEmail}`)}><Mail size={16} color="#FFF" /><Text style={styles.contactBtnText}>Email</Text></TouchableOpacity> : null}
                    {contactPhone ? <TouchableOpacity style={[styles.contactBtn, { backgroundColor: Colors.success }]} onPress={() => void Linking.openURL(`tel:${contactPhone}`)}><Phone size={16} color="#FFF" /><Text style={styles.contactBtnText}>Call</Text></TouchableOpacity> : null}
                  </View>
                  {sourceUrl ? <TouchableOpacity style={styles.sourceLink} onPress={() => void Linking.openURL(sourceUrl)}><Globe size={14} color={Colors.primary} /><Text style={styles.sourceLinkText}>{sourceName || 'View on Portal'}</Text><ExternalLink size={12} color={Colors.primary} /></TouchableOpacity> : null}
                </View>
              ) : null}
              <View style={[styles.contactActions, { marginTop: 12, flexDirection: 'column' as const, gap: 8 }]}>
                <TouchableOpacity style={[styles.actionBtn, trackedBid ? styles.actionBtnSaved : styles.actionBtnOutline, { width: '100%' as any, justifyContent: 'center' as const }]} onPress={handleToggleSave} activeOpacity={0.8}>
                  <Heart size={18} color={trackedBid ? '#FFF' : Colors.primary} fill={trackedBid ? '#FFF' : 'none'} />
                  <Text style={[styles.actionBtnText, trackedBid ? styles.actionBtnTextSaved : styles.actionBtnTextOutline]}>{trackedBid ? 'Saved' : 'Save Bid'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnTrack, { width: '100%' as any }]} onPress={() => setShowStatusPicker(true)} activeOpacity={0.8}>
                  <Bookmark size={18} color="#FFF" />
                  <Text style={styles.actionBtnTextWhite}>{trackedBid ? STATUS_LABELS[trackedBid.status] : 'Track Status'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <>
        <View style={styles.topCard}>
          <View style={styles.topRow}>
            <View style={styles.topBadges}>
              {bidType ? (
                <View style={[styles.typeBadge, { backgroundColor: Colors.primary + '15' }]}>
                  <Text style={[styles.typeBadgeText, { color: Colors.primary }]}>{BID_TYPE_LABELS[bidType] ?? bidType}</Text>
                </View>
              ) : null}
              {setAside ? (
                <View style={[styles.typeBadge, { backgroundColor: '#E8F5E9' }]}>
                  <Text style={[styles.typeBadgeText, { color: '#2E7D32' }]}>{setAside}</Text>
                </View>
              ) : null}
            </View>
            {trackedBid && (
              <View style={[styles.statusBadgeLarge, { backgroundColor: STATUS_COLORS[trackedBid.status]?.bg ?? '#E3F2FD' }]}>
                <Text style={[styles.statusBadgeLargeText, { color: STATUS_COLORS[trackedBid.status]?.text ?? '#1565C0' }]}>
                  {STATUS_LABELS[trackedBid.status]}
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.bidTitle}>{title}</Text>
          {department ? <Text style={styles.agency}>{department}</Text> : null}

          {(city || state) ? (
            <View style={styles.locationRow}>
              <MapPin size={14} color={Colors.textSecondary} />
              <Text style={styles.locationText}>{[city, state].filter(Boolean).join(', ')}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <DollarSign size={18} color={Colors.primary} />
            <Text style={styles.statLabel}>Estimated Value</Text>
            <Text style={styles.statValue}>{formatCurrency(estimatedValue)}</Text>
          </View>
          <View style={styles.statCard}>
            <Shield size={18} color={Colors.accent} />
            <Text style={styles.statLabel}>Bond Required</Text>
            <Text style={styles.statValue}>{formatCurrency(bondRequired)}</Text>
          </View>
          <View style={styles.statCard}>
            <Clock size={18} color={countdown.urgent ? '#FF3B30' : Colors.textSecondary} />
            <Text style={styles.statLabel}>Deadline</Text>
            <Text style={[styles.statValue, countdown.urgent && { color: '#FF3B30' }]}>{countdown.text}</Text>
            <Text style={styles.statSub}>{formatDate(deadline)}</Text>
          </View>
          <View style={styles.statCard}>
            <Building2 size={18} color={Colors.textSecondary} />
            <Text style={styles.statLabel}>Category</Text>
            <Text style={styles.statValue}>{BID_CATEGORY_LABELS[category] ? BID_CATEGORY_LABELS[category] : (category || 'General')}</Text>
          </View>
        </View>

        {description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{description}</Text>
          </View>
        ) : null}

        {scopeOfWork ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scope of Work</Text>
            <Text style={styles.description}>{scopeOfWork}</Text>
          </View>
        ) : null}

        {(postedDate || deadline || preBidDate) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Important Dates</Text>
            <View style={styles.dateGrid}>
              {postedDate ? (
                <View style={styles.dateItem}>
                  <Calendar size={14} color={Colors.textSecondary} />
                  <View>
                    <Text style={styles.dateLabel}>Posted</Text>
                    <Text style={styles.dateValue}>{formatDate(postedDate)}</Text>
                  </View>
                </View>
              ) : null}
              {deadline ? (
                <View style={styles.dateItem}>
                  <Clock size={14} color={countdown.urgent ? '#FF3B30' : Colors.textSecondary} />
                  <View>
                    <Text style={styles.dateLabel}>Deadline</Text>
                    <Text style={[styles.dateValue, countdown.urgent && { color: '#FF3B30' }]}>{formatDate(deadline)}</Text>
                  </View>
                </View>
              ) : null}
              {preBidDate ? (
                <View style={styles.dateItem}>
                  <Users size={14} color={Colors.info} />
                  <View>
                    <Text style={styles.dateLabel}>Pre-Bid Conference</Text>
                    <Text style={styles.dateValue}>{formatDate(preBidDate)}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {(naicsCode || solicitationNumber) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Requirements</Text>
            <View style={styles.reqGrid}>
              {naicsCode ? (
                <View style={styles.reqItem}>
                  <Tag size={13} color={Colors.textSecondary} />
                  <Text style={styles.reqLabel}>NAICS Code</Text>
                  <Text style={styles.reqValue}>{naicsCode}</Text>
                </View>
              ) : null}
              {solicitationNumber ? (
                <View style={styles.reqItem}>
                  <FileText size={13} color={Colors.textSecondary} />
                  <Text style={styles.reqLabel}>Solicitation #</Text>
                  <Text style={styles.reqValue}>{solicitationNumber}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {requiredCerts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Required Certifications</Text>
            <View style={styles.certGrid}>
              {requiredCerts.map((certId, idx) => {
                const info = CERTIFICATIONS.find(c => c.id === certId);
                const color = CERT_COLORS[certId] || Colors.primary;
                return (
                  <View key={`${certId}-${idx}`} style={[styles.certCard, { borderLeftColor: color }]}>
                    <Text style={[styles.certShort, { color }]}>{info?.shortLabel ?? certId}</Text>
                    <Text style={styles.certFull} numberOfLines={2}>{info?.label ?? certId}</Text>
                    <Text style={styles.certSource}>{info?.source ?? ''}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Qualified Companies</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{qualifiedCompanies.length}</Text>
            </View>
          </View>
          <Text style={styles.sectionSubtitle}>Companies with matching bond capacity and certifications</Text>
          {qualifiedCompanies.length === 0 ? (
            <Text style={styles.noResults}>No companies currently match this bid's requirements</Text>
          ) : (
            qualifiedCompanies.slice(0, 5).map(company => (
              <TouchableOpacity
                key={company.id}
                style={styles.companyRow}
                onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/company-detail' as any, params: { id: company.id } });
                }}
              >
                <View style={styles.companyInfo}>
                  <Text style={styles.companyName}>{company.companyName}</Text>
                  <Text style={styles.companyMeta}>{company.city}, {company.state} · Bond: {formatCurrency(company.bondCapacity)}</Text>
                  <View style={styles.companyCerts}>
                    {company.certifications.slice(0, 3).map(c => {
                      const ci = CERTIFICATIONS.find(x => x.id === c);
                      return (
                        <View key={c} style={styles.miniCertBadge}>
                          <Text style={styles.miniCertText}>{ci?.shortLabel ?? c}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {(contactEmail || contactPhone || postedBy) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact & Links</Text>
            <View style={styles.contactCard}>
              {postedBy ? <Text style={styles.postedLabel}>Posted by: {postedBy}</Text> : null}
              {postedDate ? <Text style={styles.postedDate}>Posted: {formatDate(postedDate)}</Text> : null}
              <View style={styles.contactActions}>
                {contactEmail ? (
                  <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(`mailto:${contactEmail}`)}>
                    <Mail size={16} color="#FFF" />
                    <Text style={styles.contactBtnText}>Email</Text>
                  </TouchableOpacity>
                ) : null}
                {contactPhone ? (
                  <TouchableOpacity style={[styles.contactBtn, { backgroundColor: Colors.success }]} onPress={() => void Linking.openURL(`tel:${contactPhone}`)}>
                    <Phone size={16} color="#FFF" />
                    <Text style={styles.contactBtnText}>Call</Text>
                  </TouchableOpacity>
                ) : null}
                {applyUrl ? (
                  <TouchableOpacity style={[styles.contactBtn, { backgroundColor: Colors.accent }]} onPress={() => void Linking.openURL(applyUrl)}>
                    <ExternalLink size={16} color="#FFF" />
                    <Text style={styles.contactBtnText}>Apply</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {documentsUrl ? (
                <TouchableOpacity style={styles.sourceLink} onPress={() => void Linking.openURL(documentsUrl)}>
                  <FileText size={14} color={Colors.primary} />
                  <Text style={styles.sourceLinkText}>View Documents</Text>
                  <ExternalLink size={12} color={Colors.primary} />
                </TouchableOpacity>
              ) : null}
              {sourceUrl ? (
                <TouchableOpacity style={styles.sourceLink} onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  void Linking.openURL(sourceUrl);
                }}>
                  <Globe size={14} color={Colors.primary} />
                  <Text style={styles.sourceLinkText}>{sourceName || 'View on Procurement Portal'}</Text>
                  <ExternalLink size={12} color={Colors.primary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}

        <AIBidScorecard
          bid={{
            id: (id as string) ?? title,
            title,
            department: department || postedBy || 'Agency',
            estimated_value: estimatedValue,
            naics_code: naicsCode,
            set_aside: setAside || null,
            state,
            description: description || scopeOfWork,
          }}
          testID="bid-ai-scorecard"
        />

        <View style={{ height: 120 }} />
          </>
        )}
      </ScrollView>

      {!layout.isDesktop && <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.actionBtn, trackedBid ? styles.actionBtnSaved : styles.actionBtnOutline]}
          onPress={handleToggleSave}
          activeOpacity={0.8}
        >
          <Heart size={18} color={trackedBid ? '#FFF' : Colors.primary} fill={trackedBid ? '#FFF' : 'none'} />
          <Text style={[styles.actionBtnText, trackedBid ? styles.actionBtnTextSaved : styles.actionBtnTextOutline]}>
            {trackedBid ? 'Saved' : 'Save'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnTrack]}
          onPress={() => setShowStatusPicker(true)}
          activeOpacity={0.8}
        >
          <Bookmark size={18} color="#FFF" />
          <Text style={styles.actionBtnTextWhite}>
            {trackedBid ? STATUS_LABELS[trackedBid.status] : 'Track Status'}
          </Text>
          <ChevronDown size={14} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>

        {sourceUrl ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPortal]}
            onPress={() => void Linking.openURL(sourceUrl)}
            activeOpacity={0.8}
          >
            <Globe size={18} color={Colors.primary} />
          </TouchableOpacity>
        ) : null}
      </View>}

      {showStatusPicker && (
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowStatusPicker(false)}
        >
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Track Bid Status</Text>
            {TRACKING_STATUSES.map(status => (
              <TouchableOpacity
                key={status}
                style={[styles.pickerOption, trackedBid?.status === status && { backgroundColor: STATUS_COLORS[status]?.bg }]}
                onPress={() => handleStatusSelect(status)}
                activeOpacity={0.7}
              >
                <View style={[styles.pickerDot, { backgroundColor: STATUS_COLORS[status]?.text ?? Colors.primary }]} />
                <Text style={[styles.pickerOptionText, trackedBid?.status === status && { color: STATUS_COLORS[status]?.text, fontWeight: '700' as const }]}>
                  {STATUS_LABELS[status]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  errorText: { fontSize: 16, color: Colors.textSecondary },
  topCard: { backgroundColor: Colors.surface, padding: 20, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  topBadges: { flexDirection: 'row', gap: 6, flex: 1 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  typeBadgeText: { fontSize: 12, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  statusBadgeLarge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusBadgeLargeText: { fontSize: 11, fontWeight: '700' as const },
  bidTitle: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, lineHeight: 28, marginBottom: 6 },
  agency: { fontSize: 15, color: Colors.textSecondary, marginBottom: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontSize: 14, color: Colors.textSecondary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '47%' as any, backgroundColor: Colors.surface, padding: 14, borderRadius: 12, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: 16, fontWeight: '800' as const, color: Colors.text, textAlign: 'center' as const },
  statSub: { fontSize: 11, color: Colors.textMuted },
  section: { backgroundColor: Colors.surface, padding: 20, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 8 },
  sectionSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  description: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  dateGrid: { gap: 12 },
  dateItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dateLabel: { fontSize: 12, color: Colors.textMuted, fontWeight: '500' as const },
  dateValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  reqGrid: { gap: 10 },
  reqItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqLabel: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  reqValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  certGrid: { gap: 8 },
  certCard: { backgroundColor: Colors.background, padding: 12, borderRadius: 8, borderLeftWidth: 3 },
  certShort: { fontSize: 13, fontWeight: '800' as const, marginBottom: 2 },
  certFull: { fontSize: 13, color: Colors.text },
  certSource: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  countBadge: { backgroundColor: Colors.primary, borderRadius: 10, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#FFF', fontSize: 12, fontWeight: '700' as const },
  noResults: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const, paddingVertical: 20 },
  companyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  companyInfo: { flex: 1 },
  companyName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  companyMeta: { fontSize: 13, color: Colors.textSecondary },
  companyCerts: { flexDirection: 'row', gap: 4, marginTop: 4 },
  miniCertBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 },
  miniCertText: { fontSize: 9, fontWeight: '700' as const, color: '#2E7D32' },
  contactCard: { backgroundColor: Colors.background, padding: 16, borderRadius: 12, gap: 8 },
  postedLabel: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  postedDate: { fontSize: 13, color: Colors.textSecondary },
  contactActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  contactBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' as const },
  sourceLink: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  sourceLinkText: { fontSize: 13, color: Colors.primary, fontWeight: '600' as const, flex: 1 },
  actionBar: {
    position: 'absolute' as const, bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 34,
    backgroundColor: Colors.surface,
    borderTopWidth: 0.5, borderTopColor: Colors.borderLight,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 10,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 },
  actionBtnOutline: { backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '30' },
  actionBtnSaved: { backgroundColor: Colors.primary },
  actionBtnTrack: { flex: 1, backgroundColor: Colors.primary, justifyContent: 'center' as const },
  actionBtnPortal: { backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '30' },
  actionBtnText: { fontSize: 14, fontWeight: '600' as const },
  actionBtnTextOutline: { color: Colors.primary },
  actionBtnTextSaved: { color: '#FFF' },
  actionBtnTextWhite: { fontSize: 14, fontWeight: '700' as const, color: '#FFF' },
  pickerOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' as const },
  pickerCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  pickerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginBottom: 16 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4 },
  pickerDot: { width: 10, height: 10, borderRadius: 5 },
  pickerOptionText: { fontSize: 16, color: Colors.text, fontWeight: '500' as const },
});

const bidDesktopStyles = StyleSheet.create({
  twoCol: {
    flexDirection: 'row',
    gap: 20,
    padding: 20,
  },
  mainCol: {
    flex: 3,
    gap: 8,
  },
  sideCol: {
    flex: 2,
    gap: 8,
  },
});

```


---

### `app/company-detail.tsx`

```tsx
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, Star, Shield, Building2, Mail, Phone, Globe, Calendar, Users, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useCompanies } from '@/contexts/CompaniesContext';
import { useBids } from '@/contexts/BidsContext';
import { CERTIFICATIONS, CERT_COLORS } from '@/constants/certifications';
import type { BidCategory } from '@/types';

const BID_CATEGORY_LABELS: Record<BidCategory, string> = {
  construction: 'Construction', it_services: 'IT Services', environmental: 'Environmental',
  energy: 'Energy', infrastructure: 'Infrastructure', transportation: 'Transportation',
  utilities: 'Utilities', healthcare: 'Healthcare', education: 'Education', residential: 'Residential',
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export default function CompanyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { companies } = useCompanies();
  const { bids } = useBids();

  const company = useMemo(() => companies.find(c => c.id === id), [companies, id]);

  const eligibleBids = useMemo(() => {
    if (!company) return [];
    return bids.filter(b => {
      if (b.status !== 'open') return false;
      const meetsCapacity = company.bondCapacity >= b.bondRequired;
      const meetsCerts = b.requiredCertifications.length === 0 ||
        b.requiredCertifications.some(cert => company.certifications.includes(cert));
      return meetsCapacity && meetsCerts;
    });
  }, [company, bids]);

  if (!company) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Company' }} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Company not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: company.companyName,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>{company.companyName.charAt(0)}</Text>
          </View>
          <Text style={styles.companyName}>{company.companyName}</Text>
          <View style={styles.locationRow}>
            <MapPin size={14} color={Colors.textSecondary} />
            <Text style={styles.locationText}>{company.city}, {company.state}</Text>
          </View>
          <View style={styles.ratingRow}>
            <Star size={16} color="#F5A623" fill="#F5A623" />
            <Text style={styles.ratingText}>{company.rating.toFixed(1)}</Text>
            <Text style={styles.ratingDivider}>·</Text>
            <Text style={styles.categoryText}>{BID_CATEGORY_LABELS[company.primaryCategory]}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Shield size={20} color={Colors.accent} />
            <Text style={styles.statLabel}>Bond Capacity</Text>
            <Text style={styles.statValue}>{formatCurrency(company.bondCapacity)}</Text>
          </View>
          <View style={styles.statCard}>
            <Building2 size={20} color={Colors.primary} />
            <Text style={styles.statLabel}>Projects Done</Text>
            <Text style={styles.statValue}>{company.completedProjects}</Text>
          </View>
          {company.yearEstablished && (
            <View style={styles.statCard}>
              <Calendar size={20} color={Colors.textSecondary} />
              <Text style={styles.statLabel}>Established</Text>
              <Text style={styles.statValue}>{company.yearEstablished}</Text>
            </View>
          )}
          {company.employeeCount && (
            <View style={styles.statCard}>
              <Users size={20} color={Colors.info} />
              <Text style={styles.statLabel}>Employees</Text>
              <Text style={styles.statValue}>{company.employeeCount}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.description}>{company.description}</Text>
        </View>

        {company.certifications.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Certifications & Designations</Text>
            <View style={styles.certGrid}>
              {company.certifications.map(certId => {
                const info = CERTIFICATIONS.find(c => c.id === certId);
                const color = CERT_COLORS[certId] || Colors.primary;
                return (
                  <View key={certId} style={[styles.certCard, { borderLeftColor: color }]}>
                    <Text style={[styles.certShort, { color }]}>{info?.shortLabel ?? certId}</Text>
                    <Text style={styles.certFull} numberOfLines={2}>{info?.label ?? certId}</Text>
                    <Text style={styles.certSource}>{info?.source ?? ''}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Eligible Bids</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{eligibleBids.length}</Text>
            </View>
          </View>
          <Text style={styles.sectionSubtitle}>Open bids within bond capacity and matching certifications</Text>
          {eligibleBids.length === 0 ? (
            <Text style={styles.noResults}>No matching open bids at this time</Text>
          ) : (
            eligibleBids.slice(0, 5).map(bid => (
              <TouchableOpacity
                key={bid.id}
                style={styles.bidRow}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/bid-detail' as any, params: { id: bid.id } });
                }}
              >
                <View style={styles.bidInfo}>
                  <Text style={styles.bidTitle} numberOfLines={1}>{bid.title}</Text>
                  <Text style={styles.bidMeta}>{bid.city}, {bid.state} · {formatCurrency(bid.estimatedValue)}</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact</Text>
          <View style={styles.contactActions}>
            <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(`mailto:${company.contactEmail}`)}>
              <Mail size={16} color="#FFF" />
              <Text style={styles.contactBtnText}>Email</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.contactBtn, { backgroundColor: '#2E7D32' }]} onPress={() => void Linking.openURL(`tel:${company.phone}`)}>
              <Phone size={16} color="#FFF" />
              <Text style={styles.contactBtnText}>Call</Text>
            </TouchableOpacity>
            {company.website && (
              <TouchableOpacity style={[styles.contactBtn, { backgroundColor: Colors.info }]} onPress={() => void Linking.openURL(company.website!)}>
                <Globe size={16} color="#FFF" />
                <Text style={styles.contactBtnText}>Website</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: Colors.textSecondary },
  profileHeader: { backgroundColor: Colors.surface, alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  avatarLarge: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarLargeText: { fontSize: 30, fontWeight: '800' as const, color: Colors.primary },
  companyName: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, marginBottom: 4, textAlign: 'center' as const },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  locationText: { fontSize: 14, color: Colors.textSecondary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 15, fontWeight: '700' as const, color: '#F5A623' },
  ratingDivider: { color: Colors.textMuted },
  categoryText: { fontSize: 14, color: Colors.textSecondary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '47%' as any, backgroundColor: Colors.surface, padding: 14, borderRadius: 12, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: 17, fontWeight: '800' as const, color: Colors.text },
  section: { backgroundColor: Colors.surface, padding: 20, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 8 },
  sectionSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  description: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  certGrid: { gap: 8 },
  certCard: { backgroundColor: Colors.background, padding: 12, borderRadius: 8, borderLeftWidth: 3 },
  certShort: { fontSize: 13, fontWeight: '800' as const, marginBottom: 2 },
  certFull: { fontSize: 13, color: Colors.text },
  certSource: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  countBadge: { backgroundColor: Colors.primary, borderRadius: 10, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#FFF', fontSize: 12, fontWeight: '700' as const },
  noResults: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const, paddingVertical: 20 },
  bidRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  bidInfo: { flex: 1 },
  bidTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  bidMeta: { fontSize: 13, color: Colors.textSecondary },
  contactActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  contactBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' as const },
});

```


---

### `app/worker-detail.tsx`

```tsx
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, DollarSign, Clock, Award, Mail, Phone, MessageCircle, Briefcase } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useHire } from '@/contexts/HireContext';
import { getTradeLabel } from '@/constants/trades';
import type { AvailabilityStatus } from '@/types';

const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  available: 'Available Now', employed: 'Currently Employed', open_to_offers: 'Open to Offers',
};
const AVAILABILITY_COLORS: Record<AvailabilityStatus, string> = {
  available: '#2E7D32', employed: '#E65100', open_to_offers: '#1565C0',
};

export default function WorkerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { workers, jobs, startConversation } = useHire();

  const worker = useMemo(() => workers.find(w => w.id === id), [workers, id]);

  const matchingJobs = useMemo(() => {
    if (!worker) return [];
    return jobs.filter(j => j.tradeCategory === worker.tradeCategory && j.status === 'open').slice(0, 5);
  }, [worker, jobs]);

  if (!worker) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Worker Profile' }} />
        <View style={styles.center}><Text style={styles.errorText}>Worker not found</Text></View>
      </View>
    );
  }

  const availColor = AVAILABILITY_COLORS[worker.availability];

  const handleMessage = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const convoId = startConversation(
      ['you', worker.id],
      ['You', worker.name],
      `Hi ${worker.name}, I'd like to discuss a potential opportunity with you.`
    );
    router.push({ pathname: '/messages' as any, params: { id: convoId } });
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Worker Profile',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarText}>{worker.name.charAt(0)}</Text>
          </View>
          <Text style={styles.name}>{worker.name}</Text>
          <Text style={styles.trade}>{getTradeLabel(worker.tradeCategory)}</Text>
          <View style={[styles.availBadge, { backgroundColor: availColor + '15' }]}>
            <View style={[styles.availDot, { backgroundColor: availColor }]} />
            <Text style={[styles.availText, { color: availColor }]}>{AVAILABILITY_LABELS[worker.availability]}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Clock size={18} color={Colors.primary} />
            <Text style={styles.statLabel}>Experience</Text>
            <Text style={styles.statValue}>{worker.yearsExperience} years</Text>
          </View>
          <View style={styles.statCard}>
            <DollarSign size={18} color={Colors.accent} />
            <Text style={styles.statLabel}>Rate</Text>
            <Text style={styles.statValue}>${worker.hourlyRate}/hr</Text>
          </View>
          <View style={styles.statCard}>
            <MapPin size={18} color={Colors.textSecondary} />
            <Text style={styles.statLabel}>Location</Text>
            <Text style={styles.statValue}>{worker.city}, {worker.state}</Text>
          </View>
          <View style={styles.statCard}>
            <Briefcase size={18} color={Colors.info} />
            <Text style={styles.statLabel}>Past Projects</Text>
            <Text style={styles.statValue}>{worker.pastProjects.length}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.bio}>{worker.bio}</Text>
        </View>

        {worker.licenses.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Licenses & Certifications</Text>
            {worker.licenses.map((lic, i) => (
              <View key={i} style={styles.licenseItem}>
                <Award size={14} color={Colors.primary} />
                <Text style={styles.licenseLabel}>{lic}</Text>
              </View>
            ))}
          </View>
        )}

        {worker.pastProjects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Past Projects</Text>
            {worker.pastProjects.map((proj, i) => (
              <View key={i} style={styles.projectItem}>
                <View style={styles.projectDot} />
                <Text style={styles.projectText}>{proj}</Text>
              </View>
            ))}
          </View>
        )}

        {matchingJobs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Matching Open Jobs</Text>
            {matchingJobs.map(job => (
              <TouchableOpacity
                key={job.id}
                style={styles.jobRow}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/job-detail' as any, params: { id: job.id } });
                }}
              >
                <View style={styles.jobInfo}>
                  <Text style={styles.jobTitle} numberOfLines={1}>{job.title}</Text>
                  <Text style={styles.jobMeta}>{job.companyName} · {job.city}, {job.state}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.actionSection}>
          <TouchableOpacity style={styles.messageBtn} onPress={handleMessage}>
            <MessageCircle size={16} color="#FFF" />
            <Text style={styles.messageBtnText}>Message {worker.name.split(' ')[0]}</Text>
          </TouchableOpacity>
          <View style={styles.contactRow}>
            <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(`mailto:${worker.contactEmail}`)}>
              <Mail size={16} color={Colors.primary} />
              <Text style={styles.contactBtnText}>Email</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(`tel:${worker.phone}`)}>
              <Phone size={16} color={Colors.primary} />
              <Text style={styles.contactBtnText}>Call</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: Colors.textSecondary },
  profileHeader: { backgroundColor: Colors.surface, alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  avatarLarge: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.accent + '20', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 30, fontWeight: '800' as const, color: Colors.accent },
  name: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, marginBottom: 4 },
  trade: { fontSize: 15, color: Colors.textSecondary, marginBottom: 8 },
  availBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  availDot: { width: 8, height: 8, borderRadius: 4 },
  availText: { fontSize: 13, fontWeight: '600' as const },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '48%' as any, backgroundColor: Colors.surface, padding: 14, borderRadius: 12, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, textAlign: 'center' as const },
  section: { backgroundColor: Colors.surface, padding: 20, marginTop: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 10 },
  bio: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  licenseItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  licenseLabel: { fontSize: 14, color: Colors.text },
  projectItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  projectDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  projectText: { fontSize: 14, color: Colors.text },
  jobRow: { paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  jobInfo: { flex: 1 },
  jobTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  jobMeta: { fontSize: 13, color: Colors.textSecondary },
  actionSection: { padding: 20, gap: 12 },
  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12, gap: 8 },
  messageBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
  contactRow: { flexDirection: 'row', gap: 10 },
  contactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '12', paddingVertical: 14, borderRadius: 12, gap: 8 },
  contactBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '600' as const },
});

```


---

### `app/job-detail.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, DollarSign, Clock, Briefcase, Award, ChevronRight, Send, Building2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useHire } from '@/contexts/HireContext';
import { getTradeLabel } from '@/constants/trades';

const JOB_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full-Time', part_time: 'Part-Time', contract: 'Contract', per_diem: 'Per Diem',
};
const EXP_LABELS: Record<string, string> = {
  entry: 'Entry Level', mid: 'Mid Level', senior: 'Senior', expert: 'Expert',
};

function formatPay(min: number, max: number, type: string): string {
  if (type === 'salary') return `$${(min / 1000).toFixed(0)}K – $${(max / 1000).toFixed(0)}K / year`;
  return `$${min} – $${max} / hour`;
}

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { jobs, applyToJob, workers, startConversation } = useHire();
  const [applied, setApplied] = useState(false);

  const job = useMemo(() => jobs.find(j => j.id === id), [jobs, id]);

  const matchingWorkers = useMemo(() => {
    if (!job) return [];
    return workers.filter(w =>
      w.tradeCategory === job.tradeCategory && w.availability !== 'employed'
    ).slice(0, 5);
  }, [job, workers]);

  if (!job) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Job Details' }} />
        <View style={styles.center}><Text style={styles.errorText}>Job not found</Text></View>
      </View>
    );
  }

  const handleApply = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    applyToJob(job.id);
    setApplied(true);
    Alert.alert('Applied!', 'Your application has been submitted.');
  };

  const handleMessage = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const convoId = startConversation(
      ['you', job.companyId],
      ['You', job.companyName],
      `Hi, I'm interested in the "${job.title}" position.`
    );
    router.push({ pathname: '/messages' as any, params: { id: convoId } });
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Job Details',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.topCard}>
          <View style={styles.badgeRow}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{JOB_TYPE_LABELS[job.jobType]}</Text>
            </View>
            <View style={[styles.statusBadge, job.status === 'open' ? styles.openBadge : styles.closedBadge]}>
              <Text style={[styles.statusText, job.status === 'open' ? styles.openText : styles.closedText]}>
                {job.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.title}>{job.title}</Text>
          <Text style={styles.company}>{job.companyName}</Text>
          <View style={styles.metaRow}>
            <MapPin size={14} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{job.city}, {job.state}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <DollarSign size={18} color={Colors.primary} />
            <Text style={styles.statLabel}>Pay</Text>
            <Text style={styles.statValue}>{formatPay(job.payMin, job.payMax, job.payType)}</Text>
          </View>
          <View style={styles.statCard}>
            <Briefcase size={18} color={Colors.accent} />
            <Text style={styles.statLabel}>Trade</Text>
            <Text style={styles.statValue}>{getTradeLabel(job.tradeCategory)}</Text>
          </View>
          <View style={styles.statCard}>
            <Award size={18} color={Colors.info} />
            <Text style={styles.statLabel}>Experience</Text>
            <Text style={styles.statValue}>{EXP_LABELS[job.experienceLevel]}</Text>
          </View>
          <View style={styles.statCard}>
            <Clock size={18} color={Colors.textSecondary} />
            <Text style={styles.statLabel}>Start Date</Text>
            <Text style={styles.statValue}>{job.startDate}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{job.description}</Text>
        </View>

        {job.requiredLicenses.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Required Licenses & Certifications</Text>
            {job.requiredLicenses.map((lic, i) => (
              <View key={i} style={styles.licenseItem}>
                <Award size={14} color={Colors.primary} />
                <Text style={styles.licenseLabel}>{lic}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Matching Workers</Text>
          <Text style={styles.sectionSubtitle}>Available workers matching this trade</Text>
          {matchingWorkers.length === 0 ? (
            <Text style={styles.noResults}>No matching workers at this time</Text>
          ) : (
            matchingWorkers.map(w => (
              <TouchableOpacity
                key={w.id}
                style={styles.workerRow}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/worker-detail' as any, params: { id: w.id } });
                }}
              >
                <View style={styles.workerAvatar}>
                  <Text style={styles.workerAvatarText}>{w.name.charAt(0)}</Text>
                </View>
                <View style={styles.workerInfo}>
                  <Text style={styles.workerName}>{w.name}</Text>
                  <Text style={styles.workerMeta}>{w.yearsExperience}yr exp · ${w.hourlyRate}/hr</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.actionSection}>
          <Text style={styles.applicantInfo}>{job.applicantCount} applicants so far</Text>
          <TouchableOpacity
            style={[styles.applyBtn, applied && styles.appliedBtn]}
            onPress={handleApply}
            disabled={applied}
          >
            <Send size={16} color="#FFF" />
            <Text style={styles.applyBtnText}>{applied ? 'Applied' : 'Apply Now'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.messageBtn} onPress={handleMessage}>
            <Building2 size={16} color={Colors.primary} />
            <Text style={styles.messageBtnText}>Message Company</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: Colors.textSecondary },
  topCard: { backgroundColor: Colors.surface, padding: 20, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeBadge: { backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  typeBadgeText: { fontSize: 12, fontWeight: '700' as const, color: Colors.primary, textTransform: 'uppercase' as const },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  openBadge: { backgroundColor: '#E8F5E9' },
  closedBadge: { backgroundColor: '#FFEBEE' },
  statusText: { fontSize: 11, fontWeight: '800' as const },
  openText: { color: '#2E7D32' },
  closedText: { color: '#C62828' },
  title: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, marginBottom: 4 },
  company: { fontSize: 15, color: Colors.textSecondary, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 14, color: Colors.textSecondary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '48%' as any, backgroundColor: Colors.surface, padding: 14, borderRadius: 12, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, textAlign: 'center' as const },
  section: { backgroundColor: Colors.surface, padding: 20, marginTop: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 8 },
  sectionSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  description: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  licenseItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  licenseLabel: { fontSize: 14, color: Colors.text },
  noResults: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const, paddingVertical: 20 },
  workerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  workerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.accent + '20', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  workerAvatarText: { fontSize: 14, fontWeight: '700' as const, color: Colors.accent },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  workerMeta: { fontSize: 13, color: Colors.textSecondary },
  actionSection: { padding: 20, gap: 10 },
  applicantInfo: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, marginBottom: 4 },
  applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12, gap: 8 },
  appliedBtn: { backgroundColor: Colors.textMuted },
  applyBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '12', paddingVertical: 14, borderRadius: 12, gap: 8 },
  messageBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '600' as const },
});

```


---

### `app/post-bid.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { ChevronDown, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useBids } from '@/contexts/BidsContext';
import { CERTIFICATIONS } from '@/constants/certifications';
import { US_STATES } from '@/constants/regions';
import type { PublicBid, BidType, BidCategory, CertificationType } from '@/types';
import { generateUUID } from '@/utils/generateId';

const BID_TYPES: { id: BidType; label: string }[] = [
  { id: 'federal', label: 'Federal' }, { id: 'state', label: 'State' },
  { id: 'municipal', label: 'Municipal' }, { id: 'county', label: 'County' }, { id: 'private', label: 'Private' },
];

const BID_CATEGORIES: { id: BidCategory; label: string }[] = [
  { id: 'construction', label: 'Construction' }, { id: 'it_services', label: 'IT Services' },
  { id: 'environmental', label: 'Environmental' }, { id: 'energy', label: 'Energy' },
  { id: 'infrastructure', label: 'Infrastructure' }, { id: 'transportation', label: 'Transportation' },
  { id: 'utilities', label: 'Utilities' }, { id: 'healthcare', label: 'Healthcare' },
  { id: 'education', label: 'Education' }, { id: 'residential', label: 'Residential' },
];

export default function PostBidScreen() {
  const router = useRouter();
  const { addBid } = useBids();
  const [title, setTitle] = useState('');
  const [agency, setAgency] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('NY');
  const [bidType, setBidType] = useState<BidType>('municipal');
  const [category, setCategory] = useState<BidCategory>('construction');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [bondRequired, setBondRequired] = useState('');
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [applyUrl, setApplyUrl] = useState('');
  const [selectedCerts, setSelectedCerts] = useState<CertificationType[]>([]);
  const [showCertPicker, setShowCertPicker] = useState(false);

  const toggleCert = useCallback((cert: CertificationType) => {
    void Haptics.selectionAsync();
    setSelectedCerts(prev =>
      prev.includes(cert) ? prev.filter(c => c !== cert) : [...prev, cert]
    );
  }, []);

  const handleSubmit = useCallback(() => {
    if (!title.trim() || !agency.trim() || !city.trim() || !estimatedValue || !bondRequired || !deadline || !contactEmail.trim()) {
      Alert.alert('Missing Fields', 'Please fill in all required fields.');
      return;
    }

    const bid: PublicBid = {
      id: generateUUID(),
      title: title.trim(),
      issuingAgency: agency.trim(),
      city: city.trim(),
      state,
      category,
      bidType,
      estimatedValue: parseFloat(estimatedValue) || 0,
      bondRequired: parseFloat(bondRequired) || 0,
      deadline: new Date(deadline).toISOString(),
      description: description.trim(),
      postedBy: 'You',
      postedDate: new Date().toISOString(),
      status: 'open',
      requiredCertifications: selectedCerts,
      contactEmail: contactEmail.trim(),
      applyUrl: applyUrl.trim() || undefined,
    };

    addBid(bid);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Bid Posted', 'Your bid has been published.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }, [title, agency, city, state, category, bidType, estimatedValue, bondRequired, deadline, description, contactEmail, applyUrl, selectedCerts, addBid, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Post a Bid',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Bid title" placeholderTextColor={Colors.textMuted} testID="bid-title" />

          <Text style={styles.label}>Issuing Agency *</Text>
          <TextInput style={styles.input} value={agency} onChangeText={setAgency} placeholder="Agency or company name" placeholderTextColor={Colors.textMuted} />

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>City *</Text>
              <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={Colors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>State *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stateScroll}>
                {US_STATES.slice(0, 10).map(s => (
                  <TouchableOpacity key={s.code} style={[styles.stateChip, state === s.code && styles.stateChipActive]} onPress={() => setState(s.code)}>
                    <Text style={[styles.stateChipText, state === s.code && styles.stateChipTextActive]}>{s.code}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <Text style={styles.label}>Bid Type *</Text>
          <View style={styles.chipRow}>
            {BID_TYPES.map(t => (
              <TouchableOpacity key={t.id} style={[styles.chip, bidType === t.id && styles.chipActive]} onPress={() => setBidType(t.id)}>
                <Text style={[styles.chipText, bidType === t.id && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Category *</Text>
          <View style={styles.chipRow}>
            {BID_CATEGORIES.map(c => (
              <TouchableOpacity key={c.id} style={[styles.chip, category === c.id && styles.chipActive]} onPress={() => setCategory(c.id)}>
                <Text style={[styles.chipText, category === c.id && styles.chipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>Estimated Value ($) *</Text>
              <TextInput style={styles.input} value={estimatedValue} onChangeText={setEstimatedValue} placeholder="5000000" keyboardType="numeric" placeholderTextColor={Colors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Bond Required ($) *</Text>
              <TextInput style={styles.input} value={bondRequired} onChangeText={setBondRequired} placeholder="2500000" keyboardType="numeric" placeholderTextColor={Colors.textMuted} />
            </View>
          </View>

          <Text style={styles.label}>Deadline (YYYY-MM-DD) *</Text>
          <TextInput style={styles.input} value={deadline} onChangeText={setDeadline} placeholder="2026-06-01" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="Describe the project scope..." placeholderTextColor={Colors.textMuted} multiline numberOfLines={4} />

          <Text style={styles.label}>Contact Email *</Text>
          <TextInput style={styles.input} value={contactEmail} onChangeText={setContactEmail} placeholder="bids@example.com" keyboardType="email-address" autoCapitalize="none" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Apply URL (optional)</Text>
          <TextInput style={styles.input} value={applyUrl} onChangeText={setApplyUrl} placeholder="https://..." autoCapitalize="none" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Required Certifications</Text>
          <TouchableOpacity style={styles.certToggle} onPress={() => setShowCertPicker(!showCertPicker)}>
            <Text style={styles.certToggleText}>
              {selectedCerts.length === 0 ? 'None selected' : `${selectedCerts.length} selected`}
            </Text>
            <ChevronDown size={16} color={Colors.textSecondary} />
          </TouchableOpacity>

          {showCertPicker && (
            <View style={styles.certPickerContainer}>
              {CERTIFICATIONS.map(cert => (
                <TouchableOpacity
                  key={cert.id}
                  style={[styles.certOption, selectedCerts.includes(cert.id) && styles.certOptionActive]}
                  onPress={() => toggleCert(cert.id)}
                >
                  <Text style={[styles.certOptionText, selectedCerts.includes(cert.id) && styles.certOptionTextActive]}>
                    {cert.shortLabel}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {selectedCerts.length > 0 && (
            <View style={styles.selectedCerts}>
              {selectedCerts.map(certId => {
                const info = CERTIFICATIONS.find(c => c.id === certId);
                return (
                  <TouchableOpacity key={certId} style={styles.selectedCertBadge} onPress={() => toggleCert(certId)}>
                    <Text style={styles.selectedCertText}>{info?.shortLabel ?? certId}</Text>
                    <X size={12} color={Colors.primary} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} testID="submit-bid">
            <Text style={styles.submitBtnText}>Publish Bid</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },
  label: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6, marginTop: 14, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  input: { backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.text, borderWidth: 0.5, borderColor: Colors.borderLight },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },
  row: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  stateScroll: { maxHeight: 36 },
  stateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.surface, marginRight: 4, borderWidth: 0.5, borderColor: Colors.borderLight },
  stateChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stateChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' as const },
  stateChipTextActive: { color: '#FFF' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 0.5, borderColor: Colors.borderLight },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  certToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 0.5, borderColor: Colors.borderLight },
  certToggleText: { fontSize: 15, color: Colors.textSecondary },
  certPickerContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, backgroundColor: Colors.surface, padding: 12, borderRadius: 10 },
  certOption: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: Colors.background },
  certOptionActive: { backgroundColor: Colors.primary + '20' },
  certOptionText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  certOptionTextActive: { color: Colors.primary, fontWeight: '700' as const },
  selectedCerts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  selectedCertBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary + '15', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  selectedCertText: { fontSize: 12, color: Colors.primary, fontWeight: '600' as const },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
});

```


---

### `app/post-job.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';

import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useHire } from '@/contexts/HireContext';
import { TRADE_CATEGORIES } from '@/constants/trades';
import { US_STATES } from '@/constants/regions';
import type { JobListing, TradeCategory, JobType, ExperienceLevel } from '@/types';
import { generateUUID } from '@/utils/generateId';

const JOB_TYPES: { id: JobType; label: string }[] = [
  { id: 'full_time', label: 'Full-Time' }, { id: 'part_time', label: 'Part-Time' },
  { id: 'contract', label: 'Contract' }, { id: 'per_diem', label: 'Per Diem' },
];

const EXP_LEVELS: { id: ExperienceLevel; label: string }[] = [
  { id: 'entry', label: 'Entry' }, { id: 'mid', label: 'Mid' },
  { id: 'senior', label: 'Senior' }, { id: 'expert', label: 'Expert' },
];

export default function PostJobScreen() {
  const router = useRouter();
  const { addJob } = useHire();
  const [title, setTitle] = useState('');
  const [trade, setTrade] = useState<TradeCategory>('general_laborer');
  const [city, setCity] = useState('');
  const [state, setState] = useState('NY');
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [payType, setPayType] = useState<'hourly' | 'salary'>('hourly');
  const [jobType, setJobType] = useState<JobType>('full_time');
  const [expLevel, setExpLevel] = useState<ExperienceLevel>('mid');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [licenses, setLicenses] = useState('');

  const handleSubmit = useCallback(() => {
    if (!title.trim() || !city.trim() || !payMin || !payMax || !startDate) {
      Alert.alert('Missing Fields', 'Please fill in all required fields.');
      return;
    }

    const job: JobListing = {
      id: generateUUID(),
      companyId: 'you',
      companyName: 'Your Company',
      title: title.trim(),
      tradeCategory: trade,
      city: city.trim(),
      state,
      payMin: parseFloat(payMin) || 0,
      payMax: parseFloat(payMax) || 0,
      payType,
      jobType,
      requiredLicenses: licenses.split(',').map(l => l.trim()).filter(Boolean),
      experienceLevel: expLevel,
      description: description.trim(),
      startDate,
      postedDate: new Date().toISOString(),
      status: 'open',
      applicantCount: 0,
    };

    addJob(job);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Job Posted', 'Your job listing is now live.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }, [title, trade, city, state, payMin, payMax, payType, jobType, expLevel, description, startDate, licenses, addJob, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Post a Job',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Job Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Journeyman Electrician" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Trade / Skill Category *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
            {TRADE_CATEGORIES.map(t => (
              <TouchableOpacity key={t.id} style={[styles.chip, trade === t.id && styles.chipActive]} onPress={() => setTrade(t.id)}>
                <Text style={[styles.chipText, trade === t.id && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>City *</Text>
              <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={Colors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>State *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stateScroll}>
                {US_STATES.slice(0, 15).map(s => (
                  <TouchableOpacity key={s.code} style={[styles.stateChip, state === s.code && styles.stateChipActive]} onPress={() => setState(s.code)}>
                    <Text style={[styles.stateChipText, state === s.code && styles.stateChipTextActive]}>{s.code}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <Text style={styles.label}>Pay Type</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity style={[styles.chip, payType === 'hourly' && styles.chipActive]} onPress={() => setPayType('hourly')}>
              <Text style={[styles.chipText, payType === 'hourly' && styles.chipTextActive]}>Hourly</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, payType === 'salary' && styles.chipActive]} onPress={() => setPayType('salary')}>
              <Text style={[styles.chipText, payType === 'salary' && styles.chipTextActive]}>Salary</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>{payType === 'hourly' ? 'Min $/hr *' : 'Min $/yr *'}</Text>
              <TextInput style={styles.input} value={payMin} onChangeText={setPayMin} placeholder={payType === 'hourly' ? '35' : '60000'} keyboardType="numeric" placeholderTextColor={Colors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>{payType === 'hourly' ? 'Max $/hr *' : 'Max $/yr *'}</Text>
              <TextInput style={styles.input} value={payMax} onChangeText={setPayMax} placeholder={payType === 'hourly' ? '55' : '90000'} keyboardType="numeric" placeholderTextColor={Colors.textMuted} />
            </View>
          </View>

          <Text style={styles.label}>Job Type *</Text>
          <View style={styles.chipRow}>
            {JOB_TYPES.map(t => (
              <TouchableOpacity key={t.id} style={[styles.chip, jobType === t.id && styles.chipActive]} onPress={() => setJobType(t.id)}>
                <Text style={[styles.chipText, jobType === t.id && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Experience Level *</Text>
          <View style={styles.chipRow}>
            {EXP_LEVELS.map(e => (
              <TouchableOpacity key={e.id} style={[styles.chip, expLevel === e.id && styles.chipActive]} onPress={() => setExpLevel(e.id)}>
                <Text style={[styles.chipText, expLevel === e.id && styles.chipTextActive]}>{e.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Start Date (YYYY-MM-DD) *</Text>
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="2026-05-01" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="Describe the role..." placeholderTextColor={Colors.textMuted} multiline numberOfLines={4} />

          <Text style={styles.label}>Required Licenses (comma separated)</Text>
          <TextInput style={styles.input} value={licenses} onChangeText={setLicenses} placeholder="OSHA 30, SST Card, CDL" placeholderTextColor={Colors.textMuted} />

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} testID="submit-job">
            <Text style={styles.submitBtnText}>Publish Job</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },
  label: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6, marginTop: 14, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  input: { backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.text, borderWidth: 0.5, borderColor: Colors.borderLight },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },
  row: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  scrollRow: { maxHeight: 36 },
  stateScroll: { maxHeight: 36 },
  stateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.surface, marginRight: 4, borderWidth: 0.5, borderColor: Colors.borderLight },
  stateChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stateChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' as const },
  stateChipTextActive: { color: '#FFF' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 0.5, borderColor: Colors.borderLight },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
});

```


---

### `components/AIBidScorer.tsx`

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal,
  ScrollView, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles, X, CheckCircle2, Settings } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  scoreBid, getCompanyProfile, saveCompanyProfile, getCachedResult, setCachedResult,
  type CompanyAIProfile, type BidScoreResult,
} from '@/utils/aiService';

const SPECIALTIES = ['Residential', 'Commercial', 'Industrial', 'Government', 'Renovation', 'New Construction'];
const TRADES = ['General', 'Electrical', 'Plumbing', 'HVAC', 'Roofing', 'Concrete', 'Framing', 'Painting', 'Drywall', 'Flooring', 'Landscaping'];
const SIZE_OPTIONS = ['Under $100K', '$100K-$500K', '$500K-$2M', '$2M-$10M', '$10M+'];
const CERTS = ['SDVOSB', 'HUBZone', '8(a)', 'WOSB', 'MBE', 'DBE', 'MWBE', 'SBE'];

function getMatchBadge(score: number): { label: string; color: string; bg: string } {
  if (score >= 90) return { label: 'Great Match', color: '#2E7D32', bg: '#E8F5E9' };
  if (score >= 70) return { label: 'Good Match', color: '#1565C0', bg: '#E3F2FD' };
  if (score >= 50) return { label: 'Partial Match', color: '#E65100', bg: '#FFF3E0' };
  return { label: 'Low Match', color: '#757575', bg: '#F5F5F5' };
}

export function AIMatchBadge({ score }: { score: number }) {
  const badge = getMatchBadge(score);
  return (
    <View style={[badgeStyles.container, { backgroundColor: badge.bg }]}>
      <Sparkles size={10} color={badge.color} />
      <Text style={[badgeStyles.text, { color: badge.color }]}>{badge.label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  text: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
});

interface ProfileSetupProps {
  visible: boolean;
  onClose: () => void;
  onSave: (profile: CompanyAIProfile) => void;
  initialProfile?: CompanyAIProfile | null;
}

export function AIProfileSetup({ visible, onClose, onSave, initialProfile }: ProfileSetupProps) {
  const insets = useSafeAreaInsets();
  const [specialties, setSpecialties] = useState<string[]>(initialProfile?.specialties ?? []);
  const [trades, setTrades] = useState<string[]>(initialProfile?.trades ?? []);
  const [preferredSize, setPreferredSize] = useState(initialProfile?.preferredSize ?? '$100K-$500K');
  const [location, setLocation] = useState(initialProfile?.location ?? '');
  const [certifications, setCertifications] = useState<string[]>(initialProfile?.certifications ?? []);

  const toggle = (arr: string[], item: string, setter: (v: string[]) => void) => {
    setter(arr.includes(item) ? arr.filter(s => s !== item) : [...arr, item]);
  };

  const handleSave = () => {
    const profile: CompanyAIProfile = { specialties, trades, preferredSize, location, certifications };
    saveCompanyProfile(profile).catch(() => {});
    onSave(profile);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[setupStyles.container, { paddingTop: insets.top }]}>
        <View style={setupStyles.header}>
          <Text style={setupStyles.title}>Company AI Profile</Text>
          <TouchableOpacity onPress={onClose}>
            <X size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={setupStyles.content}>
          <Text style={setupStyles.sectionTitle}>Specialties</Text>
          <View style={setupStyles.chipRow}>
            {SPECIALTIES.map(s => (
              <TouchableOpacity
                key={s}
                style={[setupStyles.chip, specialties.includes(s) && setupStyles.chipActive]}
                onPress={() => toggle(specialties, s, setSpecialties)}
              >
                <Text style={[setupStyles.chipText, specialties.includes(s) && setupStyles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={setupStyles.sectionTitle}>Trades</Text>
          <View style={setupStyles.chipRow}>
            {TRADES.map(t => (
              <TouchableOpacity
                key={t}
                style={[setupStyles.chip, trades.includes(t) && setupStyles.chipActive]}
                onPress={() => toggle(trades, t, setTrades)}
              >
                <Text style={[setupStyles.chipText, trades.includes(t) && setupStyles.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={setupStyles.sectionTitle}>Preferred Project Size</Text>
          <View style={setupStyles.chipRow}>
            {SIZE_OPTIONS.map(s => (
              <TouchableOpacity
                key={s}
                style={[setupStyles.chip, preferredSize === s && setupStyles.chipActive]}
                onPress={() => setPreferredSize(s)}
              >
                <Text style={[setupStyles.chipText, preferredSize === s && setupStyles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={setupStyles.sectionTitle}>Certifications</Text>
          <View style={setupStyles.chipRow}>
            {CERTS.map(c => (
              <TouchableOpacity
                key={c}
                style={[setupStyles.chip, certifications.includes(c) && setupStyles.chipActive]}
                onPress={() => toggle(certifications, c, setCertifications)}
              >
                <Text style={[setupStyles.chipText, certifications.includes(c) && setupStyles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={setupStyles.saveBtn} onPress={handleSave}>
            <Text style={setupStyles.saveBtnText}>Save Profile</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const setupStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight, backgroundColor: Colors.surface,
  },
  title: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: Colors.fillSecondary, borderWidth: 1, borderColor: Colors.borderLight,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.text, fontWeight: '500' as const },
  chipTextActive: { color: '#FFFFFF' },
  saveBtn: {
    backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#FFFFFF' },
});

export async function getBidScore(bidId: string, bid: {
  title: string; department: string; estimated_value: number;
  naics_code?: string; set_aside?: string | null; state?: string; description?: string;
}): Promise<BidScoreResult | null> {
  const cacheKey = `bidscore_${bidId}`;
  const cached = await getCachedResult<BidScoreResult>(cacheKey, 24 * 60 * 60 * 1000);
  if (cached) return cached;

  const profile = await getCompanyProfile();
  if (!profile || profile.specialties.length === 0) return null;

  try {
    const result = await scoreBid(bid, profile);
    await setCachedResult(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[AI Bid] Score failed:', err);
    return null;
  }
}

```


---

### `components/AIBidScorecard.tsx`

```tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, Zap, TrendingUp, AlertTriangle, CheckCircle2, Settings, RefreshCw, Target,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  scoreBid, getCompanyProfile, getCachedResult, setCachedResult,
  type CompanyAIProfile, type BidScoreResult,
} from '@/utils/aiService';
import { AIProfileSetup } from '@/components/AIBidScorer';

interface BidScoringInput {
  id: string;
  title: string;
  department: string;
  estimated_value: number;
  naics_code?: string;
  set_aside?: string | null;
  state?: string;
  description?: string;
}

interface AIBidScorecardProps {
  bid: BidScoringInput;
  testID?: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return Colors.success;
  if (score >= 60) return Colors.primary;
  if (score >= 40) return Colors.warning;
  return Colors.error;
}

function scoreLabel(score: number): string {
  if (score >= 85) return 'Strong Fit — Go';
  if (score >= 65) return 'Good Fit — Likely Go';
  if (score >= 45) return 'Partial Fit — Review';
  return 'Weak Fit — No-Go';
}

function goNoGo(score: number): 'go' | 'review' | 'no_go' {
  if (score >= 65) return 'go';
  if (score >= 45) return 'review';
  return 'no_go';
}

const PROFILE_REQUIRED_THRESHOLD = 1;

export default function AIBidScorecard({ bid, testID }: AIBidScorecardProps) {
  const [profile, setProfile] = useState<CompanyAIProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [score, setScore] = useState<BidScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = useMemo(() => `bidscore_${bid.id}`, [bid.id]);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const p = await getCompanyProfile();
      setProfile(p);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    (async () => {
      const cached = await getCachedResult<BidScoreResult>(cacheKey, 24 * 60 * 60 * 1000);
      if (cached) setScore(cached);
    })();
  }, [cacheKey]);

  const profileReady = !!profile && (profile.specialties.length + profile.trades.length) >= PROFILE_REQUIRED_THRESHOLD;

  const runScore = useCallback(async (force = false) => {
    if (!profileReady || !profile) {
      setShowProfileSetup(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (!force) {
        const cached = await getCachedResult<BidScoreResult>(cacheKey, 24 * 60 * 60 * 1000);
        if (cached) {
          setScore(cached);
          setLoading(false);
          return;
        }
      }
      const result = await scoreBid(bid, profile);
      await setCachedResult(cacheKey, result);
      setScore(result);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err?.message || 'Failed to score bid');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }, [bid, profile, profileReady, cacheKey]);

  const handleProfileSaved = useCallback((p: CompanyAIProfile) => {
    setProfile(p);
    setShowProfileSetup(false);
    // Auto-run scoring after profile saved
    setTimeout(() => { void runScore(true); }, 200);
  }, [runScore]);

  // Idle state — no score yet
  if (!score && !loading && !error) {
    return (
      <View style={styles.container} testID={testID}>
        <View style={styles.heroRow}>
          <View style={styles.iconWrap}>
            <Sparkles size={18} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>AI Go/No-Go Analysis</Text>
            <Text style={styles.subtitle}>
              {profileReady
                ? 'Score this bid against your company profile in seconds.'
                : 'Set up a quick company profile and get personalized bid scoring.'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.runBtn}
          onPress={() => void runScore(false)}
          activeOpacity={0.85}
          disabled={profileLoading}
          testID="ai-score-bid-btn"
        >
          {profileLoading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Zap size={15} color="#FFF" />
              <Text style={styles.runBtnText}>
                {profileReady ? 'Run Go/No-Go Score' : 'Set Up & Score'}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <AIProfileSetup
          visible={showProfileSetup}
          onClose={() => setShowProfileSetup(false)}
          onSave={handleProfileSaved}
          initialProfile={profile}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]} testID={testID}>
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={styles.loadingText}>Scoring bid against your profile…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { borderColor: Colors.error + '40' }]} testID={testID}>
        <View style={styles.heroRow}>
          <AlertTriangle size={18} color={Colors.error} />
          <Text style={[styles.title, { color: Colors.error }]}>Scoring Failed</Text>
        </View>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.runBtn} onPress={() => void runScore(true)} activeOpacity={0.85}>
          <RefreshCw size={14} color="#FFF" />
          <Text style={styles.runBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!score) return null;

  const color = scoreColor(score.matchScore);
  const decision = goNoGo(score.matchScore);
  const winPct = Math.round((score.estimatedWinProbability ?? 0));

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.heroRow}>
        <View style={styles.iconWrap}>
          <Sparkles size={18} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AI Go/No-Go Analysis</Text>
          <Text style={styles.subtitle}>Cached · tap refresh to re-score</Text>
        </View>
        <TouchableOpacity onPress={() => void runScore(true)} activeOpacity={0.7} style={styles.refreshBtn} testID="ai-rescore-btn">
          <RefreshCw size={14} color={Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowProfileSetup(true)} activeOpacity={0.7} style={styles.refreshBtn} testID="ai-edit-profile-btn">
          <Settings size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Score gauge */}
      <View style={styles.gaugeCard}>
        <View style={[styles.scoreBubble, { backgroundColor: color + '18', borderColor: color }]}>
          <Text style={[styles.scoreNum, { color }]}>{Math.round(score.matchScore)}</Text>
          <Text style={[styles.scoreOutOf, { color }]}>/ 100</Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.decisionLabel, { color }]}>{scoreLabel(score.matchScore)}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.min(100, score.matchScore)}%`, backgroundColor: color }]} />
          </View>
          <View style={styles.winRow}>
            <Target size={12} color={Colors.textMuted} />
            <Text style={styles.winText}>
              <Text style={styles.winPct}>{winPct}%</Text> est. win probability
            </Text>
          </View>
        </View>
      </View>

      {/* Recommendation pill */}
      <View style={[styles.decisionPill, {
        backgroundColor: decision === 'go' ? Colors.success + '18' : decision === 'review' ? Colors.warning + '18' : Colors.error + '18',
      }]}>
        <Text style={[styles.decisionPillText, {
          color: decision === 'go' ? Colors.success : decision === 'review' ? Colors.warning : Colors.error,
        }]}>
          {decision === 'go' ? '✓ Recommend pursuing' : decision === 'review' ? '⚠ Worth reviewing' : '✕ Recommend passing'}
        </Text>
      </View>

      {/* Why it matches */}
      {score.matchReasons && score.matchReasons.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <CheckCircle2 size={14} color={Colors.success} />
            <Text style={styles.sectionTitle}>Why it fits</Text>
          </View>
          {score.matchReasons.map((reason, i) => (
            <View key={`reason-${i}`} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: Colors.success }]} />
              <Text style={styles.bulletText}>{reason}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Concerns */}
      {score.concerns && score.concerns.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AlertTriangle size={14} color={Colors.warning} />
            <Text style={styles.sectionTitle}>Concerns</Text>
          </View>
          {score.concerns.map((concern, i) => (
            <View key={`concern-${i}`} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: Colors.warning }]} />
              <Text style={styles.bulletText}>{concern}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Strategy */}
      {score.bidStrategy ? (
        <View style={[styles.section, { backgroundColor: Colors.primary + '0C', borderRadius: 12, padding: 12 }]}>
          <View style={styles.sectionHeader}>
            <TrendingUp size={14} color={Colors.primary} />
            <Text style={[styles.sectionTitle, { color: Colors.primary }]}>Bid Strategy</Text>
          </View>
          <Text style={styles.strategyText}>{score.bidStrategy}</Text>
        </View>
      ) : null}

      <AIProfileSetup
        visible={showProfileSetup}
        onClose={() => setShowProfileSetup(false)}
        onSave={handleProfileSaved}
        initialProfile={profile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 12,
  },
  loadingContainer: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 24 },
  loadingText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  heroRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.primary + '15', alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  refreshBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const, justifyContent: 'center' as const },
  runBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.primary },
  runBtnText: { fontSize: 14, fontWeight: '700' as const, color: '#FFF' },
  errorText: { fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  gaugeCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14, backgroundColor: Colors.surfaceAlt, borderRadius: 14, padding: 14 },
  scoreBubble: { width: 72, height: 72, borderRadius: 36, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 2 },
  scoreNum: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.5 },
  scoreOutOf: { fontSize: 9, fontWeight: '700' as const, marginTop: -2 },
  decisionLabel: { fontSize: 15, fontWeight: '700' as const },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  barFill: { height: '100%' as const, borderRadius: 3 },
  winRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  winText: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' as const },
  winPct: { fontWeight: '700' as const, color: Colors.text },
  decisionPill: { alignSelf: 'flex-start' as const, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  decisionPillText: { fontSize: 12, fontWeight: '700' as const },
  section: { gap: 6 },
  sectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700' as const, color: Colors.text, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  bulletRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, paddingLeft: 4, paddingVertical: 2 },
  bulletDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 18 },
  strategyText: { fontSize: 13, color: Colors.primary, lineHeight: 18, fontWeight: '500' as const },
});

```


---

### `components/AISubEvaluator.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, HelpCircle, DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  evaluateSubcontractor, getCachedResult, setCachedResult,
  type SubEvaluationResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { Subcontractor } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  sub: Subcontractor;
  projectContext: string;
  subscriptionTier: SubscriptionTierKey;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export default React.memo(function AISubEvaluator({ sub, projectContext, subscriptionTier }: Props) {
  const [result, setResult] = useState<SubEvaluationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = useCallback(async () => {
    if (isLoading) return;

    const cacheKey = `sub_eval_${sub.id}`;
    const cached = await getCachedResult<SubEvaluationResult>(cacheKey, TWENTY_FOUR_HOURS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast');
    if (!limit.allowed) {
      Alert.alert('AI Limit Reached', limit.message ?? 'Try again tomorrow.');
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await evaluateSubcontractor(sub, projectContext);
      await recordAIUsage('fast');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Sub] Evaluation failed:', err);
      Alert.alert('AI Error', 'Could not evaluate this subcontractor. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, sub, projectContext, subscriptionTier]);

  if (!result) {
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleEvaluate} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Sparkles size={16} color={Colors.primary} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Analyzing...' : 'AI Evaluate Sub'}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Sparkles size={12} color={Colors.primary} />
        <Text style={styles.headerTitle}>AI Sub Evaluation</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <Text style={styles.recommendation}>{result.recommendation}</Text>

      {result.trackRecord ? (
        <View style={styles.trackRow}>
          <CheckCircle2 size={12} color={Colors.success} />
          <Text style={styles.trackText}>{result.trackRecord}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Questions to Ask</Text>
      {(result.questionsToAsk ?? []).map((q, idx) => (
        <View key={idx} style={styles.questionRow}>
          <HelpCircle size={12} color={Colors.info} />
          <Text style={styles.questionText}>{q}</Text>
        </View>
      ))}

      <Text style={styles.sectionLabel}>Typical Rates ({sub.trade})</Text>
      <View style={styles.rateGrid}>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Journeyman</Text>
          <Text style={styles.rateValue}>{result.typicalRates?.journeyman ?? '—'}</Text>
        </View>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Master</Text>
          <Text style={styles.rateValue}>{result.typicalRates?.master ?? '—'}</Text>
        </View>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Apprentice</Text>
          <Text style={styles.rateValue}>{result.typicalRates?.apprentice ?? '—'}</Text>
        </View>
      </View>

      {(result.redFlags ?? []).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Red Flags to Watch</Text>
          {(result.redFlags ?? []).map((flag, idx) => (
            <View key={idx} style={styles.flagRow}>
              <AlertTriangle size={12} color="#FF3B30" />
              <Text style={styles.flagText}>{flag}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  aiTag: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  recommendation: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    marginBottom: 12,
    fontWeight: '500' as const,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.successLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  trackText: {
    fontSize: 13,
    color: Colors.success,
    flex: 1,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 4,
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 6,
  },
  questionText: {
    fontSize: 13,
    color: Colors.text,
    flex: 1,
    lineHeight: 18,
  },
  rateGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  rateItem: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  rateLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  rateValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 4,
  },
  flagText: {
    fontSize: 13,
    color: '#D32F2F',
    flex: 1,
    lineHeight: 18,
  },
});

```


---

### `components/ContactPickerModal.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  FlatList, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, X, User, Mail } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { Contact, ContactRole } from '@/types';

interface ContactPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (contact: Contact) => void;
  contacts: Contact[];
  title?: string;
  filterRoles?: ContactRole[];
}

function getRoleColor(role: ContactRole): string {
  switch (role) {
    case 'Client': return Colors.primary;
    case 'Architect': return Colors.info;
    case "Owner's Rep": return Colors.accent;
    case 'Engineer': return '#6B7280';
    case 'Sub': return Colors.success;
    case 'Supplier': return '#8B5CF6';
    case 'Lender': return '#EC4899';
    case 'Inspector': return '#F59E0B';
    default: return Colors.textSecondary;
  }
}

export default function ContactPickerModal({
  visible,
  onClose,
  onSelect,
  contacts,
  title = 'Select Recipient',
  filterRoles,
}: ContactPickerModalProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = contacts;
    if (filterRoles && filterRoles.length > 0) {
      list = list.filter(c => filterRoles.includes(c.role));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(c =>
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        c.companyName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [contacts, query, filterRoles]);

  const handleSelect = useCallback((contact: Contact) => {
    onSelect(contact);
    setQuery('');
  }, [onSelect]);

  const handleClose = useCallback(() => {
    setQuery('');
    onClose();
  }, [onClose]);

  const renderItem = useCallback(({ item }: { item: Contact }) => {
    const roleColor = getRoleColor(item.role);
    const displayName = `${item.firstName} ${item.lastName}`.trim() || item.companyName;
    return (
      <TouchableOpacity
        style={styles.contactRow}
        onPress={() => handleSelect(item)}
        activeOpacity={0.7}
        testID={`pick-contact-${item.id}`}
      >
        <View style={[styles.avatar, { backgroundColor: roleColor + '18' }]}>
          <Text style={[styles.avatarText, { color: roleColor }]}>
            {(item.firstName[0] || item.companyName[0] || '?').toUpperCase()}
          </Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>{displayName}</Text>
          {item.companyName && item.firstName ? (
            <Text style={styles.contactCompany} numberOfLines={1}>{item.companyName}</Text>
          ) : null}
          <View style={styles.contactMeta}>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
              <Text style={[styles.roleBadgeText, { color: roleColor }]}>{item.role}</Text>
            </View>
            {item.email ? (
              <View style={styles.emailRow}>
                <Mail size={10} color={Colors.textMuted} />
                <Text style={styles.contactEmail} numberOfLines={1}>{item.email}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [handleSelect]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.overlayTouch} onPress={handleClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.headerTitle}>{title}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <X size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchBar}>
            <Search size={16} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search contacts..."
              placeholderTextColor={Colors.textMuted}
              autoFocus={false}
              testID="contact-picker-search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <X size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <User size={32} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>
                  {query ? 'No contacts found' : 'No contacts yet'}
                </Text>
                <Text style={styles.emptyDesc}>
                  {query ? 'Try a different search term' : 'Add contacts from the Contacts screen'}
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  overlayTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '75%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.fillTertiary,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 12,
    marginHorizontal: 22,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    gap: 8,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 12,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 17,
    fontWeight: '700' as const,
  },
  contactInfo: {
    flex: 1,
    gap: 2,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  contactCompany: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  contactMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  roleBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  contactEmail: {
    fontSize: 11,
    color: Colors.textMuted,
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  emptyDesc: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },
});

```
