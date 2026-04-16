import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Modal, Alert, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Tag, Truck, Search, X, Bell } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { CATEGORY_META, getLivePrices, type MaterialItem } from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import type { PriceAlert, AlertDirection } from '@/types';

const PAGE_SIZE = 30;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CategoryDetailScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { priceAlerts, addPriceAlert } = useProjects();

  const [searchQuery, setSearchQuery] = useState('');
  const [alertModal, setAlertModal] = useState<MaterialItem | null>(null);
  const [alertPrice, setAlertPrice] = useState('');
  const [alertDirection, setAlertDirection] = useState<AlertDirection>('below');

  const allMaterials = useMemo(() => {
    const prices = getLivePrices(Date.now() / 10000);
    return prices.filter(m => m.category === category);
  }, [category]);

  const filteredMaterials = useMemo(() => {
    if (!searchQuery.trim()) return allMaterials;
    const q = searchQuery.toLowerCase();
    return allMaterials.filter(item =>
      item.name.toLowerCase().includes(q) ||
      item.supplier.toLowerCase().includes(q) ||
      (item.sku && item.sku.toLowerCase().includes(q))
    );
  }, [allMaterials, searchQuery]);

  const meta = CATEGORY_META[category ?? ''] ?? { color: Colors.primary, emoji: '📦', label: category ?? 'Materials' };

  const calcDiscount = (retail: number, bulk: number) => {
    if (retail <= 0) return 0;
    return Math.round(((retail - bulk) / retail) * 100);
  };

  const handleCreateAlert = useCallback(() => {
    if (!alertModal) return;
    const price = parseFloat(alertPrice);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid target price.');
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
    Alert.alert('Alert Set', `You'll be notified when ${alertModal.name} goes ${alertDirection} $${price.toFixed(2)}.`);
  }, [alertModal, alertPrice, alertDirection, addPriceAlert]);

  const renderItem = useCallback(({ item }: { item: MaterialItem }) => {
    const discount = calcDiscount(item.baseRetailPrice, item.baseBulkPrice);
    const hasAlert = priceAlerts.some(a => a.materialId === item.id);

    return (
      <View style={styles.itemCard}>
        <View style={styles.itemTop}>
          <View style={styles.itemLeft}>
            <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
            <View style={styles.itemMeta}>
              <Truck size={10} color={Colors.textMuted} />
              <Text style={styles.itemSupplier} numberOfLines={1}>{item.supplier}</Text>
              <Text style={styles.itemDot}>·</Text>
              <Text style={styles.itemUnit}>per {item.unit}</Text>
            </View>
            {item.sku && (
              <View style={styles.skuRow}>
                <Tag size={9} color={Colors.textMuted} />
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
            <Bell size={13} color={hasAlert ? Colors.accent : Colors.textMuted} />
            <Text style={[styles.alertBtnText, hasAlert && { color: Colors.accent }]}>
              {hasAlert ? 'Alert Set' : 'Set Alert'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [priceAlerts]);

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
          testID="back-btn"
        >
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={[styles.headerEmoji, { backgroundColor: meta.color + '15' }]}>
          <Text style={styles.headerEmojiText}>{meta.emoji}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{meta.label}</Text>
          <Text style={styles.headerCount}>{filteredMaterials.length} of {allMaterials.length} items</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search size={15} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={`Search ${meta.label.toLowerCase()}...`}
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            selectionColor={Colors.primary}
            underlineColorAndroid="transparent"
            testID="category-search"
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

      {categoryAlerts.length > 0 && (
        <View style={styles.alertsBar}>
          <Bell size={12} color={Colors.accent} />
          <Text style={styles.alertsBarText}>{categoryAlerts.length} active alert{categoryAlerts.length > 1 ? 's' : ''} in this category</Text>
        </View>
      )}

      <FlatList
        data={filteredMaterials}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={PAGE_SIZE}
        maxToRenderPerBatch={15}
        windowSize={5}
        removeClippedSubviews={true}
        updateCellsBatchingPeriod={50}
        getItemLayout={undefined}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Search size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No results</Text>
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
              <TouchableOpacity onPress={() => setAlertModal(null)}>
                <X size={20} color={Colors.textMuted} />
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
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  testID="alert-price-input"
                />

                <TouchableOpacity style={styles.modalSaveBtn} onPress={handleCreateAlert} activeOpacity={0.85}>
                  <Bell size={16} color="#fff" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEmoji: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEmojiText: { fontSize: 20 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  headerCount: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.surface },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  clearBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.textMuted,
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
    backgroundColor: Colors.accent + '12',
    borderRadius: 8,
  },
  alertsBarText: { fontSize: 12, fontWeight: '500' as const, color: Colors.accent },
  listContent: { paddingTop: 8, paddingHorizontal: 16, gap: 8 },
  itemCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  itemTop: { flexDirection: 'row', gap: 12 },
  itemLeft: { flex: 1, gap: 4 },
  itemName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, lineHeight: 19 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemSupplier: { fontSize: 11, color: Colors.textMuted, flex: 1 },
  itemDot: { fontSize: 11, color: Colors.textMuted },
  itemUnit: { fontSize: 11, color: Colors.textMuted },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  skuText: { fontSize: 10, color: Colors.textMuted },
  regionBadge: {
    alignSelf: 'flex-start' as const,
    backgroundColor: Colors.info + '12',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  regionText: { fontSize: 10, fontWeight: '600' as const, color: Colors.info },
  itemRight: { alignItems: 'flex-end', gap: 2, minWidth: 80 },
  retailPrice: { fontSize: 12, color: Colors.textMuted, textDecorationLine: 'line-through' as const },
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bulkPrice: { fontSize: 17, fontWeight: '700' as const, color: Colors.success, letterSpacing: -0.3 },
  saveBadge: { backgroundColor: Colors.success + '18', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  saveBadgeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.success },
  bulkMinLabel: { fontSize: 10, color: Colors.textMuted },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  alertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  alertBtnActive: { backgroundColor: Colors.accent + '15' },
  alertBtnText: { fontSize: 12, fontWeight: '500' as const, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: Colors.surface, borderRadius: 24, padding: 22, gap: 12, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  modalMatName: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  modalCurrentPrice: { fontSize: 14, color: Colors.textSecondary },
  modalFieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  directionRow: { flexDirection: 'row', gap: 8 },
  directionBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.fillTertiary, alignItems: 'center' },
  directionBtnActive: { backgroundColor: Colors.primary },
  directionBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  directionBtnTextActive: { color: '#fff' },
  modalInput: { height: 48, borderRadius: 14, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 16, color: Colors.text },
  modalSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14 },
  modalSaveBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
});
