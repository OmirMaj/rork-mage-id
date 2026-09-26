// utils/registers/deliveryRows.ts — one desktop Deliveries register row per
// promised load (wave 6d, lane R3).
//
// PURE: type-only imports of utils/deliverySchedule and utils/buildingAccess
// (the phone's own maths), so scripts/validate-registers-lead-doc.ts executes
// it under bun. The flag, its words and its tone are the phone Row's: a late
// load reads in danger, an unconfirmed one in the accent, the rest quiet. The
// building's objection is the FIRST conflict conflictsForDelivery returns for
// the load, in its severity's colour.

import type { DeliveryFlag, DeliveryView } from '@/utils/deliverySchedule';
import type { AccessConflict, ConflictSeverity } from '@/utils/buildingAccess';
import type { RegisterCsvColumn } from './registerCsv';

export type DeliveryTone = 'danger' | 'accent' | 'neutral';

export interface DeliveryRegisterRow {
  id: string;
  flag: DeliveryFlag;
  /** classifyDelivery's one line ('3 days late', 'Due in 2d — not confirmed'). */
  flagLabel: string;
  tone: DeliveryTone;
  what: string;
  supplier: string | null;
  /** The promised calendar day (YYYY-MM-DD) as stored. */
  promisedDay: string | null;
  /** Days from today (negative = late), or null with no date. */
  daysOut: number | null;
  window: string | null;
  po: string | null;
  /** The supplier has confirmed: the row offers no Confirm. */
  confirmed: boolean;
  firstConflict: { message: string; severity: ConflictSeverity } | null;
  conflictCount: number;
}

const text = (s: string | null | undefined): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null);

/** The phone Row's colour: late → danger, unconfirmed → accent, else quiet. */
export function deliveryTone(flag: DeliveryFlag): DeliveryTone {
  return flag === 'late' ? 'danger' : flag === 'unconfirmed' ? 'accent' : 'neutral';
}

/** `conflicts` = conflictsForDelivery(all, v.delivery.id) — this load's own. */
export function deliveryRegisterRow(v: DeliveryView, conflicts: readonly AccessConflict[]): DeliveryRegisterRow {
  const d = v.delivery;
  const first = conflicts[0] ?? null;
  return {
    id: d.id,
    flag: v.flag,
    flagLabel: v.label,
    tone: deliveryTone(v.flag),
    what: d.description,
    supplier: text(d.supplier),
    promisedDay: text(d.expectedDate),
    daysOut: v.daysOut,
    window: text(d.window),
    po: text(d.poNumber),
    confirmed: d.status === 'confirmed',
    firstConflict: first ? { message: first.message, severity: first.severity } : null,
    conflictCount: conflicts.length,
  };
}

export const DELIVERY_CSV_COLUMNS: readonly RegisterCsvColumn<DeliveryRegisterRow>[] = [
  { key: 'flag', label: 'Flag', csvValue: (r) => r.flagLabel },
  { key: 'what', label: 'What', csvValue: (r) => text(r.what) },
  { key: 'promised', label: 'Promised', csvValue: (r) => r.promisedDay },
  { key: 'supplier', label: 'Supplier', csvValue: (r) => r.supplier },
  { key: 'window', label: 'Window', csvValue: (r) => r.window },
  { key: 'po', label: 'PO', csvValue: (r) => r.po },
  { key: 'confirmed', label: 'Confirmed', csvValue: (r) => (r.confirmed ? 'Yes' : 'No') },
  { key: 'building', label: 'Building access', csvValue: (r) => r.firstConflict?.message ?? null },
];
