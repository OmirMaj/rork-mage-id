// buildingAccess.ts — the building will stop you before the schedule does.
//
// THE PROBLEM THIS MODELS. On a fit-out in an occupied building, the binding
// constraint is usually not the crew or the material — it is the BUILDING. A
// freight elevator with one slot a morning. A dock that takes one truck at a
// time. A COI the property manager must hold before anyone swings a hammer.
// Badges that take a week to issue. After-hours work that needs written
// approval.
//
// None of that lives in a construction schedule, so it fails the same way every
// time: the truck arrives, there is no elevator booked, and it leaves. The
// material is on site — in the street — and the crew stands down. Nothing in
// the app could see that coming, because it only knew the delivery date.
//
// ── WHY THIS IS A GATE, NOT A LIST ──────────────────────────────────────────
// A reservation list is a filing cabinet. What a PM needs is the CONFLICT: this
// delivery, on this date, in a building that requires an elevator, has no
// confirmed slot. That is why the engine's output is `AccessConflict[]` and why
// it hangs off the delivery look-ahead rather than sitting in its own corner.
//
// ── WHY 'requested' IS NOT 'confirmed' ──────────────────────────────────────
// Same reasoning as deliveries: an email to the property manager is not a
// booking. Treating a request as a reservation would tell a PM to send a truck
// against a slot nobody granted — the most expensive possible lie.
//
// Pure — no storage, no network. Pinned by test:building-access.

import { parseLocalDate } from '@/utils/deliverySchedule';
import type { Delivery } from '@/utils/deliverySchedule';

/** What a building makes you book or hold before you can work. */
export interface BuildingAccessRules {
  projectId: string;
  /** Property manager / building contact, for the chase. */
  buildingContact?: string;
  buildingPhone?: string;
  /** Every delivery needs a booked freight elevator slot. */
  requiresFreightElevator: boolean;
  /** Every delivery needs a booked dock/loading-bay slot. */
  requiresDockReservation: boolean;
  /** The building must hold a current COI naming them as additional insured.
   *  Distinct from the GC's own COI — same document, different holder, and it
   *  is the building's copy that stops work at the door. */
  requiresCoiOnFile: boolean;
  coiOnFileAt?: string;
  /** Workers must be badged before site entry. */
  requiresBadging: boolean;
  /** Working days the building takes to issue a badge. Booking a crew inside
   *  this window is a plan that cannot happen. */
  badgeLeadTimeDays?: number;
  /** Normal permitted work hours ("07:00-17:00"). */
  workHours?: string;
  /** Anything outside workHours needs written approval. */
  afterHoursRequiresApproval: boolean;
  notes?: string;
  updatedAt: string;
}

export type AccessKind = 'freight_elevator' | 'dock' | 'after_hours' | 'badging';
export type AccessStatus = 'requested' | 'confirmed' | 'denied' | 'cancelled';

