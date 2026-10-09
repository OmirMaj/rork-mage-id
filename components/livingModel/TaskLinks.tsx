// components/livingModel/TaskLinks.tsx — tick which schedule tasks happen in each room.
//
// The Living Model, Phase 1. A task carries no room, so the person says it:
// one tick per task per room, kept with the job model.
//
// A SUGGESTION IS SHOWN, NEVER APPLIED. The app may list tasks that look like
// they belong in a room (utils/livingModel/linkCore.suggestLinks) and say why.
// None of them is ticked until the person taps Confirm Suggested or ticks the
// task himself. This file is the only caller of confirmSuggestions, and only
// from that button's onPress.
//
// CONFIRM TICKS EXACTLY WHAT THE BOX LISTS. The lines of the Suggested box and
// the ids its button ticks both come from one call
// (utils/livingModel/linkCore.suggestionBox), and every line is printed: the
// box scrolls when the list is long. A task whose name is not on the screen is
// never ticked by Confirm.
//
// THE STAGE OF A TASK CAN BE PICKED. A title can never be read perfectly, so
// each task's stage is a small button: tap it and pick the stage. The choice is
// kept with the ticks (JobModel.stages) and wins over the table; "Read from the
// Title" goes back to the table.
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { Button } from '@/components/ui';
import { labelOn } from '@/components/ui/ink';
import { confirmSuggestions, liveLinks, suggestionBox } from '@/utils/livingModel/linkCore';
import { setRoomTaskLink, setTaskStage } from '@/utils/livingModel/modelCore';
import type { ReplayInput } from '@/utils/livingModel/replayInput';
import { TASK_STAGES } from '@/utils/livingModel/stageCore';
import type { JobModel } from '@/utils/livingModel/types';
import { usePalette } from './replayShared';
import { makeLivingModelStyles } from './styles';

