// utils/deliveries/columnsGate.ts — "does the deliveries table have the seven
// columns", as this device knows it right now, and what to do when a write
// proves the answer wrong (lane DELIVERIES-1).
//
// THE ANSWER IS NOT TRUSTED FOR EVER. The device remembers that it once SAW
// the columns (DELIVERY_COLUMNS_SEEN_KEY) so the feature works with no signal.
// But a remembered "seen" can go stale: the columns can be taken off again
// (the migration's UNDO), or the app can be pointed at another database. The
// proof is a WRITE that comes back "there is no such column" for one of the
// seven. When that happens the write path (the one caller of
// rewriteForMissingColumns: the sync queue) does three things, in this order:
//   1. forgets the remembered answer (the stored key is removed by the caller,
//      and `markColumnsMissing` here closes the feature on every open screen);
//   2. the gate hook asks the table again (it is re-probed, not assumed);
//   3. the write is sent again with ONLY the columns the table had before the
//      lane, so it lands and nothing behind it in the queue waits on it. The
//      delivery keeps its new fields on the device; they are written again the
//      next time it is saved with the feature open.
// A queue entry that names a missing column and is re-sent unchanged would
// fail the same way every time: that is the wedge this file removes.
//
// Pure: no React, no storage, no network, and NO IMPORTS AT ALL: the sync
// queue loads this file, and must not pull the schedule engine in behind it.
// The stored key is read and written by hooks/useDeliveriesFollowSchedule and
// removed by the sync queue.

/** The seven columns the migration adds, in the order it adds them. (utils/deliveries/rowCore re-exports this and maps them.) */
export const DELIVERY_SCHEDULE_COLUMNS = [
  'task_id', 'buffer_days', 'lead_time_days', 'ordered_on', 'promised_date', 'date_history', 'task_start_seen',
] as const;
export type DeliveryScheduleColumn = (typeof DELIVERY_SCHEDULE_COLUMNS)[number];

/** "This device has seen the delivery columns." A fact about the table, not about a person or a job. */
export const DELIVERY_COLUMNS_SEEN_KEY = 'mageid_deliveries_fs_columns_seen';

/**
 * What this device knows about the columns:
 *   unknown  the remembered answer has not been read yet (nothing is drawn on it)
 *   seen     the table has them (remembered, or just asked)
 *   unseen   nothing remembered: the table has to be asked
 */
export type ColumnsAnswer = 'unknown' | 'seen' | 'unseen';

let answer: ColumnsAnswer = 'unknown';
/** Goes up each time a write proves a remembered "seen" wrong: the gate hook asks the table again. */
let epoch = 0;
const listeners = new Set<() => void>();
const tell = () => { for (const l of [...listeners]) l(); };

export function columnsAnswer(): ColumnsAnswer { return answer; }
export function columnsEpoch(): number { return epoch; }
export function subscribeColumns(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setColumnsAnswer(next: ColumnsAnswer): void {
  if (answer === next) return;
  answer = next;
  tell();
}
/** A write named a column the table does not have: close the feature and have the table asked again. */
export function markColumnsMissing(): void {
  answer = 'unseen';
  epoch++;
  tell();
}

/** True when a server message names one of the seven columns. */
export function namesScheduleColumn(message: string): boolean {
  return DELIVERY_SCHEDULE_COLUMNS.some((c) => new RegExp(`(^|[^a-z_])${c}([^a-z_]|$)`).test(message));
}

/** A row with the seven columns taken out: the row from before the lane. A copy. */
export function withoutScheduleColumns(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!(DELIVERY_SCHEDULE_COLUMNS as readonly string[]).includes(k)) out[k] = v;
  return out;
}

/**
 * The row to send INSTEAD, when a write of a delivery was refused because the
 * table lacks one of the seven columns (PostgREST PGRST204 "could not find the
 * column in the schema cache", or Postgres 42703 "column does not exist"), and
 * the row carries any of them. Null for every other table, every other error,
 * and a row that carries none of them (nothing to take out: not this lane's
 * failure). Calling it also closes the feature (markColumnsMissing).
 */
export function rewriteForMissingColumns(
  table: string,
  data: Record<string, unknown> | null | undefined,
  message: string,
  code: string | null | undefined,
): Record<string, unknown> | null {
  if (table !== 'deliveries' || !data) return null;
  const m = (message ?? '').toLowerCase();
  const missingColumn = code === 'PGRST204' || code === '42703' || m.includes('pgrst204') || m.includes('schema cache') || (m.includes('column') && m.includes('does not exist'));
  if (!missingColumn || !namesScheduleColumn(m)) return null;
  if (!DELIVERY_SCHEDULE_COLUMNS.some((c) => Object.prototype.hasOwnProperty.call(data, c))) return null;
  markColumnsMissing();
  return withoutScheduleColumns(data);
}
