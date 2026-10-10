// components/deliveries/DeliveryEditSheet.tsx — add a delivery, or change a
// delivery's task, buffer, supplier date and lead time (lane DELIVERIES-1).
//
// WHAT IT SAVES is only what the person typed or picked: the task, the buffer,
// the lead time, the supplier date with who gave it, and the linked task's
// start date as it stood when they pressed Save (so "the schedule moved" has
// something to compare with later). Needed On Site By and Order By are shown
// while typing and are NEVER saved: they are worked out again on every read.
//
// Saving goes through the delivery writers of ProjectContext (the offline
// queue). It moves no task, sends no message and raises no notification.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Check, ChevronLeft, Minus, Plus } from 'lucide-react-native';
import DatePickerModal from '@/components/DatePickerModal';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useSheetFrame } from '@/components/ui';
import { calendarDayOf, parseCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import type { Delivery } from '@/utils/deliverySchedule';
import type { DeliveriesScheduleCopy } from '@/hooks/useDeliveriesScheduleCopy';
import {
  DEFAULT_BUFFER_WORKING_DAYS, MAX_BUFFER_WORKING_DAYS, bufferDaysOf, neededOnSiteBy, scheduleDays, type ScheduleForDeliveries,
} from '@/utils/deliveries/neededBy';
import { leadTimeDaysOf, leadTimeFromInput, leadTimeParts, orderByDate, type LeadTimeUnit } from '@/utils/deliveries/orderBy';
import { NOTE_MAX, recordSupplierDate, supplierDateSource } from '@/utils/deliveries/provenance';
import { dayOrEmpty } from '@/utils/deliveries/calendar';
import { DateRow } from './DeliveryDatesCard';
import { dayLong, neededBasisLine, orderBasisLine } from './words';
import type { DeliveriesFollowStyles } from './styles';

export interface DeliveryEditResult {
  description: string;
  supplier: string;
  window: string;
  /** The new fields to write. A cleared field is present with the value undefined, so the writer nulls its column. */
  fields: Pick<Delivery, 'taskId' | 'bufferDays' | 'leadTimeDays' | 'taskStartSeen'> & Partial<Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate'>>;
}

interface Form {
  description: string;
  supplier: string;
  window: string;
  taskId: string;
  bufferDays: number;
  date: string;
  source: 'supplier_said' | 'typed';
  note: string;
  leadText: string;
  leadUnit: LeadTimeUnit;
}

function formFor(d: Delivery | null, presetTaskId: string | undefined): Form {
  const src = d ? supplierDateSource(d) : null;
  const lead = d ? leadTimeDaysOf(d) : null;
  const parts = lead !== null ? leadTimeParts(lead) : null;
  return {
    description: d?.description ?? '',
    supplier: d?.supplier ?? '',
    window: d?.window ?? '',
    taskId: d?.taskId ?? presetTaskId ?? '',
    bufferDays: d ? bufferDaysOf(d) : DEFAULT_BUFFER_WORKING_DAYS,
    date: d ? dayOrEmpty(d.expectedDate) : '',
    source: src && src.kind === 'typed' ? 'typed' : 'supplier_said',
    note: src && src.kind === 'supplier_said' ? src.note : '',
    leadText: parts ? String(parts.count) : '',
    leadUnit: parts ? parts.unit : 'weeks',
  };
}

export function DeliveryEditSheet({
  visible, delivery, presetTaskId, schedule, copy, styles, me, onClose, onSave,
}: {
  visible: boolean;
  /** The delivery being changed, or null to add one. */
  delivery: Delivery | null;
  /** Adding from a task's sheet: the task is already picked. */
  presetTaskId?: string;
  schedule: ScheduleForDeliveries | null | undefined;
  copy: DeliveriesScheduleCopy;
  styles: DeliveriesFollowStyles;
  me: { id: string; name: string };
  onClose: () => void;
  onSave: (result: DeliveryEditResult) => void;
}) {
  const { colors: t } = useTheme();
  const { lang } = useT();
  const insets = useSafeAreaInsets();
  const frame = useSheetFrame('form', { visible, animationType: 'slide' });
  const [form, setForm] = useState<Form>(() => formFor(delivery, presetTaskId));
  const [pickingDate, setPickingDate] = useState(false);
  const [pickingTask, setPickingTask] = useState(false);
  useEffect(() => {
    if (visible) { setForm(formFor(delivery, presetTaskId)); setPickingTask(false); setPickingDate(false); }
  }, [visible, delivery, presetTaskId]);

  const days = useMemo(() => scheduleDays(schedule), [schedule]);
  const tasks = useMemo(() => (schedule?.tasks ?? []).filter((x) => x && !x.isSummary), [schedule]);
  const pickedTask = tasks.find((x) => x.id === form.taskId) ?? null;
  const needed = neededOnSiteBy({ taskId: form.taskId || undefined, bufferDays: form.bufferDays }, schedule);
  const lead = leadTimeFromInput(form.leadText, form.leadUnit);
  const orderBy = orderByDate(needed.date, lead);
  const valid = form.description.trim().length > 0 && form.supplier.trim().length > 0 && (form.leadText.trim() === '' || lead !== null);
  const set = (patch: Partial<Form>) => setForm((p) => ({ ...p, ...patch }));

  const save = () => {
    if (!valid) return;
    const base: Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate' | 'createdAt'> = delivery
      ?? { expectedDate: '', dateHistory: undefined, promisedDate: undefined, createdAt: '' };
    const dateFields = recordSupplierDate(base, {
      date: form.date, source: form.source, note: form.note, by: me.id, byName: me.name, now: new Date(),
    });
    const start = form.taskId ? days.byTask.get(form.taskId)?.start : undefined;
    onSave({
      description: form.description.trim(),
      supplier: form.supplier.trim(),
      window: form.window.trim(),
      fields: {
        taskId: form.taskId || undefined,
        bufferDays: form.taskId ? form.bufferDays : undefined,
        leadTimeDays: lead ?? undefined,
        // What the person is looking at as they save. A record of what was seen, never a needed-by date.
        taskStartSeen: start || undefined,
        ...(dateFields ?? {}),
      },
    });
  };

  return (
    <Modal visible={visible} transparent animationType={frame.animationType} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.overlay, frame.overlay]}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }, frame.card]} testID="dfs-edit-sheet">
          <View style={styles.sheetHead}>
            <TouchableOpacity onPress={pickingTask ? () => setPickingTask(false) : onClose} style={styles.sheetBack} hitSlop={8} accessibilityRole="button" accessibilityLabel={copy.closeLabel} testID="dfs-edit-close">
              <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
            </TouchableOpacity>
            <Text style={styles.sheetTitle} numberOfLines={1}>{pickingTask ? copy.forTaskLabel : delivery ? copy.deliveryDatesLabel : copy.expectingLabel}</Text>
          </View>

          {pickingTask ? (
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.body}>{tasks.length > 0 ? copy.pickTaskBody : copy.noTasksBody}</Text>
              <TouchableOpacity style={[styles.option, !form.taskId && styles.optionOn]} onPress={() => { set({ taskId: '' }); setPickingTask(false); }} accessibilityRole="button" testID="dfs-task-none">
                <Text style={styles.optionText}>{copy.noTaskLabel}</Text>
              </TouchableOpacity>
              {tasks.map((task) => {
                const start = days.byTask.get(task.id)?.start;
                return (
                  <TouchableOpacity key={task.id} style={[styles.option, form.taskId === task.id && styles.optionOn]} onPress={() => { set({ taskId: task.id }); setPickingTask(false); }} accessibilityRole="button" testID={`dfs-task-${task.id}`}>
                    <Text style={styles.optionText} numberOfLines={1}>{task.title}</Text>
                    {start ? <Text style={styles.optionSub}>{copy.taskStartsBody(task.title, dayLong(start, lang))}</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>{copy.whatLabel}</Text>
              <TextInput style={styles.input} value={form.description} onChangeText={(x) => set({ description: x })} placeholder="14 Windows" placeholderTextColor={t.textMuted} testID="dfs-what" />
              <Text style={styles.fieldLabel}>{copy.supplierLabel}</Text>
              <TextInput style={styles.input} value={form.supplier} onChangeText={(x) => set({ supplier: x })} placeholder="Northside Glass" placeholderTextColor={t.textMuted} testID="dfs-supplier" />

              <Text style={styles.fieldLabel}>{copy.forTaskLabel}</Text>
              <TouchableOpacity style={[styles.input, styles.pick]} onPress={() => setPickingTask(true)} accessibilityRole="button" accessibilityLabel={copy.forTaskLabel} testID="dfs-task-pick">
                <Text style={styles.pickText} numberOfLines={1}>{pickedTask ? pickedTask.title : copy.noTaskLabel}</Text>
              </TouchableOpacity>

              {form.taskId ? (
                <>
                  <Text style={styles.fieldLabel}>{copy.bufferLabel}</Text>
                  <View style={styles.stepper}>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => set({ bufferDays: Math.max(0, form.bufferDays - 1) })} accessibilityRole="button" accessibilityLabel={`${copy.bufferLabel} -1`} testID="dfs-buffer-less">
                      <Minus size={16} color={t.text} strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={styles.stepVal} testID="dfs-buffer">{form.bufferDays}</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => set({ bufferDays: Math.min(MAX_BUFFER_WORKING_DAYS, form.bufferDays + 1) })} accessibilityRole="button" accessibilityLabel={`${copy.bufferLabel} +1`} testID="dfs-buffer-more">
                      <Plus size={16} color={t.text} strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={styles.fieldHint}>{copy.bufferHelpSub}</Text>
                  </View>
                  <DateRow
                    label={copy.neededByLabel}
                    value={needed.date ? dayLong(needed.date, lang) : copy.noDateLabel}
                    basis={neededBasisLine(copy, needed)}
                    styles={styles}
                    testID="dfs-edit-needed"
                  />
                </>
              ) : null}

              <Text style={styles.fieldLabel}>{copy.supplierDateLabel}</Text>
              <View style={styles.optionRow}>
                <TouchableOpacity style={[styles.input, styles.pick, { flex: 1 }]} onPress={() => setPickingDate(true)} accessibilityRole="button" accessibilityLabel={copy.supplierDateLabel} testID="dfs-date">
                  <CalendarDays size={15} color={t.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.pickText}>{form.date ? dayLong(form.date, lang) : copy.noDateYetLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.option, !form.date && styles.optionOn]} onPress={() => set({ date: '' })} accessibilityRole="checkbox" accessibilityState={{ checked: !form.date }} testID="dfs-no-date">
                  <Text style={styles.optionText}>{copy.noDateYetLabel}</Text>
                </TouchableOpacity>
              </View>
              <DatePickerModal
                visible={pickingDate}
                value={parseCalendarDay(form.date || todayCalendarDay())?.toISOString() ?? ''}
                allowFuture
                title={copy.supplierDateLabel}
                onClose={() => setPickingDate(false)}
                onChange={(iso) => { set({ date: calendarDayOf(iso) ?? form.date }); setPickingDate(false); }}
              />
              {form.date ? (
                <>
                  <Text style={styles.fieldLabel}>{copy.whoGaveLabel}</Text>
                  <View style={styles.optionRow}>
                    {(['supplier_said', 'typed'] as const).map((s) => (
                      <TouchableOpacity key={s} style={[styles.option, form.source === s && styles.optionOn]} onPress={() => set({ source: s })} accessibilityRole="radio" accessibilityState={{ selected: form.source === s }} testID={`dfs-source-${s}`}>
                        <View style={styles.pick}>
                          {form.source === s ? <Check size={13} color={t.accentLabel} strokeWidth={2.5} /> : null}
                          <Text style={styles.optionText}>{s === 'supplier_said' ? copy.supplierSaidLabel : copy.iTypedItLabel}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {form.source === 'supplier_said' ? (
                    <>
                      <Text style={styles.fieldLabel}>{copy.howToldLabel}</Text>
                      <TextInput style={styles.input} value={form.note} onChangeText={(x) => set({ note: x.slice(0, NOTE_MAX) })} placeholder={copy.howToldPlaceholder} placeholderTextColor={t.textMuted} maxLength={NOTE_MAX} testID="dfs-note" />
                    </>
                  ) : null}
                </>
              ) : (
                <Text style={styles.fieldHint}>{copy.notGivenBody}</Text>
              )}

              <Text style={styles.fieldLabel}>{copy.leadTimeLabel}</Text>
              <View style={styles.inputRow}>
                <TextInput style={[styles.input, styles.inputNarrow]} value={form.leadText} onChangeText={(x) => set({ leadText: x.replace(/[^0-9]/g, '').slice(0, 3) })} keyboardType="number-pad" placeholder="" testID="dfs-lead" accessibilityLabel={copy.leadTimeLabel} />
                {(['days', 'weeks'] as const).map((u) => (
                  <TouchableOpacity key={u} style={[styles.option, form.leadUnit === u && styles.optionOn]} onPress={() => set({ leadUnit: u })} accessibilityRole="radio" accessibilityState={{ selected: form.leadUnit === u }} testID={`dfs-lead-${u}`}>
                    <Text style={styles.optionText}>{u === 'days' ? copy.daysLabel : copy.weeksLabel}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.fieldHint}>{copy.leadHelpSub}</Text>
              {form.taskId && lead !== null ? (
                <DateRow
                  label={copy.orderByLabel}
                  value={orderBy ? dayLong(orderBy, lang) : copy.noDateLabel}
                  basis={orderBasisLine(copy, lead, orderBy)}
                  styles={styles}
                  testID="dfs-edit-order"
                />
              ) : null}

              {!delivery ? (
                <>
                  <Text style={styles.fieldLabel}>{copy.windowLabel}</Text>
                  <TextInput style={styles.input} value={form.window} onChangeText={(x) => set({ window: x })} placeholder="07:00-11:00" placeholderTextColor={t.textMuted} testID="dfs-window" />
                </>
              ) : null}

              {!valid ? <Text style={styles.fieldHint} testID="dfs-edit-blocked">{copy.needWhatBody}</Text> : null}
              <TouchableOpacity style={[styles.btn, styles.btnPrimary, !valid && styles.btnOff]} onPress={save} disabled={!valid} accessibilityRole="button" accessibilityState={{ disabled: !valid }} testID="dfs-edit-save">
                <Text style={styles.btnPrimaryText}>{delivery ? copy.saveLabel : copy.addDeliveryLabel}</Text>
              </TouchableOpacity>
              <Text style={styles.note}>{copy.supplierWordBody}</Text>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
