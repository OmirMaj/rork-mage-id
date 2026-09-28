// utils/backchargeRows.ts — a backcharge on the wire (public.backcharges,
// supabase/migrations/20260928160000_backcharges.sql) and the rules that merge
// the account copy with the device copy.
//
// PURE except fetchAccountBackcharges at the bottom, which requires the
// Supabase client lazily (inside the call) so the bun validators can import
// this module without pulling React Native in.
//
// THE OWNER COLUMN NEVER TRAVELS. toRow takes no userId and never writes
// user_id: the column default auth.uid() fills it on insert, and a payload
// without it keeps ON CONFLICT DO UPDATE from ever touching the author of a
// row an editor is editing (the table's BEFORE UPDATE trigger is the server
// side of the same guarantee).
//
// The device's photoUri is NOT stored on the account — it is a path on one
// phone. The durable photo is photoId (a ProjectPhoto). A row read back from
// the account takes the device's photoUri for the same id when there is one.
//
// Pinned by scripts/validate-backcharges-sync.ts.

import { parseBackcharges, type Backcharge } from '@/utils/backcharges';

export const BACKCHARGES_TABLE = 'backcharges';

/** Which account the device list belongs to, and the ids the account has
 *  confirmed. A mageid_ key, so the sign-out sweep removes it with the list. */
export const BACKCHARGES_ACCOUNT_KEY = 'mageid_backcharges_account';

/** The columns the client sends. No user_id, no updated_at (the trigger and
 *  the column default stamp it), no photo_uri. */
export interface BackchargeRow {
  id: string;
  project_id: string;
  sub_id: string;
  sub_name: string;
  commitment_id: string | null;
  reason: string;
  amount_cents: number;
  basis: 'typed' | 'hours_x_rate';
  hours: number | null;
  rate_cents: number | null;
  photo_id: string | null;
  punch_item_id: string | null;
  status: Backcharge['status'];
  applied_invoice_id: string | null;
  applied_at: string | null;
  created_at: string;
}

/** The columns read back. user_id is read for display/debug only: nothing
 *  branches on it. */
export const BACKCHARGE_SELECT_COLUMNS =
  'id, user_id, project_id, sub_id, sub_name, commitment_id, reason, amount_cents, basis, hours, rate_cents, photo_id, punch_item_id, status, applied_invoice_id, applied_at, created_at, updated_at';

export function toRow(b: Backcharge): BackchargeRow {
  return {
    id: b.id,
    project_id: b.projectId,
    sub_id: b.subId,
    sub_name: b.subName ?? '',
    commitment_id: b.commitmentId ?? null,
    reason: b.reason,
    amount_cents: b.amountCents,
    basis: b.basis,
    hours: b.basis === 'hours_x_rate' ? b.hours : null,
    rate_cents: b.basis === 'hours_x_rate' ? b.rateCents : null,
    photo_id: b.photoId ?? null,
    punch_item_id: b.punchItemId ?? null,
    status: b.status,
    applied_invoice_id: b.appliedInvoiceId ?? null,
    applied_at: b.appliedAt ?? null,
    created_at: b.createdAt,
  };
}

/** A whole-number string ("45000") or number → number; anything else passes
 *  through for parseBackcharges to judge. PostgREST sends bigint and numeric
 *  as JSON numbers, but a proxy that stringifies them must not zero a charge. */
function num(v: unknown): unknown {
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return v;
}

/** One account row → a Backcharge, or null when parseBackcharges would drop it
 *  (missing id, non-integer or ≤ 0 cents, unknown status). photoUri is null:
 *  the merge carries the device's. */
export function fromRow(r: unknown): Backcharge | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const camel = {
    id: o.id,
    projectId: o.project_id,
    subId: o.sub_id,
    subName: o.sub_name,
    commitmentId: o.commitment_id,
    reason: o.reason,
    amountCents: num(o.amount_cents),
    basis: o.basis,
    hours: num(o.hours),
    rateCents: num(o.rate_cents),
    photoUri: null,
    photoId: o.photo_id,
    punchItemId: o.punch_item_id,
    status: o.status,
    appliedInvoiceId: o.applied_invoice_id,
    appliedAt: o.applied_at,
    createdAt: o.created_at,
  };
  // The SAME drop rules as the device list: one parser, never two.
  const [b] = parseBackcharges(JSON.stringify([camel]));
  return b ?? null;
}

export function fromRows(rows: readonly unknown[] | null | undefined): Backcharge[] {
  const out: Backcharge[] = [];
  for (const r of rows ?? []) {
    const b = fromRow(r);
    if (b) out.push(b);
  }
  return out;
}

// ── Merge ────────────────────────────────────────────────────────────────────

export interface MergeBackchargesInput {
  /** What this device holds. */
  device: readonly Backcharge[];
  /** The account's rows, already through fromRows. */
  server: readonly Backcharge[];
  /** Ids with a write still waiting on this device (queued, or on the wire). */
  pendingIds: ReadonlySet<string>;
  /** Ids whose write was refused (the "Not saved" list). Kept, never adopted. */
  unsavedIds: ReadonlySet<string>;
  /** Ids already sent up once this session: adopted at most once. */
  adoptedIds: ReadonlySet<string>;
  /** False when the device list was written for ANOTHER account: its
   *  device-only rows are dropped instead of sent up under this one. */
  deviceIsThisUsers: boolean;
}

export interface MergeBackchargesResult {
  merged: Backcharge[];
  /** Device-only rows to send up once (made before this update, or never sent). */
  toAdopt: Backcharge[];
  /** Ids the account returned — the 'saved' evidence. */
  serverIds: Set<string>;
}

