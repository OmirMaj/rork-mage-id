// utils/syncLedger.ts — the durable record of work that will NOT be sent.
//
// ── The hole this closes ────────────────────────────────────────────────────
// utils/offlineQueue.ts drops a mutation when it hits a terminal error, when it
// exhausts MAX_RETRIES, or when the queue cap overflows. Before this file the
// only user-facing trace was `notifyDroppedWrites`, which fires a toast and a
// Sentry warning AT THE MOMENT OF THE DROP. That is the one moment the field
// user is least likely to be looking: the drop happens during a background
// flush, on the wake after the phone came back into signal, often with the app
// backgrounded and the toast host unmounted. The toast is a no-op then, and the
// queue depth has just gone DOWN — so the sync pill got QUIETER as the user's
// work was lost.
//
// The ledger is the same event, written down. It survives the app being killed,
// it is readable whenever the user next looks, and it is the only reason the
// pill is allowed to say "2 didn't sync" instead of pretending they are pending.
//
// ── Boundaries ──────────────────────────────────────────────────────────────
// • Key `mageid_sync_failures` is listed in OFFLINE_WRITE_QUEUE_KEYS
//   (utils/localCacheKeys.ts), which means AuthContext's prefix sweep never
//   removes it and `clearSyncFailures()` below does — the same route the three
//   write queues take, and for the same reason. It was left OUT of that list
//   once, on the reasoning that a failure note is not pending work; the sweep
//   then destroyed the red "2 didn't sync" notice on exactly the event (the
//   magic link a super taps to get back in) that the queues beside it are
//   preserved for, silently, with the user never told the warning had existed.
//   A deliberate sign-out still empties it, and `retainSyncFailuresForUser`
//   narrows it for a session that arrives with no marker.
//   Cross-tenant safety does not rest on the wipe in any case: `ownFailures`
//   below shows only entries tagged for the live session and has no
//   last-user-marker fallback, so another contractor's note is unreadable even
//   in the window before it is cleared.
// • Entries are tagged with the owning user and read back filtered, the same
//   discipline as getOwnOfflineQueue — a record with no tag is nobody's.
// • NOTES are bounded at MAX_SYNC_FAILURES, newest kept. An unbounded ledger
//   of notes is itself a storage leak, and a list of 400 is not more
//   actionable than a list of 40. Entries that carry a resendable payload
//   (#1) are NOT capped — see mergeFailures: they are the only copy of the
//   record, and only Retry or Discard may remove them.
//
// This module is required LAZILY by offlineQueue (same pattern as its Sentry
// and toast requires), so importing offlineQueue never pulls AsyncStorage in at
// module load.
//
// ── Why there is a lock in here ─────────────────────────────────────────────
// Every write below is a read-modify-write of ONE key, and the writer is the
// queue's drop path — which runs during a background flush, i.e. exactly during
// the window AuthContext is emptying local storage in. Unlocked, the A2 race
// the write queues already learned applies verbatim: the wipe removes the key,
// a drop that was mid-flight writes its merged array back, and the previous
// tenant's failure notes reappear seconds after being cleared. Same discipline,
// same shape, same function name as the three queue modules.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const SYNC_FAILURE_KEY = 'mageid_sync_failures';

/** Serialises every read-modify-write of SYNC_FAILURE_KEY. Same name and same
 *  shape as the queue modules' own locks — see the header. */
let ledgerLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = ledgerLock.then(fn, fn);
  ledgerLock = run.then(() => undefined, () => undefined);
  return run;
}

/** Newest N NOTES kept (payload entries are exempt). See "Boundaries" above. */
export const MAX_SYNC_FAILURES = 40;

export type SyncFailureKind = 'write' | 'photo' | 'dictation';

/** The write a failure can re-send. 'rpc' carries its function and args. */
export type UnsavedOperation = 'insert' | 'upsert' | 'update' | 'delete' | 'rpc';

/**
 * The drop reason a flush uses when a re-sent INSERT collides with a primary
 * key the caller cannot SEE (another user's row under own-row RLS). It is not
 * "already landed" — the change never reached that row. (#122 carry.)
 */
export const NOT_VISIBLE_CONFLICT = 'not_visible_conflict';

export interface SyncFailure {
  /** The dropped item's own id, so the same drop cannot be recorded twice. */
  id: string;
  kind: SyncFailureKind;
  /** What the user would call it: "Daily report", "Change order". */
  label: string;
  /** Why it stopped, in the words we are willing to show: "retried 5 times". */
  reason: string;
  at: number;
  /** Owning user. Untagged entries are unreadable by anyone — see readOwn. */
  userId?: string;
  // ── #1 (wave 4): what it takes to RESEND it ──────────────────────────────
  // A failure used to be a note — label + reason — so the only thing the user
  // could do was dismiss it and re-type the record. Worse, nothing on the
  // device knew the row was unsaved, so the next trusted list read deleted it
  // from the phone. With the payload kept here the row stays (the loaders keep
  // every id unsavedWriteIds() names) and Retry resends it exactly as it was.
  /** Table the write was for. */
  table?: string;
  /** The record's id (data.id, or the rpc's record id). */
  recordId?: string;
  operation?: UnsavedOperation;
  /** The payload exactly as it was sent (insert/upsert/update/delete). */
  row?: Record<string, unknown>;
  /** For operation 'rpc': the function and its arguments. */
  rpc?: { fn: string; args: Record<string, unknown> };
  /** When the write was first made (queue timestamp, or the direct attempt) —
   *  Retry replays one record's writes oldest-first by this. */
  queuedAt?: number;
  /** Ids of device-side records that ride this write (offlineQueue's
   *  OfflineMutation.rides) — a Discard drops exactly them. */
  rides?: string[];
}

// ── Pure core (the validator drives these directly) ─────────────────────────

/**
 * Merge new failures into the ledger: newest first, deduped by id, capped.
 *
 * Dedupe by id matters because a flush can report the same group twice across
 * a retry of the flush itself; two lines for one lost report would inflate the
 * count the user is asked to act on.
 */
