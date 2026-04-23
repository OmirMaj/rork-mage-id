import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, Activity, Plus, RefreshCcw, CheckCircle2,
  XCircle, DollarSign, Upload,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useActivityFeed, type ActivityAction, type ActivityItem } from '@/hooks/useActivityFeed';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import EntityActionSheet from '@/components/EntityActionSheet';
import type { EntityRef } from '@/types';

export default function ActivityFeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const { navigateTo } = useEntityNavigation();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useActivityFeed(projectId);
  const [actionSheetRef, setActionSheetRef] = useState<EntityRef | null>(null);

  const handleRowPress = (item: ActivityItem) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    navigateTo(item.ref);
  };

  const handleRowLongPress = (item: ActivityItem) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionSheetRef(item.ref);
  };

  const headerTitle = project?.name ? `Activity · ${project.name}` : 'Activity';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityLabel="Go back"
          testID="activity-back-btn"
        >
          <ChevronLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
          <Text style={styles.headerSubtitle}>{items.length} event{items.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Activity size={28} color={Colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyBody}>
            Change orders, RFIs, daily reports, invoices, and photos will show up here the moment they&apos;re created.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 40 }]}
          renderItem={({ item }) => (
            <ActivityRow item={item} onPress={handleRowPress} onLongPress={handleRowLongPress} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      <EntityActionSheet
        entityRef={actionSheetRef}
        onClose={() => setActionSheetRef(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps {
  item: ActivityItem;
  onPress: (item: ActivityItem) => void;
  onLongPress: (item: ActivityItem) => void;
}

function ActivityRow({ item, onPress, onLongPress }: RowProps) {
  const { icon: Icon, color, verb } = iconAndColor(item.action);

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
      activeOpacity={0.7}
      testID={`activity-row-${item.id}`}
    >
      <View style={[styles.rowIcon, { backgroundColor: color + '15' }]}>
        <Icon size={18} color={color} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          <Text style={[styles.rowVerb, { color }]}>{verb}</Text>
          <Text style={styles.rowDot}> · </Text>
          <Text>{formatWhen(item.timestamp)}</Text>
          {item.summary ? (
            <>
              <Text style={styles.rowDot}> · </Text>
              <Text>{item.summary}</Text>
            </>
          ) : null}
        </Text>
      </View>
      <ChevronRight size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function iconAndColor(action: ActivityAction) {
  switch (action) {
    case 'created':
      return { icon: Plus, color: Colors.primary, verb: 'Created' };
    case 'updated':
      return { icon: RefreshCcw, color: Colors.info, verb: 'Updated' };
    case 'completed':
      return { icon: CheckCircle2, color: Colors.success, verb: 'Completed' };
    case 'closed':
      return { icon: XCircle, color: Colors.textSecondary, verb: 'Closed' };
    case 'paid':
      return { icon: DollarSign, color: Colors.success, verb: 'Paid' };
    case 'uploaded':
      return { icon: Upload, color: Colors.accent, verb: 'Uploaded' };
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return { icon: Activity, color: Colors.textSecondary, verb: 'Activity' };
    }
  }
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso ?? '';
  const now = Date.now();
  const diffMs = now - t;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(t);
  return d.toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: Colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  headerSubtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  listContent: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.background,
    gap: 12,
  },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: Colors.text, marginBottom: 2 },
  rowMeta: { fontSize: 12, color: Colors.textSecondary },
  rowVerb: { fontWeight: '600' },
  rowDot: { color: Colors.textMuted },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginLeft: 64 },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  emptyBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
