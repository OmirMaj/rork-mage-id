/**
 * Code Thread — the saved code checks, per job (CONTRACT C8).
 *
 * SYNC DECISION: device first, account behind it. These records live in
 * AsyncStorage under mageid_code_checks (erased on sign-out by the
 * wipeLocalUserCache mageid_* sweep), and every successful local write is also
 * pushed to the account table public.code_checks through utils/offlineQueue
 * (utils/codeThread/cloudSync.ts pushCodeCheck — lazily required so this file
 * stays importable by the bun validators). When the job page opens, the
 * account copy is read and merged with this device's (utils/codeThread/
 * syncMerge.ts), so a check saved on the phone shows on the web app and
 * survives a sign-out. A push is skipped — and picked up by the next merge —
 * while signed out, on a sample job, or on a seat RLS would refuse (viewer).
 *
 * The surfaces say where a check is: 'Saved to your account' ONLY once the
 * account read and every push for that job succeeded; otherwise the
 * device-only line that fits (cloudSync CodeCheckSyncState →
 * ProjectCodeChecksCard CODE_CHECKS_CAPTION).
 *
 * Shape on disk: Record<projectId, CodeCheckRecord[]>, newest first, at most
 * MAX_CHECKS_PER_PROJECT per job (the oldest drop off).
 *
 * The merge logic is pure and exported (upsertCheck / appendAction /
 * parseCodeChecksBlob) so scripts/validate-code-thread.ts can prove it without
 * AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  CodeCheckRecord,
  CodeCheckResultSnapshot,
  CodeThreadActionRecord,
  CodeThreadSection,
} from './types';

export const CODE_CHECKS_KEY = 'mageid_code_checks';
export const MAX_CHECKS_PER_PROJECT = 50;

export type CodeChecksBlob = Record<string, CodeCheckRecord[]>;

/**
 * Parse the stored blob. null / missing = an empty store (ok). Anything that is
 * not an object of arrays = unreadable (null), so the job page can say
 * "couldn't read saved checks" instead of claiming there are none.
 */
export function parseCodeChecksBlob(raw: string | null | undefined): CodeChecksBlob | null {
  if (raw == null || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: CodeChecksBlob = {};
  for (const [pid, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(list)) return null;
    out[pid] = list.filter(
      (r): r is CodeCheckRecord =>
        !!r && typeof r === 'object' && typeof (r as CodeCheckRecord).id === 'string',
    );
  }
  return out;
}

/** The item texts of one section, trimmed. For 'codes' the text is the requirement. */
export function sectionTexts(result: CodeCheckResultSnapshot | null | undefined, section: CodeThreadSection): string[] {
  const r = result;
  if (!r) return [];
  const raw: unknown[] =
    section === 'codes'
      ? (Array.isArray(r.applicableCodes) ? r.applicableCodes : []).map((c) => c?.requirement)
      : section === 'permits'
        ? (Array.isArray(r.permitsRequired) ? r.permitsRequired : [])
        : section === 'inspections'
          ? (Array.isArray(r.inspections) ? r.inspections : [])
          : (Array.isArray(r.commonViolations) ? r.commonViolations : []);
  return raw.map((t) => (typeof t === 'string' ? t.trim() : ''));
}

/**
 * Carry the actions taken on one result over to a re-run's result. An action
 * is tied to the TEXT of the item it was taken on, not to its position: each
 * old item (in order) claims the first not-yet-claimed new item in the same
 * section with the same trimmed text. An action on a claimed item moves to the
 * new index; an action whose item is gone (or was blank) is dropped. The
 * permit / punch item / RFI it created stays in its own list either way — only
 * the "Added" mark on this check follows the item.
 *
 * Invariant (proven in scripts/validate-code-thread.ts): every action returned
 * points at an item in `next` whose text equals the text it was taken on.
 */
export function remapActions(
  prev: CodeCheckResultSnapshot | null | undefined,
  actions: readonly CodeThreadActionRecord[] | null | undefined,
  next: CodeCheckResultSnapshot | null | undefined,
): CodeThreadActionRecord[] {
  const maps = new Map<CodeThreadSection, Map<number, number>>();
  const mapFor = (section: CodeThreadSection): Map<number, number> => {
    const hit = maps.get(section);
    if (hit) return hit;
    const oldTexts = sectionTexts(prev, section);
    const newTexts = sectionTexts(next, section);
    const claimed = new Set<number>();
    const m = new Map<number, number>();
    oldTexts.forEach((t, oldIdx) => {
      if (!t) return;
      const newIdx = newTexts.findIndex((n, j) => n === t && !claimed.has(j));
      if (newIdx >= 0) {
        claimed.add(newIdx);
        m.set(oldIdx, newIdx);
      }
    });
    maps.set(section, m);
    return m;
  };
  let out: CodeThreadActionRecord[] = [];
  for (const a of Array.isArray(actions) ? actions : []) {
    if (!a || typeof a.index !== 'number') continue;
    const newIdx = mapFor(a.section).get(a.index);
    if (newIdx === undefined) continue;
    out = appendAction(out, { ...a, index: newIdx });
  }
  return out;
}

/**
 * Upsert by id, newest first, capped at MAX_CHECKS_PER_PROJECT (oldest drop).
 * A re-run of the same thread (same id) replaces the record in place of its
 * old position — moved to the front — and KEEPS the actions already taken on
 * it: the stored actions are remapped from the old result to the new one by
 * item text (remapActions), then merged with the new record's actions, which
 * must already be in the new result's index space.
 */
export function upsertCheck(list: readonly CodeCheckRecord[], rec: CodeCheckRecord): CodeCheckRecord[] {
  const prev = list.find((r) => r.id === rec.id);
  let merged = rec;
  if (prev) {
    let actions = remapActions(prev.result, prev.actions, rec.result);
    for (const a of rec.actions ?? []) actions = appendAction(actions, a);
    merged = { ...rec, createdAt: prev.createdAt || rec.createdAt, actions };
  }
  const rest = list.filter((r) => r.id !== rec.id);
  return [merged, ...rest].slice(0, MAX_CHECKS_PER_PROJECT);
}

/** Append an action, idempotent on kind + section + index. */
export function appendAction(
  actions: readonly CodeThreadActionRecord[],
  action: CodeThreadActionRecord,
): CodeThreadActionRecord[] {
  const dup = actions.some(
    (a) => a.kind === action.kind && a.section === action.section && a.index === action.index,
  );
  return dup ? [...actions] : [...actions, action];
}

const listeners = new Set<() => void>();

/** Called after every successful write. Returns the unsubscribe. */
export function subscribeCodeChecks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch {
      /* a listener's failure never blocks the others */
    }
  }
}