export function mergeFailures(
  existing: readonly SyncFailure[],
  incoming: readonly SyncFailure[],
  cap: number = MAX_SYNC_FAILURES,
): SyncFailure[] {
  const seen = new Set<string>();
  const out: SyncFailure[] = [];
  for (const f of [...incoming, ...existing]) {
    if (!f || typeof f.id !== 'string' || f.id.length === 0) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  out.sort((a, b) => b.at - a.at);
  // The cap trims NOTES only. An entry that carries its payload (#1) is the
  // phone's only copy of an unsaved record: unsavedWriteIds() keeps the row
  // on the device because of it, and Retry resends from it. Trimming it would
  // make the cap — not the user's Discard — the thing that deletes his work,
  // and a job refused for good drops all its children in one batch, so 40 is
  // reachable in a single flush. Payload entries leave only by Retry
  // (success) or Discard; notes (photo, dictation, pre-payload writes) keep
  // the newest `cap`.
  let notes = 0;
  const limit = Math.max(0, cap);
  return out.filter((f) => {
    if (isRetryableFailure(f)) return true;
    notes += 1;
    return notes <= limit;
  });
}

/** Tolerant parse. A malformed ledger reads as empty rather than throwing —
 *  but see readSyncFailures: a storage failure is NOT the same as empty. */
export function parseFailures(raw: string | null | undefined): SyncFailure[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const out: SyncFailure[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.length === 0) continue;
    if (r.kind !== 'write' && r.kind !== 'photo' && r.kind !== 'dictation') continue;
    if (typeof r.at !== 'number' || !Number.isFinite(r.at)) continue;
    const op = r.operation;
    const operation: UnsavedOperation | undefined =
      op === 'insert' || op === 'upsert' || op === 'update' || op === 'delete' || op === 'rpc' ? op : undefined;
    const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
    const rpcRaw = r.rpc as { fn?: unknown; args?: unknown } | undefined;
    out.push({
      id: r.id,
      kind: r.kind,
      label: typeof r.label === 'string' ? r.label : 'Unsaved change',
      reason: typeof r.reason === 'string' ? r.reason : 'could not be sent',
      at: r.at,
      userId: typeof r.userId === 'string' ? r.userId : undefined,
      ...(typeof r.table === 'string' ? { table: r.table } : {}),
      ...(typeof r.recordId === 'string' ? { recordId: r.recordId } : {}),
      ...(operation ? { operation } : {}),
      ...(isObj(r.row) ? { row: r.row } : {}),
      ...(isObj(rpcRaw) && typeof rpcRaw.fn === 'string' && isObj(rpcRaw.args) ? { rpc: { fn: rpcRaw.fn, args: rpcRaw.args } } : {}),
      ...(typeof r.queuedAt === 'number' && Number.isFinite(r.queuedAt) ? { queuedAt: r.queuedAt } : {}),
      ...(Array.isArray(r.rides) && r.rides.every((x) => typeof x === 'string') && r.rides.length > 0 ? { rides: r.rides as string[] } : {}),
    });
  }
  return out;
}

/** The entries belonging to this session. An UNTAGGED entry is deliberately
 *  excluded: unlike the write queues there is no marker fallback here, because
 *  showing the wrong contractor a lost-paperwork warning is worse than showing
 *  nobody one. */
export function ownFailures(all: readonly SyncFailure[], userId: string | null): SyncFailure[] {
  if (!userId) return [];
  return all.filter((f) => f.userId === userId);
}

/**
 * The distinct human labels, newest first — what the dialog lists.
 * Deduped so five failed photos read as one line, with the count folded in.
 */
