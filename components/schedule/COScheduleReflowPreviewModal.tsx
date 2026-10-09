// COScheduleReflowPreviewModal — see the schedule move BEFORE approving.
//
// Approving a change order commits money AND time. The money half was always
// spelled out in a confirm alert; the time half used to be a silent scalar
// bump that never touched a single task date. Now that approval actually
// reflows the Gantt, it gets the same treatment resource leveling already has
// (components/schedule/LevelingPreviewModal.tsx): show which task absorbs the
// days, which tasks shift, what the finish becomes, and which tasks change
// critical status — then let the user apply or back out.
//
// The modal is a pure view over utils/coScheduleReflowCore.ts. It recomputes
// the plan whenever the user picks a different anchor task, and the same
// function produces the write, so what is previewed here IS what gets saved.
//
// Every non-"ready" branch renders the plan's own message rather than a
// generic promise — a CO that cannot move the schedule must say so.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui/Sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, ArrowRight, CalendarClock, Info, Check } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ChangeOrder, ProjectSchedule } from '@/types';
import {
  describeAnchorReason,
  planCoScheduleReflow,
  type CoReflowPlan,
} from '@/utils/coScheduleReflowCore';
import {
  SlideToConfirm,
  fromWriteOutcome,
  type CommitResult,
  type CommitWriteOptions,
  type SlideToConfirmHandle,
} from '@/components/moments/core/contract';
import { useProjectCrossActions, type ChangeOrderFrozenFields } from '@/contexts/ProjectContext';
import { calendarDayToDate } from '@/utils/cpm';
import { formatCalendarDay, parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import { coApprovedTitle, coApprovedUnsignedTitle } from '@/components/moments-sites/COApproveSheet';
import {
  coBusy,
  coFinishMoves,
  coQueued,
  coRefused,
  coSlideLabelWithSchedule,
  coSrConfirm,
  coSrLabel,
  coTimeout,
} from '@/utils/moments/sites/moneyCopy';

/**
 * The new finish as a calendar date ("Nov 14, 2026"), only when the reflow
 * moves it and the schedule has a start date (the engine's day numbers are
 * calendar days from it; a schedule with no start date has no dates to name).
 */
export function reflowFinishDate(schedule: ProjectSchedule | null | undefined, plan: Pick<CoReflowPlan, 'status' | 'finishDeltaDays' | 'finishAfter'>): string | null {
  if (plan.status !== 'ready' || plan.finishDeltaDays === 0) return null;
  const start = parseCalendarDay(schedule?.startDate ?? null);
  if (!start) return null;
  return formatCalendarDay(toCalendarDayString(calendarDayToDate(start, plan.finishAfter)));
}

/** What the approve slide needs from the screen (wave-next W2, lane MOMMONEY, B2). */
export interface ReflowApproveSlide {
  /** The CO's number as the server confirmed it. */
  coNumber: number;
  /** The contract total once this CO is approved, integer cents; null when the signed contract could not be read (the title then names the CO's own amount). */
  contractAfterCents: number | null;
  /** "Client approved without signing": no client signature, and the confirmed words say so. */
  unsigned?: boolean;
  /** #131: the tax frozen onto the CO in the same write as the approval. */
  frozen?: ChangeOrderFrozenFields;
}

export function COScheduleReflowPreviewModal(props: {
  visible: boolean;
  changeOrder: ChangeOrder;
  schedule: ProjectSchedule | null | undefined;
  /** Estimate items (materialId + name) used by the estimate-link anchor tier. */
  estimateItems?: { id: string; name: string }[];
  /** One line about the dollars, e.g. "+$8,400 to the contract". Rendered
   *  above the schedule preview so approve remains one decision, not two. */
  moneyLine?: string;
  /**
   * `approve` (default) — the CO is being approved right now; the money and the
   * dates are one decision.
   * `place`   — the CO is ALREADY approved (typically via the client portal,
   *   where no GC was present to preview anything) and its days were never
   *   placed on a task. Only the schedule half is on the table, and confirming
   *   requires an anchor: there is nothing honest to do without one.
   */
  intent?: 'approve' | 'place';
  /** Called with the anchor the user settled on (undefined = whatever the
   *  rule picked, or nothing when no anchor resolved). The tap path: `place`,
   *  and `approve` when the screen passes no `approveSlide`. */
  onConfirm: (anchorTaskId?: string) => void;
  /**
   * Wave-next W2 (moments, B2): with `intent === 'approve'`, Apply becomes the
   * slide "Slide to approve and shift the schedule · +$4,200.00". The slide
   * approves through ProjectContext.approveChangeOrder(co.id, { anchorTaskId })
   * (the status is written first; the phone shows it only once stored or
   * waiting to send) and closes the modal after the result hold. `place`
   * never slides: no money moves.
   */
  approveSlide?: ReflowApproveSlide;
  onClose: () => void;
}): React.JSX.Element {
  const { changeOrder, schedule, estimateItems, moneyLine, intent = 'approve' } = props;
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [pickedAnchorId, setPickedAnchorId] = useState<string | undefined>(undefined);
  const [showPicker, setShowPicker] = useState(false);

  const plan = useMemo(
    () => planCoScheduleReflow(schedule, changeOrder, {
      anchorTaskId: pickedAnchorId,
      estimateItems,
    }),
    [schedule, changeOrder, pickedAnchorId, estimateItems],
  );

  const isReady = plan.status === 'ready';
  const finishText = plan.finishDeltaDays === 0
    ? 'unchanged'
    : `${plan.finishDeltaDays > 0 ? '+' : ''}${plan.finishDeltaDays} day${Math.abs(plan.finishDeltaDays) === 1 ? '' : 's'}`;

  const dayWord = `${plan.impactDays} day${plan.impactDays === 1 ? '' : 's'}`;
  // The primary button never over-promises: it names exactly what will happen.
  const confirmLabel = intent === 'place'
    ? (isReady ? `Apply ${dayWord}` : 'Pick a Task First')
    : isReady
      ? `Approve and Move ${dayWord}`
      : plan.status === 'no_anchor'
        ? 'Approve Without Moving Dates'
        : `Approve CO #${changeOrder.number}`;
  // In `place` mode there is no money decision left to make, so a confirm that
  // cannot move anything would be a button that does nothing.
  const confirmDisabled = intent === 'place' && !isReady;
  const slide = intent === 'approve' && props.approveSlide ? props.approveSlide : null;
  const slideRef = useRef<SlideToConfirmHandle>(null);
  // The approve slide's write in flight (and a stored answer's hold) holds the
  // modal open: Android back / Esc, the X and Cancel do nothing until the
  // answer is in. The slide closes it after the hold (onDone).
  const [slideBusy, setSlideBusy] = useState(false);
  const { onClose } = props;
  const close = useCallback(() => { if (!slideBusy) onClose(); }, [slideBusy, onClose]);
  // Closed from outside mid-write (the slide unmounted with it): the next open starts free.
  useEffect(() => { if (!props.visible) setSlideBusy(false); }, [props.visible]);
  const anchorForWrite = pickedAnchorId ?? plan.anchorTaskId ?? undefined;

  // Desktop (wave 6c): a centred 720 card. Cmd/Ctrl+Enter confirms when the
  // confirm is enabled; never Cmd+S — approving a change order is a decision
  // with money on it, not a save. All-null on a phone. (Also rendered by
  // project-detail and change-order: the props are unchanged.)
  const frame = useSheetFrame('wide', { visible: props.visible, animationType: 'slide' });
  useSheetPrimaryHotkey(
    props.visible,
    slide
      // The slide: Cmd+Enter plays the 700 ms hold, never an instant approve.
      ? () => slideRef.current?.playHoldToCommit()
      : confirmDisabled ? null : () => props.onConfirm(anchorForWrite),
    { saveKey: false },
  );

  return (
    <Modal
      visible={props.visible}
      transparent
      animationType={frame.animationType}
      onRequestClose={close}
    >
      <View style={[styles.modalBackdrop, frame.overlay]}>
        <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }, frame.card]}>
          {frame.showHandle && <View style={styles.modalHandle} />}
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>
              {intent === 'place'
                ? `CO #${changeOrder.number}: place ${dayWord}`
                : `Approve CO #${changeOrder.number}`}
            </Text>
            <TouchableOpacity
              onPress={close}
              disabled={slideBusy ? true : undefined}
              hitSlop={8}
              style={styles.modalCloseBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={18} color={themeColors.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          {moneyLine ? <Text style={styles.moneyLine}>{moneyLine}</Text> : null}

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* What this does to the schedule — always the plan's own words. */}
            <View style={styles.noticeRow}>
              <Info size={13} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.noticeText}>{plan.message}</Text>
            </View>

            {isReady && (
              <>
                <View style={styles.anchorCard}>
                  <View style={styles.anchorHead}>
                    <CalendarClock size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.anchorLabel}>Absorbs the Added Days</Text>
                  </View>
                  <Text style={styles.anchorTitle} numberOfLines={2}>{plan.anchorTaskTitle}</Text>
                  <Text style={styles.anchorMeta}>
                    {plan.anchorDurationBefore}d to {plan.anchorDurationAfter}d · {describeAnchorReason(plan.anchorReason)}
                  </Text>
                  {plan.candidates.length > 1 && (
                    <TouchableOpacity
                      onPress={() => setShowPicker(v => !v)}
                      style={styles.changeAnchorBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Choose a Different Task"
                    >
                      <Text style={styles.changeAnchorText}>
                        {showPicker ? 'Keep This Task' : 'Choose a Different Task'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.summaryLine}>
                  {plan.shifts.length} task{plan.shifts.length === 1 ? '' : 's'} shift · finish {finishText} · day {plan.finishBefore} → {plan.finishAfter}
                </Text>

                {plan.willCaptureBaseline && (
                  <Text style={styles.baselineNote}>
                    A baseline of today&apos;s dates is captured first, so the original plan stays on record.
                  </Text>
                )}
              </>
            )}

            {/* Task picker — the only way out of `no_anchor`, and an override
                for a rule-picked anchor the user disagrees with. */}
            {(showPicker || plan.status === 'no_anchor') && plan.candidates.length > 0 && (
              <View style={styles.pickerBlock}>
                <Text style={styles.pickerLabel}>Which task absorbs the added days?</Text>
                {plan.candidates.map(c => {
                  const selected = c.id === (pickedAnchorId ?? plan.anchorTaskId);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.candidateRow, selected && styles.candidateRowActive]}
                      onPress={() => { setPickedAnchorId(c.id); setShowPicker(false); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${c.title}`}
                    >
                      <View style={styles.candidateInfo}>
                        <Text style={styles.candidateTitle} numberOfLines={1}>{c.title}</Text>
                        <Text style={styles.candidateMeta}>
                          {c.phase ? `${c.phase} · ` : ''}day {c.startDay} · {c.durationDays}d
                        </Text>
                      </View>
                      {selected && <Check size={15} color={themeColors.accent} strokeWidth={2} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {isReady && plan.shifts.length > 0 && (
              <View style={styles.listBlock}>
                <Text style={styles.pickerLabel}>What Moves</Text>
                {plan.shifts.map(shift => (
                  <View key={shift.id} style={styles.shiftRow}>
                    <Text style={styles.shiftTitle} numberOfLines={1}>{shift.title}</Text>
                    <View style={styles.shiftMeta}>
                      <Text style={styles.shiftDays}>Day {shift.fromDay} → {shift.toDay}</Text>
                      <Text style={styles.shiftDelta}>
                        {shift.deltaDays > 0 ? '+' : ''}{shift.deltaDays}d
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {isReady && (plan.becameCritical.length > 0 || plan.noLongerCritical.length > 0) && (
              <View style={styles.listBlock}>
                <Text style={styles.pickerLabel}>Critical Path Changes</Text>
                {plan.becameCritical.map(t => (
                  <View key={`c-${t.id}`} style={styles.flipRow}>
                    <ArrowRight size={12} color={themeColors.danger} strokeWidth={2} />
                    <Text style={styles.flipText} numberOfLines={1}>
                      <Text style={styles.flipName}>{t.title}</Text> is now critical
                    </Text>
                  </View>
                ))}
                {plan.noLongerCritical.map(t => (
                  <View key={`n-${t.id}`} style={styles.flipRow}>
                    <ArrowRight size={12} color={themeColors.success} strokeWidth={2} />
                    <Text style={styles.flipText} numberOfLines={1}>
                      <Text style={styles.flipName}>{t.title}</Text> is no longer critical
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {slide ? (
            <View style={styles.slideFooter}>
              <ReflowApproveSlideControl
                ref={slideRef}
                changeOrder={changeOrder}
                slide={slide}
                anchorTaskId={anchorForWrite}
                finishDate={reflowFinishDate(schedule, plan)}
                onClose={props.onClose}
                onBusy={setSlideBusy}
              />
              <TouchableOpacity
                onPress={close}
                disabled={slideBusy ? true : undefined}
                style={[styles.slideCancel, styles.btnSecondary]}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="co-reflow-cancel"
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={props.onClose}
              style={[styles.btn, styles.btnSecondary]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => props.onConfirm(pickedAnchorId ?? plan.anchorTaskId ?? undefined)}
              disabled={confirmDisabled}
              style={[styles.btn, styles.btnPrimary, confirmDisabled && styles.btnDisabled]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: confirmDisabled }}
              accessibilityLabel={confirmLabel}
              testID="co-reflow-confirm"
            >
              <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * The approve slide (B2). Its own component so the context hook runs only when
 * a screen asks for the slide (the tap path stays provider-free).
 */
const ReflowApproveSlideControl = React.forwardRef<SlideToConfirmHandle, {
  changeOrder: ChangeOrder;
  slide: ReflowApproveSlide;
  anchorTaskId: string | undefined;
  finishDate: string | null;
  onClose: () => void;
  /** true from release until the answer is in (through a stored answer's hold). */
  onBusy: (busy: boolean) => void;
}>(function ReflowApproveSlideControl({ changeOrder, slide, anchorTaskId, finishDate, onClose, onBusy }, ref) {
  const { approveChangeOrder } = useProjectCrossActions();
  const amountCents = Number.isFinite(changeOrder.changeAmount) ? Math.round(changeOrder.changeAmount * 100) : 0;
  const { coNumber, contractAfterCents, unsigned, frozen } = slide;

  const approveAndShift = useCallback(async (): Promise<CommitResult> => {
    onBusy(true);
    const outcome = await approveChangeOrder(changeOrder.id, { anchorTaskId, ...(frozen ? { frozen } : {}) });
    return fromWriteOutcome(
      outcome,
      {
        title: unsigned ? coApprovedUnsignedTitle(coNumber, amountCents, contractAfterCents) : coApprovedTitle(coNumber, amountCents, contractAfterCents),
        ...(finishDate ? { detail: coFinishMoves(finishDate) } : {}),
      },
      { refused: coRefused(), queued: coQueued() },
    );
  }, [approveChangeOrder, changeOrder.id, anchorTaskId, coNumber, amountCents, contractAfterCents, finishDate, unsigned, frozen, onBusy]);

  // Non-idempotent (plan rule 3): a timeout says "Check CO #4", never "nothing was saved".
  const writeOptions = useMemo<CommitWriteOptions>(() => ({
    idempotent: false,
    copy: { refused: coRefused(), timeout: coTimeout(coNumber) },
  }), [coNumber]);

  // A result that plays a hold (confirmed, or kept on this phone) keeps the modal up until onDone.
  const onResolved = useCallback((r: CommitResult) => {
    if (r.status !== 'confirmed' && r.status !== 'queued') onBusy(false);
  }, [onBusy]);
  // The slide says the result in the toast once the modal is gone (an unsigned one says "unsigned").
  const onDone = useCallback((r: CommitResult) => {
    onBusy(false);
    if (r.status === 'confirmed' || r.status === 'queued') onClose();
  }, [onClose, onBusy]);

  return (
    <SlideToConfirm
      ref={ref}
      label={coSlideLabelWithSchedule(amountCents)}
      busyLabel={coBusy()}
      srLabel={coSrLabel(coNumber, amountCents)}
      srConfirm={coSrConfirm(coNumber)}
      onCommit={approveAndShift}
      writeOptions={writeOptions}
      size="lg"
      tone="brand"
      resultIcon="check"
      onResolved={onResolved}
      onDone={onDone}
      testID="co-reflow-slide"
    />
  );
});

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '90%' as const,
    backgroundColor: t.bg,
    borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl,
    paddingHorizontal: Tokens.spacing.md,
    paddingTop: Tokens.spacing.xs + 2,
    gap: Tokens.spacing.sm,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: Tokens.radius.xs,
    backgroundColor: t.line,
    alignSelf: 'center', marginBottom: Tokens.spacing.xxs,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  moneyLine: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  body: { flexGrow: 0 },

  noticeRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.xxs + 2,
    marginBottom: Tokens.spacing.xs,
  },
  noticeText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },

  anchorCard: {
    padding: Tokens.spacing.sm, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    gap: Tokens.spacing.hairline,
    marginBottom: Tokens.spacing.xs,
  },
  anchorHead: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs + 2 },
  anchorLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, letterSpacing: 0.3 },
  anchorTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.text },
  anchorMeta: { fontSize: Type.caption2.fontSize, color: t.textSecondary },
  changeAnchorBtn: { paddingTop: Tokens.spacing.xxs },
  changeAnchorText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent },

  summaryLine: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
  baselineNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: Tokens.spacing.xxs },

  pickerBlock: { marginTop: Tokens.spacing.xs, gap: Tokens.spacing.xxs },
  pickerLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.4, marginTop: Tokens.spacing.xs, marginBottom: Tokens.spacing.xxs,
  },
  candidateRow: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs,
    padding: Tokens.spacing.sm, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    marginBottom: Tokens.spacing.xxs + 2,
  },
  candidateRowActive: { borderColor: t.accent },
  candidateInfo: { flex: 1 },
  candidateTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  candidateMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },

  listBlock: { marginTop: Tokens.spacing.xxs },
  shiftRow: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    padding: Tokens.spacing.sm, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    marginBottom: Tokens.spacing.xxs + 2,
  },
  shiftTitle: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  shiftMeta: { alignItems: 'flex-end' },
  shiftDays: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  shiftDelta: { fontSize: Type.footnote.fontSize, fontWeight: '900', color: t.accent, letterSpacing: -0.2, marginTop: 2 },

  flipRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs + 2, paddingVertical: Tokens.spacing.xxs },
  flipText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary },
  flipName: { fontWeight: '700', color: t.text },

  footer: { flexDirection: 'row', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
  slideFooter: { gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
  slideCancel: { alignItems: 'center', justifyContent: 'center', paddingVertical: Tokens.spacing.sm, borderRadius: Tokens.radius.card },
  btn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: Tokens.spacing.sm, borderRadius: Tokens.radius.card,
  },
  btnSecondary: {
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
  },
  btnSecondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  btnPrimary: { backgroundColor: t.accentFill },
  btnDisabled: { opacity: 0.4 },
  btnPrimaryText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: Colors.textOnAccent },
});
