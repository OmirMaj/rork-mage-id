/**
 * Code Thread — the pure half of the saved-code-check cloud sync.
 *
 * The device copy (utils/codeThread/store.ts, mageid_code_checks) and the
 * account copy (public.code_checks, one row per check, the whole record as
 * jsonb) are merged here by id. No React, no storage, no network —
 * scripts/validate-cloud-sync.ts executes it.
 *
 * WHY "SERVER WINS A TIE" NEVER LOSES HIS WORK: a check's content (scenario,
 * answers, grounding, result) is written once when he runs it; after that the
 * only thing that changes is the append-only actions[] ("Added to Permits",
 * "Punch item made"). So the only thing a losing copy can carry that the
 * winner lacks is actions — and the merge unions the loser's actions into the
 * winner through appendAction. A re-run of the same thread (same id) is the
 * one case where the content itself changes; then the newer copy's content
 * wins and the loser's actions are first remapped onto it by item text
 * (remapActions, the same rule upsertCheck uses on the device).
 *
 * Every stamp comparison goes through stampMs (utils/syncSeat): PostgREST
 * returns '…:00.12+00:00' for the '…:00.120Z' the client wrote.
 */
import { stampMs } from '@/utils/syncSeat';
import { MAX_CHECKS_PER_PROJECT, appendAction, remapActions } from './store';
import type { CodeCheckRecord } from './types';

export interface CodeCheckRow {
  id: string;
  project_id: string;
  user_id: string;
  record: CodeCheckRecord;
  created_at: string;
  updated_at: string;
}

/**
 * The row a push writes. The row's updated_at and the record's updatedAt are
 * the SAME string — the stamp that was pushed — so the next merge compares
 * like with like.
 */
export function codeCheckRow(rec: CodeCheckRecord, userId: string, updatedAt: string): CodeCheckRow {
  return {
    id: rec.id,
    project_id: rec.projectId,
    user_id: userId,
    record: { ...rec, updatedAt },
    created_at: rec.createdAt || updatedAt,
    updated_at: updatedAt,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A server row back into a record, defensively. null unless row.record is an
 * object whose id and projectId match the row's own columns (a row that
 * disagrees with itself is never trusted onto the device).
 */
export function recordFromRow(row: unknown): { rec: CodeCheckRecord; serverMs: number | null } | null {
  if (!isObj(row)) return null;
  const r = row.record;
  if (!isObj(r)) return null;
  if (typeof row.id !== 'string' || row.id === '' || r.id !== row.id) return null;
  if (typeof row.project_id !== 'string' || r.projectId !== row.project_id) return null;
  const rec = { ...(r as unknown as CodeCheckRecord) };
  if (!Array.isArray(rec.actions)) rec.actions = [];
  if (typeof rec.updatedAt !== 'string') rec.updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
  if (typeof rec.createdAt !== 'string') rec.createdAt = typeof row.created_at === 'string' ? row.created_at : rec.updatedAt;
  return { rec, serverMs: stampMs(typeof row.updated_at === 'string' ? row.updated_at : null) };
}

const msOr = (s: string | null | undefined): number => stampMs(s) ?? Number.NEGATIVE_INFINITY;

/** The loser's actions carried onto the winner (remapped by item text when the result differs). */
function unionActions(winner: CodeCheckRecord, loser: CodeCheckRecord): CodeCheckRecord['actions'] {
  const wActs = Array.isArray(winner.actions) ? winner.actions : [];
  const lActs = Array.isArray(loser.actions) ? loser.actions : [];
  let carried = lActs;
  let sameResult = false;
  try { sameResult = JSON.stringify(winner.result) === JSON.stringify(loser.result); } catch { sameResult = false; }
  if (!sameResult) carried = remapActions(loser.result, lActs, winner.result);
  let out = [...wActs];
  for (const a of carried) out = appendAction(out, a);
  return out;
}

/**
 * Merge the device's checks for one job with the account's, keyed by id.
 *   - local-only  → kept AND pushed;
 *   - server-only → kept;
 *   - both        → the newer by stampMs(updatedAt) wins (a tie → the server),
 *                   the loser's actions are unioned in; pushed when local was
 *                   newer or the union added to the server's copy.
 * `merged` is newest first by createdAt, capped at MAX_CHECKS_PER_PROJECT; only
 * records that survive the cap are pushed.
 */
export function mergeCodeCheckLists(
  local: readonly CodeCheckRecord[],
  server: readonly CodeCheckRecord[],
): { merged: CodeCheckRecord[]; push: CodeCheckRecord[] } {
  const serverById = new Map<string, CodeCheckRecord>();
  for (const s of server) if (s && typeof s.id === 'string') serverById.set(s.id, s);
  const out = new Map<string, CodeCheckRecord>();
  const pushIds = new Set<string>();

  for (const l of local) {
    if (!l || typeof l.id !== 'string' || out.has(l.id)) continue;
    const s = serverById.get(l.id);
    if (!s) {
      out.set(l.id, l);
      pushIds.add(l.id);
      continue;
    }
    const localNewer = msOr(l.updatedAt) > msOr(s.updatedAt);
    const winner = localNewer ? l : s;
    const loser = localNewer ? s : l;
    const actions = unionActions(winner, loser);
    out.set(l.id, { ...winner, actions });
    const serverActs = Array.isArray(s.actions) ? s.actions.length : 0;
    if (localNewer || actions.length !== serverActs) pushIds.add(l.id);
  }
  for (const s of server) {
    if (!s || typeof s.id !== 'string' || out.has(s.id)) continue;
    out.set(s.id, s);
  }

  const merged = [...out.values()]
    // Newest first by createdAt (the date the job card shows, and upsertCheck's
    // order on the device); a tie falls to the more recently touched copy.
    .sort((a, b) => (msOr(b.createdAt) - msOr(a.createdAt)) || (msOr(b.updatedAt) - msOr(a.updatedAt)))
    .slice(0, MAX_CHECKS_PER_PROJECT);
  const push = merged.filter((r) => pushIds.has(r.id));
  return { merged, push };
}