export function failureLabels(failures: readonly SyncFailure[]): string[] {
  const counts = new Map<string, number>();
  for (const f of failures) {
    const key = `${f.label} — ${f.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, n]) => (n > 1 ? `${key} (×${n})` : key));
}

/** True when the ledger holds enough to resend this failure as it was. A
 *  photo or dictation note, or a write recorded before payloads were kept,
 *  can only be dismissed — and the UI must not offer a Retry that cannot work. */
export function isRetryableFailure(f: SyncFailure): boolean {
  if (f.kind !== 'write' || !f.table || !f.operation) return false;
  if (f.operation === 'rpc') return !!f.rpc && !!f.recordId;
  return !!f.row;
}

/** Same record = same table and record id. A failure with no record id is
 *  only ever the same record as itself. */
export function sameUnsavedRecord(a: SyncFailure, b: SyncFailure): boolean {
  if (a.id === b.id) return true;
  return !!a.table && !!a.recordId && a.table === b.table && a.recordId === b.recordId;
}

/** Every failure of `target`'s record, oldest write first — the order Retry
 *  replays them in, so a failed INSERT goes back before the edit made on it. */
export function unsavedBatchFor(own: readonly SyncFailure[], target: SyncFailure): SyncFailure[] {
  return own
    .filter((f) => sameUnsavedRecord(f, target))
    .sort((a, b) => (a.queuedAt ?? a.at) - (b.queuedAt ?? b.at));
}

/** The ids the loaders must keep for `table`: this session's unsaved writes. */
export function unsavedIdsIn(own: readonly SyncFailure[], table: string): Set<string> {
  const ids = new Set<string>();
  for (const f of own) {
    if (f.kind === 'write' && f.table === table && f.recordId) ids.add(f.recordId);
  }
  return ids;
}

// ── Integration round 1: later writes of an unsaved record wait behind it ───
// A refused INSERT parked here used to be invisible to the queue's ordering
// guard: the next edit of that record went out as a direct UPDATE, matched 0
// rows, reported 'synced' — and a later Retry resent the INSERT as it was at
// refusal time, so the server kept the pre-edit record and every edit since
// was lost without a word. The rule now (the simplest one that is provable):
// while this session's ledger holds a resendable write of a record, NO later
// write of that record is sent on its own. It is written here behind the
// earlier ones and goes out only through Retry, which replays the record
// oldest-first. What it gives up: a record refused once takes no further save
// until he taps Retry or Discard — and the sheet says so on its line.

/** True when `f` is this user's resendable write of table/recordId. */
function isUnsavedWriteOf(f: SyncFailure, userId: string, table: string, recordId: string): boolean {
  return f.userId === userId && isRetryableFailure(f) && f.table === table && f.recordId === recordId;
}

// Integration round 3 · The one exception to the park rule, for the PROFILE
// row only. Every profiles write is an update of the user's own row (created
// at sign-up), keyed on his user id — so one refused settings save parked
// every later profile write until Retry or Discard, the push-token
// registration on every launch included (a "Not sent yet" toast each launch,
// and pushes going to a dead token). The rule, and why it is provable: when
// the record's unsaved chain is nothing but UPDATEs (no create that may not
// have landed, no delete, no rpc) and the new write is an UPDATE whose columns
// share none with any line in that chain, sending it now or after the chain
// ends in the same row — an UPDATE sets only the columns it names. A write
// that shares a column with the chain still parks behind it (the Retry would
// otherwise land the older value over it). Limited to profiles: its columns
// are independent preferences; on a business record (a change order's status
// and its audit trail) two "disjoint" columns can still be one decision, and
// there the plain rule stands. What it gives up: nothing for profiles; for
// every other table, the same as before.
const INDEPENDENT_COLUMN_TABLES = new Set(['profiles']);
const KEY_COLUMNS = new Set(['id']);

/** Pure: may `incoming` go out on its own past this record's unsaved chain?
 *  See INDEPENDENT_COLUMN_TABLES. False whenever it is not provably safe. */
export function writeIsIndependentOfChain(chain: readonly SyncFailure[], incoming: Pick<SyncFailure, 'table' | 'operation' | 'row'>): boolean {
  if (!incoming.table || !INDEPENDENT_COLUMN_TABLES.has(incoming.table)) return false;
  if (incoming.operation !== 'update' || !incoming.row) return false;
  const mine = Object.keys(incoming.row).filter((c) => !KEY_COLUMNS.has(c));
  if (mine.length === 0) return false;
  const theirs = new Set<string>();
  for (const f of chain) {
    if (f.operation !== 'update' || !f.row) return false;
    for (const c of Object.keys(f.row)) if (!KEY_COLUMNS.has(c)) theirs.add(c);
  }
  return mine.every((c) => !theirs.has(c));
}

/** Pure: must a write of this record wait behind `userId`'s unsaved chain?
 *  True when a chain exists and the write is not independent of it. */
export function unsavedChainBlocksIn(
  all: readonly SyncFailure[],
  userId: string,
  write: Pick<SyncFailure, 'table' | 'recordId' | 'operation' | 'row'>,
): boolean {
  if (!write.table || !write.recordId) return false;
  const chain = all.filter((f) => isUnsavedWriteOf(f, userId, write.table!, write.recordId!));
  return chain.length > 0 && !writeIsIndependentOfChain(chain, write);
}

/** Pure: does `userId`'s ledger hold a resendable write of this record? */
export function hasUnsavedChainIn(all: readonly SyncFailure[], userId: string, table: string, recordId: string): boolean {
  return all.some((f) => isUnsavedWriteOf(f, userId, table, recordId));
}

/**
 * Pure: put `incoming` (a write of the same user, table and record) behind the
 * record's unsaved writes. Returns `parked: false` — and the ledger unchanged —
 * when there are none, so the caller sends it as usual.
 *
 * FOLDING bounds the ledger: a record refused on every save used to gain one
 * whole-row entry per save. A later UPDATE folds into the newest parked
 * insert/upsert/update of the record (its columns win), and a later UPSERT into
 * a parked UPSERT — the same end state as sending both in order. Everything
 * else (a delete, an rpc, an upsert behind an insert/update) is appended, so
 * Retry sends it in its own turn. Never folds into an entry Retry is sending
 * right now (`busy`): that payload is already on the wire, and folding into it
 * would lose the new columns when its line is removed.
 *
 * The parked entry carries the chain's FIRST reason, so the sheet's line keeps
 * saying why the record is stuck, not merely that it is waiting.
 */
export function parkBehindUnsavedIn(
  all: readonly SyncFailure[],
  incoming: SyncFailure,
  busy: ReadonlySet<string> = new Set(),
): { next: SyncFailure[]; parked: boolean; independent?: boolean } {
  const { userId, table, recordId } = incoming;
  if (!userId || !table || !recordId) return { next: [...all], parked: false };
  const chain = all
    .filter((f) => isUnsavedWriteOf(f, userId, table, recordId))
    .sort((a, b) => (a.queuedAt ?? a.at) - (b.queuedAt ?? b.at));
  if (chain.length === 0) return { next: [...all], parked: false };
  if (writeIsIndependentOfChain(chain, incoming)) return { next: [...all], parked: false, independent: true };
  const tail = chain[chain.length - 1];
  const foldable = !busy.has(tail.id) && !!tail.row && !!incoming.row && (
    (incoming.operation === 'update' && (tail.operation === 'insert' || tail.operation === 'upsert' || tail.operation === 'update'))
    || (incoming.operation === 'upsert' && tail.operation === 'upsert'));
  if (foldable) {
    // What rides either write rides the folded one: a Discard of it must drop
    // both edits' owed side-records.
    const rides = [...new Set([...(tail.rides ?? []), ...(incoming.rides ?? [])])];
    const folded: SyncFailure = { ...tail, row: { ...tail.row, ...incoming.row }, at: incoming.at, ...(rides.length > 0 ? { rides } : {}) };
    return { next: all.map((f) => (f.id === tail.id ? folded : f)), parked: true };
  }
  // Strictly after the tail: Retry orders a record by queuedAt, and a write
  // parked in the same millisecond as the refusal must not replay before it.
  const tailAt = tail.queuedAt ?? tail.at;
  const parkedEntry: SyncFailure = {
    ...incoming,
    reason: chain[0].reason,
    queuedAt: Math.max(incoming.queuedAt ?? incoming.at, tailAt + 1),
  };
  return { next: mergeFailures(all, [parkedEntry]), parked: true };
}

/** Pure: the ids of `table` whose unsaved chain holds the record's CREATE
 *  (an insert or upsert) — i.e. the record itself never reached MAGE. A record
 *  whose create landed and whose later EDIT is unsaved is not in this set. */
export function unsavedCreateIdsIn(own: readonly SyncFailure[], table: string): Set<string> {
  const ids = new Set<string>();
  for (const f of own) {
    if (f.kind !== 'write' || f.table !== table || !f.recordId || !isRetryableFailure(f)) continue;
    if (f.operation === 'insert' || f.operation === 'upsert') ids.add(f.recordId);
  }
  return ids;
}

/**
 * Pure: turn this user's resendable lines that `reasonFor` names into NOTES —
 * no table, record id or payload, the caller's sentence as the reason. For a
 * job he left or lost: every Retry of those lines would be refused under RLS
 * and toast "you do not have permission", so the sheet keeps a record that
 * they were not sent and stops offering to send them (the same way
 * offlineQueue.discardQueuedWrites records the job's QUEUED writes).
 */
export function notesForUnsavedIn(
  all: readonly SyncFailure[],
  userId: string,
  reasonFor: (f: SyncFailure) => string | null,
): { next: SyncFailure[]; noted: number } {
  let noted = 0;
  const next = all.map((f) => {
    if (f.userId !== userId || !isRetryableFailure(f)) return f;
    let reason: string | null = null;
    try { reason = reasonFor(f); } catch { reason = null; }
    if (!reason) return f;
    noted += 1;
    return { id: f.id, kind: f.kind, label: f.label, reason, at: f.at, userId: f.userId };
  });
  return { next, noted };
}

/** Pure: how many distinct records this user has unsaved (resendable) writes
 *  for — the number a sign-out must warn about, since it wipes them. */
export function unsavedRecordCountIn(all: readonly SyncFailure[], userId: string | null): number {
  const keys = new Set<string>();
  for (const f of ownFailures(all, userId)) {
    if (!isRetryableFailure(f)) continue;
    keys.add(f.table && f.recordId ? `${f.table}:${f.recordId}` : `id:${f.id}`);
  }
  return keys.size;
}

/** Exact dollars and cents for a ledger label, with no Intl dependency (this
 *  module is loaded by bun validators). */
function dollars(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0 ? '-' : ''}$${whole}.${String(cents % 100).padStart(2, '0')}`;
}

/** The amount of an invoice_append_payment call, or null. */
function appendAmount(rpc: SyncFailure['rpc']): number | null {
  if (!rpc || rpc.fn !== 'invoice_append_payment') return null;
  const entry = rpc.args?.p_entry as { amount?: unknown } | undefined;
  return typeof entry?.amount === 'number' && Number.isFinite(entry.amount) ? entry.amount : null;
}

/**
 * The ledger label for one write. A payment append names its amount: the line
 * used to read just "Invoice", and a Retry of an append he had since re-entered
 * by hand would count the money twice.
 */
export function labelForWrite(table: string, rpc?: SyncFailure['rpc']): string {
  const amount = appendAmount(rpc);
  return amount != null ? `Invoice payment of ${dollars(amount)}` : labelForTable(table);
}

/** Pure: the amounts of this user's unsaved payment appends on one invoice. */
export function unsavedPaymentAppendsIn(all: readonly SyncFailure[], userId: string | null, invoiceId: string): number[] {
  const out: number[] = [];
  for (const f of ownFailures(all, userId)) {
    if (f.table !== 'invoices' || f.recordId !== invoiceId || f.operation !== 'rpc') continue;
    const amount = appendAmount(f.rpc);
    if (amount != null) out.push(amount);
  }
  return out;
}

/**
 * The words after "Not saved to MAGE — " for a write the SERVER refused on the
 * live path (recorded by offlineQueue's failDirectWrite). Postgres text is not
 * shown to a foreman; each known class gets one plain sentence, anything else
 * a generic one. Never guesses a cause it cannot see.
 */
export function humanWriteReason(message: string, code?: string): string {
  const m = (message ?? '').toLowerCase();
  if (m === NOT_VISIBLE_CONFLICT) return humanDropReason(NOT_VISIBLE_CONFLICT);
  // CONTRACT 21 / 22 before the generic classes: the cap refusal IS a 23514
  // and used to read "a value was not accepted" — true, and no use to him.
  const known = knownRefusalOfError(message, code);
  if (known) return KNOWN_REFUSAL_REASON[known];
  if (code === '23502' || m.includes('null value in column')) return 'a required field was missing';
  if (code === '23503' || m.includes('foreign key')) return 'the job or record it belongs to is not on the server';
  if (code === '23505' || m.includes('duplicate key')) return 'a record with the same number already exists';
  if (code === '23514' || m.includes('check constraint')) return 'a value was not accepted';
  if (m.includes('free tier')) return 'your plan’s project limit refused it';
  if (code === '42501' || m.includes('row-level security') || m.includes('permission denied')) return 'you do not have permission to save this';
  return 'the server refused it';
}

// ── Server refusals the app knows by name (wave 5, CONTRACT 21 / 22) ─────────
// Two triggers on `projects` answer a write with a verdict that no retry can
// change, and neither message contains "violates", so the flush's text
// classifier used to spend all five retries on them and then drop the write as
// "the server refused it after several tries":
//   • enforce_free_tier_project_cap (20260923040000) — a NEW project row past
//     the free plan's one job: SQLSTATE 23514 (check_violation), message
//     starting 'Free tier is limited to 1 project'. Only an INSERT (or the
//     insert half of the owner's upsert) raises; a rename is pinned silently.
//   • projects_keep_safety_records (20260923170000) — a DELETE of a job with
//     OSHA-recordable incidents: SQLSTATE 23001 (restrict_violation), message
//     'project_has_safety_records'. Never keyed on 23503: offlineQueue's
//     isParentMissingRefusal reads that as "the child's job is not on the
//     server yet" and queues it.
// Both are terminal on the first answer. The cap refusal keeps its payload
// (Retry lands it after an upgrade, or after he deletes a job); the safety
// refusal is a NOTE — resending the delete is refused again, and a delete line
// would keep the job hidden on the phone while the server still has it.

export type KnownRefusal = 'free_plan_project_cap' | 'project_has_safety_records';

export const FREE_PLAN_PROJECT_CAP_REASON = 'Free plan allows 1 project — upgrade, or delete a job first';
export const SAFETY_RECORDS_DELETE_REASON = 'This job has safety records — it was not deleted';

export const KNOWN_REFUSAL_REASON: Record<KnownRefusal, string> = {
  free_plan_project_cap: FREE_PLAN_PROJECT_CAP_REASON,
  project_has_safety_records: SAFETY_RECORDS_DELETE_REASON,
};

/** Pure: which known refusal an error is, from its SQLSTATE and text alone. */
export function knownRefusalOfError(message: string | null | undefined, code: string | null | undefined): KnownRefusal | null {
  const m = (message ?? '').trim();
  if (code === '23514' && /^free tier is limited to 1 project/i.test(m)) return 'free_plan_project_cap';
  if (code === '23001' && /^project_has_safety_records\b/.test(m)) return 'project_has_safety_records';
  return null;
}

/**
 * Pure: the known refusal of one write, or null. Scoped to the write that can
 * meet it — a projects insert/upsert for the cap, a projects delete for the
 * safety rule — so a look-alike message on another table never borrows the
 * sentence.
 */
export function knownRefusalOf(
  table: string,
  operation: string,
  message: string | null | undefined,
  code: string | null | undefined,
): KnownRefusal | null {
  if (table !== 'projects') return null;
  const known = knownRefusalOfError(message, code);
  if (known === 'free_plan_project_cap') return operation === 'insert' || operation === 'upsert' ? known : null;
  if (known === 'project_has_safety_records') return operation === 'delete' ? known : null;
  return null;
}

/** The toast for a known refusal (null for any other reason): what happened
 *  and the one thing he can do about it. */
export function knownRefusalToast(reason: string | null | undefined): string | null {
  if (reason === FREE_PLAN_PROJECT_CAP_REASON) {
    return `${FREE_PLAN_PROJECT_CAP_REASON}. The job is kept under Not saved on the sync badge — Retry once you have upgraded or deleted a job.`;
  }
  if (reason === SAFETY_RECORDS_DELETE_REASON) {
    return `${SAFETY_RECORDS_DELETE_REASON}. Its injury and near-miss records must be kept — mark the job Closed instead.`;
  }
  return null;
}

/** Is this recorded reason one of the known-refusal sentences? */
export function isKnownRefusalReason(reason: string | null | undefined): boolean {
  return reason === FREE_PLAN_PROJECT_CAP_REASON || reason === SAFETY_RECORDS_DELETE_REASON;
}

/**
 * A DROP reason as the flush records it (a fixed internal phrase, or a
 * sentence a caller already wrote for the user — "You no longer have access
 * to Henderson Remodel") → what the sheet shows. The internal phrases are
 * translated; anything else is already the user's words and passes through.
 */
export function humanDropReason(reason: string): string {
  const r = (reason ?? '').trim();
  if (r === NOT_VISIBLE_CONFLICT) return 'someone else already holds this record, so your change could not reach it';
  if (r === 'terminal error or retry exhaustion') return 'the server refused it after several tries';
  if (r === 'queue cap exceeded') return 'the offline queue was full';
  if (r.startsWith('enqueue failed')) return 'this device could not store it for later';
  return r.length > 0 ? r : 'could not be sent';
}

/** Human table name. Deliberately small and explicit rather than a
 *  prettifier — a wrong guess here is shown to the user as the name of the
 *  thing they lost. Unknown tables fall back to the raw name, which is at
 *  least true. */
const TABLE_LABELS: Record<string, string> = {
  projects: 'Project',
  daily_reports: 'Daily report',
  field_tickets: 'Field ticket',
  punch_items: 'Punch item',
  change_orders: 'Change order',
  invoices: 'Invoice',
  photos: 'Photo record',
  rfis: 'RFI',
  submittals: 'Submittal',
  time_entries: 'Time entry',
  portal_messages: 'Client message',
  delay_events: 'Delay record',
  safety_incidents: 'Safety incident',
  toolbox_talks: 'Toolbox talk',
  deliveries: 'Delivery',
  // Integration round 2: rows keyed on project_id / sub_portal_id. A refused
  // write of one now carries a record id and parks what follows, so it shows
  // on the sheet — as the thing he would recognise, not the table name.
  project_financials: 'Project budget & terms',
  building_access_rules: 'Building access rules',
  sub_portal_snapshots: 'Sub portal page',
  // Integration round 3: the profile row (settings, payment terms,
  // notification choices, the push token) is one record — its line used to
  // read the raw table name on the sheet and in every "Not sent yet" toast.
  profiles: 'Profile & settings',
  // Wave 5 (portfolio): the public project page's on/off flag.
  public_profiles: 'Project page',
};

export function labelForTable(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

// ── Storage (thin; the pure core above is what the validator exercises) ─────

/** Everything on disk. Throws if storage refuses, so a caller can tell
 *  "couldn't look" from "nothing there" — the distinction utils/syncStatusCore
 *  carries as `readFailed`. */
export async function readSyncFailuresOrThrow(): Promise<SyncFailure[]> {
  return parseFailures(await AsyncStorage.getItem(SYNC_FAILURE_KEY));
}

// ── Change listeners ────────────────────────────────────────────────────────
// Retry / Discard / a new failure change what the loaders must keep and what
// the pill shows. The pill's hook re-reads on these; ProjectContext can too.
type LedgerListener = () => void;
const ledgerListeners = new Set<LedgerListener>();

export function onSyncLedgerChanged(listener: LedgerListener): () => void {
  ledgerListeners.add(listener);
  return () => { ledgerListeners.delete(listener); };
}

function notifyLedgerChanged(): void {
  for (const l of ledgerListeners) {
    try { l(); } catch { /* a listener must never break the ledger */ }
  }
}

/**
 * Append failures. Best-effort by design: this runs inside the queue's drop
 * path, and a storage error here must never wedge a flush — the toast and the
 * Sentry warning still fire either way.
 */
export async function recordSyncFailures(incoming: readonly SyncFailure[]): Promise<void> {
  if (incoming.length === 0) return;
  return withQueueLock(async () => {
    try {
      const existing = await readSyncFailuresOrThrow();
      const merged = mergeFailures(existing, incoming);
      await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.warn('[SyncLedger] could not record dropped writes:', (err as Error)?.message);
    }
  }).finally(notifyLedgerChanged);
}

// ── #1: unsaved writes the user can Retry or Discard ────────────────────────
// Lazy require for the same reason offlineQueue lazily requires this file:
// importing the ledger must not pull supabase in at module load (the bun
// validators import it directly).
type QueueModule = typeof import('@/utils/offlineQueue');
function queueModule(): QueueModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/utils/offlineQueue') as QueueModule;
}

async function readOwnFailures(): Promise<SyncFailure[]> {
  const userId = await queueModule().currentSessionUserId();
  if (!userId) return [];
  try {
    return ownFailures(await readSyncFailuresOrThrow(), userId);
  } catch {
    return [];
  }
}

async function removeFailures(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  await withQueueLock(async () => {
    try {
      const kept = (await readSyncFailuresOrThrow()).filter((f) => !drop.has(f.id));
      if (kept.length === 0) await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
      else await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(kept));
    } catch (err) {
      console.warn('[SyncLedger] could not remove unsaved-write records:', (err as Error)?.message);
    }
  });
  notifyLedgerChanged();
}

