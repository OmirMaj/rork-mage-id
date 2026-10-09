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
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { Button } from '@/components/ui';
import { labelOn } from '@/components/ui/ink';
import { confirmSuggestions, liveLinks, suggestLinks } from '@/utils/livingModel/linkCore';
import { setRoomTaskLink } from '@/utils/livingModel/modelCore';
import type { ReplayInput } from '@/utils/livingModel/replayInput';
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
  const room = model.rooms.find((r) => r.id === roomId) ?? model.rooms[0] ?? null;
  const ids = useMemo(() => new Set(input.tasks.map((t) => t.id)), [input.tasks]);
  const live = useMemo(() => (room ? liveLinks(model, room.id, ids) : { ids: [], gone: 0 }), [model, room, ids]);
  const suggestions = useMemo(() => (room ? suggestLinks(room, input.linkTasks, live.ids) : []), [room, input.linkTasks, live.ids]);
  const reasonOf = useMemo(() => new Map(suggestions.map((s) => [s.taskId, s.reason])), [suggestions]);
  const titleOf = useMemo(() => new Map(input.tasks.map((t) => [t.id, t.title])), [input.tasks]);

  if (model.rooms.length === 0) return <View style={styles.panel}><Text style={styles.para} testID="lm-links-no-rooms">{copy.noRoomsBody}</Text></View>;
  if (input.tasks.length === 0) return <View style={styles.panel}><Text style={styles.para} testID="lm-links-no-schedule">{copy.noScheduleBody}</Text></View>;
  if (!room) return null;

  return (
    <View style={styles.colMain} testID="living-model-links">
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
        {suggestions.length > 0 ? (
          <View style={styles.suggestBox} testID="lm-suggestions">
            <Text style={styles.suggestTag}>{copy.suggestedLabel}</Text>
            <Text style={styles.note}>{copy.suggestedBody(suggestions.length)}</Text>
            {suggestions.slice(0, 6).map((s) => <Text key={s.taskId} style={styles.rowSub} numberOfLines={1}>{titleOf.get(s.taskId)}</Text>)}
            <Button
              label={copy.confirmSuggestedLabel}
              variant="secondary"
              size="sm"
              onPress={() => onChange(confirmSuggestions(model, room.id, suggestions.map((s) => s.taskId)))}
              testID="lm-confirm-suggested"
            />
          </View>
        ) : null}
        {input.tasks.map((t, i) => {
          const on = live.ids.includes(t.id);
          const reason = reasonOf.get(t.id);
          return (
            <Pressable
              key={t.id}
              style={[styles.row, i === 0 && styles.rowFirst]}
              onPress={() => onChange(setRoomTaskLink(model, room.id, t.id, !on))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={copy.tickA11yLabel(t.title, room.name)}
              testID={`lm-tick-${i}`}
            >
              <View style={[styles.tick, on && styles.tickOn]}>{on ? <Check size={14} color={labelOn(colors.accentFill)} strokeWidth={3} /> : null}</View>
              <View style={styles.rowMain}>
                <Text style={styles.rowLabel} numberOfLines={2}>{t.title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{reason && !on ? copy.suggestionSub(reason) : copy.stageName(t.stage)}</Text>
              </View>
              <View style={[styles.swatch, { backgroundColor: palette.stage[t.stage] }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