/** Wake every listener without a write (the cloud sync's state changed). */
export function notifyCodeChecks(): void {
  notify();
}

async function readBlob(): Promise<CodeChecksBlob | null> {
  try {
    const raw = await AsyncStorage.getItem(CODE_CHECKS_KEY);
    return parseCodeChecksBlob(raw);
  } catch {
    return null;
  }
}

/** Push a record to the account after a successful local write. Lazy require
 *  (house pattern, utils/syncLedger queueModule): importing this store must not
 *  pull supabase / the offline queue in at module load. Never throws. */
function pushAfterLocalWrite(rec: CodeCheckRecord | undefined): void {
  if (!rec) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cloud = require('./cloudSync') as typeof import('./cloudSync');
    void cloud.pushCodeCheck(rec).catch(() => { /* the next merge re-pushes it */ });
  } catch {
    /* no cloud module (a bun validator): the device copy is the whole story */
  }
}

async function writeBlob(blob: CodeChecksBlob): Promise<boolean> {
  try {
    await AsyncStorage.setItem(CODE_CHECKS_KEY, JSON.stringify(blob));
    notify();
    return true;
  } catch {
    return false;
  }
}

export async function loadCodeChecks(
  projectId: string,
): Promise<{ ok: true; checks: CodeCheckRecord[] } | { ok: false }> {
  const blob = await readBlob();
  if (!blob) return { ok: false };
  return { ok: true, checks: blob[projectId] ?? [] };
}

// Every read-modify-write of the blob runs one at a time: the cloud merge and
// a pushed stamp's write-back must never interleave with a save and drop it.
let storeChain: Promise<unknown> = Promise.resolve();
function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storeChain.then(fn, fn);
  storeChain = run.then(() => undefined, () => undefined);
  return run;
}

export async function saveCodeCheck(rec: CodeCheckRecord): Promise<boolean> {
  if (!rec?.id || !rec.projectId) return false;
  const saved = await withStoreLock(async () => {
    const blob = await readBlob();
    // An unreadable blob is never overwritten: that would erase every saved check.
    if (!blob) return null;
    blob[rec.projectId] = upsertCheck(blob[rec.projectId] ?? [], rec);
    const ok = await writeBlob(blob);
    return ok ? blob[rec.projectId].find((r) => r.id === rec.id) ?? null : null;
  });
  // A failed local write pushes nothing.
  if (saved) pushAfterLocalWrite(saved);
  return !!saved;
}

export async function recordCodeThreadAction(
  projectId: string,
  recordId: string,
  action: CodeThreadActionRecord,
): Promise<boolean> {
  const out = await withStoreLock(async (): Promise<{ ok: boolean; changed: CodeCheckRecord | null }> => {
    const blob = await readBlob();
    if (!blob) return { ok: false, changed: null };
    const list = blob[projectId] ?? [];
    const idx = list.findIndex((r) => r.id === recordId);
    if (idx < 0) return { ok: false, changed: null };
    const rec = list[idx];
    const prevActions = Array.isArray(rec.actions) ? rec.actions : [];
    const actions = appendAction(prevActions, action);
    const changed = actions.length !== prevActions.length;
    const next = [...list];
    next[idx] = {
      ...rec,
      actions,
      // The record changed, so its stamp moves: the merge's newer-wins reads it.
      ...(changed ? { updatedAt: new Date().toISOString() } : {}),
    };
    blob[projectId] = next;
    const ok = await writeBlob(blob);
    return { ok, changed: ok && changed ? next[idx] : null };
  });
  if (out.changed) pushAfterLocalWrite(out.changed);
  return out.ok;
}

/**
 * Replace one job's list (the cloud merge's result, or a pushed stamp written
 * back). `list` may be a function of the job's CURRENT list, run under the
 * store lock; returning that same array means "no change" (nothing written,
 * true). An unreadable blob returns false and writes nothing — never
 * overwrite what could not be read. Notifies on a write.
 */
export async function replaceProjectChecks(
  projectId: string,
  list: CodeCheckRecord[] | ((current: CodeCheckRecord[]) => CodeCheckRecord[]),
): Promise<boolean> {
  if (!projectId) return false;
  return withStoreLock(async () => {
    const blob = await readBlob();
    if (!blob) return false;
    const current = blob[projectId] ?? [];
    const next = typeof list === 'function' ? list(current) : list;
    if (next === current) return true;
    blob[projectId] = next;
    return writeBlob(blob);
  });
}
