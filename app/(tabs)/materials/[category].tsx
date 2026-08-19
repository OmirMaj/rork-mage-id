import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Modal, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import {
  ArrowLeft, Tag, Truck, Search, X, Bell, Plus, CheckCircle,
  // Category icons (rendered via lookup map below) — replaces emoji-as-icon
  TreePine, Box, Home as HomeIcon, Layers, LayoutPanelLeft, AppWindow, LayoutGrid,
  Wrench, Zap, Wind, Square, Brush, Construction, HardHat, Hammer, Leaf, Package,
  type LucideIcon,
} from 'lucide-react-native';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  TreePine, Box, Home: HomeIcon, Layers, LayoutPanelLeft, AppWindow, LayoutGrid,
  Wrench, Zap, Wind, Square, Brush, Construction, HardHat, Hammer, Leaf, Package,
};
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { CATEGORY_META, getLivePrices, type MaterialItem } from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import type { PriceAlert, AlertDirection } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { parseLenientNumber } from '@/utils/formatters';
import { showAlert } from '@/utils/alert';

const PAGE_SIZE = 30;

function createId(_prefix: string): string {
  return generateUUID();
}

export default function CategoryDetailScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { category, loc } = useLocalSearchParams<{ category: string; loc?: string }>();
  // Location multiplier handed down from the Materials index picker (query
  // param). Falls back to 1.0 (national) when opened without one.
  const locationMultiplier = useMemo(() => {
    const n = loc ? parseFloat(loc) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [loc]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { priceAlerts, addPriceAlert } = useProjects();
  // Shared materials cart — same instance used by the Estimate tab. Adding
  // from this screen pushes into that cart so the user can browse here and
  // finalize/attach to a project from the Estimate tab.
  const { cart, addToCart } = useMaterialCart();

  const [searchQuery, setSearchQuery] = useState('');
  const [alertModal, setAlertModal] = useState<MaterialItem | null>(null);
  const [alertPrice, setAlertPrice] = useState('');
  const [alertDirection, setAlertDirection] = useState<AlertDirection>('below');
  // Per-item "Added · N in cart" confirmation. Map material.id → timer
  // expiry timestamp; we re-render after the timeout so the chip reverts.
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);
  const recentlyAddedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Look up how many of a given material are currently in the cart (used to
  // show "N in cart" badge in the confirmation chip).
  const cartQtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart) map.set(item.material.id, item.quantity);
    return map;
  }, [cart]);

  const handleAddToCart = useCallback((item: MaterialItem) => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addToCart(item, 1);
    setRecentlyAddedId(item.id);
    if (recentlyAddedTimer.current) clearTimeout(recentlyAddedTimer.current);
    recentlyAddedTimer.current = setTimeout(() => {
      setRecentlyAddedId(curr => (curr === item.id ? null : curr));
    }, 1500);
  }, [addToCart]);

  React.useEffect(() => () => {
    if (recentlyAddedTimer.current) clearTimeout(recentlyAddedTimer.current);
  }, []);

  const allMaterials = useMemo(() => {
    // Base products only — getLivePrices returns the full expanded catalog
    // (base × region × pricing tier ≈ 20k rows) which is reserved for the
    // Estimate tab's search/AI matching. Browsing that here rendered ~1,600
    // near-identical entries per category. locationMultiplier threads the
    // picker's selection so these BROWSE/DETAIL prices match what the index
    // card showed. NOTE: this only adjusts the displayed prices in Materials —
    // cart and Estimate-tab pricing are governed separately by the Estimate
    // tab's settings.location, which re-prices cart items on its own.
    const prices = getLivePrices(Date.now() / 10000, locationMultiplier);
    return prices.filter(m => m.category === category && m.specTier === 'base');
  }, [category, locationMultiplier]);

  const filteredMaterials = useMemo(() => {
    if (!searchQuery.trim()) return allMaterials;
    const q = searchQuery.toLowerCase();
    return allMaterials.filter(item =>
      item.name.toLowerCase().includes(q) ||
      item.supplier.toLowerCase().includes(q) ||
      (item.sku && item.sku.toLowerCase().includes(q))
    );
  }, [allMaterials, searchQuery]);

  const meta = CATEGORY_META[category ?? ''] ?? { color: themeColors.accent, iconName: 'Package', label: category ?? 'Materials' };
  const CategoryIcon = CATEGORY_ICONS[meta.iconName] ?? Package;

  const calcDiscount = (retail: number, bulk: number) => {
    if (retail <= 0) return 0;
    return Math.round(((retail - bulk) / retail) * 100);
  };

  const handleCreateAlert = useCallback(() => {
    if (!alertModal) return;
    const price = parseLenientNumber(alertPrice);
    if (price === null || price <= 0) {
      showAlert('Invalid Price', 'Please enter a valid target price.');
      return;
    }
    const alert: PriceAlert = {
      id: createId('alert'),
      materialId: alertModal.id,
      materialName: alertModal.name,
      targetPrice: price,
      direction: alertDirection,
      currentPrice: alertModal.baseRetailPrice,
      isTriggered: false,
      isPaused: false,
      createdAt: new Date().toISOString(),
    };
    addPriceAlert(alert);
    setAlertModal(null);
    setAlertPrice('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Alert Set', `You'll be notified when ${alertModal.name} goes ${alertDirection} $${price.toFixed(2)}.`);
  }, [alertModal, alertPrice, alertDirection, addPriceAlert]);

  const renderItem = useCallback(({ item }: { item: MaterialItem }) => {
    const discount = calcDiscount(item.baseRetailPrice, item.baseBulkPrice);
    const hasAlert = priceAlerts.some(a => a.materialId === item.id);
    const inCartQty = cartQtyById.get(item.id) ?? 0;
    const justAdded = recentlyAddedId === item.id;

    return (
      <View style={styles.itemCard}>
        <View style={styles.itemTop}>
          <View style={styles.itemLeft}>
            <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
            <View style={styles.itemMeta}>
              <Truck size={10} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.itemSupplier} numberOfLines={1}>{item.supplier}</Text>
              <Text style={styles.itemDot}>·</Text>
              <Text style={styles.itemUnit}>per {item.unit}</Text>
            </View>
            {item.sku && (
              <View style={styles.skuRow}>
                <Tag size={9} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.skuText}>SKU {item.sku}</Text>
              </View>
            )}
            {item.region && item.region !== 'National Avg' && (
              <View style={styles.regionBadge}>
                <Text style={styles.regionText}>{item.region}</Text>
              </View>
            )}
          </View>
          <View style={styles.itemRight}>
            <Text style={styles.retailPrice}>${item.baseRetailPrice.toFixed(2)}</Text>
            <View style={styles.bulkRow}>
              <Text style={styles.bulkPrice}>${item.baseBulkPrice.toFixed(2)}</Text>
              {discount > 0 && (
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>-{discount}%</Text>
                </View>
              )}
            </View>
            <Text style={styles.bulkMinLabel}>min {item.bulkMinQty} bulk</Text>
          </View>
        </View>
        <View style={styles.itemActions}>
          <TouchableOpacity
            style={[styles.alertBtn, hasAlert && styles.alertBtnActive]}
            onPress={() => {
              setAlertModal(item);
              setAlertPrice('');
              setAlertDirection('below');
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
            }}
            activeOpacity={0.7}
          >
            <Bell size={13} color={hasAlert ? themeColors.accent : themeColors.textMuted} strokeWidth={1.75} />
            <Text style={[styles.alertBtnText, hasAlert && { color: themeColors.accent }]}>
              {hasAlert ? 'Alert Set' : 'Set Alert'}
            </Text>
          </TouchableOpacity>
          {/* + Add — pushes into the shared MaterialCart. Repeat taps bump
              quantity; we show a 1.5s inline confirmation each time. */}
          <TouchableOpacity
            style={[styles.addBtn, (inCartQty > 0 || justAdded) && styles.addBtnActive]}
            onPress={() => handleAddToCart(item)}
            activeOpacity={0.7}
            testID={`add-to-cart-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Add ${item.name} to cart`}
          >
            {justAdded ? (
              <>
                <CheckCircle size={13} color={themeColors.success} strokeWidth={1.75} />
                <Text style={[styles.addBtnText, { color: themeColors.success }]}>
                  Added · {inCartQty} in cart
                </Text>
              </>
            ) : (
              <>
                <Plus size={13} color={inCartQty > 0 ? themeColors.accent : themeColors.accent} strokeWidth={1.75} />
                <Text style={[styles.addBtnText, { color: themeColors.accent }]}>
                  {inCartQty > 0 ? `Add (${inCartQty})` : 'Add'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [priceAlerts, cartQtyById, recentlyAddedId, handleAddToCart, themeColors]);

  const keyExtractor = useCallback((item: MaterialItem) => item.id, []);

  const categoryAlerts = useMemo(() => {
    return priceAlerts.filter(a => {
      return allMaterials.some(m => m.id === a.materialId);
    });
  }, [priceAlerts, allMaterials]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          testID="back-btn" accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft size={20} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={[styles.headerEmoji, { backgroundColor: meta.color + '15' }]}>
          <CategoryIcon size={22} color={meta.color} strokeWidth={2} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{meta.label}</Text>
          <Text style={styles.headerCount}>{filteredMaterials.length} of {allMaterials.length} items</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search size={15} color={themeColors.textMuted} strokeWidth={1.75} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={`Search ${meta.label.toLowerCase()}...`}
            placeholderTextColor={themeColors.textMuted}
            autoCorrect={false}
            selectionColor={themeColors.accent}
            underlineColorAndroid="transparent"
            testID="category-search"
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

      {categoryAlerts.length > 0 && (
        <View style={styles.alertsBar}>
          <Bell size={12} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.alertsBarText}>{categoryAlerts.length} active alert{categoryAlerts.length > 1 ? 's' : ''} in this category</Text>
        </View>
      )}

      <FlatList
        {...fabScroll}
        data={filteredMaterials}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={PAGE_SIZE}
        maxToRenderPerBatch={15}
        windowSize={5}
        removeClippedSubviews={true}
        updateCellsBatchingPeriod={50}
        getItemLayout={undefined}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Search size={36} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No materials match that</Text>
            <Text style={styles.emptyDesc}>Try a different search term</Text>
          </View>
        }
      />

      <Modal
        visible={alertModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Set Price Alert</Text>
              <TouchableOpacity onPress={() => setAlertModal(null)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {alertModal && (
              <>
                <Text style={styles.modalMatName}>{alertModal.name}</Text>
                <Text style={styles.modalCurrentPrice}>Current: ${alertModal.baseRetailPrice.toFixed(2)} / {alertModal.unit}</Text>

                <Text style={styles.modalFieldLabel}>Alert Direction</Text>
                <View style={styles.directionRow}>
                  <TouchableOpacity
                    style={[styles.directionBtn, alertDirection === 'below' && styles.directionBtnActive]}
                    onPress={() => setAlertDirection('below')}
                  >
                    <Text style={[styles.directionBtnText, alertDirection === 'below' && styles.directionBtnTextActive]}>Price drops below</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.directionBtn, alertDirection === 'above' && styles.directionBtnActive]}
                    onPress={() => setAlertDirection('above')}
                  >
                    <Text style={[styles.directionBtnText, alertDirection === 'above' && styles.directionBtnTextActive]}>Price rises above</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalFieldLabel}>Target Price ($)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={alertPrice}
                  onChangeText={setAlertPrice}
                  placeholder={alertDirection === 'below' ? (alertModal.baseRetailPrice * 0.9).toFixed(2) : (alertModal.baseRetailPrice * 1.1).toFixed(2)}
                  placeholderTextColor={themeColors.textMuted}
                  keyboardType="decimal-pad"
                  testID="alert-price-input"
                />

                <TouchableOpacity style={styles.modalSaveBtn} onPress={handleCreateAlert} activeOpacity={0.85}>
                  <Bell size={16} color="#fff" strokeWidth={1.75} />
                  <Text style={styles.modalSaveBtnText}>Set Alert</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: t.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEmoji: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEmojiText: { fontSize: Type.title3.fontSize },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  headerCount: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginTop: 1 },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: t.surface },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 12,
    gap: 8,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: Type.subhead.fontSize, color: t.text },
  clearBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: t.accent + '12',
    borderRadius: Tokens.radius.sm,
  },
  alertsBarText: { fontSize: Type.caption1.fontSize, fontWeight: '500' as const, color: t.accent },
  listContent: { paddingTop: 8, paddingHorizontal: 16, gap: 8 },
  itemCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: t.line,
  },
  itemTop: { flexDirection: 'row', gap: 12 },
  itemLeft: { flex: 1, gap: 4 },
  itemName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text, lineHeight: 19 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemSupplier: { fontSize: Type.caption2.fontSize, color: t.textMuted, flex: 1 },
  itemDot: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  itemUnit: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  skuText: { fontSize: 10, color: t.textMuted },
  regionBadge: {
    alignSelf: 'flex-start' as const,
    backgroundColor: t.info + '12',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  regionText: { fontSize: 10, fontWeight: '600' as const, color: t.info },
  itemRight: { alignItems: 'flex-end', gap: 2, minWidth: 80 },
  retailPrice: { fontSize: Type.caption1.fontSize, color: t.textMuted, textDecorationLine: 'line-through' as const },
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bulkPrice: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.success, letterSpacing: -0.3 },
  saveBadge: { backgroundColor: t.success + '18', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  saveBadgeText: { fontSize: 10, fontWeight: '700' as const, color: t.success },
  bulkMinLabel: { fontSize: 10, color: t.textMuted },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: t.line,
  },
  alertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.surfaceAlt,
  },
  alertBtnActive: { backgroundColor: t.accent + '15' },
  alertBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '500' as const, color: t.textMuted },
  // + Add button — visually mirrors alertBtn so the row reads as two parallel
  // actions. Uses accent tint when the item is already in the cart so the
  // user sees the "this is on my estimate" signal at a glance.
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '12',
  },
  addBtnActive: { backgroundColor: t.accent + '22' },
  addBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.accent },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '600' as const, color: t.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: t.surface, borderRadius: Tokens.radius["2xl"], padding: 22, gap: 12, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  modalMatName: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: t.text },
  modalCurrentPrice: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  modalFieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginTop: 4 },
  directionRow: { flexDirection: 'row', gap: 8 },
  directionBtn: { flex: 1, paddingVertical: 12, borderRadius: Tokens.radius.card, backgroundColor: t.surfaceAlt, alignItems: 'center' },
  directionBtnActive: { backgroundColor: t.accentFill },
  directionBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  directionBtnTextActive: { color: '#fff' },
  modalInput: { height: 48, borderRadius: Tokens.radius.lg, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.callout.fontSize, color: t.text },
  modalSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: 14 },
  modalSaveBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#fff' },
});
