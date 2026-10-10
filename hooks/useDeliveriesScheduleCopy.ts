// hooks/useDeliveriesScheduleCopy.ts — every word of Deliveries That Follow The
// Schedule (lane DELIVERIES-1). Every string goes through
// t('office.deliveriesSchedule.*', english, vars) / tn(...), so the i18n
// registry stays in one file (surface 'office.deliveries-schedule', Spanish in
// i18n/catalog/es/office/deliveriesSchedule.ts).
//
// WORDING (docs/VOICE.md): `Label` is a name or an action in Title Case with no
// period. `Body` is one or more whole sentences in sentence case. `Sub` is a
// caption with a capital first letter and no period, or a chip that carries a
// number. No em dashes, no "and" sign, no arrows.
//
// THE HARD RULES OF THIS LANE (scripts/validate-deliveries-schedule.ts reads
// both languages for them):
//   - A date from a supplier is the supplier's word. Nothing here says a
//     delivery "will" arrive, and nothing calls a date a promise except the
//     one line that says it is NOT one.
//   - A supplier date before the day it is needed is said as exactly that.
//     There is no "on time".
//   - The flags are reminders worked out from the dates typed in.
//   - Nothing here says the app moved, sent, told or alerted anything.
//
// Never call t() at module scope: the object is rebuilt when the language changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';

