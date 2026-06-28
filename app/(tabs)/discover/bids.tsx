// app/(tabs)/discover/bids.tsx — Public Bids feed.
//
// Pulls from the cached_bids table (Supabase), which a backend SAM.gov
// scraper populates daily. As of 2026-04 the cache holds ~1,380 rows;
// ~389 are NAICS 23xxxx (construction). The rest are electronics, IT,
// metalwork — surfaced raw they buried the bids the user actually
// wants. The filters here cut that noise.
//
// 2026-04-30 audit fixes shipped:
//   - DB column is `response_deadline`, not `deadline` — the previous
//     mapping silently showed "No deadline" on every card.
//   - department is null in 100% of rows; estimated_value in ~99% —
//     hide the meta when null instead of rendering "Department not
//     listed" / "$0".
//   - City casing inconsistent in source ("MECHANICSBURG" vs
//     "Mechanicsburg") — title-case for display + dedupe.
//   - Set-aside strings can run 60+ chars ("Service-Disabled Veteran-
//     Owned Small Business Set Aside") — abbreviated for the badge.
//   - Construction-only toggle, default ON, filters NAICS 23xxxx.
//   - Keyword search across title + city + state + solicitation #.
//   - Sort by Deadline / Posted / Distance / Value.
//   - User's last-picked state persists to AsyncStorage so the State
//     filter remembers across sessions.
//
// Data fields (cached_bids → CachedBid):
//   id, title, department, response_deadline, posted_date,
//   estimated_value, city, state, latitude, longitude, source_url,
//   set_aside, naics_code, solicitation_number, fetched_at

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Animated, ScrollView, Linking, Platform, Modal, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapPin, Clock, ArrowLeft, Navigation, AlertCircle, Crosshair,
  ChevronDown, X, Filter, Building, Search, Hammer, ArrowUpDown,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import MageRefreshControl from '@/components/MageRefreshControl';
import { SkeletonRow } from '@/components/Skeleton';
import { supabase } from '@/lib/supabase';
import { useUserLocation, getDistanceMiles } from '@/utils/location';
import { US_STATES } from '@/constants/states';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface CachedBid {
  id: string;
  title: string | null;
  department: string | null;
  response_deadline: string | null;
  posted_date: string | null;
  estimated_value: number | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  source_url: string | null;
  set_aside: string | null;
  naics_code: string | null;
  solicitation_number: string | null;
  fetched_at: string;
}

interface BidWithDistance extends CachedBid {
  distance: number | null;
  /** Pre-computed "looks like construction" so we don't re-evaluate
   *  on every filter pass. NAICS 23xxxx is the construction sector. */
  isConstruction: boolean;
}

interface NearbyCity {
  city: string;
  state: string;
  distance: number;
  count: number;
}

type SortKey = 'deadline' | 'posted' | 'distance' | 'value';
type LocationMode = 'all' | 'nearby' | 'state' | 'city';

const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;

// Pretty short labels mapped from SAM.gov's verbose set-aside strings.
// We match by substring so the cache's free-form text still groups.
const SET_ASIDE_TYPES = [
  { label: 'Small Business', match: ['small business set-aside', 'sba', 'sbsa'] },
  { label: 'Veteran (SDVOSB)', match: ['service-disabled veteran', 'sdvosb'] },
  { label: 'Veteran (VOSB)',   match: ['veteran-owned small business', 'vosb'] },
  { label: 'Women (WOSB)',     match: ['women-owned small business', 'wosb'] },
  { label: '8(a)',             match: ['8(a)'] },
  { label: 'HUBZone',          match: ['hubzone'] },
  { label: 'MWBE',             match: ['mwbe', 'minority'] },
  { label: 'No Set-Aside',     match: ['no set aside', 'no set-aside'] },
] as const;

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'deadline', label: 'Deadline' },
  { key: 'posted',   label: 'Newest' },
  { key: 'distance', label: 'Nearest' },
  { key: 'value',    label: 'Value' },
];

const STATE_STORAGE_KEY = 'bids_home_state';
const LOCATION_MODE_STORAGE_KEY = 'bids_location_mode';
const CONSTRUCTION_ONLY_STORAGE_KEY = 'bids_construction_only';

// ─── Display helpers ─────────────────────────────────────────────────

