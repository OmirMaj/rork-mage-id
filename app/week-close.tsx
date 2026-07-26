// app/week-close.tsx — The Friday Close modal.
//
// Five-leg weekly action surface: bill / chase / close / commit / clients.
// Rows deep-link into the relevant screen via the BriefItem route contract.
// Explicit Done stamps mageid_week_close_last_seen (brief.tsx:78 pattern).
//
// Business+ gated (G6). No auto-open (plan §F2).
// Desktop: content column capped at maxWidth 640 and centered.
// Anti-slop: Colors/Type/Tokens only. No emoji in UI.

import React, { useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, ChevronRight, X } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { WEEK_CLOSE_LAST_SEEN_KEY } from '@/utils/weekClose/types';
import { useWeekClose } from '@/hooks/useWeekClose';
import { QUIET_CLOSE_LINE } from '@/utils/weekClose/composeWeekClose';
import type { BriefItem, BriefSeverity, WeekCloseLeg } from '@/utils/weekClose/types';

// ─── Business gate ────────────────────────────────────────────────────────────

export default function WeekCloseScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('brain_accuracy')) {
    return (
      <Paywall
        visible={true}
        feature="Friday Close"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <WeekCloseInner />;
}

// ─── Severity helpers ─────────────────────────────────────────────────────────

function severityDotColor(severity: BriefSeverity | undefined, t: ThemeColors): string {
  if (severity === 'critical') return t.danger;
  if (severity === 'high') return Colors.warning;
  return t.textSecondary;
}

// ─── Inner screen ─────────────────────────────────────────────────────────────

function WeekCloseInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { close } = useWeekClose();

  // Stamp last-seen on mount — hides the home card until next week.
  useEffect(() => {
    AsyncStorage.setItem(WEEK_CLOSE_LAST_SEEN_KEY, new Date().toISOString().slice(0, 10)).catch(() => {});
  }, []);

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    [],
  );

  // Informational lines (reminders/notices) are not open work — count only
  // legs with actionable items, mirroring composeWeekClose's allQuiet rule.
  const openLegs = useMemo(
    () => close ? close.legs.filter(l => l.items.some(i => !i.informational)).length : 0,
    [close],
  );

  const headline = close?.allQuiet
    ? QUIET_CLOSE_LINE
    : `${openLegs} leg${openLegs === 1 ? '' : 's'} open`;

  const openItem = (item: BriefItem) => {
    if (!item.route) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (item.route.params && Object.keys(item.route.params).length > 0) {
      router.push({ pathname: item.route.pathname as never, params: item.route.params });
    } else {
      router.push(item.route.pathname as never);
    }
  };

  const markDone = () => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AsyncStorage.setItem(WEEK_CLOSE_LAST_SEEN_KEY, new Date().toISOString().slice(0, 10)).catch(() => {});
    router.back();
  };

  const renderRows = (items: BriefItem[], showDot: boolean) => (
    items.map(item => (
      <TouchableOpacity
        key={item.id}
        style={styles.row}
        onPress={() => openItem(item)}
        activeOpacity={item.route ? 0.7 : 1}
        accessibilityRole="button"
      >
        {showDot && (
          <View style={[styles.dot, { backgroundColor: severityDotColor(item.severity, t) }]} />
        )}
        <Text style={styles.rowText} numberOfLines={3}>{item.text}</Text>
        {item.route && <ChevronRight size={14} color={t.textMuted} strokeWidth={2} />}
      </TouchableOpacity>
    ))
  );

  const renderLeg = (leg: WeekCloseLeg) => (
    <View key={leg.id} style={styles.section}>
      <Text style={styles.sectionTitle}>{leg.title}</Text>
      <View style={styles.card}>
        {leg.items.length > 0
          ? renderRows(leg.items, true)
          : (
            <View style={styles.row}>
              <Text style={[styles.rowText, { color: t.textMuted }]}>Nothing here this week.</Text>
            </View>
          )
        }
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Friday Close',
          headerShown: true,
          presentation: 'modal',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={20} color={t.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <CheckCircle2 size={20} color={t.accent} strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
            <Text style={styles.headline}>{headline}</Text>
          </View>
        </View>

        {/* Five legs */}
        {close?.legs.map(renderLeg)}

        {/* Done button */}
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={markDone}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Mark week close done"
        >
          <CheckCircle2 size={16} color="#FFF" strokeWidth={2} />
          <Text style={styles.doneBtnText}>Done — close this week</Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  content: {
    paddingTop: Tokens.spacing.md,
    paddingHorizontal: Tokens.spacing.md,
    maxWidth: 640,
    alignSelf: 'center' as const,
    width: '100%',
  },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.md,
    paddingHorizontal: Tokens.spacing.sm,
    marginBottom: Tokens.spacing.sm,
  },
  headerIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  dateLabel: {
    ...Type.caption1,
    color: t.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  headline: {
    ...Type.title3,
    color: t.text,
    fontWeight: '700' as const,
  },

  section: { marginBottom: Tokens.spacing.md },
  sectionTitle: {
    ...Type.subheadEmphasized,
    color: t.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.xs,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
    overflow: 'hidden' as const,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    paddingHorizontal: Tokens.spacing.md,
    paddingVertical: Tokens.spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  rowText: { flex: 1, ...Type.bodyCompact, color: t.text, lineHeight: 20 },

  doneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Tokens.spacing.xs,
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.lg,
    paddingVertical: Tokens.spacing.md,
    marginTop: Tokens.spacing.md,
  },
  doneBtnText: { ...Type.bodyEmphasized, color: '#FFF', fontWeight: '700' as const },
});
