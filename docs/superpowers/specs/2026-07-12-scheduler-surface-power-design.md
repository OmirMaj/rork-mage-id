# Scheduler Phase 3 — Surface the Power — Design

**Date:** 2026-07-12
**Branch:** `claude/scheduler-front-door` (continues the scheduler round; PR #74)
**Surface:** Web / desktop Pro scheduler (`app/schedule-pro.tsx`). Gated to `width >= GRID_BREAKPOINT` (900). Phone unaffected.
**Status:** Approved for autonomous build (owner delegated overnight; "build everything… perfect it").

## Goal

MAGE's scheduler already has a deeper engine than its competitors — full CPM with total/free float, a working resource-leveling pass, and a structured audit log — but every one of those is **hidden or unreachable**. Phase 3 surfaces them as legible, plain-language UI so the power is actually usable:

1. **Fix overloads** — one button that runs the already-built leveling engine and applies it, with a preview.
2. **Explained critical-path / float panel** — replace the raw `Alert` with a panel that says, per task, "on the critical path" or "can slip N days."
3. **Audit-log viewer** — a read UI over the audit log that's already being written on every edit.

Everything reuses existing pure engines. **OTA-safe: JS-only, no native modules, no CPM/offline-queue/persistence changes** (leveling is applied through the same undo-aware `commit`).

## Confirmed substrate (already exists — we only add UI + thin wiring)

- **Leveling:** `levelResources(ctx: LevelingContext): { leveled: Map<taskId, startDay>; conflicts: CpmConflict[] }` (`utils/cpm.ts:810`), pure; reachable through `runCpm(tasks, { levelResources: true })` → `CpmResult.leveledStartDays` (`cpm.ts:1006`). Currently NO caller sets the flag.
- **Float:** `CpmTaskResult { es, ef, ls, lf, totalFloat, freeFloat, isCritical }` (`cpm.ts:50`); `CpmResult { perTask, projectFinish, criticalPath: string[], conflicts, … }` (`cpm.ts:72`). Current UI = `showCpmAnalysis()` raw `Alert` (`schedule-pro.tsx:1005`), wired to the Track menu's `onCriticalPath`.
- **Audit:** `ScheduleAuditEntry` (`types/index.ts:667`); helpers `buildAuditEntry`, `appendAuditToAsyncStorage`, `loadAuditFromAsyncStorage`, `groupAuditByDay`, `summarizeTaskDiff` (`utils/scheduleAudit.ts`); key `tertiary_schedule_audit::<projectId>`, 500-entry FIFO. Entries ARE written today on edits (`schedule-pro.tsx:586-597`). No read UI exists.
- **Patterns to mirror:** `EarnedValuePanel.tsx` / `BaselineManagerModal.tsx` (Modal + ScrollView + `useThemedStyles` + X-close header). Modals are declared in `schedule-pro.tsx` as `<X visible={showX} onClose=… />` with a `useState` toggle, opened from a `SchedulerMenuBar` action. `SchedulerActions` interface holds the menu callbacks.
- **Workload:** `WorkloadTab.tsx:69-92` computes a per-resource weekly load matrix and tints cells amber (≥2) / red (over capacity) — the natural home for a contextual "Fix overloads" button.

## Feature A — Fix overloads (resource leveling)

**Pure helper** `utils/levelingSummary.ts`:
```ts
export interface LevelingShift { id: string; title: string; fromDay: number; toDay: number; deltaDays: number }
export interface LevelingSummary { shiftedCount: number; maxShiftDays: number; totalShiftDays: number; shifts: LevelingShift[] }
export function summarizeLeveling(prev: ScheduleTask[], leveled: Map<string, number>): LevelingSummary;
```
Compares each task's current `startDay` to its leveled `startDay`; collects only tasks that actually move (`delta !== 0`); `maxShiftDays` = max `|delta|`, `totalShiftDays` = sum `|delta|`. Pure, validated.

**Flow (`schedule-pro.tsx` `handleFixOverloads`):** run `runCpm(rolledTasks, { levelResources: true })`; take `leveledStartDays`; `summarizeLeveling(workingTasks, leveled)`. If `shiftedCount === 0` → a "No overloads to resolve — every crew is within capacity" info alert. Else open a `LevelingPreviewModal` showing "N tasks shift · project finish +D days · biggest move M days" and the shift list. On **Apply**: `commit(prev => prev.map(t => leveled.has(t.id) ? { ...t, startDay: leveled.get(t.id)! } : t))` (one undo step) and write an audit entry (`kind: 'reflow'`, summary "Resource leveling: N tasks shifted"). On **Cancel**: close, no change.

**New component** `components/schedule/LevelingPreviewModal.tsx` (`visible`, `summary`, `projectFinishDelta`, `onApply`, `onClose`) — mirrors `EarnedValuePanel`.

**Entry points:** (1) `SchedulerMenuBar` Track group → "Fix overloads" (`onLevelResources`); (2) a contextual button rendered in `WorkloadTab` when any load cell is over capacity, calling the same handler via a new optional `onFixOverloads?` prop.

## Feature B — Explained critical-path / float panel

**Pure helper** `utils/floatExplain.ts`:
```ts
export function floatPhrase(totalFloat: number): string; // ≤0 → "On the critical path — no slack"; else "Can slip N day(s)"
export interface CriticalPathExplanation {
  finishDay: number;
  criticalTitles: { id: string; title: string }[]; // in criticalPath order
  slack: { id: string; title: string; canSlipDays: number }[]; // non-critical, sorted by canSlipDays asc, capped 20
}
export function buildCriticalPathExplanation(cpm: CpmResult, tasks: ScheduleTask[]): CriticalPathExplanation;
```
Pure (takes the already-computed `cpm`), validated.

**New component** `components/schedule/CriticalPathPanel.tsx` (`visible`, `explanation`, `onClose`) — mirrors `EarnedValuePanel`. Header "What's driving the finish date"; the critical chain as an ordered list (Title → Title → …); then "These have breathing room" with each near-critical task and `floatPhrase`. Plain language, no CPI/float jargon in the headline.

**Wiring:** replace `showCpmAnalysis`'s `Alert` body with `setShowCriticalPath(true)`; build the explanation from the live `cpm` in render. Keep the existing `onCriticalPath` menu wiring pointing at the opener.

## Feature C — Audit-log viewer

**New component** `components/schedule/ScheduleAuditModal.tsx` (`visible`, `projectId`, `onClose`): on open, `loadAuditFromAsyncStorage(projectId)` → `groupAuditByDay` → a scrollable day-by-day timeline. Each entry: time · user · `kind` chip · `summary`; when `before`/`after` exist, a muted second line from `summarizeTaskDiff(before, after)`. Empty state: "No schedule history yet — edits you make will show up here." Loading state while the async read resolves.

**Broaden writes (small, makes the log useful):** add audit entries for **task create** (in `handleAddTasks` — one `task_create` entry per batch summarizing "N task(s) added" or the single title) and **task delete** (in `handleDeleteTask`). Reuse `buildAuditEntry` + `appendAuditToAsyncStorage`; guarded by `project?.id`. No new kinds needed (`task_create`, `task_delete` already in the union).

**Wiring:** `SchedulerMenuBar` Track group → "History" (`onHistory`); `schedule-pro` state `showAudit` + `<ScheduleAuditModal visible={showAudit} projectId={project.id} onClose=… />`.

## Menu / prop threading

`SchedulerActions` (in `SchedulerMenuBar.tsx`) gains `onLevelResources` and `onHistory`. Both are added to the Track group. `schedule-pro` passes them in the existing `actions={{…}}` object. `WorkloadTab` gains an optional `onFixOverloads?` prop, threaded through `SchedulerTabShell` (render-prop or props) the way other tab callbacks are.

## Testing

- **`scripts/validate-leveling-summary.ts`** (`test:leveling-summary`) — no shifts → empty; mixed shifts → correct count/max/total, ignores zero-delta; ids preserved.
- **`scripts/validate-float-explain.ts`** (`test:float-explain`) — `floatPhrase` boundaries (−2/0 → critical wording; 1 → "Can slip 1 day"; 3 → "3 days"); `buildCriticalPathExplanation` orders the critical chain, filters/sorts slack, caps at 20.
- Both wired into the `ship-check` `&&`-chain.
- `npx tsc --noEmit` clean; `bun run lint` 0 errors, no new warnings in touched files.
- **Owner visual review at merge** (web ≥900px): Fix overloads previews then applies (undoable); the critical-path panel reads in plain language; the audit modal shows real edit history grouped by day.

## Constraints

- **OTA-safe:** JS-only, no native modules. Leveling applies through `commit` (undo + persist intact). CPM engine, offline queue, persistence untouched.
- Anti-slop lint (tokens only). Types in `types/index.ts` (no shape changes — all fields exist).
- Desktop-gated (`width >= GRID_BREAKPOINT`); phone flow unchanged.

## Out of scope (deferred)
Per-day (vs weekly) workload granularity; drag-to-reassign resources; interactive what-if leveling scenarios; audit export; leveling that also respects calendars/closures beyond what `levelResources` already does.