/** Title-case a city. Source data is mixed CASE / Mixed Case / lowercase. */
function prettyCity(city: string | null | undefined): string {
  if (!city) return '';
  return city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Short label for a set-aside string. Returns '' when the original
 *  is "no set aside" / null so the badge can render an "Open" pill. */
function prettySetAside(raw: string | null | undefined): string {
  if (!raw) return '';
  const lower = raw.toLowerCase();
  for (const t of SET_ASIDE_TYPES) {
    if (t.match.some((m) => lower.includes(m))) {
      return t.label === 'No Set-Aside' ? '' : t.label;
    }
  }
  // Unknown — truncate so the badge doesn't blow out.
  return raw.length > 22 ? raw.slice(0, 20).trim() + '…' : raw;
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || amount <= 0) return '';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

function getDeadlineInfo(deadline: string | null | undefined): { text: string; color: string; bgColor: string; sortableMs: number } {
  if (!deadline) return { text: 'No deadline', color: '#9E9E9E', bgColor: '#F5F5F5', sortableMs: Number.MAX_SAFE_INTEGER };
  const ms = new Date(deadline).getTime() - Date.now();
  if (isNaN(ms)) return { text: 'No deadline', color: '#9E9E9E', bgColor: '#F5F5F5', sortableMs: Number.MAX_SAFE_INTEGER };
  if (ms <= 0) return { text: 'Expired', color: '#9E9E9E', bgColor: '#F5F5F5', sortableMs: Number.MAX_SAFE_INTEGER - 1 };
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 3) return { text: `${days}d ${Math.floor((ms % 86_400_000) / 3_600_000)}h left`, color: '#D32F2F', bgColor: Colors.errorLight, sortableMs: ms };
  if (days <= 7) return { text: `${days} days left`, color: '#F57F17', bgColor: '#FFF8E1', sortableMs: ms };
  if (days > 30) return { text: `${Math.floor(days / 30)}mo ${days % 30}d left`, color: Colors.successDark, bgColor: Colors.successLight, sortableMs: ms };
  return { text: `${days} days left`, color: Colors.successDark, bgColor: Colors.successLight, sortableMs: ms };
}

/** Some SAM.gov titles arrive with leading "Z--" or trailing letter
 *  codes that exist for federal cataloguing — strip them so the human
 *  reads the actual subject. */
function cleanTitle(t: string | null | undefined): string {
  if (!t) return 'Untitled bid';
  return t.replace(/^[A-Z]--\s*/, '').replace(/\s+/g, ' ').trim();
}

// ─── Bid card ────────────────────────────────────────────────────────

