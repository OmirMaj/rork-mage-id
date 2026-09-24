// utils/projectContextPure.ts — pure helpers pulled out of
// contexts/ProjectContext.tsx so the loader/mapper decisions that lost money
// (MONEY-F1/F3), leaked tenancy (AUTH-F2/F5), dropped offline records (SYNC-F3)
// and starved the COI watcher (PRODUCT-F1) are unit-tested rather than buried
// in a 5,700-line provider. Guard: scripts/validate-project-context-pure.ts.
//
// Nothing here touches React, AsyncStorage, Supabase or the offline queue — the
// context passes data in and writes results out.

import type { CertificateOfInsurance, ClientPortalSettings, COICoverage, CrewMember, PaymentSplit, Project, ProjectCollaborator, ProjectPhoto, PrequalPacket, SavedAIAPayApp, Subcontractor } from '@/types';
import { isValidStamp, sameSplit } from '@/utils/paymentTerms';
import { invoiceIsSettled } from '@/utils/invoiceBilling';
import { isFinancialsBlinded } from '@/utils/roleBlinding';
import type { ProjectRole } from '@/utils/projectRole';
import { projectTypeOtherColumn } from '@/utils/projectTypes';

// ─── MONEY-F3 · rate coercion ────────────────────────────────────────────────

/**
 * Coerce a persisted rate (tax %, contingency %) without turning 0 into the
 * fallback. `Number(x) || 7.5` did exactly that: a Texas remodeler who set
 * sales tax to 0 got 7.5 % back on every synced load and on every invoice.
 * Only a MISSING or unparseable value falls back.
 */
