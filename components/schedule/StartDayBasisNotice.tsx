// StartDayBasisNotice — the ONE place the app asks about a legacy day scale.
//
// WHY THIS FILE EXISTS: `utils/scheduleRebase.ts` shipped from 2026-07 to
// 2026-09-11. The first time a start date was set on a schedule it rewrote every
// `task.startDay` from a WORKING ORDINAL to the CALENDAR INDEX of that ordinal's
// working day and persisted the result. The engine of the day needed that,
// because it read `startDay` as a calendar index. The engine now CONVERTS at its
// own `pins` line (utils/cpm.ts), so those stored rows are converted a second
// time and the plan reads longer than the plan the user authored — measured at
// twelve calendar days on a three-task, thirty-five-working-day schedule.
//
// It is legacy DATA, not legacy code, so deleting the helper fixed nothing that
// was already on disk. `cpm.previewStartDayBasisMigration` decides whether to
// ask; this component is the asking. Three rules it follows on purpose:
//
//   1. It NEVER converts anything itself. Both buttons are the caller's, and
//      which boolean each one sends is `cpm.startDayBasisNoticeModel` data
//      rather than a literal typed into this file three times.
//   2. IT ASSERTS NO CAUSE. It used to open "This schedule was re-anchored by
//      an older version of MAGE" — a claim the detector cannot support. A task
//      that slipped from its baseline by exactly the weekend it spans is
//      byte-identical to a re-anchored row, at ANY row count (measured; the
//      two-row fixture in scripts/validate-startdate-rebase.ts is both readings
//      of the same numbers). So this states the MEASUREMENT — two readings, two
//      finish dates — and names every row it would move with both of its start
//      dates, because the user cannot check a scale and can absolutely check a
//      date they set themselves.
//   3. Both answers are final. Accepting or declining writes
//      `ProjectSchedule.startDayBasis`, so the question is asked exactly once
//      per schedule. Declining is a real answer: it means "these numbers are
//      the plan I want", which is precisely what the engine already assumes.
//
// Renders null unless the preview says to ask, so it is safe to mount
// unconditionally on any surface that has a schedule.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { CalendarClock } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import {
  calendarDayToDate, startDayBasisNoticeModel,
  type StartDayBasisMigrationPreview,
} from '@/utils/cpm';

export const START_DAY_BASIS_TITLE = 'THESE START DAYS CAN BE READ TWO WAYS';
export const START_DAY_BASIS_ACCEPT = 'Re-anchor';
export const START_DAY_BASIS_DECLINE = 'Keep as-is';

/** `Fri Apr 3` for a day index, or `day 45` when the schedule has no anchor. */
function dayLabel(projectStartDate: Date | null, day: number): string {
  if (!projectStartDate || !Number.isFinite(projectStartDate.getTime())) return `day ${day}`;
  return calendarDayToDate(projectStartDate, day)
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export interface StartDayBasisNoticeProps {
  /** From `cpm.previewStartDayBasisMigration(schedule)`. Memoise it. */
  preview: StartDayBasisMigrationPreview;
  /** The schedule's anchor. Null renders day numbers instead of dates. */
  projectStartDate: Date | null;
  /**
   * Spread `cpm.startDayBasisAnswerPatch(preview, accept)` onto the stored
   * schedule, through whatever undo-aware commit path the surface owns, in ONE
   * write. `accept` comes from the model action the user pressed — this
   * component never invents it, and the surface must not either.
   */
  onAnswer: (accept: boolean) => void;
  /** Layout only (margins/width). Never used to alter the warning treatment. */
  style?: StyleProp<ViewStyle>;
}

export function StartDayBasisNotice({
  preview, projectStartDate, onAnswer, style,
}: StartDayBasisNoticeProps) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const model = startDayBasisNoticeModel(preview);
  if (!model.visible) return null;

  const { inflationDays, storedFinishDay, remappedFinishDay } = preview;
  const rows = model.rows.length;
  const body =
    `These start days can be read two ways, and MAGE cannot tell from the numbers alone which ` +
    `one you meant. Read as stored, this plan finishes ${dayLabel(projectStartDate, storedFinishDay)}. ` +
    `Read the other way it finishes ${dayLabel(projectStartDate, remappedFinishDay)}, ` +
    `${inflationDays} day${inflationDays === 1 ? '' : 's'} earlier. Check the ${rows} row${rows === 1 ? '' : 's'} ` +
    `below against dates you know: re-anchor if the second column is the one you set, keep them if the first ` +
    `is. Either way nothing else changes — no duration, no link. It is undoable, and you will only be asked once.`;

  return (
    <View style={[s.card, style]} accessibilityRole="alert" testID="schedule-startday-basis-notice">
      <View style={s.head}>
        <View style={s.icon}>
          <CalendarClock size={16} color={t.warningLabel} strokeWidth={1.75} />
        </View>
        <View style={s.headBody}>
          <Text style={s.title}>{START_DAY_BASIS_TITLE}</Text>
          <Text style={s.text}>{body}</Text>
        </View>
      </View>

      {/* The rows, with BOTH readings of each start day. This is the auditable
          half — a date the user set themselves, against the date the other
          reading gives it — and it replaces the old evidence lines, which spoke
          about baselines and calendar indices and could not be checked. */}
      {model.rows.slice(0, 4).map((r) => (
        <Text key={r.id} style={s.evidence} numberOfLines={1}>
          • {r.title} — now {dayLabel(projectStartDate, r.storedDay)}, or {dayLabel(projectStartDate, r.remappedDay)}
        </Text>
      ))}
      {model.rows.length > 4 && (
        <Text style={s.evidence}>• …and {model.rows.length - 4} more</Text>
      )}

      {/* ONE mapped handler, over `cpm.startDayBasisNoticeModel().actions`. Two
          hand-written onPress lines is how the accept button once got wired to
          the decline answer with every guard still green. */}
      <View style={s.actions}>
        {model.actions.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={a.accept ? s.accept : s.decline}
            onPress={() => onAnswer(a.accept)}
            accessibilityRole="button"
            testID={a.testID}
          >
            <Text style={a.accept ? s.acceptText : s.declineText}>
              {a.accept ? START_DAY_BASIS_ACCEPT : START_DAY_BASIS_DECLINE}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// Amber, the app's trust-warning palette — not the accent, and never the
// accent as a BACKGROUND. `warningSoft`/`warningLabel` composite over whichever
// ground is behind them, so tint and ink move together between themes.
const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  head: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  icon: {
    ...cardSurface(t, { radius: 'sm', pad: 'none', bordered: false }),
    width: 28, height: 28,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  headBody: { flex: 1, gap: 3, minWidth: 0 },
  title: {
    fontSize: Type.caption1.fontSize, fontWeight: '800' as const,
    color: t.warningLabel, letterSpacing: 0.4,
  },
  text: { fontSize: Type.caption2.fontSize, color: t.textSecondary, lineHeight: 16 },
  evidence: {
    fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15, paddingLeft: 38,
  },
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: 8 },
  decline: {
    ...cardSurface(t, { radius: 'sm', pad: 'none' }),
    paddingHorizontal: 14, paddingVertical: 8,
  },
  declineText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  accept: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.warning,
  },
  acceptText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },
});