/** A slot asked for, or granted, by the building. */
export interface AccessReservation {
  id: string;
  projectId: string;
  kind: AccessKind;
  /** The day it is for (YYYY-MM-DD). */
  date: string;
  /** The granted window ("07:00-11:00"). */
  window?: string;
  status: AccessStatus;
  /** The building's booking/confirmation reference — what you quote at the door. */
  confirmationRef?: string;
  /** Ties a slot to the load it exists for. */
  deliveryId?: string;
  requestedAt?: string;
  confirmedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Inside this many days, an unconfirmed request needs chasing. */
export const RESERVATION_CONFIRM_WINDOW_DAYS = 3;
/** Fallback when a building requires badges but nobody recorded the lead time. */
export const DEFAULT_BADGE_LEAD_DAYS = 5;

export type ConflictKind =
  /** A delivery needs a slot the building requires and none is booked. */
  | 'no_reservation'
  /** A slot was requested but the building has not confirmed, and it is close. */
  | 'unconfirmed_reservation'
  /** The building refused the slot. */
  | 'reservation_denied'
  /** The building's COI requirement is not satisfied. */
  | 'coi_not_on_file'
  /** Work is planned inside the badge lead time. */
  | 'badge_lead_time';

export type ConflictSeverity = 'blocking' | 'warning';

export interface AccessConflict {
  kind: ConflictKind;
  severity: ConflictSeverity;
  /** The delivery it blocks, when it is delivery-specific. */
  deliveryId?: string;
  date?: string;
  /** What a PM reads on the row. */
  message: string;
  /** What to do about it. */
  action: string;
}

const DAY_MS = 86_400_000;

function daysBetween(fromMs: number, toMs: number): number {
  const a = new Date(fromMs); const b = new Date(toMs);
  const sa = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const sb = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((sb - sa) / DAY_MS);
}

/** Which reservation kinds this building requires for a delivery. */
export function requiredKindsForDelivery(rules: BuildingAccessRules): AccessKind[] {
  const kinds: AccessKind[] = [];
  if (rules.requiresFreightElevator) kinds.push('freight_elevator');
  if (rules.requiresDockReservation) kinds.push('dock');
  return kinds;
}

/** A reservation counts for a delivery when it is the right kind, the right
 *  day, not cancelled, and either tied to that delivery or unassigned (a slot
 *  booked for the morning generally, which the load can use). */
function reservationCovers(r: AccessReservation, kind: AccessKind, date: string, deliveryId: string): boolean {
  if (r.kind !== kind) return false;
  if (r.status === 'cancelled' || r.status === 'denied') return false;
  if (r.date !== date) return false;
  return !r.deliveryId || r.deliveryId === deliveryId;
}

/**
 * Every way the building will stop this project, given what is scheduled.
 *
 * Blocking vs warning: BLOCKING means the truck gets turned away or the crew is
 * refused entry — the day does not happen. WARNING means it still might, but
 * someone needs to move. A PM triages on that difference, so conflating them
 * would make the list unusable.
 */
export function findAccessConflicts(opts: {
  rules: BuildingAccessRules | null | undefined;
  deliveries: Delivery[];
  reservations: AccessReservation[];
  /** Only look this far ahead — a conflict six months out is not actionable. */
  horizonDays?: number;
  nowMs?: number;
}): AccessConflict[] {
  const { rules, deliveries, reservations } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const horizon = opts.horizonDays ?? 28;
  if (!rules) return [];

  const out: AccessConflict[] = [];

  // ── COI the BUILDING holds. Not delivery-specific: without it nobody works,
  // so it is reported once rather than repeated against every load.
  if (rules.requiresCoiOnFile && !rules.coiOnFileAt) {
    out.push({
      kind: 'coi_not_on_file',
      severity: 'blocking',
      message: 'The building has no certificate of insurance on file',
      action: `Send a COI naming the building as additional insured${rules.buildingContact ? ` to ${rules.buildingContact}` : ''}.`,
    });
  }

  const required = requiredKindsForDelivery(rules);

  for (const d of deliveries) {
    if (d.status === 'delivered' || d.status === 'cancelled') continue;
    const expMs = parseLocalDate(d.expectedDate);
    if (expMs === null) continue;
    const daysOut = daysBetween(nowMs, expMs);
    // Past deliveries are the delivery chase's problem, not access planning's.
    if (daysOut < 0 || daysOut > horizon) continue;

    for (const kind of required) {
      const covering = reservations.filter(r => reservationCovers(r, kind, d.expectedDate, d.id));
      const confirmed = covering.find(r => r.status === 'confirmed');
      const requested = covering.find(r => r.status === 'requested');
      const denied = reservations.find(
        r => r.kind === kind && r.date === d.expectedDate && r.status === 'denied'
          && (!r.deliveryId || r.deliveryId === d.id),
      );

      const label = kind === 'freight_elevator' ? 'freight elevator' : 'loading dock';

      // A denial that has since been re-requested is stale history, not a live
      // conflict — reporting it would send a PM chasing a slot they already
      // rebooked. Only an unanswered denial still blocks.
      if (denied && !confirmed && !requested) {
        out.push({
          kind: 'reservation_denied',
          severity: 'blocking',
          deliveryId: d.id,
          date: d.expectedDate,
          message: `The building refused the ${label} for ${d.description} on ${d.expectedDate}`,
          action: 'Rebook another slot and move the delivery, or the truck will be turned away.',
        });
        continue;
      }

      if (confirmed) continue;

      if (requested) {
        if (daysOut <= RESERVATION_CONFIRM_WINDOW_DAYS) {
          out.push({
            kind: 'unconfirmed_reservation',
            severity: 'warning',
            deliveryId: d.id,
            date: d.expectedDate,
            message: `${label[0].toUpperCase()}${label.slice(1)} for ${d.description} is requested but not confirmed`,
            action: `Chase ${rules.buildingContact ?? 'the property manager'} — it lands in ${daysOut === 0 ? 'less than a day' : `${daysOut}d`}.`,
          });
        }
        continue;
      }

      out.push({
        kind: 'no_reservation',
        severity: 'blocking',
        deliveryId: d.id,
        date: d.expectedDate,
        message: `No ${label} booked for ${d.description} on ${d.expectedDate}`,
        action: `Book the ${label} with ${rules.buildingContact ?? 'the building'} before the truck leaves the yard.`,
      });
    }
  }

  // ── Badging lead time. A crew that cannot get through the lobby is not a
  // crew, and the lead time is the part people forget until the morning of.
  if (rules.requiresBadging) {
    const lead = rules.badgeLeadTimeDays ?? DEFAULT_BADGE_LEAD_DAYS;
    const badged = reservations.filter(r => r.kind === 'badging' && r.status === 'confirmed');
    if (badged.length === 0) {
      const soonest = deliveries
        .filter(d => d.status !== 'delivered' && d.status !== 'cancelled')
        .map(d => parseLocalDate(d.expectedDate))
        .filter((m): m is number => m !== null)
        .filter(m => daysBetween(nowMs, m) >= 0)
        .sort((a, b) => a - b)[0];
      if (soonest !== undefined && daysBetween(nowMs, soonest) < lead) {
        out.push({
          kind: 'badge_lead_time',
          severity: 'warning',
          message: `Badging takes ${lead} days and the next delivery is in ${daysBetween(nowMs, soonest)}`,
          action: 'Submit the worker list now, or nobody gets past the lobby to receive it.',
        });
      }
    }
  }

  return out;
}

/** Conflicts for one delivery — what the delivery row shows. */
export function conflictsForDelivery(conflicts: AccessConflict[], deliveryId: string): AccessConflict[] {
  return conflicts.filter(c => c.deliveryId === deliveryId);
}

/** One line for a dashboard tile. Blocking always leads. */
export function summarizeAccess(conflicts: AccessConflict[]): string | null {
  if (conflicts.length === 0) return null;
  const blocking = conflicts.filter(c => c.severity === 'blocking').length;
  if (blocking > 0) {
    return `${blocking} building ${blocking === 1 ? 'issue' : 'issues'} will stop work`;
  }
  const n = conflicts.length;
  return `${n} building ${n === 1 ? 'item needs' : 'items need'} chasing`;
}
