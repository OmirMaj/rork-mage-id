// seatModel.ts — who occupies a paid seat, and what that costs.
//
// THE PROBLEM IT SOLVES. Tiers were per-ACCOUNT, so a GC with a two-person
// office and a GC running eight PMs paid exactly the same. Team growth — the
// clearest signal a customer is getting more value — produced zero additional
// revenue, capping net revenue retention at whatever the tier ladder allowed.
//
// ── WHY FIELD SEATS ARE FREE ────────────────────────────────────────────────
// This is the load-bearing decision, not a discount.
//
// The moat is the cost book, and the cost book is fed by FIELD data: clocked
// labour hours, daily reports, photos, punch items. The 'field' collaborator
// role (utils/roleBlinding) exists specifically to get crew onto the platform
// without exposing margins. Charging per field seat would tax the exact
// behaviour the product depends on — every foreman a GC declines to add is
// labour data MAGE never learns from, which makes every future estimate worse
// for that GC and for the book.
//
// So: 'field' is unlimited and free, forever. The metered seats are the ADMIN
// ones — editor and viewer — which are the roles that read financials, cost
// real money to serve (AI, financial queries), and map to office headcount
// that grows with the customer's success.
//
// The account owner never occupies a seat.
//
// ── SEATS ARE PER ACCOUNT, NOT PER PROJECT ──────────────────────────────────
// One person invited to six projects is ONE seat. Counting per project would
// punish the GC for organising work into projects, which is the product's
// entire shape. De-duplication is by email (lowercased): a pending invite has
// no user_id yet, and the invite is keyed on (project_id, invited_email).
//
// Pending invites DO occupy a seat — otherwise the limit is trivially gamed by
// never accepting, and a seat you are holding open for someone is a seat.
// Revoked rows do not.
//
// Pure — no storage, no network, no RevenueCat. Pinned by test:seat-model.

export type SeatRole = 'owner' | 'editor' | 'viewer' | 'field';
export type SeatStatusKind = 'pending' | 'accepted' | 'revoked';
export type SeatTier = 'free' | 'pro' | 'business' | 'enterprise';

/** Monthly price of one admin seat beyond the tier's included allowance. */
export const SEAT_PRICE_USD = 15;

/**
 * MUST STAY FALSE until a per-seat RevenueCat product exists AND the server can
 * verify the entitlement.
 *
 * Mirrors the RFP_PAID_POST_ENABLED pattern in components/ClientPaywall: a
 * client flag that promises a charge the backend cannot actually take is worse
 * than no feature at all — the GC taps "add seat", the edge function returns
 * 402, and the product looks broken.
 *
 * While false, going past the included allowance asks for an UPGRADE rather
 * than offering to sell a seat. SEAT_PRICE_USD is still shown, as what an extra
 * seat will cost once metered billing is live, so the pricing is never a
 * surprise later.
 *
 * To turn on: create the per-seat product in RevenueCat, teach
 * supabase/functions/project-invite/index.ts seatCheck() to read the seat
 * entitlement, then flip this.
 */
export const SEAT_OVERAGE_BILLING_ENABLED = false;

/** Admin seats included before overage billing starts.
 *  free: 0 — collaboration is a paid feature (schedule_collaboration is Pro+),
 *  so a free account has no seats to give. */
export const INCLUDED_ADMIN_SEATS: Record<SeatTier, number> = {
  free: 0,
  pro: 2,
  business: 5,
  enterprise: 15,
};

/** Roles that consume a paid seat. 'field' is deliberately absent — see header.
 *  'owner' is the account holder, who is not a seat. */
const BILLABLE_ROLES: ReadonlySet<SeatRole> = new Set<SeatRole>(['editor', 'viewer']);

export function isBillableSeat(role: string): boolean {
  return BILLABLE_ROLES.has(role as SeatRole);
}

/** A row shaped like ProjectCollaborator, narrowed to what seat maths needs. */
export interface SeatOccupant {
  email: string;
  role: string;
  status: string;
}

export interface SeatCounts {
  /** Distinct people occupying a paid (admin) seat. */
  admin: number;
  /** Distinct field collaborators — free, shown for reassurance. */
  field: number;
  /** Lowercased emails behind `admin`, for the UI to list. */
  adminEmails: string[];
}

/** Count distinct occupants by role class. Revoked rows are ignored; pending
 *  and accepted both hold a seat. A person who is an editor on one project and
 *  field on another counts as ADMIN — the higher privilege wins, otherwise a
 *  single field invite would launder a paid seat into a free one. */
