// components/deliveries/DeliveryFollowSheet.tsx — one delivery against the
// schedule (lane DELIVERIES-1): the two flags, the three dates, the history of
// the supplier's date, and what the person can do about it.
//
// WHAT THIS SHEET CAN DO, AND NOTHING ELSE:
//   - record that the person has looked ("Keep the Supplier Date": one write of
//     the task's current start date on the delivery);
//   - mark the delivery ordered, or not ordered;
//   - open the dates form;
//   - open a DRAFT in the phone's own mail app, or copy the text on the web
//     (utils/deliveries/messageDraft). The person sends it. MAGE ID does not;
//   - open the schedule with a PROPOSAL shown ("See It on the Schedule"). The
//     schedule does not move. Applying is a button on the schedule screen,
//     through that screen's own undoable save.
// It never moves a task, never sends anything and raises no notification.
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Platform, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useIsDesktop, useSheetFrame } from '@/components/ui';
import { showAlert } from '@/utils/alert';
import { parseCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import type { Delivery } from '@/utils/deliverySchedule';
import type { DeliveriesScheduleCopy } from '@/hooks/useDeliveriesScheduleCopy';
import { neededOnSiteBy, type ScheduleForDeliveries } from '@/utils/deliveries/neededBy';
import { isSettled, scheduleMovedFlag, supplierGap, supplierLateFlag } from '@/utils/deliveries/flags';
import { supplierJobEffect, type JobEffect, type SlidTask } from '@/utils/deliveries/jobEffect';
import { readHistory, recordOrdered, supplierDateSource } from '@/utils/deliveries/provenance';
import { buildSupplierDraft, draftMailUrl } from '@/utils/deliveries/messageDraft';
import { dayOrEmpty } from '@/utils/deliveries/calendar';
import { DateRow, DeliveryDatesCard } from './DeliveryDatesCard';
import { cannotSayLine, dayLong, dayShort, gapLine, movedHeadline, neededBasisLine, supplierSourceLine } from './words';
import type { DeliveriesFollowStyles } from './styles';

/** Local midnight of a calendar day, in milliseconds (0 when it cannot be read). */
const dayMs = (day: string): number => parseCalendarDay(day)?.getTime() ?? 0;

/** One task of the preview as two bars on a shared scale: dashed = where it was, solid = where it would be. */
function SlideBar({ task, lo, span, tone, sub, styles }: { task: SlidTask; lo: number; span: number; tone: string; sub: string; styles: DeliveriesFollowStyles }) {
  const at = dayMs;
  const pct = (a: string, b: string) => {
    const left = ((at(a) - lo) / span) * 100;
    const width = Math.max(3, ((at(b) - at(a) + 86_400_000) / span) * 100);
    return { left: `${Math.max(0, Math.min(97, left))}%` as const, width: `${Math.min(100, width)}%` as const };
  };
  return (
    <View style={styles.barRow} testID={`dfs-bar-${task.id}`}>
      <View style={styles.barHead}>
        <Text style={styles.barTitle} numberOfLines={1}>{task.title}</Text>
        <Text style={styles.barDelta}>{sub}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barWas, pct(task.startWas, task.finishWas)]} />
        <View style={[styles.barNow, { backgroundColor: tone }, pct(task.startNow, task.finishNow)]} />
      </View>
    </View>
  );
}

