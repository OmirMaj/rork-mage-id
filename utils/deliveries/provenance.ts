// utils/deliveries/provenance.ts — who said each date, and when; and the short
// history of supplier date changes (lane DELIVERIES-1).
//
// EVERY DATE CARRIES ITS SOURCE. This file returns the source as DATA (a small
// tagged value); hooks/useDeliveriesScheduleCopy turns it into the words, in
// English and Spanish. The three sources of a supplier date:
//
//   supplier_said  the supplier gave the date and a person typed it in
//                  ("Supplier said so by phone. Typed by you, Oct 6.")
//   typed          a person typed it, with no word on where it came from
//   not_given      nobody has told MAGE ID a date
//
// plus `unrecorded` for a date typed before this lane: there is a date and no
// record of who gave it, and the label says exactly that.
//
// THE HISTORY is on the delivery (Delivery.dateHistory), oldest first: the
// date, the date before it, when it was recorded, the source and the typed
// note of how they were told. It is capped (DATE_HISTORY_MAX entries, each
// note NOTE_MAX characters) so one delivery can never grow without limit; the
// column has the matching check.
//
// THE ORIGINAL PROMISED DATE (Delivery.promisedDate) is set in exactly three
// ways, and by nothing else:
//   1. recordSupplierDate: the first date recorded with the source
//      'supplier_said', when the delivery has no promise yet. A date that was
//      only typed, and a date from before the lane (no record of who gave it),
//      NEVER becomes the promise: nobody said the supplier gave it.
//   2. recordOrdered: marking it ordered, when the delivery has no promise
//      yet, sets it to the supplier date standing at that moment.
//   3. correctPromisedDate: a person corrects it by hand from the dates form.
//      The correction is one more history entry (kind 'promise_corrected':
//      the date it became, the date it was, when, and who).
// A later change of the supplier date never moves it. The table holds the same
// line (the trigger in 20261012090000_deliveries_follow_schedule.sql): a write
// that changes a recorded promise without a correction entry leaves the
// promise as it was.
//
// Pure: no React, no storage, no network. `now` is handed in.
import type { Delivery, DeliveryDateChange } from '@/utils/deliverySchedule';
import { dayOrEmpty } from './calendar';

/** The most changes kept on one delivery. The oldest go first. */
export const DATE_HISTORY_MAX = 20;
/** The longest typed note of how they were told. */
export const NOTE_MAX = 140;

export type SupplierDateSource =
  | { kind: 'not_given' }
  | { kind: 'supplier_said'; note: string; at: string; by: string; byName: string }
  | { kind: 'typed'; at: string; by: string; byName: string }
  /** A date with no record of who gave it (typed before dates carried a source). `at` is when the delivery was made. */
  | { kind: 'unrecorded'; at: string };

function cleanNote(note: string | null | undefined): string {
  return (note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
}

/** True for a history entry that corrected the promised date (the supplier date did not change). */
export function isPromiseCorrection(e: Pick<DeliveryDateChange, 'kind'>): boolean {
  return e.kind === 'promise_corrected';
}

/** A stored history, made safe to read: an array of well-formed entries, oldest first, at most the cap. */
export function readHistory(delivery: Pick<Delivery, 'dateHistory'>): DeliveryDateChange[] {
  const raw = delivery.dateHistory;
  if (!Array.isArray(raw)) return [];
  const out: DeliveryDateChange[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const at = typeof e.at === 'string' ? e.at : '';
    if (!at) continue;
    const correction = e.kind === 'promise_corrected';
    out.push({
      date: dayOrEmpty(e.date),
      previousDate: dayOrEmpty(e.previousDate),
      at,
      source: e.source === 'supplier_said' ? 'supplier_said' : 'typed',
      ...(cleanNote(e.note) ? { note: cleanNote(e.note) } : {}),
      ...(typeof e.by === 'string' && e.by ? { by: e.by } : {}),
      ...(typeof e.byName === 'string' && e.byName.trim() ? { byName: e.byName.trim().slice(0, 80) } : {}),
      ...(correction ? { kind: 'promise_corrected' as const, promisedDate: dayOrEmpty(e.promisedDate), previousPromisedDate: dayOrEmpty(e.previousPromisedDate) } : {}),
    });
  }
  return out.slice(-DATE_HISTORY_MAX);
}

/** Who said the delivery's CURRENT supplier date. */
export function supplierDateSource(delivery: Pick<Delivery, 'expectedDate' | 'dateHistory' | 'createdAt'>): SupplierDateSource {
  const current = dayOrEmpty(delivery.expectedDate);
  if (!current) return { kind: 'not_given' };
  const history = readHistory(delivery);
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    // A correction of the promised date says nothing about who gave the supplier date.
    if (isPromiseCorrection(e) || e.date !== current) continue;
    return e.source === 'supplier_said'
      ? { kind: 'supplier_said', note: e.note ?? '', at: e.at, by: e.by ?? '', byName: e.byName ?? '' }
      : { kind: 'typed', at: e.at, by: e.by ?? '', byName: e.byName ?? '' };
  }
  return { kind: 'unrecorded', at: delivery.createdAt ?? '' };
}

/** The supplier date before the current one, when the history has one and it differs: "was Nov 12". '' otherwise. */
export function previousSupplierDate(delivery: Pick<Delivery, 'expectedDate' | 'dateHistory'>): string {
  const current = dayOrEmpty(delivery.expectedDate);
  const history = readHistory(delivery);
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (isPromiseCorrection(e)) continue;
    if (e.date === current && e.previousDate && e.previousDate !== current) return e.previousDate;
    if (e.date === current) return '';
  }
  return '';
}

