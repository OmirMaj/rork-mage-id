// components/schedule/PredecessorPicker.tsx — shared multi-predecessor picker.
//
// Extracted verbatim from the inline `PredecessorSheet` in app/schedule-wizard.tsx.
// Both the wizard and (eventually) the Pro grid reuse this component.
//
// ── Public interface ─────────────────────────────────────────────────────────
//
//   PredecessorLink  — one dependency with a link type and an optional lag.
//   PredecessorPickerProps  — what the host must supply.
//
// The host is responsible for filtering candidates to only the EARLIER tasks
// (i.e. calling predecessorOptions or equivalent before passing the list).
// This component trusts the list it receives — self/cycle guards live at the
// data layer (setPredecessors / repairChain), not here.
//
// ── Wizard adapter ───────────────────────────────────────────────────────────
//
// The wizard stores dependency state as:
//   task.predecessorIds: string[]          (ordered, de-duplicated, by position)
//   task.lags: Record<string, number>      (absence of key === no lag)
//
// Those map directly to PredecessorLink[]  at the call site in the wizard:
//   value = task.predecessorIds.map(id => ({
//     taskId: id, type: 'FS', lagDays: task.lags?.[id] ?? 0,
//   }))
//   onChange = (links) =>
//     updateTasks(prev =>
//       setLags(
//         setPredecessors(prev, idx, links.map(l => l.taskId)),
//         idx,
//         Object.fromEntries(links.map(l => [l.taskId, l.lagDays])),
//       )
//     )
//
// The link `type` field is kept in the public interface for the Pro grid,
// which uses typed dependency links (FS/SS/FF/SF). The wizard always uses FS
// and the extracted component does not render a type selector (matching the
// original wizard sheet exactly). Extending it for type selection is a
// separate incremental change in the Pro grid.

import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, Modal, Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { X, Minus, Plus, Square, CheckSquare } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { clampLag, lagStepperLabel } from '@/constants/scheduleTemplates';
import { PHASE_COLORS } from '@/utils/scheduleEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// ── Public types ─────────────────────────────────────────────────────────────

/** A single dependency link from one task to its predecessor. */
export interface PredecessorLink {
  taskId: string;
  /** Dependency type. The wizard always writes FS; the Pro grid may write SS/FF/SF. */
  type: 'FS' | 'SS' | 'FF' | 'SF';
  /** Positive = lag (wait N days after predecessor finishes). Negative = lead (start N days early). */
  lagDays: number;
}

/**
 * Candidate task that can be selected as a predecessor.
 * The host filters to only EARLIER tasks before passing this list.
 */
export interface PredecessorCandidate {
  id: string;
  /** Human-readable label shown in the picker row (e.g. "3. Framing"). */
  label: string;
  /** Optional phase name — used for the colored dot. Defaults to "General". */
  phase?: string;
}

export interface PredecessorPickerProps {
  /** Human-readable title for this task (shown in the sheet header). */
  taskLabel: string;
  /**
   * Tasks that may be selected as predecessors (already ordered/eligible —
   * the host filters to earlier tasks).
   */
  candidates: PredecessorCandidate[];
  /** Current dependency links for this task. */
  value: PredecessorLink[];
  /** Called when the user taps "Done". Receives the updated link list. */
  onChange: (links: PredecessorLink[]) => void;
  onClose: () => void;
  /**
   * Optional: links belonging to the task immediately above this one.
   * When provided, enables the "Alongside it" quick-preset (same predecessors
   * as the row above, same lags). The wizard supplies this; the Pro grid
   * can omit it if the preset isn't applicable.
   */
  prevLinks?: PredecessorLink[];
}

// ── Internal lag map helpers ─────────────────────────────────────────────────

/** Extract lag in days from the value array for a given predecessor id. */
function lagFor(links: PredecessorLink[], id: string): number {
  return links.find(l => l.taskId === id)?.lagDays ?? 0;
}

// ── Summary sentence ─────────────────────────────────────────────────────────
//
// Mirrors the logic of `sequenceDetail` in constants/scheduleTemplates.ts,
// but works from { id, label } pairs instead of TemplateTask objects. Kept
// in sync manually — if the wording in scheduleTemplates ever changes, update
// here too.

