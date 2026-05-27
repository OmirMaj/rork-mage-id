// Small status pill rendered next to existing status badges on every
// portal-aware item detail screen. One of: Draft / Sent / Viewed /
// Unsent edits / Recalled. The "Unsent edits" variant is derived from
// updatedAt > sentAt; not a stored status.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { PortalState } from '@/types';

interface Props {
  portalState?: PortalState;
  /** Item-level updatedAt — used to detect "Unsent edits" when
   *  updatedAt > sentAt on a Sent item. */
  itemUpdatedAt?: string;
}

const fmtDate = (iso?: string): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
};
const fmtDateTime = (iso?: string): string => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } catch { return ''; }
};

export function PortalStatusPill({ portalState, itemUpdatedAt }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Resolve display state.
  const s = portalState;
  const status = s?.status ?? 'sent'; // grandfathered (undefined) → Sent
  const unsentEdits = status === 'sent' && s?.sentAt && itemUpdatedAt &&
    new Date(itemUpdatedAt).getTime() > new Date(s.sentAt).getTime();

  if (status === 'draft') {
    return <View style={[styles.pill, { backgroundColor: colors.accent + '22' }]}>
      <View style={[styles.dot, { backgroundColor: colors.accent }]} />
      <Text style={[styles.label, { color: colors.accent }]}>Draft</Text>
    </View>;
  }
  if (status === 'recalled') {
    return <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.dot, { backgroundColor: colors.textMuted }]} />
      <Text style={[styles.label, { color: colors.textMuted }]}>Recalled</Text>
    </View>;
  }
  if (unsentEdits) {
    return <View style={[styles.pill, { backgroundColor: '#F59E0B22' }]}>
      <View style={[styles.dot, { backgroundColor: '#D97706' }]} />
      <Text style={[styles.label, { color: '#92400E' }]}>Unsent edits</Text>
    </View>;
  }
  if (s?.viewedAt) {
    return <View style={[styles.pill, { backgroundColor: '#3B82F622' }]}>
      <View style={[styles.dot, { backgroundColor: '#3B82F6' }]} />
      <Text style={[styles.label, { color: '#1E40AF' }]}>{`Viewed · ${fmtDateTime(s.viewedAt)}`}</Text>
    </View>;
  }
  // Sent (or grandfathered)
  return <View style={[styles.pill, { backgroundColor: colors.success + '22' }]}>
    <View style={[styles.dot, { backgroundColor: colors.success }]} />
    <Text style={[styles.label, { color: colors.success }]}>{s?.sentAt ? `Sent · ${fmtDate(s.sentAt)}` : 'Shared'}</Text>
  </View>;
}

const makeStyles = (_t: ThemeColors) => StyleSheet.create({
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.full,
    alignSelf: 'flex-start' as const,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, letterSpacing: 0.2 },
});
