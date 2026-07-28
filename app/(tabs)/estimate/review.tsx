import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { PackageOpen } from 'lucide-react-native';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { EstimateSummaryHeader } from '@/components/estimate/EstimateSummaryHeader';
import { EstimateDivisionTable, type DivisionRow } from '@/components/estimate/EstimateDivisionTable';
import { EstimateClientView } from '@/components/estimate/EstimateClientView';
import { classifyToCSIDivision, groupByCSIDivision } from '@/utils/csiMasterFormat';
import { toClientEstimateView } from '@/utils/clientEstimateView';
import type { LinkedEstimate } from '@/types';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Redesigned estimate REVIEW — the approved ink+amber summary view reading the
// live material cart. Non-destructive: the catalog/cart estimator at
// /(tabs)/estimate/full is untouched; this proves the new direction on device
// before it becomes the primary surface (docs/design/estimate-redesign).
export default function EstimateReviewScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { cart, globalMarkup } = useMaterialCart();
  const [mode, setMode] = useState<'contractor' | 'client'>('contractor');

  const switchMode = useCallback((m: 'contractor' | 'client') => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setMode(m);
  }, []);

  const { directCost, markups, itemCount } = useMemo(() => {
    const base = cart.reduce((sum, item) => {
      const p = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      return sum + p * item.quantity;
    }, 0);
    const withMarkup = cart.reduce((sum, item) => {
      const p = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      return sum + p * (1 + item.markup / 100) * item.quantity;
    }, 0);
    return { directCost: base, markups: withMarkup - base, itemCount: cart.length };
  }, [cart]);

  // Group the cart into CSI divisions for the contractor scope table. Materials
  // carry no explicit csiDivision, so classify from name then category.
  const divisions: DivisionRow[] = useMemo(() => {
    const rows = cart.map(item => {
      const p = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const total = p * (1 + item.markup / 100) * item.quantity;
      const csi = classifyToCSIDivision(item.material.name)
        ?? classifyToCSIDivision(item.material.category)
        ?? undefined;
      return { csiDivision: csi, name: item.material.name, qty: item.quantity, unit: item.material.unit, total };
    });
    return groupByCSIDivision(rows).map(g => ({
      key: g.division?.number ?? 'other',
      number: g.division?.number ?? null,
      title: g.division?.title ?? 'Other scope',
      total: g.items.reduce((s, r) => s + r.total, 0),
      items: g.items.map(r => ({ name: r.name, qty: r.qty, unit: r.unit, total: r.total })),
    }));
  }, [cart]);

  // Client-safe projection — build a LinkedEstimate from the cart (base line
  // totals + grand total) and run the validated transform. It strips every
  // internal number; the client view only ever sees what it returns.
  const clientView = useMemo(() => {
    const items = cart.map(item => {
      const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const csi = classifyToCSIDivision(item.material.name)
        ?? classifyToCSIDivision(item.material.category)
        ?? undefined;
      return {
        materialId: item.material.id, name: item.material.name, category: item.material.category,
        unit: item.material.unit, quantity: item.quantity, unitPrice: base,
        bulkPrice: item.material.baseBulkPrice, markup: item.markup, usesBulk: item.usesBulk,
        lineTotal: base * item.quantity, supplier: item.material.supplier ?? '', csiDivision: csi,
      };
    });
    const baseTotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const grandTotal = directCost + markups;
    const est: LinkedEstimate = {
      id: 'live', items, globalMarkup, baseTotal, markupTotal: grandTotal - baseTotal, grandTotal, createdAt: '',
    };
    return toClientEstimateView(est);
  }, [cart, globalMarkup, directCost, markups]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Estimate Review' }} />
      <View style={[styles.hero, { paddingTop: insets.top + 18 }]}>
        <BrandBackdrop />
        <Text style={styles.heroEyebrow}>ESTIMATE · {globalMarkup}% MARKUP</Text>
        <Text style={styles.heroTitle}>Review</Text>
        <Text style={styles.heroSub}>Your working estimate, at a glance.</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {cart.length === 0 ? (
          <View style={styles.empty}>
            <PackageOpen size={40} color={colors.textMuted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No line items yet</Text>
            <Text style={styles.emptyDesc}>Add materials in the Full Estimator and they roll up here with metrics, markup and scope.</Text>
          </View>
        ) : (
          <>
            <View style={styles.toggle}>
              <TouchableOpacity
                style={[styles.seg, mode === 'contractor' && styles.segOn]}
                onPress={() => switchMode('contractor')}
                activeOpacity={0.8}
                testID="review-mode-contractor"
              >
                <Text style={[styles.segText, mode === 'contractor' && styles.segTextOn]}>Contractor</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.seg, mode === 'client' && styles.segOn]}
                onPress={() => switchMode('client')}
                activeOpacity={0.8}
                testID="review-mode-client"
              >
                <Text style={[styles.segText, mode === 'client' && styles.segTextOn]}>Client</Text>
              </TouchableOpacity>
            </View>

            {mode === 'contractor' ? (
              <>
                <EstimateSummaryHeader directCost={directCost} markups={markups} itemCount={itemCount} />
                <EstimateDivisionTable divisions={divisions} />
              </>
            ) : (
              <EstimateClientView view={clientView} />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  hero: { paddingHorizontal: 20, paddingBottom: 20, overflow: 'hidden' },
  heroEyebrow: { color: '#FF8533', fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4 },
  heroTitle: { color: '#F4EFE6', fontSize: Type.title1.fontSize, fontWeight: '800' },
  heroSub: { color: '#C9C3B8', fontSize: Type.subhead.fontSize, marginTop: 4 },
  toggle: { flexDirection: 'row', gap: 4, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md, padding: 4, marginBottom: 16 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Tokens.radius.sm },
  segOn: { backgroundColor: t.accent },
  segText: { fontSize: 13, fontWeight: '700', color: t.textMuted },
  segTextOn: { color: t.surface },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { color: t.text, fontSize: Type.headline.fontSize, fontWeight: '700' },
  emptyDesc: { color: t.textSecondary, fontSize: Type.subhead.fontSize, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
});