export function DeliveryFollowSheet({
  delivery, schedule, projectId, copy, styles, me, canPreviewJobEffect, onClose, onEdit, onUpdate,
}: {
  /** The delivery shown, or null when the sheet is closed. */
  delivery: Delivery | null;
  schedule: ScheduleForDeliveries | null | undefined;
  projectId: string;
  copy: DeliveriesScheduleCopy;
  styles: DeliveriesFollowStyles;
  me: { id: string; name: string };
  canPreviewJobEffect: boolean;
  onClose: () => void;
  onEdit: (d: Delivery) => void;
  /** The delivery's own writer (ProjectContext.updateDelivery: the offline queue). */
  onUpdate: (id: string, updates: Partial<Delivery>) => void;
}) {
  const { colors: t } = useTheme();
  const { lang } = useT();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWide = useIsDesktop();
  const frame = useSheetFrame('form', { visible: !!delivery, animationType: 'slide' });

  const view = useMemo(() => {
    if (!delivery) return null;
    const needed = neededOnSiteBy(delivery, schedule);
    const gap = supplierGap(delivery, needed, schedule ?? {});
    const moved = scheduleMovedFlag(delivery, schedule);
    const late = supplierLateFlag(delivery, schedule);
    // The job effect is only worked out for a person whose plan has the preview.
    const effect: JobEffect | null = late && canPreviewJobEffect ? supplierJobEffect(delivery, schedule) : null;
    return { needed, gap, moved, late, effect };
  }, [delivery, schedule, canPreviewJobEffect]);

  if (!delivery || !view) return null;
  const { needed, gap, moved, late, effect } = view;
  const d = delivery;
  const settled = isSettled(d);
  const source = supplierDateSource(d);
  const supplierDate = dayOrEmpty(d.expectedDate);
  const history = readHistory(d);
  const ordered = dayOrEmpty(d.orderedOn);

  const writeMessage = async () => {
    const draft = buildSupplierDraft({
      delivery: d,
      neededBy: needed.date,
      neededByWas: moved ? moved.neededByWas : '',
      gap,
      senderName: me.name,
      formatDay: (day) => dayLong(day, lang),
      words: copy.draft,
    });
    const text = `${draft.subject}\n\n${draft.body}`;
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(text);
      showAlert(copy.writeToYardLabel, copy.copiedBody);
      return;
    }
    try {
      // The phone's own mail app, with a draft. Nothing is sent from here.
      await Linking.openURL(draftMailUrl(draft));
    } catch {
      await Clipboard.setStringAsync(text);
      showAlert(copy.writeToYardLabel, copy.couldNotOpenBody);
    }
  };

  const keepDate = () => {
    if (!moved) return;
    // "I have looked": the task's start as it stands now. Not a needed-by date.
    onUpdate(d.id, { taskStartSeen: moved.taskStartNow });
    onClose();
  };

  const seeOnSchedule = () => {
    onClose();
    router.push({ pathname: '/schedule-pro', params: { projectId, taskId: d.taskId ?? '', deliveryId: d.id } });
  };

  const slides = effect && effect.kind === 'task_slides' ? [effect.linked, ...effect.slides] : [];
  const noon = dayMs;
  const lo = slides.length ? Math.min(...slides.map((s) => Math.min(noon(s.startWas), noon(s.startNow)))) : 0;
  const hi = slides.length ? Math.max(...slides.map((s) => Math.max(noon(s.finishWas), noon(s.finishNow)))) + 86_400_000 : 1;

  return (
    <Modal visible transparent animationType={frame.animationType} onRequestClose={onClose}>
      <View style={[styles.overlay, frame.overlay]}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }, frame.card]} testID="dfs-sheet">
          <View style={styles.sheetHead}>
            <TouchableOpacity onPress={onClose} style={styles.sheetBack} hitSlop={8} accessibilityRole="button" accessibilityLabel={copy.closeLabel} testID="dfs-sheet-close">
              <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
            </TouchableOpacity>
            <Text style={styles.sheetTitle} numberOfLines={1}>{d.description}</Text>
            <Text style={styles.sheetSide} numberOfLines={1}>{d.supplier}</Text>
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>

            {late ? (
              <>
                <View style={styles.flag} testID="dfs-flag-after">
                  <View style={[styles.flagBar, { backgroundColor: t.dangerLabel }]} />
                  <View style={styles.flagBody}>
                    <Text style={[styles.flagEyebrow, { color: t.dangerLabel }]}>{copy.afterNeededLabel}</Text>
                    <Text style={styles.flagHead}>{copy.afterHeadBody(d.description, dayLong(late.supplierDate, lang), dayLong(late.neededBy, lang))}</Text>
                    <Text style={styles.flagFoot}>{gapLine(copy, gap)} {supplierSourceLine(copy, source, me.id, lang)}</Text>
                  </View>
                </View>

                {!canPreviewJobEffect ? (
                  <View style={styles.card} testID="dfs-effect-plan">
                    <Text style={styles.body}>{copy.proPlanBody}</Text>
                    <TouchableOpacity style={[styles.btn, styles.btnOutline, styles.btnSmall]} onPress={() => { onClose(); router.push('/paywall'); }} accessibilityRole="button" testID="dfs-see-plans">
                      <Text style={styles.btnOutlineText}>{copy.seePlansLabel}</Text>
                    </TouchableOpacity>
                  </View>
                ) : effect && effect.kind === 'task_slides' ? (
                  <View style={styles.card} testID="dfs-effect">
                    <Text style={styles.sectionLabel}>{copy.ifNothingElseLabel}</Text>
                    <DateRow
                      label={effect.taskTitle}
                      was={dayShort(effect.taskStartWas, lang)}
                      value={copy.earliestSub(dayLong(effect.taskStartEarliest, lang))}
                      basis={copy.earliestWhyBody}
                      styles={styles}
                      testID="dfs-effect-start"
                    />
                    <DateRow
                      label={copy.finishDateLabel}
                      was={effect.finishDeltaWorkingDays !== 0 ? dayLong(effect.finishWas, lang) : undefined}
                      value={dayLong(effect.finishNow, lang)}
                      basis={effect.finishDeltaWorkingDays > 0 ? copy.finishLaterBody(effect.finishDeltaWorkingDays) : copy.finishHoldsBody}
                      styles={styles}
                      testID="dfs-effect-finish"
                    />
                    <DateRow
                      label={copy.tasksThatSlideLabel}
                      value={String(effect.slides.length)}
                      basis={effect.slides.length > 0 ? `${effect.slides.map((s) => s.title).join(', ')}.` : copy.noneSlideBody}
                      styles={styles}
                      testID="dfs-effect-slides"
                    />
                    {slides.slice(0, 6).map((s) => (
                      <SlideBar key={s.id} task={s} lo={lo} span={Math.max(1, hi - lo)} tone={s.id === effect.taskId ? t.dangerLabel : t.accentFill} sub={copy.laterSub(Math.max(0, s.workingDaysLater))} styles={styles} />
                    ))}
                  </View>
                ) : effect && effect.kind === 'start_holds' ? (
                  <View style={styles.card} testID="dfs-effect-holds">
                    <Text style={styles.sectionLabel}>{copy.ifNothingElseLabel}</Text>
                    <Text style={styles.body}>{copy.startHoldsBody(effect.taskTitle, dayLong(effect.taskStart, lang))}</Text>
                  </View>
                ) : effect && effect.kind === 'cannot_say' ? (
                  <View style={styles.card} testID="dfs-effect-cannot">
                    <Text style={styles.body}>{cannotSayLine(copy, effect, late.taskTitle)}</Text>
                  </View>
                ) : null}

                {effect && effect.kind === 'task_slides' ? (
                  isWide ? (
                    <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={seeOnSchedule} accessibilityRole="button" testID="dfs-see-schedule">
                      <Text style={styles.btnPrimaryText}>{copy.seeOnScheduleLabel}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.note} testID="dfs-wider">{copy.widerScreenBody}</Text>
                  )
                ) : null}
                {canPreviewJobEffect ? <Text style={styles.note} testID="dfs-preview-only">{copy.previewOnlyBody}</Text> : null}
              </>
            ) : null}

            {moved ? (
              <>
                <View style={styles.flag} testID="dfs-flag-moved">
                  <View style={[styles.flagBar, { backgroundColor: t.warningLabel }]} />
                  <View style={styles.flagBody}>
                    <Text style={[styles.flagEyebrow, { color: t.warningLabel }]}>{copy.scheduleMovedLabel}</Text>
                    <Text style={styles.flagHead}>{movedHeadline(copy, moved, d.description)}</Text>
                    <Text style={styles.flagFoot}>{copy.startWasNowBody(dayShort(moved.taskStartWas, lang), dayShort(moved.taskStartNow, lang))} {copy.nothingSentBody}</Text>
                  </View>
                </View>
                <View style={styles.card}>
                  <DateRow
                    label={copy.neededByLabel}
                    was={moved.neededByWas ? dayShort(moved.neededByWas, lang) : undefined}
                    value={dayLong(moved.neededByNow, lang)}
                    basis={neededBasisLine(copy, needed)}
                    styles={styles}
                    testID="dfs-moved-needed"
                  />
                </View>
                <TouchableOpacity style={[styles.btn, styles.btnQuiet]} onPress={keepDate} accessibilityRole="button" testID="dfs-keep-date">
                  <Text style={styles.btnQuietText}>{copy.keepDateLabel}</Text>
                </TouchableOpacity>
              </>
            ) : null}

            <DeliveryDatesCard delivery={d} schedule={schedule} copy={copy} styles={styles} meId={me.id} />

            {!settled ? (
              <>
                <TouchableOpacity style={[styles.btn, late || moved ? styles.btnPrimary : styles.btnOutline]} onPress={() => { void writeMessage(); }} accessibilityRole="button" testID="dfs-write-message">
                  <Text style={late || moved ? styles.btnPrimaryText : styles.btnOutlineText}>{copy.writeToYardLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => onEdit(d)} accessibilityRole="button" testID="dfs-edit-dates">
                  <Text style={styles.btnOutlineText}>{copy.editDatesLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnQuiet]}
                  onPress={() => onUpdate(d.id, ordered ? { orderedOn: undefined } : recordOrdered(d, todayCalendarDay()))}
                  accessibilityRole="button"
                  testID="dfs-ordered"
                >
                  <Text style={styles.btnQuietText}>{ordered ? copy.clearOrderedLabel : copy.markOrderedLabel}</Text>
                </TouchableOpacity>
                {late || moved ? (
                  <TouchableOpacity style={[styles.btn, styles.btnQuiet]} onPress={onClose} accessibilityRole="button" testID="dfs-not-now">
                    <Text style={styles.btnQuietText}>{copy.notNowLabel}</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : null}

            {history.length > 0 ? (
              <View style={styles.card} testID="dfs-history">
                <Text style={styles.sectionLabel}>{copy.dateHistoryLabel}</Text>
                {history.slice().reverse().map((h, i) => (
                  <View key={`${h.at}-${i}`} style={styles.historyRow}>
                    <Text style={styles.historyText}>
                      {h.date ? dayLong(h.date, lang) : copy.noDateYetLabel}. {h.previousDate ? `${copy.wasBody(dayShort(h.previousDate, lang))} ` : ''}
                      {supplierSourceLine(copy, h.source === 'supplier_said'
                        ? { kind: 'supplier_said', note: h.note ?? '', at: h.at, by: h.by ?? '', byName: h.byName ?? '' }
                        : { kind: 'typed', at: h.at, by: h.by ?? '', byName: h.byName ?? '' }, me.id, lang)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.note}>{copy.supplierWordBody}</Text>
            <Text style={styles.note}>{copy.reminderBody}</Text>
            {!settled ? <Text style={styles.note}>{copy.draftOnlyBody}</Text> : null}
            {supplierDate ? null : <Text style={styles.note}>{copy.gapNoDateBody}</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