/**
 * The record ids of `table` this session could not save. Every list loader
 * adds these to mergeLocalOnly's keep set, so a trusted read that does not
 * return the row cannot delete the only copy of it. Storage refused → empty
 * (the loaders' own queue read decides then; this never throws).
 */
export async function unsavedWriteIds(table: string): Promise<Set<string>> {
  return unsavedIdsIn(await readOwnFailures(), table);
}

// Ledger ids whose payload Retry is sending right now (parkBehindUnsavedIn
// never folds into one), and the records being retried (the flush leaves their
// queued writes alone meanwhile — see isRecordRetrying).
const retryingIds = new Set<string>();
const retryingRecords = new Map<string, Promise<'synced' | 'queued' | 'failed'>>();

/** Is Retry replaying this record right now? The flush does not park a queued
 *  write of it then: Retry itself may just have queued the record's oldest
 *  write, and parking that behind the lines it has not reached yet would
 *  reverse the record's order. */
export function isRecordRetrying(table: string, recordId: string): boolean {
  return retryingRecords.has(`${table}:${recordId}`);
}

/** This session's resendable lines (Retry-able writes), for a caller that
 *  counts or maps them — e.g. "Leave project" warning what goes with the job.
 *  Storage refused → []. */
export async function ownUnsavedWrites(): Promise<SyncFailure[]> {
  return (await readOwnFailures()).filter(isRetryableFailure);
}

