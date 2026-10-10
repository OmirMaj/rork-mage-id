// components/deliveries/DeliveriesFollow.tsx — Deliveries That Follow The
// Schedule on the Deliveries screen, on a task's sheet and on Schedule Pro
// (lane DELIVERIES-1).
//
// THREE DOORS, ONE GATE. Each export asks hooks/useDeliveriesFollowSchedule
// and gives back NOTHING when the gate is closed (the flag is off and this is
// not the owner account, or the table does not have the columns yet). A screen
// that mounts one of these with the gate closed draws exactly what it drew
// before the lane.
//
//   useDeliveriesFollow(projectId)   the Deliveries screen: a block of cards
//                                    for its list, the sheets, and two openers
//   <TaskDeliveriesSection />        the schedule's task sheet
//   <DeliveryProposalBanner />       Schedule Pro, when it is opened from
//                                    "See It on the Schedule"
//
// NOTHING HERE MOVES A TASK. The banner hands the schedule screen a proposal
// to DRAW (its own preview overlay) and calls the schedule screen's own commit
// only from the person's tap on "Apply to the Schedule". Nothing here sends a
// message or raises a notification.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { generateUUID } from '@/utils/generateId';
import { todayCalendarDay } from '@/utils/calendarDate';
import type { ScheduleTask } from '@/types';
import type { RunCpmOptions } from '@/utils/cpm';
import type { SchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';
import type { Delivery } from '@/utils/deliverySchedule';
import { useDeliveriesFollowSchedule } from '@/hooks/useDeliveriesFollowSchedule';
import { useDeliveriesScheduleCopy } from '@/hooks/useDeliveriesScheduleCopy';
import type { ScheduleForDeliveries } from '@/utils/deliveries/neededBy';
import { flagsFor, hasNoSupplierDate, isSettled } from '@/utils/deliveries/flags';
import { whatToOrderThisWeek } from '@/utils/deliveries/orderBy';
import { recordOrdered } from '@/utils/deliveries/provenance';
import { proposedTasks, supplierJobEffect } from '@/utils/deliveries/jobEffect';
import { makeDeliveriesFollowStyles } from './styles';
import { DeliveryDatesCard } from './DeliveryDatesCard';
import { DeliveryEditSheet, type DeliveryEditResult } from './DeliveryEditSheet';
import { DeliveryFollowSheet } from './DeliveryFollowSheet';
import { dayLong, dayShort, movedHeadline } from './words';

export interface DeliveriesFollowApi {
  /** False = the gate is closed: `block` and `sheets` are null and the openers do nothing. */
  on: boolean;
  /** The cards for the top of the Deliveries list. */
  block: React.ReactNode;
  /** The sheets, to mount once beside the screen's own. */
  sheets: React.ReactNode;
  /** Open the form to add a delivery (with the task link). */
  openAdd: () => void;
  /** Open one delivery's dates. */
  openDelivery: (d: Delivery) => void;
  /** The words on the row button that opens a delivery's dates. */
  datesLabel: string;
}

function useMe(): { id: string; name: string } {
  const { user } = useAuth();
  return useMemo(() => ({ id: user?.id ?? '', name: user?.name?.trim() ?? '' }), [user?.id, user?.name]);
}

/** The sheets and their state, shared by the Deliveries screen and the task sheet. */
function useFollowSheets(projectId: string, schedule: ScheduleForDeliveries | null | undefined, canPreviewJobEffect: boolean) {
  const styles = useThemedStyles(makeDeliveriesFollowStyles);
  const copy = useDeliveriesScheduleCopy();
  const me = useMe();
  const { deliveries, addDelivery, updateDelivery } = useProjects();
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; taskId?: string } | null>(null);
  const open = useMemo(() => (openId ? deliveries.find((d) => d.id === openId) ?? null : null), [openId, deliveries]);
  const editing = useMemo(() => (edit?.id ? deliveries.find((d) => d.id === edit.id) ?? null : null), [edit, deliveries]);

  const save = useCallback((r: DeliveryEditResult) => {
    if (editing) {
      updateDelivery(editing.id, { description: r.description, supplier: r.supplier, ...r.fields });
    } else {
      const now = new Date().toISOString();
      addDelivery({
        id: generateUUID(),
        projectId,
        description: r.description,
        supplier: r.supplier,
        // '' = "No date yet". A real state; never counted as before the day it is needed.
        expectedDate: '',
        window: r.window || undefined,
        status: 'scheduled',
        createdAt: now,
        updatedAt: now,
        ...r.fields,
      });
    }
    setEdit(null);
  }, [editing, updateDelivery, addDelivery, projectId]);

  const sheets = (
    <>
      <DeliveryFollowSheet
        delivery={edit ? null : open}
        schedule={schedule}
        projectId={projectId}
        copy={copy}
        styles={styles}
        me={me}
        canPreviewJobEffect={canPreviewJobEffect}
        onClose={() => setOpenId(null)}
        onEdit={(d) => setEdit({ id: d.id })}
        onUpdate={updateDelivery}
      />
      <DeliveryEditSheet
        visible={!!edit}
        delivery={editing}
        presetTaskId={edit?.taskId}
        schedule={schedule}
        copy={copy}
        styles={styles}
        me={me}
        onClose={() => setEdit(null)}
        onSave={save}
      />
    </>
  );
  return { styles, copy, me, sheets, setOpenId, setEdit, updateDelivery };
}

