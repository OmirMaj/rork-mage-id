// utils/copilot/scheduleEdit/editOps.ts — the typed edit-operation vocabulary
// the AI emits, plus a pure normalizer. React/RN-free so validators drive it.
import type { DependencyType, ScheduleTask } from '@/types';
import { workingOrdinalToCalendarIndex, calendarDayToDate, type DayScaleOptions } from '@/utils/cpm';
import { parseCalendarDay, formatCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

/** A task reference: a ScheduleTask.id. The resolver (interpretOps) also
 *  falls back to a case-insensitive name match. */
export type TaskRef = string;

export type EditOp =
  | { op: 'move'; task: TaskRef; deltaDays?: number; toStartDay?: number }
  | { op: 'setDuration'; task: TaskRef; days: number }
  | { op: 'addDependency'; from: TaskRef; to: TaskRef; type: DependencyType; lag: number }
  | { op: 'removeDependency'; from: TaskRef; to: TaskRef }
  // `parallel`: he said the new work runs alongside, so it hangs off its
  // anchor without taking over the anchor's successors (see interpretOps).
  | { op: 'addTask'; title: string; durationDays: number; after?: TaskRef; crew?: number; isMilestone?: boolean; parallel?: boolean }
  | { op: 'removeTask'; task: TaskRef }
  | { op: 'setCrew'; task: TaskRef; crewSize: number }
  | { op: 'setProgress'; task: TaskRef; pct: number }
  | { op: 'level' };
// NOTE: a `setStartDate` op is intentionally NOT in v1 — re-anchoring the whole
// schedule interacts with the start-date-jump behavior and belongs to a
// dedicated flow, not a task-array edit. Shipping it here would be a silent
// no-op (the commit path only touches tasks). Add it deliberately later.

/** An op the AI sent that the app could not use. Kept (never silently
 *  dropped) so the review can say "Understood 3 of 4 changes" and name the one
 *  it couldn't read. Each turn's answer is the complete draft, so a turn's
 *  dropped lines replace the last turn's (see adoptCompleteDraft). */
export interface DroppedOp {
  summary: string;
  /** The raw pieces of the line, so a screen that has the task list can name
   *  a task by its TITLE (describeDropped) — `summary` can only print the ref
   *  the model sent, which in production is a UUID. */
  parts?: { op: string; refs: string[]; why: string };
}

export interface NormalizedEditOps { ops: EditOp[]; dropped: DroppedOp[] }

const DEP_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && isFinite(v) ? v : fallback);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The capability's schemaHint shows every op SHAPE with placeholder refs
 *  ('<task id>', '<new task title>'). A ref that starts with '<' is the model
 *  copying the example, never a real task — so it can never touch one. */
export const isPlaceholderRef = (v: unknown): boolean => typeof v === 'string' && v.trim().startsWith('<');

const REF_FIELDS = ['task', 'from', 'to', 'after', 'title'] as const;
type RefField = (typeof REF_FIELDS)[number];

/** The ref fields each op kind actually READS. Placeholders are judged only
 *  here (review round 3, written against the wave-6a union schema that declared
 *  all five ref fields on every op — rolled back live 2026-09-23). The relay's
 *  anyOf rule now gives each op a CLOSED shape with only its own slots, so a
 *  foreign slot should not arrive; this stays as a net for an old relay or a
 *  decoder that fills an UNUSED slot by echoing the example ({op:'addTask',
 *  title:'Drywall hang', after:'t1', task:'<task id>'}) — that must not cost
 *  him a complete, valid add. The old rule
 *  dropped the whole op when ANY of the five fields held a placeholder, and
 *  "add three tasks" could come back "Understood 0 of 3". An unknown op kind
 *  reads nothing we know of — it is judged on all five, then reported. */
const OWN_REFS: Record<string, readonly RefField[]> = {
  move: ['task'], setDuration: ['task'], setCrew: ['task'], setProgress: ['task'], removeTask: ['task'],
  addDependency: ['from', 'to'], removeDependency: ['from', 'to'],
  addTask: ['title', 'after'],
  level: [],
};
const ownRefs = (op: unknown): readonly RefField[] =>
  (typeof op === 'string' && Object.prototype.hasOwnProperty.call(OWN_REFS, op) ? OWN_REFS[op] : REF_FIELDS);

/** A copy with placeholder values removed from every ref field this op kind
 *  does NOT read — they are the decoder filling a slot, not part of the op. */
function scrubForeignPlaceholders(a: Record<string, unknown>): Record<string, unknown> {
  const own = ownRefs(a.op);
  const out = { ...a };
  for (const f of REF_FIELDS) if (!own.includes(f) && isPlaceholderRef(out[f])) delete out[f];
  return out;
}