/** The ids of `table` whose CREATE this session could not save (see
 *  unsavedCreateIdsIn). Storage refused → empty. */
export async function unsavedCreateIds(table: string): Promise<Set<string>> {
  return unsavedCreateIdsIn(await readOwnFailures(), table);
}

/**
 * Does THIS session's ledger hold a resendable write of the record? The
 * question offlineQueue's park rule asks — so a screen can tell "held behind
 * Not saved" (nothing was sent) from "the server refused it" before it words
 * an alert. Storage refused → false.
 */
export async function hasUnsavedChainForSession(table: string, recordId: string): Promise<boolean> {
  const userId = await queueModule().currentSessionUserId();
  if (!userId) return false;
  return hasUnsavedChain(userId, table, recordId);
}

/**
 * Convert this session's resendable lines that `reasonFor` names into notes
 * (notesForUnsavedIn), under the lock. Returns how many were converted. The
 * records' ids stop being kept on the phone — the caller is forgetting them.
 */
export async function noteUnsavedWrites(reasonFor: (f: SyncFailure) => string | null): Promise<number> {
  const userId = await queueModule().currentSessionUserId();
  if (!userId) return 0;
  let noted = 0;
  await withQueueLock(async () => {
    try {
      const plan = notesForUnsavedIn(await readSyncFailuresOrThrow(), userId, reasonFor);
      if (plan.noted === 0) return;
      await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(plan.next));
      noted = plan.noted;
    } catch (err) {
      console.warn('[SyncLedger] could not turn a left job\'s unsaved writes into notes:', (err as Error)?.message);
    }
  });
  if (noted > 0) notifyLedgerChanged();
  return noted;
}

