// propertyMirror — the pure half of the Property Manager portfolio's Supabase
// mirror (contexts/PropertyContext.tsx owns the I/O).
//
// WHY THIS EXISTS. Properties and work orders lived only in AsyncStorage under
// `mageid_*`, which AuthContext.wipeLocalUserCache sweeps on every sign-out, so
// one sign-out erased a PM's whole portfolio with no warning (audit round 2,
// #20). The server copy is supabase/migrations/20260918180000_property_manager_
// mirror.sql; this file maps records to rows and decides, on every sign-in,
// which copy of each record wins. Pure so scripts/validate-property-mirror.ts
// can run the real merge.

import type { ManagedProperty, WorkOrder, WorkOrderPriority, WorkOrderStatus } from '@/types';

export const PROPERTY_TABLES = {
  properties: 'managed_properties',
  workOrders: 'work_orders',
} as const;

/** Legacy, un-scoped keys (v1 wrote these). Read once, adopted, removed. */
export const LEGACY_PROPERTIES_KEY = 'mageid_managed_properties';
export const LEGACY_WORK_ORDERS_KEY = 'mageid_work_orders';

/**
 * The device cache is keyed by user. The cache is still under `mageid_`, so
 * the tenant sweep removes it on sign-out (it is a cache now — the record is on
 * the server); the per-user suffix means that even in the window before the
 * sweep runs, user B's session can never read user A's portfolio off disk.
 */
export function propertyCacheKeys(userId: string | null): { properties: string; workOrders: string } {
  const who = userId ?? 'signed-out';
  return {
    properties: `${LEGACY_PROPERTIES_KEY}::${who}`,
    workOrders: `${LEGACY_WORK_ORDERS_KEY}::${who}`,
  };
}

/**
 * The WorkOrder as the mirror stores it. `rfpId` (the public_bids id it was
 * posted as) now lives on WorkOrder itself and round-trips through the rfp_id
 * column; the alias stays so callers keep one name for the mirrored record.
 */
export type WorkOrderRecord = WorkOrder;

type Row = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
/** Timestamps compare as instants; the server returns +00:00, the device Z. */
const iso = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
};
const cents = (v: number | undefined): number | null => (v == null ? null : Math.round(v * 100) / 100);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function propertyToRow(p: ManagedProperty, userId: string, deletedAt: string | null = null): Row {
  return {
    id: p.id,
    user_id: userId,
    name: p.name ?? '',
    address: p.address ?? null,
    property_type: p.propertyType ?? null,
    units: p.units == null ? null : Math.max(0, Math.round(p.units)),
    owner_name: p.ownerName ?? null,
    owner_phone: p.ownerPhone ?? null,
    owner_email: p.ownerEmail ?? null,
    notes: p.notes ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    deleted_at: deletedAt,
  };
}

export function propertyFromRow(r: Row): ManagedProperty {
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    address: str(r.address),
    propertyType: str(r.property_type),
    units: num(r.units),
    ownerName: str(r.owner_name),
    ownerPhone: str(r.owner_phone),
    ownerEmail: str(r.owner_email),
    notes: str(r.notes),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
  };
}

export function workOrderToRow(w: WorkOrderRecord, userId: string, deletedAt: string | null = null): Row {
  return {
    id: w.id,
    user_id: userId,
    property_id: w.propertyId,
    title: w.title ?? '',
    description: w.description ?? null,
    category: w.category ?? null,
    priority: w.priority,
    status: w.status,
    budget: cents(w.budget),
    assigned_contact_id: w.assignedContactId ?? null,
    assigned_contact_name: w.assignedContactName ?? null,
    assigned_at: w.assignedAt ?? null,
    linked_lead_id: w.linkedLeadId ?? null,
    // The column is uuid; a malformed id would make the whole upsert fail
    // terminally and lose the rest of the edit.
    rfp_id: w.rfpId && UUID_RE.test(w.rfpId) ? w.rfpId : null,
    completed_at: w.completedAt ?? null,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
    deleted_at: deletedAt,
  };
}

export function workOrderFromRow(r: Row): WorkOrderRecord {
  return {
    id: String(r.id),
    propertyId: String(r.property_id ?? ''),
    title: str(r.title) ?? '',
    description: str(r.description),
    category: str(r.category),
    priority: (str(r.priority) ?? 'normal') as WorkOrderPriority,
    status: (str(r.status) ?? 'open') as WorkOrderStatus,
    budget: num(r.budget),
    assignedContactId: str(r.assigned_contact_id),
    assignedContactName: str(r.assigned_contact_name),
    assignedAt: iso(r.assigned_at),
    linkedLeadId: str(r.linked_lead_id),
    rfpId: str(r.rfp_id),
    completedAt: iso(r.completed_at),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
  };
}

const t = (s: string | undefined): number => {
  const n = s ? Date.parse(s) : NaN;
  return Number.isFinite(n) ? n : 0;
};

export interface MergeResult<T> {
  /** What the device should now hold, newest-created first. */
  merged: T[];
  /** Device copies the server does not have (or has older) — upload these. */
  push: T[];
}

