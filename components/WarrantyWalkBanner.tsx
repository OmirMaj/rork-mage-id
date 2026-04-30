// WarrantyWalkBanner — slim banner on the home screen surfacing
// projects whose 11-month warranty walk is coming up (or overdue).
// Hidden when there are no walks to flag, so the home screen stays
// quiet during normal operation. Tappable: opens the project so the
// GC can schedule / log the walk from there.
//
// Sits below the nav bar above the project list. One-line per project.
// Uses the existing project card visual language so it feels native.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { WarrantyWalkAlert } from '@/utils/warrantyWalks';
import { describeWalkTiming } from '@/utils/warrantyWalks';

interface Props {
  alerts: WarrantyWalkAlert[];
}

export default function WarrantyWalkBanner({ alerts }: Props) {
  const router = useRouter();
  if (!alerts || alerts.length === 0) return null;

  // Show top 2 to keep the banner tight; if more, we tease "+N more"
  // which scrolls the project list (those projects already exist in it).
  const visible = alerts.slice(0, 2);
  const extra = alerts.length - visible.length;

  return (
    <View style={styles.wrap}>
      {visible.map(a => {
        const urgent = a.severity === 'urgent';
        const Icon = urgent ? AlertTriangle : ShieldCheck;
        const accent = urgent ? Colors.error : Colors.primary;
        return (
          <TouchableOpacity
            key={a.project.id}
            style={[styles.row, { borderColor: accent + '30', backgroundColor: accent + '0E' }]}
            onPress={() => router.push({ pathname: '/project-detail' as never, params: { id: a.project.id } } as never)}
            activeOpacity={0.7}
            testID={`warranty-walk-${a.project.id}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: accent + '20' }]}>
              <Icon size={16} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: accent }]} numberOfLines={1}>
                11-month warranty walk
              </Text>
              <Text style={styles.body} numberOfLines={1}>
                <Text style={styles.bodyStrong}>{a.project.name}</Text> · {describeWalkTiming(a)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
      {extra > 0 && (
        <Text style={styles.extra}>+{extra} more upcoming</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 8,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  title: {
    fontSize: 10, fontWeight: '800' as const,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
  },
  body: {
    fontSize: 13, color: Colors.text, marginTop: 2,
  },
  bodyStrong: { fontWeight: '700' as const },
  extra: {
    fontSize: 11, color: Colors.textMuted,
    textAlign: 'center' as const, fontStyle: 'italic' as const,
  },
});
