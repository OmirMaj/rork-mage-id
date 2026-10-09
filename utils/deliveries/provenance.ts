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

/** A stored history, made safe to read: an array of well-formed entries, oldest first, at most the cap. */
export function readHistory(delivery: Pick<Delivery, 'dateHistory'>): DeliveryDateChange[] {
  const raw = delivery.dateHistory;
  if (!Array.isArray(raw)) return [];
  const out: DeliveryDateChange[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const at = typeof e.at === 'string' ? e.at : '';
    if (!at) continue;
    out.push({
      date: dayOrEmpty(e.date),
      previousDate: dayOrEmpty(e.previousDate),
      at,
      source: e.source === 'supplier_said' ? 'supplier_said' : 'typed',
      ...(cleanNote(e.note) ? { note: cleanNote(e.note) } : {}),
      ...(typeof e.by === 'string' && e.by ? { by: e.by } : {}),
      ...(typeof e.byName === 'string' && e.byName.trim() ? { byName: e.byName.trim().slice(0, 80) } : {}),
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
    if (e.date !== current) continue;
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
 * first supplier date the delivery has had. An unchanged date with an
 * unchanged source records nothing (null).
 *
 * `promisedDate` is written ONCE: the first real supplier date. A later change
 * never moves it, which is what stops an edit from erasing a slip.
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
  // The first supplier date ever recorded is the promise. A delivery that
  // already had a date before the lane keeps THAT date as its promise.
  const promisedDate = dayOrEmpty(delivery.promisedDate) || previous || next;
  return { expectedDate: next, dateHistory, ...(promisedDate ? { promisedDate } : {}) };
}

/** The fields to save when the person marks it ordered: the day, and the promise if none was recorded yet. */
export function recordOrdered(
  delivery: Pick<Delivery, 'expectedDate' | 'promisedDate'>,
  orderedOn: string,
): Pick<Delivery, 'orderedOn' | 'promisedDate'> {
  const promisedDate = dayOrEmpty(delivery.promisedDate) || dayOrEmpty(delivery.expectedDate);
  return { orderedOn: dayOrEmpty(orderedOn), ...(promisedDate ? { promisedDate } : {}) };
}