export function TaskLinks({ model, input, roomId, onRoom, onChange }: {
  model: JobModel;
  input: ReplayInput;
  roomId: string | null;
  onRoom: (roomId: string) => void;
  onChange: (next: JobModel) => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const palette = usePalette();
  const [stageFor, setStageFor] = useState<string | null>(null);
  const room = model.rooms.find((r) => r.id === roomId) ?? model.rooms[0] ?? null;
  const ids = useMemo(() => new Set(input.tasks.map((t) => t.id)), [input.tasks]);
  const live = useMemo(() => (room ? liveLinks(model, room.id, ids) : { ids: [], gone: 0 }), [model, room, ids]);
  const box = useMemo(() => (room ? suggestionBox(room, input.linkTasks, live.ids) : { listed: [], confirmIds: [] }), [room, input.linkTasks, live.ids]);
  const reasonOf = useMemo(() => new Map(box.listed.map((s) => [s.taskId, s.reason])), [box]);

  if (model.rooms.length === 0) return <View style={styles.panel}><Text style={styles.para} testID="lm-links-no-rooms">{copy.noRoomsBody}</Text></View>;
  if (input.tasks.length === 0) return <View style={styles.panel}><Text style={styles.para} testID="lm-links-no-schedule">{copy.noScheduleBody}</Text></View>;
  if (!room) return null;

  return (
    <View style={styles.narrow} testID="living-model-links">
      <Text style={styles.para}>{copy.tasksIntroBody}</Text>
      <View style={styles.chips} accessibilityRole="tablist">
        {model.rooms.map((r, i) => {
          const on = r.id === room.id;
          return (
            <Pressable key={r.id} style={[styles.chip, on && styles.chipOn]} onPress={() => onRoom(r.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={r.name} testID={`lm-links-room-${i}`}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.panel}>
        <Text style={styles.panelHeading}>{room.name}</Text>
        <Text style={styles.rowSub} testID="lm-links-count">{copy.tickedCountSub(live.ids.length, input.tasks.length)}</Text>
        {live.gone > 0 ? <Text style={styles.note}>{copy.goneBody(live.gone)}</Text> : null}
        {box.listed.length > 0 ? (
          <View style={styles.suggestBox} testID="lm-suggestions">
            <Text style={styles.suggestTag}>{copy.suggestedLabel}</Text>
            <Text style={styles.note}>{copy.suggestedBody(box.listed.length)}</Text>
            <ScrollView style={styles.suggestList} nestedScrollEnabled testID="lm-suggestion-list">
              {box.listed.map((s, i) => <Text key={s.taskId} style={styles.suggestLine} testID={`lm-suggestion-${i}`}>{s.title}</Text>)}
            </ScrollView>
            <Button
              label={copy.confirmSuggestedLabel}
              variant="secondary"
              size="sm"
              onPress={() => onChange(confirmSuggestions(model, room.id, box.confirmIds))}
              testID="lm-confirm-suggested"
            />
          </View>
        ) : null}
        <Text style={styles.note}>{copy.stageHelpBody}</Text>
        {input.tasks.map((t, i) => {
          const on = live.ids.includes(t.id);
          const reason = reasonOf.get(t.id);
          const picked = input.stageBy[t.id] === 'person';
          const open = stageFor === t.id;
          return (
            <View key={t.id} style={[styles.taskRow, i === 0 && styles.rowFirst]}>
              <View style={styles.taskRowTop}>
                <Pressable
                  style={styles.taskTick}
                  onPress={() => onChange(setRoomTaskLink(model, room.id, t.id, !on))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={copy.tickA11yLabel(t.title, room.name)}
                  testID={`lm-tick-${i}`}
                >
                  <View style={[styles.tick, on && styles.tickOn]}>{on ? <Check size={14} color={labelOn(colors.accentFill)} strokeWidth={3} /> : null}</View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowLabel} numberOfLines={2}>{t.title}</Text>
                    {reason && !on ? <Text style={styles.rowSub} numberOfLines={1}>{copy.suggestionSub(reason)}</Text> : null}
                  </View>
                </Pressable>
                <Pressable
                  style={[styles.stageBtn, open && styles.chipOn]}
                  onPress={() => setStageFor(open ? null : t.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={copy.stagePickA11yLabel(t.title)}
                  testID={`lm-stage-${i}`}
                >
                  <View style={[styles.swatch, { backgroundColor: palette.stage[t.stage] }]} />
                  <Text style={styles.stageBtnText} numberOfLines={1}>{picked ? copy.stagePickedSub(copy.stageName(t.stage)) : copy.stageName(t.stage)}</Text>
                  <ChevronDown size={14} color={colors.textMuted} />
                </Pressable>
              </View>
              {open ? (
                <View style={styles.stagePicker} accessibilityRole="radiogroup" accessibilityLabel={copy.stagePickerLabel} testID={`lm-stage-picker-${i}`}>
                  {TASK_STAGES.map((st) => {
                    const sel = picked && t.stage === st;
                    return (
                      <Pressable key={st} style={[styles.chip, sel && styles.chipOn]} onPress={() => { onChange(setTaskStage(model, t.id, st)); setStageFor(null); }} accessibilityRole="radio" accessibilityState={{ selected: sel }} accessibilityLabel={copy.stageName(st)} testID={`lm-stage-${i}-${st}`}>
                        <Text style={[styles.chipText, sel && styles.chipTextOn]}>{copy.stageName(st)}</Text>
                      </Pressable>
                    );
                  })}
                  <Pressable style={[styles.chip, !picked && styles.chipOn]} onPress={() => { onChange(setTaskStage(model, t.id, null)); setStageFor(null); }} accessibilityRole="radio" accessibilityState={{ selected: !picked }} accessibilityLabel={copy.stageFromTitleLabel} testID={`lm-stage-${i}-title`}>
                    <Text style={[styles.chipText, !picked && styles.chipTextOn]}>{copy.stageFromTitleLabel}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
