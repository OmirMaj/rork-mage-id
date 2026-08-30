// utils/scheduleImport.ts — PURE. No I/O, no imports from React/Supabase.
import type {
  ScheduleTask, DependencyLink, DependencyType, ImportedScheduleRow, ScheduleImportWarning,
} from '@/types';
import { createId } from '@/utils/scheduleEngine';

// MSPDI PredecessorLink.Type → MAGE dependency type.
export const MSPDI_LINK_TYPE: Record<number, DependencyLink['type']> = {
  0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS',
};

// MSPDI ConstraintType → MAGE anchorType. Values match the AnchorType union
// (types/index.ts): 0 ASAP → 'none', 1 ALAP → 'as-late-as-possible'.
export const MSPDI_CONSTRAINT_TYPE: Record<number, string> = {
  0: 'none', 1: 'as-late-as-possible', 2: 'must-start-on', 3: 'must-finish-on',
  4: 'start-no-earlier', 5: 'start-no-later', 6: 'finish-no-earlier', 7: 'finish-no-later',
};

const HOURS_PER_DAY = 8;

/** Parse a duration string to whole working days (>=0). Handles MSPDI ISO-8601
 *  (PT40H0M0S = 40h/8 = 5d) and Excel free text ("5 days","3d","2 wks","4"). */
