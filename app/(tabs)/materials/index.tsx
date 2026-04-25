import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Animated, AppState, Alert, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, TrendingDown, Search, X, RefreshCw, Clock, Wifi, Bell, Pause, Play, Trash2, MapPin, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import MageRefreshControl from '@/components/MageRefreshControl';
import { CATEGORY_META, getLivePrices, type MaterialItem } from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import { REGIONS, CITY_ADJUSTMENTS, getRegionForState } from '@/constants/regions';
import type { PricingRegion } from '@/types';

const ALL_CATEGORIES = Object.keys(CATEGORY_META);

interface CategorySummary {
  name: string;
  label: string;
  emoji: string;
  color: string;
  itemCount: number;
  priceRange: { min: number; max: number };
  avgDiscount: number;
}

export default function MaterialsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { priceAlerts, updatePriceAlert, deletePriceAlert } = useProjects();
  const [searchQuery, setSearchQuery] = useState('');
  const [materials, setMaterials] = useState<MaterialItem[]>(() => getLivePrices(Date.now() / 10000));
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<PricingRegion>('mid_atlantic');
  const [selectedCity, setSelectedCity] = useState<string>('New York City');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const appState = useRef(AppState.currentState);

  const regionInfo = useMemo(() => REGIONS.find(r => r.id === selectedRegion), [selectedRegion]);
  const locationMultiplier = useMemo(() => {
    const cityAdj = CITY_ADJUSTMENTS[selectedCity];
    if (cityAdj) return cityAdj;
    return regionInfo?.costIndex ?? 1.0;
  }, [selectedCity, regionInfo]);

  const refreshPrices = useCallback((showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    const seed = Date.now() / 10000;
    const newPrices = getLivePrices(seed);
    setMaterials(newPrices);
    setLastUpdated(new Date());
    if (showRefreshing) setTimeout(() => setRefreshing(false), 600);

    priceAlerts.forEach(alert => {
      if (alert.isPaused || alert.isTriggered) return;
      const mat = newPrices.find(m => m.id === alert.materialId);
      if (!mat) return;
      const triggered = alert.direction === 'below'
        ? mat.baseRetailPrice <= alert.targetPrice
        : mat.baseRetailPrice >= alert.targetPrice;
      if (triggered) {
        updatePriceAlert(alert.id, { isTriggered: true, currentPrice: mat.baseRetailPrice });
        Alert.alert('Price Alert', `${alert.materialName} is now $${mat.baseRetailPrice.toFixed(2)} — ${alert.direction === 'below' ? 'below' : 'above'} your $${alert.targetPrice.toFixed(2)} target.`);
      } else {
        updatePriceAlert(alert.id, { currentPrice: mat.baseRetailPrice });
      }
    });
  }, [priceAlerts, updatePriceAlert]);

  useEffect(() => {
    const interval = setInterval(() => refreshPrices(false), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshPrices]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') refreshPrices(false);
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [refreshPrices]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const categories: CategorySummary[] = useMemo(() => {
    const grouped: Record<string, MaterialItem[]> = {};
    materials.forEach(m => {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m);
    });

    return ALL_CATEGORIES
      .filter(cat => grouped[cat])
      .map(cat => {
        const items = grouped[cat];
        const meta = CATEGORY_META[cat] ?? { color: Colors.primary, emoji: '📦', label: cat };
        const prices = items.map(i => i.baseBulkPrice);
        const discounts = items.map(i => {
          if (i.baseRetailPrice <= 0) return 0;
          return ((i.baseRetailPrice - i.baseBulkPrice) / i.baseRetailPrice) * 100;
        });
        return {
          name: cat,
          label: meta.label,
          emoji: meta.emoji,
          color: meta.color,
          itemCount: items.length,
          priceRange: { min: Math.min(...prices), max: Math.max(...prices) },
          avgDiscount: Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length),
        };
      });
  }, [materials]);

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const q = searchQuery.toLowerCase();
    return categories.filter(cat =>
      cat.label.toLowerCase().includes(q) ||
      cat.name.toLowerCase().includes(q)
    );
  }, [categories, searchQuery]);

  const totalCount = categories.reduce((s, c) => s + c.itemCount, 0);
  const triggeredAlerts = priceAlerts.filter(a => a.isTriggered && !a.isPaused);

  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleCategoryPress = useCallback((categoryName: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push(`/(tabs)/materials/${categoryName}`);
  }, [router]);

  const renderCategory = useCallback(({ item }: { item: CategorySummary }) => {
    const alertCount = priceAlerts.filter(a =>
      materials.some(m => m.id === a.materialId && m.category === item.name)
    ).length;

    return (
      <TouchableOpacity
        style={styles.categoryCard}
        onPress={() => handleCategoryPress(item.name)}
        activeOpacity={0.65}
        testID={`cat-${item.name}`}
      >
        <View style={styles.categoryCardInner}>
          <View style={[styles.categoryEmoji, { backgroundColor: item.color + '15' }]}>
            <Text style={styles.emojiText}>{item.emoji}</Text>
          </View>
          <View style={styles.categoryInfo}>
            <View style={styles.categoryTitleRow}>
              <Text style={styles.categoryName}>{item.label}</Text>
              {alertCount > 0 && (
                <View style={styles.categoryAlertDot}>
                  <Bell size={9} color={Colors.accent} />
                </View>
              )}
            </View>
            <Text style={styles.categoryCount}>{item.itemCount} items</Text>
            <View style={styles.categoryStats}>
              <Text style={styles.priceRangeText}>
                ${(item.priceRange.min * locationMultiplier).toFixed(2)} – ${(item.priceRange.max * locationMultiplier).toFixed(2)}
              </Text>
              {item.avgDiscount > 0 && (
                <View style={styles.discountChip}>
                  <Text style={styles.discountChipText}>avg -{item.avgDiscount}%</Text>
                </View>
              )}
            </View>
          </View>
          <ChevronRight size={16} color={Colors.textMuted} strokeWidth={2} />
        </View>
      </TouchableOpacity>
    );
  }, [handleCategoryPress, priceAlerts, materials, locationMultiplier]);

  const keyExtractor = useCallback((item: CategorySummary) => item.name, []);

  const ListHeader = useMemo(() => (
    <View>
      <View style={[styles.headerArea, { paddingTop: insets.top + 4 }]}>
        <View>
          <Text style={styles.largeTitle}>Materials</Text>
          <View style={styles.liveRow}>
            <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.liveLabel}>LIVE PRICING</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {priceAlerts.length > 0 && (
            <TouchableOpacity
              style={[styles.refreshBtn, showAlerts && { backgroundColor: Colors.accent + '20' }]}
              onPress={() => setShowAlerts(!showAlerts)}
              activeOpacity={0.7}
            >
              <Bell size={15} color={showAlerts ? Colors.accent : Colors.primary} />
              {triggeredAlerts.length > 0 && (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>{triggeredAlerts.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => refreshPrices(true)}
            activeOpacity={0.7}
            testID="refresh-prices"
          >
            <RefreshCw size={15} color={Colors.primary} />
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={styles.locationBanner}
        onPress={() => setShowLocationPicker(!showLocationPicker)}
        activeOpacity={0.7}
      >
        <MapPin size={14} color={Colors.primary} />
        <Text style={styles.locationText}>
          Pricing for <Text style={styles.locationBold}>{selectedCity}</Text>
          {' '}({regionInfo?.label ?? 'US Average'})
        </Text>
        <View style={styles.locationMultiplier}>
          <Text style={styles.multiplierText}>{locationMultiplier > 1 ? '+' : ''}{((locationMultiplier - 1) * 100).toFixed(0)}%</Text>
        </View>
        <ChevronDown size={14} color={Colors.textSecondary} />
      </TouchableOpacity>

      {showLocationPicker && (
        <View style={styles.locationPicker}>
          <Text style={styles.pickerLabel}>REGION</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
            {REGIONS.map(region => (
              <TouchableOpacity
                key={region.id}
                style={[styles.pickerChip, selectedRegion === region.id && styles.pickerChipActive]}
                onPress={() => {
                  setSelectedRegion(region.id);
                  setSelectedCity(region.label);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.pickerChipText, selectedRegion === region.id && styles.pickerChipTextActive]}>
                  {region.label}
                </Text>
                <Text style={[styles.pickerChipSub, selectedRegion === region.id && styles.pickerChipTextActive]}>
                  {region.costIndex > 1 ? '+' : ''}{((region.costIndex - 1) * 100).toFixed(0)}%
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[styles.pickerLabel, { marginTop: 8 }]}>METRO AREA</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
            {Object.entries(CITY_ADJUSTMENTS).map(([city, adj]) => (
              <TouchableOpacity
                key={city}
                style={[styles.pickerChip, selectedCity === city && styles.pickerChipActive]}
                onPress={() => {
                  setSelectedCity(city);
                  const stateMap: Record<string, string> = {
                    'New York City': 'NY', 'San Francisco': 'CA', 'Los Angeles': 'CA',
                    'Chicago': 'IL', 'Boston': 'MA', 'Seattle': 'WA', 'Miami': 'FL',
                    'Houston': 'TX', 'Dallas': 'TX', 'Atlanta': 'GA', 'Denver': 'CO',
                    'Phoenix': 'AZ', 'Philadelphia': 'PA', 'Washington DC': 'DC',
                    'Detroit': 'MI', 'Minneapolis': 'MN', 'Portland': 'OR',
                    'Las Vegas': 'NV', 'Nashville': 'TN', 'Charlotte': 'NC',
                  };
                  const st = stateMap[city];
                  if (st) {
                    const r = getRegionForState(st);
                    if (r) setSelectedRegion(r.id);
                  }
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.pickerChipText, selectedCity === city && styles.pickerChipTextActive]}>{city}</Text>
                <Text style={[styles.pickerChipSub, selectedCity === city && styles.pickerChipTextActive]}>
                  {adj > 1 ? '+' : ''}{((adj - 1) * 100).toFixed(0)}%
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.updatedRow}>
        <Clock size={11} color={Colors.textMuted} />
        <Text style={styles.updatedText}>Prices updated {formatTime(lastUpdated)} · {selectedCity} rates · Pull to refresh</Text>
        <Wifi size={11} color={Colors.success} />
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search size={15} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search categories..."
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            selectionColor={Colors.primary}
            underlineColorAndroid="transparent"
            testID="materials-search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <View style={styles.clearBtn}>
                <X size={10} color="#fff" />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showAlerts && priceAlerts.length > 0 && (
        <View style={styles.alertsSection}>
          <Text style={styles.alertsSectionTitle}>PRICE ALERTS ({priceAlerts.length})</Text>
          {priceAlerts.map(alert => {
            const progress = alert.direction === 'below'
              ? Math.max(0, Math.min(1, (alert.currentPrice - alert.targetPrice) / Math.max(alert.currentPrice, 1)))
              : Math.max(0, Math.min(1, (alert.targetPrice - alert.currentPrice) / Math.max(alert.targetPrice, 1)));
            return (
              <View key={alert.id} style={styles.alertCard}>
                <View style={styles.alertCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertMatName} numberOfLines={1}>{alert.materialName}</Text>
                    <Text style={styles.alertDetail}>
                      {alert.direction === 'below' ? '↓ Below' : '↑ Above'} ${alert.targetPrice.toFixed(2)} · Now ${alert.currentPrice.toFixed(2)}
                    </Text>
                  </View>
                  {alert.isTriggered && (
                    <View style={[styles.alertStatusBadge, { backgroundColor: Colors.successLight }]}>
                      <Text style={[styles.alertStatusText, { color: Colors.success }]}>Triggered</Text>
                    </View>
                  )}
                  {alert.isPaused && (
                    <View style={[styles.alertStatusBadge, { backgroundColor: Colors.warningLight }]}>
                      <Text style={[styles.alertStatusText, { color: Colors.warning }]}>Paused</Text>
                    </View>
                  )}
                </View>
                <View style={styles.alertProgressTrack}>
                  <View style={[styles.alertProgressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: alert.isTriggered ? Colors.success : Colors.primary }]} />
                </View>
                <View style={styles.alertActions}>
                  <TouchableOpacity
                    style={styles.alertActionBtn}
                    onPress={() => {
                      updatePriceAlert(alert.id, { isPaused: !alert.isPaused });
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                  >
                    {alert.isPaused ? <Play size={12} color={Colors.primary} /> : <Pause size={12} color={Colors.warning} />}
                    <Text style={[styles.alertActionText, { color: alert.isPaused ? Colors.primary : Colors.warning }]}>
                      {alert.isPaused ? 'Resume' : 'Pause'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.alertActionBtn}
                    onPress={() => {
                      deletePriceAlert(alert.id);
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                  >
                    <Trash2 size={12} color={Colors.error} />
                    <Text style={[styles.alertActionText, { color: Colors.error }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.savingsBanner}>
        <TrendingDown size={14} color={Colors.success} />
        <Text style={styles.savingsText}>Bulk pricing saves up to 25% — tap a category to browse</Text>
      </View>

      {filteredCategories.length === 0 ? (
        <View style={styles.emptyState}>
          <Search size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No categories found</Text>
          <Text style={styles.emptyDesc}>Try a different search term</Text>
        </View>
      ) : (
        <Text style={styles.sectionHeader}>
          {totalCount} MATERIALS · {filteredCategories.length} CATEGORIES
        </Text>
      )}
    </View>
  ), [insets.top, pulseAnim, searchQuery, lastUpdated, showAlerts, priceAlerts, triggeredAlerts.length, filteredCategories.length, totalCount, refreshPrices, updatePriceAlert, deletePriceAlert, selectedRegion, selectedCity, regionInfo, locationMultiplier, showLocationPicker]);

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredCategories}
        renderItem={renderCategory}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={
          <View style={{ paddingBottom: insets.bottom + 110 }}>
            <View style={styles.sourceNote}>
              <Text style={styles.sourceText}>
                📊 Prices sourced from major retailers, distributors, and regional wholesalers across the US. Updated in real-time with market variance.
              </Text>
            </View>
          </View>
        }
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <MageRefreshControl refreshing={refreshing} onRefresh={() => refreshPrices(true)} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  listContainer: {},
  headerArea: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 4 },
  largeTitle: { fontSize: 34, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: Colors.success },
  liveLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.success, letterSpacing: 0.8 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.primary + '12', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  refreshBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  alertBadge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  alertBadgeText: { fontSize: 9, fontWeight: '700' as const, color: '#fff' },
  updatedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20, marginBottom: 12 },
  updatedText: { flex: 1, fontSize: 11, color: Colors.textMuted },
  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary, borderRadius: 12, paddingHorizontal: 12, gap: 8, height: 40 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  clearBtn: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  alertsSection: { marginHorizontal: 16, marginBottom: 16, gap: 8 },
  alertsSectionTitle: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, letterSpacing: 0.5, marginBottom: 4 },
  alertCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, gap: 8 },
  alertCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertMatName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  alertDetail: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  alertStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  alertStatusText: { fontSize: 10, fontWeight: '700' as const },
  alertProgressTrack: { height: 4, backgroundColor: Colors.fillTertiary, borderRadius: 2, overflow: 'hidden' as const },
  alertProgressFill: { height: 4, borderRadius: 2 },
  alertActions: { flexDirection: 'row', gap: 12 },
  alertActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  alertActionText: { fontSize: 12, fontWeight: '600' as const },
  savingsBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: Colors.success + '12', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginBottom: 20 },
  savingsText: { flex: 1, fontSize: 13, color: Colors.success, fontWeight: '500' as const, lineHeight: 17 },
  sectionHeader: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, letterSpacing: 0.5, paddingHorizontal: 20, marginBottom: 8 },
  categoryCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden' as const,
  },
  categoryCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  categoryEmoji: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 20 },
  categoryInfo: { flex: 1, gap: 2 },
  categoryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryName: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  categoryAlertDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.accent + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCount: { fontSize: 12, color: Colors.textMuted },
  categoryStats: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  priceRangeText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  discountChip: {
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountChipText: { fontSize: 10, fontWeight: '700' as const, color: Colors.success },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textMuted },
  sourceNote: { marginHorizontal: 16, marginTop: 16, padding: 12, backgroundColor: Colors.fillTertiary, borderRadius: 10 },
  sourceText: { fontSize: 11, color: Colors.textMuted, lineHeight: 16 },
  locationBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.primary + '08', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 6, borderWidth: 1, borderColor: Colors.primary + '20' },
  locationText: { flex: 1, fontSize: 13, color: Colors.text },
  locationBold: { fontWeight: '700' as const, color: Colors.primary },
  locationMultiplier: { backgroundColor: Colors.primary + '18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  multiplierText: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  locationPicker: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  pickerLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  pickerScroll: { flexDirection: 'row', marginBottom: 4 },
  pickerChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.background, marginRight: 6, alignItems: 'center' },
  pickerChipActive: { backgroundColor: Colors.primary },
  pickerChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  pickerChipSub: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  pickerChipTextActive: { color: '#FFF' },
});
