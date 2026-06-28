// ReactivationBanner — the anti-leakage / repeat-revenue engine.
//
// Research: 70%+ of contractor work is word-of-mouth/repeat, referred
// clients have ~16% higher LTV, and re-selling an existing client is far
// cheaper than acquiring a new one. The risk in a "bring your own pipeline"
// model is leakage — the contractor lets the relationship go cold and the
// platform stops being the system of record. This banner keeps MAGE ID in
// the loop: it surfaces clients/leads that have gone quiet and makes a
// follow-up one tap.
//
// "Stale" = an open lead (not won-and-converted, not lost) whose last touch
// (or creation, if never touched) is older than STALE_DAYS. Tapping a chip
// opens that lead; "Log follow-up" stamps a touch so it drops off the list.

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { BellRing, ChevronRight, Check, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { Lead } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const STALE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

function lastActivityMs(lead: Lead): number {
  const touchTs = lead.touches?.[0]?.occurredAt;
  return new Date(touchTs ?? lead.updatedAt ?? lead.receivedAt).getTime();
}

export default function ReactivationBanner() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { leads, addLeadTouch } = useProjects();
  const [dismissed, setDismissed] = useState(false);

  const stale = useMemo(() => {
    const cutoff = Date.now() - STALE_DAYS * MS_PER_DAY;
    return leads
      .filter(l => l.stage !== 'lost' && l.stage !== 'won' && lastActivityMs(l) < cutoff)
      .sort((a, b) => lastActivityMs(a) - lastActivityMs(b)); // most stale first
  }, [leads]);

  const logFollowUp = useCallback((leadId: string) => {
    addLeadTouch(leadId, 'note', `Follow-up reminder actioned (${STALE_DAYS}+ days quiet).`);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [addLeadTouch]);

  if (dismissed || stale.length === 0) return null;

  const top = stale.slice(0, 4);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headIcon}><BellRing size={14} color={colors.accent} strokeWidth={1.75} /></View>
        <Text style={styles.headTitle}>
          {stale.length} {stale.length === 1 ? 'client has' : 'clients have'} gone quiet
        </Text>
        <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={8} accessibilityLabel="Dismiss">
          <X size={16} color={colors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
      <Text style={styles.sub}>
        Repeat clients are your cheapest jobs. A quick check-in keeps them warm.
      </Text>
      <View style={styles.list}>
        {top.map(l => {
          const days = Math.floor((Date.now() - lastActivityMs(l)) / MS_PER_DAY);
          return (
            <View key={l.id} style={styles.row}>
              <TouchableOpacity
                style={styles.rowMain}
                onPress={() => router.push({ pathname: '/lead-detail' as never, params: { leadId: l.id } as never })}
                activeOpacity={0.7}
                testID={`reactivate-open-${l.id}`}
              >
                <Text style={styles.rowName} numberOfLines={1}>{l.name}</Text>
                <Text style={styles.rowDays}>{days}d quiet</Text>
                <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.logBtn}
                onPress={() => logFollowUp(l.id)}
                activeOpacity={0.8}
                testID={`reactivate-log-${l.id}`}
                accessibilityLabel={`Mark ${l.name} followed up`}
              >
                <Check size={13} color={colors.success} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
      {stale.length > top.length && (
        <Text style={styles.more}>+{stale.length - top.length} more in the pipeline</Text>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.accent + '33', marginHorizontal: 12, marginTop: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: t.accent + '15', alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text },
  sub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 4, lineHeight: 16 },
  list: { marginTop: 10, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.bg, borderRadius: Tokens.radius.md, paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: t.line,
  },
  rowName: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  rowDays: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },
  logBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: t.success + '14', borderWidth: 1, borderColor: t.success + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  more: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 8, textAlign: 'center' },
});
