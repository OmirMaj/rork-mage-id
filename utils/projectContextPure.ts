// utils/projectContextPure.ts — pure helpers pulled out of
// contexts/ProjectContext.tsx so the loader/mapper decisions that lost money
// (MONEY-F1/F3), leaked tenancy (AUTH-F2/F5), dropped offline records (SYNC-F3)
// and starved the COI watcher (PRODUCT-F1) are unit-tested rather than buried
// in a 5,700-line provider. Guard: scripts/validate-project-context-pure.ts.
//
// Nothing here touches React, AsyncStorage, Supabase or the offline queue — the
// context passes data in and writes results out.

import type { CertificateOfInsurance, ClientPortalSettings, COICoverage, ProjectCollaborator, SavedAIAPayApp } from '@/types';
import { invoiceIsSettled } from '@/utils/invoiceBilling';
import { isFinancialsBlinded } from '@/utils/roleBlinding';
import type { ProjectRole } from '@/utils/projectRole';

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
 * Server-first load, without silently dropping what the server has not seen
 * yet. The projects loader always did this; every child loader instead
 * overwrote the device copy wholesale, so an invoice created offline vanished
 * the moment the SELECT beat the flush's INSERT — and re-entering it produced a
 * duplicate document number.
 *
 * Rules: a row on the server wins over the local copy (the server is the
 * merge point for every device); a local row absent from the server is kept
 * ONLY while its write is still queued. A local row that is neither on the
 * server nor queued was deleted elsewhere (or never made it) and is dropped.
 * A duplicate id inside the device copy (a record saved twice by two
 * optimistic paths) is kept once — first occurrence wins — so the merge can
 * never hand a list with repeated keys to a FlatList.
 */
export function mergeLocalOnly<T extends { id: string }>(
  serverRows: readonly T[],
  localRows: readonly T[],
  pendingIds: ReadonlySet<string>,
): T[] {
  const seen = new Set(serverRows.map(r => r.id));
  const keep: T[] = [];
  for (const r of localRows) {
    if (seen.has(r.id) || !pendingIds.has(r.id)) continue;
    seen.add(r.id);
    keep.push(r);
  }
  return [...serverRows, ...keep];
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
    retentionAmount: inv.retentionAmount, retentionReleased: inv.retentionReleased,
  });
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
    totalScheduledValue += num(l.scheduledValue);
    totalCompletedAndStored += completed + stored;
    totalRetainage += (completed + stored) * (num(l.retainagePercent) / 100);
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
export function aiaRowToSaved(r: Record<string, unknown>): SavedAIAPayApp {
  const createdAt = str(r.created_at);
  const lines = (r.lines as SavedAIAPayApp['lines'] | null) ?? [];
  const contractSumToDate = coerceRate(r.contract_sum_to_date, 0);
  const lessPreviousCertificates = coerceRate(r.less_previous_certificates, 0);
  const snapshot = r.snapshot_totals;
  const totals = snapshot != null && typeof snapshot === 'object'
    ? (snapshot as SavedAIAPayApp['totals'])
    : aiaTotalsFromLines(lines, contractSumToDate, lessPreviousCertificates);
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
    payLinkUrl: str(r.pay_link_url),
    payLinkId: str(r.pay_link_id),
    payLinkAmount: r.pay_link_amount == null ? undefined : coerceRate(r.pay_link_amount, 0),
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
 * TODO(20260904100100): send pay_link_url / pay_link_id / pay_link_amount once
 * the migration is applied. Until then an unknown column makes PostgREST
 * reject the WHOLE upsert, and the offline queue would retry it forever.
 * `paid_at` is owned by the Stripe webhook and is never written from the app.
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
    snapshot_totals: a.totals ?? null,
    created_at: a.createdAt ?? (a.savedAt || undefined) ?? now,
    updated_at: a.updatedAt ?? now,
  };
}