export function coerceRate(raw: unknown, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ─── SYNC-F3 · local-only merge after a server-first load ────────────────────

/**
 * Minimal structural view of an offline-queue entry. Kept local (rather than
 * importing utils/offlineQueue's type) so this module stays dependency-free.
 */
export interface QueueEntryLike {
  table: string;
  operation: string;
  data: { id?: unknown } & Record<string, unknown>;
}

/**
 * Ids of records that still have a queued create/edit for `table`. A queued
 * DELETE is deliberately excluded — resurrecting a row the user removed would
 * be the opposite bug.
 */
export function pendingIdsForTable(queue: readonly QueueEntryLike[], table: string): Set<string> {
  const ids = new Set<string>();
  for (const entry of queue) {
    if (entry.table !== table || entry.operation === 'delete') continue;
    const id = entry.data?.id;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

/**
 * #28 (wave 4) · A portal send the batch (Client Outbox "Send all") must HOLD:
 * an RFI or submittal whose INSERT is still queued. The server numbers every
 * insert itself (#148), so until it lands the device's number is a guess — and
 * the send freezes the record, number included, into the homeowner's copy.
 * The record screen and the Outbox already hold on the number's state; this is
 * the provider's own rule, so no caller can send one early.
 */
export function portalSendHeldForNumber(kind: string, itemId: string, queue: readonly QueueEntryLike[]): boolean {
  const table = kind === 'rfi' ? 'rfis' : kind === 'submittal' ? 'submittals' : null;
  if (!table) return false;
  return queue.some(e => e.table === table && e.operation === 'insert' && e.data?.id === itemId);
}

/**
 * Record ids of `table` that the "Not saved" ledger names ONLY for refused
 * rpc calls (wave 4 review: recordInvoicePayment's invoice_append_payment).
 * A refused append is already taken back off the device copy, so there is
 * nothing on the phone to protect — keeping that id in a loader's keep set
 * would pin the pre-payment device row over every later server read (a
 * client's Stripe payment hidden until he taps Discard, and an owner device
 * republishing the stale row into the portal). A record that ALSO has a
 * refused row write (insert/update/…) stays kept: that payload is the only
 * copy. Shape-typed so the bun validators drive it without the ledger module.
 */
export function rpcOnlyLedgerIds(
  own: readonly { kind: string; table?: string; recordId?: string; operation?: string }[],
  table: string,
): Set<string> {
  const rpc = new Set<string>();
  const row = new Set<string>();
  for (const f of own) {
    if (f.kind !== 'write' || f.table !== table || !f.recordId) continue;
    (f.operation === 'rpc' ? rpc : row).add(f.recordId);
  }
  for (const id of row) rpc.delete(id);
  return rpc;
}

/**
 * Integration round 3 · The project ids this session has under Not saved (the
 * projects loader lays each one's line over the server row — round 8, see
 * unsavedProjectPinsIn — and keeps the device row only when there is no
 * server row to lay it over): an unsaved project_financials
 * write (keyed on project_id — the money and contract terms), or an unsaved
 * projects write — less a projects id the ledger names ONLY for refused rpc
 * calls (rpcOnlyLedgerIds: that line stays on the sheet but does not shadow
 * the server row) unless a write of it is still queued. `own` is this
 * session's ledger, read AFTER `queuedProjectIds` (queue first, then ledger).
 */
export function unsavedProjectIdsIn(
  own: readonly { kind: string; table?: string; recordId?: string; operation?: string }[],
  queuedProjectIds: ReadonlySet<string>,
): Set<string> {
  const pins = unsavedProjectPinsIn(own, queuedProjectIds);
  return new Set([...pins.whole, ...pins.moneyOnly]);
}

/**
 * Wave-4 final fix (round 8) · The same ids, split by what the Not-saved line
 * covers, with the line's own row for each — what the projects loader lays
 * over the SERVER's row instead of pinning the device's row whole.
 *  • `whole` — an unsaved projects write. `projectRows` holds the columns its
 *    lines carry (oldest to newest, a later line's column wins — the same end
 *    state as Retry replaying them in order); every other column is the
 *    server's.
 *  • `moneyOnly` — ONLY an unsaved project_financials write. The loader takes
 *    the server's projects row whole and lays `finRows` (the line's row: the
 *    durable copy of his refused budget / terms edit, folded with every save
 *    parked behind it) over the server's project_financials row.
 *  • `deleted` — a refused projects DELETE. There is no row to lay over; the
 *    loader keeps the device's absence (the old whole pin).
 *
 * Why not pin the job whole (round 7): his next edit of that job then sent
 * the phone's OLD projects row back as a whole-row write, overwriting a
 * rename, a close-out or a portal switched off on the web. Why not read his
 * money from the AsyncStorage cache (round 4): a same-user re-auth sweep
 * empties that cache; the ledger survives it. Identity and bookkeeping
 * columns (OVERLAY_SKIP) always stay the server's.
 */
export interface UnsavedProjectPins {
  whole: Set<string>;
  moneyOnly: Set<string>;
  projectRows: Map<string, Record<string, unknown>>;
  finRows: Map<string, Record<string, unknown>>;
  deleted: Set<string>;
}

const OVERLAY_SKIP = new Set(['id', 'project_id', 'user_id', 'created_at', 'updated_at']);

type UnsavedLineLike = {
  kind: string; table?: string; recordId?: string; operation?: string;
  row?: Record<string, unknown>; queuedAt?: number; at?: number;
};

export function unsavedProjectPinsIn(
  own: readonly UnsavedLineLike[],
  queuedProjectIds: ReadonlySet<string>,
): UnsavedProjectPins {
  const whole = new Set<string>();
  const fin = new Set<string>();
  const deleted = new Set<string>();
  const rpcOnly = rpcOnlyLedgerIds(own, 'projects');
  const rowLines: UnsavedLineLike[] = [];
  for (const f of own) {
    if (f.kind !== 'write' || !f.recordId) continue;
    if (f.table === 'project_financials') fin.add(f.recordId);
    else if (f.table === 'projects' && (!rpcOnly.has(f.recordId) || queuedProjectIds.has(f.recordId))) whole.add(f.recordId);
    else continue;
    if (f.table === 'projects' && f.operation === 'delete') deleted.add(f.recordId);
    else if (f.operation !== 'rpc' && f.operation !== 'delete' && f.row) rowLines.push(f);
  }
  const moneyOnly = new Set([...fin].filter((id) => !whole.has(id)));
  const projectRows = new Map<string, Record<string, unknown>>();
  const finRows = new Map<string, Record<string, unknown>>();
  rowLines.sort((a, b) => (a.queuedAt ?? a.at ?? 0) - (b.queuedAt ?? b.at ?? 0));
  for (const f of rowLines) {
    const into = f.table === 'projects' ? projectRows : finRows;
    const id = f.recordId as string;
    const acc = into.get(id) ?? {};
    for (const [k, v] of Object.entries(f.row as Record<string, unknown>)) if (!OVERLAY_SKIP.has(k)) acc[k] = v;
    into.set(id, acc);
  }
  return { whole, moneyOnly, projectRows, finRows, deleted };
}

/** Round 8 · `server` with `line`'s columns laid over it (the line wins where
 *  it carries a column). No line → the server row as it is. No server row
 *  (a project_financials row not created yet) → the line's columns alone. */
export function overlayUnsavedRow(
  server: Record<string, unknown> | undefined,
  line: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!line) return server;
  return { ...(server ?? {}), ...line };
}

/**
 * Wave-4 final fix · Whether a projects load that just landed owes a re-read.
 * Only a row kept whole for a write still QUEUED or on the wire owes one —
 * that write will land (or be refused) on its own, and the settle / post-flush
 * listeners re-read once it has. A row kept whole ONLY because a line sits
 * under Not saved (`ledgerOnly`) never owes one: nothing but his Retry or
 * Discard moves that line, and both re-read 'projects' themselves
 * (rereadLedgerTables). Owing it anyway was an endless reload — the settle
 * checks the queue, finds it empty, re-reads, and the ledger pins the row
 * again: three SELECTs per pass, the whole cache rewritten each time.
 */
export function projectsReloadOwedAfterLoad(
  keptWhole: ReadonlySet<string>,
  ledgerOnly: ReadonlySet<string>,
): boolean {
  for (const id of keptWhole) if (!ledgerOnly.has(id)) return true;
  return false;
}

/** #112 · Ids with a queued DELETE for `table`. pendingIdsForTable leaves
 *  deletes out on purpose (keeping a row alive because its delete is queued is
 *  the resurrection bug); a merge needs them separately, to keep the server's
 *  still-undeleted copy OFF the screen until the delete lands. */
export function pendingDeleteIdsForTable(queue: readonly QueueEntryLike[], table: string): Set<string> {
  const ids = new Set<string>();
  for (const entry of queue) {
    if (entry.table !== table || entry.operation !== 'delete') continue;
    const id = entry.data?.id;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

export interface MergeLocalOnlyOptions<T> {
  /** Ids with a queued delete (pendingDeleteIdsForTable): dropped from BOTH
   *  sides, so a row deleted offline does not come back from the server copy. */
  deletedIds?: ReadonlySet<string>;
  /** How a pending id present on both sides combines. Default: the local row,
   *  whole. A table where the server owns some columns outright (punch: the
   *  sub's note, another phone's pin) passes a combiner that keeps them. */
  combine?: (local: T, server: T) => T;
}

/**
 * Server-first load, without silently dropping what the server has not seen
 * yet. The projects loader always did this; every child loader instead
 * overwrote the device copy wholesale, so an invoice created offline vanished
 * the moment the SELECT beat the flush's INSERT — and re-entering it produced a
 * duplicate document number.
 *
 * Rules:
 *  - A row with NO queued write: the server wins (the server is the merge point
 *    for every device). A local row absent from the server is dropped — it was
 *    deleted elsewhere, or never made it.
 *  - A row with a queued create/update (`pendingIds`): the LOCAL row wins, on
 *    the server list's position (#112). The SELECT can run before the flush
 *    lands, and the server's copy is then the PRE-edit row — an item closed
 *    offline in a basement flipped back to open on screen, and the loader
 *    saved that over the device cache. The local row carries every field the
 *    queued write will send, so it is what the server will hold once it lands.
 *    A pending row the server does not have yet (offline create) is appended.
 *  - A row with a queued delete (`opts.deletedIds`) is left out entirely.
 *  - A duplicate id inside the device copy (a record saved twice by two
 *    optimistic paths) is kept once — first occurrence wins — so the merge can
 *    never hand a list with repeated keys to a FlatList.
 * An EMPTY server list is a valid input: the result is exactly the pending
 * local rows (the caller decides whether an empty read may be trusted —
 * emptyReadAuthoritative).
 */
export function mergeLocalOnly<T extends { id: string }>(
  serverRows: readonly T[],
  localRows: readonly T[],
  pendingIds: ReadonlySet<string>,
  opts?: MergeLocalOnlyOptions<T>,
): T[] {
  const deleted = opts?.deletedIds;
  const localById = new Map<string, T>();
  for (const r of localRows) if (!localById.has(r.id)) localById.set(r.id, r);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of serverRows) {
    if (seen.has(r.id) || deleted?.has(r.id)) continue;
    seen.add(r.id);
    const local = pendingIds.has(r.id) ? localById.get(r.id) : undefined;
    out.push(local ? (opts?.combine ? opts.combine(local, r) : local) : r);
  }
  for (const r of localRows) {
    if (seen.has(r.id) || !pendingIds.has(r.id) || deleted?.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * #112 / #90 · May an EMPTY successful SELECT replace the device copy? Only
 * when it was answered to THIS user's live bearer. supabase-js sends the ANON
 * key once the access token has expired and the refresh failed, and RLS then
 * answers every table with zero rows and no error — trusting that would wipe a
 * good cache (and, for projects, every job) on a phone that merely slept past
 * its token. So: the load's account is still the live one, the auth feed names
 * the same user, and a bearer is on hand right now. A non-empty result needs
 * none of this — the anon key cannot read anyone's rows.
 */
export function emptyReadAuthoritative(a: {
  loadUserId: string | null | undefined;
  liveUserId: string | null | undefined;
  sessionUserId: string | null | undefined;
  /** Review round 1: the access token supabase-js WILL send, read BEFORE the
   *  SELECT (bearerTokenForRead — null unless it has runway, so the request
   *  cannot trigger a refresh that fails and falls back to the anon key). A
   *  bearer that is live only AFTER the read proves nothing about what the
   *  read carried: a retryable refresh failure sends anon, and a later
   *  getSession() can then refresh fine. */
  bearerBefore: string | null | undefined;
  /** The access token right after the read. Must be the SAME token: a
   *  refresh (or sign-out) in between means the read's bearer is unknown. */
  bearerAfter: string | null | undefined;
}): boolean {
  if (!a.loadUserId) return false;
  if (typeof a.bearerBefore !== 'string' || a.bearerBefore.length === 0) return false;
  return a.liveUserId === a.loadUserId && a.sessionUserId === a.loadUserId && a.bearerAfter === a.bearerBefore;
}

/** auth-js refreshes a session whose token expires within EXPIRY_MARGIN_MS
 *  (90 s, @supabase/auth-js lib/constants) before it hands it to a request —
 *  and a refresh that fails with a retryable error makes supabase-js send the
 *  ANON key. A token with more runway than that margin plus a minute of slack
 *  is sent as it is. */
export const BEARER_READ_RUNWAY_MS = 150_000;

/** The token a read issued NOW will carry, or null when that is not certain
 *  (no session, or too close to expiry — the request may refresh first). A
 *  session with no expires_at is never refreshed by auth-js, so it is sent. */
export function bearerTokenForRead(
  session: { access_token?: string | null; expires_at?: number | null } | null | undefined,
  nowMs: number,
): string | null {
  const token = session?.access_token;
  if (typeof token !== 'string' || token.length === 0) return null;
  const exp = session?.expires_at;
  if (typeof exp === 'number' && Number.isFinite(exp) && exp * 1000 - nowMs <= BEARER_READ_RUNWAY_MS) return null;
  return token;
}

/** #90 review round · The one IRREVERSIBLE step — forgetting a job and
 *  discarding its unsent writes — never rests on a single zero-row projects
 *  read. A read that returned rows proves the bearer was a user's (anon reads
 *  nothing); a zero-row read must be confirmed by a second, independent
 *  trusted zero-row read before any job is revoked. Unconfirmed, the jobs stay
 *  and the next load decides again. */
export function revocationConfirmed(a: { rowCount: number; confirmedEmpty: boolean }): boolean {
  return a.rowCount > 0 || a.confirmedEmpty === true;
}

// ─── Pins survive a refetch while their writes are pending (2026-09-18) ──────
//
// punchItemsQuery is server-first. mergeLocalOnly keeps only offline-CREATED
// rows, so a SELECT that ran while a pin UPDATE was still queued (no signal) or
// in flight (one bar) handed back the old row and the pin he had just placed
// vanished — "12 of 63 pinned" dropping back to 11 mid-session. The loader now
// keeps this device's three pin fields for exactly the rows whose pin write is
// still pending. Nothing else about the row is kept, and a row whose queued
// edit never touched the pin (an unpinned copy's status edit) keeps the
// server's pin, so another phone's pin can never be hidden.

const PIN_COLUMNS = ['plan_sheet_id', 'pin_x', 'pin_y'] as const;

/** Ids with a queued punch_items insert/upsert/update whose data carries a pin
 *  column — a value or an explicit NULL. (Queue entries are JSON: an edit from
 *  an unpinned copy has no pin keys at all.) */
export function pendingPinIdsInQueue(queue: readonly QueueEntryLike[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of queue) {
    if (entry.table !== 'punch_items') continue;
    if (entry.operation !== 'insert' && entry.operation !== 'upsert' && entry.operation !== 'update') continue;
    const data = entry.data ?? {};
    const id = data.id;
    if (typeof id !== 'string' || !id) continue;
    if (PIN_COLUMNS.some(c => Object.prototype.hasOwnProperty.call(data, c) && data[c] !== undefined)) ids.add(id);
  }
  return ids;
}

/** Rows whose device pin must survive this refetch: queued pin writes, plus
 *  tracked writes still in flight or settled at/after the SELECT began. */
export function pinOverlayIds(a: {
  queued: ReadonlySet<string>;
  tracker: ReadonlyMap<string, { inFlight: number; settledAt: number }>;
  fetchStartedAt: number;
}): Set<string> {
  const out = new Set<string>(a.queued);
  for (const [id, t] of a.tracker) {
    if (t.inFlight > 0 || t.settledAt >= a.fetchStartedAt) out.add(id);
  }
  return out;
}

/** Server rows with the device's planSheetId/pinX/pinY kept for `pendingIds`.
 *  The first local source that has the row wins (memory, then disk). A row no
 *  local source has stays as the server sent it. Returns the SAME array when
 *  nothing changes. */
export function keepPendingPinFields<T extends { id: string; planSheetId?: string; pinX?: number; pinY?: number }>(
  serverRows: readonly T[],
  localSources: readonly (readonly T[])[],
  pendingIds: ReadonlySet<string>,
): T[] {
  if (pendingIds.size === 0) return serverRows as T[];
  const maps = localSources.map(src => new Map(src.map(r => [r.id, r] as const)));
  let changed = false;
  const out = serverRows.map(row => {
    if (!pendingIds.has(row.id)) return row;
    let local: T | undefined;
    for (const m of maps) { local = m.get(row.id); if (local) break; }
    if (!local) return row;
    if (local.planSheetId === row.planSheetId && local.pinX === row.pinX && local.pinY === row.pinY) return row;
    changed = true;
    return { ...row, planSheetId: local.planSheetId, pinX: local.pinX, pinY: local.pinY };
  });
  return changed ? out : (serverRows as T[]);
}

/** Every id with a queued create/edit, grouped by table (deletes excluded). */
export function pendingIdsByTable(queue: readonly QueueEntryLike[]): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  for (const entry of queue) {
    if (entry.operation === 'delete') continue;
    const id = entry.data?.id;
    if (typeof id !== 'string' || !id) continue;
    let ids = byTable.get(entry.table);
    if (!ids) { ids = new Set(); byTable.set(entry.table, ids); }
    ids.add(id);
  }
  return byTable;
}

/**
 * Ids that were pending in `before` and are not in `after`, by table. A write
 * leaves the queue for one of two reasons — it landed, or it was discarded
 * (terminal RLS/validation error, retry exhaustion) — and the queue's change
 * notification does not say which. Either way the loader is the arbiter: a
 * refetch of that table replaces a landed row with its server copy and drops a
 * discarded one (it is neither on the server nor queued any more), so the
 * caller re-pulls exactly the tables that changed instead of waiting for the
 * next incidental refetch.
 */
export function vanishedPendingIds(
  before: ReadonlyMap<string, ReadonlySet<string>>,
  after: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> {
  const gone = new Map<string, Set<string>>();
  for (const [table, ids] of before) {
    const now = after.get(table);
    for (const id of ids) {
      if (now?.has(id)) continue;
      let set = gone.get(table);
      if (!set) { set = new Set(); gone.set(table, set); }
      set.add(id);
    }
  }
  return gone;
}

/** Supabase table → react-query key head used by the loader that hydrates it. */
const TABLE_QUERY_KEYS: Record<string, string> = {
  projects: 'projects',
  project_financials: 'projects',
  profiles: 'settings',
  change_orders: 'changeOrders',
  invoices: 'invoices',
  commitments: 'commitments',
  prequal_packets: 'prequalPackets',
  daily_reports: 'dailyReports',
  field_tickets: 'fieldTickets',
  delay_events: 'delayEvents',
  deliveries: 'deliveries',
  delivery_receipts: 'deliveryReceipts',
  building_access_rules: 'buildingAccess',
  access_reservations: 'accessReservations',
  leads: 'leads',
  bid_packages: 'bid_packages',
  bid_package_bids: 'bid_package_bids',
  subcontractors: 'subcontractors',
  punch_items: 'punchItems',
  photos: 'projectPhotos',
  price_alerts: 'priceAlerts',
  contacts: 'contacts',
  comm_events: 'commEvents',
  rfis: 'rfis',
  submittals: 'submittals',
  oac_meetings: 'oac_meetings',
  cois: 'cois',
  equipment: 'equipment',
  permits: 'permits',
  aia_pay_apps: 'aiaPayApps',
  sub_portal_links: 'subPortalLinks',
};

/**
 * Which loaders to invalidate after the offline queue flushed writes to
 * `tables`. Unknown tables (ones no ProjectContext loader owns) are ignored.
 */
export function queryKeysForFlushedTables(tables: Iterable<string>): string[] {
  const keys = new Set<string>();
  for (const t of tables) {
    const key = TABLE_QUERY_KEYS[t];
    if (key) keys.add(key);
  }
  return [...keys];
}

// ─── AUTH-F2 · legacy money fallback is for the OWNER only ───────────────────

/**
 * Money lives in project_financials (RLS can blind the 'field' role there);
 * the legacy projects.* columns remain until the phase-2 drop. Prefer the new
 * table; fall back to the legacy column ONLY for a project this account owns.
 * A collaborator whose role could not read the financials row must get
 * nothing — falling back for them handed the field foreman the full estimate.
 */
export function financialPick(
  fin: Record<string, unknown> | undefined,
  key: string,
  legacy: unknown,
  owned: boolean,
): unknown {
  if (fin && fin[key] != null) return fin[key];
  return owned ? legacy : undefined;
}

/**
 * B-1 · financialPick with the cache as the fallback for a shared project whose
 * project_financials read FAILED. The projects SELECT can succeed while the
 * financials SELECT errors (the query never throws; it returns `{ error }`),
 * and treating that like "no row" handed the collaborator `estimate: null` —
 * persisted to the device cache, then carried by their next PATCH into BOTH
 * tables. The previously loaded money stays for display; `financialsLoadedFor`
 * below keeps it out of any write until a read succeeds again.
 *
 * B-3 companion · when the read succeeded and the financials row has nothing
 * for `key`, a caller whose SERVER role is a known non-field one (editor /
 * viewer — `displayRole`, fresh from THIS load's project_collaborators read,
 * never the cache) falls back to the legacy projects column for DISPLAY: RLS
 * already lets those roles read it, and until the fin row catches up (the
 * owner's pre-split device wrote projects.* only) it is the only copy of the
 * owner's estimate. `financialsLoadedFor` keeps that fallback out of every
 * write. A field or unknown role still gets nothing (AUTH-F2).
 */
export function financialPickAfterLoad(
  fin: Record<string, unknown> | undefined,
  key: string,
  legacy: unknown,
  owned: boolean,
  readSucceeded: boolean,
  cached: unknown,
  displayRole?: ProjectCollaborator['role'],
): unknown {
  if (!owned && !readSucceeded) return cached;
  const picked = financialPick(fin, key, legacy, owned);
  if (owned || picked !== undefined) return picked;
  return displayRole != null && !isFinancialsBlinded(displayRole) ? legacy : undefined;
}

/** The four money columns, as the split migration and its backfill name them. */
export const LEGACY_MONEY_COLUMNS = ['estimate', 'linked_estimate', 'estimate_versions', 'target_budget'] as const;

/**
 * B-3 · whether a projects row still carries money in its legacy columns —
 * the same `is not null` test the phase-1 backfill used to decide which rows
 * got a project_financials row. Until the phase-2 drop, devices on the
 * pre-split build write these columns ONLY, so "legacy has money but no fin
 * row came back" is proof the fin table is behind, not that no estimate exists.
 */
export function legacyMoneyPresent(row: Record<string, unknown>): boolean {
  return LEGACY_MONEY_COLUMNS.some((col) => row[col] != null);
}

export interface FinancialsLoadInput {
  /** projects.user_id is the caller. */
  owned: boolean;
  /** A project_financials row for this project came back. */
  hasRow: boolean;
  /** The project_financials SELECT itself succeeded — no error, no throw. */
  readSucceeded: boolean;
  /** The caller's role from the server's project_collaborators table (or the cache of it). */
  myRole: ProjectCollaborator['role'] | undefined;
  /** The projects row still carries money in a legacy column (`legacyMoneyPresent`). */
  legacyHasMoney: boolean;
}

/**
 * B-1 · whether this device positively holds a project's money after a load —
 * the `Project.financialsLoaded` stamp that gates every money column on a
 * shared row's write. Owned rows always do (the legacy columns are the
 * owner's own fallback). A shared row does when its financials row came back;
 * when the SELECT succeeded and returned nothing, only for a role that
 * can_view_project_financials admits (owner / editor / viewer — 'field' is
 * excluded) AND — B-3 — only when the legacy columns carry no money either:
 * then the absence means no row EXISTS yet (a lead-converted project the
 * owner never touched) and an editor's first estimate must still be able to
 * create it. Legacy money with no fin row is the fin table provably BEHIND
 * (the owner estimated on the pre-split build after the backfill); an editor
 * stamped "loaded" there sent `estimate: null` over the owner's estimate on
 * its next PATCH and INSERTed that null into project_financials — so the
 * money is held back until a row exists. For a field or UNKNOWN role the
 * absence may be RLS, and a failed read tells us nothing — hold it back.
 */
export function financialsLoadedFor(input: FinancialsLoadInput): boolean {
  if (input.owned || input.hasRow) return true;
  if (!input.readSucceeded || input.legacyHasMoney) return false;
  return input.myRole != null && !isFinancialsBlinded(input.myRole);
}

// ─── B-2 · the caller's role comes from project_collaborators, not the roster ─

const COLLABORATOR_ROLES: readonly ProjectCollaborator['role'][] = ['owner', 'editor', 'viewer', 'field'];
function isCollaboratorRole(v: unknown): v is ProjectCollaborator['role'] {
  return typeof v === 'string' && (COLLABORATOR_ROLES as readonly string[]).includes(v);
}

/** Structural view of a `project_collaborators` row as the loader selects it. */
export interface CollaboratorRowLike {
  project_id?: unknown;
  role?: unknown;
  status?: unknown;
}

/**
 * The caller's ACCEPTED role per project from their own project_collaborators
 * rows (`select project_id, role, status … eq user_id`, allowed by
 * pc_invitee_read). Pending and revoked rows grant nothing — every RLS gate
 * (is_project_collaborator, can_access_project, can_view_project_financials)
 * requires status = 'accepted' — and an unknown role string is ignored rather
 * than trusted.
 */
export function acceptedRolesByProject(
  rows: readonly CollaboratorRowLike[] | null | undefined,
): Map<string, ProjectCollaborator['role']> {
  const out = new Map<string, ProjectCollaborator['role']>();
  for (const r of rows ?? []) {
    if (r.status !== 'accepted') continue;
    if (typeof r.project_id !== 'string' || !r.project_id) continue;
    if (!isCollaboratorRole(r.role)) continue;
    out.set(r.project_id, r.role);
  }
  return out;
}

/**
 * The role to stamp on a loaded project. A successful read is authoritative:
 * an accepted row → its role; none → undefined (the legacy display list is the
 * fallback downstream). A FAILED read keeps whatever the cache last knew —
 * never "no role", which a cache predating ownerUserId would read as OWNED and
 * send the owner's columns.
 */
export function myRoleAfterLoad(
  readSucceeded: boolean,
  fromServer: ProjectCollaborator['role'] | undefined,
  cached: ProjectCollaborator['role'] | undefined,
): ProjectCollaborator['role'] | undefined {
  return readSucceeded ? fromServer : cached;
}

// ─── AUTH-F5 · portal credentials never leave the owner ──────────────────────

/**
 * Drop the portal access token and passcode from a client_portal blob before
 * it reaches a collaborator's memory and AsyncStorage cache. Both authenticate
 * the HOMEOWNER's signatures and approvals; any accepted collaborator could
 * otherwise e-sign a change order as the client. The display flags stay.
 */
export function stripPortalCredentials(
  cp: ClientPortalSettings | null | undefined,
): ClientPortalSettings | undefined {
  if (cp == null) return undefined;
  const { accessToken: _token, passcode: _pass, ...rest } = cp;
  return rest;
}

// ─── AUTH-F2/F5 · who is writing this project row ────────────────────────────

/**
 * The caller's role from the row's display collaborator list. Matched by
 * user id when the entry carries one, else by e-mail (the legacy Team list
 * predates userId). Returns undefined when the caller is not listed — the
 * server's project_collaborators table is the real gate; this only decides
 * what the CLIENT sends.
 */
export function collaboratorRoleFor(
  collaborators: readonly ProjectCollaborator[] | null | undefined,
  userId: string | null | undefined,
  userEmail: string | null | undefined,
): ProjectRole | undefined {
  if (!collaborators || collaborators.length === 0) return undefined;
  const email = userEmail?.trim().toLowerCase();
  const byId = userId ? collaborators.find(c => c.userId === userId) : undefined;
  const hit = byId ?? (email ? collaborators.find(c => c.email?.trim().toLowerCase() === email) : undefined);
  return hit?.role;
}

export interface ProjectSyncSubject {
  ownerUserId?: string;
  myRole?: ProjectCollaborator['role'];
  financialsLoaded?: boolean;
  collaborators?: ProjectCollaborator[];
}

// ─── A-1 · a project this account creates is stamped as its own ──────────────

/**
 * Claim a project this account is creating (addProject, importData, the lead
 * conversion): stamp `ownerUserId` with the caller and drop the loader's
 * per-load stamps (`myRole`, `financialsLoaded`). A clone of a SHARED project
 * or a backup exported from another account otherwise arrives carrying the
 * other owner's id and the editor's role, so the new row was PATCHed by an id
 * the server has never seen (nothing landed) or blinded as its creator. With
 * every creation path stamping the owner, "no ownerUserId" can only be a
 * cache written before the field existed — see classifyProjectForSync.
 * Signed-out (no user id) leaves the project untouched: nothing syncs then.
 */
export function claimProjectForUser<T extends ProjectSyncSubject>(project: T, userId: string | null | undefined): T {
  if (!userId) return project;
  const { myRole: _role, financialsLoaded: _loaded, ...rest } = project;
  return { ...rest, ownerUserId: userId } as T;
}

export interface ProjectSyncClassification {
  /**
   * Write as a collaborator would — PATCH by id, no ownership column, no
   * client_portal: the row belongs to another account, OR (A-1) the owner is
   * unknown because the cache predates `ownerUserId`. Never an owner-style
   * upsert on a guess: that upsert re-stamped project_financials.user_id with
   * the editor's id (its UPDATE policy admits editors and, unlike projects,
   * no trigger freezes the column), moving the project out of the owner's
   * mcp / QBO views.
   */
  shared: boolean;
  /** The caller's role withholds money: send no financial column anywhere. */
  blinded: boolean;
  /** Who the row belongs to, when known (projects.user_id from the load). */
  ownerId: string | undefined;
  /**
   * The four money columns ride on the projects write. Always for an owned
   * row. For a shared row only when the caller is not blinded and not a
   * viewer (A-2: a viewer's PATCH is filtered to 0 rows and the paired
   * project_financials upsert is RLS-refused — a terminal toast for a write
   * that could never land), this device positively holds the money
   * (`financialsLoaded !== false`) AND the owner is known — the paired
   * project_financials upsert needs the owner's id, and money must never
   * reach one table without the other.
   */
  sendMoney: boolean;
  /**
   * `user_id` for the paired project_financials upsert; undefined = skip that
   * write. The OWNER's id for a shared row — that column is the tenant filter
   * the mcp function and the QBO mapping read, so stamping the editor's id
   * would move the project out of the owner's views.
   */
  financialsUserId: string | undefined;
}

/**
 * Decides how a project row is written back, from the PROJECT itself — never
 * from what the last successful server load happened to remember. The
 * loader-filled "shared/blinded id sets" were empty on an offline launch and
 * after a transient SELECT failure, so a collaborator's edits went out
 * owner-style with the credential-stripped client_portal blob (the token was
 * regenerated by portal_set_access_token; the owner's passcode was wiped).
 *
 *   shared   ← ownerUserId, persisted on the Project by the loader and stamped
 *              by every creation path (claimProjectForUser). A-1: with no
 *              ownerUserId the cache predates the field and the owner is
 *              unknowable on the device (the display roster is a legacy Team
 *              list the invite flow never writes), so the row is written as a
 *              collaborator would — base columns only — until the next
 *              successful load stamps it. The owner's own PATCH passes RLS;
 *              an editor's pre-field cache can no longer re-own anything.
 *   blinded  ← the caller's ROLE — `myRole` from the server table the invite
 *              flow actually writes ('field' is the only blinded role), the
 *              display list only for a cache that predates `myRole`. Never
 *              "no project_financials row came back".
 *   sendMoney / financialsUserId ← see ProjectSyncClassification. A shared row
 *              after a failed financials read (`financialsLoaded: false`)
 *              PATCHes without a single money key and skips project_financials:
 *              the editor's copy holds `estimate: null` it never read, and
 *              sending it NULLed the owner's estimate on both tables. A-2: a
 *              viewer (server role first, the display list as the legacy
 *              fallback) never sends money.
 */
export function classifyProjectForSync(
  project: ProjectSyncSubject,
  userId: string | null | undefined,
  userEmail: string | null | undefined,
): ProjectSyncClassification {
  const ownerId = project.ownerUserId || undefined;
  const role = project.myRole ?? collaboratorRoleFor(project.collaborators, userId, userEmail);
  const shared = ownerId ? ownerId !== userId : true;
  const blinded = shared && isFinancialsBlinded(role ?? null);
  const sendMoney = !shared
    || (!blinded && role !== 'viewer' && project.financialsLoaded !== false && !!ownerId);
  const financialsUserId = shared ? (sendMoney ? ownerId : undefined) : (userId || undefined);
  return { shared, blinded, ownerId, sendMoney, financialsUserId };
}

// ─── PRODUCT-F1 · COI vault feeds the subcontractor's coiExpiry ──────────────

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * The earliest coverage expiry on a certificate, as YYYY-MM-DD — the format
 * coi-expiry-watch compares `subcontractors.coi_expiry` against (a text
 * column, `.lte(cutoff)` with a date-only cutoff). Returns undefined when no
 * coverage carries a usable date so the caller never blanks an existing value.
 */
export function earliestCoverageExpiry(
  coverages: readonly COICoverage[] | null | undefined,
): string | undefined {
  let bestMs = Number.POSITIVE_INFINITY;
  let best: string | undefined;
  for (const c of coverages ?? []) {
    if (!c.expiresAt) continue;
    const ms = Date.parse(c.expiresAt);
    if (!Number.isFinite(ms) || ms >= bestMs) continue;
    bestMs = ms;
    best = DATE_PREFIX.test(c.expiresAt) ? c.expiresAt.slice(0, 10) : new Date(ms).toISOString().slice(0, 10);
  }
  return best;
}

/**
 * The subcontractor's coiExpiry from EVERY certificate on file for them: each
 * certificate is only as good as its earliest-expiring coverage, and the sub
 * is covered until the LATEST such date across their certificates. Stamping a
 * single certificate's date regressed the sub to an older cert whenever that
 * older cert was edited, and deleting a cert never recomputed. Returns
 * undefined when no certificate carries a usable date, so the caller leaves
 * the existing (possibly hand-entered) value alone.
 */
export function subCoiExpiryAcross(
  cois: readonly Pick<CertificateOfInsurance, 'coverages'>[] | null | undefined,
): string | undefined {
  let best: string | undefined;
  for (const c of cois ?? []) {
    const d = earliestCoverageExpiry(c.coverages);
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

// ─── MONEY-F5 · when an edit flips an open invoice to 'paid' ─────────────────

export interface InvoiceSettlementInput {
  status?: string;
  totalDue?: number;
  amountPaid?: number;
  /** MONEY-05: the basis invoiceIsSettled recomputes the withholding from. */
  subtotal?: number;
  retentionPercent?: number;
  retentionAmount?: number;
  retentionReleased?: number;
}

/**
 * Whether an edit (manual check / cash / Zelle / ACH entry, or a webhook echo)
 * should flip an open invoice to 'paid'. Net of the retention the contract
 * still lets the client hold, with invoiceIsSettled's 1-cent tolerance — the
 * gross `amountPaid >= totalDue` gate could never flip a retention invoice, so
 * "Record Payment" stayed lit after the client had paid everything they were
 * asked for. Drafts and already-paid invoices never flip; a $0 invoice never
 * flips on its own. Held retention is tracked by retentionAmount /
 * retentionReleased, not by status.
 */
export function shouldFlipInvoiceToPaid(inv: InvoiceSettlementInput): boolean {
  if (inv.status === 'draft' || inv.status === 'paid') return false;
  if ((inv.totalDue ?? 0) <= 0) return false;
  return invoiceIsSettled({
    totalDue: inv.totalDue ?? 0, amountPaid: inv.amountPaid,
    subtotal: inv.subtotal, retentionPercent: inv.retentionPercent,
    retentionAmount: inv.retentionAmount, retentionReleased: inv.retentionReleased,
  });
}

// ─── #83/#135 (wave 4) · the pending bank-payment marker ─────────────────────

/**
 * invoices / aia_pay_apps pay_pending_at + pay_pending_amount → the record's
 * paymentPendingAt / paymentPendingAmount (CONTRACT 3). Both columns are the
 * webhook's: set when a Checkout Session completes UNPAID (ACH in flight),
 * cleared when it settles or fails. A missing or null column leaves the key
 * OUT (not `undefined`-valued), so a row read before the migration landed
 * looks exactly like a row with no payment in flight. numeric(12,2) arrives
 * as a string from PostgREST; an unparseable one is dropped, never read as 0.
 */
export function pendingPaymentFromRow(r: Record<string, unknown>): { paymentPendingAt?: string; paymentPendingAmount?: number } {
  const out: { paymentPendingAt?: string; paymentPendingAmount?: number } = {};
  if (typeof r.pay_pending_at === 'string' && r.pay_pending_at.length > 0) out.paymentPendingAt = r.pay_pending_at;
  if (r.pay_pending_amount != null && r.pay_pending_amount !== '') {
    const n = Number(r.pay_pending_amount);
    if (Number.isFinite(n)) out.paymentPendingAmount = Math.round(n * 100) / 100;
  }
  return out;
}

// ─── #80/#35 (wave 4) · a recorded payment is an APPEND ──────────────────────

/** The fields a manual payment moves on the device copy. */
export interface PaymentAppendInput {
  status?: string;
  totalDue?: number;
  amountPaid?: number;
  subtotal?: number;
  retentionPercent?: number;
  retentionAmount?: number;
  retentionReleased?: number;
  payments?: readonly { id: string; amount: number }[] | null;
}

/**
 * The OPTIMISTIC device copy of an invoice after one payment is recorded —
 * what the screen shows while invoice_append_payment is out (or queued).
 * Only the new entry is added (by id: an entry already on the row is a no-op,
 * `null`), amount_paid moves by exactly that entry to the cent, and the status
 * follows the same rule as the server's invoice_settlement_status: settled
 * NET of held retention (1-cent tolerance) → 'paid', otherwise any money in →
 * 'partially_paid'. The server's answer replaces all of it on the guarded
 * re-read; nothing here is ever written to the server (the RPC recomputes the
 * ledger sum itself, from the row it has locked).
 */
export function optimisticPaymentAppend<E extends { id: string; amount: number }, S extends string = string>(
  inv: PaymentAppendInput & { status?: S },
  entry: E,
): { payments: E[]; amountPaid: number; status: S | 'paid' | 'partially_paid' | 'sent' } | null {
  const prior = (inv.payments ?? []) as E[];
  if (prior.some(p => p && p.id === entry.id)) return null;
  const amountPaid = Math.round(((inv.amountPaid ?? 0) + entry.amount) * 100) / 100;
  const settled = invoiceIsSettled({
    totalDue: inv.totalDue ?? 0, amountPaid,
    subtotal: inv.subtotal, retentionPercent: inv.retentionPercent,
    retentionAmount: inv.retentionAmount, retentionReleased: inv.retentionReleased,
  });
  const status: S | 'paid' | 'partially_paid' | 'sent' = amountPaid > 0.005 ? (settled ? 'paid' : 'partially_paid') : (inv.status ?? 'sent');
  return { payments: [...prior, entry], amountPaid, status };
}

/**
 * Undo an optimistic append whose RPC was REFUSED ('failed' — the caller tells
 * him nothing was recorded, so the device copy must not show it either).
 * Only this entry leaves, amount_paid drops by exactly its amount, and the
 * status goes back to what it was before — unless something else moved the
 * row meanwhile (a server re-read already replaced it): then `null`, and the
 * row is left alone.
 */
export function revertOptimisticPayment<E extends { id: string; amount: number }, S extends string = string>(
  inv: PaymentAppendInput,
  entry: E,
  before: { status?: S },
): { payments: E[]; amountPaid: number; status?: S } | null {
  const prior = (inv.payments ?? []) as E[];
  if (!prior.some(p => p && p.id === entry.id)) return null;
  return {
    payments: prior.filter(p => p.id !== entry.id),
    amountPaid: Math.max(0, Math.round(((inv.amountPaid ?? 0) - entry.amount) * 100) / 100),
    status: before.status,
  };
}

/**
 * Integration round 2 · Take a payment append the FLUSH refused off the device
 * copy. revertOptimisticPayment above covers the direct 'failed' answer, where
 * the pre-payment row is still in hand; a QUEUED append refused later had no
 * such undo — the drop triggers no invoices re-read, and when another write of
 * the invoice sits under Not saved too (the UPDATE queued behind the append is
 * dropped with it as an orphan) the loader keeps the device row, so the phone
 * showed the refused payment as recorded, status paid, and an owner device
 * published it to the portal. The pre-payment status is not known here, so it
 * is RECOMPUTED from what is left: some money still paid → paid or partially
 * paid by the same retention-net rule as the append; none → an invoice that
 * read paid / partially paid goes back to 'sent' (any other status stands).
 * `null` when the entry is not on the row (nothing to take back).
 */
export function stripDroppedPayment<E extends { id: string; amount: number }>(
  inv: PaymentAppendInput,
  entryId: string,
): { payments: E[]; amountPaid: number; status?: string } | null {
  const prior = (inv.payments ?? []) as E[];
  const hit = prior.find(p => p && p.id === entryId);
  if (!hit) return null;
  const amountPaid = Math.max(0, Math.round(((inv.amountPaid ?? 0) - (Number(hit.amount) || 0)) * 100) / 100);
  let status = inv.status;
  if (amountPaid > 0.005) {
    status = invoiceIsSettled({
      totalDue: inv.totalDue ?? 0, amountPaid,
      subtotal: inv.subtotal, retentionPercent: inv.retentionPercent,
      retentionAmount: inv.retentionAmount, retentionReleased: inv.retentionReleased,
    }) ? 'paid' : 'partially_paid';
  } else if (status === 'paid' || status === 'partially_paid') {
    status = 'sent';
  }
  return { payments: prior.filter(p => p.id !== entryId), amountPaid, ...(status !== undefined ? { status } : {}) };
}

/** The entry id of a queued invoice_append_payment, or null. */
export function droppedAppendEntryId(m: { table?: string; operation?: string; rpc?: { fn?: string; args?: Record<string, unknown> } }): string | null {
  if (m.table !== 'invoices' || m.operation !== 'rpc' || m.rpc?.fn !== 'invoice_append_payment') return null;
  const e = m.rpc.args?.p_entry as { id?: unknown } | undefined;
  return typeof e?.id === 'string' && e.id.length > 0 ? e.id : null;
}

/**
 * Integration round 3 · The payment entry a Retry just took off the Not-saved
 * sheet (landed or queued), with its invoice — or null. ProjectContext puts it
 * back on the device copy (optimisticPaymentAppend, idempotent by entry id):
 * a flush refusal had stripped it (stripDroppedPayment), and without this a
 * Retry answered 'queued' left the invoice reading unpaid until the flush —
 * where a second "record payment" found no unsaved append to warn about.
 */
export function retriedAppendEntry<E extends { id: string; amount: number }>(
  line: { table?: string; operation?: string; recordId?: string; rpc?: { fn?: string; args?: Record<string, unknown> } },
): { invoiceId: string; entry: E } | null {
  if (!droppedAppendEntryId(line) || typeof line.recordId !== 'string' || !line.recordId) return null;
  const e = line.rpc?.args?.p_entry as E | undefined;
  if (!e || typeof e.amount !== 'number' || !Number.isFinite(e.amount)) return null;
  return { invoiceId: line.recordId, entry: e };
}

// ─── MONEY-F1 · aia_pay_apps row ⇄ SavedAIAPayApp ────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * The G702 cover totals from the G703 lines — the same arithmetic as
 * utils/aiaBilling computeAIATotals, kept here (React-Native-free) so a
 * hydrated row can be repaired without loading expo-print. Every pay app saved
 * BEFORE the MONEY-F1 writer fix has `snapshot_totals` NULL; without this the
 * next application read `priorAIA.totals?.totalEarnedLessRetainage ?? 0` and
 * billed the client for everything again ("less previous certificates" = $0).
 */
export function aiaTotalsFromLines(
  lines: readonly SavedAIAPayApp['lines'][number][] | null | undefined,
  contractSumToDate: number,
  lessPreviousCertificates: number,
): SavedAIAPayApp['totals'] {
  const rows = lines ?? [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  let totalScheduledValue = 0;
  let totalCompletedAndStored = 0;
  let totalRetainage = 0;
  for (const l of rows) {
    const completed = num(l.fromPreviousApp) + num(l.thisPeriod);
    const stored = num(l.materialsPresentlyStored);
    const workRate = num(l.retainagePercent);
    // G702 line 5b's rate is its OWN blank on the form. This function is a
    // second copy of computeAIATotals' arithmetic (it exists so a hydrated row
    // can be repaired without loading expo-print), and a copy that does not
    // know about the split would recompute a DIFFERENT total retainage from
    // the one the certificate was signed with — on exactly the rows that have
    // no snapshot_totals to fall back on. `undefined` means "same as the
    // completed-work rate", which is what every record saved before the field
    // existed means; an explicit 0 is a real contract term and is honoured.
    const storedRateRaw = l.storedRetainagePercent;
    const storedRate = storedRateRaw == null || !Number.isFinite(Number(storedRateRaw))
      ? workRate
      : num(storedRateRaw);
    totalScheduledValue += num(l.scheduledValue);
    totalCompletedAndStored += completed + stored;
    totalRetainage += completed * (workRate / 100) + stored * (storedRate / 100);
  }
  const totalEarnedLessRetainage = totalCompletedAndStored - totalRetainage;
  return {
    totalScheduledValue,
    totalCompletedAndStored,
    totalRetainage,
    totalEarnedLessRetainage,
    currentPaymentDue: totalEarnedLessRetainage - lessPreviousCertificates,
    balanceToFinish: contractSumToDate - totalEarnedLessRetainage,
    percentComplete: totalScheduledValue > 0 ? (totalCompletedAndStored / totalScheduledValue) * 100 : 0,
  };
}

/**
 * Hydrate an aia_pay_apps row. Reads `snapshot_totals` back into `totals`
 * (the writer used to send a never-set `snapshotTotals`, so this was always
 * NULL and the second pay app of a project crashed on `priorAIA.totals`); a
 * row whose snapshot is still NULL gets its totals recomputed from `lines`.
 * The pay-link columns are read DEFENSIVELY: they arrive with migration
 * 20260904100100 and are simply absent until it is applied.
 *
 * Portal lifecycle (`portal_state`) is layered on by the context, where
 * validate-portal-state-roundtrip guards it.
 */
/**
 * Certificate fields that have no column of their own, carried inside the
 * `snapshot_totals` JSONB the table already has.
 *
 * WHY A SIDECAR AND NOT COLUMNS. Sending an unknown top-level key makes
 * PostgREST reject the ENTIRE write, and utils/offlineQueue classifies that as
 * transient and re-queues it — correctly, but it means an OTA that reaches
 * devices before its migration is applied stops every AIA pay-app save on
 * every device until someone runs the migration. This repo has been bitten by
 * exactly that race (the punch-item regression the queue's isSchemaCacheError
 * comment records), and applying a migration is owner-gated while an OTA is
 * not. The sidecar needs no schema change at all.
 *
 * The key is namespaced so it can never collide with a totals field, and it is
 * OMITTED ENTIRELY when nothing is set — a pay application that uses none of
 * these writes a byte-identical row to the one it wrote before they existed.
 *
 * Migrating this to real columns later is a mechanical change: add the
 * columns, write both, backfill from the sidecar, then stop reading it.
 */
const AIA_EXTRAS_FIELD = '__mageCertificate';
// (Deliberately not named *_KEY: scripts/validate-storage-hygiene.ts discovers
//  AsyncStorage keys by const NAME, and this is a JSONB field, not a key.)

interface AiaCertificateExtras {
  periodFrom?: string;
  storedRetainagePercent?: number;
  amountCertified?: number;
  certifiedDate?: string;
  certifiedExplanation?: string;
  // The four-row CHANGE ORDER SUMMARY as it stood when the certificate was
  // saved. It rides here because reprinting a SENT application must reproduce
  // the document that went out; recomputing the table from today's
  // change-order list restates it whenever a CO approved inside the period is
  // entered after the fact.
  changeOrderSummary?: SavedAIAPayApp['changeOrderSummary'];
  notarize?: boolean;
  notaryState?: string;
  notaryCounty?: string;
  /**
   * Where column C came from. The screen prints a provenance note under the
   * schedule of values and branches on it; without it on the record every
   * REOPENED certificate took the "this project has no itemized estimate
   * linked" branch, telling a GC whose job does have one to go and link it.
   */
  sovBasis?: SavedAIAPayApp['sovBasis'];
}

function aiaExtrasFor(a: SavedAIAPayApp): AiaCertificateExtras | null {
  const extras: AiaCertificateExtras = {};
  if (a.periodFrom) extras.periodFrom = a.periodFrom;
  if (a.storedRetainagePercent != null) extras.storedRetainagePercent = a.storedRetainagePercent;
  if (a.amountCertified != null) extras.amountCertified = a.amountCertified;
  if (a.certifiedDate) extras.certifiedDate = a.certifiedDate;
  if (a.certifiedExplanation) extras.certifiedExplanation = a.certifiedExplanation;
  if (a.changeOrderSummary) extras.changeOrderSummary = a.changeOrderSummary;
  if (a.notarize) extras.notarize = true;
  if (a.notaryState) extras.notaryState = a.notaryState;
  if (a.notaryCounty) extras.notaryCounty = a.notaryCounty;
  if (a.sovBasis) extras.sovBasis = a.sovBasis;
  return Object.keys(extras).length ? extras : null;
}

function readAiaExtras(snapshot: unknown): AiaCertificateExtras {
  if (snapshot == null || typeof snapshot !== 'object') return {};
  const raw = (snapshot as Record<string, unknown>)[AIA_EXTRAS_FIELD];
  return raw != null && typeof raw === 'object' ? (raw as AiaCertificateExtras) : {};
}

export function aiaRowToSaved(r: Record<string, unknown>): SavedAIAPayApp {
  const createdAt = str(r.created_at);
  const lines = (r.lines as SavedAIAPayApp['lines'] | null) ?? [];
  const contractSumToDate = coerceRate(r.contract_sum_to_date, 0);
  const lessPreviousCertificates = coerceRate(r.less_previous_certificates, 0);
  const snapshot = r.snapshot_totals;
  const extras = readAiaExtras(snapshot);
  // The sidecar must never leak into `totals` — the portal snapshot and the
  // WIP report both read that object, and an extra key on it is an extra key
  // on every consumer.
  const totals = (() => {
    const fallback = () => aiaTotalsFromLines(lines, contractSumToDate, lessPreviousCertificates);
    if (snapshot == null || typeof snapshot !== 'object') return fallback();
    const { [AIA_EXTRAS_FIELD]: _extras, ...rest } = snapshot as Record<string, unknown>;
    void _extras;
    // THE SIDECAR MUST NOT DISABLE THE REPAIR PATH (review 2026-09-11).
    //
    // `savedToAiaRow` writes `{...(a.totals ?? {}), __mageCertificate: …}`, so
    // a record that has NO totals but sets any certificate field (a period
    // start, a notary county) still writes a NON-NULL snapshot_totals — an
    // object whose only key is the sidecar. Stripping it then left `{}`, and
    // the `snapshot == null` test above could no longer see that there were no
    // totals to read. Downstream that is money: the next period seeds line 7
    // from `priorAIA.totals?.totalEarnedLessRetainage ?? 0`, so a repaired
    // record would have billed "less previous certificates = $0" — the exact
    // failure MONEY-F1 opened for, reintroduced by a field that has nothing to
    // do with totals.
    //
    // So the sidecar-stripped remainder only counts as totals when it actually
    // carries the figure the rest of the app reads. Anything else falls
    // through to recomputing from the lines, as it did before the sidecar.
    const hasTotals = typeof (rest as { currentPaymentDue?: unknown }).currentPaymentDue === 'number';
    return hasTotals ? (rest as SavedAIAPayApp['totals']) : fallback();
  })();
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    invoiceId: str(r.invoice_id),
    applicationNumber: Number(r.application_number) || 1,
    applicationDate: str(r.application_date) ?? '',
    periodTo: str(r.period_to) ?? '',
    contractDate: str(r.contract_date),
    ownerName: str(r.owner_name) ?? '',
    contractorName: str(r.contractor_name) ?? '',
    architectName: str(r.architect_name),
    projectName: str(r.project_name) ?? '',
    projectLocation: str(r.project_location),
    contractForDescription: str(r.contract_for_description),
    originalContractSum: coerceRate(r.original_contract_sum, 0),
    netChangeByCO: coerceRate(r.net_change_by_co, 0),
    contractSumToDate,
    // 0 % retainage is a real contract term — the old `|| 10` erased it.
    retainagePercent: coerceRate(r.retainage_percent, 10),
    lessPreviousCertificates,
    lines,
    notes: str(r.notes),
    totals,
    ...extras,
    payLinkUrl: str(r.pay_link_url),
    payLinkId: str(r.pay_link_id),
    payLinkAmount: r.pay_link_amount == null ? undefined : coerceRate(r.pay_link_amount, 0),
    // #83/#135 (wave 4, CONTRACT 3): a bank payment the client started on the
    // Pay link that is still settling. Server-owned like pay_link_* — stamped
    // by stripe-webhook on the unpaid Checkout completion, cleared when it
    // settles or fails — and never written back by savedToAiaRow.
    ...pendingPaymentFromRow(r),
    paidAt: str(r.paid_at),
    savedAt: createdAt ?? '',
    createdAt,
    updatedAt: str(r.updated_at),
  };
}

/**
 * Serialise a SavedAIAPayApp for the aia_pay_apps table. Data columns only —
 * the context adds `portal_state` (spread, never `?? null`, see the writer's
 * comment there) and user/tenant stamping stays explicit via `userId`.
 *
 * THE PAY-LINK COLUMNS ARE SERVER-OWNED — do not add them here.
 *
 * The TODO that used to sit at this spot said to start writing pay_link_url /
 * pay_link_id / pay_link_amount "once migration 20260904100100 is applied".
 * That migration IS applied (it adds exactly those three columns to
 * aia_pay_apps), so the stated blocker is gone — but writing them from the app
 * would be wrong for a different and worse reason. supabase/functions/
 * create-payment-link writes them server-side when it mints a link, and the
 * Stripe webhook NULLS them the moment the link is paid or replaced (MONEY-F2 /
 * F16). An app-side write of a locally-cached link would resurrect a link the
 * webhook had just retired — a live Pay button for money already collected.
 * The residue is that a local payLinkUrl can lag the server's, which is why
 * `isLocked` on app/aia-pay-app.tsx errs toward locking.
 *
 * `paid_at` is owned by the Stripe webhook and is never written from the app,
 * for the same reason.
 *
 * NEW CERTIFICATE FIELDS (period_from, stored retainage, AMOUNT CERTIFIED, the
 * notary jurat) have no columns of their own and are NOT sent as top-level
 * keys: an unknown column makes PostgREST reject the whole write, and the
 * offline queue would (correctly, per its schema-cache rule) re-queue it until
 * a migration lands. They ride inside the `lines` / `snapshot_totals` JSONB the
 * table already has — see `aiaExtrasFor` below.
 */
export function savedToAiaRow(a: SavedAIAPayApp, userId: string | null | undefined): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: a.id,
    user_id: userId,
    project_id: a.projectId,
    invoice_id: a.invoiceId ?? null,
    application_number: a.applicationNumber,
    application_date: a.applicationDate || null,
    period_to: a.periodTo || null,
    contract_date: a.contractDate || null,
    owner_name: a.ownerName ?? null,
    contractor_name: a.contractorName ?? null,
    architect_name: a.architectName ?? null,
    project_name: a.projectName ?? null,
    project_location: a.projectLocation ?? null,
    contract_for_description: a.contractForDescription ?? null,
    original_contract_sum: a.originalContractSum ?? 0,
    net_change_by_co: a.netChangeByCO ?? 0,
    contract_sum_to_date: a.contractSumToDate ?? 0,
    retainage_percent: a.retainagePercent ?? 10,
    less_previous_certificates: a.lessPreviousCertificates ?? 0,
    lines: a.lines ?? [],
    notes: a.notes ?? null,
    // MONEY-F1: the object carries `totals`; `snapshotTotals` never existed.
    snapshot_totals: (() => {
      const extras = aiaExtrasFor(a);
      if (!extras) return a.totals ?? null;
      return { ...(a.totals ?? {}), [AIA_EXTRAS_FIELD]: extras };
    })(),
    created_at: a.createdAt ?? (a.savedAt || undefined) ?? now,
    updated_at: a.updatedAt ?? now,
  };
}

// ─── Wave 3 · context-money-portal ───────────────────────────────────────────
// Each helper below is a decision ProjectContext used to make inline, where a
// one-column slip went unseen. scripts/validate-context-money-portal-*.ts runs
// them.

/**
 * #21 · The daily_reports columns an INSERT and an UPDATE both write. The
 * update was hand-listed separately and was one column short — `date` — so a
 * report he re-dated (Monday → Friday, the backfill case) moved on this phone
 * only; the next refetch put it back on Monday everywhere. One builder for
 * both means an edit can never persist fewer columns than a create. The
 * insert adds only what a create alone owns: DAILY_REPORT_INSERT_ONLY.
 * `photos` arrives already mapped to storage paths (dfrPhotoRows) — never a
 * device-local uri.
 */
export function dailyReportColumns(
  dr: {
    date: string; weather: unknown; manpower: unknown; workPerformed: unknown;
    materialsDelivered: unknown; issuesAndDelays: unknown; status: unknown;
    incident?: unknown; workProgress?: unknown; homeownerSummary?: unknown;
    homeownerSummaryGeneratedAt?: unknown; homeownerSummaryPublished?: boolean;
  },
  mapped: { photos: unknown },
): Record<string, unknown> {
  return {
    // Sent exactly as the insert always sent it (a bare day or an instant —
    // the column accepts both, and the list reads either via dayOrInstantDate).
    date: dr.date,
    weather: dr.weather, manpower: dr.manpower, work_performed: dr.workPerformed,
    materials_delivered: dr.materialsDelivered, issues_and_delays: dr.issuesAndDelays,
    photos: mapped.photos, status: dr.status,
    incident: dr.incident ?? null, work_progress: dr.workProgress ?? null,
    homeowner_summary: dr.homeownerSummary ?? null,
    homeowner_summary_generated_at: dr.homeownerSummaryGeneratedAt ?? null,
    homeowner_summary_published: dr.homeownerSummaryPublished ?? false,
  };
}

/** Columns only a create writes. portal_state is the send/recall path's on
 *  every later write (a stale in-memory copy must never be echoed back). */
export const DAILY_REPORT_INSERT_ONLY = ['user_id', 'project_id', 'created_at', 'portal_state'] as const;

/**
 * #131 · The frozen sales-tax figures a CO carries once sent. Only keys the CO
 * actually holds are written — a CO that never froze tax sends none of these
 * columns, so an older row is never blanked and an edit from a device ahead of
 * the migration cannot be refused over a column it never touched. null clears.
 */
export function changeOrderTaxColumns(co: {
  taxRatePct?: number | null; taxAmount?: number | null;
  totalWithTax?: number | null; priorApprovedChangesTotal?: number | null;
}): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (co.taxRatePct !== undefined) out.tax_rate_pct = co.taxRatePct;
  if (co.taxAmount !== undefined) out.tax_amount = co.taxAmount;
  if (co.totalWithTax !== undefined) out.total_with_tax = co.totalWithTax;
  if (co.priorApprovedChangesTotal !== undefined) out.prior_approved_changes_total = co.priorApprovedChangesTotal;
  return out;
}

/** The read side of changeOrderTaxColumns. numeric comes back as a string
 *  from PostgREST; an absent or null column stays undefined, never 0 — a 0
 *  would print "tax $0.00" on a CO that simply predates the freeze. */
export function changeOrderTaxFromRow(r: Record<string, unknown>): {
  taxRatePct?: number; taxAmount?: number; totalWithTax?: number; priorApprovedChangesTotal?: number;
} {
  const num = (v: unknown): number | undefined => {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const out: { taxRatePct?: number; taxAmount?: number; totalWithTax?: number; priorApprovedChangesTotal?: number } = {};
  const rate = num(r.tax_rate_pct); if (rate !== undefined) out.taxRatePct = rate;
  const tax = num(r.tax_amount); if (tax !== undefined) out.taxAmount = tax;
  const total = num(r.total_with_tax); if (total !== undefined) out.totalWithTax = total;
  const prior = num(r.prior_approved_changes_total); if (prior !== undefined) out.priorApprovedChangesTotal = prior;
  return out;
}

/**
 * #47 · The billing recipient columns. `updates` null = an INSERT (write what
 * the invoice holds); otherwise an UPDATE writes only a key the edit named.
 * An empty or blank address is stored as null — invoice-dunning then falls
 * back to the portal invitee rather than mailing "".
 */
export function invoiceBillToColumns(
  inv: { billToEmail?: string | null; billToName?: string | null },
  updates: { billToEmail?: unknown; billToName?: unknown } | null,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const clean = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t ? t : null;
  };
  if (updates === null) {
    // Omitted when empty: a create with no billing contact never references
    // the column at all.
    const email = clean(inv.billToEmail);
    const name = clean(inv.billToName);
    if (email) out.bill_to_email = email;
    if (name) out.bill_to_name = name;
    return out;
  }
  if ('billToEmail' in updates) out.bill_to_email = clean(inv.billToEmail);
  if ('billToName' in updates) out.bill_to_name = clean(inv.billToName);
  return out;
}

/** The read side of invoiceBillToColumns. */
export function invoiceBillToFromRow(r: Record<string, unknown>): { billToEmail?: string; billToName?: string } {
  const out: { billToEmail?: string; billToName?: string } = {};
  if (typeof r.bill_to_email === 'string' && r.bill_to_email.trim()) out.billToEmail = r.bill_to_email;
  if (typeof r.bill_to_name === 'string' && r.bill_to_name.trim()) out.billToName = r.bill_to_name;
  return out;
}

/**
 * #40 · The audit entries a CO edit must APPEND on the server: every entry of
 * the new trail whose id the old trail did not hold. change_orders.audit_trail
 * is never written whole from a device any more (it erased the sealed
 * e-signature the portal RPC appends server-side); new entries go through
 * co_append_audit, which skips ids already present. Entries with no id are
 * skipped — the RPC refuses them and they could never be de-duplicated.
 */
export function newAuditEntries<E extends { id?: unknown }>(
  prevTrail: readonly E[] | null | undefined,
  nextTrail: readonly E[] | null | undefined,
): E[] {
  const seen = new Set((prevTrail ?? []).map(e => e?.id).filter((id): id is string => typeof id === 'string'));
  const out: E[] = [];
  for (const e of nextTrail ?? []) {
    if (!e || typeof e.id !== 'string' || !e.id.trim() || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/** co_append_audit refuses more than 50 entries in one call. */
export const CO_AUDIT_APPEND_MAX = 50;

/** Split into RPC-sized batches, order kept. */
export function chunkForAppend<E>(entries: readonly E[], max: number = CO_AUDIT_APPEND_MAX): E[][] {
  const out: E[][] = [];
  for (let i = 0; i < entries.length; i += max) out.push(entries.slice(i, i + max));
  return out;
}

/**
 * #40 · Should a change_orders realtime UPDATE re-read the list? It used to
 * fire only on a status change, so an audit-only append made on the server
 * (the client's sealed e-signature) never reached the GC's screen. With the
 * default replica identity `old` carries only the key, so any difference in
 * status, updated_at or the trail counts.
 */
export function coRealtimeShouldRefetch(
  next: Record<string, unknown> | null | undefined,
  old: Record<string, unknown> | null | undefined,
): boolean {
  if (!next) return false;
  const o = old ?? {};
  if (next.status !== o.status) return true;
  if (next.updated_at !== o.updated_at) return true;
  return JSON.stringify(next.audit_trail ?? null) !== JSON.stringify(o.audit_trail ?? null);
}

/**
 * #92 · Why this device must not delete a project, or null when it may. Only
 * the owner can: projects_delete is `auth.uid() = user_id`, so a collaborator's
 * (even an editor's) DELETE matches 0 rows, reports success, and the local
 * cascade had already wiped every child record from his phone until the job
 * reappeared on the next load. A project with no ownerUserId predates the
 * field and is his exactly when it carries no collaborator role (A-1) — the
 * same rule as utils/portalLiteSync.isPortalOwner. Signed out, every project
 * is a local one.
 */
export const DELETE_NOT_OWNER_REASON = 'Only the project owner can delete this job. You can leave it instead.';
/**
 * Wave 5 #61 (CONTRACT 22): the safety rule, checked after the owner rule. A
 * job with injury / near-miss records on the OSHA 300 log is not deleted —
 * those records must be kept for 5 years, and deleting the job cascaded them
 * away. `safety.incidentCount` is the job's count as the caller knows it (the
 * device's incidents, else the server's head count — see ProjectContext
 * deleteProject); absent or 0 passes.
 */
export function deleteProjectRefusal(
  project: { ownerUserId?: string | null; myRole?: ProjectRole | undefined; name?: string } | undefined,
  userId: string | null | undefined,
  safety?: { incidentCount?: number | null },
): string | null {
  if (!project) return null;
  let owner: string | null;
  if (project.ownerUserId) {
    owner = !userId || project.ownerUserId === userId ? null : DELETE_NOT_OWNER_REASON;
  } else {
    owner = !project.myRole || project.myRole === 'owner' ? null : DELETE_NOT_OWNER_REASON;
  }
  if (owner) return owner;
  return deleteProjectSafetyRefusal(project.name, safety?.incidentCount);
}

/** The server could not be asked (offline, timed out, refused the read) and
 *  the device knows of no incident: the delete waits — a guess either way
 *  would erase records OSHA says to keep. */
export const SAFETY_CHECK_OFFLINE_REASON = 'Can’t check this job’s safety records offline — try again with signal.';

/** The action a safety refusal offers instead of Delete. */
export const DELETE_SAFETY_ACTION = 'mark_closed' as const;

/** '<Job> has N injury/near-miss record(s) on your OSHA 300 log, which must be
 *  kept for 5 years. Mark the job Closed instead.' — null for no records. */
export function deleteProjectSafetyRefusal(jobName: string | null | undefined, incidentCount: number | null | undefined): string | null {
  const n = typeof incidentCount === 'number' && Number.isFinite(incidentCount) ? Math.floor(incidentCount) : 0;
  if (n <= 0) return null;
  const job = (jobName ?? '').trim() || 'This job';
  return `${job} has ${n} injury/near-miss record${n === 1 ? '' : 's'} on your OSHA 300 log, which must be kept for 5 years. Mark the job Closed instead.`;
}

/**
 * The job's incidents this DEVICE knows of: its cached incident list (the
 * SafetyContext copy) plus incident inserts still in the offline queue — one
 * filed in a basement is on no server yet, and the server's count cannot see
 * it. Each id counted once.
 */
export function localSafetyIncidentCount(
  projectId: string,
  cached: readonly { id?: unknown; projectId?: unknown }[] | null | undefined,
  queue: readonly QueueEntryLike[] | null | undefined,
): number {
  const ids = new Set<string>();
  let anonymous = 0;
  for (const i of cached ?? []) {
    if (!i || i.projectId !== projectId) continue;
    if (typeof i.id === 'string' && i.id) ids.add(i.id); else anonymous++;
  }
  for (const q of queue ?? []) {
    if (q.table !== 'safety_incidents' || (q.operation !== 'insert' && q.operation !== 'upsert')) continue;
    if (q.data?.project_id !== projectId) continue;
    const id = q.data?.id;
    if (typeof id === 'string' && id) ids.add(id); else anonymous++;
  }
  return ids.size + anonymous;
}

/**
 * #116 (FOUNDER interim: owner / editor only) · Why this device may not send
 * to — or recall from — the client portal, or null when it may. The owner
 * always may; anyone else needs an ACCEPTED editor row for himself, read
 * fresh from project_collaborators (the role on the cached project can be a
 * day old). A field or viewer seat is refused with the reason; so is a failed
 * read, rather than guessing either way. Refusing here also means the
 * portal_messages insert — which RLS refuses for anyone but the owner — is
 * never queued as a write that can only ever fail.
 */
export const PORTAL_OWNER_DECIDES_REASON = 'The project owner decides what the homeowner sees. Ask them to send this to the client portal.';
export const PORTAL_ACCESS_UNKNOWN_REASON = 'Couldn’t check your access to this project’s client portal — check your signal and try again.';
export function portalWriteRefusal(input: {
  project: { ownerUserId?: string | null; myRole?: ProjectRole | undefined } | undefined;
  userId: string | null | undefined;
  /** This project's collaborator rows, or 'error' when they could not be read. */
  collaborators: readonly Pick<ProjectCollaborator, 'userId' | 'role' | 'status'>[] | 'error' | null;
}): string | null {
  const { project, userId, collaborators } = input;
  if (!project) return null;
  if (project.ownerUserId ? project.ownerUserId === userId : (!project.myRole || project.myRole === 'owner')) return null;
  if (!userId) return PORTAL_OWNER_DECIDES_REASON;
  if (collaborators === 'error' || collaborators === null) return PORTAL_ACCESS_UNKNOWN_REASON;
  const mine = collaborators.find(c => c.userId === userId && c.status === 'accepted');
  return mine?.role === 'editor' ? null : PORTAL_OWNER_DECIDES_REASON;
}

/**
 * #48 · Server rows, but a row this device still has a queued write for keeps
 * the DEVICE copy: that copy is newer than the server's until the write lands.
 * mergeLocalOnly kept only rows MISSING from the server, so re-reading the
 * invoices on foreground (to pick up a Stripe payment) would have put the
 * pre-edit server row over an offline payment he had just recorded. Local-only
 * pending rows are kept as mergeLocalOnly keeps them.
 */
export function mergeServerKeepingPending<T extends { id: string }>(
  serverRows: readonly T[],
  localRows: readonly T[],
  pendingIds: ReadonlySet<string>,
  opts?: MergeLocalOnlyOptions<T>,
): T[] {
  // #112: mergeLocalOnly now keeps the device row for a pending id itself;
  // this name stays for its callers (and the validators that pin them).
  return mergeLocalOnly(serverRows, localRows, pendingIds, opts);
}

/**
 * #121 · Owned, portal-proposal projects whose published terms stamp is NOT
 * `split`. The toast "proposal, portal and contract now all say 25 / 65 / 10"
 * used to be chosen whenever no portal was MISSING a stamp — so a portal the
 * web had already stamped 30 / 60 / 10 still counted as agreeing. It is only
 * true when this list is empty (and nothing was left unstamped).
 */
export function portalsDisagreeingWithSplit(
  projects: readonly { id: string; ownerUserId?: string | null; clientPortal?: Pick<ClientPortalSettings, 'enabled' | 'proposalApprovalEnabled' | 'proposalPaymentTerms'> | null }[],
  userId: string | null | undefined,
  split: PaymentSplit,
): string[] {
  if (!userId) return [];
  return projects
    .filter(p => p.ownerUserId === userId
      && !!p.clientPortal?.enabled
      && !!p.clientPortal.proposalApprovalEnabled
      && isValidStamp(p.clientPortal.proposalPaymentTerms)
      && !sameSplit(p.clientPortal.proposalPaymentTerms, split))
    .map(p => p.id);
}

/**
 * #23 · Everything one project's lite portal publish is built from, as a
 * string — the provider-level sync publishes a project only when this moved
 * since its last good publish. Tenant-wide lists are cut to the project first,
 * so a change on one job never re-publishes every other job's portal.
 */
export function portalLiteSignature(
  projectId: string,
  input: {
    project: unknown;
    settings: unknown;
    lists: Record<string, readonly { projectId?: string }[]>;
  },
): string {
  const lists: Record<string, unknown[]> = {};
  for (const key of Object.keys(input.lists).sort()) {
    lists[key] = input.lists[key].filter(r => r?.projectId === projectId);
  }
  return JSON.stringify({ project: input.project, settings: input.settings, lists });
}

/** A lite publish that settled this signature: the portal holds it, or has
 *  nothing to hold. Anything else (a failed read or write, a run folded into
 *  one already in flight, a profile not loaded) is retried on the next pass. */
export function portalLiteOutcomeSettles(outcome: string): boolean {
  return outcome === 'published' || outcome === 'unchanged' || outcome === 'portal_off' || outcome === 'not_owner';
}

/**
 * #116 (review round) · May this device write the portal_messages notice that
 * goes with a send or recall? Only the owner: the insert policy ('gc inserts
 * own portal messages') admits projects.user_id = auth.uid() and nobody else,
 * so an ACCEPTED editor — who may send (portalWriteRefusal) — would still
 * queue a notice that can never land. The item's portal_state write and the
 * owner's provider republish carry the send; only the chat line is skipped.
 * Same owner rule as portalWriteRefusal / deleteProjectRefusal (A-1).
 */
export function portalMessageAllowed(
  project: { ownerUserId?: string | null; myRole?: ProjectRole | undefined } | undefined,
  userId: string | null | undefined,
): boolean {
  if (!project || !userId) return false;
  if (project.ownerUserId) return project.ownerUserId === userId;
  return !project.myRole || project.myRole === 'owner';
}

/**
 * #40 (review round) · The change_orders loader's rows with every audit entry
 * this device still owes the server laid back on. The loader takes the server
 * row once the queued UPDATE has flushed, and the server row lacks what
 * co_append_audit has not appended yet — the client's in-person signature, a
 * "place these days" marker — so without this they vanished from the screen
 * until the append landed (and a missing marker let a second one be written).
 * Server order first; a pending entry the server already holds is not doubled.
 */
export function overlayPendingAudit<R extends { id: string; auditTrail?: E[] | null }, E extends { id?: unknown }>(
  rows: readonly R[],
  pending: ReadonlyMap<string, readonly E[]>,
): R[] {
  if (pending.size === 0) return rows as R[];
  return rows.map((r) => {
    const owed = pending.get(r.id);
    if (!owed || owed.length === 0) return r;
    const add = newAuditEntries(r.auditTrail ?? [], owed);
    return add.length ? { ...r, auditTrail: [...(r.auditTrail ?? []), ...add] } : r;
  });
}

/** The durable form of the pending CO audit appends (AsyncStorage). */
export type CoAuditPendingStore<E> = { owner: string; pending: Record<string, E[]> };

/** Read a stored pending-append map back — only this account's, only arrays. */
export function coAuditPendingFromStore<E>(stored: unknown, owner: string | null | undefined): Map<string, E[]> {
  const out = new Map<string, E[]>();
  if (!owner || !stored || typeof stored !== 'object') return out;
  const s = stored as Partial<CoAuditPendingStore<E>>;
  if (s.owner !== owner || !s.pending || typeof s.pending !== 'object') return out;
  for (const [id, list] of Object.entries(s.pending)) {
    if (Array.isArray(list) && list.length) out.set(id, list);
  }
  return out;
}

/**
 * #40 review round · Ids whose DEVICE copy a change_orders read must keep: a
 * write from this device (UPDATE or audit append) is on the wire, or settled
 * after the read went out — that read may have been answered before the write
 * landed, so its row is the pre-edit one. A write that settled before the read
 * started is already in what the read returns.
 */
export function idsWrittenDuringRead(
  touches: ReadonlyMap<string, { inFlight: number; settledAt: number }>,
  readStartedAt: number,
): Set<string> {
  const out = new Set<string>();
  for (const [id, t] of touches) if (t.inFlight > 0 || t.settledAt >= readStartedAt) out.add(id);
  return out;
}
/** The change-order name of idsWrittenDuringRead (context-money-portal). */
export const coIdsWrittenDuringRead = idsWrittenDuringRead;

/**
 * #23 review round · The projects a LOCAL write of one list touched: an item
 * added, removed or changed between the list the write replaced and the list
 * it wrote. The provider publishes a portal for projects this device changed
 * (plus once after load) and — #17 (wave 4) — for a shared record another
 * member of the job filed, once SERVER reads brought it in (see
 * portalArrivalProjectIds below; a cache read never marks). An item without a
 * projectId marks nothing.
 */
export function portalDirtyProjectIds<T extends { id: string; projectId?: string }>(
  prev: readonly T[] | null | undefined,
  next: readonly T[] | null | undefined,
  projectOf: (r: T) => string | undefined = r => r.projectId,
): Set<string> {
  const out = new Set<string>();
  const before = new Map<string, T>();
  for (const r of prev ?? []) if (r && !before.has(r.id)) before.set(r.id, r);
  const seen = new Set<string>();
  for (const r of next ?? []) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    const old = before.get(r.id);
    if (old === r) continue;
    if (old && JSON.stringify(old) === JSON.stringify(r)) continue;
    const pid = projectOf(r);
    if (pid) out.add(pid);
    const oldPid = old ? projectOf(old) : undefined;
    if (oldPid && oldPid !== pid) out.add(oldPid);
  }
  for (const [id, old] of before) {
    const pid = seen.has(id) ? undefined : projectOf(old);
    if (pid) out.add(pid);
  }
  return out;
}

/** Same, for the projects list itself: a project whose row this device changed. */
export function portalDirtyProjects(
  prev: readonly { id: string }[] | null | undefined,
  next: readonly { id: string }[] | null | undefined,
): Set<string> {
  return portalDirtyProjectIds<{ id: string }>(prev, next, p => p.id);
}

/** The shape portalArrivalProjectIds reads off a daily report or a photo. */
export interface PortalArrivalRow {
  id: string;
  projectId?: string;
  portalState?: { status?: string } | null;
}

/**
 * #17 (wave 4) · The OWNER's portal jobs a server read must republish because
 * a SHARED record ANOTHER member of the job filed arrived, changed, or left.
 *
 * A foreman's (editor seat's) daily report and photos land with portal_state
 * 'sent' (auto-share), but his device may not publish (not_owner) and the
 * portal overlay can only REMOVE items — so they reached the homeowner only
 * when the GC happened to edit that job himself. Now the owner's provider
 * compares the lists its last publish pass saw with the ones it holds now
 * (both server reads of the current epoch — the caller only asks while every
 * portal-fed list is the server's), and marks the job.
 *
 * Counted: a row by someone else (`authorOf` known and not `viewerId`) that is
 * shared (isShared: no portal_state, or status 'sent') and is new, or changed
 * in anything but its device-local fields (`fingerprint` — a photo's signed
 * URL is re-minted on every read and must not count), plus a previously
 * shared row by someone else that is gone or no longer shared. Only jobs in
 * `ownedPortalProjectIds` (his own, portal on). A row with no author on
 * record, or his own, never marks here: his own writes mark through the
 * tracked saves, and a change he made on the web is published by the web.
 * Under the #59 interim a field / viewer seat's rows arrive as draft, so they
 * mark nothing until the GC sends them (a tracked save).
 */
export function portalArrivalProjectIds<T extends PortalArrivalRow>(
  prev: readonly T[] | null | undefined,
  next: readonly T[] | null | undefined,
  opts: {
    viewerId: string;
    ownedPortalProjectIds: ReadonlySet<string>;
    authorOf: (r: T) => string | null | undefined;
    fingerprint: (r: T) => string;
  },
): Set<string> {
  const out = new Set<string>();
  const sharedByOther = (r: T): boolean => {
    const author = opts.authorOf(r);
    if (!author || author === opts.viewerId) return false;
    const status = r.portalState?.status;
    return status == null || status === 'sent';
  };
  const mark = (r: T) => { if (r.projectId && opts.ownedPortalProjectIds.has(r.projectId)) out.add(r.projectId); };
  const before = new Map<string, T>();
  for (const r of prev ?? []) if (r && !before.has(r.id)) before.set(r.id, r);
  const seen = new Set<string>();
  for (const r of next ?? []) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    const old = before.get(r.id);
    const nowShared = sharedByOther(r);
    const wasShared = !!old && sharedByOther(old);
    if (nowShared) {
      if (!old || !wasShared || opts.fingerprint(old) !== opts.fingerprint(r)) mark(r);
      if (old && old.projectId !== r.projectId && wasShared) mark(old);
    } else if (wasShared) {
      mark(old!);
    }
  }
  for (const [id, old] of before) if (!seen.has(id) && sharedByOther(old)) mark(old);
  return out;
}

/**
 * #17 · A row's identity for portalArrivalProjectIds with its device-local
 * fields dropped: `uri` / `localUri` (a signed URL re-minted on every read, a
 * file path only this phone has) at the top level and on nested photos, and
 * the local-only leak scan. What is left is what the portal is built from.
 */
export function portalContentFingerprint(r: object): string {
  const strip = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(strip);
    if (!o || typeof o !== 'object') return o;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o as Record<string, unknown>).sort()) {
      if (k === 'uri' || k === 'localUri' || k === 'leakScan') continue;
      out[k] = strip((o as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(strip(r));
}

// ─── #90 · A job he was removed from leaves his phone ───────────────────────

/** The cached shape the revocation decision reads. */
export interface CachedProjectLike {
  id: string;
  name?: string;
  ownerUserId?: string | null;
  myRole?: ProjectCollaborator['role'] | null;
}

/**
 * #90 · Cached projects a SUCCESSFUL projects read says he can no longer see:
 * the server did not return them, and they are someone else's — a known owner
 * who is not him, or (a legacy cache with no owner stamp) a collaborator role
 * stamped on them. A cached project with no owner and no collaborator role is
 * his own offline create or an unstamped legacy row, and is KEPT: never lock
 * an owner out of a job the server has not seen yet.
 *
 * The loader used to keep every cached project the server stopped returning,
 * and a zero-row read fell through to the whole cache — so the GC removing a
 * foreman left the job on the foreman's phone for good, and roleForUser (no
 * collaborator row → 'owner') then handed him the owner's controls.
 */
export function revokedCachedProjectIds(
  cached: readonly CachedProjectLike[],
  returnedIds: ReadonlySet<string>,
  userId: string | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!userId) return out;
  for (const p of cached) {
    if (!p?.id || returnedIds.has(p.id)) continue;
    const foreignOwner = !!p.ownerUserId && p.ownerUserId !== userId;
    const legacyShared = !p.ownerUserId && !!p.myRole && p.myRole !== 'owner';
    if (foreignOwner || legacyShared) out.add(p.id);
  }
  return out;
}

/** The sentence a queued write for a job he lost access to is dropped with. */
export function noLongerHaveAccessReason(jobName: string | null | undefined): string {
  const name = (jobName ?? '').trim();
  return `You no longer have access to ${name ? name : 'this job'}`;
}

/**
 * #90 · Which job a queued write belongs to, when it is one of `projectIds`:
 * a projects row by id, any row carrying project_id, or a child row whose id
 * the device cache ties to one of those jobs (an UPDATE patch carries no
 * project_id). Returns the project id, or null to keep the entry.
 */
export function queuedEntryRevokedProject(
  entry: QueueEntryLike,
  projectIds: ReadonlySet<string>,
  childProjectById: ReadonlyMap<string, string>,
): string | null {
  const data = entry.data ?? {};
  const id = typeof data.id === 'string' ? data.id : null;
  if (entry.table === 'projects' || entry.table === 'project_financials') {
    const pid = entry.table === 'projects' ? id : (typeof data.project_id === 'string' ? data.project_id : null);
    return pid && projectIds.has(pid) ? pid : null;
  }
  const pid = typeof data.project_id === 'string' ? data.project_id : null;
  if (pid && projectIds.has(pid)) return pid;
  const viaChild = id ? childProjectById.get(id) : undefined;
  return viaChild && projectIds.has(viaChild) ? viaChild : null;
}

/**
 * #8/#128 (wave 4) · How many queue entries belong to one job — by the SAME
 * matcher the leave / revocation sweep discards with (queuedEntryRevokedProject
 * with the record → job map), so the number "Leave project" warns about is
 * exactly what leaving would throw away. Matching on project_id alone missed
 * child UPDATEs (a punch status edit, a daily report's second save), which tie
 * to the job only through the map.
 */
export function countQueuedEntriesForProject(
  queue: readonly QueueEntryLike[],
  projectId: string,
  childProjectById: ReadonlyMap<string, string>,
): number {
  if (!projectId) return 0;
  const ids = new Set([projectId]);
  let n = 0;
  for (const entry of queue) if (queuedEntryRevokedProject(entry, ids, childProjectById) === projectId) n += 1;
  return n;
}

// ─── #55 · RFI / submittal edits write only what changed ─────────────────────

/** RFI field → rfis column, for every column rfiMutableRow writes. A field not
 *  listed here (portalState, number, projectId, updatedAt) is never sent by an
 *  edit: portal_state belongs to send/recall, number to the server (#148). */
export const RFI_FIELD_COLUMNS: Readonly<Record<string, string>> = {
  subject: 'subject', question: 'question', submittedBy: 'submitted_by',
  assignedTo: 'assigned_to', assignedSubId: 'assigned_sub_id',
  ballInCourt: 'ball_in_court', handoffs: 'handoffs',
  dateSubmitted: 'date_submitted', dateRequired: 'date_required',
  dateResponded: 'date_responded', response: 'response',
  status: 'status', priority: 'priority',
  linkedDrawing: 'linked_drawing', linkedTaskId: 'linked_task_id',
  attachments: 'attachments', sourcePhotoId: 'source_photo_id',
};

/** Submittal field → submittals column. review_cycles / current_status are
 *  listed so an explicit edit of them still maps, but addReviewCycle never
 *  writes them — it goes through submittal_append_review_cycle. */
export const SUBMITTAL_FIELD_COLUMNS: Readonly<Record<string, string>> = {
  title: 'title', specSection: 'spec_section', submittedBy: 'submitted_by',
  submittedDate: 'submitted_date', requiredDate: 'required_date',
  reviewCycles: 'review_cycles', currentStatus: 'current_status',
  attachments: 'attachments',
  linkedTaskId: 'linked_task_id', submittalType: 'submittal_type', trade: 'trade',
  sourcePages: 'source_pages', leadDays: 'lead_days', requiredDateSource: 'required_date_source',
};

/** Columns rfi-core's guard watches (20260919080000 CLIENT WRITE CONTRACT §1):
 *  a write naming one of them MUST name updated_at. */
export const RFI_GUARDED_COLUMNS: readonly string[] = ['response', 'date_responded', 'status', 'ball_in_court', 'handoffs'];
export const SUBMITTAL_GUARDED_COLUMNS: readonly string[] = ['review_cycles', 'current_status'];

/**
 * #55 · The UPDATE payload for an edit: `id`, the columns of the fields the
 * caller actually changed (the keys of `updates`, even one set to undefined —
 * that is a clear, sent as the builder's null), and updated_at. Every value is
 * taken from the SAME row builder the insert uses, so an edit can never write
 * a column in a different shape from a create.
 *
 * Writing the whole mutable row from the device copy is how the architect's
 * portal answer was erased: a phone holding the 7am copy sent response NULL,
 * status 'open' on an unrelated edit. `updatedAt` is the updated_at of the copy
 * the edit was made on (the server's own value after a read; a device stamp
 * after a local edit). rfi-core's guard steps aside only when that equals the
 * server's current value — the writer saw the current row, so a deliberate
 * reopen lands — and coerces everything else (contract rules 2-3). A
 * device-stamped value never equals a server stamp, so it always takes the
 * guarded path.
 */
export function rowPatch(
  fullRow: Record<string, unknown>,
  changedFields: readonly string[],
  columnOf: Readonly<Record<string, string>>,
  updatedAt: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: fullRow.id };
  for (const f of changedFields) {
    const col = columnOf[f];
    if (!col || col === 'id') continue;
    out[col] = Object.prototype.hasOwnProperty.call(fullRow, col) && fullRow[col] !== undefined ? fullRow[col] : null;
  }
  out.updated_at = updatedAt;
  return out;
}

/** #60 / #144 · The intake columns (20260919090000), in and out. `?? null` on
 *  the way out so a cleared link reaches the server; undefined on the way in
 *  for NULL so an unset field stays unset. */
export function submittalIntakeColumns(s: {
  linkedTaskId?: string; submittalType?: string; trade?: string;
  sourcePages?: number[]; leadDays?: number; requiredDateSource?: 'schedule' | 'manual';
}): Record<string, unknown> {
  return {
    linked_task_id: s.linkedTaskId || null,
    submittal_type: s.submittalType ?? null,
    trade: s.trade ?? null,
    source_pages: Array.isArray(s.sourcePages) ? s.sourcePages : null,
    lead_days: typeof s.leadDays === 'number' && Number.isFinite(s.leadDays) ? Math.round(s.leadDays) : null,
    required_date_source: s.requiredDateSource === 'schedule' || s.requiredDateSource === 'manual' ? s.requiredDateSource : null,
  };
}

export function submittalIntakeFromRow(r: Record<string, unknown>): {
  linkedTaskId?: string; submittalType?: string; trade?: string;
  sourcePages?: number[]; leadDays?: number; requiredDateSource?: 'schedule' | 'manual';
} {
  const pages = Array.isArray(r.source_pages)
    ? (r.source_pages as unknown[]).map(Number).filter(n => Number.isFinite(n))
    : undefined;
  const src = r.required_date_source;
  return {
    linkedTaskId: (r.linked_task_id as string | null) || undefined,
    submittalType: (r.submittal_type as string | null) ?? undefined,
    trade: (r.trade as string | null) ?? undefined,
    sourcePages: pages,
    leadDays: r.lead_days == null || !Number.isFinite(Number(r.lead_days)) ? undefined : Number(r.lead_days),
    requiredDateSource: src === 'schedule' || src === 'manual' ? src : undefined,
  };
}

/** #16 / #111 · Punch columns the app READS but never writes on an update:
 *  who raised the item (user_id, stamped on insert) and the sub's note (the
 *  sub portal's RPC owns sub_note — an app write would overwrite it). */
export function punchServerOwnedFromRow(r: Record<string, unknown>): { createdByUserId?: string; subNote?: string } {
  return {
    createdByUserId: (r.user_id as string | null) ?? undefined,
    subNote: (r.sub_note as string | null) ?? undefined,
  };
}

/** #112 combiner for punch: the device row wins for a queued write, but the
 *  columns the device never writes stay the server's — the sub's note, and
 *  the pin (keepPendingPinFields then restores THIS device's pin only where
 *  its pin write is still out, so another phone's pin is never hidden). */
export function combinePunchPending<T extends {
  subNote?: string; planSheetId?: string; pinX?: number; pinY?: number; createdByUserId?: string;
}>(local: T, server: T): T {
  return {
    ...local,
    subNote: server.subNote,
    planSheetId: server.planSheetId, pinX: server.pinX, pinY: server.pinY,
    createdByUserId: local.createdByUserId ?? server.createdByUserId,
  };
}

// ─── #74 · plans re-read without wiping what is still on its way ────────────

export const PLAN_SYNC_TABLES: readonly string[] = ['plan_sheets', 'drawing_pins', 'plan_markups', 'plan_calibrations'];

/** Any queued write (create, edit or delete) to a plan table. A plans re-read
 *  replaces the lists from server rows, so it waits for these to land. */
export function planWritesQueued(queue: readonly QueueEntryLike[]): boolean {
  return queue.some(e => PLAN_SYNC_TABLES.includes(e.table));
}

/** A plans RE-read's merge: the server row wins by id, and a device row the
 *  server did not return is kept (a sheet imported moments ago whose write is
 *  on the wire and in no queue yet). A deletion made on another device is
 *  therefore only seen on the next cold load — the same as before (#74 leaves
 *  that known limit alone). */
export function unionServerFirst<T extends { id: string }>(
  serverRows: readonly T[],
  localRows: readonly T[],
  /** Review round 1 · ids this device wrote while the read was out (a write
   *  on the wire, or one that settled after the read started — see
   *  idsWrittenDuringRead). The read may predate the write, so for these the
   *  DEVICE is the truth: its row is kept, and an id it no longer holds (a
   *  delete in flight) is left out rather than resurrected. */
  keepLocalIds?: ReadonlySet<string>,
): T[] {
  const localById = new Map<string, T>();
  if (keepLocalIds && keepLocalIds.size > 0) for (const r of localRows) if (!localById.has(r.id)) localById.set(r.id, r);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of serverRows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (keepLocalIds?.has(r.id)) {
      const mine = localById.get(r.id);
      if (mine) out.push(mine);
      continue;
    }
    out.push(r);
  }
  for (const r of localRows) { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } }
  return out;
}

// ─── #55 review round · which updated_at an RFI / submittal edit sends ──────
//
// The answer guard (20260919080000) steps aside only when a write names the
// row's CURRENT server updated_at. The first cut sent the local copy's
// updatedAt — the server's stamp after a read, but a DEVICE clock after any
// edit of his own, because a direct write triggers no re-read. So "fix the
// response text, then tap Reopen" sent a device stamp: the guard kept the RFI
// answered while the screen said open, and the next refetch flipped it back
// with no word. The server's stamp now lives apart from the display one
// (serverUpdatedAt), set only by a server read or the read-back after his own
// write lands, and cleared the moment he sends an edit. An edit that would
// REGRESS a guarded column (reopen, clear the answer, rewrite the custody
// chain / review cycles, move a submittal's status without a new cycle) is
// sent only with a known server stamp; otherwise it is refused, with why,
// instead of being silently undone on the server.

/** Canonical JSON: object keys sorted (jsonb reorders them), so a value read
 *  back from Postgres compares equal to the one the device wrote. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function isAppendOf(before: readonly unknown[], after: readonly unknown[]): boolean {
  if (after.length < before.length) return false;
  for (let i = 0; i < before.length; i++) if (canonicalJson(before[i]) !== canonicalJson(after[i])) return false;
  return true;
}

const nonEmptyText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/** The guarded regression an RFI edit makes, or null (contract §2's list). */
export function rfiEditRegression(
  before: { status?: string; response?: string; dateResponded?: string; handoffs?: readonly unknown[] },
  updates: Record<string, unknown>,
): 'reopen' | 'clear_response' | 'clear_date_responded' | 'rewrite_handoffs' | null {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(updates, k);
  if (has('status') && updates.status === 'open' && (before.status === 'answered' || before.status === 'closed')) return 'reopen';
  if (has('response') && nonEmptyText(before.response) && !nonEmptyText(updates.response)) return 'clear_response';
  if (has('dateResponded') && nonEmptyText(before.dateResponded) && !nonEmptyText(updates.dateResponded)) return 'clear_date_responded';
  if (has('handoffs') && !isAppendOf(before.handoffs ?? [], (updates.handoffs as unknown[] | undefined) ?? [])) return 'rewrite_handoffs';
  return null;
}

/** The guarded regression a submittal edit makes, or null: a review cycle the
 *  server has rewritten or removed, or a status moved without appending the
 *  cycle that carries it (the guard keeps the server's status then). */
export function submittalEditRegression(
  before: { reviewCycles?: readonly { status?: string }[]; currentStatus?: string },
  updates: Record<string, unknown>,
): 'rewrite_cycles' | 'status_change' | null {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(updates, k);
  const beforeCycles = before.reviewCycles ?? [];
  const cycles = has('reviewCycles') ? ((updates.reviewCycles as { status?: string }[] | undefined) ?? []) : beforeCycles;
  if (has('reviewCycles') && !isAppendOf(beforeCycles, cycles)) return 'rewrite_cycles';
  if (has('currentStatus') && updates.currentStatus !== before.currentStatus) {
    const appended = cycles.length > beforeCycles.length;
    if (!(appended && cycles[cycles.length - 1]?.status === updates.currentStatus)) return 'status_change';
  }
  return null;
}

export type ProDocEditPlan<T> =
  | { ok: true; next: T; changedKeys: string[]; stamp: string; deliberate: boolean }
  | { ok: false; title: string; reason: string };

/**
 * The whole decision of updateRFI / updateSubmittal, pure so a SEQUENCE of
 * edits is executed by the validator: the new local row, the fields the patch
 * names, and the updated_at it sends.
 *  - serverUpdatedAt / updatedAt in `updates` are ignored — the provider owns
 *    both (a screen passing its render copy back must not restore a stale
 *    server stamp).
 *  - sending: the stamp is the known server stamp (a deliberate edit — the
 *    guard steps aside) or, unknown, the device clock (the guard applies:
 *    safe for every edit that is not a regression). The new local row's
 *    serverUpdatedAt is cleared: the server stamps a new value on landing.
 *  - a regression with no known server stamp is REFUSED, with why.
 *  - not sending (signed out / no backend): local edit only, stamp kept.
 */
export function planProDocEdit<T extends { updatedAt: string; serverUpdatedAt?: string }>(a: {
  kind: 'rfi' | 'submittal';
  before: T;
  updates: Partial<T>;
  nowIso: string;
  sending: boolean;
}): ProDocEditPlan<T> {
  const clean: Record<string, unknown> = { ...(a.updates as Record<string, unknown>) };
  delete clean.serverUpdatedAt;
  delete clean.updatedAt;
  const before = a.before as unknown as Record<string, unknown>;
  const regression = a.kind === 'rfi'
    ? rfiEditRegression(before as Parameters<typeof rfiEditRegression>[0], clean)
    : submittalEditRegression(before as Parameters<typeof submittalEditRegression>[0], clean);
  const known = typeof a.before.serverUpdatedAt === 'string' && a.before.serverUpdatedAt.length > 0;
  if (a.sending && regression && !known) {
    const what = a.kind === 'rfi'
      ? (regression === 'reopen' ? 'reopen this RFI' : regression === 'rewrite_handoffs' ? 'change who this RFI sat with' : 'clear the answer')
      : (regression === 'status_change' ? 'change this submittal\'s status' : 'change a review cycle');
    // Worded from the before-state (rfi-core review): an RFI closed with no
    // answer on record was never "answered", so don't say the server keeps it so.
    const answered = a.kind === 'rfi'
      && ((typeof before.response === 'string' && before.response.trim().length > 0) || !!before.dateResponded);
    const kept = a.kind === 'rfi'
      ? (before.status === 'closed' && !answered ? 'keep the RFI closed' : 'keep the RFI as answered')
      : 'keep its review cycles and status';
    return {
      ok: false,
      title: a.kind === 'rfi' ? 'Not reopened yet' : 'Not changed yet',
      reason: `This phone does not have the server's latest copy (your last change may still be syncing). Try again in a moment — to ${what} now, the server would ${kept}, and this screen would disagree with it.`,
    };
  }
  const next = {
    ...a.before,
    ...(clean as Partial<T>),
    updatedAt: a.nowIso,
    serverUpdatedAt: a.sending ? undefined : a.before.serverUpdatedAt,
  } as T;
  return {
    ok: true,
    next,
    changedKeys: Object.keys(clean),
    stamp: known ? (a.before.serverUpdatedAt as string) : a.nowIso,
    deliberate: known,
  };
}

/** After his own write lands, may the stamp the server reports now be taken
 *  as the one THIS device's copy matches? Only when the server's guarded
 *  columns equal the device's (compared canonically): otherwise someone else
 *  wrote in between (the architect's answer), and adopting the stamp would
 *  let his next reopen overwrite an answer he never saw — the caller re-reads
 *  the list instead. */
export function serverStampAdoptable(
  deviceColumns: Record<string, unknown>,
  serverRow: Record<string, unknown> | null | undefined,
  guardedColumns: readonly string[],
): boolean {
  if (!serverRow || typeof serverRow.updated_at !== 'string' || serverRow.updated_at.length === 0) return false;
  return guardedColumns.every(c => canonicalJson(deviceColumns[c] ?? null) === canonicalJson(serverRow[c] ?? null));
}

// ─── #90 review round · the removed-job sweep ───────────────────────────────

/** Record id → its job, for the rows of revoked jobs across any lists (the
 *  in-memory ones AND the device caches: on a cold launch the projects load
 *  can land before the child lists hydrate, and a queued UPDATE carries no
 *  project_id — only this map ties it to the job). */
export function childProjectMap(
  lists: readonly (readonly { id?: string; projectId?: string }[] | null | undefined)[],
  revoked: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const r of list) if (r && typeof r.id === 'string' && r.projectId && revoked.has(r.projectId)) out.set(r.id, r.projectId);
  }
  return out;
}

/** Does any list still hold a record of a revoked job (a list that hydrated
 *  after the first sweep)? */
export function listsHoldRevoked(
  lists: readonly (readonly { projectId?: string }[] | null | undefined)[],
  revoked: ReadonlySet<string>,
): boolean {
  if (revoked.size === 0) return false;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const r of list) if (r?.projectId && revoked.has(r.projectId)) return true;
  }
  return false;
}