function BidCard({ bid, onPress }: { bid: BidWithDistance; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const deadlineInfo = getDeadlineInfo(bid.response_deadline);
  const setAsideLabel = prettySetAside(bid.set_aside);
  const valueLabel = formatCurrency(bid.estimated_value);
  const cityLabel = prettyCity(bid.city);
  const stateLabel = bid.state ? bid.state.toUpperCase() : '';
  const locationLabel = cityLabel && stateLabel ? `${cityLabel}, ${stateLabel}` : (cityLabel || stateLabel || 'Location TBD');

  return (
    <Animated.View style={[styles.bidCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        testID={`cached-bid-${bid.id}`}
      >
        <View style={styles.bidHeader}>
          {setAsideLabel ? (
            <View style={styles.setAsideBadge}>
              <Text style={styles.setAsideText} numberOfLines={1}>{setAsideLabel}</Text>
            </View>
          ) : (
            <View style={styles.openBadge}>
              <Text style={styles.openBadgeText}>OPEN</Text>
            </View>
          )}
          {bid.isConstruction && (
            <View style={styles.constructionBadge}>
              <Hammer size={10} color="#3D2A0F" strokeWidth={1.75} />
              <Text style={styles.constructionText}>Construction</Text>
            </View>
          )}
          <View style={[styles.countdownBadge, { backgroundColor: deadlineInfo.bgColor }]}>
            <Clock size={11} color={deadlineInfo.color} strokeWidth={1.75} />
            <Text style={[styles.countdownText, { color: deadlineInfo.color }]}>{deadlineInfo.text}</Text>
          </View>
        </View>

        <Text style={styles.bidTitle} numberOfLines={3}>{cleanTitle(bid.title)}</Text>

        {bid.department ? (
          <Text style={styles.bidDepartment} numberOfLines={1}>{bid.department}</Text>
        ) : null}

        <View style={styles.bidMeta}>
          <View style={styles.metaItem}>
            <MapPin size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.metaText} numberOfLines={1}>{locationLabel}</Text>
          </View>
          {bid.distance !== null && (
            <View style={styles.distanceTag}>
              <Navigation size={10} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.distanceTagText}>{bid.distance} mi</Text>
            </View>
          )}
          {valueLabel ? (
            <View style={styles.valueTag}>
              <Text style={styles.valueTagText}>{valueLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.bidFooter}>
          <View style={styles.footerLeft}>
            {bid.naics_code ? (
              <Text style={styles.naicsTag}>NAICS {bid.naics_code}</Text>
            ) : null}
            {bid.solicitation_number ? (
              <Text style={styles.solTag} numberOfLines={1}>#{bid.solicitation_number}</Text>
            ) : null}
          </View>
          <Text style={styles.deadlineDate}>
            {bid.response_deadline
              ? `Due ${new Date(bid.response_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : ''}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────

export default function CachedBidsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { location } = useUserLocation();

  // Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [constructionOnly, setConstructionOnly] = useState<boolean>(true);
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
  const [selectedSetAside, setSelectedSetAside] = useState<string | undefined>();
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [locationMode, setLocationMode] = useState<LocationMode>('all');
  const [sortBy, setSortBy] = useState<SortKey>('deadline');

  // Modals
  const [showStateList, setShowStateList] = useState(false);
  const [showSetAsideDropdown, setShowSetAsideDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  // Hydrate persisted filter state on mount. Don't block the first
  // render — defaults keep the screen usable while AsyncStorage warms.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [savedState, savedMode, savedConstruction] = await Promise.all([
          AsyncStorage.getItem(STATE_STORAGE_KEY),
          AsyncStorage.getItem(LOCATION_MODE_STORAGE_KEY),
          AsyncStorage.getItem(CONSTRUCTION_ONLY_STORAGE_KEY),
        ]);
        if (cancelled) return;
        if (savedState) setSelectedState(savedState);
        if (savedMode === 'state' || savedMode === 'all' || savedMode === 'nearby' || savedMode === 'city') {
          setLocationMode(savedMode as LocationMode);
        } else if (savedState) {
          // Implied: if a state is saved, default to state mode.
          setLocationMode('state');
        }
        if (savedConstruction === '0') setConstructionOnly(false);
      } catch (e) {
        console.log('[CachedBids] failed to hydrate filters', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist when state/mode/construction toggle change.
  useEffect(() => {
    if (selectedState) AsyncStorage.setItem(STATE_STORAGE_KEY, selectedState).catch(() => {});
    AsyncStorage.setItem(LOCATION_MODE_STORAGE_KEY, locationMode).catch(() => {});
    AsyncStorage.setItem(CONSTRUCTION_ONLY_STORAGE_KEY, constructionOnly ? '1' : '0').catch(() => {});
  }, [selectedState, locationMode, constructionOnly]);

  const { data: bids, isLoading, refetch, isRefetching, error: bidsQueryError } = useQuery({
    queryKey: ['cached_bids'],
    queryFn: async (): Promise<CachedBid[]> => {
      try {
        const { data, error } = await supabase
          .from('cached_bids')
          .select('id,title,department,response_deadline,posted_date,estimated_value,city,state,latitude,longitude,source_url,set_aside,naics_code,solicitation_number,fetched_at')
          .order('response_deadline', { ascending: true, nullsFirst: false })
          .limit(2000);
        if (error) {
          console.log('[CachedBids] supabase error:', error.message);
          return [];
        }
        return (data ?? []) as CachedBid[];
      } catch (err) {
        console.log('[CachedBids] network/fetch error:', String(err));
        return [];
      }
    },
    retry: 1,
  });

  const bidsWithMeta = useMemo<BidWithDistance[]>(() => {
    if (!bids) return [];
    return bids.map((bid): BidWithDistance => ({
      ...bid,
      distance: location && bid.latitude != null && bid.longitude != null
        ? getDistanceMiles(location.latitude, location.longitude, bid.latitude, bid.longitude)
        : null,
      isConstruction: !!(bid.naics_code && bid.naics_code.startsWith('23')),
    }));
  }, [bids, location]);

  const nearbyCities = useMemo<NearbyCity[]>(() => {
    if (!bidsWithMeta.length) return [];
    const cityMap = new Map<string, { city: string; state: string; distance: number; count: number }>();
    for (const bid of bidsWithMeta) {
      if (!bid.city) continue;
      const cleanedCity = prettyCity(bid.city);
      const cleanedState = (bid.state ?? '').toUpperCase();
      const key = `${cleanedCity}_${cleanedState}`;
      const existing = cityMap.get(key);
      if (existing) {
        existing.count += 1;
        if (bid.distance !== null && bid.distance < existing.distance) existing.distance = bid.distance;
      } else {
        cityMap.set(key, { city: cleanedCity, state: cleanedState, distance: bid.distance ?? 99999, count: 1 });
      }
    }
    return Array.from(cityMap.values())
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 24);
  }, [bidsWithMeta]);

  const filteredBids = useMemo(() => {
    let result = bidsWithMeta;

    if (constructionOnly) result = result.filter((b) => b.isConstruction);

    if (selectedSetAside) {
      const wanted = SET_ASIDE_TYPES.find((s) => s.label === selectedSetAside);
      if (selectedSetAside === 'Open / No Set-Aside') {
        result = result.filter((b) => {
          const lbl = prettySetAside(b.set_aside);
          return !lbl;
        });
      } else if (wanted) {
        result = result.filter((b) => prettySetAside(b.set_aside) === wanted.label);
      }
    }

    if (locationMode === 'nearby' && location && selectedRadius !== null) {
      result = result.filter((b) => b.distance !== null && b.distance <= selectedRadius);
    }
    if (locationMode === 'state' && selectedState) {
      result = result.filter((b) => (b.state ?? '').toUpperCase() === selectedState.toUpperCase());
    }
    if (locationMode === 'city' && selectedCity) {
      const wanted = selectedCity.toLowerCase();
      result = result.filter((b) => (b.city ?? '').toLowerCase() === wanted);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((b) =>
        (b.title ?? '').toLowerCase().includes(q)
        || (b.city ?? '').toLowerCase().includes(q)
        || (b.state ?? '').toLowerCase().includes(q)
        || (b.solicitation_number ?? '').toLowerCase().includes(q)
        || (b.naics_code ?? '').toLowerCase().includes(q)
        || (b.department ?? '').toLowerCase().includes(q)
      );
    }

    // Sort
    const sorted = [...result];
    if (sortBy === 'deadline') {
      sorted.sort((a, b) => {
        const at = getDeadlineInfo(a.response_deadline).sortableMs;
        const bt = getDeadlineInfo(b.response_deadline).sortableMs;
        return at - bt;
      });
    } else if (sortBy === 'posted') {
      sorted.sort((a, b) => {
        const at = a.posted_date ? new Date(a.posted_date).getTime() : 0;
        const bt = b.posted_date ? new Date(b.posted_date).getTime() : 0;
        return bt - at;
      });
    } else if (sortBy === 'distance') {
      sorted.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    } else if (sortBy === 'value') {
      sorted.sort((a, b) => (b.estimated_value ?? 0) - (a.estimated_value ?? 0));
    }
    return sorted;
  }, [bidsWithMeta, constructionOnly, selectedSetAside, locationMode, selectedRadius, selectedState, selectedCity, searchQuery, location, sortBy]);

  const handleBidPress = useCallback((bid: CachedBid) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (bid.source_url) {
      Linking.openURL(bid.source_url).catch(() => {});
    }
  }, []);

  const handleLocationModeChange = useCallback((mode: LocationMode) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setLocationMode(mode);
    if (mode === 'nearby' && selectedRadius === null) setSelectedRadius(50);
    if (mode === 'state') setShowStateList(true); else setShowStateList(false);
    if (mode !== 'city') setSelectedCity(null);
  }, [selectedRadius]);

  const handleSetAsideSelect = useCallback((value: string | undefined) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedSetAside(value);
    setShowSetAsideDropdown(false);
  }, []);

  const handleSortSelect = useCallback((key: SortKey) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSortBy(key);
    setShowSortDropdown(false);
  }, []);

  const clearAllFilters = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearchQuery('');
    setSelectedSetAside(undefined);
    setSelectedRadius(null);
    setSelectedCity(null);
    setLocationMode('all');
    setSortBy('deadline');
  }, []);

  const renderBid = useCallback(({ item }: { item: BidWithDistance }) => (
    <BidCard bid={item} onPress={() => handleBidPress(item)} />
  ), [handleBidPress]);

  const totalCount = bidsWithMeta.length;
  const filteredCount = filteredBids.length;
  const sortLabel = SORT_OPTIONS.find((s) => s.key === sortBy)?.label ?? 'Sort';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
            <ArrowLeft size={20} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Public Bids</Text>
            <Text style={styles.headerSubtitle}>
              {filteredCount === totalCount
                ? `${totalCount.toLocaleString()} active`
                : `${filteredCount.toLocaleString()} of ${totalCount.toLocaleString()}`}
              {' · SAM.gov'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.sortBtn}
            onPress={() => { setShowSortDropdown(true); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            activeOpacity={0.7}
          >
            <ArrowUpDown size={14} color={themeColors.text} strokeWidth={1.75} />
            <Text style={styles.sortBtnText}>{sortLabel}</Text>
          </TouchableOpacity>
        </View>

        {/* Search box */}
        <View style={styles.searchWrap}>
          <Search size={15} color={themeColors.textMuted} strokeWidth={1.75} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search title, city, NAICS, solicitation #"
            placeholderTextColor={themeColors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Close">
              <X size={15} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Filter pill row 1: Construction toggle + Set-Aside */}
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={[styles.pill, constructionOnly && styles.pillActive]}
            onPress={() => { setConstructionOnly(!constructionOnly); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            activeOpacity={0.85}
          >
            <Hammer size={12} color={constructionOnly ? '#FFF' : themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.pillText, constructionOnly && styles.pillTextActive]}>Construction</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, selectedSetAside ? styles.pillActive : null]}
            onPress={() => { setShowSetAsideDropdown(true); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            activeOpacity={0.85}
          >
            <Filter size={12} color={selectedSetAside ? '#FFF' : themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.pillText, selectedSetAside ? styles.pillTextActive : null]} numberOfLines={1}>
              {selectedSetAside ?? 'Set-aside'}
            </Text>
            <ChevronDown size={12} color={selectedSetAside ? '#FFF' : themeColors.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        {/* Filter pill row 2: Location modes */}
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={[styles.pill, locationMode === 'all' && styles.pillActive]}
            onPress={() => handleLocationModeChange('all')}
            activeOpacity={0.85}
          >
            <Text style={[styles.pillText, locationMode === 'all' && styles.pillTextActive]}>All US</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, locationMode === 'nearby' && styles.pillActive]}
            onPress={() => handleLocationModeChange('nearby')}
            activeOpacity={0.85}
          >
            <Crosshair size={12} color={locationMode === 'nearby' ? '#FFF' : themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.pillText, locationMode === 'nearby' && styles.pillTextActive]}>Near me</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, locationMode === 'city' && styles.pillActive]}
            onPress={() => handleLocationModeChange('city')}
            activeOpacity={0.85}
          >
            <Building size={12} color={locationMode === 'city' ? '#FFF' : themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.pillText, locationMode === 'city' && styles.pillTextActive]}>City</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, locationMode === 'state' && styles.pillActive]}
            onPress={() => handleLocationModeChange('state')}
            activeOpacity={0.85}
          >
            <Text style={[styles.pillText, locationMode === 'state' && styles.pillTextActive]}>
              {selectedState ?? 'State'}
            </Text>
            <ChevronDown size={12} color={locationMode === 'state' ? '#FFF' : themeColors.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        {/* Sub-filter (radius / city / state list) — only one shows at a time */}
        {locationMode === 'nearby' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subFilterRow} contentContainerStyle={styles.subFilterRowInner}>
            {RADIUS_OPTIONS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.subChip, selectedRadius === r && styles.subChipActive]}
                onPress={() => { setSelectedRadius(r); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
              >
                <Text style={[styles.subChipText, selectedRadius === r && styles.subChipTextActive]}>{r} mi</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {locationMode === 'city' && nearbyCities.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subFilterRow} contentContainerStyle={styles.subFilterRowInner}>
            {nearbyCities.map((c) => {
              const active = selectedCity?.toLowerCase() === c.city.toLowerCase();
              return (
                <TouchableOpacity
                  key={`${c.city}_${c.state}`}
                  style={[styles.cityChip, active && styles.subChipActive]}
                  onPress={() => {
                    setSelectedCity(active ? null : c.city);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.cityChipName, active && styles.subChipTextActive]} numberOfLines={1}>
                    {c.city}{c.state ? `, ${c.state}` : ''}
                  </Text>
                  <Text style={[styles.cityChipMeta, active && { color: 'rgba(255,255,255,0.78)' }]}>
                    {c.distance < 99999 ? `${c.distance}mi · ` : ''}{c.count} bid{c.count === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {locationMode === 'state' && showStateList && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subFilterRow} contentContainerStyle={styles.subFilterRowInner}>
            {US_STATES.map((s) => {
              const active = selectedState === s.abbr;
              return (
                <TouchableOpacity
                  key={s.abbr}
                  style={[styles.subChip, active && styles.subChipActive]}
                  onPress={() => {
                    setSelectedState(active ? null : s.abbr);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.subChipText, active && styles.subChipTextActive]}>{s.abbr}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Sort dropdown */}
      <Modal
        visible={showSortDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSortDropdown(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSortDropdown(false)}>
          <View style={styles.dropdownModal}>
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>Sort by</Text>
              <TouchableOpacity onPress={() => setShowSortDropdown(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.dropdownItem, sortBy === opt.key && styles.dropdownItemActive]}
                onPress={() => handleSortSelect(opt.key)}
              >
                <Text style={[styles.dropdownItemText, sortBy === opt.key && styles.dropdownItemTextActive]}>{opt.label}</Text>
                {sortBy === opt.key && <View style={styles.dropdownCheck} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Set-Aside dropdown */}
      <Modal
        visible={showSetAsideDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSetAsideDropdown(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowSetAsideDropdown(false)}>
          <View style={styles.dropdownModal}>
            <View style={styles.dropdownHeader}>
              <Text style={styles.dropdownTitle}>Set-aside type</Text>
              <TouchableOpacity onPress={() => setShowSetAsideDropdown(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.dropdownItem, !selectedSetAside && styles.dropdownItemActive]}
              onPress={() => handleSetAsideSelect(undefined)}
            >
              <Text style={[styles.dropdownItemText, !selectedSetAside && styles.dropdownItemTextActive]}>All types</Text>
              {!selectedSetAside && <View style={styles.dropdownCheck} />}
            </TouchableOpacity>
            {SET_ASIDE_TYPES.filter((s) => s.label !== 'No Set-Aside').map((sa) => (
              <TouchableOpacity
                key={sa.label}
                style={[styles.dropdownItem, selectedSetAside === sa.label && styles.dropdownItemActive]}
                onPress={() => handleSetAsideSelect(selectedSetAside === sa.label ? undefined : sa.label)}
              >
                <Text style={[styles.dropdownItemText, selectedSetAside === sa.label && styles.dropdownItemTextActive]}>{sa.label}</Text>
                {selectedSetAside === sa.label && <View style={styles.dropdownCheck} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.dropdownItem, selectedSetAside === 'Open / No Set-Aside' && styles.dropdownItemActive]}
              onPress={() => handleSetAsideSelect(selectedSetAside === 'Open / No Set-Aside' ? undefined : 'Open / No Set-Aside')}
            >
              <Text style={[styles.dropdownItemText, selectedSetAside === 'Open / No Set-Aside' && styles.dropdownItemTextActive]}>Open / No set-aside</Text>
              {selectedSetAside === 'Open / No Set-Aside' && <View style={styles.dropdownCheck} />}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {bidsQueryError ? (
        <View style={styles.loadingContainer}>
          <AlertCircle size={40} color="#D32F2F" strokeWidth={1.75} />
          <Text style={styles.emptyTitle}>Couldn't load bids</Text>
          <Text style={styles.emptySubtitle}>{bidsQueryError.message}</Text>
          <TouchableOpacity onPress={() => { void refetch(); }} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : isLoading ? (
        <View>
          {[0, 1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filteredBids}
          renderItem={renderBid}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <MageRefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={40} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyTitle}>No bids match these filters</Text>
              <Text style={styles.emptySubtitle}>
                {totalCount > 0
                  ? `${totalCount.toLocaleString()} bids in the cache. Loosen your filters to see more.`
                  : 'The SAM.gov sync is still warming up. Pull to refresh.'}
              </Text>
              <TouchableOpacity onPress={clearAllFilters} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Clear all filters</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  // ─── Header
  header: { backgroundColor: t.surface, borderBottomWidth: 0.5, borderBottomColor: t.line, paddingHorizontal: 16, paddingBottom: 12 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 8, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: Tokens.radius.xl, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1, fontWeight: '500' as const },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md,
  },
  sortBtnText: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },

  // ─── Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.card,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 9 : 4,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1, fontSize: Type.bodyCompact.fontSize, color: t.text,
    paddingVertical: Platform.OS === 'ios' ? 0 : 6,
  },

  // ─── Pill rows (top-level filters)
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: 'transparent',
  },
  pillActive: { backgroundColor: t.accent, borderColor: t.accent },
  pillText: { fontSize: 12.5, color: t.textSecondary, fontWeight: '600' as const, letterSpacing: -0.1 },
  pillTextActive: { color: '#FFF' },

  // ─── Sub-filter row (radius / city / state chips)
  subFilterRow: { marginBottom: 4 },
  subFilterRowInner: { paddingRight: 16, gap: 6 },
  subChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
  },
  subChipActive: { backgroundColor: t.accent },
  subChipText: { fontSize: 12.5, color: t.textSecondary, fontWeight: '600' as const },
  subChipTextActive: { color: '#FFF' },
  cityChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surfaceAlt,
    minWidth: 110,
  },
  cityChipName: { fontSize: 12.5, color: t.text, fontWeight: '700' as const },
  cityChipMeta: { fontSize: 10.5, color: t.textMuted, marginTop: 1 },

  // ─── Cards
  list: { padding: 16, paddingBottom: 100 },
  bidCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 16, marginBottom: 12,
    // Black outline matches every other card across the app.
    borderWidth: 1, borderColor: t.line,
  },
  bidHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  setAsideBadge: { backgroundColor: Colors.successLight, paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.xs },
  setAsideText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: '#1E5128', letterSpacing: 0.2 },
  openBadge: { backgroundColor: Colors.infoLight, paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.xs },
  openBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: '#0D47A1', letterSpacing: 0.6 },
  constructionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFF4E0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.xs,
  },
  constructionText: { fontSize: 10.5, fontWeight: '800' as const, color: '#3D2A0F', letterSpacing: 0.2 },
  countdownBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.xs,
    marginLeft: 'auto' as const,
  },
  countdownText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },

  bidTitle: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 4, lineHeight: 21, letterSpacing: -0.2 },
  bidDepartment: { fontSize: 12.5, color: t.textSecondary, marginBottom: 8, fontWeight: '500' as const },

  bidMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 },
  metaText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const, flexShrink: 1 },
  distanceTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.infoLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs,
  },
  distanceTagText: { fontSize: 11.5, fontWeight: '700' as const, color: t.info },
  valueTag: {
    backgroundColor: t.accent + '14', paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs,
  },
  valueTagText: { fontSize: 11.5, fontWeight: '800' as const, color: t.accent },

  bidFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 12, paddingTop: 10,
    borderTopWidth: 0.5, borderTopColor: t.line,
    gap: 8,
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  naicsTag: { fontSize: 10.5, color: t.textMuted, fontWeight: '700' as const, letterSpacing: 0.4 },
  solTag: { fontSize: 10.5, color: t.textMuted, fontWeight: '500' as const, fontVariant: ['tabular-nums' as const], maxWidth: 120 },
  deadlineDate: { fontSize: 11.5, color: t.textMuted, fontWeight: '600' as const },

  // ─── States
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginTop: 6 },
  emptySubtitle: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
  retryButton: { marginTop: 14, backgroundColor: t.accent, paddingHorizontal: 22, paddingVertical: 11, borderRadius: Tokens.radius.md },
  retryButtonText: { color: '#FFF', fontWeight: '700' as const, fontSize: Type.bodyCompact.fontSize },

  // ─── Modal (sort + set-aside)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'center', alignItems: 'center' },
  dropdownModal: {
    width: '82%', backgroundColor: t.surface, borderRadius: Tokens.radius.panel, paddingVertical: 8, maxHeight: 460,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 12,
  },
  dropdownHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: t.line,
  },
  dropdownTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  dropdownItemActive: { backgroundColor: t.accent + '0E' },
  dropdownItemText: { fontSize: Type.subhead.fontSize, color: t.text, fontWeight: '500' as const },
  dropdownItemTextActive: { color: t.accent, fontWeight: '700' as const },
  dropdownCheck: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.accent },
});
