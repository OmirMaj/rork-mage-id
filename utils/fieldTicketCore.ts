// ============================================================================
// utils/fieldTicketCore.ts
//
// Pure T&M field-ticket logic — totals, "is this complete enough to sign",
// seal enforcement, and the ticket→ChangeOrder mapping. No React, no React
// Native, no storage, no network: bun cannot parse `react-native` imports, so
// everything the validator pins lives here (same rule as
// utils/brain/predictionLedgerCore.ts and utils/alertCore.ts).
//
// The three ideas this file exists to enforce:
//
//   1. A super signs for WORK, not for money. Hours and quantities are what
//      the owner's rep can honestly attest to standing in a hallway; rates and
//      unit costs get attached in the office. So signability requires the
//      work, not the pricing — but billability (conversion to a CO) requires
//      a positive dollar total, because a $0 change order is not a bill.
//
//   2. A signature is evidence. Once `status !== 'draft'` the captured
//      content is frozen; only lifecycle fields may move. Same principle as
//      app/contract.tsx sealing a signed contract, enforced at the data layer
//      so it can't be bypassed by a screen that forgets to set `editable`.
//
//   3. Converting the same ticket twice would double-bill the owner. The
//      dedupe marker is an auditTrail entry on the CREATED CO
//      ({ action: FIELD_TICKET_CO_ACTION, detail: ticket.id }) — the exact
//      pattern utils/brain/leakCoDraft.ts uses, and for the same reason:
//      audit_trail is a synced column, so the guard survives a cache wipe.
// ============================================================================

import type {
  ChangeOrder,
  ChangeOrderLineItem,
  COAuditEntry,
  FieldTicket,
  FieldTicketEquipmentRow,
  FieldTicketLaborRow,
  FieldTicketMaterialRow,
} from '@/types';
import { generateUUID } from '@/utils/generateId';
import { normalizeTradeKey, type LaborRateMap } from '@/utils/laborSamples';
import type { ProjectRole } from '@/utils/projectRole';
import { EQUIPMENT_HOURS_PER_DAY } from '@/utils/jobCostEngine';

// ─── Display ─────────────────────────────────────────────────────────────────

/** "T&M-007" — the human handle for a ticket, distinct from a CO number. */
export function fieldTicketLabel(number: number): string {
  return `T&M-${String(Math.max(0, Math.floor(number))).padStart(3, '0')}`;
}

/** Next per-project ticket number: max(existing) + 1, never length + 1 —
 *  deleting one out of the middle must not reissue a number that already
 *  appears on a signed, client-facing document. Mirrors change-order.tsx. */
export function nextFieldTicketNumber(existing: FieldTicket[]): number {
  return existing.reduce((max, t) => Math.max(max, t.number || 0), 0) + 1;
}

// ─── Totals ──────────────────────────────────────────────────────────────────
// Rows with no rate / no unit cost contribute ZERO dollars but still count
// toward hours and quantities. That is deliberate: an unpriced row is a real
// piece of authorized work waiting on an office rate, not an error.

function num(n: number | undefined | null): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Round to cents. Float drift across three categories plus a markup
 *  otherwise surfaces as $1,234.5600000000001 on a client-facing document. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function laborRowTotal(row: FieldTicketLaborRow): number {
  return round2(num(row.hours) * num(row.rate));
}

export function materialRowTotal(row: FieldTicketMaterialRow): number {
  return round2(num(row.quantity) * num(row.unitCost));
}

export function equipmentRowTotal(row: FieldTicketEquipmentRow): number {
  return round2(num(row.hours) * num(row.rate));
}

export interface FieldTicketTotals {
  laborHours: number;
  laborCost: number;
  materialCost: number;
  equipmentHours: number;
  equipmentCost: number;
  /** labor + material + equipment, before markup. */
  subtotal: number;
  markupPercent: number;
  markupAmount: number;
  /** What the change order would be written for. */
  billableTotal: number;
  /** Rows that carry work but no price — the office's to-do list. */
  unpricedRowCount: number;
  /** Labor hours sitting on those unpriced rows. The concrete number the
   *  conversion warning quotes: "18 hr will not be billed" lands where
   *  "2 lines" does not. */
  unpricedLaborHours: number;
}