// ─── #23 (data-session critic) · a portal publish only from SERVER lists ─────

/**
 * The lists a homeowner-portal publish is built from. Every one of their
 * loaders falls back to the device cache when its read fails (or its empty
 * answer was not trusted) and still reports "loaded" — so "loaded" alone does
 * not say the list is the server's. The portal writer treats a missing item
 * or section as GONE (#44): one flaky invoices read at launch, published,
 * pulled the client's invoices and Pay links off every portal.
 */
export const PORTAL_FED_LISTS = [
  'projects', 'invoices', 'changeOrders', 'dailyReports', 'photos', 'punchItems', 'rfis', 'permits', 'warranties',
] as const;
export type PortalFedList = typeof PORTAL_FED_LISTS[number];
/**
 * #15 (wave 4) · Lists a publish reads only when they are fresh, stamped by
 * the same epoch machinery but NOT part of portalListsFromServer's nine:
 * the AIA pay applications. The lite writer builds the pay-app section FRESH
 * only when it is handed the list (utils/portalLiteSync — absent = carry the
 * published section), so the provider waits for this list's server read in
 * the current epoch too (portalSideListFresh) before any pass runs — an
 * unread AIA list handed over as "none" would pull every pay app, and its
 * Pay button, off the homeowner's page (#44). Kept out of the nine so every
 * other reader of that gate (project-detail's own publish, which does not
 * pass the AIA list and so carries it) is unchanged.
 */