export interface DeliveriesScheduleCopy {
  // ── names of things ──
  ownerPreviewLabel: string;
  neededByLabel: string;
  supplierDateLabel: string;
  orderByLabel: string;
  forTaskLabel: string;
  bufferLabel: string;
  leadTimeLabel: string;
  orderedOnLabel: string;
  noDateYetLabel: string;
  notGivenLabel: string;
  noDateLabel: string;
  taskLabel: string;
  noTaskLabel: string;
  daysLabel: string;
  weeksLabel: string;
  whatLabel: string;
  supplierLabel: string;
  windowLabel: string;
  whoGaveLabel: string;
  supplierSaidLabel: string;
  iTypedItLabel: string;
  howToldLabel: string;
  howToldPlaceholder: string;
  whatPlaceholder: string;
  supplierPlaceholder: string;
  windowPlaceholder: string;
  bufferLessLabel: string;
  bufferMoreLabel: string;
  scoredDateLabel: string;
  noDateGroupLabel: string;
  // ── sections and sheets ──
  followSectionLabel: string;
  deliveriesForTaskLabel: string;
  whatToOrderLabel: string;
  scheduleMovedLabel: string;
  afterNeededLabel: string;
  ifNothingElseLabel: string;
  finishDateLabel: string;
  tasksThatSlideLabel: string;
  deliveryDatesLabel: string;
  expectingLabel: string;
  dateHistoryLabel: string;
  proposalLabel: string;
  holdLabel: string;
  // ── buttons ──
  addForTaskLabel: string;
  addDeliveryLabel: string;
  saveLabel: string;
  closeLabel: string;
  editDatesLabel: string;
  writeToYardLabel: string;
  keepDateLabel: string;
  notNowLabel: string;
  seeOnScheduleLabel: string;
  markOrderedLabel: string;
  clearOrderedLabel: string;
  applyToScheduleLabel: string;
  discardLabel: string;
  seePlansLabel: string;
  openDeliveriesLabel: string;
  confirmLabel: string;
  receivedLabel: string;
  correctScoredLabel: string;
  removeHoldLabel: string;
  // ── the honesty lines ──
  supplierWordBody: string;
  reminderBody: string;
  previewOnlyBody: string;
  draftOnlyBody: string;
  nothingSentBody: string;
  // ── needed on site by: its working ──
  neededBasisBody: (bufferDays: number, task: string) => string;
  neededWhyNoneBody: (why: 'no_task' | 'no_schedule' | 'schedule_undated' | 'task_removed') => string;
  taskStartsBody: (task: string, date: string) => string;
  // ── the supplier date: who said it ──
  notGivenBody: string;
  saidByYouBody: (note: string, date: string) => string;
  saidByNameBody: (note: string, name: string, date: string) => string;
  saidByTeammateBody: (note: string, date: string) => string;
  typedByYouBody: (date: string) => string;
  typedByNameBody: (name: string, date: string) => string;
  typedByTeammateBody: (date: string) => string;
  unrecordedBody: (date: string) => string;
  wasBody: (date: string) => string;
  // ── the date the supplier scorecard counts from, and a correction of it ──
  scoredBasisBody: string;
  scoredNoneBody: string;
  scoredCorrectionBody: string;
  correctedByYouBody: (date: string, when: string) => string;
  correctedByNameBody: (date: string, name: string, when: string) => string;
  correctedByTeammateBody: (date: string, when: string) => string;
  // ── the gap ──
  gapBeforeBody: (workingDays: number) => string;
  gapSameDayBody: string;
  gapAfterBody: (workingDays: number) => string;
  gapNoDateBody: string;
  gapBeforeSub: (workingDays: number) => string;
  gapSameDaySub: string;
  gapAfterSub: (workingDays: number) => string;
  toReviewSub: (count: number) => string;
  // ── flag (a): the schedule moved ──
  slidLaterBody: (task: string, workingDays: number) => string;
  movedUpBody: (task: string, workingDays: number) => string;
  nowEarlyBody: (what: string, workingDays: number) => string;
  nowAfterBody: (what: string, workingDays: number) => string;
  nowSameDayBody: (what: string) => string;
  nowNoDateBody: (what: string) => string;
  startWasNowBody: (was: string, now: string) => string;
  // ── flag (b): the supplier date is after the day it is needed ──
  afterHeadBody: (what: string, supplierDate: string, neededBy: string) => string;
  earliestSub: (date: string) => string;
  earliestWhyBody: string;
  finishLaterBody: (workingDays: number) => string;
  finishHoldsBody: string;
  laterSub: (workingDays: number) => string;
  noneSlideBody: string;
  cannotSayBody: (why: 'cycle' | 'task_pinned' | 'task_started' | 'other', task: string) => string;
  proPlanBody: string;
  widerScreenBody: string;
  // ── order by ──
  orderBasisBody: (leadTimeDays: number) => string;
  orderedBody: (date: string) => string;
  noLeadBody: string;
  orderBySub: (date: string) => string;
  orderPastSub: (date: string, daysAgo: number) => string;
  orderEmptyBody: string;
  // ── forms ──
  bufferHelpSub: string;
  leadHelpSub: string;
  pickTaskBody: string;
  noTasksBody: string;
  taskEmptyBody: string;
  needWhatBody: string;
  // ── the schedule's proposal banner ──
  proposalBody: (task: string, date: string, what: string) => string;
  proposalAppliedBody: string;
  proposalGoneBody: string;
  // ── a hold applied from this delivery, and taking it off ──
  holdBody: (task: string, date: string) => string;
  holdImprovedBody: (supplierDate: string, start: string) => string;
  holdRemovedBody: string;
  /** What the schedule's change log says the change came from. */
  auditAppliedSub: string;
  auditHoldRemovedSub: string;
  // ── the draft message ──
  draft: {
    subject: (what: string) => string;
    hello: (supplier: string) => string;
    about: (what: string) => string;
    po: (po: string) => string;
    yourDate: (date: string) => string;
    noDateFromYou: string;
    neededChanged: (was: string, now: string) => string;
    needed: (date: string) => string;
    askHold: (date: string) => string;
    askEarlier: (date: string) => string;
    askDate: string;
    thanks: string;
  };
  copiedBody: string;
  couldNotOpenBody: string;
}

