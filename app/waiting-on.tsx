// app/waiting-on.tsx — "Waiting on others" (the System of Action).
//
// Every incumbent tool STORES your RFIs and submittals; none of them chase the
// architect for a response — a person still does that. This screen is MAGE
// doing the chasing: one list of everything parked with someone else, ranked by
// how overdue it is, each with a follow-up already written and ready to send.
//
// Anti-slop: Colors/Type/Tokens + lucide only.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share, Platform, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight, Send, CheckCircle2, FileQuestion, FileCheck, FileSignature } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useCoreData, useDocsData, useFinancialsData } from '@/contexts/ProjectContext';
import { buildChaseList, chaseSummary, type ChaseItem, type ChaseKind } from '@/utils/systemOfAction';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const KIND_ICON: Record<ChaseKind, typeof FileQuestion> = {
  rfi: FileQuestion,
  submittal: FileCheck,
  co_approval: FileSignature,
};

export default function WaitingOnScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects } = useCoreData();
  const { rfis, submittals } = useDocsData();
  const { changeOrders } = useFinancialsData();
  const [sent, setSent] = useState<Set<string>>(new Set());

  const items = useMemo(
    () =>
      buildChaseList({
        rfis: rfis ?? [],
        submittals: submittals ?? [],
        changeOrders: changeOrders ?? [],
        projects: projects ?? [],
        nowMs: Date.now(),
      }),
    [rfis, submittals, changeOrders, projects],
  );
  const summary = useMemo(() => chaseSummary(items), [items]);

  const sendNudge = async (item: ChaseItem) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({ message: item.nudge });
      setSent((prev) => new Set(prev).add(item.id));
    } catch {
      Alert.alert('Could not open share', 'Copy the follow-up from the item instead.');
    }
  };

  const severityColor = (s: ChaseItem['severity']) =>
    s === 'critical' ? t.danger : s === 'high' ? Colors.warning : t.textSecondary;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={t.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <MageAIMark size={15} color={t.accent} />
          <Text style={styles.headerTitle}>Waiting on others</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>Parked with someone else</Text>
            {summary.total > 0 ? (
              <>
                <Text style={styles.heroStat}>
                  {summary.total} {summary.total === 1 ? 'item' : 'items'} overdue
                </Text>
                <Text style={styles.heroSub}>
                  {summary.critical > 0
                    ? `${summary.critical} over a week late. `
                    : ''}
                  Each one has a follow-up written and ready — send it without typing.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.heroStat}>Nobody's holding you up</Text>
                <Text style={styles.heroSub}>
                  No RFIs, submittals, or approvals are sitting overdue with anyone else.
                </Text>
              </>
            )}
          </View>

          {summary.total === 0 ? (
            <View style={styles.emptyCard}>
              <CheckCircle2 size={18} color={t.success} strokeWidth={2} />
              <Text style={styles.emptyText}>Nothing to chase. Go build.</Text>
            </View>
          ) : (
            items.map((item) => {
              const Icon = KIND_ICON[item.kind];
              const sc = severityColor(item.severity);
              const wasSent = sent.has(item.id);
              return (
                <View key={`${item.kind}-${item.id}`} style={styles.card}>
                  <TouchableOpacity
                    style={styles.cardTop}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.title}`}
                    onPress={() =>
                      router.push({ pathname: item.route.pathname as never, params: item.route.params })
                    }
                  >
                    <View style={[styles.iconWrap, { backgroundColor: sc + '18' }]}>
                      <Icon size={14} color={sc} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {item.projectName} · with {item.waitingOn}
                      </Text>
                    </View>
                    <View style={styles.lateBox}>
                      <Text style={[styles.lateNum, { color: sc }]}>{item.daysOverdue}d</Text>
                      <Text style={styles.lateLabel}>late</Text>
                    </View>
                    <ChevronRight size={14} color={t.textMuted} strokeWidth={2} />
                  </TouchableOpacity>

                  <Text style={styles.nudge} numberOfLines={3}>{item.nudge}</Text>

                  <TouchableOpacity
                    style={[styles.sendBtn, wasSent && styles.sendBtnDone]}
                    onPress={() => void sendNudge(item)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Send follow-up about ${item.title}`}
                    testID={`nudge-${item.id}`}
                  >
                    {wasSent ? (
                      <CheckCircle2 size={13} color={t.success} strokeWidth={2.25} />
                    ) : (
                      <Send size={13} color={t.accent} strokeWidth={2.25} />
                    )}
                    <Text style={[styles.sendText, wasSent && { color: t.success }]}>
                      {wasSent ? 'Follow-up sent' : 'Send follow-up'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Tokens.spacing.sm,
      paddingVertical: Tokens.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    headerTitle: { ...Type.headline, color: t.text },
    scroll: { paddingBottom: 40 },
    content: {
      width: '100%',
      maxWidth: 640,
      alignSelf: 'center',
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.lg,
    },
    hero: { marginBottom: Tokens.spacing.lg },
    eyebrow: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 2,
    },
    heroStat: { ...Type.title2, color: t.text },
    heroSub: { ...Type.subhead, color: t.textSecondary, marginTop: 4 },
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.sm,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm },
    iconWrap: {
      width: 28,
      height: 28,
      borderRadius: Tokens.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    cardTitle: { ...Type.footnoteEmphasized, color: t.text },
    cardMeta: { ...Type.caption1, color: t.textSecondary, marginTop: 1 },
    lateBox: { alignItems: 'flex-end' },
    lateNum: { ...Type.subheadEmphasized, fontVariant: ['tabular-nums'] },
    lateLabel: { ...Type.caption2, color: t.textMuted },
    nudge: {
      ...Type.caption1,
      color: t.textSecondary,
      lineHeight: 17,
      marginTop: Tokens.spacing.sm,
      paddingTop: Tokens.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.line,
    },
    sendBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: Tokens.spacing.sm,
      paddingVertical: 9,
      borderRadius: Tokens.radius.md,
      borderWidth: 1,
      borderColor: t.accentSoft,
      backgroundColor: t.surfaceAlt,
    },
    sendBtnDone: { borderColor: t.line },
    sendText: { ...Type.caption1, color: t.accent, fontWeight: '700' },
    emptyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.sm,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
    },
    emptyText: { ...Type.footnote, color: t.textSecondary, flex: 1 },
  });