export const PORTAL_SIDE_LISTS = ['aiaPayApps'] as const;
export type PortalSideList = typeof PORTAL_SIDE_LISTS[number];
/**
 * Which portal-fed lists were read from the server SINCE THE LATEST RETURN TO
 * THE FOREGROUND (round 2 of the #23 critic). `epoch` is bumped by the
 * provider's single foreground pass BEFORE it starts re-reading every list;
 * a stamp counts only for the epoch it was read in. Why epochs and not just
 * "was it the server's": the daily reports, photos, change orders, permits
 * and warranties used to be read once per launch, and an iPhone that read
 * them at 07:00 and published at 19:00 (a punch edit, any settings save)
 * rebuilt the portal from the 07:00 copies — pulling everything the GC shared
 * from the web since then off the homeowner's page (#44). With the epoch, a
 * list read before the latest foreground can never feed a publish.
 */
export interface PortalServerReads {
  epoch: number;
  /** list → the account and the epoch its read STARTED in (server answers only). */
  stamps: Partial<Record<PortalFedList | PortalSideList, { userId: string; epoch: number }>>;
}
export const EMPTY_PORTAL_SERVER_READS: PortalServerReads = { epoch: 0, stamps: {} };

/**
 * Record one load's outcome. `readEpoch` is the epoch the read STARTED in —
 * captured before the SELECT, so a read already on the wire when the phone
 * came back cannot count for the new epoch. A server answer stamps the list;
 * a cache fallback clears this account's stamp. A load from an older epoch
 * changes nothing either way: its success is too old to count, and its
 * failure says nothing about the re-read the foreground pass started (whose
 * result react-query keeps — invalidation cancels the older fetch). Returns
 * `prev` itself when nothing changed, so a React state setter is a no-op.
 */
