import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ClipboardCheck, Calendar, AlertTriangle, Check, XCircle,
  Clock, Search, Eye, ChevronRight, Plus,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_PERMITS, PERMIT_TYPE_INFO, PERMIT_STATUS_INFO } from '@/mocks/permits';
import type { Permit } from '@/types';
import { formatMoney } from '@/utils/formatters';

function PermitCard({ permit, onPress }: { permit: Permit; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const typeInfo = PERMIT_TYPE_INFO[permit.type] ?? PERMIT_TYPE_INFO.other;
  const statusInfo = PERMIT_STATUS_INFO[permit.status] ?? PERMIT_STATUS_INFO.applied;

  const isInspectionUpcoming = permit.inspectionDate &&
    (permit.status === 'inspection_scheduled') &&
    new Date(permit.inspectionDate).getTime() > Date.now();

  const daysUntilInspection = isInspectionUpcoming
    ? Math.ceil((new Date(permit.inspectionDate!).getTime() - Date.now()) / 86400000)
    : 0;

  return (
    <Animated.View style={[styles.permitCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.permitCardInner}
      >
        <View style={styles.permitHeader}>
          <View style={[styles.permitTypeDot, { backgroundColor: typeInfo.color }]} />
          <Text style={styles.permitType}>{typeInfo.label} Permit</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        </View>

        {permit.permitNumber && (
          <Text style={styles.permitNumber}>#{permit.permitNumber}</Text>
        )}

        <Text style={styles.permitProject}>{permit.projectName}</Text>
        <Text style={styles.permitJurisdiction}>{permit.jurisdiction}</Text>

        {isInspectionUpcoming && (
          <View style={styles.inspectionAlert}>
            <Calendar size={13} color="#6A1B9A" />
            <Text style={styles.inspectionAlertText}>
              Inspection in {daysUntilInspection} day{daysUntilInspection !== 1 ? 's' : ''} — {new Date(permit.inspectionDate!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </Text>
          </View>
        )}

        {permit.status === 'inspection_failed' && permit.inspectionNotes && (
          <View style={styles.failedAlert}>
            <AlertTriangle size={13} color="#C62828" />
            <Text style={styles.failedAlertText} numberOfLines={2}>{permit.inspectionNotes}</Text>
          </View>
        )}

        <View style={styles.permitFooter}>
          <Text style={styles.permitFee}>{formatMoney(permit.fee)}</Text>
          <Text style={styles.permitDate}>
            Applied {new Date(permit.appliedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function PermitsScreen() {
  const insets = useSafeAreaInsets();
  const [permits] = useState<Permit[]>(MOCK_PERMITS);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'inspections', label: 'Inspections' },
    { id: 'pending', label: 'Pending' },
  ];

  const filtered = useMemo(() => {
    if (selectedFilter === 'all') return permits;
    if (selectedFilter === 'active') return permits.filter(p => ['approved', 'inspection_scheduled', 'inspection_passed'].includes(p.status));
    if (selectedFilter === 'inspections') return permits.filter(p => p.status.startsWith('inspection'));
    if (selectedFilter === 'pending') return permits.filter(p => ['applied', 'under_review'].includes(p.status));
    return permits;
  }, [permits, selectedFilter]);

  const stats = useMemo(() => {
    const totalFees = permits.reduce((s, p) => s + p.fee, 0);
    const upcomingInspections = permits.filter(p =>
      p.status === 'inspection_scheduled' && p.inspectionDate && new Date(p.inspectionDate).getTime() > Date.now()
    ).length;
    const pending = permits.filter(p => ['applied', 'under_review'].includes(p.status)).length;
    const passed = permits.filter(p => ['approved', 'inspection_passed'].includes(p.status)).length;
    return { totalFees, upcomingInspections, pending, passed };
  }, [permits]);

  const handlePermitPress = useCallback((permit: Permit) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const statusInfo = PERMIT_STATUS_INFO[permit.status];
    const details = [
      `Type: ${PERMIT_TYPE_INFO[permit.type]?.label ?? permit.type}`,
      `Status: ${statusInfo.label}`,
      `Jurisdiction: ${permit.jurisdiction}`,
      `Fee: ${formatMoney(permit.fee)}`,
      permit.permitNumber ? `Permit #: ${permit.permitNumber}` : null,
      permit.inspectionDate ? `Inspection: ${new Date(permit.inspectionDate).toLocaleDateString()}` : null,
      permit.inspectionNotes ? `Notes: ${permit.inspectionNotes}` : null,
    ].filter(Boolean).join('\n');

    Alert.alert(permit.projectName, details);
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Permits', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: Colors.primary + '14' }]}>
              <ClipboardCheck size={16} color={Colors.primary} />
            </View>
            <Text style={styles.statValue}>{permits.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#F3E5F5' }]}>
              <Calendar size={16} color="#6A1B9A" />
            </View>
            <Text style={[styles.statValue, { color: '#6A1B9A' }]}>{stats.upcomingInspections}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#FFF3E0' }]}>
              <Clock size={16} color="#E65100" />
            </View>
            <Text style={[styles.statValue, { color: '#E65100' }]}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#E8F5E9' }]}>
              <Check size={16} color="#2E7D32" />
            </View>
            <Text style={[styles.statValue, { color: '#2E7D32' }]}>{stats.passed}</Text>
            <Text style={styles.statLabel}>Passed</Text>
          </View>
        </View>

        <View style={styles.feeCard}>
          <Text style={styles.feeLabel}>Total Permit Fees</Text>
          <Text style={styles.feeValue}>{formatMoney(stats.totalFees)}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, selectedFilter === f.id && styles.filterChipActive]}
              onPress={() => {
                setSelectedFilter(f.id);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, selectedFilter === f.id && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.listSection}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <ClipboardCheck size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No permits found</Text>
            </View>
          ) : (
            filtered.map(permit => (
              <PermitCard key={permit.id} permit={permit} onPress={() => handlePermitPress(permit)} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 16,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  statIconWrap: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary },
  feeCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  feeLabel: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' as const },
  feeValue: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff' },
  listSection: { paddingHorizontal: 16 },
  permitCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  permitCardInner: { padding: 14, gap: 4 },
  permitHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  permitTypeDot: { width: 8, height: 8, borderRadius: 4 },
  permitType: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontWeight: '600' as const },
  permitNumber: { fontSize: 13, fontWeight: '500' as const, color: Colors.textMuted },
  permitProject: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  permitJurisdiction: { fontSize: 13, color: Colors.textSecondary },
  inspectionAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  inspectionAlertText: { fontSize: 12, fontWeight: '500' as const, color: '#6A1B9A' },
  failedAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  failedAlertText: { fontSize: 12, color: '#C62828', flex: 1 },
  permitFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  permitFee: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  permitDate: { fontSize: 12, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
});