/** An op is a pure echo of the example when every ref/title it READS is a
 *  placeholder. Those are not changes anybody asked for, so they are not
 *  reported as "couldn't read" either — they are dropped without a line. An
 *  op that mixes a real title with a placeholder `after` IS a real request
 *  with a missing piece, and is reported. */
function isPureEcho(a: Record<string, unknown>): boolean {
  const refs = ownRefs(a.op).map(f => a[f]).filter(v => typeof v === 'string' && v.trim() !== '');
  return refs.length > 0 && refs.every(isPlaceholderRef);
}

/** The identity of an op: the same op kind on the same task (or, for an add,
 *  the same title AT the same anchor — job names repeat, so "Inspection" after
 *  framing and after drywall are two tasks). Used only to carry an add's
 *  `parallel` flag from the queued draft (adoptCompleteDraft); it never merges
 *  or drops ops. */
export function opKey(op: { op: string } & Record<string, unknown>): string {
  const lc = (v: unknown) => str(v).toLowerCase();
  switch (op.op) {
    case 'addTask': return `addTask|${lc(op.title)}|${lc(op.after)}`;
    case 'addDependency':
    case 'removeDependency': return `${op.op}|${lc(op.from)}|${lc(op.to)}`;
    case 'level': return 'level';
    default: return `${op.op}|${lc(op.task)}`;
  }
}

/** The refs an unusable op names, in reading order (placeholders left out). */
function rawRefs(a: Record<string, unknown>): string[] {
  // A known kind names the refs it reads (an add is named by its title, not
  // its anchor); a slot it does not read never names it.
  const own = ownRefs(a.op);
  if (own !== REF_FIELDS) {
    return (a.op === 'addTask' ? (['title'] as const) : own).map(f => str(a[f])).filter(r => r && !isPlaceholderRef(r));
  }
  const refs = str(a.title) ? [str(a.title)]
    : str(a.task) ? [str(a.task)]
    : (str(a.from) && str(a.to) ? [str(a.from), str(a.to)] : []);
  return refs.filter(r => !isPlaceholderRef(r));
}
const rawLine = (op: string, refs: string[], why: string) =>
  `${op}${refs.length ? ` “${refs.join(' → ')}”` : ''} — ${why}`;

/** Human line for an op the app could not use ("add “Drywall” — no duration"). */
function describeRaw(a: Record<string, unknown>, why: string): { summary: string; parts: NonNullable<DroppedOp['parts']> } {
  const parts = { op: str(a.op) || 'change', refs: rawRefs(a), why };
  return { summary: rawLine(parts.op, parts.refs, why), parts };
}

/** A task ref as he'd say it: an id prints as that task's title, a title
 *  prints in the schedule's own casing (not the model's "DRYWALL TAPE"). */
export function taskName(ref: string, tasks: ScheduleTask[]): string {
  const byId = tasks.find(t => t.id === ref);
  if (byId) return byId.title;
  const lc = ref.trim().toLowerCase();
  return tasks.find(t => t.title.trim().toLowerCase() === lc)?.title ?? ref;
}

/** The "Couldn't read" line with tasks named by title where they resolve. */
export function describeDropped(d: DroppedOp, tasks: ScheduleTask[]): string {
  if (!d.parts) return d.summary;
  return rawLine(d.parts.op, d.parts.refs.map(r => taskName(r, tasks)), d.parts.why);
}

/** Validate + clean a raw AI ops array into usable EditOps. Pure. Unknown ops,
 *  missing required refs, and out-of-bounds values are not trusted — but they
 *  are REPORTED in `dropped` rather than vanishing, so the review can say what
 *  it couldn't read. */