export function notePortalListRead(
  prev: PortalServerReads, list: PortalFedList | PortalSideList, userId: string, fromServer: boolean, readEpoch: number,
): PortalServerReads {
  if (readEpoch !== prev.epoch) return prev;
  const cur = prev.stamps[list];
  if (fromServer) {
    if (cur && cur.userId === userId && cur.epoch === readEpoch) return prev;
    return { ...prev, stamps: { ...prev.stamps, [list]: { userId, epoch: readEpoch } } };
  }
  if (!cur || cur.userId !== userId) return prev;
  const stamps = { ...prev.stamps };
  delete stamps[list];
  return { ...prev, stamps };
}

/** A return to the foreground: every stamp from an earlier epoch stops counting. */
export function beginPortalReadEpoch(prev: PortalServerReads, epoch: number): PortalServerReads {
  return prev.epoch === epoch ? prev : { ...prev, epoch };
}

/** True only when EVERY portal-fed list was read from the server, for this account, in the current epoch. */
export function portalListsFromServer(reads: PortalServerReads, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return PORTAL_FED_LISTS.every((list) => {
    const s = reads.stamps[list];
    return !!s && s.userId === userId && s.epoch === reads.epoch;
  });
}

/** #15 · One side list (PORTAL_SIDE_LISTS) was read from the server, for this account, in the current epoch. */
export function portalSideListFresh(reads: PortalServerReads, list: PortalSideList, userId: string | null | undefined): boolean {
  if (!userId) return false;
  const s = reads.stamps[list];
  return !!s && s.userId === userId && s.epoch === reads.epoch;
}