/** Does this user's ledger hold a resendable write of the record? Storage
 *  refused → false (the caller sends as it did before the ledger existed). */
export async function hasUnsavedChain(userId: string, table: string, recordId: string): Promise<boolean> {
  try {
    return hasUnsavedChainIn(await readSyncFailuresOrThrow(), userId, table, recordId);
  } catch {
    return false;
  }
}

/** Must this write wait behind this user's unsaved chain of its record
 *  (unsavedChainBlocksIn)? Storage refused → false, as hasUnsavedChain. */
export async function unsavedChainBlocks(
  userId: string,
  write: Pick<SyncFailure, 'table' | 'recordId' | 'operation' | 'row'>,
): Promise<boolean> {
  try {
    return unsavedChainBlocksIn(await readSyncFailuresOrThrow(), userId, write);
  } catch {
    return false;
  }
}

/**
 * The flush's form of parkBehindUnsavedWrite: 'parked'; 'independent' — the
 * record still has an unsaved chain but this write provably commutes with it
 * (writeIsIndependentOfChain), so the caller SENDS it; or 'no_chain' — the
 * unsaved writes went meanwhile (or the ledger could not be read/written).
 */
export async function parkOrPassBehindUnsavedWrite(incoming: SyncFailure): Promise<'parked' | 'independent' | 'no_chain'> {
  let answer = 'no_chain' as 'parked' | 'independent' | 'no_chain';
  await withQueueLock(async () => {
    try {
      const plan = parkBehindUnsavedIn(await readSyncFailuresOrThrow(), incoming, retryingIds);
      if (plan.independent) { answer = 'independent'; return; }
      if (!plan.parked) return;
      await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(plan.next));
      answer = 'parked';
    } catch (err) {
      console.warn('[SyncLedger] could not park a write behind its unsaved record:', (err as Error)?.message);
      answer = 'no_chain';
    }
  });
  if (answer === 'parked') notifyLedgerChanged();
  return answer;
}

