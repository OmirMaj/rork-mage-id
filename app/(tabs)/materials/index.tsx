import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import {
  ChevronRight, TrendingDown, Search, X, BookOpen, Bell, Pause, Play, Trash2, MapPin, ChevronDown, ShoppingCart, Info, AlertTriangle,
  // Category icons (rendered via CATEGORY_ICONS map below) — replaces
  // emoji-as-icon for visual consistency with the rest of the app
  TreePine, Box, Home as HomeIcon, Layers, LayoutPanelLeft, AppWindow, LayoutGrid,
  Wrench, Zap, Wind, Square, Brush, Construction, HardHat, Hammer, Leaf, Package,
  type LucideIcon,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
// Only the ThemeColors TYPE. Every colour on this screen now comes from the
// theme context (`themeColors` / the `t` handed to makeStyles) rather than the
// static `Colors` object, whose *Light tints (successLight #E8FAF0,
// warningLight #FFF3E0) are single fixed hex values with no dark variant.
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  CATEGORY_META,
  CATALOG_NOT_A_FEED,
  CATALOG_SOURCE_LABEL,
  averageBulkDiscountPct,
  catalogAgeMonths,
  catalogCompiledLabel,
  catalogIsStale,
  catalogProvenanceLine,
  evaluatePriceTargets,
  getCatalogPrices,
  marketForSelection,
  resolvePricingMarket,
  type MaterialItem,
  type PriceTargetStatus,
} from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import { HiddenTabBackLink } from '@/components/HiddenTabBackLink';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { REGIONS, CITY_ADJUSTMENTS } from '@/constants/regions';
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
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { priceAlerts, updatePriceAlert, deletePriceAlert, settings } = useProjects();
  // Shared cart — count comes from MaterialCartContext so the badge stays
  // live as the user adds items from a category screen.
  const { cart } = useMaterialCart();
  const cartCount = cart.reduce((s, item) => s + item.quantity, 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTargets, setShowTargets] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // ── WHICH MARKET ─────────────────────────────────────────────────────────
  // The screen used to open hardcoded on New York City (+35%) and print "New
  // York City rates" under the title. For a Houston GC — this account — that
  // is a 35% uplift he never asked for, stated as if he had. The default is
  // now HIS market, resolved from settings.location, and when that resolves to
  // nothing the catalog is shown un-adjusted and says so.
  const homeMarket = useMemo(() => resolvePricingMarket(settings.location), [settings.location]);
  const [override, setOverride] = useState<{ regionId: PricingRegion | null; city: string | null } | null>(null);
  const market = useMemo(
    () => (override ? marketForSelection(override.regionId, override.city) : homeMarket),
    [override, homeMarket],
  );

  // ── THE PRICES ───────────────────────────────────────────────────────────
  // Deterministic. Browse over BASE products only: getCatalogPrices returns the
  // full expanded catalog (base × every region × every pricing tier ≈ 20k rows)
  // which is meant for the Estimate tab's search/AI matching — rendering it
  // here made the category counts read as thousands of near-duplicate variants.
  //
  // There is no interval, no foreground re-price and no pull-to-refresh: they
  // existed only to re-roll a sine wave, and re-rolling nothing at a stated
  // time is how "Prices updated 9:20 PM" got onto a screen with no feed behind
  // it. These numbers change when the catalog ships a new build, or when the
  // user picks a different market. Nothing else moves them.
  const materials = useMemo<MaterialItem[]>(
    () => getCatalogPrices(market.multiplier).filter(m => m.specTier === 'base'),
    [market.multiplier],
  );

  const avgBulkDiscount = useMemo(() => averageBulkDiscountPct(materials), [materials]);
  const provenance = useMemo(
    () => catalogProvenanceLine(market.resolved ? market.label : null),
    [market],
  );
  const staleMonths = useMemo(() => (catalogIsStale() ? catalogAgeMonths() : 0), []);

  // ── PRICE TARGETS ────────────────────────────────────────────────────────
  // Derived, never read back from the row. See the note over
  // evaluatePriceTargets: `currentPrice` and `isTriggered` on a stored alert
  // were written by the synthetic feed, so they are not evidence of anything.
  // Nothing here writes, either — the old code pushed a Supabase update per
  // alert per five-minute re-roll.
  const targetStatus = useMemo(() => {
    const statuses = evaluatePriceTargets(
      priceAlerts.map(a => ({
        id: a.id,
        materialId: a.materialId,
        targetPrice: a.targetPrice,
        direction: a.direction,
        isPaused: a.isPaused,
      })),
      materials,
    );
    return new Map<string, PriceTargetStatus>(statuses.map(st => [st.id, st]));
  }, [priceAlerts, materials]);

  const metTargets = useMemo(
    () => priceAlerts.filter(a => targetStatus.get(a.id)?.meetsTarget === true).length,
    [priceAlerts, targetStatus],
  );

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

  const handleCategoryPress = useCallback((categoryName: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Carry the selected market into the detail screen so its prices match
    // this one (the detail route has no picker of its own).
    router.push({
      pathname: '/(tabs)/materials/[category]',
      params: { category: categoryName, loc: String(market.multiplier) },
    });
  }, [router, market.multiplier]);

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
      {/* NAV-07 (runtime audit 2026-09-06). This component renders at two
          routes: /(tabs)/materials, a tab registered href:null (a tab switch,
          which creates no back button and lights no tab), and
          /(tabs)/discover/materials, a push inside the Discover stack whose
          navigator has headerShown:false (so it draws no back button either).
          Both arrive from Discover's sub-tab strip, so one labelled control
          serves both. See components/HiddenTabBackLink.tsx for why it pushes a
          named destination instead of calling router.back(). */}
      <HiddenTabBackLink
        label="Discover"
        href="/(tabs)/discover"
        style={[styles.backToDiscover, { marginTop: insets.top + 4 }]}
        testID="materials-back-to-discover"
      />
      <View style={styles.headerArea}>
        <View style={{ flex: 1 }}>
          <Text style={styles.largeTitle}>Materials</Text>
          {/* Was a pulsing green dot reading "LIVE PRICING". There is no feed
              behind this screen, so it says what it is. */}
          <View style={styles.provenanceRow}>
            <BookOpen size={11} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.provenanceLabel}>REFERENCE PRICE BOOK</Text>
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
              style={[styles.refreshBtn, showTargets && { backgroundColor: themeColors.accent + '20' }]}
              onPress={() => setShowTargets(!showTargets)}
              activeOpacity={0.7}
              testID="materials-targets-toggle"
              accessibilityRole="button"
              accessibilityLabel={`Price targets (${priceAlerts.length})`}
            >
              <Bell size={15} color={themeColors.accent} strokeWidth={1.75} />
              {metTargets > 0 && (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>{metTargets}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <TouchableOpacity
        style={styles.locationBanner}
        onPress={() => setShowLocationPicker(!showLocationPicker)}
        activeOpacity={0.7}
        testID="materials-market-banner"
      >
        <MapPin size={14} color={themeColors.accent} strokeWidth={1.75} />
        {market.resolved ? (
          <Text style={styles.locationText}>
            Priced for <Text style={styles.locationBold}>{market.label}</Text>
          </Text>
        ) : (
          <Text style={styles.locationText}>
            <Text style={styles.locationBold}>US average</Text> — pick your market
          </Text>
        )}
        {market.resolved && (
          <View style={styles.locationMultiplier}>
            <Text style={styles.multiplierText}>{market.multiplier > 1 ? '+' : ''}{((market.multiplier - 1) * 100).toFixed(0)}%</Text>
          </View>
        )}
        <ChevronDown size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
      </TouchableOpacity>

      {showLocationPicker && (
        <View style={styles.locationPicker}>
          <Text style={styles.pickerLabel}>REGION</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
            {/* An explicit way back to the un-adjusted national list price.
                Without it every selection was an uplift the user could not undo. */}
            <TouchableOpacity
              style={[styles.pickerChip, !market.resolved && styles.pickerChipActive]}
              onPress={() => {
                setOverride({ regionId: null, city: null });
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              testID="market-us-average"
            >
              <Text style={[styles.pickerChipText, !market.resolved && styles.pickerChipTextActive]}>US average</Text>
              <Text style={[styles.pickerChipSub, !market.resolved && styles.pickerChipTextActive]}>no adjustment</Text>
            </TouchableOpacity>
            {REGIONS.map(region => {
              const active = market.regionId === region.id && !market.city;
              return (
                <TouchableOpacity
                  key={region.id}
                  style={[styles.pickerChip, active && styles.pickerChipActive]}
                  onPress={() => {
                    setOverride({ regionId: region.id, city: null });
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.pickerChipText, active && styles.pickerChipTextActive]}>
                    {region.label}
                  </Text>
                  <Text style={[styles.pickerChipSub, active && styles.pickerChipTextActive]}>
                    {region.costIndex > 1 ? '+' : ''}{((region.costIndex - 1) * 100).toFixed(0)}%
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Text style={[styles.pickerLabel, { marginTop: 8 }]}>METRO AREA</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
            {Object.entries(CITY_ADJUSTMENTS).map(([city, adj]) => {
              const active = market.city === city;
              return (
                <TouchableOpacity
                  key={city}
                  style={[styles.pickerChip, active && styles.pickerChipActive]}
                  onPress={() => {
                    // marketForSelection derives the region from the metro, so
                    // the city↔state table lives in constants/materials.ts
                    // where it can be tested instead of inline here.
                    setOverride({ regionId: null, city });
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.pickerChipText, active && styles.pickerChipTextActive]}>{city}</Text>
                  <Text style={[styles.pickerChipSub, active && styles.pickerChipTextActive]}>
                    {adj > 1 ? '+' : ''}{((adj - 1) * 100).toFixed(0)}%
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Replaces "Prices updated 9:20 PM · New York City rates · Pull to
          refresh". States when the book was compiled and which factor is on
          it — never when the screen last re-rendered. */}
      <View style={styles.updatedRow}>
        <Info size={11} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.updatedText} testID="materials-provenance">{provenance}</Text>
      </View>

      {/* The stale variant paints itself in the warning palette. It must use
          the THEME-AWARE pair (warningSoft tint / warningLabel ink), not the
          fixed-light Colors.warningLight (#FFF3E0): this banner switches
          itself on with no code change and therefore no review, on
          CATALOG_COMPILED_ON + CATALOG_STALE_AFTER_MONTHS, and in dark theme
          the fixed cream carried #FF9500 text at roughly 2:1. A caution
          nobody can read is a caution that is not there. */}
      <View style={[styles.cautionBanner, staleMonths > 0 && styles.cautionBannerStale]}>
        <AlertTriangle
          size={13}
          color={staleMonths > 0 ? themeColors.warningLabel : themeColors.textMuted}
          strokeWidth={1.75}
        />
        <Text style={[styles.cautionText, staleMonths > 0 && styles.cautionTextStale]} testID="materials-not-a-feed">
          {staleMonths > 0
            ? `This price book is ${staleMonths} months old. ${CATALOG_NOT_A_FEED}`
            : CATALOG_NOT_A_FEED}
        </Text>
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

      {showTargets && priceAlerts.length > 0 && (
        <View style={styles.alertsSection}>
          <Text style={styles.alertsSectionTitle}>PRICE TARGETS ({priceAlerts.length})</Text>
          {/* The old panel promised a watch it could not keep: the "Triggered"
              badge came from a sine wave, not from a supplier. */}
          <Text style={styles.alertsSectionNote}>
            MAGE has no supplier feed. A target is compared against the price book above for {market.resolved ? market.label : 'the US average'} — it does not watch the market.
          </Text>
          {priceAlerts.map(alert => {
            const status = targetStatus.get(alert.id);
            const catalogPrice = status?.catalogPrice ?? null;
            const meets = status?.meetsTarget === true;
            const progress = catalogPrice === null
              ? 0
              : alert.direction === 'below'
                ? Math.max(0, Math.min(1, (catalogPrice - alert.targetPrice) / Math.max(catalogPrice, 1)))
                : Math.max(0, Math.min(1, (alert.targetPrice - catalogPrice) / Math.max(alert.targetPrice, 1)));
            return (
              <View key={alert.id} style={styles.alertCard}>
                <View style={styles.alertCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertMatName} numberOfLines={1}>{alert.materialName}</Text>
                    <Text style={styles.alertDetail}>
                      {alert.direction === 'below' ? '↓ Below' : '↑ Above'} ${alert.targetPrice.toFixed(2)}
                      {' · '}
                      {catalogPrice === null
                        ? 'no longer in the price book'
                        : `book price $${catalogPrice.toFixed(2)}`}
                    </Text>
                  </View>
                  {/* successSoft/warningSoft + successLabel/warningLabel, not
                      the fixed-light Colors.successLight (#E8FAF0) /
                      Colors.warningLight (#FFF3E0). Those two are single hex
                      values with no dark variant, so in dark theme these
                      badges were near-white chips carrying #4ED37A and
                      #FF9500 ink — and unlike the stale-catalog banner below,
                      these two are reachable TODAY, the moment a target meets
                      or a target is paused. */}
                  {meets && (
                    <View style={[styles.alertStatusBadge, { backgroundColor: themeColors.successSoft }]}>
                      <Text style={[styles.alertStatusText, { color: themeColors.successLabel }]}>Meets target</Text>
                    </View>
                  )}
                  {alert.isPaused && (
                    <View style={[styles.alertStatusBadge, { backgroundColor: themeColors.warningSoft }]}>
                      <Text style={[styles.alertStatusText, { color: themeColors.warningLabel }]}>Paused</Text>
                    </View>
                  )}
                </View>
                <View style={styles.alertProgressTrack}>
                  <View style={[styles.alertProgressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: meets ? themeColors.success : themeColors.accent }]} />
                </View>
                <View style={styles.alertActions}>
                  <TouchableOpacity
                    style={styles.alertActionBtn}
                    onPress={() => {
                      updatePriceAlert(alert.id, { isPaused: !alert.isPaused });
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                  >
                    {alert.isPaused ? <Play size={12} color={themeColors.accent} strokeWidth={1.75} /> : <Pause size={12} color={themeColors.warningLabel} strokeWidth={1.75} />}
                    <Text style={[styles.alertActionText, { color: alert.isPaused ? themeColors.accent : themeColors.warningLabel }]}>
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
        <Text style={styles.savingsText}>
          Bulk price averages {avgBulkDiscount}% under list across this book — tap a category to browse
        </Text>
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
  ), [insets.top, searchQuery, showTargets, priceAlerts, targetStatus, metTargets, filteredCategories.length, totalCount, updatePriceAlert, deletePriceAlert, market, showLocationPicker, cartCount, router, provenance, staleMonths, avgBulkDiscount, styles, themeColors]);

  return (
    <View style={styles.container}>
      <FlatList
        {...fabScroll}
        data={filteredCategories}
        renderItem={renderCategory}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={
          <View style={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
            <View style={styles.sourceNote}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                <BookOpen size={13} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={[styles.sourceText, { flex: 1 }]} testID="materials-source-note">
                  {CATALOG_SOURCE_LABEL} compiled {catalogCompiledLabel()}, adjusted by MAGE&apos;s regional cost index. They are list prices, not quotes on your account, and MAGE does not receive supplier feeds — the numbers move only when a new build ships a new book or you change the market above. The supplier on a row is the retail channel the list price was taken from, not a vendor MAGE has priced with for you.
                </Text>
              </View>
            </View>
          </View>
        }
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  listContainer: {},
  // Only the placement: HiddenTabBackLink owns the chevron, label and tint.
  backToDiscover: { marginLeft: 14 },
  headerArea: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 4 },
  largeTitle: { fontSize: Type.largeTitle.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.5 },
  // Was a pulsing green `liveDot` + "LIVE PRICING" in success green. Muted and
  // static: this is a book, not a feed, and the colour said otherwise.
  provenanceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  provenanceLabel: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.8 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.accent + '12', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  // Cart pill — solid-accent button shown only when the cart has items, so
  // it carries weight when present. Taps to the Estimate tab.
  cartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: t.accentFill,
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
  alertsSectionNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15, marginBottom: 4 },
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
  cautionBanner: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 16, backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, paddingHorizontal: 12, paddingVertical: 9, gap: 7, marginBottom: 12 },
  cautionBannerStale: { backgroundColor: t.warningSoft },
  cautionText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },
  cautionTextStale: { color: t.warningLabel, fontWeight: '600' as const },
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
  pickerChipActive: { backgroundColor: t.accentFill },
  pickerChipText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  pickerChipSub: { fontSize: 10, color: t.textMuted, marginTop: 1 },
  pickerChipTextActive: { color: '#FFF' },
});
