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

  return {
    laborHours, laborCost, materialCost, equipmentHours, equipmentCost,
    subtotal, markupPercent, markupAmount, billableTotal, unpricedRowCount,
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

/**
 * Which keys of an update would illegally rewrite sealed content. Empty array
 * means the update is allowed. Callers reject the whole update if non-empty —
 * a partial apply would be worse than a refusal.
 */
export function sealedFieldTicketViolations(
  ticket: Pick<FieldTicket, 'status'>,
  updates: Partial<FieldTicket>,
): string[] {
  if (!isFieldTicketSealed(ticket)) return [];
  const allowed = new Set<string>(SEALED_FIELD_TICKET_MUTABLE_KEYS as readonly string[]);
  return Object.keys(updates).filter(k => !allowed.has(k));
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
    return { canConvert: false, reason: 'Add rates or unit costs — a change order needs a dollar amount.' };
  }
  return { canConvert: true };
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

  const description = [
    `${fieldTicketLabel(ticket.number)} — extra work performed ${formatTicketDate(ticket.date)}: ${ticket.workDescription.trim()}`,
    signedBy,
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