export function useDeliveriesScheduleCopy(): DeliveriesScheduleCopy {
  const { t, tn } = useT();
  return useMemo<DeliveriesScheduleCopy>(() => ({
    ownerPreviewLabel: t('office.deliveriesSchedule.ownerPreviewLabel', 'Owner Preview'),
    neededByLabel: t('office.deliveriesSchedule.neededByLabel', 'Needed on Site By'),
    supplierDateLabel: t('office.deliveriesSchedule.supplierDateLabel', 'Supplier Date'),
    orderByLabel: t('office.deliveriesSchedule.orderByLabel', 'Order By'),
    forTaskLabel: t('office.deliveriesSchedule.forTaskLabel', 'For Task'),
    bufferLabel: t('office.deliveriesSchedule.bufferLabel', 'Buffer'),
    leadTimeLabel: t('office.deliveriesSchedule.leadTimeLabel', 'Lead Time'),
    orderedOnLabel: t('office.deliveriesSchedule.orderedOnLabel', 'Ordered On'),
    noDateYetLabel: t('office.deliveriesSchedule.noDateYetLabel', 'No Date Yet'),
    notGivenLabel: t('office.deliveriesSchedule.notGivenLabel', 'Not Given'),
    noDateLabel: t('office.deliveriesSchedule.noDateLabel', 'No Date'),
    taskLabel: t('office.deliveriesSchedule.taskLabel', 'Task'),
    noTaskLabel: t('office.deliveriesSchedule.noTaskLabel', 'No Task'),
    daysLabel: t('office.deliveriesSchedule.daysLabel', 'Days'),
    weeksLabel: t('office.deliveriesSchedule.weeksLabel', 'Weeks'),
    whatLabel: t('office.deliveriesSchedule.whatLabel', 'What'),
    supplierLabel: t('office.deliveriesSchedule.supplierLabel', 'Supplier'),
    windowLabel: t('office.deliveriesSchedule.windowLabel', 'Arrival Window'),
    whoGaveLabel: t('office.deliveriesSchedule.whoGaveLabel', 'Who Gave This Date'),
    supplierSaidLabel: t('office.deliveriesSchedule.supplierSaidLabel', 'The Supplier Said So'),
    iTypedItLabel: t('office.deliveriesSchedule.iTypedItLabel', 'Typed by Me'),
    howToldLabel: t('office.deliveriesSchedule.howToldLabel', 'How You Were Told'),
    howToldPlaceholder: t('office.deliveriesSchedule.howToldPlaceholder', 'by phone'),
    whatPlaceholder: t('office.deliveriesSchedule.whatPlaceholder', '14 Windows'),
    supplierPlaceholder: t('office.deliveriesSchedule.supplierPlaceholder', 'Northside Glass'),
    windowPlaceholder: t('office.deliveriesSchedule.windowPlaceholder', '07:00-11:00'),
    bufferLessLabel: t('office.deliveriesSchedule.bufferLessLabel', 'Decrease Buffer'),
    bufferMoreLabel: t('office.deliveriesSchedule.bufferMoreLabel', 'Increase Buffer'),
    scoredDateLabel: t('office.deliveriesSchedule.scoredDateLabel', 'Supplier Scorecard Date'),
    noDateGroupLabel: t('office.deliveriesSchedule.noDateGroupLabel', 'No Date Yet'),

    followSectionLabel: t('office.deliveriesSchedule.followSectionLabel', 'Deliveries and the Schedule'),
    deliveriesForTaskLabel: t('office.deliveriesSchedule.deliveriesForTaskLabel', 'Deliveries for This Task'),
    whatToOrderLabel: t('office.deliveriesSchedule.whatToOrderLabel', 'What to Order This Week'),
    scheduleMovedLabel: t('office.deliveriesSchedule.scheduleMovedLabel', 'The Schedule Moved'),
    afterNeededLabel: t('office.deliveriesSchedule.afterNeededLabel', 'After the Day It Is Needed'),
    ifNothingElseLabel: t('office.deliveriesSchedule.ifNothingElseLabel', 'If Nothing Else Changes'),
    finishDateLabel: t('office.deliveriesSchedule.finishDateLabel', 'Finish Date'),
    tasksThatSlideLabel: t('office.deliveriesSchedule.tasksThatSlideLabel', 'Tasks That Slide'),
    deliveryDatesLabel: t('office.deliveriesSchedule.deliveryDatesLabel', 'Delivery Dates'),
    expectingLabel: t('office.deliveriesSchedule.expectingLabel', 'Expecting a Delivery'),
    dateHistoryLabel: t('office.deliveriesSchedule.dateHistoryLabel', 'Supplier Date History'),
    proposalLabel: t('office.deliveriesSchedule.proposalLabel', 'Proposed from a Delivery'),
    holdLabel: t('office.deliveriesSchedule.holdLabel', 'Hold from This Delivery'),

    addForTaskLabel: t('office.deliveriesSchedule.addForTaskLabel', 'Add a Delivery for This Task'),
    addDeliveryLabel: t('office.deliveriesSchedule.addDeliveryLabel', 'Add Delivery'),
    saveLabel: t('office.deliveriesSchedule.saveLabel', 'Save'),
    closeLabel: t('office.deliveriesSchedule.closeLabel', 'Close'),
    editDatesLabel: t('office.deliveriesSchedule.editDatesLabel', 'Change the Dates'),
    writeToYardLabel: t('office.deliveriesSchedule.writeToYardLabel', 'Write a Message to the Yard'),
    keepDateLabel: t('office.deliveriesSchedule.keepDateLabel', 'Keep the Supplier Date'),
    notNowLabel: t('office.deliveriesSchedule.notNowLabel', 'Not Now'),
    seeOnScheduleLabel: t('office.deliveriesSchedule.seeOnScheduleLabel', 'See It on the Schedule'),
    markOrderedLabel: t('office.deliveriesSchedule.markOrderedLabel', 'Mark Ordered'),
    clearOrderedLabel: t('office.deliveriesSchedule.clearOrderedLabel', 'Not Ordered Yet'),
    applyToScheduleLabel: t('office.deliveriesSchedule.applyToScheduleLabel', 'Apply to the Schedule'),
    discardLabel: t('office.deliveriesSchedule.discardLabel', 'Discard'),
    seePlansLabel: t('office.deliveriesSchedule.seePlansLabel', 'See Plans'),
    openDeliveriesLabel: t('office.deliveriesSchedule.openDeliveriesLabel', 'Open Deliveries'),
    confirmLabel: t('office.deliveriesSchedule.confirmLabel', 'Confirm'),
    receivedLabel: t('office.deliveriesSchedule.receivedLabel', 'Received'),
    correctScoredLabel: t('office.deliveriesSchedule.correctScoredLabel', 'Correct This Date'),
    removeHoldLabel: t('office.deliveriesSchedule.removeHoldLabel', 'Remove the Hold on This Task'),

    supplierWordBody: t('office.deliveriesSchedule.supplierWordBody', 'The supplier date is the supplier\'s word, not a promise from MAGE ID.'),
    reminderBody: t('office.deliveriesSchedule.reminderBody', 'MAGE ID shows what the dates say. It can miss things. Check with your supplier.'),
    previewOnlyBody: t('office.deliveriesSchedule.previewOnlyBody', 'A preview only. Your schedule does not move until you apply it.'),
    draftOnlyBody: t('office.deliveriesSchedule.draftOnlyBody', 'Write a Message opens a draft for you to read and send yourself. MAGE ID sends nothing to a supplier.'),
    nothingSentBody: t('office.deliveriesSchedule.nothingSentBody', 'MAGE ID has sent nothing.'),

    neededBasisBody: (bufferDays, task) => (bufferDays === 0
      ? t('office.deliveriesSchedule.neededBasisZeroBody', 'The day {task} starts. No buffer.', { task })
      : tn('office.deliveriesSchedule.neededBasisBody', bufferDays, { one: '1 working day before {task} starts.', other: '{count} working days before {task} starts.' }, { task })),
    neededWhyNoneBody: (why) => (why === 'no_task'
      ? t('office.deliveriesSchedule.whyNoTaskBody', 'No task is linked, so there is no date to work out.')
      : why === 'schedule_undated'
        ? t('office.deliveriesSchedule.whyUndatedBody', 'The schedule has no start date, so there is no date to work out.')
        : why === 'task_removed'
          ? t('office.deliveriesSchedule.whyTaskRemovedBody', 'The linked task is no longer on the schedule.')
          : t('office.deliveriesSchedule.whyNoScheduleBody', 'This project has no schedule yet.')),
    taskStartsBody: (task, date) => t('office.deliveriesSchedule.taskStartsBody', '{task} starts {date}.', { task, date }),

    notGivenBody: t('office.deliveriesSchedule.notGivenBody', 'Nobody has told MAGE ID a date.'),
    saidByYouBody: (note, date) => (note
      ? t('office.deliveriesSchedule.saidByYouNoteBody', 'Supplier said so {note}. Typed by you, {date}.', { note, date })
      : t('office.deliveriesSchedule.saidByYouBody', 'Supplier said so. Typed by you, {date}.', { date })),
    saidByNameBody: (note, name, date) => (note
      ? t('office.deliveriesSchedule.saidByNameNoteBody', 'Supplier said so {note}. Typed by {name}, {date}.', { note, name, date })
      : t('office.deliveriesSchedule.saidByNameBody', 'Supplier said so. Typed by {name}, {date}.', { name, date })),
    saidByTeammateBody: (note, date) => (note
      ? t('office.deliveriesSchedule.saidByTeammateNoteBody', 'Supplier said so {note}. Typed by a teammate, {date}.', { note, date })
      : t('office.deliveriesSchedule.saidByTeammateBody', 'Supplier said so. Typed by a teammate, {date}.', { date })),
    typedByYouBody: (date) => t('office.deliveriesSchedule.typedByYouBody', 'Typed by you, {date}. No word on who gave it.', { date }),
    typedByNameBody: (name, date) => t('office.deliveriesSchedule.typedByNameBody', 'Typed by {name}, {date}. No word on who gave it.', { name, date }),
    typedByTeammateBody: (date) => t('office.deliveriesSchedule.typedByTeammateBody', 'Typed by a teammate, {date}. No word on who gave it.', { date }),
    unrecordedBody: (date) => t('office.deliveriesSchedule.unrecordedBody', 'Typed {date}. No record of who gave it.', { date }),
    wasBody: (date) => t('office.deliveriesSchedule.wasBody', 'Was {date}.', { date }),

    scoredBasisBody: t('office.deliveriesSchedule.scoredBasisBody', 'The supplier scorecard counts lateness from this date.'),
    scoredNoneBody: t('office.deliveriesSchedule.scoredNoneBody', 'No date is recorded. The supplier scorecard counts from the supplier date.'),
    scoredCorrectionBody: t('office.deliveriesSchedule.scoredCorrectionBody', 'Saving records this correction, and who made it, in the history.'),
    correctedByYouBody: (date, when) => t('office.deliveriesSchedule.correctedByYouBody', 'Scorecard date corrected to {date}. By you, {when}.', { date, when }),
    correctedByNameBody: (date, name, when) => t('office.deliveriesSchedule.correctedByNameBody', 'Scorecard date corrected to {date}. By {name}, {when}.', { date, name, when }),
    correctedByTeammateBody: (date, when) => t('office.deliveriesSchedule.correctedByTeammateBody', 'Scorecard date corrected to {date}. By a teammate, {when}.', { date, when }),

    gapBeforeBody: (n) => tn('office.deliveriesSchedule.gapBeforeBody', n, { one: 'The supplier date is 1 working day before the day it is needed.', other: 'The supplier date is {count} working days before the day it is needed.' }),
    gapSameDayBody: t('office.deliveriesSchedule.gapSameDayBody', 'The supplier date is the day it is needed.'),
    gapAfterBody: (n) => tn('office.deliveriesSchedule.gapAfterBody', n, { one: 'The supplier date is 1 working day after the day it is needed.', other: 'The supplier date is {count} working days after the day it is needed.' }),
    gapNoDateBody: t('office.deliveriesSchedule.gapNoDateBody', 'There is no supplier date to compare with the day it is needed.'),
    gapBeforeSub: (n) => tn('office.deliveriesSchedule.gapBeforeSub', n, { one: '1 working day before', other: '{count} working days before' }),
    gapSameDaySub: t('office.deliveriesSchedule.gapSameDaySub', 'Same day'),
    gapAfterSub: (n) => tn('office.deliveriesSchedule.gapAfterSub', n, { one: '1 working day after', other: '{count} working days after' }),
    toReviewSub: (n) => tn('office.deliveriesSchedule.toReviewSub', n, { one: '1 to review', other: '{count} to review' }),

    slidLaterBody: (task, n) => tn('office.deliveriesSchedule.slidLaterBody', n, { one: '{task} slid 1 working day.', other: '{task} slid {count} working days.' }, { task }),
    movedUpBody: (task, n) => tn('office.deliveriesSchedule.movedUpBody', n, { one: '{task} moved up 1 working day.', other: '{task} moved up {count} working days.' }, { task }),
    nowEarlyBody: (what, n) => tn('office.deliveriesSchedule.nowEarlyBody', n, { one: 'The supplier date for {what} is now 1 working day before the day it is needed.', other: 'The supplier date for {what} is now {count} working days before the day it is needed.' }, { what }),
    nowAfterBody: (what, n) => tn('office.deliveriesSchedule.nowAfterBody', n, { one: '{what} now has a supplier date 1 working day after the day it is needed.', other: '{what} now has a supplier date {count} working days after the day it is needed.' }, { what }),
    nowSameDayBody: (what) => t('office.deliveriesSchedule.nowSameDayBody', '{what} now has its supplier date on the day it is needed.', { what }),
    nowNoDateBody: (what) => t('office.deliveriesSchedule.nowNoDateBody', '{what} has no supplier date yet.', { what }),
    startWasNowBody: (was, now) => t('office.deliveriesSchedule.startWasNowBody', 'The start was {was}. It is now {now}.', { was, now }),

    afterHeadBody: (what, supplierDate, neededBy) => t('office.deliveriesSchedule.afterHeadBody', '{what}: the supplier date is {supplierDate}. It is needed by {neededBy}.', { what, supplierDate, neededBy }),
    earliestSub: (date) => t('office.deliveriesSchedule.earliestSub', '{date} at the earliest', { date }),
    earliestWhyBody: t('office.deliveriesSchedule.earliestWhyBody', 'The earliest start that puts the supplier date on or before the day it is needed.'),
    finishLaterBody: (n) => tn('office.deliveriesSchedule.finishLaterBody', n, { one: '1 working day later. Worked out from your schedule.', other: '{count} working days later. Worked out from your schedule.' }),
    finishHoldsBody: t('office.deliveriesSchedule.finishHoldsBody', 'The finish date does not move. Worked out from your schedule.'),
    laterSub: (n) => tn('office.deliveriesSchedule.laterSub', n, { one: '1 working day later', other: '{count} working days later' }),
    noneSlideBody: t('office.deliveriesSchedule.noneSlideBody', 'No other task moves.'),
    cannotSayBody: (why, task) => (why === 'cycle'
      ? t('office.deliveriesSchedule.cannotCycleBody', 'The schedule has a dependency loop, so MAGE ID cannot work out the effect.')
      : why === 'task_pinned'
        ? t('office.deliveriesSchedule.cannotPinnedBody', '{task} is pinned to a date on the schedule, so MAGE ID cannot work out the effect.', { task })
        : why === 'task_started'
          ? t('office.deliveriesSchedule.cannotStartedBody', '{task} has already started, so there is no start date to move.', { task })
          : t('office.deliveriesSchedule.cannotOtherBody', 'MAGE ID cannot work out the effect from this schedule.')),
    proPlanBody: t('office.deliveriesSchedule.proPlanBody', 'What this does to the job is on the Pro plan.'),
    widerScreenBody: t('office.deliveriesSchedule.widerScreenBody', 'Open Schedule Pro on a wider screen to see this drawn on the schedule and to apply it there.'),

    orderBasisBody: (leadTimeDays) => (leadTimeDays % 7 === 0
      ? tn('office.deliveriesSchedule.orderBasisWeeksBody', leadTimeDays / 7, { one: 'Counted back the 1 week lead time typed on this delivery.', other: 'Counted back the {count} week lead time typed on this delivery.' })
      : tn('office.deliveriesSchedule.orderBasisDaysBody', leadTimeDays, { one: 'Counted back the 1 day lead time typed on this delivery.', other: 'Counted back the {count} day lead time typed on this delivery.' })),
    orderedBody: (date) => t('office.deliveriesSchedule.orderedBody', 'Marked ordered {date}.', { date }),
    noLeadBody: t('office.deliveriesSchedule.noLeadBody', 'No lead time typed, so there is no date.'),
    orderBySub: (date) => t('office.deliveriesSchedule.orderBySub', 'Order by {date}', { date }),
    orderPastSub: (date, daysAgo) => tn('office.deliveriesSchedule.orderPastSub', daysAgo, { one: 'Order by {date}, 1 day ago', other: 'Order by {date}, {count} days ago' }, { date }),
    orderEmptyBody: t('office.deliveriesSchedule.orderEmptyBody', 'Nothing with a typed lead time has an order by date this week.'),

    bufferHelpSub: t('office.deliveriesSchedule.bufferHelpSub', 'Working days before the task starts'),
    leadHelpSub: t('office.deliveriesSchedule.leadHelpSub', 'What the supplier quoted. Leave blank if you do not know'),
    pickTaskBody: t('office.deliveriesSchedule.pickTaskBody', 'Pick the task that needs this delivery.'),
    noTasksBody: t('office.deliveriesSchedule.noTasksBody', 'This project has no schedule tasks to link.'),
    taskEmptyBody: t('office.deliveriesSchedule.taskEmptyBody', 'No deliveries are linked to this task.'),
    needWhatBody: t('office.deliveriesSchedule.needWhatBody', 'Say what is coming and who is sending it.'),

    proposalBody: (task, date, what) => t('office.deliveriesSchedule.proposalBody', '{task} would start no earlier than {date}. That is the earliest start that puts the supplier date for {what} on or before the day it is needed.', { task, date, what }),
    proposalAppliedBody: t('office.deliveriesSchedule.proposalAppliedBody', 'Applied to the schedule. Undo takes it back.'),
    proposalGoneBody: t('office.deliveriesSchedule.proposalGoneBody', 'There is nothing to propose from this delivery now.'),

    holdBody: (task, date) => t('office.deliveriesSchedule.holdBody', '{task} is held to start no earlier than {date}. That hold was applied from this delivery.', { task, date }),
    holdImprovedBody: (supplierDate, start) => t('office.deliveriesSchedule.holdImprovedBody', 'The supplier date is now {supplierDate}. With your buffer, that allows a start as early as {start}.', { supplierDate, start }),
    holdRemovedBody: t('office.deliveriesSchedule.holdRemovedBody', 'The hold is removed. Undo takes it back.'),
    auditAppliedSub: t('office.deliveriesSchedule.auditAppliedSub', 'Applied from a delivery'),
    auditHoldRemovedSub: t('office.deliveriesSchedule.auditHoldRemovedSub', 'Hold removed from a delivery'),

    draft: {
      subject: (what) => t('office.deliveriesSchedule.draftSubject', 'Delivery date: {what}', { what }),
      hello: (supplier) => t('office.deliveriesSchedule.draftHello', 'Hello {supplier},', { supplier }),
      about: (what) => t('office.deliveriesSchedule.draftAbout', 'This is about our order: {what}.', { what }),
      po: (po) => t('office.deliveriesSchedule.draftPo', 'Our PO number is {po}.', { po }),
      yourDate: (date) => t('office.deliveriesSchedule.draftYourDate', 'The delivery date we have from you is {date}.', { date }),
      noDateFromYou: t('office.deliveriesSchedule.draftNoDate', 'We do not have a delivery date from you yet.'),
      neededChanged: (was, now) => t('office.deliveriesSchedule.draftNeededChanged', 'We needed it on site by {was}. We now need it on site by {now}.', { was, now }),
      needed: (date) => t('office.deliveriesSchedule.draftNeeded', 'We need it on site by {date}.', { date }),
      askHold: (date) => t('office.deliveriesSchedule.draftAskHold', 'Can you hold it and deliver on {date} or just before?', { date }),
      askEarlier: (date) => t('office.deliveriesSchedule.draftAskEarlier', 'Can you deliver by {date}? If not, what is the earliest date you can give us?', { date }),
      askDate: t('office.deliveriesSchedule.draftAskDate', 'What delivery date can you give us?'),
      thanks: t('office.deliveriesSchedule.draftThanks', 'Thank you,'),
    },
    copiedBody: t('office.deliveriesSchedule.copiedBody', 'The message is copied. Paste it where you write to the supplier.'),
    couldNotOpenBody: t('office.deliveriesSchedule.couldNotOpenBody', 'Your mail app did not open. The message is copied for you to paste.'),
  }), [t, tn]);
}
