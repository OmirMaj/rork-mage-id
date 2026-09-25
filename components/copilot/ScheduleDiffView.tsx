// components/copilot/ScheduleDiffView.tsx — the before→after preview for a
// conversational schedule edit. Pure compute (interpret → CPM → diff), memoized.
//
// Honest acknowledgement: the header counts what the app UNDERSTOOD against
// everything the AI sent ("Understood 3 of 4 changes"), every op it couldn't
// read or apply gets its own line, and the button names how many changes Apply
// will make. It used to list only what survived and enable "Apply it" if
// anything did — "add three tasks" + one move showed just the move.
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Hammer, X, TriangleAlert } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { runCpm } from '@/utils/cpm';
import type { CopilotContext } from '@/utils/copilot/types';
import { describeDropped, type EditOp, type DroppedOp } from '@/utils/copilot/scheduleEdit/editOps';
import { interpretScheduleOps, applyEditEffects } from '@/utils/copilot/scheduleEdit/interpretOps';
import { diffSchedule } from '@/utils/copilot/scheduleEdit/diffSchedule';
import { buildSchedulePreviewOverlay, type SchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a preview overlay says, as a string: every field except the ids an
 *  added task is minted with (they change on every re-interpretation). Two
 *  overlays with the same signature draw the same marks. Exported for the
 *  lane's validator. */
export function previewSignature(o: SchedulePreviewOverlay): string {
  return JSON.stringify([
    o.moved.map((m) => [m.id, m.fromEs, m.fromEf, m.toEs, m.toEf]),
    o.added.map((a) => [a.title, a.es, a.ef, a.isMilestone, a.afterIndex]),
    o.removedIds,
    o.finishBefore,
    o.finishAfter,
  ]);
}

export default function ScheduleDiffView({ ops, dropped = [], ctx, onApply, onDiscard }: {
  ops: EditOp[]; dropped?: DroppedOp[]; ctx: CopilotContext; onApply: () => void; onDiscard: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { diff, okCount, loose, overlay } = useMemo(() => {
    const before = ctx.currentTasks ?? [];
    // The host's calendar: a move CPM would ignore is reported, not counted.
    const { nextTasks, results } = interpretScheduleOps(ops, before, ctx.cpmOptions ?? {});
    const after = applyEditEffects(ops, nextTasks, ctx.cpmOptions ?? {});
    const rejected = results.filter(r => !r.ok).map(r => ({ summary: r.reason ?? 'skipped' }));
    const cpmBefore = runCpm(before, ctx.cpmOptions ?? {});
    const cpmAfter = runCpm(after, ctx.cpmOptions ?? {});
    const d = diffSchedule(before, after, cpmBefore, cpmAfter, rejected);
    // A new task nothing waits on doesn't push anything — say so, so a task
    // that landed "at the end, on its own" is never read as inserted work.
    // Keyed by task ID: three new "Cleanup" rows where only the last is loose
    // used to flag all three (review round 3).
    const beforeIds = new Set(before.map(t => t.id));
    const newIds = after.filter(t => !beforeIds.has(t.id)).map(t => t.id);
    const loose = new Set(newIds.filter(id => !after.some(t => t.dependencies.includes(id))));
    // The same proposal as a Gantt overlay (wave 6c): a host that can draw it
    // (Schedule Pro's docked editor) shows the ripple on the timeline before
    // Apply. Built from the SAME before/after and CPM runs as the words.
    const overlay = buildSchedulePreviewOverlay(before, after, cpmBefore, cpmAfter);
    return { diff: d, okCount: results.filter(r => r.ok).length, loose, overlay };
  }, [ops, ctx]);

  // Hand the overlay to the host while this review is on screen, and take it
  // back when it goes (Apply, Discard, a new turn, the pane closing). Optional:
  // no host but Schedule Pro sets onPreview, so the phone, the classic tab and
  // the daily report are untouched.
  //
  // Keyed on what the overlay SAYS, not its identity. useProjects() returns a
  // fresh object on every call, so the host's memoised ctx — and this memo —
  // rebuild on every render, and interpretScheduleOps mints a new id for each
  // added task each time. Handing the host a "new" overlay on every render
  // would re-render the host, which re-renders this view, which hands it
  // another: an endless loop (it hit React's update-depth limit in jest). The
  // signature leaves out the added tasks' minted ids for the same reason.
  const onPreviewRef = useRef(ctx.onPreview);
  onPreviewRef.current = ctx.onPreview;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const overlaySig = previewSignature(overlay);
  useEffect(() => {
    onPreviewRef.current?.(overlayRef.current);
    return () => { onPreviewRef.current?.(null); };
  }, [overlaySig]);

  const total = ops.length + dropped.length;
  const valid = okCount > 0;
  const dd = (n: number) => (n > 0 ? `+${n}d` : `${n}d`);
  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>HERE’S THE RIPPLE</Text>
      {total > 0 && (
        <Text style={styles.count} testID="schedule-edit-understood">
          {okCount === total ? `Understood ${plural(total, 'change')}` : `Understood ${okCount} of ${plural(total, 'change')}`}
        </Text>
      )}
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {diff.finishDeltaDays !== 0 && (
          <Text style={styles.finish}>Finish {dd(diff.finishDeltaDays)} — day {diff.finishBeforeDay} → {diff.finishAfterDay}</Text>
        )}
        {diff.moved.map(m => (
          <Text key={m.id} style={styles.line}>
            {m.name}:{m.startDelta ? ` start ${dd(m.startDelta)}` : ''}{m.durationDelta ? ` dur ${dd(m.durationDelta)}` : ''}
          </Text>
        ))}
        {diff.added.map((a, i) => (
          <Text key={`a${i}`} style={styles.add} testID="schedule-edit-added">
            + {a.name} ({a.durationDays}d{a.isMilestone ? ', milestone' : ''}){loose.has(a.id) ? ' — nothing waits on it yet' : ''}
          </Text>
        ))}
        {diff.removed.map((r, i) => <Text key={`r${i}`} style={styles.remove}>− {r.name}</Text>)}
        {diff.depChanges.map((c, i) => <Text key={`d${i}`} style={styles.line}>{c.added ? '+' : '−'} dep {c.fromName} → {c.toName} ({c.type})</Text>)}
        {diff.criticalEntered.length > 0 && (
          <View style={styles.critRow}>
            <TriangleAlert size={14} color={colors.accent} strokeWidth={2} />
            <Text style={styles.warn}>now critical: {diff.criticalEntered.join(', ')}</Text>
          </View>
        )}
        {diff.criticalLeft.length > 0 && <Text style={styles.line}>off critical: {diff.criticalLeft.join(', ')}</Text>}
        {dropped.map((d, i) => <Text key={`u${i}`} style={styles.reject} testID="schedule-edit-unread">Couldn’t read: {describeDropped(d, ctx.currentTasks ?? [])}</Text>)}
        {diff.rejected.map((r, i) => <Text key={`x${i}`} style={styles.reject}>Couldn’t apply: {r.summary}</Text>)}
        {!valid && <Text style={styles.reject}>Nothing to change yet — say it another way below.</Text>}
      </ScrollView>
      <TouchableOpacity style={[styles.apply, !valid && styles.applyOff]} onPress={onApply} disabled={!valid} activeOpacity={0.9} testID="schedule-edit-apply" accessibilityRole="button">
        <Hammer size={18} color={Colors.textOnAccent} strokeWidth={2} />
        <Text style={styles.applyText}>{valid ? `Apply ${plural(okCount, 'change')}` : 'Nothing to apply'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.discard} onPress={onDiscard} activeOpacity={0.7} testID="schedule-edit-discard" accessibilityRole="button">
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
    count: { ...Type.subheadEmphasized, color: colors.text },
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
