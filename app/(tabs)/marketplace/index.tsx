import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Modal, Pressable, Alert, Platform, FlatList, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Search, X, Star, Truck, Clock, MapPin, Phone, Mail, Globe,
  ChevronRight, Package, CheckCircle,
  Store, Award, DollarSign,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_SUPPLIERS, MOCK_LISTINGS, SUPPLIER_CATEGORIES } from '@/mocks/suppliers';
import type { Supplier, SupplierListing } from '@/types';

type ViewMode = 'suppliers' | 'listings';

export default function MarketplaceScreen() {
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
      const url = `mailto:${supplier.email}?subject=Inquiry from Tertiary - ${supplier.companyName}`;
      Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open email client.'));
    } else if (method === 'phone') {
      Linking.openURL(`tel:${supplier.phone}`).catch(() => Alert.alert('Error', 'Could not open phone.'));
    } else {
      Linking.openURL(`https://${supplier.website}`).catch(() => Alert.alert('Error', 'Could not open browser.'));
    }
  }, []);

  const handleRequestQuote = useCallback((listing: SupplierListing) => {
    const qty = parseInt(orderQty, 10);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid quantity.');
      return;
    }
    const supplier = getSupplier(listing.supplierId);
    if (!supplier) return;
    const usesBulk = qty >= listing.bulkMinQty;
    const unitPrice = usesBulk ? listing.bulkPrice : listing.price;
    const total = unitPrice * qty;

    const subject = `Tertiary Quote Request - ${listing.name}`;
    const body = `Hi ${supplier.contactName},\n\nI'd like to request a quote for:\n\nItem: ${listing.name}\nQuantity: ${qty} ${listing.unit}\nUnit Price: $${unitPrice.toFixed(2)}${usesBulk ? ' (bulk rate)' : ''}\nEstimated Total: $${total.toFixed(2)}\n\nPlease confirm availability and delivery timeline.\n\nThank you,\nSent via Tertiary`;
    const url = `mailto:${supplier.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open email client.'));
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
          color={i <= Math.round(rating) ? '#FFB800' : Colors.borderLight}
          fill={i <= Math.round(rating) ? '#FFB800' : 'transparent'}
        />
      );
    }
    return stars;
  }, []);

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
            <Award size={10} color="#FFB800" />
            <Text style={styles.featuredText}>Featured</Text>
          </View>
        )}
        <View style={styles.supplierTop}>
          <View style={styles.supplierAvatar}>
            <Store size={20} color={Colors.primary} />
          </View>
          <View style={styles.supplierInfo}>
            <Text style={styles.supplierName} numberOfLines={1}>{item.companyName}</Text>
            <View style={styles.ratingRow}>
              {renderStars(item.rating)}
              <Text style={styles.ratingText}>{item.rating}</Text>
            </View>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </View>
        <Text style={styles.supplierDesc} numberOfLines={2}>{item.description}</Text>
        <View style={styles.supplierMeta}>
          <View style={styles.supplierChip}>
            <Package size={10} color={Colors.info} />
            <Text style={styles.supplierChipText}>{listingCount} products</Text>
          </View>
          <View style={styles.supplierChip}>
            <MapPin size={10} color={Colors.textMuted} />
            <Text style={styles.supplierChipText}>{item.address.split(',').pop()?.trim()}</Text>
          </View>
          <View style={styles.supplierChip}>
            <DollarSign size={10} color={Colors.success} />
            <Text style={styles.supplierChipText}>Min ${item.minOrderAmount}</Text>
          </View>
        </View>
        <View style={styles.supplierCats}>
          {item.categories.map(cat => {
            const catInfo = SUPPLIER_CATEGORIES.find(c => c.id === cat);
            return (
              <View key={cat} style={styles.catTag}>
                <Text style={styles.catTagText}>{catInfo?.emoji} {catInfo?.label ?? cat}</Text>
              </View>
            );
          })}
        </View>
      </TouchableOpacity>
    );
  }, [renderStars]);

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
              <CheckCircle size={10} color={Colors.success} />
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
            <Text style={[styles.listingPriceLabel, { color: Colors.success }]}>BULK</Text>
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
              <Store size={10} color={Colors.textMuted} />
              <Text style={styles.listingSupplierText}>{supplier.companyName}</Text>
            </View>
          )}
          <View style={styles.listingLeadRow}>
            <Clock size={10} color={Colors.info} />
            <Text style={styles.listingLeadText}>{item.leadTimeDays}d lead</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [getSupplier]);

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
        ListHeaderComponent={
          <View>
            <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
              <Text style={styles.largeTitle}>Marketplace</Text>
              <Text style={styles.subtitle}>Buy materials directly from suppliers</Text>

              <View style={styles.searchBar}>
                <Search size={16} color={Colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search suppliers, materials..."
                  placeholderTextColor={Colors.textMuted}
                  autoCorrect={false}
                  selectionColor={Colors.primary}
                  underlineColorAndroid="transparent"
                  testID="marketplace-search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, viewMode === 'suppliers' && styles.modeBtnActive]}
                  onPress={() => setViewMode('suppliers')}
                  activeOpacity={0.7}
                >
                  <Store size={14} color={viewMode === 'suppliers' ? Colors.textOnPrimary : Colors.textSecondary} />
                  <Text style={[styles.modeBtnText, viewMode === 'suppliers' && styles.modeBtnTextActive]}>Suppliers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, viewMode === 'listings' && styles.modeBtnActive]}
                  onPress={() => setViewMode('listings')}
                  activeOpacity={0.7}
                >
                  <Package size={14} color={viewMode === 'listings' ? Colors.textOnPrimary : Colors.textSecondary} />
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
                      <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
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
                <Store size={40} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>No suppliers found</Text>
                <Text style={styles.emptyDesc}>Try a different search or category</Text>
              </View>
            )}
            {viewMode === 'listings' && filteredListings.length === 0 && (
              <View style={styles.emptyState}>
                <Package size={40} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>No products found</Text>
                <Text style={styles.emptyDesc}>Try a different search or category</Text>
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
                activeOpacity={0.7}
              >
                <X size={20} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
              <View style={styles.supplierDetailHeader}>
                <View style={styles.supplierDetailAvatar}>
                  <Store size={32} color={Colors.primary} />
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
                  <Mail size={18} color={Colors.info} />
                  <Text style={styles.contactBtnText}>Email</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => handleContactSupplier(selectedSupplier, 'phone')}
                  activeOpacity={0.7}
                >
                  <Phone size={18} color={Colors.success} />
                  <Text style={styles.contactBtnText}>Call</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => handleContactSupplier(selectedSupplier, 'website')}
                  activeOpacity={0.7}
                >
                  <Globe size={18} color={Colors.accent} />
                  <Text style={styles.contactBtnText}>Website</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.detailInfoCard}>
                <View style={styles.detailInfoRow}>
                  <MapPin size={14} color={Colors.textMuted} />
                  <Text style={styles.detailInfoText}>{selectedSupplier.address}</Text>
                </View>
                <View style={styles.detailInfoDivider} />
                <View style={styles.detailInfoRow}>
                  <Truck size={14} color={Colors.textMuted} />
                  <Text style={styles.detailInfoText}>{selectedSupplier.deliveryOptions.join(' · ')}</Text>
                </View>
                <View style={styles.detailInfoDivider} />
                <View style={styles.detailInfoRow}>
                  <DollarSign size={14} color={Colors.textMuted} />
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
                    <TouchableOpacity onPress={() => setSelectedListing(null)} style={styles.popupCloseBtn}>
                      <X size={18} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.popupDesc}>{selectedListing.description}</Text>

                  {supplier && (
                    <View style={styles.popupSupplierRow}>
                      <Store size={12} color={Colors.primary} />
                      <Text style={styles.popupSupplierName}>{supplier.companyName}</Text>
                      {selectedListing.inStock && (
                        <View style={styles.popupStockBadge}>
                          <CheckCircle size={10} color={Colors.success} />
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
                      <Text style={[styles.popupPriceLabel, { color: Colors.success }]}>BULK</Text>
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
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={styles.popupBulkText}>Bulk pricing applied! Save {savings}%</Text>
                    </View>
                  )}

                  <View style={styles.popupTotalRow}>
                    <Text style={styles.popupTotalLabel}>Estimated Total</Text>
                    <Text style={styles.popupTotalValue}>${orderTotal.toFixed(2)}</Text>
                  </View>

                  <View style={styles.popupLeadRow}>
                    <Clock size={12} color={Colors.info} />
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
                    <Mail size={18} color={Colors.textOnPrimary} />
                    <Text style={styles.popupRequestBtnText}>Request Quote via Email</Text>
                  </TouchableOpacity>

                  {supplier && (
                    <TouchableOpacity
                      style={styles.popupCallBtn}
                      onPress={() => handleContactSupplier(supplier, 'phone')}
                      activeOpacity={0.7}
                    >
                      <Phone size={16} color={Colors.primary} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: -4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 14,
    paddingHorizontal: 12,
    gap: 8,
    height: 44,
    marginTop: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
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
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
  },
  modeBtnActive: {
    backgroundColor: Colors.primary,
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  modeBtnTextActive: {
    color: Colors.textOnPrimary,
  },
  categoriesWrapper: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
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
    fontSize: 13,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
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
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.2,
  },
  supplierCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
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
    borderRadius: 6,
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
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supplierInfo: {
    flex: 1,
    gap: 4,
  },
  supplierName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginLeft: 3,
  },
  supplierDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
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
    borderRadius: 6,
  },
  supplierChipText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  supplierCats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  catTag: {
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  catTagText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  listingCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
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
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    lineHeight: 20,
  },
  listingDesc: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.successLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  stockText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  listingPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 10,
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
    color: Colors.textMuted,
    marginRight: 4,
    letterSpacing: 0.5,
  },
  listingRetail: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  listingBulk: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.success,
    letterSpacing: -0.3,
  },
  listingUnit: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  listingPriceDivider: {
    width: 0.5,
    height: 24,
    backgroundColor: Colors.border,
  },
  listingSaveBadge: {
    alignItems: 'flex-end',
  },
  listingSaveText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  listingMinText: {
    fontSize: 10,
    color: Colors.textMuted,
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
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  listingLeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  listingLeadText: {
    fontSize: 11,
    color: Colors.info,
    fontWeight: '500' as const,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
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
    borderBottomColor: Colors.borderLight,
  },
  modalTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.3,
    marginRight: 12,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginLeft: 4,
  },
  supplierDetailDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
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
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  contactBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  detailInfoCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  detailInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailInfoText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
  },
  detailInfoDivider: {
    height: 0.5,
    backgroundColor: Colors.borderLight,
    marginLeft: 24,
  },
  detailSectionLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  detailListingsCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
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
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  detailListingMeta: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  detailListingRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  detailListingPrice: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
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
    backgroundColor: Colors.borderLight,
    marginLeft: 14,
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  popupCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
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
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
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
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  popupSupplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupSupplierName: {
    fontSize: 13,
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
    borderRadius: 6,
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
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  popupPriceLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginRight: 4,
  },
  popupRetail: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  popupBulk: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  popupPriceUnit: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  popupFieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
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
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupQtyBtnText: {
    fontSize: 22,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  popupQtyInput: {
    flex: 1,
    height: 48,
    backgroundColor: Colors.background,
    borderRadius: 12,
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  popupBulkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: 10,
    padding: 10,
  },
  popupBulkText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  popupTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.primary + '08',
    borderRadius: 12,
    padding: 14,
  },
  popupTotalLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  popupTotalValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  popupLeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupLeadText: {
    fontSize: 12,
    color: Colors.info,
    fontWeight: '500' as const,
  },
  popupRequestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  popupRequestBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  popupCallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  popupCallBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});
