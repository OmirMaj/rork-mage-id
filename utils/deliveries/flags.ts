// utils/deliveries/flags.ts — the two flags, as plain facts computed from the
// dates (lane DELIVERIES-1, Deliveries That Follow The Schedule).
//
//   (a) THE SCHEDULE MOVED. The linked task starts on a different day than the
//       day the person last looked at (Delivery.taskStartSeen). The flag says
//       how many working days the task moved, and where the supplier's date
//       now sits against Needed On Site By.
//   (b) THE SUPPLIER'S DATE IS AFTER NEEDED ON SITE BY. What that does to the
//       job is utils/deliveries/jobEffect.ts.
//
// WHAT THESE ARE NOT. They are not predictions and not promises. A supplier
// date before the day it is needed is reported as exactly that ("before the day
// it is needed", with the working days between); nothing here has a state
// called on time, and a delivery with NO supplier date is its own state
// ('no_date') that is never counted as before.
//
// Nothing here writes anything, moves a task or contacts anyone. The flag for
// (a) clears only when the PERSON records that they have looked (a write of
// taskStartSeen through the delivery's own save).
//
// Pure: no React, no storage, no network, no clock.
import type { Delivery } from '@/utils/deliverySchedule';
import { compareDays, dayOrEmpty, workingDaysFromTo, type WorkCalendar } from './calendar';
import { neededByForStart, neededOnSiteBy, type NeededBy, type ScheduleForDeliveries } from './neededBy';

/** Where the supplier's date sits against Needed On Site By. */
export type SupplierGap =
  /** Nobody has told MAGE ID a supplier date. Never treated as before the day it is needed. */
  | { kind: 'no_date' }
  /** There is no Needed On Site By to compare with (no task, no start date). */
  | { kind: 'no_needed_by' }
  /** The supplier's date is before the day it is needed, by this many working days (1 or more). */
  | { kind: 'before'; workingDays: number }
  /** The supplier's date is the day it is needed. */
  | { kind: 'same_day' }
  /** The supplier's date is after the day it is needed, by this many working days (1 or more). */
  | { kind: 'after'; workingDays: number };

/** A delivery that is settled: it arrived or was cancelled. Settled deliveries raise no flag. */
export function isSettled(d: Pick<Delivery, 'status'>): boolean {
  return d.status === 'delivered' || d.status === 'cancelled';
}

/** True when the delivery has no supplier date: "No date yet". */
export function hasNoSupplierDate(d: Pick<Delivery, 'expectedDate'>): boolean {
  return dayOrEmpty(d.expectedDate) === '';
}

export function supplierGap(
  delivery: Pick<Delivery, 'expectedDate'>,
  needed: Pick<NeededBy, 'date'>,
  calendar: WorkCalendar,
): SupplierGap {
  const supplier = dayOrEmpty(delivery.expectedDate);
  if (!supplier) return { kind: 'no_date' };
  if (!needed.date) return { kind: 'no_needed_by' };
  const order = compareDays(supplier, needed.date);
  if (order === null) return { kind: 'no_needed_by' };
  if (order === 0) return { kind: 'same_day' };
  // A supplier date on a closed day still counts as a different day: at least 1.
  const gap = Math.max(1, Math.abs(workingDaysFromTo(supplier, needed.date, calendar) ?? 0));
  return order < 0 ? { kind: 'before', workingDays: gap } : { kind: 'after', workingDays: gap };
}

/** Flag (a): the linked task's start is not the one the person last looked at. */
export interface ScheduleMovedFlag {
  kind: 'schedule_moved';
  taskId: string;
  taskTitle: string;
  /** 'later' = the task slid; 'earlier' = it was pulled in. */
  direction: 'later' | 'earlier';
  /** Working days between the two starts (1 or more). */
  workingDays: number;
  taskStartWas: string;
  taskStartNow: string;
  /** What Needed On Site By was for the old start, WORKED OUT here from it. Not read from storage. */
  neededByWas: string;
  neededByNow: string;
  /** Where the supplier's date sits now. */
  gap: SupplierGap;
}

/** Flag (b): the supplier's date is after Needed On Site By. */
export interface SupplierLateFlag {
  kind: 'supplier_after_needed';
  taskId: string;
  taskTitle: string;
  supplierDate: string;
  neededBy: string;
  /** Working days the supplier's date is after the day it is needed (1 or more). */
  workingDays: number;
}

export type DeliveryFlagFact = ScheduleMovedFlag | SupplierLateFlag;

export function scheduleMovedFlag(
  delivery: Pick<Delivery, 'status' | 'taskId' | 'bufferDays' | 'expectedDate' | 'taskStartSeen'>,
  schedule: ScheduleForDeliveries | null | undefined,
): ScheduleMovedFlag | null {
  if (isSettled(delivery)) return null;
  const needed = neededOnSiteBy(delivery, schedule);
  if (needed.basis.kind !== 'task' || !schedule) return null;
  const seen = dayOrEmpty(delivery.taskStartSeen);
  // Nothing seen yet (the first link records it): no move to report.
  if (!seen) return null;
  const now = needed.basis.taskStart;
  const order = compareDays(seen, now);
  if (order === null || order === 0) return null;
  const moved = Math.max(1, Math.abs(workingDaysFromTo(seen, now, schedule) ?? 0));
  return {
    kind: 'schedule_moved',
    taskId: needed.basis.taskId,
    taskTitle: needed.basis.taskTitle,
    direction: order < 0 ? 'later' : 'earlier',
    workingDays: moved,
    taskStartWas: seen,
    taskStartNow: now,
    neededByWas: neededByForStart(delivery, seen, schedule),
    neededByNow: needed.date,
    gap: supplierGap(delivery, needed, schedule),
  };
}

export function supplierLateFlag(
  delivery: Pick<Delivery, 'status' | 'taskId' | 'bufferDays' | 'expectedDate'>,
  schedule: ScheduleForDeliveries | null | undefined,
): SupplierLateFlag | null {
  if (isSettled(delivery)) return null;
  const needed = neededOnSiteBy(delivery, schedule);
  if (needed.basis.kind !== 'task' || !schedule) return null;
  const gap = supplierGap(delivery, needed, schedule);
  if (gap.kind !== 'after') return null;
  return {
    kind: 'supplier_after_needed',
    taskId: needed.basis.taskId,
    taskTitle: needed.basis.taskTitle,
    supplierDate: dayOrEmpty(delivery.expectedDate),
    neededBy: needed.date,
    workingDays: gap.workingDays,
  };
}

/** Both flags for one delivery, the supplier one first (it is the one that can move the job). */
export function flagsFor(
  delivery: Pick<Delivery, 'status' | 'taskId' | 'bufferDays' | 'expectedDate' | 'taskStartSeen'>,
  schedule: ScheduleForDeliveries | null | undefined,
): DeliveryFlagFact[] {
  const out: DeliveryFlagFact[] = [];
  const late = supplierLateFlag(delivery, schedule);
  if (late) out.push(late);
  const moved = scheduleMovedFlag(delivery, schedule);
  if (moved) out.push(moved);
  return out;
}

/** How many of these deliveries carry at least one flag: the "To Review" count. */
export function toReviewCount(
  deliveries: readonly Pick<Delivery, 'status' | 'taskId' | 'bufferDays' | 'expectedDate' | 'taskStartSeen' | 'projectId'>[],
  scheduleFor: (projectId: string) => ScheduleForDeliveries | null | undefined,
): number {
  let n = 0;
  for (const d of deliveries) if (flagsFor(d, scheduleFor(d.projectId)).length > 0) n++;
  return n;
}
