// components/takeoff/AiSuggestionsSection.tsx — "Suggested by AI" in the
// desktop takeoff's Conditions panel (lane TK-b). Presentational: the
// workspace reads the saved AI Takeoff (hooks/useSavedAiTakeoff), builds the
// rows (utils/takeoff/aiSuggestions) and owns accept / dismiss.
//
// Honesty rules this file carries:
//  - every row says "not counted" in the amount column: a suggestion never
//    reaches the cost line or the push until he accepts it;
//  - each row names where it came from (page + file, or "page not given") and
//    whether the number is his own correction;
//  - AI rows are never drawn — there is nothing here the canvas can read;
//  - where the AI Takeoff lives is said plainly: on this browser, not his account.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Hash, Minus, Square, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Layout } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ConditionKind } from '@/utils/takeoff/conditions';
import { aiSkippedLine, type AiSkipped, type AiSuggestion } from '@/utils/takeoff/aiSuggestions';
import type { SavedAiTakeoffState } from '@/hooks/useSavedAiTakeoff';

export const KIND_ICON: Record<ConditionKind, typeof Square> = { area: Square, linear: Minus, count: Hash };

const CONF_WORD: Record<AiSuggestion['confidence'], string> = { high: 'High', medium: 'Medium', low: 'Low' };

export interface AiSuggestionsSectionProps {
  state: SavedAiTakeoffState;
  savedAt: string | null;
  /** The rows to show (after the panel's text filter). */
  rows: AiSuggestion[];
  /** Unhandled rows before the text filter — tells "all handled" from "none match". */
  totalRows: number;
  skipped: AiSkipped[];
  onAccept: (s: AiSuggestion) => void;
  onAcceptMeasure: (s: AiSuggestion) => void;
  onDismiss: (s: AiSuggestion) => void;
  onRunAi: () => void;
  onRetry: () => void;
}