export function countSeats(rows: SeatOccupant[]): SeatCounts {
  const byEmail = new Map<string, { billable: boolean }>();
  for (const r of rows) {
    if (r.status === 'revoked') continue;
    if (r.role === 'owner') continue;
    const email = (r.email || '').trim().toLowerCase();
    if (!email) continue;
    const billable = isBillableSeat(r.role);
    const prior = byEmail.get(email);
    byEmail.set(email, { billable: (prior?.billable ?? false) || billable });
  }
  const adminEmails: string[] = [];
  let field = 0;
  for (const [email, v] of byEmail) {
    if (v.billable) adminEmails.push(email);
    else field += 1;
  }
  adminEmails.sort();
  return { admin: adminEmails.length, field, adminEmails };
}

export interface SeatStatus {
  tier: SeatTier;
  /** Admin seats the tier includes. */
  included: number;
  /** Admin seats currently occupied. */
  used: number;
  /** Seats beyond the allowance (never negative). */
  overage: number;
  /** overage × SEAT_PRICE_USD. */
  overageMonthlyUsd: number;
  /** Free field seats in use — always allowed. */
  fieldSeats: number;
  /** Seats left before the next one bills. */
  remaining: number;
  /** True when adding one more admin seat would start (or grow) a charge. */
  nextSeatBills: boolean;
}

export function seatStatus(tier: SeatTier, counts: SeatCounts): SeatStatus {
  const included = INCLUDED_ADMIN_SEATS[tier] ?? 0;
  const used = counts.admin;
  const overage = Math.max(0, used - included);
  return {
    tier,
    included,
    used,
    overage,
    overageMonthlyUsd: overage * SEAT_PRICE_USD,
    fieldSeats: counts.field,
    remaining: Math.max(0, included - used),
    nextSeatBills: used >= included,
  };
}

/** What adding one collaborator in `role` would do. The UI calls this BEFORE
 *  sending an invite so the GC is never surprised by a charge. */
export interface SeatPreview {
  /** False only when the tier includes no seats at all (free). */
  allowed: boolean;
  /** True when this specific invite adds a billable seat. */
  bills: boolean;
  /** Monthly delta in USD (0 for field, or when inside the allowance). */
  addedMonthlyUsd: number;
  /** Plain-English line for the invite UI. */
  message: string;
}

export function previewSeat(
  tier: SeatTier,
  counts: SeatCounts,
  role: string,
  /** Email being invited — re-inviting someone who already holds a seat is free. */
  email?: string,
): SeatPreview {
  const normalized = (email || '').trim().toLowerCase();
  const alreadyHeld = !!normalized && counts.adminEmails.includes(normalized);

  if (!isBillableSeat(role)) {
    return {
      allowed: true,
      bills: false,
      addedMonthlyUsd: 0,
      message: 'Field access is free and unlimited — crew never count toward seats.',
    };
  }

  const status = seatStatus(tier, counts);

  if (status.included === 0) {
    return {
      allowed: false,
      bills: false,
      addedMonthlyUsd: 0,
      message: 'Inviting teammates needs a Pro plan or higher.',
    };
  }

  if (alreadyHeld) {
    return {
      allowed: true,
      bills: false,
      addedMonthlyUsd: 0,
      message: 'They already hold a seat on your account — no extra charge.',
    };
  }

  if (!status.nextSeatBills) {
    const left = status.remaining;
    return {
      allowed: true,
      bills: false,
      addedMonthlyUsd: 0,
      message: `${left} of ${status.included} included seat${status.included === 1 ? '' : 's'} left on ${status.tier}.`,
    };
  }

  // Past the allowance. Until metered seat billing is live the honest answer is
  // "upgrade" — the server enforces the same limit, so offering to sell a seat
  // here would just produce a 402 and a broken-looking product.
  if (!SEAT_OVERAGE_BILLING_ENABLED) {
    return {
      allowed: false,
      bills: false,
      addedMonthlyUsd: 0,
      message: `All ${status.included} team seats on your ${status.tier} plan are in use. Upgrade for more — or invite them as Field, which is always free.`,
    };
  }

  return {
    allowed: true,
    bills: true,
    addedMonthlyUsd: SEAT_PRICE_USD,
    message: `This is seat ${status.used + 1}. Your ${status.tier} plan includes ${status.included}, so this adds $${SEAT_PRICE_USD}/mo.`,
  };
}