export function parseDurationDays(raw: string | undefined): number {
  if (!raw) return 1;
  const s = String(raw).trim().toLowerCase();
  const iso = s.match(/^pt(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (iso) { const h = parseFloat(iso[1] ?? '0'); return Math.max(0, Math.round(h / HOURS_PER_DAY)); }
  const num = parseFloat(s.replace(/[^0-9.]/g, '')) || 0;
  if (/w(ee)?k/.test(s)) return Math.max(0, Math.round(num * 5));
  if (/h(ou)?r/.test(s)) return Math.max(0, Math.round(num / HOURS_PER_DAY));
  return Math.max(0, Math.round(num));
}

/** Parse "3FS+2d, 5SS-1d" or "3,5" → [{ sourceId, type, lagDays }]. */
export function parsePredecessorString(raw: string | undefined):
  { sourceId: string; type: DependencyLink['type']; lagDays: number }[] {
  if (!raw) return [];
  return String(raw).split(/[,;]/).map(tok => tok.trim()).filter(Boolean).map(tok => {
    const m = tok.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?/i);
    if (!m) return null;
    const lag = m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0;
    return { sourceId: m[1], type: (m[2]?.toUpperCase() as DependencyLink['type']) ?? 'FS', lagDays: lag };
  }).filter((x): x is { sourceId: string; type: DependencyType; lagDays: number } => x !== null);
}

export interface MapOptions { scheduleStartDate: string; workingDaysPerWeek: number }

export function mapRowsToScheduleTasks(
  rows: ImportedScheduleRow[],
  opts: MapOptions,
): { tasks: ScheduleTask[]; warnings: ScheduleImportWarning[] } {
  const warnings: ScheduleImportWarning[] = [];
  // 1. First pass: create tasks + a sourceId → newId map (drop empty-title rows).
  const idBySource = new Map<string, string>();
  const kept = rows.filter(r => (r.title ?? '').trim().length > 0);
  if (kept.length < rows.length) warnings.push({ code: 'empty_title', message: `${rows.length - kept.length} row(s) had no task name and were skipped.` });
  for (const r of kept) idBySource.set(r.sourceId, createId('task'));

  // 2. Second pass: build ScheduleTask, remapping predecessor sourceIds → newIds.
  const startEpoch = Date.parse(opts.scheduleStartDate);
  const tasks: ScheduleTask[] = kept.map(r => {
    const durationDays = r.milestone ? 0 : parseDurationDays(r.rawDuration);
    const startDay = computeStartDay(r.rawStart, startEpoch, opts) ?? 1;
    const preds = parsePredecessorString(r.rawPredecessors);
    // Surface tokens that couldn't be parsed at all (e.g. "see note", an alpha
    // WBS reference, a task-name dependency) — parsePredecessorString drops
    // them silently, so without this the GC gets no signal that links were lost.
    const rawTokenCount = (r.rawPredecessors ?? '')
      .split(/[,;]/).map(s => s.trim()).filter(Boolean).length;
    if (rawTokenCount > preds.length) {
      warnings.push({
        code: 'bad_predecessor',
        message: `${rawTokenCount - preds.length} predecessor reference(s) on "${r.title.trim()}" could not be read and were dropped.`,
        sourceId: r.sourceId,
      });
    }
    const dependencyLinks: DependencyLink[] = [];
    for (const p of preds) {
      const target = idBySource.get(p.sourceId);
      if (!target) { warnings.push({ code: 'dangling_dep', message: `Predecessor ${p.sourceId} not found; link dropped.`, sourceId: r.sourceId }); continue; }
      dependencyLinks.push({ taskId: target, type: p.type, lagDays: p.lagDays });
    }
    return {
      id: idBySource.get(r.sourceId)!,
      title: r.title.trim(),
      phase: 'General',
      durationDays,
      startDay,
      progress: clamp(r.progress ?? 0, 0, 100),
      crew: r.resource ?? '',
      dependencies: dependencyLinks.map(d => d.taskId), // legacy mirror
      dependencyLinks,
      notes: r.notes ?? '',
      status: 'not_started',
      isMilestone: durationDays === 0 || !!r.milestone,
      wbsCode: r.wbs,
      outlineLevel: r.outlineLevel,
      // anchorDate is declared 'YYYY-MM-DD' (types/index.ts). MSPDI's
      // <ConstraintDate> is a full datetime, so normalise at the boundary and
      // store the canonical shape rather than whatever the file happened to
      // carry. utils/cpm.isoToDay also tolerates a timestamp now, but data that
      // matches its own type is worth more than a parser that forgives it.
      ...(r.constraintType != null && MSPDI_CONSTRAINT_TYPE[r.constraintType]
        ? {
            anchorType: MSPDI_CONSTRAINT_TYPE[r.constraintType] as ScheduleTask['anchorType'],
            anchorDate: r.constraintDate ? r.constraintDate.slice(0, 10) : undefined,
          }
        : {}),
      ...(r.resource ? { resourceIds: [] } : {}),
    } as ScheduleTask;
  });

  // 3. Rebuild parent/child from outlineLevel (nearest preceding lower level = parent).
  assignParents(tasks, warnings);
  return { tasks, warnings };
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

/** Working-day offset (1-indexed) of a date from the schedule start. Naive
 *  calendar-day delta then compressed to the work week is acceptable for v1. */
function computeStartDay(rawStart: string | undefined, startEpoch: number, opts: MapOptions): number | null {
  if (!rawStart) return null;
  const t = Date.parse(rawStart);
  if (Number.isNaN(t) || Number.isNaN(startEpoch)) return null;
  const calDays = Math.round((t - startEpoch) / 86_400_000);
  if (calDays <= 0) return 1;
  const wpw = opts.workingDaysPerWeek || 7;
  const weeks = Math.floor(calDays / 7), rem = calDays % 7;
  return weeks * wpw + Math.min(rem, wpw) + 1;
}

/** parentId from outlineLevel: nearest earlier task with a strictly lower level. */
function assignParents(tasks: (ScheduleTask & { outlineLevel?: number })[], _warnings: ScheduleImportWarning[]) {
  const stack: ScheduleTask[] = [];
  for (const t of tasks) {
    const lvl = t.outlineLevel ?? 0;
    while (stack.length && ((stack[stack.length - 1].outlineLevel ?? 0) >= lvl)) stack.pop();
    t.parentId = stack.length ? stack[stack.length - 1].id : undefined;
    stack.push(t);
  }
  // Mark parents as summaries (CPM ignores their author duration).
  const parentIds = new Set(tasks.map(t => t.parentId).filter(Boolean) as string[]);
  for (const t of tasks) if (parentIds.has(t.id)) t.isSummary = true;
}