export function computeFieldTicketTotals(
  ticket: Pick<FieldTicket, 'labor' | 'materials' | 'equipment' | 'markupPercent'>,
): FieldTicketTotals {
  const labor = ticket.labor ?? [];
  const materials = ticket.materials ?? [];
  const equipment = ticket.equipment ?? [];

  const laborHours = round2(labor.reduce((s, r) => s + num(r.hours), 0));
  const laborCost = round2(labor.reduce((s, r) => s + laborRowTotal(r), 0));
  const materialCost = round2(materials.reduce((s, r) => s + materialRowTotal(r), 0));
  const equipmentHours = round2(equipment.reduce((s, r) => s + num(r.hours), 0));
  const equipmentCost = round2(equipment.reduce((s, r) => s + equipmentRowTotal(r), 0));

  const subtotal = round2(laborCost + materialCost + equipmentCost);
  const markupPercent = Math.max(0, num(ticket.markupPercent));
  const markupAmount = round2(subtotal * (markupPercent / 100));
  const billableTotal = round2(subtotal + markupAmount);

  const unpricedRowCount =
    labor.filter(r => num(r.hours) > 0 && num(r.rate) <= 0).length +
    materials.filter(r => num(r.quantity) > 0 && num(r.unitCost) <= 0).length +
    equipment.filter(r => num(r.hours) > 0 && num(r.rate) <= 0).length;

  const unpricedLaborHours = round2(
    labor.filter(r => num(r.rate) <= 0).reduce((s, r) => s + num(r.hours), 0),
  );

  return {
    laborHours, laborCost, materialCost, equipmentHours, equipmentCost,
    subtotal, markupPercent, markupAmount, billableTotal,
    unpricedRowCount, unpricedLaborHours,
  };
}

/** True when the ticket records at least one unit of real work. */
export function hasWorkRecorded(
  ticket: Pick<FieldTicket, 'labor' | 'materials' | 'equipment'>,
): boolean {
  return (
    (ticket.labor ?? []).some(r => num(r.hours) > 0) ||
    (ticket.materials ?? []).some(r => num(r.quantity) > 0) ||
    (ticket.equipment ?? []).some(r => num(r.hours) > 0)
  );
}

// ─── Signability ─────────────────────────────────────────────────────────────

/** Draft fields a ticket needs before anyone can be asked to sign it. */
export interface FieldTicketReadiness {
  ready: boolean;
  /** Human-readable, ordered, one per missing requirement. */
  missing: string[];
}

/**
 * Can we put this in front of the owner's rep? Requires the four things that
 * make a ticket mean something: a project, a date, what work was done, why
 * it's extra, and at least one row of actual work.
 *
 * Explicitly does NOT require prices — see the file header.
 */
export function checkFieldTicketReadiness(ticket: FieldTicket): FieldTicketReadiness {
  const missing: string[] = [];
  if (!ticket.projectId || !ticket.projectId.trim()) missing.push('Project');
  if (!ticket.date || !ticket.date.trim()) missing.push('Date of work');
  if (!ticket.workDescription || ticket.workDescription.trim().length < 3) {
    missing.push('Description of the work performed');
  }
  if (!ticket.reasonExtra || ticket.reasonExtra.trim().length < 3) {
    missing.push('Why the work is extra');
  }
  if (!hasWorkRecorded(ticket)) {
    missing.push('At least one labor, material, or equipment line');
  }
  return { ready: missing.length === 0, missing };
}

/** Convenience predicate. */
export function isFieldTicketSignable(ticket: FieldTicket): boolean {
  return checkFieldTicketReadiness(ticket).ready;
}

/**
 * Is this ticket ACTUALLY authorized? An unsigned or half-signed ticket must
 * never be treated as authorized anywhere in the app — that is the whole
 * point of the feature. Requires:
 *   * a non-draft, non-void status
 *   * an authorization block with a real typed name
 *   * at least one signature stroke (a typed name alone is not a signature
 *     captured in the field)
 *   * a signedAt timestamp
 *   * the underlying ticket still being complete (guards against a ticket
 *     that was somehow emptied after signing)
 */
export function isFieldTicketAuthorized(ticket: FieldTicket): boolean {
  if (ticket.status !== 'signed' && ticket.status !== 'converted') return false;
  const auth = ticket.authorization;
  if (!auth) return false;
  if (!auth.name || auth.name.trim().length === 0) return false;
  if (!Array.isArray(auth.signaturePaths) || auth.signaturePaths.length === 0) return false;
  if (!auth.signedAt || auth.signedAt.trim().length === 0) return false;
  return isFieldTicketSignable(ticket);
}

// ─── Sealing ─────────────────────────────────────────────────────────────────

/** A ticket is sealed the moment it leaves draft — its content is evidence. */
export function isFieldTicketSealed(ticket: Pick<FieldTicket, 'status'>): boolean {
  return ticket.status !== 'draft';
}

/**
 * The ONLY keys a sealed ticket may still change. Everything else is captured
 * content: the owner's rep signed a specific set of hours and quantities and
 * that set must not move underneath the signature.
 */
export const SEALED_FIELD_TICKET_MUTABLE_KEYS: readonly (keyof FieldTicket)[] = [
  'status',
  'convertedChangeOrderId',
  'convertedAt',
  'auditTrail',
  'updatedAt',
  // Photo rows gain `storagePath`/`localUri` when the upload queue drains.
  // Those are transport bookkeeping for bytes that were already captured, not
  // a change to what was signed for.
  'photos',
];

