import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Pressable, Platform, FlatList, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Search, X, Star, Truck, Clock, MapPin, Phone, Mail, Globe,
  ChevronRight, Package, CheckCircle,
  Store, Award, DollarSign,
  TreePine, Box, Home, Zap, Wrench, Layers, LayoutGrid, HardHat, Paintbrush, Leaf, Fence,
} from 'lucide-react-native';
import { MageMaterials } from '@/components/icons';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';

// Supplier-category id → trade icon (replaces the emoji chips).
const CAT_ICON: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  all: Store, lumber: TreePine, concrete: Box, roofing: Home, electrical: Zap,
  plumbing: Wrench, insulation: Layers, flooring: LayoutGrid, steel: HardHat,
  paint: Paintbrush, landscape: Leaf, fencing: Fence,
};
import { MOCK_SUPPLIERS, MOCK_LISTINGS, SUPPLIER_CATEGORIES } from '@/mocks/suppliers';
import type { Supplier, SupplierListing } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

type ViewMode = 'suppliers' | 'listings';

export default function MarketplaceScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors: themeColors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>('suppliers');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedListing, setSelectedListing] = useState<SupplierListing | null>(null);
  const [orderQty, setOrderQty] = useState('1');

  const filteredSuppliers = useMemo(() => {
    let results = MOCK_SUPPLIERS;
    if (activeCategory !== 'all') {
      results = results.filter(s => s.categories.includes(activeCategory));
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(s =>
        s.companyName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.categories.some(c => c.toLowerCase().includes(q))
      );
    }
    return results.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.rating - a.rating);
  }, [query, activeCategory]);

  const filteredListings = useMemo(() => {
    let results = MOCK_LISTINGS;
    if (activeCategory !== 'all') {
      results = results.filter(l => l.category === activeCategory);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
      );
    }
    return results;
  }, [query, activeCategory]);

  const getSupplier = useCallback((id: string) => MOCK_SUPPLIERS.find(s => s.id === id), []);

  const supplierListings = useMemo(() => {
    if (!selectedSupplier) return [];
    return MOCK_LISTINGS.filter(l => l.supplierId === selectedSupplier.id);
  }, [selectedSupplier]);

  const handleContactSupplier = useCallback((supplier: Supplier, method: 'email' | 'phone' | 'website') => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (method === 'email') {
      const url = `mailto:${supplier.email}?subject=Inquiry from MAGE ID —${supplier.companyName}`;
      Linking.openURL(url).catch(() => showAlert('Error', 'Could not open email client.'));
    } else if (method === 'phone') {
      Linking.openURL(`tel:${supplier.phone}`).catch(() => showAlert('Error', 'Could not open phone.'));
    } else {
      Linking.openURL(`https://${supplier.website}`).catch(() => showAlert('Error', 'Could not open browser.'));
    }
  }, []);

  const handleRequestQuote = useCallback((listing: SupplierListing) => {
    const qty = parseInt(orderQty, 10);
    if (isNaN(qty) || qty <= 0) {
      showAlert('Invalid Quantity', 'Please enter a valid quantity.');
      return;
    }
    const supplier = getSupplier(listing.supplierId);
    if (!supplier) return;
    const usesBulk = qty >= listing.bulkMinQty;
    const unitPrice = usesBulk ? listing.bulkPrice : listing.price;
    const total = unitPrice * qty;

    const subject = `Quote request —${listing.name}`;
    const body = `Hi ${supplier.contactName},\n\nI'd like to request a quote for:\n\nItem: ${listing.name}\nQuantity: ${qty} ${listing.unit}\nUnit Price: $${unitPrice.toFixed(2)}${usesBulk ? ' (bulk rate)' : ''}\nEstimated Total: $${total.toFixed(2)}\n\nPlease confirm availability and delivery timeline.\n\nThank you,\nSent via MAGE ID`;
    const url = `mailto:${supplier.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => showAlert('Error', 'Could not open email client.'));
    setSelectedListing(null);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [orderQty, getSupplier]);

  const renderStars = useCallback((rating: number) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(
        <Star
          key={i}
          size={12}
          color={i <= Math.round(rating) ? '#FFB800' : themeColors.line}
          fill={i <= Math.round(rating) ? '#FFB800' : 'transparent'} strokeWidth={1.75}
        />
      );
    }
    return stars;
  }, [themeColors]);

  const renderSupplierCard = useCallback(({ item }: { item: Supplier }) => {
    const listingCount = MOCK_LISTINGS.filter(l => l.supplierId === item.id).length;
    return (
      <TouchableOpacity
        style={styles.supplierCard}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedSupplier(item);
        }}
        activeOpacity={0.7}
        testID={`supplier-${item.id}`}
      >
        {item.featured && (
          <View style={styles.featuredBadge}>
            <Award size={10} color="#FFB800" strokeWidth={1.75} />
            <Text style={styles.featuredText}>Featured</Text>
          </View>
        )}
        <View style={styles.supplierTop}>
          <View style={styles.supplierAvatar}>
            <Store size={20} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <View style={styles.supplierInfo}>
            <Text style={styles.supplierName} numberOfLines={1}>{item.companyName}</Text>
            <View style={styles.ratingRow}>
              {renderStars(item.rating)}
              <Text style={styles.ratingText}>{item.rating}</Text>
            </View>
          </View>
          <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
        </View>
        <Text style={styles.supplierDesc} numberOfLines={2}>{item.description}</Text>
        <View style={styles.supplierMeta}>
          <View style={styles.supplierChip}>
            <Package size={10} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.supplierChipText}>{listingCount} products</Text>
          </View>
          <View style={styles.supplierChip}>
            <MapPin size={10} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.supplierChipText}>{item.address.split(',').pop()?.trim()}</Text>
          </View>
          <View style={styles.supplierChip}>
            <DollarSign size={10} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.supplierChipText}>Min ${item.minOrderAmount}</Text>
          </View>
        </View>
        <View style={styles.supplierCats}>
          {item.categories.map(cat => {
            const catInfo = SUPPLIER_CATEGORIES.find(c => c.id === cat);
            return (
              <View key={cat} style={styles.catTag}>
                {(() => { const I = CAT_ICON[cat]; return I ? <I size={11} color={themeColors.accent} strokeWidth={1.75} /> : null; })()}
                <Text style={styles.catTagText}>{catInfo?.label ?? cat}</Text>
              </View>
            );
          })}
        </View>
      </TouchableOpacity>
    );
  }, [renderStars, styles, themeColors]);

  const renderListingCard = useCallback(({ item }: { item: SupplierListing }) => {
    const supplier = getSupplier(item.supplierId);
    const savings = item.price > 0 ? Math.round(((item.price - item.bulkPrice) / item.price) * 100) : 0;
    return (
      <TouchableOpacity
        style={styles.listingCard}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedListing(item);
          setOrderQty('1');
        }}
        activeOpacity={0.7}
        testID={`listing-${item.id}`}
      >
        <View style={styles.listingTop}>
          <View style={styles.listingInfo}>
            <Text style={styles.listingName} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.listingDesc} numberOfLines={1}>{item.description}</Text>
          </View>
          {item.inStock && (
            <View style={styles.stockBadge}>
              <CheckCircle size={10} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.stockText}>In Stock</Text>
            </View>
          )}
        </View>
        <View style={styles.listingPriceRow}>
          <View style={styles.listingPriceBlock}>
            <Text style={styles.listingPriceLabel}>RETAIL</Text>
            <Text style={styles.listingRetail}>${item.price.toFixed(2)}</Text>
            <Text style={styles.listingUnit}>/{item.unit}</Text>
          </View>
          <View style={styles.listingPriceDivider} />
          <View style={styles.listingPriceBlock}>
            <Text style={[styles.listingPriceLabel, { color: themeColors.success }]}>BULK</Text>
            <Text style={styles.listingBulk}>${item.bulkPrice.toFixed(2)}</Text>
            <Text style={styles.listingUnit}>/{item.unit}</Text>
          </View>
          {savings > 0 && (
            <View style={styles.listingSaveBadge}>
              <Text style={styles.listingSaveText}>-{savings}%</Text>
              <Text style={styles.listingMinText}>min {item.bulkMinQty}</Text>
            </View>
          )}
        </View>
        <View style={styles.listingBottom}>
          {supplier && (
            <View style={styles.listingSupplierRow}>
              <Store size={10} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.listingSupplierText}>{supplier.companyName}</Text>
            </View>
          )}
          <View style={styles.listingLeadRow}>
            <Clock size={10} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.listingLeadText}>{item.leadTimeDays}d lead</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [getSupplier, styles, themeColors]);

  const orderTotal = useMemo(() => {
    if (!selectedListing) return 0;
    const qty = parseInt(orderQty, 10) || 0;
    const usesBulk = qty >= selectedListing.bulkMinQty;
    return (usesBulk ? selectedListing.bulkPrice : selectedListing.price) * qty;
  }, [selectedListing, orderQty]);

  return (
    <View style={styles.container}>
      <FlatList
        data={viewMode === 'suppliers' ? [] : []}
        renderItem={() => null}
        keyExtractor={(_, idx) => `marketplace-${idx}`}
        ListHeaderComponent={
          <View>
            <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
              <Text style={styles.largeTitle}>Marketplace</Text>
              <Text style={styles.subtitle}>Buy materials directly from suppliers</Text>
              {/* Preview banner — added during May 2026 launch audit. The
                  supplier list and listings are MOCK_SUPPLIERS / MOCK_LISTINGS
                  for now; "Order" buttons don't actually transact. We're
                  validating the UX with real suppliers before opening the
                  payment plumbing. */}
              <View style={styles.previewBanner}>
                <Text style={styles.previewLabel}>
                  PREVIEW
                </Text>
                <Text style={styles.previewBody}>
                  Marketplace is in preview. Suppliers and listings shown are reference data — orders here won&apos;t actually ship. We&apos;re onboarding real suppliers; tap &quot;Contact&quot; to reach out directly.
                </Text>
              </View>

              <View style={styles.searchBar}>
                <Search size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search suppliers, materials..."
                  placeholderTextColor={themeColors.textMuted}
                  autoCorrect={false}
                  selectionColor={themeColors.accent}
                  underlineColorAndroid="transparent"
                  testID="marketplace-search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, viewMode === 'suppliers' && styles.modeBtnActive]}
                  onPress={() => setViewMode('suppliers')}
                  activeOpacity={0.7}
                >
                  <Store size={14} color={viewMode === 'suppliers' ? Colors.textOnPrimary : themeColors.textSecondary} strokeWidth={1.75} />
                  <Text style={[styles.modeBtnText, viewMode === 'suppliers' && styles.modeBtnTextActive]}>Suppliers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, viewMode === 'listings' && styles.modeBtnActive]}
                  onPress={() => setViewMode('listings')}
                  activeOpacity={0.7}
                >
                  <Package size={14} color={viewMode === 'listings' ? Colors.textOnPrimary : themeColors.textSecondary} strokeWidth={1.75} />
                  <Text style={[styles.modeBtnText, viewMode === 'listings' && styles.modeBtnTextActive]}>Products</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.categoriesWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesContent}>
                {SUPPLIER_CATEGORIES.map(cat => {
                  const isActive = activeCategory === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                      onPress={() => {
                        setActiveCategory(cat.id);
                        if (Platform.OS !== 'web') void Haptics.selectionAsync();
                      }}
                      activeOpacity={0.7}
                    >
                      {(() => { const I = CAT_ICON[cat.id]; return I ? <I size={15} color={isActive ? '#FFFFFF' : themeColors.textSecondary} strokeWidth={1.75} /> : null; })()}
                      <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View style={styles.resultsHeader}>
              <Text style={styles.resultsCount}>
                {viewMode === 'suppliers'
                  ? `${filteredSuppliers.length} supplier${filteredSuppliers.length !== 1 ? 's' : ''}`
                  : `${filteredListings.length} product${filteredListings.length !== 1 ? 's' : ''}`
                }
              </Text>
            </View>
          </View>
        }
        ListFooterComponent={
          <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, gap: 10 }}>
            {viewMode === 'suppliers'
              ? filteredSuppliers.map(supplier => (
                  <View key={supplier.id}>
                    {renderSupplierCard({ item: supplier })}
                  </View>
                ))
              : filteredListings.map(listing => (
                  <View key={listing.id}>
                    {renderListingCard({ item: listing })}
                  </View>
                ))
            }
            {viewMode === 'suppliers' && filteredSuppliers.length === 0 && (
              <View style={styles.emptyState}>
                <Store size={40} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.emptyTitle}>No suppliers match yet</Text>
                <Text style={styles.emptyDesc}>
                  Clear the search box, switch the category chip, or tap the Listings tab to see products instead of vendors.
                </Text>
              </View>
            )}
            {viewMode === 'listings' && filteredListings.length === 0 && (
              <View style={styles.emptyState}>
                <MageMaterials size={40} color={themeColors.textMuted} />
                <Text style={styles.emptyTitle}>No products match yet</Text>
                <Text style={styles.emptyDesc}>
                  Try a broader category, clear your search, or switch to the Suppliers tab to browse vendors first.
                </Text>
              </View>
            )}
          </View>
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      <Modal
        visible={selectedSupplier !== null}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setSelectedSupplier(null)}
      >
        {selectedSupplier && (
          <View style={[styles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>{selectedSupplier.companyName}</Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setSelectedSupplier(null)}
                activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
              <View style={styles.supplierDetailHeader}>
                <View style={styles.supplierDetailAvatar}>
                  <Store size={32} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <View style={styles.ratingRowLarge}>
                  {renderStars(selectedSupplier.rating)}
                  <Text style={styles.ratingTextLarge}>{selectedSupplier.rating}</Text>
                </View>
                <Text style={styles.supplierDetailDesc}>{selectedSupplier.description}</Text>
              </View>

              <View style={styles.contactGrid}>
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => handleContactSupplier(selectedSupplier, 'email')}
                  activeOpacity={0.7}
                >
                  <Mail size={18} color={themeColors.info} strokeWidth={1.75} />
                  <Text style={styles.contactBtnText}>Email</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => handleContactSupplier(selectedSupplier, 'phone')}
                  activeOpacity={0.7}
                >
                  <Phone size={18} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={styles.contactBtnText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => handleContactSupplier(selectedSupplier, 'website')}
                  activeOpacity={0.7}
                >
                  <Globe size={18} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.contactBtnText}>Website</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.detailInfoCard}>
                <View style={styles.detailInfoRow}>
                  <MapPin size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.detailInfoText}>{selectedSupplier.address}</Text>
                </View>
                <View style={styles.detailInfoDivider} />
                <View style={styles.detailInfoRow}>
                  <Truck size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.detailInfoText}>{selectedSupplier.deliveryOptions.join(' · ')}</Text>
                </View>
                <View style={styles.detailInfoDivider} />
                <View style={styles.detailInfoRow}>
                  <DollarSign size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.detailInfoText}>Min order: ${selectedSupplier.minOrderAmount}</Text>
                </View>
              </View>

              <Text style={styles.detailSectionLabel}>
                PRODUCTS ({supplierListings.length})
              </Text>
              <View style={styles.detailListingsCard}>
                {supplierListings.map((listing, idx) => {
                  const savings = listing.price > 0 ? Math.round(((listing.price - listing.bulkPrice) / listing.price) * 100) : 0;
                  return (
                    <View key={listing.id}>
                      <TouchableOpacity
                        style={styles.detailListingRow}
                        onPress={() => {
                          setSelectedListing(listing);
                          setOrderQty('1');
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.detailListingInfo}>
                          <Text style={styles.detailListingName}>{listing.name}</Text>
                          <Text style={styles.detailListingMeta}>
                            ${listing.bulkPrice.toFixed(2)}/{listing.unit} bulk · {listing.leadTimeDays}d lead
                          </Text>
                        </View>
                        <View style={styles.detailListingRight}>
                          <Text style={styles.detailListingPrice}>${listing.price.toFixed(2)}</Text>
                          {savings > 0 && (
                            <View style={styles.detailSaveBadge}>
                              <Text style={styles.detailSaveText}>-{savings}%</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                      {idx < supplierListings.length - 1 && <View style={styles.detailListingDivider} />}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>

      <Modal
        visible={selectedListing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedListing(null)}
      >
        <Pressable style={styles.popupOverlay} onPress={() => setSelectedListing(null)}>
          <Pressable style={styles.popupCard} onPress={() => undefined}>
            {selectedListing && (() => {
              const supplier = getSupplier(selectedListing.supplierId);
              const qty = parseInt(orderQty, 10) || 0;
              const usesBulk = qty >= selectedListing.bulkMinQty;
              const savings = selectedListing.price > 0 ? Math.round(((selectedListing.price - selectedListing.bulkPrice) / selectedListing.price) * 100) : 0;

              return (
                <>
                  <View style={styles.popupHeader}>
                    <Text style={styles.popupTitle} numberOfLines={2}>{selectedListing.name}</Text>
                    <TouchableOpacity onPress={() => setSelectedListing(null)} style={styles.popupCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                      <X size={18} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.popupDesc}>{selectedListing.description}</Text>

                  {supplier && (
                    <View style={styles.popupSupplierRow}>
                      <Store size={12} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.popupSupplierName}>{supplier.companyName}</Text>
                      {selectedListing.inStock && (
                        <View style={styles.popupStockBadge}>
                          <CheckCircle size={10} color={themeColors.success} strokeWidth={1.75} />
                          <Text style={styles.popupStockText}>In Stock</Text>
                        </View>
                      )}
                    </View>
                  )}

                  <View style={styles.popupPriceRow}>
                    <View style={styles.popupPriceBlock}>
                      <Text style={styles.popupPriceLabel}>RETAIL</Text>
                      <Text style={styles.popupRetail}>${selectedListing.price.toFixed(2)}</Text>
                      <Text style={styles.popupPriceUnit}>/{selectedListing.unit}</Text>
                    </View>
                    <View style={styles.popupPriceBlock}>
                      <Text style={[styles.popupPriceLabel, { color: themeColors.success }]}>BULK</Text>
                      <Text style={styles.popupBulk}>${selectedListing.bulkPrice.toFixed(2)}</Text>
                      <Text style={styles.popupPriceUnit}>/{selectedListing.unit}</Text>
                    </View>
                  </View>

                  <Text style={styles.popupFieldLabel}>Quantity ({selectedListing.unit})</Text>
                  <View style={styles.popupQtyRow}>
                    <TouchableOpacity
                      style={styles.popupQtyBtn}
                      onPress={() => {
                        const q = Math.max(1, (parseInt(orderQty, 10) || 1) - 1);
                        setOrderQty(String(q));
                      }}
                    >
                      <Text style={styles.popupQtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.popupQtyInput}
                      value={orderQty}
                      onChangeText={setOrderQty}
                      keyboardType="number-pad"
                      textAlign="center"
                      testID="order-qty-input"
                    />
                    <TouchableOpacity
                      style={styles.popupQtyBtn}
                      onPress={() => {
                        const q = (parseInt(orderQty, 10) || 0) + 1;
                        setOrderQty(String(q));
                      }}
                    >
                      <Text style={styles.popupQtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>

                  {usesBulk && (
                    <View style={styles.popupBulkBanner}>
                      <CheckCircle size={14} color={themeColors.success} strokeWidth={1.75} />
                      <Text style={styles.popupBulkText}>Bulk pricing applied! Save {savings}%</Text>
                    </View>
                  )}

                  <View style={styles.popupTotalRow}>
                    <Text style={styles.popupTotalLabel}>Estimated Total</Text>
                    <Text style={styles.popupTotalValue}>${orderTotal.toFixed(2)}</Text>
                  </View>

                  <View style={styles.popupLeadRow}>
                    <Clock size={12} color={themeColors.info} strokeWidth={1.75} />
                    <Text style={styles.popupLeadText}>
                      Estimated lead time: {selectedListing.leadTimeDays} business day{selectedListing.leadTimeDays !== 1 ? 's' : ''}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.popupRequestBtn}
                    onPress={() => handleRequestQuote(selectedListing)}
                    activeOpacity={0.85}
                    testID="request-quote-btn"
                  >
                    <Mail size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
                    <Text style={styles.popupRequestBtnText}>Request Quote via Email</Text>
                  </TouchableOpacity>

                  {supplier && (
                    <TouchableOpacity
                      style={styles.popupCallBtn}
                      onPress={() => handleContactSupplier(supplier, 'phone')}
                      activeOpacity={0.7}
                    >
                      <Phone size={16} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.popupCallBtnText}>Call {supplier.companyName}</Text>
                    </TouchableOpacity>
                  )}
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: themeColors.bg,
  },
  header: {
    backgroundColor: themeColors.surface,
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
  },
  largeTitle: {
    fontSize: Type.largeTitle.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textSecondary,
    marginTop: -4,
  },
  previewBanner: {
    marginTop: 12,
    padding: 12,
    backgroundColor: Colors.warning + '15',
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.warning + '40',
  },
  previewLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    color: Colors.warning,
    letterSpacing: 0.5,
  },
  previewBody: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.text,
    marginTop: 4,
    lineHeight: 18,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.lg,
    paddingHorizontal: 12,
    gap: 8,
    height: 44,
    marginTop: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.fillTertiary,
  },
  modeBtnActive: {
    backgroundColor: Colors.primary,
  },
  modeBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  modeBtnTextActive: {
    color: Colors.textOnPrimary,
  },
  categoriesWrapper: {
    backgroundColor: themeColors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
  },
  categoriesContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.fillTertiary,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
  },
  categoryEmoji: {
    fontSize: Type.footnote.fontSize,
  },
  categoryChipText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
  },
  categoryChipTextActive: {
    color: Colors.textOnPrimary,
    fontWeight: '600' as const,
  },
  resultsHeader: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  resultsCount: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
    letterSpacing: 0.2,
  },
  supplierCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  featuredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  featuredText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFB800',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  supplierTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  supplierAvatar: {
    width: 44,
    height: 44,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierInfo: {
    flex: 1,
    gap: 4,
  },
  supplierName: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    marginLeft: 3,
  },
  supplierDesc: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 18,
  },
  supplierMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  supplierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  supplierChipText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
  },
  supplierCats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  catTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.sm,
  },
  catTagText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  listingCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  listingTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  listingInfo: {
    flex: 1,
    gap: 3,
  },
  listingName: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
    lineHeight: 20,
  },
  listingDesc: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
  },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  stockText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  listingPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: themeColors.bg,
    borderRadius: Tokens.radius.md,
    padding: 10,
    gap: 8,
  },
  listingPriceBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  listingPriceLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    marginRight: 4,
    letterSpacing: 0.5,
  },
  listingRetail: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  listingBulk: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.success,
    letterSpacing: -0.3,
  },
  listingUnit: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
  },
  listingPriceDivider: {
    width: 0.5,
    height: 24,
    backgroundColor: themeColors.line,
  },
  listingSaveBadge: {
    alignItems: 'flex-end',
  },
  listingSaveText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  listingMinText: {
    fontSize: 10,
    color: themeColors.textMuted,
  },
  listingBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  listingSupplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listingSupplierText: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    fontWeight: '500' as const,
  },
  listingLeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listingLeadText: {
    fontSize: Type.caption2.fontSize,
    color: Colors.info,
    fontWeight: '500' as const,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: Type.body.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  emptyDesc: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textMuted,
    textAlign: 'center' as const,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: themeColors.bg,
  },
  modalHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: themeColors.line,
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
  },
  modalTitle: {
    flex: 1,
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    letterSpacing: -0.3,
    marginRight: 12,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierDetailHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 10,
  },
  supplierDetailAvatar: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  ratingRowLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingTextLarge: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    marginLeft: 4,
  },
  supplierDetailDesc: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  contactGrid: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  contactBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.surface,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  contactBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  detailInfoCard: {
    marginHorizontal: 20,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  detailInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailInfoText: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.text,
  },
  detailInfoDivider: {
    height: 0.5,
    backgroundColor: themeColors.line,
    marginLeft: 24,
  },
  detailSectionLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textMuted,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  detailListingsCard: {
    marginHorizontal: 20,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  detailListingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  detailListingInfo: {
    flex: 1,
    gap: 2,
  },
  detailListingName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  detailListingMeta: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
  },
  detailListingRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  detailListingPrice: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  detailSaveBadge: {
    backgroundColor: Colors.successLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  detailSaveText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  detailListingDivider: {
    height: 0.5,
    backgroundColor: themeColors.line,
    marginLeft: 14,
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  popupCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius["2xl"],
    padding: 20,
    gap: 12,
    maxHeight: '85%',
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  popupTitle: {
    flex: 1,
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    lineHeight: 24,
  },
  popupCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupDesc: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 18,
  },
  popupSupplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupSupplierName: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
    flex: 1,
  },
  popupStockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
  },
  popupStockText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  popupPriceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  popupPriceBlock: {
    flex: 1,
    backgroundColor: themeColors.bg,
    borderRadius: Tokens.radius.card,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  popupPriceLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    letterSpacing: 0.5,
    marginRight: 4,
  },
  popupRetail: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  popupBulk: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  popupPriceUnit: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
  },
  popupFieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    marginTop: 2,
  },
  popupQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  popupQtyBtn: {
    width: 44,
    height: 44,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupQtyBtnText: {
    fontSize: Type.title2.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  popupQtyInput: {
    flex: 1,
    height: 48,
    backgroundColor: themeColors.bg,
    borderRadius: Tokens.radius.card,
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  popupBulkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: Tokens.radius.md,
    padding: 10,
  },
  popupBulkText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  popupTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.primary + '08',
    borderRadius: Tokens.radius.card,
    padding: 14,
  },
  popupTotalLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  popupTotalValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  popupLeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupLeadText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.info,
    fontWeight: '500' as const,
  },
  popupRequestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    marginTop: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  popupRequestBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  popupCallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  popupCallBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});
