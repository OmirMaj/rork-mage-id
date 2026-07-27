import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Animated, AppState, Alert, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight, TrendingDown, Search, X, RefreshCw, Clock, Wifi, Bell, Pause, Play, Trash2, MapPin, ChevronDown, ShoppingCart, BarChart3,
  // Category icons (rendered via CATEGORY_ICONS map below) — replaces
  // emoji-as-icon for visual consistency with the rest of the app
  TreePine, Box, Home as HomeIcon, Layers, LayoutPanelLeft, AppWindow, LayoutGrid,
  Wrench, Zap, Wind, Square, Brush, Construction, HardHat, Hammer, Leaf, Package,
  type LucideIcon,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import MageRefreshControl from '@/components/MageRefreshControl';
import { CATEGORY_META, getLivePrices, type MaterialItem } from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { REGIONS, CITY_ADJUSTMENTS, getRegionForState } from '@/constants/regions';
import type { PricingRegion } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const ALL_CATEGORIES = Object.keys(CATEGORY_META);

// Map iconName strings (declared in constants/materials.ts) to actual
// Lucide components. Done locally rather than at the data layer because
// data files shouldn't import from JSX-rendering modules.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  TreePine, Box, Home: HomeIcon, Layers, LayoutPanelLeft, AppWindow, LayoutGrid,
  Wrench, Zap, Wind, Square, Brush, Construction, HardHat, Hammer, Leaf, Package,
};

interface CategorySummary {
  name: string;
  label: string;
  Icon: LucideIcon;
  color: string;
  itemCount: number;
  priceRange: { min: number; max: number };
  avgDiscount: number;
}