function dayCount(n: number): string {
  const abs = Math.abs(n);
  return abs === 1 ? '1 day' : `${abs} days`;
}

function buildSummary(
  candidates: PredecessorCandidate[],
  selected: string[],
  draftLags: Record<string, number>,
): string {
  if (selected.length === 0) return 'Starts on day 1';

  // Preserve list order, not tap order.
  const rows = candidates.filter(c => selected.includes(c.id));
  const names = rows.map(c => c.label);
  const lagOf = (id: string) => {
    const raw = draftLags[id];
    return typeof raw === 'number' ? clampLag(raw) : 0;
  };

  if (rows.every(r => lagOf(r.id) === 0)) {
    if (names.length === 1) return `Starts when ${names[0]} finishes`;
    if (names.length === 2) return `Starts when ${names[0]} and ${names[1]} have both finished`;
    return `Starts when all ${names.length} of ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} have finished`;
  }

  if (rows.length === 1) {
    const lag = lagOf(rows[0].id);
    return lag > 0
      ? `Starts ${dayCount(lag)} after ${names[0]} finishes`
      : `Starts ${dayCount(lag)} before ${names[0]} finishes`;
  }

  const clauses = rows.map(r => {
    const lag = lagOf(r.id);
    const name = r.label;
    if (lag === 0) return `when ${name} finishes`;
    return lag > 0
      ? `${dayCount(lag)} after ${name} finishes`
      : `${dayCount(lag)} before ${name} finishes`;
  });
  return `Starts at the latest of: ${clauses.join(', ')}`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PredecessorPicker(props: PredecessorPickerProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { taskLabel, candidates, value, onChange, onClose, prevLinks } = props;

  // Seeded once at mount — the parent mounts this only while it's open, so
  // there's no props-to-state sync to drift.
  const [selected, setSelected] = useState<string[]>(
    () => value.map(l => l.taskId),
  );
  // Draft offsets, keyed by predecessor id. Same pruning rule as the model:
  // an offset only exists while its link does.
  const [draftLags, setDraftLags] = useState<Record<string, number>>(
    () => {
      const m: Record<string, number> = {};
      for (const l of value) {
        if (l.lagDays !== 0) m[l.taskId] = l.lagDays;
      }
      return m;
    },
  );

  const toggle = (id: string) => {
    setSelected(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));
    // Un-checking drops the offset WITH the link. Keeping it would mean
    // re-checking the same task six taps later silently restores a wait the
    // user thought they'd deleted — the exact resurrection the model prunes
    // against, reproduced in the draft.
    setDraftLags(cur => {
      if (!(id in cur)) return cur;
      const { [id]: _dropped, ...rest } = cur;
      return rest;
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  };

  const bumpLag = (id: string, delta: number) => {
    setDraftLags(cur => ({ ...cur, [id]: clampLag((cur[id] ?? 0) + delta) }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  };

  /** Tapping the caption clears the offset — the way back from 12 taps of "+". */
  const clearLag = (id: string) => {
    setDraftLags(cur => {
      if (!(id in cur)) return cur;
      const { [id]: _dropped, ...rest } = cur;
      return rest;
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  };

  const applyPreset = (ids: string[], lags: Record<string, number>) => {
    setSelected(ids);
    setDraftLags(lags);
  };

  // ── Quick-access presets ───────────────────────────────────────────────────
  //
  // The three states the old one-tap chip could reach, as shortcuts over the
  // same selection. "Alongside" is omitted when the row above starts on day 1,
  // because there it means the identical thing as "Starts day 1" and two lit
  // chips saying different words is worse than one.
  //
  // "Alongside it" carries the row above's OFFSETS too. Without them this row
  // would start earlier than the row it claims to run alongside, which is the
  // one thing the word promises.
  const lastCandidate = candidates.length > 0 ? candidates[candidates.length - 1] : null;

  const presets = useMemo<{ label: string; ids: string[]; lags: Record<string, number> }[]>(() => {
    if (!lastCandidate) return [];

    const prevIds = prevLinks?.map(l => l.taskId) ?? [];
    const prevLagMap: Record<string, number> = {};
    for (const l of prevLinks ?? []) {
      if (l.lagDays !== 0) prevLagMap[l.taskId] = l.lagDays;
    }

    return [
      { label: 'After the task above', ids: [lastCandidate.id], lags: {} },
      ...(prevIds.length > 0
        ? [{ label: 'Alongside it', ids: [...prevIds], lags: prevLagMap }]
        : []),
      { label: 'Starts day 1', ids: [], lags: {} },
    ];
  }, [lastCandidate, prevLinks]);

  const summary = buildSummary(candidates, selected, draftLags);

  const handleDone = () => {
    // Build the PredecessorLink[] from selected + draftLags.
    // Preserve list order (candidates order) so the output is deterministic.
    const links: PredecessorLink[] = candidates
      .filter(c => selected.includes(c.id))
      .map(c => ({
        taskId: c.id,
        type: 'FS' as const,
        lagDays: draftLags[c.id] ?? 0,
      }));
    onChange(links);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Sequence</Text>
              <Text style={styles.sheetSub} numberOfLines={1}>{taskLabel}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={19} color={themeColors.textMuted} strokeWidth={1.9} />
            </TouchableOpacity>
          </View>

          <View style={styles.presetRow}>
            {presets.map((p, pi) => {
              const active = p.ids.length === selected.length
                && p.ids.every(id => selected.includes(id))
                // A preset with the right tasks but a different wait is NOT
                // that preset — lighting it would claim a schedule the user
                // isn't looking at.
                && p.ids.every(id => (draftLags[id] ?? 0) === (p.lags[id] ?? 0));
              return (
                <TouchableOpacity
                  key={p.label}
                  style={[styles.presetChip, active && styles.presetChipActive]}
                  onPress={() => applyPreset(p.ids, p.lags)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  testID={`pred-preset-${pi}`}
                >
                  <Text style={[styles.presetChipText, active && styles.presetChipTextActive]} numberOfLines={1}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Waits for</Text>
          <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
            {candidates.map((o, i) => {
              const on = selected.includes(o.id);
              const Box = on ? CheckSquare : Square;
              const lag = draftLags[o.id] ?? 0;
              const phaseColor = PHASE_COLORS[o.phase ?? 'General'] ?? PHASE_COLORS.General;
              return (
                <View key={o.id} style={[styles.predRow, on && styles.predOptionActive]}>
                  <TouchableOpacity
                    style={styles.predOption}
                    onPress={() => toggle(o.id)}
                    activeOpacity={0.7}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={o.label}
                    testID={`pred-option-${i}`}
                  >
                    <Box size={18} color={on ? themeColors.accent : themeColors.textMuted} strokeWidth={2} />
                    <View style={[styles.taskDot, { backgroundColor: phaseColor }]} />
                    <Text style={[styles.predOptionText, on && { color: themeColors.text }]} numberOfLines={1}>
                      {o.label}
                    </Text>
                  </TouchableOpacity>

                  {/* Lag / lead. Only shown for a task this row actually waits
                      on — an offset with no link to sit on is meaningless, and
                      the model would prune it on the way in anyway. Stepping
                      below zero is the LEAD direction: this task overlaps the
                      end of that one instead of waiting for it. */}
                  {on && (
                    <View style={styles.lagRow}>
                      <TouchableOpacity
                        onPress={() => bumpLag(o.id, -1)}
                        hitSlop={{ top: 10, right: 8, bottom: 10, left: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Start earlier relative to ${o.label}`}
                        testID={`pred-lag-minus-${i}`}
                      >
                        <Minus size={15} color={themeColors.text} strokeWidth={2.25} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => clearLag(o.id)}
                        disabled={lag === 0}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={
                          lag === 0
                            ? `No wait after ${o.label}`
                            : `${lagStepperLabel(lag)} relative to ${o.label}. Tap to clear.`
                        }
                        testID={`pred-lag-value-${i}`}
                      >
                        <Text style={[styles.lagValueText, lag !== 0 && styles.lagValueTextSet]}>
                          {lagStepperLabel(lag)}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => bumpLag(o.id, 1)}
                        hitSlop={{ top: 10, right: 10, bottom: 10, left: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Wait longer after ${o.label}`}
                        testID={`pred-lag-plus-${i}`}
                      >
                        <Plus size={15} color={themeColors.text} strokeWidth={2.25} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
            {candidates.length === 0 && (
              <Text style={styles.helper}>
                Nothing runs before this task, so it starts on day 1.
              </Text>
            )}
          </ScrollView>

          {candidates.length > 0 && (
            <Text style={[styles.helper, { marginTop: 10 }]}>
              Tick everything this task waits on. Add a wait when there has to be
              a gap — curing, drying, an inspector&apos;s visit — or step below
              zero to start early and overlap the task before it.
            </Text>
          )}

          <Text style={[styles.helper, { marginTop: 12 }]} testID="pred-summary">
            {summary}
          </Text>
          <TouchableOpacity
            style={[styles.confirmBtn, { marginTop: 12 }]}
            onPress={handleDone}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="pred-apply"
          >
            <Text style={styles.confirmBtnText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
//
// Matches the predecessor picker styles from schedule-wizard.tsx exactly —
// same tokens, same values, same names. This keeps the visual output
// byte-for-byte identical to the original while the styles live alongside
// the component rather than in the wizard's giant makeStyles block.

function makeStyles(t: ThemeColors) {
  return StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: Colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    sheet: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.panel,
      borderWidth: 1, borderColor: t.line,
      padding: 18,
    },
    sheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    sheetTitle: {
      fontSize: Type.title3.fontSize,
      fontWeight: '700' as const,
      color: t.text,
      letterSpacing: -0.3,
    },
    sheetSub: {
      fontSize: Type.caption1.fontSize,
      color: t.textMuted,
      marginTop: 2,
    },
    presetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    presetChip: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: Tokens.radius.md,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1, borderColor: t.line,
    },
    presetChipActive: { borderColor: t.accent, backgroundColor: t.accent + '12' },
    presetChipText: {
      fontSize: Type.caption1.fontSize,
      fontWeight: '600' as const,
      color: t.textSecondary,
    },
    presetChipTextActive: { color: t.accent, fontWeight: '700' as const },
    predOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
      paddingHorizontal: 10,
      borderRadius: Tokens.radius.md,
    },
    predOptionActive: { backgroundColor: t.accent + '10' },
    predOptionText: {
      flex: 1,
      fontSize: Type.bodyCompact.fontSize,
      fontWeight: '600' as const,
      color: t.textSecondary,
    },
    // Wrapper so the checkbox line and the lag stepper share one tinted block —
    // the stepper belongs to the task above it, not to the next one down.
    predRow: {
      borderRadius: Tokens.radius.md,
    },
    // Lag / lead stepper. Indented to the checkbox's text column so it reads as
    // a property OF that row rather than another row.
    lagRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 14,
      marginLeft: 38,
      marginRight: 10,
      marginBottom: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
      alignSelf: 'flex-start',
      borderRadius: Tokens.radius.md,
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.line,
    },
    // Fixed width so the caption swapping between "No wait" and "Start 3 days
    // early" doesn't shove the +/- buttons out from under the user's thumb.
    lagValueText: {
      minWidth: 116,
      textAlign: 'center',
      fontSize: Type.caption1.fontSize,
      fontWeight: '600' as const,
      color: t.textMuted,
    },
    lagValueTextSet: { color: t.text, fontWeight: '700' as const },
    taskDot: {
      width: 10, height: 10, borderRadius: 5,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '800' as const,
      color: t.textMuted,
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      marginTop: 4,
    },
    helper: {
      fontSize: Type.footnote.fontSize,
      color: t.textMuted,
      lineHeight: 19,
    },
    confirmBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: Tokens.radius.card,
      backgroundColor: t.accentFill,
    },
    confirmBtnText: {
      fontSize: Type.bodyCompact.fontSize,
      fontWeight: '700' as const,
      color: Colors.textOnAccent,
    },
  });
}
