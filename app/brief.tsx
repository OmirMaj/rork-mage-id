// app/brief.tsx — the Morning Brief.
//
// Deterministic composition (utils/brief/composeBrief.ts via
// hooks/useMorningBrief.ts) — no AI call, no spinner theater. Three
// sections in the hybrid voice: NEEDS YOU / WATCHING / DID FOR YOU —
// dense facts up top, first person only in the brain's own lines.
// Every row drills into the real screen behind it. Explicit Done,
// no auto-open anywhere.
//
// Business+ gated (G6, same 'brain_accuracy' proxy as /business).
// Opening the brief stamps BRIEF_LAST_SEEN_KEY with today's local date,
// which hides the pinned home card for the rest of the day.
//
// Anti-slop: Colors/Type/Tokens only. Desktop: the three sections sit
// side-by-side in a grid inside a 1280 content column (see contentDesktop);
// phone keeps the single stacked column.

import React, { useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  Sunrise, AlertCircle, Eye, ChevronRight, CheckCircle2,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useMorningBrief } from '@/hooks/useMorningBrief';
import {
  BRIEF_LAST_SEEN_KEY, briefIsEmpty, localDateISO, QUIET_MORNING_LINE,
  type BriefItem, type BriefSeverity,
} from '@/utils/brief/composeBrief';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// ─── Business gate ──────────────────────────────────────────────────────────

export default function BriefScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('brain_accuracy')) {
    return (
      <Paywall
        visible={true}
        feature="Morning Brief"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <BriefInner />;
}

// ─── Severity dot color (BrainWatchCard mapping) ────────────────────────────

function severityColor(severity: BriefSeverity | undefined, t: ThemeColors): string {
  if (severity === 'critical') return t.danger;
  if (severity === 'high') return Colors.warning;
  return t.textSecondary;
}

// ─── Inner screen ───────────────────────────────────────────────────────────

function BriefInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { brief } = useMorningBrief();
  const { isDesktop } = useResponsiveLayout();

  // Opening the brief counts as "seen today" — hides the pinned home card.
  useEffect(() => {
    AsyncStorage.setItem(BRIEF_LAST_SEEN_KEY, localDateISO(new Date())).catch(() => {});
  }, []);

  const dateLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    [],
  );

  const headline = brief.needsYou.length === 0
    ? QUIET_MORNING_LINE
    : `${brief.needsYou.length} need${brief.needsYou.length === 1 ? 's' : ''} you`;

  const openItem = (item: BriefItem) => {
    if (!item.route) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (item.route.params && Object.keys(item.route.params).length > 0) {
      router.push({ pathname: item.route.pathname as never, params: item.route.params });
    } else {
      router.push(item.route.pathname as never);
    }
  };

  const renderRows = (items: BriefItem[], showDot: boolean) => (
    <View style={styles.rows}>
      {items.map(item => (
        <TouchableOpacity
          key={item.id}
          style={styles.row}
          onPress={() => openItem(item)}
          disabled={!item.route}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={item.text}
        >
          {showDot && (
            <View style={[styles.severityDot, { backgroundColor: severityColor(item.severity, t) }]} />
          )}
          <Text style={styles.rowText}>{item.text}</Text>
          {item.route && <ChevronRight size={14} color={t.textMuted} strokeWidth={2} />}
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.content, isDesktop && styles.contentDesktop]}>
          {/* Dated header */}
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Sunrise size={18} color={t.accent} strokeWidth={1.75} />
            </View>
            <Text style={styles.eyebrow}>{dateLabel}</Text>
            <Text style={styles.headline}>{headline}</Text>
          </View>

          {briefIsEmpty(brief) ? (
            <View style={styles.emptyCard}>
              <CheckCircle2 size={18} color={t.success} strokeWidth={2} />
              <Text style={styles.emptyText}>
                Nothing overdue, nothing at risk, nothing waiting on you. Go build.
              </Text>
            </View>
          ) : (
            <>
              <View style={isDesktop ? styles.sectionGrid : undefined}>
              {/* NEEDS YOU */}
              {brief.needsYou.length > 0 && (
                <View style={[styles.section, isDesktop && styles.sectionDesktop]}>
                  <View style={styles.sectionHeader}>
                    <AlertCircle size={14} color={t.danger} strokeWidth={2} />
                    <Text style={styles.sectionLabel}>Needs you</Text>
                  </View>
                  {renderRows(brief.needsYou, true)}
                </View>
              )}

              {/* WATCHING */}
              {brief.watching.length > 0 && (
                <View style={[styles.section, isDesktop && styles.sectionDesktop]}>
                  <View style={styles.sectionHeader}>
                    <Eye size={14} color={t.accent} strokeWidth={2} />
                    <Text style={styles.sectionLabel}>Watching</Text>
                  </View>
                  {renderRows(brief.watching, true)}
                </View>
              )}

              {/* DID FOR YOU — the brain's own lines; first person lives here */}
              {brief.didForYou.length > 0 && (
                <View style={[styles.section, isDesktop && styles.sectionDesktop]}>
                  <View style={styles.sectionHeader}>
                    <MageAIMark size={14} color={t.accent} />
                    <Text style={styles.sectionLabel}>Did for you</Text>
                  </View>
                  {renderRows(brief.didForYou, false)}
                </View>
              )}
              </View>

              {brief.needsYou.length === 0 && brief.watching.length === 0 && (
                <Text style={styles.quietNote}>{QUIET_MORNING_LINE}.</Text>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Explicit Done — the only way out; no auto-dismiss. */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => router.back()}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Done"
          testID="brief-done"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scrollContent: { paddingBottom: 24 },
  content: {
    width: '100%', alignSelf: 'center',
    paddingHorizontal: Tokens.spacing.md, paddingTop: Tokens.spacing.lg,
  },
  contentDesktop: { maxWidth: 1280, paddingHorizontal: Tokens.spacing.lg },

  header: { marginBottom: Tokens.spacing.lg },
  headerIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '14',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Tokens.spacing.sm,
  },
  eyebrow: { ...Type.caption1, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  headline: { ...Type.title2, color: t.text, marginTop: 2 },

  section: { marginBottom: Tokens.spacing.lg },
  // Desktop: the three brief sections read as columns rather than one long
  // scroll. flexBasis picks the column count; sections wrap when they don't fit.
  sectionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.lg },
  sectionDesktop: { flexGrow: 1, flexBasis: 340, maxWidth: 520, marginBottom: 0 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs,
    marginBottom: Tokens.spacing.xs,
  },
  sectionLabel: { ...Type.subheadEmphasized, color: t.text },

  rows: {
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.panel, paddingHorizontal: Tokens.spacing.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  severityDot: { width: 6, height: 6, borderRadius: Tokens.radius.full, flexShrink: 0 },
  rowText: { ...Type.footnote, color: t.textSecondary, flex: 1 },

  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.panel,
    paddingVertical: Tokens.spacing.md, paddingHorizontal: Tokens.spacing.md,
  },
  emptyText: { ...Type.footnote, color: t.textSecondary, flex: 1 },
  quietNote: { ...Type.footnote, color: t.textMuted },

  footer: {
    borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.bg,
    paddingHorizontal: Tokens.spacing.md, paddingTop: Tokens.spacing.sm,
  },
  doneBtn: {
    width: '100%', maxWidth: 640, alignSelf: 'center',
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.lg,
    alignItems: 'center', paddingVertical: 14,
  },
  doneText: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
});
