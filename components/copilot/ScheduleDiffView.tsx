// components/copilot/ScheduleDiffView.tsx — the before→after preview for a
// conversational schedule edit. Pure compute (interpret → CPM → diff), memoized.
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Hammer, X, TriangleAlert } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { runCpm } from '@/utils/cpm';
import type { CopilotContext } from '@/utils/copilot/types';
import type { EditOp } from '@/utils/copilot/scheduleEdit/editOps';
import { interpretScheduleOps, applyEditEffects } from '@/utils/copilot/scheduleEdit/interpretOps';
import { diffSchedule } from '@/utils/copilot/scheduleEdit/diffSchedule';

export default function ScheduleDiffView({ ops, ctx, onApply, onDiscard }: {
  ops: EditOp[]; ctx: CopilotContext; onApply: () => void; onDiscard: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { diff, valid } = useMemo(() => {
    const before = ctx.currentTasks ?? [];
    const { nextTasks, results } = interpretScheduleOps(ops, before);
    const after = applyEditEffects(ops, nextTasks, ctx.cpmOptions ?? {});
    const rejected = results.filter(r => !r.ok).map(r => ({ summary: r.reason ?? 'skipped' }));
    const d = diffSchedule(before, after, runCpm(before, ctx.cpmOptions ?? {}), runCpm(after, ctx.cpmOptions ?? {}), rejected);
    return { diff: d, valid: results.some(r => r.ok) };
  }, [ops, ctx]);

  const dd = (n: number) => (n > 0 ? `+${n}d` : `${n}d`);
  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>HERE’S THE RIPPLE</Text>
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {diff.finishDeltaDays !== 0 && (
          <Text style={styles.finish}>Finish {dd(diff.finishDeltaDays)} — day {diff.finishBeforeDay} → {diff.finishAfterDay}</Text>
        )}
        {diff.moved.map(m => (
          <Text key={m.id} style={styles.line}>
            {m.name}:{m.startDelta ? ` start ${dd(m.startDelta)}` : ''}{m.durationDelta ? ` dur ${dd(m.durationDelta)}` : ''}
          </Text>
        ))}
        {diff.added.map((a, i) => <Text key={`a${i}`} style={styles.add}>+ {a.name} ({a.durationDays}d{a.isMilestone ? ', milestone' : ''})</Text>)}
        {diff.removed.map((r, i) => <Text key={`r${i}`} style={styles.remove}>− {r.name}</Text>)}
        {diff.depChanges.map((c, i) => <Text key={`d${i}`} style={styles.line}>{c.added ? '+' : '−'} dep {c.fromName} → {c.toName} ({c.type})</Text>)}
        {diff.criticalEntered.length > 0 && (
          <View style={styles.critRow}>
            <TriangleAlert size={14} color={colors.accent} strokeWidth={2} />
            <Text style={styles.warn}>now critical: {diff.criticalEntered.join(', ')}</Text>
          </View>
        )}
        {diff.criticalLeft.length > 0 && <Text style={styles.line}>off critical: {diff.criticalLeft.join(', ')}</Text>}
        {diff.rejected.map((r, i) => <Text key={`x${i}`} style={styles.reject}>couldn’t: {r.summary}</Text>)}
        {!valid && <Text style={styles.reject}>Nothing to change — try rephrasing.</Text>}
      </ScrollView>
      <TouchableOpacity style={[styles.apply, !valid && styles.applyOff]} onPress={onApply} disabled={!valid} activeOpacity={0.9} testID="schedule-edit-apply">
        <Hammer size={18} color={Colors.textOnAccent} strokeWidth={2} />
        <Text style={styles.applyText}>Apply it</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.discard} onPress={onDiscard} activeOpacity={0.7} testID="schedule-edit-discard">
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
    finish: { ...Type.subheadEmphasized, color: colors.text, marginBottom: Tokens.spacing.xs },
    line: { ...Type.body, color: colors.textSecondary, paddingVertical: Tokens.spacing.xxs },
    add: { ...Type.body, color: colors.success, paddingVertical: Tokens.spacing.xxs },
    remove: { ...Type.body, color: colors.danger, paddingVertical: Tokens.spacing.xxs },
    critRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, paddingVertical: Tokens.spacing.xxs },
    warn: { ...Type.body, color: colors.accent },
    reject: { ...Type.footnote, color: colors.textMuted, paddingVertical: Tokens.spacing.xxs },
    apply: { flexDirection: 'row', gap: Tokens.spacing.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFill, borderRadius: Tokens.radius.full, paddingVertical: Tokens.spacing.md, marginTop: Tokens.spacing.sm },
    applyOff: { opacity: 0.4 },
    applyText: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
    discard: { flexDirection: 'row', gap: Tokens.spacing.xxs, alignItems: 'center', justifyContent: 'center', paddingVertical: Tokens.spacing.sm },
    discardText: { ...Type.footnote, color: colors.textMuted },
  });
}