export function normalizeEditOps(raw: unknown): NormalizedEditOps {
  if (!Array.isArray(raw)) return { ops: [], dropped: [] };
  const out: EditOp[] = [];
  const dropped: DroppedOp[] = [];
  const drop = (a: Record<string, unknown>, why: string) => { dropped.push(describeRaw(a, why)); };
  // `level` carries no ref, so an echoed { op: 'level' } example cannot be
  // told from a request by its value. An answer that echoes any example is
  // copying the list: its `level` is part of the copy, not a request.
  let echoed = false;
  for (const r of raw) {
    if (r === null || typeof r !== 'object') continue;
    const sent = r as Record<string, unknown>;
    const op = sent.op;
    if (typeof op !== 'string' || !op.trim()) { drop(sent, 'no change type'); continue; }
    const a = scrubForeignPlaceholders(sent);
    if (isPureEcho(a)) { echoed = true; continue; }
    const placeholder = ownRefs(op).find(f => isPlaceholderRef(a[f]));
    if (placeholder) { drop(a, placeholder === 'after' ? 'no position given for the new task' : `no ${placeholder === 'title' ? 'name' : 'task'} given`); continue; }
    switch (op) {
      case 'move': {
        const task = str(a.task); if (!task) { drop(a, 'no task given'); break; }
        const move: EditOp = { op: 'move', task };
        if (typeof a.deltaDays === 'number' && isFinite(a.deltaDays) && Math.round(a.deltaDays) !== 0) move.deltaDays = Math.round(a.deltaDays);
        // toStartDay ≤ 0 is the decoder filling a field it had to declare, not
        // "move it to day 1" — treat it as absent.
        if (typeof a.toStartDay === 'number' && isFinite(a.toStartDay) && a.toStartDay >= 1) move.toStartDay = Math.round(a.toStartDay);
        // A 0-day move (or one with no amount) changes nothing — report it
        // rather than show it as a change.
        if (move.deltaDays === undefined && move.toStartDay === undefined) { drop(a, 'no amount to move by'); break; }
        out.push(move); break;
      }
      case 'setDuration': {
        const task = str(a.task); const days = numOr(a.days, NaN);
        if (task && isFinite(days) && days >= 0) out.push({ op: 'setDuration', task, days: Math.round(days) });
        else drop(a, !task ? 'no task given' : 'no valid duration');
        break;
      }
      case 'addDependency': {
        const from = str(a.from), to = str(a.to);
        if (!from || !to || from === to) { drop(a, 'needs two different tasks'); break; }
        const type = DEP_TYPES.includes(a.type as DependencyType) ? (a.type as DependencyType) : 'FS';
        out.push({ op: 'addDependency', from, to, type, lag: Math.round(numOr(a.lag, 0)) });
        break;
      }
      case 'removeDependency': {
        const from = str(a.from), to = str(a.to);
        if (from && to) out.push({ op: 'removeDependency', from, to });
        else drop(a, 'needs two tasks');
        break;
      }
      case 'addTask': {
        const title = str(a.title); const durationDays = numOr(a.durationDays, NaN);
        if (!title) { drop(a, 'no name for the new task'); break; }
        if (!isFinite(durationDays) || durationDays < 0) { drop(a, 'no valid duration'); break; }
        const t: EditOp = { op: 'addTask', title, durationDays: Math.round(durationDays) };
        if (str(a.after)) t.after = str(a.after);
        if (typeof a.crew === 'number' && a.crew > 0) t.crew = Math.round(a.crew);
        if (a.isMilestone === true || durationDays === 0) t.isMilestone = true;
        if (a.parallel === true) t.parallel = true;
        out.push(t); break;
      }
      case 'removeTask': {
        const task = str(a.task); if (task) out.push({ op: 'removeTask', task }); else drop(a, 'no task given'); break;
      }
      case 'setCrew': {
        const task = str(a.task); const crewSize = numOr(a.crewSize ?? a.crew, NaN);
        if (task && isFinite(crewSize) && crewSize >= 0) out.push({ op: 'setCrew', task, crewSize: Math.round(crewSize) });
        else drop(a, !task ? 'no task given' : 'no valid crew size');
        break;
      }
      case 'setProgress': {
        const task = str(a.task); const pct = numOr(a.pct, NaN);
        if (task && isFinite(pct)) out.push({ op: 'setProgress', task, pct: clamp(Math.round(pct), 0, 100) });
        else drop(a, !task ? 'no task given' : 'no valid percent');
        break;
      }
      case 'level': out.push({ op: 'level' }); break;
      default: drop(a, 'not a change this editor can make'); break;
    }
  }
  return { ops: echoed ? out.filter(o => o.op !== 'level') : out, dropped };
}

/** Fold a turn's answer into the draft — THE COMPLETE-DRAFT RULE (integration
 *  round 6). Every turn the prompt shows the queued draft and asks the model
 *  for the COMPLETE list of ops for everything he has asked so far: keep what
 *  still stands, change what he corrected, add what is new, leave out what he
 *  took back. So the answer simply REPLACES the draft: `ops` is this turn's
 *  normalized ops and `dropped` is this turn's dropped only.
 *
 *  Why not merge: five review rounds circled a merge that guessed, from word
 *  lists, whether a re-sent add was a correction (move it) or another one
 *  (append it). "No, that's too early", "the second floor", "an extra day" and
 *  "add an inspection after drywall" each broke it one way or the other — a
 *  doubled chain, or a requested task silently gone. Replacing needs no guess:
 *  the count on the review is always exactly what the model returned for his
 *  whole request, and every op in it is shown.
 *
 *  The ONE thing carried across turns is the `parallel` flag, because the
 *  schema cannot express it (it is read from his words, never the model's):
 *  an add that is the SAME add as a queued one (same title at the same anchor,
 *  opKey) keeps the queued flag; an add that is new this turn takes this
 *  turn's words (PARALLEL_RE). This never changes how many ops there are or
 *  where they go. Pure. */
