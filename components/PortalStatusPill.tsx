// Small status pill rendered next to existing status badges on every
// portal-aware item detail screen. One of: Draft / Sent / Viewed /
// Unsent edits / Recalled. The "Unsent edits" variant is derived from
// updatedAt > sentAt; not a stored status.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
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
    // accentLabel, not accent. The raw brand hue over its own 13%-alpha tint
    // was 2.49:1 for the retired orange (2026-09-07 audit), and a brand wash
    // under brand text is still the weakest pairing for the green (4.25:1 over
    // surfaceAlt) against a 4.5:1 floor for 12pt text. The DOT keeps the raw
    // accent: it is non-text chrome and lives under the 3:1 rule.
    return <View style={[styles.pill, { backgroundColor: colors.accent + '22' }]}>
      <View style={[styles.dot, { backgroundColor: colors.accent }]} />
      <Text style={[styles.label, { color: colors.accentLabel }]}>Draft</Text>
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
      <Text style={[styles.label, { color: '#92400E' }]}>Unsent Edits</Text>
    </View>;
  }
  if (s?.viewedAt) {
    return <View style={[styles.pill, { backgroundColor: '#3B82F622' }]}>
      <View style={[styles.dot, { backgroundColor: '#3B82F6' }]} />
      <Text style={[styles.label, { color: '#1E40AF' }]}>{`Viewed · ${fmtDateTime(s.viewedAt)}`}</Text>
    </View>;
  }
  // Sent (or grandfathered). A success state, so it carries a CHECK instead of
  // the dot: since the 2026-09-16 rebrand success is teal and the brand is
  // green, and a state must never be told apart from a brand chip by hue
  // alone. successLabel (not the success fill) is the ink, because 12pt text
  // on its own 13% wash is a label, not a signal fill.
  return <View style={[styles.pill, { backgroundColor: colors.success + '22' }]}>
    <Check size={10} color={colors.successLabel} strokeWidth={3} />
    <Text style={[styles.label, { color: colors.successLabel }]}>{s?.sentAt ? `Sent · ${fmtDate(s.sentAt)}` : 'Shared'}</Text>
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