function savedOn(iso: string | null): string {
  const t = iso ? new Date(iso) : null;
  if (!t || !Number.isFinite(t.getTime())) return 'an unknown date';
  return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const qtyOf = (s: AiSuggestion): string =>
  `${s.qty.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${s.unit}`;

export default function AiSuggestionsSection(p: AiSuggestionsSectionProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const n = p.rows.length;
  const ready = p.state === 'ready';
  // Open while there is anything to read: rows (before the filter — typing in
  // the filter never collapses it) or a skip line. Collapsed only when every
  // row is handled and nothing was skipped.
  const open = toggled ?? (!ready || p.totalRows > 0 || p.skipped.length > 0);
  const dotColor = { high: t.success, medium: t.warningLabel, low: t.danger } as const;

  const runLink = (
    <TouchableOpacity onPress={p.onRunAi} accessibilityRole="link" testID="takeoffws-ai-run">
      <Text style={styles.link}>Run AI Takeoff</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.section} testID="takeoffws-ai">
      <Pressable
        onPress={() => setToggled(!open)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="takeoffws-ai-header"
      >
        {open
          ? <ChevronDown size={14} color={t.textMuted} strokeWidth={1.75} />
          : <ChevronRight size={14} color={t.textMuted} strokeWidth={1.75} />}
        <Text style={styles.heading}>{ready ? `Suggested by AI (${n})` : 'Suggested by AI'}</Text>
      </Pressable>

      {!open || p.state === 'loading' ? null : p.state === 'none' ? (
        <View style={styles.body} testID="takeoffws-ai-none">
          <Text style={styles.muted}>No AI Takeoff saved on this browser for this project yet. An AI Takeoff run on your phone stays on that phone.</Text>
          {runLink}
        </View>
      ) : p.state === 'stale' ? (
        <View style={styles.body} testID="takeoffws-ai-stale">
          <Text style={styles.muted}>The AI Takeoff saved on this browser is over 60 days old. Run it again on the current plans.</Text>
          {runLink}
        </View>
      ) : p.state === 'failed' ? (
        <View style={styles.body} testID="takeoffws-ai-failed">
          <Text style={styles.muted}>Couldn’t read the AI Takeoff saved on this browser for this project.</Text>
          <TouchableOpacity onPress={p.onRetry} accessibilityRole="button" testID="takeoffws-ai-retry">
            <Text style={styles.link}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View testID="takeoffws-ai-ready">
          <Text style={[styles.muted, styles.intro]}>
            {`From AI takeoff on ${savedOn(p.savedAt)}, saved on this browser. Read from the plans, not measured. Nothing here counts until you accept it.`}
          </Text>
          {p.totalRows === 0 ? (
            <Text style={[styles.muted, styles.intro]} testID="takeoffws-ai-done">Every AI suggestion is accepted or dismissed.</Text>
          ) : n === 0 ? (
            <Text style={[styles.muted, styles.intro]} testID="takeoffws-ai-nomatch">No AI suggestions match the filter.</Text>
          ) : null}
          {p.rows.map((s, i) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <View key={s.key} style={styles.rowWrap} testID={`takeoffws-ai-row-${i}`}>
                <View style={styles.row}>
                  <Icon size={14} color={t.textMuted} strokeWidth={1.75} />
                  <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.qty} numberOfLines={1}>{qtyOf(s)}</Text>
                  <Text style={styles.amount} numberOfLines={1}>Not counted</Text>
                  <TouchableOpacity
                    onPress={() => p.onDismiss(s)}
                    style={styles.dismiss}
                    accessibilityRole="button"
                    accessibilityLabel={`Dismiss ${s.name}`}
                    testID={`takeoffws-ai-dismiss-${i}`}
                  >
                    <X size={14} color={t.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <View style={styles.caption}>
                  <View style={[styles.dot, { backgroundColor: dotColor[s.confidence] }]} />
                  <Text style={styles.captionText} numberOfLines={1}>
                    {`${CONF_WORD[s.confidence]} · ${s.citation}${s.corrected ? ' · your correction' : ''}`}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => p.onAccept(s)} accessibilityRole="button" accessibilityLabel={`Accept ${s.name}`} testID={`takeoffws-ai-accept-${i}`}>
                    <Text style={styles.link}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => p.onAcceptMeasure(s)} accessibilityRole="button" accessibilityLabel={`Accept and measure ${s.name}`} testID={`takeoffws-ai-measure-${i}`}>
                    <Text style={styles.link}>Accept and Measure</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
          {p.skipped.map((s) => (
            <Text key={s.code} style={[styles.muted, styles.intro]} testID={`takeoffws-ai-skipped-${s.code}`}>{aiSkippedLine(s)}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  section: { borderTopWidth: 1, borderTopColor: t.line },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, height: Layout.control.row, paddingHorizontal: Layout.cardPad },
  heading: { ...Type.footnoteEmphasized, color: t.text },
  body: { paddingHorizontal: Layout.cardPad, paddingBottom: 10, gap: 6, alignItems: 'flex-start' },
  intro: { paddingHorizontal: Layout.cardPad, paddingBottom: 8 },
  muted: { ...Type.caption1, color: t.textMuted },
  link: { ...Type.caption1, color: t.accentLabel, fontWeight: '600' },
  rowWrap: { borderTopWidth: 1, borderTopColor: t.line, paddingBottom: 6 },
  row: { minHeight: Layout.control.row, flexDirection: 'row', alignItems: 'center', gap: Layout.rowGap, paddingLeft: Layout.cardPad },
  name: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600', color: t.text },
  qty: { fontSize: 13, color: t.textMuted, textAlign: 'right', fontVariant: ['tabular-nums'] },
  amount: { width: 84, fontSize: 13, color: t.textMuted, textAlign: 'right' },
  dismiss: { width: 32, height: Layout.control.row, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Layout.cardPad },
  dot: { width: 6, height: 6, borderRadius: 3 },
  captionText: { ...Type.caption1, color: t.textMuted, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: Layout.cardPad, paddingHorizontal: Layout.cardPad, paddingTop: 4 },
});