export interface DateChangeInput {
  /** The new supplier date ('YYYY-MM-DD'), or '' for "no date yet". */
  date: string;
  source: 'supplier_said' | 'typed';
  note?: string;
  by?: string;
  byName?: string;
  /** When it is being recorded. */
  now: Date;
}

/**
 * The fields to save when the supplier date is recorded or changed: the date,
 * one more history entry, and the ORIGINAL promised date when this is the
 * first date the SUPPLIER is recorded as having given. An unchanged date with
 * an unchanged source records nothing (null).
 *
 * `promisedDate` is set here only from a 'supplier_said' date, and only when
 * the delivery has none. The date standing before (typed, or with no record of
 * who gave it) is never promoted to it, and a typed date never is. A later
 * change never moves it, which is what stops an edit from erasing a slip.
 */
export function recordSupplierDate(
  delivery: Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate' | 'createdAt'>,
  input: DateChangeInput,
): Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate'> | null {
  const next = dayOrEmpty(input.date);
  const previous = dayOrEmpty(delivery.expectedDate);
  const was = supplierDateSource(delivery);
  const note = cleanNote(input.note);
  const sameSource = was.kind === input.source && (was.kind !== 'supplier_said' || was.note === note);
  if (next === previous && (next === '' || sameSource)) return null;
  const entry: DeliveryDateChange = {
    date: next,
    previousDate: previous,
    at: input.now.toISOString(),
    source: input.source,
    ...(input.source === 'supplier_said' && note ? { note } : {}),
    ...(input.by ? { by: input.by } : {}),
    ...(input.byName && input.byName.trim() ? { byName: input.byName.trim().slice(0, 80) } : {}),
  };
  const dateHistory = [...readHistory(delivery), entry].slice(-DATE_HISTORY_MAX);
  // THE PROMISE: the one already recorded, else THIS date when the supplier is
  // recorded as having said it. Never `previous`, never a typed date.
  const promisedDate = dayOrEmpty(delivery.promisedDate) || (input.source === 'supplier_said' ? next : '');
  return { expectedDate: next, dateHistory, ...(promisedDate ? { promisedDate } : {}) };
}

/** What the dates form holds for the supplier date. 'unrecorded' = a date with no record of who gave it, left as it is. */
export type FormDateSource = 'supplier_said' | 'typed' | 'unrecorded';

/** The form's starting source for a delivery: what the record says, and 'typed' for a date not yet given (the person is about to type one). */
export function formSourceFor(delivery: Pick<Delivery, 'expectedDate' | 'dateHistory' | 'createdAt'> | null): FormDateSource {
  const src = delivery ? supplierDateSource(delivery) : null;
  if (!src || src.kind === 'not_given') return 'typed';
  return src.kind;
}

/**
 * The supplier-date fields the dates form saves, or null for "record nothing".
 *
 * A date with no record of who gave it STAYS unrecorded when the form is saved
 * for another reason (linking a task, a buffer, a lead time): nothing is
 * written about it, so the history never claims a source nobody gave. It gets
 * a history entry only when the person changes the date (recorded as 'typed':
 * they typed it, with no word on who gave it) or picks a source themselves.
 */
export function recordFromForm(
  delivery: Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate' | 'createdAt'> | null,
  form: { date: string; source: FormDateSource; note?: string },
  who: { by?: string; byName?: string; now: Date },
): Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate'> | null {
  const base = delivery ?? { expectedDate: '', dateHistory: undefined, promisedDate: undefined, createdAt: '' };
  const changed = dayOrEmpty(form.date) !== dayOrEmpty(base.expectedDate);
  if (form.source === 'unrecorded' && !changed) return null;
  const source = form.source === 'unrecorded' ? 'typed' : form.source;
  return recordSupplierDate(base, { date: form.date, source, note: form.note, by: who.by, byName: who.byName, now: who.now });
}

/** The fields to save when the person marks it ordered: the day, and (only when no promise is recorded yet) the supplier date standing now as the promise. */
export function recordOrdered(
  delivery: Pick<Delivery, 'expectedDate' | 'promisedDate'>,
  orderedOn: string,
): Pick<Delivery, 'orderedOn' | 'promisedDate'> {
  const promisedDate = dayOrEmpty(delivery.promisedDate) || dayOrEmpty(delivery.expectedDate);
  return { orderedOn: dayOrEmpty(orderedOn), ...(promisedDate ? { promisedDate } : {}) };
}

/**
 * The fields to save when a person CORRECTS the original promised date by
 * hand: the new promise and one history entry that records the correction
 * (what it became, what it was, when, and who). The supplier date is not
 * touched. Null when the date is unreadable or is already the promise. To keep
 * a supplier-date change made in the same save, hand in the delivery with that
 * change already merged.
 */
export function correctPromisedDate(
  delivery: Pick<Delivery, 'expectedDate' | 'dateHistory' | 'promisedDate'>,
  input: { date: string; by?: string; byName?: string; now: Date },
): Pick<Delivery, 'promisedDate' | 'dateHistory'> | null {
  const next = dayOrEmpty(input.date);
  const previous = dayOrEmpty(delivery.promisedDate);
  if (!next || next === previous) return null;
  const standing = dayOrEmpty(delivery.expectedDate);
  const entry: DeliveryDateChange = {
    date: standing,
    previousDate: standing,
    at: input.now.toISOString(),
    source: 'typed',
    ...(input.by ? { by: input.by } : {}),
    ...(input.byName && input.byName.trim() ? { byName: input.byName.trim().slice(0, 80) } : {}),
    kind: 'promise_corrected',
    promisedDate: next,
    previousPromisedDate: previous,
  };
  return { promisedDate: next, dateHistory: [...readHistory(delivery), entry].slice(-DATE_HISTORY_MAX) };
}
