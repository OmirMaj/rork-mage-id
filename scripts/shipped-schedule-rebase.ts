// scripts/shipped-schedule-rebase.ts — NOT app code. Schedule Pro's rebase as
// it shipped in 357d0a34 (utils/fieldScheduleUpdate.ts, verbatim), kept only
// as the CONTROL the schedule validators replay: the screen no longer rebases
// (utils/scheduleMerge.ts — it ignores outside copies while busy and adopts the
// server's whole once quiet), so the function left the app module in
// integration round 2 rather than linger there with only validators calling it.
import type { ScheduleTask } from '../types';
import { FIELD_EDIT_STAMPS, FIELD_TASK_PATCH_KEYS } from '../utils/fieldScheduleUpdate';

const DERIVED_TASK_KEYS = new Set<string>(['isCriticalPath', 'wbsCode', 'collapsed', 'fieldEditedAt']);
type Stamps = Record<string, string>;
function stampsOf(t: unknown): Stamps {
  const v = (t as Record<string, unknown> | null | undefined)?.[FIELD_EDIT_STAMPS];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Stamps) : {};
}
function stampMs(s: string | undefined): number | null {
  if (typeof s !== 'string') return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Same task content, ignoring the keys the app writes by itself (stamps,
 *  critical-path flags, outline state) and key order. */
function sameTaskContent(a: ScheduleTask, b: ScheduleTask): boolean {
  const ar = a as unknown as Record<string, unknown>;
  const br = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(ar), ...Object.keys(br)]);
  for (const k of keys) {
    if (DERIVED_TASK_KEYS.has(k)) continue;
    if (!same(ar[k], br[k])) return false;
  }
  return true;
}

/**
 * Bring a screen's working copy up to a NEWER server copy that arrived from
 * outside the screen — the foreground refetch, or this device's own write
 * coming back stamped — without losing the edits the screen has not saved.
 * `baseline` is the last server copy the screen absorbed.
 *
 *   • a task with no unsaved local edit (same content as `baseline`) → the
 *     server's, values and stamps: the foreman's 60% appears before the GC
 *     edits, and his next change is stamped after it and wins;
 *   • a task WITH an unsaved local edit → the local one, except that a field
 *     key the local copy did not change takes the server's value and stamp,
 *     and a key where both agree takes the freshest stamp. A key BOTH changed
 *     stays local; stampFieldEdits decides it on save and the screen reports
 *     a refusal (staleFieldEdits);
 *   • a task deleted locally stays deleted, one added locally stays, one the
 *     server added appears, one the server deleted (and not edited here) goes.
 * Local order is kept when there are unsaved edits (a pending reorder is an
 * edit); with none, the server's list is taken as it is.
 */
export function rebaseWorkingTasks(
  baseline: readonly ScheduleTask[],
  incoming: readonly ScheduleTask[],
  local: readonly ScheduleTask[],
): ScheduleTask[] {
  const baseById = new Map(baseline.map(t => [t.id, t] as const));
  const incById = new Map(incoming.map(t => [t.id, t] as const));
  const localIds = new Set(local.map(t => t.id));
  const unsaved = local.length !== baseline.length
    || local.some((t, i) => baseline[i]?.id !== t.id || !sameTaskContent(t, baseline[i]));
  if (!unsaved) return [...incoming];
  const out: ScheduleTask[] = [];
  for (const loc of local) {
    const inc = incById.get(loc.id);
    const base = baseById.get(loc.id);
    if (!inc) {
      // Added here and not saved yet → keep. Deleted on the server → keep only
      // if edited here (the editor's save decides), else it goes.
      if (!base || !sameTaskContent(loc, base)) out.push(loc);
      continue;
    }
    if (base && sameTaskContent(loc, base)) { out.push(inc); continue; }
    const ir = inc as unknown as Record<string, unknown>;
    const lr = loc as unknown as Record<string, unknown>;
    const br = base as unknown as Record<string, unknown> | undefined;
    const iS = stampsOf(inc);
    const next = { ...lr };
    const stamps: Stamps = { ...stampsOf(loc) };
    for (const k of FIELD_TASK_PATCH_KEYS) {
      if (same(ir[k], lr[k])) {
        const iMs = stampMs(iS[k]);
        const lMs = stampMs(stamps[k]);
        if (iMs != null && (lMs == null || iMs > lMs)) stamps[k] = iS[k];
      } else if (br && same(lr[k], br[k])) {
        if (k in ir) next[k] = ir[k]; else delete next[k];
        if (iS[k] !== undefined) stamps[k] = iS[k]; else delete stamps[k];
      }
    }
    if (Object.keys(stamps).length > 0) next[FIELD_EDIT_STAMPS] = stamps;
    out.push(next as unknown as ScheduleTask);
  }
  for (const inc of incoming) {
    if (!localIds.has(inc.id) && !baseById.has(inc.id)) out.push(inc);
  }
  return out;
}

