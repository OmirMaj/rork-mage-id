// components/copilot/EstimateDiffView.tsx — before→after preview for a
// conversational estimate edit. Pure compute (interpret → recompute → diff),
// memoized.
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Hammer, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { diffEstimates } from '@/utils/estimateCommit';
import type { CopilotContext } from '@/utils/copilot/types';
import type { EstimateEditOp } from '@/utils/copilot/estimateEdit/estimateOps';
import { interpretEstimateOps } from '@/utils/copilot/estimateEdit/interpretEstimateOps';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const signed = (n: number) => (n > 0 ? `+${money(n)}` : `-${money(Math.abs(n))}`);

export default function EstimateDiffView({ ops, ctx, onApply, onDiscard }: {
  ops: EstimateEditOp[]; ctx: CopilotContext; onApply: () => void; onDiscard: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const view = useMemo(() => {
    const before = ctx.project?.linkedEstimate ?? null;
    if (!before) return null;
    const { nextEstimate, results } = interpretEstimateOps(ops, before);
    const diff = diffEstimates(before, nextEstimate);
    const rejected = results.filter(r => !r.ok).map(r => r.reason ?? 'skipped');
    return { before, after: nextEstimate, diff, rejected, valid: results.some(r => r.ok) };
  }, [ops, ctx]);

  if (!view) return (
    <View style={styles.wrap}><Text style={styles.reject}>No estimate to edit.</Text></View>
  );
  const grandDelta = view.after.grandTotal - view.before.grandTotal;

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>HERE’S THE CHANGE</Text>
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.total}>Total {money(view.before.grandTotal)} → {money(view.after.grandTotal)} ({signed(grandDelta)})</Text>
        {view.before.globalMarkup !== view.after.globalMarkup && (
          <Text style={styles.line}>Markup {view.before.globalMarkup}% → {view.after.globalMarkup}%</Text>
        )}
        {view.diff.categories.filter(c => c.delta !== 0).map((c, i) => (
          <Text key={`c${i}`} style={c.delta > 0 ? styles.up : styles.down}>{c.label}: {signed(c.delta)}</Text>
        ))}
        {view.rejected.map((r, i) => <Text key={`x${i}`} style={styles.reject}>couldn’t: {r}</Text>)}
        {!view.valid && <Text style={styles.reject}>Nothing to change — try rephrasing.</Text>}
      </ScrollView>
      <TouchableOpacity style={[styles.apply, !view.valid && styles.applyOff]} onPress={onApply} disabled={!view.valid} activeOpacity={0.9} testID="estimate-edit-apply">
        <Hammer size={18} color={Colors.textOnAccent} strokeWidth={2} />
        <Text style={styles.applyText}>Apply it</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.discard} onPress={onDiscard} activeOpacity={0.7} testID="estimate-edit-discard">
        <X size={14} color={colors.textMuted} strokeWidth={2} />
        <Text style={styles.discardText}>Not that — discard</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: Tokens.spacing.sm },
    eyebrow: { ...Type.monoLabel, color: colors.accent },
    body: { maxHeight: 320 },
    total: { ...Type.subheadEmphasized, color: colors.text, marginBottom: Tokens.spacing.xs },
    line: { ...Type.body, color: colors.textSecondary, paddingVertical: Tokens.spacing.xxs },
    up: { ...Type.body, color: colors.danger, paddingVertical: Tokens.spacing.xxs },
    down: { ...Type.body, color: colors.success, paddingVertical: Tokens.spacing.xxs },
    reject: { ...Type.footnote, color: colors.textMuted, paddingVertical: Tokens.spacing.xxs },
    apply: { flexDirection: 'row', gap: Tokens.spacing.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: Tokens.radius.full, paddingVertical: Tokens.spacing.md, marginTop: Tokens.spacing.sm },
    applyOff: { opacity: 0.4 },
    applyText: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
    discard: { flexDirection: 'row', gap: Tokens.spacing.xxs, alignItems: 'center', justifyContent: 'center', paddingVertical: Tokens.spacing.sm },
    discardText: { ...Type.footnote, color: colors.textMuted },
  });
}
