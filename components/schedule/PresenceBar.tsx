// components/schedule/PresenceBar.tsx
//
// Live collaborator presence for the schedule (Phase 2). Shows who else is on
// this project's schedule right now (avatars), and — the per-task soft-lock —
// which task each of them currently has selected/is editing, so two people
// don't grab the same bar. Renders nothing when you're alone.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Type } from '@/constants/typography';
import type { SchedulePeer } from '@/hooks/useSchedulePresence';

export function PresenceBar({
  peers,
  taskTitleById,
}: {
  peers: SchedulePeer[];
  taskTitleById?: Record<string, string>;
}) {
  if (peers.length === 0) return null;
  const shown = peers.slice(0, 5);
  // Peers currently on a task we can name — the soft-lock awareness list.
  const editing = peers.filter(
    (p) => p.selectedTaskId && taskTitleById?.[p.selectedTaskId],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {shown.map((p) => (
          <View key={p.userId} style={[styles.avatar, { backgroundColor: p.color }]}>
            <Text style={styles.initial}>{(p.name || '?').trim().charAt(0).toUpperCase()}</Text>
          </View>
        ))}
        {peers.length > shown.length ? <Text style={styles.more}>+{peers.length - shown.length}</Text> : null}
        <Text style={styles.label}>{peers.length === 1 ? 'live' : `${peers.length} here`}</Text>
      </View>
      {editing.map((p) => (
        <View key={p.userId} style={styles.editingRow}>
          <View style={[styles.dot, { backgroundColor: p.color }]} />
          <Text style={styles.editingText} numberOfLines={1}>
            {(p.name || 'Someone').split('@')[0]} · editing {taskTitleById![p.selectedTaskId!]}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF', marginLeft: -6 },
  initial: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  more: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: '#8A8F98', marginLeft: 4 },
  label: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: '#8A8F98', marginLeft: 8 },
  editingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  editingText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: '#8A8F98', maxWidth: 240 },
});
