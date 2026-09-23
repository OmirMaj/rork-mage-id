// propertyMirror — the pure half of the Property Manager portfolio's Supabase
// mirror (contexts/PropertyContext.tsx owns the I/O).
//
// WHY THIS EXISTS. Properties and work orders lived only in AsyncStorage under
// `mageid_*`, which AuthContext.wipeLocalUserCache sweeps on every sign-out, so
// one sign-out erased a PM's whole portfolio with no warning (audit round 2,
// #20). The server copy is supabase/migrations/20260918180000_property_manager_
// mirror.sql; this file maps records to rows, builds the per-field patch an
// edit sends, and decides, on every sign-in and refresh, which copy of each
// record the device shows. Pure so scripts/validate-property-mirror.ts can run
// the real merge and the real two-device case.

import type { ManagedProperty, WorkOrder, WorkOrderPriority, WorkOrderStatus } from '@/types';
import type { ThemeColors } from '@/constants/colors';

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
  /** Device records the server has never seen (creates) — upload these. */
  push: T[];
}

/**
 * Reconcile the device copy with the server copy, record by record. Runs on
 * sign-in AND on every refresh (app foreground, focus of a PM screen, pull to
 * refresh), so it must never be the thing that overwrites another device.
 *
 *  - The SERVER copy of a live record wins, full stop, unless that record's id
 *    is in `pending`: a write THIS device made that has not landed yet (still
 *    in the offline queue, on the wire, or sent after this read started). Only
 *    then is the device copy shown, because the server does not have its edit
 *    yet. It is still never pushed: that edit already travels as a per-field
 *    patch (workOrderPatch / propertyPatch).
 *    WHY NOT TIMESTAMPS (Phase 0 review, round 1): updatedAt comes from each
 *    device's own clock, and a queued offline patch carries the time it was
 *    MADE, not the time it lands. The phone marks a job Done offline (T1), the
 *    laptop edits the description online (T2), the phone's queue drains: the
 *    server now says Done at T1, older than the laptop's T2, so "newer copy
 *    wins" showed the laptop's Open on every refresh until someone edited the
 *    job again. Clock skew does the same. "Has this device got a write in
 *    flight for this record?" is a fact the device knows; which clock is right
 *    is not.
 *  - A server tombstone (deleted_at set) removes the device copy. Delete wins:
 *    a device that edited the record before it heard of the delete does not
 *    bring it back, because the only way to bring it back was a whole-row
 *    push, carrying every stale column with it.
 *  - A device record the server has never seen is kept AND pushed (a create).
 *    This is the upgrade path too: every portfolio written before the mirror
 *    shipped uploads on its first signed-in load. If its create is already
 *    pending it is kept but not pushed again.
 *  - A live server row this device has DELETED (no device copy, but a write
 *    pending for it: the tombstone) stays gone until the tombstone lands.
 *
 * So the ONLY rows this ever pushes are rows the server does not have: it can
 * create, it cannot overwrite. `fromRow` is the table's mapper; a row whose id
 * is missing is ignored.
 */
export function mergeMirror<T extends { id: string; createdAt: string; updatedAt: string }>(
  local: readonly T[],
  serverRows: readonly Row[],
  fromRow: (r: Row) => T,
  pending: ReadonlySet<string> = new Set(),
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
    if (deleted) continue;
    // A pending write for a record this device no longer holds is a delete
    // whose tombstone has not landed yet: the server's live row is older news.
    if (!mine && pending.has(server.id)) continue;
    // Shown, not pushed — see above.
    byId.set(server.id, mine && pending.has(server.id) ? mine : server);
  }
  for (const [id, mine] of localById) {
    if (seen.has(id)) continue;
    byId.set(id, mine);
    // A create that is already queued or on the wire is not sent again:
    // refresh runs on every focus and foreground, and a second copy draining
    // after another device edited the record would overwrite that edit.
    if (!pending.has(id)) push.push(mine);
  }
  const merged = [...byId.values()].sort((a, b) => t(b.createdAt) - t(a.createdAt));
  return { merged, push };
}

/** The record ids of `table` that have a write waiting in the offline queue.
 *  Every queued write names its record in data.id (the queue's own per-record
 *  FIFO relies on it). */