// ─── Pricing a sealed ticket ─────────────────────────────────────────────────
//
// The rep signs for HOURS (see the file header and the sign-off wording in
// app/field-ticket.tsx). The money is the office's to attach afterwards. Until
// this existed the seal froze the rate fields too, so a ticket signed the
// designed way — hours now, rates later — could never reach a dollar amount
// and therefore could never become a change order. Signed evidence that can
// never be billed is the exact failure the feature exists to prevent.
//
// So the seal is now per FIELD, not per key: on a sealed ticket the office may
// move `labor[].rate`, `materials[].unitCost` and `equipment[].rate` and
// NOTHING else. Hours, quantities, trades, descriptions, row order and the row
// set itself stay frozen — a whole-key allow-list would have let all of those
// be rewritten under the signature, because the check only ever looked at
// top-level key names.
//
// Every rate the office moves is recorded (FIELD_TICKET_PRICED_ACTION) so the
// ticket can always show which half the rep signed and which half the office
// added later. That record is the point: it makes the relaxed seal *stronger*
// evidence in a dispute, not weaker.

/** The one numeric field on each row collection the office may still set. */
export const SEALED_FIELD_TICKET_PRICE_FIELDS = {
  labor: 'rate',
  materials: 'unitCost',
  equipment: 'rate',
} as const;

export type FieldTicketPricedCategory = keyof typeof SEALED_FIELD_TICKET_PRICE_FIELDS;

/** Audit action stamped on the ticket for each rate applied after signing. */
export const FIELD_TICKET_PRICED_ACTION = 'priced_after_signature';

type UnknownRow = Record<string, unknown>;

/** Everything about a row EXCEPT its price, in a stable, comparable form.
 *  Absent and explicitly-undefined keys must compare equal — `{ rate: undefined }`
 *  round-trips out of JSON as an absent key, so treating them differently would
 *  refuse a legitimate patch after one sync. */
function rowIdentity(row: UnknownRow, priceField: string): string {
  const keys = Object.keys(row)
    .filter(k => k !== priceField && row[k] !== undefined)
    .sort();
  return JSON.stringify(keys.map(k => [k, row[k]]));
}

