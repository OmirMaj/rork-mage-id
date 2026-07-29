// components/schedule/PresenceBar.tsx
//
// Live collaborator avatars for the schedule (Phase 2). Shows who else is
// viewing/editing this project's schedule right now, driven by Supabase Presence
// (useSchedulePresence). Renders nothing when you're alone.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Type } from '@/constants/typography';
import type { SchedulePeer } from '@/hooks/useSchedulePresence';

export function PresenceBar({ peers }: { peers: SchedulePeer[] }) {
  if (peers.length === 0) return null;
  const shown = peers.slice(0, 5);
  return (
    <View style={styles.row}>
      {shown.map((p) => (
        <View key={p.userId} style={[styles.avatar, { backgroundColor: p.color }]}>
          <Text style={styles.initial}>{(p.name || '?').trim().charAt(0).toUpperCase()}</Text>
        </View>
      ))}
      {peers.length > shown.length ? <Text style={styles.more}>+{peers.length - shown.length}</Text> : null}
      <Text style={styles.label}>{peers.length === 1 ? 'live' : `${peers.length} here`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF', marginLeft: -6 },
  initial: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  more: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: '#8A8F98', marginLeft: 4 },
  label: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: '#8A8F98', marginLeft: 8 },
});
