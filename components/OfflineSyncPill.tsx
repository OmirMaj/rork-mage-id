// OfflineSyncPill
//
// A small badge that appears in tab/screen headers when there are unsynced
// mutations sitting in the offline queue. Renders nothing when the queue is
// empty — no visual noise on the happy path.
//
// Why this matters in the field:
//   When a super dictates a daily report at the bottom of an elevator shaft,
//   the data lands in the offline queue. They want one signal: "is this saved
//   or am I going to lose it?" This pill answers that visually with a count
//   and a tooltip-friendly summary. NetworkErr → queued → flushed is otherwise
//   completely invisible to the user.
//
// We intentionally don't trigger a manual "flush now" from a tap — the
// OfflineSyncManager already retries on AppState wake and on cold boot, and
// adding a manual button creates ambiguity ("did I press it? is it stuck?").
// Tapping just shows a Toast/Alert with the friendly explanation.

import React, { useCallback } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CloudOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useOfflineQueueDepth } from '@/hooks/useOfflineQueueDepth';

interface Props {
  /** Optional: visual variant. 'compact' shows just the icon + number; 'full' adds the word "queued". */
  variant?: 'compact' | 'full';
}

export default function OfflineSyncPill({ variant = 'compact' }: Props) {
  const depth = useOfflineQueueDepth();

  const onPress = useCallback(() => {
    if (depth === 0) return;
    Alert.alert(
      `${depth} change${depth === 1 ? '' : 's'} queued`,
      Platform.OS === 'web'
        ? 'These changes are saved on this device and will sync to the cloud when you\u2019re back online.'
        : 'These changes are saved on your phone and will sync to the cloud automatically next time you have signal or wifi.',
    );
  }, [depth]);

  if (depth === 0) return null;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityLabel={`${depth} changes queued for sync`}>
      <View style={styles.pill}>
        <CloudOff size={12} color={Colors.warning} />
        <Text style={styles.text}>
          {variant === 'full' ? `${depth} queued` : depth}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255, 159, 27, 0.12)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255, 159, 27, 0.35)',
  },
  text: {
    color: Colors.warning,
    fontSize: 11, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