/**
 * Park a write behind its record's unsaved writes (parkBehindUnsavedIn), under
 * the ledger lock so the look and the write are one step. Resolves true when it
 * was parked — the caller must then NOT send it. A ledger that cannot be read
 * or written answers false: the write goes out as it did before the ledger
 * existed rather than being lost.
 */
export async function parkBehindUnsavedWrite(incoming: SyncFailure): Promise<boolean> {
  let parked = false;
  await withQueueLock(async () => {
    try {
      const plan = parkBehindUnsavedIn(await readSyncFailuresOrThrow(), incoming, retryingIds);
      if (!plan.parked) return;
      await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(plan.next));
      parked = true;
    } catch (err) {
      console.warn('[SyncLedger] could not park a write behind its unsaved record:', (err as Error)?.message);
      parked = false;
    }
  });
  if (parked) notifyLedgerChanged();
  return parked;
}

/**
 * Resend an unsaved write — and every other unsaved write of the same record,
 * oldest first, so a refused INSERT goes back before the edit made on it.
 * The ONLY path that resends anything from the ledger: nothing is ever sent
 * automatically. Returns the worst outcome.
 *
 * A line leaves the ledger only AFTER its resend reports 'synced' or 'queued'
 * (integration round 1): removed first, a list read during the resend found the
 * record neither unsaved nor queued and dropped the device copy. Each entry is
 * re-read just before it is sent (a later save may have folded into it), and
 * writes parked while the replay runs are picked up by the next round. The
 * resend skips the park check (`ledgerRetry`) — it IS the ordered replay — and
 * a refusal leaves this line and the ones behind it exactly where they were.
 */
export async function retryUnsavedWrite(failureId: string): Promise<'synced' | 'queued' | 'failed'> {
  const own = await readOwnFailures();
  const target = own.find((f) => f.id === failureId);
  if (!target || !isRetryableFailure(target)) return 'failed';
  const recordKey = target.table && target.recordId ? `${target.table}:${target.recordId}` : `id:${target.id}`;
  const running = retryingRecords.get(recordKey);
  if (running) return running; // a double tap joins the replay already running
  const run = replayRecord(target).finally(() => { retryingRecords.delete(recordKey); });
  retryingRecords.set(recordKey, run);
  return run;
}

// Retry listeners (integration round 3): a Retry that lands must re-read what
// it wrote, as Discard does. A flush that refused a queued payment append
// takes the payment off the device invoice (stripDroppedPayment); the Retry
// that later lands it emitted no flush or queue event, so the sheet line went
// away as saved while the invoice still read unpaid — and a second "record
// payment" from there found no unsaved append to warn about and counted the
// money twice. Called with the lines this Retry took off the sheet (each one
// 'synced' or 'queued', oldest first) and the replay's overall outcome —
// whenever at least one line went, even if a later line of the record was
// refused again ('failed'): what did land must still be re-read.
type RetryListener = (sent: readonly SyncFailure[], outcome: 'synced' | 'queued' | 'failed') => void;
const retryListeners = new Set<RetryListener>();
export function onUnsavedRetried(listener: RetryListener): () => void {
  retryListeners.add(listener);
  return () => { retryListeners.delete(listener); };
}

/** Rounds of "pick up what was parked while replaying" before Retry stops and
 *  leaves the rest on the sheet for the next tap. */
const MAX_REPLAY_ROUNDS = 5;

async function replayRecord(target: SyncFailure): Promise<'synced' | 'queued' | 'failed'> {
  const sent: SyncFailure[] = [];
  let out: 'synced' | 'queued' | 'failed' = 'failed';
  try {
    out = await replayRecordLines(target, sent);
  } finally {
    // Even a replay that ends 'failed' may have landed its first lines —
    // those are re-read too (their lines are gone from the sheet).
    if (sent.length > 0) {
      for (const l of retryListeners) {
        try { l(sent, out); } catch { /* a listener must never break a retry */ }
      }
    }
  }
  return out;
}