/**
 * The device rows a re-read must keep, from the write tracker: an id written
 * (insert/update/delete) while the read was out is the device's — kept if the
 * device still holds it (an insert not yet committed, an edit not yet landed),
 * and treated as deleted if it does not (a delete not yet landed would
 * otherwise come back from the SELECT).
 */
export function deviceRowsWrittenDuringRead(
  touches: ReadonlyMap<string, { inFlight: number; settledAt: number }>,
  readStartedAt: number,
  deviceRows: readonly { id: string }[],
): { keep: Set<string>; gone: Set<string> } {
  const keep = idsWrittenDuringRead(touches, readStartedAt);
  const onDevice = new Set(deviceRows.map(r => r.id));
  const gone = new Set<string>();
  for (const id of keep) if (!onDevice.has(id)) gone.add(id);
  return { keep, gone };
}

// ─── #86 (wave 4) · a live schedule copy carries the active baseline ─────────

/**
 * The baselines and active-baseline id the store keeps after absorbing a
 * server copy of a schedule. Taken from the copy only when the absorb is WHOLE
 * (no unconfirmed local sync of the project — a phone with a pending lock must
 * not lose it to a peer's echo). Before, the id was never carried on any live
 * path: the GC activated v2 on the web, the phone kept v1, and its next edit
 * wrote [v1] / v1 back — deleting v2 on the server.
 *  - `adopt.baselines` absent (an older event shape): the store's stay.
 *  - `adopt.activeBaselineId`: undefined = the copy did not say (keep); null =
 *    the copy has none (clear — the key is then removed, see
 *    utils/scheduleOps.withActiveBaselineId); a string = that baseline.
 */