/**
 * Reconcile the device copy with the server copy, record by record.
 *
 *  - Newer `updatedAt` wins, whichever side it is on. Ties go to the server
 *    (it is what every other device sees).
 *  - A server tombstone (deleted_at set) removes the device copy unless the
 *    device edited it AFTER the delete — a later edit resurrects, as a PM
 *    would expect if he re-opened the work order on the other phone.
 *  - A device record the server has never seen is kept AND pushed. This is the
 *    upgrade path: every portfolio written before the mirror shipped uploads on
 *    its first signed-in load instead of waiting for its next edit.
 *
 * `fromRow` is the table's mapper; a row whose id is missing is ignored.
 */
export function mergeMirror<T extends { id: string; createdAt: string; updatedAt: string }>(
  local: readonly T[],
  serverRows: readonly Row[],
  fromRow: (r: Row) => T,
): MergeResult<T> {
  const byId = new Map<string, T>();
  const push: T[] = [];
  const localById = new Map(local.filter(x => x && typeof x.id === 'string').map(x => [x.id, x]));
  const seen = new Set<string>();

  for (const row of serverRows) {
    if (!row || typeof row.id !== 'string' || !row.id) continue;
    const server = fromRow(row);
    seen.add(server.id);
    const mine = localById.get(server.id);
    const deleted = row.deleted_at != null && row.deleted_at !== '';
    if (deleted) {
      if (mine && t(mine.updatedAt) > t(server.updatedAt)) {
        byId.set(mine.id, mine);
        push.push(mine);
      }
      continue;
    }
    if (mine && t(mine.updatedAt) > t(server.updatedAt)) {
      byId.set(mine.id, mine);
      push.push(mine);
    } else {
      byId.set(server.id, server);
    }
  }
  for (const [id, mine] of localById) {
    if (seen.has(id)) continue;
    byId.set(id, mine);
    push.push(mine);
  }
  const merged = [...byId.values()].sort((a, b) => t(b.createdAt) - t(a.createdAt));
  return { merged, push };
}

// ── Dispatch message ────────────────────────────────────────────────────────
// "Dispatch to contractor" used to set status 'assigned' and tell no one. The
// PM now sends the job himself, from his own phone, with everything the work
// order already holds; MAGE does not message the contractor on his behalf, and
// the screen says so.

export interface DispatchMessageInput {
  workOrder: Pick<WorkOrder, 'title' | 'description' | 'priority' | 'category' | 'budget'>;
  propertyName?: string;
  propertyAddress?: string;
  contactFirstName?: string;
  senderName?: string;
}

const PRIORITY_WORDS: Record<WorkOrderPriority, string> = {
  low: 'Low priority',
  normal: 'Normal priority',
  high: 'High priority',
  emergency: 'EMERGENCY',
};

export function composeDispatchMessage(i: DispatchMessageInput): { subject: string; body: string } {
  const w = i.workOrder;
  const where = [i.propertyName, i.propertyAddress].filter(Boolean).join(', ');
  const subject = `${w.priority === 'emergency' ? 'EMERGENCY: ' : ''}${w.title}${where ? ` at ${where}` : ''}`;
  const details = [
    `${w.title} (${PRIORITY_WORDS[w.priority] ?? w.priority})`,
    where ? `Where: ${where}` : null,
    w.category ? `Trade: ${w.category}` : null,
    w.budget != null ? `Budget: $${(Math.round(w.budget * 100) / 100).toFixed(2)}` : null,
  ].filter((l): l is string => !!l);
  const parts = [
    i.contactFirstName ? `Hi ${i.contactFirstName},` : 'Hi,',
    ['Can you take this job?', ...details].join('\n'),
    w.description?.trim() || null,
    'Please reply to confirm you can take it and when you can be there.' + (i.senderName ? `\n— ${i.senderName}` : ''),
  ].filter((l): l is string => !!l);
  return { subject, body: parts.join('\n\n') };
}

export function buildDispatchSmsUrl(phone: string, msg: { body: string }, platform: 'ios' | 'android' | 'web' | string): string {
  const to = phone.replace(/[^\d+]/g, '');
  // iOS wants `&body=` after a recipient; Android and web take `?body=`.
  const sep = platform === 'ios' ? '&' : '?';
  return `sms:${to}${sep}body=${encodeURIComponent(msg.body)}`;
}

export function buildDispatchMailtoUrl(email: string, msg: { subject: string; body: string }): string {
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body)}`;
}

/**
 * The device half of an RFP award. award-rfp PATCHes the PM's work order to
 * 'assigned' on the server, but PropertyContext only reads the server copy at
 * sign-in — so the PM's list kept saying "Out for bids" for the rest of the
 * session, and his next edit upserted the whole stale row (newer updated_at),
 * nulling the assignee the award had just recorded. The award screen applies
 * the same change locally through updateWorkOrder. Same filter as the server
 * PATCH: this RFP's orders that are still open or out for bids.
 */
export function workOrdersAssignedByAward(
  workOrders: readonly WorkOrderRecord[],
  bidId: string,
  companyName: string | null,
  nowIso: string,
): { id: string; updates: Partial<WorkOrderRecord> }[] {
  if (!bidId) return [];
  return workOrders
    .filter(w => w.rfpId === bidId && (w.status === 'open' || w.status === 'posted_for_bids'))
    .map(w => ({
      id: w.id,
      updates: { status: 'assigned' as const, assignedContactName: companyName ?? undefined, assignedAt: nowIso },
    }));
}
