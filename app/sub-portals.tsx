import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, HardHat, Inbox } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubSubmittedInvoices } from '@/hooks/useSubSubmittedInvoices';
import { formatMoney } from '@/utils/formatters';

interface PairRow {
  key: string;
  projectId: string;
  projectName: string;
  subId: string;
  subName: string;
  trade: string;
  totalCommitment: number;
}

export default function SubPortalsListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    projects, subcontractors, commitments,
  } = useProjects();

  // Build a list of (project, sub) pairs that have at least one commitment.
  const pairs = useMemo<PairRow[]>(() => {
    const map = new Map<string, PairRow>();
    for (const c of commitments) {
      if (!c.subcontractorId) continue;
      const project = projects.find(p => p.id === c.projectId);
      const sub = subcontractors.find(s => s.id === c.subcontractorId);
      if (!project || !sub) continue;
      const key = `${project.id}::${sub.id}`;
      const existing = map.get(key);
      const value = c.amount + (c.changeAmount ?? 0);
      if (existing) {
        existing.totalCommitment += value;
      } else {
        map.set(key, {
          key,
          projectId: project.id,
          projectName: project.name,
          subId: sub.id,
          subName: sub.companyName,
          trade: sub.trade,
          totalCommitment: value,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalCommitment - a.totalCommitment);
  }, [projects, subcontractors, commitments]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen
        options={{
          title: 'Sub Portals',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={Colors.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.headerWrap}>
        <Text style={styles.title}>Sub portals</Text>
        <Text style={styles.subtitle}>
          One self-serve link per sub per project — they review scope, submit invoices, and track payment without asking you for updates.
        </Text>
      </View>

      <FlatList
        data={pairs}
        keyExtractor={p => p.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Inbox size={32} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No commitments yet</Text>
            <Text style={styles.emptyBody}>Add a sub commitment to a project — that&apos;s the link between a sub and a project, and what powers their portal.</Text>
          </View>
        }
        renderItem={({ item }) => <PairRowItem item={item} onPress={() =>
          router.push({ pathname: '/sub-portal-setup', params: { projectId: item.projectId, subId: item.subId } } as never)
        } />}
      />
    </View>
  );
}

function PairRowItem({ item, onPress }: { item: PairRow; onPress: () => void }) {
  const submitted = useSubSubmittedInvoices({ projectId: item.projectId });
  const pendingForThisSub = useMemo(() =>
    submitted.pending.filter(i => i.subcontractorId === item.subId),
    [submitted.pending, item.subId]);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <HardHat size={20} color={Colors.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.subName}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {item.trade} · {item.projectName}
        </Text>
        <View style={styles.rowFoot}>
          <Text style={styles.rowAmount}>{formatMoney(item.totalCommitment)}</Text>
          {pendingForThisSub.length > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{pendingForThisSub.length} new invoice{pendingForThisSub.length === 1 ? '' : 's'}</Text>
            </View>
          )}
        </View>
      </View>
      <ChevronRight size={18} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: Colors.textMuted, marginTop: 6, lineHeight: 20 },

  empty: {
    alignItems: 'center', padding: 36, marginTop: 32,
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14, marginBottom: 10,
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  rowMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  rowAmount: { fontSize: 14, fontWeight: '700', color: Colors.text },
  pendingBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: Colors.primary + '18',
  },
  pendingBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
});