function priceOf(row: UnknownRow, priceField: string): number | undefined {
  const v = row[priceField];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * True when `after` differs from `before` ONLY in the price field: same rows,
 * same ids, same order, same hours/quantities/labels. Anything else — a row
 * added, removed, reordered, or re-scoped — is a rewrite of signed content.
 */
export function isPricingOnlyRowChange(
  before: UnknownRow[],
  after: UnknownRow[],
  priceField: string,
): boolean {
  if (before.length !== after.length) return false;
  return before.every((b, i) => {
    const a = after[i];
    if (!a || typeof a !== 'object') return false;
    if (b.id !== a.id) return false;
    return rowIdentity(b, priceField) === rowIdentity(a, priceField);
  });
}

/**
 * Which keys of an update would illegally rewrite sealed content. Empty array
 * means the update is allowed. Callers reject the whole update if non-empty —
 * a partial apply would be worse than a refusal.
 *
 * Pass the WHOLE prior ticket, not just its status: a labor/materials/equipment
 * update is judged row by row against what was signed, and without the prior
 * rows there is nothing to judge it against (that case is refused, because an
 * edit we cannot prove is price-only must not be trusted).
 */
export function sealedFieldTicketViolations(
  ticket: Pick<FieldTicket, 'status'> &
    Partial<Pick<FieldTicket, 'labor' | 'materials' | 'equipment'>>,
  updates: Partial<FieldTicket>,
): string[] {
  if (!isFieldTicketSealed(ticket)) return [];
  const allowed = new Set<string>(SEALED_FIELD_TICKET_MUTABLE_KEYS as readonly string[]);
  const priceFields: Record<string, string | undefined> = SEALED_FIELD_TICKET_PRICE_FIELDS;
  return Object.keys(updates).filter(k => {
    if (allowed.has(k)) return false;
    const priceField = priceFields[k];
    if (!priceField) return true;
    const before = (ticket as Record<string, unknown>)[k];
    const after = (updates as Record<string, unknown>)[k];
    if (!Array.isArray(before) || !Array.isArray(after)) return true;
    return !isPricingOnlyRowChange(before as UnknownRow[], after as UnknownRow[], priceField);
  });
}

/** One rate the office moved after the signature. */
export interface FieldTicketPriceChange {
  category: FieldTicketPricedCategory;
  rowId: string;
  /** What the row is, in the words already on the ticket. */
  label: string;
  /** Undefined = the row carried no price before / after. */
  from?: number;
  to?: number;
}

function rowLabel(category: FieldTicketPricedCategory, row: UnknownRow): string {
  if (category === 'labor') {
    const trade = typeof row.trade === 'string' ? row.trade.trim() : '';
    const who = typeof row.workerName === 'string' ? row.workerName.trim() : '';
    return [trade, who].filter(Boolean).join(' — ') || 'Labor';
  }
  const desc = typeof row.description === 'string' ? row.description.trim() : '';
  return desc || (category === 'materials' ? 'Material' : 'Equipment');
}

/**
 * The rates this update would change, in ticket order. Only meaningful for an
 * update that already passed sealedFieldTicketViolations — a rewritten row set
 * is refused before it gets here.
 */
export function fieldTicketPriceChanges(
  ticket: Partial<Pick<FieldTicket, 'labor' | 'materials' | 'equipment'>>,
  updates: Partial<FieldTicket>,
): FieldTicketPriceChange[] {
  const out: FieldTicketPriceChange[] = [];
  for (const category of Object.keys(SEALED_FIELD_TICKET_PRICE_FIELDS) as FieldTicketPricedCategory[]) {
    const priceField = SEALED_FIELD_TICKET_PRICE_FIELDS[category];
    const after = (updates as Record<string, unknown>)[category];
    const before = (ticket as Record<string, unknown>)[category];
    if (!Array.isArray(after) || !Array.isArray(before)) continue;
    (after as UnknownRow[]).forEach((a, i) => {
      const b = (before as UnknownRow[])[i];
      if (!b || b.id !== a.id) return;
      const from = priceOf(b, priceField);
      const to = priceOf(a, priceField);
      if (from === to) return;
      out.push({
        category,
        rowId: String(a.id ?? ''),
        label: rowLabel(category, a),
        ...(from === undefined ? null : { from }),
        ...(to === undefined ? null : { to }),
      });
    });
  }
  return out;
}

/** "Carpenter — R. Alvarez: rate set to $95.00/hr" — the audit line a GC can
 *  read back to an owner who says the rates were invented later. */
export function priceChangeDetail(change: FieldTicketPriceChange): string {
  const unit = change.category === 'materials' ? '/unit' : '/hr';
  const fmt = (n: number) => `$${n.toFixed(2)}${unit}`;
  const to = change.to === undefined ? 'cleared' : fmt(change.to);
  const from = change.from === undefined ? 'no rate' : fmt(change.from);
  return `${change.label}: ${from} → ${to}`;
}

/**
 * Audit entries for a batch of office-applied rates. Appended to the ticket's
 * own auditTrail (an already-sealed-mutable key) so the record of WHO priced it
 * and WHEN survives a cache wipe exactly like the conversion marker does.
 */
export function buildPricingAuditEntries(
  changes: FieldTicketPriceChange[],
  actor: string,
  nowISO: string,
  newId: () => string = generateUUID,
): COAuditEntry[] {
  return changes.map(c => ({
    id: newId(),
    action: FIELD_TICKET_PRICED_ACTION,
    actor,
    timestamp: nowISO,
    detail: priceChangeDetail(c),
  }));
}

/**
 * The name a 'priced_after_signature' entry records: the SIGNED-IN person who
 * set the rate. The device's company branding named every collaborator who
 * priced a ticket after the GC (his contactName, or his company), and a
 * missing branding wrote the literal 'Office' — so the dispute record could
 * not say who actually attached the dollars. Branding is only the fallback
 * for a session with neither a name nor an email.
 */
export function pricingActorName(
  user: { name?: string | null; email?: string | null } | null | undefined,
  branding: { contactName?: string | null; companyName?: string | null } | null | undefined,
): string {
  return (user?.name ?? '').trim()
    || (user?.email ?? '').trim()
    || (branding?.contactName ?? '').trim()
    || (branding?.companyName ?? '').trim()
    || 'Office';
}

/**
 * Why this person may NOT price a signed ticket, or null when they may.
 * Pricing puts the dollars on sealed evidence, so it is the owner's or an
 * editor's call: a viewer is read-only by definition, and a field user is
 * blinded from money (utils/roleBlinding). A role still resolving — or a
 * collaborator read that failed — is not a yes; the screen says which it is
 * rather than hiding the button without a word.
 */
/**
 * The role pricing is gated on. The collaborator read is a network query, so
 * with no signal on site it fails or hangs and the role is null — and the GC
 * opening his OWN signed ticket was told pricing stays locked. Ownership is
 * already on the cached project row (Project.ownerUserId, the row's user_id),
 * so the owner is recognised from that without waiting. Everyone else still
 * fails closed on null. The database enforces the write either way.
 */
export function pricingRoleFor(
  role: ProjectRole,
  ownerUserId: string | null | undefined,
  userId: string | null | undefined,
): ProjectRole {
  if (role != null) return role;
  return ownerUserId && userId && ownerUserId === userId ? 'owner' : null;
}

export function fieldTicketPricingBlockReason(role: ProjectRole, roleError = false): string | null {
  if (role === 'owner' || role === 'editor') return null;
  if (role === 'viewer') return 'Pricing is locked for you: your access on this project is view-only. The owner or an editor sets the rates.';
  if (role === 'field') return 'Pricing is done in the office. The owner or an editor sets the rates on a signed ticket.';
  return roleError
    ? 'Couldn’t confirm your access on this project, so pricing stays locked. Reopen the ticket to try again.'
    : 'Checking your access on this project before pricing opens…';
}

/**
 * Why rates and totals are hidden on this screen, or null when they are shown
 * (audit #99). Money is shown only to a role canViewFinancials allows, and the
 * role is null offline or before the collaborator read lands — fail closed,
 * but never silently: an editor on a job site with no signal is told it is his
 * connection, not his access. The owner never gets here offline: pricingRoleFor
 * recognises him from the cached project row.
 */
export function fieldTicketMoneyHiddenReason(role: ProjectRole, roleError = false): string | null {
  if (role === 'owner' || role === 'editor' || role === 'viewer') return null;
  if (role === 'field') return 'Rates and totals are the office’s — field access shows hours and quantities.';
  return roleError
    ? 'Couldn’t confirm your access on this project, so amounts are hidden. Reopen the ticket with a signal to see them.'
    : 'Checking your access on this project — amounts show once it is confirmed.';
}

// ─── Where the office's rates come from ──────────────────────────────────────
// The app already knows what this GC pays. Making him retype it is how a
// ticket stays unpriced for a month. But a suggested rate is NOT a fact about
// this ticket, so every suggestion carries the source it came from and is
// OFFERED, never silently written — the screen shows it as a tappable chip
// beside an empty field.

export interface FieldTicketRateSuggestion {
  rate: number;
  /** Where the number came from, in the GC's own terms. Shown verbatim. */
  source: string;
}

/** The GC's own loaded $/hr for a trade, as set in Time Tracking. No rate
 *  configured for that trade ⇒ no suggestion; a market average dressed up as
 *  "your rate" is exactly what utils/laborSamples refuses to do.
 *
 *  The number is a COST, not a bill rate. hooks/useLaborRates stores what the
 *  GC pays — wages plus burden, the payroll figure entered in Time Tracking —
 *  while FieldTicketLaborRow.rate is what the owner is billed. Offering the
 *  cost under a label that reads like a bill rate is how 18 carpentry hours go
 *  out at $58 instead of $95: the tap meant to stop money falling off the
 *  change order is the tap that leaves it off. So the chip says what the
 *  number is and what is still missing from it. */
export function suggestLaborRate(
  trade: string | undefined,
  rates: LaborRateMap | undefined,
): FieldTicketRateSuggestion | undefined {
  const key = normalizeTradeKey(trade);
  const rate = rates?.[key];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return undefined;
  const label = (trade ?? '').trim() || 'general';
  return {
    rate: round2(rate),
    source: `Your loaded ${label} cost from Time Tracking — add O&P`,
  };
}

/** Whole-word containment. Plain `includes` matched mid-word, which is how a
 *  ticket line reading "Forklift" pulled the day rate of a machine called
 *  "Lift". A name that only appears inside a longer word is not a name match. */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/** Loose name match between a ticket's free-text machine description and a
 *  piece of tracked equipment ("Mini excavator" ↔ "Kubota KX040 mini
 *  excavator"). Deliberately conservative: a wrong machine's day rate is a
 *  wrong dollar amount on a client-facing change order. */
function equipmentNameMatches(description: string, e: { name: string; make?: string; model?: string }): boolean {
  const d = description.trim().toLowerCase();
  if (d.length < 3) return false;
  const haystack = [e.name, e.make, e.model].filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return false;
  // Forward: the ticket's words appear in the machine's full name. This is the
  // sound direction — "mini excavator" inside "Kubota KX040 mini excavator".
  if (containsPhrase(haystack, d)) return true;
  // Reverse: a short machine name inside a verbose description. This is the
  // direction that goes wrong, so it carries its own floor — a machine named
  // in three characters or fewer ("Cat", "JD") is a brand fragment, not an
  // identification, and turns up inside unrelated free text ("scaffold cat
  // walk") where it would put that machine's day rate on a client-facing
  // change order.
  const n = e.name.trim().toLowerCase();
  return n.length >= 4 && containsPhrase(d, n);
}

/** Day rate ÷ a working day = the hourly figure a T&M line is written at —
 *  the same conversion utils/jobCostEngine and utils/wip already use, so an
 *  hour of excavator costs the same number everywhere in the app. */
export function suggestEquipmentRate(
  description: string,
  equipment: { name: string; make?: string; model?: string; dailyRate?: number }[] | undefined,
): FieldTicketRateSuggestion | undefined {
  const match = (equipment ?? []).find(
    e => equipmentNameMatches(description ?? '', e) &&
      typeof e.dailyRate === 'number' && e.dailyRate > 0,
  );
  if (!match || !match.dailyRate) return undefined;
  return {
    rate: round2(match.dailyRate / EQUIPMENT_HOURS_PER_DAY),
    source: `${match.name} — $${match.dailyRate}/day ÷ ${EQUIPMENT_HOURS_PER_DAY} hr`,
  };
}

/** When the office last attached a rate to this ticket, if ever. */
export function lastPricedAt(ticket: Pick<FieldTicket, 'auditTrail'>): string | undefined {
  const stamps = (ticket.auditTrail ?? [])
    .filter(e => e.action === FIELD_TICKET_PRICED_ACTION)
    .map(e => e.timestamp)
    .filter(Boolean)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : undefined;
}

/**
 * The sentence that separates what the owner's rep signed (hours and
 * quantities) from what the office added afterwards (the rates), or '' when
 * the ticket was never priced after signing.
 *
 * ONE wording for both documents a disputed T&M charge is argued over — the
 * change order and the field-ticket PDF. The PDF prints the full rates and
 * total right above the signature block, so without this line a ticket priced
 * in the office reads as if the rep approved the dollars too (audit #7,
 * review 2). `withSigner` names who signed and when, for a document (the PDF)
 * that does not already say it in the same breath.
 */
export function pricingProvenanceNote(
  ticket: Pick<FieldTicket, 'auditTrail' | 'authorization'>,
  opts: { withSigner?: boolean } = {},
): string {
  const pricedAt = lastPricedAt(ticket);
  if (!pricedAt) return '';
  const auth = ticket.authorization;
  const who = opts.withSigner && auth
    ? ` by ${auth.name} ${formatTicketDate(auth.signedAt)}`
    : '';
  return `Hours and quantities are as signed on site${who}; T&M rates were applied in the office ${formatTicketDate(pricedAt)}.`;
}

// ─── Ticket → ChangeOrder ────────────────────────────────────────────────────

/**
 * Dedupe marker stamped into the auditTrail of every CO built from a ticket.
 * `detail` is the ticket id. Same mechanism as leakCoDraft's AUTO_DRAFT_ACTION
 * and for the same reason — audit_trail syncs, so the guard survives a cache
 * wipe and a reinstall.
 */
export const FIELD_TICKET_CO_ACTION = 'converted_from_field_ticket';

/** True if this ChangeOrder was built from a signed field ticket. */
export function isFieldTicketCO(co: ChangeOrder): boolean {
  return (co.auditTrail ?? []).some(e => e.action === FIELD_TICKET_CO_ACTION);
}

/**
 * The already-converted check. Two independent signals, either one is enough:
 *   1. the ticket's own convertedChangeOrderId still resolves to a live CO
 *   2. any CO carries an audit entry whose detail is this ticket's id
 * (2) is the durable one — it holds even if the local ticket cache was wiped
 * and rehydrated before the conversion flag synced.
 */
export function findChangeOrderForTicket(
  ticket: Pick<FieldTicket, 'id' | 'convertedChangeOrderId'>,
  changeOrders: ChangeOrder[],
): ChangeOrder | undefined {
  const byMarker = changeOrders.find(
    co => (co.auditTrail ?? []).some(
      e => e.action === FIELD_TICKET_CO_ACTION && e.detail === ticket.id,
    ),
  );
  if (byMarker) return byMarker;
  if (ticket.convertedChangeOrderId) {
    return changeOrders.find(co => co.id === ticket.convertedChangeOrderId);
  }
  return undefined;
}

export interface FieldTicketConversionCheck {
  canConvert: boolean;
  /** One sentence, safe to show the user verbatim. */
  reason?: string;
  /** Set when the ticket has already been billed. */
  existingChangeOrderId?: string;
  /** Signed work carrying no rate. These rows produce NO line item (see
   *  groupHourlyByRate), so converting drops them silently unless the caller
   *  says so — which is what `warning` is for. */
  unpricedRowCount?: number;
  /** Non-blocking. Must be shown verbatim in the conversion confirmation when
   *  present: a half-priced ticket still converts, and the hours it leaves
   *  behind are the money this feature exists to protect. */
  warning?: string;
}

/** The sentence a half-priced ticket has to say out loud before it converts. */
export function unpricedConversionWarning(totals: FieldTicketTotals): string | undefined {
  const n = totals.unpricedRowCount;
  if (n <= 0) return undefined;
  const hours = totals.unpricedLaborHours > 0
    ? ` (${totals.unpricedLaborHours} labor hr)`
    : '';
  return `${n} signed line${n === 1 ? '' : 's'}${hours} still ha${n === 1 ? 's' : 've'} no rate. ` +
    `${n === 1 ? 'It' : 'They'} will NOT be on this change order. Price the ticket first if you want that work paid.`;
}

/**
 * The single gate every conversion entry point must pass through.
 * Order matters — "already billed" is reported ahead of "unsigned" so a
 * converted ticket never reads as if it needs another signature.
 */
export function checkFieldTicketConversion(
  ticket: FieldTicket,
  changeOrders: ChangeOrder[],
): FieldTicketConversionCheck {
  const existing = findChangeOrderForTicket(ticket, changeOrders);
  if (existing) {
    return {
      canConvert: false,
      reason: `Already billed on Change Order #${existing.number}.`,
      existingChangeOrderId: existing.id,
    };
  }
  if (ticket.status === 'converted') {
    // Flag set but the CO isn't in this device's cache yet. Refusing is the
    // only safe answer: converting again would double-bill the owner.
    return { canConvert: false, reason: 'This ticket has already been converted to a change order.' };
  }
  if (ticket.status === 'void') {
    return { canConvert: false, reason: 'This ticket was voided.' };
  }
  if (!isFieldTicketAuthorized(ticket)) {
    return { canConvert: false, reason: 'Only a signed ticket can become a change order. Get the signature on site first.' };
  }
  const totals = computeFieldTicketTotals(ticket);
  if (totals.billableTotal <= 0) {
    return {
      canConvert: false,
      reason: 'Add rates or unit costs — a change order needs a dollar amount.',
      unpricedRowCount: totals.unpricedRowCount,
    };
  }
  return {
    canConvert: true,
    unpricedRowCount: totals.unpricedRowCount,
    warning: unpricedConversionWarning(totals),
  };
}

/**
 * Group hourly rows by RATE, so every emitted line satisfies
 * quantity × unitPrice === total exactly.
 *
 * A single blended-rate line does NOT hold: 14.5 hr of mixed $62/$88 labor
 * blends to $66.48/hr, and 14.5 × 66.48 = $963.96 against a $964.00 total. On
 * a client-facing change order a line whose own arithmetic is four cents off
 * is an invitation to argue about the whole ticket. Grouping by rate also
 * happens to be exactly how a GC writes a T&M change order by hand:
 * "Laborer @ $62/hr — 12 hrs", "Foreman @ $88/hr — 2.5 hrs".
 *
 * Rows with no rate are skipped entirely — a $0 line reads as an error.
 * Groups keep first-appearance order so the output is deterministic.
 */
function groupHourlyByRate(
  rows: { hours?: number; rate?: number; label: string }[],
): { rate: number; hours: number; total: number; labels: string[] }[] {
  const byRate = new Map<number, { rate: number; hours: number; total: number; labels: string[] }>();
  for (const row of rows) {
    const hours = num(row.hours);
    const rate = num(row.rate);
    if (hours <= 0 || rate <= 0) continue;
    const group = byRate.get(rate) ?? { rate, hours: 0, total: 0, labels: [] };
    group.hours = round2(group.hours + hours);
    group.total = round2(group.hours * rate);
    const label = row.label.trim();
    if (label && !group.labels.includes(label)) group.labels.push(label);
    byRate.set(rate, group);
  }
  return [...byRate.values()];
}

/** The CO line items a ticket becomes. Every line reconciles exactly. */
function buildTicketLineItems(ticket: FieldTicket): ChangeOrderLineItem[] {
  const t = computeFieldTicketTotals(ticket);
  const items: ChangeOrderLineItem[] = [];

  for (const g of groupHourlyByRate((ticket.labor ?? []).map(r => ({
    hours: r.hours, rate: r.rate, label: r.trade,
  })))) {
    items.push({
      id: generateUUID(),
      name: `T&M labor${g.labels.length ? ` — ${g.labels.join(', ')}` : ''}`,
      description: `${g.hours} hr${g.hours === 1 ? '' : 's'} @ $${g.rate}/hr`,
      quantity: g.hours,
      unit: 'hr',
      unitPrice: g.rate,
      total: g.total,
      isNew: true,
    });
  }

  if (t.materialCost > 0) {
    const names = (ticket.materials ?? [])
      .filter(r => materialRowTotal(r) > 0)
      .map(r => r.description.trim())
      .filter(Boolean);
    items.push({
      id: generateUUID(),
      name: 'T&M materials',
      description: names.length ? names.join(', ') : 'Materials consumed on extra work',
      quantity: 1,
      unit: 'ls',
      unitPrice: t.materialCost,
      total: t.materialCost,
      isNew: true,
    });
  }

  for (const g of groupHourlyByRate((ticket.equipment ?? []).map(r => ({
    hours: r.hours, rate: r.rate, label: r.description,
  })))) {
    items.push({
      id: generateUUID(),
      name: `T&M equipment${g.labels.length ? ` — ${g.labels.join(', ')}` : ''}`,
      description: `${g.hours} hr${g.hours === 1 ? '' : 's'} @ $${g.rate}/hr`,
      quantity: g.hours,
      unit: 'hr',
      unitPrice: g.rate,
      total: g.total,
      isNew: true,
    });
  }

  if (t.markupAmount > 0) {
    items.push({
      id: generateUUID(),
      name: `Overhead & profit (${t.markupPercent}%)`,
      description: 'Contract markup on time & materials',
      quantity: 1,
      unit: 'ls',
      unitPrice: t.markupAmount,
      total: t.markupAmount,
      isNew: true,
    });
  }

  return items;
}

/** Wording used on the CO description + the PDF. */
const AUTHORIZER_LABEL: Record<string, string> = {
  owner_rep: "owner's representative",
  client: 'client',
  architect: 'architect',
  cm: 'construction manager',
  other: 'authorized representative',
};

export function authorizerRoleLabel(role: string | undefined): string {
  return AUTHORIZER_LABEL[role ?? 'other'] ?? AUTHORIZER_LABEL.other;
}

/** ISO (or ISO-datetime) → "Jul 26, 2026". Local-safe for date-only input. */
export function formatTicketDate(raw: string): string {
  if (!raw) return '';
  const d = raw.length === 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface BuildCOFromTicketInput {
  ticket: FieldTicket;
  /** Existing COs on the project — drives the next CO number AND the
   *  approved-CO roll-up in originalContractValue. */
  existingCOs: ChangeOrder[];
  /** Base contract value: estimate grandTotal (approved COs are added here). */
  baseContractValue: number;
  nowISO: string;
}

/**
 * Build the ChangeOrder a signed ticket becomes. Pure — the caller persists it
 * and stamps `convertedChangeOrderId` back onto the ticket.
 *
 * CALLERS MUST GATE ON checkFieldTicketConversion FIRST. This function will
 * happily build a CO from anything; the gate is what stops an unsigned ticket
 * or a double-bill, and it is tested separately.
 */
export function buildChangeOrderFromTicket(input: BuildCOFromTicketInput): ChangeOrder {
  const { ticket, existingCOs, baseContractValue, nowISO } = input;
  const totals = computeFieldTicketTotals(ticket);
  const auth = ticket.authorization;

  const nextNumber = existingCOs.reduce((max, c) => Math.max(max, c.number || 0), 0) + 1;

  const approvedCOsTotal = existingCOs
    .filter(c => c.status === 'approved')
    .reduce((s, c) => s + (c.changeAmount ?? 0), 0);
  const originalContractValue = baseContractValue + approvedCOsTotal;

  const signedBy = auth
    ? `Signed on site ${formatTicketDate(auth.signedAt)} by ${auth.name}` +
      `${auth.title ? ` (${auth.title})` : ''}, ${authorizerRoleLabel(auth.role)}.`
    : '';

  // Separate what the rep attested to from what the office added afterwards.
  // The rep signs for hours and quantities (that is the wording on the pad and
  // on the PDF); when the rates were attached later, the document has to say so
  // in its own words — otherwise a priced-after-the-fact ticket reads as if the
  // owner's rep approved the dollars too, which is exactly the claim a disputed
  // T&M change order turns on.
  // (The CO already names the signer in `signedBy`, so no signer here.)
  const pricedNote = pricingProvenanceNote(ticket);

  const description = [
    `${fieldTicketLabel(ticket.number)} — extra work performed ${formatTicketDate(ticket.date)}: ${ticket.workDescription.trim()}`,
    signedBy,
    pricedNote,
  ].filter(Boolean).join(' ');

  const audit: COAuditEntry[] = [{
    id: generateUUID(),
    action: FIELD_TICKET_CO_ACTION,
    actor: auth?.name ?? 'Field ticket',
    timestamp: nowISO,
    // DEDUPE KEY — findChangeOrderForTicket matches on this.
    detail: ticket.id,
  }];

  return {
    id: generateUUID(),
    number: nextNumber,
    projectId: ticket.projectId,
    date: nowISO,
    description,
    reason: ticket.reasonExtra.trim(),
    lineItems: buildTicketLineItems(ticket),
    originalContractValue,
    changeAmount: totals.billableTotal,
    newContractTotal: round2(originalContractValue + totals.billableTotal),
    // A signed field ticket is authorized WORK, not an approved CO. It still
    // has to go through the owner's normal CO approval. Starting it at 'draft'
    // matches leakCoDraft and keeps the GC in control of what gets sent.
    status: 'draft',
    auditTrail: audit,
    createdAt: nowISO,
    updatedAt: nowISO,
  };
}

/** The patch applied to the ticket once its CO exists. Kept here so the
 *  screen and any future automation stamp identical fields. */
export function ticketConversionPatch(co: ChangeOrder, nowISO: string): Partial<FieldTicket> {
  return {
    status: 'converted',
    convertedChangeOrderId: co.id,
    convertedAt: nowISO,
  };
}

/** Empty ticket scaffold — one place that decides what a new ticket starts as. */
export function emptyFieldTicket(opts: {
  id: string;
  projectId: string;
  number: number;
  nowISO: string;
  sourceDailyReportId?: string;
  markupPercent?: number;
}): FieldTicket {
  return {
    id: opts.id,
    number: opts.number,
    projectId: opts.projectId,
    date: opts.nowISO.slice(0, 10),
    workDescription: '',
    reasonExtra: '',
    sourceDailyReportId: opts.sourceDailyReportId,
    labor: [],
    materials: [],
    equipment: [],
    photos: [],
    markupPercent: opts.markupPercent ?? 0,
    status: 'draft',
    createdAt: opts.nowISO,
    updatedAt: opts.nowISO,
  };
}