export function absorbedScheduleMeta<B>(
  current: { baselines?: B[]; activeBaselineId?: string },
  adopt: { baselines?: readonly unknown[]; activeBaselineId?: string | null } | undefined,
  whole: boolean,
): { baselines: B[] | undefined; activeBaselineId: string | undefined } {
  const baselines = whole && Array.isArray(adopt?.baselines) ? (adopt!.baselines as B[]) : current.baselines;
  const incoming = adopt?.activeBaselineId;
  const activeBaselineId = whole && incoming !== undefined
    ? (typeof incoming === 'string' && incoming.length > 0 ? incoming : undefined)
    : current.activeBaselineId;
  return { baselines, activeBaselineId };
}

// ─── wave 4 · context-records (#30, #40, #27/#29, #79, #118) ────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #30 · The reply-link token for a new RFI / submittal, minted ON THE DEVICE so
 * the record has its architect reply link from the first render — online or
 * off, with no read-back race (a voice RFI opened at once used to go out with
 * no link, because share_token was only a server default and the device row
 * never had it). `mint` must be a CSPRNG (expo-crypto's randomUUID): the token
 * is the bearer credential for get_rfi_by_token / submit_pro_response, so
 * utils/generateId's Math.random fallback is never acceptable here. A minter
 * that throws or hands back something that is not a uuid gives `undefined` —
 * the caller then leaves share_token out and the column default mints it.
 */
export function mintedShareToken(mint: () => string): string | undefined {
  try {
    const t = mint();
    return typeof t === 'string' && UUID_RE.test(t) ? t.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * #30 · mergeLocalOnly's combine for rfis / submittals: the device copy wins
 * for what he edits, but the server-only columns come from the server row when
 * the device copy lacks them (a row born before client minting, or one whose
 * mint fell back to the column default). Without it a kept device row hid the
 * token the server had already given the record.
 */
export function withServerShareToken<T extends { shareToken?: string; createdAt?: string }>(local: T, server: T): T {
  const shareToken = local.shareToken || server.shareToken;
  const createdAt = local.createdAt || server.createdAt;
  if (shareToken === local.shareToken && createdAt === local.createdAt) return local;
  return { ...local, shareToken, createdAt };
}

/**
 * #40 · What a co_append_audit error means.
 *  - 'payload': the entries themselves were refused (bad shape / too many) —
 *    final, resending the same batch can never succeed.
 *  - 'row_or_session': co_denied / 42501. The RPC says the same thing for "not
 *    your CO", "the row is not on the server yet" and "this request carried no
 *    user token" (anon has no EXECUTE) — so it is final only when the caller
 *    has ruled the other two out (coAuditRefusalIsFinal).
 *  - 'transient': anything else — the entries stay owed.
 */
export type CoAuditErrorKind = 'payload' | 'row_or_session' | 'transient';
export function classifyCoAuditError(err: { message?: string | null; code?: string | null }): CoAuditErrorKind {
  const msg = err.message ?? '';
  if (/co_audit_bad_entries|co_audit_too_many/.test(msg)) return 'payload';
  if (/co_denied/.test(msg) || err.code === '42501') return 'row_or_session';
  return 'transient';
}

/**
 * #40 · A co_denied / 42501 drops the owed entries for good ONLY when the
 * request went out with this user's live bearer (before and after — the A4
 * rule in utils/offlineQueue: a refusal answered to an anon request says
 * nothing about the write) AND the CO is known to be on the server: no INSERT
 * of it on the wire and no write of it in the queue. Otherwise a mic-drafted
 * CO whose insert had not reported, or an append made while the token was
 * refreshing, lost its in-person signature entry for ever.
 */
export function coAuditRefusalIsFinal(ctx: {
  bearerBefore: boolean; bearerAfter: boolean; insertInFlight: boolean; queued: boolean;
}): boolean {
  return ctx.bearerBefore && ctx.bearerAfter && !ctx.insertInFlight && !ctx.queued;
}

/**
 * #29 · Must a new review cycle ride the offline queue instead of the RPC?
 *  - 'insert': the submittal's own INSERT is still queued — the RPC cannot
 *    find the row.
 *  - 'cycle_patch': a queued UPDATE carries review_cycles or current_status —
 *    it would land after the RPC and overwrite what the RPC wrote.
 *  - null: the RPC goes direct. A queued edit of any OTHER column (a title
 *    typo) is a named-column patch that cannot touch the cycles, so it no
 *    longer blocks the cycle (or makes a weeks-old submittal read as unsent).
 */
export function submittalCycleQueueHold(queue: readonly QueueEntryLike[], id: string): 'insert' | 'cycle_patch' | null {
  let hold: 'insert' | 'cycle_patch' | null = null;
  for (const e of queue) {
    if (e.table !== 'submittals' || e.data?.id !== id) continue;
    if (e.operation === 'insert') return 'insert';
    if (e.operation === 'update' && ('review_cycles' in e.data || 'current_status' in e.data)) hold = 'cycle_patch';
  }
  return hold;
}

/** #29 · Why a close-in-place cannot go through the queue, per hold. The old
 *  single sentence blamed the connection even with full signal. */
export function closeCycleHoldReason(hold: 'insert' | 'cycle_patch' | 'network', cycleNo: number): string {
  if (hold === 'insert') return `This submittal hasn't reached the server yet, so Cycle ${cycleNo} can't be closed there. Close it once it syncs.`;
  if (hold === 'cycle_patch') return `A change to this submittal's review log is still syncing. Try closing Cycle ${cycleNo} again in a moment.`;
  return `Closing Cycle ${cycleNo} needs a connection — the server closes it so no other copy is overwritten. Try again once you have signal.`;
}

const SUBMITTAL_STATUS_WORDS: Record<string, string> = {
  pending: 'Pending', in_review: 'In review', approved: 'Approved', approved_as_noted: 'Approved as noted',
  revise_resubmit: 'Revise & resubmit', rejected: 'Rejected',
};

/**
 * #27 · submittal_append_review_cycle's refusal of a close on a cycle the
 * reviewer already returned through the reply link (CONTRACT 16:
 * {success:false, error:'already_closed', cycle_number, status}). Nothing was
 * added and current_status was left alone — say so, and what to do.
 */
export function alreadyClosedCycleReason(res: { cycle_number?: unknown; status?: unknown }, fallbackNo: number): string {
  const n = typeof res.cycle_number === 'number' && Number.isFinite(res.cycle_number) ? res.cycle_number : fallbackNo;
  const word = typeof res.status === 'string' ? SUBMITTAL_STATUS_WORDS[res.status] ?? res.status : '';
  return `The reviewer already returned Cycle ${n}${word ? ` (${word})` : ''} through the reply link, so nothing was added — their stamp is on the log now. If yours differs, start a new cycle.`;
}

/**
 * #79 · The GC's own approval of a CO (the CO screen's Mark approved, the
 * reflow preview's confirm, project-detail's Approve) leaves a trail entry
 * saying who — coApprovalLine prints "Marked approved by <actor>" from it.
 * Not for the portal reconciler (it writes its own portal entries). Idempotent
 * over the edit: a trail that already gained a 'marked_approved' in this edit
 * gets no second one.
 */
export function withMarkedApproved<E extends { id: string; action: string; actor: string; timestamp: string; detail?: string }>(
  priorTrail: readonly E[] | undefined,
  nextTrail: readonly E[] | undefined,
  mark: { id: string; actor: string; timestamp: string },
): E[] {
  const next = [...(nextTrail ?? [])];
  const had = new Set((priorTrail ?? []).map(e => e.id));
  if (next.some(e => e.action === 'marked_approved' && !had.has(e.id))) return next;
  next.push({ id: mark.id, action: 'marked_approved', actor: mark.actor, timestamp: mark.timestamp } as E);
  return next;
}

/**
 * #118 · Deleting a plan sheet. When it was the LATEST revision in its chain
 * (not itself superseded), the sheet it replaced (previousSheetId) is current
 * again: un-supersede it, or the set shows no current sheet for that number
 * — the GC's wrong import deleted, and the field left with nothing to open.
 * Only when no other live sheet already replaces that predecessor.
 */
export function planSheetsAfterDelete<S extends { id: string; previousSheetId?: string; superseded?: boolean }>(
  list: readonly S[],
  id: string,
  nowIso: string,
): { list: S[]; restoredId: string | null } {
  const gone = list.find(s => s.id === id);
  const rest = list.filter(s => s.id !== id);
  const prevId = gone && !gone.superseded ? gone.previousSheetId : undefined;
  if (!prevId) return { list: rest, restoredId: null };
  const prev = rest.find(s => s.id === prevId);
  const replacedElsewhere = rest.some(s => s.previousSheetId === prevId && !s.superseded);
  if (!prev || !prev.superseded || replacedElsewhere) return { list: rest, restoredId: null };
  return {
    list: rest.map(s => (s.id === prevId ? { ...s, superseded: false, updatedAt: nowIso } : s)),
    restoredId: prevId,
  };
}

/**
 * #59 / #133 interim, the CLIENT half (integration round 1). A daily report or
 * photo created by a field or viewer seat lands as a DRAFT on the server —
 * trg_daily_reports_portal_owner / trg_portal_state_owner (migration
 * 20260920140000) turn any INSERT by a caller who is not the owner or an
 * editor into {status:'draft'}, whatever the project's autoShare says: the GC
 * reviews a foreman's work before the homeowner sees it. The phone must say
 * the same from the first render, or a report made by voice or photo triage
 * reads "Shared in the homeowner's portal" and a photo shows "Sent" with a
 * Recall bar until the next server read, while nothing reached the homeowner.
 */
export function fieldSeatCreatesDraft(kind: string, myRole: ProjectCollaborator['role'] | undefined): boolean {
  return (kind === 'daily_report' || kind === 'photo') && (myRole === 'field' || myRole === 'viewer');
}

/**
 * Integration round 2 · Which owed change-order audit entries a Discard from
 * the Not-saved sheet takes with it, by CO: `'all'` when a discarded line is
 * the CO's CREATE (insert/upsert — the row will not exist, so no owed entry
 * has anywhere to land), otherwise exactly the entry ids that rode the
 * discarded writes (`rides`). A CO whose discarded lines carry neither gets no
 * key: its owed entries belong to edits that landed and stay.
 */
export function coAuditDropsForDiscard(
  discarded: readonly { table?: string; recordId?: string; operation?: string; rides?: readonly string[] }[],
): Map<string, 'all' | Set<string>> {
  const out = new Map<string, 'all' | Set<string>>();
  for (const f of discarded) {
    if (f.table !== 'change_orders' || !f.recordId) continue;
    const cur = out.get(f.recordId);
    if (cur === 'all') continue;
    if (f.operation === 'insert' || f.operation === 'upsert') { out.set(f.recordId, 'all'); continue; }
    if (!f.rides || f.rides.length === 0) continue;
    const ids = cur ?? new Set<string>();
    for (const r of f.rides) ids.add(r);
    out.set(f.recordId, ids);
  }
  return out;
}

/**
 * Integration round 2 · A Not-saved ledger line (utils/syncLedger SyncFailure)
 * as the queue entry it was — so "Leave project" counts, and its sweep turns
 * into notes, the job's UNSAVED writes by the SAME matcher and record → job
 * map it uses for queued ones (queuedEntryRevokedProject). A payload line's
 * row carries project_id (or its id ties to the job through the map); an rpc
 * line is its record id. A line with nothing to match on is null.
 */
export function ledgerLineAsQueueEntry(
  f: { table?: string; operation?: string; recordId?: string; row?: Record<string, unknown> },
): QueueEntryLike | null {
  if (!f.table || !f.operation) return null;
  if (f.row) return { table: f.table, operation: f.operation, data: f.row };
  if (f.recordId) return { table: f.table, operation: f.operation, data: { id: f.recordId } };
  return null;
}


// ─── Wave 5 · join-core helpers ──────────────────────────────────────────────

/**
 * #82 (CONTRACT 13) · The homeowner portal blob as the OWNER's projects upsert
 * sends it: everything but `accessToken`. The key now lives in
 * portal_credentials (owner-only), and portal_set_access_token keeps the
 * stored key for the row's portal id when the blob arrives without one
 * (20260923170000) — so the phone no longer ships the credential on every
 * edit of the job. The passcode still rides until validate-portal-passcode
 * reads portal_credentials. stripPortalCredentials (both keys) stays the
 * guard for a collaborator's copy.
 */
export function ownerClientPortalForWrite(cp: ClientPortalSettings | null | undefined): ClientPortalSettings | undefined {
  if (cp == null) return undefined;
  const { accessToken: _token, ...rest } = cp;
  return rest;
}

/**
 * #1 (CONTRACT 21) · The Not-saved reason for a job that exists only on this
 * phone: its create never reached MAGE (the old free-plan cap refused it, or
 * a flush dropped it before the ledger existed), so it was kept on the phone
 * with nothing left that would ever send it — and no sync badge said so.
 */
export const LOCAL_ONLY_PROJECT_REASON = 'This job is only on this phone — it never reached MAGE. Retry sends it; Discard removes it from this phone.';

/** The ledger line id for a local-only job — stable, so a later load that
 *  finds the same job records the same line (mergeFailures dedupes by id). */
export function localOnlyProjectLineId(projectId: string): string {
  return `local-only-project-${projectId}`;
}

/**
 * #1 fix round 2 · The append-only "ever confirmed on the server" set for the
 * local-only rule. It only grows: every trusted load's answer and every
 * landed owner upsert are unioned in, and nothing is removed except by the
 * account wipe (its key is under mageid_). The replace-on-load set
 * (serverProjectIdsRef) must NOT feed the local-only rule on its own: a load
 * drops a job deleted on the web from it, the loader keeps his own copy on
 * the phone, and the NEXT load would then read that job as "never reached
 * MAGE" and offer a Retry that re-creates a job he deleted on purpose.
 */
export function withServerConfirmed(ever: ReadonlySet<string>, ids: Iterable<string>): Set<string> {
  const out = new Set(ever);
  for (const id of ids) if (typeof id === 'string' && id.length > 0) out.add(id);
  return out;
}

/**
 * #1 · Which of the device's jobs become Not-saved lines after a TRUSTED
 * server read: his own (owner stamp is his, or no stamp and no collaborator
 * role), absent from the server's answer, never confirmed on the server
 * (`confirmedBefore` — the APPEND-ONLY ever-confirmed ids, withServerConfirmed,
 * plus the replace-on-load set as it stood before this read; and no loader
 * stamp on the device copy), with no write queued, on the wire or already under Not saved,
 * and not a job he was removed from. Never resent automatically: the line
 * waits for Retry or Discard.
 *
 * Fix round 1: the caller builds `pending` and `unsaved` AT RECORD TIME (after
 * the SELECT answered), not from the sets captured when the load started — a
 * job created, queued or refused while the SELECT was out is not "only on this
 * phone", and a line for it would park its own queued create behind itself.
 */
export function localOnlyOwnedProjectIds(input: {
  local: readonly { id: string; ownerUserId?: string | null; myRole?: ProjectRole | undefined; financialsLoaded?: boolean }[];
  remoteIds: ReadonlySet<string>;
  userId: string;
  confirmedBefore: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  unsaved: ReadonlySet<string>;
  revoked: ReadonlySet<string>;
  /** Fix round 1 · ids written on this device after the load started (the
   *  projectWriteLog past its `since`). A job created while the SELECT was
   *  out is absent from the answer only because the read predates it: its
   *  create is on the wire or waiting, not lost. */
  written?: ReadonlySet<string>;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of input.local) {
    if (!p || typeof p.id !== 'string' || !p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    // Integration round 1 (data-security): only a copy STAMPED with this
    // account counts as his. The projects cache (PROJECTS_KEY) is not keyed
    // by account, so an unstamped legacy job could be a previous account's
    // that survived an account switch; a line for it would let Retry INSERT
    // another account's job under this user_id (localOnlyProjectInsertRow) —
    // before this line existed such a job was PATCHed by id and matched 0
    // rows. Every create since 2026-09-06 is stamped (claimProjectForUser),
    // and an unknown owner is written as a collaborator elsewhere too
    // (classifyProjectSync, A-1). What this gives up: a job made while
    // signed out, never stamped and never synced, gets no "only on this
    // phone" line.
    if (!p.ownerUserId || p.ownerUserId !== input.userId) continue;
    if (input.remoteIds.has(p.id) || input.confirmedBefore.has(p.id)) continue;
    // Fix round 2 · the device copy itself says it was READ from the server:
    // financialsLoaded is a loader stamp (the row mapper always sets it, and
    // claimProjectForUser strips it from every copy a create path makes), so
    // a job carrying it existed on the server at some load. Gone from the
    // answer now means deleted elsewhere (the web, a second phone) — never
    // "never reached MAGE". This covers jobs deleted elsewhere before the
    // append-only confirmed set existed (the first loads after the OTA).
    if (typeof p.financialsLoaded === 'boolean') continue;
    if (input.pending.has(p.id) || input.unsaved.has(p.id) || input.revoked.has(p.id)) continue;
    if (input.written?.has(p.id)) continue;
    out.push(p.id);
  }
  return out;
}

/**
 * #1 · The projects INSERT a local-only job's line carries — the owner row
 * ProjectContext.syncProjectToSupabase upserts, with the schedule (a create
 * must carry it) and without the portal key (#82). Retry sends it as an
 * INSERT: if the row turns out to be on the server after all, the queue reads
 * the primary-key duplicate as landed. Money rides the legacy columns, as on a
 * refused owner upsert; the job's next edit writes project_financials.
 * validate-w5-join-core-mappers keeps its keys in step with the sync's owner
 * upsert (syncProjectToSupabase's row literal).
 */
export function localOnlyProjectInsertRow(project: Project, userId: string): Record<string, unknown> {
  return {
    id: project.id, name: project.name, type: project.type,
    project_type_other: projectTypeOtherColumn(project),
    location: project.location, square_footage: project.squareFootage, quality: project.quality,
    location_latitude: project.locationLatitude ?? null,
    location_longitude: project.locationLongitude ?? null,
    location_geocoded_at: project.locationGeocodedAt ?? null,
    description: project.description,
    scope: (project.scope ?? null) as unknown,
    schedule: (project.schedule ?? null) as unknown,
    status: project.status,
    collaborators: (project.collaborators ?? []) as unknown,
    primary_contact: project.primaryContact ?? null,
    lead_source: project.leadSource ?? null,
    target_timeline_notes: project.targetTimelineNotes ?? null,
    handover_checklist: (project.handoverChecklist ?? {}) as unknown,
    closed_at: project.closedAt,
    substantial_completion_date: project.substantialCompletionDate,
    warranty_walk_completed_at: project.warrantyWalkCompletedAt,
    photo_count: project.photoCount,
    updated_at: project.updatedAt,
    user_id: userId, created_at: project.createdAt,
    client_portal: ownerClientPortalForWrite(project.clientPortal) as unknown,
    estimate: project.estimate as unknown,
    linked_estimate: project.linkedEstimate as unknown,
    estimate_versions: project.estimateVersions as unknown,
    target_budget: project.targetBudget as unknown,
  };
}

/**
 * #27 (CONTRACT 17) · subcontractors.legal_name, tax_id_last4,
 * license_verified_at, coi_verified_at, w9_doc_path → the Subcontractor
 * fields. Before these were mapped the Subs form saved them on the phone and
 * the next server read rebuilt the sub without them (1099 export "TIN
 * missing", badges back to "Not verified", the W-9 button asking again).
 * coi_last_warned_for is the COI watcher's own marker: never read, never
 * written by the app.
 */
export function subcontractorExtrasFromRow(r: Record<string, unknown>): Pick<Subcontractor, 'legalName' | 'taxIdLast4' | 'licenseVerifiedAt' | 'coiVerifiedAt' | 'w9DocPath'> {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
  return {
    legalName: str(r.legal_name),
    taxIdLast4: str(r.tax_id_last4),
    licenseVerifiedAt: str(r.license_verified_at),
    coiVerifiedAt: str(r.coi_verified_at),
    w9DocPath: str(r.w9_doc_path),
  };
}

/**
 * The same five, the other way — ONLY the ones this copy holds a value for,
 * so a device that never loaded a stamp (or a stale copy) cannot null one
 * written from another device. tax_id_last4 goes only as exactly four digits,
 * or '' → null (a deliberate clear); anything else stays off the row (the
 * server's trigger would pin it anyway, 20260923150000).
 */
export function subcontractorExtraColumns(s: Partial<Subcontractor>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.legalName !== undefined) out.legal_name = s.legalName;
  if (typeof s.taxIdLast4 === 'string') {
    const tin = s.taxIdLast4.trim();
    if (/^[0-9]{4}$/.test(tin)) out.tax_id_last4 = tin;
    else if (tin === '') out.tax_id_last4 = null;
  }
  if (s.licenseVerifiedAt !== undefined) out.license_verified_at = s.licenseVerifiedAt || null;
  if (s.coiVerifiedAt !== undefined) out.coi_verified_at = s.coiVerifiedAt || null;
  if (s.w9DocPath !== undefined) out.w9_doc_path = s.w9DocPath || null;
  return out;
}

/**
 * #65 (CONTRACT 18) · photos.latitude / longitude / location_accuracy_meters /
 * location_label → ProjectPhoto. The capture flows stamp them, but nothing
 * wrote or read them, so the pin on "where was this taken" was gone the moment
 * the photo left the phone that took it.
 */
export function photoGeoFromRow(r: Record<string, unknown>): Pick<ProjectPhoto, 'latitude' | 'longitude' | 'locationAccuracyMeters' | 'locationLabel'> {
  const num = (v: unknown): number | undefined => {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    locationAccuracyMeters: num(r.location_accuracy_meters),
    locationLabel: typeof r.location_label === 'string' && r.location_label.length > 0 ? r.location_label : undefined,
  };
}

/** The same four, the other way — only the ones present on `p` (an insert
 *  sends what the capture stamped; an update sends what the caller changed). */
export function photoGeoColumns(p: Partial<ProjectPhoto>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.latitude !== undefined) out.latitude = Number.isFinite(p.latitude) ? p.latitude : null;
  if (p.longitude !== undefined) out.longitude = Number.isFinite(p.longitude) ? p.longitude : null;
  if (p.locationAccuracyMeters !== undefined) out.location_accuracy_meters = Number.isFinite(p.locationAccuracyMeters) ? p.locationAccuracyMeters : null;
  if (p.locationLabel !== undefined) out.location_label = p.locationLabel || null;
  return out;
}

/**
 * #70 (CONTRACT 19) · crew_members columns by CrewMember key. updateCrewMember
 * sent the WHOLE row (toRow) on every edit, so a phone holding a day-old copy
 * put back phone, email, project_ids and status another device had changed.
 * It now sends only the keys the caller changed.
 */
export const CREW_MEMBER_COLUMNS: Readonly<Record<string, string>> = {
  companyUserId: 'user_id', fullName: 'full_name', trades: 'trades', phone: 'phone', email: 'email',
  photoUrl: 'photo_url', status: 'status', idVerified: 'id_verified', idType: 'id_type',
  idMaskedLast4: 'id_masked_last4', idExpiry: 'id_expiry', idIssuer: 'id_issuer', idScannedAt: 'id_scanned_at',
  idImagePath: 'id_image_path', claimToken: 'claim_token', claimedByUserId: 'claimed_by_user_id', claimedAt: 'claimed_at',
  isPublic: 'is_public', marketplaceProfileId: 'marketplace_profile_id', projectIds: 'project_ids',
};

/** Keys a client never sends on an UPDATE: the row's owner and creation
 *  stamp, and the claim state the server pins (crew_freeze_ownership_columns). */
const CREW_UPDATE_NEVER = new Set(['companyUserId', 'claimedByUserId', 'claimedAt', 'createdAt', 'id', 'updatedAt']);

/**
 * The UPDATE payload for a crew edit: `{ id, <changed columns>, updated_at }`.
 * A key the caller passed as `undefined` is a CLEAR and goes as null (Remove ID
 * and the purge-path scan clear the id_* fields that way); a key it did not
 * pass is not sent at all.
 */
export function crewMemberUpdateRow(
  id: string,
  changes: Partial<CrewMember>,
  updatedAt: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = { id };
  for (const key of Object.keys(changes)) {
    if (CREW_UPDATE_NEVER.has(key)) continue;
    const col = CREW_MEMBER_COLUMNS[key];
    if (!col) continue;
    const v = (changes as Record<string, unknown>)[key];
    row[col] = v === undefined ? null : v;
  }
  row.updated_at = updatedAt;
  return row;
}

/**
 * #24 · The columns a prequal REVIEW writes. The review used to upsert the
 * whole packet the GC's phone held — so a review made from a copy loaded before
 * the sub submitted wrote the sub's answers back over what he had just sent.
 * Only the reviewer's columns go (the ones present on the patch).
 */
export const PREQUAL_REVIEW_COLUMNS: Readonly<Record<string, string>> = {
  status: 'status',
  reviewerNotes: 'reviewer_notes',
  reviewedAt: 'reviewed_at',
  reviewedBy: 'reviewed_by',
  expiresAt: 'expires_at',
  autoReviewFindings: 'auto_review_findings',
  updatedAt: 'updated_at',
};

export type PrequalReviewPatch = Partial<Pick<PrequalPacket, 'status' | 'reviewerNotes' | 'reviewedAt' | 'reviewedBy' | 'expiresAt' | 'autoReviewFindings' | 'updatedAt'>>;

export function prequalReviewRow(id: string, patch: PrequalReviewPatch, now: string): Record<string, unknown> {
  const row: Record<string, unknown> = { id };
  for (const [key, col] of Object.entries(PREQUAL_REVIEW_COLUMNS)) {
    if (!(key in patch)) continue;
    const v = (patch as Record<string, unknown>)[key];
    row[col] = v === undefined ? null : v;
  }
  row.updated_at = (typeof patch.updatedAt === 'string' && patch.updatedAt) ? patch.updatedAt : now;
  return row;
}

/**
 * coi-subs (wave 5) · May saving this certificate stamp the sub's
 * coiVerifiedAt ("COI verified today")? Not while any coverage on it is
 * still only what the model read (source 'ai'): an unconfirmed AI read is not
 * a GC who looked at the certificate. The expiry still moves — that reads
 * `expiresAt` only (subCoiExpiryAcross), which an AI read never fills.
 */
export function coiSaveStampsVerified(cert: Pick<CertificateOfInsurance, 'coverages'> | null | undefined): boolean {
  return !(cert?.coverages ?? []).some(c => c?.source === 'ai');
}