/** The Deliveries screen's door. Call it on every render; it is inert when the gate is closed. */
export function useDeliveriesFollow(projectId: string): DeliveriesFollowApi {
  const gate = useDeliveriesFollowSchedule();
  const { colors: t } = useTheme();
  const { lang } = useT();
  const { projects, deliveries } = useProjects();
  const schedule = useMemo(() => projects.find((p) => p.id === projectId)?.schedule ?? null, [projects, projectId]);
  const { styles, copy, me, sheets, setOpenId, setEdit, updateDelivery } = useFollowSheets(projectId, schedule, gate.canPreviewJobEffect);

  const scoped = useMemo(() => deliveries.filter((d) => d.projectId === projectId), [deliveries, projectId]);
  const model = useMemo(() => {
    if (!gate.on) return null;
    const open = scoped.filter((d) => !isSettled(d));
    const flagged = open.map((d) => ({ d, flags: flagsFor(d, schedule) })).filter((x) => x.flags.length > 0);
    const flaggedIds = new Set(flagged.map((x) => x.d.id));
    // Linked to a task, or with no supplier date: these have something to show that the old rows cannot.
    const cards = open.filter((d) => !flaggedIds.has(d.id) && (!!d.taskId || hasNoSupplierDate(d)));
    const order = whatToOrderThisWeek(open, () => schedule, todayCalendarDay());
    return { flagged, cards, order };
  }, [gate.on, scoped, schedule]);

  const openAdd = useCallback(() => { if (gate.on) setEdit({ id: null }); }, [gate.on, setEdit]);
  const openDelivery = useCallback((d: Delivery) => { if (gate.on) setOpenId(d.id); }, [gate.on, setOpenId]);

  if (!gate.on || !model) return { on: false, block: null, sheets: null, openAdd, openDelivery, datesLabel: copy.deliveryDatesLabel };

  const block = (
    <View style={styles.block} testID="dfs-block">
      <View style={styles.headRow}>
        <Text style={styles.eyebrow}>{copy.followSectionLabel}</Text>
        {model.flagged.length > 0 ? (
          <View style={[styles.chip, styles.chipWarn]} testID="dfs-to-review"><Text style={[styles.chipText, styles.chipWarnText]}>{copy.toReviewSub(model.flagged.length)}</Text></View>
        ) : null}
        {gate.ownerPreview ? <View style={styles.chip} testID="dfs-owner-preview"><Text style={styles.chipText}>{copy.ownerPreviewLabel}</Text></View> : null}
      </View>

      {model.flagged.map(({ d, flags }) => flags.map((f) => (
        <TouchableOpacity key={`${d.id}-${f.kind}`} style={styles.flag} onPress={() => setOpenId(d.id)} accessibilityRole="button" testID={`dfs-flagrow-${f.kind}-${d.id}`}>
          <View style={[styles.flagBar, { backgroundColor: f.kind === 'supplier_after_needed' ? t.dangerLabel : t.warningLabel }]} />
          <View style={styles.flagBody}>
            <Text style={[styles.flagEyebrow, { color: f.kind === 'supplier_after_needed' ? t.dangerLabel : t.warningLabel }]}>
              {f.kind === 'supplier_after_needed' ? copy.afterNeededLabel : copy.scheduleMovedLabel}
            </Text>
            <Text style={styles.flagHead}>
              {f.kind === 'supplier_after_needed'
                ? copy.afterHeadBody(d.description, dayLong(f.supplierDate, lang), dayLong(f.neededBy, lang))
                : movedHeadline(copy, f, d.description)}
            </Text>
            <Text style={styles.flagFoot}>{d.supplier}. {copy.nothingSentBody}</Text>
          </View>
        </TouchableOpacity>
      )))}

      {model.order.rows.length > 0 ? (
        <View style={styles.card} testID="dfs-order-list">
          <Text style={styles.sectionLabel}>{copy.whatToOrderLabel}</Text>
          {model.order.rows.map((row) => (
            <View key={row.delivery.id} style={styles.orderRow} testID={`dfs-order-row-${row.delivery.id}`}>
              <TouchableOpacity style={styles.orderText} onPress={() => setOpenId(row.delivery.id)} accessibilityRole="button">
                <Text style={styles.orderTitle} numberOfLines={1}>{row.delivery.description}, {row.delivery.supplier}</Text>
                <Text style={[styles.orderSub, row.daysLeft < 0 && styles.orderSubPast]}>
                  {row.daysLeft < 0 ? copy.orderPastSub(dayShort(row.orderBy, lang), -row.daysLeft) : copy.orderBySub(dayLong(row.orderBy, lang))}
                </Text>
                <Text style={styles.orderSub}>{copy.orderBasisBody(row.leadTimeDays)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnQuiet, styles.btnSmall]}
                onPress={() => updateDelivery(row.delivery.id, recordOrdered(row.delivery, todayCalendarDay()))}
                accessibilityRole="button"
                testID={`dfs-mark-ordered-${row.delivery.id}`}
              >
                <Text style={styles.btnQuietText}>{copy.markOrderedLabel}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {model.cards.map((d) => (
        <DeliveryDatesCard key={d.id} delivery={d} schedule={schedule} copy={copy} styles={styles} meId={me.id} onPress={(x) => setOpenId(x.id)} />
      ))}

      <Text style={styles.note} testID="dfs-supplier-word">{copy.supplierWordBody}</Text>
      <Text style={styles.note} testID="dfs-reminder">{copy.reminderBody}</Text>
    </View>
  );
  return { on: true, block, sheets, openAdd, openDelivery, datesLabel: copy.deliveryDatesLabel };
}

/** The schedule's task sheet: "Deliveries for This Task". Draws nothing when the gate is closed. */
export function TaskDeliveriesSection({ taskId }: { taskId: string }) {
  const gate = useDeliveriesFollowSchedule();
  const { projects, deliveries } = useProjects();
  const project = useMemo(() => projects.find((p) => (p.schedule?.tasks ?? []).some((x) => x.id === taskId)) ?? null, [projects, taskId]);
  const schedule = project?.schedule ?? null;
  const { styles, copy, me, sheets, setOpenId, setEdit } = useFollowSheets(project?.id ?? '', schedule, gate.canPreviewJobEffect);
  if (!gate.on || !project) return null;
  const mine = deliveries.filter((d) => d.projectId === project.id && d.taskId === taskId && d.status !== 'cancelled');
  return (
    <View style={styles.block} testID="dfs-task-section">
      <View style={styles.headRow}>
        <Text style={styles.eyebrow}>{copy.deliveriesForTaskLabel}</Text>
        {gate.ownerPreview ? <View style={styles.chip}><Text style={styles.chipText}>{copy.ownerPreviewLabel}</Text></View> : null}
      </View>
      {mine.length === 0 ? <Text style={styles.body} testID="dfs-task-empty">{copy.taskEmptyBody}</Text> : null}
      {mine.map((d) => (
        <DeliveryDatesCard key={d.id} delivery={d} schedule={schedule} copy={copy} styles={styles} meId={me.id} showTask={false} onPress={(x) => setOpenId(x.id)} />
      ))}
      <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setEdit({ id: null, taskId })} accessibilityRole="button" testID="dfs-task-add">
        <Text style={styles.btnOutlineText}>{copy.addForTaskLabel}</Text>
      </TouchableOpacity>
      <Text style={styles.note}>{copy.supplierWordBody}</Text>
      {sheets}
    </View>
  );
}

/** What the schedule screen hands the banner: its own task list, its own engine options, its own preview slot and its own commit. */
export interface DeliveryProposalHostProps {
  projectId: string;
  /** The `deliveryId` route param ("See It on the Schedule"). */
  deliveryId: string | undefined;
  schedule: ScheduleForDeliveries | null | undefined;
  /** The tasks the schedule screen is drawing (its working copy). */
  tasks: readonly ScheduleTask[];
  engine?: Omit<RunCpmOptions, 'scheduleStartDate' | 'workingDaysPerWeek' | 'nonWorkingDates'>;
  /** The schedule screen's own "draw a proposed change" slot (the dashed bars and the Finish marker). */
  onPreview: (overlay: SchedulePreviewOverlay | null) => void;
  /** The schedule screen's own undoable commit. Returns a sentence when the seat may not save. */
  commit: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => string | void;
}

/**
 * Schedule Pro, opened from a delivery: draws the proposal on the schedule's
 * own preview and offers Apply and Discard. Draws nothing, and previews
 * nothing, when the gate is closed or no delivery was named.
 */
export function DeliveryProposalBanner({ projectId, deliveryId, schedule, tasks, engine, onPreview, commit }: DeliveryProposalHostProps) {
  const gate = useDeliveriesFollowSchedule();
  const styles = useThemedStyles(makeDeliveriesFollowStyles);
  const copy = useDeliveriesScheduleCopy();
  const { lang } = useT();
  const { deliveries } = useProjects();
  const [closed, setClosed] = useState<'no' | 'discarded' | 'applied'>('no');
  const [refusal, setRefusal] = useState<string | null>(null);
  const active = gate.on && gate.canPreviewJobEffect && !!deliveryId;
  const delivery = useMemo(() => (active ? deliveries.find((d) => d.id === deliveryId && d.projectId === projectId) ?? null : null), [active, deliveries, deliveryId, projectId]);
  const effect = useMemo(() => {
    if (!delivery || !schedule || closed !== 'no') return null;
    return supplierJobEffect(delivery, { ...schedule, tasks }, engine);
  }, [delivery, schedule, tasks, engine, closed]);
  const proposal = effect && effect.kind === 'task_slides' ? effect : null;

  // Hand the overlay to the schedule while the banner is up, and take it back
  // when it goes. Keyed on what the overlay SAYS, so a re-render with the same
  // proposal does not hand the host a "new" one (the loop ScheduleDiffView names).
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  const overlayRef = useRef<SchedulePreviewOverlay | null>(null);
  overlayRef.current = proposal ? proposal.overlay : null;
  const signature = proposal ? JSON.stringify([proposal.overlay.moved, proposal.overlay.finishBefore, proposal.overlay.finishAfter]) : '';
  useEffect(() => {
    if (!signature) return undefined;
    onPreviewRef.current(overlayRef.current);
    return () => { onPreviewRef.current(null); };
  }, [signature]);

  if (!active || !delivery) return null;
  if (closed === 'discarded') return null;
  if (closed === 'applied') {
    return <View style={styles.banner} testID="dfs-proposal-applied"><Text style={styles.body}>{copy.proposalAppliedBody}</Text></View>;
  }
  if (!proposal) {
    return <View style={styles.banner} testID="dfs-proposal-none"><Text style={styles.body}>{copy.proposalGoneBody}</Text></View>;
  }
  const apply = () => {
    // The person's own tap, through the schedule screen's own commit (its Undo takes it back).
    const refused = commit((prev) => proposedTasks(prev, proposal.proposal.taskId, proposal.proposal.notBefore));
    if (typeof refused === 'string') { setRefusal(refused); return; }
    setClosed('applied');
  };
  return (
    <View style={styles.banner} testID="dfs-proposal">
      <Text style={styles.sectionLabel}>{copy.proposalLabel}</Text>
      <Text style={styles.flagHead}>{copy.proposalBody(proposal.taskTitle, dayLong(proposal.proposal.notBefore, lang), delivery.description)}</Text>
      <Text style={styles.body}>{copy.previewOnlyBody}</Text>
      {refusal ? <Text style={styles.body} testID="dfs-proposal-refused">{refusal}</Text> : null}
      <View style={styles.bannerRow}>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary, styles.btnSmall]} onPress={apply} accessibilityRole="button" testID="dfs-proposal-apply">
          <Text style={styles.btnPrimaryText}>{copy.applyToScheduleLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnQuiet, styles.btnSmall]} onPress={() => setClosed('discarded')} accessibilityRole="button" testID="dfs-proposal-discard">
          <Text style={styles.btnQuietText}>{copy.discardLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
