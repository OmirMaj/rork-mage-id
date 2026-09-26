/**
 * Code Thread — the saved code checks, per job (CONTRACT C8).
 *
 * SYNC DECISION: Local-first for this wave. These records live in AsyncStorage
 * under mageid_code_checks, so they stay on this device and are erased when he
 * signs out (wipeLocalUserCache sweeps mageid_*). Because sign-out erases them,
 * a synced code_checks table IS worth building. It is the recommended next
 * small wave (migration + RLS + an offline-queue mapper + a storage-hygiene
 * entry + a PGlite test, about an hour). It is not in this wave because this
 * wave ships with no migrations.
 *
 * Every surface that shows a saved check says so: 'on this device until you
 * sign out'.
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

async function readBlob(): Promise<CodeChecksBlob | null> {
  try {
    const raw = await AsyncStorage.getItem(CODE_CHECKS_KEY);
    return parseCodeChecksBlob(raw);
  } catch {
    return null;
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

export async function saveCodeCheck(rec: CodeCheckRecord): Promise<boolean> {
  if (!rec?.id || !rec.projectId) return false;
  const blob = await readBlob();
  // An unreadable blob is never overwritten: that would erase every saved check.
  if (!blob) return false;
  blob[rec.projectId] = upsertCheck(blob[rec.projectId] ?? [], rec);
  return writeBlob(blob);
}

export async function recordCodeThreadAction(
  projectId: string,
  recordId: string,
  action: CodeThreadActionRecord,
): Promise<boolean> {
  const blob = await readBlob();
  if (!blob) return false;
  const list = blob[projectId] ?? [];
  const idx = list.findIndex((r) => r.id === recordId);
  if (idx < 0) return false;
  const rec = list[idx];
  const next = [...list];
  next[idx] = {
    ...rec,
    actions: appendAction(Array.isArray(rec.actions) ? rec.actions : [], action),
  };
  blob[projectId] = next;
  return writeBlob(blob);
}