export default function MaterialsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { priceAlerts, updatePriceAlert, deletePriceAlert } = useProjects();
  // Shared cart — count comes from MaterialCartContext so the badge stays
  // live as the user adds items from a category screen.
  const { cart } = useMaterialCart();
  const cartCount = cart.reduce((s, item) => s + item.quantity, 0);
  const [searchQuery, setSearchQuery] = useState('');
  // Browse over BASE products only. getLivePrices returns the full expanded
  // catalog (base × every region × every pricing tier ≈ 20k rows) which is
  // meant for the Estimate tab's search/AI matching — rendering it here made
  // the category counts read as thousands of near-duplicate variants. The
  // base tier is the real, human-facing product list (~274 items).
  // Seed with the default location's multiplier (matches locationMultiplier
  // below for the initial 'New York City' / mid_atlantic selection) so the
  // first frame shows location-adjusted prices instead of flashing national
  // prices before the effect re-prices.
  const [materials, setMaterials] = useState<MaterialItem[]>(() =>
    getLivePrices(
      Date.now() / 10000,
      CITY_ADJUSTMENTS['New York City'] ?? REGIONS.find(r => r.id === 'mid_atlantic')?.costIndex ?? 1.0,
    ).filter(m => m.specTier === 'base')
  );
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
    // Thread the selected location into pricing so the picker actually moves
    // the numbers, and keep to base products (see initial state note).
    const newPrices = getLivePrices(seed, locationMultiplier).filter(m => m.specTier === 'base');
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
  }, [priceAlerts, updatePriceAlert, locationMultiplier]);

  useEffect(() => {
    const interval = setInterval(() => refreshPrices(false), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshPrices]);

  // Re-price whenever the selected location changes so the picker is no longer
  // decorative. Keyed only on the multiplier — refreshPrices mutates price
  // alerts, so keying this on its identity would loop.
  useEffect(() => {
    refreshPrices(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationMultiplier]);

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
        const meta = CATEGORY_META[cat] ?? { color: themeColors.accent, iconName: 'Package', label: cat };
        const prices = items.map(i => i.baseBulkPrice);
        const discounts = items.map(i => {
          if (i.baseRetailPrice <= 0) return 0;
          return ((i.baseRetailPrice - i.baseBulkPrice) / i.baseRetailPrice) * 100;
        });
        return {
          name: cat,
          label: meta.label,
          Icon: CATEGORY_ICONS[meta.iconName] ?? Package,
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
    // Carry the selected location into the detail screen so its prices match
    // the picker (the detail route has no picker of its own).
    router.push({
      pathname: '/(tabs)/materials/[category]',
      params: { category: categoryName, loc: String(locationMultiplier) },
    });
  }, [router, locationMultiplier]);

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
            <item.Icon size={20} color={item.color} strokeWidth={2} />
          </View>
          <View style={styles.categoryInfo}>
            <View style={styles.categoryTitleRow}>
              <Text style={styles.categoryName}>{item.label}</Text>
              {alertCount > 0 && (
                <View style={styles.categoryAlertDot}>
                  <Bell size={9} color={themeColors.accent} strokeWidth={1.75} />
                </View>
              )}
            </View>
            <Text style={styles.categoryCount}>{item.itemCount} items</Text>
            <View style={styles.categoryStats}>
              <Text style={styles.priceRangeText}>
                ${item.priceRange.min.toFixed(2)} – ${item.priceRange.max.toFixed(2)}
              </Text>
              {item.avgDiscount > 0 && (
                <View style={styles.discountChip}>
                  <Text style={styles.discountChipText}>avg -{item.avgDiscount}%</Text>
                </View>
              )}
            </View>
          </View>
          <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={2} />
        </View>
      </TouchableOpacity>
    );
  }, [handleCategoryPress, priceAlerts, materials]);

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
          {/* Cart pill — visible whenever there are items. Taps over to the
              Estimate tab where the user can finalize markup, name the
              estimate, and attach it to a project. */}
          {cartCount > 0 && (
            <TouchableOpacity
              style={styles.cartPill}
              onPress={() => {
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
                router.push('/(tabs)/estimate/full');
              }}
              activeOpacity={0.7}
              testID="materials-cart-pill"
              accessibilityRole="button"
              accessibilityLabel={`Open cart with ${cartCount} item${cartCount === 1 ? '' : 's'}`}
            >
              <ShoppingCart size={14} color="#fff" strokeWidth={1.75} />
              <Text style={styles.cartPillText}>Cart ({cartCount})</Text>
            </TouchableOpacity>
          )}
          {priceAlerts.length > 0 && (
            <TouchableOpacity
              style={[styles.refreshBtn, showAlerts && { backgroundColor: themeColors.accent + '20' }]}
              onPress={() => setShowAlerts(!showAlerts)}
              activeOpacity={0.7}
            >
              <Bell size={15} color={showAlerts ? themeColors.accent : themeColors.accent} strokeWidth={1.75} />
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
            <RefreshCw size={15} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={styles.locationBanner}
        onPress={() => setShowLocationPicker(!showLocationPicker)}
        activeOpacity={0.7}
      >
        <MapPin size={14} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.locationText}>
          Pricing for <Text style={styles.locationBold}>{selectedCity}</Text>
          {' '}({regionInfo?.label ?? 'US Average'})
        </Text>
        <View style={styles.locationMultiplier}>
          <Text style={styles.multiplierText}>{locationMultiplier > 1 ? '+' : ''}{((locationMultiplier - 1) * 100).toFixed(0)}%</Text>
        </View>
        <ChevronDown size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
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
        <Clock size={11} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.updatedText}>Prices updated {formatTime(lastUpdated)} · {selectedCity} rates · Pull to refresh</Text>
        <Wifi size={11} color={themeColors.success} strokeWidth={1.75} />
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search size={15} color={themeColors.textMuted} strokeWidth={1.75} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search categories..."
            placeholderTextColor={themeColors.textMuted}
            autoCorrect={false}
            selectionColor={themeColors.accent}
            underlineColorAndroid="transparent"
            testID="materials-search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <View style={styles.clearBtn}>
                <X size={10} color="#fff" strokeWidth={1.75} />
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
                      <Text style={[styles.alertStatusText, { color: themeColors.success }]}>Triggered</Text>
                    </View>
                  )}
                  {alert.isPaused && (
                    <View style={[styles.alertStatusBadge, { backgroundColor: Colors.warningLight }]}>
                      <Text style={[styles.alertStatusText, { color: Colors.warning }]}>Paused</Text>
                    </View>
                  )}
                </View>
                <View style={styles.alertProgressTrack}>
                  <View style={[styles.alertProgressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: alert.isTriggered ? themeColors.success : themeColors.accent }]} />
                </View>
                <View style={styles.alertActions}>
                  <TouchableOpacity
                    style={styles.alertActionBtn}
                    onPress={() => {
                      updatePriceAlert(alert.id, { isPaused: !alert.isPaused });
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                  >
                    {alert.isPaused ? <Play size={12} color={themeColors.accent} strokeWidth={1.75} /> : <Pause size={12} color={Colors.warning} strokeWidth={1.75} />}
                    <Text style={[styles.alertActionText, { color: alert.isPaused ? themeColors.accent : Colors.warning }]}>
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
                    <Trash2 size={12} color={themeColors.danger} strokeWidth={1.75} />
                    <Text style={[styles.alertActionText, { color: themeColors.danger }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.savingsBanner}>
        <TrendingDown size={14} color={themeColors.success} strokeWidth={1.75} />
        <Text style={styles.savingsText}>Bulk pricing saves up to 25% — tap a category to browse</Text>
      </View>

      {filteredCategories.length === 0 ? (
        <View style={styles.emptyState}>
          <Search size={40} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text style={styles.emptyTitle}>No categories found</Text>
          <Text style={styles.emptyDesc}>Try a different search term</Text>
        </View>
      ) : (
        <Text style={styles.sectionHeader}>
          {totalCount} MATERIALS · {filteredCategories.length} CATEGORIES
        </Text>
      )}
    </View>
  ), [insets.top, pulseAnim, searchQuery, lastUpdated, showAlerts, priceAlerts, triggeredAlerts.length, filteredCategories.length, totalCount, refreshPrices, updatePriceAlert, deletePriceAlert, selectedRegion, selectedCity, regionInfo, locationMultiplier, showLocationPicker, cartCount, router]);

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
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                <BarChart3 size={13} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={[styles.sourceText, { flex: 1 }]}>
                  Prices sourced from major retailers, distributors, and regional wholesalers across the US. Updated in real-time with market variance.
                </Text>
              </View>
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  listContainer: {},
  headerArea: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 4 },
  largeTitle: { fontSize: Type.largeTitle.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.5 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: t.success },
  liveLabel: { fontSize: 10, fontWeight: '700' as const, color: t.success, letterSpacing: 0.8 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.accent + '12', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  refreshBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.accent },
  // Cart pill — solid-accent button shown only when the cart has items, so
  // it carries weight when present. Taps to the Estimate tab.
  cartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: t.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  cartPillText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: '#fff' },
  alertBadge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: Tokens.radius.sm, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center' },
  alertBadgeText: { fontSize: 9, fontWeight: '700' as const, color: '#fff' },
  updatedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20, marginBottom: 12 },
  updatedText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textMuted },
  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.card, paddingHorizontal: 12, gap: 8, height: 40 },
  searchInput: { flex: 1, fontSize: Type.subhead.fontSize, color: t.text },
  clearBtn: { width: 18, height: 18, borderRadius: 9, backgroundColor: t.textMuted, alignItems: 'center', justifyContent: 'center' },
  alertsSection: { marginHorizontal: 16, marginBottom: 16, gap: 8 },
  alertsSectionTitle: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textSecondary, letterSpacing: 0.5, marginBottom: 4 },
  alertCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 14, borderWidth: 1, borderColor: t.line, gap: 8 },
  alertCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertMatName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  alertDetail: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2 },
  alertStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  alertStatusText: { fontSize: 10, fontWeight: '700' as const },
  alertProgressTrack: { height: 4, backgroundColor: t.surfaceAlt, borderRadius: 2, overflow: 'hidden' as const },
  alertProgressFill: { height: 4, borderRadius: 2 },
  alertActions: { flexDirection: 'row', gap: 12 },
  alertActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  alertActionText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },
  savingsBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: t.success + '12', borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginBottom: 20 },
  savingsText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.success, fontWeight: '500' as const, lineHeight: 17 },
  sectionHeader: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textSecondary, letterSpacing: 0.5, paddingHorizontal: 20, marginBottom: 8 },
  categoryCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden' as const,
  },
  categoryCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  categoryEmoji: { width: 44, height: 44, borderRadius: Tokens.radius.card, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: Type.title3.fontSize },
  categoryInfo: { flex: 1, gap: 2 },
  categoryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryName: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: t.text },
  categoryAlertDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.accent + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCount: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  categoryStats: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  priceRangeText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  discountChip: {
    backgroundColor: t.success + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountChipText: { fontSize: 10, fontWeight: '700' as const, color: t.success },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '600' as const, color: t.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted },
  sourceNote: { marginHorizontal: 16, marginTop: 16, padding: 12, backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md },
  sourceText: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16 },
  locationBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: t.accent + '08', borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 10, gap: 6, borderWidth: 1, borderColor: t.accent + '20' },
  locationText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text },
  locationBold: { fontWeight: '700' as const, color: t.accent },
  locationMultiplier: { backgroundColor: t.accent + '18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  multiplierText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.accent },
  locationPicker: { marginHorizontal: 16, marginBottom: 12, backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 12, borderWidth: 1, borderColor: t.line },
  pickerLabel: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  pickerScroll: { flexDirection: 'row', marginBottom: 4 },
  pickerChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: t.bg, marginRight: 6, alignItems: 'center' },
  pickerChipActive: { backgroundColor: t.accent },
  pickerChipText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  pickerChipSub: { fontSize: 10, color: t.textMuted, marginTop: 1 },
  pickerChipTextActive: { color: '#FFF' },
});
