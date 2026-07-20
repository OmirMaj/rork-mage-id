// app/copilot-hub.tsx — the universal MAGE Copilot entry.
//
// One place to just SAY what you need. Type/speak a request → classifyIntent
// routes it to the right capability's interview (seeding the utterance so you
// don't re-type). Or pick a capability from the grid. Every registered
// capability is reachable here — the contractor never has to hunt for the right
// button. Built on the §3.7 design tokens (ink/cream ground, MAGE-orange accent,
// amber = the "your data" signal, Fraunces for the ask, JetBrains-Mono labels).
import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X, ClipboardList, CalendarDays, Receipt, Repeat, MessageSquare,
  FileText, CheckSquare, Wallet, ShieldAlert, ChevronRight,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { INTENTS } from '@/utils/copilot/intentTable';
import { splitIntents, type SplitAction } from '@/utils/copilot/splitIntents';
import type { CopilotCapabilityId } from '@/utils/copilot/types';

const ICONS: Record<CopilotCapabilityId, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  daily_report: ClipboardList,
  schedule: CalendarDays,
  estimate: Receipt,
  change_order: Repeat,
  rfi: MessageSquare,
  submittal: FileText,
  punch: CheckSquare,
  invoice: Wallet,
  safety_incident: ShieldAlert,
};

export default function CopilotHubScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const [queue, setQueue] = useState<SplitAction[]>([]);

  const open = useCallback((capabilityId: CopilotCapabilityId, seed?: string) => {
    router.push({
      pathname: '/copilot',
      params: { capabilityId, projectId: projectId ?? '', ...(seed ? { seed } : {}) },
    } as never);
  }, [router, projectId]);

  const route = useCallback(async () => {
    const utterance = text.trim();
    if (!utterance || thinking) return;
    setThinking(true);
    setNoMatch(false);
    setQueue([]);
    const found = await splitIntents(utterance);
    setThinking(false);
    if (found.length === 1) router.replace({ pathname: '/copilot', params: { capabilityId: found[0].capabilityId, projectId: projectId ?? '', seed: found[0].text } } as never);
    else if (found.length > 1) setQueue(found);
    else setNoMatch(true);
  }, [text, thinking, projectId, router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topbar}>
        <Text style={styles.brand}>MAGE&nbsp;COPILOT</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Close" hitSlop={10} testID="copilot-hub-close">
          <X size={20} color={colors.textMuted} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>JUST TELL ME WHAT YOU NEED</Text>
        <Text style={styles.question}>What are we doing?</Text>
        <Text style={styles.hint}>“LOG TODAY’S REPORT”  ·  “OWNER WANTS A HEAT PUMP”  ·  “RFI ON THE BEAM SIZE”</Text>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(t) => { setText(t); setNoMatch(false); }}
          placeholder="Say it in your own words…"
          placeholderTextColor={colors.textMuted}
          multiline
          testID="copilot-hub-input"
        />
        <TouchableOpacity
          style={[styles.goBtn, (!text.trim() || thinking) && styles.goBtnDisabled]}
          onPress={route}
          disabled={!text.trim() || thinking}
          activeOpacity={0.9}
          testID="copilot-hub-go"
        >
          {thinking
            ? <ActivityIndicator color={Colors.textOnAccent} />
            : <Text style={styles.goBtnText}>Continue</Text>}
        </TouchableOpacity>
        {noMatch && (
          <Text style={styles.noMatch}>Not sure which one that is — pick below.</Text>
        )}

        {queue.length > 1 && (
          <View style={styles.queueWrap}>
            <Text style={styles.queueLabel}>I HEARD {queue.length} THINGS — TAP TO HANDLE EACH</Text>
            {queue.map((a, i) => {
              const Icon = ICONS[a.capabilityId] ?? ClipboardList;
              return (
                <TouchableOpacity
                  key={i}
                  style={styles.card}
                  onPress={() => open(a.capabilityId, a.text)}
                  activeOpacity={0.85}
                  testID={`copilot-hub-queue-${i}`}
                >
                  <View style={styles.cardIcon}><Icon size={18} color={colors.accent} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{INTENTS.find((x) => x.id === a.capabilityId)?.label ?? a.capabilityId}</Text>
                    <Text style={styles.queueSub} numberOfLines={1}>{a.label}</Text>
                  </View>
                  <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.9} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <Text style={styles.orLabel}>OR PICK ONE</Text>
        <View style={styles.grid}>
          {INTENTS.map((i) => {
            const Icon = ICONS[i.id] ?? ClipboardList;
            return (
              <TouchableOpacity
                key={i.id}
                style={styles.card}
                onPress={() => open(i.id)}
                activeOpacity={0.85}
                testID={`copilot-hub-${i.id}`}
              >
                <View style={styles.cardIcon}><Icon size={18} color={colors.accent} strokeWidth={2} /></View>
                <Text style={styles.cardLabel}>{i.label}</Text>
                <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.9} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Tokens.spacing.lg, paddingTop: Tokens.spacing.md, paddingBottom: Tokens.spacing.sm },
    brand: { ...Type.monoEyebrow, color: colors.textSecondary },
    body: { paddingHorizontal: Tokens.spacing.lg, paddingBottom: Tokens.spacing['3xl'], gap: Tokens.spacing.sm },
    eyebrow: { ...Type.monoLabel, color: colors.accent },
    question: { ...Type.serifHeadline, color: colors.text },
    hint: { ...Type.monoLabel, color: colors.textMuted, marginBottom: Tokens.spacing.sm },
    input: {
      ...Type.body, color: colors.text, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line, borderRadius: Tokens.radius.lg,
      padding: Tokens.spacing.md, minHeight: 88, textAlignVertical: 'top',
    },
    goBtn: {
      backgroundColor: colors.accent, borderRadius: Tokens.radius.full,
      paddingVertical: Tokens.spacing.md, alignItems: 'center', justifyContent: 'center',
      marginTop: Tokens.spacing.xs,
    },
    goBtnDisabled: { opacity: 0.4 },
    goBtnText: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
    noMatch: { ...Type.footnote, color: colors.textMuted, textAlign: 'center', marginTop: Tokens.spacing.xs },
    queueWrap: { gap: Tokens.spacing.xs, marginTop: Tokens.spacing.md },
    queueLabel: { ...Type.monoLabel, color: colors.accent, marginBottom: Tokens.spacing.xxs },
    queueSub: { ...Type.footnote, color: colors.textMuted, marginTop: 1 },
    orLabel: { ...Type.monoLabel, color: colors.textMuted, marginTop: Tokens.spacing.lg, marginBottom: Tokens.spacing.xxs },
    grid: { gap: Tokens.spacing.xs },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
      padding: Tokens.spacing.md, borderWidth: 1, borderColor: colors.line,
      borderRadius: Tokens.radius.lg, backgroundColor: colors.surface,
    },
    cardIcon: { width: 34, height: 34, borderRadius: Tokens.radius.full, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
    cardLabel: { ...Type.subheadEmphasized, color: colors.text, flex: 1 },
  });
}