async function replayRecordLines(target: SyncFailure, sent: SyncFailure[]): Promise<'synced' | 'queued' | 'failed'> {
  const q = queueModule();
  let worst: 'synced' | 'queued' | 'failed' = 'synced';
  const done = new Set<string>();
  for (let round = 0; round < MAX_REPLAY_ROUNDS; round++) {
    const batch = unsavedBatchFor(await readOwnFailures(), target)
      .filter(isRetryableFailure)
      .filter((f) => !done.has(f.id));
    if (batch.length === 0) break;
    for (const queued of batch) {
      retryingIds.add(queued.id);
      try {
        // Busy BEFORE the fresh read: a fold that landed earlier is in it, and
        // none can land after (parkBehindUnsavedIn skips a busy entry).
        const f = (await readOwnFailures()).find((x) => x.id === queued.id);
        done.add(queued.id);
        if (!f || !isRetryableFailure(f)) continue; // discarded meanwhile
        let out: 'synced' | 'queued' | 'failed';
        try {
          out = f.operation === 'rpc'
            ? await q.supabaseRpcDetailed(f.table!, f.recordId!, f.rpc!.fn, f.rpc!.args, { ledgerRetry: true })
            // The line's riders go with its resend: queued now and refused by
            // a later flush, the new line still names them for Discard.
            : await q.supabaseWriteDetailed(f.table!, f.operation as 'insert' | 'upsert' | 'update' | 'delete', f.row!, { ledgerRetry: true, ...(f.rides ? { rides: f.rides } : {}) });
        } catch {
          out = 'failed';
        }
        if (out === 'failed') return 'failed';
        await removeFailures([f.id]);
        sent.push(f);
        if (out === 'queued') worst = 'queued';
      } finally {
        retryingIds.delete(queued.id);
      }
    }
  }
  return worst;
}

// Discard listeners: ProjectContext drops what it stashed for a discarded
// write (a change order's owed audit entries) and re-reads the table, so the
// phone really does go back to MAGE's copy as the confirm says.
type DiscardListener = (discarded: readonly SyncFailure[]) => void;
const discardListeners = new Set<DiscardListener>();
export function onUnsavedDiscarded(listener: DiscardListener): () => void {
  discardListeners.add(listener);
  return () => { discardListeners.delete(listener); };
}

/**
 * Remove an unsaved write — and every other unsaved write of the same record —
 * from the ledger. The ONLY path that removes one: after this the record's id
 * is no longer kept, and the next list read drops the device copy. The UI
 * confirms first and says the data will not be recovered. Returns how many
 * entries went.
 */
export async function discardUnsavedWrite(failureId: string): Promise<number> {
  const own = await readOwnFailures();
  const target = own.find((f) => f.id === failureId);
  if (!target) return 0;
  const batch = unsavedBatchFor(own, target);
  await removeFailures(batch.map((f) => f.id));
  for (const l of discardListeners) {
    try { l(batch); } catch { /* a listener must never break a discard */ }
  }
  return batch.length;
}

/** How many records this session has unsaved writes for (see
 *  unsavedRecordCountIn). Storage refused → 0. */
export async function countOwnUnsavedRecords(): Promise<number> {
  const userId = await queueModule().currentSessionUserId();
  if (!userId) return 0;
  try {
    return unsavedRecordCountIn(await readSyncFailuresOrThrow(), userId);
  } catch {
    return 0;
  }
}

/** The amounts of this session's unsaved payment appends on one invoice —
 *  the invoice screen asks before a new payment is recorded over them. */
export async function unsavedPaymentAppends(invoiceId: string): Promise<number[]> {
  const userId = await queueModule().currentSessionUserId();
  if (!userId) return [];
  try {
    return unsavedPaymentAppendsIn(await readSyncFailuresOrThrow(), userId, invoiceId);
  } catch {
    return [];
  }
}

// "Open the Not-saved sheet" from elsewhere (the sign-out confirm). The pill
// mounted app-wide owns the sheet and subscribes.
type SheetListener = () => void;
const sheetListeners = new Set<SheetListener>();
export function onSyncSheetRequested(listener: SheetListener): () => void {
  sheetListeners.add(listener);
  return () => { sheetListeners.delete(listener); };
}
export function requestSyncSheet(): void {
  for (const l of sheetListeners) {
    try { l(); } catch { /* ignore */ }
  }
}

/**
 * Empty the ledger on a deliberate sign-out / tenant switch.
 *
 * The counterpart to this key's exemption in OFFLINE_WRITE_QUEUE_KEYS: the
 * prefix sweep deliberately no longer touches it (so a same-user re-auth keeps
 * the red "didn't sync" notice), which means the sign-out path has to. Under
 * the lock, for the reason in the header — the drop path can be mid-write.
 */
export async function clearSyncFailures(): Promise<void> {
  await withQueueLock(async () => {
    try {
      await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
    } catch (err) {
      console.warn('[SyncLedger] could not clear the failure ledger:', (err as Error)?.message);
    }
  });
}

/**
 * Keep only `userId`'s notes; drop the rest. Twin of the queues'
 * retain*ForUser, for the session that arrives with no last-user marker.
 *
 * Untagged rows go: unlike a queue entry there is no marker fallback here
 * (see ownFailures), so an untagged note is unreadable by anyone and keeping
 * it only leaves the previous tenant's paperwork on the disk.
 */
export async function retainSyncFailuresForUser(userId: string): Promise<void> {
  await withQueueLock(async () => {
    try {
      const kept = (await readSyncFailuresOrThrow()).filter((f) => f.userId === userId);
      if (kept.length === 0) await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
      else await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(kept));
    } catch (err) {
      console.warn('[SyncLedger] could not narrow the failure ledger:', (err as Error)?.message);
    }
  });
}

/**
 * Forget the listed failures (or all of them).
 *
 * This is an ACKNOWLEDGEMENT, not a recovery, and every call site must say so
 * in its copy. Nothing here re-queues anything: the data is gone from the
 * queue and the user has to re-enter it.
 */
export async function acknowledgeSyncFailures(ids?: readonly string[]): Promise<void> {
  return withQueueLock(async () => {
  try {
    if (!ids) {
      await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
      return;
    }
    const drop = new Set(ids);
    const kept = (await readSyncFailuresOrThrow()).filter((f) => !drop.has(f.id));
    if (kept.length === 0) await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
    else await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(kept));
  } catch (err) {
    console.warn('[SyncLedger] could not clear dropped-write records:', (err as Error)?.message);
  }
  }).finally(notifyLedgerChanged);
}
