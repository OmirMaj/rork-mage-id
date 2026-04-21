// /shared-schedule?t=<token>
//
// Read-only viewer for a schedule snapshot shared via URL. The token is the
// base64-encoded payload — we decode it, run CPM for critical-path coloring,
// and render the InteractiveGantt in a locked mode (all edit handlers
// no-op). No backend needed.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, ChevronLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import InteractiveGantt from '@/components/schedule/InteractiveGantt';
import { runCpm } from '@/utils/cpm';
import { decodeShareToken, tasksFromSharePayload } from '@/utils/scheduleOps';

export default function SharedScheduleScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLocalSearchParams<{ t?: string }>();
  const { width } = useWindowDimensions();

  const payload = useMemo(() => (t ? decodeShareToken(String(t)) : null), [t]);
  const tasks = useMemo(() => payload ? tasksFromSharePayload(payload) : [], [payload]);
  const cpm = useMemo(() => runCpm(tasks), [tasks]);
  const projectStartDate = useMemo(
    () => payload ? new Date(payload.projectStartISO) : new Date(),
    [payload],
  );

  if (!payload) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ title: 'Schedule' }} />
        <Lock size={28} color={Colors.textMuted} />
        <Text style={styles.title}>Invalid or expired link</Text>
        <Text style={styles.body}>
          This schedule link could not be opened. Ask the sender for a fresh link.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/' as any)} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const narrow = width < 900;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={18} color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{payload.name}</Text>
          <Text style={styles.sub}>
            Read-only · {tasks.length} tasks · finish day {cpm.projectFinish} ·
            {cpm.criticalPath.length} on critical path
          </Text>
        </View>
        <View style={styles.lockBadge}>
          <Lock size={12} color={Colors.textSecondary} />
          <Text style={styles.lockBadgeText}>Shared view</Text>
        </View>
      </View>

      {narrow ? (
        // Simple list fallback for phones.
        <View style={styles.body}>
          <Text style={styles.narrowIntro}>
            Open this link on a laptop or iPad to see the full Gantt chart.
          </Text>
          {tasks.map((task, i) => (
            <View key={task.id} style={styles.narrowRow}>
              <Text style={styles.narrowIdx}>{i + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.narrowTitle}>{task.title}</Text>
                <Text style={styles.narrowMeta}>
                  {task.phase} · {task.durationDays}d · day {task.startDay}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.body}>
          <InteractiveGantt
            tasks={tasks}
            cpm={cpm}
            projectStartDate={projectStartDate}
            onEdit={() => { /* locked */ }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.cardBorder,
    backgroundColor: Colors.surface,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  titleWrap: { flex: 1, marginHorizontal: 8 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  sub: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  lockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    backgroundColor: Colors.fillSecondary,
  },
  lockBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
  body: { flex: 1, padding: 12 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, marginTop: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  narrowIntro: { fontSize: 13, color: Colors.textSecondary, marginBottom: 16, fontStyle: 'italic' },
  narrowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  narrowIdx: { fontSize: 12, color: Colors.textMuted, width: 24, paddingTop: 2 },
  narrowTitle: { fontSize: 13, fontWeight: '600', color: Colors.text },
  narrowMeta: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  body_: {},
});