/**
 * Server rows win, except an id with a write still pending (or refused) on this
 * device keeps its device copy. A device row the account does not return is
 * NEVER deleted here: it stays, and is sent up once unless it is pending or
 * refused. A server row keeps the device photoUri of the same id.
 * Order: the device order first, then account-only rows oldest first.
 */
export function mergeBackcharges(input: MergeBackchargesInput): MergeBackchargesResult {
  const serverById = new Map<string, Backcharge>();
  for (const s of input.server) if (s?.id) serverById.set(s.id, s);
  const serverIds = new Set(serverById.keys());
  const merged: Backcharge[] = [];
  const toAdopt: Backcharge[] = [];
  const seen = new Set<string>();
  for (const d of input.device) {
    if (!d?.id || seen.has(d.id)) continue;
    const s = serverById.get(d.id);
    const held = input.pendingIds.has(d.id) || input.unsavedIds.has(d.id);
    if (s) {
      seen.add(d.id);
      merged.push(held ? d : { ...s, photoUri: s.photoUri ?? d.photoUri ?? null });
      continue;
    }
    if (!input.deviceIsThisUsers) continue;
    seen.add(d.id);
    merged.push(d);
    if (!held && !input.adoptedIds.has(d.id)) toAdopt.push(d);
  }
  const rest = [...serverById.values()]
    .filter(s => !seen.has(s.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  merged.push(...rest);
  return { merged, toAdopt, serverIds };
}

// ── Per-row state ────────────────────────────────────────────────────────────

/** Where one backcharge is kept, for the words the screens show:
 *  'saved'       the account has it (read back, or the write landed);
 *  'waiting'     the device's own queue holds its write: it goes up when the
 *                queue next flushes (the back-online line);
 *  'unconfirmed' signed in, but the account has not confirmed it and the queue
 *                does not report a write for it (a write on the wire, the first
 *                read of this session not back yet, a read that failed, or the
 *                queue could not be read) — never called saved, and never
 *                blamed on being offline;
 *  'not_saved'   the account refused it (the Not saved list);
 *  'device'      signed out: on this device only. */
export type BackchargeSaveState = 'saved' | 'waiting' | 'unconfirmed' | 'not_saved' | 'device';

export interface SaveStateInput {
  signedIn: boolean;
  unsavedIds: ReadonlySet<string>;
  /** Ids the device's own queue reports a write for. */
  pendingIds: ReadonlySet<string>;
  savedIds: ReadonlySet<string>;
  /** The own-queue read failed: no row can be called saved or waiting. */
  queueUnreadable?: boolean;
}

export function saveStateOf(id: string, s: SaveStateInput): BackchargeSaveState {
  if (!s.signedIn) return 'device';
  if (s.unsavedIds.has(id)) return 'not_saved';
  if (s.queueUnreadable) return 'unconfirmed';
  if (s.pendingIds.has(id)) return 'waiting';
  if (s.savedIds.has(id)) return 'saved';
  return 'unconfirmed';
}

// ── Is the list complete? ────────────────────────────────────────────────────

export interface CompletenessInput {
  signedIn: boolean;
  userId: string | null;
  /** The device copy has been read (or written) this launch. */
  deviceLoaded: boolean;
  /** The account the in-memory list was loaded or written under. */
  listOwner: string | null;
  /** The account whose read of public.backcharges came back this session. */
  accountReadFor: string | null;
}

/**
 * Whether the list holds every backcharge this session can know about.
 * Signed out: the device copy is the whole record, once it has been read.
 * Signed in: only once the account's own read came back for THIS user in this
 * session, and the list is that user's. Before that the list can be [] with
 * backcharges on the account (the web app, a second phone, the first launch
 * after a sign-in, offline, a read that failed) — and [] must never be read as
 * "no backcharges".
 */
export function backchargesComplete(s: CompletenessInput): boolean {
  if (!s.signedIn) return s.deviceLoaded;
  return s.userId != null && s.accountReadFor === s.userId && s.listOwner === s.userId;
}

/**
 * What a scorecard may count. undefined when the list is not complete, so the
 * backcharges factor reads "Backcharges not counted on this screen" (weight 0)
 * instead of a clean record the screen never checked.
 */
export function backchargesForScorecard(list: Backcharge[], complete: boolean): Backcharge[] | undefined {
  return complete ? list : undefined;
}

// ── Device meta ──────────────────────────────────────────────────────────────

export interface BackchargeAccountMeta {
  userId: string | null;
  savedIds: string[];
}

/** Never throws; junk reads as "no owner, nothing confirmed". */
export function parseAccountMeta(raw: string | null | undefined): BackchargeAccountMeta {
  if (!raw) return { userId: null, savedIds: [] };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const userId = typeof o?.userId === 'string' && o.userId.length > 0 ? o.userId : null;
    const savedIds = Array.isArray(o?.savedIds) ? o.savedIds.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
    return { userId, savedIds };
  } catch {
    return { userId: null, savedIds: [] };
  }
}

// ── The account read (the only impure function here) ────────────────────────

/** Every backcharge row this user can see (RLS: owner or editor on the
 *  project). null when the read failed — offline, or the table is not there
 *  yet — so a failed read never empties a real list. */
export async function fetchAccountBackcharges(): Promise<Backcharge[] | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabase } = require('@/lib/supabase') as typeof import('@/lib/supabase');
    const res = await supabase.from(BACKCHARGES_TABLE).select(BACKCHARGE_SELECT_COLUMNS);
    if (res.error || !Array.isArray(res.data)) return null;
    return fromRows(res.data as unknown[]);
  } catch {
    return null;
  }
}