export function adoptCompleteDraft(
  prev: { ops?: EditOp[] },
  next: NormalizedEditOps,
  opts: { parallelThisTurn?: boolean } = {},
): { ops: EditOp[]; dropped: DroppedOp[] } {
  const key = (o: EditOp) => opKey(o as { op: string } & Record<string, unknown>);
  const queuedAdds = new Map<string, boolean>();
  for (const o of prev.ops ?? []) if (o.op === 'addTask') queuedAdds.set(key(o), queuedAdds.get(key(o)) === true || o.parallel === true);
  const ops = next.ops.map((o): EditOp => {
    if (o.op !== 'addTask') return o;
    const k = key(o);
    const parallel = queuedAdds.has(k) ? queuedAdds.get(k) === true : opts.parallelThisTurn === true;
    const out = { ...o };
    if (parallel) out.parallel = true; else delete out.parallel;
    return out;
  });
  return { ops, dropped: [...next.dropped] };
}

/** He asked for the new work to run alongside, not in sequence. Read from
 *  his own words (deterministic), not left to the model. */
export const PARALLEL_RE = /\b(in parallel|at the same time|alongside|concurrent(ly)?|simultaneous(ly)?)\b/i;

const signed = (n: number) => (n > 0 ? `+${n}d` : `${n}d`);

/** How the "what landed" card names a working-day ordinal. On a DATED plan it
 *  prints the date ("Tue, Oct 13") — the review shows calendar dates and
 *  calendar deltas, and "day 20 → 27" printed seconds later read as a second,
 *  different move. An undated plan keeps "day N". */
function dayLabel(dayScale?: DayScaleOptions): (ordinal: number) => string {
  const start = parseCalendarDay(dayScale?.scheduleStartDate);
  if (!start || !dayScale) return (n) => `day ${n}`;
  return (n) => formatCalendarDay(
    toCalendarDayString(calendarDayToDate(start, workingOrdinalToCalendarIndex(n, dayScale))),
    { weekday: 'short', month: 'short', day: 'numeric' },
  );
}

/** One plain line per op, naming tasks by title — for the "what landed" list.
 *  `detail.anchorTitle` is the task an add ACTUALLY follows (interpretOps'
 *  result, after same-anchor chaining); `tasks` should include the rows the
 *  batch added so a title ref prints in the schedule's casing. */
export function describeEditOp(
  op: EditOp,
  tasks: ScheduleTask[],
  detail?: { anchorTitle?: string; fromDay?: number; toDay?: number; askedDay?: number },
  dayScale?: DayScaleOptions,
): string {
  const name = (ref: string) => taskName(ref, tasks);
  switch (op.op) {
    case 'move': {
      // Where it was scheduled and where it is scheduled now (interpretOps'
      // result) — what the Gantt shows. op.deltaDays is what the model sent:
      // "Moved Trim +14d" was printed over a +2d ripple (review round 4).
      if (detail?.fromDay != null && detail.toDay != null) {
        const day = dayLabel(dayScale);
        const asked = detail.askedDay != null && detail.askedDay !== detail.toDay ? `; asked for ${day(detail.askedDay)}` : '';
        return `Moved ${name(op.task)} to ${day(detail.toDay)} (was ${day(detail.fromDay)}${asked})`;
      }
      return op.toStartDay != null ? `Moved ${name(op.task)} to day ${op.toStartDay}` : `Moved ${name(op.task)} ${signed(op.deltaDays ?? 0)}`;
    }
    case 'setDuration': return `${name(op.task)} is now ${op.days}d`;
    case 'setCrew': return `${name(op.task)} crew set to ${op.crewSize}`;
    case 'setProgress': return `${name(op.task)} at ${op.pct}%`;
    case 'addDependency': return `${name(op.to)} now follows ${name(op.from)} (${op.type}${op.lag ? ` ${signed(op.lag)}` : ''})`;
    case 'removeDependency': return `${name(op.to)} no longer waits on ${name(op.from)}`;
    case 'addTask': {
      const after = detail?.anchorTitle ?? (op.after ? name(op.after) : undefined);
      const where = after ? ` after ${after}${op.parallel ? ' (in parallel)' : ''}` : ' at the end, with nothing linked to it';
      return `Added ${op.title} (${op.durationDays}d)${where}`;
    }
    case 'removeTask': return `Removed ${name(op.task)}`;
    case 'level': return 'Re-levelled crew overloads';
    default: return 'change';
  }
}
