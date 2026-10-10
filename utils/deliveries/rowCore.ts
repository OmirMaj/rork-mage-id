// utils/deliveries/rowCore.ts — the delivery's new columns, to and from the
// server row (lane DELIVERIES-1).
//
// THE MIGRATION MAY NOT BE APPLIED YET. The columns below are added by
// supabase/migrations/20261012090000_deliveries_follow_schedule.sql. A build
// can reach a phone before that file is applied, so two rules hold here:
//
//   1. A delivery that carries NONE of the new fields is written with exactly
//      the columns it was written with before the lane. `deliveryScheduleColumns`
//      returns {} for it, so the row has no key the old table does not have.
//      The offline queue never sees an unknown column from a delivery made the
//      old way, flag on or off, migration applied or not.
//   2. The new fields can only be put on a delivery by the feature's own
//      screens, and those are closed until the device has SEEN the columns
//      (hooks/useDeliveriesFollowSchedule: one read that names them). So a
//      delivery that carries a new field exists only where the columns do.
//
// A field the person CLEARED is written as null (not left out): the row keeps a
// key for every new field the object has as an OWN PROPERTY, even when its
// value is undefined. ProjectContext builds the row from `{ ...old, ...updates }`,
// so `updateDelivery(id, { taskId: undefined })` reaches here with the key
// present and unlinks the task on the server too.
//
// NEEDED ON SITE BY IS NOT A COLUMN and this file has no key for it.
//
// Pure: no React, no storage, no network.
import type { Delivery, DeliveryDateChange } from '@/utils/deliverySchedule';
import { dayOrEmpty } from './calendar';
import { DATE_HISTORY_MAX, readHistory } from './provenance';
import { DELIVERY_SCHEDULE_COLUMNS, type DeliveryScheduleColumn } from './columnsGate';

/** The seven columns the migration adds, in the order it adds them. Defined in columnsGate.ts (a file with no imports, so the sync queue can load it). */
export { DELIVERY_SCHEDULE_COLUMNS, type DeliveryScheduleColumn };

/** The Delivery fields those columns hold, in the same order. */
export const DELIVERY_SCHEDULE_FIELDS = [
  'taskId', 'bufferDays', 'leadTimeDays', 'orderedOn', 'promisedDate', 'dateHistory', 'taskStartSeen',
] as const;
export type DeliveryScheduleField = (typeof DELIVERY_SCHEDULE_FIELDS)[number];

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** True when the delivery object has any of the new fields as an own property (set or cleared). */
export function carriesScheduleFields(d: Partial<Delivery>): boolean {
  return DELIVERY_SCHEDULE_FIELDS.some((f) => own(d, f));
}

function wholeOrNull(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n < min || n > max ? null : n;
}

/**
 * The new columns for a write. {} when the delivery carries none of the new
 * fields: the row is then exactly the row from before the lane.
 */
export function deliveryScheduleColumns(d: Partial<Delivery>): Partial<Record<DeliveryScheduleColumn, unknown>> {
  if (!carriesScheduleFields(d)) return {};
  const history = readHistory({ dateHistory: d.dateHistory });
  return {
    task_id: (d.taskId ?? '').trim().slice(0, 200) || null,
    buffer_days: wholeOrNull(d.bufferDays, 0, 60),
    lead_time_days: wholeOrNull(d.leadTimeDays, 1, 730),
    ordered_on: dayOrEmpty(d.orderedOn) || null,
    promised_date: dayOrEmpty(d.promisedDate) || null,
    date_history: history.length > 0 ? history.slice(-DATE_HISTORY_MAX) : null,
    task_start_seen: dayOrEmpty(d.taskStartSeen) || null,
  };
}

/** The supplier date for a write: the day, or null for "No date yet" (the column takes no empty string). */
export function expectedDateColumn(d: Pick<Delivery, 'expectedDate'>): string | null {
  return d.expectedDate ? d.expectedDate : null;
}

/**
 * The new fields from a server row. A row from a table without the columns
 * (the migration not applied) has none of the keys and gives {}: the delivery
 * is then exactly the object from before the lane.
 */
export function deliveryScheduleFieldsFromRow(r: Record<string, unknown>): Partial<Pick<Delivery, DeliveryScheduleField>> {
  const out: Partial<Pick<Delivery, DeliveryScheduleField>> = {};
  if (typeof r.task_id === 'string' && r.task_id.trim()) out.taskId = r.task_id.trim();
  const buffer = wholeOrNull(r.buffer_days, 0, 60);
  if (buffer !== null) out.bufferDays = buffer;
  const lead = wholeOrNull(r.lead_time_days, 1, 730);
  if (lead !== null) out.leadTimeDays = lead;
  const ordered = dayOrEmpty(typeof r.ordered_on === 'string' ? r.ordered_on : '');
  if (ordered) out.orderedOn = ordered;
  const promised = dayOrEmpty(typeof r.promised_date === 'string' ? r.promised_date : '');
  if (promised) out.promisedDate = promised;
  const history = readHistory({ dateHistory: Array.isArray(r.date_history) ? (r.date_history as DeliveryDateChange[]) : undefined });
  if (history.length > 0) out.dateHistory = history;
  const seen = dayOrEmpty(typeof r.task_start_seen === 'string' ? r.task_start_seen : '');
  if (seen) out.taskStartSeen = seen;
  return out;
}

/** The supplier date from a server row: the day, or '' for "No date yet" (a null column). */
export function expectedDateFromRow(r: Record<string, unknown>): string {
  return typeof r.expected_date === 'string' ? r.expected_date : '';
}

/** True when a server row shows the table HAS the new columns (every one is a key of the row, even when null). */
export function rowHasScheduleColumns(r: Record<string, unknown> | null | undefined): boolean {
  return !!r && DELIVERY_SCHEDULE_COLUMNS.every((c) => own(r, c));
}