export function queuedRecordIds(
  table: string,
  entries: readonly { table: string; data?: Record<string, unknown> | null }[],
): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    const id = e?.data?.id;
    if (e?.table === table && typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

// ── Per-field patches ───────────────────────────────────────────────────────
// An EDIT sends only the columns it changed, plus updated_at, through the
// offline queue's 'update' op. Creates and tombstones stay whole-row upserts.
// Diffed against the device's copy BEFORE the edit, so a stale device that
// fixes a typo in the description sends the description and nothing else: it
// cannot write back the status, completed_at or assignee it never touched.

/** Columns an edit may never send: identity, owner, and the tombstone. */
const NEVER_PATCHED = new Set(['id', 'user_id', 'created_at', 'updated_at', 'deleted_at']);

const sameCell = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);

function rowPatch(before: Row, after: Row, companions: Record<string, readonly string[]> = {}): Row | null {
  const changed: Row = {};
  let any = false;
  for (const k of Object.keys(after)) {
    if (NEVER_PATCHED.has(k)) continue;
    if (sameCell(before[k], after[k])) continue;
    changed[k] = after[k] ?? null;
    any = true;
  }
  if (!any) return null;
  // A column that is only meaningful WITH another one travels with it, changed
  // or not, so the pair is never half-written onto the server.
  for (const k of Object.keys(changed)) {
    for (const c of companions[k] ?? []) {
      if (!(c in changed) && c in after) changed[c] = after[c] ?? null;
    }
  }
  return { id: after.id, ...changed, updated_at: after.updated_at };
}

/** completed_at belongs to the status that set it. A stale device that moves
 *  an order out of Done had completedAt undefined in its own (pre-Done) copy
 *  too, so a plain diff dropped the clear and left the server "In progress,
 *  completed 10:00" (Phase 0 review, round 1). Sending it whenever the status
 *  is sent keeps the two in step. */
const WORK_ORDER_COMPANIONS: Record<string, readonly string[]> = { status: ['completed_at'] };

/** The 'update' payload for a work-order edit, or null when nothing changed. */
export function workOrderPatch(before: WorkOrderRecord, after: WorkOrderRecord, userId: string): Row | null {
  return rowPatch(workOrderToRow(before, userId), workOrderToRow(after, userId), WORK_ORDER_COMPANIONS);
}

/** The 'update' payload for a property edit, or null when nothing changed. */
export function propertyPatch(before: ManagedProperty, after: ManagedProperty, userId: string): Row | null {
  return rowPatch(propertyToRow(before, userId), propertyToRow(after, userId));
}

// ── Form input ──────────────────────────────────────────────────────────────

/** The edit sheet's text fields, exactly as the PM sees them. */
export interface PropertyEditForm {
  name: string; address: string; propertyType: string; ownerName: string;
  ownerPhone: string; ownerEmail: string; units: string; notes: string;
}

/** A property as the edit sheet fills in its fields when it opens. */
export function propertyEditForm(p: Partial<ManagedProperty> | null | undefined): PropertyEditForm {
  return {
    name: p?.name ?? '', address: p?.address ?? '', propertyType: p?.propertyType ?? '',
    ownerName: p?.ownerName ?? '', ownerPhone: p?.ownerPhone ?? '', ownerEmail: p?.ownerEmail ?? '',
    units: p?.units != null ? String(p.units) : '', notes: p?.notes ?? '',
  };
}

/** The updates a save sends: ONLY the fields he changed since the sheet
 *  opened. Diffed against the form as it OPENED, not against the device copy
 *  at save time: a refresh while the sheet is open (the app coming back to the
 *  front) can bring in the other device's owner phone, and a diff against that
 *  would count the sheet's old value as an edit and write it back over it
 *  (Phase 0 review, round 1). */
export function propertyEditUpdates(opened: PropertyEditForm, form: PropertyEditForm): Partial<ManagedProperty> {
  const clean = (f: PropertyEditForm): Partial<ManagedProperty> => ({
    name: f.name.trim(),
    address: f.address.trim() || undefined,
    propertyType: f.propertyType.trim() || undefined,
    ownerName: f.ownerName.trim() || undefined,
    ownerPhone: f.ownerPhone.trim() || undefined,
    // Contact list only. Never passed to an invite, portal or grant.
    ownerEmail: f.ownerEmail.trim() || undefined,
    units: parseUnitsInput(f.units),
    notes: f.notes.trim() || undefined,
  });
  const before = clean(opened);
  const after = clean(form);
  const out: Partial<ManagedProperty> = {};
  for (const k of Object.keys(after) as (keyof ManagedProperty)[]) {
    if ((before[k] ?? null) !== (after[k] ?? null)) (out as Record<string, unknown>)[k] = after[k];
  }
  return out;
}

