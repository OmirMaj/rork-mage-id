// components/deliveries/words.ts — turns the lane's facts (utils/deliveries/*)
// into the lines the screens print, with the copy hook's words. Kept apart
// from the components so the smoke tests and the validator can read every line
// a date is shown with.
//
// EVERY DATE HAS A LINE THAT SAYS WHERE IT CAME FROM. The three functions that
// make those lines (neededBasisLine, supplierSourceLine, orderBasisLine) never
// return an empty string.
import { calendarDayOf, formatCalendarDay } from '@/utils/calendarDate';
import type { Lang } from '@/i18n/types';
import type { DeliveriesScheduleCopy } from '@/hooks/useDeliveriesScheduleCopy';
import type { NeededBy } from '@/utils/deliveries/neededBy';
import type { SupplierDateSource } from '@/utils/deliveries/provenance';
import type { DeliveryDateChange } from '@/utils/deliverySchedule';
import type { ScheduleMovedFlag, SupplierGap } from '@/utils/deliveries/flags';
import type { JobEffect } from '@/utils/deliveries/jobEffect';

/** "Fri, Nov 13" (a calendar day, local). */
export function dayLong(day: string, lang: Lang): string {
  return formatCalendarDay(day, { weekday: 'short', month: 'short', day: 'numeric' }, lang);
}
/** "Oct 6", from a calendar day or from the local day an instant fell on. */
export function dayShort(value: string, lang: Lang): string {
  const day = calendarDayOf(value) ?? value;
  return formatCalendarDay(day, { month: 'short', day: 'numeric' }, lang);
}

/** The working behind Needed On Site By, or why there is no date. */
export function neededBasisLine(copy: DeliveriesScheduleCopy, needed: NeededBy): string {
  return needed.basis.kind === 'task'
    ? copy.neededBasisBody(needed.basis.bufferDays, needed.basis.taskTitle)
    : copy.neededWhyNoneBody(needed.basis.why);
}

/** Who said the supplier date, and when. */
export function supplierSourceLine(copy: DeliveriesScheduleCopy, src: SupplierDateSource, meId: string | null | undefined, lang: Lang): string {
  if (src.kind === 'not_given') return copy.notGivenBody;
  if (src.kind === 'unrecorded') return copy.unrecordedBody(dayShort(src.at, lang));
  const when = dayShort(src.at, lang);
  const mine = !!meId && src.by === meId;
  if (src.kind === 'supplier_said') {
    if (mine) return copy.saidByYouBody(src.note, when);
    return src.byName ? copy.saidByNameBody(src.note, src.byName, when) : copy.saidByTeammateBody(src.note, when);
  }
  if (mine) return copy.typedByYouBody(when);
  return src.byName ? copy.typedByNameBody(src.byName, when) : copy.typedByTeammateBody(when);
}

/**
 * One line of the supplier date history. A change of the supplier date says
 * the date, what it was, and who said it. A correction of the scorecard date
 * says what it became, what it was, and who made the correction.
 */
export function historyLine(copy: DeliveriesScheduleCopy, h: DeliveryDateChange, meId: string | null | undefined, lang: Lang): string {
  const when = dayShort(h.at, lang);
  if (h.kind === 'promise_corrected') {
    const date = h.promisedDate ? dayLong(h.promisedDate, lang) : copy.noDateLabel;
    const mine = !!meId && h.by === meId;
    const line = mine ? copy.correctedByYouBody(date, when)
      : h.byName ? copy.correctedByNameBody(date, h.byName, when) : copy.correctedByTeammateBody(date, when);
    return h.previousPromisedDate ? `${line} ${copy.wasBody(dayShort(h.previousPromisedDate, lang))}` : line;
  }
  const src: SupplierDateSource = h.source === 'supplier_said'
    ? { kind: 'supplier_said', note: h.note ?? '', at: h.at, by: h.by ?? '', byName: h.byName ?? '' }
    : { kind: 'typed', at: h.at, by: h.by ?? '', byName: h.byName ?? '' };
  const head = `${h.date ? dayLong(h.date, lang) : copy.noDateYetLabel}.`;
  const was = h.previousDate && h.previousDate !== h.date ? ` ${copy.wasBody(dayShort(h.previousDate, lang))}` : '';
  return `${head}${was} ${supplierSourceLine(copy, src, meId, lang)}`;
}

/** The working behind Order By, or why there is no date. */
export function orderBasisLine(copy: DeliveriesScheduleCopy, leadTimeDays: number | null, orderBy: string): string {
  if (leadTimeDays === null || !orderBy) return copy.noLeadBody;
  return copy.orderBasisBody(leadTimeDays);
}

/** The gap as a sentence. Never "on time": only where the supplier date sits against the day it is needed. */
export function gapLine(copy: DeliveriesScheduleCopy, gap: SupplierGap): string {
  switch (gap.kind) {
    case 'before': return copy.gapBeforeBody(gap.workingDays);
    case 'same_day': return copy.gapSameDayBody;
    case 'after': return copy.gapAfterBody(gap.workingDays);
    default: return copy.gapNoDateBody;
  }
}

/** The gap as a chip, and its tone. A delivery with no supplier date says "No Date Yet", never a good tone. */
export function gapChip(copy: DeliveriesScheduleCopy, gap: SupplierGap): { text: string; tone: 'plain' | 'warn' | 'danger' } | null {
  switch (gap.kind) {
    case 'no_date': return { text: copy.noDateYetLabel, tone: 'warn' };
    case 'before': return { text: copy.gapBeforeSub(gap.workingDays), tone: 'plain' };
    case 'same_day': return { text: copy.gapSameDaySub, tone: 'plain' };
    case 'after': return { text: copy.gapAfterSub(gap.workingDays), tone: 'danger' };
    default: return null;
  }
}

/** Flag (a) in two sentences: what the task did, and where that leaves the supplier date. */
export function movedHeadline(copy: DeliveriesScheduleCopy, flag: ScheduleMovedFlag, what: string): string {
  const first = flag.direction === 'later' ? copy.slidLaterBody(flag.taskTitle, flag.workingDays) : copy.movedUpBody(flag.taskTitle, flag.workingDays);
  const g = flag.gap;
  const second = g.kind === 'before' ? copy.nowEarlyBody(what, g.workingDays)
    : g.kind === 'after' ? copy.nowAfterBody(what, g.workingDays)
      : g.kind === 'same_day' ? copy.nowSameDayBody(what)
        : copy.nowNoDateBody(what);
  return `${first} ${second}`;
}

/** Why the job effect cannot be worked out, in words. */
export function cannotSayLine(copy: DeliveriesScheduleCopy, effect: Extract<JobEffect, { kind: 'cannot_say' }>, task: string): string {
  if (effect.why === 'cycle' || effect.why === 'task_pinned' || effect.why === 'task_started') return copy.cannotSayBody(effect.why, task);
  if (effect.why === 'schedule_undated' || effect.why === 'no_task' || effect.why === 'no_schedule' || effect.why === 'task_removed') return copy.neededWhyNoneBody(effect.why);
  return copy.cannotSayBody('other', task);
}
