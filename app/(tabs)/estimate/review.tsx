import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { PackageOpen, Share2 } from 'lucide-react-native';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { EstimateSummaryHeader } from '@/components/estimate/EstimateSummaryHeader';
import { EstimateMetricGrid } from '@/components/estimate/EstimateMetricGrid';
import { EstimateSummaryCard } from '@/components/estimate/EstimateSummaryCard';
import { EstimateCostBreakdown } from '@/components/estimate/EstimateCostBreakdown';
import { EstimateDivisionTable, type DivisionRow } from '@/components/estimate/EstimateDivisionTable';
import { EstimateTotalsBar } from '@/components/estimate/EstimateTotalsBar';
import { EstimateClientView } from '@/components/estimate/EstimateClientView';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { classifyToCSIDivision, groupByCSIDivision } from '@/utils/csiMasterFormat';
import { toClientEstimateView, defaultPaymentSchedule } from '@/utils/clientEstimateView';
import { buildClientEstimateSharePayload, encodeClientEstimateToken } from '@/utils/clientEstimateShareToken';
import type { LinkedEstimate } from '@/types';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { useProjects } from '@/contexts/ProjectContext';
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
  const { settings } = useProjects();
  const layout = useResponsiveLayout();
  const isDesktop = layout.isDesktop;
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

  // Build the client-safe proposal link and copy it. The token is built from
  // clientView only, so the shared URL can never carry costs or markups.
  const handleShareProposal = useCallback(async () => {
    const gcName = settings?.branding?.companyName || undefined;
    const payload = buildClientEstimateSharePayload(clientView, {
      projectName: gcName ? `${gcName} — Estimate` : 'Project Estimate',
      gcName,
      paymentSchedule: defaultPaymentSchedule(clientView.projectTotal),
    });
    const token = encodeClientEstimateToken(payload);
    const base = Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://mageid.app';
    const url = `${base}/shared-estimate?t=${token}`;
    const ok = await (await import('@/utils/clipboard')).copyToClipboard(url);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      ok ? 'Proposal link copied' : 'Proposal link',
      ok
        ? 'Client-safe link copied to your clipboard. Paste it into a text or email — no login needed, and it shows no costs, markups or margin.'
        : url,
    );
  }, [clientView, settings]);

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
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + (cart.length > 0 && mode === 'contractor' ? 88 : 40) }}
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
              isDesktop ? (
                <View>
                  <EstimateMetricGrid directCost={directCost} markups={markups} itemCount={itemCount} wide />
                  <View style={styles.desktopRow}>
                    <View style={styles.desktopMain}>
                      <EstimateDivisionTable divisions={divisions} />
                    </View>
                    <View style={styles.desktopRail}>
                      <EstimateSummaryCard directCost={directCost} markups={markups} />
                      <View style={{ height: 14 }} />
                      <EstimateCostBreakdown divisions={divisions} />
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  <EstimateSummaryHeader directCost={directCost} markups={markups} itemCount={itemCount} />
                  <EstimateDivisionTable divisions={divisions} />
                </>
              )
            ) : (
              <View style={isDesktop ? styles.clientDesktopWrap : undefined}>
                <EstimateClientView view={clientView} paymentSchedule={defaultPaymentSchedule(clientView.projectTotal)} />
                <TouchableOpacity
                  style={styles.shareBtn}
                  onPress={() => { void handleShareProposal(); }}
                  activeOpacity={0.85}
                  testID="review-share-proposal"
                >
                  <Share2 size={16} color={colors.surface} strokeWidth={2} />
                  <Text style={styles.shareBtnText}>Share proposal</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {cart.length > 0 && mode === 'contractor' && (
        <View style={[styles.totalsBarWrap, { paddingBottom: insets.bottom }]}>
          <EstimateTotalsBar
            itemCount={itemCount}
            divisionCount={divisions.length}
            cost={directCost}
            markups={markups}
            grandTotal={directCost + markups}
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  hero: { paddingHorizontal: 20, paddingBottom: 20, overflow: 'hidden' },
  heroEyebrow: { color: '#FF8533', fontSize: Type.caption2.fontSize, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4 },
  // Fraunces display face — same hero band as the estimate hub + wizard.
  heroTitle: { ...Type.serifTitle, color: '#F4EFE6' },
  heroSub: { color: '#C9C3B8', fontSize: Type.subhead.fontSize, marginTop: 4 },
  toggle: { flexDirection: 'row', gap: 4, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md, padding: 4, marginBottom: 16 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: Tokens.radius.sm },
  segOn: { backgroundColor: t.accent },
  segText: { fontSize: 13, fontWeight: '700', color: t.textMuted },
  segTextOn: { color: t.surface },
  totalsBarWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.surfaceAlt },
  desktopRow: { flexDirection: 'row', gap: 16, marginTop: 12, alignItems: 'flex-start' },
  desktopMain: { flex: 1.7, minWidth: 0 },
  desktopRail: { width: 340 },
  clientDesktopWrap: { maxWidth: 640, alignSelf: 'center', width: '100%' },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accent, borderRadius: Tokens.radius.md, paddingVertical: 15, marginTop: 22 },
  shareBtnText: { color: t.surface, fontSize: 15, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { color: t.text, fontSize: Type.headline.fontSize, fontWeight: '700' },
  emptyDesc: { color: t.textSecondary, fontSize: Type.subhead.fontSize, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
});