/** A typed budget ("$1,234.56") as dollars to the cent — the column is
 *  numeric(12,2). Rounding to whole dollars used to drop the cents. */
export function parseBudgetInput(raw: string): number | undefined {
  const n = parseFloat(String(raw ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100) / 100;
}

/** A typed unit count as a whole, non-negative number (the column is an
 *  integer with a >= 0 check), or undefined when blank or not a number. */
export function parseUnitsInput(raw: string): number | undefined {
  const s = String(raw ?? '').replace(/[,\s]/g, '');
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : undefined;
}

// ── "Post for bids" reach ───────────────────────────────────────────────────
// A post reaches a contractor only when contractors can both be matched to it
// (SERVICE_AREA_SETUP_ENABLED: nobody has a service area until the editor
// ships) and read it (RFP_BROWSE_ENABLED: reading other people's posts is off
// for 1.0). Until both are on, "Post it to MAGE ID contractors who cover your
// area" was a promise to nobody, and the PM's order sat at Out for bids for
// good. The screen passes the two flags; this says what it may claim.

export interface PostForBidsGate {
  /** The tile works and its subtitle may promise reach (the screen owns that
   *  sentence: app/work-order.tsx POST_FOR_BIDS_REACH_SUBTITLE). */
  open: boolean;
  /** What the tile and an Out-for-bids order say instead, when not open. */
  reason: string | null;
}

export function postForBidsGate(browseOpen: boolean, matchingLive: boolean): PostForBidsGate {
  if (browseOpen === true && matchingLive === true) return { open: true, reason: null };
  return {
    open: false,
    reason: browseOpen === true
      // Readable by a contractor who goes looking, but nobody is alerted.
      ? 'MAGE cannot alert contractors about new posts yet. Send it to one you know.'
      : 'No contractor can see posts on MAGE yet. Send it to one you know.',
  };
}

// ── Dispatch signature ──────────────────────────────────────────────────────
/** Who the dispatch text is signed by. A PM's onboarding skips contractor
 *  setup, so company branding is usually empty for him; his profile name is
 *  the honest fallback (a text signed by nobody reads like spam). */
export function dispatchSenderName(
  branding: { contactName?: string | null; companyName?: string | null } | null | undefined,
  profileName: string | null | undefined,
): string | undefined {
  for (const v of [branding?.contactName, branding?.companyName, profileName]) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) return s;
  }
  return undefined;
}

// ── Status and priority colours ─────────────────────────────────────────────
// Theme tokens, not hex: the open status was still the pre-rebrand orange
// (#FF6A1A) and none of these followed dark mode. `fg` is text/border, `bg`
// the soft wash behind it; each pair is a token pair the theme defines for
// exactly that use, so contrast holds in both themes.

export interface Tone { fg: string; bg: string }

type ToneTokens = Pick<ThemeColors,
  'accentLabel' | 'accentSoft' | 'info' | 'neutralSoft' | 'textSecondary' | 'textMuted'
  | 'successLabel' | 'successSoft' | 'warningLabel' | 'warningSoft' | 'dangerLabel' | 'dangerSoft'>;

export function workOrderStatusTone(t: ToneTokens, status: WorkOrderStatus): Tone {
  switch (status) {
    case 'open': return { fg: t.warningLabel, bg: t.warningSoft };
    case 'posted_for_bids': return { fg: t.textSecondary, bg: t.neutralSoft };
    case 'assigned': return { fg: t.info, bg: t.neutralSoft };
    case 'in_progress': return { fg: t.accentLabel, bg: t.accentSoft };
    case 'done': return { fg: t.successLabel, bg: t.successSoft };
    case 'cancelled':
    default: return { fg: t.textMuted, bg: t.neutralSoft };
  }
}

export function workOrderPriorityTone(t: ToneTokens, priority: WorkOrderPriority): Tone {
  switch (priority) {
    case 'emergency': return { fg: t.dangerLabel, bg: t.dangerSoft };
    case 'high': return { fg: t.warningLabel, bg: t.warningSoft };
    case 'normal': return { fg: t.info, bg: t.neutralSoft };
    case 'low':
    default: return { fg: t.textMuted, bg: t.neutralSoft };
  }
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
 * 'assigned' on the server. PropertyContext re-reads the server on foreground,
 * focus and pull, but the award screen should not wait for that, so it applies
 * the same change locally through updateWorkOrder (a per-field patch, so it
 * restates what the server already holds and overwrites nothing else). Same
 * filter as the server PATCH: this RFP's orders that are still open or out for
 * bids.
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
