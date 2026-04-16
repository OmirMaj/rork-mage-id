import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Package, Percent, MapPin, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { CATEGORY_META, CATEGORY_COST_FACTORS } from '@/constants/materials';
import type { MaterialItem } from '@/constants/materials';
import type { LaborRate } from '@/constants/laborRates';
import type { AssemblyItem } from '@/constants/assemblies';

interface CartItem {
  material: MaterialItem;
  quantity: number;
  markup: number;
  usesBulk: boolean;
}

interface LaborCartItem {
  labor: LaborRate;
  hours: number;
  adjustedRate: number;
}

interface AssemblyCartItem {
  assembly: AssemblyItem;
  quantity: number;
  materialsCost: number;
  laborCost: number;
  totalCost: number;
}

interface CostBreakdownReportProps {
  cart: CartItem[];
  laborCart: LaborCartItem[];
  assemblyCart: AssemblyCartItem[];
  globalMarkup: number;
  locationFactor: number;
  locationName?: string;
}

interface CategoryBreakdown {
  category: string;
  label: string;
  color: string;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  total: number;
}

const CostBreakdownReport = React.memo(function CostBreakdownReport({
  cart, laborCart, assemblyCart, globalMarkup, locationFactor, locationName: _locationName,
}: CostBreakdownReportProps) {
  const breakdown = useMemo(() => {
    const categoryMap = new Map<string, CategoryBreakdown>();

    for (const item of cart) {
      const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const totalMaterial = base * item.quantity;
      const factors = CATEGORY_COST_FACTORS[item.material.category];
      const laborCost = factors ? totalMaterial * factors.laborFactor : 0;
      const equipmentCost = factors ? totalMaterial * factors.equipmentFactor : 0;

      const cat = item.material.category;
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.materialCost += totalMaterial;
        existing.laborCost += laborCost;
        existing.equipmentCost += equipmentCost;
        existing.total += totalMaterial + laborCost + equipmentCost;
      } else {
        const meta = CATEGORY_META[cat];
        categoryMap.set(cat, {
          category: cat,
          label: meta?.label ?? cat,
          color: meta?.color ?? Colors.primary,
          materialCost: totalMaterial,
          laborCost,
          equipmentCost,
          total: totalMaterial + laborCost + equipmentCost,
        });
      }
    }

    return Array.from(categoryMap.values()).sort((a, b) => b.total - a.total);
  }, [cart]);

  const totals = useMemo(() => {
    let materialTotal = 0;
    let laborTotal = 0;
    let equipmentTotal = 0;

    for (const b of breakdown) {
      materialTotal += b.materialCost;
      laborTotal += b.laborCost;
      equipmentTotal += b.equipmentCost;
    }

    const directLaborTotal = laborCart.reduce((sum, i) => sum + i.adjustedRate * i.hours, 0);
    const assemblyMaterialTotal = assemblyCart.reduce((sum, i) => sum + i.materialsCost, 0);
    const assemblyLaborTotal = assemblyCart.reduce((sum, i) => sum + i.laborCost, 0);
    const laborHours = laborCart.reduce((sum, i) => sum + i.hours, 0);

    const combinedMaterial = materialTotal + assemblyMaterialTotal;
    const combinedLabor = laborTotal + directLaborTotal + assemblyLaborTotal;
    const combinedEquipment = equipmentTotal;
    const subtotal = combinedMaterial + combinedLabor + combinedEquipment;
    const markupAmount = (materialTotal * globalMarkup / 100);
    const grandTotal = subtotal + markupAmount;

    const matPct = grandTotal > 0 ? (combinedMaterial / grandTotal) * 100 : 0;
    const labPct = grandTotal > 0 ? (combinedLabor / grandTotal) * 100 : 0;
    const eqPct = grandTotal > 0 ? (combinedEquipment / grandTotal) * 100 : 0;
    const mkPct = grandTotal > 0 ? (markupAmount / grandTotal) * 100 : 0;

    return {
      materialTotal: combinedMaterial,
      laborTotal: combinedLabor,
      equipmentTotal: combinedEquipment,
      markupAmount,
      grandTotal,
      laborHours,
      matPct, labPct, eqPct, mkPct,
      matLaborRatio: combinedLabor > 0 ? (combinedMaterial / combinedLabor).toFixed(1) : 'N/A',
    };
  }, [breakdown, laborCart, assemblyCart, globalMarkup]);

  if (cart.length === 0 && laborCart.length === 0 && assemblyCart.length === 0) return null;

  return (
    <View style={s.container}>
      <Text style={s.sectionTitle}>Cost Report</Text>

      <View style={s.barContainer}>
        <View style={s.barTrack}>
          {totals.matPct > 0 && <View style={[s.barSegment, { width: `${totals.matPct}%`, backgroundColor: Colors.primary }]} />}
          {totals.labPct > 0 && <View style={[s.barSegment, { width: `${totals.labPct}%`, backgroundColor: Colors.accent }]} />}
          {totals.eqPct > 0 && <View style={[s.barSegment, { width: `${totals.eqPct}%`, backgroundColor: Colors.info }]} />}
          {totals.mkPct > 0 && <View style={[s.barSegment, { width: `${totals.mkPct}%`, backgroundColor: '#9CA3AF' }]} />}
        </View>
        <View style={s.legendRow}>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: Colors.primary }]} />
            <Text style={s.legendText}>Material {totals.matPct.toFixed(0)}%</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: Colors.accent }]} />
            <Text style={s.legendText}>Labor {totals.labPct.toFixed(0)}%</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: Colors.info }]} />
            <Text style={s.legendText}>Equip {totals.eqPct.toFixed(0)}%</Text>
          </View>
          {totals.mkPct > 0 && (
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: '#9CA3AF' }]} />
              <Text style={s.legendText}>Markup {totals.mkPct.toFixed(0)}%</Text>
            </View>
          )}
        </View>
      </View>

      {breakdown.length > 0 && (
        <View style={s.divisionTable}>
          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderCell, { flex: 2 }]}>Division</Text>
            <Text style={s.tableHeaderCell}>Material</Text>
            <Text style={s.tableHeaderCell}>Labor</Text>
            <Text style={s.tableHeaderCell}>Total</Text>
          </View>
          {breakdown.slice(0, 6).map(b => (
            <View key={b.category} style={s.tableRow}>
              <View style={[s.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                <View style={[s.tableDot, { backgroundColor: b.color }]} />
                <Text style={s.tableCellText} numberOfLines={1}>{b.label}</Text>
              </View>
              <Text style={[s.tableCellText, { flex: 1, textAlign: 'right' as const }]}>${b.materialCost.toFixed(0)}</Text>
              <Text style={[s.tableCellText, { flex: 1, textAlign: 'right' as const }]}>${b.laborCost.toFixed(0)}</Text>
              <Text style={[s.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>${b.total.toFixed(0)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.metricsGrid}>
        <View style={s.metricCard}>
          <Package size={14} color={Colors.primary} />
          <Text style={s.metricLabel}>Mat:Labor</Text>
          <Text style={s.metricValue}>{totals.matLaborRatio}:1</Text>
        </View>
        <View style={s.metricCard}>
          <Percent size={14} color={Colors.accent} />
          <Text style={s.metricLabel}>Markup</Text>
          <Text style={s.metricValue}>${totals.markupAmount.toFixed(0)}</Text>
        </View>
        <View style={s.metricCard}>
          <Clock size={14} color={Colors.info} />
          <Text style={s.metricLabel}>Labor Hrs</Text>
          <Text style={s.metricValue}>{totals.laborHours.toFixed(0)}</Text>
        </View>
        {locationFactor !== 1 && (
          <View style={s.metricCard}>
            <MapPin size={14} color={Colors.warning} />
            <Text style={s.metricLabel}>Location</Text>
            <Text style={s.metricValue}>{locationFactor.toFixed(2)}x</Text>
          </View>
        )}
      </View>
    </View>
  );
});

export default CostBreakdownReport;

const s = StyleSheet.create({
  container: { gap: 12 },
  sectionTitle: {
    fontSize: 16, fontWeight: '700' as const, color: Colors.text,
    paddingHorizontal: 16, paddingTop: 8,
  },
  barContainer: {
    marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  barTrack: {
    flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden' as const,
    backgroundColor: Colors.fillTertiary,
  },
  barSegment: { height: '100%' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary },
  divisionTable: {
    marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' as const,
  },
  tableHeader: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: Colors.fillSecondary, gap: 4,
  },
  tableHeaderCell: {
    flex: 1, fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 0.5, borderTopColor: Colors.borderLight, alignItems: 'center', gap: 4,
  },
  tableCell: { flex: 1 },
  tableDot: { width: 6, height: 6, borderRadius: 3 },
  tableCellText: { fontSize: 12, color: Colors.textSecondary },
  tableCellBold: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  metricsGrid: {
    flexDirection: 'row', flexWrap: 'wrap' as const, paddingHorizontal: 16, gap: 8,
  },
  metricCard: {
    flex: 1, minWidth: 70, backgroundColor: Colors.surface, borderRadius: 10, padding: 10,
    alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  metricLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted },
  metricValue: { fontSize: 14, fontWeight: '800' as const, color: Colors.text },
});
